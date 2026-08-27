import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AppConfig } from "../config/types.js";
import { publishSourceResult, readAllClaims } from "../linter/storage.js";
import type { Claim } from "../types/index.js";
import { questionRef } from "../types/index.js";
import { publishQuestionEvolution, readAllQuestionFrames } from "../wiki/question-storage.js";
import {
	createKnowledgeSnapshot,
	currentKnowledgeVersion,
	readKnowledgeSnapshot,
	restoreKnowledgeSnapshot,
} from "./version-store.js";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("knowledge snapshot and rollback", () => {
	it("restores the exact published state and removes later derived files", () => {
		const config = fixtureConfig();
		publish(config, "run:t0", [claim("claim:t0", "初始发布规则")]);
		const snapshot = createKnowledgeSnapshot(config, "T0 before correction");

		publish(config, "run:t2", [claim("claim:t2", "纠正后的发布规则")]);
		const extraWiki = join(config.wikiDir, "later.json");
		writeJson(extraWiki, {
			id: "wiki:later",
			stableAddress: "wiki://later",
			coreQuestion: "后续问题",
			currentUnderstanding: "后续理解",
			disputes: [],
			claimRefs: [],
			conceptRefs: [],
			dependencies: [],
			publicationState: "CANONICAL",
			updatedAt: "2026-07-24T00:00:00.000Z",
		});
		expect(existsSync(extraWiki)).toBe(true);
		const mutatedVersion = currentKnowledgeVersion(config);
		expect(mutatedVersion).not.toBe(snapshot.knowledgeVersion);

		restoreKnowledgeSnapshot(config, snapshot.id, mutatedVersion);

		expect(readAllClaims(config).map((item) => item.id)).toEqual(["claim:t0"]);
		expect(currentKnowledgeVersion(config)).toBe(snapshot.knowledgeVersion);
		expect(existsSync(extraWiki)).toBe(false);
		expect(readKnowledgeSnapshot(config, snapshot.id).filesHash).toBe(snapshot.filesHash);
	});

	it("refuses rollback when the caller has a stale current-version precondition", () => {
		const config = fixtureConfig();
		publish(config, "run:t0", [claim("claim:t0", "初始规则")]);
		const snapshot = createKnowledgeSnapshot(config, "T0");
		publish(config, "run:t1", [claim("claim:t1", "变化后的规则")]);
		expect(() => restoreKnowledgeSnapshot(config, snapshot.id, "kv:stale")).toThrow(
			"知识状态已变化",
		);
	});

	it("versions and restores QuestionFrame state with the knowledge snapshot", () => {
		const config = fixtureConfig();
		publish(config, "run:t0", [claim("claim:t0", "初始规则")]);
		publishQuestionEvolution(config, {
			frames: [questionFrame("初始长期问题", "kv:question-1")],
			decisions: [questionDecision("create", "CREATE", "kv:question-1")],
		});
		const snapshot = createKnowledgeSnapshot(config, "before question update");
		const beforeFrame = readAllQuestionFrames(config)[0];

		publishQuestionEvolution(config, {
			frames: [questionFrame("更新后的长期问题", "kv:question-2")],
			decisions: [questionDecision("update", "UPDATE", "kv:question-2")],
		});
		const changedVersion = currentKnowledgeVersion(config);
		expect(changedVersion).not.toBe(snapshot.knowledgeVersion);

		restoreKnowledgeSnapshot(config, snapshot.id, changedVersion);
		expect(readAllQuestionFrames(config)[0]).toEqual(beforeFrame);
		expect(currentKnowledgeVersion(config)).toBe(snapshot.knowledgeVersion);
	});
});

function fixtureConfig(): AppConfig {
	const projectRoot = mkdtempSync(join(tmpdir(), "wge-version-"));
	roots.push(projectRoot);
	return {
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
}

function publish(config: AppConfig, runId: string, claims: Claim[]): void {
	const publishedAt = "2026-07-24T00:00:00.000Z";
	publishSourceResult(
		config,
		{
			schemaVersion: "v1",
			sourceId: "source:test",
			runId,
			publishedAt,
			claims,
			concepts: [],
			relations: [],
		},
		{
			schemaVersion: "v1",
			sourceId: "source:test",
			runId,
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

function writeJson(path: string, value: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify(value), "utf-8");
}

function questionFrame(canonicalQuestion: string, knowledgeVersion: string) {
	return {
		id: questionRef("question:release-policy"),
		stableAddress: "question/release/policy",
		canonicalQuestion,
		aliases: [],
		domain: "release",
		scope: { type: "GLOBAL" as const },
		boundaries: ["只讨论发布规则"],
		lifecycle: "ACTIVE" as const,
		parentQuestionRefs: [],
		childQuestionRefs: [],
		mergedInto: null,
		formationSignals: [
			{
				type: "CLAIM_CLUSTER" as const,
				sourceIds: ["source:test"],
				claimRefs: [],
				relationIds: [],
				conceptRefs: [],
				reason: "稳定问题",
			},
		],
		publicationState: "CANONICAL" as const,
		createdAtKnowledgeVersion: "kv:question-1",
		updatedAtKnowledgeVersion: knowledgeVersion,
		createdAt: "2026-08-20T00:00:00.000Z",
		updatedAt: "2026-08-20T00:00:00.000Z",
	};
}

function questionDecision(suffix: string, action: "CREATE" | "UPDATE", knowledgeVersion: string) {
	return {
		id: `question-decision:${suffix}`,
		knowledgeVersion,
		sourceId: "source:test",
		action,
		questionRefs: [questionRef("question:release-policy")],
		affectedClaimRefs: [],
		affectedRelationIds: [],
		reasonCodes: [action],
		beforeHash: action === "CREATE" ? null : "before",
		afterHash: "after",
		formationVersion: "wge-question-formation/v1",
		createdAt: action === "CREATE" ? "2026-08-20T00:00:00.000Z" : "2026-08-20T00:01:00.000Z",
	};
}
