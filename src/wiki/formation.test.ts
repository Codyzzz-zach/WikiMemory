import { describe, expect, it } from "vitest";
import type { Claim, SourceSpan } from "../types/index.js";
import { chunkWikiFormationSection, formWikiModuleSeeds } from "./formation.js";

describe("task-blind Wiki formation", () => {
	it("forms deterministic section modules without a question or Gold input", () => {
		const spans = [heading("source:a", 0, "发布规则"), body("source:a", 1, "规则正文")];
		const claims = [
			claim("claim:b", spans[1] as SourceSpan),
			claim("claim:a", spans[1] as SourceSpan),
		];
		const forward = formWikiModuleSeeds({ claims, relations: [], spans });
		const reversed = formWikiModuleSeeds({
			claims: [...claims].reverse(),
			relations: [],
			spans: [...spans].reverse(),
		});

		expect(forward.seeds).toEqual(reversed.seeds);
		expect(forward.seeds).toHaveLength(1);
		expect(forward.seeds[0]?.claimRefs).toEqual(["claim:a", "claim:b"]);
		expect(forward.seeds[0]?.coreQuestion).toBe("关于“发布规则”的当前知识是什么？");
	});

	it("fails closed for stale, unresolved-evidence and singleton sections", () => {
		const spans = [
			heading("source:a", 0, "第一节"),
			body("source:a", 1, "正文一"),
			heading("source:a", 2, "第二节"),
			body("source:a", 3, "正文二"),
		];
		const good = claim("claim:singleton", spans[1] as SourceSpan);
		const stale = {
			...claim("claim:stale", spans[3] as SourceSpan),
			lifecycle: "SUPERSEDED" as const,
		};
		const missing = {
			...claim("claim:missing", spans[3] as SourceSpan),
			evidenceSpanIds: ["span:missing"],
		};
		const result = formWikiModuleSeeds({ claims: [good, stale, missing], relations: [], spans });

		expect(result.seeds).toEqual([]);
		expect(
			Object.fromEntries(result.decisions.map((decision) => [decision.claimId, decision.reason])),
		).toEqual({
			"claim:missing": "evidence-not-resolvable",
			"claim:singleton": "section-below-minimum",
			"claim:stale": "claim-not-consumable",
		});
	});

	it("splits oversized sections with stable bounded membership", () => {
		const spans = [heading("source:a", 0, "大章节"), body("source:a", 1, "正文")];
		const claims = Array.from({ length: 5 }, (_, index) =>
			claim(`claim:${index}`, spans[1] as SourceSpan),
		);
		const result = formWikiModuleSeeds(
			{ claims, relations: [], spans },
			{ minClaimsPerModule: 2, maxClaimsPerModule: 3 },
		);

		expect(result.seeds.map((seed) => seed.claimRefs.length)).toEqual([3, 2]);
		expect(new Set(result.seeds.map((seed) => seed.stableAddress)).size).toBe(2);
	});

	it("rebalances a singleton tail instead of silently dropping knowledge", () => {
		const span = body("source:a", 1, "正文");
		const items = Array.from({ length: 13 }, (_, index) => ({ id: index, span }));

		expect(chunkWikiFormationSection(items, 12, 4000).map((chunk) => chunk.length)).toEqual([
			11, 2,
		]);
	});

	it("keeps unrelated module identities and memberships stable after a local addition", () => {
		const spans = [
			heading("source:a", 0, "章节 A"),
			body("source:a", 1, "正文 A"),
			heading("source:a", 2, "章节 B"),
			body("source:a", 3, "正文 B"),
		];
		const baseClaims = [
			claim("claim:a1", spans[1] as SourceSpan),
			claim("claim:a2", spans[1] as SourceSpan),
			claim("claim:b1", spans[3] as SourceSpan),
			claim("claim:b2", spans[3] as SourceSpan),
		];
		const before = formWikiModuleSeeds({ claims: baseClaims, relations: [], spans });
		const after = formWikiModuleSeeds({
			claims: [...baseClaims, claim("claim:a3", spans[1] as SourceSpan)],
			relations: [],
			spans,
		});
		const beforeB = before.seeds.find((seed) => seed.stableAddress.includes("章节-b"));
		const afterB = after.seeds.find((seed) => seed.stableAddress.includes("章节-b"));

		expect(afterB).toEqual(beforeB);
	});

	it("rejects one Claim whose complete evidence closure exceeds the module budget", () => {
		const spans = [
			heading("source:a", 0, "预算"),
			body("source:a", 1, "a".repeat(300)),
			body("source:a", 2, "短证据"),
		];
		const oversized = claim("claim:oversized", spans[1] as SourceSpan);
		const result = formWikiModuleSeeds(
			{
				claims: [oversized, claim("claim:small", spans[2] as SourceSpan)],
				relations: [],
				spans,
			},
			{ maxEvidenceCharsPerModule: 256 },
		);

		expect(result.decisions.find((item) => item.claimId === oversized.id)?.reason).toBe(
			"claim-evidence-budget-exceeded",
		);
	});
});

function heading(sourceId: string, order: number, title: string): SourceSpan {
	return {
		id: `span:${sourceId}:${order}`,
		sourceId,
		blockId: `${sourceId}#block-${order}`,
		charStart: 0,
		charEnd: title.length,
		text: `## ${title}`,
	};
}

function body(sourceId: string, order: number, text: string): SourceSpan {
	return {
		id: `span:${sourceId}:${order}`,
		sourceId,
		blockId: `${sourceId}#block-${order}`,
		charStart: 0,
		charEnd: text.length,
		text,
	};
}

function claim(id: string, span: SourceSpan): Claim {
	return {
		id,
		statement: `${id} 的事实`,
		evidenceSpanIds: [span.id],
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
		provenanceRefs: [],
		supportingEvidenceRefs: [],
		knowledgeVersion: "kv:test",
		recordedAt: "2026-08-12T00:00:00.000Z",
	};
}
