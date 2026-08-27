import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AppConfig } from "../config/types.js";
import type { LLMProvider } from "../core/llm-provider.js";
import type { ChatOptions, ChatResult } from "../core/types.js";
import { SUPPORT_PREAUDIT_ROUTER_SYSTEM } from "../prompts/index.js";
import type { Claim, Relation } from "../types/index.js";
import { claimRef } from "../types/index.js";
import { routeSupportCandidates } from "./support-router.js";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("SUPPORTS pre-audit router", () => {
	it("routes plausible support and defers non-evidential co-occurrence", async () => {
		const provider = new StaticRouterProvider();
		const inputs = [
			input("good", "Trial measured an 8 mmHg reduction.", "Treatment lowers pressure."),
			input("weak", "Atlas is a software platform.", "Atlas documents three languages."),
		];
		const result = await routeSupportCandidates(config(), inputs, provider, {
			sourceId: "source:test",
			runId: "run:router",
			model: "test-model",
		});

		expect(result.fullAudit.map((relation) => relation.id)).toEqual(["rel:good"]);
		expect(result.deferred.map((relation) => relation.id)).toEqual(["rel:weak"]);
		expect(result.deferred[0]?.publicationState).toBe("CANDIDATE");
		expect(result.decisions.every((decision) => decision.decisionSource === "MODEL")).toBe(true);
	});

	it("splits an invalid envelope and fails an invalid singleton open to full audit", async () => {
		const provider = new ShrinkingRouterProvider();
		const inputs = [
			input("defer", "A product definition.", "A product capability."),
			input("broken", "A broad heading.", "A detailed rule."),
		];
		const result = await routeSupportCandidates(config(), inputs, provider, {
			sourceId: "source:test",
			runId: "run:router-shrink",
			model: "test-model",
		});

		expect(provider.batchSizes).toEqual([2, 1, 1, 1]);
		expect(result.deferred.map((relation) => relation.id)).toEqual(["rel:defer"]);
		expect(result.fullAudit.map((relation) => relation.id)).toEqual(["rel:broken"]);
		expect(
			result.decisions.find((decision) => decision.relation.id === "rel:broken"),
		).toMatchObject({
			decision: "FULL_AUDIT",
			decisionSource: "FAIL_OPEN",
		});
	});

	it("rejects non-SUPPORTS inputs as a programming error", async () => {
		const candidate = input("related", "A", "B");
		candidate.relation.type = "RELATED_TO";
		await expect(
			routeSupportCandidates(config(), [candidate], new StaticRouterProvider(), {
				sourceId: "source:test",
				runId: "run:wrong-type",
				model: "test-model",
			}),
		).rejects.toThrow("cannot route RELATED_TO");
	});
});

class StaticRouterProvider implements LLMProvider {
	async chat(options: ChatOptions): Promise<ChatResult> {
		if (options.systemPrompt !== SUPPORT_PREAUDIT_ROUTER_SYSTEM) {
			throw new Error("Unexpected prompt");
		}
		const ids = objectIds(options);
		return result({
			items: ids.map((objectId) => ({
				objectId,
				verdict:
					objectId === "rel:good"
						? { decision: "FULL_AUDIT", failureModes: [] }
						: { decision: "DEFER_BY_TYPE_ROUTER", failureModes: ["NO_EXPLICIT_SUPPORT"] },
			})),
		});
	}

	async chatWithThinking(options: ChatOptions): Promise<ChatResult> {
		return this.chat(options);
	}
}

class ShrinkingRouterProvider extends StaticRouterProvider {
	batchSizes: number[] = [];

	override async chat(options: ChatOptions): Promise<ChatResult> {
		const ids = objectIds(options);
		this.batchSizes.push(ids.length);
		if (ids.length > 1 || ids[0] === "rel:broken") return result({ items: [] });
		return result({
			items: [
				{
					objectId: ids[0],
					verdict: {
						decision: "DEFER_BY_TYPE_ROUTER",
						failureModes: ["DEFINITION_TO_DETAIL"],
					},
				},
			],
		});
	}
}

function input(id: string, fromStatement: string, toStatement: string) {
	const from = claim(`claim:${id}:from`, fromStatement);
	const to = claim(`claim:${id}:to`, toStatement);
	return { relation: relation(id, from, to), fromClaim: from, toClaim: to };
}

function claim(id: string, statement: string): Claim {
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
		recordedAt: "2026-08-11T00:00:00.000Z",
	};
}

function relation(id: string, from: Claim, to: Claim): Relation {
	return {
		id: `rel:${id}`,
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
		source: "cross-material-detect",
		confidence: 0.8,
		consumedBy: [],
	};
}

function objectIds(options: ChatOptions): string[] {
	const content = options.messages[0]?.content ?? "";
	return [...content.matchAll(/^## objectId=(.+)$/gmu)].map((match) => match[1] as string);
}

function result(body: unknown): ChatResult {
	return {
		content: JSON.stringify(body),
		model: "test-model",
		finishReason: "stop",
		reasoningContentChars: 0,
		usage: null,
	};
}

function config(): AppConfig {
	const projectRoot = mkdtempSync(join(tmpdir(), "wge-support-router-"));
	roots.push(projectRoot);
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
