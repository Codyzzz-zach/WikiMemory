import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type JsonRecord = Record<string, unknown>;

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const suiteRoot = join(projectRoot, "experiments", "benchmark-seed-v1");
const suitePath = join(suiteRoot, "suite-manifest.json");
const errors: string[] = [];

const suite = readJson(suitePath);
const batches = requireRecord(suite, "batches");
const development = requireRecord(batches, "development");
const validation = requireRecord(batches, "crossDomainValidation");
const split = requireRecord(suite, "splitContract");
const experiments = requireRecord(suite, "experiments");

assertEqual(suite.schemaVersion, "wge-benchmark-seed-suite/v1", "schemaVersion");
assertEqual(suite.status, "LOCKED_DIRECTIONAL", "suite status");
assertArray(split.blindHoldoutDomains, "blindHoldoutDomains");
if ((split.blindHoldoutDomains as unknown[]).length !== 0) {
	errors.push("Blind holdout must remain empty until Batch C exists");
}
assertEqual(split.blindHoldoutStatus, "NOT_YET_BUILT", "blind holdout status");

const developmentManifest = readJsonl(resolvePath(development, "sourceManifest"));
const validationManifest = readJsonl(resolvePath(validation, "sourceManifest"));
const validationTasks = readJsonl(resolvePath(validation, "taskFile"));
const validationFacts = readJsonl(resolvePath(validation, "factFile"));
const validationRelations = readJsonl(resolvePath(validation, "relationFile"));
const validationEpisodes = readJsonl(resolvePath(validation, "episodeFile"));
const batchBValidation = readJson(resolvePath(validation, "validationReport"));

assertCount(validationManifest, 12, "Batch B sources");
assertCount(validationFacts, 36, "Batch B facts");
assertCount(validationRelations, 9, "Batch B relations");
assertCount(validationTasks, 32, "Batch B tasks");
assertCount(validationEpisodes, 3, "Batch B episodes");
assertEqual(batchBValidation.status, "validated-candidate", "Batch B validation status");

const developmentDomains = stringSet(split.developmentDomains, "developmentDomains");
const validationDomains = stringSet(split.firstRunValidationDomains, "firstRunValidationDomains");
for (const domain of developmentDomains) {
	if (validationDomains.has(domain)) errors.push(`Domain leakage across split: ${domain}`);
}

const developmentUrls = new Set(
	developmentManifest.map((row) => requireString(row, "canonicalUrl")),
);
for (const source of validationManifest) {
	const sourceId = requireString(source, "sourceId");
	const domain = requireString(source, "domain");
	if (!validationDomains.has(domain)) errors.push(`${sourceId}: undeclared validation domain`);
	if (developmentUrls.has(requireString(source, "canonicalUrl"))) {
		errors.push(`${sourceId}: canonical URL appears in development batch`);
	}
	const compilationPath = resolve(
		projectRoot,
		"workbuddy-batch-b",
		requireString(source, "compilationPath"),
	);
	if (!existsSync(compilationPath)) errors.push(`${sourceId}: missing compilation artifact`);
}

for (const task of validationTasks) {
	const caseId = requireString(task, "caseId");
	if (task.status !== "candidate") errors.push(`${caseId}: must remain candidate`);
	if (task.split !== "validation-candidate-public") {
		errors.push(`${caseId}: cannot be represented as blind holdout`);
	}
}

const e1 = requireRecord(experiments, "E1");
const e4 = requireRecord(experiments, "E4");
const e1Inputs = requireRecord(e1, "inputs");
assertEqual(e1Inputs.sources, 12, "E1 source contract");
assertEqual(e1Inputs.factAnchors, 36, "E1 fact contract");
assertEqual(e1Inputs.relationAnchors, 9, "E1 relation contract");
assertEqual(e1Inputs.evolutionEpisodes, 3, "E1 episode contract");
assertEqual(e4.questions, 32, "E4 question contract");
const groups = stringSet(e4.groups, "E4 groups");
for (const group of ["B", "P", "E-min"]) {
	if (!groups.has(group)) errors.push(`E4 missing group ${group}`);
}
assertEqual(e4.goldExposureToAnswerer, false, "E4 answer leakage contract");
assertEqual(e4.retrievalNetwork, false, "E4 network contract");

const report = {
	schemaVersion: "wge-benchmark-seed-validation/v1",
	status: errors.length === 0 ? "VALID" : "INVALID",
	suiteId: suite.suiteId,
	suiteHash: sha256(readFileSync(suitePath, "utf8")),
	counts: {
		developmentSources: developmentManifest.length,
		validationSources: validationManifest.length,
		validationFacts: validationFacts.length,
		validationRelations: validationRelations.length,
		validationTasks: validationTasks.length,
		validationEpisodes: validationEpisodes.length,
	},
	splits: {
		developmentDomains: [...developmentDomains].sort(),
		firstRunValidationDomains: [...validationDomains].sort(),
		blindHoldoutDomains: [],
	},
	errors,
	warnings: [
		"Batch B is public directional validation, not blind holdout or human Gold.",
		"The first Batch B result must be preserved before any Batch B-driven tuning.",
		"A future hidden Batch C is required for confirmatory product claims.",
	],
};

mkdirSync(join(suiteRoot, "reports"), { recursive: true });
writeFileSync(
	join(suiteRoot, "reports", "validation.json"),
	`${JSON.stringify(report, null, 2)}\n`,
	"utf8",
);

if (errors.length > 0) {
	console.error(`Benchmark seed validation failed (${errors.length})`);
	for (const error of errors) console.error(`- ${error}`);
	process.exitCode = 1;
} else {
	console.log("Benchmark seed contract is valid");
	console.log(JSON.stringify(report.counts, null, 2));
}

function resolvePath(record: JsonRecord, key: string): string {
	return resolve(projectRoot, requireString(record, key));
}

function readJson(path: string): JsonRecord {
	return JSON.parse(readFileSync(path, "utf8")) as JsonRecord;
}

function readJsonl(path: string): JsonRecord[] {
	return readFileSync(path, "utf8")
		.split("\n")
		.filter((line) => line.trim().length > 0)
		.map((line) => JSON.parse(line) as JsonRecord);
}

function requireRecord(record: JsonRecord, key: string): JsonRecord {
	const value = record[key];
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`Missing object ${key}`);
	}
	return value as JsonRecord;
}

function requireString(record: JsonRecord, key: string): string {
	const value = record[key];
	if (typeof value !== "string" || value.length === 0) throw new Error(`Missing string ${key}`);
	return value;
}

function assertArray(value: unknown, label: string): asserts value is unknown[] {
	if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
}

function stringSet(value: unknown, label: string): Set<string> {
	assertArray(value, label);
	const values = value.filter((item): item is string => typeof item === "string");
	if (values.length !== value.length) throw new Error(`${label} must contain strings only`);
	return new Set(values);
}

function assertCount(values: unknown[], expected: number, label: string): void {
	if (values.length !== expected) errors.push(`${label}: ${values.length} != ${expected}`);
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
	if (actual !== expected) errors.push(`${label}: ${String(actual)} != ${String(expected)}`);
}

function sha256(value: string): string {
	return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}
