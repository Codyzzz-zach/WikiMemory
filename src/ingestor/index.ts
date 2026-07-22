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
import { existsSync, mkdirSync, writeFileSync, appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AppConfig } from "../config/types.js";
import type { Source, SourceSpan } from "../types/index.js";
import { parseMarkdownFile } from "../parser/markdown.js";

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
export function ingestMarkdownFile(config: AppConfig, filePath: string): IngestResult {
	const parsed = parseMarkdownFile(filePath);
	const fileStem = parsed.fileStem;

	// ── 计算 hash（基于正文内容去重）──
	const hash = createHash("sha256")
		.update(parsed.body)
		.digest("hex")
		.slice(0, 16);

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
		uri: filePath,
		parsedText: parsed.body,
		sourceType: "md",
		loaderVersion: "v1.0",
		createdAt: new Date().toISOString(),
	};

	// ── 从 blocks 生成 SourceSpan（每个 block 一个 span）──
	const spans: SourceSpan[] = parsed.blocks.map((block, idx) => ({
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
	writeFileSync(
		spansFile,
		spans.map((s) => JSON.stringify(s)).join("\n") + "\n",
		"utf-8",
	);

	// ── 追加 manifest 条目 ──
	const manifestEntry = {
		sourceId,
		hash,
		uri: filePath,
		title: parsed.frontmatter.title ?? fileStem,
		sourceType: "md",
		blockCount: spans.length,
		createdAt: source.createdAt,
	};
	const manifestPath = join(config.sourcesDir, "..", "manifest.jsonl");
	appendFileSync(manifestPath, JSON.stringify(manifestEntry) + "\n", "utf-8");

	return { source, spans, isDuplicate: false };
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

	// 在 block 文本中找 quote 的位置
	const relativeOffset = blockSpan.text.indexOf(exactQuote);
	if (relativeOffset === -1) {
		// 精确匹配失败，尝试去掉首尾空白
		const trimmedQuote = exactQuote.trim();
		const trimmedOffset = blockSpan.text.indexOf(trimmedQuote);
		if (trimmedOffset === -1) return null;
		return {
			...blockSpan,
			id: `${blockSpan.id}#quote-0`,
			charStart: blockSpan.charStart + trimmedOffset,
			charEnd: blockSpan.charStart + trimmedOffset + trimmedQuote.length,
			text: trimmedQuote,
		};
	}

	// 返回精确子 span
	return {
		...blockSpan,
		id: `${blockSpan.id}#quote-0`,
		charStart: blockSpan.charStart + relativeOffset,
		charEnd: blockSpan.charStart + relativeOffset + exactQuote.length,
		text: exactQuote,
	};
}
