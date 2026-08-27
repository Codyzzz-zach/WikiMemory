import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type JsonRecord = Record<string, unknown>;

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const refinedRoot = resolve(process.argv[2] ?? join(projectRoot, "workbuddy-batch-a", "refined"));
const errors: string[] = [];
const manifest = readJsonl(join(refinedRoot, "source-manifest.jsonl"));
const tasks = readJsonl(join(refinedRoot, "data", "tasks-reviewed.jsonl"));
const facts = readJsonl(join(refinedRoot, "data", "facts-reviewed.jsonl"));
const risks = readJsonl(join(refinedRoot, "data", "adversarial-risks.jsonl"));
const relations = readJsonl(join(refinedRoot, "data", "relations-reviewed.jsonl"));
const episodes = readJsonl(join(refinedRoot, "data", "evolution-episodes-reviewed.jsonl"));
const canary = JSON.parse(
	readFileSync(join(refinedRoot, "audit", "canary.json"), "utf8"),
) as JsonRecord;

const sourceSnapshots = new Map<string, string>();
for (const entry of manifest) {
	const sourceId = requireString(entry, "sourceId");
	const path = join(refinedRoot, requireString(entry, "contentPath"));
	const content = normalizeNewlines(readFileSync(path, "utf8"));
	const snapshot = extractSnapshot(content);
	sourceSnapshots.set(sourceId, snapshot);
	assertEqual(entry.snapshotHash, sha256(snapshot), `${sourceId}: snapshotHash mismatch`);
	assertEqual(entry.artifactHash, sha256(content), `${sourceId}: artifactHash mismatch`);
}

const taskById = new Map(tasks.map((task) => [requireString(task, "caseId"), task]));
const validRelationEndpoints = new Set([
	...manifest.map((entry) => requireString(entry, "sourceId")),
	...facts.map((fact) => requireString(fact, "candidateId")),
]);
const cases = Array.isArray(canary.cases) ? (canary.cases as JsonRecord[]) : [];
if (cases.length !== 12) errors.push(`Canary case count ${cases.length} != 12`);
for (const item of cases) {
	const caseId = requireString(item, "caseId");
	const task = taskById.get(caseId);
	if (!task) {
		errors.push(`${caseId}: task missing`);
		continue;
	}
	validateEvidenceArray(task.requiredEvidence, `${caseId}.requiredEvidence`);
}

for (const fact of facts)
	validateQuote(fact.sourceId, fact.exactQuote, requireString(fact, "candidateId"));
for (const risk of risks)
	validateQuote(risk.sourceId, risk.sourceFact, requireString(risk, "riskId"));
for (const task of tasks) {
	if (
		task.answerability === "insufficient" &&
		(!Array.isArray(task.requiredEvidence) || task.requiredEvidence.length === 0)
	)
		continue;
	validateEvidenceArray(task.requiredEvidence, `${requireString(task, "caseId")}.requiredEvidence`);
}
for (const relation of relations) {
	const relationId = requireString(relation, "candidateId");
	validateEvidenceArray(relation.evidence, `${requireString(relation, "candidateId")}.evidence`);
	for (const endpoint of [requireString(relation, "from"), requireString(relation, "to")]) {
		if (!validRelationEndpoints.has(endpoint))
			errors.push(`${relationId}: unknown endpoint ${endpoint}`);
	}
	if (relation.relationAuditVersion !== "batch-a-relation-audit/v1") {
		errors.push(`${relationId}: relationAuditVersion missing`);
	}
}
for (const episode of episodes) {
	validateEvidenceArray(
		episode.chronologyEvidence,
		`${requireString(episode, "episodeId")}.chronologyEvidence`,
	);
}

const runContract = {
	schemaVersion: "wge-canary-run-contract/v1",
	status: errors.length === 0 ? "validated" : "failed",
	knowledgeVersion: sha256(
		manifest
			.map((entry) => `${String(entry.sourceId)}:${String(entry.snapshotHash)}`)
			.sort()
			.join("\n"),
	),
	promptHash: null,
	actualTokens: null,
	note: "Structure-only canary: prompt/tokens are intentionally null until an answer model is run.",
	counts: {
		sources: manifest.length,
		facts: facts.length,
		risks: risks.length,
		relations: relations.length,
		tasks: tasks.length,
		episodes: episodes.length,
		canaryCases: cases.length,
	},
	evidenceResolutionErrors: errors,
};
writeFileSync(
	join(refinedRoot, "audit", "canary-validation.json"),
	`${JSON.stringify(runContract, null, 2)}\n`,
	"utf8",
);

if (errors.length > 0) {
	console.error(`Batch A canary validation failed (${errors.length})`);
	for (const error of errors) console.error(`- ${error}`);
	process.exitCode = 1;
} else {
	console.log("Batch A canary validation passed");
	console.log(JSON.stringify(runContract.counts, null, 2));
}

function validateEvidenceArray(value: unknown, label: string): void {
	if (!Array.isArray(value) || value.length === 0) {
		errors.push(`${label}: missing or empty`);
		return;
	}
	for (const [index, item] of value.entries()) {
		if (!isRecord(item)) {
			errors.push(`${label}[${index}]: invalid object`);
			continue;
		}
		validateQuote(item.sourceId, item.exactQuote, `${label}[${index}]`);
	}
}

function validateQuote(sourceValue: unknown, quoteValue: unknown, label: string): void {
	if (typeof sourceValue !== "string" || typeof quoteValue !== "string") {
		errors.push(`${label}: invalid sourceId/exactQuote`);
		return;
	}
	const snapshot = sourceSnapshots.get(sourceValue);
	if (!snapshot) errors.push(`${label}: unknown source ${sourceValue}`);
	else if (!snapshot.includes(quoteValue))
		errors.push(`${label}: quote does not resolve in ${sourceValue}`);
}

function assertEqual(actual: unknown, expected: string, message: string): void {
	if (actual !== expected) errors.push(message);
}

function isRecord(value: unknown): value is JsonRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJsonl(path: string): JsonRecord[] {
	return readFileSync(path, "utf8")
		.split("\n")
		.filter((lineValue) => lineValue.trim().length > 0)
		.map((lineValue) => JSON.parse(lineValue) as JsonRecord);
}

function requireString(record: JsonRecord, key: string): string {
	const value = record[key];
	if (typeof value !== "string" || value.length === 0)
		throw new Error(`Missing string field: ${key}`);
	return value;
}

function extractSnapshot(content: string): string {
	const marker = "## Source Snapshot";
	const start = content.indexOf(marker);
	const bodyStart = content.indexOf("\n", start + marker.length) + 1;
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
