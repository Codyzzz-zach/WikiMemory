import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AppConfig } from "../config/types.js";
import {
	publishSourceResult,
	readAllClaims,
	readAllRelations,
	readAllWikiModules,
	readSourcePublications,
	readWikiModuleQuarantine,
} from "../linter/storage.js";
import { RELATION_AUDIT_VERSION } from "../prompts/index.js";
import type { Claim, Relation, WikiModule } from "../types/index.js";
import { claimRef } from "../types/index.js";
import { applyKnowledgeEvolution } from "./transaction.js";
import { currentKnowledgeVersion, restoreKnowledgeSnapshot } from "./version-store.js";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("snapshot-protected knowledge evolution transaction", () => {
	it("persists a cross-source correction, retires stale edges, and fail-closes stale Wiki", () => {
		const config = fixtureConfig();
		const old = claim("claim:old", "通过自动化测试后可以直接发布");
		const guide = claim("claim:guide", "发布指南采用直接发布流程");
		const correction = claim("claim:new", "通过自动化测试后仍需负责人批准");
		const stale = relation("rel:stale", guide.id, old.id, "REQUIRES");
		const trigger = relation("rel:correction", correction.id, old.id, "SUPERSEDES");
		publish(config, "source:old", [old, guide], [stale]);
		publish(config, "source:new", [correction], [trigger]);
		writeJson(join(config.wikiDir, "deployment.json"), wiki("wiki:deployment", [old.id]));
		const before = currentKnowledgeVersion(config);

		const result = applyKnowledgeEvolution(config, [trigger.id], before);

		expect(result.changedSourceIds).toEqual(["source:new", "source:old"]);
		expect(readAllClaims(config).find((item) => item.id === old.id)?.lifecycle).toBe("SUPERSEDED");
		expect(readAllRelations(config).find((item) => item.id === stale.id)?.lifecycle).toBe(
			"SUPERSEDED",
		);
		expect(readAllWikiModules(config)).toEqual([]);
		expect(readWikiModuleQuarantine(config).map((record) => record.module.id)).toEqual([
			"wiki:deployment",
		]);
		expect(
			readSourcePublications(config).every(
				(publication) => publication.evolutionSnapshotId === result.snapshotId,
			),
		).toBe(true);
		expect(result.afterKnowledgeVersion).toBe(currentKnowledgeVersion(config));
		expect(result.afterKnowledgeVersion).not.toBe(before);

		restoreKnowledgeSnapshot(config, result.snapshotId, result.afterKnowledgeVersion);
		expect(currentKnowledgeVersion(config)).toBe(before);
		expect(readAllClaims(config).find((item) => item.id === old.id)?.lifecycle).toBe("ACTIVE");
		expect(readAllWikiModules(config).map((module) => module.id)).toEqual(["wiki:deployment"]);
		expect(readWikiModuleQuarantine(config)).toEqual([]);
	});

	it("automatically restores every Source when a later publication write fails", () => {
		const config = fixtureConfig();
		const first = claim("claim:first", "该许可证允许商业再训练");
		const second = claim("claim:second", "该许可证禁止商业再训练");
		const trigger = relation("rel:conflict", first.id, second.id, "CONTRADICTS");
		publish(config, "source:b", [second], []);
		publish(config, "source:a", [first], [trigger]);
		const before = currentKnowledgeVersion(config);

		expect(() =>
			applyKnowledgeEvolution(config, [trigger.id], before, {
				failAfterPublicationWrites: 1,
			}),
		).toThrow("已自动回滚");

		expect(currentKnowledgeVersion(config)).toBe(before);
		expect(readAllClaims(config).every((item) => item.validity === "SUPPORTED")).toBe(true);
		expect(
			readSourcePublications(config).every(
				(publication) => publication.evolutionSnapshotId === undefined,
			),
		).toBe(true);
	});

	it("rejects a stale optimistic version before creating or writing an evolution", () => {
		const config = fixtureConfig();
		const first = claim("claim:first", "旧规则");
		const second = claim("claim:second", "新规则");
		const trigger = relation("rel:replace", second.id, first.id, "SUPERSEDES");
		publish(config, "source:first", [first], []);
		publish(config, "source:second", [second], [trigger]);

		expect(() => applyKnowledgeEvolution(config, [trigger.id], "kv:stale")).toThrow(
			"知识状态已变化",
		);
		expect(readAllClaims(config).find((item) => item.id === first.id)?.lifecycle).toBe("ACTIVE");
	});

	it("rolls back when post-write evidence verification fails", () => {
		const config = fixtureConfig();
		const old = claim("claim:evidence-old", "旧的审计规则");
		const correction = claim("claim:evidence-new", "新的审计规则");
		const trigger = {
			...relation("rel:evidence-replace", correction.id, old.id, "SUPERSEDES"),
			evidenceSpanIds: ["span:missing"],
		};
		publish(config, "source:evidence-old", [old], []);
		publish(config, "source:evidence-new", [correction], [trigger]);
		const before = currentKnowledgeVersion(config);

		expect(() => applyKnowledgeEvolution(config, [trigger.id], before)).toThrow("已自动回滚");
		expect(currentKnowledgeVersion(config)).toBe(before);
		expect(readAllClaims(config).find((item) => item.id === old.id)?.lifecycle).toBe("ACTIVE");
	});
});

function fixtureConfig(): AppConfig {
	const projectRoot = mkdtempSync(join(tmpdir(), "wge-evolution-transaction-"));
	roots.push(projectRoot);
	const config: AppConfig = {
		projectRoot,
		sourcesDir: join(projectRoot, "sources"),
		wikiDir: join(projectRoot, "wiki"),
		quarantineDir: join(projectRoot, "quarantine"),
		indexesDir: join(projectRoot, "indexes"),
		runsDir: join(projectRoot, "runs"),
		apiKey: "test",
		baseUrl: "http://localhost",
		model: "test",
		temperature: 0,
	};
	mkdirSync(config.wikiDir, { recursive: true });
	return config;
}

function publish(
	config: AppConfig,
	sourceId: string,
	claims: Claim[],
	relations: Relation[],
): void {
	const publishedAt = "2026-07-24T00:00:00.000Z";
	mkdirSync(config.sourcesDir, { recursive: true });
	for (const item of claims) {
		appendFileSync(
			join(config.sourcesDir, "fixture.spans.jsonl"),
			`${JSON.stringify({
				id: item.evidenceSpanIds[0],
				sourceId,
				blockId: `block:${item.id}`,
				charStart: 0,
				charEnd: item.statement.length,
				text: item.statement,
			})}\n`,
			"utf-8",
		);
	}
	publishSourceResult(
		config,
		{
			schemaVersion: "v1",
			sourceId,
			runId: `run:${sourceId}`,
			publishedAt,
			claims,
			concepts: [],
			relations,
		},
		{
			schemaVersion: "v1",
			sourceId,
			runId: `run:${sourceId}`,
			publishedAt,
			claims: [],
			relations: [],
		},
	);
}

function claim(id: string, statement: string): Claim {
	const spanId = `span:${id}`;
	return {
		id,
		statement,
		evidenceSpanIds: [spanId],
		conditions: [],
		derivation: "EXTRACTED",
		validity: "SUPPORTED",
		lifecycle: "ACTIVE",
		publicationState: "CANONICAL",
		validFrom: null,
		validTo: null,
		compilerVersion: "test",
		confidence: 1,
		claimKind: "FACT",
		scope: { type: "GLOBAL" },
		provenanceRefs: [{ type: "SourceSpan", spanId }],
		supportingEvidenceRefs: [{ type: "SourceSpan", spanId }],
		knowledgeVersion: "test",
		recordedAt: "2026-07-24T00:00:00.000Z",
	};
}

function relation(id: string, from: string, to: string, type: Relation["type"]): Relation {
	return {
		id,
		from: claimRef(from),
		to: claimRef(to),
		type,
		conditions: [],
		conditionStatus: "EXPLICIT_NONE",
		relationAuditVersion: RELATION_AUDIT_VERSION,
		evidenceSpanIds: [`span:${from}`, `span:${to}`],
		derivation: "INFERRED",
		validity: "SUPPORTED",
		lifecycle: "ACTIVE",
		publicationState: "CANONICAL",
		validFrom: null,
		validTo: null,
		compilerVersion: "test",
		source: "cross-material-detect",
		confidence: 1,
		consumedBy: [],
	};
}

function wiki(id: string, claimIds: string[]): WikiModule {
	return {
		id,
		stableAddress: "project/deployment",
		coreQuestion: "当前规则是什么？",
		currentUnderstanding: "旧理解",
		disputes: [],
		claimRefs: claimIds.map(claimRef),
		conceptRefs: [],
		dependencies: [],
		publicationState: "CANONICAL",
		updatedAt: "2026-07-24T00:00:00.000Z",
	};
}

function writeJson(path: string, value: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify(value), "utf-8");
}
