import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../config/index.js";
import { currentKnowledgeVersion } from "../evolution/version-store.js";
import { ingestLoadedDocument } from "../ingestor/index.js";
import { publishSourceResult, readAllClaims, readSourcePublications } from "../linter/storage.js";
import { RELATION_AUDIT_VERSION } from "../prompts/index.js";
import type { Claim, Relation } from "../types/index.js";
import { claimRef } from "../types/index.js";
import { CorrectionApplicationService } from "./correction-service.js";
import { FactCorrectionResolutionApplicationService } from "./fact-resolution-service.js";
import { initializeRuntime } from "./runtime.js";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("FactCorrectionResolutionApplicationService", () => {
	it("resolves a committed FACT dispute only through an audited evidence relation", () => {
		const { config, corrections, resolutions } = fixture();
		const oldSpan = ingestSpan(config, "old", "旧文档声称部署不需要人工批准。");
		const oldClaim = fact("claim:old-deploy", "旧文档声称部署不需要人工批准。", oldSpan);
		publish(config, "source:old", [oldClaim], []);
		const proposal = corrections.propose({
			statement: "这条部署规则可能已过时，请停止无条件使用。",
			claimKind: "FACT",
			scope: { type: "GLOBAL" },
			authorityBasis: "user-dispute",
			targetClaimId: oldClaim.id,
			idempotencyKey: "dispute-deploy",
		});
		corrections.commit({
			proposalId: proposal.proposalId,
			expectedKnowledgeVersion: currentKnowledgeVersion(config),
			idempotencyKey: "commit-dispute-deploy",
		});

		const newSpan = ingestSpan(config, "new", "新规范要求部署必须由负责人批准。");
		const newClaim = fact("claim:new-deploy", "新规范要求部署必须由负责人批准。", newSpan);
		const replacement = relation(
			"relation:new-replaces-old",
			newClaim.id,
			oldClaim.id,
			"SUPERSEDES",
			[newSpan, oldSpan],
		);
		publish(config, "source:new", [newClaim], [replacement]);
		const before = currentKnowledgeVersion(config);
		const request = {
			proposalId: proposal.proposalId,
			relationId: replacement.id,
			expectedKnowledgeVersion: before,
			idempotencyKey: "resolve-deploy",
		};

		const resolved = resolutions.resolve(request);
		expect(resolved).toEqual(
			expect.objectContaining({
				outcome: "SUPERSEDED",
				beforeKnowledgeVersion: before,
				idempotentReplay: false,
				recoveredAfterCrash: false,
			}),
		);
		expect(readAllClaims(config)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: oldClaim.id, lifecycle: "SUPERSEDED" }),
				expect.objectContaining({ id: newClaim.id, lifecycle: "ACTIVE", validity: "SUPPORTED" }),
			]),
		);
		expect(
			readSourcePublications(config).find((item) => item.sourceId === "source:new")
				?.evolutionOperationId,
		).toMatch(/^fact-resolution:/);
		expect(resolutions.resolve(request)).toEqual({
			...resolved,
			idempotentReplay: true,
		});
		expect(() =>
			new FactCorrectionResolutionApplicationService(config, {
				principalId: "mallory",
				projectRoles: {},
			}).resolve(request),
		).toThrow("Only the resolution actor");
	});

	it("rejects unaudited, misdirected, or non-material resolution edges", () => {
		const { config, corrections, resolutions } = fixture();
		const oldSpan = ingestSpan(config, "old-invalid", "旧结论。");
		const newSpan = ingestSpan(config, "new-invalid", "新结论。");
		const oldClaim = fact("claim:old-invalid", "旧结论。", oldSpan);
		const newClaim = fact("claim:new-invalid", "新结论。", newSpan);
		publish(config, "source:old-invalid", [oldClaim], []);
		const proposal = corrections.propose({
			statement: "旧结论可能错误。",
			claimKind: "FACT",
			scope: { type: "GLOBAL" },
			authorityBasis: "user-dispute",
			targetClaimId: oldClaim.id,
			idempotencyKey: "dispute-invalid",
		});
		corrections.commit({
			proposalId: proposal.proposalId,
			expectedKnowledgeVersion: currentKnowledgeVersion(config),
			idempotencyKey: "commit-invalid",
		});
		const unaudited = {
			...relation("relation:unaudited", newClaim.id, oldClaim.id, "SUPERSEDES", [newSpan, oldSpan]),
			relationAuditVersion: null,
		};
		publish(config, "source:new-invalid", [newClaim], [unaudited]);

		expect(() =>
			resolutions.resolve({
				proposalId: proposal.proposalId,
				relationId: unaudited.id,
				expectedKnowledgeVersion: currentKnowledgeVersion(config),
				idempotencyKey: "resolve-invalid",
			}),
		).toThrow("audit gate");
		expect(readAllClaims(config).find((item) => item.id === oldClaim.id)?.lifecycle).toBe("ACTIVE");
	});

	it("rolls back a resolution but refuses to erase later knowledge", () => {
		const { config, corrections, resolutions } = fixture();
		const oldSpan = ingestSpan(config, "old-rollback", "旧政策有效。");
		const oldClaim = fact("claim:old-policy", "旧政策有效。", oldSpan);
		publish(config, "source:old-policy", [oldClaim], []);
		const proposal = corrections.propose({
			statement: "旧政策可能已经失效。",
			claimKind: "FACT",
			scope: { type: "GLOBAL" },
			authorityBasis: "user-dispute",
			targetClaimId: oldClaim.id,
			idempotencyKey: "dispute-policy",
		});
		corrections.commit({
			proposalId: proposal.proposalId,
			expectedKnowledgeVersion: currentKnowledgeVersion(config),
			idempotencyKey: "commit-policy",
		});
		const newSpan = ingestSpan(config, "new-rollback", "新政策取代旧政策。");
		const newClaim = fact("claim:new-policy", "新政策取代旧政策。", newSpan);
		const edge = relation("relation:policy-replace", newClaim.id, oldClaim.id, "SUPERSEDES", [
			newSpan,
			oldSpan,
		]);
		publish(config, "source:new-policy", [newClaim], [edge]);
		const resolved = resolutions.resolve({
			proposalId: proposal.proposalId,
			relationId: edge.id,
			expectedKnowledgeVersion: currentKnowledgeVersion(config),
			idempotencyKey: "resolve-policy",
		});
		const laterSpan = ingestSpan(config, "later", "后续新增知识。");
		publish(config, "source:later", [fact("claim:later", "后续新增知识。", laterSpan)], []);

		expect(() =>
			resolutions.rollback({
				proposalId: proposal.proposalId,
				idempotencyKey: "resolve-policy",
				expectedKnowledgeVersion: currentKnowledgeVersion(config),
				confirmation: resolved.rollbackConfirmation,
			}),
		).toThrow("later knowledge changes");
	});
});

function fixture() {
	const root = mkdtempSync(join(tmpdir(), "wge-fact-resolution-"));
	roots.push(root);
	const config = loadConfig({ runtimeRoot: root, apiKey: "" });
	initializeRuntime(config);
	const identity = { principalId: "alice", projectRoles: { wiki: "owner" } };
	return {
		config,
		corrections: new CorrectionApplicationService(config, identity),
		resolutions: new FactCorrectionResolutionApplicationService(config, identity),
	};
}

function ingestSpan(config: ReturnType<typeof loadConfig>, key: string, text: string): string {
	const ingested = ingestLoadedDocument(config, {
		uri: `memory://${key}`,
		sourceType: "md",
		loaderVersion: "test/v1",
		sourceKey: key,
		title: key,
		parsedText: text,
		blocks: [{ blockId: "block-0", kind: "paragraph", charStart: 0, charEnd: text.length, text }],
	});
	return ingested.spans[0]?.id ?? "";
}

function publish(
	config: ReturnType<typeof loadConfig>,
	sourceId: string,
	claims: Claim[],
	relations: Relation[],
): void {
	publishSourceResult(
		config,
		{
			schemaVersion: "v1",
			sourceId,
			runId: `run:${sourceId}`,
			publishedAt: "2026-08-13T00:00:00.000Z",
			claims,
			concepts: [],
			relations,
		},
		{
			schemaVersion: "v1",
			sourceId,
			runId: `run:${sourceId}`,
			publishedAt: "2026-08-13T00:00:00.000Z",
			claims: [],
			relations: [],
		},
	);
}

function fact(id: string, statement: string, spanId: string): Claim {
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
		recordedAt: "2026-08-13T00:00:00.000Z",
	};
}

function relation(
	id: string,
	from: string,
	to: string,
	type: "SUPERSEDES" | "CONTRADICTS",
	evidenceSpanIds: string[],
): Relation {
	return {
		id,
		from: claimRef(from),
		to: claimRef(to),
		type,
		conditions: [],
		conditionStatus: "EXPLICIT_NONE",
		supersessionEffect: type === "SUPERSEDES" ? "TOTAL_TO_CLAIM" : null,
		relationAuditVersion: RELATION_AUDIT_VERSION,
		evidenceSpanIds,
		derivation: "INFERRED",
		validity: "SUPPORTED",
		lifecycle: "ACTIVE",
		publicationState: "CANONICAL",
		validFrom: null,
		validTo: null,
		compilerVersion: "test",
		source: "human-confirm",
		confidence: 1,
		consumedBy: [],
	};
}
