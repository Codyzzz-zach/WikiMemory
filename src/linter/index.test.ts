import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AppConfig } from "../config/types.js";
import type { LLMProvider } from "../core/llm-provider.js";
import type { ChatOptions, ChatResult } from "../core/types.js";
import {
	RELATED_TO_UTILITY_CRITIC_BATCH_SYSTEM,
	RELATED_TO_UTILITY_CRITIC_SYSTEM,
	RELATION_AUDIT_SYSTEM,
	RELATION_AUDIT_VERSION,
	RELATION_TYPE_CRITIC_SYSTEM,
	SEMANTIC_AUDIT_SYSTEM,
} from "../prompts/index.js";
import type { AssertedRecord, Claim, Relation, SourceSpan } from "../types/index.js";
import { claimRef } from "../types/index.js";
import {
	checkClaimStructure,
	checkRelationStructure,
	lintCompileResult,
	semanticCheck,
} from "./index.js";
import { appendAssertedRecords } from "./storage.js";

const temporaryRoots: string[] = [];

afterEach(() => {
	for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("semantic audit infrastructure failures", () => {
	it("fails the run instead of misclassifying a Claim as unfaithful", async () => {
		const provider = new InvalidAuditProvider();
		await expect(semanticCheck(temporaryConfig(), claim(), [span()], provider)).rejects.toThrow(
			"连续两次无法产生可信结构化结果",
		);
		expect(provider.calls).toBe(2);
	});

	it("keeps structurally published Claims unresolved when semantic lint is skipped", async () => {
		const result = await lintCompileResult(temporaryConfig(), [claim()], [], [], [span()], null, {
			skipSemantic: true,
		});
		expect(result.canonicalClaims).toHaveLength(1);
		expect(result.canonicalClaims[0]?.validity).toBe("UNRESOLVED");
	});

	it("rejects a parseable verdict whose summary contradicts its dimensions", async () => {
		const provider = new StaticAuditProvider({
			verdict: "passed",
			dimensions: passingDimensions({ support: "fail" }),
			anchorSpanIndex: 0,
			failedDimensions: ["support"],
		});
		await expect(semanticCheck(temporaryConfig(), claim(), [span()], provider)).rejects.toThrow(
			"verdict 与维度结果不一致",
		);
		expect(provider.calls).toBe(2);
	});

	it("reuses only a validated semantic verdict from the audit cache", async () => {
		const provider = new StaticAuditProvider({
			verdict: "passed",
			dimensions: passingDimensions(),
			anchorSpanIndex: 0,
			failedDimensions: [],
		});
		const config = temporaryConfig();
		expect(await semanticCheck(config, claim(), [span()], provider)).toEqual([]);
		expect(await semanticCheck(config, claim(), [span()], provider)).toEqual([]);
		expect(provider.calls).toBe(1);
	});
});

describe("bounded batch semantic audit", () => {
	it("shares audit prompts while preserving per-object Claim and Relation verdicts", async () => {
		const provider = new BatchPassProvider();
		const claims = Array.from({ length: 4 }, (_, index) =>
			claim(`claim:${index}`, `Claim ${index}`, `span:${index}`),
		);
		const spans = claims.map((candidate, index) =>
			span(candidate.evidenceSpanIds[0] as string, `Claim ${index}.`),
		);
		const relations = [0, 1, 2].map((index) => ({
			...relation(claims[index] as Claim, claims[index + 1] as Claim),
			id: `rel:${index}`,
		}));
		const result = await lintCompileResult(
			temporaryConfig(),
			claims,
			relations,
			[],
			spans,
			provider,
			{ run: { sourceId: "source:test", runId: "run:batch", model: "test-model" } },
		);
		expect(result.canonicalClaims).toHaveLength(4);
		expect(result.canonicalRelations).toHaveLength(3);
		expect(provider.claimCalls).toBe(1);
		expect(provider.relationCalls).toBe(1);
		expect(provider.criticCalls).toBe(3);
	});

	it("rejects an incomplete envelope and shrinks until every Claim has an independent verdict", async () => {
		const provider = new ShrinkingBatchProvider();
		const claims = Array.from({ length: 4 }, (_, index) =>
			claim(`claim:${index}`, `Claim ${index}`, `span:${index}`),
		);
		const spans = claims.map((candidate, index) =>
			span(candidate.evidenceSpanIds[0] as string, `Claim ${index}.`),
		);
		const result = await lintCompileResult(temporaryConfig(), claims, [], [], spans, provider, {
			run: { sourceId: "source:test", runId: "run:shrink", model: "test-model" },
		});
		expect(result.canonicalClaims).toHaveLength(4);
		expect(provider.claimCalls).toBe(3);
		expect(provider.batchSizes).toEqual([4, 2, 2]);
	});

	it("shrinks an invalid RELATED_TO utility envelope and fails closed only for the bad singleton", async () => {
		const provider = new ShrinkingUtilityBatchProvider();
		const claims = [
			claim("claim:0", "Northstar model family", "span:0"),
			claim("claim:1", "Northstar uses a community license", "span:1"),
			claim("claim:2", "Northstar supports eight languages", "span:2"),
		];
		const spans = claims.map((candidate, index) =>
			span(candidate.evidenceSpanIds[0] as string, candidate.statement, `source:${index}`),
		);
		const relations = [1, 2].map((toIndex, index) => ({
			...relation(claims[0] as Claim, claims[toIndex] as Claim),
			id: `rel:utility-${index}`,
			type: "RELATED_TO" as const,
			source: "cross-material-detect" as const,
		}));
		const result = await lintCompileResult(
			temporaryConfig(),
			claims,
			relations,
			[],
			spans,
			provider,
			{ run: { sourceId: "source:test", runId: "run:utility-shrink", model: "test-model" } },
		);

		expect(result.canonicalRelations.map((item) => item.id)).toEqual(["rel:utility-0"]);
		expect(result.quarantinedRelations).toEqual([
			expect.objectContaining({
				relation: expect.objectContaining({ id: "rel:utility-1" }),
				issues: expect.arrayContaining([
					expect.objectContaining({ code: "RELATION_AUDIT_INVALID" }),
				]),
			}),
		]);
		expect(provider.utilityBatchSizes).toEqual([2, 1, 1, 1]);
	});
});

describe("relation and provenance gates", () => {
	it("does not promote a Relation merely because both endpoint Claims passed", async () => {
		const provider = new ClaimPassRelationFailProvider();
		const claims = [claim("claim:a", "Alpha", "span:a"), claim("claim:b", "Beta", "span:b")];
		const spans = [span("span:a", "Alpha."), span("span:b", "Beta.")];
		const result = await lintCompileResult(
			temporaryConfig(),
			claims,
			[relation(claims[0] as Claim, claims[1] as Claim)],
			[],
			spans,
			provider,
		);
		expect(result.canonicalClaims).toHaveLength(2);
		expect(result.canonicalRelations).toHaveLength(0);
		expect(result.quarantinedRelations[0]?.issues[0]?.code).toBe("RELATION_SEMANTIC_FAILED");
	});

	it("deterministically quarantines cross-source metadata before LLM relation audit", async () => {
		const provider = new ClaimPassRelationIdentityFailProvider();
		const claims = [
			claim("claim:a", "文档发布日期为 1 月 7 日", "span:a"),
			claim("claim:b", "另一文档发布日期为 1 月 10 日", "span:b"),
		];
		const candidate = relation(claims[0] as Claim, claims[1] as Claim);
		candidate.type = "CONTRADICTS";
		candidate.source = "cross-material-detect";
		const result = await lintCompileResult(
			temporaryConfig(),
			claims,
			[candidate],
			[],
			[
				span("span:a", "发布日期为 1 月 7 日。", "source:document-a"),
				span("span:b", "发布日期为 1 月 10 日。", "source:document-b"),
			],
			provider,
		);
		expect(result.canonicalRelations).toHaveLength(0);
		expect(result.quarantinedRelations[0]?.issues[0]?.code).toBe("RELATION_PROVENANCE_ONLY");
		expect(provider.relationAuditCalls).toBe(0);
	});

	it("separates semantic validity from weak-edge navigation utility", async () => {
		const provider = new ClaimPassRelationUtilityFailProvider();
		const claims = [
			claim("claim:a", "Northstar 3.1 使用新的许可证", "span:a"),
			claim("claim:b", "Northstar 3.1 支持八种语言", "span:b"),
		];
		const candidate = relation(claims[0] as Claim, claims[1] as Claim);
		candidate.type = "RELATED_TO";
		candidate.source = "cross-material-detect";
		const result = await lintCompileResult(
			temporaryConfig(),
			claims,
			[candidate],
			[],
			[span("span:a", claims[0]?.statement ?? ""), span("span:b", claims[1]?.statement ?? "")],
			provider,
		);
		expect(result.canonicalRelations).toHaveLength(0);
		expect(result.quarantinedRelations[0]?.issues).toEqual(
			expect.arrayContaining([expect.objectContaining({ code: "RELATION_UTILITY_LOW" })]),
		);
	});

	it("keeps an independently reviewed complementary RELATED_TO edge", async () => {
		const provider = new ClaimPassRelationUtilityPassProvider();
		const claims = [
			claim("claim:a", "Northstar 更新许可证，允许模型输出用于改进其他模型", "span:a"),
			claim("claim:b", "Northstar 3.1 使用 Community License 授权", "span:b"),
		];
		const candidate = relation(claims[0] as Claim, claims[1] as Claim);
		candidate.type = "RELATED_TO";
		candidate.source = "cross-material-detect";
		const result = await lintCompileResult(
			temporaryConfig(),
			claims,
			[candidate],
			[],
			[span("span:a", claims[0]?.statement ?? ""), span("span:b", claims[1]?.statement ?? "")],
			provider,
		);
		expect(result.canonicalRelations).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "RELATED_TO",
					relationAuditVersion: RELATION_AUDIT_VERSION,
				}),
			]),
		);
	});

	it("quarantines a RELATED_TO edge whose shared unit measures different semantic slots", async () => {
		const provider = new ClaimPassRelationMeasurementMismatchProvider();
		const claims = [
			claim("claim:a", "Northstar 的训练数据量为 15T token", "span:a"),
			claim("claim:b", "Northstar 的上下文窗口为 128K token", "span:b"),
		];
		const candidate = relation(claims[0] as Claim, claims[1] as Claim);
		candidate.type = "RELATED_TO";
		candidate.source = "cross-material-detect";
		const result = await lintCompileResult(
			temporaryConfig(),
			claims,
			[candidate],
			[],
			[span("span:a", claims[0]?.statement ?? ""), span("span:b", claims[1]?.statement ?? "")],
			provider,
		);
		expect(result.canonicalRelations).toHaveLength(0);
		expect(result.quarantinedRelations[0]?.issues).toEqual(
			expect.arrayContaining([expect.objectContaining({ code: "RELATION_UTILITY_LOW" })]),
		);
	});

	it("quarantines a passed Relation audit without edge-level supporting evidence", async () => {
		const provider = new ClaimPassRelationPassWithoutSupportProvider();
		const claims = [claim("claim:a", "Alpha", "span:a"), claim("claim:b", "Beta", "span:b")];
		const spans = [span("span:a", "Alpha."), span("span:b", "Beta.")];
		const result = await lintCompileResult(
			temporaryConfig(),
			claims,
			[relation(claims[0] as Claim, claims[1] as Claim)],
			[],
			spans,
			provider,
		);
		expect(result.canonicalRelations).toHaveLength(0);
		expect(result.quarantinedRelations[0]?.issues[0]?.code).toBe("RELATION_AUDIT_INVALID");
	});

	it("quarantines an invalid Relation audit without blocking endpoint Claims", async () => {
		const provider = new ClaimPassRelationInvalidProvider();
		const claims = [claim("claim:a", "Alpha", "span:a"), claim("claim:b", "Beta", "span:b")];
		const result = await lintCompileResult(
			temporaryConfig(),
			claims,
			[relation(claims[0] as Claim, claims[1] as Claim)],
			[],
			[span("span:a", "Alpha."), span("span:b", "Beta.")],
			provider,
		);
		expect(result.canonicalClaims).toHaveLength(2);
		expect(result.canonicalRelations).toHaveLength(0);
		expect(result.quarantinedRelations[0]?.issues[0]?.code).toBe("RELATION_AUDIT_INVALID");
		expect(provider.relationAuditCalls).toBe(2);
	});

	it("rejects a FACT supported only by a user assertion", () => {
		const candidate = claim();
		candidate.evidenceSpanIds = [];
		candidate.provenanceRefs = [{ type: "AssertedRecord", assertionId: "assert:1" }];
		candidate.supportingEvidenceRefs = [{ type: "AssertedRecord", assertionId: "assert:1" }];
		expect(
			checkClaimStructure(candidate, [span()]).some(
				(issue) => issue.code === "INVALID_SUPPORTING_EVIDENCE",
			),
		).toBe(true);
	});

	it("accepts a PERSONAL preference backed by its resolvable AssertedRecord", () => {
		const candidate = claim("claim:preference", "我偏好先看结论", "span:unused");
		candidate.claimKind = "PREFERENCE";
		candidate.scope = { type: "PERSONAL", id: "user:alice" };
		candidate.evidenceSpanIds = [];
		candidate.provenanceRefs = [{ type: "AssertedRecord", assertionId: "assert:preference" }];
		candidate.supportingEvidenceRefs = [
			{ type: "AssertedRecord", assertionId: "assert:preference" },
		];
		const record: AssertedRecord = {
			assertionId: "assert:preference",
			claimId: candidate.id,
			assertedBy: "user:alice",
			assertedAt: "2026-07-23T00:00:00.000Z",
			scope: candidate.scope,
			authorityBasis: "本人偏好",
			assertionText: candidate.statement,
		};
		expect(checkClaimStructure(candidate, [], [record])).toEqual([]);
	});

	it("publishes a validated preference without pretending it has SourceSpan evidence", async () => {
		const config = temporaryConfig();
		const candidate = claim("claim:preference", "我偏好先看结论", "span:unused");
		candidate.claimKind = "PREFERENCE";
		candidate.scope = { type: "PERSONAL", id: "user:alice" };
		candidate.evidenceSpanIds = [];
		candidate.provenanceRefs = [{ type: "AssertedRecord", assertionId: "assert:preference" }];
		candidate.supportingEvidenceRefs = [
			{ type: "AssertedRecord", assertionId: "assert:preference" },
		];
		appendAssertedRecords(config, [
			{
				assertionId: "assert:preference",
				claimId: candidate.id,
				assertedBy: "user:alice",
				assertedAt: "2026-07-23T00:00:00.000Z",
				scope: candidate.scope,
				authorityBasis: "本人偏好",
				assertionText: candidate.statement,
			},
		]);
		const result = await lintCompileResult(config, [candidate], [], [], [], null);
		expect(result.canonicalClaims[0]).toMatchObject({
			claimKind: "PREFERENCE",
			validity: "SUPPORTED",
			publicationState: "CANONICAL",
			evidenceSpanIds: [],
		});
	});

	it("requires an explicit condition for EQUIVALENT_UNDER", () => {
		const from = claim("claim:a", "Alpha", "span:a");
		const to = claim("claim:b", "Beta", "span:b");
		const candidate = relation(from, to);
		candidate.type = "EQUIVALENT_UNDER";
		expect(
			checkRelationStructure(candidate, new Set([from.id, to.id]), new Set([from.id, to.id]), [
				span("span:a"),
				span("span:b"),
			]).some((issue) => issue.code === "RELATION_CONDITION_REQUIRED"),
		).toBe(true);
	});

	it("fails closed for EQUIVALENT_UNDER pending calibrated human review", () => {
		const from = claim("claim:a", "Alpha", "span:a");
		const to = claim("claim:b", "Beta", "span:b");
		const candidate = relation(from, to);
		candidate.type = "EQUIVALENT_UNDER";
		candidate.conditions = ["同一对象域"];
		expect(
			checkRelationStructure(candidate, new Set([from.id, to.id]), new Set([from.id, to.id]), [
				span("span:a"),
				span("span:b"),
			]).some((issue) => issue.code === "RELATION_EQUIVALENCE_REVIEW_REQUIRED"),
		).toBe(true);
	});

	it("promotes an edge only with a successful versioned Relation audit", async () => {
		const provider = new ClaimAndRelationPassProvider();
		const claims = [claim("claim:a", "Alpha", "span:a"), claim("claim:b", "Beta", "span:b")];
		const spans = [span("span:a", "Alpha."), span("span:b", "Beta.")];
		const result = await lintCompileResult(
			temporaryConfig(),
			claims,
			[relation(claims[0] as Claim, claims[1] as Claim)],
			[],
			spans,
			provider,
		);
		expect(result.canonicalRelations).toHaveLength(1);
		expect(result.canonicalRelations[0]).toMatchObject({
			validity: "SUPPORTED",
			conditionStatus: "EXPLICIT_NONE",
			relationAuditVersion: RELATION_AUDIT_VERSION,
		});
	});

	it("persists the auditor's total supersession effect independently from conditions", async () => {
		const provider = new ClaimAndRelationPassProvider();
		const claims = [
			claim("claim:new", "外部 API 必须使用 TLS 1.3", "span:new"),
			claim("claim:old", "外部 API 必须使用 TLS 1.2", "span:old"),
		];
		const candidate = relation(claims[0] as Claim, claims[1] as Claim);
		candidate.type = "SUPERSEDES";
		candidate.conditions = ["自 2026-07-10 起"];
		const result = await lintCompileResult(
			temporaryConfig(),
			claims,
			[candidate],
			[],
			[
				span("span:new", "外部 API 必须使用 TLS 1.3。"),
				span("span:old", "外部 API 必须使用 TLS 1.2。"),
			],
			provider,
		);
		expect(result.canonicalRelations[0]).toMatchObject({
			conditionStatus: "PRESERVED",
			supersessionEffect: "TOTAL_TO_CLAIM",
			relationAuditVersion: RELATION_AUDIT_VERSION,
		});
	});

	it("quarantines a passed Relation audit that selects evidence from only one endpoint", async () => {
		const provider = new ClaimPassRelationOneSidedProvider();
		const claims = [claim("claim:a", "Alpha", "span:a"), claim("claim:b", "Beta", "span:b")];
		const spans = [span("span:a", "Alpha."), span("span:b", "Beta.")];
		const result = await lintCompileResult(
			temporaryConfig(),
			claims,
			[relation(claims[0] as Claim, claims[1] as Claim)],
			[],
			spans,
			provider,
		);
		expect(result.canonicalRelations).toHaveLength(0);
		expect(result.quarantinedRelations[0]?.issues[0]?.detail).toContain("未同时覆盖 FROM 与 TO");
	});

	it("requires the adversarial type critic to pass before promoting a strong edge", async () => {
		const provider = new ClaimPassRelationCriticFailProvider();
		const claims = [
			claim("claim:a", "Proof D", "span:a"),
			claim("claim:b", "Conclusion C", "span:b"),
		];
		const candidate = relation(claims[0] as Claim, claims[1] as Claim);
		candidate.type = "DERIVED_FROM";
		const result = await lintCompileResult(
			temporaryConfig(),
			claims,
			[candidate],
			[],
			[span("span:a", "Proof D"), span("span:b", "Conclusion C")],
			provider,
		);
		expect(result.canonicalRelations).toHaveLength(0);
		expect(result.quarantinedRelations[0]?.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "RELATION_TYPE_MISMATCH",
					detail: expect.stringContaining("DIRECTION_REVERSED"),
				}),
			]),
		);
	});
});

class InvalidAuditProvider implements LLMProvider {
	calls = 0;

	async chat(_options: ChatOptions): Promise<ChatResult> {
		this.calls++;
		return {
			content: "{invalid",
			model: "test-model",
			finishReason: "stop",
			reasoningContentChars: 0,
			usage: null,
		};
	}

	async chatWithThinking(options: ChatOptions): Promise<ChatResult> {
		return this.chat(options);
	}
}

class BatchPassProvider implements LLMProvider {
	claimCalls = 0;
	relationCalls = 0;
	criticCalls = 0;

	async chat(options: ChatOptions): Promise<ChatResult> {
		const ids = batchObjectIds(options);
		if (options.systemPrompt.startsWith(SEMANTIC_AUDIT_SYSTEM)) {
			this.claimCalls++;
			return auditChatResult({
				items: ids.map((objectId) => ({
					objectId,
					verdict: {
						verdict: "passed",
						dimensions: passingDimensions(),
						anchorSpanIndex: 0,
						failedDimensions: [],
					},
				})),
			});
		}
		if (options.systemPrompt.startsWith(RELATION_AUDIT_SYSTEM)) {
			this.relationCalls++;
			return auditChatResult({
				items: ids.map((objectId) => ({
					objectId,
					verdict: {
						verdict: "passed",
						supersessionEffect: "NOT_APPLICABLE",
						dimensions: Object.fromEntries(
							["identity", "relation", "type", "direction", "conditions"].map((dimension) => [
								dimension,
								{ result: "pass", evidenceSpanIndexes: [0, 1] },
							]),
						),
						anchorSpanIndex: 0,
						failedDimensions: [],
						supportingEvidenceSpanIndexes: [0, 1],
					},
				})),
			});
		}
		if (options.systemPrompt === RELATION_TYPE_CRITIC_SYSTEM) {
			this.criticCalls++;
			return auditChatResult({
				verdict: "passed",
				failureModes: [],
				evidenceSpanIndexes: [0, 1],
			});
		}
		throw new Error("Unexpected batch audit prompt");
	}

	async chatWithThinking(options: ChatOptions): Promise<ChatResult> {
		return this.chat(options);
	}
}

class ShrinkingBatchProvider extends BatchPassProvider {
	batchSizes: number[] = [];

	override async chat(options: ChatOptions): Promise<ChatResult> {
		if (!options.systemPrompt.startsWith(SEMANTIC_AUDIT_SYSTEM)) return super.chat(options);
		const ids = batchObjectIds(options);
		this.claimCalls++;
		this.batchSizes.push(ids.length);
		const returnedIds = ids.length > 2 ? ids.slice(0, -1) : ids;
		return auditChatResult({
			items: returnedIds.map((objectId) => ({
				objectId,
				verdict: {
					verdict: "passed",
					dimensions: passingDimensions(),
					anchorSpanIndex: 0,
					failedDimensions: [],
				},
			})),
		});
	}
}

class ShrinkingUtilityBatchProvider extends BatchPassProvider {
	utilityBatchSizes: number[] = [];

	override async chat(options: ChatOptions): Promise<ChatResult> {
		if (options.systemPrompt !== RELATED_TO_UTILITY_CRITIC_BATCH_SYSTEM) {
			return super.chat(options);
		}
		const ids = batchObjectIds(options);
		this.utilityBatchSizes.push(ids.length);
		if (ids.length > 1) {
			return auditChatResult({
				items: [utilityBatchItem(ids[0] as string)],
			});
		}
		if (ids[0] === "rel:utility-0") {
			return auditChatResult({ items: [utilityBatchItem(ids[0])] });
		}
		return auditChatResult({ items: [] });
	}
}

function utilityBatchItem(objectId: string) {
	return {
		objectId,
		verdict: {
			verdict: "passed",
			failureModes: [],
			evidenceSpanIndexes: [0, 1],
		},
	};
}

function batchObjectIds(options: ChatOptions): string[] {
	const content = options.messages.map((message) => message.content).join("\n");
	return [...content.matchAll(/^## objectId=(.+)$/gm)].map((match) => match[1] as string);
}

class StaticAuditProvider implements LLMProvider {
	calls = 0;

	constructor(private readonly body: unknown) {}

	async chat(_options: ChatOptions): Promise<ChatResult> {
		this.calls++;
		return {
			content: JSON.stringify(this.body),
			model: "test-model",
			finishReason: "stop",
			reasoningContentChars: 0,
			usage: null,
		};
	}

	async chatWithThinking(options: ChatOptions): Promise<ChatResult> {
		return this.chat(options);
	}
}

class ClaimPassRelationFailProvider implements LLMProvider {
	async chat(options: ChatOptions): Promise<ChatResult> {
		if (options.systemPrompt === SEMANTIC_AUDIT_SYSTEM) {
			return auditChatResult({
				verdict: "passed",
				dimensions: passingDimensions(),
				anchorSpanIndex: 0,
				failedDimensions: [],
			});
		}
		if (options.systemPrompt === RELATION_AUDIT_SYSTEM) {
			const dimensions = Object.fromEntries(
				["identity", "relation", "type", "direction", "conditions"].map((dimension) => [
					dimension,
					{ result: dimension === "relation" ? "fail" : "pass", evidenceSpanIndexes: [0] },
				]),
			);
			return auditChatResult({
				verdict: "failed",
				dimensions,
				anchorSpanIndex: 0,
				failedDimensions: ["relation"],
				supportingEvidenceSpanIndexes: [],
			});
		}
		throw new Error("Unexpected audit prompt");
	}

	async chatWithThinking(options: ChatOptions): Promise<ChatResult> {
		return this.chat(options);
	}
}

class ClaimPassRelationIdentityFailProvider implements LLMProvider {
	relationAuditCalls = 0;

	async chat(options: ChatOptions): Promise<ChatResult> {
		if (options.systemPrompt === SEMANTIC_AUDIT_SYSTEM) {
			return auditChatResult({
				verdict: "passed",
				dimensions: passingDimensions(),
				anchorSpanIndex: 0,
				failedDimensions: [],
			});
		}
		if (options.systemPrompt === RELATION_AUDIT_SYSTEM) {
			this.relationAuditCalls++;
			return auditChatResult({
				verdict: "failed",
				dimensions: Object.fromEntries(
					["identity", "relation", "type", "direction", "conditions"].map((dimension) => [
						dimension,
						{ result: dimension === "identity" ? "fail" : "pass", evidenceSpanIndexes: [0, 1] },
					]),
				),
				anchorSpanIndex: 0,
				failedDimensions: ["identity"],
				supportingEvidenceSpanIndexes: [],
			});
		}
		throw new Error("Unexpected audit prompt");
	}

	async chatWithThinking(options: ChatOptions): Promise<ChatResult> {
		return this.chat(options);
	}
}

class ClaimPassRelationUtilityFailProvider implements LLMProvider {
	async chat(options: ChatOptions): Promise<ChatResult> {
		if (options.systemPrompt === SEMANTIC_AUDIT_SYSTEM) {
			return auditChatResult({
				verdict: "passed",
				dimensions: passingDimensions(),
				anchorSpanIndex: 0,
				failedDimensions: [],
			});
		}
		if (options.systemPrompt === RELATION_AUDIT_SYSTEM) {
			return auditChatResult({
				verdict: "passed",
				supersessionEffect: "NOT_APPLICABLE",
				dimensions: Object.fromEntries(
					["identity", "relation", "type", "direction", "conditions"].map((dimension) => [
						dimension,
						{ result: "pass", evidenceSpanIndexes: [0, 1] },
					]),
				),
				anchorSpanIndex: 0,
				failedDimensions: [],
				supportingEvidenceSpanIndexes: [0, 1],
			});
		}
		if (options.systemPrompt === RELATED_TO_UTILITY_CRITIC_SYSTEM) {
			return auditChatResult({
				verdict: "failed",
				failureModes: ["NO_NAVIGATION_GAIN"],
				evidenceSpanIndexes: [0, 1],
			});
		}
		throw new Error("Unexpected audit prompt");
	}

	async chatWithThinking(options: ChatOptions): Promise<ChatResult> {
		return this.chat(options);
	}
}

class ClaimPassRelationUtilityPassProvider extends ClaimPassRelationUtilityFailProvider {
	override async chat(options: ChatOptions): Promise<ChatResult> {
		if (options.systemPrompt === RELATED_TO_UTILITY_CRITIC_SYSTEM) {
			return auditChatResult({
				verdict: "passed",
				failureModes: [],
				evidenceSpanIndexes: [0, 1],
			});
		}
		return super.chat(options);
	}
}

class ClaimPassRelationMeasurementMismatchProvider extends ClaimPassRelationUtilityFailProvider {
	override async chat(options: ChatOptions): Promise<ChatResult> {
		if (options.systemPrompt === RELATED_TO_UTILITY_CRITIC_SYSTEM) {
			return auditChatResult({
				verdict: "failed",
				failureModes: ["MEASUREMENT_SLOT_MISMATCH"],
				evidenceSpanIndexes: [0, 1],
			});
		}
		return super.chat(options);
	}
}

class ClaimPassRelationInvalidProvider implements LLMProvider {
	relationAuditCalls = 0;

	async chat(options: ChatOptions): Promise<ChatResult> {
		if (options.systemPrompt === SEMANTIC_AUDIT_SYSTEM) {
			return auditChatResult({
				verdict: "passed",
				dimensions: passingDimensions(),
				anchorSpanIndex: 0,
				failedDimensions: [],
			});
		}
		if (options.systemPrompt === RELATION_AUDIT_SYSTEM) {
			this.relationAuditCalls++;
			return auditChatResult({
				verdict: "failed",
				dimensions: Object.fromEntries(
					["identity", "relation", "type", "direction", "conditions"].map((dimension) => [
						dimension,
						{ result: "pass", evidenceSpanIndexes: [0, 1] },
					]),
				),
				anchorSpanIndex: 0,
				failedDimensions: [],
				supportingEvidenceSpanIndexes: [0, 1],
			});
		}
		throw new Error("Unexpected audit prompt");
	}

	async chatWithThinking(options: ChatOptions): Promise<ChatResult> {
		return this.chat(options);
	}
}

class ClaimPassRelationPassWithoutSupportProvider implements LLMProvider {
	async chat(options: ChatOptions): Promise<ChatResult> {
		if (options.systemPrompt === SEMANTIC_AUDIT_SYSTEM) {
			return auditChatResult({
				verdict: "passed",
				dimensions: passingDimensions(),
				anchorSpanIndex: 0,
				failedDimensions: [],
			});
		}
		if (options.systemPrompt === RELATION_AUDIT_SYSTEM) {
			return auditChatResult({
				verdict: "passed",
				dimensions: Object.fromEntries(
					["identity", "relation", "type", "direction", "conditions"].map((dimension) => [
						dimension,
						{ result: "pass", evidenceSpanIndexes: [0] },
					]),
				),
				anchorSpanIndex: 0,
				failedDimensions: [],
				supportingEvidenceSpanIndexes: [],
			});
		}
		throw new Error("Unexpected audit prompt");
	}

	async chatWithThinking(options: ChatOptions): Promise<ChatResult> {
		return this.chat(options);
	}
}

class ClaimAndRelationPassProvider implements LLMProvider {
	async chat(options: ChatOptions): Promise<ChatResult> {
		if (options.systemPrompt === SEMANTIC_AUDIT_SYSTEM) {
			return auditChatResult({
				verdict: "passed",
				dimensions: passingDimensions(),
				anchorSpanIndex: 0,
				failedDimensions: [],
			});
		}
		if (options.systemPrompt === RELATION_AUDIT_SYSTEM) {
			return auditChatResult({
				verdict: "passed",
				supersessionEffect: options.messages[0]?.content.includes("\nSUPERSEDES\n")
					? "TOTAL_TO_CLAIM"
					: "NOT_APPLICABLE",
				dimensions: Object.fromEntries(
					["identity", "relation", "type", "direction", "conditions"].map((dimension) => [
						dimension,
						{ result: "pass", evidenceSpanIndexes: [0, 1] },
					]),
				),
				anchorSpanIndex: 0,
				failedDimensions: [],
				supportingEvidenceSpanIndexes: [0, 1],
			});
		}
		if (options.systemPrompt === RELATION_TYPE_CRITIC_SYSTEM) {
			return auditChatResult({
				verdict: "passed",
				failureModes: [],
				evidenceSpanIndexes: [0, 1],
			});
		}
		throw new Error("Unexpected audit prompt");
	}

	async chatWithThinking(options: ChatOptions): Promise<ChatResult> {
		return this.chat(options);
	}
}

class ClaimPassRelationOneSidedProvider implements LLMProvider {
	async chat(options: ChatOptions): Promise<ChatResult> {
		if (options.systemPrompt === SEMANTIC_AUDIT_SYSTEM) {
			return auditChatResult({
				verdict: "passed",
				dimensions: passingDimensions(),
				anchorSpanIndex: 0,
				failedDimensions: [],
			});
		}
		if (options.systemPrompt === RELATION_AUDIT_SYSTEM) {
			return auditChatResult({
				verdict: "passed",
				dimensions: Object.fromEntries(
					["identity", "relation", "type", "direction", "conditions"].map((dimension) => [
						dimension,
						{ result: "pass", evidenceSpanIndexes: [0] },
					]),
				),
				anchorSpanIndex: 0,
				failedDimensions: [],
				supportingEvidenceSpanIndexes: [0],
			});
		}
		if (options.systemPrompt === RELATION_TYPE_CRITIC_SYSTEM) {
			return auditChatResult({
				verdict: "passed",
				failureModes: [],
				evidenceSpanIndexes: [0, 1],
			});
		}
		throw new Error("Unexpected audit prompt");
	}

	async chatWithThinking(options: ChatOptions): Promise<ChatResult> {
		return this.chat(options);
	}
}

class ClaimPassRelationCriticFailProvider extends ClaimAndRelationPassProvider {
	override async chat(options: ChatOptions): Promise<ChatResult> {
		if (options.systemPrompt === RELATION_TYPE_CRITIC_SYSTEM) {
			return auditChatResult({
				verdict: "failed",
				failureModes: ["DIRECTION_REVERSED"],
				evidenceSpanIndexes: [0, 1],
			});
		}
		return super.chat(options);
	}
}

function auditChatResult(body: unknown): ChatResult {
	return {
		content: JSON.stringify(body),
		model: "test-model",
		finishReason: "stop",
		reasoningContentChars: 0,
		usage: null,
	};
}

function passingDimensions(overrides: Partial<Record<string, "pass" | "fail">> = {}) {
	return Object.fromEntries(
		["support", "addition", "inference", "limits", "citation"].map((dimension) => {
			const result = overrides[dimension] ?? "pass";
			return [
				dimension,
				{
					result,
					evidenceSpanIndexes:
						result === "fail" || dimension === "support" || dimension === "citation" ? [0] : [],
				},
			];
		}),
	);
}

function claim(id = "claim:test", statement = "Alpha", spanId = "span:test"): Claim {
	return {
		id,
		statement,
		evidenceSpanIds: [spanId],
		conditions: [],
		derivation: "EXTRACTED",
		validity: "UNRESOLVED",
		lifecycle: "ACTIVE",
		publicationState: "CANDIDATE",
		validFrom: null,
		validTo: null,
		compilerVersion: "test",
		confidence: 1,
		claimKind: "FACT",
		scope: { type: "GLOBAL" },
		provenanceRefs: [{ type: "SourceSpan", spanId }],
		supportingEvidenceRefs: [{ type: "SourceSpan", spanId }],
		knowledgeVersion: "v1",
		recordedAt: "2026-07-23T00:00:00.000Z",
	};
}

function span(id = "span:test", text = "Alpha.", sourceId = "source:test"): SourceSpan {
	return {
		id,
		sourceId,
		blockId: "b0",
		charStart: 0,
		charEnd: text.length,
		text,
	};
}

function relation(from: Claim, to: Claim): Relation {
	return {
		id: "rel:test",
		from: claimRef(from.id),
		to: claimRef(to.id),
		type: "SUPPORTS",
		conditions: [],
		conditionStatus: "UNVERIFIED",
		supersessionEffect: null,
		relationAuditVersion: null,
		evidenceSpanIds: [...from.evidenceSpanIds, ...to.evidenceSpanIds],
		derivation: "INFERRED",
		validity: "UNRESOLVED",
		lifecycle: "ACTIVE",
		publicationState: "CANDIDATE",
		validFrom: null,
		validTo: null,
		compilerVersion: "test",
		source: "intra-material-compile",
		confidence: 0.5,
		consumedBy: [],
	};
}

function temporaryConfig(): AppConfig {
	const projectRoot = mkdtempSync(join(tmpdir(), "wge-linter-"));
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
