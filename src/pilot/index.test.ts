import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AppConfig } from "../config/types.js";
import { RELATION_AUDIT_VERSION } from "../prompts/index.js";
import type { Claim, ContextPack, Relation, SourceSpan } from "../types/index.js";
import { claimRef } from "../types/index.js";
import { preparePilotContext, serializeKnowledgeContext } from "./index.js";
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
			schemaVersion: "wge-context-trace/v1",
			strategy: "folder-lexical",
			corpusChunkCount: 2,
		});
		expect(first.questionHash).toBe(second.questionHash);
		expect(first.configHash).toBe(second.configHash);
		expect(first.inputSnapshotHash).toMatch(/^corpus:[a-f0-9]{64}$/);
		expect(first.inputSnapshotHash).toBe(second.inputSnapshotHash);
		expect(first.traceHash).toBe(second.traceHash);
	});

	it("serializes Claim and all of its Evidence as one budget decision", () => {
		const pack = knowledgePack();
		const result = serializeKnowledgeContext(pack, 95, false);
		expect(result.estimatedTokens).toBeLessThanOrEqual(95);
		expect(result.closure.complete).toBe(true);
		for (const claimId of result.selectedClaimIds) {
			const claim = pack.subgraph.claims.find((item) => item.id === claimId);
			expect(claim).toBeDefined();
			for (const spanId of claim?.evidenceSpanIds ?? []) {
				expect(result.selectedEvidenceSpanIds).toContain(spanId);
				expect(result.text).toContain(`## EVIDENCE ${spanId}`);
			}
		}
	});

	it("drops a Relation when either endpoint Claim bundle is not visible", () => {
		const result = serializeKnowledgeContext(knowledgePack(), 95, false);
		const relationDecision = result.decisions.find((item) => item.id === "rel:alpha-beta");
		expect(relationDecision).toMatchObject({
			selected: false,
			kind: "relation",
		});
		expect(relationDecision?.reason).toContain("endpoint-not-visible");
		expect(result.selectedRelationIds).toEqual([]);
	});

	it("refuses a Claim whose referenced Evidence is absent from the pack", () => {
		const pack = knowledgePack();
		pack.evidenceSpans = pack.evidenceSpans.filter((span) => span.id !== "span:alpha");
		const result = serializeKnowledgeContext(pack, 1000, false);
		expect(result.selectedClaimIds).not.toContain("claim:alpha");
		expect(result.decisions).toContainEqual(
			expect.objectContaining({
				id: "claim:alpha",
				selected: false,
				reason: "missing-evidence:span:alpha",
			}),
		);
	});

	it("records conditional Graph activation separately from candidate traversal", () => {
		const root = mkdtempSync(join(tmpdir(), "wge-pilot-activation-"));
		mkdirSync(join(root, "corpus"));
		writeFileSync(join(root, "corpus", "alpha.md"), "# Alpha\n\nAlpha evidence.");
		const prepared = preparePilotContext(
			appConfig(root),
			pilotConfig(),
			{ id: "q-activation", question: "Alpha 是什么？" },
			"P",
			{ graphExpansion: true },
		);
		expect(prepared.retrievalTrace).toMatchObject({
			strategy: "claim-seed-graph-conditional",
			candidateFlow: {
				graphActivation: expect.objectContaining({
					mode: expect.stringMatching(/CANDIDATE_ONLY|VISIBLE/),
					visibleRelationIds: expect.any(Array),
				}),
			},
		});
	});
});

function knowledgePack(): ContextPack {
	const alpha = testClaim("claim:alpha", "Alpha conclusion", "span:alpha");
	const beta = testClaim("claim:beta", "Beta ".repeat(220), "span:beta");
	const relation: Relation = {
		id: "rel:alpha-beta",
		from: claimRef(alpha.id),
		to: claimRef(beta.id),
		type: "SUPPORTS",
		conditions: [],
		conditionStatus: "EXPLICIT_NONE",
		supersessionEffect: null,
		relationAuditVersion: RELATION_AUDIT_VERSION,
		evidenceSpanIds: ["span:alpha", "span:beta"],
		derivation: "INFERRED",
		validity: "SUPPORTED",
		lifecycle: "ACTIVE",
		publicationState: "CANONICAL",
		validFrom: null,
		validTo: null,
		compilerVersion: "test",
		source: "cross-material-detect",
		confidence: 1,
		consumedBy: [],
	};
	const spans: SourceSpan[] = [
		{
			id: "span:alpha",
			sourceId: "source:test",
			blockId: "b1",
			charStart: 0,
			charEnd: 14,
			text: "Alpha evidence",
		},
		{
			id: "span:beta",
			sourceId: "source:test",
			blockId: "b2",
			charStart: 15,
			charEnd: 28,
			text: "Beta evidence",
		},
	];
	return {
		knowledgeVersion: "knowledge:test",
		taskMap: "主题: Alpha",
		subgraph: { claims: [alpha, beta], relations: [relation] },
		wikiModules: [],
		evidenceSpans: spans,
		conflictsAndConditions: [],
		selectionLog: [],
		knownGaps: [],
	};
}

function testClaim(id: string, statement: string, spanId: string): Claim {
	return {
		id,
		statement,
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
		knowledgeVersion: "test",
		recordedAt: "2026-07-29T00:00:00.000Z",
	};
}

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
