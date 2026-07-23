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
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	writeFileSync,
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
	appendFileSync(filePath, `${lines}\n`, "utf-8");
}

/** JSONL 全量覆盖写入（用于原子发布） */
export function writeJsonl<T>(filePath: string, items: T[]): void {
	mkdirSync(join(filePath, ".."), { recursive: true });
	const lines = items.map((item) => JSON.stringify(item)).join("\n");
	writeFileSync(filePath, `${lines}\n`, "utf-8");
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

/**
 * 物理隔离：Quarantined Claim 写到 quarantine/ 目录（轨道 D-2）。
 *
 * Review 断点 4：Quarantine 与 Canonical 共存储 → 靠运行时过滤，任一新消费者
 * 漏用矩阵就污染。物理隔离让默认读取 API 根本看不到它们。
 *
 * readAllClaims 只读 claims/，不读 quarantine/。
 * 诊断/审计用 readAllClaimsQuarantined 显式读取。
 */
export function appendClaimsQuarantined(config: AppConfig, claims: Claim[]): void {
	appendJsonl(join(config.quarantineDir, "claims.jsonl"), claims);
}

/** 读取 Quarantined Claim（仅诊断/审计用，默认消费路径不调用） */
export function readAllClaimsQuarantined(config: AppConfig): Claim[] {
	return readJsonl<Claim>(join(config.quarantineDir, "claims.jsonl"));
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

/** 物理隔离：Quarantined Relation 写到 quarantine/（同 appendClaimsQuarantined） */
export function appendRelationsQuarantined(config: AppConfig, relations: Relation[]): void {
	appendJsonl(join(config.quarantineDir, "relations.jsonl"), relations);
}

/** 读取 Quarantined Relation（仅诊断/审计用） */
export function readAllRelationsQuarantined(config: AppConfig): Relation[] {
	return readJsonl<Relation>(join(config.quarantineDir, "relations.jsonl"));
}

// ─── SourceSpan 存储 ─────────────────────────────────────────────

export function readAllSpans(config: AppConfig): SourceSpan[] {
	const sourcesDir = config.sourcesDir;
	if (!existsSync(sourcesDir)) return [];
	const files = readdirSync(sourcesDir).filter((f: string) =>
		f.endsWith(".spans.jsonl"),
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

// ─── 审计指标存储（轨道 B：可观测）──────────────────────────────

/**
 * 追加一条审计指标记录到 runs/audit-metrics.jsonl。
 *
 * 用途：meta-eval 校准（算 TPR/TNR）、criterion drift 监测（按 model 快照分桶）。
 * 每条记录含 claimId/outcome/dimension/model 快照/auditVersion/时间戳。
 */
export function appendAuditMetric(
	config: AppConfig,
	metric: {
		claimId: string;
		outcome: string;
		dimension: string;
		model: string;
		auditVersion: string;
		timestamp: string;
	},
): void {
	appendJsonl(join(config.runsDir, "audit-metrics.jsonl"), [metric]);
}

/**
 * 读取所有审计指标记录（meta-eval 脚本用）。
 */
export function readAllAuditMetrics(config: AppConfig): Array<{
	claimId: string;
	outcome: string;
	dimension: string;
	model: string;
	auditVersion: string;
	timestamp: string;
}> {
	return readJsonl(join(config.runsDir, "audit-metrics.jsonl"));
}
