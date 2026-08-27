/**
 * Goal 3-B2：基于既有 v7 持久化词法索引的只读 source-routing 选择器。
 *
 * 纯选择器：不接触存储、不读 Claim/span/source 文件，不构造图边、不返回
 * Relation、不引用任何 domain 术语。持久化层负责词法检索、scope/temporal
 * 可见性过滤与 evidence→source 解析（含 child-span 语义），把已解析的
 * routing pool 交给本模块做确定性选择。
 *
 * 固定预算（契约 goal3-source-routing-contract-v1.json）：
 * routingPoolBudget 默认/上限 120；sourceBudget 默认/上限 12；
 * candidateBudget 默认/上限 40。任何传入值都被 clamp 到 [0, 上限]，
 * 因此 alias 补充等上游膨胀永远不会让 routing pool 超过预算。
 */

export const ROUTING_POOL_BUDGET_DEFAULT = 120;
export const ROUTING_POOL_BUDGET_MAX = 120;
export const SOURCE_BUDGET_DEFAULT = 12;
export const SOURCE_BUDGET_MAX = 12;
export const CANDIDATE_BUDGET_DEFAULT = 40;
export const CANDIDATE_BUDGET_MAX = 40;

export interface SourceRoutingOptions {
	routingPoolBudget?: number;
	sourceBudget?: number;
	candidateBudget?: number;
}

export interface SourceRoutingBudget {
	routingPoolBudget: number;
	sourceBudget: number;
	candidateBudget: number;
}

/** 契约固定预算 clamp：缺省取默认值，超上限取上限，负值取 0。 */
export function clampSourceRoutingOptions(options: SourceRoutingOptions = {}): SourceRoutingBudget {
	const routingPoolBudget = clampBudget(
		options.routingPoolBudget,
		ROUTING_POOL_BUDGET_DEFAULT,
		ROUTING_POOL_BUDGET_MAX,
	);
	const sourceBudget = clampBudget(options.sourceBudget, SOURCE_BUDGET_DEFAULT, SOURCE_BUDGET_MAX);
	const candidateBudget = clampBudget(
		options.candidateBudget,
		CANDIDATE_BUDGET_DEFAULT,
		CANDIDATE_BUDGET_MAX,
	);
	return { routingPoolBudget, sourceBudget, candidateBudget };
}

export interface SourceRoutingPoolClaim {
	claimId: string;
	/** 该 Claim 在现有确定性词法顺序中的 1-based 排位（含未解析 evidence 的排位）。 */
	lexicalRank: number;
	/** 为这个 Claim 解析出的去重 evidence Source ID 列表；一个 Claim 可映射到多个 sources。 */
	sourceIds: string[];
}

export interface RoutedSource {
	sourceId: string;
	/** 该 source 任何 Claim 出现的最早词法排位。 */
	firstLexicalRank: number;
	/** 路由到该 source 的 Claim ID 列表，按 routing-pool 词法顺序。 */
	claimIds: string[];
}

export interface SourceRoutingCandidate {
	claimId: string;
	lexicalRank: number;
	/** 该 Claim 映射到的 selected sources，按 source 选择顺序。 */
	sourceIds: string[];
	/** 是否为某个 selected source 的最高排位 Claim（阶段 1 保证项）。 */
	guaranteed: boolean;
}

export interface SourceRoutingDiagnostics {
	routingPoolSize: number;
	discoveredSourceCount: number;
	selectedSourceCount: number;
	candidateCount: number;
}

export interface SourceRoutingSelection {
	/** 有序候选；仅来自 selected sources，且绝不超过 candidateBudget。 */
	candidates: SourceRoutingCandidate[];
	/** 全部 discovered sources，按 firstLexicalRank 升序、sourceId 字典序。 */
	sources: RoutedSource[];
	/** selected source ID，按选择顺序。 */
	selectedSourceIds: string[];
	diagnostics: SourceRoutingDiagnostics;
}

function clampBudget(value: number | undefined, fallback: number, maximum: number): number {
	if (value === undefined) return fallback;
	if (!Number.isFinite(value)) return value === Number.POSITIVE_INFINITY ? maximum : 0;
	return Math.max(0, Math.min(Math.floor(value), maximum));
}

/**
 * 确定性 source-routing 选择（纯函数）。
 *
 * 阶段 0：routing pool 截断到 routingPoolBudget（上游 alias 补充不会超限）。
 * 阶段 1：按最早词法排位 + sourceId 字典序排序 discovered sources，选前
 * sourceBudget 个；保证每个 selected source 的最高排位 Claim（跨 source 去重）。
 * 阶段 2：按 routing pool 原始词法顺序，仅取属于 selected sources 的 Claim
 * 填充剩余名额，直到 candidateBudget。任何情况下候选数不超过 candidateBudget。
 */
export function selectSourceRoutedCandidates(
	pool: readonly SourceRoutingPoolClaim[],
	options: SourceRoutingOptions = {},
): SourceRoutingSelection {
	const { routingPoolBudget, sourceBudget, candidateBudget } = clampSourceRoutingOptions(options);
	const boundedPool = pool.slice(0, routingPoolBudget);
	const sourceIdsByClaim = new Map(
		boundedPool.map((item) => [item.claimId, item.sourceIds] as const),
	);
	const bySource = new Map<string, { firstLexicalRank: number; claimIds: string[] }>();
	for (const item of boundedPool) {
		const seen = new Set<string>();
		for (const sourceId of item.sourceIds) {
			if (seen.has(sourceId)) continue;
			seen.add(sourceId);
			const record = bySource.get(sourceId);
			if (record) {
				record.claimIds.push(item.claimId);
			} else {
				bySource.set(sourceId, { firstLexicalRank: item.lexicalRank, claimIds: [item.claimId] });
			}
		}
	}
	const sources = [...bySource.entries()]
		.map(
			([sourceId, record]): RoutedSource => ({
				sourceId,
				firstLexicalRank: record.firstLexicalRank,
				claimIds: record.claimIds,
			}),
		)
		.sort(
			(left, right) =>
				left.firstLexicalRank - right.firstLexicalRank ||
				left.sourceId.localeCompare(right.sourceId),
		);
	// 每个 selected source 都必须能在阶段 1 获得一个代表 Claim；当调用方
	// 给出的 candidateBudget 小于 sourceBudget 时，不能把无法表示的来源
	// 标成 selected。固定合同为 12 <= 40，这里同时守住通用 API 不变量。
	const selectedSources = sources.slice(0, Math.min(sourceBudget, candidateBudget));
	const selectedSourceIds = selectedSources.map((source) => source.sourceId);
	const chosen = new Set<string>();
	const candidates: SourceRoutingCandidate[] = [];
	if (candidateBudget > 0) {
		// 阶段 1：按 selected source 选择顺序保证各 source 的最高排位 Claim。
		for (const source of selectedSources) {
			if (candidates.length >= candidateBudget) break;
			const topClaimId = source.claimIds[0];
			if (!topClaimId || chosen.has(topClaimId)) continue;
			chosen.add(topClaimId);
			candidates.push({
				claimId: topClaimId,
				lexicalRank: source.firstLexicalRank,
				sourceIds: selectedSourceIds.filter((id) =>
					(sourceIdsByClaim.get(topClaimId) ?? []).includes(id),
				),
				guaranteed: true,
			});
		}
		// 阶段 2：按 routing pool 原始词法顺序，仅用 selected sources 填充。
		for (const item of boundedPool) {
			if (candidates.length >= candidateBudget) break;
			if (chosen.has(item.claimId)) continue;
			const routed = selectedSourceIds.filter((id) => item.sourceIds.includes(id));
			if (routed.length === 0) continue;
			chosen.add(item.claimId);
			candidates.push({
				claimId: item.claimId,
				lexicalRank: item.lexicalRank,
				sourceIds: routed,
				guaranteed: false,
			});
		}
	}
	return {
		candidates,
		sources,
		selectedSourceIds,
		diagnostics: {
			routingPoolSize: boundedPool.length,
			discoveredSourceCount: sources.length,
			selectedSourceCount: selectedSources.length,
			candidateCount: candidates.length,
		},
	};
}
