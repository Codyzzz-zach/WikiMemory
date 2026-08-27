import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../config/index.js";
import type { LLMProvider } from "../core/llm-provider.js";
import type { ChatOptions, ChatResult } from "../core/types.js";
import type { Claim, Source } from "../types/index.js";
import { proposeQuestionCandidates } from "./question-proposer.js";

describe("semantic Question proposal", () => {
	it("parses bounded semantic proposals without granting publication authority", async () => {
		const provider = new FakeProvider(
			JSON.stringify({
				questions: [
					{
						matchQuestionIndex: null,
						canonicalQuestion: "消息系统能提供哪些投递语义？",
						aliases: ["投递保证"],
						scope: { type: "GLOBAL" },
						boundaries: ["只讨论消息系统语义"],
						claimIndexes: [0, 1],
						relationIndexes: [],
						conceptIndexes: [],
						recommendedLifecycle: "ACTIVE",
						rationale: "未来材料可以持续补充、限制或反驳",
					},
				],
			}),
		);
		const result = await proposeQuestionCandidates(config(), provider, proposalInput());
		expect(result.proposals).toHaveLength(1);
		expect(result.proposals[0]?.proposalId).toMatch(/^question-proposal:/);
		expect(result.proposals[0]).not.toHaveProperty("publicationState");
		expect(result.lifecycleProposals).toEqual([]);
		expect(provider.lastOptions?.systemPrompt).toContain("没有发布权限");
		expect(provider.lastOptions?.messages[0]?.content).not.toContain("Agent run");
		const payload = JSON.parse(provider.lastOptions?.messages[0]?.content ?? "{}");
		expect(payload.claims[0]).not.toHaveProperty("id");
		expect(payload.claims[0]?.index).toBe(0);
		expect(result.proposals[0]?.claimIds).toEqual(["claim:one", "claim:two"]);
		expect(result.proposals[0]?.domain).toBe("distributed-systems");
	});

	it("rejects malformed proposal references before the deterministic gate", async () => {
		const provider = new FakeProvider(
			JSON.stringify({
				questions: [
					{
						canonicalQuestion: "问题",
						scope: { type: "GLOBAL" },
						boundaries: [],
						claimIndexes: [],
						recommendedLifecycle: "ACTIVE",
						rationale: "理由",
					},
				],
			}),
		);
		await expect(proposeQuestionCandidates(config(), provider, proposalInput())).rejects.toThrow(
			/不符合 schema/,
		);
	});

	it("rejects an out-of-range local reference before the deterministic gate", async () => {
		const provider = new FakeProvider(
			JSON.stringify({
				questions: [
					{
						matchQuestionIndex: null,
						canonicalQuestion: "消息系统能提供哪些投递语义？",
						aliases: [],
						scope: { type: "GLOBAL" },
						boundaries: ["只讨论消息系统语义"],
						claimIndexes: [2],
						relationIndexes: [],
						conceptIndexes: [],
						recommendedLifecycle: "ACTIVE",
						rationale: "未来材料可以持续更新",
					},
				],
			}),
		);
		await expect(proposeQuestionCandidates(config(), provider, proposalInput())).rejects.toThrow(
			/claimIndex 越界/,
		);
	});
});

class FakeProvider implements LLMProvider {
	lastOptions: ChatOptions | null = null;

	constructor(private readonly content: string) {}

	async chat(options: ChatOptions): Promise<ChatResult> {
		this.lastOptions = options;
		return {
			content: this.content,
			model: "fake",
			finishReason: "stop",
			reasoningContentChars: 0,
			usage: null,
		};
	}

	async chatWithThinking(options: ChatOptions): Promise<ChatResult> {
		return this.chat(options);
	}
}

function config() {
	const root = mkdtempSync(join(tmpdir(), "wge-question-proposer-"));
	return loadConfig({ projectRoot: root, runtimeRoot: root, apiKey: "test", model: "fake" });
}

function proposalInput() {
	return {
		run: { runId: "run:question", sourceId: "source:test", model: "fake" },
		source: source(),
		declaredDomain: "distributed-systems",
		newClaims: [claim("claim:one"), claim("claim:two")],
		relevantRelations: [],
		concepts: [],
		existingFrames: [],
	};
}

function source(): Source {
	return {
		id: "source:test",
		hash: "hash",
		uri: "selected-material.md",
		parsedText: "selected material",
		sourceType: "md",
		loaderVersion: "test",
		metadata: { title: "Selected material" },
		createdAt: "2026-08-20T00:00:00.000Z",
	};
}

function claim(id: string): Claim {
	const spanId = `span:${id}`;
	return {
		id,
		statement: `${id} statement`,
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
		knowledgeVersion: "kv:test",
		recordedAt: "2026-08-20T00:00:00.000Z",
	};
}
