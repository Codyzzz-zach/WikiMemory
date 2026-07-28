/**
 * Ingestor — 机械摄入层
 *
 * 把原始材料（MD/PDF/HTML）变成不可变的 Source + SourceSpan。
 * 纯机械操作——不调 LLM、不做语义判断。
 *
 * 产出：
 * - Source（写入 sources/<sourceId>.json）
 * - SourceSpan 列表（每个 block 一个 span，写入 sources/<sourceId>.spans.jsonl）
 * - manifest 条目（追加到 manifest.jsonl）
 *
 * 修 GPT 问题 7：charStart/charEnd 由 parser 机械生成。
 */

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AppConfig } from "../config/types.js";
import { createDefaultLoaderRegistry } from "../loaders/registry.js";
import type { LoadedDocument, LoaderRegistry } from "../loaders/types.js";
import type { Source, SourceSpan } from "../types/index.js";

/** 摄入结果 */
export interface IngestResult {
	source: Source;
	spans: SourceSpan[];
	isDuplicate: boolean;
}

/**
 * 摄入一个 Markdown 文件。
 *
 * @param config - 应用配置
 * @param filePath - MD 文件路径
 * @returns 摄入结果（Source + SourceSpan 列表）
 */
export function ingestFile(
	config: AppConfig,
	filePath: string,
	registry: LoaderRegistry = createDefaultLoaderRegistry(),
): IngestResult {
	const loader = registry.resolve(filePath);
	return ingestLoadedDocument(config, loader.load(filePath));
}

/** 向后兼容入口；Markdown 也必须经过统一 Loader registry。 */
export function ingestMarkdownFile(config: AppConfig, filePath: string): IngestResult {
	const result = ingestFile(config, filePath);
	if (result.source.sourceType !== "md")
		throw new Error(`期望 Markdown Loader，实际为 ${result.source.sourceType}`);
	return result;
}

export function ingestLoadedDocument(config: AppConfig, loaded: LoadedDocument): IngestResult {
	validateLoadedDocument(loaded);
	const fileStem = loaded.sourceKey;

	// ── 计算 hash（基于正文内容去重）──
	const hash = createHash("sha256").update(loaded.parsedText).digest("hex").slice(0, 16);

	const sourceId = `source:${fileStem}-${hash}`;

	// ── 检查是否已存在（去重）──
	const sourcePath = join(config.sourcesDir, `${sourceId.replace("source:", "")}.json`);
	if (existsSync(sourcePath)) {
		// 已摄入过，读回返回
		const existing = JSON.parse(readFileSync(sourcePath, "utf-8")) as Source;
		const spansPath = join(config.sourcesDir, `${sourceId.replace("source:", "")}.spans.jsonl`);
		const spansRaw = existsSync(spansPath)
			? readFileSync(spansPath, "utf-8")
					.trim()
					.split("\n")
					.filter(Boolean)
					.map((l) => JSON.parse(l) as SourceSpan)
			: [];
		return { source: existing, spans: spansRaw, isDuplicate: true };
	}

	// ── 创建 Source ──
	const source: Source = {
		id: sourceId,
		hash,
		uri: loaded.uri,
		parsedText: loaded.parsedText,
		sourceType: loaded.sourceType,
		loaderVersion: loaded.loaderVersion,
		metadata: loaded.metadata,
		createdAt: new Date().toISOString(),
	};

	// ── 从 blocks 生成 SourceSpan（每个 block 一个 span）──
	const spans: SourceSpan[] = loaded.blocks.map((block, idx) => ({
		id: `span:${fileStem}-${hash}-${idx}`,
		sourceId,
		blockId: block.blockId,
		charStart: block.charStart,
		charEnd: block.charEnd,
		text: block.text,
	}));

	// ── 写入文件系统 ──
	mkdirSync(config.sourcesDir, { recursive: true });

	const sourceFile = join(config.sourcesDir, `${sourceId.replace("source:", "")}.json`);
	writeFileSync(sourceFile, JSON.stringify(source, null, 2), "utf-8");

	const spansFile = join(config.sourcesDir, `${sourceId.replace("source:", "")}.spans.jsonl`);
	writeFileSync(spansFile, `${spans.map((s) => JSON.stringify(s)).join("\n")}\n`, "utf-8");

	// ── 追加 manifest 条目 ──
	const manifestEntry = {
		sourceId,
		hash,
		uri: loaded.uri,
		title: loaded.title,
		sourceType: loaded.sourceType,
		loaderVersion: loaded.loaderVersion,
		metadata: loaded.metadata,
		blockCount: spans.length,
		createdAt: source.createdAt,
	};
	const manifestPath = join(config.sourcesDir, "..", "manifest.jsonl");
	appendFileSync(manifestPath, `${JSON.stringify(manifestEntry)}\n`, "utf-8");

	return { source, spans, isDuplicate: false };
}

function validateLoadedDocument(document: LoadedDocument): void {
	if (!document.sourceKey.trim()) throw new Error("Loader 输出缺少 sourceKey");
	if (!document.loaderVersion.trim()) throw new Error("Loader 输出缺少 loaderVersion");
	if (!document.parsedText.trim()) throw new Error("Loader 没有解析出可摄入文本");
	for (const block of document.blocks) {
		if (
			block.charStart < 0 ||
			block.charEnd <= block.charStart ||
			block.charEnd > document.parsedText.length ||
			document.parsedText.slice(block.charStart, block.charEnd) !== block.text
		) {
			throw new Error(`Loader 输出了不可回溯的 block: ${block.blockId}`);
		}
	}
}

/**
 * 在一个 SourceSpan 中查找 quote 对应的子 span。
 *
 * 修 GPT 问题 7：LLM 返回 exactQuote + blockId，
 * 程序负责在 block 内做字符串匹配映射成精确的 SourceSpan。
 *
 * @param spans - 所有 SourceSpan
 * @param blockId - LLM 返回的 blockId
 * @param exactQuote - LLM 返回的原文引用
 * @returns 匹配到的 SourceSpan（含精确 charStart/charEnd）；匹配失败返回 null
 */
export function mapQuoteToSpan(
	spans: SourceSpan[],
	blockId: string,
	exactQuote: string,
): SourceSpan | null {
	// 找到 blockId 对应的 span
	const blockSpan = spans.find((s) => s.blockId === blockId);
	if (!blockSpan) return null;
	const trimmedQuote = exactQuote.trim();
	const tableContext = mapMarkdownTableQuote(blockSpan, trimmedQuote);
	if (tableContext) return tableContext;

	// 在 block 文本中找 quote 的位置
	const relativeOffset = blockSpan.text.indexOf(exactQuote);
	if (relativeOffset === -1) {
		// 精确匹配失败，尝试去掉首尾空白
		const trimmedOffset = blockSpan.text.indexOf(trimmedQuote);
		if (trimmedOffset === -1) {
			return (
				mapCanonicalQuote(blockSpan, trimmedQuote) ?? mapMarkdownTableQuote(blockSpan, trimmedQuote)
			);
		}
		return {
			...blockSpan,
			id: buildDerivedSpanId(
				blockSpan.id,
				blockSpan.charStart + trimmedOffset,
				blockSpan.charStart + trimmedOffset + trimmedQuote.length,
			),
			charStart: blockSpan.charStart + trimmedOffset,
			charEnd: blockSpan.charStart + trimmedOffset + trimmedQuote.length,
			text: trimmedQuote,
		};
	}

	// 返回精确子 span
	return {
		...blockSpan,
		id: buildDerivedSpanId(
			blockSpan.id,
			blockSpan.charStart + relativeOffset,
			blockSpan.charStart + relativeOffset + exactQuote.length,
		),
		charStart: blockSpan.charStart + relativeOffset,
		charEnd: blockSpan.charStart + relativeOffset + exactQuote.length,
		text: exactQuote,
	};
}

/**
 * Models often omit unrelated Markdown table cells while preserving a row label and one value.
 * When those cells identify exactly one row, cite the complete table block so column headers and
 * omitted cells remain visible to the fidelity auditor. This is deterministic structural matching,
 * not semantic/fuzzy matching.
 */
function mapMarkdownTableQuote(blockSpan: SourceSpan, quote: string): SourceSpan | null {
	const lines = blockSpan.text.split("\n");
	if (lines.length < 2 || !lines.every((line) => line.includes("|"))) return null;
	const quoteCells = quote
		.split("|")
		.map(canonicalText)
		.filter((cell) => cell.length > 0);
	if (quoteCells.length < 2) return null;

	const matchingRows = lines.filter((line) => {
		if (/^\s*\|?\s*:?-{3,}/.test(line)) return false;
		const rowCells = line
			.split("|")
			.map(canonicalText)
			.filter((cell) => cell.length > 0);
		let rowIndex = 0;
		for (const quoteCell of quoteCells) {
			const matchedIndex = rowCells.findIndex(
				(rowCell, index) => index >= rowIndex && rowCell.includes(quoteCell),
			);
			if (matchedIndex === -1) return false;
			rowIndex = matchedIndex + 1;
		}
		return true;
	});
	if (matchingRows.length !== 1) return null;
	return blockSpan;
}

function canonicalText(value: string): string {
	return canonicalizeWithOffsets(value)
		.map((item) => item.value)
		.join("");
}

function buildDerivedSpanId(baseSpanId: string, charStart: number, charEnd: number): string {
	return `${baseSpanId}#chars-${charStart}-${charEnd}`;
}

interface CanonicalCharacter {
	value: string;
	start: number;
	end: number;
}

/**
 * Match formatting-equivalent text without semantic fuzziness.
 * Markdown markers, whitespace and punctuation are ignored; LaTeX/Unicode math symbols are
 * converted to the same canonical character sequence while retaining source offsets.
 */
function mapCanonicalQuote(blockSpan: SourceSpan, quote: string): SourceSpan | null {
	const sourceCharacters = canonicalizeWithOffsets(blockSpan.text);
	const quoteCharacters = canonicalizeWithOffsets(quote);
	const sourceCanonical = sourceCharacters.map((item) => item.value).join("");
	const quoteCanonical = quoteCharacters.map((item) => item.value).join("");
	if (quoteCanonical.length < 2) return null;

	const canonicalOffset = sourceCanonical.indexOf(quoteCanonical);
	if (canonicalOffset === -1) return null;
	// Repeated normalized text is ambiguous; do not guess which occurrence the model intended.
	if (sourceCanonical.indexOf(quoteCanonical, canonicalOffset + 1) !== -1) return null;

	const first = sourceCharacters[canonicalOffset];
	const last = sourceCharacters[canonicalOffset + quoteCanonical.length - 1];
	if (!first || !last) return null;
	const [relativeStart, relativeEnd] = expandFormattingBoundary(
		blockSpan.text,
		first.start,
		last.end,
	);
	const charStart = blockSpan.charStart + relativeStart;
	const charEnd = blockSpan.charStart + relativeEnd;
	return {
		...blockSpan,
		id: buildDerivedSpanId(blockSpan.id, charStart, charEnd),
		charStart,
		charEnd,
		text: blockSpan.text.slice(relativeStart, relativeEnd),
	};
}

function canonicalizeWithOffsets(input: string): CanonicalCharacter[] {
	const output: CanonicalCharacter[] = [];
	for (let index = 0; index < input.length; index++) {
		const character = input[index] ?? "";
		if (character === "\\") {
			const fractionMatch = /^\\frac\{([^{}]*)\}\{([^{}]*)\}/.exec(input.slice(index));
			if (fractionMatch) {
				const fullMatch = fractionMatch[0];
				const numerator = fractionMatch[1] ?? "";
				const denominator = fractionMatch[2] ?? "";
				const numeratorStart = index + "\\frac{".length;
				appendShiftedCanonical(output, numerator, numeratorStart);
				appendCanonical(output, "/", index, index + fullMatch.length);
				const denominatorStart = index + "\\frac{".length + numerator.length + "}{".length;
				appendShiftedCanonical(output, denominator, denominatorStart);
				index += fullMatch.length - 1;
				continue;
			}
			const commandMatch = /^[a-zA-Z]+/.exec(input.slice(index + 1));
			if (commandMatch) {
				const command = commandMatch[0];
				const replacement = latexCommandReplacement(command);
				appendCanonical(output, replacement, index, index + command.length + 1);
				index += command.length;
				continue;
			}
			continue;
		}

		const symbolReplacement = unicodeReplacement(character);
		if (symbolReplacement !== null) {
			appendCanonical(output, symbolReplacement, index, index + character.length);
			continue;
		}
		if (isIgnoredFormattingCharacter(character)) continue;
		appendCanonical(output, character.toLocaleLowerCase(), index, index + character.length);
	}
	return output;
}

function appendShiftedCanonical(output: CanonicalCharacter[], value: string, offset: number): void {
	for (const character of canonicalizeWithOffsets(value)) {
		output.push({
			...character,
			start: character.start + offset,
			end: character.end + offset,
		});
	}
}

function appendCanonical(
	output: CanonicalCharacter[],
	value: string,
	start: number,
	end: number,
): void {
	for (const character of value) output.push({ value: character, start, end });
}

function latexCommandReplacement(command: string): string {
	const replacements: Record<string, string> = {
		S: "§",
		in: "in",
		notin: "notin",
		Rightarrow: "=>",
		rightarrow: "->",
		to: "->",
		times: "*",
		cdot: "*",
		div: "/",
		neq: "!=",
		ne: "!=",
		sim: "~",
		iff: "<=>",
		cup: "u",
		cap: "n",
		emptyset: "empty",
		forall: "forall",
		exists: "exists",
		sqrt: "sqrt",
		cos: "cos",
		sin: "sin",
		tan: "tan",
		theta: "theta",
		pi: "pi",
		Re: "re",
		Im: "im",
	};
	return replacements[command] ?? "";
}

function unicodeReplacement(character: string): string | null {
	const replacements: Record<string, string> = {
		ℕ: "n",
		ℤ: "z",
		ℚ: "q",
		ℝ: "r",
		ℂ: "c",
		"∈": "in",
		"∉": "notin",
		"⇒": "=>",
		"→": "->",
		"×": "*",
		"÷": "/",
		"≠": "!=",
		"∼": "~",
		"⇔": "<=>",
		"∪": "u",
		"∩": "n",
		"∅": "empty",
		"∀": "forall",
		"∃": "exists",
		"√": "sqrt",
		θ: "theta",
		π: "pi",
		"²": "2",
		"³": "3",
		"̅": "",
	};
	return Object.hasOwn(replacements, character) ? (replacements[character] ?? "") : null;
}

function isIgnoredFormattingCharacter(character: string): boolean {
	return /[\s$*_`#>|{}\[\]()（）,:：;；,.。!！?？"“”'‘’^]/u.test(character);
}

function expandFormattingBoundary(text: string, start: number, end: number): [number, number] {
	let expandedStart = start;
	let expandedEnd = end;
	while (expandedStart > 0 && /[$*_`]/.test(text[expandedStart - 1] ?? "")) expandedStart--;
	while (expandedEnd < text.length && /[$*_`}]/.test(text[expandedEnd] ?? "")) expandedEnd++;

	if (text[expandedStart - 1] === "{") {
		const prefix = text.slice(0, expandedStart - 1);
		const commandStart = prefix.search(/\\[a-zA-Z]+$/);
		if (commandStart !== -1) expandedStart = commandStart;
	}
	return [expandedStart, expandedEnd];
}
