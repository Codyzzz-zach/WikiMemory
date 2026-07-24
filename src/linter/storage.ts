/**
 * Storage — 知识状态读写层
 *
 * 把 Claim/Concept/Relation/WikiModule 写入文件系统。
 * 知识状态进 Git（修 GPT 问题 9）——wiki/claims/concepts/relations 全部追踪。
 *
 * 存储格式：JSONL（对齐 Product Definition §06 的 edges.jsonl）。
 * 每个一等对象一行 JSON，追加写入、流式读取、git diff 友好。
 */

import { createHash } from "node:crypto";
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { AppConfig } from "../config/types.js";
import type {
	AssertedRecord,
	Claim,
	Concept,
	Relation,
	Source,
	SourceSpan,
	WikiModule,
} from "../types/index.js";

export interface SourcePublication {
	schemaVersion: "v1";
	sourceId: string;
	runId: string;
	publishedAt: string;
	claims: Claim[];
	concepts: Concept[];
	relations: Relation[];
}

export interface SourceQuarantinePublication {
	schemaVersion: "v1";
	sourceId: string;
	runId: string;
	publishedAt: string;
	claims: Array<{ claim: Claim; issues: unknown[] }>;
	relations: Array<{ relation: Relation; issues: unknown[] }>;
}

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

/** Write a complete JSON snapshot and expose it with one same-filesystem rename. */
export function writeJsonAtomic(filePath: string, data: unknown): void {
	mkdirSync(join(filePath, ".."), { recursive: true });
	const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
	writeFileSync(temporaryPath, JSON.stringify(data, null, 2), { encoding: "utf-8", flag: "wx" });
	renameSync(temporaryPath, filePath);
}

/**
 * Publish one Source as an idempotent snapshot.
 * Quarantine is replaced first; the canonical snapshot is the visibility boundary and is renamed last.
 */
export function publishSourceResult(
	config: AppConfig,
	publication: SourcePublication,
	quarantine: SourceQuarantinePublication,
): void {
	const fileName = `${safeSourceFileName(publication.sourceId)}.json`;
	const reconciled = reconcileDanglingCrossRelations(config, publication, quarantine);

	// Foreign snapshots are made safe before the target Source loses its old Claims.
	// A crash can therefore hide an edge temporarily, but can never expose a dangling edge.
	for (const update of reconciled.foreignUpdates) {
		const foreignFileName = `${safeSourceFileName(update.publication.sourceId)}.json`;
		writeJsonAtomic(join(config.quarantineDir, "publications", foreignFileName), update.quarantine);
		writeJsonAtomic(join(config.projectRoot, "publications", foreignFileName), update.publication);
	}

	writeJsonAtomic(join(config.quarantineDir, "publications", fileName), reconciled.quarantine);
	writeJsonAtomic(join(config.projectRoot, "publications", fileName), reconciled.publication);
}

interface ReconciledPublicationPair {
	publication: SourcePublication;
	quarantine: SourceQuarantinePublication;
}

/**
 * A cross-material Relation is owned by the Source that discovered it, but either endpoint may
 * belong to another Source. Replacing that other Source can therefore invalidate a foreign edge.
 * Reconcile against the prospective Claim set and retain every invalidated edge in quarantine.
 */
function reconcileDanglingCrossRelations(
	config: AppConfig,
	incomingPublication: SourcePublication,
	incomingQuarantine: SourceQuarantinePublication,
): ReconciledPublicationPair & { foreignUpdates: ReconciledPublicationPair[] } {
	const publications = readPublicationFiles<SourcePublication>(
		join(config.projectRoot, "publications"),
	);
	const quarantines = readPublicationFiles<SourceQuarantinePublication>(
		join(config.quarantineDir, "publications"),
	);
	const prospective = new Map(publications.map((item) => [item.sourceId, item]));
	prospective.set(incomingPublication.sourceId, incomingPublication);
	const canonicalClaimIds = new Set([
		...readJsonl<Claim>(join(config.projectRoot, "claims", "claims.jsonl")).map(
			(claim) => claim.id,
		),
		...[...prospective.values()].flatMap((item) => item.claims.map((claim) => claim.id)),
	]);
	const quarantineBySource = new Map(quarantines.map((item) => [item.sourceId, item]));
	quarantineBySource.set(incomingQuarantine.sourceId, incomingQuarantine);
	const updates: ReconciledPublicationPair[] = [];

	for (const candidate of prospective.values()) {
		const dangling = candidate.relations.filter(
			(relation) =>
				relation.source === "cross-material-detect" &&
				(!canonicalClaimIds.has(relation.from as string) ||
					!canonicalClaimIds.has(relation.to as string)),
		);
		if (dangling.length === 0) {
			updates.push({
				publication: candidate,
				quarantine:
					quarantineBySource.get(candidate.sourceId) ??
					emptyQuarantine(candidate.sourceId, candidate.runId, candidate.publishedAt),
			});
			continue;
		}

		const danglingIds = new Set(dangling.map((relation) => relation.id));
		const baseQuarantine =
			quarantineBySource.get(candidate.sourceId) ??
			emptyQuarantine(candidate.sourceId, candidate.runId, candidate.publishedAt);
		updates.push({
			publication: {
				...candidate,
				relations: candidate.relations.filter((relation) => !danglingIds.has(relation.id)),
			},
			quarantine: {
				...baseQuarantine,
				relations: [
					...baseQuarantine.relations.filter((item) => !danglingIds.has(item.relation.id)),
					...dangling.map((relation) => ({
						relation: {
							...relation,
							validity: "UNRESOLVED" as const,
							publicationState: "QUARANTINED" as const,
						},
						issues: [
							{
								code: "BROKEN_RELATION_ENDPOINT",
								severity: "error",
								affectedObject: relation.id,
								detail: `Source 重编后 Relation 端点失效: from=${relation.from}, to=${relation.to}`,
								recommendedState: "QUARANTINE",
							},
						],
					})),
				],
			},
		});
	}

	const own = updates.find(
		(update) => update.publication.sourceId === incomingPublication.sourceId,
	);
	if (!own) throw new Error(`无法协调 Source publication: ${incomingPublication.sourceId}`);
	return {
		...own,
		foreignUpdates: updates.filter(
			(update) =>
				update.publication.sourceId !== incomingPublication.sourceId &&
				update.publication.relations.length !==
					publications.find((item) => item.sourceId === update.publication.sourceId)?.relations
						.length,
		),
	};
}

function emptyQuarantine(
	sourceId: string,
	runId: string,
	publishedAt: string,
): SourceQuarantinePublication {
	return { schemaVersion: "v1", sourceId, runId, publishedAt, claims: [], relations: [] };
}

function safeSourceFileName(sourceId: string): string {
	return sourceId.replace(/^source:/, "").replace(/[^a-zA-Z0-9._-]/g, "_");
}

function readPublicationFiles<T>(directory: string): T[] {
	if (!existsSync(directory)) return [];
	return readdirSync(directory)
		.filter((file) => file.endsWith(".json"))
		.sort()
		.map((file) => {
			const value = readJson<T>(join(directory, file));
			if (!value) throw new Error(`发布快照为空: ${join(directory, file)}`);
			return value;
		});
}

export function readSourcePublications(config: AppConfig): SourcePublication[] {
	return readPublicationFiles<SourcePublication>(join(config.projectRoot, "publications")).map(
		(publication) => ({
			...publication,
			relations: publication.relations.map(normalizeRelation),
		}),
	);
}

function readQuarantinePublications(config: AppConfig): SourceQuarantinePublication[] {
	return readPublicationFiles<SourceQuarantinePublication>(
		join(config.quarantineDir, "publications"),
	).map((publication) => ({
		...publication,
		relations: publication.relations.map((item) => ({
			...item,
			relation: normalizeRelation(item.relation),
		})),
	}));
}

/** 旧发布物没有边级审计证明：读取时 fail-closed，绝不沿用历史 SUPPORTED。 */
function normalizeRelation(relation: Relation): Relation {
	const legacy = relation as Relation & {
		conditionStatus?: Relation["conditionStatus"];
		relationAuditVersion?: string | null;
	};
	const conditionStatus = legacy.conditionStatus ?? "UNVERIFIED";
	const relationAuditVersion = legacy.relationAuditVersion ?? null;
	if (conditionStatus !== "UNVERIFIED" && relationAuditVersion !== null) {
		return { ...relation, conditionStatus, relationAuditVersion };
	}
	return {
		...relation,
		conditionStatus: "UNVERIFIED",
		relationAuditVersion: null,
		validity: "UNRESOLVED",
	};
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
	const byId = new Map<string, T>();
	for (const item of items) byId.set(item.id, item);
	return [...byId.values()];
}

// ─── Claim 存储 ──────────────────────────────────────────────────

export function readAllClaims(config: AppConfig): Claim[] {
	const legacy = readJsonl<Claim>(join(config.projectRoot, "claims", "claims.jsonl"));
	const published = readSourcePublications(config).flatMap((entry) => entry.claims);
	return uniqueById([...legacy, ...published]);
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
	const legacy = readJsonl<Claim>(join(config.quarantineDir, "claims.jsonl"));
	const published = readQuarantinePublications(config).flatMap((entry) =>
		entry.claims.map((item) => item.claim),
	);
	return uniqueById([...legacy, ...published]);
}

// ─── Concept 存储 ────────────────────────────────────────────────

export function readAllConcepts(config: AppConfig): Concept[] {
	const legacy = readJsonl<Concept>(join(config.projectRoot, "concepts", "concepts.jsonl"));
	const published = readSourcePublications(config).flatMap((entry) => entry.concepts);
	const merged = new Map<string, Concept>();
	for (const concept of [...legacy, ...published]) {
		const existing = merged.get(concept.id);
		merged.set(concept.id, {
			...concept,
			name: existing && existing.name.length <= concept.name.length ? existing.name : concept.name,
			aliases: [...new Set([...(existing?.aliases ?? []), ...concept.aliases])].sort(),
			boundary:
				(existing?.boundary.length ?? 0) >= concept.boundary.length
					? (existing?.boundary ?? "")
					: concept.boundary,
			domain: existing?.domain || concept.domain,
		});
	}
	return [...merged.values()];
}

export function appendConcepts(config: AppConfig, concepts: Concept[]): void {
	appendJsonl(join(config.projectRoot, "concepts", "concepts.jsonl"), concepts);
}

// ─── AssertedRecord 存储 ────────────────────────────────────────

export function readAllAssertedRecords(config: AppConfig): AssertedRecord[] {
	const byId = new Map<string, AssertedRecord>();
	for (const record of readJsonl<AssertedRecord>(
		join(config.projectRoot, "assertions", "asserted-records.jsonl"),
	)) {
		byId.set(record.assertionId, record);
	}
	return [...byId.values()];
}

export function appendAssertedRecords(config: AppConfig, records: AssertedRecord[]): void {
	appendJsonl(join(config.projectRoot, "assertions", "asserted-records.jsonl"), records);
}

// ─── Relation 存储 ───────────────────────────────────────────────

export function readAllRelations(config: AppConfig): Relation[] {
	const legacy = readJsonl<Relation>(join(config.projectRoot, "relations", "edges.jsonl")).map(
		normalizeRelation,
	);
	const published = readSourcePublications(config).flatMap((entry) => entry.relations);
	return uniqueById([...legacy, ...published]);
}

/** 将某个 Source 的阶段 2 跨材料边原子替换，不触碰阶段 1 的 Claim/Concept/同材料边。 */
export function publishCrossMaterialRelations(
	config: AppConfig,
	sourceId: string,
	runId: string,
	canonicalRelations: Relation[],
	quarantinedRelations: Array<{ relation: Relation; issues: unknown[] }>,
): void {
	const publication = readSourcePublications(config).find((entry) => entry.sourceId === sourceId);
	if (!publication) throw new Error(`找不到 Source 的阶段 1 发布快照: ${sourceId}`);
	const quarantine = readQuarantinePublications(config).find(
		(entry) => entry.sourceId === sourceId,
	);
	const publishedAt = new Date().toISOString();
	publishSourceResult(
		config,
		{
			...publication,
			runId,
			publishedAt,
			relations: [
				...publication.relations.filter((relation) => relation.source !== "cross-material-detect"),
				...canonicalRelations,
			],
		},
		{
			schemaVersion: "v1",
			sourceId,
			runId,
			publishedAt,
			claims: quarantine?.claims ?? [],
			relations: [
				...(quarantine?.relations ?? []).filter(
					(item) => item.relation.source !== "cross-material-detect",
				),
				...quarantinedRelations,
			],
		},
	);
}

/** Human review override: remove one canonical Relation and retain it with an explicit reason. */
export function quarantineCanonicalRelation(
	config: AppConfig,
	relationId: string,
	reason: string,
): void {
	const publication = readSourcePublications(config).find((entry) =>
		entry.relations.some((relation) => relation.id === relationId),
	);
	if (!publication) throw new Error(`找不到 canonical Relation: ${relationId}`);
	const relation = publication.relations.find((item) => item.id === relationId);
	if (!relation) throw new Error(`找不到 canonical Relation: ${relationId}`);
	const quarantine = readQuarantinePublications(config).find(
		(entry) => entry.sourceId === publication.sourceId,
	);
	const publishedAt = new Date().toISOString();
	const fileName = `${safeSourceFileName(publication.sourceId)}.json`;
	const quarantinedRelation = {
		...relation,
		validity: "UNRESOLVED" as const,
		publicationState: "QUARANTINED" as const,
	};
	const nextQuarantine: SourceQuarantinePublication = {
		...(quarantine ??
			emptyQuarantine(publication.sourceId, publication.runId, publication.publishedAt)),
		publishedAt,
		relations: [
			...(quarantine?.relations ?? []).filter((item) => item.relation.id !== relationId),
			{
				relation: quarantinedRelation,
				issues: [
					{
						code: "HUMAN_REVIEW_REJECTED",
						severity: "error",
						affectedObject: relationId,
						detail: reason,
						recommendedState: "QUARANTINE",
					},
				],
			},
		],
	};
	const nextPublication: SourcePublication = {
		...publication,
		publishedAt,
		relations: publication.relations.filter((item) => item.id !== relationId),
	};
	// Fail closed: make the audit trail durable before removing the canonical edge.
	writeJsonAtomic(join(config.quarantineDir, "publications", fileName), nextQuarantine);
	writeJsonAtomic(join(config.projectRoot, "publications", fileName), nextPublication);
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
	const legacy = readJsonl<Relation>(join(config.quarantineDir, "relations.jsonl")).map(
		normalizeRelation,
	);
	const published = readQuarantinePublications(config).flatMap((entry) =>
		entry.relations.map((item) => item.relation),
	);
	return uniqueById([...legacy, ...published]);
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

export function readAllSources(config: AppConfig): Source[] {
	if (!existsSync(config.sourcesDir)) return [];
	return readdirSync(config.sourcesDir)
		.filter((file) => file.endsWith(".json") && !file.endsWith(".spans.json"))
		.sort()
		.map((file) => {
			const source = readJson<Source>(join(config.sourcesDir, file));
			if (!source) throw new Error(`Source 文件为空: ${file}`);
			return source;
		});
}

/** Canonical 对象内容导出的稳定知识版本；相同知识状态重复查询得到同一值。 */
export function computeKnowledgeVersion(
	claims: Claim[],
	concepts: Concept[],
	relations: Relation[],
	wikiModules: WikiModule[] = [],
	assertedRecords: AssertedRecord[] = [],
): string {
	const snapshot = {
		claims: claims
			.map((claim) => ({
				id: claim.id,
				statement: claim.statement,
				evidenceSpanIds: [...claim.evidenceSpanIds].sort(),
				conditions: [...claim.conditions].sort(),
				validity: claim.validity,
				lifecycle: claim.lifecycle,
				publicationState: claim.publicationState,
				scope: claim.scope,
				claimKind: claim.claimKind,
			}))
			.sort((left, right) => left.id.localeCompare(right.id)),
		concepts: concepts
			.map((concept) => ({
				id: concept.id,
				name: concept.name,
				aliases: [...concept.aliases].sort(),
				boundary: concept.boundary,
				domain: concept.domain,
			}))
			.sort((left, right) => left.id.localeCompare(right.id)),
		relations: relations
			.map((relation) => ({
				id: relation.id,
				from: relation.from,
				to: relation.to,
				type: relation.type,
				conditions: [...relation.conditions].sort(),
				conditionStatus: relation.conditionStatus,
				relationAuditVersion: relation.relationAuditVersion,
				evidenceSpanIds: [...relation.evidenceSpanIds].sort(),
				validity: relation.validity,
				lifecycle: relation.lifecycle,
				publicationState: relation.publicationState,
			}))
			.sort((left, right) => left.id.localeCompare(right.id)),
		wikiModules: wikiModules
			.map((module) => ({
				id: module.id,
				stableAddress: module.stableAddress,
				coreQuestion: module.coreQuestion,
				currentUnderstanding: module.currentUnderstanding,
				disputes: [...module.disputes],
				claimRefs: [...module.claimRefs].sort(),
				conceptRefs: [...module.conceptRefs].sort(),
				dependencies: [...module.dependencies].sort(),
				publicationState: module.publicationState,
			}))
			.sort((left, right) => left.id.localeCompare(right.id)),
		assertedRecords: assertedRecords
			.map((record) => ({
				...record,
				supportingSourceIds: [...(record.supportingSourceIds ?? [])].sort(),
			}))
			.sort((left, right) => left.assertionId.localeCompare(right.assertionId)),
	};
	return `kv:${createHash("sha256").update(JSON.stringify(snapshot)).digest("hex").slice(0, 24)}`;
}

export function readAllWikiModules(config: AppConfig): WikiModule[] {
	if (!existsSync(config.wikiDir)) return [];
	const modules: WikiModule[] = [];
	for (const file of readdirSync(config.wikiDir).sort()) {
		if (file.endsWith(".json")) {
			const module = readJson<WikiModule>(join(config.wikiDir, file));
			if (module) modules.push(module);
		} else if (file.endsWith(".jsonl")) {
			modules.push(...readJsonl<WikiModule>(join(config.wikiDir, file)));
		}
	}
	return uniqueById(modules).filter((module) => module.publicationState === "CANONICAL");
}

/**
 * 根据 spanId 批量查找 SourceSpan。
 * 从内存中的 spans 数组查找（调用方负责先 readAllSpans）。
 */
export function findSpansByIds(allSpans: SourceSpan[], spanIds: string[]): SourceSpan[] {
	const resolved: SourceSpan[] = [];
	const seen = new Set<string>();
	for (const spanId of spanIds) {
		if (seen.has(spanId)) continue;
		const span = resolveSpanById(allSpans, spanId);
		if (span) {
			seen.add(spanId);
			resolved.push(span);
		}
	}
	return resolved;
}

/** Resolve either a persisted block span or a deterministic char-range child span. */
export function resolveSpanById(allSpans: SourceSpan[], spanId: string): SourceSpan | null {
	const persisted = allSpans.find((span) => span.id === spanId);
	if (persisted) return persisted;

	const match = /^(.*)#chars-(\d+)-(\d+)$/.exec(spanId);
	if (!match) return null;
	const [, baseSpanId, startText, endText] = match;
	const base = allSpans.find((span) => span.id === baseSpanId);
	const charStart = Number(startText);
	const charEnd = Number(endText);
	if (
		!base ||
		!Number.isSafeInteger(charStart) ||
		!Number.isSafeInteger(charEnd) ||
		charStart < base.charStart ||
		charEnd > base.charEnd ||
		charEnd <= charStart
	) {
		return null;
	}

	return {
		...base,
		id: spanId,
		charStart,
		charEnd,
		text: base.text.slice(charStart - base.charStart, charEnd - base.charStart),
	};
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
