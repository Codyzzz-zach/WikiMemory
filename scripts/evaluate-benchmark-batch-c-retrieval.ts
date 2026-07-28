import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

type JsonRecord = Record<string, unknown>;

const projectRoot = process.cwd();
const experimentRoot = join(projectRoot, "experiments", "benchmark-batch-c");
const evaluationId = process.env.WGE_BATCH_C_RETRIEVAL_EVAL_ID ?? "blind-first-run";
const preparationRoot =
	evaluationId === "blind-first-run"
		? join(experimentRoot, "blind-first-run", "offline")
		: join(experimentRoot, "post-hoc", "preparations", evaluationId);
const tasks = readJsonl(
	join(experimentRoot, "stage-b-evaluator", "normalized-gold", "tasks.jsonl"),
);
const preparation = asRecord(
	readJson(join(preparationRoot, "context-preparation.json")),
	"context preparation",
);
const preparedRows = recordArray(preparation.rows);
const rows: JsonRecord[] = [];

for (const task of tasks) {
	const questionId = requireString(task, "caseId");
	const eligibility = requireString(task, "scoreEligibility");
	const evidence = recordArray(task.requiredEvidence).filter(
		(item) => typeof item.exactQuote === "string" && item.exactQuote.length > 0,
	);
	for (const group of ["B", "P-seed", "P-graph"]) {
		const prepared = preparedRows.find(
			(item) => item.questionId === questionId && item.group === group,
		);
		if (!prepared) throw new Error(`Missing prepared row ${questionId} ${group}`);
		const contextPath = join(preparationRoot, "contexts", `${questionId}--${group}.txt`);
		const context = readFileSync(contextPath, "utf8");
		if (sha256(context) !== requireString(prepared, "contextHash")) {
			throw new Error(`Context hash mismatch ${questionId} ${group}`);
		}
		const normalizedContext = normalize(context);
		const matched = evidence.filter((item) =>
			normalizedContext.includes(normalize(requireString(item, "exactQuote"))),
		);
		rows.push({
			questionId,
			group,
			eligibility,
			requiredEvidenceItems: evidence.length,
			matchedEvidenceItems: matched.length,
			allRequiredEvidencePresent: evidence.length > 0 && matched.length === evidence.length,
			matchedQuotes: matched.map((item) => requireString(item, "exactQuote")),
			missingQuotes: evidence
				.filter((item) => !matched.includes(item))
				.map((item) => requireString(item, "exactQuote")),
		});
	}
}

const primary = rows.filter((row) => row.eligibility === "primary");
const summary = Object.fromEntries(
	["B", "P-seed", "P-graph"].map((group) => {
		const selected = primary.filter((row) => row.group === group);
		const required = sum(selected.map((row) => Number(row.requiredEvidenceItems)));
		const matched = sum(selected.map((row) => Number(row.matchedEvidenceItems)));
		return [
			group,
			{
				questions: selected.length,
				requiredEvidenceItems: required,
				matchedEvidenceItems: matched,
				evidenceItemRecall: required === 0 ? null : round(matched / required),
				questionsWithAllRequiredEvidence: selected.filter(
					(row) => row.allRequiredEvidencePresent === true,
				).length,
			},
		];
	}),
);
const report = {
	schemaVersion: "wge-batch-c-retrieval-gold-evaluation/v1",
	status: "POST_REVEAL_DIAGNOSTIC",
	evaluationId,
	preparationRoot,
	summary,
	rows,
	limitations: [
		"Exact-quote presence measures retrieval evidence availability, not answer correctness.",
		"Stage B Gold was produced post-answer and is diagnostic rather than confirmatory.",
	],
};
const outputPath = join(
	experimentRoot,
	"stage-b-evaluator",
	"retrieval-evaluations",
	`${evaluationId}.json`,
);
writeJson(outputPath, report);
console.log(JSON.stringify({ outputPath, summary }, null, 2));

function normalize(value: string) {
	return value
		.normalize("NFKC")
		.replace(/(^|\s)[>*#-]+\s+/gu, "$1")
		.replace(/[*_`]+/gu, "")
		.replace(/\s+/gu, " ")
		.trim();
}
function round(value: number) {
	return Math.round(value * 1000) / 1000;
}
function sum(values: number[]) {
	return values.reduce((total, value) => total + value, 0);
}
function sha256(value: string) {
	return createHash("sha256").update(value).digest("hex");
}
function readJson(path: string): unknown {
	return JSON.parse(readFileSync(path, "utf8"));
}
function readJsonl(path: string): JsonRecord[] {
	return readFileSync(path, "utf8")
		.split(/\r?\n/u)
		.filter((line) => line.trim().length > 0)
		.map((line) => asRecord(JSON.parse(line), path));
}
function writeJson(path: string, value: unknown) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
function asRecord(value: unknown, label: string): JsonRecord {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${label} must be an object`);
	}
	return value as JsonRecord;
}
function recordArray(value: unknown): JsonRecord[] {
	if (!Array.isArray(value)) throw new Error("Expected record array");
	return value.map((item) => asRecord(item, "array item"));
}
function requireString(record: JsonRecord, key: string) {
	const value = record[key];
	if (typeof value !== "string" || value.length === 0) throw new Error(`${key} must be a string`);
	return value;
}
