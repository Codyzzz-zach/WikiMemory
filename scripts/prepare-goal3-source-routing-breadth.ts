import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type JsonRecord = Record<string, unknown>;

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = join(projectRoot, "workbuddy-batch-b/generated/candidates/tasks.jsonl");
const outputRoot = join(projectRoot, "experiments/goal3/source-routing-breadth-v1");
if (existsSync(outputRoot)) throw new Error(`Refusing to overwrite ${outputRoot}`);

const sourceText = readFileSync(sourcePath, "utf8");
const rows = sourceText
	.split(/\r?\n/u)
	.filter((line) => line.trim().length > 0)
	.map((line) => JSON.parse(line) as JsonRecord);
if (rows.length !== 32) throw new Error(`Expected 32 Batch B tasks, got ${rows.length}`);

const questions = rows.map((row) => ({
	caseId: requiredString(row, "caseId"),
	questionType: requiredString(row, "questionType"),
	question: requiredString(row, "question"),
	answerability: requiredString(row, "answerability"),
}));
const gold = rows.map((row) => ({
	caseId: requiredString(row, "caseId"),
	requiredEvidence: Array.isArray(row.requiredEvidence) ? row.requiredEvidence : [],
}));
const questionText = toJsonl(questions);
const goldText = toJsonl(gold);

mkdirSync(outputRoot, { recursive: true });
writeFileSync(join(outputRoot, "questions-public.jsonl"), questionText, { flag: "wx" });
writeFileSync(join(outputRoot, "diagnostic-gold.jsonl"), goldText, { flag: "wx" });
writeFileSync(
	join(outputRoot, "manifest.json"),
	`${JSON.stringify(
		{
			schemaVersion: "wge-goal3-source-routing-breadth-input/v1",
			status: "POST_HOC_DEV_REGRESSION",
			source: { path: sourcePath, sha256: sha256(sourceText), count: rows.length },
			questions: { sha256: sha256(questionText), count: questions.length },
			diagnosticGold: { sha256: sha256(goldText), count: gold.length },
		},
		null,
		2,
	)}\n`,
	{ flag: "wx" },
);

function requiredString(row: JsonRecord, key: string): string {
	const value = row[key];
	if (typeof value !== "string" || value.length === 0) throw new Error(`Missing ${key}`);
	return value;
}

function toJsonl(rows: unknown[]): string {
	return `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}
