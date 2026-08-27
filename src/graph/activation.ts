import type { RelationType } from "../types/index.js";

const ANSWER_SAFETY_TYPES = new Set<RelationType>([
	"REQUIRES",
	"CONTRADICTS",
	"SUPERSEDES",
	"EQUIVALENT_UNDER",
]);

const EXPLANATORY_TYPES = new Set<RelationType>(["SUPPORTS", "DERIVED_FROM"]);

const RELATIONAL_QUERY_PATTERNS = [
	/关系|关联|比较|区别|差异|为什么|为何|原因|依赖|前提|条件|冲突|矛盾|变化|更新|取代|替代|推导|支持/u,
	/\b(?:relation|relationship|compare|comparison|difference|why|cause|because|depend|require|prerequisite|condition|conflict|contradict|change|update|supersede|derive|support)\w*\b/iu,
];

export type GraphActivationMode = "DISABLED" | "CANDIDATE_ONLY" | "VISIBLE";

export interface GraphVisibilityCandidate {
	relationId: string;
	type: RelationType;
	depth: number;
	touchesSeed: boolean;
	bothEndpointsSeed: boolean;
	conditions: string[];
	estimatedMarginalTokens: number;
}

export interface GraphVisibilityDecision {
	relationId: string;
	type: RelationType;
	visible: boolean;
	triggerReasons: string[];
	dropReason: string | null;
	estimatedMarginalTokens: number;
	benefitScore: number;
	utilityPer100Tokens: number;
}

export interface GraphActivationDecision {
	mode: GraphActivationMode;
	requestedDepth: number;
	relationalQueryIntent: boolean;
	marginalBudgetTokens: number;
	selectedMarginalTokens: number;
	visibleRelationIds: string[];
	decisions: GraphVisibilityDecision[];
	reason: string;
}

export interface GraphActivationInput {
	task: string;
	requestedDepth: number;
	contextBudgetTokens: number;
	seedClaimCount: number;
	candidates: GraphVisibilityCandidate[];
	/** Graph is allowed to consume only this fraction of the same fixed Context budget. */
	maxMarginalBudgetRatio?: number;
	minimumUtilityPer100Tokens?: number;
}

/**
 * Decide which already-audited Graph candidates may become Agent-visible.
 * Candidate navigation and Prompt visibility are deliberately different decisions.
 */
export function decideGraphActivation(input: GraphActivationInput): GraphActivationDecision {
	if (!Number.isSafeInteger(input.requestedDepth) || input.requestedDepth < 0) {
		throw new Error(`requestedDepth must be a non-negative integer: ${input.requestedDepth}`);
	}
	if (!Number.isSafeInteger(input.contextBudgetTokens) || input.contextBudgetTokens <= 0) {
		throw new Error(`contextBudgetTokens must be a positive integer: ${input.contextBudgetTokens}`);
	}
	const ratio = input.maxMarginalBudgetRatio ?? 0.25;
	if (!(ratio >= 0 && ratio <= 1)) throw new Error(`maxMarginalBudgetRatio out of range: ${ratio}`);
	// Utility is an observable/ranking signal until answer experiments calibrate a real threshold.
	// A guessed default threshold would make the experiment self-fulfilling by hiding every costly edge.
	const minimumUtility = input.minimumUtilityPer100Tokens ?? 0;
	const marginalBudgetTokens = Math.floor(input.contextBudgetTokens * ratio);
	const relationalQueryIntent = RELATIONAL_QUERY_PATTERNS.some((pattern) =>
		pattern.test(input.task),
	);

	if (input.requestedDepth === 0) {
		return emptyDecision(
			"DISABLED",
			"graph-depth-zero",
			input.requestedDepth,
			relationalQueryIntent,
			marginalBudgetTokens,
		);
	}
	if (input.seedClaimCount === 0) {
		return emptyDecision(
			"CANDIDATE_ONLY",
			"no-reliable-seed",
			input.requestedDepth,
			relationalQueryIntent,
			marginalBudgetTokens,
		);
	}
	if (input.candidates.length === 0) {
		return emptyDecision(
			"CANDIDATE_ONLY",
			"no-consumable-graph-candidate",
			input.requestedDepth,
			relationalQueryIntent,
			marginalBudgetTokens,
		);
	}

	const ranked = input.candidates
		.map((candidate) => scoreCandidate(candidate, relationalQueryIntent, minimumUtility))
		.sort(
			(left, right) =>
				right.benefitScore - left.benefitScore ||
				right.utilityPer100Tokens - left.utilityPer100Tokens ||
				left.estimatedMarginalTokens - right.estimatedMarginalTokens ||
				left.relationId.localeCompare(right.relationId),
		);
	let selectedMarginalTokens = 0;
	const decisions = ranked.map((decision): GraphVisibilityDecision => {
		if (decision.dropReason) return decision;
		if (selectedMarginalTokens + decision.estimatedMarginalTokens > marginalBudgetTokens) {
			return { ...decision, visible: false, dropReason: "marginal-token-budget" };
		}
		selectedMarginalTokens += decision.estimatedMarginalTokens;
		return { ...decision, visible: true };
	});
	const visibleRelationIds = decisions
		.filter((decision) => decision.visible)
		.map((decision) => decision.relationId);
	return {
		mode: visibleRelationIds.length > 0 ? "VISIBLE" : "CANDIDATE_ONLY",
		requestedDepth: input.requestedDepth,
		relationalQueryIntent,
		marginalBudgetTokens,
		selectedMarginalTokens,
		visibleRelationIds,
		decisions,
		reason: visibleRelationIds.length > 0 ? "qualified-graph-units" : "no-qualified-visible-unit",
	};
}

function scoreCandidate(
	candidate: GraphVisibilityCandidate,
	relationalQueryIntent: boolean,
	minimumUtility: number,
): GraphVisibilityDecision {
	if (
		!Number.isSafeInteger(candidate.estimatedMarginalTokens) ||
		candidate.estimatedMarginalTokens < 0
	) {
		throw new Error(
			`estimatedMarginalTokens must be a non-negative integer: ${candidate.relationId}`,
		);
	}
	const triggerReasons: string[] = [];
	let benefitScore = 0;
	if (candidate.touchesSeed && ANSWER_SAFETY_TYPES.has(candidate.type)) {
		triggerReasons.push("answer-safety-relation-adjacent-to-seed");
		benefitScore += 5;
	}
	if (
		relationalQueryIntent &&
		candidate.depth <= 2 &&
		(ANSWER_SAFETY_TYPES.has(candidate.type) ||
			(EXPLANATORY_TYPES.has(candidate.type) && candidate.bothEndpointsSeed))
	) {
		triggerReasons.push(
			EXPLANATORY_TYPES.has(candidate.type)
				? "explicit-relational-query-between-seeds"
				: "explicit-relational-query-intent",
		);
		benefitScore += 3;
	}
	if (candidate.conditions.length > 0 && candidate.touchesSeed && triggerReasons.length > 0) {
		triggerReasons.push("condition-bearing-relation-adjacent-to-seed");
		benefitScore += 2;
	}
	const utilityPer100Tokens =
		candidate.estimatedMarginalTokens === 0
			? benefitScore
			: (benefitScore * 100) / candidate.estimatedMarginalTokens;
	let dropReason: string | null = null;
	if (candidate.type === "RELATED_TO") dropReason = "weak-navigation-only";
	else if (triggerReasons.length === 0) dropReason = "no-task-necessary-trigger";
	else if (utilityPer100Tokens < minimumUtility) dropReason = "below-marginal-utility-threshold";
	return {
		relationId: candidate.relationId,
		type: candidate.type,
		visible: false,
		triggerReasons,
		dropReason,
		estimatedMarginalTokens: candidate.estimatedMarginalTokens,
		benefitScore,
		utilityPer100Tokens,
	};
}

function emptyDecision(
	mode: GraphActivationMode,
	reason: string,
	requestedDepth: number,
	relationalQueryIntent: boolean,
	marginalBudgetTokens: number,
): GraphActivationDecision {
	return {
		mode,
		requestedDepth,
		relationalQueryIntent,
		marginalBudgetTokens,
		selectedMarginalTokens: 0,
		visibleRelationIds: [],
		decisions: [],
		reason,
	};
}
