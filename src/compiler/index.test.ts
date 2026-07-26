import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AppConfig } from "../config/types.js";
import type { LLMProvider } from "../core/llm-provider.js";
import type { ChatOptions, ChatResult } from "../core/types.js";
import { resolveSpanById } from "../linter/storage.js";
import {
	CLAIM_COMPILE_SYSTEM,
	CONCEPT_CONSOLIDATE_SYSTEM,
	PROPOSITION_EXTRACT_SYSTEM,
	RELATION_DETECT_SYSTEM,
} from "../prompts/index.js";
import type { Claim, Source, SourceSpan } from "../types/index.js";
import {
	compileCrossMaterialRelations,
	compileSource,
	findExplicitlyReferencedSourceIds,
	selectCrossMaterialCandidates,
} from "./index.js";

const temporaryRoots: string[] = [];

afterEach(() => {
	for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("bounded compiler", () => {
	it("shrinks a length-truncated batch and emits resolvable stable evidence", async () => {
		const config = temporaryConfig();
		const source: Source = {
			id: "source:test-abc",
			hash: "abc",
			uri: "test.md",
			parsedText: "Alpha.\nBeta.",
			sourceType: "md",
			loaderVersion: "test",
			createdAt: "2026-07-23T00:00:00.000Z",
		};
		const spans: SourceSpan[] = [
			{
				id: "span:test-0",
				sourceId: source.id,
				blockId: "b0",
				charStart: 0,
				charEnd: 6,
				text: "Alpha.",
			},
			{
				id: "span:test-1",
				sourceId: source.id,
				blockId: "b1",
				charStart: 7,
				charEnd: 12,
				text: "Beta.",
			},
		];
		const provider = new TruncatingProvider();
		const result = await compileSource(config, source, spans, provider);

		expect(provider.propositionCalls).toBe(3);
		expect(result.propositions).toHaveLength(2);
		expect(result.propositions.every((item) => item.relatesTo === undefined)).toBe(true);
		expect(result.claims).toHaveLength(2);
		expect(result.claims.every((item) => item.id.startsWith("claim:abc-"))).toBe(true);
		for (const compiledClaim of result.claims) {
			for (const spanId of compiledClaim.evidenceSpanIds) {
				expect(resolveSpanById(spans, spanId)).not.toBeNull();
			}
		}

		const telemetry = await import("../linter/storage.js").then(({ readJsonl }) =>
			readJsonl<{ eventType: string; finishReason?: string }>(
				join(config.runsDir, "llm-calls.jsonl"),
			),
		);
		expect(
			telemetry.some(
				(event) => event.eventType === "LLM_CALL_COMPLETED" && event.finishReason === "length",
			),
		).toBe(true);

		const resumedProvider = new TruncatingProvider();
		const resumed = await compileSource(config, source, spans, resumedProvider);
		expect(resumed.claims.map((item) => item.id)).toEqual(result.claims.map((item) => item.id));
		expect(resumedProvider.propositionCalls).toBe(0);
	});

	it("retries a non-truncated invalid JSON response once", async () => {
		const config = temporaryConfig();
		const source: Source = {
			id: "source:format-retry",
			hash: "retry",
			uri: "retry.md",
			parsedText: "Alpha.",
			sourceType: "md",
			loaderVersion: "test",
			createdAt: "2026-07-23T00:00:00.000Z",
		};
		const spans: SourceSpan[] = [
			{
				id: "span:retry-0",
				sourceId: source.id,
				blockId: "b0",
				charStart: 0,
				charEnd: 6,
				text: "Alpha.",
			},
		];
		const provider = new InvalidThenValidProvider();
		const result = await compileSource(config, source, spans, provider, {
			existingConcepts: [
				{
					id: "concept:global-alpha",
					name: "Alpha",
					aliases: [],
					boundary: "first letter",
					domain: "math",
				},
			],
		});
		expect(provider.propositionCalls).toBe(2);
		expect(result.claims).toHaveLength(1);
		expect(result.concepts[0]?.id).toBe("concept:global-alpha");
		expect(result.compileStats.totalClaimDrafts).toBe(2);
		expect(result.compileStats.skippedClaims).toEqual([
			{ statement: "Alpha", reason: "DUPLICATE_CLAIM_MERGED" },
		]);
	});

	it("recalls bounded cross-material candidates without matching on a stray bigram", () => {
		const candidates = selectCrossMaterialCandidates(
			[compiledClaim("claim:new", "完备空间中的逐点性质能够推出全局性质")],
			[
				{
					id: "concept:completeness",
					name: "完备性",
					aliases: ["完备空间"],
					boundary: "空间中的柯西列收敛",
					domain: "analysis",
				},
			],
			[
				compiledClaim("claim:relevant", "完备性是泛函分析四大定理的重要前提"),
				compiledClaim("claim:unrelated", "黄金比例可以由一个二次方程定义"),
			],
		);
		expect(candidates.map((claim) => claim.id)).toEqual(["claim:relevant"]);
	});

	it("keeps Source management metadata out of cross-material candidates", () => {
		const candidates = selectCrossMaterialCandidates(
			[compiledClaim("claim:new", "发布日期为 1 月 10 日")],
			[{ id: "concept:date", name: "发布日期", aliases: [], boundary: "日期", domain: "meta" }],
			[compiledClaim("claim:old", "另一文档发布日期为 1 月 7 日")],
		);
		expect(candidates).toEqual([]);
	});

	it("shows endpoint source evidence to cross-material relation detection", async () => {
		const provider = new RelationPromptCaptureProvider();
		const source: Source = {
			id: "source:new-policy-bbb",
			hash: "bbb",
			uri: "new-policy.md",
			parsedText: "发布日不同",
			sourceType: "md",
			loaderVersion: "test",
			createdAt: "2026-07-23T00:00:00.000Z",
		};
		const newClaim = compiledClaim("claim:new", "Northstar 发布流程要求双人审批");
		newClaim.evidenceSpanIds = ["span:new-policy-bbb-1#chars-0-10"];
		const oldClaim = compiledClaim("claim:old", "旧版发布流程要求单人审批");
		oldClaim.evidenceSpanIds = ["span:old-policy-aaa-1#chars-0-9"];
		await compileCrossMaterialRelations(
			temporaryConfig(),
			provider,
			"run:test",
			source,
			[newClaim],
			[
				{
					id: "concept:release",
					name: "发布流程",
					aliases: [],
					boundary: "生产发布治理",
					domain: "platform",
				},
			],
			[oldClaim],
		);
		expect(provider.prompt).toContain("source evidence: span:new-policy-bbb-1");
		expect(provider.prompt).toContain("source evidence: span:old-policy-aaa-1");
	});

	it("recalls claims from a Source explicitly referenced by document identifier", async () => {
		const newSource: Source = {
			id: "source:new-policy-bbb",
			hash: "bbb",
			uri: "new-policy.md",
			parsedText: "本政策取代《旧政策》（OLD-POLICY-2026-01）。新规则改为双人审批。",
			sourceType: "md",
			loaderVersion: "test",
			createdAt: "2026-07-23T00:00:00.000Z",
		};
		const oldSource: Source = {
			id: "source:old-policy-aaa",
			hash: "aaa",
			uri: "old-policy.md",
			parsedText: "文件编号 OLD-POLICY-2026-01。每周日必须由风险委员会线下签字。",
			sourceType: "md",
			loaderVersion: "test",
			createdAt: "2026-07-01T00:00:00.000Z",
		};
		const references = findExplicitlyReferencedSourceIds(newSource, [oldSource]);
		expect([...references]).toEqual([oldSource.id]);
		const oldClaim = compiledClaim("claim:old", "每周日必须由风险委员会线下签字");
		oldClaim.evidenceSpanIds = ["span:old-policy-aaa-3#chars-0-20"];
		const candidates = selectCrossMaterialCandidates(
			[compiledClaim("claim:new", "新规则改为双人审批")],
			[],
			[oldClaim],
			40,
			references,
		);
		expect(candidates.map((claim) => claim.id)).toEqual([oldClaim.id]);
	});

	it("attaches an explicit replacement declaration as edge evidence for SUPERSEDES", async () => {
		const provider = new SupersedesProvider();
		const newSource: Source = {
			id: "source:new-policy-bbb",
			hash: "bbb",
			uri: "new-policy.md",
			parsedText: "本政策取代旧政策 OLD-POLICY-2026-01。新规则要求双人审批。",
			sourceType: "md",
			loaderVersion: "test",
			createdAt: "2026-07-23T00:00:00.000Z",
		};
		const declaration = compiledClaim("claim:declaration", "本政策取代旧政策 OLD-POLICY-2026-01");
		declaration.evidenceSpanIds = ["span:new-policy-bbb-2#chars-0-30"];
		const newRule = compiledClaim("claim:new-rule", "新规则要求双人审批");
		newRule.evidenceSpanIds = ["span:new-policy-bbb-3#chars-31-45"];
		const effectiveDate = compiledClaim("claim:date", "生效日期为 2026-08-01");
		effectiveDate.evidenceSpanIds = ["span:new-policy-bbb-1#chars-0-15"];
		const retained = compiledClaim("claim:retained", "旧政策的审计日志要求继续有效");
		retained.evidenceSpanIds = ["span:new-policy-bbb-2#chars-31-50"];
		const oldRule = compiledClaim("claim:old-rule", "旧规则要求单人审批");
		oldRule.evidenceSpanIds = ["span:old-policy-aaa-4#chars-0-12"];
		const oldSource: Source = {
			id: "source:old-policy-aaa",
			hash: "aaa",
			uri: "old-policy.md",
			parsedText: "文件编号 OLD-POLICY-2026-01。旧规则要求单人审批。",
			sourceType: "md",
			loaderVersion: "test",
			createdAt: "2026-07-01T00:00:00.000Z",
		};
		const result = await compileCrossMaterialRelations(
			temporaryConfig(),
			provider,
			"run:test",
			newSource,
			[declaration, newRule, effectiveDate, retained],
			[],
			[oldRule],
			[oldSource],
		);
		expect(result.relations).toHaveLength(1);
		expect(result.relations[0]?.conditions).toEqual(
			expect.arrayContaining([
				"本政策取代旧政策 OLD-POLICY-2026-01",
				"生效日期为 2026-08-01",
				"旧政策的审计日志要求继续有效",
			]),
		);
		expect(result.relations[0]?.evidenceSpanIds).toEqual(
			expect.arrayContaining([
				"span:new-policy-bbb-2#chars-0-30",
				"span:new-policy-bbb-1#chars-0-15",
				"span:new-policy-bbb-2#chars-31-50",
				"span:new-policy-bbb-3#chars-31-45",
				"span:old-policy-aaa-4#chars-0-12",
			]),
		);
	});

	it("synthesizes an auditable supersession candidate when detection misses an explicit declaration", async () => {
		const newSource: Source = {
			id: "source:new-policy-bbb",
			hash: "bbb",
			uri: "new-policy.md",
			parsedText: "本政策取代旧政策 OLD-POLICY-2026-01。",
			sourceType: "md",
			loaderVersion: "test",
			createdAt: "2026-07-23T00:00:00.000Z",
		};
		const oldSource: Source = {
			id: "source:old-policy-aaa",
			hash: "aaa",
			uri: "old-policy.md",
			parsedText: "文件编号 OLD-POLICY-2026-01。旧规则要求单人审批。",
			sourceType: "md",
			loaderVersion: "test",
			createdAt: "2026-07-01T00:00:00.000Z",
		};
		const declaration = compiledClaim("claim:declaration", "本政策取代旧政策 OLD-POLICY-2026-01");
		declaration.evidenceSpanIds = ["span:new-policy-bbb-2#chars-0-30"];
		const oldRule = compiledClaim("claim:old-rule", "旧规则要求单人审批");
		oldRule.evidenceSpanIds = ["span:old-policy-aaa-4#chars-0-12"];
		const result = await compileCrossMaterialRelations(
			temporaryConfig(),
			new RelationPromptCaptureProvider(),
			"run:test",
			newSource,
			[declaration],
			[],
			[oldRule],
			[oldSource],
		);
		expect(result.relations).toHaveLength(1);
		expect(result.relations[0]).toMatchObject({
			from: declaration.id,
			to: oldRule.id,
			type: "SUPERSEDES",
		});
	});

	it("uses the closest concrete new rule as the supersession endpoint", async () => {
		const newSource: Source = {
			id: "source:new-security-bbb",
			hash: "bbb",
			uri: "new-security.md",
			parsedText: "本通知取代旧标准 OLD-SEC-2026-01。所有外部 API 必须使用 TLS 1.3。",
			sourceType: "md",
			loaderVersion: "test",
			createdAt: "2026-07-23T00:00:00.000Z",
		};
		const oldSource: Source = {
			id: "source:old-security-aaa",
			hash: "aaa",
			uri: "old-security.md",
			parsedText: "文件编号 OLD-SEC-2026-01。所有外部 API 必须使用 TLS 1.2。",
			sourceType: "md",
			loaderVersion: "test",
			createdAt: "2026-07-01T00:00:00.000Z",
		};
		const declaration = compiledClaim("claim:declaration", "本通知取代旧标准 OLD-SEC-2026-01");
		declaration.evidenceSpanIds = ["span:new-security-bbb-2#chars-0-25"];
		const concrete = compiledClaim("claim:tls13", "所有外部 API 必须使用 TLS 1.3");
		concrete.evidenceSpanIds = ["span:new-security-bbb-2#chars-26-48"];
		const retained = compiledClaim("claim:retained", "旧标准的日志规则继续有效");
		retained.evidenceSpanIds = ["span:new-security-bbb-3#chars-0-12"];
		const oldRule = compiledClaim("claim:tls12", "所有外部 API 必须使用 TLS 1.2");
		oldRule.evidenceSpanIds = ["span:old-security-aaa-2#chars-0-22"];
		const result = await compileCrossMaterialRelations(
			temporaryConfig(),
			new RelationPromptCaptureProvider(),
			"run:test",
			newSource,
			[declaration, concrete, retained],
			[],
			[oldRule],
			[oldSource],
		);
		expect(result.relations).toHaveLength(1);
		expect(result.relations[0]).toMatchObject({
			from: concrete.id,
			to: oldRule.id,
			type: "SUPERSEDES",
		});
	});
});

class RelationPromptCaptureProvider implements LLMProvider {
	prompt = "";

	async chat(options: ChatOptions): Promise<ChatResult> {
		if (options.systemPrompt !== RELATION_DETECT_SYSTEM) throw new Error("Unexpected prompt");
		this.prompt = options.messages.map((message) => message.content).join("\n");
		return chatResult('{"relations":[]}');
	}

	async chatWithThinking(options: ChatOptions): Promise<ChatResult> {
		return this.chat(options);
	}
}

class SupersedesProvider implements LLMProvider {
	async chat(options: ChatOptions): Promise<ChatResult> {
		if (options.systemPrompt !== RELATION_DETECT_SYSTEM) throw new Error("Unexpected prompt");
		return chatResult(
			JSON.stringify({
				relations: [
					{
						fromClaimIndex: 1,
						toClaimIndex: 3,
						type: "SUPERSEDES",
						conditions: ["自生效日起"],
						confidence: 0.9,
					},
				],
			}),
		);
	}

	async chatWithThinking(options: ChatOptions): Promise<ChatResult> {
		return this.chat(options);
	}
}

class TruncatingProvider implements LLMProvider {
	propositionCalls = 0;

	async chat(options: ChatOptions): Promise<ChatResult> {
		const prompt = options.messages.map((message) => message.content).join("\n");
		if (options.systemPrompt === PROPOSITION_EXTRACT_SYSTEM) {
			this.propositionCalls++;
			if (this.propositionCalls === 1) {
				return chatResult('{"propositions":[', "length", options.maxTokens ?? 8192);
			}
			const propositions = [
				...(prompt.includes("[b0]")
					? [{ text: "Alpha", exactQuote: "Alpha.", blockId: "b0", relatesTo: null }]
					: []),
				...(prompt.includes("[b1]") ? [{ text: "Beta", exactQuote: "Beta.", blockId: "b1" }] : []),
			];
			return chatResult(JSON.stringify({ propositions }));
		}
		if (options.systemPrompt === CLAIM_COMPILE_SYSTEM) {
			const claims = [
				...(prompt.includes("blockId=b0")
					? [
							{
								statement: "Alpha",
								evidenceQuotes: ["Alpha."],
								blockIds: ["b0"],
								conditions: [],
								derivation: "EXTRACTED",
								confidence: 0.9,
							},
						]
					: []),
				...(prompt.includes("blockId=b1")
					? [
							{
								statement: "Beta",
								evidenceQuotes: ["Beta."],
								blockIds: ["b1"],
								conditions: [],
								derivation: "EXTRACTED",
								confidence: 0.9,
							},
						]
					: []),
			];
			return chatResult(JSON.stringify({ claims }));
		}
		if (options.systemPrompt === CONCEPT_CONSOLIDATE_SYSTEM) {
			return chatResult(
				'{"concepts":[{"name":"Alpha","aliases":[],"boundary":"first letter","domain":"math"}]}',
			);
		}
		if (options.systemPrompt === RELATION_DETECT_SYSTEM) {
			return chatResult('{"relations":[]}');
		}
		throw new Error("Unexpected prompt");
	}

	async chatWithThinking(options: ChatOptions): Promise<ChatResult> {
		return this.chat(options);
	}
}

class InvalidThenValidProvider implements LLMProvider {
	propositionCalls = 0;

	async chat(options: ChatOptions): Promise<ChatResult> {
		if (options.systemPrompt === PROPOSITION_EXTRACT_SYSTEM) {
			this.propositionCalls++;
			if (this.propositionCalls === 1) {
				return chatResult('{"propositions":[{"text":"unescaped "quote""}]}');
			}
			return chatResult(
				JSON.stringify({
					propositions: [{ text: "Alpha", exactQuote: "Alpha.", blockId: "b0" }],
				}),
			);
		}
		if (options.systemPrompt === CLAIM_COMPILE_SYSTEM) {
			return chatResult(
				JSON.stringify({
					claims: [
						{
							statement: "Alpha",
							evidenceQuotes: ["Alpha."],
							blockIds: ["b0"],
							conditions: [],
							derivation: "EXTRACTED",
							confidence: 1,
						},
						{
							statement: "Alpha",
							evidenceQuotes: ["Alpha."],
							blockIds: ["b0"],
							conditions: [],
							derivation: "EXTRACTED",
							confidence: 0.9,
						},
					],
				}),
			);
		}
		if (options.systemPrompt === CONCEPT_CONSOLIDATE_SYSTEM) {
			return chatResult(
				'{"concepts":[{"name":"Alpha","aliases":[],"boundary":"first letter","domain":"math"}]}',
			);
		}
		throw new Error("Unexpected prompt");
	}

	async chatWithThinking(options: ChatOptions): Promise<ChatResult> {
		return this.chat(options);
	}
}

function chatResult(content: string, finishReason = "stop", completionTokens = 10): ChatResult {
	return {
		content,
		model: "test-model",
		finishReason,
		reasoningContentChars: 0,
		usage: {
			promptTokens: 10,
			completionTokens,
			totalTokens: 10 + completionTokens,
			promptCacheHitTokens: 0,
			promptCacheMissTokens: 10,
			reasoningTokens: 0,
		},
	};
}

function compiledClaim(id: string, statement: string): Claim {
	return {
		id,
		statement,
		evidenceSpanIds: [`span:${id}`],
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
		provenanceRefs: [{ type: "SourceSpan", spanId: `span:${id}` }],
		supportingEvidenceRefs: [{ type: "SourceSpan", spanId: `span:${id}` }],
		knowledgeVersion: "v1",
		recordedAt: "2026-07-23T00:00:00.000Z",
	};
}

function temporaryConfig(): AppConfig {
	const projectRoot = mkdtempSync(join(tmpdir(), "wge-compiler-"));
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
		temperature: 0,
	};
}
