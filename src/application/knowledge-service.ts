import { randomUUID } from "node:crypto";
import {
	type CompileRunEvent,
	getCompileState,
	getLatestCompileEvent,
} from "../compiler/run-state.js";
import { estimateTokens } from "../compiler/telemetry.js";
import type { AppConfig } from "../config/types.js";
import { encodeCompactContextPack } from "../context-pack/compact-transport.js";
import {
	type ContextPackBuildResult,
	buildContextPackWithDiagnostics,
	buildManagedContextPackWithDiagnostics,
	filterClaimsByScope,
} from "../context-pack/index.js";
import { currentCanonicalEvidenceVersion } from "../evolution/version-store.js";
import { inspectRelationGate } from "../graph/index.js";
import {
	readAllAssertedRecords,
	readAllClaims,
	readAllClaimsQuarantined,
	readAllConcepts,
	readAllRelations,
	readAllSources,
	readAllSpans,
	readAllWikiModules,
	resolveSpanById,
} from "../linter/storage.js";
import { RELATION_AUDIT_VERSION } from "../prompts/index.js";
import type {
	AssertedRecord,
	Claim,
	CompileState,
	Concept,
	QuestionEvolutionDecision,
	QuestionFrame,
	Relation,
	Source,
	SourceSpan,
	WikiModule,
} from "../types/index.js";
import { inspectWikiModuleSupport } from "../wiki/materialization.js";
import { readAllQuestionFrames, readQuestionEvolutionDecisions } from "../wiki/question-storage.js";
import type {
	AgentQueryContextResponse,
	AgentStandingInstruction,
	GetIngestStatusRequest,
	GetIngestStatusResponse,
	KnowledgeStatusResponse,
	QueryContextRequest,
	QueryContextResponse,
	SourceCompileStatus,
	TraceKnowledgeRequest,
	TraceKnowledgeResponse,
} from "./contracts.js";

export interface KnowledgeApplicationDependencies {
	queryManaged(config: AppConfig, request: QueryContextRequest): ContextPackBuildResult;
	queryLegacy(config: AppConfig, request: QueryContextRequest): ContextPackBuildResult;
	readClaims(config: AppConfig): Claim[];
	readAssertedRecords(config: AppConfig): AssertedRecord[];
	readQuarantinedClaims(config: AppConfig): Claim[];
	readConcepts(config: AppConfig): Concept[];
	readRelations(config: AppConfig): Relation[];
	readSources(config: AppConfig): Source[];
	readSpans(config: AppConfig): SourceSpan[];
	readWikiModules(config: AppConfig): WikiModule[];
	readQuestionFrames(config: AppConfig): QuestionFrame[];
	readQuestionDecisions(config: AppConfig): QuestionEvolutionDecision[];
	currentCanonicalEvidenceVersion(config: AppConfig): string;
	getCompileState(config: AppConfig, sourceId: string): CompileState;
	getLatestCompileEvent(config: AppConfig, sourceId: string): CompileRunEvent | null;
	observeAgentQuery?(config: AppConfig, task: string, response: AgentQueryContextResponse): void;
}

const defaultDependencies: KnowledgeApplicationDependencies = {
	queryManaged: (config, request) =>
		buildManagedContextPackWithDiagnostics(
			config,
			request.task,
			request.budgetTokens,
			request.maxGraphDepth,
			request.scopeContext,
			{ indexFailurePolicy: request.indexFailurePolicy },
		),
	queryLegacy: (config, request) =>
		buildContextPackWithDiagnostics(
			config,
			request.task,
			request.budgetTokens,
			request.maxGraphDepth,
			request.scopeContext,
			{ knowledgeAccess: "LEGACY" },
		),
	readClaims: readAllClaims,
	readAssertedRecords: readAllAssertedRecords,
	readQuarantinedClaims: readAllClaimsQuarantined,
	readConcepts: readAllConcepts,
	readRelations: readAllRelations,
	readSources: readAllSources,
	readSpans: readAllSpans,
	readWikiModules: readAllWikiModules,
	readQuestionFrames: readAllQuestionFrames,
	readQuestionDecisions: readQuestionEvolutionDecisions,
	currentCanonicalEvidenceVersion,
	getCompileState,
	getLatestCompileEvent,
};

export class KnowledgeApplicationService {
	private readonly dependencies: KnowledgeApplicationDependencies;

	constructor(
		private readonly config: AppConfig,
		dependencies: Partial<KnowledgeApplicationDependencies> = {},
	) {
		this.dependencies = { ...defaultDependencies, ...dependencies };
	}

	queryContext(request: QueryContextRequest): QueryContextResponse {
		const normalized = normalizeQueryRequest(request);
		const result =
			normalized.knowledgeAccess === "LEGACY"
				? this.dependencies.queryLegacy(this.config, normalized)
				: this.dependencies.queryManaged(this.config, normalized);
		return { ...result, traceId: randomUUID() };
	}

	queryAgentContext(request: QueryContextRequest): AgentQueryContextResponse {
		const normalized = normalizeQueryRequest(request);
		const standingInstructions = this.standingInstructions(normalized.scopeContext);
		let packBudget = normalized.budgetTokens;
		for (let attempt = 0; attempt < 5; attempt += 1) {
			const queried = this.queryContext({ ...normalized, budgetTokens: packBudget });
			const contextPack = encodeCompactContextPack(queried.pack);
			const visibleAssertionIds = new Set([
				...queried.pack.subgraph.claims
					.flatMap((claim) => [...claim.provenanceRefs, ...claim.supportingEvidenceRefs])
					.flatMap((reference) =>
						reference.type === "AssertedRecord" ? [reference.assertionId] : [],
					),
				...standingInstructions.flatMap((instruction) => instruction.assertionIds),
			]);
			const assertedRecords = this.dependencies
				.readAssertedRecords(this.config)
				.filter((record) => visibleAssertionIds.has(record.assertionId));
			const serializedContextTokens = estimateTokens(
				JSON.stringify({ contextPack, standingInstructions, assertedRecords }),
			);
			if (serializedContextTokens <= normalized.budgetTokens) {
				const response: AgentQueryContextResponse = {
					traceId: queried.traceId,
					knowledgeVersion: queried.pack.knowledgeVersion,
					scopeContext: normalized.scopeContext ?? null,
					requestedBudgetTokens: normalized.budgetTokens,
					serializedContextTokens,
					contextPack,
					standingInstructions,
					assertedRecords,
				};
				this.dependencies.observeAgentQuery?.(this.config, normalized.task, response);
				return response;
			}
			const overflow = serializedContextTokens - normalized.budgetTokens;
			const reduction = Math.max(overflow + 16, Math.ceil(packBudget * 0.2));
			packBudget = Math.max(1, packBudget - reduction);
		}
		throw new Error(
			`Unable to construct an evidence-closed Agent Context Pack within ${normalized.budgetTokens} tokens`,
		);
	}

	private standingInstructions(
		scopeContext?: QueryContextRequest["scopeContext"],
	): AgentStandingInstruction[] {
		if (!scopeContext) return [];
		return filterClaimsByScope(this.dependencies.readClaims(this.config), scopeContext)
			.filter(
				(claim) =>
					claim.claimKind === "PREFERENCE" &&
					claim.scope.type === "PERSONAL" &&
					claim.scope.id === scopeContext.principalId &&
					claim.publicationState === "CANONICAL" &&
					claim.lifecycle === "ACTIVE",
			)
			.sort((left, right) => right.recordedAt.localeCompare(left.recordedAt))
			.slice(0, 8)
			.map((claim) => ({
				claimId: claim.id,
				statement: claim.statement,
				claimKind: "PREFERENCE",
				scope: claim.scope as { type: "PERSONAL"; id: string },
				assertionIds: [...claim.provenanceRefs, ...claim.supportingEvidenceRefs].flatMap(
					(reference) => (reference.type === "AssertedRecord" ? [reference.assertionId] : []),
				),
				recordedAt: claim.recordedAt,
			}));
	}

	getIngestStatus(request: GetIngestStatusRequest = {}): GetIngestStatusResponse {
		const sources = this.dependencies
			.readSources(this.config)
			.filter((source) => request.sourceId === undefined || source.id === request.sourceId)
			.map((source) => this.sourceStatus(source))
			.sort((left, right) => left.sourceId.localeCompare(right.sourceId));
		return { sources };
	}

	getStatus(): KnowledgeStatusResponse {
		const claims = this.dependencies.readClaims(this.config);
		const quarantinedClaims = this.dependencies.readQuarantinedClaims(this.config);
		const concepts = this.dependencies.readConcepts(this.config);
		const relations = this.dependencies.readRelations(this.config);
		const spans = this.dependencies.readSpans(this.config);
		const sourceStatuses = this.getIngestStatus().sources;
		const canonicalActiveClaims = claims.filter(
			(claim) => claim.publicationState === "CANONICAL" && claim.lifecycle === "ACTIVE",
		);
		const disputedClaims = claims.filter((claim) => claim.validity === "DISPUTED");
		const unresolvedClaims = claims.filter((claim) => claim.validity === "UNRESOLVED");
		const activeNodeIds = new Set([
			...canonicalActiveClaims.map((claim) => claim.id as string),
			...concepts.map((concept) => concept.id as string),
		]);
		const consumableRelations = relations.filter(
			(relation) => inspectRelationGate(relation, activeNodeIds).accepted,
		);
		const incompleteSources = sourceStatuses.filter((source) => !source.isComplete);

		return {
			sourceSpans: spans.length,
			totalClaims: claims.length,
			canonicalActiveClaims: canonicalActiveClaims.length,
			quarantinedClaims: quarantinedClaims.length,
			disputedClaims: disputedClaims.length,
			unresolvedClaims: unresolvedClaims.length,
			totalRelations: relations.length,
			consumableRelations: consumableRelations.length,
			relationAuditVersion: RELATION_AUDIT_VERSION,
			totalSources: sourceStatuses.length,
			completedSources: sourceStatuses.length - incompleteSources.length,
			incompleteSources,
		};
	}

	traceKnowledge(request: TraceKnowledgeRequest): TraceKnowledgeResponse {
		const objectId = request.objectId.trim();
		if (objectId.length === 0) throw new Error("objectId must not be empty");
		if (request.scopeContext?.principalId.trim().length === 0) {
			throw new Error("scopeContext.principalId must not be empty");
		}
		const allClaims = this.dependencies.readClaims(this.config);
		const allSpans = this.dependencies.readSpans(this.config);
		const scopeContext = request.scopeContext ?? { principalId: "__global_only__" };
		const claims = filterClaimsByScope(allClaims, scopeContext).filter(
			(claim) => claim.publicationState === "CANONICAL" && claim.lifecycle === "ACTIVE",
		);
		const visibleNodeIds = new Set([
			...claims.map((claim) => claim.id as string),
			...this.dependencies.readConcepts(this.config).map((concept) => concept.id as string),
		]);
		const relations = this.dependencies
			.readRelations(this.config)
			.filter((relation) => inspectRelationGate(relation, visibleNodeIds).accepted);
		const questionFrames = this.dependencies.readQuestionFrames(this.config).filter((frame) => {
			if (frame.publicationState !== "CANONICAL" || frame.lifecycle !== "ACTIVE") return false;
			if (frame.scope.type === "GLOBAL") return true;
			if (frame.scope.type === "PERSONAL") return frame.scope.id === scopeContext.principalId;
			return Boolean(scopeContext.projectId) && frame.scope.id === scopeContext.projectId;
		});
		const wikiModules = this.dependencies.readWikiModules(this.config).filter(
			(module) =>
				inspectWikiModuleSupport(module, claims, allSpans, {
					relations,
					questionFrames,
				}).consumable,
		);
		const allSources = this.dependencies.readSources(this.config);
		const allAssertedRecords = this.dependencies.readAssertedRecords(this.config);
		const claim = claims.find((item) => item.id === objectId) ?? null;
		const relation = relations.find((item) => item.id === objectId) ?? null;
		const wikiModule = wikiModules.find((item) => item.id === objectId) ?? null;
		const questionFrame =
			questionFrames.find((item) => String(item.id) === objectId) ??
			(wikiModule?.questionRef
				? (questionFrames.find((item) => item.id === wikiModule.questionRef) ?? null)
				: null);
		if (!claim && !relation && !wikiModule && !questionFrame) {
			throw new Error(`Knowledge object not found: ${objectId}`);
		}
		const questionClaimRefs = questionFrame
			? questionFrame.formationSignals.flatMap((signal) => signal.claimRefs.map(String))
			: [];
		const evidenceSpanIds = claim
			? claimEvidenceSpanIds(claim)
			: relation
				? relation.evidenceSpanIds
				: wikiModule
					? wikiModule.claimRefs.flatMap((ref) => {
							const supportingClaim = claims.find((item) => item.id === ref);
							return supportingClaim ? claimEvidenceSpanIds(supportingClaim) : [];
						})
					: questionClaimRefs.flatMap((ref) => {
							const supportingClaim = claims.find((item) => item.id === ref);
							return supportingClaim ? claimEvidenceSpanIds(supportingClaim) : [];
						});
		const evidenceSpans: SourceSpan[] = [];
		const assertedRecordIds = new Set(
			(claim
				? [...claim.provenanceRefs, ...claim.supportingEvidenceRefs]
				: wikiModule
					? wikiModule.claimRefs.flatMap((ref) => {
							const supportingClaim = claims.find((item) => item.id === ref);
							return supportingClaim
								? [...supportingClaim.provenanceRefs, ...supportingClaim.supportingEvidenceRefs]
								: [];
						})
					: questionClaimRefs.flatMap((ref) => {
							const supportingClaim = claims.find((item) => item.id === ref);
							return supportingClaim
								? [...supportingClaim.provenanceRefs, ...supportingClaim.supportingEvidenceRefs]
								: [];
						})
			).flatMap((reference) =>
				reference.type === "AssertedRecord" ? [reference.assertionId] : [],
			),
		);
		const missingEvidenceSpanIds: string[] = [];
		const seen = new Set<string>();
		for (const spanId of evidenceSpanIds) {
			if (seen.has(spanId)) continue;
			seen.add(spanId);
			const span = resolveSpanById(allSpans, spanId);
			if (span) evidenceSpans.push(span);
			else missingEvidenceSpanIds.push(spanId);
		}
		const sourceIds = new Set(evidenceSpans.map((span) => span.sourceId));
		return {
			objectType: claim ? "CLAIM" : relation ? "RELATION" : wikiModule ? "WIKI" : "QUESTION",
			objectId,
			claim,
			relation,
			questionFrame,
			questionEvolutionDecisions: questionFrame
				? this.dependencies
						.readQuestionDecisions(this.config)
						.filter((decision) => decision.questionRefs.includes(questionFrame.id))
				: [],
			wikiModule,
			evidenceSpans,
			assertedRecords: allAssertedRecords.filter((record) =>
				assertedRecordIds.has(record.assertionId),
			),
			sources: allSources
				.filter((source) => sourceIds.has(source.id))
				.map(({ parsedText, ...source }) => source),
			missingEvidenceSpanIds,
		};
	}

	private sourceStatus(source: Source): SourceCompileStatus {
		const latest = this.dependencies.getLatestCompileEvent(this.config, source.id);
		const state = this.dependencies.getCompileState(this.config, source.id);
		return {
			sourceId: source.id,
			uri: source.uri,
			state,
			isComplete: state === "COMPLETED",
			runId: latest?.runId ?? null,
			stage: latest?.stage ?? null,
			updatedAt: latest?.timestamp ?? null,
			error: latest?.error ?? null,
			retryable:
				state === "SOURCE_INGESTED" ||
				state === "COMPILE_FAILED" ||
				state === "COMPILE_PARTIAL" ||
				state === "RELATION_SCAN_PENDING",
		};
	}
}

function claimEvidenceSpanIds(claim: Claim): string[] {
	return [
		...claim.evidenceSpanIds,
		...claim.supportingEvidenceRefs.flatMap((reference) =>
			reference.type === "SourceSpan" ? [reference.spanId] : [],
		),
	];
}

function normalizeQueryRequest(
	request: QueryContextRequest,
): Required<
	Pick<
		QueryContextRequest,
		"task" | "budgetTokens" | "maxGraphDepth" | "knowledgeAccess" | "indexFailurePolicy"
	>
> &
	Pick<QueryContextRequest, "scopeContext"> {
	const task = request.task.trim();
	if (task.length === 0) throw new Error("task must not be empty");
	const budgetTokens = request.budgetTokens ?? 12000;
	if (!Number.isSafeInteger(budgetTokens) || budgetTokens <= 0) {
		throw new Error(`budgetTokens must be a positive safe integer, received: ${budgetTokens}`);
	}
	const maxGraphDepth = request.maxGraphDepth ?? 3;
	if (!Number.isSafeInteger(maxGraphDepth) || maxGraphDepth < 0 || maxGraphDepth > 8) {
		throw new Error(`maxGraphDepth must be an integer between 0 and 8, received: ${maxGraphDepth}`);
	}
	if (request.scopeContext?.principalId.trim().length === 0) {
		throw new Error("scopeContext.principalId must not be empty");
	}
	return {
		task,
		budgetTokens,
		maxGraphDepth,
		knowledgeAccess: request.knowledgeAccess ?? "MANAGED",
		indexFailurePolicy: request.indexFailurePolicy ?? "LEGACY_FALLBACK",
		...(request.scopeContext ? { scopeContext: request.scopeContext } : {}),
	};
}
