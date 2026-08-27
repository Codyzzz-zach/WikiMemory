import { createHash } from "node:crypto";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config/index.js";
import type { SourcePublication } from "../src/linter/storage.js";
import type { PilotConfig, PilotGroup, PilotQuestion } from "../src/pilot/index.js";
import { preparePilotContext } from "../src/pilot/index.js";
import type { Relation } from "../src/types/index.js";

type JsonRecord = Record<string, unknown>;

interface AuditResult {
	object: Relation;
	finalState: "CANONICAL" | "QUARANTINED";
}

interface QuestionFile {
	questions: PilotQuestion[];
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const options = parseArguments(process.argv.slice(2));
const auditRunRoot = resolve(projectRoot, options.auditRun);
const outputRoot = resolve(projectRoot, options.output);
if (existsSync(outputRoot)) throw new Error(`Refusing to overwrite experiment: ${outputRoot}`);

const auditManifestPath = join(auditRunRoot, "manifest.json");
const auditResultsPath = join(auditRunRoot, "audit-results.json");
const auditManifest = readJson<JsonRecord>(auditManifestPath);
const auditResults = readJson<AuditResult[]>(auditResultsPath);
const acceptedRelations = auditResults
	.filter((result) => result.finalState === "CANONICAL")
	.map((result) => result.object);
if (acceptedRelations.length === 0) throw new Error("Audit run contains no accepted relations");

const isolatedRoot = join(outputRoot, "workspace");
for (const directory of ["publications", "sources", "mathtest-material", "wiki", "quarantine"]) {
	mkdirSync(join(isolatedRoot, directory), { recursive: true });
}

const publicationDirectory = join(projectRoot, "publications");
const publications = readdirSync(publicationDirectory)
	.filter((file) => file.endsWith(".json"))
	.sort()
	.map((file) => ({
		file,
		publication: readJson<SourcePublication>(join(publicationDirectory, file)),
	}));
const claimOwner = new Map<string, string>();
for (const { publication } of publications) {
	for (const claim of publication.claims) claimOwner.set(claim.id, publication.sourceId);
}
const acceptedBySource = new Map<string, Relation[]>();
for (const relation of acceptedRelations) {
	const sourceId = claimOwner.get(relation.from as string);
	if (!sourceId) throw new Error(`Accepted relation has no local From owner: ${relation.id}`);
	const rows = acceptedBySource.get(sourceId) ?? [];
	rows.push(relation);
	acceptedBySource.set(sourceId, rows);
}
for (const { file, publication } of publications) {
	writeJson(join(isolatedRoot, "publications", file), {
		...publication,
		relations: acceptedBySource.get(publication.sourceId) ?? [],
	});
}
copyMatchingFiles(join(projectRoot, "sources"), join(isolatedRoot, "sources"), () => true);
copyMatchingFiles(
	join(projectRoot, "mathtest-material"),
	join(isolatedRoot, "mathtest-material"),
	(file) => file.endsWith(".md"),
);

const pilotConfig = readJson<PilotConfig>(join(projectRoot, "experiments", "pilot", "config.json"));
const questionFile = readJson<QuestionFile>(
	join(projectRoot, "experiments", "pilot", "questions.json"),
);
const mainConfig = loadConfig({ projectRoot });
const isolatedConfig = loadConfig({ projectRoot: isolatedRoot });
const modes = [
	{ id: "B", pilotGroup: "B", graphExpansion: false, config: mainConfig },
	{ id: "P-seed", pilotGroup: "P", graphExpansion: false, config: isolatedConfig },
	{ id: "P-graph", pilotGroup: "P", graphExpansion: true, config: isolatedConfig },
] as const;

mkdirSync(join(outputRoot, "contexts"), { recursive: true });
const rows: JsonRecord[] = [];
for (const question of questionFile.questions) {
	for (const mode of modes) {
		const prepared = preparePilotContext(
			mode.config,
			pilotConfig,
			{ id: question.id, question: question.question },
			mode.pilotGroup as PilotGroup,
			{ graphExpansion: mode.graphExpansion },
		);
		writeFileSync(
			join(outputRoot, "contexts", `${question.id}--${mode.id}.txt`),
			prepared.context,
			"utf8",
		);
		rows.push({
			questionId: question.id,
			category: question.category,
			question: question.question,
			group: mode.id,
			estimatedContextTokens: prepared.estimatedContextTokens,
			contextHash: prepared.contextHash,
			retrievedClaims: prepared.retrievedClaims,
			retrievedRelations: prepared.retrievedRelations,
			evidenceSpans: prepared.evidenceSpans,
			retrievedSources: prepared.retrievedSources,
			droppedContext: prepared.droppedContext,
			retrievalTrace: prepared.retrievalTrace,
		});
	}
}

const graphRows = rows.filter((row) => row.group === "P-graph");
const triggered = graphRows.filter((row) => arrayLength(row.retrievedRelations) > 0);
const report = {
	schemaVersion: "wge-goal1-isolated-graph-preparation/v1",
	status: "PREPARED_POST_HOC_DEV_PROXY",
	createdAt: new Date().toISOString(),
	provenance: {
		auditRun: options.auditRun,
		auditManifestHash: sha256(readFileSync(auditManifestPath, "utf8")),
		auditResultsHash: sha256(readFileSync(auditResultsPath, "utf8")),
		auditVersion: auditManifest.auditVersion ?? null,
		acceptedRelationCount: acceptedRelations.length,
		mainPublicationMutated: false,
	},
	questionCount: questionFile.questions.length,
	contextBudgetTokens: pilotConfig.retrieval.contextBudgetTokens,
	triggeredQuestionIds: triggered.map((row) => row.questionId),
	summary: modes.map((mode) => {
		const selected = rows.filter((row) => row.group === mode.id);
		return {
			group: mode.id,
			questions: selected.length,
			averageContextTokens: average(selected.map((row) => Number(row.estimatedContextTokens))),
			averageClaims: average(selected.map((row) => arrayLength(row.retrievedClaims))),
			averageRelations: average(selected.map((row) => arrayLength(row.retrievedRelations))),
		};
	}),
	rows,
	limitations: [
		"This is a post-hoc Goal 1 development experiment, not a blind product benchmark.",
		"Accepted relations come from an AI proxy calibration gate, not human Gold.",
		"The isolated workspace is read-only experiment input and does not publish to the main knowledge base.",
	],
};
writeJson(join(outputRoot, "context-preparation.json"), report);
writeJson(join(outputRoot, "manifest.json"), {
	schemaVersion: "wge-goal1-isolated-workspace/v1",
	createdAt: report.createdAt,
	auditRun: options.auditRun,
	auditVersion: auditManifest.auditVersion ?? null,
	acceptedRelationIds: acceptedRelations.map((relation) => relation.id).sort(),
	publicationHashes: readdirSync(join(isolatedRoot, "publications"))
		.filter((file) => file.endsWith(".json"))
		.sort()
		.map((file) => ({
			file,
			sha256: sha256(readFileSync(join(isolatedRoot, "publications", file), "utf8")),
		})),
});
console.log(
	JSON.stringify(
		{
			outputRoot,
			acceptedRelations: acceptedRelations.length,
			questions: questionFile.questions.length,
			triggeredQuestionIds: report.triggeredQuestionIds,
			summary: report.summary,
		},
		null,
		2,
	),
);

function parseArguments(argv: string[]): { auditRun: string; output: string } {
	let auditRun: string | undefined;
	let output: string | undefined;
	for (let index = 0; index < argv.length; index += 1) {
		const value = argv[index];
		if (value === "--audit-run") auditRun = requiredValue(argv, ++index, value);
		else if (value === "--output") output = requiredValue(argv, ++index, value);
		else throw new Error(`Unknown argument: ${value}`);
	}
	if (!auditRun || !output) throw new Error("--audit-run and --output are required");
	return { auditRun, output };
}

function requiredValue(argv: string[], index: number, flag: string): string {
	const value = argv[index];
	if (!value) throw new Error(`${flag} requires a value`);
	return value;
}

function copyMatchingFiles(
	source: string,
	target: string,
	include: (file: string) => boolean,
): void {
	for (const file of readdirSync(source).filter(include).sort()) {
		copyFileSync(join(source, file), join(target, basename(file)));
	}
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

function arrayLength(value: unknown): number {
	return Array.isArray(value) ? value.length : 0;
}

function average(values: number[]): number {
	return values.length === 0
		? 0
		: Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}
