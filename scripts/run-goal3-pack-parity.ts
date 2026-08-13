import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config/index.js";
import { buildContextPackWithDiagnostics } from "../src/context-pack/index.js";
import { readAllClaims, readAllSpans } from "../src/linter/storage.js";
import { buildPersistentSeedIndex } from "../src/retrieval/persistent-index.js";

type JsonRecord = Record<string, unknown>;

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const runId = process.env.WGE_GOAL3_PACK_RUN_ID ?? "pack-v1";
const runRoot = join(projectRoot, "experiments", "goal3", "pack-runs", runId);
if (existsSync(runRoot)) throw new Error(`Refusing to overwrite Pack parity run: ${runRoot}`);
mkdirSync(runRoot, { recursive: true });

const batchQuestionPath = join(
	projectRoot,
	"experiments",
	"benchmark-batch-c",
	"stage-a-freeze",
	"questions-public.jsonl",
);
const batchQuestionText = readFileSync(batchQuestionPath, "utf8");
const batchQuestions = readJsonl(batchQuestionText).map((record) => ({
	id: requiredString(record, "caseId"),
	task: requiredString(record, "question"),
}));
const workspaces = ["S12", "S29", "S50"].map((tier) => ({
	name: tier,
	root: join(projectRoot, "experiments", "goal3", "runs", "scale-v5", "workspaces", tier),
	questions: batchQuestions,
}));
const rootConfig = loadConfig({ projectRoot });
const rootSpans = new Set(readAllSpans(rootConfig).map((span) => span.id));
const rootQuestions = readAllClaims(rootConfig)
	.filter(
		(claim) =>
			claim.scope.type === "GLOBAL" &&
			claim.evidenceSpanIds.some((spanId) => rootSpans.has(spanId)),
	)
	.sort((left, right) => left.id.localeCompare(right.id))
	.slice(0, 24)
	.map((claim) => ({ id: `ROOT:${claim.id}`, task: claim.statement }));
workspaces.push({ name: "ROOT", root: projectRoot, questions: rootQuestions });

const rows: JsonRecord[] = [];
const builds: JsonRecord[] = [];
for (const workspace of workspaces) {
	const config = loadConfig({ projectRoot: workspace.root });
	const indexRoot = join(runRoot, "indexes", workspace.name);
	const buildStarted = process.hrtime.bigint();
	const build = buildPersistentSeedIndex(config, indexRoot);
	builds.push({ workspace: workspace.name, ...build, milliseconds: elapsed(buildStarted) });
	for (const selectionMode of ["R0", "LEGACY_CONDITIONAL"] as const) {
		for (const question of workspace.questions) {
			const legacyStarted = process.hrtime.bigint();
			const legacy = buildContextPackWithDiagnostics(config, question.task, 4000, 2, undefined, {
				selectionMode,
			});
			const legacyMilliseconds = elapsed(legacyStarted);
			const indexedStarted = process.hrtime.bigint();
			const indexed = buildContextPackWithDiagnostics(config, question.task, 4000, 2, undefined, {
				selectionMode,
				knowledgeAccess: "INDEXED",
				indexRoot,
			});
			const indexedMilliseconds = elapsed(indexedStarted);
			const legacyJson = JSON.stringify(legacy.pack);
			const indexedJson = JSON.stringify(indexed.pack);
			rows.push({
				workspace: workspace.name,
				questionId: question.id,
				selectionMode,
				legacyMilliseconds,
				indexedMilliseconds,
				packParity: legacyJson === indexedJson,
				legacyPackHash: sha256(legacyJson),
				indexedPackHash: sha256(indexedJson),
				temporalParity:
					JSON.stringify(normalizeTemporal(legacy.diagnostics.temporalScope)) ===
					JSON.stringify(normalizeTemporal(indexed.diagnostics.temporalScope)),
				budgetSelectionParity:
					JSON.stringify(normalizeBudget(legacy.diagnostics.budget)) ===
					JSON.stringify(normalizeBudget(indexed.diagnostics.budget)),
				legacyCounts: packCounts(legacy.pack),
				indexedCounts: packCounts(indexed.pack),
			});
		}
	}
}

const report = {
	schemaVersion: "wge-goal3-pack-parity/v1",
	runId,
	createdAt: new Date().toISOString(),
	status: rows.every(
		(row) =>
			row.packParity === true && row.temporalParity === true && row.budgetSelectionParity === true,
	)
		? "PASS_PACK_PARITY"
		: "FAIL_PACK_PARITY",
	provenance: {
		batchQuestionPath,
		batchQuestionSha256: sha256(batchQuestionText),
		modelCalls: 0,
		network: false,
		budget: 4000,
		maxDepth: 2,
	},
	checks: {
		packParity: rows.every((row) => row.packParity === true),
		temporalParity: rows.every((row) => row.temporalParity === true),
		budgetSelectionParity: rows.every((row) => row.budgetSelectionParity === true),
	},
	builds,
	summaries: workspaces.flatMap((workspace) =>
		(["R0", "LEGACY_CONDITIONAL"] as const).map((selectionMode) => {
			const selected = rows.filter(
				(row) => row.workspace === workspace.name && row.selectionMode === selectionMode,
			);
			return {
				workspace: workspace.name,
				selectionMode,
				queries: selected.length,
				packParity: selected.filter((row) => row.packParity === true).length,
				averageLegacyMilliseconds: average(selected.map((row) => Number(row.legacyMilliseconds))),
				averageIndexedMilliseconds: average(selected.map((row) => Number(row.indexedMilliseconds))),
			};
		}),
	),
	rows,
};
writeFileSync(join(runRoot, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(
	JSON.stringify(
		{ runRoot, status: report.status, checks: report.checks, summaries: report.summaries },
		null,
		2,
	),
);

function packCounts(pack: ReturnType<typeof buildContextPackWithDiagnostics>["pack"]) {
	return {
		claims: pack.subgraph.claims.length,
		relations: pack.subgraph.relations.length,
		spans: pack.evidenceSpans.length,
		wikiModules: pack.wikiModules.length,
		conflicts: pack.conflictsAndConditions.length,
		knownGaps: pack.knownGaps.length,
	};
}

function normalizeTemporal(
	diagnostics: ReturnType<typeof buildContextPackWithDiagnostics>["diagnostics"]["temporalScope"],
) {
	return {
		...diagnostics,
		excludedClaimIds: [...diagnostics.excludedClaimIds].sort(),
	};
}

function normalizeBudget(
	diagnostics: ReturnType<typeof buildContextPackWithDiagnostics>["diagnostics"]["budget"],
) {
	return {
		selectedClaimIds: [...diagnostics.selectedClaimIds].sort(),
		selectedRelationIds: [...diagnostics.selectedRelationIds].sort(),
		selectedEvidenceSpanIds: [...diagnostics.selectedEvidenceSpanIds].sort(),
		selectedWikiModuleIds: [...diagnostics.selectedWikiModuleIds].sort(),
		finalEstimatedTokens: diagnostics.finalEstimatedTokens,
	};
}

function readJsonl(text: string): JsonRecord[] {
	return text
		.split(/\r?\n/u)
		.filter((line) => line.trim().length > 0)
		.map((line) => JSON.parse(line) as JsonRecord);
}

function requiredString(record: JsonRecord, key: string): string {
	const value = record[key];
	if (typeof value !== "string" || value.length === 0) throw new Error(`Missing string ${key}`);
	return value;
}

function elapsed(started: bigint): number {
	return Math.round((Number(process.hrtime.bigint() - started) / 1_000_000) * 1000) / 1000;
}

function average(values: number[]): number {
	if (values.length === 0) return 0;
	return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 1000) / 1000;
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}
