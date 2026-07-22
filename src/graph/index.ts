/**
 * Graph — 类型化关系索引
 *
 * 修 GPT 问题 10：Graph 从 Canonical Claim/Concept/Relation 构建，不从 Wiki 文本反向抽取。
 * 修旧项目 Bug 4：只读 publicationState=CANONICAL + lifecycle=ACTIVE，Quarantine 不进 Graph。
 *
 * Product Definition §06 架构图：Compiler → Claim/Concept/Relation → Graph
 */

import type { Claim, Concept, Relation } from "../types/index.js";

/** 图数据 */
export interface GraphData {
	claims: Claim[];
	concepts: Concept[];
	relations: Relation[];
	/** 邻接索引：nodeId → 关联的 Relation 列表 */
	adjacency: Map<string, Relation[]>;
}

/**
 * 从 Canonical Claim/Concept/Relation 构建图。
 *
 * 只包含 publicationState=CANONICAL + lifecycle=ACTIVE 的对象。
 * Quarantined 和 Superseded 不进图。
 *
 * @param claims - 所有 Claim（会自动过滤）
 * @param concepts - 所有 Concept
 * @param relations - 所有 Relation（会自动过滤）
 */
export function buildGraph(
	claims: Claim[],
	concepts: Concept[],
	relations: Relation[],
): GraphData {
	// 过滤：只保留 Canonical + Active
	const activeClaims = claims.filter(
		(c) => c.publicationState === "CANONICAL" && c.lifecycle === "ACTIVE",
	);
	const activeRelations = relations.filter(
		(r) => r.publicationState === "CANONICAL" && r.lifecycle === "ACTIVE",
	);

	// 构建邻接索引
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
 * @param graph - 图数据
 * @param seedIds - 种子节点 ID 列表
 * @param maxDepth - 最大遍历深度
 * @param allowedTypes - 允许的关系类型
 * @returns 子图中的 Claim + Relation
 */
export function walkGraph(
	graph: GraphData,
	seedIds: string[],
	maxDepth: number,
	allowedTypes?: Set<string>,
): { claims: Claim[]; relations: Relation[] } {
	const visitedNodes = new Set<string>(seedIds);
	const visitedRels = new Set<string>();
	const resultClaims: Claim[] = [];
	const resultRelations: Relation[] = [];

	// 种子 Claim 直接加入
	const claimMap = new Map(graph.claims.map((c) => [c.id, c]));
	for (const seedId of seedIds) {
		const claim = claimMap.get(seedId);
		if (claim) resultClaims.push(claim);
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

				// 加入边
				if (!visitedRels.has(edge.id)) {
					visitedRels.add(edge.id);
					resultRelations.push(edge);
				}

				// 加入对端节点
				const otherId = edge.from === nodeId ? edge.to : edge.from;
				if (!visitedNodes.has(otherId)) {
					visitedNodes.add(otherId);
					nextFrontier.push(otherId);

					// 如果对端是 Claim，加入结果
					const otherClaim = claimMap.get(otherId);
					if (otherClaim) resultClaims.push(otherClaim);
				}
			}
		}

		frontier = nextFrontier;
	}

	return { claims: resultClaims, relations: resultRelations };
}

/**
 * 关键词搜索 Claim（简单 BM25 替代，Phase 1 先用包含匹配）。
 *
 * @param claims - 所有 Claim
 * @param query - 搜索查询
 * @param limit - 返回数量上限
 * @returns 按 relevance 排序的 Claim 列表
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
		.filter((c) => c.publicationState === "CANONICAL" && c.lifecycle === "ACTIVE")
		.map((claim) => {
			const text = claim.statement.toLowerCase();
			let score = 0;
			for (const term of queryTerms) {
				// 简单包含匹配
				const count = text.split(term).length - 1;
				score += count;
			}
			return { claim, score };
		})
		.filter((s) => s.score > 0)
		.sort((a, b) => b.score - a.score);

	return scored.slice(0, limit);
}
