import { createHash } from "node:crypto";
import { resolveSpanById } from "../linter/storage.js";
import type {
	Claim,
	ConceptRef,
	QuestionFrame,
	Relation,
	SourceSpan,
	WikiAssertion,
	WikiConditionalBranch,
	WikiKnownGap,
	WikiModule,
} from "../types/index.js";
import { claimRef } from "../types/index.js";
import { QUESTION_WIKI_CLAIM_LIMIT, isQuestionFrameConsumable } from "./question-model.js";

export const WIKI_SUPPORT_CONTRACT_VERSION = "wge-wiki-support/v1" as const;
export const WIKI_SUPPORT_CONTRACT_VERSION_V2 = "wge-wiki-support/v2" as const;

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
	questionEvolutionDecisionId?: string | null;
}

export interface WikiSupportInspectionOptions {
	relations?: Relation[];
	questionFrames?: QuestionFrame[];
	expectedKnowledgeVersion?: string;
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

/** Materialize the current answer to one stable long-term question without inventing prose. */
export function materializeQuestionWikiModule(
	frame: QuestionFrame,
	claims: Claim[],
	relations: Relation[],
	spans: SourceSpan[],
	context: WikiMaterializationContext,
): WikiModule {
	if (!isQuestionFrameConsumable(frame)) {
		throw new Error(`只有 ACTIVE Canonical QuestionFrame 可以物化: ${frame.id}`);
	}
	const claimById = new Map(claims.map((claim) => [claim.id, claim]));
	const signaledClaimIds = [
		...new Set(frame.formationSignals.flatMap((signal) => signal.claimRefs.map(String))),
	].sort();
	const activeClaims = signaledClaimIds.flatMap((id) => {
		const claim = claimById.get(id);
		if (!claim) throw new Error(`QuestionFrame 引用不存在的 Claim: ${frame.id} -> ${id}`);
		if (claim.lifecycle !== "ACTIVE") return [];
		assertClaimCanMaterialize(claim, spans, String(frame.id));
		return [claim];
	});
	if (activeClaims.length > QUESTION_WIKI_CLAIM_LIMIT) {
		throw new Error(
			`QuestionFrame 超过 WikiModule Claim 上限: ${frame.id}: ${activeClaims.length}/${QUESTION_WIKI_CLAIM_LIMIT}`,
		);
	}
	const relationIds = [
		...new Set(frame.formationSignals.flatMap((signal) => signal.relationIds)),
	].sort();
	const relationById = new Map(relations.map((relation) => [relation.id, relation]));
	const activeClaimIds = new Set(activeClaims.map((claim) => claim.id));
	const consumableRelationIds = relationIds.filter((id) => {
		const relation = relationById.get(id);
		if (!relation) throw new Error(`QuestionFrame 引用不存在的 Relation: ${frame.id} -> ${id}`);
		return (
			relation.publicationState === "CANONICAL" &&
			relation.lifecycle === "ACTIVE" &&
			relation.validity !== "UNRESOLVED" &&
			relation.conditionStatus !== "UNVERIFIED" &&
			Boolean(relation.relationAuditVersion) &&
			activeClaimIds.has(String(relation.from)) &&
			activeClaimIds.has(String(relation.to))
		);
	});
	const moduleId = `wiki:${String(frame.id).replace(/^question:/, "")}`;
	const assertions = activeClaims.map((claim) => {
		const renderedText = renderWikiAssertion(claim);
		const role = assertionRoleV2(claim);
		return {
			id: `wiki-assertion:${hash({ moduleId, claimId: claim.id, renderedText, role }).slice(0, 24)}`,
			role,
			claimRef: claimRef(claim.id),
			renderedText,
		};
	});
	const conditionalBranches = buildConditionalBranches(moduleId, activeClaims);
	const knownGaps = buildKnownGaps(moduleId, activeClaims, assertions);
	const currentAssertions = assertions.filter((assertion) => assertion.role === "CURRENT");
	const disputes = assertions.filter((assertion) => assertion.role === "DISPUTE");
	const moduleWithoutHash: WikiModule = {
		id: moduleId,
		stableAddress: frame.stableAddress.replace(/^question\//, "wiki/"),
		coreQuestion: frame.canonicalQuestion,
		currentUnderstanding: renderCurrentUnderstanding(
			currentAssertions.map((assertion) => assertion.renderedText),
			conditionalBranches,
			knownGaps,
		),
		disputes: disputes.map((assertion) => assertion.renderedText),
		claimRefs: assertions.map((assertion) => assertion.claimRef),
		conceptRefs: [
			...new Set(frame.formationSignals.flatMap((signal) => signal.conceptRefs)),
		].sort(),
		dependencies: frame.parentQuestionRefs.map(
			(ref) => `wiki:${String(ref).replace(/^question:/, "")}`,
		),
		publicationState: "CANONICAL",
		updatedAt: context.updatedAt,
		questionRef: frame.id,
		conditionalBranches,
		knownGaps,
		relationRefs: consumableRelationIds,
	};
	return {
		...moduleWithoutHash,
		materialization: {
			schemaVersion: "wge-wiki-materialization/v2",
			supportContractVersion: WIKI_SUPPORT_CONTRACT_VERSION_V2,
			sourceKnowledgeVersion: context.sourceKnowledgeVersion,
			supportHash: wikiSupportHashV2(moduleWithoutHash, assertions),
			rebuiltFromSnapshotId: context.rebuiltFromSnapshotId,
			questionRef: frame.id,
			questionUpdatedAtKnowledgeVersion: frame.updatedAtKnowledgeVersion,
			questionEvolutionDecisionId: context.questionEvolutionDecisionId ?? null,
			assertions,
			relationIds: consumableRelationIds,
			conditionalBranches,
			knownGaps,
		},
	};
}

export function inspectWikiModuleSupport(
	module: WikiModule,
	claims: Claim[],
	spans: SourceSpan[],
	options: WikiSupportInspectionOptions = {},
): WikiSupportInspection {
	const reasons: string[] = [];
	const materialization = module.materialization;
	if (!materialization) return { consumable: false, reasons: ["missing-materialization-contract"] };
	if (materialization.schemaVersion === "wge-wiki-materialization/v2") {
		return inspectQuestionWikiModuleSupport(module, claims, spans, options);
	}
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

function inspectQuestionWikiModuleSupport(
	module: WikiModule,
	claims: Claim[],
	spans: SourceSpan[],
	options: WikiSupportInspectionOptions,
): WikiSupportInspection {
	const reasons: string[] = [];
	const materialization = module.materialization;
	if (!materialization || materialization.schemaVersion !== "wge-wiki-materialization/v2") {
		return { consumable: false, reasons: ["missing-v2-materialization-contract"] };
	}
	if (materialization.supportContractVersion !== WIKI_SUPPORT_CONTRACT_VERSION_V2) {
		reasons.push("unsupported-materialization-contract");
	}
	const frame = options.questionFrames?.find(
		(candidate) => String(candidate.id) === String(materialization.questionRef),
	);
	if (!frame) reasons.push(`missing-question-frame:${materialization.questionRef}`);
	else {
		if (!isQuestionFrameConsumable(frame))
			reasons.push(`question-frame-not-consumable:${frame.id}`);
		if (module.questionRef !== frame.id) reasons.push("module-question-ref-mismatch");
		if (module.coreQuestion !== frame.canonicalQuestion) reasons.push("core-question-mismatch");
		if (module.stableAddress !== frame.stableAddress.replace(/^question\//, "wiki/")) {
			reasons.push("stable-address-mismatch");
		}
		if (materialization.questionUpdatedAtKnowledgeVersion !== frame.updatedAtKnowledgeVersion) {
			reasons.push("question-version-mismatch");
		}
	}
	if (
		options.expectedKnowledgeVersion &&
		materialization.sourceKnowledgeVersion !== options.expectedKnowledgeVersion
	) {
		reasons.push("source-knowledge-version-mismatch");
	}
	const claimById = new Map(claims.map((claim) => [claim.id, claim]));
	const assertionRefs = materialization.assertions.map((assertion) => String(assertion.claimRef));
	if (new Set(assertionRefs).size !== assertionRefs.length)
		reasons.push("duplicate-assertion-claim");
	if (JSON.stringify(assertionRefs) !== JSON.stringify(module.claimRefs.map(String))) {
		reasons.push("claim-refs-do-not-match-assertions");
	}
	for (const assertion of materialization.assertions) {
		const claim = claimById.get(String(assertion.claimRef));
		if (!claim) {
			reasons.push(`missing-claim:${assertion.claimRef}`);
			continue;
		}
		try {
			assertClaimCanMaterialize(claim, spans, module.id);
		} catch (error) {
			reasons.push(error instanceof Error ? error.message : String(error));
		}
		if (assertion.role !== assertionRoleV2(claim)) reasons.push(`role-mismatch:${claim.id}`);
		if (assertion.renderedText !== renderWikiAssertion(claim)) {
			reasons.push(`rendered-text-mismatch:${claim.id}`);
		}
	}
	const activeClaims = assertionRefs.flatMap((id) => {
		const claim = claimById.get(id);
		return claim ? [claim] : [];
	});
	const expectedBranches = buildConditionalBranches(module.id, activeClaims);
	const expectedGaps = buildKnownGaps(module.id, activeClaims, materialization.assertions);
	if (JSON.stringify(module.conditionalBranches ?? []) !== JSON.stringify(expectedBranches)) {
		reasons.push("conditional-branches-mismatch");
	}
	if (JSON.stringify(materialization.conditionalBranches) !== JSON.stringify(expectedBranches)) {
		reasons.push("materialized-conditional-branches-mismatch");
	}
	if (JSON.stringify(module.knownGaps ?? []) !== JSON.stringify(expectedGaps)) {
		reasons.push("known-gaps-mismatch");
	}
	if (JSON.stringify(materialization.knownGaps) !== JSON.stringify(expectedGaps)) {
		reasons.push("materialized-known-gaps-mismatch");
	}
	const expectedDisputes = materialization.assertions
		.filter((assertion) => assertion.role === "DISPUTE")
		.map((assertion) => assertion.renderedText);
	if (JSON.stringify(module.disputes) !== JSON.stringify(expectedDisputes)) {
		reasons.push("disputes-mismatch");
	}
	const expectedUnderstanding = renderCurrentUnderstanding(
		materialization.assertions
			.filter((assertion) => assertion.role === "CURRENT")
			.map((assertion) => assertion.renderedText),
		expectedBranches,
		expectedGaps,
	);
	if (module.currentUnderstanding !== expectedUnderstanding) reasons.push("understanding-mismatch");
	if (JSON.stringify(module.relationRefs ?? []) !== JSON.stringify(materialization.relationIds)) {
		reasons.push("relation-refs-mismatch");
	}
	const suppliedRelationIds = new Set((options.relations ?? []).map((relation) => relation.id));
	for (const relationId of materialization.relationIds) {
		if (!suppliedRelationIds.has(relationId)) reasons.push(`missing-relation:${relationId}`);
	}
	if (materialization.assertions.length === 0 && materialization.knownGaps.length === 0) {
		reasons.push("empty-assertions-without-gap");
	}
	const expectedHash = wikiSupportHashV2(module, materialization.assertions);
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

function wikiSupportHashV2(module: WikiModule, assertions: WikiAssertion[]): string {
	return `wiki-support-v2:${hash({
		id: module.id,
		stableAddress: module.stableAddress,
		coreQuestion: module.coreQuestion,
		questionRef: module.questionRef,
		currentUnderstanding: module.currentUnderstanding,
		disputes: module.disputes,
		claimRefs: module.claimRefs.map(String),
		relationRefs: module.relationRefs ?? [],
		conditionalBranches: module.conditionalBranches ?? [],
		knownGaps: module.knownGaps ?? [],
		assertions: assertions.map((assertion) => ({
			id: assertion.id,
			role: assertion.role,
			claimRef: String(assertion.claimRef),
			renderedText: assertion.renderedText,
		})),
	})}`;
}

function assertionRoleV2(claim: Claim): WikiAssertion["role"] {
	if (claim.validity === "DISPUTED") return "DISPUTE";
	if (claim.validity === "UNRESOLVED") return "UNRESOLVED";
	return claim.conditions.length > 0 ? "CONDITIONAL" : "CURRENT";
}

function buildConditionalBranches(moduleId: string, claims: Claim[]): WikiConditionalBranch[] {
	return claims
		.filter((claim) => claim.validity === "SUPPORTED" && claim.conditions.length > 0)
		.map((claim) => ({
			id: `wiki-branch:${hash({ moduleId, claimId: claim.id, conditions: claim.conditions }).slice(0, 24)}`,
			conditions: [...claim.conditions],
			claimRefs: [claimRef(claim.id)],
			renderedText: renderWikiAssertion(claim),
		}));
}

function buildKnownGaps(
	moduleId: string,
	claims: Claim[],
	assertions: WikiAssertion[],
): WikiKnownGap[] {
	const gaps = claims
		.filter((claim) => claim.validity === "UNRESOLVED")
		.map((claim) => {
			const kind = claim.claimKind === "FACT" ? "EVIDENCE" : "NORMATIVE";
			const description =
				kind === "EVIDENCE"
					? `现有材料尚不足以判断：${claim.statement}`
					: `该问题依赖尚未确定的决定或偏好：${claim.statement}`;
			return {
				id: `wiki-gap:${hash({ moduleId, claimId: claim.id, kind }).slice(0, 24)}`,
				kind,
				description,
				claimRefs: [claimRef(claim.id)],
				relationIds: [],
			} satisfies WikiKnownGap;
		});
	const supported = assertions.some((assertion) =>
		["CURRENT", "CONDITIONAL"].includes(assertion.role),
	);
	if (!supported && gaps.length === 0) {
		gaps.push({
			id: `wiki-gap:${hash({ moduleId, kind: "EVIDENCE", state: "no-current-support" }).slice(0, 24)}`,
			kind: "EVIDENCE",
			description: "当前没有足够材料形成受支持的结论。",
			claimRefs: [],
			relationIds: [],
		});
	}
	return gaps;
}

function renderCurrentUnderstanding(
	currentTexts: string[],
	conditionalBranches: WikiConditionalBranch[],
	knownGaps: WikiKnownGap[],
): string {
	if (currentTexts.length > 0) return currentTexts.join("\n");
	if (conditionalBranches.length > 0) return "当前认识只在已列出的特定条件下成立。";
	if (knownGaps.length > 0) return "当前没有足够材料形成无条件结论；已保留明确的知识缺口。";
	return "当前没有通过争议门禁的确定结论。";
}

function hash(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
