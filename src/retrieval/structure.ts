import type { Claim, ScopeContext } from "../types/index.js";

/**
 * 结构候选路径种类（Goal 3-B）。
 *
 * 只描述"从 Seed 出发经过哪条证据结构到达候选"，不承担事实推理权，
 * 不构造图边。SAME_EVIDENCE_BLOCK = 与 Seed 的证据同处一个证据块
 * （sourceId + blockId）；SAME_SOURCE = 与 Seed 的证据同属一个 Source。
 */
export type StructuralPathKind = "SAME_EVIDENCE_BLOCK" | "SAME_SOURCE";

/** 一条可解释的结构路径：从某个 Seed 出发，经过同一证据块或同一 Source 到达候选。 */
export interface StructuralCandidateTrace {
	seedClaimId: string;
	candidateClaimId: string;
	pathKind: StructuralPathKind;
	viaSourceId: string;
	/** SAME_EVIDENCE_BLOCK 路径提供定位块；SAME_SOURCE 路径不提供块定位。 */
	viaBlockId?: string;
}

/** 去重合并后的结构候选：Claim + 全部到达路径 trace。 */
export interface StructuralCandidate {
	claim: Claim;
	traces: StructuralCandidateTrace[];
}

/** 结构候选发现诊断；只读检索，不写任何 knowledge state / index。 */
export interface StructuralCandidateDiagnostics {
	indexVersion: string;
	canonicalStateGeneration: string;
	/** 参与发现的 Seed 数（scope 可见的输入 Seed；重复 id 只计一次）。 */
	seedCount: number;
	/** 返回的候选数（截断与可见性过滤之后）。 */
	candidateCount: number;
	spanClaimShardsRead: number;
	sourceClaimShardsRead: number;
	/** 排除所有 Seed 后的去重候选总数（即 aggregates.length；诊断账平公式的基数）。 */
	discoveredCandidateCount: number;
	/** 实际进入 claim/evidence 检查的 scope+temporal 可见候选数（渐进流水线已检查的批次成员）。 */
	inspectedCandidateCount: number;
	/** 因 scope 不可见被排除的去重候选数（截断前统计）。 */
	scopeExcludedCount: number;
	/** scope 可见但因 temporal 区间被排除的去重候选数。 */
	temporalExcludedCount: number;
	/** 因预算未返回的候选数：未检查的剩余可见候选 + 当前检查批次中可解析但超过剩余名额的候选（不含已计入 unresolved 的候选）。 */
	truncatedCount: number;
	/** 无法水合或缺失可解析 evidence 而被排除的去重候选数（含缺 locator 的不可水合防御桶；保证候选证据完整性）。 */
	unresolvedEvidenceExcludedCount: number;
	/** 仅统计最终返回 candidates 的可解析证据 span 数（不含同批次检查过但未返回的候选）。 */
	resolvedEvidenceSpanCount: number;
}

export interface StructuralCandidateResult {
	/** 仅新增候选；Seed 不混入 candidates。 */
	candidates: StructuralCandidate[];
	diagnostics: StructuralCandidateDiagnostics;
}

export interface StructuralCandidateOptions {
	/** 返回候选上限；0 表示不返回任何候选。默认 40（与 neighborhood 默认预算一致）。 */
	maxCandidates?: number;
	/** 缺失时按 GLOBAL-only 处理，与现有 lexical 可见性语义一致。 */
	scopeContext?: ScopeContext;
	/** 与现有 lexical 检索相同的显式月份区间语义。 */
	temporalQuery?: string;
	/**
	 * 允许参与发现的路径种类（Goal 3-B 离线消融）。缺省 = 两类全开，
	 * 与既有行为完全一致。空数组 = 不读取任何 adjacency shard、不生成
	 * trace，返回零候选（仍走 openCurrentIndex 的 stale fail-closed）。
	 * 过滤发生在 adjacency 读取与 trace 生成之前。
	 */
	pathKinds?: StructuralPathKind[];
}

/** 聚合过程中的候选（尚未 hydrate Claim）；claimId + 全部去重 trace。 */
export interface StructuralCandidateAggregate {
	claimId: string;
	traces: StructuralCandidateTrace[];
}

const PATH_KIND_ORDER: Record<StructuralPathKind, number> = {
	SAME_EVIDENCE_BLOCK: 0,
	SAME_SOURCE: 1,
};

function traceKey(trace: StructuralCandidateTrace): string {
	return [
		trace.seedClaimId,
		trace.candidateClaimId,
		trace.pathKind,
		trace.viaSourceId,
		trace.viaBlockId ?? "",
	].join("\u0000");
}

/**
 * 确定性结构候选聚合（纯函数；不接触存储，不构造图边）。
 *
 * 排序合同（固定并写进代码，逐级比较）：
 * 1. Seed 输入顺序：seedClaimId 在 seedOrder 中的序号（缺失视为最后）；
 * 2. 路径种类：SAME_EVIDENCE_BLOCK 先于 SAME_SOURCE；
 * 3. viaSourceId 字典序；
 * 4. viaBlockId 字典序（仅块路径内比较；SAME_SOURCE 视为空串，不跨种类比较）；
 * 5. candidateClaimId 字典序。
 *
 * 重复候选只保留第一次出现位置，但该候选合并全部去重 trace。
 */
export function orderStructuralCandidates(
	traces: readonly StructuralCandidateTrace[],
	seedOrder: ReadonlyMap<string, number>,
): StructuralCandidateAggregate[] {
	const seen = new Set<string>();
	const uniqueTraces: StructuralCandidateTrace[] = [];
	for (const trace of traces) {
		const key = traceKey(trace);
		if (seen.has(key)) continue;
		seen.add(key);
		uniqueTraces.push(trace);
	}
	uniqueTraces.sort((left, right) => compareTraces(left, right, seedOrder));
	const aggregateByClaim = new Map<string, StructuralCandidateAggregate>();
	const order: string[] = [];
	for (const trace of uniqueTraces) {
		const existing = aggregateByClaim.get(trace.candidateClaimId);
		if (existing) {
			existing.traces.push(trace);
		} else {
			aggregateByClaim.set(trace.candidateClaimId, {
				claimId: trace.candidateClaimId,
				traces: [trace],
			});
			order.push(trace.candidateClaimId);
		}
	}
	return order.map((claimId) => aggregateByClaim.get(claimId) as StructuralCandidateAggregate);
}

function compareTraces(
	left: StructuralCandidateTrace,
	right: StructuralCandidateTrace,
	seedOrder: ReadonlyMap<string, number>,
): number {
	const seedDifference =
		(seedOrder.get(left.seedClaimId) ?? Number.MAX_SAFE_INTEGER) -
		(seedOrder.get(right.seedClaimId) ?? Number.MAX_SAFE_INTEGER);
	if (seedDifference !== 0) return seedDifference;
	const kindDifference = PATH_KIND_ORDER[left.pathKind] - PATH_KIND_ORDER[right.pathKind];
	if (kindDifference !== 0) return kindDifference;
	const sourceComparison = left.viaSourceId.localeCompare(right.viaSourceId);
	if (sourceComparison !== 0) return sourceComparison;
	const blockComparison = (left.viaBlockId ?? "").localeCompare(right.viaBlockId ?? "");
	if (blockComparison !== 0) return blockComparison;
	return left.candidateClaimId.localeCompare(right.candidateClaimId);
}
