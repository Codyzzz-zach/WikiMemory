import { describe, expect, it } from "vitest";
import type { SourceSpan } from "../types/index.js";
import {
	type EvidenceRequirement,
	canonicalSourceIdsMatch,
	evaluateEvidenceCoverage,
	normalizeEvidenceQuote,
} from "./evidence-coverage.js";

function makeSpan(
	id: string,
	text: string,
	charStart: number,
	sourceId: string,
	blockId = "block-0",
): SourceSpan {
	return {
		id,
		sourceId,
		blockId,
		charStart,
		charEnd: charStart + text.length,
		text,
	};
}

const BASE = "The quick brown fox";
const SPAN = makeSpan("span:book1#block-0", BASE, 0, "source:book1-doc-v1-testhash");
const CHILD_QUICK = `${SPAN.id}#chars-4-9`;
const CHILD_BROWN = `${SPAN.id}#chars-10-15`;
const CHILD_FOX = `${SPAN.id}#chars-16-19`;

describe("evaluateEvidenceCoverage (goal3 evidence-coverage rescore contract v1)", () => {
	it("adjacent child ranges match regardless of candidate order", () => {
		const requirements: EvidenceRequirement[] = [
			{ sourceId: "book1-doc-v1", exactQuote: "quick brown" },
		];
		const forward = evaluateEvidenceCoverage([SPAN], [CHILD_QUICK, CHILD_BROWN], requirements);
		const reversed = evaluateEvidenceCoverage([SPAN], [CHILD_BROWN, CHILD_QUICK], requirements);
		expect(forward.matchedEvidence).toEqual(requirements);
		expect(forward.matchedCount).toBe(1);
		expect(forward.recall).toBe(1);
		// The whitespace gap between the two children is bridged into one segment.
		expect(forward.closureSegments).toHaveLength(1);
		expect(forward.closureSegments[0]?.text).toBe("quick brown");
		expect(reversed.matchedEvidence).toEqual(forward.matchedEvidence);
	});

	it("whitespace-only gaps may bridge; non-whitespace gaps may not", () => {
		// chars-4-9 ("quick") and chars-10-15 ("brown") are separated by a single
		// space in the persisted base text: they must merge.
		const bridged = evaluateEvidenceCoverage(
			[SPAN],
			[CHILD_QUICK, CHILD_BROWN],
			[{ sourceId: "book1-doc-v1", exactQuote: "quick brown" }],
		);
		expect(bridged.closureSegments).toHaveLength(1);
		expect(bridged.matchedCount).toBe(1);

		// chars-4-9 ("quick") and chars-16-19 ("fox") have " brown " between them:
		// they must NOT merge, so "quick fox" cannot be reconstructed.
		const notBridged = evaluateEvidenceCoverage(
			[SPAN],
			[CHILD_QUICK, CHILD_FOX],
			[{ sourceId: "book1-doc-v1", exactQuote: "quick fox" }],
		);
		expect(notBridged.closureSegments).toHaveLength(2);
		expect(notBridged.closureSegments.map((segment) => segment.text)).toEqual(["quick", "fox"]);
		expect(notBridged.matchedCount).toBe(0);
		expect(notBridged.missingEvidence).toHaveLength(1);
	});

	it("identical quote text in the wrong source does not match", () => {
		const spanA = makeSpan("span:bookA#block-0", "shared phrase here", 0, "source:bookA-doc-v1");
		const spanB = makeSpan("span:bookB#block-0", "shared phrase here", 0, "source:bookB-doc-v1");
		const result = evaluateEvidenceCoverage(
			[spanA, spanB],
			[`${spanB.id}#chars-0-5`],
			[{ sourceId: "bookA-doc-v1", exactQuote: "shared" }],
		);
		expect(result.matchedCount).toBe(0);
		expect(result.missingEvidence).toEqual([{ sourceId: "bookA-doc-v1", exactQuote: "shared" }]);
		expect(result.missingEvidenceKeys).toEqual(["bookA-doc-v1\u0000shared"]);
	});

	it("a full persisted span matches normally", () => {
		const markdownSpan = makeSpan(
			"span:book1#block-1",
			"> 引言：**快速** 和 `慢速`",
			0,
			"source:book1-doc-v1-testhash",
		);
		const result = evaluateEvidenceCoverage(
			[markdownSpan],
			[markdownSpan.id],
			[{ sourceId: "book1-doc-v1", exactQuote: "**快速** 和 `慢速`" }],
		);
		expect(result.matchedCount).toBe(1);
		expect(result.recall).toBe(1);
		// The reconstructed segment equals the persisted span text.
		expect(result.closureSegments).toHaveLength(1);
		expect(result.closureSegments[0]?.text).toBe(markdownSpan.text);
	});

	it("candidate order does not change the result", () => {
		const requirements: EvidenceRequirement[] = [
			{ sourceId: "book1-doc-v1", exactQuote: "brown" },
			{ sourceId: "other-doc", exactQuote: "fox" },
		];
		const orderA = evaluateEvidenceCoverage(
			[SPAN],
			[CHILD_QUICK, CHILD_BROWN, CHILD_FOX],
			requirements,
		);
		const orderB = evaluateEvidenceCoverage(
			[SPAN],
			[CHILD_FOX, CHILD_QUICK, CHILD_BROWN],
			requirements,
		);
		expect(orderB).toEqual(orderA);
		expect(orderA.matchedCount).toBe(1);
		expect(orderA.missingEvidence).toHaveLength(1);
	});

	it("duplicate candidate ids do not change the result", () => {
		const requirements: EvidenceRequirement[] = [
			{ sourceId: "book1-doc-v1", exactQuote: "quick brown" },
		];
		const deduplicated = evaluateEvidenceCoverage([SPAN], [CHILD_QUICK, CHILD_BROWN], requirements);
		const duplicated = evaluateEvidenceCoverage(
			[SPAN],
			[CHILD_QUICK, CHILD_QUICK, CHILD_BROWN, CHILD_BROWN],
			requirements,
		);
		expect(duplicated).toEqual(deduplicated);
	});

	it("throws fail-closed on an unresolved child span id", () => {
		expect(() => evaluateEvidenceCoverage([SPAN], [`${SPAN.id}#chars-90-95`], [])).toThrow(
			/Unresolved/,
		);
		expect(() =>
			evaluateEvidenceCoverage([SPAN], ["span:nonexistent#block-0#chars-0-5"], []),
		).toThrow(/Unresolved/);
		expect(() => evaluateEvidenceCoverage([SPAN], ["not-a-span-id"], [])).toThrow(/Unresolved/);
	});

	it("canonical sourceId prefix matching follows the benchmark semantics", () => {
		const canonicalSpan = makeSpan(
			"span:health#block-0",
			"vaccine efficacy",
			0,
			"source:health-who-july-2020-002-50fd4599b9553875",
		);
		// canonical = "source:" + benchmarkId + "-" prefix: matches.
		const matched = evaluateEvidenceCoverage(
			[canonicalSpan],
			[canonicalSpan.id],
			[{ sourceId: "health-who-july-2020-002", exactQuote: "vaccine efficacy" }],
		);
		expect(matched.matchedCount).toBe(1);

		// A different benchmark id must not match.
		const different = evaluateEvidenceCoverage(
			[canonicalSpan],
			[canonicalSpan.id],
			[{ sourceId: "health-who-july-2020-003", exactQuote: "vaccine efficacy" }],
		);
		expect(different.matchedCount).toBe(0);

		// Exact equality also matches.
		expect(
			canonicalSourceIdsMatch(
				"source:health-who-july-2020-002-50fd4599b9553875",
				"source:health-who-july-2020-002-50fd4599b9553875",
			),
		).toBe(true);
	});

	it("does not concatenate across base spans or sources", () => {
		const spanA = makeSpan("span:bookA#block-0", "alpha", 0, "source:bookA-doc-v1");
		const spanB = makeSpan("span:bookB#block-0", "beta", 0, "source:bookB-doc-v1");
		const result = evaluateEvidenceCoverage(
			[spanA, spanB],
			[spanA.id, spanB.id],
			[{ sourceId: "bookA-doc-v1", exactQuote: "alphabeta" }],
		);
		expect(result.closureSegments).toHaveLength(2);
		expect(result.matchedCount).toBe(0);
	});

	it("returns null recall when no requirements exist", () => {
		const result = evaluateEvidenceCoverage([SPAN], [CHILD_QUICK], []);
		expect(result.matchedCount).toBe(0);
		expect(result.requiredCount).toBe(0);
		expect(result.recall).toBeNull();
		expect(result.matchedEvidence).toEqual([]);
		expect(result.missingEvidence).toEqual([]);
		expect(result.matchedEvidenceKeys).toEqual([]);
		expect(result.missingEvidenceKeys).toEqual([]);
	});

	it("rejects empty source or normalized quote requirements", () => {
		expect(() =>
			evaluateEvidenceCoverage([SPAN], [CHILD_QUICK], [{ sourceId: "", exactQuote: "quick" }]),
		).toThrow(/non-empty/);
		expect(() =>
			evaluateEvidenceCoverage(
				[SPAN],
				[CHILD_QUICK],
				[{ sourceId: "book1-doc-v1", exactQuote: "  ** `  " }],
			),
		).toThrow(/non-empty/);
	});

	it("normalizes quotes identically to run-goal3-source-routing.ts", () => {
		expect(normalizeEvidenceQuote("  > # **强调** `代码`  行 ")).toBe("# 强调 代码 行");
		expect(normalizeEvidenceQuote("ＡＢＣ　１２３")).toBe("ABC 123");
	});
});
