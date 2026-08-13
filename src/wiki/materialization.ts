import { createHash } from "node:crypto";
import { resolveSpanById } from "../linter/storage.js";
import type {
	Claim,
	ConceptRef,
	Relation,
	SourceSpan,
	WikiAssertion,
	WikiModule,
} from "../types/index.js";
import { claimRef } from "../types/index.js";

export const WIKI_SUPPORT_CONTRACT_VERSION = "wge-wiki-support/v1" as const;

export interface WikiModuleSeed {
	id: string;
	stableAddress: string;
	coreQuestion: string;
	claimRefs: string[];
	conceptRefs?: ConceptRef[];
	dependencies?: string[];
}

export interface WikiMaterializationContext {
	sourceKnowledgeVersion: string;
	rebuiltFromSnapshotId: string | null;
	updatedAt: string;
}

export interface WikiSupportInspection {
	consumable: boolean;
	reasons: string[];
}

/** Conditions are part of the displayed assertion so a concise Wiki cannot erase applicability. */
export function renderWikiAssertion(claim: Claim): string {
	const conditions =
		claim.conditions.length === 0 ? "" : `（适用条件：${claim.conditions.join("；")}）`;
	return `${claim.statement}${conditions}`;
}

export function materializeWikiModule(
	seed: WikiModuleSeed,
	claims: Claim[],
	spans: SourceSpan[],
	context: WikiMaterializationContext,
): WikiModule {
	if (!seed.id.trim() || !seed.stableAddress.trim() || !seed.coreQuestion.trim()) {
		throw new Error("WikiModule id、stableAddress 与 coreQuestion 不能为空");
	}
	const claimById = new Map(claims.map((claim) => [claim.id, claim]));
	const orderedIds = [...new Set(seed.claimRefs)];
	if (orderedIds.length === 0) throw new Error(`WikiModule 至少需要一个 Claim: ${seed.id}`);

	const assertions: WikiAssertion[] = orderedIds.map((id) => {
		const claim = claimById.get(id);
		if (!claim) throw new Error(`WikiModule 引用不存在的 Claim: ${seed.id} -> ${id}`);
		assertClaimCanMaterialize(claim, spans, seed.id);
		const renderedText = renderWikiAssertion(claim);
		return {
			id: `wiki-assertion:${hash({ moduleId: seed.id, claimId: id, renderedText }).slice(0, 24)}`,
			role: claim.validity === "SUPPORTED" ? "CURRENT" : "DISPUTE",
			claimRef: claimRef(id),
			renderedText,
		};
	});
	const current = assertions.filter((assertion) => assertion.role === "CURRENT");
	const disputes = assertions.filter((assertion) => assertion.role === "DISPUTE");
	const moduleWithoutHash = {
		id: seed.id,
		stableAddress: seed.stableAddress,
		coreQuestion: seed.coreQuestion,
		currentUnderstanding:
			current.length === 0
				? "当前没有通过争议门禁的确定结论。"
				: current.map((assertion) => assertion.renderedText).join("\n"),
		disputes: disputes.map((assertion) => assertion.renderedText),
		claimRefs: assertions.map((assertion) => assertion.claimRef),
		conceptRefs: [...(seed.conceptRefs ?? [])],
		dependencies: [...(seed.dependencies ?? [])],
		publicationState: "CANONICAL" as const,
		updatedAt: context.updatedAt,
	};
	return {
		...moduleWithoutHash,
		materialization: {
			schemaVersion: "wge-wiki-materialization/v1",
			supportContractVersion: WIKI_SUPPORT_CONTRACT_VERSION,
			sourceKnowledgeVersion: context.sourceKnowledgeVersion,
			supportHash: wikiSupportHash(moduleWithoutHash, assertions),
			rebuiltFromSnapshotId: context.rebuiltFromSnapshotId,
			assertions,
		},
	};
}

export function inspectWikiModuleSupport(
	module: WikiModule,
	claims: Claim[],
	spans: SourceSpan[],
): WikiSupportInspection {
	const reasons: string[] = [];
	const materialization = module.materialization;
	if (!materialization) return { consumable: false, reasons: ["missing-materialization-contract"] };
	if (materialization.supportContractVersion !== WIKI_SUPPORT_CONTRACT_VERSION) {
		reasons.push("unsupported-materialization-contract");
	}
	if (materialization.assertions.length === 0) reasons.push("empty-assertions");
	const claimById = new Map(claims.map((claim) => [claim.id, claim]));
	const assertionRefs = materialization.assertions.map((assertion) => assertion.claimRef as string);
	if (new Set(assertionRefs).size !== assertionRefs.length)
		reasons.push("duplicate-assertion-claim");
	if (JSON.stringify(assertionRefs) !== JSON.stringify(module.claimRefs.map(String))) {
		reasons.push("claim-refs-do-not-match-assertions");
	}

	for (const assertion of materialization.assertions) {
		const claim = claimById.get(assertion.claimRef as string);
		if (!claim) {
			reasons.push(`missing-claim:${assertion.claimRef as string}`);
			continue;
		}
		try {
			assertClaimCanMaterialize(claim, spans, module.id);
		} catch (error) {
			reasons.push(error instanceof Error ? error.message : String(error));
		}
		const expectedRole = claim.validity === "SUPPORTED" ? "CURRENT" : "DISPUTE";
		if (assertion.role !== expectedRole) reasons.push(`role-mismatch:${claim.id}`);
		if (assertion.renderedText !== renderWikiAssertion(claim)) {
			reasons.push(`rendered-text-mismatch:${claim.id}`);
		}
	}

	const currentAssertions = materialization.assertions.filter(
		(assertion) => assertion.role === "CURRENT",
	);
	const disputeAssertions = materialization.assertions.filter(
		(assertion) => assertion.role === "DISPUTE",
	);
	const expectedUnderstanding =
		currentAssertions.length === 0
			? "当前没有通过争议门禁的确定结论。"
			: currentAssertions.map((assertion) => assertion.renderedText).join("\n");
	if (module.currentUnderstanding !== expectedUnderstanding) reasons.push("understanding-mismatch");
	if (
		JSON.stringify(module.disputes) !==
		JSON.stringify(disputeAssertions.map((assertion) => assertion.renderedText))
	) {
		reasons.push("disputes-mismatch");
	}
	const expectedHash = wikiSupportHash(module, materialization.assertions);
	if (materialization.supportHash !== expectedHash) reasons.push("support-hash-mismatch");
	return { consumable: reasons.length === 0, reasons };
}

/**
 * Rebuild a quarantined materialized view from audited evolution edges.
 * SUPERSEDES replaces the old slot; CONTRADICTS preserves both sides as an explicit dispute.
 */
export function rebuildWikiModulesAfterEvolution(
	modules: WikiModule[],
	claims: Claim[],
	triggerRelations: Relation[],
	spans: SourceSpan[],
	context: WikiMaterializationContext,
): WikiModule[] {
	const claimById = new Map(claims.map((claim) => [claim.id, claim]));
	return modules.map((module) => {
		const nextIds: string[] = [];
		for (const ref of module.claimRefs.map(String)) {
			const replacement = triggerRelations.find(
				(relation) => relation.type === "SUPERSEDES" && (relation.to as string) === ref,
			);
			if (replacement) nextIds.push(replacement.from as string);
			else nextIds.push(ref);
		}
		for (const relation of triggerRelations) {
			if (relation.type !== "CONTRADICTS") continue;
			const endpoints = [relation.from as string, relation.to as string];
			if (!endpoints.some((id) => nextIds.includes(id))) continue;
			nextIds.push(...endpoints);
		}
		const consumableIds = [...new Set(nextIds)].filter((id) => {
			const claim = claimById.get(id);
			return (
				claim?.publicationState === "CANONICAL" &&
				claim.lifecycle === "ACTIVE" &&
				["SUPPORTED", "DISPUTED", "UNRESOLVED"].includes(claim.validity)
			);
		});
		return materializeWikiModule(
			{
				id: module.id,
				stableAddress: module.stableAddress,
				coreQuestion: module.coreQuestion,
				claimRefs: consumableIds,
				conceptRefs: module.conceptRefs,
				dependencies: module.dependencies,
			},
			claims,
			spans,
			context,
		);
	});
}

function assertClaimCanMaterialize(claim: Claim, spans: SourceSpan[], moduleId: string): void {
	if (claim.publicationState !== "CANONICAL") {
		throw new Error(`WikiModule 引用非 Canonical Claim: ${moduleId} -> ${claim.id}`);
	}
	if (claim.lifecycle !== "ACTIVE") {
		throw new Error(`WikiModule 引用非 Active Claim: ${moduleId} -> ${claim.id}`);
	}
	if (claim.evidenceSpanIds.length === 0) {
		throw new Error(`WikiModule Claim 缺少 SourceSpan 证据: ${moduleId} -> ${claim.id}`);
	}
	for (const spanId of claim.evidenceSpanIds) {
		if (!resolveSpanById(spans, spanId)) {
			throw new Error(`WikiModule Claim 证据不可解析: ${moduleId} -> ${claim.id} -> ${spanId}`);
		}
	}
}

function wikiSupportHash(
	module: Pick<
		WikiModule,
		"id" | "stableAddress" | "coreQuestion" | "currentUnderstanding" | "disputes" | "claimRefs"
	>,
	assertions: WikiAssertion[],
): string {
	return `wiki-support:${hash({
		id: module.id,
		stableAddress: module.stableAddress,
		coreQuestion: module.coreQuestion,
		currentUnderstanding: module.currentUnderstanding,
		disputes: module.disputes,
		claimRefs: module.claimRefs.map(String),
		assertions: assertions.map((assertion) => ({
			id: assertion.id,
			role: assertion.role,
			claimRef: assertion.claimRef as string,
			renderedText: assertion.renderedText,
		})),
	})}`;
}

function hash(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
