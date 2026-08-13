import { describe, expect, it } from "vitest";
import { decideGraphActivation } from "./activation.js";

describe("Graph conditional activation", () => {
	it("does not expand Prompt for a direct fact with only weak navigation", () => {
		const decision = decideGraphActivation({
			task: "Alpha 的定义是什么？",
			requestedDepth: 2,
			contextBudgetTokens: 1000,
			seedClaimCount: 1,
			candidates: [candidate("related", "RELATED_TO", 40)],
		});
		expect(decision.mode).toBe("CANDIDATE_ONLY");
		expect(decision.selectedMarginalTokens).toBe(0);
		expect(decision.decisions[0]).toMatchObject({
			visible: false,
			dropReason: "weak-navigation-only",
		});
	});

	it("makes a condition-bearing safety edge visible when adjacent to a Seed", () => {
		const decision = decideGraphActivation({
			task: "Alpha 是否成立？",
			requestedDepth: 2,
			contextBudgetTokens: 1000,
			seedClaimCount: 1,
			candidates: [candidate("requires", "REQUIRES", 80, ["仅在 Beta 成立时"])],
		});
		expect(decision.mode).toBe("VISIBLE");
		expect(decision.visibleRelationIds).toEqual(["requires"]);
		expect(decision.decisions[0]?.triggerReasons).toEqual(
			expect.arrayContaining([
				"answer-safety-relation-adjacent-to-seed",
				"condition-bearing-relation-adjacent-to-seed",
			]),
		);
	});

	it("allows audited explanatory structure only for explicit relational intent", () => {
		const direct = decideGraphActivation({
			task: "Alpha 是什么？",
			requestedDepth: 2,
			contextBudgetTokens: 1000,
			seedClaimCount: 1,
			candidates: [candidate("support", "SUPPORTS", 100)],
		});
		const relational = decideGraphActivation({
			task: "为什么 Beta 支持 Alpha？",
			requestedDepth: 2,
			contextBudgetTokens: 1000,
			seedClaimCount: 1,
			candidates: [candidate("support", "SUPPORTS", 100)],
		});
		expect(direct.mode).toBe("CANDIDATE_ONLY");
		expect(relational.mode).toBe("VISIBLE");
	});

	it("keeps one-anchor explanatory expansion candidate-only even for relational questions", () => {
		const decision = decideGraphActivation({
			task: "为什么 Beta 支持 Alpha？",
			requestedDepth: 2,
			contextBudgetTokens: 1000,
			seedClaimCount: 1,
			candidates: [candidate("support", "SUPPORTS", 100, [], false)],
		});
		expect(decision.mode).toBe("CANDIDATE_ONLY");
		expect(decision.decisions[0]).toMatchObject({
			visible: false,
			dropReason: "no-task-necessary-trigger",
		});
	});

	it("does not treat conditions on an explanatory edge as a standalone trigger", () => {
		const decision = decideGraphActivation({
			task: "Alpha 是什么？",
			requestedDepth: 2,
			contextBudgetTokens: 1000,
			seedClaimCount: 1,
			candidates: [candidate("support", "SUPPORTS", 100, ["在 Beta 范围内"])],
		});
		expect(decision.mode).toBe("CANDIDATE_ONLY");
		expect(decision.decisions[0]).toMatchObject({
			visible: false,
			dropReason: "no-task-necessary-trigger",
		});
	});

	it("rejects useful candidates when their closed unit exceeds marginal budget", () => {
		const decision = decideGraphActivation({
			task: "Alpha 为什么变化？",
			requestedDepth: 2,
			contextBudgetTokens: 400,
			seedClaimCount: 1,
			candidates: [candidate("supersedes", "SUPERSEDES", 101)],
		});
		expect(decision.marginalBudgetTokens).toBe(100);
		expect(decision.mode).toBe("CANDIDATE_ONLY");
		expect(decision.decisions[0]?.dropReason).toBe("marginal-token-budget");
	});

	it("records heuristic utility without using an uncalibrated default cutoff", () => {
		const observable = decideGraphActivation({
			task: "为什么 Beta 支持 Alpha？",
			requestedDepth: 2,
			contextBudgetTokens: 2000,
			seedClaimCount: 1,
			candidates: [candidate("support", "SUPPORTS", 400)],
		});
		const explicitlyCalibrated = decideGraphActivation({
			task: "为什么 Beta 支持 Alpha？",
			requestedDepth: 2,
			contextBudgetTokens: 2000,
			seedClaimCount: 1,
			minimumUtilityPer100Tokens: 1,
			candidates: [candidate("support", "SUPPORTS", 400)],
		});
		expect(observable).toMatchObject({ mode: "VISIBLE", visibleRelationIds: ["support"] });
		expect(observable.decisions[0]?.utilityPer100Tokens).toBe(0.75);
		expect(explicitlyCalibrated.decisions[0]).toMatchObject({
			visible: false,
			dropReason: "below-marginal-utility-threshold",
		});
	});

	it("never activates without a reliable Seed or when Graph depth is zero", () => {
		const noSeed = decideGraphActivation({
			task: "Alpha 与 Beta 的关系？",
			requestedDepth: 2,
			contextBudgetTokens: 1000,
			seedClaimCount: 0,
			candidates: [candidate("requires", "REQUIRES", 50)],
		});
		const disabled = decideGraphActivation({
			task: "Alpha 与 Beta 的关系？",
			requestedDepth: 0,
			contextBudgetTokens: 1000,
			seedClaimCount: 1,
			candidates: [candidate("requires", "REQUIRES", 50)],
		});
		expect(noSeed).toMatchObject({ mode: "CANDIDATE_ONLY", reason: "no-reliable-seed" });
		expect(disabled).toMatchObject({ mode: "DISABLED", reason: "graph-depth-zero" });
	});
});

function candidate(
	relationId: string,
	type: Parameters<typeof decideGraphActivation>[0]["candidates"][number]["type"],
	estimatedMarginalTokens: number,
	conditions: string[] = [],
	bothEndpointsSeed = true,
) {
	return {
		relationId,
		type,
		depth: 1,
		touchesSeed: true,
		bothEndpointsSeed,
		conditions,
		estimatedMarginalTokens,
	};
}
