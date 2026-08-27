import { describe, expect, it } from "vitest";
import type { RelationType } from "../types/index.js";
import { type R1CandidateEdge, type R1SelectorConfig, selectClaimsWithR1 } from "./ranking.js";

const config: R1SelectorConfig = {
	protectedLexicalSeeds: 1,
	maxCandidateNodes: 12,
	maxDepth: 2,
	restartAlpha: 0.25,
	iterations: 25,
	selectedClaimLimit: 3,
	edgeWeights: {
		REQUIRES: 1,
		CONTRADICTS: 1,
		SUPERSEDES: 1,
		EQUIVALENT_UNDER: 1,
		DERIVED_FROM: 0.8,
		SUPPORTS: 0.8,
		RELATED_TO: 0.25,
	},
};

describe("R1 structural selector", () => {
	it("uses a multi-anchor graph candidate to replace a weak lexical Seed", () => {
		const result = selectClaimsWithR1(
			nodes(["a", 10, 1], ["b", 8, 2], ["c", 0.1, 3], ["x", 0, null]),
			[edge("a-x", "a", "x"), edge("b-x", "b", "x")],
			["a", "b", "c"],
			config,
		);
		expect(result.selectedClaimIds).toEqual(expect.arrayContaining(["a", "b", "x"]));
		expect(result.removedLexicalSeedIds).toEqual(["c"]);
		expect(result.addedGraphClaimIds).toEqual(["x"]);
		expect(result.decisions).toContainEqual(
			expect.objectContaining({
				id: "x",
				selected: true,
				anchorCount: 2,
				reason: "selected-multi-anchor-graph-candidate",
			}),
		);
	});

	it("does not promote a one-anchor explanatory neighbor", () => {
		const result = selectClaimsWithR1(
			nodes(["a", 10, 1], ["b", 8, 2], ["c", 1, 3], ["x", 0, null]),
			[edge("a-x", "a", "x")],
			["a", "b", "c"],
			config,
		);
		expect(result.selectedClaimIds).toEqual(["a", "b", "c"]);
		expect(result.decisions).toContainEqual(
			expect.objectContaining({
				id: "x",
				selected: false,
				reason: "ineligible-single-anchor-graph-candidate",
			}),
		);
	});

	it("allows an adjacent safety Claim to replace a weak Seed", () => {
		const result = selectClaimsWithR1(
			nodes(["a", 10, 1], ["b", 8, 2], ["c", 0.1, 3], ["guard", 0, null]),
			[edge("guard-a", "guard", "a", "REQUIRES")],
			["a", "b", "c"],
			config,
		);
		expect(result.selectedClaimIds).toContain("guard");
		expect(result.decisions).toContainEqual(
			expect.objectContaining({
				id: "guard",
				selected: true,
				safetyAdjacentToSeed: true,
				reason: "selected-safety-neighbor",
			}),
		);
	});

	it("keeps the candidate graph bounded by node count and depth", () => {
		const chain = Array.from({ length: 20 }, (_, index) => `n${index}`);
		const result = selectClaimsWithR1(
			chain.map((id, index) => ({
				id,
				lexicalScore: index === 0 ? 10 : 0,
				lexicalRank: index === 0 ? 1 : null,
			})),
			chain.slice(1).map((id, index) => edge(`e${index}`, chain[index] as string, id)),
			["n0"],
			{ ...config, maxCandidateNodes: 5, maxDepth: 2, selectedClaimLimit: 1 },
		);
		expect(result.diagnostics).toMatchObject({
			bounded: true,
			candidateNodeCount: 3,
			maximumObservedDepth: 2,
		});
		expect(result.candidateNodeIds).toEqual(["n0", "n1", "n2"]);
	});

	it("is identical to lexical selection when no trusted structure exists", () => {
		const result = selectClaimsWithR1(
			nodes(["a", 10, 1], ["b", 8, 2], ["c", 1, 3]),
			[],
			["a", "b", "c"],
			config,
		);
		expect(result.selectedClaimIds).toEqual(["a", "b", "c"]);
		expect(result.removedLexicalSeedIds).toEqual([]);
		expect(result.addedGraphClaimIds).toEqual([]);
		expect(result.diagnostics.restartMass).toBeCloseTo(1, 10);
	});

	it("returns deterministic decisions independent of edge input order", () => {
		const candidateNodes = nodes(["a", 10, 1], ["b", 8, 2], ["c", 0.1, 3], ["x", 0, null]);
		const candidateEdges = [edge("a-x", "a", "x"), edge("b-x", "b", "x")];
		const first = selectClaimsWithR1(candidateNodes, candidateEdges, ["a", "b", "c"], config);
		const second = selectClaimsWithR1(
			candidateNodes,
			[...candidateEdges].reverse(),
			["a", "b", "c"],
			config,
		);
		expect(second).toEqual(first);
	});
});

function nodes(...rows: Array<[string, number, number | null]>) {
	return rows.map(([id, lexicalScore, lexicalRank]) => ({ id, lexicalScore, lexicalRank }));
}

function edge(
	id: string,
	from: string,
	to: string,
	type: RelationType = "SUPPORTS",
): R1CandidateEdge {
	return { id, from, to, type };
}
