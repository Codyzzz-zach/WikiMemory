import { createHash } from "node:crypto";
import type { ObjectLintResult } from "../linter/index.js";
import { resolveSpanById } from "../linter/storage.js";
import type { Claim, Relation, RelationType, SourceSpan } from "../types/index.js";

export const STRONG_RELATION_TYPES: ReadonlySet<RelationType> = new Set([
	"REQUIRES",
	"DERIVED_FROM",
	"SUPPORTS",
	"CONTRADICTS",
	"SUPERSEDES",
	"EQUIVALENT_UNDER",
]);

export interface RelationCorpusInspection {
	total: number;
	strong: number;
	consumable: number;
	brokenEndpoints: number;
	brokenEvidence: number;
	unverifiedConditions: number;
	auditVersionMismatch: number;
	equivalentUnderMissingConditions: number;
	strongExplicitNone: number;
	byType: Record<string, number>;
	bySource: Record<string, number>;
	byAuditVersion: Record<string, number>;
}

export interface RelationAuditLedger {
	input: number;
	canonical: number;
	quarantined: number;
	accounted: number;
	duplicateResultIds: string[];
	missingResultIds: string[];
	unexpectedResultIds: string[];
	canonicalContractViolations: Array<{ relationId: string; reasons: string[] }>;
	closed: boolean;
}

export interface RelationAuditInputNormalization {
	relation: Relation;
	removedConditionPlaceholders: string[];
}

export interface RelationAuditReviewItem {
	relationId: string;
	decision: "accept" | "reject";
}

export interface RelationAuditPredictionItem {
	relationId: string;
	type: RelationType;
	auditDecision: "accept" | "reject";
}

export interface BinaryAuditMetrics {
	total: number;
	tp: number;
	fp: number;
	tn: number;
	fn: number;
	precision: number | null;
	recall: number | null;
	accuracy: number | null;
}

export interface RelationAuditReviewScore {
	overall: BinaryAuditMetrics;
	strong: BinaryAuditMetrics;
	duplicatePredictionIds: string[];
	duplicateReviewIds: string[];
	missingReviewIds: string[];
	unexpectedReviewIds: string[];
	disagreements: Array<{
		relationId: string;
		type: RelationType;
		auditDecision: "accept" | "reject";
		reviewDecision: "accept" | "reject";
	}>;
	closed: boolean;
}

export interface RelationAuditSampleGate {
	decision: "FAIL_SAMPLE_GATE" | "PASS_DEV_PROXY_GATE" | "PASS_HUMAN_SAMPLE_GATE";
	metricsPassed: boolean;
	evidenceTier: "DEV_PROXY" | "HUMAN_GOLD";
	failures: string[];
}

const EMPTY_CONDITION_PLACEHOLDERS = new Set(["无", "none", "n/a", "na", "不适用"]);

/** Convert legacy sentinel text into the canonical empty-array representation before re-audit. */
export function normalizeRelationAuditInput(relation: Relation): RelationAuditInputNormalization {
	const removedConditionPlaceholders = relation.conditions.filter((condition) =>
		EMPTY_CONDITION_PLACEHOLDERS.has(condition.trim().toLocaleLowerCase()),
	);
	if (removedConditionPlaceholders.length === 0) {
		return { relation, removedConditionPlaceholders };
	}
	const conditions = relation.conditions.filter(
		(condition) => !EMPTY_CONDITION_PLACEHOLDERS.has(condition.trim().toLocaleLowerCase()),
	);
	return {
		relation: {
			...relation,
			conditions,
			conditionStatus: conditions.length > 0 ? relation.conditionStatus : "EXPLICIT_NONE",
		},
		removedConditionPlaceholders,
	};
}

/**
 * Inspect persisted Relation state without changing the consumption gate.
 * EXPLICIT_NONE is counted separately: an unconditional edge is not a missing-condition edge.
 */
export function inspectRelationCorpus(
	relations: Relation[],
	claims: Claim[],
	spans: SourceSpan[],
	currentAuditVersion: string,
): RelationCorpusInspection {
	const claimIds = new Set(claims.map((claim) => claim.id));
	const byType = countBy(relations, (relation) => relation.type);
	const bySource = countBy(relations, (relation) => relation.source);
	const byAuditVersion = countBy(relations, (relation) => relation.relationAuditVersion ?? "null");
	const isConsumable = (relation: Relation): boolean =>
		relation.publicationState === "CANONICAL" &&
		relation.lifecycle === "ACTIVE" &&
		relation.validity !== "UNRESOLVED" &&
		relation.conditionStatus !== "UNVERIFIED" &&
		relation.relationAuditVersion === currentAuditVersion &&
		claimIds.has(relation.from as string) &&
		claimIds.has(relation.to as string) &&
		relation.evidenceSpanIds.length > 0 &&
		relation.evidenceSpanIds.every((spanId) => resolveSpanById(spans, spanId) !== null);

	return {
		total: relations.length,
		strong: relations.filter((relation) => STRONG_RELATION_TYPES.has(relation.type)).length,
		consumable: relations.filter(isConsumable).length,
		brokenEndpoints: relations.filter(
			(relation) => !claimIds.has(relation.from as string) || !claimIds.has(relation.to as string),
		).length,
		brokenEvidence: relations.filter(
			(relation) =>
				relation.evidenceSpanIds.length === 0 ||
				relation.evidenceSpanIds.some((spanId) => resolveSpanById(spans, spanId) === null),
		).length,
		unverifiedConditions: relations.filter((relation) => relation.conditionStatus === "UNVERIFIED")
			.length,
		auditVersionMismatch: relations.filter(
			(relation) => relation.relationAuditVersion !== currentAuditVersion,
		).length,
		equivalentUnderMissingConditions: relations.filter(
			(relation) => relation.type === "EQUIVALENT_UNDER" && relation.conditions.length === 0,
		).length,
		strongExplicitNone: relations.filter(
			(relation) =>
				STRONG_RELATION_TYPES.has(relation.type) &&
				relation.conditionStatus === "EXPLICIT_NONE" &&
				relation.conditions.length === 0,
		).length,
		byType,
		bySource,
		byAuditVersion,
	};
}

/** Deterministic round-robin sampling across relation type and provenance source. */
export function selectStratifiedRelationSample(
	relations: Relation[],
	sampleSize: number,
	seed: string,
): Relation[] {
	if (!Number.isInteger(sampleSize) || sampleSize < 1) {
		throw new Error(`sampleSize must be a positive integer, received ${sampleSize}`);
	}
	if (sampleSize >= relations.length) return [...relations].sort(compareIds);

	const strata = new Map<string, Relation[]>();
	for (const relation of relations) {
		const key = `${relation.type}|${relation.source}`;
		const bucket = strata.get(key) ?? [];
		bucket.push(relation);
		strata.set(key, bucket);
	}
	for (const bucket of strata.values()) {
		bucket.sort((left, right) =>
			hash(`${seed}:${left.id}`).localeCompare(hash(`${seed}:${right.id}`)),
		);
	}

	const orderedStrata = [...strata.entries()].sort(([left], [right]) => left.localeCompare(right));
	const selected: Relation[] = [];
	let round = 0;
	while (selected.length < sampleSize) {
		let added = false;
		for (const [, bucket] of orderedStrata) {
			const relation = bucket[round];
			if (!relation) continue;
			selected.push(relation);
			added = true;
			if (selected.length === sampleSize) break;
		}
		if (!added) break;
		round += 1;
	}
	return selected;
}

/**
 * Candidate-only audit ledger. A caller must pass this contract before any publication migration.
 */
export function verifyRelationAuditLedger(
	inputRelations: Relation[],
	results: Array<ObjectLintResult<Relation>>,
	claims: Claim[],
	spans: SourceSpan[],
	currentAuditVersion: string,
): RelationAuditLedger {
	const inputIds = new Set(inputRelations.map((relation) => relation.id));
	const resultCounts = new Map<string, number>();
	for (const result of results) {
		resultCounts.set(result.object.id, (resultCounts.get(result.object.id) ?? 0) + 1);
	}
	const resultIds = new Set(resultCounts.keys());
	const duplicateResultIds = [...resultCounts]
		.filter(([, count]) => count > 1)
		.map(([id]) => id)
		.sort();
	const missingResultIds = [...inputIds].filter((id) => !resultIds.has(id)).sort();
	const unexpectedResultIds = [...resultIds].filter((id) => !inputIds.has(id)).sort();
	const claimIds = new Set(claims.map((claim) => claim.id));
	const canonical = results.filter((result) => result.finalState === "CANONICAL");
	const quarantined = results.filter((result) => result.finalState === "QUARANTINED");
	const canonicalContractViolations = canonical.flatMap((result) => {
		const relation = result.object;
		const reasons: string[] = [];
		if (relation.publicationState !== "CANONICAL") reasons.push("not-canonical");
		if (relation.lifecycle !== "ACTIVE") reasons.push("not-active");
		if (relation.validity === "UNRESOLVED") reasons.push("unresolved");
		if (relation.conditionStatus === "UNVERIFIED") reasons.push("condition-unverified");
		if (relation.relationAuditVersion !== currentAuditVersion) {
			reasons.push("audit-version-mismatch");
		}
		if (!claimIds.has(relation.from as string) || !claimIds.has(relation.to as string)) {
			reasons.push("broken-endpoint");
		}
		if (
			relation.evidenceSpanIds.length === 0 ||
			relation.evidenceSpanIds.some((spanId) => resolveSpanById(spans, spanId) === null)
		) {
			reasons.push("broken-evidence");
		}
		if (relation.type === "EQUIVALENT_UNDER" && relation.conditions.length === 0) {
			reasons.push("equivalent-under-missing-conditions");
		}
		return reasons.length > 0 ? [{ relationId: relation.id, reasons }] : [];
	});
	const accounted = canonical.length + quarantined.length;
	return {
		input: inputRelations.length,
		canonical: canonical.length,
		quarantined: quarantined.length,
		accounted,
		duplicateResultIds,
		missingResultIds,
		unexpectedResultIds,
		canonicalContractViolations,
		closed:
			accounted === inputRelations.length &&
			duplicateResultIds.length === 0 &&
			missingResultIds.length === 0 &&
			unexpectedResultIds.length === 0 &&
			canonicalContractViolations.length === 0,
	};
}

/**
 * Score a frozen audit run against an independently frozen review file.
 * Strong-edge metrics are separate so RELATED_TO cannot hide unsafe strong edges.
 */
export function scoreRelationAuditReview(
	predictions: RelationAuditPredictionItem[],
	reviews: RelationAuditReviewItem[],
): RelationAuditReviewScore {
	const predictionCounts = countIds(predictions);
	const reviewCounts = countIds(reviews);
	const duplicatePredictionIds = duplicateIds(predictionCounts);
	const duplicateReviewIds = duplicateIds(reviewCounts);
	const predictionIds = new Set(predictionCounts.keys());
	const reviewIds = new Set(reviewCounts.keys());
	const missingReviewIds = [...predictionIds].filter((id) => !reviewIds.has(id)).sort();
	const unexpectedReviewIds = [...reviewIds].filter((id) => !predictionIds.has(id)).sort();
	const reviewById = new Map(reviews.map((review) => [review.relationId, review]));
	const comparable = predictions.flatMap((prediction) => {
		const review = reviewById.get(prediction.relationId);
		return review ? [{ prediction, review }] : [];
	});
	const disagreements = comparable.flatMap(({ prediction, review }) =>
		prediction.auditDecision === review.decision
			? []
			: [
					{
						relationId: prediction.relationId,
						type: prediction.type,
						auditDecision: prediction.auditDecision,
						reviewDecision: review.decision,
					},
				],
	);
	return {
		overall: binaryMetrics(comparable),
		strong: binaryMetrics(
			comparable.filter(({ prediction }) => STRONG_RELATION_TYPES.has(prediction.type)),
		),
		duplicatePredictionIds,
		duplicateReviewIds,
		missingReviewIds,
		unexpectedReviewIds,
		disagreements,
		closed:
			duplicatePredictionIds.length === 0 &&
			duplicateReviewIds.length === 0 &&
			missingReviewIds.length === 0 &&
			unexpectedReviewIds.length === 0,
	};
}

export function decideRelationAuditSampleGate(input: {
	score: RelationAuditReviewScore;
	strongPrecisionThreshold: number;
	strongRecallThreshold: number;
	reviewerType: string;
	goldStatus: string;
}): RelationAuditSampleGate {
	const failures: string[] = [];
	if (!input.score.closed) failures.push("review-ledger-not-closed");
	if (
		input.score.strong.precision === null ||
		input.score.strong.precision < input.strongPrecisionThreshold
	) {
		failures.push("strong-precision-below-threshold");
	}
	if (
		input.score.strong.recall === null ||
		input.score.strong.recall < input.strongRecallThreshold
	) {
		failures.push("strong-recall-below-threshold");
	}
	const evidenceTier =
		input.reviewerType === "HUMAN" && input.goldStatus === "GOLD" ? "HUMAN_GOLD" : "DEV_PROXY";
	return {
		decision:
			failures.length > 0
				? "FAIL_SAMPLE_GATE"
				: evidenceTier === "HUMAN_GOLD"
					? "PASS_HUMAN_SAMPLE_GATE"
					: "PASS_DEV_PROXY_GATE",
		metricsPassed: failures.length === 0,
		evidenceTier,
		failures,
	};
}

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
	const counts = new Map<string, number>();
	for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
	return Object.fromEntries([...counts].sort(([left], [right]) => left.localeCompare(right)));
}

function countIds<T extends { relationId: string }>(items: T[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const item of items) counts.set(item.relationId, (counts.get(item.relationId) ?? 0) + 1);
	return counts;
}

function duplicateIds(counts: Map<string, number>): string[] {
	return [...counts]
		.filter(([, count]) => count > 1)
		.map(([id]) => id)
		.sort();
}

function binaryMetrics(
	items: Array<{
		prediction: RelationAuditPredictionItem;
		review: RelationAuditReviewItem;
	}>,
): BinaryAuditMetrics {
	let tp = 0;
	let fp = 0;
	let tn = 0;
	let fn = 0;
	for (const { prediction, review } of items) {
		if (prediction.auditDecision === "accept" && review.decision === "accept") tp += 1;
		else if (prediction.auditDecision === "accept" && review.decision === "reject") fp += 1;
		else if (prediction.auditDecision === "reject" && review.decision === "reject") tn += 1;
		else fn += 1;
	}
	const total = items.length;
	return {
		total,
		tp,
		fp,
		tn,
		fn,
		precision: ratio(tp, tp + fp),
		recall: ratio(tp, tp + fn),
		accuracy: ratio(tp + tn, total),
	};
}

function ratio(numerator: number, denominator: number): number | null {
	return denominator === 0 ? null : numerator / denominator;
}

function hash(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function compareIds(left: Relation, right: Relation): number {
	return left.id.localeCompare(right.id);
}
