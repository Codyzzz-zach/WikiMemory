/**
 * Markdown 解析器 — 机械提取 + blockId 生成
 *
 * 修 GPT 问题 7：charStart/charEnd 由 parser 机械生成，不让 LLM 返回。
 * LLM 只返回 blockId + exactQuote，程序用 exactQuote 在 block 内做字符串匹配映射成 SourceSpan。
 *
 * blockId 是稳定的块标识（如 "01-number-systems#block-3"），
 * 基于文件名 + 块索引生成，重新解析时保持一致。
 */

import { readFileSync } from "node:fs";
import { basename } from "node:path";

/** 一个机械切分的原文块 */
export interface TextBlock {
	/** 稳定标识：文件名#block-索引 */
	blockId: string;
	/** 块在全文中的起始位置（UTF-16 code unit offset） */
	charStart: number;
	/** 块在全文中的结束位置 */
	charEnd: number;
	/** 块的纯文本内容 */
	text: string;
	/** 块类型 */
	kind: "heading" | "paragraph" | "list_item" | "table_row" | "code" | "blockquote" | "math";
}

/** frontmatter 解析结果 */
export interface ParsedFrontmatter {
	title: string | null;
	prev: string | null;
	next: string | null;
	raw: Record<string, string>;
}

/** 完整的 MD 解析结果 */
export interface ParsedMarkdown {
	frontmatter: ParsedFrontmatter;
	/** 去除 frontmatter 后的纯正文（用于 hash 和 offset 计算） */
	body: string;
	/** 机械切分的块列表 */
	blocks: TextBlock[];
	/** 原始文件路径 */
	filePath: string;
	/** 文件名（不含扩展名，用于 blockId 前缀） */
	fileStem: string;
}

/**
 * 解析 Markdown 文件的 frontmatter（YAML）和正文，并机械切分成块。
 *
 * @param filePath - MD 文件路径
 * @returns 解析结果，含 blocks（每个 block 有 blockId + charStart + charEnd + text）
 */
export function parseMarkdownFile(filePath: string): ParsedMarkdown {
	const content = readFileSync(filePath, "utf-8");
	const fileStem = basename(filePath).replace(/\.md$/, "");
	return parseMarkdownContent(content, fileStem, filePath);
}

/**
 * 解析 Markdown 内容（不读文件）。
 * 公开此函数便于测试。
 */
export function parseMarkdownContent(
	content: string,
	fileStem: string,
	filePath: string,
): ParsedMarkdown {
	// ── 1. 分离 frontmatter 和 body ──
	const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
	let body: string;
	let frontmatterRaw: Record<string, string> = {};

	if (fmMatch) {
		const fmText = fmMatch[1] ?? "";
		body = fmMatch[2] ?? "";
		frontmatterRaw = parseSimpleFrontmatter(fmText);
	} else {
		body = content;
	}

	// ── 2. 机械切分成块 ──
	const blocks = splitIntoBlocks(body, fileStem);

	return {
		frontmatter: {
			title: frontmatterRaw.title ?? null,
			prev: frontmatterRaw.prev ?? null,
			next: frontmatterRaw.next ?? null,
			raw: frontmatterRaw,
		},
		body,
		blocks,
		filePath,
		fileStem,
	};
}

/** 解析简单 frontmatter（key: value 格式） */
function parseSimpleFrontmatter(fmText: string): Record<string, string> {
	const result: Record<string, string> = {};
	for (const line of fmText.split("\n")) {
		const match = line.match(/^(\w+):\s*"?(.*?)"?\s*$/);
		if (match) {
			result[match[1]!] = match[2]!;
		}
	}
	return result;
}

/**
 * 将正文机械切分成块。
 * 每个块是一个有意义的文本单元（段落、列表项、表格行等）。
 *
 * 切分策略：
 * - 按 Markdown 结构切分（标题/段落/列表/表格/代码/引用/公式）
 * - 每个块记录在 body 中的 charStart/charEnd
 * - blockId = fileStem#block-N（N 从 0 开始）
 *
 * 注意：charStart/charEnd 是 body 内的偏移（不是全文），
 * Source 存 body 全文，SourceSpan 的 offset 基于 body。
 */
function splitIntoBlocks(body: string, fileStem: string): TextBlock[] {
	const blocks: TextBlock[] = [];
	const lines = body.split("\n");
	let blockIndex = 0;
	let currentOffset = 0;
	let i = 0;

	while (i < lines.length) {
		const line = lines[i]!;
		const trimmed = line.trim();

		// 空行跳过
		if (trimmed === "") {
			currentOffset += line.length + 1; // +1 for \n
			i++;
			continue;
		}

		// 判断块类型并收集内容
		const { blockLines, kind, consumedLines } = collectBlock(lines, i);

		if (blockLines.length > 0) {
			const blockText = blockLines.join("\n");
			blocks.push({
				blockId: `${fileStem}#block-${blockIndex}`,
				charStart: currentOffset,
				charEnd: currentOffset + blockText.length,
				text: blockText,
				kind,
			});
			blockIndex++;

			// 推进 offset
			for (let j = 0; j < consumedLines; j++) {
				currentOffset += (lines[i + j]?.length ?? 0) + 1;
			}
		}

		i += consumedLines;
	}

	return blocks;
}

/** 收集从 i 开始的一个块，返回块内容 + 类型 + 消耗的行数 */
function collectBlock(
	lines: string[],
	startIdx: number,
): { blockLines: string[]; kind: TextBlock["kind"]; consumedLines: number } {
	const line = lines[startIdx]!;
	const trimmed = line.trim();

	// 数学块 $$ ... $$
	if (trimmed.startsWith("$$")) {
		return collectUntilClose(lines, startIdx, "$$", "math");
	}

	// 代码块 ``` ... ```
	if (trimmed.startsWith("```")) {
		return collectUntilClose(lines, startIdx, "```", "code");
	}

	// 标题 # ...
	if (/^#{1,6}\s/.test(trimmed)) {
		return { blockLines: [line], kind: "heading", consumedLines: 1 };
	}

	// 列表项 - / * / 数字.
	if (/^[-*]\s/.test(trimmed) || /^\d+\.\s/.test(trimmed)) {
		// 收集连续列表项
		const blockLines: string[] = [];
		let j = startIdx;
		while (j < lines.length) {
			const l = lines[j]!.trim();
			if (/^[-*]\s/.test(l) || /^\d+\.\s/.test(l) || (l === "" && j + 1 < lines.length && /^[-*]\s|^\d+\.\s/.test(lines[j + 1]!.trim()))) {
				if (l === "") {
					// 列表中的空行，不单独成块
					j++;
					continue;
				}
				blockLines.push(lines[j]!);
				j++;
			} else {
				break;
			}
		}
		return { blockLines, kind: "list_item", consumedLines: j - startIdx };
	}

	// 表格行 | ... |
	if (trimmed.startsWith("|")) {
		const blockLines: string[] = [];
		let j = startIdx;
		while (j < lines.length && lines[j]!.trim().startsWith("|")) {
			blockLines.push(lines[j]!);
			j++;
		}
		return { blockLines, kind: "table_row", consumedLines: j - startIdx };
	}

	// 引用 > ...
	if (trimmed.startsWith(">")) {
		const blockLines: string[] = [];
		let j = startIdx;
		while (j < lines.length && lines[j]!.trim().startsWith(">")) {
			blockLines.push(lines[j]!);
			j++;
		}
		return { blockLines, kind: "blockquote", consumedLines: j - startIdx };
	}

	// 默认：段落（收集到空行或结构变化）
	{
		const blockLines: string[] = [line];
		let j = startIdx + 1;
		while (j < lines.length) {
			const l = lines[j]!.trim();
			if (
				l === "" ||
				/^#{1,6}\s/.test(l) ||
				/^[-*]\s/.test(l) ||
				/^\d+\.\s/.test(l) ||
				l.startsWith("|") ||
				l.startsWith(">") ||
				l.startsWith("$$") ||
				l.startsWith("```")
			) {
				break;
			}
			blockLines.push(lines[j]!);
			j++;
		}
		return { blockLines, kind: "paragraph", consumedLines: j - startIdx };
	}
}

/** 收集直到遇到关闭标记的块（数学/代码） */
function collectUntilClose(
	lines: string[],
	startIdx: number,
	closeMarker: string,
	kind: TextBlock["kind"],
): { blockLines: string[]; kind: TextBlock["kind"]; consumedLines: number } {
	const blockLines: string[] = [lines[startIdx]!];
	let j = startIdx + 1;

	// 单行情况（如 $$ ... $$ 在同一行）
	if ((lines[startIdx]!.match(/\$\$/g)?.length ?? 0) >= 2 && kind === "math") {
		return { blockLines, kind, consumedLines: 1 };
	}

	while (j < lines.length) {
		blockLines.push(lines[j]!);
		if (lines[j]!.trim().endsWith(closeMarker) || lines[j]!.trim() === closeMarker) {
			j++;
			break;
		}
		j++;
	}

	return { blockLines, kind, consumedLines: j - startIdx };
}
