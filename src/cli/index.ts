#!/usr/bin/env node

import { resolve } from "node:path";
import { Command } from "commander";
import {
	IngestApplicationService,
	IngestCoordinatorApplicationService,
	IngestJobApplicationService,
	type IngestProgressEvent,
	KnowledgeApplicationService,
	initializeRuntime,
} from "../application/index.js";
import { loadConfig } from "../config/index.js";
import type { AppConfig } from "../config/types.js";
import { applyKnowledgeEvolution } from "../evolution/transaction.js";
import {
	createKnowledgeSnapshot,
	currentKnowledgeVersion,
	restoreKnowledgeSnapshot,
} from "../evolution/version-store.js";
import { quarantineCanonicalRelation } from "../linter/storage.js";

const program = new Command();

program
	.name("wge")
	.description("WGEMemory4LLM — Agent-native knowledge compilation")
	.version("0.1.0")
	.option("--project-root <directory>", "Legacy alias for the knowledge-state root")
	.option(
		"--runtime-root <directory>",
		"Explicit durable knowledge-state root; preferred by Agent and container transports",
	);

function loadCliConfig(): AppConfig {
	const options = program.opts<{ projectRoot?: string; runtimeRoot?: string }>();
	const legacyRoot = options.projectRoot ? resolve(options.projectRoot) : undefined;
	const runtimeRoot = options.runtimeRoot ? resolve(options.runtimeRoot) : legacyRoot;
	return loadConfig({
		...(legacyRoot ? { projectRoot: legacyRoot } : {}),
		...(runtimeRoot ? { runtimeRoot } : {}),
	});
}

program
	.command("init")
	.description("Initialize an explicit durable WikiMemory runtime root")
	.action(() => {
		const config = loadCliConfig();
		const manifest = initializeRuntime(config);
		console.log(
			JSON.stringify(
				{
					runtimeRoot: config.runtimeRoot ?? config.projectRoot,
					...manifest,
				},
				null,
				2,
			),
		);
	});

// ─── ingest 命令 ─────────────────────────────────────────────────

program
	.command("ingest")
	.description("Ingest a Markdown file: parse → compile → lint → canonical/quarantine")
	.argument("<file>", "Path to .md file")
	.option("--no-semantic", "Skip semantic lint (structure only)")
	.option("--recompile", "Recompile and atomically replace an already compiled Source")
	.option(
		"--accept-publication-diff",
		"Acknowledge a REVIEW_REQUIRED recompile diff; hard integrity failures still block",
	)
	.option("--json", "Output JSON result")
	.action(
		async (
			file: string,
			options: {
				semantic: boolean;
				recompile?: boolean;
				acceptPublicationDiff?: boolean;
				json?: boolean;
			},
		) => {
			const config = loadCliConfig();
			const service = new IngestApplicationService(config, {
				onProgress: options.json ? undefined : renderIngestProgress,
			});
			const result = await service.ingestMaterial({
				filePath: file,
				semantic: options.semantic,
				recompile: options.recompile,
				acceptPublicationDiff: options.acceptPublicationDiff,
			});
			if (options.json) console.log(JSON.stringify(result, null, 2));
			else console.error(`✅ Ingest state: ${result.compileState}`);
		},
	);

function renderIngestProgress(event: IngestProgressEvent): void {
	console.error(`[${event.stage}] ${event.message}`);
	if (event.details) console.error(`   ${JSON.stringify(event.details)}`);
}

const relationsCommand = program
	.command("relations")
	.description("Cross-material relation maintenance");
relationsCommand
	.command("quarantine")
	.description("Move a canonical Relation to quarantine after human review")
	.argument("<relationId>", "Canonical rel:... ID")
	.requiredOption("--reason <text>", "Human-readable rejection reason")
	.action((relationId: string, options: { reason: string }) => {
		const config = loadCliConfig();
		quarantineCanonicalRelation(config, relationId, options.reason);
		console.log(`✅ Relation quarantined: ${relationId}`);
	});
relationsCommand
	.command("backfill")
	.description("Run/re-run stage-2 cross-material relation detection")
	.argument("[sourceId]", "Optional source:... ID; defaults to every published Source")
	.option("--json", "Output JSON result")
	.action(async (sourceId: string | undefined, options: { json?: boolean }) => {
		const config = loadCliConfig();
		const result = await new IngestApplicationService(config, {
			onProgress: options.json ? undefined : renderIngestProgress,
		}).backfillRelations({ ...(sourceId ? { sourceId } : {}) });
		if (options.json) console.log(JSON.stringify(result, null, 2));
		else
			for (const item of result.items)
				console.error(
					`✅ ${item.sourceId}: ${item.summary.canonicalCrossRelations} cross-material relations`,
				);
	});

// ─── versions 命令 ───────────────────────────────────────────────

const versionsCommand = program.command("versions").description("Knowledge snapshot and rollback");
versionsCommand
	.command("snapshot")
	.description("Create a verifiable snapshot of all mutable derived knowledge")
	.argument("[label]", "Human-readable snapshot label", "manual snapshot")
	.action((label: string) => {
		const snapshot = createKnowledgeSnapshot(loadCliConfig(), label);
		console.log(
			JSON.stringify(
				{
					id: snapshot.id,
					label: snapshot.label,
					knowledgeVersion: snapshot.knowledgeVersion,
					files: snapshot.files.length,
					filesHash: snapshot.filesHash,
				},
				null,
				2,
			),
		);
	});
versionsCommand
	.command("restore")
	.description("Restore a snapshot with an optimistic current-version guard")
	.argument("<snapshotId>", "ks-... snapshot ID")
	.requiredOption(
		"--expect-current <knowledgeVersion>",
		"Current kv:... observed by the caller; prevents overwriting concurrent changes",
	)
	.action((snapshotId: string, options: { expectCurrent: string }) => {
		const config = loadCliConfig();
		const restored = restoreKnowledgeSnapshot(config, snapshotId, options.expectCurrent);
		console.log(
			JSON.stringify(
				{
					restored: restored.id,
					knowledgeVersion: currentKnowledgeVersion(config),
					automaticBackupCreated: true,
				},
				null,
				2,
			),
		);
	});

// ─── evolution 命令 ──────────────────────────────────────────────

const evolutionCommand = program
	.command("evolution")
	.description("Apply audited correction relations as a rollback-protected transaction");
evolutionCommand
	.command("apply")
	.description("Apply audited SUPERSEDES/CONTRADICTS relations to canonical knowledge")
	.argument("<relationIds...>", "One or more audited rel:... IDs")
	.requiredOption(
		"--expect-current <knowledgeVersion>",
		"Current kv:... observed by the caller; prevents overwriting concurrent changes",
	)
	.action((relationIds: string[], options: { expectCurrent: string }) => {
		const result = applyKnowledgeEvolution(loadCliConfig(), relationIds, options.expectCurrent);
		console.log(JSON.stringify(result, null, 2));
	});

// ─── query 命令 ──────────────────────────────────────────────────

program
	.command("trace")
	.description("Trace a visible Claim, audited Relation or supported WikiModule to evidence")
	.argument("<objectId>", "claim:..., rel:... or wiki:... ID")
	.option("--user <id>", "Principal ID for PERSONAL scope visibility")
	.option("--project <id>", "Project ID for PROJECT scope visibility")
	.action((objectId: string, options: { user?: string; project?: string }) => {
		const scopeContext = options.user
			? { principalId: options.user, projectId: options.project }
			: undefined;
		const traced = new KnowledgeApplicationService(loadCliConfig()).traceKnowledge({
			objectId,
			...(scopeContext ? { scopeContext } : {}),
		});
		console.log(JSON.stringify(traced, null, 2));
	});

program
	.command("query")
	.description("Query knowledge state and build a Context Pack")
	.argument("<task>", "Task description")
	.option("--budget <tokens>", "Context budget in tokens", "12000")
	.option("--depth <n>", "Max graph depth", "3")
	.option("--json", "Output JSON Context Pack")
	.option("--legacy-read", "Bypass the persistent index (diagnostic ablation only)")
	.option("--fail-on-index-error", "Fail instead of explicitly falling back to live legacy reads")
	.option("--user <id>", "Principal ID for scope filtering (PERSONAL claims)")
	.option("--project <id>", "Project ID for scope filtering (PROJECT claims)")
	.action(
		(
			task: string,
			options: {
				budget: string;
				depth: string;
				json?: boolean;
				legacyRead?: boolean;
				failOnIndexError?: boolean;
				user?: string;
				project?: string;
			},
		) => {
			const config = loadCliConfig();
			const application = new KnowledgeApplicationService(config);
			const scopeContext = options.user
				? { principalId: options.user, projectId: options.project }
				: undefined;
			const budget = Number.parseInt(options.budget, 10);
			const depth = Number.parseInt(options.depth, 10);
			const built = application.queryContext({
				task,
				budgetTokens: budget,
				maxGraphDepth: depth,
				...(scopeContext ? { scopeContext } : {}),
				knowledgeAccess: options.legacyRead ? "LEGACY" : "MANAGED",
				indexFailurePolicy: options.failOnIndexError ? "FAIL_CLOSED" : "LEGACY_FALLBACK",
			});
			const { pack } = built;
			if (built.diagnostics.knowledgeAccess.lifecycle === "LEGACY_FALLBACK") {
				console.error(
					`⚠️ Persistent index unavailable; used live Canonical legacy reads: ${built.diagnostics.knowledgeAccess.fallbackReason}`,
				);
			}

			if (options.json) {
				console.log(JSON.stringify(built, null, 2));
			} else {
				console.log("📋 Context Pack");
				console.log(pack.taskMap);
				console.log("");
				if (pack.subgraph.claims.length > 0) {
					console.log(`🧠 Claims (${pack.subgraph.claims.length}):`);
					for (const claim of pack.subgraph.claims.slice(0, 10)) {
						console.log(`   ${claim.id}: ${claim.statement}`);
					}
				}
				if (pack.subgraph.relations.length > 0) {
					console.log(`🔗 Relations (${pack.subgraph.relations.length}):`);
					for (const relation of pack.subgraph.relations.slice(0, 10)) {
						console.log(`   ${relation.from} --[${relation.type}]--> ${relation.to}`);
					}
				}
				if (pack.evidenceSpans.length > 0) {
					console.log(`\n📄 Evidence (${pack.evidenceSpans.length}):`);
					for (const span of pack.evidenceSpans.slice(0, 5)) {
						console.log(`   [${span.blockId}] ${span.text.slice(0, 100)}...`);
					}
				}
				if (pack.conflictsAndConditions.length > 0) {
					console.log("\n⚠️ Conflicts & Conditions:");
					for (const conflict of pack.conflictsAndConditions) console.log(`   ${conflict}`);
				}
				if (pack.knownGaps.length > 0) {
					console.log("\n❓ Known Gaps:");
					for (const gap of pack.knownGaps) console.log(`   ${gap}`);
				}
			}
		},
	);

// ─── status 命令 ─────────────────────────────────────────────────

program
	.command("ingest-status")
	.description("Show durable ingest/compile state for all Sources or one Source")
	.option("--source <sourceId>", "Filter by exact source ID")
	.action((options: { source?: string }) => {
		const status = new IngestCoordinatorApplicationService(loadCliConfig()).getStatus({
			...(options.source ? { sourceId: options.source } : {}),
		});
		console.log(JSON.stringify(status, null, 2));
	});

program
	.command("ingest-retry")
	.description("Explicitly requeue one FAILED durable ingest job")
	.argument("<jobId>", "Durable ingest job ID")
	.action((jobId: string) => {
		const job = new IngestJobApplicationService(loadCliConfig()).retryFailedJob(jobId);
		console.log(
			JSON.stringify({ jobId: job.jobId, sourceId: job.sourceId, state: job.state }, null, 2),
		);
	});

program
	.command("status")
	.description("Show knowledge state summary")
	.option("--json", "Output the stable Application status payload")
	.action((options: { json?: boolean }) => {
		const config = loadCliConfig();
		const status = new KnowledgeApplicationService(config).getStatus();
		if (options.json) {
			console.log(JSON.stringify(status, null, 2));
			return;
		}

		console.log("📊 WGEMemory4LLM Status");
		console.log(`   Sources spans: ${status.sourceSpans}`);
		console.log(`   Total claims: ${status.totalClaims}`);
		console.log(`   Canonical (active): ${status.canonicalActiveClaims}`);
		console.log(`   Quarantined: ${status.quarantinedClaims}`);
		console.log(`   Disputed: ${status.disputedClaims}`);
		console.log(`   Unresolved: ${status.unresolvedClaims}`);
		console.log(`   Total relations: ${status.totalRelations}`);
		console.log(
			`   Consumable relations (audit ${status.relationAuditVersion}): ${status.consumableRelations}`,
		);
		console.log(`   Completed sources: ${status.completedSources}`);
		if (status.incompleteSources.length > 0) {
			console.log("   Sources requiring resume/recompile:");
			for (const item of status.incompleteSources) {
				console.log(`      ${item.sourceId}: ${item.state}`);
			}
		}
	});

program.parseAsync(process.argv).catch((error: unknown) => {
	console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
	process.exitCode = 1;
});
