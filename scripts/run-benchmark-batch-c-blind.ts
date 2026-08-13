import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { estimateTokens } from "../src/compiler/telemetry.js";
import { loadConfig } from "../src/config/index.js";
import { createLLMProvider } from "../src/core/llm-provider.js";
import type { PilotConfig } from "../src/pilot/index.js";

type JsonRecord = Record<string, unknown>;

const answerSystemPrompt = `你是受证据约束的问答 Agent。只使用本次请求提供的检索上下文回答。
要求：保留影响结论的条件、时间、例外、来源角色与不确定性；关键结论引用上下文中的 SOURCE、EVIDENCE 或 CLAIM 标识；上下文不足时明确说明，不得用外部常识补齐。
只输出严格 JSON：{"answer":"...","citations":["..."],"insufficient":false,"uncertainties":["..."]}。`;

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const experimentRoot = join(projectRoot, "experiments", "benchmark-batch-c");
const freezeRoot = join(experimentRoot, "stage-a-freeze");
const preparationId = process.env.WGE_BATCH_C_PREP_RUN_ID;
const offlineRoot = preparationId
	? join(experimentRoot, "post-hoc", "preparations", preparationId)
	: join(experimentRoot, "blind-first-run", "offline");
const selection = readJson<JsonRecord>(join(freezeRoot, "selection.json"));
const config = readJson<PilotConfig>(join(freezeRoot, "config.json"));
const taskPath = resolve(experimentRoot, requireString(selection, "taskFile"));
const taskText = readFileSync(taskPath, "utf8");
if (sha256(taskText) !== requireString(selection, "taskFileSha256"))
	throw new Error("Public question file drifted");
const questions = new Map(
	readJsonl(taskPath).map((row) => [requireString(row, "caseId"), row] as const),
);
const frozenQuestionIds = stringArray(selection.questionIds);
const questionIds = process.env.WGE_BATCH_C_QUESTION_IDS
	? process.env.WGE_BATCH_C_QUESTION_IDS.split(",").map((value) => value.trim())
	: frozenQuestionIds;
if (questionIds.some((questionId) => !frozenQuestionIds.includes(questionId))) {
	throw new Error("Post-hoc question selection contains an unfrozen question");
}
const groups = process.env.WGE_BATCH_C_GROUPS
	? process.env.WGE_BATCH_C_GROUPS.split(",").map((value) => value.trim())
	: ["B", "P-seed", "P-graph"];
if (groups.some((group) => !["B", "P-seed", "P-graph"].includes(group))) {
	throw new Error("Unknown Batch C group");
}
const offline = readJson<{
	contextBudgetTokens: number;
	rows: JsonRecord[];
}>(join(offlineRoot, "context-preparation.json"));
if (offline.rows.length < questionIds.length * groups.length)
	throw new Error("Offline preparation is incomplete");
const baseConfig = loadConfig({
	projectRoot: join(experimentRoot, "workspace"),
	model: config.answer.model,
	temperature: config.answer.temperature,
});
if (!baseConfig.apiKey) throw new Error("DEEPSEEK_API_KEY 未设置");
const provider = createLLMProvider(baseConfig);
const runId = `batch-c-${preparationId ? "posthoc" : "blind-first"}-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`;
const runRoot = preparationId
	? join(experimentRoot, "post-hoc", "answers", runId)
	: join(experimentRoot, "blind-first-run", "answers", runId);
mkdirSync(join(runRoot, "records"), { recursive: true });
const publicAnswers: JsonRecord[] = [];
let returnedModel: string | null = null;
for (const questionId of questionIds) {
	const question = questions.get(questionId);
	if (!question) throw new Error(`Missing question ${questionId}`);
	const questionText = requireString(question, "question");
	for (const group of orderedGroups(questionId).filter((group) => groups.includes(group))) {
		const row = offline.rows.find((item) => item.questionId === questionId && item.group === group);
		if (!row) throw new Error(`Missing offline context ${questionId} ${group}`);
		const contextPath = join(offlineRoot, "contexts", `${questionId}--${group}.txt`);
		const context = readFileSync(contextPath, "utf8");
		if (sha256(context) !== requireString(row, "contextHash"))
			throw new Error(`Context drift: ${questionId} ${group}`);
		const userPrompt = `# 问题\n${questionText}\n\n# 检索上下文\n${context}`;
		const startedAt = Date.now();
		const result = await provider.chat({
			model: config.answer.model,
			temperature: config.answer.temperature,
			thinkingDisabled: config.answer.thinkingDisabled,
			systemPrompt: answerSystemPrompt,
			messages: [{ role: "user", content: userPrompt }],
			responseFormat: "json_object",
			maxTokens: config.answer.maxOutputTokens,
		});
		if (returnedModel === null) returnedModel = result.model;
		else if (returnedModel !== result.model)
			throw new Error(`Answer model drift: ${returnedModel} -> ${result.model}`);
		const sampleId = `sample-${randomUUID()}`;
		const citationValidation = validateCitations(result.content, userPrompt);
		const record = {
			runId,
			sampleId,
			questionId,
			group,
			modelRequested: config.answer.model,
			modelReturned: result.model,
			temperature: config.answer.temperature,
			finishReason: result.finishReason,
			usage: result.usage,
			latencyMs: Date.now() - startedAt,
			promptHash: sha256(`${answerSystemPrompt}\n${userPrompt}`),
			contextHash: sha256(context),
			questionHash: row.questionHash,
			configHash: row.configHash,
			knowledgeSnapshotHash: row.knowledgeSnapshotHash,
			inputSnapshotHash: row.inputSnapshotHash,
			traceHash: row.traceHash,
			estimatedContextTokens: Number(row.estimatedContextTokens),
			estimatedInputTokens: estimateTokens(`${answerSystemPrompt}\n${userPrompt}`),
			toolCalls: Number(row.toolCalls),
			retrievedClaims: row.retrievedClaims,
			retrievedRelations: row.retrievedRelations,
			retrievedSources: row.retrievedSources,
			retrievalTrace: row.retrievalTrace,
			citationValidation,
			request: { systemPrompt: answerSystemPrompt, userPrompt },
			answer: result.content,
			answerFormatValid: isAnswerFormatValid(result.content),
		};
		writeJson(join(runRoot, "records", `${questionId}--${group}.json`), record);
		publicAnswers.push({ sampleId, questionId, answer: result.content, citationValidation });
		console.error(`sealed answer ${questionId} ${group}`);
	}
}
writeJson(join(runRoot, "blind-answers.json"), publicAnswers);
writeJson(
	join(runRoot, "blinding-key.json"),
	publicAnswers.map((answer) => {
		const record = readJson<JsonRecord>(
			join(
				runRoot,
				"records",
				`${answer.questionId}--${findGroup(answer.sampleId as string, runRoot, answer.questionId as string)}.json`,
			),
		);
		return { sampleId: answer.sampleId, questionId: answer.questionId, group: record.group };
	}),
);
writeJson(join(runRoot, "manifest.json"), {
	schemaVersion: "wge-batch-c-blind-answers/v1",
	status: preparationId ? "SEALED_POST_HOC" : "SEALED_AWAITING_STAGE_B",
	runId,
	createdAt: new Date().toISOString(),
	questionFileHash: `sha256:${sha256(taskText)}`,
	configHash: `sha256:${sha256(readFileSync(join(freezeRoot, "config.json"), "utf8"))}`,
	preparationConfigHashes: [
		...new Set(offline.rows.map((row) => requireString(row, "configHash"))),
	],
	knowledgeSnapshotHashes: [
		...new Set(
			offline.rows
				.map((row) => row.knowledgeSnapshotHash)
				.filter((value): value is string => typeof value === "string"),
		),
	],
	inputSnapshotHashes: [
		...new Set(offline.rows.map((row) => requireString(row, "inputSnapshotHash"))),
	],
	contextTraceHashes: offline.rows
		.filter(
			(row) =>
				questionIds.includes(requireString(row, "questionId")) &&
				groups.includes(requireString(row, "group")),
		)
		.map((row) => requireString(row, "traceHash")),
	answerPromptHash: `sha256:${sha256(answerSystemPrompt)}`,
	modelRequested: config.answer.model,
	modelReturned: returnedModel,
	temperature: config.answer.temperature,
	contextBudgetTokens: offline.contextBudgetTokens,
	questions: questionIds.length,
	answers: publicAnswers.length,
	stageBRead: preparationId !== undefined,
	preparationId: preparationId ?? null,
});
console.log(
	JSON.stringify(
		{
			status: preparationId ? "SEALED_POST_HOC" : "SEALED_AWAITING_STAGE_B",
			runRoot,
			answers: publicAnswers.length,
		},
		null,
		2,
	),
);

function orderedGroups(seed: string): string[] {
	const groups = ["B", "P-seed", "P-graph"];
	const offset = Number.parseInt(sha256(seed).slice(0, 8), 16) % groups.length;
	return [...groups.slice(offset), ...groups.slice(0, offset)];
}
function findGroup(sampleId: string, runRoot: string, questionId: string): string {
	for (const group of groups) {
		const path = join(runRoot, "records", `${questionId}--${group}.json`);
		const record = readJson<JsonRecord>(path);
		if (record.sampleId === sampleId) return group;
	}
	throw new Error(`Missing group for ${sampleId}`);
}
function validateCitations(content: string, prompt: string): JsonRecord {
	try {
		const parsed = JSON.parse(content) as JsonRecord;
		const citations = stringArray(parsed.citations ?? []);
		const invalid = citations.filter((citation) => !prompt.includes(citation));
		return { valid: invalid.length === 0, citationCount: citations.length, invalid };
	} catch {
		return { valid: false, citationCount: 0, invalid: ["answer-json-invalid"] };
	}
}
function isAnswerFormatValid(content: string): boolean {
	try {
		const parsed = JSON.parse(content) as JsonRecord;
		return (
			typeof parsed.answer === "string" &&
			Array.isArray(parsed.citations) &&
			typeof parsed.insufficient === "boolean" &&
			Array.isArray(parsed.uncertainties)
		);
	} catch {
		return false;
	}
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
