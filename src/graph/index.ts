/**
 * Graph — 类型化关系索引
 *
 * 修 GPT 审计断点 2：双向邻接与关系方向语义需要分层。
 *   - 邻接 Map 允许从两端找到边（导航用）
 *   - 但推理有方向约束：A REQUIRES B 允许从 B 反向找到 A（导航），但不允许解释成 B REQUIRES A（推理）
 *
 * 修 GPT 审计断点 5：接入 Canonical 消费矩阵。
 *   - 不只过滤 publicationState + lifecycle
 *   - 还要按 validity 区分：UNRESOLVED 可导航但不进推理链，DISPUTED 进 conflictsAndConditions
 *
 * 修 GPT 审计断点 10：Graph 从 Canonical Claim/Concept/Relation 构建，不从 Wiki 文本反向抽取。
 */

import { getConsumptionRule } from "../linter/index.js";
import { RELATION_AUDIT_VERSION } from "../prompts/index.js";
import type { Claim, Concept, Relation } from "../types/index.js";
import type { RelationType } from "../types/index.js";

// ─── RelationType 方向语义（修断点 2）──────────────────────────

export interface RelationTypeSemantics {
	/** 是否对称（A→B 等价于 B→A） */
	symmetric: boolean;
	/** 是否允许反向导航（从 to 端找到 from 端） */
	allowReverseNavigation: boolean;
	/** 是否允许反向推理（从 to 端推出 from 端的结论） */
	allowReverseReasoning: boolean;
	/** 是否可以支撑结论（RELATED_TO 不可以） */
	canSupportConclusion: boolean;
}

/**
 * 冻结每种 RelationType 的方向语义。
 * 修断点 2：方向性由 type 语义定义，不是统一 direction: "directed"。
 */
const RELATION_TYPE_SEMANTICS: Record<RelationType, RelationTypeSemantics> = {
	REQUIRES: {
		symmetric: false,
		allowReverseNavigation: true, // 可以从 B 找到"谁需要 B"
		allowReverseReasoning: false, // 不能从 B 推出"B 需要 A"
		canSupportConclusion: true,
	},
	DERIVED_FROM: {
		symmetric: false,
		allowReverseNavigation: true,
		allowReverseReasoning: false,
		canSupportConclusion: true,
	},
	SUPPORTS: {
		symmetric: false,
		allowReverseNavigation: true, // 可以找"谁支持了这个结论"
		allowReverseReasoning: false,
		canSupportConclusion: true,
	},
	CONTRADICTS: {
		symmetric: true, // 矛盾通常是对称的
		allowReverseNavigation: true,
		allowReverseReasoning: true, // 对称关系允许反向推理
		canSupportConclusion: true,
	},
	SUPERSEDES: {
		symmetric: false,
		allowReverseNavigation: true, // 可以找"谁被谁取代了"
		allowReverseReasoning: false,
		canSupportConclusion: true,
	},
	EQUIVALENT_UNDER: {
		symmetric: true, // 等价是对称的（在给定条件下）
		allowReverseNavigation: true,
		allowReverseReasoning: true,
		canSupportConclusion: true,
	},
	RELATED_TO: {
		symmetric: true,
		allowReverseNavigation: true,
		allowReverseReasoning: false,
		canSupportConclusion: false, // 弱关联不能支撑结论（哲学 05）
	},
};

export function getRelationTypeSemantics(type: RelationType): RelationTypeSemantics {
	return RELATION_TYPE_SEMANTICS[type];
}

// ─── 图数据结构 ──────────────────────────────────────────────────

export interface GraphData {
	claims: Claim[];
	concepts: Concept[];
	relations: Relation[];
	/** 邻接索引：nodeId → 关联的 Relation 列表（双向，导航用） */
	adjacency: Map<string, Relation[]>;
}

export interface GraphTraversalStep {
	relationId: string;
	fromNodeId: string;
	toNodeId: string;
	depth: number;
	navigationDirection: "forward" | "reverse";
	pathNodeIds: string[];
	pathRelationIds: string[];
	triggerReason: "reachable-from-seed-bfs";
}

export type RelationGateReason =
	| "accepted"
	| "not-canonical"
	| "not-active"
	| "unresolved"
	| "condition-unverified"
	| "audit-version-mismatch"
	| "missing-or-ineligible-endpoint";

/**
 * Explain the exact fail-closed decision used by buildGraph.
 * This is observability only: buildGraph consumes the same decision, so Trace cannot
 * silently drift away from the production gate.
 */
export function inspectRelationGate(
	relation: Relation,
	activeNodeIds: ReadonlySet<string>,
): { accepted: boolean; reason: RelationGateReason } {
	if (relation.publicationState !== "CANONICAL") {
		return { accepted: false, reason: "not-canonical" };
	}
	if (relation.lifecycle !== "ACTIVE") return { accepted: false, reason: "not-active" };
	if (relation.validity === "UNRESOLVED") return { accepted: false, reason: "unresolved" };
	if (relation.conditionStatus === "UNVERIFIED") {
		return { accepted: false, reason: "condition-unverified" };
	}
	if (relation.relationAuditVersion !== RELATION_AUDIT_VERSION) {
		return { accepted: false, reason: "audit-version-mismatch" };
	}
	if (!activeNodeIds.has(relation.from as string) || !activeNodeIds.has(relation.to as string)) {
		return { accepted: false, reason: "missing-or-ineligible-endpoint" };
	}
	return { accepted: true, reason: "accepted" };
}

/**
 * 从 Canonical Claim/Concept/Relation 构建图。
 *
 * 修断点 5：不只过滤 publicationState + lifecycle，
 * 还记录 validity 用于消费矩阵（Graph 内不过滤 validity——消费矩阵在 walkGraph/searchClaims 层面应用）。
 *
 * @param claims - 所有 Claim
 * @param concepts - 所有 Concept
 * @param relations - 所有 Relation
 */
export function buildGraph(claims: Claim[], concepts: Concept[], relations: Relation[]): GraphData {
	// 过滤：只保留 Canonical + Active
	const activeClaims = claims.filter(
		(c) => c.publicationState === "CANONICAL" && c.lifecycle === "ACTIVE",
	);
	const activeNodeIds = new Set([
		...activeClaims.map((claim) => claim.id),
		...concepts.map((concept) => concept.id),
	]);
	const activeRelations = relations.filter(
		(relation) => inspectRelationGate(relation, activeNodeIds).accepted,
	);

	// 构建双向邻接 Map（导航用——修断点 2：双向是导航，不是推理）
	const adjacency = new Map<string, Relation[]>();
	for (const rel of activeRelations) {
		const fromList = adjacency.get(rel.from) ?? [];
		fromList.push(rel);
		adjacency.set(rel.from, fromList);

		const toList = adjacency.get(rel.to) ?? [];
		toList.push(rel);
		adjacency.set(rel.to, toList);
	}

	return {
		claims: activeClaims,
		concepts,
		relations: activeRelations,
		adjacency,
	};
}

/**
 * 从种子节点出发，沿 Graph 关系扩展。
 *
 * 修断点 2：遍历时区分方向。
 * - 正向遍历：seed → to 端（直接用 edge.type 语义）
 * - 反向遍历：seed ← from 端（检查 allowReverseNavigation）
 * - 用于推理时检查 canSupportConclusion
 *
 * 修断点 5：遍历时应用消费矩阵。
 * - DISPUTED 的 Claim 可以出现在结果里，但标记为"不能独立支撑结论"
 * - UNRESOLVED 的 Claim 可以导航但不能进推理链
 *
 * @param graph - 图数据
 * @param seedIds - 种子节点 ID 列表
 * @param maxDepth - 最大遍历深度
 * @param allowedTypes - 允许的关系类型（可选）
 */
export function walkGraph(
	graph: GraphData,
	seedIds: string[],
	maxDepth: number,
	allowedTypes?: Set<string>,
): {
	claims: Claim[];
	relations: Relation[];
	traversalTrace: GraphTraversalStep[];
	/** 需要进入 conflictsAndConditions 的 Claim */
	disputedClaims: Claim[];
	/** 只能导航不能推理的 Claim */
	unresolvedClaims: Claim[];
} {
	const visitedNodes = new Set<string>(seedIds);
	const visitedRels = new Set<string>();
	const resultClaims: Claim[] = [];
	const resultRelations: Relation[] = [];
	const disputedClaims: Claim[] = [];
	const unresolvedClaims: Claim[] = [];
	const traversalTrace: GraphTraversalStep[] = [];
	const pathByNode = new Map<string, { nodeIds: string[]; relationIds: string[] }>(
		seedIds.map((seedId) => [seedId, { nodeIds: [seedId], relationIds: [] }]),
	);

	const claimMap = new Map(graph.claims.map((c) => [c.id, c]));

	// 种子 Claim 直接加入，按消费矩阵分类
	for (const seedId of seedIds) {
		const claim = claimMap.get(seedId);
		if (!claim) continue;

		const rule = getConsumptionRule(claim.publicationState, claim.lifecycle, claim.validity);

		if (!rule.allowRetrieval) continue;

		resultClaims.push(claim);
		if (rule.packBehavior === "conflictsAndConditions") {
			disputedClaims.push(claim);
		}
		if (rule.packBehavior === "knownGaps") {
			unresolvedClaims.push(claim);
		}
	}

	// BFS 扩展
	let frontier = [...seedIds];
	for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
		const nextFrontier: string[] = [];

		for (const nodeId of frontier) {
			const edges = graph.adjacency.get(nodeId) ?? [];
			for (const edge of edges) {
				// 过滤关系类型
				if (allowedTypes && !allowedTypes.has(edge.type)) continue;

				// 修断点 2：检查方向语义
				const isFromSeed = edge.from === nodeId;
				const sem = getRelationTypeSemantics(edge.type);

				// 如果是反向遍历（seed 在 to 端），检查是否允许反向导航
				if (!isFromSeed && !sem.allowReverseNavigation && !sem.symmetric) {
					continue;
				}

				// 加入边
				if (!visitedRels.has(edge.id)) {
					visitedRels.add(edge.id);
					resultRelations.push(edge);
					const basePath = pathByNode.get(nodeId) ?? { nodeIds: [nodeId], relationIds: [] };
					const otherId = isFromSeed ? edge.to : edge.from;
					traversalTrace.push({
						relationId: edge.id,
						fromNodeId: nodeId,
						toNodeId: otherId as string,
						depth: depth + 1,
						navigationDirection: isFromSeed ? "forward" : "reverse",
						pathNodeIds: [...basePath.nodeIds, otherId as string],
						pathRelationIds: [...basePath.relationIds, edge.id],
						triggerReason: "reachable-from-seed-bfs",
					});
				}

				// 加入对端节点
				const otherId = isFromSeed ? edge.to : edge.from;
				if (!visitedNodes.has(otherId)) {
					visitedNodes.add(otherId);
					nextFrontier.push(otherId);
					const basePath = pathByNode.get(nodeId) ?? { nodeIds: [nodeId], relationIds: [] };
					pathByNode.set(otherId, {
						nodeIds: [...basePath.nodeIds, otherId as string],
						relationIds: [...basePath.relationIds, edge.id],
					});

					// 如果对端是 Claim，按消费矩阵分类
					const otherClaim = claimMap.get(otherId);
					if (otherClaim) {
						const otherRule = getConsumptionRule(
							otherClaim.publicationState,
							otherClaim.lifecycle,
							otherClaim.validity,
						);

						if (otherRule.allowRetrieval) {
							resultClaims.push(otherClaim);
							if (otherRule.packBehavior === "conflictsAndConditions") {
								disputedClaims.push(otherClaim);
							}
							if (otherRule.packBehavior === "knownGaps") {
								unresolvedClaims.push(otherClaim);
							}
						}
					}
				}
			}
		}

		frontier = nextFrontier;
	}

	return {
		claims: resultClaims,
		relations: resultRelations,
		traversalTrace,
		disputedClaims,
		unresolvedClaims,
	};
}

/**
 * 关键词搜索 Claim。
 *
 * 修断点 5：应用消费矩阵——UNRESOLVED 可搜到但不进推理链。
 */
export function searchClaims(
	claims: Claim[],
	query: string,
	limit = 10,
): Array<{ claim: Claim; score: number }> {
	const queryTerms = query
		.toLowerCase()
		.split(/\s+/)
		.filter((t) => t.length > 0);

	const scored = claims
		.filter((c) => {
			// 消费矩阵：只有 CANONICAL+ACTIVE 才能进检索
			const rule = getConsumptionRule(c.publicationState, c.lifecycle, c.validity);
			return rule.allowRetrieval;
		})
		.map((claim) => {
			const text = claim.statement.toLowerCase();
			let score = 0;
			for (const term of queryTerms) {
				const count = text.split(term).length - 1;
				score += count;
			}
			return { claim, score };
		})
		.filter((s) => s.score > 0)
		.sort((a, b) => b.score - a.score);

	return scored.slice(0, limit);
}
