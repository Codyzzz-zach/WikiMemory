import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { beginCompileRun } from "../compiler/run-state.js";
import { loadConfig } from "../config/index.js";
import type { LLMProvider } from "../core/llm-provider.js";
import type { ChatOptions, ChatResult } from "../core/types.js";
import {
	createKnowledgeSnapshot,
	currentCanonicalEvidenceVersion,
} from "../evolution/version-store.js";
import { ingestLoadedDocument } from "../ingestor/index.js";
import {
	publishSourceResult,
	readAllClaims,
	readAllRelations,
	readAllSpans,
	readAllWikiModules,
	upsertWikiModules,
} from "../linter/storage.js";
import type { Claim, QuestionFrame } from "../types/index.js";
import { claimRef, questionRef } from "../types/index.js";
import { materializeQuestionWikiModule } from "../wiki/materialization.js";
import { gateQuestionProposals } from "../wiki/question-formation-v2.js";
import type { proposeQuestionCandidates } from "../wiki/question-proposer.js";
import {
	publishQuestionEvolution,
	readAllQuestionFrames,
	readQuestionState,
} from "../wiki/question-storage.js";
import {
	beginQuestionTransaction,
	readPendingQuestionTransactions,
} from "../wiki/question-transaction.js";
import { QuestionMaintenanceApplicationService } from "./question-maintenance-service.js";
import { initializeRuntime } from "./runtime.js";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("QuestionMaintenanceApplicationService", () => {
	it("publishes a grounded active QuestionFrame and its WikiModule V2", async () => {
		const fixture = createFixture();
		const result = await new QuestionMaintenanceApplicationService(fixture.config, {
			propose: proposalFor(fixture.claims.map((claim) => claim.id)),
			now: () => new Date("2026-08-20T00:00:00.000Z"),
		}).maintain({
			provider: new UnusedProvider(),
			run: fixture.run,
			source: fixture.source,
			publication: fixture.publication,
			declaredDomain: "distributed-systems",
		});

		expect(result).toMatchObject({
			status: "UPDATED",
			createdQuestions: 1,
			publishedWikiModuleIds: [expect.stringMatching(/^wiki:/)],
		});
		expect(readAllQuestionFrames(fixture.config)[0]).toMatchObject({
			lifecycle: "ACTIVE",
			publicationState: "CANONICAL",
			domain: "distributed-systems",
		});
		expect(readAllWikiModules(fixture.config)[0]?.materialization?.schemaVersion).toBe(
			"wge-wiki-materialization/v2",
		);
		expect(result.materialImpactReportPath && existsSync(result.materialImpactReportPath)).toBe(
			true,
		);
		const report = JSON.parse(
			readFileSync(result.materialImpactReportPath ?? "", "utf-8"),
		) as Record<string, unknown>;
		expect(report).toMatchObject({
			schemaVersion: "wge-material-impact-report/v1",
			outcome: "UPDATED",
			wikiChanges: [expect.objectContaining({ questionRef: expect.stringMatching(/^question:/) })],
		});
	});

	it("rolls back only Question/Wiki views when Wiki publication fails", async () => {
		const fixture = createFixture();
		const evidenceVersion = currentCanonicalEvidenceVersion(fixture.config);
		const service = new QuestionMaintenanceApplicationService(fixture.config, {
			propose: proposalFor(fixture.claims.map((claim) => claim.id)),
			publishWiki: () => {
				throw new Error("injected Wiki publication failure");
			},
			now: () => new Date("2026-08-20T00:00:00.000Z"),
		});

		await expect(
			service.maintain({
				provider: new UnusedProvider(),
				run: fixture.run,
				source: fixture.source,
				publication: fixture.publication,
				declaredDomain: "distributed-systems",
			}),
		).rejects.toThrow("injected Wiki publication failure");

		expect(readAllQuestionFrames(fixture.config)).toEqual([]);
		expect(readAllWikiModules(fixture.config)).toEqual([]);
		expect(
			readAllClaims(fixture.config)
				.map((claim) => claim.id)
				.sort(),
		).toEqual(fixture.claims.map((claim) => claim.id).sort());
		expect(currentCanonicalEvidenceVersion(fixture.config)).toBe(evidenceVersion);
	});

	it("skips formation without a human-declared domain", async () => {
		const fixture = createFixture(false);
		const result = await new QuestionMaintenanceApplicationService(fixture.config, {
			propose: proposalFor(fixture.claims.map((claim) => claim.id)),
		}).maintain({
			provider: new UnusedProvider(),
			run: fixture.run,
			source: fixture.source,
			publication: fixture.publication,
		});
		expect(result).toMatchObject({ status: "SKIPPED", reason: "MISSING_DECLARED_DOMAIN" });
		expect(readAllQuestionFrames(fixture.config)).toEqual([]);
	});

	it("replays a pending receipt after a crash between Question and Wiki writes", () => {
		const fixture = createFixture();
		const evidenceVersion = currentCanonicalEvidenceVersion(fixture.config);
		const gated = gateQuestionProposals({
			sourceId: fixture.source.id,
			knowledgeVersion: evidenceVersion,
			declaredDomain: "distributed-systems",
			proposals: [candidateProposal(fixture.claims.map((claim) => claim.id))],
			claims: fixture.claims,
			relations: readAllRelations(fixture.config),
			concepts: [],
			spans: readAllSpans(fixture.config),
			existingFrames: [],
			now: "2026-08-20T00:00:00.000Z",
		});
		const snapshot = createKnowledgeSnapshot(fixture.config, "before simulated crash");
		beginQuestionTransaction(fixture.config, {
			runId: fixture.run.runId,
			sourceId: fixture.source.id,
			canonicalEvidenceVersion: evidenceVersion,
			beforeQuestionStateHash: readQuestionState(fixture.config).stateHash,
			snapshotId: snapshot.id,
			frames: gated.framesToPublish,
			decisions: gated.evolutionDecisions,
			createdAt: "2026-08-20T00:00:00.000Z",
		});
		publishQuestionEvolution(fixture.config, {
			frames: gated.framesToPublish,
			decisions: gated.evolutionDecisions,
		});
		expect(readAllWikiModules(fixture.config)).toEqual([]);

		const recovered = new QuestionMaintenanceApplicationService(fixture.config, {
			now: () => new Date("2026-08-20T00:01:00.000Z"),
		}).recoverPendingTransactions();

		expect(recovered).toHaveLength(1);
		expect(readPendingQuestionTransactions(fixture.config)).toEqual([]);
		expect(readAllWikiModules(fixture.config)[0]?.materialization?.schemaVersion).toBe(
			"wge-wiki-materialization/v2",
		);
	});

	it("keeps an unrelated Question/Wiki sentinel byte-stable", async () => {
		const fixture = createFixture();
		const evidenceVersion = currentCanonicalEvidenceVersion(fixture.config);
		const sentinel = sentinelFrame(
			evidenceVersion,
			fixture.claims.map((claim) => claim.id),
		);
		publishQuestionEvolution(fixture.config, {
			frames: [sentinel],
			decisions: [
				{
					id: "question-decision:sentinel",
					knowledgeVersion: evidenceVersion,
					sourceId: fixture.source.id,
					action: "CREATE",
					questionRefs: [sentinel.id],
					affectedClaimRefs: fixture.claims.map((claim) => claimRef(claim.id)),
					affectedRelationIds: [],
					reasonCodes: ["CREATE"],
					beforeHash: null,
					afterHash: "sentinel",
					formationVersion: "wge-question-formation/v1",
					createdAt: "2026-08-19T00:00:00.000Z",
				},
			],
		});
		const sentinelModule = materializeQuestionWikiModule(
			sentinel,
			fixture.claims,
			[],
			readAllSpans(fixture.config),
			{
				sourceKnowledgeVersion: evidenceVersion,
				rebuiltFromSnapshotId: null,
				updatedAt: "2026-08-19T00:00:00.000Z",
				questionEvolutionDecisionId: "question-decision:sentinel",
			},
		);
		upsertWikiModules(fixture.config, [sentinelModule]);
		const beforeFrame = JSON.stringify(sentinel);
		const beforeModule = JSON.stringify(sentinelModule);

		await new QuestionMaintenanceApplicationService(fixture.config, {
			propose: proposalFor(fixture.claims.map((claim) => claim.id)),
			now: () => new Date("2026-08-20T00:00:00.000Z"),
		}).maintain({
			provider: new UnusedProvider(),
			run: fixture.run,
			source: fixture.source,
			publication: fixture.publication,
			declaredDomain: "distributed-systems",
		});

		expect(
			JSON.stringify(
				readAllQuestionFrames(fixture.config).find((frame) => frame.id === sentinel.id),
			),
		).toBe(beforeFrame);
		expect(
			JSON.stringify(
				readAllWikiModules(fixture.config).find((module) => module.id === sentinelModule.id),
			),
		).toBe(beforeModule);
	});
});

function createFixture(withMetadataDomain = true) {
	const root = mkdtempSync(join(tmpdir(), "wge-question-maintenance-"));
	roots.push(root);
	const config = loadConfig({ runtimeRoot: root, apiKey: "test", model: "test" });
	initializeRuntime(config);
	const text = "消息至少投递一次。去重可以实现恰好一次效果。";
	const ingested = ingestLoadedDocument(config, {
		uri: "memory://delivery",
		sourceType: "md",
		loaderVersion: "test",
		sourceKey: "delivery",
		title: "Delivery semantics",
		metadata: withMetadataDomain ? { domain: "distributed-systems" } : {},
		parsedText: text,
		blocks: [{ blockId: "b0", kind: "paragraph", charStart: 0, charEnd: text.length, text }],
	});
	const spanId = ingested.spans[0]?.id;
	if (!spanId) throw new Error("expected persisted span");
	const claims = [
		claim("claim:at-least-once", "消息至少投递一次", spanId),
		claim("claim:dedup", "去重可以实现恰好一次效果", spanId),
	];
	const publishedAt = "2026-08-20T00:00:00.000Z";
	const publication = {
		schemaVersion: "v1" as const,
		sourceId: ingested.source.id,
		runId: "run:canonical",
		publishedAt,
		claims,
		concepts: [],
		relations: [],
	};
	publishSourceResult(config, publication, {
		schemaVersion: "v1",
		sourceId: ingested.source.id,
		runId: "run:canonical",
		publishedAt,
		claims: [],
		relations: [],
	});
	const run = beginCompileRun(config, ingested.source.id, config.model);
	return { config, source: ingested.source, publication, claims, run };
}

function proposalFor(claimIds: string[]): typeof proposeQuestionCandidates {
	return async () => ({
		schemaVersion: "wge-question-proposal/v1",
		promptVersion: "v1.1",
		proposals: [candidateProposal(claimIds)],
		lifecycleProposals: [],
	});
}

function candidateProposal(claimIds: string[]) {
	return {
		proposalId: "proposal:delivery",
		matchQuestionRef: null,
		canonicalQuestion: "消息系统能提供哪些投递语义？",
		aliases: ["投递保证"],
		domain: "distributed-systems",
		scope: { type: "GLOBAL" as const },
		boundaries: ["仅讨论消息传递语义"],
		claimIds,
		relationIds: [],
		conceptIds: [],
		recommendedLifecycle: "ACTIVE" as const,
		rationale: "该问题独立于单篇材料并可由后续材料持续修订",
	};
}

function sentinelFrame(knowledgeVersion: string, claimIds: string[]): QuestionFrame {
	return {
		id: questionRef("question:unrelated-sentinel"),
		stableAddress: "question/storage/unrelated-sentinel",
		canonicalQuestion: "存储压缩策略如何选择？",
		aliases: [],
		domain: "storage",
		scope: { type: "GLOBAL" },
		boundaries: ["仅作为无关更新哨兵"],
		lifecycle: "ACTIVE",
		parentQuestionRefs: [],
		childQuestionRefs: [],
		mergedInto: null,
		formationSignals: [
			{
				type: "CLAIM_CLUSTER",
				sourceIds: ["source:sentinel"],
				claimRefs: claimIds.map(claimRef),
				relationIds: [],
				conceptRefs: [],
				reason: "isolation sentinel",
			},
		],
		publicationState: "CANONICAL",
		createdAtKnowledgeVersion: knowledgeVersion,
		updatedAtKnowledgeVersion: knowledgeVersion,
		createdAt: "2026-08-19T00:00:00.000Z",
		updatedAt: "2026-08-19T00:00:00.000Z",
	};
}

function claim(id: string, statement: string, spanId: string): Claim {
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
		knowledgeVersion: "kv:test",
		recordedAt: "2026-08-20T00:00:00.000Z",
	};
}

class UnusedProvider implements LLMProvider {
	async chat(_options: ChatOptions): Promise<ChatResult> {
		throw new Error("provider should not be called by injected proposer");
	}

	async chatWithThinking(options: ChatOptions): Promise<ChatResult> {
		return this.chat(options);
	}
}
