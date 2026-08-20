import { createHash } from "node:crypto";
import { join } from "node:path";
import type { CompileRunHandle } from "../compiler/run-state.js";
import { recordCompileStage } from "../compiler/run-state.js";
import type { AppConfig } from "../config/types.js";
import type { LLMProvider } from "../core/llm-provider.js";
import {
	createKnowledgeSnapshot,
	currentCanonicalEvidenceVersion,
	currentKnowledgeVersion,
	restoreKnowledgeSnapshot,
} from "../evolution/version-store.js";
import { withRuntimeWriteLease } from "../infrastructure/runtime-write-lock.js";
import {
	appendJsonl,
	readAllClaims,
	readAllConcepts,
	readAllRelations,
	readAllSpans,
	upsertWikiModules,
	writeJsonAtomic,
} from "../linter/storage.js";
import type { SourcePublication } from "../linter/storage.js";
import type { QuestionEvolutionDecision, QuestionFrame, Source } from "../types/index.js";
import {
	inspectWikiModuleSupport,
	materializeQuestionWikiModule,
} from "../wiki/materialization.js";
import { gateQuestionProposals } from "../wiki/question-formation-v2.js";
import { gateQuestionLifecycleProposals } from "../wiki/question-lifecycle.js";
import { questionFrameHash } from "../wiki/question-model.js";
import { proposeQuestionCandidates } from "../wiki/question-proposer.js";
import {
	publishQuestionEvolution,
	readAllQuestionFrames,
	readQuestionState,
} from "../wiki/question-storage.js";
import {
	beginQuestionTransaction,
	finishQuestionTransaction,
	readPendingQuestionTransactions,
} from "../wiki/question-transaction.js";
import type { QuestionMaintenanceSummary } from "./contracts.js";

export interface QuestionMaintenanceInput {
	provider: LLMProvider;
	run: CompileRunHandle;
	source: Source;
	publication: SourcePublication;
	declaredDomain?: string;
}

export interface QuestionMaintenanceDependencies {
	propose?: typeof proposeQuestionCandidates;
	publishQuestions?: typeof publishQuestionEvolution;
	publishWiki?: typeof upsertWikiModules;
	now?: () => Date;
}

/**
 * Maintains QuestionFrame and WikiModule views after canonical evidence publication.
 * A compensating snapshot deliberately starts after evidence publication, so rollback cannot
 * erase the newly accepted Source/Claim/Relation state.
 */
export class QuestionMaintenanceApplicationService {
	private readonly propose: typeof proposeQuestionCandidates;
	private readonly publishQuestions: typeof publishQuestionEvolution;
	private readonly publishWiki: typeof upsertWikiModules;
	private readonly now: () => Date;

	constructor(
		private readonly config: AppConfig,
		dependencies: QuestionMaintenanceDependencies = {},
	) {
		this.propose = dependencies.propose ?? proposeQuestionCandidates;
		this.publishQuestions = dependencies.publishQuestions ?? publishQuestionEvolution;
		this.publishWiki = dependencies.publishWiki ?? upsertWikiModules;
		this.now = dependencies.now ?? (() => new Date());
	}

	async maintain(input: QuestionMaintenanceInput): Promise<QuestionMaintenanceSummary> {
		this.recoverPendingTransactions();
		const declaredDomain = resolveDeclaredQuestionDomain(
			input.declaredDomain,
			input.source.metadata,
		);
		if (!declaredDomain) {
			return emptySummary("SKIPPED", "MISSING_DECLARED_DOMAIN");
		}

		const canonicalEvidenceVersion = currentCanonicalEvidenceVersion(this.config);
		const claims = readAllClaims(this.config);
		const relations = readAllRelations(this.config);
		const concepts = readAllConcepts(this.config);
		const spans = readAllSpans(this.config);
		const beforeQuestionState = readQuestionState(this.config);
		const existingFrames = beforeQuestionState.frames;

		recordCompileStage(this.config, input.run, "QUESTION_PROPOSAL");
		const proposed = await this.propose(this.config, input.provider, {
			run: input.run,
			source: input.source,
			declaredDomain,
			newClaims: input.publication.claims,
			relevantRelations: relations,
			concepts: input.publication.concepts,
			existingFrames,
		});

		recordCompileStage(this.config, input.run, "QUESTION_GATE");
		const formationGated = gateQuestionProposals({
			sourceId: input.source.id,
			knowledgeVersion: canonicalEvidenceVersion,
			declaredDomain,
			proposals: proposed.proposals,
			claims,
			relations,
			concepts,
			spans,
			existingFrames,
			now: this.now().toISOString(),
		});
		const lifecycleGated = gateQuestionLifecycleProposals({
			sourceId: input.source.id,
			knowledgeVersion: canonicalEvidenceVersion,
			proposals: proposed.lifecycleProposals,
			existingFrames: mergeFrames(existingFrames, formationGated.framesToPublish),
			claims,
			relations,
			spans,
			now: this.now().toISOString(),
		});
		const gated: ReturnType<typeof gateQuestionProposals> = {
			schemaVersion: "wge-question-formation-gate/v1",
			framesToPublish: latestFrames([
				...formationGated.framesToPublish,
				...lifecycleGated.framesToPublish,
			]),
			evolutionDecisions: [
				...formationGated.evolutionDecisions,
				...lifecycleGated.evolutionDecisions,
			].sort((left, right) => left.id.localeCompare(right.id)),
			decisions: [...formationGated.decisions, ...lifecycleGated.decisions],
			stats: {
				...formationGated.stats,
				proposed: formationGated.stats.proposed + lifecycleGated.decisions.length,
				accepted:
					formationGated.stats.accepted +
					lifecycleGated.decisions.filter((decision) => decision.accepted).length,
				rejected:
					formationGated.stats.rejected +
					lifecycleGated.decisions.filter((decision) => !decision.accepted).length,
				merged: lifecycleGated.evolutionDecisions.filter((decision) => decision.action === "MERGE")
					.length,
				split: lifecycleGated.evolutionDecisions.filter((decision) => decision.action === "SPLIT")
					.length,
				archived: lifecycleGated.evolutionDecisions.filter(
					(decision) => decision.action === "ARCHIVE",
				).length,
				reopened:
					formationGated.stats.reopened +
					lifecycleGated.evolutionDecisions.filter((decision) => decision.action === "REOPEN")
						.length,
			},
		};
		const mutations = gated.evolutionDecisions.filter(
			(decision) => decision.action !== "NO_CHANGE",
		);
		const mutatedQuestionRefs = new Set(
			mutations.flatMap((decision) => decision.questionRefs.map(String)),
		);
		const framesToPublish = latestFrames(
			gated.framesToPublish.filter((frame) => mutatedQuestionRefs.has(String(frame.id))),
		);

		if (framesToPublish.length === 0) {
			this.writeGateLedger(
				input,
				declaredDomain,
				canonicalEvidenceVersion,
				gated,
				"NO_CHANGE",
				null,
			);
			const reportPath = this.writeMaterialImpactReport(
				input,
				declaredDomain,
				canonicalEvidenceVersion,
				gated,
				[],
				"NO_CHANGE",
				null,
			);
			return summaryFor(
				gated,
				"NO_CHANGE",
				null,
				declaredDomain,
				canonicalEvidenceVersion,
				[],
				[],
				null,
				reportPath,
			);
		}

		const effectiveFrames = mergeFrames(existingFrames, framesToPublish);
		const decisionByQuestion = indexDecisionsByQuestion(mutations);
		recordCompileStage(this.config, input.run, "WIKI_MATERIALIZATION");
		const modules = framesToPublish
			.filter((frame) => frame.lifecycle === "ACTIVE" && frame.publicationState === "CANONICAL")
			.map((frame) =>
				materializeQuestionWikiModule(frame, claims, relations, spans, {
					sourceKnowledgeVersion: canonicalEvidenceVersion,
					rebuiltFromSnapshotId: null,
					updatedAt: this.now().toISOString(),
					questionEvolutionDecisionId: decisionByQuestion.get(String(frame.id))?.id ?? null,
				}),
			);

		recordCompileStage(this.config, input.run, "WIKI_PUBLICATION_GATE");
		for (const module of modules) {
			const inspection = inspectWikiModuleSupport(module, claims, spans, {
				relations,
				questionFrames: effectiveFrames,
				expectedKnowledgeVersion: canonicalEvidenceVersion,
			});
			if (!inspection.consumable) {
				throw new Error(
					`WikiModule V2 publication gate failed: ${module.id}: ${inspection.reasons.join(", ")}`,
				);
			}
		}

		return withRuntimeWriteLease(
			this.config,
			`commit-question-maintenance:${input.run.runId}`,
			() => {
				if (currentCanonicalEvidenceVersion(this.config) !== canonicalEvidenceVersion) {
					throw new Error("Canonical evidence changed during Question proposal; retry required");
				}
				if (readQuestionState(this.config).stateHash !== beforeQuestionState.stateHash) {
					throw new Error("Question state changed during Question proposal; retry required");
				}
				const snapshot = createKnowledgeSnapshot(
					this.config,
					`before question/wiki update for run ${input.run.runId}`,
				);
				const receipt = beginQuestionTransaction(this.config, {
					runId: input.run.runId,
					sourceId: input.source.id,
					canonicalEvidenceVersion,
					beforeQuestionStateHash: beforeQuestionState.stateHash,
					snapshotId: snapshot.id,
					frames: framesToPublish,
					decisions: mutations,
					createdAt: this.now().toISOString(),
				});
				try {
					recordCompileStage(this.config, input.run, "QUESTION_PUBLISH");
					this.publishQuestions(this.config, {
						frames: framesToPublish,
						decisions: mutations,
					});
					this.publishWiki(this.config, modules);
					finishQuestionTransaction(this.config, receipt, "COMPLETED", this.now().toISOString());
					this.writeGateLedger(
						input,
						declaredDomain,
						canonicalEvidenceVersion,
						gated,
						"UPDATED",
						snapshot.id,
					);
					const reportPath = this.writeMaterialImpactReport(
						input,
						declaredDomain,
						canonicalEvidenceVersion,
						gated,
						modules,
						"UPDATED",
						snapshot.id,
					);
					return summaryFor(
						gated,
						"UPDATED",
						null,
						declaredDomain,
						canonicalEvidenceVersion,
						framesToPublish.map((frame) => String(frame.id)),
						modules.map((module) => module.id),
						snapshot.id,
						reportPath,
					);
				} catch (error) {
					try {
						restoreKnowledgeSnapshot(
							this.config,
							snapshot.id,
							currentKnowledgeVersion(this.config),
						);
						finishQuestionTransaction(
							this.config,
							receipt,
							"ROLLED_BACK",
							this.now().toISOString(),
							error instanceof Error ? error.message : String(error),
						);
					} catch (rollbackError) {
						throw new AggregateError(
							[error, rollbackError],
							`Question/Wiki update failed and rollback failed; snapshot=${snapshot.id}`,
						);
					}
					this.writeGateLedger(
						input,
						declaredDomain,
						canonicalEvidenceVersion,
						gated,
						"ROLLED_BACK",
						snapshot.id,
						error,
					);
					throw error;
				}
			},
		);
	}

	/** Replay an interrupted idempotent commit; never restores a global snapshot. */
	recoverPendingTransactions(): string[] {
		return withRuntimeWriteLease(this.config, "recover-question-transactions", () => {
			const recovered: string[] = [];
			for (const receipt of readPendingQuestionTransactions(this.config)) {
				const currentFrames = readAllQuestionFrames(this.config);
				const currentById = new Map(currentFrames.map((frame) => [String(frame.id), frame]));
				for (const frame of receipt.frames) {
					const current = currentById.get(String(frame.id));
					if (
						current &&
						questionFrameHash(current) !== questionFrameHash(frame) &&
						Date.parse(current.updatedAt) > Date.parse(frame.updatedAt)
					) {
						throw new Error(
							`Pending Question transaction conflicts with newer frame: ${receipt.transactionId} -> ${frame.id}`,
						);
					}
				}
				const claims = readAllClaims(this.config);
				const relations = readAllRelations(this.config);
				const spans = readAllSpans(this.config);
				const effectiveFrames = mergeFrames(currentFrames, receipt.frames);
				const evidenceVersion = currentCanonicalEvidenceVersion(this.config);
				const decisionByQuestion = indexDecisionsByQuestion(receipt.decisions);
				const modules = receipt.frames
					.filter((frame) => frame.lifecycle === "ACTIVE" && frame.publicationState === "CANONICAL")
					.map((frame) =>
						materializeQuestionWikiModule(frame, claims, relations, spans, {
							sourceKnowledgeVersion: evidenceVersion,
							rebuiltFromSnapshotId: receipt.snapshotId,
							updatedAt: this.now().toISOString(),
							questionEvolutionDecisionId: decisionByQuestion.get(String(frame.id))?.id ?? null,
						}),
					);
				for (const module of modules) {
					const inspection = inspectWikiModuleSupport(module, claims, spans, {
						relations,
						questionFrames: effectiveFrames,
						expectedKnowledgeVersion: evidenceVersion,
					});
					if (!inspection.consumable) {
						throw new Error(
							`Pending WikiModule recovery gate failed: ${module.id}: ${inspection.reasons.join(", ")}`,
						);
					}
				}
				this.publishQuestions(this.config, {
					frames: receipt.frames,
					decisions: receipt.decisions,
				});
				this.publishWiki(this.config, modules);
				finishQuestionTransaction(this.config, receipt, "COMPLETED", this.now().toISOString());
				recovered.push(receipt.transactionId);
			}
			return recovered;
		});
	}

	private writeGateLedger(
		input: QuestionMaintenanceInput,
		declaredDomain: string,
		canonicalEvidenceVersion: string,
		gated: ReturnType<typeof gateQuestionProposals>,
		outcome: "NO_CHANGE" | "UPDATED" | "ROLLED_BACK",
		rollbackSnapshotId: string | null,
		error?: unknown,
	): void {
		appendJsonl(join(this.config.runsDir, "question-evolution-ledger.jsonl"), [
			{
				schemaVersion: "wge-question-evolution-ledger/v1",
				runId: input.run.runId,
				sourceId: input.source.id,
				declaredDomain,
				canonicalEvidenceVersion,
				outcome,
				rollbackSnapshotId,
				stats: gated.stats,
				proposalDecisions: gated.decisions,
				evolutionDecisions: gated.evolutionDecisions,
				error: error instanceof Error ? error.message : error ? String(error) : null,
				createdAt: this.now().toISOString(),
			},
		]);
	}

	private writeMaterialImpactReport(
		input: QuestionMaintenanceInput,
		declaredDomain: string,
		canonicalEvidenceVersion: string,
		gated: ReturnType<typeof gateQuestionProposals>,
		modules: ReturnType<typeof materializeQuestionWikiModule>[],
		outcome: "NO_CHANGE" | "UPDATED",
		rollbackSnapshotId: string | null,
	): string {
		const safeRunId = createHash("sha256").update(input.run.runId).digest("hex").slice(0, 24);
		const path = join(this.config.runsDir, "material-impact", `${safeRunId}.json`);
		writeJsonAtomic(path, {
			schemaVersion: "wge-material-impact-report/v1",
			runId: input.run.runId,
			sourceId: input.source.id,
			declaredDomain,
			canonicalEvidenceVersion,
			outcome,
			rollbackSnapshotId,
			stats: gated.stats,
			proposalDecisions: gated.decisions,
			questionChanges: gated.evolutionDecisions.map((decision) => ({
				decisionId: decision.id,
				action: decision.action,
				questionRefs: decision.questionRefs,
				affectedClaimRefs: decision.affectedClaimRefs,
				affectedRelationIds: decision.affectedRelationIds,
				beforeHash: decision.beforeHash,
				afterHash: decision.afterHash,
				reasonCodes: decision.reasonCodes,
			})),
			wikiChanges: modules.map((module) => ({
				moduleId: module.id,
				questionRef: module.questionRef ?? null,
				assertionRoles: Object.fromEntries(
					["CURRENT", "CONDITIONAL", "DISPUTE", "UNRESOLVED", "SUPERSEDED"].map((role) => [
						role,
						module.materialization?.assertions.filter((assertion) => assertion.role === role)
							.length ?? 0,
					]),
				),
				conditionalBranchIds: (module.conditionalBranches ?? []).map((branch) => branch.id),
				knownGapIds: (module.knownGaps ?? []).map((gap) => gap.id),
				claimRefs: module.claimRefs,
				relationRefs: module.relationRefs ?? [],
			})),
			createdAt: this.now().toISOString(),
		});
		return path;
	}
}

export function resolveDeclaredQuestionDomain(
	explicitDomain?: string,
	metadata?: Record<string, string>,
): string | null {
	const explicit = explicitDomain?.trim() || null;
	const metadataDomain = metadata?.domain?.trim() || null;
	if (explicit && metadataDomain && explicit !== metadataDomain) {
		throw new Error(
			`Question domain conflict: request=${explicit}, source.metadata.domain=${metadataDomain}`,
		);
	}
	return explicit ?? metadataDomain;
}

function latestFrames(frames: QuestionFrame[]): QuestionFrame[] {
	return [...new Map(frames.map((frame) => [String(frame.id), frame])).values()].sort(
		(left, right) => String(left.id).localeCompare(String(right.id)),
	);
}

function mergeFrames(existing: QuestionFrame[], replacements: QuestionFrame[]): QuestionFrame[] {
	return latestFrames([...existing, ...replacements]);
}

function indexDecisionsByQuestion(
	decisions: QuestionEvolutionDecision[],
): Map<string, QuestionEvolutionDecision> {
	const result = new Map<string, QuestionEvolutionDecision>();
	for (const decision of decisions) {
		for (const ref of decision.questionRefs) result.set(String(ref), decision);
	}
	return result;
}

function emptySummary(
	status: QuestionMaintenanceSummary["status"],
	reason: string,
): QuestionMaintenanceSummary {
	return {
		status,
		reason,
		declaredDomain: null,
		proposedQuestions: 0,
		acceptedQuestions: 0,
		rejectedQuestions: 0,
		createdQuestions: 0,
		updatedQuestions: 0,
		promotedQuestions: 0,
		candidateQuestions: 0,
		mergedQuestions: 0,
		splitQuestions: 0,
		archivedQuestions: 0,
		reopenedQuestions: 0,
		publishedQuestionRefs: [],
		publishedWikiModuleIds: [],
		canonicalEvidenceVersion: null,
		rollbackSnapshotId: null,
		materialImpactReportPath: null,
	};
}

function summaryFor(
	gated: ReturnType<typeof gateQuestionProposals>,
	status: QuestionMaintenanceSummary["status"],
	reason: string | null,
	declaredDomain: string,
	canonicalEvidenceVersion: string,
	publishedQuestionRefs: string[],
	publishedWikiModuleIds: string[],
	rollbackSnapshotId: string | null,
	materialImpactReportPath: string,
): QuestionMaintenanceSummary {
	return {
		status,
		reason,
		declaredDomain,
		proposedQuestions: gated.stats.proposed,
		acceptedQuestions: gated.stats.accepted,
		rejectedQuestions: gated.stats.rejected,
		createdQuestions: gated.stats.created,
		updatedQuestions: gated.stats.updated,
		promotedQuestions: gated.stats.promoted,
		candidateQuestions: gated.stats.candidate,
		mergedQuestions: gated.stats.merged,
		splitQuestions: gated.stats.split,
		archivedQuestions: gated.stats.archived,
		reopenedQuestions: gated.stats.reopened,
		publishedQuestionRefs: [...publishedQuestionRefs].sort(),
		publishedWikiModuleIds: [...publishedWikiModuleIds].sort(),
		canonicalEvidenceVersion,
		rollbackSnapshotId,
		materialImpactReportPath,
	};
}
