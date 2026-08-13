import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { beginCompileRun, finishCompileRun } from "../compiler/run-state.js";
import { loadConfig } from "../config/index.js";
import { currentKnowledgeVersion } from "../evolution/version-store.js";
import { ingestLoadedDocument } from "../ingestor/index.js";
import { publishSourceResult } from "../linter/storage.js";
import type { Claim } from "../types/index.js";
import { KnowledgeApplicationService } from "./knowledge-service.js";
import { RUNTIME_LAYOUT_VERSION, assertRuntimeReady, initializeRuntime } from "./runtime.js";

const temporaryRoots: string[] = [];

afterEach(() => {
	for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("runtime layout", () => {
	it("keeps configuration loading side-effect free and initializes only on demand", () => {
		const root = temporaryRoot();
		const runtimeRoot = join(root, "runtime-data");
		const config = loadConfig({ projectRoot: root, runtimeRoot, apiKey: "" });

		expect(config.projectRoot).toBe(runtimeRoot);
		expect(config.runtimeRoot).toBe(runtimeRoot);
		expect(existsSync(runtimeRoot)).toBe(false);

		const manifest = initializeRuntime(config);
		expect(manifest.schemaVersion).toBe(RUNTIME_LAYOUT_VERSION);
		expect(existsSync(join(runtimeRoot, "sources"))).toBe(true);
		expect(existsSync(join(runtimeRoot, "publications"))).toBe(true);
		expect(assertRuntimeReady(config)).toEqual(manifest);
	});

	it("is idempotent and rejects an incompatible on-disk layout", () => {
		const root = temporaryRoot();
		const config = loadConfig({ runtimeRoot: root, apiKey: "" });
		const first = initializeRuntime(config);
		const second = initializeRuntime(config);
		expect(second).toEqual(first);

		writeFileSync(
			join(root, "runtime-layout.json"),
			JSON.stringify({ ...first, schemaVersion: "wge-runtime-layout/v999" }),
		);
		expect(() => initializeRuntime(config)).toThrow("Unsupported runtime layout");
		expect(() => assertRuntimeReady(config)).toThrow("Unsupported runtime layout");
	});

	it("rejects a tampered directory contract instead of trusting paths from disk", () => {
		const root = temporaryRoot();
		const config = loadConfig({ runtimeRoot: root, apiKey: "" });
		const manifest = initializeRuntime(config);
		writeFileSync(
			join(root, "runtime-layout.json"),
			JSON.stringify({ ...manifest, directories: ["../outside"] }),
		);

		expect(() => initializeRuntime(config)).toThrow("directory contract mismatch");
		expect(() => assertRuntimeReady(config)).toThrow("directory contract mismatch");
	});

	it("migrates the additive v1 layout only through explicit initialization", () => {
		const root = temporaryRoot();
		const config = loadConfig({ runtimeRoot: root, apiKey: "" });
		const createdAt = "2026-08-12T00:00:00.000Z";
		writeFileSync(
			join(root, "runtime-layout.json"),
			JSON.stringify({
				schemaVersion: "wge-runtime-layout/v1",
				createdAt,
				directories: [
					"sources",
					"publications",
					"quarantine/publications",
					"quarantine/wiki",
					"wiki",
					"claims",
					"concepts",
					"relations",
					"assertions",
					"versions",
					"indexes",
					"runs",
				],
			}),
		);

		expect(() => assertRuntimeReady(config)).toThrow("Unsupported runtime layout");
		expect(initializeRuntime(config)).toEqual(
			expect.objectContaining({ schemaVersion: RUNTIME_LAYOUT_VERSION, createdAt }),
		);
		expect(existsSync(join(root, "jobs"))).toBe(true);
		expect(assertRuntimeReady(config).directories).toContain("jobs");
	});

	it("restores canonical knowledge and incomplete job visibility through a fresh application", () => {
		const root = temporaryRoot();
		const config = loadConfig({ runtimeRoot: root, apiKey: "" });
		initializeRuntime(config);
		const completed = ingest(config, "completed", "Alpha evidence.");
		const pending = ingest(config, "pending", "Beta evidence.");
		const completedRun = beginCompileRun(config, completed.source.id, "test-model");
		const publishedAt = "2026-08-13T00:00:00.000Z";
		publishSourceResult(
			config,
			{
				schemaVersion: "v1",
				sourceId: completed.source.id,
				runId: completedRun.runId,
				publishedAt,
				claims: [claim(completed.spans[0]?.id ?? "")],
				concepts: [],
				relations: [],
			},
			{
				schemaVersion: "v1",
				sourceId: completed.source.id,
				runId: completedRun.runId,
				publishedAt,
				claims: [],
				relations: [],
			},
		);
		finishCompileRun(config, completedRun, "COMPLETED", "COMPLETE");
		beginCompileRun(config, pending.source.id, "test-model");
		const knowledgeVersion = currentKnowledgeVersion(config);

		const restartedConfig = loadConfig({ runtimeRoot: root, apiKey: "" });
		assertRuntimeReady(restartedConfig);
		const restarted = new KnowledgeApplicationService(restartedConfig);
		const status = restarted.getStatus();

		expect(status.totalSources).toBe(2);
		expect(status.totalClaims).toBe(1);
		expect(status.completedSources).toBe(1);
		expect(status.incompleteSources).toEqual([
			expect.objectContaining({ sourceId: pending.source.id, state: "COMPILE_RUNNING" }),
		]);
		expect(currentKnowledgeVersion(restartedConfig)).toBe(knowledgeVersion);
	});
});

function temporaryRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "wge-runtime-"));
	temporaryRoots.push(root);
	return root;
}

function ingest(config: ReturnType<typeof loadConfig>, sourceKey: string, text: string) {
	return ingestLoadedDocument(config, {
		uri: `memory://${sourceKey}`,
		sourceType: "md",
		loaderVersion: "test/v1",
		sourceKey,
		title: sourceKey,
		parsedText: text,
		blocks: [{ blockId: "block-0", kind: "paragraph", charStart: 0, charEnd: text.length, text }],
	});
}

function claim(evidenceSpanId: string): Claim {
	return {
		id: "claim:restart-persistence",
		statement: "Alpha evidence persists.",
		evidenceSpanIds: [evidenceSpanId],
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
	};
}
