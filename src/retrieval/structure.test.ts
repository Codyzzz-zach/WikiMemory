import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../config/index.js";
import { markCanonicalStateChanged, resolveSpanById } from "../linter/storage.js";
import type { Claim, Scope, Source, SourceSpan } from "../types/index.js";
import {
	buildPersistentSeedIndex,
	discoverStructuralCandidates,
	loadPersistentKnowledgeNeighborhood,
} from "./persistent-index.js";
import { type StructuralCandidateTrace, orderStructuralCandidates } from "./structure.js";

const temporaryRoots: string[] = [];
afterEach(() => {
	for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("structure candidate discovery (Goal 3-B)", () => {
	it("applies the fixed ordering contract: seed order, block over source, then source/block/id", () => {
		const root = mkdtempSync(join(tmpdir(), "wge-structure-order-"));
		temporaryRoots.push(root);
		// source:s0 block b0: cA(seed0), cB, cC; block b1: cD, cF
		// source:s1 block b0: cG(seed1), cH
		// source:s3 block b0: cI
		// cA 引用两个同块 span（span:s0b0 / span:s0b0b）以验证同块重复 trace 去重，
		// 以及第三证据 span:s3b0 以验证 viaSourceId 字典序在块路径内生效。
		const cA = fixture("a", "seed alpha", { spans: ["span:s0b0", "span:s0b0b", "span:s3b0"] });
		const cB = fixture("b", "block sibling beta", { spans: ["span:s0b0"] });
		const cC = fixture("c", "block sibling gamma", { spans: ["span:s0b0b"] });
		const cD = fixture("d", "source sibling delta", { spans: ["span:s0b1"] });
		const cF = fixture("f", "source sibling zeta", { spans: ["span:s0b1"] });
		const cG = fixture("g", "seed two", { spans: ["span:s1b0"] });
		const cH = fixture("h", "second seed sibling", { spans: ["span:s1b0"] });
		const cI = fixture("i", "other block sibling", { spans: ["span:s3b0"] });
		const claims = [cA, cB, cC, cD, cF, cG, cH, cI];
		const spans: SourceSpan[] = [
			span("span:s0b0", "source:s0", "b0", cA.statement),
			span("span:s0b0b", "source:s0", "b0", cA.statement),
			span("span:s0b1", "source:s0", "b1", cD.statement),
			span("span:s1b0", "source:s1", "b0", cG.statement),
			span("span:s3b0", "source:s3", "b0", cI.statement),
		];
		const indexRoot = buildIndex(root, claims, spans);

		const result = discoverStructuralCandidates(indexRoot, [cA, cG]);
		// seed0 块路径（source:s0 先于 source:s3）→ seed0 源路径 → seed1 块路径。
		expect(result.candidates.map((candidate) => candidate.claim.id)).toEqual([
			"claim:b",
			"claim:c",
			"claim:i",
			"claim:d",
			"claim:f",
			"claim:h",
		]);
		expect(result.diagnostics.seedCount).toBe(2);
		expect(result.diagnostics.candidateCount).toBe(6);

		// Seed 自身不混入 candidates。
		expect(result.candidates.some((candidate) => candidate.claim.id === "claim:a")).toBe(false);
		expect(result.candidates.some((candidate) => candidate.claim.id === "claim:g")).toBe(false);

		// 多路径 trace 合并：cB 同时被 seed0 的块路径与源路径到达（同块重复 span 已去重）。
		const byId = new Map(result.candidates.map((candidate) => [candidate.claim.id, candidate]));
		expect(
			byId
				.get("claim:b")
				?.traces.map((trace) => trace.pathKind)
				.sort(),
		).toEqual(["SAME_EVIDENCE_BLOCK", "SAME_SOURCE"]);
		expect(byId.get("claim:b")?.traces).toHaveLength(2);
		expect(byId.get("claim:i")?.traces.map((trace) => trace.viaSourceId)).toEqual([
			"source:s3",
			"source:s3",
		]);
		expect(byId.get("claim:d")?.traces).toEqual([
			{
				seedClaimId: "claim:a",
				candidateClaimId: "claim:d",
				pathKind: "SAME_SOURCE",
				viaSourceId: "source:s0",
			},
		]);
		expect(byId.get("claim:h")?.traces[0]).toEqual({
			seedClaimId: "claim:g",
			candidateClaimId: "claim:h",
			pathKind: "SAME_EVIDENCE_BLOCK",
			viaSourceId: "source:s1",
			viaBlockId: "b0",
		});

		// 确定性：重复调用顺序与 trace 完全一致。
		const second = discoverStructuralCandidates(indexRoot, [cA, cG]);
		expect(second.candidates.map((candidate) => candidate.claim.id)).toEqual(
			result.candidates.map((candidate) => candidate.claim.id),
		);
		expect(second.candidates.map((candidate) => candidate.traces)).toEqual(
			result.candidates.map((candidate) => candidate.traces),
		);
	});

	it("honors maxCandidates=0 and truncation with fixed counts", () => {
		const root = mkdtempSync(join(tmpdir(), "wge-structure-truncate-"));
		temporaryRoots.push(root);
		const seed = fixture("seed", "truncation seed", { spans: ["span:s0b0"] });
		const siblings = ["s1", "s2", "s3", "s4", "s5"].map((id) =>
			fixture(id, `sibling ${id}`, { spans: ["span:s0b0"] }),
		);
		const indexRoot = buildIndex(
			root,
			[seed, ...siblings],
			[span("span:s0b0", "source:s0", "b0", seed.statement)],
		);

		const empty = discoverStructuralCandidates(indexRoot, [seed], { maxCandidates: 0 });
		expect(empty.candidates).toEqual([]);
		expect(empty.diagnostics.candidateCount).toBe(0);
		expect(empty.diagnostics.truncatedCount).toBe(5);

		const limited = discoverStructuralCandidates(indexRoot, [seed], { maxCandidates: 2 });
		expect(limited.candidates.map((candidate) => candidate.claim.id)).toEqual([
			"claim:s1",
			"claim:s2",
		]);
		expect(limited.diagnostics.candidateCount).toBe(2);
		expect(limited.diagnostics.truncatedCount).toBe(3);
	});

	it("keeps PERSONAL/PROJECT scope isolation and counts scope exclusions", () => {
		const root = mkdtempSync(join(tmpdir(), "wge-structure-scope-"));
		temporaryRoots.push(root);
		const global = fixture("global", "Scope note global", { spans: ["span:s9b0"] });
		const personalA = fixture("pa", "Scope note alice", { spans: ["span:s9b0"] });
		personalA.scope = { type: "PERSONAL", id: "alice" };
		const personalB = fixture("pb", "Scope note bob", { spans: ["span:s9b0"] });
		personalB.scope = { type: "PERSONAL", id: "bob" };
		const project = fixture("proj", "Scope note apollo", { spans: ["span:s9b0"] });
		project.scope = { type: "PROJECT", id: "apollo" };
		const claims = [global, personalA, personalB, project];
		const indexRoot = buildIndex(root, claims, [
			span("span:s9b0", "source:s9", "b0", global.statement),
		]);

		const globalOnly = discoverStructuralCandidates(indexRoot, [global]);
		expect(globalOnly.candidates).toEqual([]);
		expect(globalOnly.diagnostics.scopeExcludedCount).toBe(3);
		expect(globalOnly.diagnostics.temporalExcludedCount).toBe(0);

		// 无 projectId 时只见 PERSONAL:alice，看不到 PROJECT:apollo。
		const alice = discoverStructuralCandidates(indexRoot, [global], {
			scopeContext: { principalId: "alice" },
		});
		expect(alice.candidates.map((candidate) => candidate.claim.id)).toEqual(["claim:pa"]);
		expect(alice.diagnostics.scopeExcludedCount).toBe(2);

		// 带 projectId 时同时看到 PERSONAL:alice 与 PROJECT:apollo（独立断言）。
		const apollo = discoverStructuralCandidates(indexRoot, [global], {
			scopeContext: { principalId: "alice", projectId: "apollo" },
		});
		expect(new Set(apollo.candidates.map((candidate) => candidate.claim.id))).toEqual(
			new Set(["claim:pa", "claim:proj"]),
		);
		expect(apollo.diagnostics.scopeExcludedCount).toBe(1);

		// scope 不可见的 Seed 不参与发现。
		const bobSeed = discoverStructuralCandidates(indexRoot, [personalB]);
		expect(bobSeed.candidates).toEqual([]);
		expect(bobSeed.diagnostics.seedCount).toBe(0);
	});

	it("applies temporalQuery isolation with lexical visibility semantics", () => {
		const root = mkdtempSync(join(tmpdir(), "wge-structure-temporal-"));
		temporaryRoots.push(root);
		const baseline = fixture("t0", "Temporal baseline note", { spans: ["span:s10b0"] });
		const oldRule = fixture("t1", "2020年3月发布的旧版规范", { spans: ["span:s10b0"] });
		const newRule = fixture("t2", "2021年7月发布的新版规范", { spans: ["span:s10b0"] });
		const undated = fixture("t3", "未注明日期的补充说明", { spans: ["span:s10b0"] });
		const indexRoot = buildIndex(
			root,
			[baseline, oldRule, newRule, undated],
			[span("span:s10b0", "source:s10", "b0", baseline.statement)],
		);

		const result = discoverStructuralCandidates(indexRoot, [baseline], {
			temporalQuery: "从 2020-05 到 2020-08 有什么变化？",
		});
		expect(result.candidates.map((candidate) => candidate.claim.id)).toEqual(["claim:t3"]);
		expect(result.diagnostics.temporalExcludedCount).toBe(2);
		expect(result.diagnostics.scopeExcludedCount).toBe(0);

		// 未激活的 temporalQuery（少于两个显式月份）不排除任何候选。
		const singleMonth = discoverStructuralCandidates(indexRoot, [baseline], {
			temporalQuery: "2020年3月发布了什么？",
		});
		expect(singleMonth.candidates).toHaveLength(3);
		expect(singleMonth.diagnostics.temporalExcludedCount).toBe(0);
	});

	it("resolves child span evidence to its parent block and keeps candidate evidence parseable", () => {
		const root = mkdtempSync(join(tmpdir(), "wge-structure-child-"));
		temporaryRoots.push(root);
		const parentText = "prefix exact evidence suffix";
		const parentSpan: SourceSpan = {
			id: "span:child",
			sourceId: "source:child",
			blockId: "b0",
			charStart: 0,
			charEnd: parentText.length,
			text: parentText,
		};
		const claim = fixture("child", "exact evidence", { spans: ["span:child#chars-7-21"] });
		const sibling = fixture("child-sibling", "same block sibling", {
			spans: ["span:child#chars-0-6"],
		});
		const indexRoot = buildIndex(root, [claim, sibling], [parentSpan]);

		const result = discoverStructuralCandidates(indexRoot, [claim]);
		expect(result.candidates.map((candidate) => candidate.claim.id)).toEqual([
			"claim:child-sibling",
		]);
		expect(result.candidates[0]?.traces[0]).toEqual({
			seedClaimId: "claim:child",
			candidateClaimId: "claim:child-sibling",
			pathKind: "SAME_EVIDENCE_BLOCK",
			viaSourceId: "source:child",
			viaBlockId: "b0",
		});
		// 候选证据必须可解析：子 span 还原到父块内容。
		const resolved = resolveSpanById(
			[parentSpan],
			result.candidates[0]?.claim.evidenceSpanIds[0] ?? "",
		);
		expect(resolved).not.toBeNull();
		expect(resolved?.blockId).toBe("b0");
		expect(resolved?.text).toBe("prefix");
		expect(result.diagnostics.resolvedEvidenceSpanCount).toBe(1);
	});

	it("fails closed when the canonical generation is stale", () => {
		const root = mkdtempSync(join(tmpdir(), "wge-structure-stale-"));
		temporaryRoots.push(root);
		const seed = fixture("seed", "stale seed", { spans: ["span:s0b0"] });
		const sibling = fixture("sib", "stale sibling", { spans: ["span:s0b0"] });
		const indexRoot = buildIndex(
			root,
			[seed, sibling],
			[span("span:s0b0", "source:s0", "b0", seed.statement)],
		);
		markCanonicalStateChanged(loadConfig({ projectRoot: root }), "structure-mutation");
		expect(() => discoverStructuralCandidates(indexRoot, [seed])).toThrow(/index is stale/u);
	});

	it("returns candidates and traces without Relation or graph edge objects", () => {
		const root = mkdtempSync(join(tmpdir(), "wge-structure-shape-"));
		temporaryRoots.push(root);
		const seed = fixture("seed", "no relation seed", { spans: ["span:s0b0"] });
		const sibling = fixture("sib", "no relation sibling", { spans: ["span:s0b0"] });
		const indexRoot = buildIndex(
			root,
			[seed, sibling],
			[span("span:s0b0", "source:s0", "b0", seed.statement)],
		);
		const result = discoverStructuralCandidates(indexRoot, [seed]);
		expect(result.candidates).toHaveLength(1);
		const candidate = result.candidates[0];
		expect(Object.keys(candidate).sort()).toEqual(["claim", "traces"]);
		expect(Object.keys(candidate.traces[0] ?? {}).sort()).toEqual([
			"candidateClaimId",
			"pathKind",
			"seedClaimId",
			"viaBlockId",
			"viaSourceId",
		]);
		expect(Object.keys(result.diagnostics).sort()).toEqual([
			"candidateCount",
			"canonicalStateGeneration",
			"discoveredCandidateCount",
			"indexVersion",
			"inspectedCandidateCount",
			"resolvedEvidenceSpanCount",
			"scopeExcludedCount",
			"seedCount",
			"sourceClaimShardsRead",
			"spanClaimShardsRead",
			"temporalExcludedCount",
			"truncatedCount",
			"unresolvedEvidenceExcludedCount",
		]);
		expect(JSON.stringify(result)).not.toMatch(/"from"|"to"|"relationType"/u);
	});

	it("leaves index and knowledge state files untouched and adds no snapshot directories", () => {
		const root = mkdtempSync(join(tmpdir(), "wge-structure-readonly-"));
		temporaryRoots.push(root);
		const seed = fixture("seed", "readonly seed", { spans: ["span:s0b0"] });
		const sibling = fixture("sib", "readonly sibling", { spans: ["span:s0b0"] });
		const indexRoot = buildIndex(
			root,
			[seed, sibling],
			[span("span:s0b0", "source:s0", "b0", seed.statement)],
		);
		const before = fingerprint(root);
		const snapshotNamesBefore = readdirSync(join(indexRoot, "snapshots")).sort();
		discoverStructuralCandidates(indexRoot, [seed]);
		discoverStructuralCandidates(indexRoot, [seed], { maxCandidates: 0 });
		discoverStructuralCandidates(indexRoot, [seed], { maxCandidates: 1 });
		discoverStructuralCandidates(indexRoot, [seed], {
			scopeContext: { principalId: "alice" },
			temporalQuery: "从 2020-05 到 2020-08 的变化",
		});
		expect(fingerprint(root)).toEqual(before);
		expect(readdirSync(join(indexRoot, "snapshots")).sort()).toEqual(snapshotNamesBefore);
	});

	it("returns an empty result for an empty seed list", () => {
		const root = mkdtempSync(join(tmpdir(), "wge-structure-empty-"));
		temporaryRoots.push(root);
		const seed = fixture("seed", "empty seed", { spans: ["span:s0b0"] });
		const sibling = fixture("sib", "empty sibling", { spans: ["span:s0b0"] });
		const indexRoot = buildIndex(
			root,
			[seed, sibling],
			[span("span:s0b0", "source:s0", "b0", seed.statement)],
		);
		const result = discoverStructuralCandidates(indexRoot, []);
		expect(result.candidates).toEqual([]);
		expect(result.diagnostics).toMatchObject({
			seedCount: 0,
			candidateCount: 0,
			truncatedCount: 0,
			spanClaimShardsRead: 0,
			sourceClaimShardsRead: 0,
			scopeExcludedCount: 0,
			temporalExcludedCount: 0,
		});
	});

	it("excludes every Seed from candidates under multiple seeds and balances diagnostics", () => {
		const root = mkdtempSync(join(tmpdir(), "wge-structure-multi-seed-"));
		temporaryRoots.push(root);
		const seed0 = fixture("seed0", "first seed", { spans: ["span:s0b0"] });
		const seed1 = fixture("seed1", "second seed", { spans: ["span:s0b0"] });
		const sibling = fixture("sib", "plain sibling", { spans: ["span:s0b0"] });
		const indexRoot = buildIndex(
			root,
			[seed0, seed1, sibling],
			[span("span:s0b0", "source:s0", "b0", seed0.statement)],
		);

		const result = discoverStructuralCandidates(indexRoot, [seed0, seed1]);
		const ids = result.candidates.map((candidate) => candidate.claim.id);
		// 排除 seedOrder 中全部 Seed id：另一个 Seed 不得作为新增候选混入。
		expect(ids).not.toContain("claim:seed0");
		expect(ids).not.toContain("claim:seed1");
		expect(ids).toEqual(["claim:sib"]);
		// 账平：unique discovered（去重候选数）= scope + temporal + candidate + truncated + unresolved。
		const { diagnostics } = result;
		expect(diagnostics.scopeExcludedCount).toBe(0);
		expect(diagnostics.temporalExcludedCount).toBe(0);
		expect(diagnostics.truncatedCount).toBe(0);
		expect(diagnostics.unresolvedEvidenceExcludedCount).toBe(0);
		expect(
			diagnostics.scopeExcludedCount +
				diagnostics.temporalExcludedCount +
				diagnostics.candidateCount +
				diagnostics.truncatedCount +
				diagnostics.unresolvedEvidenceExcludedCount,
		).toBe(1);
	});

	it("classifies invisible candidates before truncation so they cannot consume budget", () => {
		const root = mkdtempSync(join(tmpdir(), "wge-structure-filter-before-truncate-"));
		temporaryRoots.push(root);
		const seed = fixture("seed", "budget seed", { spans: ["span:s0b0"] });
		const hiddenA = fixture("ha", "hidden alice scope", { spans: ["span:s0b0"] });
		hiddenA.scope = { type: "PERSONAL", id: "bob" };
		const hiddenB = fixture("hb", "hidden project scope", { spans: ["span:s0b0"] });
		hiddenB.scope = { type: "PROJECT", id: "apollo" };
		const visible = ["va", "vb", "vc"].map((id) =>
			fixture(id, `visible ${id}`, { spans: ["span:s0b0"] }),
		);
		const indexRoot = buildIndex(
			root,
			[seed, hiddenA, hiddenB, ...visible],
			[span("span:s0b0", "source:s0", "b0", seed.statement)],
		);

		const result = discoverStructuralCandidates(indexRoot, [seed], {
			maxCandidates: 3,
			scopeContext: { principalId: "alice" },
		});
		// 不可见候选（ha、hb）先被 scope 排除、不占用预算；可见候选全部返回。
		expect(result.candidates.map((candidate) => candidate.claim.id)).toEqual([
			"claim:va",
			"claim:vb",
			"claim:vc",
		]);
		expect(result.diagnostics.scopeExcludedCount).toBe(2);
		expect(result.diagnostics.truncatedCount).toBe(0);
		// 账平：5 个去重候选 = 2 scope 排除 + 0 temporal + 3 返回 + 0 截断 + 0 unresolved。
		const { diagnostics } = result;
		expect(
			diagnostics.scopeExcludedCount +
				diagnostics.temporalExcludedCount +
				diagnostics.candidateCount +
				diagnostics.truncatedCount +
				diagnostics.unresolvedEvidenceExcludedCount,
		).toBe(5);
	});

	it("drops candidates whose evidence cannot be resolved from v7 spans and counts them", () => {
		const root = mkdtempSync(join(tmpdir(), "wge-structure-unresolved-"));
		temporaryRoots.push(root);
		const seed = fixture("seed", "evidence seed", { spans: ["span:s0b0"] });
		const dangling = fixture("dangling", "dangling evidence sibling", {
			spans: ["span:s0b0", "span:missing"],
		});
		const good = fixture("good", "resolvable sibling", { spans: ["span:s0b0"] });
		const persistedSpans = [span("span:s0b0", "source:s0", "b0", seed.statement)];
		const indexRoot = buildIndex(root, [seed, dangling, good], persistedSpans);

		const result = discoverStructuralCandidates(indexRoot, [seed]);
		expect(result.candidates.map((candidate) => candidate.claim.id)).toEqual(["claim:good"]);
		expect(result.diagnostics.unresolvedEvidenceExcludedCount).toBe(1);
		// 每个返回候选的全部 evidenceSpanIds 均可由 v7 spans 解析。
		for (const candidate of result.candidates) {
			for (const spanId of candidate.claim.evidenceSpanIds) {
				expect(resolveSpanById(persistedSpans, spanId)).not.toBeNull();
			}
		}
		// 账平：2 个去重候选 = 0 + 0 + 1 返回 + 0 截断 + 1 unresolved。
		const { diagnostics } = result;
		expect(
			diagnostics.scopeExcludedCount +
				diagnostics.temporalExcludedCount +
				diagnostics.candidateCount +
				diagnostics.truncatedCount +
				diagnostics.unresolvedEvidenceExcludedCount,
		).toBe(2);
	});

	it("refills the budget after an earlier candidate has unresolved evidence", () => {
		const root = mkdtempSync(join(tmpdir(), "wge-structure-unresolved-refill-"));
		temporaryRoots.push(root);
		const seed = fixture("seed", "evidence refill seed", { spans: ["span:s0b0"] });
		const dangling = fixture("a-dangling", "dangling candidate sorts first", {
			spans: ["span:s0b0", "span:missing"],
		});
		const good = fixture("b-good", "resolvable candidate sorts second", {
			spans: ["span:s0b0"],
		});
		const indexRoot = buildIndex(
			root,
			[seed, dangling, good],
			[span("span:s0b0", "source:s0", "b0", seed.statement)],
		);

		const result = discoverStructuralCandidates(indexRoot, [seed], { maxCandidates: 1 });
		expect(result.candidates.map((candidate) => candidate.claim.id)).toEqual(["claim:b-good"]);
		expect(result.diagnostics).toMatchObject({
			discoveredCandidateCount: 2,
			inspectedCandidateCount: 2,
			unresolvedEvidenceExcludedCount: 1,
			candidateCount: 1,
			truncatedCount: 0,
		});
		expect(
			result.diagnostics.scopeExcludedCount +
				result.diagnostics.temporalExcludedCount +
				result.diagnostics.unresolvedEvidenceExcludedCount +
				result.diagnostics.candidateCount +
				result.diagnostics.truncatedCount,
		).toBe(result.diagnostics.discoveredCandidateCount);
	});

	it("matches the legacy neighborhood sibling candidate set (order-independent)", () => {
		const root = mkdtempSync(join(tmpdir(), "wge-structure-neighborhood-"));
		temporaryRoots.push(root);
		const seed0 = fixture("seed", "seed statement", { spans: ["span:s0b0"] });
		const n1 = fixture("n1", "block sibling one", { spans: ["span:s0b0"] });
		const n2 = fixture("n2", "block sibling two", { spans: ["span:s0b0"] });
		const n3 = fixture("n3", "source sibling three", { spans: ["span:s0b1"] });
		const indexRoot = buildIndex(
			root,
			[seed0, n1, n2, n3],
			[
				span("span:s0b0", "source:s0", "b0", seed0.statement),
				span("span:s0b1", "source:s0", "b1", n3.statement),
			],
		);

		const structural = discoverStructuralCandidates(indexRoot, [seed0]);
		const structuralIds = new Set(structural.candidates.map((candidate) => candidate.claim.id));
		const neighborhood = loadPersistentKnowledgeNeighborhood(indexRoot, [seed0], {
			maxRelationDepth: 0,
			maxClaims: 1000,
			includeEvidenceBlockSiblings: true,
			includeSourceSiblings: true,
		});
		const neighborhoodIds = new Set(neighborhood.claims.map((claim) => claim.id));
		neighborhoodIds.delete(seed0.id);
		// 只对照集合，不要求顺序复用旧实现。
		expect(structuralIds).toEqual(neighborhoodIds);
	});

	it("treats explicit union pathKinds identically to the default behavior", () => {
		const { indexRoot, seed } = buildPathKindsFixture();
		const byDefault = discoverStructuralCandidates(indexRoot, [seed]);
		const explicitUnion = discoverStructuralCandidates(indexRoot, [seed], {
			pathKinds: ["SAME_EVIDENCE_BLOCK", "SAME_SOURCE"],
		});
		expect(explicitUnion).toEqual(byDefault);
		// 默认行为基线：块路径候选先于纯源路径候选，异源候选不出现。
		expect(byDefault.candidates.map((candidate) => candidate.claim.id)).toEqual([
			"claim:b",
			"claim:c",
			"claim:d",
		]);
		expect(byDefault.diagnostics).toMatchObject({
			spanClaimShardsRead: 1,
			sourceClaimShardsRead: 1,
		});
	});

	it("restricts discovery to SAME_EVIDENCE_BLOCK without reading source-claims", () => {
		const { indexRoot, seed } = buildPathKindsFixture();
		const result = discoverStructuralCandidates(indexRoot, [seed], {
			pathKinds: ["SAME_EVIDENCE_BLOCK"],
		});
		// 只保留同证据块候选；同源不同块（d）与异源（e）不出现。
		expect(result.candidates.map((candidate) => candidate.claim.id)).toEqual([
			"claim:b",
			"claim:c",
		]);
		expect(result.diagnostics).toMatchObject({
			spanClaimShardsRead: 1,
			sourceClaimShardsRead: 0,
			discoveredCandidateCount: 2,
		});
		for (const candidate of result.candidates) {
			expect(candidate.traces.every((trace) => trace.pathKind === "SAME_EVIDENCE_BLOCK")).toBe(
				true,
			);
		}
	});

	it("restricts discovery to SAME_SOURCE without reading span-claims, still reaching same-block claims", () => {
		const { indexRoot, seed } = buildPathKindsFixture();
		const result = discoverStructuralCandidates(indexRoot, [seed], {
			pathKinds: ["SAME_SOURCE"],
		});
		// SAME_SOURCE 表达同源路径：允许到达同块 Claim（b、c）与同源其他块（d）；
		// 异源候选（e）不出现。
		expect(result.candidates.map((candidate) => candidate.claim.id)).toEqual([
			"claim:b",
			"claim:c",
			"claim:d",
		]);
		expect(result.diagnostics).toMatchObject({
			spanClaimShardsRead: 0,
			sourceClaimShardsRead: 1,
			discoveredCandidateCount: 3,
		});
		for (const candidate of result.candidates) {
			expect(candidate.traces.every((trace) => trace.pathKind === "SAME_SOURCE")).toBe(true);
		}
		// 同块 Claim 仅经 SAME_SOURCE 到达：不提供块定位。
		expect(result.candidates[0]?.traces[0]).toEqual({
			seedClaimId: "claim:seed",
			candidateClaimId: "claim:b",
			pathKind: "SAME_SOURCE",
			viaSourceId: "source:s0",
		});
	});

	it("returns zero results and reads no adjacency shards for pathKinds=[] while failing closed on stale", () => {
		const { root, indexRoot, seed } = buildPathKindsFixture();
		const result = discoverStructuralCandidates(indexRoot, [seed], { pathKinds: [] });
		expect(result.candidates).toEqual([]);
		expect(result.diagnostics).toMatchObject({
			seedCount: 1,
			candidateCount: 0,
			discoveredCandidateCount: 0,
			inspectedCandidateCount: 0,
			spanClaimShardsRead: 0,
			sourceClaimShardsRead: 0,
			scopeExcludedCount: 0,
			temporalExcludedCount: 0,
			truncatedCount: 0,
			unresolvedEvidenceExcludedCount: 0,
			resolvedEvidenceSpanCount: 0,
		});
		// 空数组仍走 openCurrentIndex 的 stale fail-closed。
		markCanonicalStateChanged(loadConfig({ projectRoot: root }), "structure-mutation");
		expect(() => discoverStructuralCandidates(indexRoot, [seed], { pathKinds: [] })).toThrow(
			/index is stale/u,
		);
	});
});

describe("orderStructuralCandidates pure ordering contract", () => {
	it("prioritizes seed input order over path kind", () => {
		const seedOrder = new Map([
			["seed:z", 0],
			["seed:a", 1],
		]);
		const traces: StructuralCandidateTrace[] = [
			{
				seedClaimId: "seed:z",
				candidateClaimId: "claim:src",
				pathKind: "SAME_SOURCE",
				viaSourceId: "source:1",
			},
			{
				seedClaimId: "seed:a",
				candidateClaimId: "claim:block",
				pathKind: "SAME_EVIDENCE_BLOCK",
				viaSourceId: "source:0",
				viaBlockId: "b0",
			},
			{
				seedClaimId: "seed:z",
				candidateClaimId: "claim:block",
				pathKind: "SAME_EVIDENCE_BLOCK",
				viaSourceId: "source:0",
				viaBlockId: "b0",
			},
			// 完全重复的 trace 必须去重。
			{
				seedClaimId: "seed:z",
				candidateClaimId: "claim:block",
				pathKind: "SAME_EVIDENCE_BLOCK",
				viaSourceId: "source:0",
				viaBlockId: "b0",
			},
		];
		const result = orderStructuralCandidates(traces, seedOrder);
		expect(result.map((aggregate) => aggregate.claimId)).toEqual(["claim:block", "claim:src"]);
		// claim:block 首次出现于 seed:z 块路径；seed:a 的块路径 trace 合并到同一候选。
		expect(result[0]?.traces.map((trace) => trace.seedClaimId)).toEqual(["seed:z", "seed:a"]);
		expect(result[0]?.traces).toHaveLength(2);
		expect(result[1]?.traces).toHaveLength(1);
	});

	it("prioritizes SAME_EVIDENCE_BLOCK over SAME_SOURCE within a seed", () => {
		const traces: StructuralCandidateTrace[] = [
			{
				seedClaimId: "seed:1",
				candidateClaimId: "claim:src",
				pathKind: "SAME_SOURCE",
				viaSourceId: "source:aaa",
			},
			{
				seedClaimId: "seed:1",
				candidateClaimId: "claim:block",
				pathKind: "SAME_EVIDENCE_BLOCK",
				viaSourceId: "source:zzz",
				viaBlockId: "b0",
			},
		];
		const result = orderStructuralCandidates(traces, new Map([["seed:1", 0]]));
		expect(result.map((aggregate) => aggregate.claimId)).toEqual(["claim:block", "claim:src"]);
	});

	it("orders by viaSourceId, then viaBlockId, then candidateClaimId", () => {
		const traces: StructuralCandidateTrace[] = [
			{
				seedClaimId: "seed:1",
				candidateClaimId: "claim:z",
				pathKind: "SAME_EVIDENCE_BLOCK",
				viaSourceId: "source:b",
				viaBlockId: "b0",
			},
			{
				seedClaimId: "seed:1",
				candidateClaimId: "claim:a",
				pathKind: "SAME_EVIDENCE_BLOCK",
				viaSourceId: "source:a",
				viaBlockId: "b9",
			},
			{
				seedClaimId: "seed:1",
				candidateClaimId: "claim:m",
				pathKind: "SAME_EVIDENCE_BLOCK",
				viaSourceId: "source:b",
				viaBlockId: "b0",
			},
		];
		const result = orderStructuralCandidates(traces, new Map([["seed:1", 0]]));
		expect(result.map((aggregate) => aggregate.claimId)).toEqual(["claim:a", "claim:m", "claim:z"]);
	});
});

function buildPathKindsFixture(): { root: string; indexRoot: string; seed: Claim } {
	const root = mkdtempSync(join(tmpdir(), "wge-structure-pathkinds-"));
	temporaryRoots.push(root);
	const seed = fixture("seed", "path kinds seed", { spans: ["span:s0b0"] });
	const blockSibA = fixture("b", "block sibling a", { spans: ["span:s0b0"] });
	const blockSibB = fixture("c", "block sibling b", { spans: ["span:s0b0"] });
	const sourceOnly = fixture("d", "source sibling only", { spans: ["span:s0b1"] });
	const otherSource = fixture("e", "other source sibling", { spans: ["span:s1b0"] });
	const indexRoot = buildIndex(
		root,
		[seed, blockSibA, blockSibB, sourceOnly, otherSource],
		[
			span("span:s0b0", "source:s0", "b0", seed.statement),
			span("span:s0b1", "source:s0", "b1", sourceOnly.statement),
			span("span:s1b0", "source:s1", "b0", otherSource.statement),
		],
	);
	return { root, indexRoot, seed };
}

function buildIndex(root: string, claims: Claim[], spans: SourceSpan[]): string {
	for (const directory of ["sources", "publications", "indexes", "wiki", "quarantine", "runs"]) {
		mkdirSync(join(root, directory), { recursive: true });
	}
	const sourceIds = [...new Set(spans.map((item) => item.sourceId))];
	sourceIds.forEach((sourceId, index) => {
		const source = sourceFixture(sourceId, `source-${index}.md`);
		writeFileSync(join(root, "sources", `s${index}.json`), JSON.stringify(source));
		writeFileSync(
			join(root, "sources", `s${index}.spans.jsonl`),
			`${spans
				.filter((item) => item.sourceId === sourceId)
				.map((item) => JSON.stringify(item))
				.join("\n")}\n`,
		);
	});
	writeFileSync(
		join(root, "publications", "fixture.json"),
		JSON.stringify({
			schemaVersion: "v1",
			sourceId: "source:fixture",
			runId: "test",
			publishedAt: "2026-07-30T00:00:00.000Z",
			claims,
			concepts: [],
			relations: [],
		}),
	);
	buildPersistentSeedIndex(loadConfig({ projectRoot: root }));
	return join(root, "indexes", "retrieval-v1");
}

function fixture(
	id: string,
	statement: string,
	overrides: { spans?: string[]; scope?: Scope } = {},
): Claim {
	const spanId = overrides.spans?.[0] ?? `span:${id}`;
	return {
		id: `claim:${id}`,
		statement,
		evidenceSpanIds: overrides.spans ?? [spanId],
		conditions: [],
		derivation: "EXTRACTED",
		validity: "SUPPORTED",
		lifecycle: "ACTIVE",
		publicationState: "CANONICAL",
		validFrom: null,
		validTo: null,
		compilerVersion: "test",
		confidence: 1,
		claimKind: "FACT",
		scope: overrides.scope ?? { type: "GLOBAL" },
		provenanceRefs: [{ type: "SourceSpan", spanId }],
		supportingEvidenceRefs: [{ type: "SourceSpan", spanId }],
		knowledgeVersion: "test",
		recordedAt: "2026-07-30T00:00:00.000Z",
	};
}

function span(id: string, sourceId: string, blockId: string, text: string): SourceSpan {
	return { id, sourceId, blockId, charStart: 0, charEnd: text.length, text };
}

function sourceFixture(id: string, uri: string): Source {
	return {
		id,
		hash: "hash",
		uri,
		parsedText: "fixture",
		sourceType: "md",
		loaderVersion: "test",
		metadata: {},
		createdAt: "2026-07-30T00:00:00.000Z",
	};
}

function fingerprint(root: string): Array<[string, string]> {
	const result: Array<[string, string]> = [];
	const walk = (directory: string, prefix: string): void => {
		for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
			left.name.localeCompare(right.name),
		)) {
			const path = join(directory, entry.name);
			const relative = join(prefix, entry.name);
			if (entry.isDirectory()) {
				walk(path, relative);
			} else {
				result.push([relative, createHash("sha256").update(readFileSync(path)).digest("hex")]);
			}
		}
	};
	for (const directory of ["sources", "publications", "indexes"]) {
		walk(join(root, directory), directory);
	}
	return result;
}
