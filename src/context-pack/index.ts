/**
 * Context Pack — Agent 统一消费合同
 *
 * Product Definition §07 流 2：Agent 先获得知识地图，再按任务加载子图与证据。
 *
 * 从 Canonical Claim/Concept/Relation + SourceSpan 组装面向任务的上下文。
 * 去重 + 排序 + 预算控制 + 风险标注 + 引用封装。
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

/**
 * 构建面向任务的 Context Pack。
 *
 * @param config - 配置
 * @param task - 用户任务描述
 * @param budget - token 预算
 * @param maxDepth - Graph 遍历深度
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

	// ── 2. 构建 Graph ──
	const graph = buildGraph(allClaims, allConcepts, allRelations);

	// ── 3. 关键词搜索种子 ──
	const searchResults = searchClaims(graph.claims, task, 10);
	const seedIds = searchResults.map((r) => r.claim.id);

	const selectionLog: SelectionLogEntry[] = [];
	for (const r of searchResults) {
		selectionLog.push({
			selected: r.claim.id,
			reason: `关键词匹配 score=${r.score}`,
		});
	}

	// ── 4. Graph 扩展（沿关系找更多 Claim）──
	const allowedTypes = new Set(["REQUIRES", "DERIVED_FROM", "SUPPORTS", "CONTRADICTS", "SUPERSEDES", "EQUIVALENT_UNDER"]);
	const subgraph = walkGraph(graph, seedIds, maxDepth, allowedTypes);

	// ── 5. 预算控制（简单 token 估算：4 chars ≈ 1 token）──
	const maxChars = budget * 4;
	let usedChars = 0;
	const selectedClaims: Claim[] = [];
	const selectedRelations: Relation[] = [];
	const selectedSpanIds = new Set<string>();

	// 先放种子 Claim（相关性最高）
	for (const r of searchResults) {
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
		if (usedChars + 100 > maxChars) break; // 粗估每条边 ~100 chars
		selectedRelations.push(rel);
		usedChars += 100;
	}

	// ── 6. 回填原文证据 ──
	const evidenceSpans = findSpansByIds(allSpans, [...selectedSpanIds]);

	// ── 7. 提取冲突与条件 ──
	const conflictsAndConditions: string[] = [];
	for (const claim of selectedClaims) {
		if (claim.validity === "DISPUTED") {
			conflictsAndConditions.push(`⚠️ Claim ${claim.id} 存在争议: ${claim.statement.slice(0, 80)}`);
		}
		if (claim.conditions.length > 0) {
			conflictsAndConditions.push(
				`📌 Claim ${claim.id} 适用条件: ${claim.conditions.join("; ")}`,
			);
		}
	}

	// ── 8. 知识地图（简版）──
	const taskMap = [
		`主题: ${task}`,
		`找到 ${selectedClaims.length} 条相关 Claim`,
		`找到 ${selectedRelations.length} 条关系`,
		`找到 ${evidenceSpans.length} 条原文证据`,
		conflictsAndConditions.length > 0
			? `发现 ${conflictsAndConditions.length} 个冲突/条件`
			: "无已知冲突",
	].join("\n");

	// ── 9. 已知缺口 ──
	const knownGaps: string[] = [];
	if (selectedClaims.length === 0) {
		knownGaps.push("未找到与任务相关的 Claim——知识库可能未覆盖此主题");
	}
	if (selectedRelations.length === 0) {
		knownGaps.push("未找到关系——Graph 可能尚未建立跨材料边");
	}

	return {
		knowledgeVersion: new Date().toISOString(),
		taskMap,
		subgraph: selectedRelations,
		wikiModules: [], // Phase 2 实现 WikiModule
		evidenceSpans,
		conflictsAndConditions,
		selectionLog,
		knownGaps,
	};
}
