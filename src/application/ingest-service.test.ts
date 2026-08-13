import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { beginCompileRun, finishCompileRun, getCompileState } from "../compiler/run-state.js";
import { loadConfig } from "../config/index.js";
import type { LLMProvider } from "../core/llm-provider.js";
import type { ChatOptions, ChatResult } from "../core/types.js";
import { ingestFile } from "../ingestor/index.js";
import { IngestApplicationService } from "./ingest-service.js";
import { initializeRuntime } from "./runtime.js";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("IngestApplicationService", () => {
	it("returns an idempotent structured result for an already completed Source", async () => {
		const { config, materialPath } = fixture("# Stable\n\nAlready compiled knowledge.");
		const ingested = ingestFile(config, materialPath);
		const run = beginCompileRun(config, ingested.source.id, config.model);
		finishCompileRun(config, run, "COMPLETED", "COMPLETE");
		const provider = new ThrowingProvider();

		const result = await new IngestApplicationService(config, {
			providerFactory: () => provider,
		}).ingestMaterial({ filePath: materialPath });

		expect(result).toEqual({
			runId: null,
			sourceId: ingested.source.id,
			duplicate: true,
			skipped: true,
			compileState: "COMPLETED",
			summary: {},
		});
		expect(provider.calls).toBe(0);
	});

	it("records COMPILE_FAILED when the provider fails before publication", async () => {
		const { config, materialPath } = fixture("# Failure\n\nA statement that reaches compilation.");
		const provider = new ThrowingProvider();
		const service = new IngestApplicationService(config, { providerFactory: () => provider });

		await expect(service.ingestMaterial({ filePath: materialPath })).rejects.toThrow(
			"injected provider failure",
		);
		const ingested = ingestFile(config, materialPath);
		expect(getCompileState(config, ingested.source.id)).toBe("COMPILE_FAILED");
		expect(provider.calls).toBeGreaterThan(0);
	});
});

class ThrowingProvider implements LLMProvider {
	calls = 0;

	async chat(_options: ChatOptions): Promise<ChatResult> {
		this.calls += 1;
		throw new Error("injected provider failure");
	}

	async chatWithThinking(options: ChatOptions): Promise<ChatResult> {
		return this.chat(options);
	}
}

function fixture(markdown: string) {
	const root = mkdtempSync(join(tmpdir(), "wge-ingest-application-"));
	roots.push(root);
	const config = loadConfig({ runtimeRoot: join(root, "runtime"), apiKey: "test" });
	initializeRuntime(config);
	const materialPath = join(root, "material.md");
	writeFileSync(materialPath, markdown, "utf-8");
	return { config, materialPath };
}
