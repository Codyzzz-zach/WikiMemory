import type { RelationType } from "../types/index.js";

const SAFETY_TYPES = new Set<RelationType>([
	"REQUIRES",
	"CONTRADICTS",
	"SUPERSEDES",
	"EQUIVALENT_UNDER",
]);

export interface R1CandidateNode {
	id: string;
	lexicalScore: number;
	lexicalRank: number | null;
}

export interface R1CandidateEdge {
	id: string;
	from: string;
	to: string;
	type: RelationType;
}

export interface R1SelectorConfig {
	protectedLexicalSeeds: number;
	maxCandidateNodes: number;
	maxDepth: number;
	restartAlpha: number;
	iterations: number;
	selectedClaimLimit: number;
	edgeWeights: Record<RelationType, number>;
}

export interface R1NodeDecision {
	id: string;
	selected: boolean;
	lexicalRank: number | null;
	lexicalScore: number;
	graphScore: number;
	depth: number;
	anchorCount: number;
	safetyAdjacentToSeed: boolean;
	reason:
		| "protected-lexical-seed"
		| "retained-by-r1-rank"
		| "selected-multi-anchor-graph-candidate"
		| "selected-safety-neighbor"
		| "dropped-by-r1-rank"
		| "ineligible-single-anchor-graph-candidate";
}

export interface R1SelectionResult {
	selectedClaimIds: string[];
	selectedRelationIds: string[];
	removedLexicalSeedIds: string[];
	addedGraphClaimIds: string[];
	candidateNodeIds: string[];
	candidateRelationIds: string[];
	decisions: R1NodeDecision[];
	diagnostics: {
		bounded: boolean;
		candidateNodeCount: number;
		candidateRelationCount: number;
		maximumObservedDepth: number;
		restartMass: number;
	};
}

interface AdjacentEdge extends R1CandidateEdge {
	neighborId: string;
	weight: number;
}

/**
 * Deterministic R1 selector inspired by CodeGraph's bounded personalized PageRank.
 * Text retrieval defines restart Seeds; Graph may reorder/replace remaining slots but
 * never increases the visible Claim count.
 */
export function selectClaimsWithR1(
	nodes: R1CandidateNode[],
	edges: R1CandidateEdge[],
	lexicalSeedIds: string[],
	config: R1SelectorConfig,
): R1SelectionResult {
	validateConfig(config);
	const nodeById = new Map(nodes.map((node) => [node.id, node]));
	if (nodeById.size !== nodes.length) throw new Error("R1 nodes must have unique ids");
	const orderedSeeds = [...new Set(lexicalSeedIds)];
	if (orderedSeeds.some((id) => !nodeById.has(id)))
		throw new Error("R1 Seed is missing from nodes");
	if (orderedSeeds.length > config.maxCandidateNodes) {
		throw new Error("maxCandidateNodes cannot be smaller than the lexical Seed set");
	}
	const adjacency = buildAdjacency(nodeById, edges, config.edgeWeights);
	const { candidateIds, depthById } = boundedCandidates(
		orderedSeeds,
		adjacency,
		config.maxDepth,
		config.maxCandidateNodes,
	);
	const candidateSet = new Set(candidateIds);
	const candidateEdges = edges
		.filter(
			(edge) =>
				candidateSet.has(edge.from) &&
				candidateSet.has(edge.to) &&
				nodeById.has(edge.from) &&
				nodeById.has(edge.to),
		)
		.sort((left, right) => left.id.localeCompare(right.id));
	const anchorSets = anchorReachability(orderedSeeds, candidateIds, adjacency, config.maxDepth);
	const seedSet = new Set(orderedSeeds);
	const safetyAdjacent = new Set<string>();
	for (const edge of candidateEdges) {
		if (!SAFETY_TYPES.has(edge.type)) continue;
		if (seedSet.has(edge.from) && !seedSet.has(edge.to)) safetyAdjacent.add(edge.to);
		if (seedSet.has(edge.to) && !seedSet.has(edge.from)) safetyAdjacent.add(edge.from);
	}
	const graphScores = randomWalkWithRestart(
		candidateIds,
		adjacency,
		orderedSeeds,
		nodeById,
		config.restartAlpha,
		config.iterations,
	);
	const protectedIds = new Set(
		orderedSeeds.slice(0, Math.min(config.protectedLexicalSeeds, config.selectedClaimLimit)),
	);
	const eligibleIds = candidateIds.filter(
		(id) => seedSet.has(id) || (anchorSets.get(id)?.size ?? 0) >= 2 || safetyAdjacent.has(id),
	);
	const ranked = eligibleIds.sort((left, right) => {
		const scoreDelta = (graphScores.get(right) ?? 0) - (graphScores.get(left) ?? 0);
		if (Math.abs(scoreDelta) > 1e-15) return scoreDelta;
		const leftRank = nodeById.get(left)?.lexicalRank ?? Number.POSITIVE_INFINITY;
		const rightRank = nodeById.get(right)?.lexicalRank ?? Number.POSITIVE_INFINITY;
		return leftRank - rightRank || left.localeCompare(right);
	});
	const selected: string[] = [...protectedIds];
	for (const id of ranked) {
		if (selected.length >= Math.min(config.selectedClaimLimit, candidateIds.length)) break;
		if (!selected.includes(id)) selected.push(id);
	}
	const selectedSet = new Set(selected);
	const decisions = candidateIds
		.map((id): R1NodeDecision => {
			const node = nodeById.get(id);
			if (!node) throw new Error(`R1 candidate node disappeared: ${id}`);
			const anchorCount = anchorSets.get(id)?.size ?? 0;
			const isSelected = selectedSet.has(id);
			let reason: R1NodeDecision["reason"];
			if (protectedIds.has(id)) reason = "protected-lexical-seed";
			else if (!seedSet.has(id) && anchorCount < 2 && !safetyAdjacent.has(id)) {
				reason = "ineligible-single-anchor-graph-candidate";
			} else if (!isSelected) reason = "dropped-by-r1-rank";
			else if (seedSet.has(id)) reason = "retained-by-r1-rank";
			else if (safetyAdjacent.has(id)) reason = "selected-safety-neighbor";
			else reason = "selected-multi-anchor-graph-candidate";
			return {
				id,
				selected: isSelected,
				lexicalRank: node.lexicalRank,
				lexicalScore: node.lexicalScore,
				graphScore: graphScores.get(id) ?? 0,
				depth: depthById.get(id) ?? 0,
				anchorCount,
				safetyAdjacentToSeed: safetyAdjacent.has(id),
				reason,
			};
		})
		.sort(
			(left, right) =>
				Number(right.selected) - Number(left.selected) ||
				right.graphScore - left.graphScore ||
				left.id.localeCompare(right.id),
		);
	const selectedRelationIds = candidateEdges
		.filter((edge) => selectedSet.has(edge.from) && selectedSet.has(edge.to))
		.map((edge) => edge.id);
	return {
		selectedClaimIds: selected,
		selectedRelationIds,
		removedLexicalSeedIds: orderedSeeds.filter((id) => !selectedSet.has(id)),
		addedGraphClaimIds: selected.filter((id) => !seedSet.has(id)),
		candidateNodeIds: candidateIds,
		candidateRelationIds: candidateEdges.map((edge) => edge.id),
		decisions,
		diagnostics: {
			bounded: candidateIds.length <= config.maxCandidateNodes,
			candidateNodeCount: candidateIds.length,
			candidateRelationCount: candidateEdges.length,
			maximumObservedDepth: Math.max(0, ...depthById.values()),
			restartMass: sum([...graphScores.values()]),
		},
	};
}

function buildAdjacency(
	nodeById: Map<string, R1CandidateNode>,
	edges: R1CandidateEdge[],
	weights: Record<RelationType, number>,
): Map<string, AdjacentEdge[]> {
	const adjacency = new Map<string, AdjacentEdge[]>();
	for (const id of nodeById.keys()) adjacency.set(id, []);
	for (const edge of [...edges].sort((left, right) => left.id.localeCompare(right.id))) {
		if (!nodeById.has(edge.from) || !nodeById.has(edge.to) || edge.from === edge.to) continue;
		const weight = weights[edge.type];
		if (!(weight > 0)) continue;
		adjacency.get(edge.from)?.push({ ...edge, neighborId: edge.to, weight });
		adjacency.get(edge.to)?.push({ ...edge, neighborId: edge.from, weight });
	}
	for (const rows of adjacency.values()) {
		rows.sort(
			(left, right) =>
				left.neighborId.localeCompare(right.neighborId) || left.id.localeCompare(right.id),
		);
	}
	return adjacency;
}

function boundedCandidates(
	seedIds: string[],
	adjacency: Map<string, AdjacentEdge[]>,
	maxDepth: number,
	maxNodes: number,
): { candidateIds: string[]; depthById: Map<string, number> } {
	const candidateIds = [...seedIds];
	const depthById = new Map(seedIds.map((id) => [id, 0]));
	const queue = [...seedIds];
	for (let index = 0; index < queue.length && candidateIds.length < maxNodes; index++) {
		const current = queue[index];
		if (!current) continue;
		const currentDepth = depthById.get(current) ?? 0;
		if (currentDepth >= maxDepth) continue;
		for (const edge of adjacency.get(current) ?? []) {
			if (depthById.has(edge.neighborId)) continue;
			depthById.set(edge.neighborId, currentDepth + 1);
			candidateIds.push(edge.neighborId);
			queue.push(edge.neighborId);
			if (candidateIds.length >= maxNodes) break;
		}
	}
	return { candidateIds, depthById };
}

function anchorReachability(
	seedIds: string[],
	candidateIds: string[],
	adjacency: Map<string, AdjacentEdge[]>,
	maxDepth: number,
): Map<string, Set<string>> {
	const candidateSet = new Set(candidateIds);
	const result = new Map(candidateIds.map((id) => [id, new Set<string>()]));
	for (const seedId of seedIds) {
		const visited = new Set([seedId]);
		let frontier = [seedId];
		result.get(seedId)?.add(seedId);
		for (let depth = 0; depth < maxDepth; depth++) {
			const next: string[] = [];
			for (const current of frontier) {
				for (const edge of adjacency.get(current) ?? []) {
					if (!candidateSet.has(edge.neighborId) || visited.has(edge.neighborId)) continue;
					visited.add(edge.neighborId);
					result.get(edge.neighborId)?.add(seedId);
					next.push(edge.neighborId);
				}
			}
			frontier = next;
			if (frontier.length === 0) break;
		}
	}
	return result;
}

function randomWalkWithRestart(
	candidateIds: string[],
	adjacency: Map<string, AdjacentEdge[]>,
	seedIds: string[],
	nodeById: Map<string, R1CandidateNode>,
	alpha: number,
	iterations: number,
): Map<string, number> {
	const index = new Map(candidateIds.map((id, position) => [id, position]));
	const restart = new Array<number>(candidateIds.length).fill(0);
	let restartTotal = 0;
	for (const seedId of seedIds) {
		const position = index.get(seedId);
		if (position === undefined) continue;
		const weight = Math.max(0, nodeById.get(seedId)?.lexicalScore ?? 0) || 1;
		restart[position] = weight;
		restartTotal += weight;
	}
	if (restartTotal === 0) restartTotal = 1;
	for (let position = 0; position < restart.length; position++) {
		restart[position] = (restart[position] ?? 0) / restartTotal;
	}
	let scores = [...restart];
	for (let iteration = 0; iteration < iterations; iteration++) {
		const walked = new Array<number>(candidateIds.length).fill(0);
		for (let position = 0; position < candidateIds.length; position++) {
			const id = candidateIds[position];
			if (!id) continue;
			const rows = (adjacency.get(id) ?? []).filter((edge) => index.has(edge.neighborId));
			const totalWeight = sum(rows.map((edge) => edge.weight));
			if (totalWeight === 0) {
				walked[position] = (walked[position] ?? 0) + (scores[position] ?? 0);
				continue;
			}
			for (const edge of rows) {
				const neighbor = index.get(edge.neighborId);
				if (neighbor === undefined) continue;
				walked[neighbor] =
					(walked[neighbor] ?? 0) + ((scores[position] ?? 0) * edge.weight) / totalWeight;
			}
		}
		scores = walked.map(
			(value, position) => (1 - alpha) * value + alpha * (restart[position] ?? 0),
		);
	}
	return new Map(candidateIds.map((id, position) => [id, scores[position] ?? 0]));
}

function validateConfig(config: R1SelectorConfig): void {
	for (const [name, value] of [
		["protectedLexicalSeeds", config.protectedLexicalSeeds],
		["maxCandidateNodes", config.maxCandidateNodes],
		["maxDepth", config.maxDepth],
		["iterations", config.iterations],
		["selectedClaimLimit", config.selectedClaimLimit],
	] as const) {
		if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be non-negative`);
	}
	if (
		config.maxCandidateNodes === 0 ||
		config.selectedClaimLimit === 0 ||
		config.iterations === 0
	) {
		throw new Error("R1 candidate, selection and iteration limits must be positive");
	}
	if (!(config.restartAlpha > 0 && config.restartAlpha < 1)) {
		throw new Error("restartAlpha must be between zero and one");
	}
}

function sum(values: number[]): number {
	return values.reduce((total, value) => total + value, 0);
}
