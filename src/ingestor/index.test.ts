import { describe, expect, it } from "vitest";
import type { SourceSpan } from "../types/index.js";
import { mapQuoteToSpan } from "./index.js";

describe("format-normalized quote mapping", () => {
	it.each([
		["1. $0$ 是自然数\n2. 每个自然数 $n$ 有一个**后继** $S(n)$", "每个自然数 n 有一个后继 S(n)"],
		[
			"| 加法封闭 | $a,b \\in \\mathbb{N} \\Rightarrow a+b \\in \\mathbb{N}$ | $3+5=8$ |",
			"加法封闭: a,b ∈ ℕ ⇒ a+b ∈ ℕ",
		],
		[
			"$$\\mathbb{C} = \\{a + bi \\mid a,b \\in \\mathbb{R}, i^2 = -1\\}$$",
			"ℂ = {a + bi | a,b ∈ ℝ, i² = -1}",
		],
		[
			"$$\\mathbb{Q} = \\left\\{\\frac{a}{b} \\;\\middle|\\; a,b \\in \\mathbb{Z}, b \\neq 0\\right\\}$$",
			"ℚ = { a/b | a,b ∈ ℤ, b ≠ 0 }",
		],
		[
			"**代数基本定理**：任何 $n$ 次复系数多项式在 $\\mathbb{C}$ 中恰好有 $n$ 个根（计重数）。",
			"任何 n 次复系数多项式在 ℂ 中恰好有 n 个根（计重数）。",
		],
	])("maps rendered text back to an exact source interval", (sourceText, quote) => {
		const base = span(sourceText);
		const mapped = mapQuoteToSpan([base], base.blockId, quote);
		expect(mapped).not.toBeNull();
		expect(mapped?.id).toMatch(/#chars-\d+-\d+$/);
		expect(sourceText.includes(mapped?.text ?? "missing")).toBe(true);
	});

	it("rejects ambiguous normalized matches", () => {
		const base = span("$x$ 是数；$x$ 是数");
		expect(mapQuoteToSpan([base], base.blockId, "x 是数")).toBeNull();
	});

	it("maps a unique partial table row to the complete table context", () => {
		const base = span(
			"| 结构 | $\\mathbb{N}$ | $\\mathbb{Z}$ |\n|---|---|---|\n| 加法逆元 | ❌ | ✅ 每个 $a$ 有 $-a$ |\n| 乘法逆元 | ❌ | ❌ |",
		);
		const mapped = mapQuoteToSpan([base], base.blockId, "加法逆元 | ✅ 每个 $a$ 有 $-a$");
		expect(mapped).toEqual(base);
		expect(mapQuoteToSpan([base], base.blockId, "| 加法逆元 | ❌ | ✅ 每个 $a$ 有 $-a$ |")).toEqual(
			base,
		);
	});

	it("normalizes the LaTeX section sign without changing source offsets", () => {
		const base = span("这在 $\\S$3 数列与极限中是基石。");
		const mapped = mapQuoteToSpan([base], base.blockId, "这在 §3 数列与极限中是基石。");
		expect(mapped?.text).toContain("$\\S$3");
		expect(base.text.includes(mapped?.text ?? "missing")).toBe(true);
	});
});

function span(text: string): SourceSpan {
	return {
		id: "span:test-0",
		sourceId: "source:test",
		blockId: "block-0",
		charStart: 100,
		charEnd: 100 + text.length,
		text,
	};
}
