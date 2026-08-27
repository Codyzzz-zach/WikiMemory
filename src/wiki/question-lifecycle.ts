import { createHash } from "node:crypto";
import type {
	Claim,
	QuestionEvolutionDecision,
	QuestionFormationSignal,
	QuestionFrame,
	QuestionRef,
	Relation,
	Scope,
	SourceSpan,
} from "../types/index.js";
import { claimRef, questionRef } from "../types/index.js";
import {
	QUESTION_FORMATION_VERSION,
	questionFrameHash,
	validateQuestionFrame,
} from "./question-model.js";

export interface QuestionLifecycleTarget {
	canonicalQuestion: string;
	aliases: string[];
	boundaries: string[];
}

export interface QuestionLifecycleProposal {
	proposalId: string;
	action: "MERGE" | "SPLIT" | "ARCHIVE" | "REOPEN";
	questionRefs: QuestionRef[];
	targets: QuestionLifecycleTarget[];
	claimIds: string[];
	relationIds: string[];
	reasonCodes: string[];
	rationale: string;
}

export interface QuestionLifecycleGateInput {
	sourceId: string;
	knowledgeVersion: string;
	proposals: QuestionLifecycleProposal[];
	existingFrames: QuestionFrame[];
	claims: Claim[];
	relations: Relation[];
	spans: SourceSpan[];
	now?: string;
}

export interface QuestionLifecycleGateResult {
	framesToPublish: QuestionFrame[];
	evolutionDecisions: QuestionEvolutionDecision[];
	decisions: Array<{
		proposalId: string;
		accepted: boolean;
		reasonCodes: string[];
		questionRef: QuestionRef | null;
		lifecycle: null;
	}>;
}

/** Deterministic identity-migration gate for rare Question merge/split/archive/reopen events. */
export function gateQuestionLifecycleProposals(
	input: QuestionLifecycleGateInput,
): QuestionLifecycleGateResult {
	const now = input.now ?? new Date().toISOString();
	if (!Number.isFinite(Date.parse(now))) throw new Error(`now 必须是 ISO 日期: ${now}`);
	const frameById = new Map(input.existingFrames.map((frame) => [String(frame.id), frame]));
	const claimById = new Map(input.claims.map((claim) => [claim.id, claim]));
	const relationById = new Map(input.relations.map((relation) => [relation.id, relation]));
	const spanIds = new Set(input.spans.map((span) => span.id));
	const semanticKeys = new Set(
		input.existingFrames.flatMap((frame) =>
			[frame.canonicalQuestion, ...frame.aliases].map((text) =>
				semanticKey(frame.domain, frame.scope, text),
			),
		),
	);
	const framesToPublish: QuestionFrame[] = [];
	const evolutionDecisions: QuestionEvolutionDecision[] = [];
	const decisions: QuestionLifecycleGateResult["decisions"] = [];

	for (const proposal of [...input.proposals].sort((left, right) =>
		left.proposalId.localeCompare(right.proposalId),
	)) {
		const reasons = validateProposal(proposal);
		const sources = proposal.questionRefs.flatMap((ref) => {
			const frame = frameById.get(String(ref));
			if (!frame) reasons.push("UNKNOWN_QUESTION");
			return frame ? [frame] : [];
		});
		if (new Set(proposal.questionRefs.map(String)).size !== proposal.questionRefs.length) {
			reasons.push("DUPLICATE_QUESTION_REF");
		}
		if (sources.length > 1) {
			const first = sources[0];
			if (
				first &&
				sources.some(
					(frame) => frame.domain !== first.domain || !sameScope(frame.scope, first.scope),
				)
			) {
				reasons.push("CROSS_DOMAIN_OR_SCOPE_MIGRATION");
			}
		}
		if (
			["MERGE", "SPLIT"].includes(proposal.action) &&
			sources.some((frame) => !["ACTIVE", "CANDIDATE"].includes(frame.lifecycle))
		) {
			reasons.push("SOURCE_NOT_EVOLVABLE");
		}
		if (
			proposal.action === "ARCHIVE" &&
			sources.some((frame) => !["ACTIVE", "CANDIDATE"].includes(frame.lifecycle))
		) {
			reasons.push("SOURCE_NOT_ARCHIVABLE");
		}
		if (proposal.action === "REOPEN" && sources.some((frame) => frame.lifecycle !== "ARCHIVED")) {
			reasons.push("SOURCE_NOT_ARCHIVED");
		}
		for (const id of proposal.claimIds) {
			const claim = claimById.get(id);
			if (!claim) {
				reasons.push("UNKNOWN_CLAIM");
				continue;
			}
			if (
				claim.publicationState !== "CANONICAL" ||
				claim.lifecycle !== "ACTIVE" ||
				claim.evidenceSpanIds.length === 0 ||
				claim.evidenceSpanIds.some((spanId) => !spanIds.has(spanId))
			) {
				reasons.push("NON_CONSUMABLE_CLAIM");
			}
		}
		for (const id of proposal.relationIds) {
			const relation = relationById.get(id);
			if (
				!relation ||
				relation.publicationState !== "CANONICAL" ||
				relation.lifecycle !== "ACTIVE" ||
				!relation.relationAuditVersion
			) {
				reasons.push("NON_CONSUMABLE_RELATION");
			}
		}
		const owner = sources[0];
		if (owner) {
			for (const target of proposal.targets) {
				const key = semanticKey(owner.domain, owner.scope, target.canonicalQuestion);
				if (semanticKeys.has(key)) reasons.push("DUPLICATE_TARGET_QUESTION");
			}
		}
		if (
			new Set(
				proposal.targets.map((target) =>
					owner
						? semanticKey(owner.domain, owner.scope, target.canonicalQuestion)
						: target.canonicalQuestion,
				),
			).size !== proposal.targets.length
		) {
			reasons.push("DUPLICATE_TARGET_QUESTION");
		}

		const uniqueReasons = [...new Set(reasons)].sort();
		if (uniqueReasons.length > 0 || !owner) {
			decisions.push({
				proposalId: proposal.proposalId,
				accepted: false,
				reasonCodes: uniqueReasons,
				questionRef: null,
				lifecycle: null,
			});
			continue;
		}

		const beforeHash = compositeHash(sources);
		const nextFrames = applyLifecycle(proposal, sources, input.knowledgeVersion, now);
		for (const frame of nextFrames) {
			frameById.set(String(frame.id), frame);
			semanticKeys.add(semanticKey(frame.domain, frame.scope, frame.canonicalQuestion));
		}
		const afterHash = compositeHash(nextFrames);
		const decision = lifecycleDecision(input, proposal, nextFrames, beforeHash, afterHash, now);
		framesToPublish.push(...nextFrames);
		evolutionDecisions.push(decision);
		decisions.push({
			proposalId: proposal.proposalId,
			accepted: true,
			reasonCodes: [...new Set([proposal.action, ...proposal.reasonCodes])].sort(),
			questionRef: null,
			lifecycle: null,
		});
	}

	return {
		framesToPublish: latestFrames(framesToPublish),
		evolutionDecisions: evolutionDecisions.sort((a, b) => a.id.localeCompare(b.id)),
		decisions,
	};
}

function validateProposal(proposal: QuestionLifecycleProposal): string[] {
	const reasons: string[] = [];
	if (!proposal.proposalId.trim()) reasons.push("EMPTY_PROPOSAL_ID");
	if (!proposal.rationale.trim()) reasons.push("MISSING_RATIONALE");
	if (proposal.reasonCodes.length === 0) reasons.push("MISSING_REASON_CODE");
	if (proposal.claimIds.length === 0) reasons.push("MISSING_EVIDENCE_CLAIM");
	if (proposal.action === "MERGE") {
		if (proposal.questionRefs.length < 2) reasons.push("MERGE_REQUIRES_MULTIPLE_SOURCES");
		if (proposal.targets.length !== 1) reasons.push("MERGE_REQUIRES_ONE_TARGET");
	}
	if (proposal.action === "SPLIT") {
		if (proposal.questionRefs.length !== 1) reasons.push("SPLIT_REQUIRES_ONE_SOURCE");
		if (proposal.targets.length < 2) reasons.push("SPLIT_REQUIRES_MULTIPLE_TARGETS");
	}
	if (["ARCHIVE", "REOPEN"].includes(proposal.action)) {
		if (proposal.questionRefs.length !== 1) reasons.push("STATE_CHANGE_REQUIRES_ONE_SOURCE");
		if (proposal.targets.length !== 0) reasons.push("STATE_CHANGE_FORBIDS_TARGETS");
	}
	for (const target of proposal.targets) {
		if (!target.canonicalQuestion.trim()) reasons.push("EMPTY_TARGET_QUESTION");
		if (target.boundaries.map((item) => item.trim()).filter(Boolean).length === 0) {
			reasons.push("MISSING_TARGET_BOUNDARY");
		}
	}
	return reasons;
}

function applyLifecycle(
	proposal: QuestionLifecycleProposal,
	sources: QuestionFrame[],
	knowledgeVersion: string,
	now: string,
): QuestionFrame[] {
	const owner = sources[0];
	if (!owner) throw new Error("lifecycle source missing after gate");
	if (proposal.action === "ARCHIVE") {
		if (owner.lifecycle === "ARCHIVED") throw new Error(`Question already archived: ${owner.id}`);
		return [
			validateQuestionFrame({
				...owner,
				lifecycle: "ARCHIVED",
				publicationState: "CANONICAL",
				updatedAtKnowledgeVersion: knowledgeVersion,
				updatedAt: now,
			}),
		];
	}
	if (proposal.action === "REOPEN") {
		if (owner.lifecycle !== "ARCHIVED")
			throw new Error(`Only ARCHIVED Question can reopen: ${owner.id}`);
		return [
			validateQuestionFrame({
				...owner,
				lifecycle: "ACTIVE",
				updatedAtKnowledgeVersion: knowledgeVersion,
				updatedAt: now,
			}),
		];
	}

	const targets = proposal.targets.map((target) =>
		createTargetFrame(owner, sources, target, proposal, knowledgeVersion, now),
	);
	if (proposal.action === "MERGE") {
		const target = targets[0];
		if (!target) throw new Error("merge target missing after gate");
		return [
			...sources.map((source) =>
				validateQuestionFrame({
					...source,
					lifecycle: "MERGED",
					publicationState: "CANONICAL",
					mergedInto: target.id,
					childQuestionRefs: [...new Set([...source.childQuestionRefs, target.id])],
					updatedAtKnowledgeVersion: knowledgeVersion,
					updatedAt: now,
				}),
			),
			target,
		];
	}
	return [
		validateQuestionFrame({
			...owner,
			lifecycle: "SPLIT",
			publicationState: "CANONICAL",
			childQuestionRefs: targets.map((target) => target.id),
			updatedAtKnowledgeVersion: knowledgeVersion,
			updatedAt: now,
		}),
		...targets,
	];
}

function createTargetFrame(
	owner: QuestionFrame,
	sources: QuestionFrame[],
	target: QuestionLifecycleTarget,
	proposal: QuestionLifecycleProposal,
	knowledgeVersion: string,
	now: string,
): QuestionFrame {
	const key = semanticKey(owner.domain, owner.scope, target.canonicalQuestion);
	const digest = createHash("sha256").update(key).digest("hex").slice(0, 24);
	const signals: QuestionFormationSignal[] = [
		...sources.flatMap((source) => source.formationSignals),
		{
			type: "CLAIM_CLUSTER",
			sourceIds: [
				...new Set(
					sources.flatMap((source) => source.formationSignals.flatMap((s) => s.sourceIds)),
				),
			].sort(),
			claimRefs: [...new Set(proposal.claimIds)].sort().map(claimRef),
			relationIds: [...new Set(proposal.relationIds)].sort(),
			conceptRefs: [],
			reason: proposal.rationale.trim(),
		},
	];
	return validateQuestionFrame({
		id: questionRef(`question:${digest}`),
		stableAddress: `question/${slug(owner.domain)}/${digest.slice(0, 16)}`,
		canonicalQuestion: target.canonicalQuestion,
		aliases: target.aliases,
		domain: owner.domain,
		scope: owner.scope,
		boundaries: target.boundaries,
		lifecycle: "ACTIVE",
		parentQuestionRefs: sources.map((source) => source.id),
		childQuestionRefs: [],
		mergedInto: null,
		formationSignals: signals,
		publicationState: "CANONICAL",
		createdAtKnowledgeVersion: knowledgeVersion,
		updatedAtKnowledgeVersion: knowledgeVersion,
		createdAt: now,
		updatedAt: now,
	});
}

function lifecycleDecision(
	input: QuestionLifecycleGateInput,
	proposal: QuestionLifecycleProposal,
	frames: QuestionFrame[],
	beforeHash: string,
	afterHash: string,
	now: string,
): QuestionEvolutionDecision {
	const identity = JSON.stringify({
		sourceId: input.sourceId,
		knowledgeVersion: input.knowledgeVersion,
		proposalId: proposal.proposalId,
		action: proposal.action,
		beforeHash,
		afterHash,
	});
	return {
		id: `question-decision:${createHash("sha256").update(identity).digest("hex").slice(0, 24)}`,
		knowledgeVersion: input.knowledgeVersion,
		sourceId: input.sourceId,
		action: proposal.action,
		questionRefs: frames.map((frame) => frame.id),
		affectedClaimRefs: [...new Set(proposal.claimIds)].sort().map(claimRef),
		affectedRelationIds: [...new Set(proposal.relationIds)].sort(),
		reasonCodes: [...new Set([proposal.action, ...proposal.reasonCodes])].sort(),
		beforeHash,
		afterHash,
		formationVersion: QUESTION_FORMATION_VERSION,
		createdAt: now,
	};
}

function compositeHash(frames: QuestionFrame[]): string {
	return createHash("sha256")
		.update(
			JSON.stringify(
				frames
					.map((frame) => ({ id: String(frame.id), hash: questionFrameHash(frame) }))
					.sort((a, b) => a.id.localeCompare(b.id)),
			),
		)
		.digest("hex");
}

function latestFrames(frames: QuestionFrame[]): QuestionFrame[] {
	return [...new Map(frames.map((frame) => [String(frame.id), frame])).values()].sort((a, b) =>
		String(a.id).localeCompare(String(b.id)),
	);
}

function sameScope(left: Scope, right: Scope): boolean {
	return left.type === right.type && left.id === right.id;
}

function semanticKey(domain: string, scope: Scope, question: string): string {
	return JSON.stringify({
		domain: domain.trim().toLocaleLowerCase(),
		scope: { type: scope.type, id: scope.id ?? null },
		question: question
			.normalize("NFKC")
			.toLocaleLowerCase()
			.replace(/[\p{P}\p{S}\s]+/gu, ""),
	});
}

function slug(value: string): string {
	return (
		value
			.normalize("NFKC")
			.toLocaleLowerCase()
			.replace(/[^\p{L}\p{N}]+/gu, "-")
			.replace(/^-+|-+$/g, "") || "general"
	);
}
