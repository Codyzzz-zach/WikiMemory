import { createHash } from "node:crypto";
import { buildGraph } from "../graph/index.js";
import { resolveSpanById } from "../linter/storage.js";
import type {
	Claim,
	ClaimRef,
	Concept,
	ConceptRef,
	QuestionEvolutionAction,
	QuestionEvolutionDecision,
	QuestionFormationSignal,
	QuestionFrame,
	QuestionLifecycle,
	QuestionRef,
	Relation,
	Scope,
	SourceSpan,
} from "../types/index.js";
import { claimRef, conceptRef, questionRef } from "../types/index.js";
import {
	QUESTION_FORMATION_VERSION,
	QUESTION_WIKI_CLAIM_LIMIT,
	questionFrameHash,
	validateQuestionFrame,
} from "./question-model.js";

export interface QuestionCandidateProposal {
	proposalId: string;
	matchQuestionRef: QuestionRef | null;
	canonicalQuestion: string;
	aliases: string[];
	domain: string;
	scope: Scope;
	boundaries: string[];
	claimIds: string[];
	relationIds: string[];
	conceptIds: string[];
	recommendedLifecycle: "CANDIDATE" | "ACTIVE";
	rationale: string;
}

export interface QuestionFormationGateInput {
	sourceId: string;
	knowledgeVersion: string;
	declaredDomain?: string;
	proposals: QuestionCandidateProposal[];
	claims: Claim[];
	relations: Relation[];
	concepts: Concept[];
	spans: SourceSpan[];
	existingFrames: QuestionFrame[];
	now?: string;
}

export interface QuestionProposalDecision {
	proposalId: string;
	accepted: boolean;
	reasonCodes: string[];
	questionRef: QuestionRef | null;
	lifecycle: QuestionLifecycle | null;
}

export interface QuestionFormationGateResult {
	schemaVersion: "wge-question-formation-gate/v1";
	framesToPublish: QuestionFrame[];
	evolutionDecisions: QuestionEvolutionDecision[];
	decisions: QuestionProposalDecision[];
	stats: {
		proposed: number;
		accepted: number;
		rejected: number;
		created: number;
		updated: number;
		promoted: number;
		candidate: number;
		merged: number;
		split: number;
		archived: number;
		reopened: number;
	};
}

/**
 * Deterministic publication gate for semantic question proposals.
 * It never calls a model and accepts only references already present in Canonical Knowledge.
 */
export function gateQuestionProposals(
	input: QuestionFormationGateInput,
): QuestionFormationGateResult {
	const now = input.now ?? new Date().toISOString();
	assertIsoDate(now);
	const claimById = new Map(input.claims.map((claim) => [claim.id, claim]));
	const conceptById = new Map(input.concepts.map((concept) => [concept.id, concept]));
	const consumableRelations = new Map(
		buildGraph(input.claims, input.concepts, input.relations).relations.map((relation) => [
			relation.id,
			relation,
		]),
	);
	const existingById = new Map(input.existingFrames.map((frame) => [String(frame.id), frame]));
	const existingSemanticKeys = buildExistingSemanticKeys(input.existingFrames);
	const framesToPublish: QuestionFrame[] = [];
	const evolutionDecisions: QuestionEvolutionDecision[] = [];
	const decisions: QuestionProposalDecision[] = [];

	for (const proposal of [...input.proposals].sort((left, right) =>
		left.proposalId.localeCompare(right.proposalId),
	)) {
		const rejectionReasons = validateProposalShape(proposal, input.declaredDomain);
		const claims = proposal.claimIds.flatMap((id) => {
			const claim = claimById.get(id);
			if (!claim) {
				rejectionReasons.push("UNKNOWN_CLAIM");
				return [];
			}
			if (!isConsumableClaim(claim)) rejectionReasons.push("NON_CONSUMABLE_CLAIM");
			if (!scopeAllowsClaim(proposal.scope, claim.scope)) rejectionReasons.push("SCOPE_MISMATCH");
			if (
				claim.evidenceSpanIds.length === 0 ||
				claim.evidenceSpanIds.some((spanId) => !resolveSpanById(input.spans, spanId))
			) {
				rejectionReasons.push("UNRESOLVED_EVIDENCE");
			}
			return [claim];
		});
		const relations = proposal.relationIds.flatMap((id) => {
			const relation = consumableRelations.get(id);
			if (!relation) {
				rejectionReasons.push("NON_CONSUMABLE_RELATION");
				return [];
			}
			return [relation];
		});
		const concepts = proposal.conceptIds.flatMap((id) => {
			const concept = conceptById.get(id);
			if (!concept) {
				rejectionReasons.push("UNKNOWN_CONCEPT");
				return [];
			}
			return [concept];
		});

		const existing = proposal.matchQuestionRef
			? existingById.get(String(proposal.matchQuestionRef))
			: null;
		if (proposal.matchQuestionRef && !existing) rejectionReasons.push("UNKNOWN_MATCH_QUESTION");
		if (existing && !sameScope(existing.scope, proposal.scope)) {
			rejectionReasons.push("QUESTION_SCOPE_MISMATCH");
		}
		if (existing && existing.domain !== proposal.domain.trim()) {
			rejectionReasons.push("QUESTION_DOMAIN_MISMATCH");
		}
		if (existing && ["MERGED", "SPLIT"].includes(existing.lifecycle)) {
			rejectionReasons.push("TERMINAL_QUESTION_MATCH");
		}
		const cumulativeClaimIds = new Set([
			...(existing?.formationSignals.flatMap((signal) => signal.claimRefs.map(String)) ?? []),
			...claims.map((claim) => claim.id),
		]);
		if (cumulativeClaimIds.size > QUESTION_WIKI_CLAIM_LIMIT) {
			rejectionReasons.push("QUESTION_CLAIM_LIMIT_EXCEEDED");
		}

		const semanticKey = questionSemanticKey(
			proposal.domain,
			proposal.scope,
			proposal.canonicalQuestion,
		);
		const semanticOwner = existingSemanticKeys.get(semanticKey);
		if (!existing && semanticOwner) rejectionReasons.push("DUPLICATE_EXISTING_QUESTION");
		if (claims.length === 0) rejectionReasons.push("EMPTY_CLAIM_MEMBERSHIP");

		const reasonCodes = [...new Set(rejectionReasons)].sort();
		if (reasonCodes.length > 0) {
			decisions.push({
				proposalId: proposal.proposalId,
				accepted: false,
				reasonCodes,
				questionRef: existing?.id ?? null,
				lifecycle: existing?.lifecycle ?? null,
			});
			continue;
		}

		const sourceIds = uniqueSorted(
			claims.flatMap((claim) =>
				claim.evidenceSpanIds.flatMap((spanId) => {
					const span = resolveSpanById(input.spans, spanId);
					return span ? [span.sourceId] : [];
				}),
			),
		);
		const signals = deriveFormationSignals(
			input,
			claims.map((claim) => claimRef(claim.id)),
			relations,
			concepts.map((concept) => conceptRef(concept.id)),
			sourceIds,
			proposal.rationale,
		);
		const lifecycle = resolveLifecycle(proposal, claims, signals, existing ?? null);
		const frame = existing
			? updateExistingFrame(existing, proposal, signals, lifecycle, input.knowledgeVersion, now)
			: createFrame(proposal, signals, lifecycle, input.knowledgeVersion, now);
		const beforeHash = existing ? questionFrameHash(existing) : null;
		const afterHash = questionFrameHash(frame);
		const action = resolveAction(existing ?? null, lifecycle, beforeHash, afterHash);
		const evolution = evolutionDecision(input, proposal, frame, action, beforeHash, afterHash, now);
		framesToPublish.push(frame);
		evolutionDecisions.push(evolution);
		decisions.push({
			proposalId: proposal.proposalId,
			accepted: true,
			reasonCodes: action === "NO_CHANGE" ? ["NO_SEMANTIC_CHANGE"] : [action],
			questionRef: frame.id,
			lifecycle: frame.lifecycle,
		});
		existingById.set(String(frame.id), frame);
		existingSemanticKeys.set(semanticKey, frame.id);
	}

	framesToPublish.sort((left, right) => String(left.id).localeCompare(String(right.id)));
	evolutionDecisions.sort((left, right) => left.id.localeCompare(right.id));
	const accepted = decisions.filter((decision) => decision.accepted);
	return {
		schemaVersion: "wge-question-formation-gate/v1",
		framesToPublish,
		evolutionDecisions,
		decisions,
		stats: {
			proposed: decisions.length,
			accepted: accepted.length,
			rejected: decisions.length - accepted.length,
			created: evolutionDecisions.filter((decision) => decision.action === "CREATE").length,
			updated: evolutionDecisions.filter((decision) => decision.action === "UPDATE").length,
			promoted: evolutionDecisions.filter((decision) => decision.action === "PROMOTE").length,
			candidate: framesToPublish.filter((frame) => frame.lifecycle === "CANDIDATE").length,
			merged: 0,
			split: 0,
			archived: 0,
			reopened: evolutionDecisions.filter((decision) => decision.action === "REOPEN").length,
		},
	};
}

function validateProposalShape(
	proposal: QuestionCandidateProposal,
	declaredDomain?: string,
): string[] {
	const reasons: string[] = [];
	const question = proposal.canonicalQuestion.trim();
	if (!proposal.proposalId.trim()) reasons.push("EMPTY_PROPOSAL_ID");
	if (!question) reasons.push("EMPTY_QUESTION");
	if (/^关于[“\"].+[”\"]的当前知识是什么[？?]?$/.test(question)) {
		reasons.push("ARTICLE_SHAPED_GENERIC_QUESTION");
	}
	if (!proposal.domain.trim()) reasons.push("EMPTY_DOMAIN");
	if (declaredDomain && proposal.domain.trim() !== declaredDomain.trim()) {
		reasons.push("DECLARED_DOMAIN_MISMATCH");
	}
	if (proposal.boundaries.map((item) => item.trim()).filter(Boolean).length === 0) {
		reasons.push("MISSING_BOUNDARY");
	}
	if (!proposal.rationale.trim()) reasons.push("MISSING_LONG_TERM_RATIONALE");
	if (proposal.scope.type === "PROJECT" && !proposal.scope.id?.trim()) {
		reasons.push("MISSING_PROJECT_SCOPE_ID");
	}
	return reasons;
}

function isConsumableClaim(claim: Claim): boolean {
	return (
		claim.publicationState === "CANONICAL" &&
		claim.lifecycle === "ACTIVE" &&
		["SUPPORTED", "DISPUTED", "UNRESOLVED"].includes(claim.validity)
	);
}

function scopeAllowsClaim(questionScope: Scope, claimScope: Scope): boolean {
	if (questionScope.type === "GLOBAL") return claimScope.type === "GLOBAL";
	if (claimScope.type === "GLOBAL") return true;
	if (questionScope.type !== claimScope.type) return false;
	if (questionScope.type === "PROJECT") return questionScope.id === claimScope.id;
	return true;
}

function sameScope(left: Scope, right: Scope): boolean {
	return left.type === right.type && left.id === right.id;
}

function deriveFormationSignals(
	input: QuestionFormationGateInput,
	claimRefs: ClaimRef[],
	relations: Relation[],
	conceptRefs: ConceptRef[],
	sourceIds: string[],
	rationale: string,
): QuestionFormationSignal[] {
	const base = {
		sourceIds,
		claimRefs: [...claimRefs].sort(),
		relationIds: relations.map((relation) => relation.id).sort(),
		conceptRefs: [...conceptRefs].sort(),
		reason: rationale.trim(),
	};
	const signals: QuestionFormationSignal[] = [{ type: "CLAIM_CLUSTER", ...base }];
	if (input.declaredDomain) signals.push({ type: "DECLARED_DOMAIN", ...base });
	if (conceptRefs.length > 0) signals.push({ type: "STABLE_CONCEPT", ...base });
	if (sourceIds.length > 1) signals.push({ type: "CROSS_MATERIAL_RELATION", ...base });
	if (relations.some((relation) => relation.type === "CONTRADICTS")) {
		signals.push({ type: "CONTRADICTION", ...base });
	}
	if (relations.some((relation) => relation.type === "SUPERSEDES")) {
		signals.push({ type: "SUPERSESSION", ...base });
	}
	return signals;
}

function resolveLifecycle(
	proposal: QuestionCandidateProposal,
	claims: Claim[],
	signals: QuestionFormationSignal[],
	existing: QuestionFrame | null,
): "CANDIDATE" | "ACTIVE" {
	if (proposal.recommendedLifecycle === "CANDIDATE") return "CANDIDATE";
	if (claims.length < 2) return "CANDIDATE";
	if (signals.every((signal) => signal.type === "SOURCE_STRUCTURE")) return "CANDIDATE";
	if (existing?.lifecycle === "ACTIVE") return "ACTIVE";
	return "ACTIVE";
}

function createFrame(
	proposal: QuestionCandidateProposal,
	signals: QuestionFormationSignal[],
	lifecycle: "CANDIDATE" | "ACTIVE",
	knowledgeVersion: string,
	now: string,
): QuestionFrame {
	const semanticKey = questionSemanticKey(
		proposal.domain,
		proposal.scope,
		proposal.canonicalQuestion,
	);
	const digest = createHash("sha256").update(semanticKey).digest("hex").slice(0, 24);
	return validateQuestionFrame({
		id: questionRef(`question:${digest}`),
		stableAddress: `question/${slug(proposal.domain)}/${digest.slice(0, 16)}`,
		canonicalQuestion: proposal.canonicalQuestion,
		aliases: proposal.aliases,
		domain: proposal.domain,
		scope: proposal.scope,
		boundaries: proposal.boundaries,
		lifecycle,
		parentQuestionRefs: [],
		childQuestionRefs: [],
		mergedInto: null,
		formationSignals: signals,
		publicationState: lifecycle === "CANDIDATE" ? "CANDIDATE" : "CANONICAL",
		createdAtKnowledgeVersion: knowledgeVersion,
		updatedAtKnowledgeVersion: knowledgeVersion,
		createdAt: now,
		updatedAt: now,
	});
}

function updateExistingFrame(
	existing: QuestionFrame,
	proposal: QuestionCandidateProposal,
	signals: QuestionFormationSignal[],
	lifecycle: "CANDIDATE" | "ACTIVE",
	knowledgeVersion: string,
	now: string,
): QuestionFrame {
	return validateQuestionFrame({
		...existing,
		aliases: uniqueSorted([
			...existing.aliases,
			...proposal.aliases,
			...(existing.canonicalQuestion === proposal.canonicalQuestion
				? []
				: [proposal.canonicalQuestion]),
		]),
		boundaries: uniqueSorted([...existing.boundaries, ...proposal.boundaries]),
		lifecycle,
		formationSignals: uniqueSignals([...existing.formationSignals, ...signals]),
		publicationState: lifecycle === "CANDIDATE" ? "CANDIDATE" : "CANONICAL",
		updatedAtKnowledgeVersion: knowledgeVersion,
		updatedAt: now,
	});
}

function resolveAction(
	existing: QuestionFrame | null,
	lifecycle: "CANDIDATE" | "ACTIVE",
	beforeHash: string | null,
	afterHash: string,
): QuestionEvolutionAction {
	if (!existing) return "CREATE";
	if (existing.lifecycle === "ARCHIVED" && lifecycle === "ACTIVE") return "REOPEN";
	if (existing.lifecycle === "CANDIDATE" && lifecycle === "ACTIVE") return "PROMOTE";
	if (beforeHash === afterHash) return "NO_CHANGE";
	return "UPDATE";
}

function evolutionDecision(
	input: QuestionFormationGateInput,
	proposal: QuestionCandidateProposal,
	frame: QuestionFrame,
	action: QuestionEvolutionAction,
	beforeHash: string | null,
	afterHash: string,
	now: string,
): QuestionEvolutionDecision {
	const identity = JSON.stringify({
		knowledgeVersion: input.knowledgeVersion,
		sourceId: input.sourceId,
		proposalId: proposal.proposalId,
		questionRef: frame.id,
		action,
		beforeHash,
		afterHash,
	});
	return {
		id: `question-decision:${createHash("sha256").update(identity).digest("hex").slice(0, 24)}`,
		knowledgeVersion: input.knowledgeVersion,
		sourceId: input.sourceId,
		action,
		questionRefs: [frame.id],
		affectedClaimRefs: uniqueSorted(proposal.claimIds).map(claimRef),
		affectedRelationIds: uniqueSorted(proposal.relationIds),
		reasonCodes: [action],
		beforeHash,
		afterHash,
		formationVersion: QUESTION_FORMATION_VERSION,
		createdAt: now,
	};
}

function buildExistingSemanticKeys(frames: QuestionFrame[]): Map<string, QuestionRef> {
	const result = new Map<string, QuestionRef>();
	for (const frame of frames) {
		for (const text of [frame.canonicalQuestion, ...frame.aliases]) {
			result.set(questionSemanticKey(frame.domain, frame.scope, text), frame.id);
		}
	}
	return result;
}

function questionSemanticKey(domain: string, scope: Scope, question: string): string {
	return JSON.stringify({
		domain: domain.trim().toLocaleLowerCase(),
		scope: { type: scope.type, id: scope.id ?? null },
		question: normalizeQuestionText(question),
	});
}

function normalizeQuestionText(value: string): string {
	return value
		.normalize("NFKC")
		.toLocaleLowerCase()
		.replace(/[\p{P}\p{S}\s]+/gu, "");
}

function uniqueSignals(signals: QuestionFormationSignal[]): QuestionFormationSignal[] {
	return [
		...new Map(
			signals.map((signal) => [
				JSON.stringify({
					...signal,
					sourceIds: uniqueSorted(signal.sourceIds),
					claimRefs: [...new Set(signal.claimRefs)].sort(),
					relationIds: uniqueSorted(signal.relationIds),
					conceptRefs: [...new Set(signal.conceptRefs)].sort(),
				}),
				signal,
			]),
		).values(),
	];
}

function uniqueSorted(values: string[]): string[] {
	return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function slug(value: string): string {
	const result = value
		.normalize("NFKC")
		.toLocaleLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, "-")
		.replace(/^-+|-+$/g, "");
	return result || "general";
}

function assertIsoDate(value: string): void {
	if (!Number.isFinite(Date.parse(value))) throw new Error(`now 必须是 ISO 日期: ${value}`);
}
