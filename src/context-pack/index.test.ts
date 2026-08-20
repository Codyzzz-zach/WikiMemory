import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { estimateTokens } from "../compiler/telemetry.js";
import type { AppConfig } from "../config/types.js";
import { currentCanonicalEvidenceVersion } from "../evolution/version-store.js";
import { getRelationTypeSemantics } from "../graph/index.js";
import {
	publishSourceResult,
	readAllClaims,
	readAllSpans,
	upsertWikiModules,
	writeJsonl,
} from "../linter/storage.js";
import { RELATION_AUDIT_VERSION } from "../prompts/index.js";
import { buildPersistentSeedIndex } from "../retrieval/persistent-index.js";
import type { Claim, QuestionFrame, Relation, SourceSpan } from "../types/index.js";
import { claimRef, questionRef } from "../types/index.js";
import { materializeQuestionWikiModule, materializeWikiModule } from "../wiki/materialization.js";
import { publishQuestionEvolution } from "../wiki/question-storage.js";
import type { WikiRetrievalCandidate } from "../wiki/retrieval.js";
import {
	buildContextPack,
	buildContextPackWithDiagnostics,
	buildManagedContextPackWithDiagnostics,
	injectWikiSupportingClaims,
} from "./index.js";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Context Pack contract", () => {
	it("returns Claim nodes, stable knowledge version, and Global-only data without scope context", () => {
		const config = fixture();
		const first = buildContextPack(config, "Alpha", 4000, 2);
		const second = buildContextPack(config, "Alpha", 4000, 2);
		expect(first.knowledgeVersion).toBe(second.knowledgeVersion);
		expect(first.subgraph.claims.map((claim) => claim.id)).toContain("claim:global");
		expect(first.subgraph.claims.map((claim) => claim.id)).not.toContain("claim:personal");
		expect(first.subgraph.relations).toHaveLength(0);
	});

	it("surfaces Relation conditions when the scoped endpoint is allowed", () => {
		const pack = buildContextPack(fixture(), "为什么 personal Alpha 支持 global Alpha？", 4000, 2, {
			principalId: "user:alice",
		});
		expect(pack.subgraph.claims.map((claim) => claim.id)).toEqual(
			expect.arrayContaining(["claim:global", "claim:personal"]),
		);
		expect(pack.subgraph.relations).toHaveLength(1);
		expect(pack.conflictsAndConditions.join("\n")).toContain("仅在测试环境");
		expect(pack.conflictsAndConditions.join("\n")).toContain(
			"SUPPORTS 只表示 Claim 之间存在语义支持",
		);
		expect(pack.conflictsAndConditions.join("\n")).toContain("sourceRole=primary");
	});

	it("traces the production Relation gate decision without changing traversal", () => {
		const built = buildContextPackWithDiagnostics(fixture(), "Alpha", 4000, 2, {
			principalId: "user:alice",
		});
		expect(built.diagnostics.graph.relationGates).toContainEqual(
			expect.objectContaining({
				relationId: "rel:scoped",
				accepted: true,
				reason: "accepted",
			}),
		);
		expect(built.diagnostics.graph.expandedRelationIds).toContain("rel:scoped");
		expect(built.diagnostics.graph.traversal).toContainEqual(
			expect.objectContaining({
				relationId: "rel:scoped",
				type: "SUPPORTS",
				navigationDirection: expect.stringMatching(/forward|reverse/),
				triggerReason: "reachable-from-seed-bfs",
				structureScore: null,
				structureScoreReason: "not-computed-in-r0-bfs",
			}),
		);
	});

	it("keeps RELATED_TO in candidate navigation without making it visible", () => {
		const config = fixture("RELATED_TO");
		const seedOnly = buildContextPack(config, "Alpha", 4000, 0, { principalId: "user:alice" });
		const built = buildContextPackWithDiagnostics(config, "Alpha", 4000, 2, {
			principalId: "user:alice",
		});
		expect(built.pack).toEqual(seedOnly);
		expect(built.pack.subgraph.relations).toEqual([]);
		expect(built.diagnostics.graph.expandedRelationIds).toContain("rel:scoped");
		expect(built.diagnostics.graph.activation.decisions).toContainEqual(
			expect.objectContaining({
				relationId: "rel:scoped",
				visible: false,
				dropReason: "weak-navigation-only",
			}),
		);
		expect(getRelationTypeSemantics("RELATED_TO").canSupportConclusion).toBe(false);
	});

	it("keeps visible Graph units inside the fixed context and marginal budgets", () => {
		const budget = 4000;
		const built = buildContextPackWithDiagnostics(fixture("REQUIRES"), "Alpha", budget, 2, {
			principalId: "user:alice",
		});
		expect(built.diagnostics.graph.activation.mode).toBe("VISIBLE");
		expect(built.diagnostics.graph.activation.selectedMarginalTokens).toBeLessThanOrEqual(
			built.diagnostics.graph.activation.marginalBudgetTokens,
		);
		expect(estimateTokens(JSON.stringify(built.pack))).toBeLessThanOrEqual(budget);
	});

	it("supports a Seed-only ablation at graph depth zero", () => {
		const config = fixture();
		const task = "为什么 personal Alpha 支持 global Alpha？";
		const seedOnly = buildContextPack(config, task, 4000, 0, { principalId: "user:alice" });
		const seedGraph = buildContextPack(config, task, 4000, 2, {
			principalId: "user:alice",
		});
		expect(seedOnly.subgraph.claims.length).toBeGreaterThan(0);
		expect(seedOnly.subgraph.relations).toHaveLength(0);
		expect(seedGraph.subgraph.relations).toHaveLength(1);
	});

	it("completes a bounded Claim neighborhood extracted from the same evidence block", () => {
		const pack = buildContextPack(fixture(), "Alpha global", 4000, 0);
		expect(pack.subgraph.claims.map((item) => item.id)).toContain("claim:sibling");
		expect(pack.selectionLog).toContainEqual(
			expect.objectContaining({
				selected: "claim:sibling",
				reason: expect.stringContaining("co-evidence:claim:global"),
			}),
		);
	});

	it("keeps opt-in indexed R0 Pack identical to legacy for scoped graph and evidence closure", () => {
		const config = fixture();
		buildPersistentSeedIndex(config);
		const task = "为什么 personal Alpha 支持 global Alpha？";
		const scope = { principalId: "user:alice" };
		const legacy = buildContextPackWithDiagnostics(config, task, 4000, 2, scope, {
			selectionMode: "R0",
		});
		const indexed = buildContextPackWithDiagnostics(config, task, 4000, 2, scope, {
			selectionMode: "R0",
			knowledgeAccess: "INDEXED",
		});
		expect(indexed.pack).toEqual(legacy.pack);
		expect(indexed.diagnostics.knowledgeAccess).toMatchObject({
			mode: "INDEXED",
			indexVersion: expect.any(String),
			canonicalStateGeneration: expect.any(String),
		});
	});

	it("builds then reuses the managed persistent index without changing the Pack", () => {
		const config = fixture();
		const legacy = buildContextPack(config, "Alpha global", 4000, 0);
		const first = buildManagedContextPackWithDiagnostics(config, "Alpha global", 4000, 0);
		const second = buildManagedContextPackWithDiagnostics(config, "Alpha global", 4000, 0);
		expect(first.pack).toEqual(legacy);
		expect(second.pack).toEqual(legacy);
		expect(first.diagnostics.knowledgeAccess).toMatchObject({
			mode: "INDEXED",
			lifecycle: "BUILT",
			fallbackReason: null,
		});
		expect(second.diagnostics.knowledgeAccess).toMatchObject({
			mode: "INDEXED",
			lifecycle: "REUSED",
			fallbackReason: null,
		});
	});

	it("falls back explicitly to live Canonical reads when index rebuild cannot be written", () => {
		const config = fixture();
		const blockedIndexRoot = join(config.projectRoot, "blocked-index");
		writeFileSync(blockedIndexRoot, "not-a-directory", "utf8");
		const legacy = buildContextPack(config, "Alpha global", 4000, 0);
		const managed = buildManagedContextPackWithDiagnostics(
			config,
			"Alpha global",
			4000,
			0,
			undefined,
			{
				indexRoot: blockedIndexRoot,
			},
		);
		expect(managed.pack).toEqual(legacy);
		expect(managed.diagnostics.knowledgeAccess).toMatchObject({
			mode: "LEGACY",
			lifecycle: "LEGACY_FALLBACK",
			fallbackReason: expect.any(String),
		});
		expect(() =>
			buildManagedContextPackWithDiagnostics(config, "Alpha global", 4000, 0, undefined, {
				indexRoot: blockedIndexRoot,
				indexFailurePolicy: "FAIL_CLOSED",
			}),
		).toThrow();
	});

	it("enforces the serialized token budget while preserving graph/evidence closure", () => {
		const budget = 350;
		const pack = buildContextPack(fixture(), "Alpha", budget, 2, {
			principalId: "user:alice",
		});
		expect(estimateTokens(JSON.stringify(pack))).toBeLessThanOrEqual(budget);
		const claimIds = new Set(pack.subgraph.claims.map((claim) => claim.id));
		const evidenceIds = new Set(pack.evidenceSpans.map((span) => span.id));
		for (const claim of pack.subgraph.claims) {
			expect(claim.evidenceSpanIds.every((spanId) => evidenceIds.has(spanId))).toBe(true);
		}
		for (const relation of pack.subgraph.relations) {
			expect(claimIds.has(relation.from as string)).toBe(true);
			expect(claimIds.has(relation.to as string)).toBe(true);
		}
		for (const entry of pack.conflictsAndConditions) {
			const claimId = /^(?:⚠️|📌) Claim (\S+)/u.exec(entry)?.[1];
			if (claimId) expect(claimIds.has(claimId)).toBe(true);
		}
	});

	it("keeps an uncovered named topic empty instead of expanding from generic words", () => {
		const pack = buildContextPack(fixture(), "WebAssembly 与传统部署方式有什么不同？", 4000, 2);
		expect(pack.subgraph.claims).toEqual([]);
		expect(pack.knownGaps.join("\n")).toContain("Seed Retriever 未找到可靠匹配");
		expect(pack.selectionLog[0]?.reason).toContain("matchedClaims=0");
		expect(pack.taskMap).toContain("地图主题: 无");
		expect(pack.taskMap).toContain("关键概念: 无");
	});

	it("fails closed for legacy Wiki prose and admits a fully supported materialized view", () => {
		const config = fixture();
		upsertWikiModules(config, [
			{
				id: "wiki:alpha",
				stableAddress: "alpha/current",
				coreQuestion: "Alpha 的当前结论是什么？",
				currentUnderstanding: "未经逐句支撑的旧摘要",
				disputes: [],
				claimRefs: [claimRef("claim:global"), claimRef("claim:sibling")],
				conceptRefs: [],
				dependencies: [],
				publicationState: "CANONICAL",
				updatedAt: "2026-08-12T00:00:00.000Z",
			},
		]);
		const legacy = buildContextPackWithDiagnostics(config, "Alpha global", 4000, 0);
		expect(legacy.pack.wikiModules).toEqual([]);
		expect(legacy.diagnostics.wiki.supportGates).toContainEqual(
			expect.objectContaining({
				moduleId: "wiki:alpha",
				accepted: false,
				reasons: ["missing-materialization-contract"],
			}),
		);

		const materialized = materializeWikiModule(
			{
				id: "wiki:alpha",
				stableAddress: "alpha/current",
				coreQuestion: "Alpha 的当前结论是什么？",
				claimRefs: ["claim:global", "claim:sibling"],
			},
			readAllClaims(config),
			readAllSpans(config),
			{
				// An unrelated later material may advance the global knowledge version without
				// invalidating this module's locally audited Claim/Span support closure.
				sourceKnowledgeVersion: "kv:previous-unrelated-state",
				rebuiltFromSnapshotId: null,
				updatedAt: "2026-08-12T00:00:00.000Z",
			},
		);
		upsertWikiModules(config, [materialized]);
		const current = buildContextPackWithDiagnostics(config, "Alpha global", 4000, 0);
		expect(current.pack.wikiModules.map((module) => module.id)).toEqual(["wiki:alpha"]);
		expect(current.diagnostics.wiki.supportGates).toContainEqual(
			expect.objectContaining({ moduleId: "wiki:alpha", accepted: true, reasons: [] }),
		);
		const disabled = buildContextPackWithDiagnostics(config, "Alpha global", 4000, 0, undefined, {
			wikiMode: "DISABLED",
		});
		expect(disabled.pack.wikiModules).toEqual([]);
		expect(disabled.diagnostics.wiki.retrieval).toEqual([]);
	});

	it("records when a retrieved Wiki is removed by the final closed-budget pass", () => {
		const config = fixture();
		const materialized = materializeWikiModule(
			{
				id: "wiki:alpha",
				stableAddress: "alpha/current",
				coreQuestion: "Alpha 的当前结论是什么？",
				claimRefs: ["claim:global", "claim:sibling"],
			},
			readAllClaims(config),
			readAllSpans(config),
			{
				sourceKnowledgeVersion: "kv:test",
				rebuiltFromSnapshotId: null,
				updatedAt: "2026-08-12T00:00:00.000Z",
			},
		);
		upsertWikiModules(config, [materialized]);
		const result = buildContextPackWithDiagnostics(config, "Alpha global", 200, 0);

		expect(result.pack.wikiModules).toEqual([]);
		expect(result.diagnostics.budget.dropped).toContainEqual(
			expect.objectContaining({
				id: "wiki:alpha",
				reason: "pack-final-budget-or-evidence-closure",
			}),
		);
	});

	it("consumes a Question-centered WikiModule only with its current QuestionFrame", () => {
		const config = fixture();
		const claims = readAllClaims(config).filter((item) =>
			["claim:global", "claim:sibling"].includes(item.id),
		);
		const evidenceVersion = currentCanonicalEvidenceVersion(config);
		const frame = questionFrameForContext(evidenceVersion);
		publishQuestionEvolution(config, {
			frames: [frame],
			decisions: [
				{
					id: "question-decision:alpha",
					knowledgeVersion: evidenceVersion,
					sourceId: "source:test",
					action: "CREATE",
					questionRefs: [frame.id],
					affectedClaimRefs: claims.map((claim) => claimRef(claim.id)),
					affectedRelationIds: [],
					reasonCodes: ["CREATE"],
					beforeHash: null,
					afterHash: "alpha",
					formationVersion: "wge-question-formation/v1",
					createdAt: "2026-08-20T00:00:00.000Z",
				},
			],
		});
		upsertWikiModules(config, [
			materializeQuestionWikiModule(frame, claims, [], readAllSpans(config), {
				sourceKnowledgeVersion: evidenceVersion,
				rebuiltFromSnapshotId: null,
				updatedAt: "2026-08-20T00:00:00.000Z",
				questionEvolutionDecisionId: "question-decision:alpha",
			}),
		]);

		const result = buildContextPackWithDiagnostics(config, "Alpha 当前结论", 4000, 0);
		expect(result.pack.wikiModules[0]).toMatchObject({
			questionRef: frame.id,
			coreQuestion: frame.canonicalQuestion,
		});
		expect(result.pack.taskMap).toContain("1 个长期问题 WikiModule");
		expect(result.diagnostics.wiki.supportGates).toContainEqual(
			expect.objectContaining({ accepted: true, reasons: [] }),
		);
	});

	it("loads the complete Wiki evidence closure beyond an indexed task neighborhood", () => {
		const config = fixture();
		const detachedSpan: SourceSpan = {
			id: "span:detached",
			sourceId: "source:detached",
			blockId: "detached-block",
			charStart: 0,
			charEnd: 33,
			text: "Detached supporting detail for the Wiki.",
		};
		writeJsonl(join(config.sourcesDir, "detached.spans.jsonl"), [detachedSpan]);
		writeFileSync(
			join(config.sourcesDir, "detached.json"),
			JSON.stringify({
				id: "source:detached",
				hash: "detached",
				uri: "https://example.test/detached",
				parsedText: detachedSpan.text,
				sourceType: "html",
				loaderVersion: "test",
				metadata: { sourceRole: "primary" },
				createdAt: "2026-08-20T00:00:00.000Z",
			}),
			"utf-8",
		);
		publishSourceResult(
			config,
			{
				schemaVersion: "v1",
				sourceId: "source:detached",
				runId: "run:detached",
				publishedAt: "2026-08-20T00:00:00.000Z",
				claims: [
					claim("claim:detached", "Detached supporting detail", detachedSpan.id, {
						type: "GLOBAL",
					}),
				],
				concepts: [],
				relations: [],
			},
			{
				schemaVersion: "v1",
				sourceId: "source:detached",
				runId: "run:detached",
				publishedAt: "2026-08-20T00:00:00.000Z",
				claims: [],
				relations: [],
			},
		);
		upsertWikiModules(config, [
			materializeWikiModule(
				{
					id: "wiki:indexed-closure",
					stableAddress: "wiki/test/indexed-closure",
					coreQuestion: "Alpha 的完整支撑闭包是什么？",
					claimRefs: ["claim:global", "claim:detached"],
				},
				readAllClaims(config),
				readAllSpans(config),
				{
					sourceKnowledgeVersion: currentCanonicalEvidenceVersion(config),
					rebuiltFromSnapshotId: null,
					updatedAt: "2026-08-20T00:00:00.000Z",
				},
			),
		]);

		const result = buildManagedContextPackWithDiagnostics(config, "Alpha global", 4000, 0);
		expect(result.pack.wikiModules.map((module) => module.id)).toContain("wiki:indexed-closure");
		expect(result.pack.evidenceSpans.map((span) => span.id)).toContain(detachedSpan.id);
	});

	it("does not let a lower-ranked Wiki evict the closure of an accepted module", () => {
		const claims = Array.from({ length: 16 }, (_, index) =>
			claim(`claim:${index}`, `Alpha fact ${index}`, "span:global", { type: "GLOBAL" }),
		);
		const base = claims.slice(0, 10).map((item, index) => ({
			claim: item,
			score: 100 - index,
			source: "lexical:test",
		}));
		const higher = wikiCandidate("wiki:higher", [0, 3, 4, 10, 11, 12, 13], claims, 20);
		const lower = wikiCandidate("wiki:lower", [3, 4, 14, 15], claims, 10);
		const result = injectWikiSupportingClaims(base, [higher, lower], claims, 10, 3);

		expect(result.results.map((entry) => entry.claim.id)).toEqual(
			expect.arrayContaining(higher.module.claimRefs.map(String)),
		);
		expect(result.rejections).toContainEqual({
			moduleId: "wiki:lower",
			reason: "insufficient-primary-slots:required=2,available=1",
		});
	});

	it("keeps R0 unchanged when no audited graph candidate exists", () => {
		const config = fixture();
		const task = "Alpha global";
		const r0 = buildContextPackWithDiagnostics(config, task, 4000, 2, undefined, {
			selectionMode: "R0",
		});
		const r1 = buildContextPackWithDiagnostics(config, task, 4000, 2, undefined, {
			selectionMode: "R1",
		});
		expect(r1.pack).toEqual(r0.pack);
		expect(r1.diagnostics.graph.selection).toMatchObject({
			mode: "R1",
			addedGraphClaimIds: [],
			removedLexicalSeedIds: [],
		});
	});

	it("lets R1 replace a weak lexical slot with a two-anchor graph candidate", () => {
		const config = r1Fixture();
		const r0 = buildContextPackWithDiagnostics(config, "Alpha framework", 4000, 2, undefined, {
			selectionMode: "R0",
		});
		const r1 = buildContextPackWithDiagnostics(config, "Alpha framework", 4000, 2, undefined, {
			selectionMode: "R1",
		});
		const r0Primary = r0.diagnostics.graph.selection.primarySelectedClaimIds;
		const r1Primary = r1.diagnostics.graph.selection.primarySelectedClaimIds;
		expect(r1Primary).toHaveLength(r0Primary.length);
		expect(r1.diagnostics.graph.selection.addedGraphClaimIds).toEqual(["claim:bridge"]);
		expect(r1.diagnostics.graph.selection.removedLexicalSeedIds).toHaveLength(1);
		expect(r1Primary).toContain("claim:bridge");
		expect(estimateTokens(JSON.stringify(r1.pack))).toBeLessThanOrEqual(4000);
		const claimIds = new Set(r1.pack.subgraph.claims.map((claim) => claim.id));
		const evidenceIds = new Set(r1.pack.evidenceSpans.map((span) => span.id));
		for (const claim of r1.pack.subgraph.claims) {
			expect(claim.evidenceSpanIds.every((spanId) => evidenceIds.has(spanId))).toBe(true);
		}
		for (const relation of r1.pack.subgraph.relations) {
			expect(claimIds.has(relation.from as string)).toBe(true);
			expect(claimIds.has(relation.to as string)).toBe(true);
		}
	});
});

function r1Fixture(): AppConfig {
	const projectRoot = mkdtempSync(join(tmpdir(), "wge-context-r1-"));
	roots.push(projectRoot);
	const config: AppConfig = {
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
	const ids = ["a", "b", "c", "d", "bridge"];
	const spans: SourceSpan[] = ids.map((id, index) => ({
		id: `span:${id}`,
		sourceId: "source:r1",
		blockId: `b${index}`,
		charStart: index * 20,
		charEnd: index * 20 + 15,
		text: id === "bridge" ? "Structural bridge evidence" : `Alpha evidence ${id}`,
	}));
	writeJsonl(join(config.sourcesDir, "r1.spans.jsonl"), spans);
	writeFileSync(
		join(config.sourcesDir, "r1.json"),
		JSON.stringify({
			id: "source:r1",
			hash: "r1",
			uri: "https://example.test/r1",
			parsedText: spans.map((span) => span.text).join("\n"),
			sourceType: "html",
			loaderVersion: "test",
			metadata: { sourceRole: "primary" },
			createdAt: "2026-07-29T00:00:00.000Z",
		}),
		"utf-8",
	);
	const claims = ids.map((id) =>
		claim(
			`claim:${id}`,
			id === "bridge"
				? "Structural bridge conclusion"
				: id === "d"
					? "Alpha d conclusion applies to this framework"
					: `Alpha framework ${id} conclusion`,
			`span:${id}`,
			{ type: "GLOBAL" },
		),
	);
	const relation = (id: string, from: string, to: string): Relation => ({
		id,
		from: claimRef(from),
		to: claimRef(to),
		type: "SUPPORTS",
		conditions: [],
		conditionStatus: "EXPLICIT_NONE",
		supersessionEffect: null,
		relationAuditVersion: RELATION_AUDIT_VERSION,
		evidenceSpanIds: [`span:${from.slice("claim:".length)}`, `span:${to.slice("claim:".length)}`],
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
	});
	publishSourceResult(
		config,
		{
			schemaVersion: "v1",
			sourceId: "source:r1",
			runId: "run:r1",
			publishedAt: "2026-07-29T00:00:00.000Z",
			claims,
			concepts: [],
			relations: [
				relation("rel:a-bridge", "claim:a", "claim:bridge"),
				relation("rel:b-bridge", "claim:b", "claim:bridge"),
			],
		},
		{
			schemaVersion: "v1",
			sourceId: "source:r1",
			runId: "run:r1",
			publishedAt: "2026-07-29T00:00:00.000Z",
			claims: [],
			relations: [],
		},
	);
	return config;
}

function fixture(relationType: Relation["type"] = "SUPPORTS"): AppConfig {
	const projectRoot = mkdtempSync(join(tmpdir(), "wge-context-"));
	roots.push(projectRoot);
	const config: AppConfig = {
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
	const spans: SourceSpan[] = [
		{
			id: "span:global",
			sourceId: "source:test",
			blockId: "b0",
			charStart: 0,
			charEnd: 13,
			text: "Alpha global.",
		},
		{
			id: "span:sibling",
			sourceId: "source:test",
			blockId: "b0",
			charStart: 30,
			charEnd: 48,
			text: "Sibling condition.",
		},
		{
			id: "span:personal",
			sourceId: "source:test",
			blockId: "b1",
			charStart: 14,
			charEnd: 29,
			text: "Alpha personal.",
		},
	];
	writeJsonl(join(config.sourcesDir, "test.spans.jsonl"), spans);
	writeFileSync(
		join(config.sourcesDir, "test.json"),
		JSON.stringify({
			id: "source:test",
			hash: "test",
			uri: "https://example.test/standard",
			parsedText: "Alpha global. Alpha personal.",
			sourceType: "html",
			loaderVersion: "test",
			metadata: { sourceRole: "primary", publisher: "Example Standards Body" },
			createdAt: "2026-07-23T00:00:00.000Z",
		}),
		"utf-8",
	);
	const global = claim("claim:global", "Alpha global theorem", "span:global", { type: "GLOBAL" });
	const sibling = claim("claim:sibling", "Sibling condition", "span:sibling", {
		type: "GLOBAL",
	});
	const personal = claim("claim:personal", "Alpha personal note", "span:personal", {
		type: "PERSONAL",
		id: "user:alice",
	});
	const relation: Relation = {
		id: "rel:scoped",
		from: claimRef(global.id),
		to: claimRef(personal.id),
		type: relationType,
		conditions: ["仅在测试环境"],
		conditionStatus: "PRESERVED",
		supersessionEffect: relationType === "SUPERSEDES" ? "CONDITIONAL_TO_CLAIM" : null,
		relationAuditVersion: RELATION_AUDIT_VERSION,
		evidenceSpanIds: ["span:global", "span:personal"],
		derivation: "INFERRED",
		validity: "SUPPORTED",
		lifecycle: "ACTIVE",
		publicationState: "CANONICAL",
		validFrom: null,
		validTo: null,
		compilerVersion: "test",
		source: "cross-material-detect",
		confidence: 0.8,
		consumedBy: [],
	};
	publishSourceResult(
		config,
		{
			schemaVersion: "v1",
			sourceId: "source:test",
			runId: "run:test",
			publishedAt: "2026-07-23T00:00:00.000Z",
			claims: [global, sibling, personal],
			concepts: [],
			relations: [relation],
		},
		{
			schemaVersion: "v1",
			sourceId: "source:test",
			runId: "run:test",
			publishedAt: "2026-07-23T00:00:00.000Z",
			claims: [],
			relations: [],
		},
	);
	return config;
}

function claim(id: string, statement: string, spanId: string, scope: Claim["scope"]): Claim {
	return {
		id,
		statement,
		evidenceSpanIds: [spanId],
		conditions: [],
		derivation: "EXTRACTED",
		validity: "SUPPORTED",
		lifecycle: "ACTIVE",
		publicationState: "CANONICAL",
		validFrom: "2026-07-23T00:00:00.000Z",
		validTo: null,
		compilerVersion: "test",
		confidence: 1,
		claimKind: "FACT",
		scope,
		provenanceRefs: [{ type: "SourceSpan", spanId }],
		supportingEvidenceRefs: [{ type: "SourceSpan", spanId }],
		knowledgeVersion: "test",
		recordedAt: "2026-07-23T00:00:00.000Z",
	};
}

function questionFrameForContext(knowledgeVersion: string): QuestionFrame {
	return {
		id: questionRef("question:alpha-current"),
		stableAddress: "question/test/alpha-current",
		canonicalQuestion: "Alpha 的当前结论是什么？",
		aliases: ["Alpha current"],
		domain: "test",
		scope: { type: "GLOBAL" },
		boundaries: ["仅讨论 Alpha"],
		lifecycle: "ACTIVE",
		parentQuestionRefs: [],
		childQuestionRefs: [],
		mergedInto: null,
		formationSignals: [
			{
				type: "CLAIM_CLUSTER",
				sourceIds: ["source:test"],
				claimRefs: [claimRef("claim:global"), claimRef("claim:sibling")],
				relationIds: [],
				conceptRefs: [],
				reason: "可由后续材料持续更新的长期问题",
			},
		],
		publicationState: "CANONICAL",
		createdAtKnowledgeVersion: knowledgeVersion,
		updatedAtKnowledgeVersion: knowledgeVersion,
		createdAt: "2026-08-20T00:00:00.000Z",
		updatedAt: "2026-08-20T00:00:00.000Z",
	};
}

function wikiCandidate(
	id: string,
	claimIndexes: number[],
	claims: Claim[],
	score: number,
): WikiRetrievalCandidate {
	const refs = claimIndexes.map((index) => {
		const item = claims[index];
		if (!item) throw new Error(`missing test claim ${index}`);
		return claimRef(item.id);
	});
	return {
		module: {
			id,
			stableAddress: id,
			coreQuestion: "Alpha current facts",
			currentUnderstanding: "Alpha",
			disputes: [],
			claimRefs: refs,
			conceptRefs: [],
			dependencies: [],
			publicationState: "CANONICAL",
			updatedAt: "2026-08-12T00:00:00.000Z",
		},
		score,
		matchedSeedClaimIds: refs.slice(0, 2).map(String),
		matchedCoreFeatures: ["w:alpha"],
		matchedAssertionFeatures: [],
	};
}
