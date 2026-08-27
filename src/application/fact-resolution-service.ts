import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AppConfig } from "../config/types.js";
import { applyKnowledgeEvolution } from "../evolution/transaction.js";
import { currentKnowledgeVersion, restoreKnowledgeSnapshot } from "../evolution/version-store.js";
import { inspectRelationGate } from "../graph/index.js";
import { withRuntimeWriteLease } from "../infrastructure/runtime-write-lock.js";
import {
	readAllClaims,
	readAllConcepts,
	readAllRelations,
	readSourcePublications,
	writeJsonAtomic,
} from "../linter/storage.js";
import type { Claim, Relation } from "../types/index.js";
import { CorrectionApplicationService, type CorrectionIdentity } from "./correction-service.js";

export interface ResolveFactCorrectionRequest {
	proposalId: string;
	relationId: string;
	expectedKnowledgeVersion: string;
	idempotencyKey: string;
}

export interface ResolveFactCorrectionResponse {
	proposalId: string;
	relationId: string;
	outcome: "SUPERSEDED" | "CONFLICT_RECORDED";
	beforeKnowledgeVersion: string;
	afterKnowledgeVersion: string;
	rollbackSnapshotId: string;
	rollbackConfirmation: string;
	rebuiltWikiModuleIds: string[];
	idempotentReplay: boolean;
	recoveredAfterCrash: boolean;
}

export interface RollbackFactResolutionRequest {
	proposalId: string;
	idempotencyKey: string;
	expectedKnowledgeVersion: string;
	confirmation: string;
}

export interface RollbackFactResolutionResponse {
	proposalId: string;
	relationId: string;
	rolledBackFromKnowledgeVersion: string;
	restoredKnowledgeVersion: string;
	rollbackSnapshotId: string;
}

interface FactResolutionRecord {
	schemaVersion: "wge-fact-resolution/v1";
	idempotencyKey: string;
	requestHash: string;
	operationId: string;
	actor: string;
	proposalId: string;
	relationId: string;
	expectedKnowledgeVersion: string;
	state: "PENDING" | "COMPLETED" | "ROLLED_BACK";
	createdAt: string;
	updatedAt: string;
	result: Omit<ResolveFactCorrectionResponse, "idempotentReplay" | "recoveredAfterCrash"> | null;
}

/**
 * Connect a human FACT dispute to compiled evidence without treating the human statement as truth.
 * Only an audited SUPERSEDES/CONTRADICTS edge may enter the existing snapshot transaction.
 */
export class FactCorrectionResolutionApplicationService {
	private readonly corrections: CorrectionApplicationService;

	constructor(
		private readonly config: AppConfig,
		private readonly identity: CorrectionIdentity,
	) {
		this.corrections = new CorrectionApplicationService(config, identity);
	}

	resolve(request: ResolveFactCorrectionRequest): ResolveFactCorrectionResponse {
		const normalized = normalizeResolveRequest(request);
		const requestHash = stableHash(normalized);
		const operationId = `fact-resolution:${stableHash(normalized.idempotencyKey)}`;
		return withRuntimeWriteLease(this.config, `resolve-fact:${normalized.proposalId}`, () => {
			const existing = readRecord(this.config, normalized.idempotencyKey);
			if (existing) {
				if (existing.actor !== this.identity.principalId) {
					throw new Error("Only the resolution actor may replay this FACT resolution");
				}
				if (existing.requestHash !== requestHash) {
					throw new Error("idempotencyKey was already used for a different FACT resolution");
				}
				if (existing.state === "COMPLETED" && existing.result) {
					return { ...existing.result, idempotentReplay: true, recoveredAfterCrash: false };
				}
				if (existing.state === "ROLLED_BACK") {
					throw new Error(
						"FACT resolution was rolled back; use a new idempotencyKey to apply again",
					);
				}
				const recovered = this.recoverCommittedOperation(existing);
				if (recovered) return recovered;
			}

			const { proposal, relation } = this.validateResolution(normalized);
			const createdAt = existing?.createdAt ?? new Date().toISOString();
			const pending: FactResolutionRecord = existing ?? {
				schemaVersion: "wge-fact-resolution/v1",
				idempotencyKey: normalized.idempotencyKey,
				requestHash,
				operationId,
				actor: proposal.actor,
				proposalId: normalized.proposalId,
				relationId: normalized.relationId,
				expectedKnowledgeVersion: normalized.expectedKnowledgeVersion,
				state: "PENDING",
				createdAt,
				updatedAt: createdAt,
				result: null,
			};
			writeRecord(this.config, pending);
			const evolved = applyKnowledgeEvolution(
				this.config,
				[normalized.relationId],
				normalized.expectedKnowledgeVersion,
				{ operationId },
			);
			const result = resultFromEvolution(
				normalized.proposalId,
				relation,
				evolved.beforeKnowledgeVersion,
				evolved.afterKnowledgeVersion,
				evolved.snapshotId,
				evolved.rebuiltWikiModuleIds,
			);
			writeRecord(this.config, {
				...pending,
				state: "COMPLETED",
				updatedAt: new Date().toISOString(),
				result,
			});
			return { ...result, idempotentReplay: false, recoveredAfterCrash: false };
		});
	}

	rollback(request: RollbackFactResolutionRequest): RollbackFactResolutionResponse {
		const proposalId = request.proposalId.trim();
		const idempotencyKey = request.idempotencyKey.trim();
		const expectedKnowledgeVersion = request.expectedKnowledgeVersion.trim();
		const confirmation = request.confirmation.trim();
		if (!proposalId || !idempotencyKey || !expectedKnowledgeVersion || !confirmation) {
			throw new Error(
				"proposalId, idempotencyKey, expectedKnowledgeVersion and confirmation are required",
			);
		}
		return withRuntimeWriteLease(this.config, `rollback-fact:${proposalId}`, () => {
			const record = readRecord(this.config, idempotencyKey);
			if (!record || record.proposalId !== proposalId) {
				throw new Error("FACT resolution record not found");
			}
			if (record.actor !== this.identity.principalId) {
				throw new Error("Only the resolution actor may roll it back");
			}
			if (record.state !== "COMPLETED" || !record.result) {
				throw new Error("FACT resolution has no completed state to roll back");
			}
			if (confirmation !== record.result.rollbackConfirmation) {
				throw new Error("FACT resolution rollback confirmation does not match");
			}
			const actual = currentKnowledgeVersion(this.config);
			if (actual !== expectedKnowledgeVersion || actual !== record.result.afterKnowledgeVersion) {
				throw new Error(
					"FACT resolution has later knowledge changes; direct snapshot rollback is unsafe",
				);
			}
			restoreKnowledgeSnapshot(this.config, record.result.rollbackSnapshotId, actual);
			writeRecord(this.config, {
				...record,
				state: "ROLLED_BACK",
				updatedAt: new Date().toISOString(),
			});
			return {
				proposalId,
				relationId: record.relationId,
				rolledBackFromKnowledgeVersion: actual,
				restoredKnowledgeVersion: currentKnowledgeVersion(this.config),
				rollbackSnapshotId: record.result.rollbackSnapshotId,
			};
		});
	}

	private validateResolution(request: ReturnType<typeof normalizeResolveRequest>) {
		const proposal = this.corrections.getProposal(request.proposalId);
		if (!proposal) throw new Error(`Correction proposal not found: ${request.proposalId}`);
		if (proposal.actor !== this.identity.principalId) {
			throw new Error("Only the proposal actor may resolve its FACT dispute");
		}
		if (
			proposal.claimKind !== "FACT" ||
			proposal.state !== "COMMITTED" ||
			!proposal.targetClaimId
		) {
			throw new Error("FACT resolution requires a committed dispute with a target Claim");
		}
		const actualVersion = currentKnowledgeVersion(this.config);
		if (actualVersion !== request.expectedKnowledgeVersion) {
			throw new Error(
				`Knowledge state changed: expected=${request.expectedKnowledgeVersion}, actual=${actualVersion}`,
			);
		}
		const claims = readAllClaims(this.config);
		const claimById = new Map(claims.map((claim) => [claim.id, claim]));
		const target = claimById.get(proposal.targetClaimId);
		if (!target || target.validity !== "DISPUTED" || target.lifecycle !== "ACTIVE") {
			throw new Error("FACT resolution target must remain an active disputed Claim");
		}
		const relation = readAllRelations(this.config).find((item) => item.id === request.relationId);
		if (!relation) throw new Error(`Resolution Relation not found: ${request.relationId}`);
		if (relation.type !== "SUPERSEDES" && relation.type !== "CONTRADICTS") {
			throw new Error("FACT resolution requires SUPERSEDES or CONTRADICTS");
		}
		const targetId = proposal.targetClaimId;
		if (relation.type === "SUPERSEDES" && relation.to !== targetId) {
			throw new Error("SUPERSEDES resolution must point from the new Claim to the disputed Claim");
		}
		if (relation.from !== targetId && relation.to !== targetId) {
			throw new Error("Resolution Relation must include the disputed Claim endpoint");
		}
		const evidenceClaimId =
			relation.from === targetId ? String(relation.to) : String(relation.from);
		const evidenceClaim = claimById.get(evidenceClaimId);
		if (!evidenceClaim || !isMaterialFact(evidenceClaim)) {
			throw new Error("The opposite endpoint must be an active FACT backed by material evidence");
		}
		const activeNodeIds = new Set([
			...claims
				.filter((claim) => claim.lifecycle === "ACTIVE" && claim.publicationState === "CANONICAL")
				.map((claim) => claim.id),
			...readAllConcepts(this.config).map((concept) => concept.id),
		]);
		const gate = inspectRelationGate(relation, activeNodeIds);
		if (!gate.accepted) throw new Error(`Resolution Relation failed audit gate: ${gate.reason}`);
		return { proposal, relation };
	}

	private recoverCommittedOperation(
		record: FactResolutionRecord,
	): ResolveFactCorrectionResponse | null {
		const publications = readSourcePublications(this.config).filter(
			(publication) => publication.evolutionOperationId === record.operationId,
		);
		if (publications.length === 0) return null;
		const snapshotIds = new Set(
			publications.flatMap((publication) =>
				publication.evolutionSnapshotId ? [publication.evolutionSnapshotId] : [],
			),
		);
		const completedVersions = new Set(
			publications.flatMap((publication) =>
				publication.evolutionKnowledgeVersion ? [publication.evolutionKnowledgeVersion] : [],
			),
		);
		if (snapshotIds.size !== 1 || completedVersions.size !== 1) {
			throw new Error("Cannot recover FACT resolution: inconsistent evolution snapshots");
		}
		const relation = readAllRelations(this.config).find((item) => item.id === record.relationId);
		if (!relation) throw new Error("Cannot recover FACT resolution: Relation is missing");
		const completedVersion = [...completedVersions][0];
		const rebuiltWikiModuleIds = [
			...new Set(
				publications.flatMap((publication) => publication.evolutionRebuiltWikiModuleIds ?? []),
			),
		];
		const result = resultFromEvolution(
			record.proposalId,
			relation,
			record.expectedKnowledgeVersion,
			completedVersion,
			[...snapshotIds][0],
			rebuiltWikiModuleIds,
		);
		writeRecord(this.config, {
			...record,
			state: "COMPLETED",
			updatedAt: new Date().toISOString(),
			result,
		});
		return { ...result, idempotentReplay: true, recoveredAfterCrash: true };
	}
}

function normalizeResolveRequest(request: ResolveFactCorrectionRequest) {
	const proposalId = request.proposalId.trim();
	const relationId = request.relationId.trim();
	const expectedKnowledgeVersion = request.expectedKnowledgeVersion.trim();
	const idempotencyKey = request.idempotencyKey.trim();
	if (!proposalId || !relationId || !expectedKnowledgeVersion || !idempotencyKey) {
		throw new Error(
			"proposalId, relationId, expectedKnowledgeVersion and idempotencyKey are required",
		);
	}
	if (idempotencyKey.length > 200) throw new Error("idempotencyKey must be at most 200 characters");
	return { proposalId, relationId, expectedKnowledgeVersion, idempotencyKey };
}

function isMaterialFact(claim: Claim): boolean {
	return (
		claim.claimKind === "FACT" &&
		claim.lifecycle === "ACTIVE" &&
		claim.publicationState === "CANONICAL" &&
		claim.supportingEvidenceRefs.some(
			(reference) => reference.type === "SourceSpan" || reference.type === "ExperimentRecord",
		)
	);
}

function resultFromEvolution(
	proposalId: string,
	relation: Relation,
	beforeKnowledgeVersion: string,
	afterKnowledgeVersion: string,
	rollbackSnapshotId: string,
	rebuiltWikiModuleIds: string[],
): Omit<ResolveFactCorrectionResponse, "idempotentReplay" | "recoveredAfterCrash"> {
	return {
		proposalId,
		relationId: relation.id,
		outcome: relation.type === "SUPERSEDES" ? "SUPERSEDED" : "CONFLICT_RECORDED",
		beforeKnowledgeVersion,
		afterKnowledgeVersion,
		rollbackSnapshotId,
		rollbackConfirmation: factRollbackConfirmation(proposalId, rollbackSnapshotId),
		rebuiltWikiModuleIds: [...rebuiltWikiModuleIds].sort(),
	};
}

function factRollbackConfirmation(proposalId: string, snapshotId: string): string {
	return `ROLLBACK_FACT:${proposalId}:${snapshotId}`;
}

function recordPath(config: AppConfig, idempotencyKey: string): string {
	return join(
		config.projectRoot,
		"assertions",
		"fact-resolutions",
		`${stableHash(idempotencyKey)}.json`,
	);
}

function readRecord(config: AppConfig, idempotencyKey: string): FactResolutionRecord | null {
	const path = recordPath(config, idempotencyKey);
	if (!existsSync(path)) return null;
	return JSON.parse(readFileSync(path, "utf-8")) as FactResolutionRecord;
}

function writeRecord(config: AppConfig, record: FactResolutionRecord): void {
	writeJsonAtomic(recordPath(config, record.idempotencyKey), record);
}

function stableHash(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
