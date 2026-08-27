import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config/index.js";
import type { PilotConfig, PilotGroup, PilotQuestion } from "../src/pilot/index.js";
import { preparePilotContext } from "../src/pilot/index.js";

type JsonRecord = Record<string, unknown>;

interface Goal2Contract {
	schemaVersion: string;
	micro: {
		questionIds: string[];
		targetQuestionIds: string[];
		controlQuestionIds: string[];
	};
}

interface QuestionFile {
	questions: PilotQuestion[];
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const options = parseArguments(process.argv.slice(2));
const outputRoot = resolve(projectRoot, options.output);
if (existsSync(outputRoot)) throw new Error(`Refusing to overwrite Goal 2 run: ${outputRoot}`);

const contractPath = join(projectRoot, "experiments", "goal2", "goal2-contract-v1.json");
const questionsPath = join(projectRoot, "experiments", "pilot", "questions.json");
const goldPath = join(projectRoot, "experiments", "pilot", "gold-rubric.json");
const pilotConfigPath = join(projectRoot, "experiments", "pilot", "config.json");
const contract = readJson<Goal2Contract>(contractPath);
const questionFile = readJson<QuestionFile>(questionsPath);
const pilotConfig = readJson<PilotConfig>(pilotConfigPath);
const requestedIds = new Set(contract.micro.questionIds);
const questions = questionFile.questions.filter((question) => requestedIds.has(question.id));
if (questions.length !== requestedIds.size) {
	const found = new Set(questions.map((question) => question.id));
	throw new Error(
		`Goal 2 question set incomplete: ${[...requestedIds].filter((id) => !found.has(id)).join(", ")}`,
	);
}

const isolatedRoot = resolve(projectRoot, options.workspace);
const mainConfig = loadConfig({ projectRoot });
const isolatedConfig = loadConfig({ projectRoot: isolatedRoot });
const modes = [
	{ id: "B", pilotGroup: "B", config: mainConfig, retrievalMode: undefined },
	{ id: "R0", pilotGroup: "P", config: isolatedConfig, retrievalMode: "R0" },
	{ id: "R1", pilotGroup: "P", config: isolatedConfig, retrievalMode: "R1" },
] as const;

mkdirSync(join(outputRoot, "contexts"), { recursive: true });
const rows: JsonRecord[] = [];
for (const question of questions) {
	for (const mode of modes) {
		const prepared = preparePilotContext(
			mode.config,
			pilotConfig,
			{ id: question.id, question: question.question },
			mode.pilotGroup as PilotGroup,
			mode.retrievalMode ? { retrievalMode: mode.retrievalMode } : {},
		);
		writeFileSync(
			join(outputRoot, "contexts", `${question.id}--${mode.id}.txt`),
			prepared.context,
			"utf8",
		);
		const packBuild = asRecord(asRecord(prepared.retrievalTrace).packBuild);
		const graph = asRecord(packBuild.graph);
		const selection = asRecord(graph.selection);
		const serialization = asRecord(asRecord(prepared.retrievalTrace).serialization);
		const closure = asRecord(asRecord(prepared.retrievalTrace).closure);
		rows.push({
			questionId: question.id,
			questionClass: contract.micro.targetQuestionIds.includes(question.id) ? "target" : "control",
			category: question.category,
			question: question.question,
			group: mode.id,
			estimatedContextTokens: prepared.estimatedContextTokens,
			contextHash: prepared.contextHash,
			retrievedClaims: prepared.retrievedClaims,
			retrievedRelations: prepared.retrievedRelations,
			evidenceSpans: prepared.evidenceSpans,
			closureComplete: closure.complete ?? null,
			serializationBudgetTokens: serialization.budgetTokens ?? null,
			selection: mode.id === "B" ? null : selection,
			retrievalTrace: prepared.retrievalTrace,
		});
	}
}

const paired = questions.map((question) => {
	const r0 = requiredRow(rows, question.id, "R0");
	const r1 = requiredRow(rows, question.id, "R1");
	const r0Selection = asRecord(r0.selection);
	const r1Selection = asRecord(r1.selection);
	const r0Primary = stringArray(r0Selection.primarySelectedClaimIds);
	const r1Primary = stringArray(r1Selection.primarySelectedClaimIds);
	const added = stringArray(r1Selection.addedGraphClaimIds);
	const removed = stringArray(r1Selection.removedLexicalSeedIds);
	return {
		questionId: question.id,
		questionClass: contract.micro.targetQuestionIds.includes(question.id) ? "target" : "control",
		contextChanged: r0.contextHash !== r1.contextHash,
		primaryClaimCountEqual: r0Primary.length === r1Primary.length,
		r0PrimaryClaimIds: r0Primary,
		r1PrimaryClaimIds: r1Primary,
		addedGraphClaimIds: added,
		removedLexicalSeedIds: removed,
		r0ContextTokens: numberValue(r0.estimatedContextTokens),
		r1ContextTokens: numberValue(r1.estimatedContextTokens),
		tokenDelta: numberValue(r1.estimatedContextTokens) - numberValue(r0.estimatedContextTokens),
		closureComplete: r0.closureComplete === true && r1.closureComplete === true,
	};
});

const targetPairs = paired.filter((row) => row.questionClass === "target");
const controlPairs = paired.filter((row) => row.questionClass === "control");
const checks = {
	sameFrozenBudget: rows
		.filter((row) => row.group !== "B")
		.every((row) => row.serializationBudgetTokens === pilotConfig.retrieval.contextBudgetTokens),
	primaryClaimCountNeverIncreases: paired.every((row) => row.primaryClaimCountEqual),
	targetHasStructuralDifference: targetPairs.some(
		(row) => row.addedGraphClaimIds.length > 0 && row.removedLexicalSeedIds.length > 0,
	),
	controlsHaveNoGraphReplacement: controlPairs.every((row) => row.addedGraphClaimIds.length === 0),
	closureComplete: paired.every((row) => row.closureComplete),
};
const offlineGatePassed = Object.values(checks).every(Boolean);
const report = {
	schemaVersion: "wge-goal2-r1-offline-micro/v1",
	status: offlineGatePassed ? "PASS_OFFLINE_ENTRY_GATE" : "FAIL_OFFLINE_ENTRY_GATE",
	createdAt: new Date().toISOString(),
	provenance: {
		contractPath,
		contractHash: sha256(readFileSync(contractPath, "utf8")),
		questionsHash: sha256(readFileSync(questionsPath, "utf8")),
		goldHash: sha256(readFileSync(goldPath, "utf8")),
		pilotConfigHash: sha256(readFileSync(pilotConfigPath, "utf8")),
		workspace: isolatedRoot,
		workspaceManifestHash: sha256(readFileSync(join(isolatedRoot, "..", "manifest.json"), "utf8")),
		mainPublicationMutated: false,
	},
	questionIds: questions.map((question) => question.id),
	contextBudgetTokens: pilotConfig.retrieval.contextBudgetTokens,
	checks,
	offlineGatePassed,
	paired,
	summary: modes.map((mode) => {
		const selected = rows.filter((row) => row.group === mode.id);
		return {
			group: mode.id,
			questions: selected.length,
			averageContextTokens: average(selected.map((row) => numberValue(row.estimatedContextTokens))),
			averageClaims: average(selected.map((row) => arrayLength(row.retrievedClaims))),
			averageRelations: average(selected.map((row) => arrayLength(row.retrievedRelations))),
		};
	}),
	rows,
	limitations: [
		"Questions are revealed Dev regression assets, not blind product evidence.",
		"Relations are AI post-hoc proxy accepted edges, not human Gold.",
		"Control replacement is fail-closed in the offline gate; a later typed trigger may relax it only under a new frozen contract.",
	],
};
writeJson(join(outputRoot, "offline-report.json"), report);
writeJson(join(outputRoot, "manifest.json"), {
	schemaVersion: "wge-goal2-run-manifest/v1",
	createdAt: report.createdAt,
	status: report.status,
	inputHashes: report.provenance,
	contextFilesHash: sha256(
		rows
			.map((row) => `${row.questionId}:${row.group}:${row.contextHash}`)
			.sort()
			.join("\n"),
	),
});
console.log(
	JSON.stringify(
		{
			outputRoot,
			status: report.status,
			checks,
			summary: report.summary,
			paired,
		},
		null,
		2,
	),
);

function parseArguments(argv: string[]): { workspace: string; output: string } {
	let workspace: string | undefined;
	let output: string | undefined;
	for (let index = 0; index < argv.length; index += 1) {
		const value = argv[index];
		if (value === "--workspace") workspace = requiredValue(argv, ++index, value);
		else if (value === "--output") output = requiredValue(argv, ++index, value);
		else throw new Error(`Unknown argument: ${value}`);
	}
	if (!workspace || !output) throw new Error("--workspace and --output are required");
	return { workspace, output };
}

function requiredValue(argv: string[], index: number, flag: string): string {
	const value = argv[index];
	if (!value) throw new Error(`${flag} requires a value`);
	return value;
}

function requiredRow(rows: JsonRecord[], questionId: string, group: string): JsonRecord {
	const row = rows.find(
		(candidate) => candidate.questionId === questionId && candidate.group === group,
	);
	if (!row) throw new Error(`Missing ${questionId}/${group}`);
	return row;
}

function asRecord(value: unknown): JsonRecord {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function stringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

function numberValue(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function arrayLength(value: unknown): number {
	return Array.isArray(value) ? value.length : 0;
}

function average(values: number[]): number {
	return values.length === 0
		? 0
		: Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, "utf8")) as T;
}

function writeJson(path: string, value: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}
