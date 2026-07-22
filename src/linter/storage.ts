/**
 * Storage — 知识状态读写层
 *
 * 把 Claim/Concept/Relation/WikiModule 写入文件系统。
 * 知识状态进 Git（修 GPT 问题 9）——wiki/claims/concepts/relations 全部追踪。
 *
 * 存储格式：JSONL（对齐 Product Definition §06 的 edges.jsonl）。
 * 每个一等对象一行 JSON，追加写入、流式读取、git diff 友好。
 */

import {
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
	appendFileSync,
} from "node:fs";
import { join } from "node:path";
import type { AppConfig } from "../config/types.js";
import type { Claim, Concept, Relation, SourceSpan } from "../types/index.js";

/** JSONL 读取工具 */
export function readJsonl<T>(filePath: string): T[] {
	if (!existsSync(filePath)) return [];
	const content = readFileSync(filePath, "utf-8");
	return content
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line) as T);
}

/** JSONL 追加写入工具 */
export function appendJsonl<T>(filePath: string, items: T[]): void {
	mkdirSync(join(filePath, ".."), { recursive: true });
	const lines = items.map((item) => JSON.stringify(item)).join("\n");
	appendFileSync(filePath, lines + "\n", "utf-8");
}

/** JSONL 全量覆盖写入（用于原子发布） */
export function writeJsonl<T>(filePath: string, items: T[]): void {
	mkdirSync(join(filePath, ".."), { recursive: true });
	const lines = items.map((item) => JSON.stringify(item)).join("\n");
	writeFileSync(filePath, lines + "\n", "utf-8");
}

/** 单个 JSON 文件读取 */
export function readJson<T>(filePath: string): T | null {
	if (!existsSync(filePath)) return null;
	return JSON.parse(readFileSync(filePath, "utf-8")) as T;
}

/** 单个 JSON 文件写入 */
export function writeJson(filePath: string, data: unknown): void {
	mkdirSync(join(filePath, ".."), { recursive: true });
	writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

// ─── Claim 存储 ──────────────────────────────────────────────────

export function readAllClaims(config: AppConfig): Claim[] {
	return readJsonl<Claim>(join(config.projectRoot, "claims", "claims.jsonl"));
}

export function appendClaims(config: AppConfig, claims: Claim[]): void {
	appendJsonl(join(config.projectRoot, "claims", "claims.jsonl"), claims);
}

// ─── Concept 存储 ────────────────────────────────────────────────

export function readAllConcepts(config: AppConfig): Concept[] {
	return readJsonl<Concept>(join(config.projectRoot, "concepts", "concepts.jsonl"));
}

export function appendConcepts(config: AppConfig, concepts: Concept[]): void {
	appendJsonl(join(config.projectRoot, "concepts", "concepts.jsonl"), concepts);
}

// ─── Relation 存储 ───────────────────────────────────────────────

export function readAllRelations(config: AppConfig): Relation[] {
	return readJsonl<Relation>(join(config.projectRoot, "relations", "edges.jsonl"));
}

export function appendRelations(config: AppConfig, relations: Relation[]): void {
	appendJsonl(join(config.projectRoot, "relations", "edges.jsonl"), relations);
}

// ─── SourceSpan 存储 ─────────────────────────────────────────────

export function readAllSpans(config: AppConfig): SourceSpan[] {
	const sourcesDir = config.sourcesDir;
	if (!existsSync(sourcesDir)) return [];
	const { readdirSync } = require("node:fs");
	const files = readdirSync(sourcesDir).filter(
		(f: string) => f.endsWith(".spans.jsonl"),
	) as string[];
	const spans: SourceSpan[] = [];
	for (const f of files) {
		spans.push(...readJsonl<SourceSpan>(join(sourcesDir, f)));
	}
	return spans;
}

/**
 * 根据 spanId 批量查找 SourceSpan。
 * 从内存中的 spans 数组查找（调用方负责先 readAllSpans）。
 */
export function findSpansByIds(allSpans: SourceSpan[], spanIds: string[]): SourceSpan[] {
	const idSet = new Set(spanIds);
	return allSpans.filter((s) => idSet.has(s.id));
}
