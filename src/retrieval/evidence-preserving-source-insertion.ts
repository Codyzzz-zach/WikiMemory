/**
 * Goal 3 EPSI40 —— 证据保留的 source 插入选择器(纯确定性函数)。
 *
 * 实现 experiments/goal3/goal3-evidence-preserving-source-insertion-contract-v1.json
 * 的 fixedAlgorithm(EPSI40 arm):
 *
 * - 输入是一个已经按确定性词法顺序排序的有界 routing pool(默认/上限
 *   routingPoolBudget = 120),每条记录含 claimId、lexicalRank、sourceIds、
 *   evidenceSpanIds;sourceIds 与 evidenceSpanIds 必须已经由持久化层解析。
 * - 起点是前 candidateBudget(默认/上限 40)条 Claims(L40_STRONG)。
 * - novel source = 当前选中集合(selected sources 并集)之外的 source;按
 *   (firstLexicalRank 升序, sourceId 字典序)确定性排序,最多检查
 *   novelSourceInspectionBudget(默认/上限 12)个。
 * - 每个 novel source 取其最高排位的未选中 Claim 作为代表;代表必须已有
 *   持久化 evidence(空 evidence 无资格插入),未解析 evidence 整池
 *   fail-closed 抛错。
 * - 现有候选只有在 evidence 非空且其每个 evidenceSpanId 仍被另一个当前
 *   选中 Claim 引用(精确持久化 span 身份,语义相似/重叠文本/Gold 一律
 *   不作为冗余证明)时才可驱逐;取词法排位最差(最大)、claimId 字典序升序
 *   tie-break 的那一个,插入代表并立即更新 evidence 引用计数后再考虑下一个
 *   novel source。
 * - 没有安全可驱逐者时拒绝该插入。绝不增长超过 candidateBudget,绝不移除
 *   L40 唯一的 evidenceSpanId。
 *
 * 纯函数:不访问存储/网络/模型,不读取 Gold,不构造 Relation/Context Pack,
 * 不改变 canonical 状态。返回的 diagnostics + trace 足以审计每次接受/拒绝的
 * 插入与 evidence-span 保留。
 */

export const ROUTING_POOL_BUDGET_DEFAULT = 120;
export const ROUTING_POOL_BUDGET_MAX = 120;
export const NOVEL_SOURCE_INSPECTION_BUDGET_DEFAULT = 12;
export const NOVEL_SOURCE_INSPECTION_BUDGET_MAX = 12;
export const CANDIDATE_BUDGET_DEFAULT = 40;
export const CANDIDATE_BUDGET_MAX = 40;

export interface EvidencePreservingInsertionOptions {
	routingPoolBudget?: number;
	novelSourceInspectionBudget?: number;
	candidateBudget?: number;
}

export interface EvidencePreservingInsertionBudget {
	routingPoolBudget: number;
	novelSourceInspectionBudget: number;
	candidateBudget: number;
}

/** 已解析的 routing pool 记录;池必须按 lexicalRank 严格递增排序。 */
export interface EvidencePreservingPoolClaim {
	claimId: string;
	/** 该 Claim 在现有确定性词法顺序中的 1-based 排位,池内严格递增。 */
	lexicalRank: number;
	/** 为这个 Claim 解析出的去重 evidence Source ID 列表。 */
	sourceIds: string[];
	/**
	 * 已解析的持久化 evidence span ID 列表(可为空)。
	 * `null` 表示未解析 evidence —— 持久化包装器语义下 fail-closed,本模块抛错。
	 * 空数组表示无 evidence:无资格被插入或驱逐。
	 */
	evidenceSpanIds: string[] | null;
}

/** 池内全部 sources,按 (firstLexicalRank, sourceId) 确定性排序。 */
export interface EvidencePreservingRoutedSource {
	sourceId: string;
	/** 该 source 任何 Claim 出现的最早词法排位。 */
	firstLexicalRank: number;
	/** 映射到该 source 的 Claim ID,按池内词法顺序。 */
	claimIds: string[];
}

export interface EvidencePreservingCandidate {
	claimId: string;
	lexicalRank: number;
	sourceIds: string[];
	evidenceSpanIds: string[];
}

export type EvidencePreservingInsertionOutcome = "accepted" | "rejected";

export type EvidencePreservingRejectionReason =
	| "empty-evidence-representative"
	| "no-safe-eviction"
	| "no-unselected-representative";

/** 单条插入尝试的审计记录;顺序即处理顺序,完全确定。 */
export interface EvidencePreservingInsertionTraceEntry {
	/** 被检查的 novel source。 */
	sourceId: string;
	sourceFirstLexicalRank: number;
	/** 尝试作为代表的 Claim(拒绝时给出候选代表;无未选中代表时给出最高排位 Claim)。 */
	representativeClaimId: string;
	representativeLexicalRank: number;
	outcome: EvidencePreservingInsertionOutcome;
	/** rejected 时给出原因。 */
	rejectionReason?: EvidencePreservingRejectionReason;
	/** accepted 时被驱逐的当前候选。 */
	evictedClaimId?: string;
	evictedLexicalRank?: number;
	/**
	 * accepted 时被驱逐候选每个 evidenceSpanId 在驱逐后的剩余引用计数
	 * (契约保证逐项 >= 1,即该 span 仍被另一条选中 Claim 引用)。
	 */
	evictedEvidenceReferenceCountsAfter?: Record<string, number>;
}

export interface EvidencePreservingInsertionDiagnostics {
	/** 截断后的实际 pool 大小(不超过 routingPoolBudget)。 */
	poolSize: number;
	routingPoolBudget: number;
	novelSourceInspectionBudget: number;
	candidateBudget: number;
	/** 初始 L40 候选数 = min(poolSize, candidateBudget)。 */
	initialCandidateCount: number;
	/** 最终候选数,绝不大于 candidateBudget。 */
	candidateCount: number;
	/** 实际检查过的 novel sources 数(含接受与拒绝),不超过 novelSourceInspectionBudget。 */
	novelSourcesConsidered: number;
	/** 遍历中因已属于当前 selected sources 而跳过的 novel 候选数(不计入检查预算)。 */
	novelSourcesSkippedAlreadySelected: number;
	acceptedInsertions: number;
	rejectedNoSafeEviction: number;
	rejectedEmptyEvidenceRepresentative: number;
	rejectedNoUnselectedRepresentative: number;
	selectedSourceCount: number;
	/** 初始 L40 的 evidenceSpanId 并集(去重排序)。 */
	baselineEvidenceSpanIds: string[];
	/** 最终 selection 的 evidenceSpanId 并集(去重排序)。 */
	finalEvidenceSpanIds: string[];
	/** finalEvidenceSpanIds ⊇ baselineEvidenceSpanIds(EPSI40 的保留不变量)。 */
	baselineEvidenceSpanUnionPreserved: boolean;
	/** baseline \ final;契约要求恒为空。 */
	lostEvidenceSpanIds: string[];
	/** final \ baseline;仅由插入带来的新 span。 */
	gainedEvidenceSpanIds: string[];
}

export interface EvidencePreservingInsertionSelection {
	/** 有序候选(按 lexicalRank 升序),绝不超 candidateBudget。 */
	candidates: EvidencePreservingCandidate[];
	/** 最终 selected sources 并集,字典序。 */
	selectedSourceIds: string[];
	/** 池内全部 sources,按 (firstLexicalRank, sourceId) 排序。 */
	sources: EvidencePreservingRoutedSource[];
	/** 每条 novel source 插入尝试的审计记录,处理顺序即数组顺序。 */
	trace: EvidencePreservingInsertionTraceEntry[];
	diagnostics: EvidencePreservingInsertionDiagnostics;
}

function clampBudget(value: number | undefined, fallback: number, maximum: number): number {
	if (value === undefined) return fallback;
	if (!Number.isFinite(value)) return value === Number.POSITIVE_INFINITY ? maximum : 0;
	return Math.max(0, Math.min(Math.floor(value), maximum));
}

/** 契约固定预算 clamp:缺省取默认值,超上限取上限,负值/NaN 取 0。 */
export function clampEvidencePreservingInsertionOptions(
	options: EvidencePreservingInsertionOptions = {},
): EvidencePreservingInsertionBudget {
	const routingPoolBudget = clampBudget(
		options.routingPoolBudget,
		ROUTING_POOL_BUDGET_DEFAULT,
		ROUTING_POOL_BUDGET_MAX,
	);
	const novelSourceInspectionBudget = clampBudget(
		options.novelSourceInspectionBudget,
		NOVEL_SOURCE_INSPECTION_BUDGET_DEFAULT,
		NOVEL_SOURCE_INSPECTION_BUDGET_MAX,
	);
	const candidateBudget = clampBudget(
		options.candidateBudget,
		CANDIDATE_BUDGET_DEFAULT,
		CANDIDATE_BUDGET_MAX,
	);
	return { routingPoolBudget, novelSourceInspectionBudget, candidateBudget };
}

function compareStrings(left: string, right: string): number {
	return left.localeCompare(right);
}

/** 每条记录内的 evidence span 去重;空 evidence 返回空数组。 */
function uniqueEvidenceSpanIds(candidate: { evidenceSpanIds: readonly string[] }): string[] {
	return [...new Set(candidate.evidenceSpanIds)];
}

function collectSelectedSourceIds(
	candidates: readonly { sourceIds: readonly string[] }[],
): Set<string> {
	const set = new Set<string>();
	for (const candidate of candidates) {
		for (const sourceId of candidate.sourceIds) set.add(sourceId);
	}
	return set;
}

function unionOfEvidence(candidates: readonly EvidencePreservingCandidate[]): Set<string> {
	const set = new Set<string>();
	for (const candidate of candidates) {
		for (const spanId of uniqueEvidenceSpanIds(candidate)) set.add(spanId);
	}
	return set;
}

/**
 * 安全可驱逐:evidence 非空,且每个 evidenceSpanId 的当前引用计数 >= 2
 * (驱逐后仍被另一条选中 Claim 引用)。引用计数只来自精确的持久化 span
 * 身份;空 evidence 与唯一引用一律不可驱逐(fail-closed)。
 */
function isSafelyEvictable(
	candidate: EvidencePreservingCandidate,
	counts: ReadonlyMap<string, number>,
): boolean {
	const spans = uniqueEvidenceSpanIds(candidate);
	if (spans.length === 0) return false;
	return spans.every((spanId) => (counts.get(spanId) ?? 0) >= 2);
}

/**
 * 确定性证据保留 source 插入选择(纯函数)。
 *
 * 阶段 0:pool 防御性截断到 routingPoolBudget;未解析 evidence 与乱序/
 * 重复 claimId 输入 fail-closed 抛错。
 * 阶段 1:构造 L40_STRONG = 前 candidateBudget 条,统计 evidence 引用计数。
 * 阶段 2:按 (firstLexicalRank, sourceId) 遍历 novel sources(最多
 * novelSourceInspectionBudget 个),对每个 novel source 尝试安全驱逐 +
 * 插入;无安全槽则拒绝,继续处理下一个。
 */
export function selectEvidencePreservingCandidates(
	pool: readonly EvidencePreservingPoolClaim[],
	options: EvidencePreservingInsertionOptions = {},
): EvidencePreservingInsertionSelection {
	const { routingPoolBudget, novelSourceInspectionBudget, candidateBudget } =
		clampEvidencePreservingInsertionOptions(options);
	const boundedPool = pool.slice(0, routingPoolBudget);

	// fail-closed:未解析 evidence 整池拒绝;绝不把 unresolved 带进 selection。
	const unresolved = boundedPool.find((item) => item.evidenceSpanIds === null);
	if (unresolved) {
		throw new Error(
			`Unresolved evidence for claim ${unresolved.claimId}: unresolved evidence fails closed`,
		);
	}
	// 输入前提校验:词法序 = lexicalRank 严格递增,claimId 唯一。
	const seenClaimIds = new Set<string>();
	for (let i = 0; i < boundedPool.length; i += 1) {
		const item = boundedPool[i];
		if (i > 0 && item.lexicalRank <= boundedPool[i - 1].lexicalRank) {
			throw new Error(
				`Pool must be lexical-ordered by strictly increasing lexicalRank (claim ${item.claimId})`,
			);
		}
		if (seenClaimIds.has(item.claimId)) {
			throw new Error(`Duplicate claimId in pool: ${item.claimId}`);
		}
		seenClaimIds.add(item.claimId);
	}

	const byClaimId = new Map(boundedPool.map((item) => [item.claimId, item] as const));

	// 阶段 1:L40_STRONG = 前 candidateBudget 条(无条件,保持词法顺序)。
	const selected: EvidencePreservingCandidate[] = boundedPool
		.slice(0, candidateBudget)
		.map((item) => ({
			claimId: item.claimId,
			lexicalRank: item.lexicalRank,
			sourceIds: [...item.sourceIds],
			evidenceSpanIds: item.evidenceSpanIds === null ? [] : [...item.evidenceSpanIds],
		}));
	const selectedClaimIds = new Set(selected.map((candidate) => candidate.claimId));
	const evidenceCounts = new Map<string, number>();
	for (const candidate of selected) {
		for (const spanId of uniqueEvidenceSpanIds(candidate)) {
			evidenceCounts.set(spanId, (evidenceCounts.get(spanId) ?? 0) + 1);
		}
	}
	const baselineEvidenceSpanIds = [...unionOfEvidence(selected)].sort(compareStrings);

	// 池内全部 sources:按首次词法排位 + sourceId 字典序确定性排序。
	const bySource = new Map<string, { firstLexicalRank: number; claimIds: string[] }>();
	for (const item of boundedPool) {
		const seen = new Set<string>();
		for (const sourceId of item.sourceIds) {
			if (seen.has(sourceId)) continue;
			seen.add(sourceId);
			const record = bySource.get(sourceId);
			if (record) record.claimIds.push(item.claimId);
			else bySource.set(sourceId, { firstLexicalRank: item.lexicalRank, claimIds: [item.claimId] });
		}
	}
	const sources: EvidencePreservingRoutedSource[] = [...bySource.entries()]
		.map(([sourceId, record]) => ({
			sourceId,
			firstLexicalRank: record.firstLexicalRank,
			claimIds: [...record.claimIds],
		}))
		.sort(
			(left, right) =>
				left.firstLexicalRank - right.firstLexicalRank ||
				left.sourceId.localeCompare(right.sourceId),
		);

	// 阶段 2:novel source 插入。
	const trace: EvidencePreservingInsertionTraceEntry[] = [];
	let inspected = 0;
	let novelSourcesSkippedAlreadySelected = 0;
	let acceptedInsertions = 0;
	let rejectedNoSafeEviction = 0;
	let rejectedEmptyEvidenceRepresentative = 0;
	let rejectedNoUnselectedRepresentative = 0;

	for (const source of sources) {
		if (inspected >= novelSourceInspectionBudget) break;
		const selectedSourceIds = collectSelectedSourceIds(selected);
		if (selectedSourceIds.has(source.sourceId)) {
			novelSourcesSkippedAlreadySelected += 1;
			continue;
		}
		inspected += 1;

		// 该 novel source 最高排位的未选中 Claim 作为代表。
		let representative: EvidencePreservingPoolClaim | undefined;
		for (const claimId of source.claimIds) {
			const item = byClaimId.get(claimId);
			if (item && !selectedClaimIds.has(item.claimId)) {
				representative = item;
				break;
			}
		}
		const fallbackClaimId = source.claimIds[0] ?? "";
		const representativeClaimId = representative?.claimId ?? fallbackClaimId;
		const representativeLexicalRank =
			representative?.lexicalRank ?? byClaimId.get(fallbackClaimId)?.lexicalRank ?? 0;

		if (!representative) {
			rejectedNoUnselectedRepresentative += 1;
			trace.push({
				sourceId: source.sourceId,
				sourceFirstLexicalRank: source.firstLexicalRank,
				representativeClaimId,
				representativeLexicalRank,
				outcome: "rejected",
				rejectionReason: "no-unselected-representative",
			});
			continue;
		}

		const representativeEvidence = representative.evidenceSpanIds;
		if (representativeEvidence === null) {
			// 阶段 0 已整池 fail-closed;此处仅为类型收窄,实际不可达。
			throw new Error(
				`Unresolved evidence for claim ${representative.claimId}: unresolved evidence fails closed`,
			);
		}
		if (representativeEvidence.length === 0) {
			rejectedEmptyEvidenceRepresentative += 1;
			trace.push({
				sourceId: source.sourceId,
				sourceFirstLexicalRank: source.firstLexicalRank,
				representativeClaimId,
				representativeLexicalRank,
				outcome: "rejected",
				rejectionReason: "empty-evidence-representative",
			});
			continue;
		}

		// 安全可驱逐者中取词法排位最差(最大),claimId 字典序升序 tie-break。
		const evicted = selected
			.filter((candidate) => isSafelyEvictable(candidate, evidenceCounts))
			.sort(
				(left, right) =>
					right.lexicalRank - left.lexicalRank || left.claimId.localeCompare(right.claimId),
			)[0];

		if (!evicted) {
			rejectedNoSafeEviction += 1;
			trace.push({
				sourceId: source.sourceId,
				sourceFirstLexicalRank: source.firstLexicalRank,
				representativeClaimId,
				representativeLexicalRank,
				outcome: "rejected",
				rejectionReason: "no-safe-eviction",
			});
			continue;
		}

		// 驱逐:更新 evidence 引用计数(资格已保证逐 span 剩余 >= 1)。
		for (const spanId of uniqueEvidenceSpanIds(evicted)) {
			evidenceCounts.set(spanId, (evidenceCounts.get(spanId) ?? 1) - 1);
		}
		// 插入代表,保持候选词法顺序。
		const inserted: EvidencePreservingCandidate = {
			claimId: representative.claimId,
			lexicalRank: representative.lexicalRank,
			sourceIds: [...representative.sourceIds],
			evidenceSpanIds: [...representativeEvidence],
		};
		selectedClaimIds.delete(evicted.claimId);
		selectedClaimIds.add(inserted.claimId);
		const remaining = selected.filter((candidate) => candidate.claimId !== evicted.claimId);
		remaining.push(inserted);
		selected.length = 0;
		selected.push(...remaining.sort((left, right) => left.lexicalRank - right.lexicalRank));
		for (const spanId of uniqueEvidenceSpanIds(inserted)) {
			evidenceCounts.set(spanId, (evidenceCounts.get(spanId) ?? 0) + 1);
		}

		const evictedEvidenceReferenceCountsAfter: Record<string, number> = {};
		for (const spanId of uniqueEvidenceSpanIds(evicted)) {
			evictedEvidenceReferenceCountsAfter[spanId] = evidenceCounts.get(spanId) ?? 0;
		}
		acceptedInsertions += 1;
		trace.push({
			sourceId: source.sourceId,
			sourceFirstLexicalRank: source.firstLexicalRank,
			representativeClaimId: inserted.claimId,
			representativeLexicalRank: inserted.lexicalRank,
			outcome: "accepted",
			evictedClaimId: evicted.claimId,
			evictedLexicalRank: evicted.lexicalRank,
			evictedEvidenceReferenceCountsAfter,
		});
	}

	const finalEvidenceSpanIds = [...unionOfEvidence(selected)].sort(compareStrings);
	const finalEvidenceSet = new Set(finalEvidenceSpanIds);
	const lostEvidenceSpanIds = baselineEvidenceSpanIds.filter(
		(spanId) => !finalEvidenceSet.has(spanId),
	);
	const gainedEvidenceSpanIds = finalEvidenceSpanIds.filter(
		(spanId) => !new Set(baselineEvidenceSpanIds).has(spanId),
	);

	return {
		candidates: selected,
		selectedSourceIds: [...collectSelectedSourceIds(selected)].sort(compareStrings),
		sources,
		trace,
		diagnostics: {
			poolSize: boundedPool.length,
			routingPoolBudget,
			novelSourceInspectionBudget,
			candidateBudget,
			initialCandidateCount: Math.min(boundedPool.length, candidateBudget),
			candidateCount: selected.length,
			novelSourcesConsidered: inspected,
			novelSourcesSkippedAlreadySelected,
			acceptedInsertions,
			rejectedNoSafeEviction,
			rejectedEmptyEvidenceRepresentative,
			rejectedNoUnselectedRepresentative,
			selectedSourceCount: collectSelectedSourceIds(selected).size,
			baselineEvidenceSpanIds,
			finalEvidenceSpanIds,
			baselineEvidenceSpanUnionPreserved: lostEvidenceSpanIds.length === 0,
			lostEvidenceSpanIds,
			gainedEvidenceSpanIds,
		},
	};
}
