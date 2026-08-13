import { describe, expect, it } from "vitest";
import type { SourceSpan } from "../types/index.js";
import {
	buildEvidenceIntervalProjection,
	measureTextCost,
	stableStringify,
} from "./pack-cost-ledger.js";

const base: SourceSpan = {
	id: "span:base-1",
	sourceId: "source:one",
	blockId: "block:one",
	charStart: 100,
	charEnd: 120,
	text: "abcdefghijklmnopqrst",
};

describe("pack cost ledger evidence projection", () => {
	it("merges overlap and strict adjacency while preserving the exact interval union", () => {
		const projection = buildEvidenceIntervalProjection(
			[base],
			["span:base-1#chars-100-106", "span:base-1#chars-104-110", "span:base-1#chars-110-114"],
		);

		expect(projection.raw).toHaveLength(3);
		expect(projection.merged).toEqual([
			{
				baseSpanId: "span:base-1",
				sourceId: "source:one",
				blockId: "block:one",
				charStart: 100,
				charEnd: 114,
				spanIds: [
					"span:base-1#chars-100-106",
					"span:base-1#chars-104-110",
					"span:base-1#chars-110-114",
				],
				text: "abcdefghijklmn",
			},
		]);
		expect(projection.intervalUnionPreserved).toBe(true);
		expect(projection.mergedUnionHash).toBe(projection.rawUnionHash);
	});

	it("does not absorb even a whitespace-only gap", () => {
		const whitespaceBase: SourceSpan = { ...base, text: "abcd  ghijklmnopqrst" };
		const projection = buildEvidenceIntervalProjection(
			[whitespaceBase],
			["span:base-1#chars-100-104", "span:base-1#chars-106-110"],
		);

		expect(projection.merged).toHaveLength(2);
		expect(projection.intervalUnionPreserved).toBe(true);
	});

	it("fails closed on an invalid child span", () => {
		expect(() => buildEvidenceIntervalProjection([base], ["span:base-1#chars-99-104"])).toThrow(
			"Invalid child evidence span",
		);
	});
});

describe("pack cost ledger serialization", () => {
	it("sorts object keys without changing array order", () => {
		expect(stableStringify({ z: 1, nested: { b: 2, a: 1 }, ranked: ["b", "a"] })).toBe(
			'{"nested":{"a":1,"b":2},"ranked":["b","a"],"z":1}',
		);
	});

	it("reports exact UTF-8 bytes and the repository token estimate", () => {
		expect(measureTextCost("abcd中")).toEqual({
			utf8Bytes: 7,
			characters: 5,
			estimatedTokens: 2,
		});
	});
});
