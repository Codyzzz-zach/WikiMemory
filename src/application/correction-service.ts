import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { AppConfig } from "../config/types.js";
import {
	createKnowledgeSnapshot,
	currentKnowledgeVersion,
	restoreKnowledgeSnapshot,
} from "../evolution/version-store.js";
import { withRuntimeWriteLease } from "../infrastructure/runtime-write-lock.js";
import { checkClaimStructure } from "../linter/index.js";
import {
	publishCorrectionPublication,
	readAllClaims,
	readAllSpans,
	readAllWikiModules,
	readCorrectionPublications,
	upsertWikiModules,
	writeJsonAtomic,
} from "../linter/storage.js";
import type { AssertedRecord, Claim, ClaimKind, Scope } from "../types/index.js";
import { rebuildWikiModulesAfterEvolution } from "../wiki/materialization.js";

export type CorrectionProposalState =
	| "COMMIT_READY"
	| "DISPUTE_READY"
	| "NEEDS_EVIDENCE"
	| "COMMITTED";

export interface CorrectionIdentity {
	principalId: string;
	projectRoles: Record<string, string>;
}

export interface ProposeCorrectionRequest {
	statement: string;
	claimKind: ClaimKind;
	scope: Scope;
	authorityBasis: string;
	rationale?: string;
	targetClaimId?: string;
	idempotencyKey: string;
	/** Private parser provenance; strict Transport schemas prevent callers from supplying it. */
	parserContext?: {
		naturalInputHash: string;
		model: string;
		finishReason: string | null;
		totalTokens: number | null;
	};
}

export interface CorrectionProposal {
	schemaVersion: "wge-correction-proposal/v1";
	proposalId: string;
	idempotencyKey: string;
	requestHash: string;
	createdAt: string;
	updatedAt: string;
	actor: string;
	statement: string;
	claimKind: ClaimKind;
	scope: Scope;
	authorityBasis: string;
	rationale: string | null;
	targetClaimId: string | null;
	state: CorrectionProposalState;
	risk: "SCOPED_AUTHORITY" | "WORLD_FACT_UNVERIFIED";
	requiredEvidence: string[];
	impact: {
		willCreateClaim: boolean;
		willSupersedeClaimId: string | null;
		willDisputeClaimId: string | null;
		willInvalidateDerivedViews: boolean;
	};
	committedAt: string | null;
	commitKnowledgeVersion: string | null;
	rollbackSnapshotId: string | null;
	commitIdempotencyKey: string | null;
	parserContext: ProposeCorrectionRequest["parserContext"] | null;
}

export type CorrectionProposalResponse = Omit<
	CorrectionProposal,
	"idempotencyKey" | "requestHash" | "commitIdempotencyKey" | "parserContext"
>;

export interface CommitCorrectionRequest {
	proposalId: string;
	expectedKnowledgeVersion: string;
	idempotencyKey: string;
	classificationConfirmation?: string;
}

export interface CommitCorrectionResponse {
	proposalId: string;
	claimId: string | null;
	disputedClaimId: string | null;
	beforeKnowledgeVersion: string;
	afterKnowledgeVersion: string;
	rollbackSnapshotId: string;
	rollbackConfirmation: string;
	rebuiltWikiModuleIds: string[];
	idempotentReplay: boolean;
}

export interface RollbackCorrectionRequest {
	proposalId: string;
	expectedKnowledgeVersion: string;
	confirmation: string;
}

export interface RollbackCorrectionResponse {
	proposalId: string;
	rolledBackFromKnowledgeVersion: string;
	restoredKnowledgeVersion: string;
	rollbackSnapshotId: string;
}

/** Typed correction boundary. It never treats a human assertion as evidence for a world FACT. */
export class CorrectionApplicationService {
	constructor(
		private readonly config: AppConfig,
		private readonly identity: CorrectionIdentity,
	) {
		if (!identity.principalId.trim()) throw new Error("Correction identity requires principalId");
	}

	propose(request: ProposeCorrectionRequest): CorrectionProposalResponse {
		const normalized = normalizeProposal(request);
		this.authorize(normalized.claimKind, normalized.scope, normalized.authorityBasis);
		const requestHash = stableHash(normalized);
		return withRuntimeWriteLease(
			this.config,
			`propose-correction:${normalized.idempotencyKey}`,
			() => {
				const existing = this.readProposals().find(
					(proposal) => proposal.idempotencyKey === normalized.idempotencyKey,
				);
				if (existing) {
					if (existing.requestHash !== requestHash) {
						throw new Error("idempotencyKey was already used for a different correction proposal");
					}
					return publicProposal(existing);
				}
				const target = normalized.targetClaimId
					? readAllClaims(this.config).find((claim) => claim.id === normalized.targetClaimId)
					: undefined;
				if (normalized.targetClaimId && !target) {
					throw new Error(`Target Claim not found: ${normalized.targetClaimId}`);
				}
				if (target && !sameScope(target.scope, normalized.scope)) {
					throw new Error("Correction scope must match the target Claim scope");
				}
				if (target && target.claimKind !== normalized.claimKind) {
					throw new Error("Correction kind must match the target Claim kind");
				}
				if (target && target.lifecycle !== "ACTIVE") {
					throw new Error("Correction target must be an ACTIVE Claim");
				}
				const timestamp = new Date().toISOString();
				const isFact = normalized.claimKind === "FACT";
				const canDisputeFact = isFact && target !== undefined;
				const proposal: CorrectionProposal = {
					schemaVersion: "wge-correction-proposal/v1",
					proposalId: `proposal:${randomUUID()}`,
					idempotencyKey: normalized.idempotencyKey,
					requestHash,
					createdAt: timestamp,
					updatedAt: timestamp,
					actor: this.identity.principalId,
					statement: normalized.statement,
					claimKind: normalized.claimKind,
					scope: normalized.scope,
					authorityBasis: normalized.authorityBasis,
					rationale: normalized.rationale,
					targetClaimId: normalized.targetClaimId,
					state: canDisputeFact ? "DISPUTE_READY" : isFact ? "NEEDS_EVIDENCE" : "COMMIT_READY",
					risk: isFact ? "WORLD_FACT_UNVERIFIED" : "SCOPED_AUTHORITY",
					requiredEvidence: isFact
						? ["SourceSpan or ExperimentRecord supporting the corrected world fact"]
						: [],
					impact: {
						willCreateClaim: !isFact,
						willSupersedeClaimId: !isFact ? normalized.targetClaimId : null,
						willDisputeClaimId: canDisputeFact ? normalized.targetClaimId : null,
						willInvalidateDerivedViews: normalized.targetClaimId !== null,
					},
					committedAt: null,
					commitKnowledgeVersion: null,
					rollbackSnapshotId: null,
					commitIdempotencyKey: null,
					parserContext: normalized.parserContext,
				};
				this.writeProposal(proposal);
				return publicProposal(proposal);
			},
		);
	}

	commit(request: CommitCorrectionRequest): CommitCorrectionResponse {
		const proposalId = request.proposalId.trim();
		const expectedKnowledgeVersion = request.expectedKnowledgeVersion.trim();
		const idempotencyKey = request.idempotencyKey.trim();
		if (!proposalId || !expectedKnowledgeVersion || !idempotencyKey) {
			throw new Error("proposalId, expectedKnowledgeVersion and idempotencyKey are required");
		}
		return withRuntimeWriteLease(this.config, `commit-correction:${proposalId}`, () => {
			const proposal = this.getProposal(proposalId);
			if (!proposal) throw new Error(`Correction proposal not found: ${proposalId}`);
			if (proposal.actor !== this.identity.principalId)
				throw new Error("Only the proposal actor may commit");
			this.authorize(proposal.claimKind, proposal.scope, proposal.authorityBasis);
			const existingPublication = readCorrectionPublications(this.config).find(
				(item) => item.proposalId === proposalId,
			);
			if (existingPublication) {
				if (existingPublication.commitIdempotencyKey !== idempotencyKey) {
					throw new Error(
						"Correction proposal was already committed with a different idempotencyKey",
					);
				}
				const isCompletePublication = Boolean(existingPublication.committedKnowledgeVersion);
				const rebuiltWikiModuleIds = isCompletePublication
					? [...(existingPublication.rebuiltWikiModuleIds ?? [])].sort()
					: this.rebuildCorrectionWikiViews(existingPublication);
				const afterKnowledgeVersion =
					existingPublication.committedKnowledgeVersion ??
					proposal.commitKnowledgeVersion ??
					currentKnowledgeVersion(this.config);
				if (proposal.state !== "COMMITTED") {
					this.writeProposal({
						...proposal,
						state: "COMMITTED",
						updatedAt: existingPublication.committedAt,
						committedAt: existingPublication.committedAt,
						commitKnowledgeVersion: existingPublication.committedKnowledgeVersion ?? null,
						rollbackSnapshotId: existingPublication.rollbackSnapshotId,
						commitIdempotencyKey: idempotencyKey,
					});
				}
				return {
					proposalId,
					claimId: existingPublication.claim?.id ?? null,
					disputedClaimId: existingPublication.disputedClaimId ?? null,
					beforeKnowledgeVersion: existingPublication.beforeKnowledgeVersion,
					afterKnowledgeVersion,
					rollbackSnapshotId: existingPublication.rollbackSnapshotId,
					rollbackConfirmation: rollbackConfirmation(
						proposalId,
						existingPublication.rollbackSnapshotId,
					),
					rebuiltWikiModuleIds,
					idempotentReplay: true,
				};
			}
			if (proposal.state !== "COMMIT_READY" && proposal.state !== "DISPUTE_READY") {
				throw new Error(`Correction proposal is not commit-ready: ${proposal.state}`);
			}
			if (
				proposal.parserContext &&
				request.classificationConfirmation !== `CONFIRM:${proposal.claimKind}`
			) {
				throw new Error(
					`Parsed correction requires classificationConfirmation=CONFIRM:${proposal.claimKind}`,
				);
			}
			const beforeKnowledgeVersion = currentKnowledgeVersion(this.config);
			if (beforeKnowledgeVersion !== expectedKnowledgeVersion) {
				throw new Error(
					`Knowledge state changed: expected=${expectedKnowledgeVersion}, actual=${beforeKnowledgeVersion}`,
				);
			}
			const committedAt = new Date().toISOString();
			const isFactDispute = proposal.state === "DISPUTE_READY";
			const claimId = isFactDispute
				? null
				: `claim:asserted-${stableHash({ proposalId, statement: proposal.statement }).slice(0, 24)}`;
			const disputedClaimId = isFactDispute ? proposal.targetClaimId : null;
			if (isFactDispute && !disputedClaimId) {
				throw new Error("A FACT dispute requires a target Claim");
			}
			const assertionId = `assert:${stableHash({ proposalId, actor: proposal.actor }).slice(0, 24)}`;
			const record: AssertedRecord = {
				assertionId,
				claimId: claimId ?? disputedClaimId ?? "",
				assertedBy: proposal.actor,
				assertedAt: committedAt,
				scope: proposal.scope,
				authorityBasis: proposal.authorityBasis,
				assertionText: proposal.statement,
				...(proposal.rationale ? { rationale: proposal.rationale } : {}),
			};
			const claim: Claim | null = isFactDispute
				? null
				: {
						id: claimId ?? "",
						statement: proposal.statement,
						evidenceSpanIds: [],
						conditions: [],
						derivation: "HUMAN_ASSERTED",
						validity: "SUPPORTED",
						lifecycle: "ACTIVE",
						publicationState: "CANONICAL",
						validFrom: committedAt,
						validTo: null,
						compilerVersion: "correction-application/v1",
						confidence: 1,
						claimKind: proposal.claimKind,
						scope: proposal.scope,
						provenanceRefs: [{ type: "AssertedRecord", assertionId }],
						supportingEvidenceRefs: [{ type: "AssertedRecord", assertionId }],
						knowledgeVersion: beforeKnowledgeVersion,
						recordedAt: committedAt,
					};
			if (claim) {
				const issues = checkClaimStructure(claim, readAllSpans(this.config), [record]);
				if (issues.some((issue) => issue.severity === "error")) {
					throw new Error(`Correction Claim failed structural gate: ${JSON.stringify(issues)}`);
				}
			}
			const snapshot = createKnowledgeSnapshot(this.config, `before correction ${proposalId}`);
			try {
				const affectedWikiModules = proposal.targetClaimId
					? readAllWikiModules(this.config).filter((module) =>
							module.claimRefs.map(String).includes(proposal.targetClaimId ?? ""),
						)
					: [];
				const publication = {
					schemaVersion: "wge-correction-publication/v1",
					proposalId,
					commitIdempotencyKey: idempotencyKey,
					committedAt,
					beforeKnowledgeVersion,
					rollbackSnapshotId: snapshot.id,
					assertedRecord: record,
					claim,
					replacedClaimId: isFactDispute ? null : proposal.targetClaimId,
					disputedClaimId,
					rebuiltWikiModuleIds: affectedWikiModules.map((module) => module.id).sort(),
				} as const;
				publishCorrectionPublication(this.config, publication);
				const rebuiltWikiModules = rebuildWikiModulesAfterEvolution(
					affectedWikiModules,
					readAllClaims(this.config),
					[],
					readAllSpans(this.config),
					{
						sourceKnowledgeVersion: currentKnowledgeVersion(this.config),
						rebuiltFromSnapshotId: snapshot.id,
						updatedAt: committedAt,
					},
				);
				upsertWikiModules(this.config, rebuiltWikiModules);
				const afterKnowledgeVersion = currentKnowledgeVersion(this.config);
				if (afterKnowledgeVersion === beforeKnowledgeVersion) {
					throw new Error("Correction commit did not change knowledgeVersion");
				}
				publishCorrectionPublication(this.config, {
					...publication,
					committedKnowledgeVersion: afterKnowledgeVersion,
				});
				if (currentKnowledgeVersion(this.config) !== afterKnowledgeVersion) {
					throw new Error("Writing the correction recovery receipt changed knowledgeVersion");
				}
				this.writeProposal({
					...proposal,
					state: "COMMITTED",
					updatedAt: committedAt,
					committedAt,
					commitKnowledgeVersion: afterKnowledgeVersion,
					rollbackSnapshotId: snapshot.id,
					commitIdempotencyKey: idempotencyKey,
				});
				return {
					proposalId,
					claimId,
					disputedClaimId,
					beforeKnowledgeVersion,
					afterKnowledgeVersion,
					rollbackSnapshotId: snapshot.id,
					rollbackConfirmation: rollbackConfirmation(proposalId, snapshot.id),
					rebuiltWikiModuleIds: rebuiltWikiModules.map((module) => module.id).sort(),
					idempotentReplay: false,
				};
			} catch (error) {
				const changedVersion = currentKnowledgeVersion(this.config);
				if (changedVersion !== beforeKnowledgeVersion) {
					restoreKnowledgeSnapshot(this.config, snapshot.id, changedVersion);
				}
				throw error;
			}
		});
	}

	rollback(request: RollbackCorrectionRequest): RollbackCorrectionResponse {
		const proposalId = request.proposalId.trim();
		const expectedKnowledgeVersion = request.expectedKnowledgeVersion.trim();
		const confirmation = request.confirmation.trim();
		if (!proposalId || !expectedKnowledgeVersion || !confirmation) {
			throw new Error("proposalId, expectedKnowledgeVersion and confirmation are required");
		}
		return withRuntimeWriteLease(this.config, `rollback-correction:${proposalId}`, () => {
			const proposal = this.getProposal(proposalId);
			if (!proposal) throw new Error(`Correction proposal not found: ${proposalId}`);
			if (proposal.actor !== this.identity.principalId) {
				throw new Error("Only the proposal actor may roll back its correction");
			}
			if (proposal.state !== "COMMITTED" || !proposal.rollbackSnapshotId) {
				throw new Error("Correction proposal has no committed state to roll back");
			}
			const expectedConfirmation = rollbackConfirmation(proposalId, proposal.rollbackSnapshotId);
			if (confirmation !== expectedConfirmation) {
				throw new Error("Correction rollback confirmation does not match the committed proposal");
			}
			const actualVersion = currentKnowledgeVersion(this.config);
			if (actualVersion !== expectedKnowledgeVersion) {
				throw new Error(
					`Knowledge state changed: expected=${expectedKnowledgeVersion}, actual=${actualVersion}`,
				);
			}
			if (proposal.commitKnowledgeVersion !== actualVersion) {
				throw new Error(
					"Correction has later knowledge changes; direct snapshot rollback is unsafe. Create a compensating correction instead.",
				);
			}
			const snapshot = restoreKnowledgeSnapshot(
				this.config,
				proposal.rollbackSnapshotId,
				expectedKnowledgeVersion,
			);
			return {
				proposalId,
				rolledBackFromKnowledgeVersion: expectedKnowledgeVersion,
				restoredKnowledgeVersion: currentKnowledgeVersion(this.config),
				rollbackSnapshotId: snapshot.id,
			};
		});
	}

	getProposal(proposalId: string): CorrectionProposal | null {
		return this.readProposals().find((proposal) => proposal.proposalId === proposalId) ?? null;
	}

	findProposalByIdempotencyKey(idempotencyKey: string): CorrectionProposal | null {
		const normalized = idempotencyKey.trim();
		if (!normalized) return null;
		return this.readProposals().find((proposal) => proposal.idempotencyKey === normalized) ?? null;
	}

	private readProposals(): CorrectionProposal[] {
		const root = proposalRoot(this.config);
		if (!existsSync(root)) return [];
		return readdirSync(root)
			.filter((file) => file.endsWith(".json"))
			.map((file) => JSON.parse(readFileSync(join(root, file), "utf-8")) as CorrectionProposal);
	}

	private writeProposal(proposal: CorrectionProposal): void {
		writeJsonAtomic(
			join(proposalRoot(this.config), `${safeId(proposal.proposalId)}.json`),
			proposal,
		);
	}

	private rebuildCorrectionWikiViews(
		publication: ReturnType<typeof readCorrectionPublications>[number],
	): string[] {
		const affectedIds = new Set(publication.rebuiltWikiModuleIds ?? []);
		if (affectedIds.size === 0) return [];
		const affectedWikiModules = readAllWikiModules(this.config).filter((module) =>
			affectedIds.has(module.id),
		);
		if (affectedWikiModules.length !== affectedIds.size) {
			throw new Error("Correction recovery cannot resolve every affected WikiModule");
		}
		const rebuilt = rebuildWikiModulesAfterEvolution(
			affectedWikiModules,
			readAllClaims(this.config),
			[],
			readAllSpans(this.config),
			{
				sourceKnowledgeVersion: currentKnowledgeVersion(this.config),
				rebuiltFromSnapshotId: publication.rollbackSnapshotId,
				updatedAt: publication.committedAt,
			},
		);
		upsertWikiModules(this.config, rebuilt);
		return rebuilt.map((module) => module.id).sort();
	}

	private authorize(claimKind: ClaimKind, scope: Scope, authorityBasis: string): void {
		if (!authorityBasis.trim()) throw new Error("authorityBasis must not be empty");
		if (claimKind === "PREFERENCE") {
			if (scope.type !== "PERSONAL" || scope.id !== this.identity.principalId) {
				throw new Error("PREFERENCE requires the actor's PERSONAL scope");
			}
			return;
		}
		if (claimKind === "DECISION") {
			if (scope.type !== "PROJECT" || !scope.id) throw new Error("DECISION requires PROJECT scope");
			const role = this.identity.projectRoles[scope.id];
			if (!role) throw new Error(`Actor has no role for project: ${scope.id}`);
			if (authorityBasis !== `role:${role}`) {
				throw new Error(`authorityBasis must match configured project role: role:${role}`);
			}
			return;
		}
		if (scope.type !== "GLOBAL" && scope.id !== this.identity.principalId) {
			throw new Error("FACT proposal scope is not visible to the actor");
		}
	}
}

function normalizeProposal(request: ProposeCorrectionRequest) {
	const statement = request.statement.trim();
	const authorityBasis = request.authorityBasis.trim();
	const idempotencyKey = request.idempotencyKey.trim();
	if (!statement) throw new Error("statement must not be empty");
	if (!authorityBasis) throw new Error("authorityBasis must not be empty");
	if (!idempotencyKey || idempotencyKey.length > 200) {
		throw new Error("idempotencyKey must be 1-200 characters");
	}
	return {
		statement,
		claimKind: request.claimKind,
		scope: request.scope,
		authorityBasis,
		rationale: request.rationale?.trim() || null,
		targetClaimId: request.targetClaimId?.trim() || null,
		idempotencyKey,
		parserContext: request.parserContext ?? null,
	};
}

function proposalRoot(config: AppConfig): string {
	return join(config.projectRoot, "assertions", "correction-proposals");
}

function stableHash(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function safeId(id: string): string {
	return createHash("sha256").update(id).digest("hex");
}

function sameScope(left: Scope, right: Scope): boolean {
	return left.type === right.type && left.id === right.id;
}

function publicProposal(proposal: CorrectionProposal): CorrectionProposalResponse {
	const { idempotencyKey, requestHash, commitIdempotencyKey, parserContext, ...response } =
		proposal;
	void idempotencyKey;
	void requestHash;
	void commitIdempotencyKey;
	void parserContext;
	return response;
}

function rollbackConfirmation(proposalId: string, snapshotId: string): string {
	return `ROLLBACK:${proposalId}:${snapshotId}`;
}
