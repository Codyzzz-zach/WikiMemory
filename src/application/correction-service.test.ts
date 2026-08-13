import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../config/index.js";
import { currentKnowledgeVersion, restoreKnowledgeSnapshot } from "../evolution/version-store.js";
import { ingestLoadedDocument } from "../ingestor/index.js";
import {
	publishSourceResult,
	readAllAssertedRecords,
	readAllClaims,
	readAllRelations,
	readAllWikiModules,
	upsertWikiModules,
} from "../linter/storage.js";
import { RELATION_AUDIT_VERSION } from "../prompts/index.js";
import type { Claim, Relation } from "../types/index.js";
import { materializeWikiModule } from "../wiki/materialization.js";
import { CorrectionApplicationService } from "./correction-service.js";
import { KnowledgeApplicationService } from "./knowledge-service.js";
import { initializeRuntime } from "./runtime.js";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("CorrectionApplicationService", () => {
	it("commits an actor-owned PERSONAL preference with an auditable rollback snapshot", () => {
		const { config, service } = fixture();
		const proposal = service.propose({
			statement: "回答我时优先使用中文。",
			claimKind: "PREFERENCE",
			scope: { type: "PERSONAL", id: "alice" },
			authorityBasis: "self",
			idempotencyKey: "preference-1",
		});
		expect(proposal).not.toHaveProperty("idempotencyKey");
		expect(proposal).not.toHaveProperty("requestHash");
		expect(proposal).not.toHaveProperty("commitIdempotencyKey");
		const before = currentKnowledgeVersion(config);

		const committed = service.commit({
			proposalId: proposal.proposalId,
			expectedKnowledgeVersion: before,
			idempotencyKey: "commit-preference-1",
		});
		const committedClaimId = requiredClaimId(committed.claimId);

		expect(committed.afterKnowledgeVersion).not.toBe(before);
		expect(readAllClaims(config)).toEqual([
			expect.objectContaining({
				id: committedClaimId,
				claimKind: "PREFERENCE",
				scope: { type: "PERSONAL", id: "alice" },
				validity: "SUPPORTED",
			}),
		]);
		expect(readAllAssertedRecords(config)).toEqual([
			expect.objectContaining({ assertedBy: "alice", claimId: committedClaimId }),
		]);
		expect(
			new KnowledgeApplicationService(config).traceKnowledge({
				objectId: committedClaimId,
				scopeContext: { principalId: "alice" },
			}),
		).toEqual(
			expect.objectContaining({
				assertedRecords: [
					expect.objectContaining({ assertedBy: "alice", assertionText: "回答我时优先使用中文。" }),
				],
			}),
		);
		const agentContext = new KnowledgeApplicationService(config).queryAgentContext({
			task: "回答语言偏好",
			budgetTokens: 1_200,
			scopeContext: { principalId: "alice" },
		});
		expect(agentContext.scopeContext).toEqual({ principalId: "alice" });
		expect(agentContext.serializedContextTokens).toBeLessThanOrEqual(1_200);
		expect(agentContext.assertedRecords).toEqual([
			expect.objectContaining({ assertedBy: "alice", claimId: committedClaimId }),
		]);

		restoreKnowledgeSnapshot(config, committed.rollbackSnapshotId, committed.afterKnowledgeVersion);
		expect(currentKnowledgeVersion(config)).toBe(before);
		expect(readAllClaims(config)).toEqual([]);
		expect(service.getProposal(proposal.proposalId)).toEqual(
			expect.objectContaining({ state: "COMMIT_READY", committedAt: null }),
		);
	});

	it("rolls back only the actor-owned correction with its exact confirmation token", () => {
		const { config, service } = fixture();
		const proposal = service.propose({
			statement: "回答时优先给出简短摘要。",
			claimKind: "PREFERENCE",
			scope: { type: "PERSONAL", id: "alice" },
			authorityBasis: "self",
			idempotencyKey: "rollback-preference",
		});
		const before = currentKnowledgeVersion(config);
		const committed = service.commit({
			proposalId: proposal.proposalId,
			expectedKnowledgeVersion: before,
			idempotencyKey: "rollback-preference-commit",
		});
		expect(() =>
			service.rollback({
				proposalId: proposal.proposalId,
				expectedKnowledgeVersion: committed.afterKnowledgeVersion,
				confirmation: "ROLLBACK:wrong",
			}),
		).toThrow("confirmation");

		const rolledBack = service.rollback({
			proposalId: proposal.proposalId,
			expectedKnowledgeVersion: committed.afterKnowledgeVersion,
			confirmation: committed.rollbackConfirmation,
		});
		expect(rolledBack).toEqual(
			expect.objectContaining({
				proposalId: proposal.proposalId,
				restoredKnowledgeVersion: before,
				rollbackSnapshotId: committed.rollbackSnapshotId,
			}),
		);
		expect(readAllClaims(config)).toEqual([]);
	});

	it("requires the configured project role for DECISION authority", () => {
		const { service } = fixture();
		expect(() =>
			service.propose({
				statement: "项目采用每周五发布。",
				claimKind: "DECISION",
				scope: { type: "PROJECT", id: "wiki" },
				authorityBasis: "role:viewer",
				idempotencyKey: "decision-wrong-role",
			}),
		).toThrow("role:owner");
		expect(
			service.propose({
				statement: "项目采用每周五发布。",
				claimKind: "DECISION",
				scope: { type: "PROJECT", id: "wiki" },
				authorityBasis: "role:owner",
				idempotencyKey: "decision-owner",
			}).state,
		).toBe("COMMIT_READY");
	});

	it("supersedes only an active target of the same kind and scope", () => {
		const { config, service } = fixture();
		const first = service.propose({
			statement: "默认使用英文回答。",
			claimKind: "PREFERENCE",
			scope: { type: "PERSONAL", id: "alice" },
			authorityBasis: "self",
			idempotencyKey: "preference-old",
		});
		const firstCommit = service.commit({
			proposalId: first.proposalId,
			expectedKnowledgeVersion: currentKnowledgeVersion(config),
			idempotencyKey: "preference-old-commit",
		});
		const firstClaimId = requiredClaimId(firstCommit.claimId);
		const replacement = service.propose({
			statement: "默认使用中文回答。",
			claimKind: "PREFERENCE",
			scope: { type: "PERSONAL", id: "alice" },
			authorityBasis: "self",
			targetClaimId: firstClaimId,
			idempotencyKey: "preference-new",
		});
		const replacementCommit = service.commit({
			proposalId: replacement.proposalId,
			expectedKnowledgeVersion: currentKnowledgeVersion(config),
			idempotencyKey: "preference-new-commit",
		});
		const replacementClaimId = requiredClaimId(replacementCommit.claimId);

		expect(readAllClaims(config)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: firstClaimId, lifecycle: "SUPERSEDED" }),
				expect.objectContaining({ id: replacementClaimId, lifecycle: "ACTIVE" }),
			]),
		);
		const knowledge = new KnowledgeApplicationService(config);
		expect(() =>
			knowledge.traceKnowledge({
				objectId: firstClaimId,
				scopeContext: { principalId: "alice" },
			}),
		).toThrow("not found");
		expect(
			knowledge.queryAgentContext({
				task: "任意任务",
				budgetTokens: 1_200,
				scopeContext: { principalId: "alice" },
			}).standingInstructions,
		).toEqual([
			expect.objectContaining({
				claimId: replacementClaimId,
				statement: "默认使用中文回答。",
			}),
		]);
		expect(() =>
			service.propose({
				statement: "再次改为双语回答。",
				claimKind: "PREFERENCE",
				scope: { type: "PERSONAL", id: "alice" },
				authorityBasis: "self",
				targetClaimId: firstClaimId,
				idempotencyKey: "preference-stale-target",
			}),
		).toThrow("ACTIVE");
	});

	it("never makes an asserted world FACT commit-ready without material evidence", () => {
		const { config, service } = fixture();
		const proposal = service.propose({
			statement: "某药物可以治愈所有患者。",
			claimKind: "FACT",
			scope: { type: "GLOBAL" },
			authorityBasis: "user-report",
			idempotencyKey: "fact-1",
		});

		expect(proposal).toEqual(
			expect.objectContaining({
				state: "NEEDS_EVIDENCE",
				risk: "WORLD_FACT_UNVERIFIED",
				impact: expect.objectContaining({ willCreateClaim: false }),
			}),
		);
		expect(() =>
			service.commit({
				proposalId: proposal.proposalId,
				expectedKnowledgeVersion: currentKnowledgeVersion(config),
				idempotencyKey: "commit-fact-1",
			}),
		).toThrow("not commit-ready");
		expect(readAllClaims(config)).toEqual([]);
	});

	it("allows a user to dispute an existing FACT without asserting the replacement as true", () => {
		const { config, service } = fixture();
		const evidenceText = "旧材料断言该功能始终安全。关联结论。";
		const ingested = ingestLoadedDocument(config, {
			uri: "memory://fact-dispute",
			sourceType: "md",
			loaderVersion: "test/v1",
			sourceKey: "fact-dispute",
			title: "Fact dispute",
			parsedText: evidenceText,
			blocks: [
				{
					blockId: "block-0",
					kind: "paragraph",
					charStart: 0,
					charEnd: evidenceText.length,
					text: evidenceText,
				},
			],
		});
		const spanId = ingested.spans[0]?.id ?? "";
		const oldClaim = factClaim("claim:legacy-fact", "旧材料断言该功能始终安全。", spanId);
		const relation = auditedRelation("relation:legacy-support", oldClaim.id, "claim:peer");
		publishFacts(
			config,
			ingested.source.id,
			[oldClaim, factClaim("claim:peer", "关联结论。", spanId)],
			[relation],
		);
		upsertWikiModules(config, [
			materializeWikiModule(
				{
					id: "wiki:safety",
					stableAddress: "wiki://safety",
					coreQuestion: "该功能安全吗？",
					claimRefs: [oldClaim.id],
					conceptRefs: [],
					dependencies: [],
				},
				readAllClaims(config),
				ingested.spans,
				{
					sourceKnowledgeVersion: currentKnowledgeVersion(config),
					rebuiltFromSnapshotId: null,
					updatedAt: "2026-08-13T00:00:00.000Z",
				},
			),
		]);
		const before = currentKnowledgeVersion(config);
		const proposal = service.propose({
			statement: "我认为该结论不再成立，请先停止无条件使用。",
			claimKind: "FACT",
			scope: { type: "GLOBAL" },
			authorityBasis: "user-dispute",
			targetClaimId: oldClaim.id,
			idempotencyKey: "fact-dispute-1",
		});

		expect(proposal).toEqual(
			expect.objectContaining({
				state: "DISPUTE_READY",
				impact: expect.objectContaining({
					willCreateClaim: false,
					willDisputeClaimId: oldClaim.id,
					willInvalidateDerivedViews: true,
				}),
			}),
		);
		const committed = service.commit({
			proposalId: proposal.proposalId,
			expectedKnowledgeVersion: before,
			idempotencyKey: "fact-dispute-commit",
		});
		expect(committed).toEqual(
			expect.objectContaining({
				claimId: null,
				disputedClaimId: oldClaim.id,
				rebuiltWikiModuleIds: ["wiki:safety"],
			}),
		);
		expect(readAllClaims(config)).toEqual(
			expect.arrayContaining([expect.objectContaining({ id: oldClaim.id, validity: "DISPUTED" })]),
		);
		expect(readAllClaims(config).some((claim) => claim.statement === proposal.statement)).toBe(
			false,
		);
		expect(readAllRelations(config)).toEqual([
			expect.objectContaining({ id: relation.id, validity: "UNRESOLVED" }),
		]);
		expect(readAllWikiModules(config)).toEqual([
			expect.objectContaining({
				id: "wiki:safety",
				currentUnderstanding: "当前没有通过争议门禁的确定结论。",
				disputes: [expect.stringContaining("旧材料断言该功能始终安全")],
			}),
		]);
		const agentContext = new KnowledgeApplicationService(config).queryAgentContext({
			task: "该功能是否始终安全？",
			budgetTokens: 1_600,
		});
		expect(agentContext.contextPack.claimTable.rows).toEqual(
			expect.arrayContaining([expect.arrayContaining([oldClaim.id, "旧材料断言该功能始终安全。"])]),
		);
		expect(agentContext.contextPack.payload.conflictsAndConditions).toEqual(
			expect.arrayContaining([expect.stringContaining(oldClaim.id)]),
		);
		expect(agentContext.contextPack.payload.relations).toEqual([]);
		expect(agentContext.assertedRecords).toEqual([
			expect.objectContaining({
				assertedBy: "alice",
				assertionText: proposal.statement,
			}),
		]);
		const traced = new KnowledgeApplicationService(config).traceKnowledge({
			objectId: oldClaim.id,
		});
		expect(traced).toEqual(
			expect.objectContaining({
				claim: expect.objectContaining({ validity: "DISPUTED" }),
				assertedRecords: [
					expect.objectContaining({
						assertedBy: "alice",
						assertionText: proposal.statement,
					}),
				],
			}),
		);
	});

	it("is idempotent by proposal and commit keys and rejects conflicting reuse", () => {
		const { config, service } = fixture();
		const request = {
			statement: "默认给出简洁回答。",
			claimKind: "PREFERENCE" as const,
			scope: { type: "PERSONAL" as const, id: "alice" },
			authorityBasis: "self",
			idempotencyKey: "proposal-idempotent",
		};
		const first = service.propose(request);
		expect(service.propose(request)).toEqual(first);
		expect(() => service.propose({ ...request, statement: "不同内容" })).toThrow(
			"different correction proposal",
		);
		const before = currentKnowledgeVersion(config);
		const committed = service.commit({
			proposalId: first.proposalId,
			expectedKnowledgeVersion: before,
			idempotencyKey: "commit-idempotent",
		});
		expect(
			service.commit({
				proposalId: first.proposalId,
				expectedKnowledgeVersion: before,
				idempotencyKey: "commit-idempotent",
			}),
		).toEqual({ ...committed, idempotentReplay: true });
		expect(() =>
			service.commit({
				proposalId: first.proposalId,
				expectedKnowledgeVersion: before,
				idempotencyKey: "different-commit-key",
			}),
		).toThrow("different idempotencyKey");
	});

	it("refuses snapshot rollback after later knowledge changes", () => {
		const { config, service } = fixture();
		const first = service.propose({
			statement: "优先中文回答。",
			claimKind: "PREFERENCE",
			scope: { type: "PERSONAL", id: "alice" },
			authorityBasis: "self",
			idempotencyKey: "unsafe-rollback-first",
		});
		const firstCommit = service.commit({
			proposalId: first.proposalId,
			expectedKnowledgeVersion: currentKnowledgeVersion(config),
			idempotencyKey: "unsafe-rollback-first-commit",
		});
		const second = service.propose({
			statement: "回答先给摘要。",
			claimKind: "PREFERENCE",
			scope: { type: "PERSONAL", id: "alice" },
			authorityBasis: "self",
			idempotencyKey: "unsafe-rollback-second",
		});
		service.commit({
			proposalId: second.proposalId,
			expectedKnowledgeVersion: currentKnowledgeVersion(config),
			idempotencyKey: "unsafe-rollback-second-commit",
		});
		const replayedFirst = service.commit({
			proposalId: first.proposalId,
			expectedKnowledgeVersion: firstCommit.beforeKnowledgeVersion,
			idempotencyKey: "unsafe-rollback-first-commit",
		});
		expect(replayedFirst.afterKnowledgeVersion).toBe(firstCommit.afterKnowledgeVersion);

		expect(() =>
			service.rollback({
				proposalId: first.proposalId,
				expectedKnowledgeVersion: currentKnowledgeVersion(config),
				confirmation: firstCommit.rollbackConfirmation,
			}),
		).toThrow("direct snapshot rollback is unsafe");
		expect(readAllClaims(config)).toHaveLength(2);
	});
});

function fixture() {
	const root = mkdtempSync(join(tmpdir(), "wge-correction-"));
	roots.push(root);
	const config = loadConfig({ runtimeRoot: root, apiKey: "" });
	initializeRuntime(config);
	return {
		config,
		service: new CorrectionApplicationService(config, {
			principalId: "alice",
			projectRoles: { wiki: "owner" },
		}),
	};
}

function requiredClaimId(claimId: string | null): string {
	if (!claimId) throw new Error("Expected a committed Claim ID");
	return claimId;
}

function publishFacts(
	config: ReturnType<typeof loadConfig>,
	sourceId: string,
	claims: Claim[],
	relations: Relation[],
) {
	const publishedAt = "2026-08-13T00:00:00.000Z";
	publishSourceResult(
		config,
		{
			schemaVersion: "v1",
			sourceId,
			runId: "run:facts",
			publishedAt,
			claims,
			concepts: [],
			relations,
		},
		{
			schemaVersion: "v1",
			sourceId,
			runId: "run:facts",
			publishedAt,
			claims: [],
			relations: [],
		},
	);
}

function factClaim(id: string, statement: string, spanId: string): Claim {
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
		recordedAt: "2026-08-13T00:00:00.000Z",
	};
}

function auditedRelation(id: string, from: string, to: string): Relation {
	return {
		id,
		from: from as Relation["from"],
		to: to as Relation["to"],
		type: "SUPPORTS",
		conditions: [],
		conditionStatus: "EXPLICIT_NONE",
		supersessionEffect: null,
		relationAuditVersion: RELATION_AUDIT_VERSION,
		evidenceSpanIds: [],
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
