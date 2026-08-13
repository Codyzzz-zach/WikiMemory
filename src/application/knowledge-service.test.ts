import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CompileRunEvent } from "../compiler/run-state.js";
import { loadConfig } from "../config/index.js";
import type { AppConfig } from "../config/types.js";
import {
	type ContextPackBuildResult,
	buildManagedContextPackWithDiagnostics,
} from "../context-pack/index.js";
import { RELATION_AUDIT_VERSION } from "../prompts/index.js";
import type { Claim, Concept, Relation, Source } from "../types/index.js";
import { KnowledgeApplicationService } from "./knowledge-service.js";
import { initializeRuntime } from "./runtime.js";

const temporaryRoots: string[] = [];

afterEach(() => {
	for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("KnowledgeApplicationService", () => {
	it("normalizes query defaults and delegates through the managed application boundary", () => {
		const managedResult = queryResult("managed");
		const queryManaged = vi.fn(() => managedResult);
		const service = new KnowledgeApplicationService(config(), { queryManaged });

		const result = service.queryContext({ task: "  什么是完备性？  " });

		expect(result).toEqual({ ...managedResult, traceId: expect.any(String) });
		expect(queryManaged).toHaveBeenCalledWith(
			expect.objectContaining({ projectRoot: expect.any(String) }),
			{
				task: "什么是完备性？",
				budgetTokens: 12000,
				maxGraphDepth: 3,
				knowledgeAccess: "MANAGED",
				indexFailurePolicy: "LEGACY_FALLBACK",
			},
		);
	});

	it("keeps legacy reads explicit and rejects invalid transport input before the core", () => {
		const queryLegacy = vi.fn(() => queryResult("legacy"));
		const service = new KnowledgeApplicationService(config(), { queryLegacy });

		expect(
			service.queryContext({
				task: "legacy",
				knowledgeAccess: "LEGACY",
				budgetTokens: 800,
				maxGraphDepth: 0,
			}),
		).toEqual({ ...queryLegacy.mock.results[0]?.value, traceId: expect.any(String) });
		expect(queryLegacy).toHaveBeenCalledTimes(1);
		expect(() => service.queryContext({ task: " " })).toThrow("task must not be empty");
		expect(() => service.queryContext({ task: "x", budgetTokens: 0 })).toThrow("budgetTokens");
		expect(() => service.queryContext({ task: "x", maxGraphDepth: 9 })).toThrow("maxGraphDepth");
	});

	it("returns a stable ingest-status payload without exposing ledger files", () => {
		const sources = [source("source:b"), source("source:a")];
		const completed = event("source:a", "COMPLETED", "COMPLETE");
		const failed = event("source:b", "COMPILE_FAILED", "CLAIM_COMPILATION", "truncated");
		const service = new KnowledgeApplicationService(config(), {
			readSources: () => sources,
			getCompileState: (_config, sourceId) =>
				sourceId === "source:a" ? "COMPLETED" : "COMPILE_FAILED",
			getLatestCompileEvent: (_config, sourceId) => (sourceId === "source:a" ? completed : failed),
		});

		expect(service.getIngestStatus()).toEqual({
			sources: [
				{
					sourceId: "source:a",
					uri: "source:a.md",
					state: "COMPLETED",
					isComplete: true,
					runId: completed.runId,
					stage: "COMPLETE",
					updatedAt: completed.timestamp,
					error: null,
					retryable: false,
				},
				{
					sourceId: "source:b",
					uri: "source:b.md",
					state: "COMPILE_FAILED",
					isComplete: false,
					runId: failed.runId,
					stage: "CLAIM_COMPILATION",
					updatedAt: failed.timestamp,
					error: "truncated",
					retryable: true,
				},
			],
		});
		expect(service.getIngestStatus({ sourceId: "source:a" }).sources).toHaveLength(1);
	});

	it("uses the production relation gate when aggregating status", () => {
		const activeA = claim("claim:a");
		const activeB = claim("claim:b");
		const quarantined = claim("claim:q", { publicationState: "QUARANTINED" });
		const valid = relation("rel:valid", "claim:a", "claim:b");
		const stale = relation("rel:stale", "claim:a", "claim:b", {
			relationAuditVersion: "v0",
		});
		const dangling = relation("rel:dangling", "claim:a", "claim:missing");
		const service = new KnowledgeApplicationService(config(), {
			readClaims: () => [activeA, activeB],
			readQuarantinedClaims: () => [quarantined],
			readConcepts: () => [] as Concept[],
			readRelations: () => [valid, stale, dangling],
			readSources: () => [source("source:a")],
			readSpans: () => [],
			getCompileState: () => "COMPILED",
			getLatestCompileEvent: () => null,
		});

		expect(service.getStatus()).toEqual(
			expect.objectContaining({
				totalClaims: 2,
				canonicalActiveClaims: 2,
				quarantinedClaims: 1,
				totalRelations: 3,
				consumableRelations: 1,
				totalSources: 1,
				completedSources: 0,
			}),
		);
	});

	it("preserves query semantics while exposing index build then reuse lifecycle", () => {
		const runtimeRoot = mkdtempSync(join(tmpdir(), "wge-application-parity-"));
		temporaryRoots.push(runtimeRoot);
		const runtimeConfig = loadConfig({ runtimeRoot, apiKey: "" });
		initializeRuntime(runtimeConfig);
		const request = {
			task: "跨领域知识如何关联？",
			budgetTokens: 1800,
			maxGraphDepth: 1,
			knowledgeAccess: "MANAGED" as const,
			indexFailurePolicy: "FAIL_CLOSED" as const,
		};

		const throughApplication = new KnowledgeApplicationService(runtimeConfig).queryContext(request);
		const throughCore = buildManagedContextPackWithDiagnostics(
			runtimeConfig,
			request.task,
			request.budgetTokens,
			request.maxGraphDepth,
			undefined,
			{ indexFailurePolicy: request.indexFailurePolicy },
		);

		expect(throughApplication.pack).toEqual(throughCore.pack);
		expect(throughApplication.diagnostics.retrieval).toEqual(throughCore.diagnostics.retrieval);
		expect(throughApplication.diagnostics.graph).toEqual(throughCore.diagnostics.graph);
		expect(throughApplication.diagnostics.wiki).toEqual(throughCore.diagnostics.wiki);
		expect(throughApplication.diagnostics.budget).toEqual(throughCore.diagnostics.budget);
		expect(throughApplication.diagnostics.knowledgeAccess).toEqual(
			expect.objectContaining({ lifecycle: "BUILT", mode: "INDEXED" }),
		);
		expect(throughCore.diagnostics.knowledgeAccess).toEqual(
			expect.objectContaining({ lifecycle: "REUSED", mode: "INDEXED" }),
		);
	});

	it("traces only visible canonical knowledge and rejects direct span browsing", () => {
		const global = claim("claim:global", {
			evidenceSpanIds: [],
			supportingEvidenceRefs: [{ type: "SourceSpan", spanId: "span:global" }],
		});
		const personal = claim("claim:personal", {
			evidenceSpanIds: ["span:personal"],
			scope: { type: "PERSONAL", id: "alice" },
		});
		const edge = relation("rel:visible", global.id, personal.id);
		const service = new KnowledgeApplicationService(config(), {
			readClaims: () => [global, personal],
			readRelations: () => [edge],
			readConcepts: () => [],
			readWikiModules: () => [],
			readSpans: () => [
				{
					id: "span:global",
					sourceId: "source:global",
					blockId: "g",
					charStart: 0,
					charEnd: 6,
					text: "global",
				},
				{
					id: "span:personal",
					sourceId: "source:personal",
					blockId: "p",
					charStart: 0,
					charEnd: 8,
					text: "personal",
				},
			],
			readSources: () => [source("source:global"), source("source:personal")],
		});

		expect(service.traceKnowledge({ objectId: global.id })).toEqual(
			expect.objectContaining({
				objectType: "CLAIM",
				evidenceSpans: [expect.objectContaining({ id: "span:global" })],
				sources: [expect.objectContaining({ id: "source:global" })],
			}),
		);
		expect(service.traceKnowledge({ objectId: global.id }).sources[0]).not.toHaveProperty(
			"parsedText",
		);
		expect(() => service.traceKnowledge({ objectId: personal.id })).toThrow("not found");
		expect(() => service.traceKnowledge({ objectId: edge.id })).toThrow("not found");
		expect(() => service.traceKnowledge({ objectId: "span:global" })).toThrow("not found");
		expect(
			service.traceKnowledge({
				objectId: edge.id,
				scopeContext: { principalId: "alice" },
			}),
		).toEqual(expect.objectContaining({ objectType: "RELATION", relation: edge }));
	});
});

function config(): AppConfig {
	const projectRoot = mkdtempSync(join(tmpdir(), "wge-application-"));
	temporaryRoots.push(projectRoot);
	return {
		projectRoot,
		sourcesDir: join(projectRoot, "sources"),
		wikiDir: join(projectRoot, "wiki"),
		quarantineDir: join(projectRoot, "quarantine"),
		indexesDir: join(projectRoot, "indexes"),
		runsDir: join(projectRoot, "runs"),
		apiKey: "",
		baseUrl: "http://localhost",
		model: "test-model",
		temperature: 0,
	};
}

function queryResult(taskMap: string): ContextPackBuildResult {
	return {
		pack: {
			knowledgeVersion: "kv:test",
			taskMap,
			subgraph: { claims: [], relations: [] },
			wikiModules: [],
			evidenceSpans: [],
			conflictsAndConditions: [],
			selectionLog: [],
			knownGaps: [],
		},
		diagnostics: {},
	} as unknown as ContextPackBuildResult;
}

function source(id: string): Source {
	return {
		id,
		hash: `hash:${id}`,
		uri: `${id}.md`,
		parsedText: id,
		sourceType: "md",
		loaderVersion: "test",
		createdAt: "2026-08-13T00:00:00.000Z",
	};
}

function event(
	sourceId: string,
	state: CompileRunEvent["state"],
	stage: CompileRunEvent["stage"],
	error?: string,
): CompileRunEvent {
	return {
		eventType: "COMPILE_STATE_CHANGED",
		sourceId,
		runId: `run:${sourceId}`,
		state,
		stage,
		model: "test",
		timestamp: "2026-08-13T00:00:00.000Z",
		hostname: "test",
		pid: 1,
		...(error ? { error } : {}),
	};
}

function claim(id: string, overrides: Partial<Claim> = {}): Claim {
	return {
		id: id as Claim["id"],
		statement: id,
		evidenceSpanIds: [],
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
		provenanceRefs: [],
		supportingEvidenceRefs: [],
		knowledgeVersion: "kv:test",
		recordedAt: "2026-08-13T00:00:00.000Z",
		...overrides,
	};
}

function relation(
	id: string,
	from: string,
	to: string,
	overrides: Partial<Relation> = {},
): Relation {
	return {
		id: id as Relation["id"],
		from: from as Relation["from"],
		to: to as Relation["to"],
		type: "SUPPORTS",
		conditions: [],
		conditionStatus: "EXPLICIT_NONE",
		supersessionEffect: null,
		relationAuditVersion: RELATION_AUDIT_VERSION,
		evidenceSpanIds: [],
		derivation: "INFERRED",
		validity: "SUPPORTED",
		lifecycle: "ACTIVE",
		publicationState: "CANONICAL",
		validFrom: null,
		validTo: null,
		compilerVersion: "test",
		source: "human-confirm",
		confidence: 1,
		consumedBy: [],
		...overrides,
	};
}
