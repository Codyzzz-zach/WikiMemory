/**
 * Context Pack — Agent 统一消费合同
 *
 * Product Definition §07 流 2 + 哲学 07：先地图、后子图、再证据。
 *
 * 修 GPT 审计断点 3：taskMap 从「检索后摘要」改为「检索前地图」。
 *   - 先从 Claim/Concept 构建全局地图（主题/争议/关键概念/最近变化）
 *   - Seed Retriever 独立选择可靠起点，地图为 Agent 提供全局定向
 *   - Context Pack 最终携带裁剪后的 taskMap
 *
 * 修 GPT 审计断点 5：接入消费矩阵。
 *   - walkGraph 返回 disputedClaims/unresolvedClaims
 *   - DISPUTED → conflictsAndConditions
 *   - UNRESOLVED → knownGaps
 */

import { estimateTokens } from "../compiler/telemetry.js";
import type { AppConfig } from "../config/types.js";
import { buildGraph, walkGraph } from "../graph/index.js";
import {
	computeKnowledgeVersion,
	findSpansByIds,
	readAllClaims,
	readAllConcepts,
	readAllRelations,
	readAllSources,
	readAllSpans,
	readAllWikiModules,
} from "../linter/storage.js";
import {
	filterClaimsByExplicitTemporalScope,
	lexicalFeatures,
	retrieveClaimSeeds,
} from "../retrieval/index.js";
import type {
	Claim,
	ContextPack,
	Relation,
	ScopeContext,
	SelectionLogEntry,
} from "../types/index.js";

// ─── Map-first：检索前地图 ──────────────────────────────────────

/**
 * 全局知识地图（检索前生成，为 Agent 提供低成本全局定向）。
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

export interface ContextPackDiagnostics {
	temporalScope: {
		applied: boolean;
		startMonth: string | null;
		endMonth: string | null;
		excludedClaimIds: string[];
	};
	retrieval: {
		queryFeatureCount: number;
		eligibleClaimCount: number;
		matchedClaimCount: number;
		usedEvidenceText: boolean;
		usedSourceMetadata: boolean;
		resolvedEvidenceRefCount: number;
		unresolvedEvidenceRefCount: number;
		candidates: Array<{
			claimId: string;
			rank: number;
			score: number;
			channels: string[];
			matchedFeatureCount: number;
		}>;
	};
	graph: {
		seedClaimIds: string[];
		expandedClaimIds: string[];
		expandedRelationIds: string[];
	};
	budget: {
		selectedClaimIds: string[];
		selectedRelationIds: string[];
		selectedEvidenceSpanIds: string[];
		selectedWikiModuleIds: string[];
		dropped: Array<{ id: string; reason: string }>;
		finalEstimatedTokens: number;
	};
}

export interface ContextPackBuildResult {
	pack: ContextPack;
	diagnostics: ContextPackDiagnostics;
}

/**
 * 按 ScopeContext 过滤 Claim（v1.1：Global Base + Scoped Overlay）。
 *
 * 选择规则（Product Definition §05 作用域消费链）：
 * 1. 始终包含 GLOBAL 知识
 * 2. 包含当前 principalId 的 PERSONAL 知识
 * 3. 有 projectId 时，只包含该项目的 PROJECT 知识
 * 4. 绝不召回其他个人或项目作用域的知识
 *
 * 缺少 ScopeContext 时由调用方按 Global-only 处理（不调此函数）。
 */
export function filterClaimsByScope(claims: Claim[], scope: ScopeContext): Claim[] {
	return claims.filter((claim) => {
		const cs = claim.scope;
		if (cs.type === "GLOBAL") return true;
		if (cs.type === "PERSONAL") return cs.id === scope.principalId;
		if (cs.type === "PROJECT") return cs.id === scope.projectId;
		return false;
	});
}

/**
 * 从知识状态构建全局地图。
 * 在种子选择之前调用——用于 map-first 的选择机制。
 */
export function buildKnowledgeMap(
	claims: Claim[],
	concepts: { id: string; name: string; aliases: string[] }[],
	query = "",
): KnowledgeMap {
	// 只看 Canonical + Active
	const active = claims.filter(
		(c) => c.publicationState === "CANONICAL" && c.lifecycle === "ACTIVE",
	);

	// 地图必须帮助当前任务定向，而不是注入全库高频词和任意 Concept。
	// 仍然在 Seed 之前生成，但只展示和任务有明确稀疏特征交集的项目。
	const queryFeatures = lexicalFeatures(query);
	const relevant =
		queryFeatures.size === 0
			? []
			: active.filter((claim) =>
					[...lexicalFeatures(claim.statement)].some((feature) => queryFeatures.has(feature)),
				);

	// 主题提取：使用与 Seed Retriever 一致的 Unicode 特征，避免整句中文成为一个 token。
	const wordFreq = new Map<string, number>();
	for (const claim of relevant) {
		for (const feature of lexicalFeatures(claim.statement)) {
			if (feature.startsWith("g3:") || !queryFeatures.has(feature)) continue;
			wordFreq.set(feature, (wordFreq.get(feature) ?? 0) + 1);
		}
	}
	const topics = [...wordFreq.entries()]
		.sort(([, leftCount], [, rightCount]) => rightCount - leftCount)
		.slice(0, 10)
		.map(([feature]) => feature.slice(feature.indexOf(":") + 1));

	// 已知争议
	const disputes = relevant
		.filter((c) => c.validity === "DISPUTED")
		.slice(0, 5)
		.map((c) => `${c.id}: ${c.statement.slice(0, 80)}`);

	// 关键概念
	const keyConcepts = concepts
		.filter((concept) =>
			[...lexicalFeatures([concept.name, ...concept.aliases].join(" "))].some((feature) =>
				queryFeatures.has(feature),
			),
		)
		.slice(0, 15)
		.map((concept) => concept.name);

	// 最近变化（按 createdAt/validFrom 排序）
	const recentChanges = [...relevant]
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
 * 基于查询生成可靠的种子 Claim。
 * 地图与 Seed 职责分开：地图负责全局定向，Seed Retriever 负责相关性。
 */
function selectSeeds(
	claims: Claim[],
	spans: ReturnType<typeof readAllSpans>,
	query: string,
	sourceSearchText: ReadonlyMap<string, string>,
): ReturnType<typeof retrieveClaimSeeds> {
	return retrieveClaimSeeds(claims, spans, query, 10, sourceSearchText);
}

// ─── Context Pack 构建 ──────────────────────────────────────────

/**
 * 构建面向任务的 Context Pack。
 *
 * 修断点 3：流程改为 Map → Seed → Subgraph → Evidence → Pack
 */
export function buildContextPackWithDiagnostics(
	config: AppConfig,
	task: string,
	budget = 12000,
	maxDepth = 3,
	scopeContext?: ScopeContext,
): ContextPackBuildResult {
	// ── 1. 加载知识状态 ──
	let allClaims = readAllClaims(config);
	const allConcepts = readAllConcepts(config);
	let allRelations = readAllRelations(config);
	const allSpans = readAllSpans(config);
	const allSources = readAllSources(config);
	const sourceSearchText = new Map(
		allSources.map(
			(source) =>
				[
					source.id,
					[source.uri, source.sourceType, ...Object.entries(source.metadata ?? {}).flat()].join(
						"\n",
					),
				] as const,
		),
	);
	const allWikiModules = readAllWikiModules(config);
	const knowledgeVersion = computeKnowledgeVersion(
		allClaims,
		allConcepts,
		allRelations,
		allWikiModules,
	);

	// ── 1.5 v1.1：作用域过滤（Global Base + Scoped Overlay）──
	// 缺少 ScopeContext 时按 Global-only 处理，不能"默认全选"
	allClaims = scopeContext
		? filterClaimsByScope(allClaims, scopeContext)
		: allClaims.filter((claim) => claim.scope.type === "GLOBAL");
	const temporalScope = filterClaimsByExplicitTemporalScope(
		allClaims,
		allSpans,
		task,
		sourceSearchText,
	);
	allClaims = temporalScope.claims;
	// Relation 只保留两端 Claim 都在过滤后集合中的边，防止通过边泄露其他作用域。
	const scopedClaimIds = new Set(allClaims.map((claim) => claim.id));
	allRelations = allRelations.filter((relation) =>
		[relation.from as string, relation.to as string].every((id) => scopedClaimIds.has(id)),
	);

	// ── 2. 构建全局地图（修断点 3：map-first）──
	const knowledgeMap = buildKnowledgeMap(allClaims, allConcepts, task);

	// ── 3. 构建 Graph ──
	const graph = buildGraph(allClaims, allConcepts, allRelations);

	// ── 4. 选择可靠种子；Graph 只能在 Seed 之后扩展 ──
	const retrieval = selectSeeds(graph.claims, allSpans, task, sourceSearchText);
	const seedResults = retrieval.candidates.map((candidate) => ({
		claim: candidate.claim,
		score: candidate.score,
		source: `lexical:${candidate.channels.join("+")}`,
	}));
	const seedIds = seedResults.map((r) => r.claim.id);

	const selectionLog: SelectionLogEntry[] = [
		{
			selected: "",
			reason:
				`seed-retrieval queryFeatures=${retrieval.diagnostics.queryFeatureCount} ` +
				`eligibleClaims=${retrieval.diagnostics.eligibleClaimCount} ` +
				`matchedClaims=${retrieval.diagnostics.matchedClaimCount} ` +
				`evidenceIndex=${retrieval.diagnostics.usedEvidenceText}`,
		},
	];
	for (const r of seedResults) {
		selectionLog.push({
			selected: r.claim.id,
			reason: `${r.source} (score=${r.score})`,
		});
	}

	// ── 5. Graph 扩展（沿关系找更多 Claim）──
	const allowedTypes = new Set([
		"REQUIRES",
		"DERIVED_FROM",
		"SUPPORTS",
		"CONTRADICTS",
		"SUPERSEDES",
		"EQUIVALENT_UNDER",
		"RELATED_TO",
	]);
	const subgraph = walkGraph(graph, seedIds, maxDepth, allowedTypes);

	// ── 6. 预算控制（v1.1 修复偏离 4：全部 Pack 内容计入预算）──
	// 预算分配：Claim+Relation 占 60%，Evidence 占 25%，冲突+条件+缺口+taskMap 占 15%
	const maxChars = budget * 4;
	const claimRelationBudget = Math.floor(maxChars * 0.6);
	const evidenceBudget = Math.floor(maxChars * 0.25);
	const overheadBudget = maxChars - claimRelationBudget - evidenceBudget; // ~15%

	let usedChars = 0;
	const selectedClaims: Claim[] = [];
	const selectedRelations: Relation[] = [];
	const selectedWikiModules: typeof allWikiModules = [];
	const selectedSpanIds = new Set<string>();

	// 6a. 选 Claim（从 claimRelationBudget 扣）
	for (const r of seedResults) {
		const claimChars = r.claim.statement.length;
		if (usedChars + claimChars > claimRelationBudget) {
			selectionLog.push({
				selected: "",
				reason: "",
				dropped: r.claim.id,
				dropReason: "预算超限(Claim+Relation 段)",
			});
			continue;
		}
		selectedClaims.push(r.claim);
		usedChars += claimChars;
		for (const spanId of r.claim.evidenceSpanIds) {
			selectedSpanIds.add(spanId);
		}
	}

	// 6b. Graph 扩展 Claim（去重，继续从 claimRelationBudget 扣）
	const existingIds = new Set(selectedClaims.map((c) => c.id));
	for (const claim of subgraph.claims) {
		if (existingIds.has(claim.id)) continue;
		const claimChars = claim.statement.length;
		if (usedChars + claimChars > claimRelationBudget) break;
		selectedClaims.push(claim);
		existingIds.add(claim.id);
		usedChars += claimChars;
		for (const spanId of claim.evidenceSpanIds) {
			selectedSpanIds.add(spanId);
		}
	}

	// 6c. Relations（从 claimRelationBudget 剩余扣，每条约 100 chars）
	let relUsedChars = 0;
	for (const rel of subgraph.relations) {
		const relChars = 100;
		if (usedChars + relUsedChars + relChars > claimRelationBudget) break;
		selectedRelations.push(rel);
		relUsedChars += relChars;
	}
	usedChars += relUsedChars;

	// 6d. 只选引用了当前 Claim 的 WikiModule；Wiki 不能脱离 Canonical Claim 独立进入 Pack。
	for (const module of allWikiModules) {
		if (!module.claimRefs.some((claimId) => existingIds.has(claimId as string))) continue;
		const moduleChars =
			module.coreQuestion.length +
			module.currentUnderstanding.length +
			module.disputes.join(";").length;
		if (usedChars + moduleChars > claimRelationBudget) {
			selectionLog.push({
				selected: "",
				reason: "",
				dropped: module.id,
				dropReason: "预算超限(WikiModule)",
			});
			continue;
		}
		selectedWikiModules.push(module);
		usedChars += moduleChars;
	}

	// ── 7. 回填原文证据（从 evidenceBudget 扣，超限裁剪）──
	let evidenceUsedChars = 0;
	const evidenceSpans: typeof allSpans = [];
	for (const span of findSpansByIds(allSpans, [...selectedSpanIds])) {
		const spanChars = span.text.length + 30; // +30 for blockId 包装
		if (evidenceUsedChars + spanChars > evidenceBudget) {
			selectionLog.push({
				selected: "",
				reason: "",
				dropped: span.id,
				dropReason: "预算超限(Evidence 段)",
			});
			continue;
		}
		evidenceSpans.push(span);
		evidenceUsedChars += spanChars;
	}

	// ── 8. 冲突与条件（从 overheadBudget 扣，超限裁剪）──
	const conflictsAndConditions: string[] = [];
	let overheadUsed = 0;
	const addOverhead = (text: string): boolean => {
		if (overheadUsed + text.length > overheadBudget) return false;
		conflictsAndConditions.push(text);
		overheadUsed += text.length;
		return true;
	};

	for (const claim of subgraph.disputedClaims) {
		if (!addOverhead(`⚠️ Claim ${claim.id} 存在争议: ${claim.statement.slice(0, 80)}`)) break;
	}
	for (const claim of selectedClaims) {
		if (claim.conditions.length > 0) {
			if (!addOverhead(`📌 Claim ${claim.id} 适用条件: ${claim.conditions.join("; ")}`)) break;
		}
	}
	for (const relation of selectedRelations) {
		if (relation.conditions.length > 0) {
			if (
				!addOverhead(
					`📌 Relation ${relation.id} (${relation.type}) 适用条件: ${relation.conditions.join("; ")}`,
				)
			)
				break;
		}
		if (
			relation.conditionStatus === "UNVERIFIED" &&
			!addOverhead(`⚠️ Relation ${relation.id} 条件尚未审计`)
		) {
			break;
		}
	}
	if (selectedRelations.some((relation) => relation.type === "SUPPORTS")) {
		addOverhead(
			"⚠️ SUPPORTS 只表示 Claim 之间存在语义支持，不证明其来源彼此独立、同等权威或都是规范性来源；来源独立性必须依据 Source provenance 单独判断。",
		);
	}
	const evidenceSourceIds = new Set(evidenceSpans.map((span) => span.sourceId));
	for (const source of allSources) {
		if (!evidenceSourceIds.has(source.id)) continue;
		const metadata = source.metadata ?? {};
		const preferredKeys = [
			"sourceRole",
			"author",
			"publisher",
			"canonicalUrl",
			"publishedAt",
			"versionRef",
		];
		const details = preferredKeys
			.flatMap((key) => (metadata[key] ? [`${key}=${metadata[key]}`] : []))
			.join("; ");
		if (
			!addOverhead(
				`🔎 Source ${source.id} provenance: uri=${source.uri}; sourceType=${source.sourceType}; ${details || "role=unknown"}`,
			)
		)
			break;
	}

	// ── 9. 已知缺口（从 overheadBudget 剩余扣）──
	const knownGaps: string[] = [];
	let gapsUsed = 0;
	const remainingOverhead = overheadBudget - overheadUsed;
	for (const claim of subgraph.unresolvedClaims) {
		const gapText = `❓ Claim ${claim.id} 证据未决: ${claim.statement.slice(0, 60)}`;
		if (gapsUsed + gapText.length > remainingOverhead) break;
		knownGaps.push(gapText);
		gapsUsed += gapText.length;
	}
	if (selectedClaims.length === 0) {
		knownGaps.push(
			"Seed Retriever 未找到可靠匹配——知识库可能未覆盖此主题，或相关原文尚未编译为 Canonical Claim",
		);
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

	const availableEvidenceIds = new Set(evidenceSpans.map((span) => span.id));
	const evidenceBackedClaims = selectedClaims.filter((claim) =>
		claim.evidenceSpanIds.every((spanId) => availableEvidenceIds.has(spanId)),
	);
	const evidenceBackedClaimIds = new Set(evidenceBackedClaims.map((claim) => claim.id));
	const evidenceBackedRelations = selectedRelations.filter((relation) =>
		[relation.from as string, relation.to as string].every((id) => evidenceBackedClaimIds.has(id)),
	);
	const evidenceBackedWikiModules = selectedWikiModules.filter((module) =>
		module.claimRefs.some((claimId) => evidenceBackedClaimIds.has(claimId as string)),
	);
	const pack: ContextPack = {
		knowledgeVersion,
		taskMap,
		subgraph: { claims: evidenceBackedClaims, relations: evidenceBackedRelations },
		wikiModules: evidenceBackedWikiModules,
		evidenceSpans,
		conflictsAndConditions,
		selectionLog: selectionLog.slice(0, 50),
		knownGaps,
	};
	const finalPack = enforceContextBudget(pack, budget);
	return {
		pack: finalPack,
		diagnostics: {
			temporalScope: temporalScope.diagnostics,
			retrieval: {
				...retrieval.diagnostics,
				candidates: retrieval.candidates.map((candidate, index) => ({
					claimId: candidate.claim.id,
					rank: index + 1,
					score: candidate.score,
					channels: candidate.channels,
					matchedFeatureCount: candidate.matchedFeatures.length,
				})),
			},
			graph: {
				seedClaimIds: seedIds,
				expandedClaimIds: subgraph.claims.map((claim) => claim.id),
				expandedRelationIds: subgraph.relations.map((relation) => relation.id),
			},
			budget: {
				selectedClaimIds: finalPack.subgraph.claims.map((claim) => claim.id),
				selectedRelationIds: finalPack.subgraph.relations.map((relation) => relation.id),
				selectedEvidenceSpanIds: finalPack.evidenceSpans.map((span) => span.id),
				selectedWikiModuleIds: finalPack.wikiModules.map((module) => module.id),
				dropped: selectionLog
					.filter((entry) => entry.dropped)
					.map((entry) => ({
						id: entry.dropped ?? "unknown",
						reason: entry.dropReason ?? "pack-budget",
					})),
				finalEstimatedTokens: estimateTokens(JSON.stringify(finalPack)),
			},
		},
	};
}

/** Backwards-compatible production API; diagnostics stay outside the Agent payload. */
export function buildContextPack(
	config: AppConfig,
	task: string,
	budget = 12000,
	maxDepth = 3,
	scopeContext?: ScopeContext,
): ContextPack {
	return buildContextPackWithDiagnostics(config, task, budget, maxDepth, scopeContext).pack;
}

/** 最终以真实序列化载荷复核预算；裁剪时保持 Claim→Evidence 和 Relation→Endpoint 闭包。 */
function enforceContextBudget(pack: ContextPack, budget: number): ContextPack {
	if (!Number.isSafeInteger(budget) || budget <= 0)
		throw new Error(`非法 Context budget: ${budget}`);
	const fits = () => estimateTokens(JSON.stringify(pack)) <= budget;
	const refreshDerivedClosure = () => {
		const claimIds = new Set(pack.subgraph.claims.map((claim) => claim.id));
		pack.subgraph.relations = pack.subgraph.relations.filter((relation) =>
			[relation.from as string, relation.to as string].every((id) => claimIds.has(id)),
		);
		pack.wikiModules = pack.wikiModules.filter((module) =>
			module.claimRefs.some((claimId) => claimIds.has(claimId as string)),
		);
		const requiredSpanIds = new Set(pack.subgraph.claims.flatMap((claim) => claim.evidenceSpanIds));
		pack.evidenceSpans = pack.evidenceSpans.filter((span) => requiredSpanIds.has(span.id));
		pack.taskMap = pack.taskMap
			.replace(/找到 \d+ 条相关 Claim/, `找到 ${pack.subgraph.claims.length} 条相关 Claim`)
			.replace(/找到 \d+ 条关系/, `找到 ${pack.subgraph.relations.length} 条关系`)
			.replace(/找到 \d+ 条原文证据/, `找到 ${pack.evidenceSpans.length} 条原文证据`);
	};

	while (!fits() && pack.selectionLog.length > 0) pack.selectionLog.pop();
	while (!fits() && pack.wikiModules.length > 0) pack.wikiModules.pop();
	while (!fits() && pack.subgraph.relations.length > 0) pack.subgraph.relations.pop();
	while (!fits() && pack.subgraph.claims.length > 0) {
		pack.subgraph.claims.pop();
		refreshDerivedClosure();
	}
	while (!fits() && pack.conflictsAndConditions.length > 0) {
		pack.conflictsAndConditions.pop();
	}
	while (!fits() && pack.knownGaps.length > 0) pack.knownGaps.pop();
	if (!fits()) {
		pack.taskMap = `主题: ${pack.taskMap.split("\n")[0]?.replace(/^主题:\s*/, "") ?? "未知"}`;
	}
	if (!fits()) {
		throw new Error(`Context budget=${budget} 过小，连最小合同外壳都无法容纳`);
	}
	return pack;
}
