import { describe, expect, it } from "vitest";
import { parseMarkdownContent } from "./markdown.js";

describe("Markdown block provenance", () => {
	it("preserves blank lines inside a contiguous numbered list", () => {
		const body = [
			"# Terminology",
			"",
			"1. Airborne transmission or inhalation",
			"",
			"2. Direct deposition",
			"",
		].join("\n");
		const parsed = parseMarkdownContent(body, "terminology", "terminology.md");
		const list = parsed.blocks.find((block) => block.kind === "list_item");

		expect(list?.text).toBe("1. Airborne transmission or inhalation\n\n2. Direct deposition");
		expect(parsed.body.slice(list?.charStart, list?.charEnd)).toBe(list?.text);
	});

	it("keeps every emitted block exactly traceable to the parsed body", () => {
		const body = "# H\n\n- first\n\n- second\n\nparagraph\n";
		const parsed = parseMarkdownContent(body, "sample", "sample.md");

		for (const block of parsed.blocks) {
			expect(parsed.body.slice(block.charStart, block.charEnd)).toBe(block.text);
		}
	});
});
