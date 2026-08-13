import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { estimateTokens } from "../src/compiler/telemetry.js";
import { loadConfig } from "../src/config/index.js";
import { createLLMProvider } from "../src/core/llm-provider.js";
import type { PilotConfig, PilotQuestion } from "../src/pilot/index.js";

type JsonRecord = Record<string, unknown>;
type Group = "B" | "P-seed" | "P-graph";

interface QuestionFile {
	questions: PilotQuestion[];
}

interface GoldQuestion {
	id: string;
	sourceRisk: { present: boolean; detail: string };
	evidence: unknown[];
}

interface GoldFile {
	scoringContract: unknown;
	questionGold: GoldQuestion[];
}

interface JudgeScore {
	sampleId: string;
	requiredClaimCoverage: number;
	conditionFidelity: number;
	evidenceGrounding: number;
	answerabilityDiscipline: number;
	hardFailure: boolean;
	rationale: string;
}

const answerSystemPrompt = `你是受证据约束的问答 Agent。只使用本次请求提供的检索上下文回答。
要求：保留影响结论的条件、例外和不确定性；每个关键结论引用上下文中的 SOURCE、EVIDENCE 或 CLAIM 标识；上下文不足时明确说明，不得用外部常识补齐。
只输出严格 JSON：{"answer":"...","citations":["..."],"insufficient":false,"uncertainties":["..."]}。`;

const judgeSystemPrompt = `你是知识系统的盲测评分员。只按提供的冻结 Gold 和评分合同评价匿名答案，不判断答案来自哪个实验组。
逐项核对 requiredClaims、mustMentionConditions、forbiddenClaims、answerability 和证据引用。
只输出严格 JSON：{"scores":[{"sampleId":"...","requiredClaimCoverage":0,"conditionFidelity":0,"evidenceGrounding":0,"answerabilityDiscipline":0,"hardFailure":false,"rationale":"..."}]}。`;

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const options = parseArguments(process.argv.slice(2));
const preparationRoot = resolve(projectRoot, options.preparation);
const outputRoot = resolve(projectRoot, options.output);
if (existsSync(outputRoot)) throw new Error(`Refusing to overwrite answer run: ${outputRoot}`);

const preparation = readJson<JsonRecord>(join(preparationRoot, "context-preparation.json"));
const rows = recordArray(preparation.rows, "preparation.rows");
const questionIds = stringArray(preparation.triggeredQuestionIds, "triggeredQuestionIds");
if (questionIds.length === 0) throw new Error("Preparation has no triggered Graph questions");
const questions = readJson<QuestionFile>(
	join(projectRoot, "experiments", "pilot", "questions.json"),
);
const gold = readJson<GoldFile>(join(projectRoot, "experiments", "pilot", "gold-rubric.json"));
const config = readJson<PilotConfig>(join(projectRoot, "experiments", "pilot", "config.json"));
const questionById = new Map(questions.questions.map((question) => [question.id, question]));
const goldById = new Map(gold.questionGold.map((item) => [item.id, item]));
const appConfig = loadConfig({
	projectRoot,
	model: config.answer.model,
	temperature: config.answer.temperature,
});
if (!appConfig.apiKey) throw new Error("DEEPSEEK_API_KEY is not configured");
const provider = createLLMProvider(appConfig);
const groups: Group[] = ["B", "P-seed", "P-graph"];
const runId = basenameSafe(outputRoot);
mkdirSync(join(outputRoot, "records"), { recursive: true });

const blindAnswers: Array<{ sampleId: string; questionId: string; answer: string }> = [];
const blindingKey: Array<{ sampleId: string; questionId: string; group: Group }> = [];
let answerModelReturned: string | null = null;
for (const questionId of questionIds) {
	const question = questionById.get(questionId);
	if (!question) throw new Error(`Missing question: ${questionId}`);
	for (const group of deterministicOrder(groups, questionId)) {
		const row = uniquePreparationRow(rows, questionId, group);
		const contextPath = join(preparationRoot, "contexts", `${questionId}--${group}.txt`);
		const context = readFileSync(contextPath, "utf8");
		if (sha256(context) !== requireString(row, "contextHash")) {
			throw new Error(`Context hash mismatch: ${questionId}/${group}`);
		}
		const userPrompt = `# 问题\n${question.question}\n\n# 检索上下文\n${context}`;
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
		answerModelReturned ??= result.model;
		if (result.model !== answerModelReturned) throw new Error("Answer model drift within run");
		const sampleId = `sample-${randomUUID()}`;
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
			estimatedContextTokens: Number(row.estimatedContextTokens),
			estimatedInputTokens: estimateTokens(`${answerSystemPrompt}\n${userPrompt}`),
			retrievedClaims: row.retrievedClaims,
			retrievedRelations: row.retrievedRelations,
			retrievalTrace: row.retrievalTrace,
			citationValidation: validateCitations(result.content, userPrompt),
			answerFormatValid: isAnswerFormatValid(result.content),
			answer: result.content,
		};
		writeJson(join(outputRoot, "records", `${questionId}--${group}.json`), record);
		blindAnswers.push({ sampleId, questionId, answer: result.content });
		blindingKey.push({ sampleId, questionId, group });
		console.error(`answered ${questionId} ${group}`);
	}
}
writeJson(join(outputRoot, "blind-answers.json"), deterministicOrder(blindAnswers, runId));
writeJson(join(outputRoot, "blinding-key.json"), blindingKey);

const scored: Array<JudgeScore & { questionId: string; group: Group; total: number }> = [];
let judgeModelReturned: string | null = null;
for (const questionId of questionIds) {
	const question = questionById.get(questionId);
	const questionGold = goldById.get(questionId);
	if (!question || !questionGold) throw new Error(`Missing frozen Gold: ${questionId}`);
	const samples = blindAnswers
		.filter((answer) => answer.questionId === questionId)
		.map(({ sampleId, answer }) => ({ sampleId, answer }));
	const judgePrompt = buildJudgePrompt(gold.scoringContract, question, questionGold, samples);
	const result = await provider.chat({
		model: config.judge.model,
		temperature: config.judge.temperature,
		thinkingDisabled: config.judge.thinkingDisabled,
		systemPrompt: judgeSystemPrompt,
		messages: [{ role: "user", content: judgePrompt }],
		responseFormat: "json_object",
		maxTokens: config.judge.maxOutputTokens,
	});
	judgeModelReturned ??= result.model;
	if (result.model !== judgeModelReturned) throw new Error("Judge model drift within run");
	const scores = parseJudgeScores(result.content);
	if (scores.length !== groups.length) throw new Error(`Judge score count mismatch: ${questionId}`);
	for (const score of scores) {
		const key = blindingKey.find((item) => item.sampleId === score.sampleId);
		if (!key || key.questionId !== questionId)
			throw new Error(`Unknown judged sample: ${score.sampleId}`);
		scored.push({
			...score,
			questionId,
			group: key.group,
			total:
				score.requiredClaimCoverage +
				score.conditionFidelity +
				score.evidenceGrounding +
				score.answerabilityDiscipline,
		});
	}
	writeJson(join(outputRoot, `judge-${questionId}.json`), {
		modelRequested: config.judge.model,
		modelReturned: result.model,
		finishReason: result.finishReason,
		usage: result.usage,
		promptHash: sha256(`${judgeSystemPrompt}\n${judgePrompt}`),
		raw: result.content,
	});
	console.error(`judged ${questionId}`);
}

const aggregates = Object.fromEntries(
	groups.map((group) => {
		const selected = scored.filter((row) => row.group === group);
		return [
			group,
			{
				n: selected.length,
				averageTotal: average(selected.map((row) => row.total)),
				averageRequiredClaimCoverage: average(selected.map((row) => row.requiredClaimCoverage)),
				averageConditionFidelity: average(selected.map((row) => row.conditionFidelity)),
				averageEvidenceGrounding: average(selected.map((row) => row.evidenceGrounding)),
				averageAnswerabilityDiscipline: average(selected.map((row) => row.answerabilityDiscipline)),
				hardFailures: selected.filter((row) => row.hardFailure).length,
				averageContextTokens: average(
					rows
						.filter(
							(row) =>
								row.group === group && questionIds.includes(requireString(row, "questionId")),
						)
						.map((row) => Number(row.estimatedContextTokens)),
				),
			},
		];
	}),
);
const report = {
	schemaVersion: "wge-goal1-conditional-graph-answer-micro/v1",
	status: "POST_HOC_DEV_PROXY_SCORED",
	createdAt: new Date().toISOString(),
	preparation: options.preparation,
	preparationHash: sha256(readFileSync(join(preparationRoot, "context-preparation.json"), "utf8")),
	questionIds,
	groups,
	answerModelRequested: config.answer.model,
	answerModelReturned,
	judgeModelRequested: config.judge.model,
	judgeModelReturned,
	temperature: config.answer.temperature,
	aggregates,
	scores: scored,
	limitations: [
		"This is a two-question post-hoc development Micro selected because Graph actually triggered.",
		"The judge is an AI proxy using frozen Pilot Gold; it is not a human evaluation.",
		"The result can reject a Graph policy or justify a larger blind test, but cannot establish product value.",
	],
};
writeJson(join(outputRoot, "score-report.json"), report);
writeJson(join(outputRoot, "manifest.json"), {
	schemaVersion: "wge-goal1-answer-run/v1",
	runId,
	createdAt: report.createdAt,
	questionIds,
	groups,
	answerPromptHash: sha256(answerSystemPrompt),
	judgePromptHash: sha256(judgeSystemPrompt),
	preparationHash: report.preparationHash,
	recordHashes: questionIds.flatMap((questionId) =>
		groups.map((group) => {
			const file = `${questionId}--${group}.json`;
			return {
				file,
				sha256: sha256(readFileSync(join(outputRoot, "records", file), "utf8")),
			};
		}),
	),
});
console.log(JSON.stringify(report, null, 2));

function buildJudgePrompt(
	scoringContract: unknown,
	question: PilotQuestion,
	gold: GoldQuestion,
	samples: Array<{ sampleId: string; answer: string }>,
): string {
	return `# 评分合同\n${JSON.stringify(scoringContract, null, 2)}\n\n# 题目与 Gold\n${JSON.stringify(
		{
			question: question.question,
			answerability: question.answerability,
			requiredClaims: question.requiredClaims,
			mustMentionConditions: question.mustMentionConditions,
			forbiddenClaims: question.forbiddenClaims,
			sourceRisk: gold.sourceRisk,
			evidence: gold.evidence,
		},
		null,
		2,
	)}\n\n# 匿名答案\n${JSON.stringify(samples, null, 2)}`;
}

function parseJudgeScores(content: string): JudgeScore[] {
	const value = JSON.parse(stripFence(content)) as { scores?: unknown };
	if (!Array.isArray(value.scores)) throw new Error("Judge output has no scores array");
	return value.scores.map((candidate) => {
		const row = record(candidate, "judge score");
		return {
			sampleId: requireString(row, "sampleId"),
			requiredClaimCoverage: boundedScore(row.requiredClaimCoverage, "requiredClaimCoverage"),
			conditionFidelity: boundedScore(row.conditionFidelity, "conditionFidelity"),
			evidenceGrounding: boundedScore(row.evidenceGrounding, "evidenceGrounding"),
			answerabilityDiscipline: boundedScore(row.answerabilityDiscipline, "answerabilityDiscipline"),
			hardFailure: row.hardFailure === true,
			rationale: requireString(row, "rationale"),
		};
	});
}

function boundedScore(value: unknown, label: string): number {
	if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 2) {
		throw new Error(`Invalid ${label}: ${String(value)}`);
	}
	return Number(value);
}

function validateCitations(content: string, prompt: string): JsonRecord {
	try {
		const parsed = JSON.parse(stripFence(content)) as JsonRecord;
		const citations = stringArray(parsed.citations ?? [], "citations");
		const invalid = citations.filter((citation) => !prompt.includes(citation));
		return { valid: invalid.length === 0, citationCount: citations.length, invalid };
	} catch {
		return { valid: false, citationCount: 0, invalid: ["answer-json-invalid"] };
	}
}

function isAnswerFormatValid(content: string): boolean {
	try {
		const parsed = JSON.parse(stripFence(content)) as JsonRecord;
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

function parseArguments(argv: string[]): { preparation: string; output: string } {
	let preparation: string | undefined;
	let output: string | undefined;
	for (let index = 0; index < argv.length; index += 1) {
		const value = argv[index];
		if (value === "--preparation") preparation = requiredValue(argv, ++index, value);
		else if (value === "--output") output = requiredValue(argv, ++index, value);
		else throw new Error(`Unknown argument: ${value}`);
	}
	if (!preparation || !output) throw new Error("--preparation and --output are required");
	return { preparation, output };
}

function requiredValue(argv: string[], index: number, flag: string): string {
	const value = argv[index];
	if (!value) throw new Error(`${flag} requires a value`);
	return value;
}

function uniquePreparationRow(rows: JsonRecord[], questionId: string, group: Group): JsonRecord {
	const selected = rows.filter((row) => row.questionId === questionId && row.group === group);
	if (selected.length !== 1)
		throw new Error(`Expected one preparation row: ${questionId}/${group}`);
	return selected[0] as JsonRecord;
}

function deterministicOrder<T>(items: T[], seed: string): T[] {
	return [...items].sort((left, right) =>
		sha256(`${seed}:${JSON.stringify(left)}`).localeCompare(
			sha256(`${seed}:${JSON.stringify(right)}`),
		),
	);
}

function basenameSafe(path: string): string {
	return path.split("/").filter(Boolean).at(-1) ?? `goal1-${Date.now()}`;
}

function average(values: number[]): number | null {
	return values.length === 0
		? null
		: Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4));
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function stripFence(value: string): string {
	return value
		.trim()
		.replace(/^```(?:json)?\s*/i, "")
		.replace(/\s*```$/, "");
}

function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, "utf8")) as T;
}

function writeJson(path: string, value: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function record(value: unknown, label: string): JsonRecord {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`Expected record: ${label}`);
	}
	return value as JsonRecord;
}

function recordArray(value: unknown, label: string): JsonRecord[] {
	if (!Array.isArray(value)) throw new Error(`Expected record array: ${label}`);
	return value.map((item) => record(item, label));
}

function requireString(row: JsonRecord, key: string): string {
	const value = row[key];
	if (typeof value !== "string" || value.length === 0) throw new Error(`Missing string: ${key}`);
	return value;
}

function stringArray(value: unknown, label: string): string[] {
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
		throw new Error(`Expected string array: ${label}`);
	}
	return value as string[];
}
