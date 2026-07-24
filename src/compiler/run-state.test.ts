import { appendFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AppConfig } from "../config/types.js";
import {
	beginCompileRun,
	finishCompileRun,
	getCompileState,
	recordCompileStage,
} from "./run-state.js";

const temporaryRoots: string[] = [];

afterEach(() => {
	for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("compile run state", () => {
	it("separates source ingestion from retryable compile attempts", () => {
		const config = temporaryConfig();
		const sourceId = "source:test-abc";
		expect(getCompileState(config, sourceId)).toBe("SOURCE_INGESTED");

		const first = beginCompileRun(config, sourceId, "test-model");
		expect(getCompileState(config, sourceId)).toBe("COMPILE_RUNNING");
		recordCompileStage(config, first, "CLAIM_COMPILATION");
		finishCompileRun(config, first, "COMPILE_FAILED", "CLAIM_COMPILATION", "truncated");
		expect(getCompileState(config, sourceId)).toBe("COMPILE_FAILED");

		const retry = beginCompileRun(config, sourceId, "test-model");
		expect(retry.runId).not.toBe(first.runId);
		finishCompileRun(config, retry, "RELATION_SCAN_PENDING", "CROSS_MATERIAL_RELATION_DETECTION");
		expect(getCompileState(config, sourceId)).toBe("RELATION_SCAN_PENDING");

		const relationRetry = beginCompileRun(config, sourceId, "test-model");
		finishCompileRun(config, relationRetry, "COMPLETED", "COMPLETE");
		expect(getCompileState(config, sourceId)).toBe("COMPLETED");
	});

	it("rejects a concurrent run owned by a live process", () => {
		const config = temporaryConfig();
		const sourceId = "source:test-concurrent";
		const run = beginCompileRun(config, sourceId, "test-model");
		expect(() => beginCompileRun(config, sourceId, "test-model")).toThrow("拒绝并发运行");
		finishCompileRun(config, run, "COMPILE_FAILED", "INGESTED", "test cleanup");
	});

	it("fails closed when the state ledger is malformed", () => {
		const config = temporaryConfig();
		mkdirSync(config.runsDir, { recursive: true });
		appendFileSync(join(config.runsDir, "compile-state.jsonl"), "{broken\n", "utf-8");
		expect(() => getCompileState(config, "source:any")).toThrow();
	});

	it("forces a full legacy recompile when Relation audit proof is missing", () => {
		const config = temporaryConfig();
		mkdirSync(config.runsDir, { recursive: true });
		appendFileSync(
			join(config.runsDir, "compile-state.jsonl"),
			`${JSON.stringify({
				eventType: "COMPILE_STATE_CHANGED",
				sourceId: "source:legacy",
				runId: "run:legacy",
				state: "COMPLETED",
				stage: "COMPLETE",
				model: "old-model",
				timestamp: "2026-07-22T00:00:00.000Z",
				hostname: "old-host",
				pid: 1,
			})}\n`,
			"utf-8",
		);
		expect(getCompileState(config, "source:legacy")).toBe("COMPILED");
	});
});

function temporaryConfig(): AppConfig {
	const projectRoot = mkdtempSync(join(tmpdir(), "wge-run-state-"));
	temporaryRoots.push(projectRoot);
	return {
		projectRoot,
		sourcesDir: join(projectRoot, "sources"),
		wikiDir: join(projectRoot, "wiki"),
		quarantineDir: join(projectRoot, "quarantine"),
		indexesDir: join(projectRoot, "indexes"),
		runsDir: join(projectRoot, "runs"),
		apiKey: "test",
		baseUrl: "http://localhost",
		model: "test-model",
	};
}
