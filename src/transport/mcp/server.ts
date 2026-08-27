import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod4";
import {
	CorrectionApplicationService,
	FactCorrectionResolutionApplicationService,
	IngestCoordinatorApplicationService,
	IngestJobApplicationService,
	KnowledgeApplicationService,
	NaturalLanguageCorrectionApplicationService,
	PilotObservationApplicationService,
	assertRuntimeReady,
} from "../../application/index.js";
import { loadConfig } from "../../config/index.js";
import type { AppConfig } from "../../config/types.js";

export type McpCapability = "read" | "ingest" | "correct" | "pilot";

export interface WikiMemoryMcpOptions {
	config?: AppConfig;
	capabilities?: Iterable<McpCapability>;
	maxIngestChars?: number;
	identity?: McpIdentity;
}

export interface McpIdentity {
	principalId: string | null;
	projectRoles: Record<string, string>;
}

const scopeSchema = z.object({ projectId: z.string().trim().min(1).optional() }).strict();

/** Thin MCP adapter: validation/capabilities here, all knowledge behavior in Application services. */
export function createWikiMemoryMcpServer(options: WikiMemoryMcpOptions = {}): McpServer {
	const config = options.config ?? loadConfig();
	assertRuntimeReady(config);
	const capabilities = new Set(options.capabilities ?? capabilitiesFromEnvironment());
	const maxIngestChars = options.maxIngestChars ?? maxIngestCharsFromEnvironment();
	const identity = options.identity ?? identityFromEnvironment();
	const pilotHashKey = process.env.WGE_PILOT_HASH_KEY?.trim() || null;
	const pilotObservation = capabilities.has("pilot")
		? identity.principalId && pilotHashKey
			? new PilotObservationApplicationService(
					config,
					{ principalId: identity.principalId, projectRoles: identity.projectRoles },
					pilotHashKey,
				)
			: null
		: null;
	if (capabilities.has("pilot") && !pilotObservation) {
		throw new Error("pilot capability requires WGE_MCP_PRINCIPAL_ID and WGE_PILOT_HASH_KEY");
	}
	if (capabilities.has("pilot") && !capabilities.has("read")) {
		throw new Error(
			"pilot capability requires read capability so every outcome has a query receipt",
		);
	}
	const knowledge = new KnowledgeApplicationService(config, {
		...(pilotObservation
			? {
					observeAgentQuery: (_config, task, response) =>
						pilotObservation.recordQuery(task, response),
				}
			: {}),
	});
	const ingestStatus = new IngestCoordinatorApplicationService(config);
	const jobs = new IngestJobApplicationService(config);
	const correction = identity.principalId
		? new CorrectionApplicationService(config, {
				principalId: identity.principalId,
				projectRoles: identity.projectRoles,
			})
		: null;
	const naturalLanguageCorrection = identity.principalId
		? new NaturalLanguageCorrectionApplicationService(config, {
				principalId: identity.principalId,
				projectRoles: identity.projectRoles,
			})
		: null;
	const factResolution = identity.principalId
		? new FactCorrectionResolutionApplicationService(config, {
				principalId: identity.principalId,
				projectRoles: identity.projectRoles,
			})
		: null;
	const server = new McpServer(
		{ name: "wikimemory", version: "0.1.0" },
		{ capabilities: { tools: {} } },
	);

	if (capabilities.has("read")) {
		server.registerTool(
			"query_context",
			{
				title: "Query WikiMemory context",
				description: "Retrieve a budgeted, evidence-bearing Context Pack for an Agent task.",
				inputSchema: z.object({
					task: z.string().trim().min(1),
					budgetTokens: z.number().int().positive().max(100_000).optional(),
					maxGraphDepth: z.number().int().min(0).max(8).optional(),
					scope: scopeSchema.optional(),
				}),
				annotations: {
					readOnlyHint: pilotObservation === null,
					destructiveHint: false,
					idempotentHint: pilotObservation === null,
				},
			},
			async ({ task, budgetTokens, maxGraphDepth, scope }) => {
				const queried = knowledge.queryAgentContext({
					task,
					budgetTokens,
					maxGraphDepth,
					...scopeContextFor(identity, scope?.projectId),
				});
				return toolResult(queried);
			},
		);

		server.registerTool(
			"get_ingest_status",
			{
				title: "Get ingest status",
				description: "Inspect durable ingest jobs and compiler stages without mutating knowledge.",
				inputSchema: z.object({
					sourceId: z.string().trim().min(1).optional(),
					jobId: z.string().trim().min(1).optional(),
				}),
				annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
			},
			async (request) => toolResult(ingestStatus.getStatus(request)),
		);

		server.registerTool(
			"trace_knowledge",
			{
				title: "Trace knowledge to evidence",
				description:
					"Trace a visible Claim, audited Relation, or supported WikiModule to SourceSpan evidence.",
				inputSchema: z.object({
					objectId: z.string().trim().min(1),
					scope: scopeSchema.optional(),
				}),
				annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
			},
			async ({ objectId, scope }) =>
				toolResult(
					knowledge.traceKnowledge({
						objectId,
						...scopeContextFor(identity, scope?.projectId),
					}),
				),
		);
	}

	if (capabilities.has("ingest")) {
		server.registerTool(
			"ingest_material",
			{
				title: "Submit material to WikiMemory",
				description:
					"Persist user-supplied Markdown evidence and enqueue an asynchronous compile job.",
				inputSchema: z.object({
					sourceKey: z.string().trim().min(1).max(128),
					title: z.string().trim().min(1).max(500),
					content: z.string().min(1).max(maxIngestChars),
					uri: z.string().trim().min(1).max(2048).optional(),
					metadata: z.record(z.string(), z.string()).optional(),
					domain: z.string().trim().min(1).max(200).optional(),
					idempotencyKey: z.string().trim().min(1).max(200),
					semantic: z.boolean().optional(),
					recompile: z.boolean().optional(),
					acceptPublicationDiff: z.boolean().optional(),
				}),
				annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
			},
			async (request) => toolResult(jobs.submitMaterial(request)),
		);
	}

	if (capabilities.has("correct")) {
		if (!correction || !naturalLanguageCorrection || !factResolution) {
			throw new Error("correct capability requires WGE_MCP_PRINCIPAL_ID");
		}
		const correctionScopeSchema = z
			.discriminatedUnion("type", [
				z.object({ type: z.literal("GLOBAL") }).strict(),
				z.object({ type: z.literal("PERSONAL"), id: z.string().trim().min(1) }).strict(),
				z.object({ type: z.literal("PROJECT"), id: z.string().trim().min(1) }).strict(),
			])
			.describe("Authority scope for the correction");
		server.registerTool(
			"propose_correction",
			{
				title: "Propose a knowledge correction",
				description:
					"Create an auditable correction proposal. World facts remain unverified until material evidence is supplied.",
				inputSchema: z
					.object({
						statement: z.string().trim().min(1).max(10_000),
						claimKind: z.enum(["FACT", "DECISION", "PREFERENCE"]),
						scope: correctionScopeSchema,
						authorityBasis: z.string().trim().min(1).max(500),
						rationale: z.string().trim().min(1).max(10_000).optional(),
						targetClaimId: z.string().trim().min(1).optional(),
						idempotencyKey: z.string().trim().min(1).max(200),
					})
					.strict(),
				annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
			},
			async (request) => toolResult(correction.propose(request)),
		);
		server.registerTool(
			"propose_natural_language_correction",
			{
				title: "Interpret a natural-language correction",
				description:
					"Use the configured model to classify a correction, then apply deterministic scope and authority policy. This only creates a proposal.",
				inputSchema: z
					.object({
						naturalLanguage: z.string().trim().min(1).max(20_000),
						projectId: z.string().trim().min(1).optional(),
						targetClaimId: z.string().trim().min(1).optional(),
						idempotencyKey: z.string().trim().min(1).max(200),
					})
					.strict(),
				annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
			},
			async (request) => toolResult(await naturalLanguageCorrection.propose(request)),
		);
		server.registerTool(
			"commit_correction",
			{
				title: "Commit an approved scoped correction",
				description:
					"Commit a commit-ready correction using optimistic knowledge-version control and create a rollback snapshot.",
				inputSchema: z
					.object({
						proposalId: z.string().trim().min(1),
						expectedKnowledgeVersion: z.string().trim().min(1),
						idempotencyKey: z.string().trim().min(1).max(200),
						classificationConfirmation: z.string().trim().min(1).optional(),
					})
					.strict(),
				annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
			},
			async (request) => toolResult(correction.commit(request)),
		);
		server.registerTool(
			"resolve_fact_correction",
			{
				title: "Resolve a FACT dispute with compiled evidence",
				description:
					"Apply an audited SUPERSEDES or CONTRADICTS Relation between a disputed FACT and a newly compiled evidence-backed FACT.",
				inputSchema: z
					.object({
						proposalId: z.string().trim().min(1),
						relationId: z.string().trim().min(1),
						expectedKnowledgeVersion: z.string().trim().min(1),
						idempotencyKey: z.string().trim().min(1).max(200),
					})
					.strict(),
				annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
			},
			async (request) => toolResult(factResolution.resolve(request)),
		);
		server.registerTool(
			"rollback_correction",
			{
				title: "Roll back one committed correction",
				description:
					"Restore the exact pre-commit snapshot for a correction owned by the configured principal.",
				inputSchema: z
					.object({
						proposalId: z.string().trim().min(1),
						expectedKnowledgeVersion: z.string().trim().min(1),
						confirmation: z.string().trim().min(1),
					})
					.strict(),
				annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
			},
			async (request) => toolResult(correction.rollback(request)),
		);
		server.registerTool(
			"rollback_fact_resolution",
			{
				title: "Roll back one FACT evidence resolution",
				description:
					"Restore the exact pre-resolution snapshot only when no later knowledge change exists.",
				inputSchema: z
					.object({
						proposalId: z.string().trim().min(1),
						idempotencyKey: z.string().trim().min(1).max(200),
						expectedKnowledgeVersion: z.string().trim().min(1),
						confirmation: z.string().trim().min(1),
					})
					.strict(),
				annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
			},
			async (request) => toolResult(factResolution.rollback(request)),
		);
	}

	if (capabilities.has("pilot")) {
		if (!pilotObservation) throw new Error("pilot capability is not initialized");
		const hardFailureSchema = z.enum([
			"UNSUPPORTED_ASSERTION",
			"CORRECTED_ERROR_RECURRENCE",
			"CONFLICT_FLATTENED",
			"CITATION_FAILURE",
			"SCOPE_LEAK",
		]);
		server.registerTool(
			"register_pilot_baseline",
			{
				title: "Register one external Baseline task",
				description:
					"Create a paired Pilot receipt for a file/folder Agent run that receives no WikiMemory Context Pack.",
				inputSchema: z
					.object({
						task: z.string().trim().min(1).max(20_000),
						budgetTokens: z.number().int().positive().max(100_000),
						idempotencyKey: z.string().trim().min(1).max(200),
					})
					.strict(),
				annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
			},
			async (request) => toolResult(pilotObservation.registerBaseline(request)),
		);
		server.registerTool(
			"record_pilot_outcome",
			{
				title: "Record one real Agent task outcome",
				description:
					"Attach immutable outcome signals to a query trace. Raw task and answer text are HMACed, not stored.",
				inputSchema: z
					.object({
						traceId: z.string().trim().min(1),
						answer: z.string().trim().min(1).max(100_000),
						outcome: z.enum(["SUCCESS", "PARTIAL", "FAILURE"]),
						repeatedExplanation: z.boolean(),
						correctedErrorRecurrence: z.boolean(),
						hardFailures: z.array(hardFailureSchema).max(5),
						userAccepted: z.boolean().nullable(),
						idempotencyKey: z.string().trim().min(1).max(200),
					})
					.strict(),
				annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
			},
			async (request) => toolResult(pilotObservation.recordOutcome(request)),
		);
		server.registerTool(
			"get_pilot_status",
			{
				title: "Get longitudinal Pilot status",
				description:
					"Aggregate only the configured principal's recorded query and outcome signals.",
				inputSchema: z.object({}).strict(),
				annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
			},
			async () => toolResult(pilotObservation.getStatus()),
		);
		server.registerTool(
			"mark_trusted_checkpoint",
			{
				title: "Mark a user-trusted Pilot checkpoint",
				description:
					"Record the current knowledge version and Pilot status as a trust marker; this does not mutate knowledge.",
				inputSchema: z.object({ label: z.string().trim().min(1).max(200) }).strict(),
				annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
			},
			async ({ label }) => toolResult(pilotObservation.markTrustedCheckpoint(label)),
		);
	}

	return server;
}

export function capabilitiesFromEnvironment(
	value = process.env.WGE_MCP_CAPABILITIES,
): McpCapability[] {
	const raw = value?.trim() || "read";
	const capabilities = raw
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);
	for (const capability of capabilities) {
		if (
			capability !== "read" &&
			capability !== "ingest" &&
			capability !== "correct" &&
			capability !== "pilot"
		) {
			throw new Error(`Unsupported WGE_MCP_CAPABILITIES value: ${capability}`);
		}
	}
	return [...new Set(capabilities)] as McpCapability[];
}

export function identityFromEnvironment(
	principal = process.env.WGE_MCP_PRINCIPAL_ID,
	projectRolesJson = process.env.WGE_MCP_PROJECT_ROLES,
): McpIdentity {
	const principalId = principal?.trim() || null;
	if (!projectRolesJson?.trim()) return { principalId, projectRoles: {} };
	const parsed: unknown = JSON.parse(projectRolesJson);
	if (!isStringRecord(parsed)) throw new Error("WGE_MCP_PROJECT_ROLES must be a JSON string map");
	if (!principalId && Object.keys(parsed).length > 0) {
		throw new Error("WGE_MCP_PROJECT_ROLES requires WGE_MCP_PRINCIPAL_ID");
	}
	return { principalId, projectRoles: parsed };
}

function maxIngestCharsFromEnvironment(): number {
	const raw = process.env.WGE_MAX_INGEST_CHARS;
	const value = raw === undefined ? 2_000_000 : Number.parseInt(raw, 10);
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new Error(`WGE_MAX_INGEST_CHARS must be a positive safe integer, received: ${raw}`);
	}
	return value;
}

function toolResult(value: object) {
	return {
		content: [{ type: "text" as const, text: JSON.stringify(value) }],
		structuredContent: value as Record<string, unknown>,
	};
}

function scopeContextFor(identity: McpIdentity, projectId?: string) {
	if (!identity.principalId) {
		if (projectId) throw new Error("Project scope requires a configured MCP principal");
		return {};
	}
	if (projectId && !identity.projectRoles[projectId]) {
		throw new Error(`Configured MCP principal has no role for project: ${projectId}`);
	}
	return {
		scopeContext: {
			principalId: identity.principalId,
			...(projectId ? { projectId } : {}),
		},
	};
}

function isStringRecord(value: unknown): value is Record<string, string> {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		Object.values(value).every((item) => typeof item === "string" && item.trim().length > 0)
	);
}
