import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { afterEach, describe, expect, it } from "vitest";
import { initializeRuntime } from "../../application/runtime.js";
import { beginCompileRun, finishCompileRun } from "../../compiler/run-state.js";
import { loadConfig } from "../../config/index.js";
import { ingestLoadedDocument } from "../../ingestor/index.js";
import { publishSourceResult } from "../../linter/storage.js";
import type { Claim } from "../../types/index.js";

const roots: string[] = [];
const clients: Client[] = [];

afterEach(async () => {
	for (const client of clients.splice(0)) await client.close();
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("WikiMemory MCP stdio", () => {
	it("defaults to read-only tools and returns Application payloads over a real protocol process", async () => {
		const { client } = await connect("read");
		const tools = await client.listTools();

		expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
			"get_ingest_status",
			"query_context",
			"trace_knowledge",
		]);
		const result = await client.callTool({ name: "get_ingest_status", arguments: {} });
		expect(result.isError).not.toBe(true);
		expect(result.structuredContent).toEqual(
			expect.objectContaining({ sources: [], jobs: [], lastHealthyVersion: expect.any(String) }),
		);
	});

	it("registers ingest only with explicit capability and persists an asynchronous job", async () => {
		const { client } = await connect("read,ingest");
		const tools = await client.listTools();
		expect(tools.tools.map((tool) => tool.name)).toContain("ingest_material");

		const submitted = await client.callTool({
			name: "ingest_material",
			arguments: {
				sourceKey: "stdio-e2e",
				title: "Stdio E2E",
				content: "# Evidence\n\nThe MCP transport persists evidence before compilation.",
				idempotencyKey: "stdio-e2e-1",
			},
		});
		expect(submitted.isError).not.toBe(true);
		expect(submitted.structuredContent).toEqual(
			expect.objectContaining({ sourceId: expect.stringMatching(/^source:/), state: "PENDING" }),
		);
		const status = await client.callTool({ name: "get_ingest_status", arguments: {} });
		expect(status.structuredContent).toEqual(
			expect.objectContaining({ jobs: [expect.objectContaining({ state: "PENDING" })] }),
		);
	});

	it("queries and traces the same canonical knowledge across the stdio process boundary", async () => {
		const { client, root } = await connect("read");
		const claim = seedCanonical(root);

		const queried = await client.callTool({
			name: "query_context",
			arguments: { task: "What does the durable protocol boundary preserve?", budgetTokens: 1200 },
		});
		expect(queried.isError).not.toBe(true);
		expect(queried.structuredContent).toEqual(
			expect.objectContaining({
				traceId: expect.any(String),
				knowledgeVersion: expect.stringMatching(/^kv:/),
				requestedBudgetTokens: 1200,
				serializedContextTokens: expect.any(Number),
				contextPack: expect.objectContaining({
					schemaVersion: "wge-context-pack-compact/v1",
					claimTable: expect.objectContaining({
						rows: [expect.arrayContaining([claim.id])],
					}),
				}),
			}),
		);

		const traced = await client.callTool({
			name: "trace_knowledge",
			arguments: { objectId: claim.id },
		});
		expect(traced.structuredContent).toEqual(
			expect.objectContaining({
				objectType: "CLAIM",
				claim: expect.objectContaining({ id: claim.id }),
				evidenceSpans: [expect.objectContaining({ text: expect.stringContaining("durable") })],
			}),
		);
	});

	it("does not accept caller-supplied principal identity in tool arguments", async () => {
		const { client } = await connect("read");
		const result = await client.callTool({
			name: "query_context",
			arguments: { task: "identity boundary", scope: { principalId: "impersonated-user" } },
		});
		expect(result.isError).toBe(true);
	});

	it("exposes correction tools only with an injected identity and preserves fact authority limits", async () => {
		const { client } = await connect("read,correct", {
			WGE_MCP_PRINCIPAL_ID: "alice",
			WGE_MCP_PROJECT_ROLES: JSON.stringify({ wiki: "owner" }),
		});
		const tools = await client.listTools();
		expect(tools.tools.map((tool) => tool.name)).toEqual(
			expect.arrayContaining([
				"propose_correction",
				"propose_natural_language_correction",
				"commit_correction",
				"resolve_fact_correction",
				"rollback_correction",
				"rollback_fact_resolution",
			]),
		);
		const fact = await client.callTool({
			name: "propose_correction",
			arguments: {
				statement: "This external-world claim is asserted by a user.",
				claimKind: "FACT",
				scope: { type: "GLOBAL" },
				authorityBasis: "user-report",
				idempotencyKey: "mcp-fact-proposal",
			},
		});
		expect(fact.structuredContent).toEqual(
			expect.objectContaining({ state: "NEEDS_EVIDENCE", risk: "WORLD_FACT_UNVERIFIED" }),
		);

		const preference = await client.callTool({
			name: "propose_correction",
			arguments: {
				statement: "回答时优先使用中文。",
				claimKind: "PREFERENCE",
				scope: { type: "PERSONAL", id: "alice" },
				authorityBasis: "self",
				idempotencyKey: "mcp-preference-proposal",
			},
		});
		const proposalId = stringField(preference.structuredContent, "proposalId");
		expect(preference.structuredContent).not.toHaveProperty("idempotencyKey");
		expect(preference.structuredContent).not.toHaveProperty("requestHash");
		expect(preference.structuredContent).not.toHaveProperty("commitIdempotencyKey");
		const status = await client.callTool({ name: "get_ingest_status", arguments: {} });
		const knowledgeVersion = stringField(status.structuredContent, "lastHealthyVersion");
		const committed = await client.callTool({
			name: "commit_correction",
			arguments: {
				proposalId,
				expectedKnowledgeVersion: knowledgeVersion,
				idempotencyKey: "mcp-preference-commit",
			},
		});
		expect(committed.structuredContent).toEqual(
			expect.objectContaining({
				beforeKnowledgeVersion: knowledgeVersion,
				afterKnowledgeVersion: expect.not.stringMatching(knowledgeVersion),
				rollbackSnapshotId: expect.stringMatching(/^ks-/),
			}),
		);
		const claimId = stringField(committed.structuredContent, "claimId");
		const queried = await client.callTool({
			name: "query_context",
			arguments: { task: "回答语言偏好", budgetTokens: 1200 },
		});
		expect(queried.structuredContent).toEqual(
			expect.objectContaining({
				scopeContext: { principalId: "alice" },
				assertedRecords: [expect.objectContaining({ claimId, assertedBy: "alice" })],
			}),
		);
		const traced = await client.callTool({
			name: "trace_knowledge",
			arguments: { objectId: claimId },
		});
		expect(traced.structuredContent).toEqual(
			expect.objectContaining({
				assertedRecords: [expect.objectContaining({ claimId, assertedBy: "alice" })],
			}),
		);
		const rollback = await client.callTool({
			name: "rollback_correction",
			arguments: {
				proposalId,
				expectedKnowledgeVersion: stringField(committed.structuredContent, "afterKnowledgeVersion"),
				confirmation: stringField(committed.structuredContent, "rollbackConfirmation"),
			},
		});
		expect(rollback.structuredContent).toEqual(
			expect.objectContaining({ restoredKnowledgeVersion: knowledgeVersion }),
		);
	});

	it("records an opt-in Pilot query and outcome over the protocol without persisting raw text", async () => {
		const task = "一个不应原样写入 Pilot 日志的真实问题";
		const answer = "一个不应原样写入 Pilot 日志的回答";
		const { client, root } = await connect("read,pilot", {
			WGE_MCP_PRINCIPAL_ID: "alice",
			WGE_PILOT_HASH_KEY: "stdio-pilot-secret-key",
		});
		const tools = await client.listTools();
		expect(tools.tools.map((tool) => tool.name)).toEqual(
			expect.arrayContaining([
				"query_context",
				"record_pilot_outcome",
				"register_pilot_baseline",
				"get_pilot_status",
				"mark_trusted_checkpoint",
			]),
		);
		const baseline = await client.callTool({
			name: "register_pilot_baseline",
			arguments: { task, budgetTokens: 800, idempotencyKey: "stdio-pilot-baseline" },
		});
		expect(baseline.structuredContent).toEqual(
			expect.objectContaining({
				arm: "BASELINE",
				requestedBudgetTokens: 800,
				contextPolicy: "EXTERNAL_BASELINE_NO_WIKIMEMORY_CONTEXT",
			}),
		);
		const queried = await client.callTool({
			name: "query_context",
			arguments: { task, budgetTokens: 800 },
		});
		const traceId = stringField(queried.structuredContent, "traceId");
		const outcome = await client.callTool({
			name: "record_pilot_outcome",
			arguments: {
				traceId,
				answer,
				outcome: "SUCCESS",
				repeatedExplanation: false,
				correctedErrorRecurrence: false,
				hardFailures: [],
				userAccepted: true,
				idempotencyKey: "stdio-pilot-outcome",
			},
		});
		expect(outcome.structuredContent).toEqual(
			expect.objectContaining({ traceId, outcome: "SUCCESS" }),
		);
		expect(outcome.structuredContent).not.toHaveProperty("idempotencyKey");
		expect(outcome.structuredContent).not.toHaveProperty("requestHash");
		expect(outcome.structuredContent).not.toHaveProperty("answerHmac");
		const status = await client.callTool({ name: "get_pilot_status", arguments: {} });
		expect(status.structuredContent).toEqual(
			expect.objectContaining({
				queries: 2,
				feedbackRecorded: 1,
				userAcceptedCount: 1,
				pairedTasks: 1,
				armCounts: { BASELINE: 1, WIKIMEMORY: 1 },
			}),
		);
		const persisted = readDirectoryText(join(root, "runs", "pilot"));
		expect(persisted).not.toContain(task);
		expect(persisted).not.toContain(answer);
	});
});

async function connect(capabilities: string, extraEnvironment: Record<string, string> = {}) {
	const root = mkdtempSync(join(tmpdir(), "wge-mcp-e2e-"));
	roots.push(root);
	initializeRuntime(loadConfig({ runtimeRoot: root, apiKey: "" }));
	const client = new Client({ name: "wikimemory-test", version: "1.0.0" });
	clients.push(client);
	const transport = new StdioClientTransport({
		command: process.execPath,
		args: ["--import", "tsx", "src/transport/mcp/stdio.ts"],
		cwd: process.cwd(),
		env: {
			...process.env,
			WGE_RUNTIME_ROOT: root,
			WGE_MCP_CAPABILITIES: capabilities,
			...extraEnvironment,
		},
		stderr: "pipe",
	});
	await client.connect(transport);
	return { client, transport, root };
}

function seedCanonical(root: string): Claim {
	const config = loadConfig({ runtimeRoot: root, apiKey: "" });
	const text = "The durable protocol boundary preserves evidence provenance.";
	const ingested = ingestLoadedDocument(config, {
		uri: "memory://protocol-boundary",
		sourceType: "md",
		loaderVersion: "test/v1",
		sourceKey: "protocol-boundary",
		title: "Protocol boundary",
		parsedText: text,
		blocks: [{ blockId: "block-0", kind: "paragraph", charStart: 0, charEnd: text.length, text }],
	});
	const run = beginCompileRun(config, ingested.source.id, "test-model");
	const claim: Claim = {
		id: "claim:protocol-boundary",
		statement: text,
		evidenceSpanIds: [ingested.spans[0]?.id ?? ""],
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
		provenanceRefs: [],
		supportingEvidenceRefs: [],
		knowledgeVersion: "kv:test",
		recordedAt: "2026-08-13T00:00:00.000Z",
	};
	const publishedAt = "2026-08-13T00:00:00.000Z";
	publishSourceResult(
		config,
		{
			schemaVersion: "v1",
			sourceId: ingested.source.id,
			runId: run.runId,
			publishedAt,
			claims: [claim],
			concepts: [],
			relations: [],
		},
		{
			schemaVersion: "v1",
			sourceId: ingested.source.id,
			runId: run.runId,
			publishedAt,
			claims: [],
			relations: [],
		},
	);
	finishCompileRun(config, run, "COMPLETED", "COMPLETE");
	return claim;
}

function stringField(value: unknown, field: string): string {
	if (
		!value ||
		typeof value !== "object" ||
		typeof (value as Record<string, unknown>)[field] !== "string"
	) {
		throw new Error(`Missing string field: ${field}`);
	}
	return (value as Record<string, string>)[field] ?? "";
}

function readDirectoryText(root: string): string {
	if (!existsSync(root)) return "";
	return readdirSync(root, { recursive: true })
		.filter((entry): entry is string => typeof entry === "string" && entry.endsWith(".json"))
		.map((entry) => readFileSync(join(root, entry), "utf-8"))
		.join("\n");
}
