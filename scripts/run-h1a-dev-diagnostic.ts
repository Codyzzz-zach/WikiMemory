#!/usr/bin/env node

import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { loadConfig } from "../src/config/index.js";
import { buildContextPackWithDiagnostics } from "../src/context-pack/index.js";
import { upsertWikiModules, writeJsonAtomic } from "../src/linter/storage.js";
import type { WikiModule } from "../src/types/index.js";

interface Episode {
	affectedQuestionId: string;
	affectedQuestion: string;
	requiredClaimIds: string[];
	unaffectedQuestionId: string;
	unaffectedQuestion: string;
	unaffectedClaimIds: string[];
}

interface Selection {
	episodes: Episode[];
}

const ROOT = process.cwd();
const SOURCE_WORKSPACE = join(
	ROOT,
	"experiments/evolution/runs/controlled-v1-lineage-v15/workspace",
);
const SELECTION_PATH = join(ROOT, "experiments/m2-wiki-completeness/selection-v1.json");

const program = new Command();
program
	.name("run-h1a-dev-diagnostic")
	.requiredOption("--formation-run <id>")
	.requiredOption("--run-id <id>")
	.option("--budget <n>", "estimated visible token budget", "6000")
	.action(({ formationRun, runId, budget }) => {
		const outputRoot = join(ROOT, "experiments/h1-wiki-formation/dev-diagnostics", runId);
		if (existsSync(outputRoot)) throw new Error(`诊断工件已存在，拒绝覆盖: ${outputRoot}`);
		mkdirSync(outputRoot, { recursive: true });
		const tokenBudget = parsePositiveInt(budget);
		const formationRoot = join(ROOT, "experiments/h1-wiki-formation/runs", formationRun);
		const formationReport = readJson<{ status: string }>(join(formationRoot, "report.json"));
		if (formationReport.status !== "PASS") throw new Error("Formation 工程门禁未通过");
		const modules = readJson<WikiModule[]>(join(formationRoot, "modules.json"));
		const selection = readJson<Selection>(SELECTION_PATH);
		const temporaryRoot = mkdtempSync(join(tmpdir(), "wge-h1a-diagnostic-"));
		const workspace = join(temporaryRoot, "workspace");
		try {
			cpSync(SOURCE_WORKSPACE, workspace, { recursive: true });
			rmSync(join(workspace, "wiki"), { recursive: true, force: true });
			mkdirSync(join(workspace, "wiki"), { recursive: true });
			const config = loadConfig({ projectRoot: workspace, apiKey: "", temperature: 0 });
			upsertWikiModules(config, modules);
			const rows = selection.episodes.flatMap((episode) => [
				buildRow(
					config,
					episode.affectedQuestionId,
					episode.affectedQuestion,
					episode.requiredClaimIds,
					"affected",
					tokenBudget,
				),
				buildRow(
					config,
					episode.unaffectedQuestionId,
					episode.unaffectedQuestion,
					episode.unaffectedClaimIds,
					"unaffected",
					tokenBudget,
				),
			]);
			writeJsonAtomic(join(outputRoot, "rows.json"), rows);
			writeJsonAtomic(join(outputRoot, "report.json"), {
				schemaVersion: "wge-h1a-dev-diagnostic/v1",
				runId,
				status: "DIAGNOSTIC_ONLY",
				formationRun,
				datasetClass: "REVEALED_DEVELOPMENT_POST_HOC",
				interpretation:
					"May diagnose automatic formation and retrieval, but cannot modify the frozen formation run or establish held-out generalization.",
				formationArtifactHash: sha256(readFileSync(join(formationRoot, "modules.json"))),
				selectionHash: sha256(readFileSync(SELECTION_PATH)),
				budget: tokenBudget,
				summary: {
					questions: rows.length,
					wikiVisible: rows.filter((row) => row.wikiModuleIds.length > 0).length,
					requiredPresent: rows.reduce((sum, row) => sum + row.present.length, 0),
					requiredTotal: rows.reduce((sum, row) => sum + row.requiredClaimIds.length, 0),
					fullCoverage: rows.filter((row) => row.missing.length === 0).length,
				},
				rows,
			});
			console.log(JSON.stringify(rows, null, 2));
		} finally {
			rmSync(temporaryRoot, { recursive: true, force: true });
		}
	});

program.parseAsync().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});

function buildRow(
	config: ReturnType<typeof loadConfig>,
	questionId: string,
	question: string,
	requiredClaimIds: string[],
	category: string,
	budget: number,
) {
	const result = buildContextPackWithDiagnostics(config, question, budget, 0, undefined, {
		selectionMode: "R0",
		wikiMode: "MATERIALIZED",
	});
	const baseline = buildContextPackWithDiagnostics(config, question, budget, 0, undefined, {
		selectionMode: "R0",
		wikiMode: "DISABLED",
	});
	const visibleClaims = new Set(result.pack.subgraph.claims.map((claim) => claim.id));
	const baselineClaims = new Set(baseline.pack.subgraph.claims.map((claim) => claim.id));
	return {
		questionId,
		category,
		requiredClaimIds,
		present: requiredClaimIds.filter((id) => visibleClaims.has(id)),
		missing: requiredClaimIds.filter((id) => !visibleClaims.has(id)),
		baselinePresent: requiredClaimIds.filter((id) => baselineClaims.has(id)),
		baselineMissing: requiredClaimIds.filter((id) => !baselineClaims.has(id)),
		wikiModuleIds: result.pack.wikiModules.map((module) => module.id),
		wikiStableAddresses: result.pack.wikiModules.map((module) => module.stableAddress),
		wikiRetrieval: result.diagnostics.wiki.retrieval,
		wikiDrops: result.diagnostics.budget.dropped.filter((drop) => drop.id.startsWith("wiki:")),
		estimatedTokens: result.diagnostics.budget.finalEstimatedTokens,
		baselineEstimatedTokens: baseline.diagnostics.budget.finalEstimatedTokens,
	};
}

function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, "utf8")) as T;
}

function parsePositiveInt(value: string): number {
	const parsed = Number.parseInt(value, 10);
	if (!Number.isInteger(parsed) || parsed <= 0) throw new Error("budget 必须是正整数");
	return parsed;
}

function sha256(value: Buffer): string {
	return createHash("sha256").update(value).digest("hex");
}
