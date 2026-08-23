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
import { decideGraphActivation } from "../graph/activation.js";
import { buildGraph, inspectRelationGate, walkGraph } from "../graph/index.js";
import { type R1NodeDecision, selectClaimsWithR1 } from "../graph/ranking.js";
import {
	computeKnowledgeVersion,
	findSpansByIds,
	readAllClaims,
	readAllConcepts,
	readAllRelations,
	readAllSources,
	readAllSpans,
	readAllWikiModules,
	resolveSpanById,
} from "../linter/storage.js";
import {
	filterClaimsByExplicitTemporalScope,
	lexicalFeatures,
	retrieveClaimSeeds,
} from "../retrieval/index.js";
import {
	ensurePersistentSeedIndexReady,
	loadPersistentKnowledgeNeighborhood,
	retrieveClaimSeedsFromPersistentIndex,
} from "../retrieval/persistent-index.js";
import type {
	Claim,
	ContextPack,
	Relation,
	ScopeContext,
	SelectionLogEntry,
} from "../types/index.js";
import { inspectWikiModuleSupport } from "../wiki/materialization.js";
import { QUESTION_WIKI_CLAIM_LIMIT } from "../wiki/question-model.js";
import { readAllQuestionFrames } from "../wiki/question-storage.js";
import { retrieveWikiModuleSeeds } from "../wiki/retrieval.js";

const WIKI_PROTECTED_LEXICAL_COUNT = 3;

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
	knowledgeAccess: {
		mode: "LEGACY" | "INDEXED";
		indexVersion: string | null;
		canonicalStateGeneration: string | null;
		lifecycle: "DIRECT" | "REUSED" | "BUILT" | "LEGACY_FALLBACK";
		fallbackReason: string | null;
	};
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
			selected: boolean;
			dropReason: "seed-limit" | "alias-supplement-limit" | null;
		}>;
	};
	graph: {
		selection: {
			mode: ContextSelectionMode;
			lexicalSeedClaimIds: string[];
			primarySelectedClaimIds: string[];
			candidateNodeIds: string[];
			candidateRelationIds: string[];
			removedLexicalSeedIds: string[];
			addedGraphClaimIds: string[];
			decisions: R1NodeDecision[];
		};
		seedClaimIds: string[];
		expandedClaimIds: string[];
		expandedRelationIds: string[];
		activation: ReturnType<typeof decideGraphActivation>;
		traversal: Array<{
			relationId: string;
			fromNodeId: string;
			toNodeId: string;
			depth: number;
			navigationDirection: "forward" | "reverse";
			pathNodeIds: string[];
			pathRelationIds: string[];
			triggerReason: string;
			type: Relation["type"];
			conditions: string[];
			conditionStatus: Relation["conditionStatus"];
			relationAuditVersion: string | null;
			structureScore: null;
			structureScoreReason: "not-computed-in-r0-bfs";
		}>;
		relationGates: Array<{
			relationId: string;
			from: string;
			to: string;
			type: Relation["type"];
			conditions: string[];
			conditionStatus: Relation["conditionStatus"];
			relationAuditVersion: string | null;
			accepted: boolean;
			reason: string;
		}>;
	};
	wiki: {
		supportGates: Array<{
			moduleId: string;
			accepted: boolean;
			reasons: string[];
		}>;
		retrieval: Array<{
			moduleId: string;
			score: number;
			matchedSeedClaimIds: string[];
			matchedClusterIds: string[];
			matchedCoreFeatures: string[];
			matchedAssertionFeatures: string[];
			supportingClaimIds: string[];
		}>;
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

export type ContextSelectionMode = "LEGACY_CONDITIONAL" | "R0" | "R1";

export interface ContextPackBuildOptions {
	/**
	 * LEGACY_CONDITIONAL preserves the Goal 1 production path.
	 * R0 disables online Graph use. R1 uses audited Graph structure to replace,
	 * never append, primary lexical Claim slots.
	 */
	selectionMode?: ContextSelectionMode;
	/** Explicit opt-in while G3-A parity validation is running; legacy remains the default. */
	knowledgeAccess?: "LEGACY" | "INDEXED";
	/** Defaults to config.indexesDir/retrieval-v1. */
	indexRoot?: string;
	/** Paired Wiki ablation for product experiments; MATERIALIZED is the production default. */
	wikiMode?: "DISABLED" | "MATERIALIZED";
}

export interface ManagedContextPackBuildOptions
	extends Omit<ContextPackBuildOptions, "knowledgeAccess"> {
	/** Safe availability fallback: never reads stale index; uses live Canonical state instead. */
	indexFailurePolicy?: "LEGACY_FALLBACK" | "FAIL_CLOSED";
}

const R1_EDGE_WEIGHTS = {
	REQUIRES: 1,
	DERIVED_FROM: 0.8,
	SUPPORTS: 0.8,
	CONTRADICTS: 1,
	SUPERSEDES: 1,
	EQUIVALENT_UNDER: 1,
	RELATED_TO: 0.25,
} as const;

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
		.sort(
			([leftFeature, leftCount], [rightFeature, rightCount]) =>
				rightCount - leftCount || leftFeature.localeCompare(rightFeature),
		)
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
	options: ContextPackBuildOptions = {},
): ContextPackBuildResult {
	const selectionMode = options.selectionMode ?? "LEGACY_CONDITIONAL";
	const knowledgeAccess = options.knowledgeAccess ?? "LEGACY";
	// ── 1. 加载知识状态 ──
	const allConcepts = readAllConcepts(config);
	let allWikiModules = readAllWikiModules(config);
	const allQuestionFrames = readAllQuestionFrames(config);
	let allClaims: Claim[];
	let loadedRelations: Relation[];
	let allRelations: Relation[];
	let allSpans: ReturnType<typeof readAllSpans>;
	let allSources: ReturnType<typeof readAllSources>;
	let knowledgeVersion: string;
	let indexedRetrieval: ReturnType<typeof retrieveClaimSeedsFromPersistentIndex> | null = null;
	if (knowledgeAccess === "INDEXED") {
		const indexRoot = options.indexRoot ?? `${config.indexesDir}/retrieval-v1`;
		indexedRetrieval = retrieveClaimSeedsFromPersistentIndex(indexRoot, task, 10, {
			scopeContext,
		});
		const neighborhood = loadPersistentKnowledgeNeighborhood(
			indexRoot,
			indexedRetrieval.result.candidates.map((candidate) => candidate.claim),
			{
				scopeContext,
				maxRelationDepth: Math.min(maxDepth, 4),
				maxClaims: 120,
				includeEvidenceBlockSiblings: true,
				temporalQuery: task,
			},
		);
		allClaims = uniqueClaims([...indexedRetrieval.matchedClaims, ...neighborhood.claims]);
		loadedRelations = neighborhood.relations;
		allRelations = loadedRelations;
		allSpans = neighborhood.spans;
		allSources = neighborhood.sources.map((source) => ({ ...source, parsedText: "" }));
		knowledgeVersion = indexedRetrieval.diagnostics.knowledgeVersion;
	} else {
		allClaims = readAllClaims(config);
		loadedRelations = readAllRelations(config);
		allRelations = loadedRelations;
		allSpans = readAllSpans(config);
		allSources = readAllSources(config);
		knowledgeVersion = computeKnowledgeVersion(
			allClaims,
			allConcepts,
			allRelations,
			allWikiModules,
			[],
			allQuestionFrames,
		);
	}
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

	// ── 1.5 v1.1：作用域过滤（Global Base + Scoped Overlay）──
	// 缺少 ScopeContext 时按 Global-only 处理，不能"默认全选"
	allClaims = scopeContext
		? filterClaimsByScope(allClaims, scopeContext)
		: allClaims.filter((claim) => claim.scope.type === "GLOBAL");
	const temporalScope = indexedRetrieval
		? { claims: allClaims, diagnostics: indexedRetrieval.diagnostics.temporalScope }
		: filterClaimsByExplicitTemporalScope(allClaims, allSpans, task, sourceSearchText);
	allClaims = temporalScope.claims;
	// Relation 只保留两端 Claim 都在过滤后集合中的边，防止通过边泄露其他作用域。
	const scopedClaimIds = new Set(allClaims.map((claim) => claim.id));
	allRelations = allRelations.filter((relation) =>
		[relation.from as string, relation.to as string].every((id) => scopedClaimIds.has(id)),
	);
	const scopedQuestionFrames = allQuestionFrames.filter((frame) => {
		if (frame.scope.type === "GLOBAL") return true;
		if (!scopeContext) return false;
		if (frame.scope.type === "PERSONAL") return frame.scope.id === scopeContext.principalId;
		return Boolean(scopeContext.projectId) && frame.scope.id === scopeContext.projectId;
	});
	// Wiki support is an authority/grounding check over the complete current scope,
	// not a retrieval decision. Task-temporal and indexed-neighborhood pruning must
	// not make a valid module look as if its Claim/Span/Relation closure disappeared.
	const supportClaims = scopeContext
		? filterClaimsByScope(readAllClaims(config), scopeContext)
		: readAllClaims(config).filter((claim) => claim.scope.type === "GLOBAL");
	const supportClaimIds = new Set(supportClaims.map((claim) => claim.id));
	const supportRelations = readAllRelations(config).filter((relation) =>
		[relation.from as string, relation.to as string].every((id) => supportClaimIds.has(id)),
	);
	const supportSpans = readAllSpans(config);
	const supportSources = readAllSources(config);
	const wikiSupportGates = allWikiModules.map((module) => {
		const decision = inspectWikiModuleSupport(module, supportClaims, supportSpans, {
			relations: supportRelations,
			questionFrames: scopedQuestionFrames,
		});
		return {
			moduleId: module.id,
			accepted: decision.consumable,
			reasons: decision.reasons,
		};
	});
	const supportedWikiIds = new Set(
		wikiSupportGates.filter((decision) => decision.accepted).map((decision) => decision.moduleId),
	);
	allWikiModules = allWikiModules.filter((module) => supportedWikiIds.has(module.id));

	// ── 2. 构建全局地图（修断点 3：map-first）──
	const knowledgeMap = buildKnowledgeMap(allClaims, allConcepts, task);

	// ── 3. 构建 Graph ──
	const graph = buildGraph(allClaims, allConcepts, allRelations);
	const graphRelationIds = new Set(graph.relations.map((relation) => relation.id));
	const scopedRelationIds = new Set(allRelations.map((relation) => relation.id));
	const graphNodeIds = new Set([
		...graph.claims.map((claim) => claim.id),
		...allConcepts.map((concept) => concept.id),
	]);
	const relationGates = loadedRelations.map((relation) => {
		const detail = {
			relationId: relation.id,
			from: relation.from as string,
			to: relation.to as string,
			type: relation.type,
			conditions: relation.conditions,
			conditionStatus: relation.conditionStatus,
			relationAuditVersion: relation.relationAuditVersion,
		};
		if (!scopedRelationIds.has(relation.id)) {
			return { ...detail, accepted: false, reason: "endpoint-out-of-scope" };
		}
		const decision = inspectRelationGate(relation, graphNodeIds);
		return {
			...detail,
			accepted: graphRelationIds.has(relation.id),
			reason: decision.reason,
		};
	});

	// ── 4. 选择可靠种子；Graph 只能在 Seed 之后扩展 ──
	const graphClaimIds = new Set(graph.claims.map((claim) => claim.id));
	const retrieval = indexedRetrieval
		? {
				...indexedRetrieval.result,
				candidates: indexedRetrieval.result.candidates.filter((candidate) =>
					graphClaimIds.has(candidate.claim.id),
				),
			}
		: selectSeeds(graph.claims, allSpans, task, sourceSearchText);
	const lexicalSeedResults = retrieval.candidates.map((candidate) => ({
		claim: candidate.claim,
		score: candidate.score,
		source: `lexical:${candidate.channels.join("+")}`,
	}));
	const lexicalSeedIds = lexicalSeedResults.map((result) => result.claim.id);
	const clusterIdsByClaimId = buildClaimClusterIndex(supportClaims, supportSpans, supportSources);
	const wikiDisabled = options.wikiMode === "DISABLED";
	const directWikiRetrievalCandidates = wikiDisabled
		? []
		: retrieveWikiModuleSeeds(allWikiModules, task, 2, {
				anchorClaimIds: lexicalSeedIds,
				requireAnchor: true,
			});
	const dominantClusterIds = selectDominantSeedClusters(lexicalSeedIds, clusterIdsByClaimId);
	const wikiRetrievalCandidates = wikiDisabled
		? []
		: directWikiRetrievalCandidates.length > 0 || dominantClusterIds.length === 0
			? directWikiRetrievalCandidates
			: retrieveWikiModuleSeeds(allWikiModules, task, 2, {
					anchorClaimIds: lexicalSeedIds,
					anchorClusterIds: dominantClusterIds,
					clusterIdsByClaimId,
					allowClusterFallback: true,
					requireAnchor: true,
				});
	const r1Selection =
		selectionMode === "R1" && lexicalSeedIds.length > 0
			? selectClaimsWithR1(
					graph.claims.map((claim) => {
						const lexicalIndex = lexicalSeedIds.indexOf(claim.id);
						return {
							id: claim.id,
							lexicalScore: lexicalIndex >= 0 ? (lexicalSeedResults[lexicalIndex]?.score ?? 0) : 0,
							lexicalRank: lexicalIndex >= 0 ? lexicalIndex + 1 : null,
						};
					}),
					graph.relations.map((relation) => ({
						id: relation.id,
						from: relation.from as string,
						to: relation.to as string,
						type: relation.type,
					})),
					lexicalSeedIds,
					{
						protectedLexicalSeeds: 3,
						maxCandidateNodes: 40,
						maxDepth: Math.min(maxDepth, 2),
						restartAlpha: 0.25,
						iterations: 25,
						selectedClaimLimit: lexicalSeedIds.length,
						edgeWeights: R1_EDGE_WEIGHTS,
					},
				)
			: null;
	const graphPrimarySeedResults = r1Selection
		? r1Selection.selectedClaimIds.flatMap((claimId) => {
				const claim = graph.claims.find((candidate) => candidate.id === claimId);
				const lexical = lexicalSeedResults.find((candidate) => candidate.claim.id === claimId);
				const decision = r1Selection.decisions.find((candidate) => candidate.id === claimId);
				if (!claim || !decision) return [];
				return [
					{
						claim,
						score: lexical?.score ?? decision.graphScore,
						source: lexical?.source ?? `r1-graph:${decision.reason}`,
					},
				];
			})
		: lexicalSeedResults;
	const wikiInjection = injectWikiSupportingClaims(
		graphPrimarySeedResults,
		wikiRetrievalCandidates,
		supportClaims,
		QUESTION_WIKI_CLAIM_LIMIT + WIKI_PROTECTED_LEXICAL_COUNT,
		WIKI_PROTECTED_LEXICAL_COUNT,
	);
	const primarySeedResults = wikiInjection.results;
	// Claims extracted from the same source block are a bounded, evidence-local
	// neighborhood. Completing that neighborhood is safer than guessing a semantic
	// edge and prevents Top-K from splitting a list, table row group, or quoted clause.
	const lexicalCoEvidenceResults = selectCoEvidenceNeighbors(
		lexicalSeedResults,
		allClaims,
		allSpans,
		8,
	);
	// R1 may replace primary Claim slots, but it cannot manufacture extra
	// co-evidence capacity. The R0 neighborhood count is the paired ceiling.
	const coEvidenceResults = r1Selection
		? selectCoEvidenceNeighbors(
				primarySeedResults,
				allClaims,
				allSpans,
				lexicalCoEvidenceResults.length,
			)
		: lexicalCoEvidenceResults;
	const seedResults = [
		...new Map(
			[...primarySeedResults, ...coEvidenceResults].map((result) => [result.claim.id, result]),
		).values(),
	];
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
	for (const decision of wikiSupportGates.filter((item) => !item.accepted)) {
		selectionLog.push({
			selected: "",
			reason: "",
			dropped: decision.moduleId,
			dropReason: `Wiki 支撑门禁: ${decision.reasons.join(",")}`,
		});
	}
	for (const rejection of wikiInjection.rejections) {
		selectionLog.push({
			selected: "",
			reason: "",
			dropped: rejection.moduleId,
			dropReason: `WikiModule 原子注入拒绝: ${rejection.reason}`,
		});
	}
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
	const effectiveDepth = selectionMode === "R0" ? 0 : maxDepth;
	const subgraph = walkGraph(graph, seedIds, effectiveDepth, allowedTypes);
	// Goal 2 isolates Graph's ranking value. R1 relations remain auditable internal
	// paths; they do not consume Agent-visible Prompt slots in this experiment.
	const activationRelations = selectionMode === "R1" ? [] : subgraph.relations;
	const activation = decideGraphActivation({
		task,
		requestedDepth: effectiveDepth,
		contextBudgetTokens: budget,
		seedClaimCount: seedIds.length,
		candidates: activationRelations.map((relation) => {
			const traversal = subgraph.traversalTrace.find((step) => step.relationId === relation.id);
			return {
				relationId: relation.id,
				type: relation.type,
				depth: traversal?.depth ?? effectiveDepth,
				touchesSeed: [relation.from as string, relation.to as string].some((id) =>
					seedIds.includes(id),
				),
				bothEndpointsSeed: [relation.from as string, relation.to as string].every((id) =>
					seedIds.includes(id),
				),
				conditions: relation.conditions,
				estimatedMarginalTokens: estimateGraphUnitTokens(
					relation,
					subgraph.claims,
					allSpans,
					new Set(seedIds),
				),
			};
		}),
	});
	const visibleRelationIds = new Set(activation.visibleRelationIds);
	const visibleGraphRelations = subgraph.relations.filter((relation) =>
		visibleRelationIds.has(relation.id),
	);
	const visibleGraphClaimIds = new Set([
		...seedIds,
		...visibleGraphRelations.flatMap((relation) => [
			relation.from as string,
			relation.to as string,
		]),
	]);
	const visibleGraphClaims = subgraph.claims.filter((claim) => visibleGraphClaimIds.has(claim.id));
	const visibleGraphDisputedClaims = subgraph.disputedClaims.filter((claim) =>
		visibleGraphClaimIds.has(claim.id),
	);
	const visibleGraphUnresolvedClaims = subgraph.unresolvedClaims.filter((claim) =>
		visibleGraphClaimIds.has(claim.id),
	);

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
	const wikiReservationChars = wikiRetrievalCandidates.reduce(
		(total, candidate) =>
			total +
			candidate.module.coreQuestion.length +
			candidate.module.currentUnderstanding.length +
			candidate.module.disputes.join(";").length,
		0,
	);
	const claimSelectionBudget = Math.max(0, claimRelationBudget - wikiReservationChars);

	// 6a. 选 Claim（从 claimRelationBudget 扣）
	for (const r of seedResults) {
		const claimChars = r.claim.statement.length;
		if (usedChars + claimChars > claimSelectionBudget) {
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
	for (let index = 0; index < visibleGraphClaims.length; index++) {
		const claim = visibleGraphClaims[index];
		if (!claim) continue;
		if (existingIds.has(claim.id)) continue;
		const claimChars = claim.statement.length;
		if (usedChars + claimChars > claimSelectionBudget) {
			for (const remaining of visibleGraphClaims.slice(index)) {
				if (existingIds.has(remaining.id)) continue;
				selectionLog.push({
					selected: "",
					reason: "",
					dropped: remaining.id,
					dropReason: "预算截止(Graph Claim 排序后缀)",
				});
			}
			break;
		}
		selectedClaims.push(claim);
		existingIds.add(claim.id);
		usedChars += claimChars;
		for (const spanId of claim.evidenceSpanIds) {
			selectedSpanIds.add(spanId);
		}
	}

	// 6c. Relations（从 claimRelationBudget 剩余扣，每条约 100 chars）
	let relUsedChars = 0;
	for (let index = 0; index < visibleGraphRelations.length; index++) {
		const rel = visibleGraphRelations[index];
		if (!rel) continue;
		const relChars = 100;
		if (usedChars + relUsedChars + relChars > claimSelectionBudget) {
			for (const remaining of visibleGraphRelations.slice(index)) {
				selectionLog.push({
					selected: "",
					reason: "",
					dropped: remaining.id,
					dropReason: "预算截止(Relation 排序后缀)",
				});
			}
			break;
		}
		selectedRelations.push(rel);
		relUsedChars += relChars;
	}
	usedChars += relUsedChars;

	// 6d. Wiki 是整个物化单元：全部引用必须已进入 Pack，不能只带部分支撑却展示整段文本。
	for (const { module } of wikiRetrievalCandidates) {
		const missingSupportingClaimIds = module.claimRefs
			.map(String)
			.filter((claimId) => !existingIds.has(claimId));
		if (missingSupportingClaimIds.length > 0) {
			selectionLog.push({
				selected: "",
				reason: "",
				dropped: module.id,
				dropReason: `WikiModule 支撑 Claim 未全部进入候选集: ${missingSupportingClaimIds.join(",")}`,
			});
			continue;
		}
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
	// A WikiModule is an atomic supported view, so its Claim evidence must be
	// considered before ordinary retrieval evidence. The 25% evidence share is a
	// soft allocation for ordinary Claims; a Wiki closure may borrow from the
	// remaining pack budget and the final serialized-budget pass will trim optional
	// Claims first or reject the whole module if the closed unit still cannot fit.
	const selectedClaimById = new Map(selectedClaims.map((claim) => [claim.id, claim]));
	const wikiEvidenceSpanIds = new Set(
		selectedWikiModules.flatMap((module) =>
			module.claimRefs.flatMap(
				(claimId) => selectedClaimById.get(String(claimId))?.evidenceSpanIds ?? [],
			),
		),
	);
	const orderedSpanIds = [
		...wikiEvidenceSpanIds,
		...[...selectedSpanIds].filter((spanId) => !wikiEvidenceSpanIds.has(spanId)),
	];
	for (const span of findSpansByIds(supportSpans, orderedSpanIds)) {
		const spanChars = span.text.length + 30; // +30 for blockId 包装
		if (!wikiEvidenceSpanIds.has(span.id) && evidenceUsedChars + spanChars > evidenceBudget) {
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

	for (const claim of visibleGraphDisputedClaims) {
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
	for (const source of supportSources) {
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
	for (const { module, gap } of selectedWikiModules.flatMap((module) =>
		(module.knownGaps ?? []).map((gap) => ({ module, gap })),
	)) {
		const gapText = `❓ Wiki ${module.questionRef ?? module.id} ${gap.kind} 缺口: ${gap.description}`;
		if (gapsUsed + gapText.length > remainingOverhead) break;
		knownGaps.push(gapText);
		gapsUsed += gapText.length;
	}
	for (const claim of visibleGraphUnresolvedClaims) {
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
		knownGaps.push("未选择可见关系——当前任务不需要关系路径，或没有通过门禁的可消费边");
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
		`找到 ${selectedWikiModules.length} 个长期问题 WikiModule`,
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
		module.claimRefs.every((claimId) => evidenceBackedClaimIds.has(claimId as string)),
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
	const finalClaimIds = new Set(finalPack.subgraph.claims.map((claim) => claim.id));
	const finalRelationIds = new Set(finalPack.subgraph.relations.map((relation) => relation.id));
	const finalEvidenceIds = new Set(finalPack.evidenceSpans.map((span) => span.id));
	const finalWikiModuleIds = new Set(finalPack.wikiModules.map((module) => module.id));
	const explicitDrops = selectionLog
		.filter((entry) => entry.dropped)
		.map((entry) => ({
			id: entry.dropped ?? "unknown",
			reason: entry.dropReason ?? "pack-budget",
		}));
	const explicitDropIds = new Set(explicitDrops.map((entry) => entry.id));
	const activationDrops = activation.decisions
		.filter((decision) => !decision.visible)
		.map((decision) => ({
			id: decision.relationId,
			reason: `graph-visible-gate:${decision.dropReason ?? "not-selected"}`,
		}));
	for (const drop of activationDrops) explicitDropIds.add(drop.id);
	const inferredDrops = [
		...[...new Set([...seedIds, ...visibleGraphClaims.map((claim) => claim.id)])]
			.filter((id) => !finalClaimIds.has(id) && !explicitDropIds.has(id))
			.map((id) => ({ id, reason: "pack-final-budget-or-evidence-closure" })),
		...visibleGraphRelations
			.map((relation) => relation.id)
			.filter((id) => !finalRelationIds.has(id) && !explicitDropIds.has(id))
			.map((id) => ({ id, reason: "pack-final-budget-or-endpoint-closure" })),
		...[...selectedSpanIds]
			.filter((id) => !finalEvidenceIds.has(id) && !explicitDropIds.has(id))
			.map((id) => ({ id, reason: "pack-evidence-budget-or-closure" })),
		...selectedWikiModules
			.map((module) => module.id)
			.filter((id) => !finalWikiModuleIds.has(id) && !explicitDropIds.has(id))
			.map((id) => ({ id, reason: "pack-final-budget-or-evidence-closure" })),
	];
	return {
		pack: finalPack,
		diagnostics: {
			knowledgeAccess: {
				mode: knowledgeAccess,
				indexVersion: indexedRetrieval?.diagnostics.indexVersion ?? null,
				canonicalStateGeneration: indexedRetrieval?.diagnostics.canonicalStateGeneration ?? null,
				lifecycle: "DIRECT",
				fallbackReason: null,
			},
			temporalScope: temporalScope.diagnostics,
			retrieval: {
				...retrieval.diagnostics,
				candidates: retrieval.traceCandidates.map((candidate) => ({
					claimId: candidate.claimId,
					rank: candidate.rank,
					score: candidate.score,
					channels: candidate.channels,
					matchedFeatureCount: candidate.matchedFeatures.length,
					selected: candidate.selected,
					dropReason: candidate.dropReason,
				})),
			},
			graph: {
				selection: {
					mode: selectionMode,
					lexicalSeedClaimIds: lexicalSeedIds,
					primarySelectedClaimIds: primarySeedResults.map((result) => result.claim.id),
					candidateNodeIds: r1Selection?.candidateNodeIds ?? lexicalSeedIds,
					candidateRelationIds: r1Selection?.candidateRelationIds ?? [],
					removedLexicalSeedIds: r1Selection?.removedLexicalSeedIds ?? [],
					addedGraphClaimIds: r1Selection?.addedGraphClaimIds ?? [],
					decisions: r1Selection?.decisions ?? [],
				},
				seedClaimIds: seedIds,
				expandedClaimIds: subgraph.claims.map((claim) => claim.id),
				expandedRelationIds: subgraph.relations.map((relation) => relation.id),
				activation,
				traversal: subgraph.traversalTrace.flatMap((step) => {
					const relation = subgraph.relations.find((item) => item.id === step.relationId);
					if (!relation) return [];
					return [
						{
							...step,
							type: relation.type,
							conditions: relation.conditions,
							conditionStatus: relation.conditionStatus,
							relationAuditVersion: relation.relationAuditVersion,
							structureScore: null,
							structureScoreReason: "not-computed-in-r0-bfs" as const,
						},
					];
				}),
				relationGates,
			},
			wiki: {
				supportGates: wikiSupportGates,
				retrieval: wikiRetrievalCandidates.map((candidate) => ({
					moduleId: candidate.module.id,
					score: candidate.score,
					matchedSeedClaimIds: candidate.matchedSeedClaimIds,
					matchedClusterIds: candidate.matchedClusterIds,
					matchedCoreFeatures: candidate.matchedCoreFeatures,
					matchedAssertionFeatures: candidate.matchedAssertionFeatures,
					supportingClaimIds: candidate.module.claimRefs.map(String),
				})),
			},
			budget: {
				selectedClaimIds: finalPack.subgraph.claims.map((claim) => claim.id),
				selectedRelationIds: finalPack.subgraph.relations.map((relation) => relation.id),
				selectedEvidenceSpanIds: finalPack.evidenceSpans.map((span) => span.id),
				selectedWikiModuleIds: finalPack.wikiModules.map((module) => module.id),
				dropped: [...activationDrops, ...explicitDrops, ...inferredDrops],
				finalEstimatedTokens: estimateTokens(JSON.stringify(finalPack)),
			},
		},
	};
}

export function selectDominantSeedClusters(
	seedClaimIds: string[],
	clusterIdsByClaimId: ReadonlyMap<string, ReadonlySet<string>>,
	minimumSupport = 2,
	minimumShare = 0.6,
): string[] {
	const counts = new Map<string, number>();
	let clusteredSeeds = 0;
	for (const claimId of seedClaimIds) {
		const clusters = clusterIdsByClaimId.get(claimId);
		if (!clusters || clusters.size === 0) continue;
		clusteredSeeds++;
		for (const clusterId of clusters) counts.set(clusterId, (counts.get(clusterId) ?? 0) + 1);
	}
	const strongest = Math.max(0, ...counts.values());
	if (
		strongest < minimumSupport ||
		clusteredSeeds === 0 ||
		strongest / clusteredSeeds < minimumShare
	) {
		return [];
	}
	return [...counts.entries()]
		.filter(([, count]) => count === strongest)
		.map(([clusterId]) => clusterId)
		.sort();
}

function buildClaimClusterIndex(
	claims: Claim[],
	spans: ReturnType<typeof readAllSpans>,
	sources: ReturnType<typeof readAllSources>,
): Map<string, ReadonlySet<string>> {
	const clusterBySourceId = new Map(
		sources.flatMap((source) => {
			const clusterId = source.metadata?.clusterId;
			return typeof clusterId === "string" && clusterId.trim()
				? [[source.id, clusterId.trim()] as const]
				: [];
		}),
	);
	return new Map(
		claims.map((claim) => {
			const clusters = new Set(
				claim.evidenceSpanIds.flatMap((spanId) => {
					const span = resolveSpanById(spans, spanId);
					const clusterId = span ? clusterBySourceId.get(span.sourceId) : undefined;
					return clusterId ? [clusterId] : [];
				}),
			);
			return [claim.id, clusters] as const;
		}),
	);
}

function selectCoEvidenceNeighbors(
	seedResults: Array<{ claim: Claim; score: number; source: string }>,
	claims: Claim[],
	spans: ReturnType<typeof readAllSpans>,
	limit: number,
): Array<{ claim: Claim; score: number; source: string }> {
	const selectedIds = new Set(seedResults.map((result) => result.claim.id));
	const seedByBlock = new Map<string, { claim: Claim; score: number; source: string }>();
	for (const seed of seedResults) {
		for (const spanId of seed.claim.evidenceSpanIds) {
			const span = resolveSpanById(spans, spanId);
			if (!span) continue;
			const key = `${span.sourceId}\u0000${span.blockId}`;
			const current = seedByBlock.get(key);
			if (!current || seed.score > current.score) seedByBlock.set(key, seed);
		}
	}
	return claims
		.flatMap((claim) => {
			if (selectedIds.has(claim.id)) return [];
			const parents = claim.evidenceSpanIds.flatMap((spanId) => {
				const span = resolveSpanById(spans, spanId);
				if (!span) return [];
				const parent = seedByBlock.get(`${span.sourceId}\u0000${span.blockId}`);
				return parent ? [parent] : [];
			});
			if (parents.length === 0) return [];
			const parent = parents.sort((left, right) => right.score - left.score)[0];
			if (!parent) return [];
			return [
				{
					claim,
					score: parent.score,
					source: `co-evidence:${parent.claim.id}`,
				},
			];
		})
		.sort((left, right) => right.score - left.score || left.claim.id.localeCompare(right.claim.id))
		.slice(0, limit);
}

function uniqueClaims(claims: Claim[]): Claim[] {
	const byId = new Map<string, Claim>();
	for (const claim of claims) byId.set(claim.id, claim);
	return [...byId.values()];
}

/**
 * Wiki does not append an unbounded second context stream. Its supporting Claims occupy the same
 * fixed primary slots and replace only weak, unprotected lexical candidates.
 */
export function injectWikiSupportingClaims(
	base: Array<{ claim: Claim; score: number; source: string }>,
	candidates: ReturnType<typeof retrieveWikiModuleSeeds>,
	claims: Claim[],
	limit: number,
	protectedLexicalCount: number,
): {
	results: Array<{ claim: Claim; score: number; source: string }>;
	rejections: Array<{ moduleId: string; reason: string }>;
} {
	const result = base.slice(0, limit);
	const rejections: Array<{ moduleId: string; reason: string }> = [];
	const claimById = new Map(claims.map((claim) => [claim.id, claim]));
	const protectedIds = new Set(
		base.slice(0, protectedLexicalCount).map((candidate) => candidate.claim.id),
	);
	const wikiInsertedIds = new Set<string>();
	for (const candidate of candidates) {
		const refs = candidate.module.claimRefs.map(String);
		const missingClaims = refs.filter((ref) => !claimById.has(ref));
		if (missingClaims.length > 0) {
			rejections.push({
				moduleId: candidate.module.id,
				reason: `missing-claims:${missingClaims.join(",")}`,
			});
			continue;
		}
		const missingRefs = refs.filter((ref) => !result.some((entry) => entry.claim.id === ref));
		const removableIndexes = result.flatMap((entry, index) =>
			!protectedIds.has(entry.claim.id) && !wikiInsertedIds.has(entry.claim.id) ? [index] : [],
		);
		const freeSlots = Math.max(0, limit - result.length);
		if (missingRefs.length > freeSlots + removableIndexes.length) {
			rejections.push({
				moduleId: candidate.module.id,
				reason: `insufficient-primary-slots:required=${missingRefs.length},available=${freeSlots + removableIndexes.length}`,
			});
			continue;
		}
		for (const ref of refs) {
			if (result.some((entry) => entry.claim.id === ref)) continue;
			const claim = claimById.get(ref);
			if (!claim) throw new Error(`Wiki 原子注入前置检查失效: ${candidate.module.id} -> ${ref}`);
			if (result.length >= limit) {
				let removableIndex = -1;
				for (let index = result.length - 1; index >= 0; index -= 1) {
					const entry = result[index];
					if (entry && !protectedIds.has(entry.claim.id) && !wikiInsertedIds.has(entry.claim.id)) {
						removableIndex = index;
						break;
					}
				}
				if (removableIndex < 0) continue;
				result.splice(removableIndex, 1);
			}
			result.push({ claim, score: candidate.score, source: `wiki:${candidate.module.id}` });
			wikiInsertedIds.add(claim.id);
		}
		// Once a higher-ranked module is accepted, its complete closure owns those
		// slots. A later module may share them, but may not evict an assertion that
		// happened to originate from the base lexical result rather than this loop.
		for (const ref of refs) wikiInsertedIds.add(ref);
	}
	return { results: result, rejections };
}

/** Estimate the closed marginal unit, not merely the Relation label. */
function estimateGraphUnitTokens(
	relation: Relation,
	claims: Claim[],
	spans: ReturnType<typeof readAllSpans>,
	seedClaimIds: ReadonlySet<string>,
): number {
	const endpointIds = [relation.from as string, relation.to as string];
	const addedClaims = claims.filter(
		(claim) => endpointIds.includes(claim.id) && !seedClaimIds.has(claim.id),
	);
	const evidenceIds = new Set([
		...relation.evidenceSpanIds,
		...addedClaims.flatMap((claim) => claim.evidenceSpanIds),
	]);
	const evidence = [...evidenceIds].flatMap((spanId) => {
		const span = resolveSpanById(spans, spanId);
		return span ? [{ id: span.id, text: span.text }] : [];
	});
	return Math.max(1, estimateTokens(JSON.stringify({ relation, addedClaims, evidence })));
}

/** Backwards-compatible production API; diagnostics stay outside the Agent payload. */
export function buildContextPack(
	config: AppConfig,
	task: string,
	budget = 12000,
	maxDepth = 3,
	scopeContext?: ScopeContext,
	options: ContextPackBuildOptions = {},
): ContextPack {
	return buildContextPackWithDiagnostics(config, task, budget, maxDepth, scopeContext, options)
		.pack;
}

/**
 * Production orchestration for the persistent read path.
 *
 * A valid generation-matched index is reused in O(1) metadata reads. Missing,
 * stale or old-schema indexes are synchronously rebuilt. If rebuilding fails,
 * callers may explicitly use live Canonical legacy reads; stale index data is
 * never consumed and the fallback is recorded in diagnostics.
 */
export function buildManagedContextPackWithDiagnostics(
	config: AppConfig,
	task: string,
	budget = 12000,
	maxDepth = 3,
	scopeContext?: ScopeContext,
	options: ManagedContextPackBuildOptions = {},
): ContextPackBuildResult {
	const indexRoot = options.indexRoot ?? `${config.indexesDir}/retrieval-v1`;
	const failurePolicy = options.indexFailurePolicy ?? "LEGACY_FALLBACK";
	try {
		const ready = ensurePersistentSeedIndexReady(config, indexRoot);
		const result = buildContextPackWithDiagnostics(config, task, budget, maxDepth, scopeContext, {
			selectionMode: options.selectionMode,
			knowledgeAccess: "INDEXED",
			indexRoot,
			wikiMode: options.wikiMode,
		});
		result.diagnostics.knowledgeAccess.lifecycle = ready.status;
		return result;
	} catch (error) {
		if (failurePolicy === "FAIL_CLOSED") throw error;
		const result = buildContextPackWithDiagnostics(config, task, budget, maxDepth, scopeContext, {
			selectionMode: options.selectionMode,
			knowledgeAccess: "LEGACY",
			wikiMode: options.wikiMode,
		});
		result.diagnostics.knowledgeAccess.lifecycle = "LEGACY_FALLBACK";
		result.diagnostics.knowledgeAccess.fallbackReason = errorMessage(error);
		return result;
	}
}

/** Production convenience API using managed persistent access. */
export function buildManagedContextPack(
	config: AppConfig,
	task: string,
	budget = 12000,
	maxDepth = 3,
	scopeContext?: ScopeContext,
	options: ManagedContextPackBuildOptions = {},
): ContextPack {
	return buildManagedContextPackWithDiagnostics(
		config,
		task,
		budget,
		maxDepth,
		scopeContext,
		options,
	).pack;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** 最终以真实序列化载荷复核预算；裁剪时保持 Claim→Evidence 和 Relation→Endpoint 闭包。 */
function enforceContextBudget(pack: ContextPack, budget: number): ContextPack {
	if (!Number.isSafeInteger(budget) || budget <= 0)
		throw new Error(`非法 Context budget: ${budget}`);
	const noVisibleRelationGap = "未选择可见关系——当前任务不需要关系路径，或没有通过门禁的可消费边";
	const fits = () => estimateTokens(JSON.stringify(pack)) <= budget;
	const refreshDerivedClosure = () => {
		const claimIds = new Set(pack.subgraph.claims.map((claim) => claim.id));
		pack.subgraph.relations = pack.subgraph.relations.filter((relation) =>
			[relation.from as string, relation.to as string].every((id) => claimIds.has(id)),
		);
		const relationIds = new Set(pack.subgraph.relations.map((relation) => relation.id));
		pack.wikiModules = pack.wikiModules.filter((module) =>
			module.claimRefs.every((claimId) => claimIds.has(claimId as string)),
		);
		const requiredSpanIds = new Set(pack.subgraph.claims.flatMap((claim) => claim.evidenceSpanIds));
		pack.evidenceSpans = pack.evidenceSpans.filter((span) => requiredSpanIds.has(span.id));
		const sourceIds = new Set(pack.evidenceSpans.map((span) => span.sourceId));
		const hasSupports = pack.subgraph.relations.some((relation) => relation.type === "SUPPORTS");
		pack.conflictsAndConditions = pack.conflictsAndConditions.filter((entry) => {
			const claimId = /^(?:⚠️|📌) Claim (\S+)/u.exec(entry)?.[1];
			if (claimId) return claimIds.has(claimId);
			const relationId = /^(?:⚠️|📌) Relation (\S+)/u.exec(entry)?.[1];
			if (relationId) return relationIds.has(relationId);
			const sourceId = /^🔎 Source (\S+)/u.exec(entry)?.[1];
			if (sourceId) return sourceIds.has(sourceId);
			if (entry.includes("SUPPORTS 只表示 Claim")) return hasSupports;
			return true;
		});
		pack.knownGaps = pack.knownGaps.filter((entry) => entry !== noVisibleRelationGap);
		if (pack.subgraph.relations.length === 0) pack.knownGaps.push(noVisibleRelationGap);
		pack.taskMap = pack.taskMap
			.replace(/找到 \d+ 条相关 Claim/, `找到 ${pack.subgraph.claims.length} 条相关 Claim`)
			.replace(/找到 \d+ 条关系/, `找到 ${pack.subgraph.relations.length} 条关系`)
			.replace(
				/找到 \d+ 个长期问题 WikiModule/,
				`找到 ${pack.wikiModules.length} 个长期问题 WikiModule`,
			)
			.replace(/找到 \d+ 条原文证据/, `找到 ${pack.evidenceSpans.length} 条原文证据`);
	};
	const trimOptionalClaims = () => {
		while (!fits() && pack.subgraph.claims.length > 0) {
			const wikiClaimIds = new Set(
				pack.wikiModules.flatMap((module) => module.claimRefs.map(String)),
			);
			let removableIndex = -1;
			for (let index = pack.subgraph.claims.length - 1; index >= 0; index -= 1) {
				const claim = pack.subgraph.claims[index];
				if (claim && !wikiClaimIds.has(claim.id)) {
					removableIndex = index;
					break;
				}
			}
			if (removableIndex < 0) break;
			pack.subgraph.claims.splice(removableIndex, 1);
			refreshDerivedClosure();
		}
	};

	while (!fits() && pack.selectionLog.length > 0) pack.selectionLog.pop();
	while (!fits() && pack.subgraph.relations.length > 0) {
		pack.subgraph.relations.pop();
		refreshDerivedClosure();
	}
	// An activated Wiki view is useful only together with every supporting Claim. Trim optional
	// Claim slots first; otherwise the final serializer would silently undo Wiki activation.
	trimOptionalClaims();
	while (!fits() && pack.wikiModules.length > 0) {
		pack.wikiModules.pop();
		refreshDerivedClosure();
		// Claims that were protected only by the rejected lower-ranked module are
		// optional again. Reclaim them before considering rejection of the next Wiki.
		trimOptionalClaims();
	}
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
