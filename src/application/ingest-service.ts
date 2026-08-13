import { join } from "node:path";
import { compileCrossMaterialRelations, compileSource } from "../compiler/index.js";
import type { CompileRunHandle } from "../compiler/run-state.js";
import {
	beginCompileRun,
	finishCompileRun,
	getCompileState,
	getLatestCompileEvent,
	recordCompileStage,
} from "../compiler/run-state.js";
import type { AppConfig } from "../config/types.js";
import { createLLMProvider } from "../core/llm-provider.js";
import type { LLMProvider } from "../core/llm-provider.js";
import { ingestFile } from "../ingestor/index.js";
import type { IngestResult } from "../ingestor/index.js";
import {
	type CompileLintResult,
	lintCompileResult,
	lintRelationsAgainstCanonicalClaims,
} from "../linter/index.js";
import {
	appendJsonl,
	publishCrossMaterialRelations,
	publishSourceResult,
	readAllClaims,
	readAllConcepts,
	readAllSources,
	readAllSpans,
	readSourcePublications,
} from "../linter/storage.js";
import type { SourcePublication } from "../linter/storage.js";
import { recordRelationFunnelEvent } from "../observability/relation-funnel.js";
import { evaluatePublicationGate, writePublicationDiffReport } from "../publication-gate/index.js";
import { compactAuditedRelations } from "../relations/post-audit-compaction.js";
import { routeSupportCandidates } from "../relations/support-router.js";
import type { Source } from "../types/index.js";
import type {
	BackfillRelationsRequest,
	BackfillRelationsResponse,
	CompileIngestedSourceRequest,
	CrossMaterialSummary,
	IngestMaterialRequest,
	IngestMaterialResponse,
	IngestProgressEvent,
} from "./contracts.js";

export interface IngestApplicationOptions {
	providerFactory?: (config: AppConfig) => LLMProvider;
	onProgress?: (event: IngestProgressEvent) => void;
}

/** Complete ingest orchestration shared by CLI now and MCP/HTTP later. */
export class IngestApplicationService {
	private readonly providerFactory: (config: AppConfig) => LLMProvider;
	private readonly onProgress: (event: IngestProgressEvent) => void;

	constructor(
		private readonly config: AppConfig,
		options: IngestApplicationOptions = {},
	) {
		this.providerFactory = options.providerFactory ?? createLLMProvider;
		this.onProgress = options.onProgress ?? (() => undefined);
	}

	async ingestMaterial(request: IngestMaterialRequest): Promise<IngestMaterialResponse> {
		const filePath = request.filePath.trim();
		if (filePath.length === 0) throw new Error("filePath must not be empty");
		this.progress("INGEST", `Ingesting ${filePath}`);
		const ingestResult = ingestFile(this.config, filePath);
		this.progress("INGEST", "Evidence ingested", {
			sourceId: ingestResult.source.id,
			blocks: ingestResult.spans.length,
			duplicate: ingestResult.isDuplicate,
		});
		return this.compileEvidence(request, ingestResult);
	}

	async compileIngestedSource(
		request: CompileIngestedSourceRequest,
	): Promise<IngestMaterialResponse> {
		const sourceId = request.sourceId.trim();
		if (sourceId.length === 0) throw new Error("sourceId must not be empty");
		const source = readAllSources(this.config).find((item) => item.id === sourceId);
		if (!source) throw new Error(`Source not found: ${sourceId}`);
		const spans = readAllSpans(this.config).filter((span) => span.sourceId === sourceId);
		if (spans.length === 0) throw new Error(`Source has no persisted spans: ${sourceId}`);
		return this.compileEvidence(request, { source, spans, isDuplicate: true });
	}

	private async compileEvidence(
		request: CompileIngestedSourceRequest | IngestMaterialRequest,
		ingestResult: IngestResult,
	): Promise<IngestMaterialResponse> {
		if (!this.config.apiKey) {
			throw new Error("DEEPSEEK_API_KEY not set. Copy .env.example to .env.");
		}
		const semantic = request.semantic ?? true;
		const provider = this.providerFactory(this.config);

		const compileState = getCompileState(this.config, ingestResult.source.id);
		if (compileState === "COMPLETED" && !request.recompile) {
			return {
				runId: null,
				sourceId: ingestResult.source.id,
				duplicate: ingestResult.isDuplicate,
				skipped: true,
				compileState,
				summary: {},
			};
		}

		const run = beginCompileRun(this.config, ingestResult.source.id, this.config.model);
		const relationOnlyResume =
			ingestResult.isDuplicate && !request.recompile && compileState === "RELATION_SCAN_PENDING";
		let localPublished = relationOnlyResume;
		let localSummary: Record<string, unknown> = {
			resumedFromPublishedStage1: relationOnlyResume,
		};
		try {
			if (relationOnlyResume && !semantic) {
				finishCompileRun(
					this.config,
					run,
					"RELATION_SCAN_PENDING",
					"CROSS_MATERIAL_RELATION_LINT",
					"跨材料 Relation 必须经过语义门禁；semantic=false 不能完成阶段 2",
				);
				return {
					runId: run.runId,
					sourceId: ingestResult.source.id,
					duplicate: ingestResult.isDuplicate,
					skipped: false,
					compileState: "RELATION_SCAN_PENDING",
					summary: localSummary,
				};
			}

			if (!relationOnlyResume) {
				this.progress("COMPILE", "Compiling source", { runId: run.runId });
				const compileResult = await compileSource(
					this.config,
					ingestResult.source,
					ingestResult.spans,
					provider,
					{ run, existingConcepts: readAllConcepts(this.config) },
				);
				this.progress("COMPILE", "Source compilation finished", {
					claims: compileResult.claims.length,
					concepts: compileResult.concepts.length,
					relations: compileResult.relations.length,
					compileStats: compileResult.compileStats,
				});

				recordCompileStage(this.config, run, "LINT");
				this.progress("LINT", "Linting claims and relations");
				const allSpans = readAllSpans(this.config);
				const lintResult: CompileLintResult = await lintCompileResult(
					this.config,
					compileResult.claims,
					compileResult.relations,
					compileResult.concepts,
					allSpans,
					semantic ? provider : null,
					{ skipSemantic: !semantic, run },
				);
				this.progress("LINT", "Lint finished", {
					canonicalClaims: lintResult.canonicalClaims.length,
					canonicalRelations: lintResult.canonicalRelations.length,
					quarantinedClaims: lintResult.quarantinedClaims.length,
					quarantinedRelations: lintResult.quarantinedRelations.length,
				});

				const publishedAt = new Date().toISOString();
				const candidatePublication: SourcePublication = {
					schemaVersion: "v1",
					sourceId: ingestResult.source.id,
					runId: run.runId,
					publishedAt,
					claims: lintResult.canonicalClaims,
					concepts: compileResult.concepts,
					relations: lintResult.canonicalRelations,
				};
				const candidateQuarantine = {
					schemaVersion: "v1" as const,
					sourceId: ingestResult.source.id,
					runId: run.runId,
					publishedAt,
					claims: lintResult.quarantinedClaims,
					relations: lintResult.quarantinedRelations,
				};
				recordCompileStage(this.config, run, "PUBLICATION_GATE");
				const baselinePublication =
					readSourcePublications(this.config).find(
						(entry) => entry.sourceId === ingestResult.source.id,
					) ?? null;
				const publicationDiff = evaluatePublicationGate({
					config: this.config,
					runId: run.runId,
					source: ingestResult.source,
					baseline: baselinePublication,
					candidate: candidatePublication,
					quarantine: candidateQuarantine,
					allSpans,
					allCanonicalClaims: readAllClaims(this.config),
					acceptReview: request.acceptPublicationDiff,
				});
				const publicationDiffPath = writePublicationDiffReport(this.config, publicationDiff);
				this.progress("PUBLICATION_GATE", `Publication gate ${publicationDiff.status}`, {
					publicationDiffPath,
				});
				if (publicationDiff.status !== "PASS") {
					throw new Error(
						`Publication gate ${publicationDiff.status}; canonical 未被覆盖。详见 ${publicationDiffPath}`,
					);
				}

				recordCompileStage(this.config, run, "PUBLISH");
				publishSourceResult(this.config, candidatePublication, candidateQuarantine);
				localPublished = true;
				localSummary = {
					propositions: compileResult.propositions.length,
					claims: compileResult.claims.length,
					concepts: compileResult.concepts.length,
					relations: compileResult.relations.length,
					canonicalClaims: lintResult.canonicalClaims.length,
					canonicalRelations: lintResult.canonicalRelations.length,
					quarantinedClaims: lintResult.quarantinedClaims.length,
					quarantinedRelations: lintResult.quarantinedRelations.length,
					publicationGate: publicationDiff.status,
					publicationDiffPath,
				};
				this.progress("PUBLISH", "Stage 1 publication committed", localSummary);
				if (!semantic) {
					finishCompileRun(this.config, run, "COMPILE_PARTIAL", "PUBLISH");
					return {
						runId: run.runId,
						sourceId: ingestResult.source.id,
						duplicate: ingestResult.isDuplicate,
						skipped: false,
						compileState: "COMPILE_PARTIAL",
						summary: localSummary,
					};
				}
			}

			const publication = readSourcePublications(this.config).find(
				(entry) => entry.sourceId === ingestResult.source.id,
			);
			if (!publication) throw new Error("阶段 1 发布后无法读取 Source publication");
			this.progress("CROSS_MATERIAL", "Running cross-material relation stage");
			const crossSummary = await this.runCrossMaterialStage(
				provider,
				run,
				ingestResult.source,
				publication,
			);
			finishCompileRun(this.config, run, "COMPLETED", "COMPLETE");
			const summary = { ...localSummary, ...crossSummary };
			this.progress("COMPLETE", "Ingest completed", summary);
			return {
				runId: run.runId,
				sourceId: ingestResult.source.id,
				duplicate: ingestResult.isDuplicate,
				skipped: false,
				compileState: "COMPLETED",
				summary,
			};
		} catch (error) {
			try {
				const latest = getLatestCompileEvent(this.config, ingestResult.source.id);
				finishCompileRun(
					this.config,
					run,
					localPublished ? "RELATION_SCAN_PENDING" : "COMPILE_FAILED",
					latest?.runId === run.runId ? latest.stage : "COMPLETE",
					error instanceof Error ? error.message : String(error),
				);
			} catch (stateError) {
				throw new AggregateError(
					[error, stateError],
					"Ingest failed and compile failure state could not be recorded",
				);
			}
			throw error;
		}
	}

	async backfillRelations(
		request: BackfillRelationsRequest = {},
	): Promise<BackfillRelationsResponse> {
		if (!this.config.apiKey) {
			throw new Error("DEEPSEEK_API_KEY not set. Copy .env.example to .env.");
		}
		const provider = this.providerFactory(this.config);
		const sources = readAllSources(this.config);
		const publications = readSourcePublications(this.config);
		const targets = publications.filter(
			(publication) => !request.sourceId || publication.sourceId === request.sourceId,
		);
		if (targets.length === 0) {
			throw new Error(`没有匹配的已发布 Source: ${request.sourceId ?? "<all>"}`);
		}
		const items: BackfillRelationsResponse["items"] = [];
		for (const publication of targets) {
			const source = sources.find((item) => item.id === publication.sourceId);
			if (!source) throw new Error(`找不到不可变 Source: ${publication.sourceId}`);
			const state = getCompileState(this.config, source.id);
			if (state !== "RELATION_SCAN_PENDING" && state !== "COMPLETED") {
				throw new Error(
					`Source ${source.id} 当前为 ${state}，缺少当前版本的单材料 Relation 审计；请先重新编译 ${source.uri}`,
				);
			}
			const run = beginCompileRun(this.config, source.id, this.config.model);
			try {
				const summary = await this.runCrossMaterialStage(provider, run, source, publication);
				finishCompileRun(this.config, run, "COMPLETED", "COMPLETE");
				items.push({ sourceId: source.id, runId: run.runId, summary });
			} catch (error) {
				const latest = getLatestCompileEvent(this.config, source.id);
				finishCompileRun(
					this.config,
					run,
					"RELATION_SCAN_PENDING",
					latest?.runId === run.runId ? latest.stage : "CROSS_MATERIAL_RELATION_DETECTION",
					error instanceof Error ? error.message : String(error),
				);
				throw error;
			}
		}
		return { items };
	}

	private async runCrossMaterialStage(
		provider: LLMProvider,
		run: CompileRunHandle,
		source: Source,
		publication: SourcePublication,
	): Promise<CrossMaterialSummary> {
		recordCompileStage(this.config, run, "CROSS_MATERIAL_RELATION_DETECTION");
		const allClaims = readAllClaims(this.config);
		const newClaimIds = new Set(publication.claims.map((claim) => claim.id));
		const existingClaims = allClaims.filter((claim) => !newClaimIds.has(claim.id));
		const crossCompile = await compileCrossMaterialRelations(
			this.config,
			provider,
			run.runId,
			source,
			publication.claims,
			publication.concepts,
			existingClaims,
			readAllSources(this.config).filter((item) => item.id !== source.id),
		);

		recordCompileStage(this.config, run, "CROSS_MATERIAL_RELATION_LINT");
		const claimsById = new Map(allClaims.map((claim) => [claim.id, claim]));
		const supportRouteInputs = crossCompile.relations.flatMap((relation) => {
			if (relation.type !== "SUPPORTS") return [];
			const fromClaim = claimsById.get(relation.from as string);
			const toClaim = claimsById.get(relation.to as string);
			return fromClaim && toClaim ? [{ relation, fromClaim, toClaim }] : [];
		});
		const supportRouting = await routeSupportCandidates(
			this.config,
			supportRouteInputs,
			provider,
			run,
		);
		const routedSupportIds = new Set(supportRouteInputs.map((input) => input.relation.id));
		const fullAuditSupportIds = new Set(supportRouting.fullAudit.map((relation) => relation.id));
		const fullAuditRelations = crossCompile.relations.filter(
			(relation) =>
				relation.type !== "SUPPORTS" ||
				!routedSupportIds.has(relation.id) ||
				fullAuditSupportIds.has(relation.id),
		);
		if (
			crossCompile.relations.length !==
			fullAuditRelations.length + supportRouting.deferred.length
		) {
			throw new Error(
				`Cross Relation type-router accounting mismatch: selected=${crossCompile.relations.length}, fullAudit=${fullAuditRelations.length}, deferred=${supportRouting.deferred.length}`,
			);
		}
		const routedAt = new Date().toISOString();
		if (supportRouting.decisions.length > 0) {
			appendJsonl(
				join(this.config.runsDir, "relation-candidate-ledger.jsonl"),
				supportRouting.decisions.map((decision) => ({
					schemaVersion: "wge-relation-preaudit-router-ledger/v1",
					runId: run.runId,
					sourceId: source.id,
					relation: decision.relation,
					lifecycleStage: "PRE_AUDIT_TYPE_ROUTING",
					selectionState: decision.decision,
					failureModes: decision.failureModes,
					decisionSource: decision.decisionSource,
					error: decision.error ?? null,
					createdAt: routedAt,
				})),
			);
		}
		recordRelationFunnelEvent(this.config, {
			stage: "TYPE_ROUTING",
			runId: run.runId,
			sourceId: source.id,
			payload: {
				selectedBeforeRouterCount: crossCompile.relations.length,
				supportCandidateCount: supportRouteInputs.length,
				unresolvedSupportEndpointCount:
					crossCompile.relations.filter((relation) => relation.type === "SUPPORTS").length -
					supportRouteInputs.length,
				fullAuditCount: fullAuditRelations.length,
				deferredByTypeRouterCount: supportRouting.deferred.length,
				decisions: supportRouting.decisions.map((decision) => ({
					relationId: decision.relation.id,
					selectionState: decision.decision,
					failureModes: decision.failureModes,
					decisionSource: decision.decisionSource,
					error: decision.error ?? null,
				})),
			},
		});
		const crossLint = await lintRelationsAgainstCanonicalClaims(
			this.config,
			fullAuditRelations,
			allClaims,
			readAllSpans(this.config),
			provider,
			{ run },
		);
		const auditedPassedCrossRelations = crossLint
			.filter((result) => result.finalState === "CANONICAL")
			.map((result) => result.object);
		const quarantinedCrossRelations = crossLint
			.filter((result) => result.finalState === "QUARANTINED")
			.map((result) => ({ relation: result.object, issues: result.issues }));
		recordRelationFunnelEvent(this.config, {
			stage: "LINT",
			runId: run.runId,
			sourceId: source.id,
			payload: {
				results: crossLint.map((result) => ({
					relationId: result.object.id,
					type: result.object.type,
					finalState: result.finalState,
					conditionStatus: result.object.conditionStatus,
					issueCodes: result.issues.map((issue) => issue.code),
					issueSeverities: result.issues.map((issue) => issue.severity),
				})),
			},
		});
		if (
			fullAuditRelations.length !==
			auditedPassedCrossRelations.length + quarantinedCrossRelations.length
		) {
			throw new Error(
				`Cross Relation audit accounting mismatch: selected=${fullAuditRelations.length}, passed=${auditedPassedCrossRelations.length}, quarantined=${quarantinedCrossRelations.length}`,
			);
		}

		const postAuditCompaction = compactAuditedRelations(
			auditedPassedCrossRelations,
			newClaimIds,
			new Map(allClaims.map((claim) => [claim.id, claim.statement])),
		);
		if (
			auditedPassedCrossRelations.length !==
			postAuditCompaction.canonical.length + postAuditCompaction.deferred.length
		) {
			throw new Error(
				`Cross Relation compaction accounting mismatch: passed=${auditedPassedCrossRelations.length}, canonical=${postAuditCompaction.canonical.length}, deferred=${postAuditCompaction.deferred.length}`,
			);
		}
		const compactedAt = new Date().toISOString();
		if (postAuditCompaction.decisions.length > 0) {
			appendJsonl(
				join(this.config.runsDir, "relation-candidate-ledger.jsonl"),
				postAuditCompaction.decisions.map((decision) => ({
					schemaVersion: "wge-relation-post-audit-ledger/v1",
					runId: run.runId,
					sourceId: source.id,
					relation: decision.relation,
					lifecycleStage: "POST_AUDIT_COMPACTION",
					selectionState: decision.state,
					selectionReason: decision.reason,
					newSourceEndpointId: decision.newSourceEndpointId,
					createdAt: compactedAt,
				})),
			);
		}
		recordRelationFunnelEvent(this.config, {
			stage: "COMPACTION",
			runId: run.runId,
			sourceId: source.id,
			payload: {
				auditedPassedCount: auditedPassedCrossRelations.length,
				canonicalReadyCount: postAuditCompaction.canonical.length,
				deferredByGraphDiversityCount: postAuditCompaction.deferred.length,
				decisions: postAuditCompaction.decisions.map((decision) => ({
					relationId: decision.relation.id,
					type: decision.relation.type,
					selectionState: decision.state,
					selectionReason: decision.reason,
					newSourceEndpointId: decision.newSourceEndpointId,
				})),
			},
		});
		const canonicalCrossRelations = postAuditCompaction.canonical;

		recordCompileStage(this.config, run, "CROSS_MATERIAL_RELATION_PUBLISH");
		publishCrossMaterialRelations(
			this.config,
			source.id,
			run.runId,
			canonicalCrossRelations,
			quarantinedCrossRelations,
		);
		recordRelationFunnelEvent(this.config, {
			stage: "PUBLISH",
			runId: run.runId,
			sourceId: source.id,
			payload: {
				candidateClaimCount: crossCompile.candidateClaimIds.length,
				proposedRelationCount: crossCompile.relations.length,
				generatedRelationCount: crossCompile.generatedRelationCount,
				deferredByAuditBudgetCount: crossCompile.deferredRelationCount,
				deferredByTypeRouterCount: supportRouting.deferred.length,
				deferredByGraphDiversityCount: postAuditCompaction.deferred.length,
				canonicalRelationIds: canonicalCrossRelations.map((relation) => relation.id),
				quarantinedRelationIds: quarantinedCrossRelations.map(({ relation }) => relation.id),
			},
		});
		return {
			crossMaterialCandidates: crossCompile.candidateClaimIds.length,
			generatedCrossRelations: crossCompile.generatedRelationCount,
			selectedCrossRelationsBeforeTypeRouter: crossCompile.relations.length,
			selectedCrossRelationsForAudit: fullAuditRelations.length,
			deferredCrossRelations: crossCompile.deferredRelationCount,
			deferredCrossRelationsByTypeRouter: supportRouting.deferred.length,
			deferredCrossRelationsByGraphDiversity: postAuditCompaction.deferred.length,
			canonicalCrossRelations: canonicalCrossRelations.length,
			quarantinedCrossRelations: quarantinedCrossRelations.length,
		};
	}

	private progress(
		stage: IngestProgressEvent["stage"],
		message: string,
		details?: Record<string, unknown>,
	): void {
		this.onProgress({ stage, message, ...(details ? { details } : {}) });
	}
}
