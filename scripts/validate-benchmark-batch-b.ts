import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type JsonRecord = Record<string, unknown>;

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const batchRoot = resolve(process.argv[2] ?? join(projectRoot, "workbuddy-batch-b"));
const generatedRoot = join(batchRoot, "generated");
const errors: string[] = [];

const manifest = readJsonl(join(generatedRoot, "source-manifest.jsonl"));
const facts = readJsonl(join(generatedRoot, "candidates", "facts.jsonl"));
const relations = readJsonl(join(generatedRoot, "candidates", "relations.jsonl"));
const tasks = readJsonl(join(generatedRoot, "candidates", "tasks.jsonl"));
const episodes = readJsonl(join(generatedRoot, "candidates", "evolution-episodes.jsonl"));

assertCount(manifest, 12, "sources");
assertCount(facts, 36, "facts");
assertCount(relations, 9, "relations");
assertCount(tasks, 32, "tasks");
assertCount(episodes, 3, "episodes");

const snapshots = new Map<string, string>();
for (const source of manifest) {
	const sourceId = requireString(source, "sourceId");
	const content = normalizeNewlines(
		readFileSync(join(batchRoot, requireString(source, "contentPath")), "utf8"),
	);
	const snapshot = extractSnapshot(content);
	snapshots.set(sourceId, snapshot);
	assertEqual(source.snapshotHash, sha256(snapshot), `${sourceId}: snapshotHash mismatch`);
	assertEqual(source.artifactHash, sha256(content), `${sourceId}: artifactHash mismatch`);
	const compilationPath = requireString(source, "compilationPath");
	const compilationArtifact = normalizeNewlines(
		readFileSync(join(batchRoot, compilationPath), "utf8"),
	);
	assertEqual(
		source.compilationHash,
		sha256(compilationArtifact),
		`${sourceId}: compilationHash mismatch`,
	);
	if (!compilationArtifact.endsWith(snapshot)) {
		errors.push(`${sourceId}: compilation artifact does not preserve the exact snapshot`);
	}
	if (compilationArtifact.includes("## Research Notes")) {
		errors.push(`${sourceId}: compilation artifact leaks Research Notes`);
	}
	if (source.status !== "source-frozen-candidate")
		errors.push(`${sourceId}: invalid source status`);
}

const domains = ["health-biology", "history-humanities", "design-accessibility"];
for (const domain of domains) {
	const domainSources = manifest.filter((source) => source.domain === domain);
	if (domainSources.length !== 4)
		errors.push(`${domain}: source count ${domainSources.length} != 4`);
	const roles = new Set(domainSources.map((source) => String(source.sourceRole)));
	if (roles.size < 3) errors.push(`${domain}: source role diversity ${roles.size} < 3`);
}

assertUnique(manifest, "sourceId");
assertUnique(facts, "candidateId");
assertUnique(relations, "candidateId");
assertUnique(tasks, "caseId");
assertUnique(episodes, "episodeId");

const factsById = new Map(facts.map((fact) => [requireString(fact, "candidateId"), fact]));
for (const fact of facts) {
	const factId = requireString(fact, "candidateId");
	if (fact.status !== "candidate") errors.push(`${factId}: fact status must remain candidate`);
	validateQuote(fact.sourceId, fact.exactQuote, factId);
}

const relationTypes = new Set([
	"REQUIRES",
	"DERIVED_FROM",
	"SUPPORTS",
	"CONTRADICTS",
	"SUPERSEDES",
	"EQUIVALENT_UNDER",
	"RELATED_TO",
]);
for (const relation of relations) {
	const relationId = requireString(relation, "candidateId");
	if (!relationTypes.has(requireString(relation, "type"))) {
		errors.push(`${relationId}: unknown relation type ${String(relation.type)}`);
	}
	for (const endpoint of [requireString(relation, "from"), requireString(relation, "to")]) {
		if (!factsById.has(endpoint)) errors.push(`${relationId}: unknown endpoint ${endpoint}`);
	}
	if (
		relation.type === "SUPERSEDES" &&
		(!Array.isArray(relation.conditions) || relation.conditions.length === 0)
	) {
		errors.push(`${relationId}: SUPERSEDES requires explicit conditions`);
	}
	validateEvidenceArray(relation.evidence, `${relationId}.evidence`);
}

for (const task of tasks) {
	const caseId = requireString(task, "caseId");
	if (task.status !== "candidate") errors.push(`${caseId}: task status must remain candidate`);
	if (task.split !== "validation-candidate-public")
		errors.push(`${caseId}: invalid public split label`);
	const evidence = task.requiredEvidence;
	if (task.answerability === "insufficient") {
		if (!Array.isArray(evidence))
			errors.push(`${caseId}: insufficient task needs an evidence array`);
		else if (evidence.length > 0) validateEvidenceArray(evidence, `${caseId}.requiredEvidence`);
	} else validateEvidenceArray(evidence, `${caseId}.requiredEvidence`);
	if (!Array.isArray(task.forbiddenClaims) || task.forbiddenClaims.length === 0) {
		errors.push(`${caseId}: forbiddenClaims missing`);
	}
}

for (const episode of episodes) {
	const episodeId = requireString(episode, "episodeId");
	if (episode.status !== "candidate")
		errors.push(`${episodeId}: episode status must remain candidate`);
	validateEvidenceArray(episode.chronologyEvidence, `${episodeId}.chronologyEvidence`);
}

const batchAManifestPath = join(
	projectRoot,
	"workbuddy-batch-a",
	"refined",
	"source-manifest.jsonl",
);
const batchAUrls = new Set(
	readJsonl(batchAManifestPath)
		.map((source) => String(source.canonicalUrl))
		.filter(Boolean),
);
for (const source of manifest) {
	if (batchAUrls.has(String(source.canonicalUrl))) {
		errors.push(`${String(source.sourceId)}: canonical URL leaks from Batch A`);
	}
}

const taskTypes = Object.fromEntries(
	["F", "R", "X", "C", "K", "T", "E", "A", "U"].map((type) => [
		type,
		tasks.filter((task) => task.questionType === type).length,
	]),
);
for (const [type, count] of Object.entries(taskTypes)) {
	if (count === 0) errors.push(`task type ${type}: no coverage`);
}

const validation = {
	schemaVersion: "wge-batch-validation/v1",
	status: errors.length === 0 ? "validated-candidate" : "failed",
	knowledgeVersion: sha256(
		manifest
			.map((source) => `${String(source.sourceId)}:${String(source.snapshotHash)}`)
			.sort()
			.join("\n"),
	),
	counts: {
		sources: manifest.length,
		facts: facts.length,
		relations: relations.length,
		tasks: tasks.length,
		episodes: episodes.length,
	},
	taskTypes,
	errors,
	warnings: [
		"All questions are public validation candidates, not blind holdout.",
		"Relations and episodes still require an independent semantic critic before Gold promotion.",
		"Health materials are historical evidence snapshots and do not constitute medical advice.",
	],
};
writeFileSync(
	join(generatedRoot, "reports", "validation.json"),
	`${JSON.stringify(validation, null, 2)}\n`,
	"utf8",
);

if (errors.length > 0) {
	console.error(`Batch B validation failed (${errors.length})`);
	for (const error of errors) console.error(`- ${error}`);
	process.exitCode = 1;
} else {
	console.log("Batch B candidate validation passed");
	console.log(JSON.stringify({ ...validation.counts, taskTypes }, null, 2));
}

function validateEvidenceArray(value: unknown, label: string): void {
	if (!Array.isArray(value) || value.length === 0) {
		errors.push(`${label}: missing or empty`);
		return;
	}
	for (const [index, item] of value.entries()) {
		if (!isRecord(item)) {
			errors.push(`${label}[${index}]: invalid evidence object`);
			continue;
		}
		validateQuote(item.sourceId, item.exactQuote, `${label}[${index}]`);
		const factId = item.factId;
		if (typeof factId !== "string" || !factsById.has(factId)) {
			errors.push(`${label}[${index}]: unknown factId ${String(factId)}`);
			continue;
		}
		const fact = factsById.get(factId);
		if (!fact) continue;
		if (fact.sourceId !== item.sourceId || fact.exactQuote !== item.exactQuote) {
			errors.push(`${label}[${index}]: evidence does not match ${factId}`);
		}
	}
}

function validateQuote(sourceValue: unknown, quoteValue: unknown, label: string): void {
	if (typeof sourceValue !== "string" || typeof quoteValue !== "string") {
		errors.push(`${label}: invalid sourceId/exactQuote`);
		return;
	}
	const snapshot = snapshots.get(sourceValue);
	if (!snapshot) errors.push(`${label}: unknown source ${sourceValue}`);
	else if (!snapshot.includes(quoteValue))
		errors.push(`${label}: quote not found in ${sourceValue}`);
}

function assertCount(values: unknown[], expected: number, label: string): void {
	if (values.length !== expected) errors.push(`${label}: ${values.length} != ${expected}`);
}

function assertUnique(values: JsonRecord[], key: string): void {
	const seen = new Set<string>();
	for (const value of values) {
		const id = requireString(value, key);
		if (seen.has(id)) errors.push(`duplicate ${key}: ${id}`);
		seen.add(id);
	}
}

function assertEqual(actual: unknown, expected: string, message: string): void {
	if (actual !== expected) errors.push(message);
}

function readJsonl(path: string): JsonRecord[] {
	return readFileSync(path, "utf8")
		.split("\n")
		.filter((line) => line.trim().length > 0)
		.map((line) => JSON.parse(line) as JsonRecord);
}

function requireString(record: JsonRecord, key: string): string {
	const value = record[key];
	if (typeof value !== "string" || value.length === 0) throw new Error(`Missing string ${key}`);
	return value;
}

function extractSnapshot(content: string): string {
	const heading = "## Source Snapshot";
	const start = content.indexOf(heading);
	const bodyStart = content.indexOf("\n", start + heading.length) + 1;
	const end = content.indexOf("## Research Notes", bodyStart);
	if (start < 0 || bodyStart === 0 || end < 0)
		throw new Error("Invalid Source Snapshot boundaries");
	return `${content.slice(bodyStart, end).trim()}\n`;
}

function normalizeNewlines(value: string): string {
	return value.replace(/\r\n?/g, "\n");
}

function sha256(value: string): string {
	return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function isRecord(value: unknown): value is JsonRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
