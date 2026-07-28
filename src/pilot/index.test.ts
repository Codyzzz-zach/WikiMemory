import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AppConfig } from "../config/types.js";
import { preparePilotContext } from "./index.js";
import type { PilotConfig } from "./index.js";

describe("pilot context preparation", () => {
	it("builds a deterministic budgeted folder-search baseline", () => {
		const root = mkdtempSync(join(tmpdir(), "wge-pilot-"));
		mkdirSync(join(root, "corpus"));
		writeFileSync(
			join(root, "corpus", "spaces.md"),
			"# 空间\n\nBanach 空间是完备赋范空间。\n\n# 无关\n\n黄金比例是一个常数。",
		);
		const config = appConfig(root);
		const pilot = pilotConfig();
		const first = preparePilotContext(
			config,
			pilot,
			{ id: "q1", question: "Banach 空间为什么需要完备性？" },
			"B",
		);
		const second = preparePilotContext(
			config,
			pilot,
			{ id: "q1", question: "Banach 空间为什么需要完备性？" },
			"B",
		);
		expect(first.context).toContain("Banach 空间是完备赋范空间");
		expect(first.contextHash).toBe(second.contextHash);
		expect(first.estimatedContextTokens).toBeLessThanOrEqual(pilot.retrieval.contextBudgetTokens);
		expect(first.retrievalTrace).toMatchObject({
			strategy: "folder-lexical",
			corpusChunkCount: 2,
		});
	});
});

function appConfig(root: string): AppConfig {
	return {
		projectRoot: root,
		sourcesDir: join(root, "sources"),
		wikiDir: join(root, "wiki"),
		quarantineDir: join(root, "quarantine"),
		indexesDir: join(root, "indexes"),
		runsDir: join(root, "runs"),
		apiKey: "test",
		baseUrl: "http://localhost",
		model: "test-model",
		temperature: 0,
	};
}

function pilotConfig(): PilotConfig {
	return {
		schemaVersion: "wge-pilot-config/v1",
		status: "LOCKED",
		corpus: ["corpus/spaces.md"],
		compiler: { model: "test-model", temperature: 0, thinkingDisabled: true },
		answer: {
			model: "test-model",
			temperature: 0,
			thinkingDisabled: true,
			maxOutputTokens: 100,
		},
		judge: {
			model: "test-model",
			temperature: 0,
			thinkingDisabled: true,
			maxOutputTokens: 100,
		},
		retrieval: {
			contextBudgetTokens: 100,
			maxGraphDepth: 2,
			maxFolderChunks: 2,
			folderChunkChars: 80,
		},
		execution: {
			groups: ["B", "P", "E-min"],
			externalRetrievalNetwork: false,
			maxToolCalls: 1,
			timeoutMs: 1000,
		},
	};
}
