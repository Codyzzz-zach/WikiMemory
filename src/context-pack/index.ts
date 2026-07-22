/**
 * Context Pack — Agent 统一消费合同
 *
 * Product Definition §07 流 2 + 哲学 07：先地图、后子图、再证据。
 *
 * 修 GPT 审计断点 3：taskMap 从「检索后摘要」改为「检索前地图」。
 *   - 先从 Claim/Concept 构建全局地图（主题/争议/关键概念/最近变化）
 *   - 地图参与种子选择（不只是关键词匹配）
 *   - Context Pack 最终携带裁剪后的 taskMap
 *
 * 修 GPT 审计断点 5：接入消费矩阵。
 *   - walkGraph 返回 disputedClaims/unresolvedClaims
 *   - DISPUTED → conflictsAndConditions
 *   - UNRESOLVED → knownGaps
 */

import type { AppConfig } from "../config/types.js";
import type {
	Claim,
	ContextPack,
	Relation,
	SelectionLogEntry,
} from "../types/index.js";
import {
	buildGraph,
	searchClaims,
	walkGraph,
} from "../graph/index.js";
import {
	findSpansByIds,
	readAllClaims,
	readAllConcepts,
	readAllRelations,
	readAllSpans,
} from "../linter/storage.js";

// ─── Map-first：检索前地图 ──────────────────────────────────────

/**
 * 全局知识地图（检索前生成，参与种子选择）。
 *
 * 修断点 3：这不是搜索结果的摘要，是一个低成本导航索引。
 * 它在种子选择之前生成，帮助系统知道"应该选什么"。
 */
export interface KnowledgeMap {
	/** 识别的主题（从 Claim statement 高频词提取） */
	topics: string[];
	/** 已知争议（validity=DISPUTED 的 Claim 摘要） */
	disputes: string[];
	/** 关键概念（从 Concept 提取） */
	keyConcepts: string[];
	/** 最近变化（最近 N 条 Claim 的时间戳 + 摘要） */
	recentChanges: string[];
	/** 地图生成时的 Claim 总数 */
	totalClaims: number;
}

/**
 * 从知识状态构建全局地图。
 * 在种子选择之前调用——用于 map-first 的选择机制。
 */
export function buildKnowledgeMap(
	claims: Claim[],
	concepts: { id: string; name: string; aliases: string[] }[],
): KnowledgeMap {
	// 只看 Canonical + Active
	const active = claims.filter(
		(c) => c.publicationState === "CANONICAL" && c.lifecycle === "ACTIVE",
	);

	// 主题提取：从 Claim statement 提取高频关键词（简单分词）
	const wordFreq = new Map<string, number>();
	for (const claim of active) {
		// 简单分词：按空格和标点切分，取长度 > 1 的词
		const words = claim.statement
			.toLowerCase()
			.split(/[\s,，。.;；:：!！?？""""''()（）\[\]]+/)
			.filter((w) => w.length > 1);
		for (const word of words) {
			wordFreq.set(word, (wordFreq.get(word) ?? 0) + 1);
		}
	}
	const topics = [...wordFreq.entries()]
		.filter(([, count]) => count >= 2) // 至少出现 2 次
		.sort((a, b) => b[1]! - a[1]!)
		.slice(0, 10)
		.map(([word]) => word);

	// 已知争议
	const disputes = active
		.filter((c) => c.validity === "DISPUTED")
		.slice(0, 5)
		.map((c) => `${c.id}: ${c.statement.slice(0, 80)}`);

	// 关键概念
	const keyConcepts = concepts
		.slice(0, 15)
		.map((c) => c.name);

	// 最近变化（按 createdAt/validFrom 排序）
	const recentChanges = [...active]
		.sort((a, b) => (b.validFrom ?? "").localeCompare(a.validFrom ?? ""))
		.slice(0, 5)
		.map((c) => `[${c.validFrom?.slice(0, 10) ?? "?"}] ${c.statement.slice(0, 60)}`);

	return {
		topics,
		disputes,
		keyConcepts,
		recentChanges,
		totalClaims: active.length,
	};
}

/**
 * 基于地图 + 查询生成种子 Claim ID。
 *
 * 修断点 3：种子不只来自关键词匹配，还参考地图。
 * - 先用关键词搜索找到直接匹配
 * - 再用地图的 topics/disputes 补充可能遗漏的相关 Claim
 */
function selectSeeds(
	map: KnowledgeMap,
	claims: Claim[],
	query: string,
): Array<{ claim: Claim; score: number; source: string }> {
	// 1. 关键词搜索直接匹配
	const directMatches = searchClaims(claims, query, 10).map((r) => ({
		claim: r.claim,
		score: r.score,
		source: "keyword-direct",
	}));

	// 2. 地图辅助：检查查询词是否命中地图主题
	const queryTerms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
	const matchedTopics = map.topics.filter((topic) =>
		queryTerms.some((term) => topic.includes(term) || term.includes(topic)),
	);

	// 如果有地图主题匹配，找与该主题相关的 Claim 补充到种子
	const existingIds = new Set(directMatches.map((m) => m.claim.id));
	const topicMatches: Array<{ claim: Claim; score: number; source: string }> = [];

	if (matchedTopics.length > 0) {
		for (const claim of claims) {
			if (existingIds.has(claim.id)) continue;
			if (claim.publicationState !== "CANONICAL" || claim.lifecycle !== "ACTIVE") continue;

			const text = claim.statement.toLowerCase();
			for (const topic of matchedTopics) {
				if (text.includes(topic)) {
					topicMatches.push({
						claim,
						score: 0.5, // 地图辅助匹配分数低于直接匹配
						source: "map-topic",
					});
					existingIds.add(claim.id);
					break;
				}
			}
		}
	}

	return [...directMatches, ...topicMatches.slice(0, 5)];
}

// ─── Context Pack 构建 ──────────────────────────────────────────

/**
 * 构建面向任务的 Context Pack。
 *
 * 修断点 3：流程改为 Map → Seed → Subgraph → Evidence → Pack
 */
export function buildContextPack(
	config: AppConfig,
	task: string,
	budget = 12000,
	maxDepth = 3,
): ContextPack {
	// ── 1. 加载知识状态 ──
	const allClaims = readAllClaims(config);
	const allConcepts = readAllConcepts(config);
	const allRelations = readAllRelations(config);
	const allSpans = readAllSpans(config);

	// ── 2. 构建全局地图（修断点 3：map-first）──
	const knowledgeMap = buildKnowledgeMap(allClaims, allConcepts);

	// ── 3. 构建 Graph ──
	const graph = buildGraph(allClaims, allConcepts, allRelations);

	// ── 4. 基于地图 + 查询选择种子（修断点 3）──
	const seedResults = selectSeeds(knowledgeMap, graph.claims, task);
	const seedIds = seedResults.map((r) => r.claim.id);

	const selectionLog: SelectionLogEntry[] = [];
	for (const r of seedResults) {
		selectionLog.push({
			selected: r.claim.id,
			reason: `${r.source} (score=${r.score})`,
		});
	}

	// ── 5. Graph 扩展（沿关系找更多 Claim）──
	const allowedTypes = new Set([
		"REQUIRES", "DERIVED_FROM", "SUPPORTS",
		"CONTRADICTS", "SUPERSEDES", "EQUIVALENT_UNDER",
	]);
	const subgraph = walkGraph(graph, seedIds, maxDepth, allowedTypes);

	// ── 6. 预算控制（4 chars ≈ 1 token）──
	const maxChars = budget * 4;
	let usedChars = 0;
	const selectedClaims: Claim[] = [];
	const selectedRelations: Relation[] = [];
	const selectedSpanIds = new Set<string>();

	// 先放种子 Claim（相关性最高）
	for (const r of seedResults) {
		const claimChars = r.claim.statement.length;
		if (usedChars + claimChars > maxChars) {
			selectionLog.push({
				selected: "",
				reason: "",
				dropped: r.claim.id,
				dropReason: "预算超限",
			});
			continue;
		}
		selectedClaims.push(r.claim);
		usedChars += claimChars;
		for (const spanId of r.claim.evidenceSpanIds) {
			selectedSpanIds.add(spanId);
		}
	}

	// 再放 Graph 扩展的额外 Claim（去重）
	const existingIds = new Set(selectedClaims.map((c) => c.id));
	for (const claim of subgraph.claims) {
		if (existingIds.has(claim.id)) continue;
		const claimChars = claim.statement.length;
		if (usedChars + claimChars > maxChars) break;
		selectedClaims.push(claim);
		existingIds.add(claim.id);
		usedChars += claimChars;
		for (const spanId of claim.evidenceSpanIds) {
			selectedSpanIds.add(spanId);
		}
	}

	// 放 Relations
	for (const rel of subgraph.relations) {
		if (usedChars + 100 > maxChars) break;
		selectedRelations.push(rel);
		usedChars += 100;
	}

	// ── 7. 回填原文证据 ──
	const evidenceSpans = findSpansByIds(allSpans, [...selectedSpanIds]);

	// ── 8. 冲突与条件（修断点 5：从 walkGraph 返回值获取）──
	const conflictsAndConditions: string[] = [];

	// DISPUTED Claim → conflictsAndConditions
	for (const claim of subgraph.disputedClaims) {
		conflictsAndConditions.push(
			`⚠️ Claim ${claim.id} 存在争议: ${claim.statement.slice(0, 80)}`,
		);
	}
	// 带 conditions 的 Claim
	for (const claim of selectedClaims) {
		if (claim.conditions.length > 0) {
			conflictsAndConditions.push(
				`📌 Claim ${claim.id} 适用条件: ${claim.conditions.join("; ")}`,
			);
		}
	}

	// ── 9. 已知缺口（修断点 5：UNRESOLVED → knownGaps）──
	const knownGaps: string[] = [];
	for (const claim of subgraph.unresolvedClaims) {
		knownGaps.push(
			`❓ Claim ${claim.id} 证据未决: ${claim.statement.slice(0, 60)}`,
		);
	}
	if (selectedClaims.length === 0) {
		knownGaps.push("未找到与任务相关的 Claim——知识库可能未覆盖此主题");
	}
	if (selectedRelations.length === 0) {
		knownGaps.push("未找到关系——Graph 可能尚未建立跨材料边");
	}

	// ── 10. 裁剪后的 taskMap（地图是检索前生成的，Pack 携带裁剪版）──
	const taskMap = [
		`主题: ${task}`,
		`地图主题: ${knowledgeMap.topics.slice(0, 5).join(", ") || "无"}`,
		`关键概念: ${knowledgeMap.keyConcepts.slice(0, 5).join(", ") || "无"}`,
		`已知争议: ${knowledgeMap.disputes.length} 个`,
		`最近变化: ${knowledgeMap.recentChanges.length} 条`,
		`找到 ${selectedClaims.length} 条相关 Claim`,
		`找到 ${selectedRelations.length} 条关系`,
		`找到 ${evidenceSpans.length} 条原文证据`,
	].join("\n");

	return {
		knowledgeVersion: new Date().toISOString(),
		taskMap,
		subgraph: selectedRelations,
		wikiModules: [], // Phase 2 实现
		evidenceSpans,
		conflictsAndConditions,
		selectionLog,
		knownGaps,
	};
}
