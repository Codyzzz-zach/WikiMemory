import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../config/index.js";
import type { LLMProvider } from "../core/llm-provider.js";
import type { ChatResult } from "../core/types.js";
import { currentKnowledgeVersion } from "../evolution/version-store.js";
import { NaturalLanguageCorrectionApplicationService } from "./correction-parser-service.js";
import { CorrectionApplicationService } from "./correction-service.js";
import { initializeRuntime } from "./runtime.js";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("NaturalLanguageCorrectionApplicationService", () => {
	it("parses a preference but derives personal authority outside the model", async () => {
		const { config, service, chat } = fixture({
			statement: "回答时优先使用中文。",
			claimKind: "PREFERENCE",
			rationale: "用户明确表达了回答语言偏好。",
		});
		const result = await service.propose({
			naturalLanguage: "以后请尽量用中文回答我。",
			idempotencyKey: "nl-preference-1",
		});
		const replay = await service.propose({
			naturalLanguage: "以后请尽量用中文回答我。",
			idempotencyKey: "nl-preference-1",
		});

		expect(result.proposal).toEqual(
			expect.objectContaining({
				claimKind: "PREFERENCE",
				scope: { type: "PERSONAL", id: "alice" },
				authorityBasis: "self",
				state: "COMMIT_READY",
			}),
		);
		expect(result.requiredCommitConfirmation).toBe("CONFIRM:PREFERENCE");
		const typedCorrections = new CorrectionApplicationService(config, {
			principalId: "alice",
			projectRoles: { wiki: "owner" },
		});
		expect(() =>
			typedCorrections.commit({
				proposalId: result.proposal.proposalId,
				expectedKnowledgeVersion: currentKnowledgeVersion(config),
				idempotencyKey: "nl-preference-commit",
			}),
		).toThrow("classificationConfirmation");
		expect(
			typedCorrections.commit({
				proposalId: result.proposal.proposalId,
				expectedKnowledgeVersion: currentKnowledgeVersion(config),
				idempotencyKey: "nl-preference-commit",
				classificationConfirmation: result.requiredCommitConfirmation,
			}),
		).toEqual(expect.objectContaining({ claimId: expect.stringMatching(/^claim:asserted-/) }));
		expect(chat).toHaveBeenCalledWith(
			expect.objectContaining({
				responseFormat: "json_object",
				maxTokens: 800,
				temperature: 0,
				thinkingDisabled: true,
			}),
		);
		expect(chat).toHaveBeenCalledTimes(1);
		expect(replay).toEqual(result);
		await expect(
			service.propose({
				naturalLanguage: "不同的纠正请求。",
				idempotencyKey: "nl-preference-1",
			}),
		).rejects.toThrow("different natural-language request");
		expect(chat).toHaveBeenCalledTimes(1);
	});

	it("requires explicit project scope and a configured role for a parsed decision", async () => {
		const parsed = { statement: "项目每周五发布。", claimKind: "DECISION", rationale: null };
		const { service } = fixture(parsed);
		await expect(
			service.propose({
				naturalLanguage: "我们项目以后每周五发布。",
				idempotencyKey: "nl-decision-no-project",
			}),
		).rejects.toThrow("projectId");
		await expect(
			service.propose({
				naturalLanguage: "我们项目以后每周五发布。",
				projectId: "unknown",
				idempotencyKey: "nl-decision-no-role",
			}),
		).rejects.toThrow("no role");
	});

	it("keeps a parsed world fact unverified and rejects malformed or truncated model output", async () => {
		const { service } = fixture({
			statement: "该药物可以治愈所有患者。",
			claimKind: "FACT",
			rationale: null,
		});
		const proposal = await service.propose({
			naturalLanguage: "我告诉你，这个药对所有人都有效。",
			idempotencyKey: "nl-fact-1",
		});
		expect(proposal.proposal).toEqual(
			expect.objectContaining({
				claimKind: "FACT",
				scope: { type: "GLOBAL" },
				state: "NEEDS_EVIDENCE",
			}),
		);

		const malformed = fixtureRaw({ ...chatResult(), content: "not-json" }).service;
		await expect(
			malformed.propose({ naturalLanguage: "纠正", idempotencyKey: "bad-json" }),
		).rejects.toThrow("不是合法 JSON");
		const truncated = fixtureRaw({ ...chatResult(), finishReason: "length" }).service;
		await expect(
			truncated.propose({ naturalLanguage: "纠正", idempotencyKey: "truncated" }),
		).rejects.toThrow("truncated");
	});
});

function fixture(parsed: object) {
	return fixtureRaw({ ...chatResult(), content: JSON.stringify(parsed) });
}

function fixtureRaw(result: ChatResult) {
	const root = mkdtempSync(join(tmpdir(), "wge-correction-parser-"));
	roots.push(root);
	const config = loadConfig({ runtimeRoot: root, apiKey: "test", model: "test-model" });
	initializeRuntime(config);
	const chat = vi.fn(async () => result);
	const provider: LLMProvider = { chat, chatWithThinking: chat };
	return {
		config,
		chat,
		service: new NaturalLanguageCorrectionApplicationService(
			config,
			{ principalId: "alice", projectRoles: { wiki: "owner" } },
			provider,
		),
	};
}

function chatResult(): ChatResult {
	return {
		content: "{}",
		model: "test-model",
		finishReason: "stop",
		reasoningContentChars: 0,
		usage: {
			promptTokens: 10,
			completionTokens: 5,
			totalTokens: 15,
			promptCacheHitTokens: 0,
			promptCacheMissTokens: 10,
			reasoningTokens: 0,
		},
	};
}
