#!/usr/bin/env node

import { Command } from "commander";
import { compileCrossMaterialRelations, compileSource } from "../compiler/index.js";
import type { CompileRunHandle } from "../compiler/run-state.js";
import {
	beginCompileRun,
	finishCompileRun,
	getCompileState,
	getLatestCompileEvent,
	recordCompileStage,
} from "../compiler/run-state.js";
import { loadConfig } from "../config/index.js";
import type { AppConfig } from "../config/types.js";
import { buildContextPack } from "../context-pack/index.js";
import { createLLMProvider } from "../core/llm-provider.js";
import type { LLMProvider } from "../core/llm-provider.js";
import { ingestFile } from "../ingestor/index.js";
import {
	type CompileLintResult,
	lintCompileResult,
	lintRelationsAgainstCanonicalClaims,
} from "../linter/index.js";
import {
	publishCrossMaterialRelations,
	publishSourceResult,
	quarantineCanonicalRelation,
	readAllClaims,
	readAllClaimsQuarantined,
	readAllConcepts,
	readAllRelations,
	readAllSources,
	readAllSpans,
	readSourcePublications,
} from "../linter/storage.js";
import type { SourcePublication } from "../linter/storage.js";
import { RELATION_AUDIT_VERSION } from "../prompts/index.js";
import { evaluatePublicationGate, writePublicationDiffReport } from "../publication-gate/index.js";
import type { Source } from "../types/index.js";

const program = new Command();

program
	.name("wge")
	.description("WGEMemory4LLM — Agent-native knowledge compilation")
	.version("0.1.0");

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
			const config = loadConfig();
			const skipSemantic = options.semantic === false;
			if (!config.apiKey) {
				throw new Error("DEEPSEEK_API_KEY not set. Copy .env.example to .env.");
			}

			const provider = createLLMProvider(config);
			if (!options.json) console.error(`📥 Ingesting: ${file}`);
			const ingestResult = ingestFile(config, file);
			if (!options.json) {
				console.error(`   Source: ${ingestResult.source.id}`);
				console.error(`   Blocks: ${ingestResult.spans.length}`);
				console.error(`   Duplicate: ${ingestResult.isDuplicate}`);
			}

			const compileState = getCompileState(config, ingestResult.source.id);
			if (compileState === "COMPLETED" && !options.recompile) {
				if (!options.json) console.error("✅ Already compiled. Skipping.");
				if (options.json) {
					console.log(
						JSON.stringify({ skipped: true, source: ingestResult.source.id, compileState }),
					);
				}
				return;
			}
			if (ingestResult.isDuplicate && !options.json) {
				console.error(`⚠️ Source exists but compileState=${compileState}. Resuming compile...`);
			}

			const run = beginCompileRun(config, ingestResult.source.id, config.model);
			const relationOnlyResume =
				ingestResult.isDuplicate && !options.recompile && compileState === "RELATION_SCAN_PENDING";
			let localPublished = relationOnlyResume;
			let localSummary: Record<string, unknown> = {
				resumedFromPublishedStage1: relationOnlyResume,
			};
			try {
				if (relationOnlyResume && skipSemantic) {
					finishCompileRun(
						config,
						run,
						"RELATION_SCAN_PENDING",
						"CROSS_MATERIAL_RELATION_LINT",
						"跨材料 Relation 必须经过语义门禁；--no-semantic 不能完成阶段 2",
					);
					if (!options.json)
						console.error("⚠️ 跨材料 Relation 扫描不能使用 --no-semantic，状态保持待扫描。");
					else
						console.log(
							JSON.stringify(
								{
									runId: run.runId,
									source: ingestResult.source.id,
									compileState: "RELATION_SCAN_PENDING",
								},
								null,
								2,
							),
						);
					return;
				}
				if (!relationOnlyResume) {
					if (!options.json) console.error(`🔧 Compiling (run ${run.runId})...`);
					const compileResult = await compileSource(
						config,
						ingestResult.source,
						ingestResult.spans,
						provider,
						{ run, existingConcepts: readAllConcepts(config) },
					);
					if (!options.json) {
						console.error(`   Claims: ${compileResult.claims.length}`);
						console.error(`   Concepts: ${compileResult.concepts.length}`);
						console.error(`   Relations: ${compileResult.relations.length}`);
						const stats = compileResult.compileStats;
						console.error(
							`   映射覆盖: 命题 ${stats.mappedPropositions}/${stats.totalPropositions}, Claim ${stats.mappedClaims}/${stats.totalClaimDrafts}`,
						);
						console.error(`   知识块覆盖: ${stats.coveredEligibleBlocks}/${stats.eligibleBlocks}`);
						if (stats.skippedPropositions.length > 0 || stats.skippedClaims.length > 0) {
							console.error(
								`   ⚠️ 跳过: ${stats.skippedPropositions.length} 命题, ${stats.skippedClaims.length} Claim`,
							);
						}
					}

					recordCompileStage(config, run, "LINT");
					if (!options.json) console.error("🔍 Linting (claims + relations)...");
					const allSpans = readAllSpans(config);
					const lintProvider = skipSemantic ? null : provider;
					const lintResult: CompileLintResult = await lintCompileResult(
						config,
						compileResult.claims,
						compileResult.relations,
						compileResult.concepts,
						allSpans,
						lintProvider,
						{ skipSemantic, run },
					);
					if (!options.json) {
						console.error(`   Canonical claims: ${lintResult.canonicalClaims.length}`);
						console.error(`   Canonical relations: ${lintResult.canonicalRelations.length}`);
						console.error(`   Quarantined claims: ${lintResult.quarantinedClaims.length}`);
						console.error(`   Quarantined relations: ${lintResult.quarantinedRelations.length}`);
					}

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
					recordCompileStage(config, run, "PUBLICATION_GATE");
					const baselinePublication =
						readSourcePublications(config).find(
							(entry) => entry.sourceId === ingestResult.source.id,
						) ?? null;
					const publicationDiff = evaluatePublicationGate({
						config,
						runId: run.runId,
						source: ingestResult.source,
						baseline: baselinePublication,
						candidate: candidatePublication,
						quarantine: candidateQuarantine,
						allSpans,
						allCanonicalClaims: readAllClaims(config),
						acceptReview: options.acceptPublicationDiff,
					});
					const publicationDiffPath = writePublicationDiffReport(config, publicationDiff);
					if (!options.json) {
						console.error(`   Publication gate: ${publicationDiff.status}`);
						console.error(`   Diff report: ${publicationDiffPath}`);
					}
					if (publicationDiff.status !== "PASS") {
						throw new Error(
							`Publication gate ${publicationDiff.status}; canonical 未被覆盖。详见 ${publicationDiffPath}`,
						);
					}

					recordCompileStage(config, run, "PUBLISH");
					publishSourceResult(config, candidatePublication, candidateQuarantine);
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
					if (skipSemantic) {
						finishCompileRun(config, run, "COMPILE_PARTIAL", "PUBLISH");
						if (!options.json)
							console.error(
								"⚠️ Stage 1 published as UNRESOLVED; semantic lint and stage 2 remain pending.",
							);
						else
							console.log(
								JSON.stringify(
									{
										runId: run.runId,
										source: ingestResult.source.id,
										compileState: "COMPILE_PARTIAL",
										...localSummary,
									},
									null,
									2,
								),
							);
						return;
					}
				}

				const publication = readSourcePublications(config).find(
					(entry) => entry.sourceId === ingestResult.source.id,
				);
				if (!publication) throw new Error("阶段 1 发布后无法读取 Source publication");
				const crossSummary = await runCrossMaterialStage(
					config,
					provider,
					run,
					ingestResult.source,
					publication,
				);
				finishCompileRun(config, run, "COMPLETED", "COMPLETE");
				const resultSummary = {
					runId: run.runId,
					source: ingestResult.source.id,
					compileState: "COMPLETED",
					...localSummary,
					...crossSummary,
				};
				if (!options.json) {
					console.error(
						`✅ Ingest completed: ${crossSummary.canonicalCrossRelations} canonical cross-material relations`,
					);
				} else {
					console.log(JSON.stringify(resultSummary, null, 2));
				}
			} catch (error) {
				try {
					const latest = getLatestCompileEvent(config, ingestResult.source.id);
					finishCompileRun(
						config,
						run,
						localPublished ? "RELATION_SCAN_PENDING" : "COMPILE_FAILED",
						latest?.runId === run.runId ? latest.stage : "COMPLETE",
						error instanceof Error ? error.message : String(error),
					);
				} catch (stateError) {
					console.error(
						`❌ Failed to record compile failure: ${
							stateError instanceof Error ? stateError.message : String(stateError)
						}`,
					);
				}
				throw error;
			}
		},
	);

async function runCrossMaterialStage(
	config: AppConfig,
	provider: LLMProvider,
	run: CompileRunHandle,
	source: Source,
	publication: SourcePublication,
): Promise<{
	crossMaterialCandidates: number;
	canonicalCrossRelations: number;
	quarantinedCrossRelations: number;
}> {
	recordCompileStage(config, run, "CROSS_MATERIAL_RELATION_DETECTION");
	const allClaims = readAllClaims(config);
	const newClaimIds = new Set(publication.claims.map((claim) => claim.id));
	const existingClaims = allClaims.filter((claim) => !newClaimIds.has(claim.id));
	const crossCompile = await compileCrossMaterialRelations(
		config,
		provider,
		run.runId,
		source,
		publication.claims,
		publication.concepts,
		existingClaims,
	);

	recordCompileStage(config, run, "CROSS_MATERIAL_RELATION_LINT");
	const crossLint = await lintRelationsAgainstCanonicalClaims(
		config,
		crossCompile.relations,
		allClaims,
		readAllSpans(config),
		provider,
		{ run },
	);
	const canonicalCrossRelations = crossLint
		.filter((result) => result.finalState === "CANONICAL")
		.map((result) => result.object);
	const quarantinedCrossRelations = crossLint
		.filter((result) => result.finalState === "QUARANTINED")
		.map((result) => ({ relation: result.object, issues: result.issues }));

	recordCompileStage(config, run, "CROSS_MATERIAL_RELATION_PUBLISH");
	publishCrossMaterialRelations(
		config,
		source.id,
		run.runId,
		canonicalCrossRelations,
		quarantinedCrossRelations,
	);
	return {
		crossMaterialCandidates: crossCompile.candidateClaimIds.length,
		canonicalCrossRelations: canonicalCrossRelations.length,
		quarantinedCrossRelations: quarantinedCrossRelations.length,
	};
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
		const config = loadConfig();
		quarantineCanonicalRelation(config, relationId, options.reason);
		console.log(`✅ Relation quarantined: ${relationId}`);
	});
relationsCommand
	.command("backfill")
	.description("Run/re-run stage-2 cross-material relation detection")
	.argument("[sourceId]", "Optional source:... ID; defaults to every published Source")
	.option("--json", "Output JSON result")
	.action(async (sourceId: string | undefined, options: { json?: boolean }) => {
		const config = loadConfig();
		if (!config.apiKey) throw new Error("DEEPSEEK_API_KEY not set. Copy .env.example to .env.");
		const provider = createLLMProvider(config);
		const sources = readAllSources(config);
		const publications = readSourcePublications(config);
		const targets = publications.filter(
			(publication) => !sourceId || publication.sourceId === sourceId,
		);
		if (targets.length === 0) throw new Error(`没有匹配的已发布 Source: ${sourceId ?? "<all>"}`);
		const summaries: Array<Record<string, unknown>> = [];
		for (const publication of targets) {
			const source = sources.find((item) => item.id === publication.sourceId);
			if (!source) throw new Error(`找不到不可变 Source: ${publication.sourceId}`);
			const state = getCompileState(config, source.id);
			if (state !== "RELATION_SCAN_PENDING" && state !== "COMPLETED") {
				throw new Error(
					`Source ${source.id} 当前为 ${state}，缺少当前版本的单材料 Relation 审计；请先执行 ingest ${source.uri} --recompile`,
				);
			}
			const run = beginCompileRun(config, source.id, config.model);
			try {
				const summary = await runCrossMaterialStage(config, provider, run, source, publication);
				finishCompileRun(config, run, "COMPLETED", "COMPLETE");
				summaries.push({ sourceId: source.id, runId: run.runId, ...summary });
			} catch (error) {
				const latest = getLatestCompileEvent(config, source.id);
				finishCompileRun(
					config,
					run,
					"RELATION_SCAN_PENDING",
					latest?.runId === run.runId ? latest.stage : "CROSS_MATERIAL_RELATION_DETECTION",
					error instanceof Error ? error.message : String(error),
				);
				throw error;
			}
		}
		if (options.json) console.log(JSON.stringify(summaries, null, 2));
		else
			for (const summary of summaries)
				console.error(
					`✅ ${summary.sourceId}: ${summary.canonicalCrossRelations} cross-material relations`,
				);
	});

// ─── query 命令 ──────────────────────────────────────────────────

program
	.command("query")
	.description("Query knowledge state and build a Context Pack")
	.argument("<task>", "Task description")
	.option("--budget <tokens>", "Context budget in tokens", "12000")
	.option("--depth <n>", "Max graph depth", "3")
	.option("--json", "Output JSON Context Pack")
	.option("--user <id>", "Principal ID for scope filtering (PERSONAL claims)")
	.option("--project <id>", "Project ID for scope filtering (PROJECT claims)")
	.action(
		(
			task: string,
			options: { budget: string; depth: string; json?: boolean; user?: string; project?: string },
		) => {
			const config = loadConfig();
			const scopeContext = options.user
				? { principalId: options.user, projectId: options.project }
				: undefined;
			const pack = buildContextPack(
				config,
				task,
				Number.parseInt(options.budget, 10),
				Number.parseInt(options.depth, 10),
				scopeContext,
			);

			if (options.json) {
				console.log(JSON.stringify(pack, null, 2));
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
	.command("status")
	.description("Show knowledge state summary")
	.action(() => {
		const config = loadConfig();
		const claims = readAllClaims(config);
		const quarantinedClaims = readAllClaimsQuarantined(config);
		const relations = readAllRelations(config);
		const spans = readAllSpans(config);
		const sources = readAllSources(config);
		const canonical = claims.filter(
			(claim) => claim.publicationState === "CANONICAL" && claim.lifecycle === "ACTIVE",
		);
		const disputed = claims.filter((claim) => claim.validity === "DISPUTED");
		const unresolved = claims.filter((claim) => claim.validity === "UNRESOLVED");
		const consumableRelations = relations.filter(
			(relation) =>
				relation.publicationState === "CANONICAL" &&
				relation.lifecycle === "ACTIVE" &&
				relation.validity !== "UNRESOLVED" &&
				relation.conditionStatus !== "UNVERIFIED" &&
				relation.relationAuditVersion === RELATION_AUDIT_VERSION,
		);
		const sourceStates = sources.map((source) => ({
			sourceId: source.id,
			state: getCompileState(config, source.id),
		}));
		const incompleteSources = sourceStates.filter((item) => item.state !== "COMPLETED");

		console.log("📊 WGEMemory4LLM Status");
		console.log(`   Sources spans: ${spans.length}`);
		console.log(`   Total claims: ${claims.length}`);
		console.log(`   Canonical (active): ${canonical.length}`);
		console.log(`   Quarantined: ${quarantinedClaims.length}`);
		console.log(`   Disputed: ${disputed.length}`);
		console.log(`   Unresolved: ${unresolved.length}`);
		console.log(`   Total relations: ${relations.length}`);
		console.log(
			`   Consumable relations (audit ${RELATION_AUDIT_VERSION}): ${consumableRelations.length}`,
		);
		console.log(`   Completed sources: ${sourceStates.length - incompleteSources.length}`);
		if (incompleteSources.length > 0) {
			console.log("   Sources requiring resume/recompile:");
			for (const item of incompleteSources) console.log(`      ${item.sourceId}: ${item.state}`);
		}
	});

program.parseAsync(process.argv).catch((error: unknown) => {
	console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
	process.exitCode = 1;
});
