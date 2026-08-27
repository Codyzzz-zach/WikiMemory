import { describe, expect, it } from "vitest";
import {
	type EvidencePreservingInsertionSelection,
	type EvidencePreservingPoolClaim,
	clampEvidencePreservingInsertionOptions,
	selectEvidencePreservingCandidates,
} from "./evidence-preserving-source-insertion.js";

/** 测试辅助:构造一条已解析、词法序合法的 pool 记录。 */
function poolClaim(
	claimId: string,
	lexicalRank: number,
	sourceIds: string[],
	evidenceSpanIds: string[] | null = [],
): EvidencePreservingPoolClaim {
	return { claimId, lexicalRank, sourceIds, evidenceSpanIds };
}

/** 确定性伪随机源(mulberry32),保证 property 测试可复现。 */
function mulberry32(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) | 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** 生成确定性伪随机 pool(rank 1..size):共享 evidence 热区保证存在多引用。 */
function seededPool(seed: number, size = 100): EvidencePreservingPoolClaim[] {
	const rand = mulberry32(seed);
	const claims: EvidencePreservingPoolClaim[] = [];
	for (let rank = 1; rank <= size; rank += 1) {
		const sourceCount = 1 + (rand() < 0.35 ? 1 : 0);
		const sources = new Set<string>();
		while (sources.size < sourceCount) {
			sources.add(`source:${1 + Math.floor(rand() * 15)}`);
		}
		const evidence = new Set<string>();
		const evidenceCount = rand() < 0.15 ? 0 : 1 + Math.floor(rand() * 3);
		while (evidence.size < evidenceCount) {
			const hot = rand() < 0.6;
			const spanId = hot
				? `span:${1 + Math.floor(rand() * 6)}`
				: `span:${7 + Math.floor(rand() * 20)}`;
			evidence.add(spanId);
		}
		claims.push({
			claimId: `claim:${rank}`,
			lexicalRank: rank,
			sourceIds: [...sources],
			evidenceSpanIds: [...evidence],
		});
	}
	return claims;
}

describe("clampEvidencePreservingInsertionOptions", () => {
	it("clamps budgets to contract maxima and floors at zero", () => {
		expect(clampEvidencePreservingInsertionOptions({})).toEqual({
			routingPoolBudget: 120,
			novelSourceInspectionBudget: 12,
			candidateBudget: 40,
		});
		expect(
			clampEvidencePreservingInsertionOptions({
				routingPoolBudget: 40,
				novelSourceInspectionBudget: 5,
				candidateBudget: 7,
			}),
		).toEqual({ routingPoolBudget: 40, novelSourceInspectionBudget: 5, candidateBudget: 7 });
		expect(
			clampEvidencePreservingInsertionOptions({
				routingPoolBudget: 999,
				novelSourceInspectionBudget: 999,
				candidateBudget: 999,
			}),
		).toEqual({ routingPoolBudget: 120, novelSourceInspectionBudget: 12, candidateBudget: 40 });
		expect(
			clampEvidencePreservingInsertionOptions({
				routingPoolBudget: -3,
				novelSourceInspectionBudget: -1,
				candidateBudget: -9,
			}),
		).toEqual({ routingPoolBudget: 0, novelSourceInspectionBudget: 0, candidateBudget: 0 });
		expect(
			clampEvidencePreservingInsertionOptions({
				routingPoolBudget: 12.9,
				novelSourceInspectionBudget: Number.NaN,
				candidateBudget: Number.POSITIVE_INFINITY,
			}),
		).toEqual({ routingPoolBudget: 12, novelSourceInspectionBudget: 0, candidateBudget: 40 });
	});
});

describe("selectEvidencePreservingCandidates", () => {
	it("rejects insertion when no safely evictable candidate exists (no safe slot)", () => {
		const pool: EvidencePreservingPoolClaim[] = [];
		for (let rank = 1; rank <= 40; rank += 1) {
			// 每条 evidence span 只被一条 claim 引用 —— 唯一引用不可驱逐。
			pool.push(poolClaim(`c${rank}`, rank, ["source:s0"], [`e${rank}`]));
		}
		pool.push(poolClaim("c41", 41, ["source:s1"], ["e41"]));

		const selection = selectEvidencePreservingCandidates(pool);
		expect(selection.diagnostics.candidateCount).toBe(40);
		expect(selection.candidates.map((candidate) => candidate.claimId)).not.toContain("c41");
		expect(selection.diagnostics.acceptedInsertions).toBe(0);
		expect(selection.diagnostics.rejectedNoSafeEviction).toBe(1);
		expect(selection.trace[0]).toMatchObject({
			sourceId: "source:s1",
			outcome: "rejected",
			rejectionReason: "no-safe-eviction",
		});
		expect(selection.diagnostics.baselineEvidenceSpanUnionPreserved).toBe(true);
		expect(selection.diagnostics.lostEvidenceSpanIds).toEqual([]);
	});

	it("safely inserts a novel source by evicting the worst-rank safe candidate", () => {
		const pool: EvidencePreservingPoolClaim[] = [];
		for (let rank = 1; rank <= 35; rank += 1) {
			pool.push(poolClaim(`c${rank}`, rank, ["source:s0"], [`e${rank}`]));
		}
		pool.push(poolClaim("c36", 36, ["source:s0"], ["e36", "sharedA"]));
		pool.push(poolClaim("c37", 37, ["source:s0"], ["e37", "sharedB"]));
		pool.push(poolClaim("c38", 38, ["source:s0"], ["e38"]));
		pool.push(poolClaim("c39", 39, ["source:s0"], ["sharedA", "shared"]));
		pool.push(poolClaim("c40", 40, ["source:s0"], ["sharedB", "shared"]));
		pool.push(poolClaim("c41", 41, ["source:s1"], ["e41"]));

		const selection = selectEvidencePreservingCandidates(pool);
		expect(selection.diagnostics.candidateCount).toBe(40);
		expect(selection.diagnostics.acceptedInsertions).toBe(1);
		expect(selection.candidates.map((candidate) => candidate.claimId)).toContain("c41");
		expect(selection.candidates.map((candidate) => candidate.claimId)).not.toContain("c40");
		// 驱逐 rank 最差者(40)而非 rank 39。
		expect(selection.trace[0]).toMatchObject({
			sourceId: "source:s1",
			representativeClaimId: "c41",
			outcome: "accepted",
			evictedClaimId: "c40",
			evictedLexicalRank: 40,
			evictedEvidenceReferenceCountsAfter: { sharedB: 1, shared: 1 },
		});
		// shared 仍被 c39 引用,保留不变量成立。
		expect(selection.diagnostics.baselineEvidenceSpanUnionPreserved).toBe(true);
		expect(selection.diagnostics.finalEvidenceSpanIds).toContain("shared");
		expect(selection.diagnostics.lostEvidenceSpanIds).toEqual([]);
		expect(selection.selectedSourceIds).toEqual(["source:s0", "source:s1"]);
	});

	it("supports multiple insertions with updated evidence reference counts", () => {
		const pool: EvidencePreservingPoolClaim[] = [];
		for (let rank = 1; rank <= 34; rank += 1) {
			pool.push(poolClaim(`c${rank}`, rank, ["source:s0"], [`e${rank}`]));
		}
		pool.push(poolClaim("c35", 35, ["source:s0"], ["e35", "sharedA"]));
		pool.push(poolClaim("c36", 36, ["source:s0"], ["e36", "sharedB"]));
		pool.push(poolClaim("c37", 37, ["source:s0"], ["e37", "sharedC"]));
		pool.push(poolClaim("c38", 38, ["source:s0"], ["sharedA", "shared"]));
		pool.push(poolClaim("c39", 39, ["source:s0"], ["sharedB", "shared"]));
		pool.push(poolClaim("c40", 40, ["source:s0"], ["sharedC", "shared"]));
		pool.push(poolClaim("c41", 41, ["source:s1"], ["e41"]));
		pool.push(poolClaim("c42", 42, ["source:s2"], ["e42"]));
		pool.push(poolClaim("c43", 43, ["source:s3"], ["e43"]));

		const selection = selectEvidencePreservingCandidates(pool);
		expect(selection.diagnostics.acceptedInsertions).toBe(2);
		expect(selection.diagnostics.rejectedNoSafeEviction).toBe(1);
		expect(selection.trace.map((entry) => entry.outcome)).toEqual([
			"accepted",
			"accepted",
			"rejected",
		]);
		// 第一次驱逐:shared 3 -> 2;第二次驱逐:shared 2 -> 1;第三次无安全槽。
		expect(selection.trace[0].evictedEvidenceReferenceCountsAfter?.shared).toBe(2);
		expect(selection.trace[1].evictedEvidenceReferenceCountsAfter?.shared).toBe(1);
		expect(selection.trace[2]).toMatchObject({
			sourceId: "source:s3",
			outcome: "rejected",
			rejectionReason: "no-safe-eviction",
		});
		const claimIds = selection.candidates.map((candidate) => candidate.claimId);
		expect(claimIds).toContain("c41");
		expect(claimIds).toContain("c42");
		expect(claimIds).toContain("c38");
		expect(claimIds).not.toContain("c39");
		expect(claimIds).not.toContain("c40");
		expect(selection.diagnostics.candidateCount).toBe(40);
		expect(selection.diagnostics.finalEvidenceSpanIds).toContain("shared");
		expect(selection.diagnostics.baselineEvidenceSpanUnionPreserved).toBe(true);
		expect(selection.selectedSourceIds).toEqual(["source:s0", "source:s1", "source:s2"]);
	});

	it("handles multi-source claims: an inserted representative brings all its sources", () => {
		const pool: EvidencePreservingPoolClaim[] = [];
		for (let rank = 1; rank <= 35; rank += 1) {
			pool.push(poolClaim(`c${rank}`, rank, ["source:s0"], [`e${rank}`]));
		}
		pool.push(poolClaim("c36", 36, ["source:s0"], ["e36", "sharedA"]));
		pool.push(poolClaim("c37", 37, ["source:s0"], ["e37", "sharedB"]));
		pool.push(poolClaim("c38", 38, ["source:s0"], ["e38"]));
		pool.push(poolClaim("c39", 39, ["source:s0"], ["sharedA", "shared"]));
		pool.push(poolClaim("c40", 40, ["source:s0", "source:sX"], ["sharedB", "shared"]));
		pool.push(poolClaim("c41", 41, ["source:sA", "source:sB"], ["e41"]));
		pool.push(poolClaim("c50", 50, ["source:sA"], ["e50"]));

		const selection = selectEvidencePreservingCandidates(pool);
		// 只有 sA 会被尝试:sB 随 c41 一起进入 selected sources,不再 novel。
		expect(selection.diagnostics.acceptedInsertions).toBe(1);
		expect(selection.trace).toHaveLength(1);
		expect(selection.trace[0]).toMatchObject({
			sourceId: "source:sA",
			representativeClaimId: "c41",
			outcome: "accepted",
		});
		expect(selection.diagnostics.novelSourcesSkippedAlreadySelected).toBeGreaterThanOrEqual(1);
		const inserted = selection.candidates.find((candidate) => candidate.claimId === "c41");
		expect(inserted?.sourceIds).toEqual(["source:sA", "source:sB"]);
		// 被驱逐的多源 incumbent c40 的 sX 随驱逐退出 selected sources。
		expect(selection.selectedSourceIds).toEqual(["source:s0", "source:sA", "source:sB"]);
		expect(selection.diagnostics.baselineEvidenceSpanUnionPreserved).toBe(true);
	});

	it("fails closed on empty-evidence outsiders: rejected even with a safe slot", () => {
		const pool: EvidencePreservingPoolClaim[] = [];
		for (let rank = 1; rank <= 38; rank += 1) {
			pool.push(poolClaim(`c${rank}`, rank, ["source:s0"], [`e${rank}`]));
		}
		pool.push(poolClaim("c39", 39, ["source:s0"], ["e39", "shared"]));
		pool.push(poolClaim("c40", 40, ["source:s0"], ["e40", "shared"]));
		pool.push(poolClaim("c41", 41, ["source:s1"], []));

		const selection = selectEvidencePreservingCandidates(pool);
		expect(selection.diagnostics.acceptedInsertions).toBe(0);
		expect(selection.diagnostics.rejectedEmptyEvidenceRepresentative).toBe(1);
		expect(selection.trace[0]).toMatchObject({
			sourceId: "source:s1",
			outcome: "rejected",
			rejectionReason: "empty-evidence-representative",
		});
		// 没有发生任何驱逐:空 evidence 代表无资格插入。
		expect(selection.candidates.map((candidate) => candidate.claimId)).not.toContain("c41");
		expect(selection.candidates.map((candidate) => candidate.claimId)).toContain("c40");
		expect(selection.diagnostics.baselineEvidenceSpanUnionPreserved).toBe(true);
	});

	it("fails closed on empty-evidence incumbents: never evictable even when last", () => {
		const pool: EvidencePreservingPoolClaim[] = [];
		for (let rank = 1; rank <= 38; rank += 1) {
			pool.push(poolClaim(`c${rank}`, rank, ["source:s0"], [`e${rank}`]));
		}
		pool.push(poolClaim("c39", 39, ["source:s0"], ["e39"]));
		pool.push(poolClaim("c40", 40, ["source:s0"], []));
		pool.push(poolClaim("c41", 41, ["source:s1"], ["e41"]));

		const selection = selectEvidencePreservingCandidates(pool);
		expect(selection.diagnostics.rejectedNoSafeEviction).toBe(1);
		expect(selection.trace[0]?.rejectionReason).toBe("no-safe-eviction");
		// 空 evidence 的 c40 是最差排位却不可驱逐(fail-closed)。
		expect(selection.candidates.map((candidate) => candidate.claimId)).toContain("c40");
		expect(selection.diagnostics.baselineEvidenceSpanUnionPreserved).toBe(true);
	});

	it("throws on unresolved (null) evidence — fail closed", () => {
		const pool: EvidencePreservingPoolClaim[] = [];
		for (let rank = 1; rank <= 40; rank += 1) {
			pool.push(poolClaim(`c${rank}`, rank, ["source:s0"], [`e${rank}`]));
		}
		pool.push(poolClaim("c41", 41, ["source:s1"], null));
		expect(() => selectEvidencePreservingCandidates(pool)).toThrow(/Unresolved evidence/);
		// unresolved 出现在 L40 内同样抛错。
		const poolWithUnresolvedInL40 = [...pool];
		poolWithUnresolvedInL40[5] = poolClaim("c6", 6, ["source:s0"], null);
		expect(() => selectEvidencePreservingCandidates(poolWithUnresolvedInL40)).toThrow(
			/Unresolved evidence/,
		);
	});

	it("throws on pools that are not lexical-ordered or contain duplicate claimIds", () => {
		const unique = (): EvidencePreservingPoolClaim[] => [
			poolClaim("c1", 1, ["source:s0"], ["e1"]),
			poolClaim("c2", 2, ["source:s0"], ["e2"]),
			poolClaim("c3", 3, ["source:s0"], ["e3"]),
		];
		expect(() =>
			selectEvidencePreservingCandidates([
				poolClaim("c1", 1, ["source:s0"], ["e1"]),
				poolClaim("c2", 2, ["source:s0"], ["e2"]),
				poolClaim("c3", 3, ["source:s0"], ["e3"]),
				poolClaim("c4", 3, ["source:s0"], ["e4"]),
			]),
		).toThrow(/lexical-ordered/);
		expect(() =>
			selectEvidencePreservingCandidates([
				poolClaim("c1", 1, ["source:s0"], ["e1"]),
				poolClaim("c2", 3, ["source:s0"], ["e2"]),
				poolClaim("c3", 2, ["source:s0"], ["e3"]),
			]),
		).toThrow(/lexical-ordered/);
		expect(() =>
			selectEvidencePreservingCandidates([
				poolClaim("c1", 1, ["source:s0"], ["e1"]),
				poolClaim("c1", 2, ["source:s0"], ["e2"]),
			]),
		).toThrow(/Duplicate claimId/);
		expect(unique()).toBeDefined();
	});

	it("orders novel sources by first lexical rank then sourceId tie-break", () => {
		const pool: EvidencePreservingPoolClaim[] = [];
		for (let rank = 1; rank <= 40; rank += 1) {
			pool.push(poolClaim(`c${rank}`, rank, ["source:s0"], [`e${rank}`]));
		}
		// 同一首次排位的两个 novel sources:sourceId 字典序 sA 先于 sZ。
		pool.push(poolClaim("c41", 41, ["source:sZ", "source:sA"], ["e41"]));

		const selection = selectEvidencePreservingCandidates(pool);
		expect(selection.sources.map((source) => source.sourceId)).toEqual([
			"source:s0",
			"source:sA",
			"source:sZ",
		]);
		// 两次尝试顺序确定:sA 先于 sZ,且都因无安全槽被拒。
		expect(selection.trace.map((entry) => entry.sourceId)).toEqual(["source:sA", "source:sZ"]);
		expect(selection.trace.every((entry) => entry.outcome === "rejected")).toBe(true);
	});

	it("is deterministic across repeated invocations", () => {
		const pool: EvidencePreservingPoolClaim[] = [];
		for (let rank = 1; rank <= 37; rank += 1) {
			pool.push(poolClaim(`c${rank}`, rank, ["source:s0"], [`e${rank}`]));
		}
		pool.push(poolClaim("c38", 38, ["source:s0"], ["e38", "shared"]));
		pool.push(poolClaim("c39", 39, ["source:s0"], ["e39", "shared"]));
		pool.push(poolClaim("c40", 40, ["source:s0"], ["e40", "shared"]));
		pool.push(poolClaim("c41", 41, ["source:s1"], ["e41"]));
		pool.push(poolClaim("c42", 42, ["source:s2"], ["e42"]));

		const first = selectEvidencePreservingCandidates(pool);
		for (let run = 0; run < 5; run += 1) {
			const again = selectEvidencePreservingCandidates(pool);
			expect(again).toStrictEqual(first);
		}
		// 重新构造相同内容的输入(不同对象引用)结果也必须一致。
		const rebuilt = pool.map((item) => ({
			...item,
			sourceIds: [...item.sourceIds],
			evidenceSpanIds: item.evidenceSpanIds === null ? null : [...item.evidenceSpanIds],
		}));
		expect(selectEvidencePreservingCandidates(rebuilt)).toStrictEqual(first);
	});

	it("never exceeds budgets and clamps oversized inputs (pool 120 / novel 12 / candidate 40)", () => {
		const pool: EvidencePreservingPoolClaim[] = [];
		for (let rank = 1; rank <= 36; rank += 1) {
			pool.push(poolClaim(`c${rank}`, rank, ["source:s0"], [`e${rank}`]));
		}
		pool.push(poolClaim("c37", 37, ["source:s0"], ["e37", "sharedA"]));
		pool.push(poolClaim("c38", 38, ["source:s0"], ["e38", "sharedB"]));
		pool.push(poolClaim("c39", 39, ["source:s0"], ["sharedA", "shared"]));
		pool.push(poolClaim("c40", 40, ["source:s0"], ["sharedB", "shared"]));
		for (let rank = 41; rank <= 130; rank += 1) {
			pool.push(poolClaim(`c${rank}`, rank, [`source:s${rank - 40}`], [`e${rank}`]));
		}
		const selection = selectEvidencePreservingCandidates(pool, {
			routingPoolBudget: 999,
			novelSourceInspectionBudget: 999,
			candidateBudget: 999,
		});
		expect(selection.diagnostics.routingPoolBudget).toBe(120);
		expect(selection.diagnostics.novelSourceInspectionBudget).toBe(12);
		expect(selection.diagnostics.candidateBudget).toBe(40);
		expect(selection.diagnostics.poolSize).toBe(120);
		expect(selection.diagnostics.candidateCount).toBe(40);
		expect(selection.diagnostics.novelSourcesConsidered).toBe(12);
		expect(selection.trace).toHaveLength(12);
		expect(selection.diagnostics.acceptedInsertions).toBe(1);
		expect(selection.diagnostics.rejectedNoSafeEviction).toBe(11);
	});

	it("proves the baseline evidence-span union is a subset of the output union", () => {
		for (let seed = 0; seed < 60; seed += 1) {
			const pool = seededPool(seed);
			const selection: EvidencePreservingInsertionSelection =
				selectEvidencePreservingCandidates(pool);

			// 独立计算(不依赖诊断字段):baseline = 前 40 条并集,输出 = 候选并集。
			const baseline = new Set<string>();
			for (const claim of pool.slice(0, 40)) {
				for (const spanId of claim.evidenceSpanIds ?? []) baseline.add(spanId);
			}
			const output = new Set<string>();
			for (const candidate of selection.candidates) {
				for (const spanId of candidate.evidenceSpanIds) output.add(spanId);
			}
			for (const spanId of baseline) {
				expect(output.has(spanId), `seed ${seed}: lost span ${spanId}`).toBe(true);
			}
			// 诊断与独立计算一致。
			expect(selection.diagnostics.baselineEvidenceSpanUnionPreserved).toBe(true);
			expect(selection.diagnostics.lostEvidenceSpanIds).toEqual([]);
			// 预算不变量。
			expect(selection.diagnostics.candidateCount).toBeLessThanOrEqual(40);
			expect(selection.candidates.length).toBe(selection.diagnostics.candidateCount);
			expect(selection.diagnostics.novelSourcesConsidered).toBeLessThanOrEqual(12);
			// 更强的保留证明:每个 accepted 驱逐条目的每个 span 仍在输出并集中。
			for (const entry of selection.trace) {
				if (entry.outcome !== "accepted") continue;
				expect(entry.evictedClaimId).toBeDefined();
				expect(entry.evictedEvidenceReferenceCountsAfter).toBeDefined();
				for (const spanId of Object.keys(entry.evictedEvidenceReferenceCountsAfter ?? {})) {
					expect(output.has(spanId), `seed ${seed}: evicted span ${spanId}`).toBe(true);
					expect(entry.evictedEvidenceReferenceCountsAfter?.[spanId]).toBeGreaterThanOrEqual(1);
				}
			}
			// trace 计数与诊断一致,可用于审计。
			const traceAccepted = selection.trace.filter((entry) => entry.outcome === "accepted");
			expect(traceAccepted.length).toBe(selection.diagnostics.acceptedInsertions);
			expect(selection.trace.length).toBe(
				selection.diagnostics.acceptedInsertions +
					selection.diagnostics.rejectedNoSafeEviction +
					selection.diagnostics.rejectedEmptyEvidenceRepresentative +
					selection.diagnostics.rejectedNoUnselectedRepresentative,
			);
			// 输出候选 claimId 唯一(不变量)。
			const claimIds = selection.candidates.map((candidate) => candidate.claimId);
			expect(new Set(claimIds).size).toBe(claimIds.length);
		}
	});
});
