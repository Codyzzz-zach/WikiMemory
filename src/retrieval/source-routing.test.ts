import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../config/index.js";
import { markCanonicalStateChanged } from "../linter/storage.js";
import type { Claim, Source, SourceSpan } from "../types/index.js";
import {
	buildPersistentSeedIndex,
	retrieveSourceRoutedSeedsFromPersistentIndex,
} from "./persistent-index.js";
import {
	type SourceRoutingPoolClaim,
	clampSourceRoutingOptions,
	selectSourceRoutedCandidates,
} from "./source-routing.js";

const temporaryRoots: string[] = [];
afterEach(() => {
	for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("selectSourceRoutedCandidates", () => {
	it("clamps budgets to contract maxima and floors at zero", () => {
		expect(clampSourceRoutingOptions({})).toEqual({
			routingPoolBudget: 120,
			sourceBudget: 12,
			candidateBudget: 40,
		});
		expect(
			clampSourceRoutingOptions({ routingPoolBudget: 40, sourceBudget: 5, candidateBudget: 7 }),
		).toEqual({ routingPoolBudget: 40, sourceBudget: 5, candidateBudget: 7 });
		expect(
			clampSourceRoutingOptions({
				routingPoolBudget: 999,
				sourceBudget: 999,
				candidateBudget: 999,
			}),
		).toEqual({ routingPoolBudget: 120, sourceBudget: 12, candidateBudget: 40 });
		expect(
			clampSourceRoutingOptions({ routingPoolBudget: -3, sourceBudget: -1, candidateBudget: -9 }),
		).toEqual({ routingPoolBudget: 0, sourceBudget: 0, candidateBudget: 0 });
		expect(
			clampSourceRoutingOptions({
				routingPoolBudget: 12.9,
				sourceBudget: Number.NaN,
				candidateBudget: Number.POSITIVE_INFINITY,
			}),
		).toEqual({ routingPoolBudget: 12, sourceBudget: 0, candidateBudget: 40 });
	});

	it("ranks sources by earliest lexical rank with deterministic sourceId tie-break", () => {
		const selection = selectSourceRoutedCandidates(
			[
				poolClaim("c1", 1, ["source:z"]),
				poolClaim("c2", 2, ["source:a"]),
				poolClaim("c3", 3, ["source:z", "source:m"]),
				poolClaim("c4", 4, ["source:unselected"]),
			],
			{ routingPoolBudget: 120, sourceBudget: 2, candidateBudget: 10 },
		);
		expect(selection.sources.map((source) => source.sourceId)).toEqual([
			"source:z",
			"source:a",
			"source:m",
			"source:unselected",
		]);
		expect(selection.sources.map((source) => source.firstLexicalRank)).toEqual([1, 2, 3, 4]);
		expect(selection.selectedSourceIds).toEqual(["source:z", "source:a"]);
		expect(selection.candidates.map((candidate) => candidate.claimId)).toEqual(["c1", "c2", "c3"]);
		// tie-break：同一 Claim 映射到两个 sources 时二者同排位，按 sourceId 字典序。
		const tied = selectSourceRoutedCandidates([poolClaim("c1", 1, ["source:z", "source:a"])], {
			routingPoolBudget: 120,
			sourceBudget: 2,
			candidateBudget: 10,
		});
		expect(tied.sources.map((source) => source.sourceId)).toEqual(["source:a", "source:z"]);
	});

	it("guarantees one highest-ranked Claim per selected source, dedupes, then fills in pool order", () => {
		const selection = selectSourceRoutedCandidates(
			[
				poolClaim("c1", 1, ["source:a"]),
				poolClaim("c2", 2, ["source:a", "source:b"]),
				poolClaim("c3", 3, ["source:b"]),
				poolClaim("c4", 4, ["source:b"]),
				poolClaim("c5", 5, ["source:outside"]),
			],
			{ routingPoolBudget: 120, sourceBudget: 2, candidateBudget: 4 },
		);
		expect(selection.candidates.map((candidate) => candidate.claimId)).toEqual([
			"c1",
			"c2",
			"c3",
			"c4",
		]);
		expect(
			selection.candidates.map((candidate) => [candidate.claimId, candidate.guaranteed]),
		).toEqual([
			["c1", true],
			["c2", true],
			["c3", false],
			["c4", false],
		]);
		// c2 同时映射到两个 selected sources。
		expect(selection.candidates[1]?.sourceIds).toEqual(["source:a", "source:b"]);
		// 未选中 source 的 Claim 永远不进入候选。
		expect(selection.candidates.map((candidate) => candidate.claimId)).not.toContain("c5");
		expect(selection.diagnostics).toEqual({
			routingPoolSize: 5,
			discoveredSourceCount: 3,
			selectedSourceCount: 2,
			candidateCount: 4,
		});
	});

	it("routes a multi-source Claim to every selected source and preserves pool order", () => {
		const selection = selectSourceRoutedCandidates(
			[poolClaim("c1", 1, ["source:x"]), poolClaim("c2", 2, ["source:x", "source:y"])],
			{ routingPoolBudget: 120, sourceBudget: 12, candidateBudget: 40 },
		);
		expect(selection.selectedSourceIds).toEqual(["source:x", "source:y"]);
		const bySource = new Map(
			selection.sources.map((source) => [source.sourceId, source.claimIds] as const),
		);
		expect(bySource.get("source:x")).toEqual(["c1", "c2"]);
		expect(bySource.get("source:y")).toEqual(["c2"]);
		expect(selection.candidates.map((candidate) => candidate.claimId)).toEqual(["c1", "c2"]);
		expect(selection.candidates[1]?.sourceIds).toEqual(["source:x", "source:y"]);
	});

	it("honors zero budgets", () => {
		const pool: SourceRoutingPoolClaim[] = [
			poolClaim("c1", 1, ["source:a"]),
			poolClaim("c2", 2, ["source:b"]),
		];
		const emptyPool = selectSourceRoutedCandidates(pool, { routingPoolBudget: 0 });
		expect(emptyPool.candidates).toEqual([]);
		expect(emptyPool.diagnostics.routingPoolSize).toBe(0);
		expect(emptyPool.diagnostics.discoveredSourceCount).toBe(0);

		const noSources = selectSourceRoutedCandidates(pool, { sourceBudget: 0, candidateBudget: 40 });
		expect(noSources.selectedSourceIds).toEqual([]);
		expect(noSources.candidates).toEqual([]);
		expect(noSources.diagnostics.selectedSourceCount).toBe(0);

		const noCandidates = selectSourceRoutedCandidates(pool, { candidateBudget: 0 });
		expect(noCandidates.candidates).toEqual([]);
		expect(noCandidates.diagnostics.discoveredSourceCount).toBe(2);
	});

	it("never exceeds a candidateBudget smaller than the selected source count", () => {
		const pool = Array.from({ length: 12 }, (_, index) =>
			poolClaim(`c${String(index).padStart(2, "0")}`, index + 1, [`source:${index}`]),
		);
		const selection = selectSourceRoutedCandidates(pool, {
			routingPoolBudget: 120,
			sourceBudget: 12,
			candidateBudget: 5,
		});
		expect(selection.candidates).toHaveLength(5);
		expect(selection.selectedSourceIds).toHaveLength(5);
		expect(selection.diagnostics.selectedSourceCount).toBe(5);
		expect(selection.candidates.map((candidate) => candidate.guaranteed)).toEqual([
			true,
			true,
			true,
			true,
			true,
		]);
	});

	it("is deterministic for identical input", () => {
		const pool: SourceRoutingPoolClaim[] = [
			poolClaim("c1", 1, ["source:a"]),
			poolClaim("c2", 2, ["source:b", "source:a"]),
			poolClaim("c3", 3, ["source:c"]),
		];
		const options = { routingPoolBudget: 120, sourceBudget: 2, candidateBudget: 40 };
		const first = selectSourceRoutedCandidates(pool, options);
		const second = selectSourceRoutedCandidates(pool, options);
		expect(JSON.stringify(second)).toBe(JSON.stringify(first));
	});
});

describe("persistent source routing", () => {
	it("discovers sources beyond the top-40 lexical cutoff within the 120 routing pool", () => {
		const root = makeRoot();
		const sourceA = sourceFixture("source:a", "a.md");
		const sourceB = sourceFixture("source:b", "b.md");
		const sourceC = sourceFixture("source:c", "c.md");
		const alphaClaims = Array.from({ length: 40 }, (_, index) =>
			claimFixture(`alpha-${String(index).padStart(3, "0")}`, "quorum alpha term", sourceA.id),
		);
		const betaClaim = claimFixture("beta-000", "quorum alpha term", sourceB.id);
		const gammaClaim = claimFixture("gamma-000", "quorum alpha term", sourceC.id);
		writeCorpus(root, [
			{
				source: sourceA,
				spans: alphaClaims.map((claim) => spanOf(claim, sourceA.id)),
				claims: alphaClaims,
			},
			{ source: sourceB, spans: [spanOf(betaClaim, sourceB.id)], claims: [betaClaim] },
			{ source: sourceC, spans: [spanOf(gammaClaim, sourceC.id)], claims: [gammaClaim] },
		]);
		const config = loadConfig({ projectRoot: root });
		buildPersistentSeedIndex(config);
		const indexRoot = join(root, "indexes", "retrieval-v1");

		const routed = retrieveSourceRoutedSeedsFromPersistentIndex(indexRoot, "quorum alpha term", {
			routingPoolBudget: 120,
			sourceBudget: 12,
			candidateBudget: 40,
		});
		expect(routed.diagnostics.routingPoolClaimCount).toBe(42);
		expect(routed.diagnostics.discoveredSourceCount).toBe(3);
		expect(routed.diagnostics.selectedSourceCount).toBe(3);
		expect(routed.diagnostics.candidateClaimCount).toBe(40);
		// 每个 selected source 的最高排位 Claim 都被保证：beta/gamma 在词法排位 41/42。
		expect(routed.candidates.slice(0, 3).map((candidate) => candidate.claim.id)).toEqual([
			"claim:alpha-000",
			"claim:beta-000",
			"claim:gamma-000",
		]);
		expect(routed.candidates[1]?.guaranteed).toBe(true);
		expect(routed.candidates[1]?.lexicalRank).toBe(41);
		expect(routed.candidates[1]?.routedSourceIds).toEqual(["source:b"]);
		// 剩余名额按 pool 原始词法顺序用 selected sources 填充，绝不超 candidateBudget。
		expect(new Set(routed.candidates.map((candidate) => candidate.claim.id))).toHaveLength(40);
		expect(routed.candidates.map((candidate) => candidate.claim.id)).toContain("claim:beta-000");
		expect(routed.sources.map((source) => source.id)).toEqual(["source:a", "source:b", "source:c"]);
		expect(routed.traces.map((trace) => [trace.sourceId, trace.firstLexicalRank])).toEqual([
			["source:a", 1],
			["source:b", 41],
			["source:c", 42],
		]);

		// L40 对照：routing pool 只有 40 个 Claim，beta/gamma 不在 pool 内。
		const top40 = retrieveSourceRoutedSeedsFromPersistentIndex(indexRoot, "quorum alpha term", {
			routingPoolBudget: 40,
			sourceBudget: 12,
			candidateBudget: 40,
		});
		expect(top40.diagnostics.routingPoolClaimCount).toBe(40);
		expect(top40.diagnostics.discoveredSourceCount).toBe(1);
		expect(top40.diagnostics.selectedSourceCount).toBe(1);
		expect(top40.candidates.map((candidate) => candidate.claim.id)).not.toContain("claim:beta-000");
	});

	it("clamps the routing pool so alias supplements never exceed routingPoolBudget", () => {
		const root = makeRoot();
		const source = sourceFixture("source:alias", "alias.md");
		const baselineClaims = Array.from({ length: 20 }, (_, index) =>
			claimFixture(`base-${String(index).padStart(3, "0")}`, "turbo engine baseline", source.id),
		);
		const aliasClaims = Array.from({ length: 6 }, (_, index) => {
			const claim = claimFixture(
				`alias-${String(index).padStart(3, "0")}`,
				"generic statement",
				source.id,
			);
			claim.retrievalAliases = ["turbo engine generic"];
			return claim;
		});
		const allClaims = [...baselineClaims, ...aliasClaims];
		writeCorpus(root, [
			{
				source,
				spans: allClaims.map((claim) => spanOf(claim, source.id)),
				claims: allClaims,
			},
		]);
		const config = loadConfig({ projectRoot: root });
		buildPersistentSeedIndex(config);
		const indexRoot = join(root, "indexes", "retrieval-v1");

		const routed = retrieveSourceRoutedSeedsFromPersistentIndex(indexRoot, "turbo engine", {
			routingPoolBudget: 22,
			sourceBudget: 12,
			candidateBudget: 40,
		});
		// 词法检索可能返回 20 baseline + 4 alias supplements = 24 个；pool 严格 clamp 到 22。
		expect(routed.diagnostics.routingPoolClaimCount).toBeLessThanOrEqual(22);
		expect(routed.diagnostics.routingPoolClaimCount).toBe(22);
		// alias 补充确实进入 pool（预算内），没有挤掉 baseline。
		const poolAliasCount = routed.traces[0]?.claimIds.filter((claimId) =>
			claimId.startsWith("claim:alias-"),
		).length;
		expect(poolAliasCount).toBeGreaterThan(0);
		expect(routed.candidates.length).toBeLessThanOrEqual(40);
	});

	it("keeps GLOBAL default scope and explicit temporal filtering identical to lexical retrieval", () => {
		const root = makeRoot();
		const source = sourceFixture("source:scope", "scope.md");
		const globalJan = claimFixture("global-jan", "sensor policy note January 2024", source.id);
		const personal = claimFixture("alice-jun", "sensor policy note June 2024", source.id);
		personal.scope = { type: "PERSONAL", id: "alice" };
		const globalJun = claimFixture("global-jun", "sensor policy note June 2024", source.id);
		const project = claimFixture("apollo-jun", "sensor policy note June 2024", source.id);
		project.scope = { type: "PROJECT", id: "apollo" };
		const claims = [globalJan, personal, globalJun, project];
		writeCorpus(root, [
			{
				source,
				spans: claims.map((claim) => spanOf(claim, source.id)),
				claims,
			},
		]);
		const config = loadConfig({ projectRoot: root });
		buildPersistentSeedIndex(config);
		const indexRoot = join(root, "indexes", "retrieval-v1");

		// GLOBAL-only 默认 + 显式月份区间 [2024-01, 2024-02]：只保留 January 2024 的 Claim。
		const winter = retrieveSourceRoutedSeedsFromPersistentIndex(
			indexRoot,
			"sensor policy note 2024-01 2024-02",
		);
		expect(winter.diagnostics.temporalScope.applied).toBe(true);
		expect(winter.diagnostics.temporalScope.startMonth).toBe("2024-01");
		expect(winter.diagnostics.temporalScope.endMonth).toBe("2024-02");
		expect(winter.candidates.map((candidate) => candidate.claim.id)).toEqual(["claim:global-jan"]);

		// 显式 temporalQuery 与 query 内嵌月份语义一致（neighborhood 风格选项）。
		const winterViaOption = retrieveSourceRoutedSeedsFromPersistentIndex(
			indexRoot,
			"sensor policy note",
			{
				temporalQuery: "2024-01 2024-02",
			},
		);
		expect(winterViaOption.candidates.map((candidate) => candidate.claim.id)).toEqual([
			"claim:global-jan",
		]);

		// 扩大区间 + PERSONAL scope：GLOBAL 与本人可见，PROJECT 不可见。
		const alice = retrieveSourceRoutedSeedsFromPersistentIndex(
			indexRoot,
			"sensor policy note 2024-01 2024-06",
			{ scopeContext: { principalId: "alice" } },
		);
		expect(new Set(alice.candidates.map((candidate) => candidate.claim.id))).toEqual(
			new Set(["claim:global-jan", "claim:alice-jun", "claim:global-jun"]),
		);
		expect(alice.candidates.map((candidate) => candidate.claim.id)).not.toContain(
			"claim:apollo-jun",
		);

		// PROJECT scope 显式给出后才可见。
		const apollo = retrieveSourceRoutedSeedsFromPersistentIndex(
			indexRoot,
			"sensor policy note 2024-01 2024-06",
			{ scopeContext: { principalId: "alice", projectId: "apollo" } },
		);
		expect(apollo.candidates.map((candidate) => candidate.claim.id)).toContain("claim:apollo-jun");
	});

	it("resolves child-span evidence to parent sources", () => {
		const root = makeRoot();
		const source = sourceFixture("source:child", "child.md");
		const parentText = "prefix exact evidence suffix";
		const parentSpan: SourceSpan = {
			id: "span:parent",
			sourceId: source.id,
			blockId: "b0",
			charStart: 0,
			charEnd: parentText.length,
			text: parentText,
		};
		const claim = claimFixture("child", "exact evidence", source.id);
		claim.evidenceSpanIds = ["span:parent#chars-7-21"];
		claim.provenanceRefs = [{ type: "SourceSpan", spanId: claim.evidenceSpanIds[0] }];
		claim.supportingEvidenceRefs = [{ type: "SourceSpan", spanId: claim.evidenceSpanIds[0] }];
		writeCorpus(root, [{ source, spans: [parentSpan], claims: [claim] }]);
		const config = loadConfig({ projectRoot: root });
		buildPersistentSeedIndex(config);
		const indexRoot = join(root, "indexes", "retrieval-v1");

		const routed = retrieveSourceRoutedSeedsFromPersistentIndex(indexRoot, "exact evidence");
		expect(routed.candidates.map((candidate) => candidate.claim.id)).toEqual(["claim:child"]);
		expect(routed.candidates[0]?.routedSourceIds).toEqual(["source:child"]);
		expect(routed.diagnostics.unresolvedEvidenceCount).toBe(0);
		expect(routed.diagnostics.unresolvedEvidenceRefCount).toBe(0);
	});

	it("counts unresolved evidence and keeps lexical ranks of later Claims", () => {
		const root = makeRoot();
		const sourceGood = sourceFixture("source:good", "good.md");
		const sourceGood2 = sourceFixture("source:good2", "good2.md");
		const good = claimFixture("good", "orphan evidence term", sourceGood.id);
		const broken = claimFixture("broken", "orphan evidence term", sourceGood.id);
		broken.evidenceSpanIds = ["span:missing"];
		broken.provenanceRefs = [];
		broken.supportingEvidenceRefs = [];
		const good2 = claimFixture("good2", "orphan evidence term", sourceGood2.id);
		writeCorpus(root, [
			{ source: sourceGood, spans: [spanOf(good, sourceGood.id)], claims: [good, broken] },
			{ source: sourceGood2, spans: [spanOf(good2, sourceGood2.id)], claims: [good2] },
		]);
		const config = loadConfig({ projectRoot: root });
		buildPersistentSeedIndex(config);
		const indexRoot = join(root, "indexes", "retrieval-v1");

		const routed = retrieveSourceRoutedSeedsFromPersistentIndex(indexRoot, "orphan evidence term");
		expect(routed.diagnostics.routingPoolClaimCount).toBe(3);
		expect(routed.diagnostics.unresolvedEvidenceCount).toBe(1);
		expect(routed.diagnostics.unresolvedEvidenceRefCount).toBe(1);
		expect(routed.candidates.map((candidate) => candidate.claim.id)).not.toContain("claim:broken");
		expect(routed.sources.map((source) => source.id)).toEqual(["source:good", "source:good2"]);
		// 未解析 Claim 占据词法排位 1（claimId 字典序 tie-break 使其先于 good）；
		// 后续 Claim 保持原始排位，不被压缩。
		expect(
			routed.candidates.map((candidate) => [candidate.claim.id, candidate.lexicalRank]),
		).toEqual([
			["claim:good", 2],
			["claim:good2", 3],
		]);
	});

	it("fails closed on a stale index", () => {
		const root = makeRoot();
		const source = sourceFixture("source:stale", "stale.md");
		const claim = claimFixture("stale", "stale marker term", source.id);
		writeCorpus(root, [{ source, spans: [spanOf(claim, source.id)], claims: [claim] }]);
		const config = loadConfig({ projectRoot: root });
		buildPersistentSeedIndex(config);
		const indexRoot = join(root, "indexes", "retrieval-v1");
		expect(
			retrieveSourceRoutedSeedsFromPersistentIndex(indexRoot, "stale marker term").candidates,
		).toHaveLength(1);
		markCanonicalStateChanged(config, "mutated-after-freeze");
		expect(() =>
			retrieveSourceRoutedSeedsFromPersistentIndex(indexRoot, "stale marker term"),
		).toThrow(/index is stale/u);
	});

	it("is read-only and returns no Relation or Context Pack data", () => {
		const root = makeRoot();
		const source = sourceFixture("source:ro", "ro.md");
		const claim = claimFixture("ro", "read only marker term", source.id);
		writeCorpus(root, [{ source, spans: [spanOf(claim, source.id)], claims: [claim] }]);
		const config = loadConfig({ projectRoot: root });
		buildPersistentSeedIndex(config);
		const indexRoot = join(root, "indexes", "retrieval-v1");
		const before = treeHash(indexRoot);

		const result = retrieveSourceRoutedSeedsFromPersistentIndex(
			indexRoot,
			"read only marker term",
			{
				routingPoolBudget: 120,
				sourceBudget: 12,
				candidateBudget: 40,
			},
		);
		retrieveSourceRoutedSeedsFromPersistentIndex(indexRoot, "read only marker term", {
			routingPoolBudget: 5,
			sourceBudget: 1,
			candidateBudget: 2,
			scopeContext: { principalId: "alice" },
		});
		expect(treeHash(indexRoot)).toBe(before);
		expect(Object.keys(result).sort()).toEqual(["candidates", "diagnostics", "sources", "traces"]);
		expect(Object.keys(result.candidates[0] ?? {}).sort()).toEqual([
			"claim",
			"guaranteed",
			"lexicalRank",
			"routedSourceIds",
		]);
		expect(result.sources).toHaveLength(1);
		expect(result.sources[0]?.id).toBe("source:ro");
		expect(result.candidates[0]?.guaranteed).toBe(true);
	});

	it("produces identical output across repeated runs", () => {
		const root = makeRoot();
		const sourceA = sourceFixture("source:det-a", "det-a.md");
		const sourceB = sourceFixture("source:det-b", "det-b.md");
		const claimA = claimFixture("det-a", "deterministic routing term", sourceA.id);
		const claimB = claimFixture("det-b", "deterministic routing term", sourceB.id);
		writeCorpus(root, [
			{ source: sourceA, spans: [spanOf(claimA, sourceA.id)], claims: [claimA] },
			{ source: sourceB, spans: [spanOf(claimB, sourceB.id)], claims: [claimB] },
		]);
		const config = loadConfig({ projectRoot: root });
		buildPersistentSeedIndex(config);
		const indexRoot = join(root, "indexes", "retrieval-v1");
		const options = { routingPoolBudget: 120, sourceBudget: 12, candidateBudget: 40 };
		const first = retrieveSourceRoutedSeedsFromPersistentIndex(
			indexRoot,
			"deterministic routing term",
			options,
		);
		const second = retrieveSourceRoutedSeedsFromPersistentIndex(
			indexRoot,
			"deterministic routing term",
			options,
		);
		expect(JSON.stringify(second)).toBe(JSON.stringify(first));
	});
});

function poolClaim(
	claimId: string,
	lexicalRank: number,
	sourceIds: string[],
): SourceRoutingPoolClaim {
	return { claimId, lexicalRank, sourceIds };
}

function makeRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "wge-source-routing-"));
	temporaryRoots.push(root);
	for (const directory of ["sources", "publications", "indexes", "wiki", "quarantine", "runs"]) {
		mkdirSync(join(root, directory), { recursive: true });
	}
	return root;
}

interface CorpusEntry {
	source: Source;
	spans: SourceSpan[];
	claims: Claim[];
}

function writeCorpus(root: string, entries: CorpusEntry[]): void {
	for (const [index, entry] of entries.entries()) {
		writeFileSync(join(root, "sources", `s${index}.json`), JSON.stringify(entry.source));
		writeFileSync(
			join(root, "sources", `s${index}.spans.jsonl`),
			`${entry.spans.map((span) => JSON.stringify(span)).join("\n")}\n`,
		);
		writeFileSync(
			join(root, "publications", `p${index}.json`),
			JSON.stringify({
				schemaVersion: "v1",
				sourceId: entry.source.id,
				runId: "test",
				publishedAt: "2026-07-30T00:00:00.000Z",
				claims: entry.claims,
				concepts: [],
				relations: [],
			}),
		);
	}
}

function claimFixture(id: string, statement: string, _sourceId: string): Claim {
	const spanId = `span:${id}`;
	return {
		id: `claim:${id}`,
		statement,
		evidenceSpanIds: [spanId],
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
		scope: { type: "GLOBAL" },
		provenanceRefs: [{ type: "SourceSpan", spanId }],
		supportingEvidenceRefs: [{ type: "SourceSpan", spanId }],
		knowledgeVersion: "test",
		recordedAt: "2026-07-30T00:00:00.000Z",
	};
}

function spanOf(claim: Claim, sourceId: string): SourceSpan {
	const spanId = claim.evidenceSpanIds[0] ?? "";
	return {
		id: spanId,
		sourceId,
		blockId: "b0",
		charStart: 0,
		charEnd: claim.statement.length,
		text: claim.statement,
	};
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

/** 递归汇总 indexRoot 下全部文件内容的 sha256，用于验证只读性。 */
function treeHash(root: string): string {
	const files: string[] = [];
	const walk = (directory: string): void => {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const path = join(directory, entry.name);
			if (entry.isDirectory()) walk(path);
			else files.push(path);
		}
	};
	walk(root);
	const digest = createHash("sha256");
	for (const path of files.sort()) {
		digest.update(path);
		digest.update(readFileSync(path));
	}
	return digest.digest("hex");
}
