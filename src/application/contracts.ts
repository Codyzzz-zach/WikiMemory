import type { CompileStage } from "../compiler/run-state.js";
import type { CompactContextPackTransport } from "../context-pack/compact-transport.js";
import type { ContextPackBuildResult } from "../context-pack/index.js";
import type {
	AssertedRecord,
	Claim,
	CompileState,
	QuestionEvolutionDecision,
	QuestionFrame,
	Relation,
	ScopeContext,
	Source,
	SourceSpan,
	WikiModule,
} from "../types/index.js";

export interface QueryContextRequest {
	task: string;
	budgetTokens?: number;
	maxGraphDepth?: number;
	scopeContext?: ScopeContext;
	knowledgeAccess?: "MANAGED" | "LEGACY";
	indexFailurePolicy?: "LEGACY_FALLBACK" | "FAIL_CLOSED";
}

/** Stable application payload shared by CLI now and MCP/HTTP later. */
export interface QueryContextResponse extends ContextPackBuildResult {
	traceId: string;
}

export interface AgentQueryContextResponse {
	traceId: string;
	knowledgeVersion: string;
	scopeContext: ScopeContext | null;
	requestedBudgetTokens: number;
	serializedContextTokens: number;
	contextPack: CompactContextPackTransport;
	standingInstructions: AgentStandingInstruction[];
	assertedRecords: AssertedRecord[];
}

export interface AgentStandingInstruction {
	claimId: string;
	statement: string;
	claimKind: "PREFERENCE";
	scope: { type: "PERSONAL"; id: string };
	assertionIds: string[];
	recordedAt: string;
}

export interface SourceCompileStatus {
	sourceId: string;
	uri: string;
	state: CompileState;
	isComplete: boolean;
	runId: string | null;
	stage: CompileStage | null;
	updatedAt: string | null;
	error: string | null;
	retryable: boolean;
}

export interface GetIngestStatusRequest {
	sourceId?: string;
}

export interface GetIngestStatusResponse {
	sources: SourceCompileStatus[];
}

export interface IngestMaterialRequest {
	filePath: string;
	/** Human-declared knowledge domain used to bound long-term question formation. */
	domain?: string;
	semantic?: boolean;
	recompile?: boolean;
	acceptPublicationDiff?: boolean;
}

export interface CompileIngestedSourceRequest {
	sourceId: string;
	domain?: string;
	semantic?: boolean;
	recompile?: boolean;
	acceptPublicationDiff?: boolean;
}

export interface SubmitMaterialRequest {
	sourceKey: string;
	title: string;
	content: string;
	uri?: string;
	metadata?: Record<string, string>;
	domain?: string;
	idempotencyKey: string;
	semantic?: boolean;
	recompile?: boolean;
	acceptPublicationDiff?: boolean;
}

export type IngestJobState = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";

export interface IngestJob {
	schemaVersion: "wge-ingest-job/v1";
	jobId: string;
	idempotencyKey: string;
	requestHash: string;
	sourceId: string;
	state: IngestJobState;
	semantic: boolean;
	recompile: boolean;
	acceptPublicationDiff: boolean;
	domain?: string;
	createdAt: string;
	updatedAt: string;
	attempts: number;
	worker: { hostname: string; pid: number } | null;
	result: IngestMaterialResponse | null;
	error: string | null;
}

export interface SubmitMaterialResponse {
	sourceId: string;
	jobId: string | null;
	duplicate: boolean;
	state: IngestJobState | "ALREADY_COMPLETED";
}

export interface RunWorkerOnceResponse {
	processed: boolean;
	job: IngestJob | null;
}

export interface GetIngestOperationalStatusRequest {
	sourceId?: string;
	jobId?: string;
}

export interface GetIngestOperationalStatusResponse {
	sources: SourceCompileStatus[];
	jobs: IngestJobStatus[];
	lastHealthyVersion: string;
}

export interface IngestJobStatus {
	jobId: string;
	sourceId: string;
	state: IngestJobState;
	createdAt: string;
	updatedAt: string;
	attempts: number;
	resultState: CompileState | null;
	error: string | null;
	retryable: boolean;
}

export type IngestProgressStage =
	| "INGEST"
	| "COMPILE"
	| "LINT"
	| "PUBLICATION_GATE"
	| "PUBLISH"
	| "CROSS_MATERIAL"
	| "QUESTION_MAINTENANCE"
	| "COMPLETE";

export interface IngestProgressEvent {
	stage: IngestProgressStage;
	message: string;
	details?: Record<string, unknown>;
}

export interface IngestMaterialResponse {
	runId: string | null;
	sourceId: string;
	duplicate: boolean;
	skipped: boolean;
	compileState: CompileState;
	summary: Record<string, unknown>;
}

export interface BackfillRelationsRequest {
	sourceId?: string;
	domain?: string;
}

export interface BackfillRelationsItem {
	sourceId: string;
	runId: string;
	summary: CrossMaterialSummary;
	questionMaintenance: QuestionMaintenanceSummary;
}

export interface BackfillRelationsResponse {
	items: BackfillRelationsItem[];
}

export interface CrossMaterialSummary {
	crossMaterialCandidates: number;
	generatedCrossRelations: number;
	selectedCrossRelationsBeforeTypeRouter: number;
	selectedCrossRelationsForAudit: number;
	deferredCrossRelations: number;
	deferredCrossRelationsByTypeRouter: number;
	deferredCrossRelationsByGraphDiversity: number;
	canonicalCrossRelations: number;
	quarantinedCrossRelations: number;
}

export interface QuestionMaintenanceSummary {
	status: "SKIPPED" | "NO_CHANGE" | "UPDATED";
	reason: string | null;
	declaredDomain: string | null;
	proposedQuestions: number;
	acceptedQuestions: number;
	rejectedQuestions: number;
	createdQuestions: number;
	updatedQuestions: number;
	promotedQuestions: number;
	candidateQuestions: number;
	mergedQuestions: number;
	splitQuestions: number;
	archivedQuestions: number;
	reopenedQuestions: number;
	publishedQuestionRefs: string[];
	publishedWikiModuleIds: string[];
	canonicalEvidenceVersion: string | null;
	rollbackSnapshotId: string | null;
	materialImpactReportPath: string | null;
}

export interface KnowledgeStatusResponse {
	sourceSpans: number;
	totalClaims: number;
	canonicalActiveClaims: number;
	quarantinedClaims: number;
	disputedClaims: number;
	unresolvedClaims: number;
	totalRelations: number;
	consumableRelations: number;
	relationAuditVersion: string;
	totalSources: number;
	completedSources: number;
	incompleteSources: SourceCompileStatus[];
}

export type TraceKnowledgeObjectType = "CLAIM" | "RELATION" | "QUESTION" | "WIKI";

export interface TraceKnowledgeRequest {
	objectId: string;
	scopeContext?: ScopeContext;
}

export type TraceSourceMetadata = Omit<Source, "parsedText">;

export interface TraceKnowledgeResponse {
	objectType: TraceKnowledgeObjectType;
	objectId: string;
	claim: Claim | null;
	relation: Relation | null;
	questionFrame: QuestionFrame | null;
	questionEvolutionDecisions: QuestionEvolutionDecision[];
	wikiModule: WikiModule | null;
	evidenceSpans: SourceSpan[];
	assertedRecords: AssertedRecord[];
	sources: TraceSourceMetadata[];
	missingEvidenceSpanIds: string[];
}
