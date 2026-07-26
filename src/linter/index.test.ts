import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AppConfig } from "../config/types.js";
import type { LLMProvider } from "../core/llm-provider.js";
import type { ChatOptions, ChatResult } from "../core/types.js";
import {
	RELATION_AUDIT_SYSTEM,
	RELATION_AUDIT_VERSION,
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
		expect(result.quarantinedRelations[0]?.issues[0]?.code).toBe("RELATION_IDENTITY_MISMATCH");
		expect(provider.relationAuditCalls).toBe(0);
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
		throw new Error("Unexpected audit prompt");
	}

	async chatWithThinking(options: ChatOptions): Promise<ChatResult> {
		return this.chat(options);
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
