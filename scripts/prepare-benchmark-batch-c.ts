import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config/index.js";
import type { PilotConfig, PilotGroup } from "../src/pilot/index.js";
import { preparePilotContext } from "../src/pilot/index.js";

type JsonRecord = Record<string, unknown>;

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const experimentRoot = join(projectRoot, "experiments", "benchmark-batch-c");
const freezeRoot = join(experimentRoot, "stage-a-freeze");
const workspaceRoot = join(experimentRoot, "workspace");
const preparationId = process.env.WGE_BATCH_C_PREP_RUN_ID;
const reportRoot = preparationId
	? join(experimentRoot, "post-hoc", "preparations", preparationId)
	: join(experimentRoot, "blind-first-run", "offline");
const selection = readJson<JsonRecord>(join(freezeRoot, "selection.json"));
const frozenConfig = readJson<PilotConfig>(join(freezeRoot, "config.json"));
const requestedBudget = process.env.WGE_BATCH_C_CONTEXT_BUDGET_TOKENS
	? Number(process.env.WGE_BATCH_C_CONTEXT_BUDGET_TOKENS)
	: null;
if (requestedBudget !== null && !preparationId) {
	throw new Error("A budget override is allowed only for an explicitly named post-hoc preparation");
}
if (requestedBudget !== null && (!Number.isSafeInteger(requestedBudget) || requestedBudget <= 0)) {
	throw new Error(`Invalid post-hoc context budget: ${String(requestedBudget)}`);
}
const config: PilotConfig =
	requestedBudget === null
		? frozenConfig
		: {
				...frozenConfig,
				retrieval: { ...frozenConfig.retrieval, contextBudgetTokens: requestedBudget },
			};
const taskPath = resolve(experimentRoot, requireString(selection, "taskFile"));
const taskText = readFileSync(taskPath, "utf8");
if (sha256(taskText) !== requireString(selection, "taskFileSha256"))
	throw new Error("Public question file drifted after Stage A freeze");
const questionsById = new Map(
	readJsonl(taskPath).map((row) => [requireString(row, "caseId"), row] as const),
);
const frozenQuestionIds = stringArray(selection.questionIds);
const requestedQuestionIds = (process.env.WGE_BATCH_C_QUESTION_IDS ?? "")
	.split(",")
	.map((id) => id.trim())
	.filter(Boolean);
if (requestedQuestionIds.length > 0 && !preparationId) {
	throw new Error("A question subset is allowed only for an explicitly named post-hoc preparation");
}
const questionIds =
	requestedQuestionIds.length === 0
		? frozenQuestionIds
		: requestedQuestionIds.map((id) => {
				if (!frozenQuestionIds.includes(id)) throw new Error(`Question is outside freeze: ${id}`);
				return id;
			});
const appConfig = loadConfig({ projectRoot: workspaceRoot });
const modes = [
	{ id: "B", pilotGroup: "B", graphExpansion: false },
	{ id: "P-seed", pilotGroup: "P", graphExpansion: false },
	{ id: "P-graph", pilotGroup: "P", graphExpansion: true },
] as const;
if (!preparationId && existsSync(join(reportRoot, "context-preparation.json"))) {
	throw new Error(
		"Blind first-run contexts are sealed. Set WGE_BATCH_C_PREP_RUN_ID for a post-hoc preparation.",
	);
}
mkdirSync(join(reportRoot, "contexts"), { recursive: true });
const rows: JsonRecord[] = [];
for (const questionId of questionIds) {
	const question = questionsById.get(questionId);
	if (!question) throw new Error(`Missing frozen question ${questionId}`);
	const questionText = requireString(question, "question");
	for (const mode of modes) {
		const prepared = preparePilotContext(
			appConfig,
			config,
			{ id: questionId, question: questionText },
			mode.pilotGroup as PilotGroup,
			{ graphExpansion: mode.graphExpansion },
		);
		const contextPath = join(reportRoot, "contexts", `${questionId}--${mode.id}.txt`);
		writeFileSync(contextPath, prepared.context, "utf8");
		rows.push({
			questionId,
			group: mode.id,
			question: questionText,
			estimatedContextTokens: prepared.estimatedContextTokens,
			contextHash: prepared.contextHash,
			questionHash: prepared.questionHash,
			configHash: prepared.configHash,
			knowledgeSnapshotHash: prepared.knowledgeSnapshotHash,
			inputSnapshotHash: prepared.inputSnapshotHash,
			traceHash: prepared.traceHash,
			retrievedClaims: prepared.retrievedClaims,
			retrievedRelations: prepared.retrievedRelations,
			retrievedSources: prepared.retrievedSources,
			evidenceSpanCount: prepared.evidenceSpans.length,
			toolCalls: prepared.toolCalls,
			droppedContext: prepared.droppedContext,
			retrievalTrace: prepared.retrievalTrace,
		});
	}
}
const summary = modes.map((mode) => {
	const groupRows = rows.filter((row) => row.group === mode.id);
	return {
		group: mode.id,
		questions: groupRows.length,
		emptyContexts: groupRows.filter((row) => Number(row.estimatedContextTokens) <= 1).length,
		zeroClaimContexts: groupRows.filter(
			(row) => Array.isArray(row.retrievedClaims) && row.retrievedClaims.length === 0,
		).length,
		averageContextTokens: average(groupRows.map((row) => Number(row.estimatedContextTokens))),
		maximumContextTokens: Math.max(...groupRows.map((row) => Number(row.estimatedContextTokens))),
		averageClaims: average(groupRows.map((row) => arrayLength(row.retrievedClaims))),
		averageRelations: average(groupRows.map((row) => arrayLength(row.retrievedRelations))),
		averageSources: average(groupRows.map((row) => arrayLength(row.retrievedSources))),
	};
});
const report = {
	schemaVersion: "wge-batch-c-offline-preparation/v1",
	status: preparationId ? "PREPARED_POST_HOC" : "PREPARED_BLIND_NO_GOLD",
	preparationId: preparationId ?? null,
	questionFileHash: `sha256:${sha256(taskText)}`,
	selectedQuestionIds: questionIds,
	contextBudgetTokens: config.retrieval.contextBudgetTokens,
	limitations: preparationId
		? [
				"This is a post-hoc retrieval preparation produced after Stage B reveal.",
				"It must not replace or be reported as the blind first-run result.",
				...(requestedBudget === null
					? []
					: [
							`The frozen context budget was overridden to ${requestedBudget} tokens for stress testing.`,
						]),
			]
		: [
				"No Stage B Gold or required evidence was available; this report measures retrieval shape and cost only.",
				"Evidence recall and answer correctness cannot be computed before the sealed Gold is revealed.",
			],
	summary,
	rows,
};
writeJson(join(reportRoot, "context-preparation.json"), report);
writeFileSync(
	join(reportRoot, "context-trace.jsonl"),
	`${rows.map((row) => JSON.stringify(row)).join("\n")}\n`,
);
console.log(JSON.stringify({ status: report.status, summary }, null, 2));

function average(values: number[]): number {
	return values.length === 0
		? 0
		: Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}
function arrayLength(value: unknown): number {
	return Array.isArray(value) ? value.length : 0;
}
function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}
function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, "utf8")) as T;
}
function readJsonl(path: string): JsonRecord[] {
	return readFileSync(path, "utf8")
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line) as JsonRecord);
}
function writeJson(path: string, value: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
function requireString(record: JsonRecord, key: string): string {
	const value = record[key];
	if (typeof value !== "string" || value.length === 0) throw new Error(`Missing string ${key}`);
	return value;
}
function stringArray(value: unknown): string[] {
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
		throw new Error("Expected string array");
	return value as string[];
}
