import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { estimateTokens } from "../src/compiler/telemetry.js";
import { loadConfig } from "../src/config/index.js";
import { createLLMProvider } from "../src/core/llm-provider.js";
import type { PilotConfig, PilotGroup } from "../src/pilot/index.js";
import { preparePilotContext } from "../src/pilot/index.js";

type JsonRecord = Record<string, unknown>;

interface Selection {
	taskFile: string;
	taskFileSha256: string;
	questionIds: string[];
	groups: Array<"B" | "P">;
}

interface ExperimentMode {
	id: string;
	pilotGroup: "B" | "P";
	graphExpansion: boolean;
}

interface JudgeScore {
	sampleId: string;
	requiredPointCoverage: number;
	conditionFidelity: number;
	evidenceGrounding: number;
	answerabilityDiscipline: number;
	hardFailure: boolean;
	rationale: string;
}

const answerSystemPrompt = `你是受证据约束的问答 Agent。只使用本次请求提供的检索上下文回答。
要求：保留影响结论的条件、时间、例外、来源角色与不确定性；关键结论引用上下文中的 SOURCE、EVIDENCE 或 CLAIM 标识；上下文不足时明确说明，不得用外部常识补齐。
只输出严格 JSON：{"answer":"...","citations":["..."],"insufficient":false,"uncertainties":["..."]}。`;

const judgeSystemPrompt = `你是盲测评分员，不知道答案属于哪个实验组。只按题目、评分锚点、Gold 证据和引用预校验评价，不用外部常识修正答案。
每个维度独立使用同一 0-4 锚点：4=完整且准确；3=大部分满足，仅轻微遗漏；2=部分满足，存在重要遗漏；1=仅有极少相关内容；0=缺失、反转或与证据冲突。
requiredPointCoverage 只看 requiredPoints；conditionFidelity 看条件、时间、来源角色和不确定性；evidenceGrounding 同时看关键结论是否与 Gold 证据一致以及 citationValidation；answerabilityDiscipline 看是否越界、编造或错误拒答。
citationValidation.valid 表示引用标识确实存在于该匿名样本收到的上下文。内部 CLAIM/SPAN/SOURCE 标识不需要出现在 Gold 文本中，不得仅因此扣分；但存在性有效不代表语义必然支持，仍需对照答案内容与 Gold。
若反转来源归属、抹掉关键条件/时间、把提案当最终规范或编造关键事实，hardFailure=true。
数值必须与 rationale 一致：若 rationale 说“完整覆盖且准确”，对应维度不能低于 3。
只输出严格 JSON：{"scores":[{"sampleId":"...","requiredPointCoverage":0,"conditionFidelity":0,"evidenceGrounding":0,"answerabilityDiscipline":0,"hardFailure":false,"rationale":"..."}]}。`;

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const experimentRoot = join(projectRoot, "experiments", "benchmark-seed-v1");
const workspaceRoot = join(experimentRoot, "workspace");
const smokeRoot = join(experimentRoot, "e4-smoke");
const selectionArgument = argumentValue("--selection");
const selectionPath = selectionArgument
	? resolve(projectRoot, selectionArgument)
	: join(smokeRoot, "selection.json");
const reportName = argumentValue("--report-name") ?? "e4-smoke";
const selection = readJson<Selection>(selectionPath);
const pilotConfig = readJson<PilotConfig>(join(smokeRoot, "config.json"));
const isAblation = process.argv.includes("--ablation");
const isAllModes = process.argv.includes("--all-modes");
const repetitionArgument = process.argv.indexOf("--repetitions");
const repetitions =
	repetitionArgument >= 0 ? Number(process.argv[repetitionArgument + 1] ?? Number.NaN) : 1;
if (!Number.isSafeInteger(repetitions) || repetitions < 1 || repetitions > 5) {
	throw new Error(`Invalid repetitions: ${String(repetitions)}`);
}
const ablationModes = readJson<{ modes: ExperimentMode[] }>(join(smokeRoot, "ablation.json")).modes;
const modes: ExperimentMode[] = isAllModes
	? ablationModes
	: isAblation
		? ablationModes.filter((mode) => mode.id !== "B")
		: selection.groups.map((group) => ({
				id: group,
				pilotGroup: group,
				graphExpansion: group === "P",
			}));
const taskPath = join(projectRoot, selection.taskFile);
const taskText = readFileSync(taskPath, "utf8");
if (selection.taskFileSha256 !== sha256(taskText)) throw new Error("E4 smoke task file drifted");
const taskById = new Map(
	readJsonl(taskPath).map((task) => [requireString(task, "caseId"), task] as const),
);
const allQuestions = selection.questionIds.map((id) => {
	const task = taskById.get(id);
	if (!task) throw new Error(`Missing question ${id}`);
	return task;
});
const questionArgument = process.argv.indexOf("--question");
const requestedQuestion = questionArgument >= 0 ? process.argv[questionArgument + 1] : undefined;
const questions = requestedQuestion
	? allQuestions.filter((question) => requireString(question, "caseId") === requestedQuestion)
	: allQuestions;
if (questions.length === 0)
	throw new Error(`Missing requested question ${String(requestedQuestion)}`);
const baseConfig = loadConfig({ projectRoot: workspaceRoot });
if (!baseConfig.apiKey) throw new Error("DEEPSEEK_API_KEY 未设置");
const answerProvider = createLLMProvider(
	loadConfig({
		projectRoot: workspaceRoot,
		model: pilotConfig.answer.model,
		temperature: pilotConfig.answer.temperature,
	}),
);
const judgeProvider = createLLMProvider(
	loadConfig({
		projectRoot: workspaceRoot,
		model: pilotConfig.judge.model,
		temperature: pilotConfig.judge.temperature,
	}),
);
const runLabel = reportName.replaceAll(/[^a-zA-Z0-9-]/g, "-");
const runId = `${runLabel}-${isAllModes ? "all-modes" : isAblation ? "graph-ablation" : "run"}-${new Date()
	.toISOString()
	.replaceAll(/[:.]/g, "-")}`;
const runRoot = join(experimentRoot, "reports", reportName, "runs", runId);
mkdirSync(join(runRoot, "records"), { recursive: true });
mkdirSync(join(runRoot, "judge-records"), { recursive: true });

const blindAnswers: Array<{
	sampleId: string;
	questionId: string;
	repetition: number;
	answer: string;
	citationValidation: JsonRecord;
}> = [];
const blindingKey: Array<{
	sampleId: string;
	questionId: string;
	group: string;
	repetition: number;
}> = [];
let answerModelReturned: string | null = null;

for (const question of questions) {
	const questionId = requireString(question, "caseId");
	const questionText = requireString(question, "question");
	for (let repetition = 1; repetition <= repetitions; repetition++) {
		for (const mode of orderedModes(modes, `${questionId}:${repetition}`)) {
			const prepared = preparePilotContext(
				baseConfig,
				pilotConfig,
				{ id: questionId, question: questionText },
				mode.pilotGroup as PilotGroup,
				{ graphExpansion: mode.graphExpansion },
			);
			const userPrompt = `# 问题\n${questionText}\n\n# 检索上下文\n${prepared.context}`;
			const startedAt = Date.now();
			const result = await answerProvider.chat({
				model: pilotConfig.answer.model,
				temperature: pilotConfig.answer.temperature,
				thinkingDisabled: pilotConfig.answer.thinkingDisabled,
				systemPrompt: answerSystemPrompt,
				messages: [{ role: "user", content: userPrompt }],
				responseFormat: "json_object",
				maxTokens: pilotConfig.answer.maxOutputTokens,
			});
			answerModelReturned = assertStableModel(answerModelReturned, result.model, "answer");
			const sampleId = `sample-${randomUUID()}`;
			const record = {
				runId,
				sampleId,
				questionId,
				group: mode.id,
				pilotGroup: mode.pilotGroup,
				graphExpansion: mode.graphExpansion,
				repetition,
				modelRequested: pilotConfig.answer.model,
				modelReturned: result.model,
				temperature: pilotConfig.answer.temperature,
				finishReason: result.finishReason,
				usage: result.usage,
				latencyMs: Date.now() - startedAt,
				promptHash: sha256(`${answerSystemPrompt}\n${userPrompt}`),
				contextHash: prepared.contextHash,
				estimatedContextTokens: prepared.estimatedContextTokens,
				estimatedInputTokens: estimateTokens(`${answerSystemPrompt}\n${userPrompt}`),
				retrievedClaims: prepared.retrievedClaims,
				retrievedRelations: prepared.retrievedRelations,
				retrievedSources: prepared.retrievedSources,
				droppedContext: prepared.droppedContext,
				retrievalTrace: prepared.retrievalTrace,
				request: { systemPrompt: answerSystemPrompt, userPrompt },
				answer: result.content,
				answerFormatValid: isAnswerFormatValid(result.content),
			};
			writeJson(join(runRoot, "records", `${questionId}--${mode.id}--r${repetition}.json`), record);
			blindAnswers.push({
				sampleId,
				questionId,
				repetition,
				answer: result.content,
				citationValidation: validateCitations(result.content, userPrompt),
			});
			blindingKey.push({ sampleId, questionId, group: mode.id, repetition });
			console.error(`answered ${questionId} ${mode.id} r${repetition}`);
		}
	}
}

const scores: JudgeScore[] = [];
let judgeModelReturned: string | null = null;
for (const question of questions) {
	const questionId = requireString(question, "caseId");
	const samples = blindAnswers.filter((sample) => sample.questionId === questionId);
	const judgePrompt = buildJudgePrompt(question, samples);
	const result = await judgeProvider.chat({
		model: pilotConfig.judge.model,
		temperature: pilotConfig.judge.temperature,
		thinkingDisabled: pilotConfig.judge.thinkingDisabled,
		systemPrompt: judgeSystemPrompt,
		messages: [{ role: "user", content: judgePrompt }],
		responseFormat: "json_object",
		maxTokens: Math.max(pilotConfig.judge.maxOutputTokens, samples.length * 400),
	});
	judgeModelReturned = assertStableModel(judgeModelReturned, result.model, "judge");
	const parsed = parseJudgeScores(result.content);
	const expectedIds = new Set(samples.map((sample) => sample.sampleId));
	if (
		parsed.length !== expectedIds.size ||
		parsed.some((score) => !expectedIds.has(score.sampleId))
	) {
		throw new Error(`Judge sample mismatch for ${questionId}`);
	}
	scores.push(...parsed);
	writeJson(join(runRoot, "judge-records", `${questionId}.json`), {
		questionId,
		modelRequested: pilotConfig.judge.model,
		modelReturned: result.model,
		finishReason: result.finishReason,
		usage: result.usage,
		request: { systemPrompt: judgeSystemPrompt, userPrompt: judgePrompt },
		rawResponse: result.content,
		parsed,
	});
	console.error(`judged ${questionId}`);
}

const keyBySample = new Map(blindingKey.map((row) => [row.sampleId, row] as const));
const unblinded = scores.map((score) => {
	const key = keyBySample.get(score.sampleId);
	if (!key) throw new Error(`Missing blinding key ${score.sampleId}`);
	const rawTotal =
		score.requiredPointCoverage +
		score.conditionFidelity +
		score.evidenceGrounding +
		score.answerabilityDiscipline;
	return {
		...score,
		questionId: key.questionId,
		group: key.group,
		repetition: key.repetition,
		total: score.hardFailure ? Math.min(4, rawTotal) : rawTotal,
	};
});
const report = {
	schemaVersion: "wge-e4-answer-ablation/v2",
	status: "DIRECTIONAL_MEASURED",
	runId,
	createdAt: new Date().toISOString(),
	taskFileSha256: selection.taskFileSha256,
	answerModelRequested: pilotConfig.answer.model,
	answerModelReturned,
	judgeModelRequested: pilotConfig.judge.model,
	judgeModelReturned,
	experimentType: isAllModes ? "B_VS_SEED_VS_GRAPH" : isAblation ? "SEED_VS_GRAPH" : "B_VS_P",
	repetitions,
	groups: modes.map((mode) => aggregateGroup(mode.id, unblinded)),
	perQuestion: questions.map((question) => {
		const questionId = requireString(question, "caseId");
		return {
			questionId,
			groups: modes.map((mode) =>
				aggregateGroup(
					mode.id,
					unblinded.filter((row) => row.questionId === questionId),
				),
			),
		};
	}),
	limitations: [
		`${questions.length} public developer-visible questions are diagnostic only and cannot support a confirmatory product claim.`,
		"The same model family generated answers and judge scores; human audit is still required.",
		"E-min was not run because no generic Gold-independent WikiModule builder exists.",
	],
};
writeJson(join(runRoot, "blind-answers.json"), blindAnswers);
writeJson(join(runRoot, "blinding-key.json"), blindingKey);
writeJson(join(runRoot, "scores.unblinded.json"), unblinded);
writeJson(join(runRoot, "score-report.json"), report);
writeJson(join(runRoot, "manifest.json"), {
	runId,
	selectionPath,
	taskFile: selection.taskFile,
	questionIds: questions.map((question) => requireString(question, "caseId")),
	modes,
	repetitions,
	config: pilotConfig,
	answerModelReturned,
	judgeModelReturned,
});
console.log(JSON.stringify({ runRoot, report }, null, 2));

function buildJudgePrompt(
	question: JsonRecord,
	samples: Array<{ sampleId: string; answer: string; citationValidation: JsonRecord }>,
): string {
	return JSON.stringify({
		question: requireString(question, "question"),
		answerability: question.answerability,
		requiredPoints: question.requiredPoints,
		forbiddenClaims: question.forbiddenClaims,
		requiredEvidence: recordArray(question.requiredEvidence).map((item) => ({
			sourceId: item.sourceId,
			exactQuote: item.exactQuote,
			role: item.role,
		})),
		sourcePriorityRule: question.sourcePriorityRule,
		anonymousAnswers: samples,
	});
}

function validateCitations(answerContent: string, userPrompt: string): JsonRecord {
	try {
		const answer = JSON.parse(stripFence(answerContent)) as JsonRecord;
		const citations = stringArray(answer.citations);
		const invalid = citations.filter(
			(citation) => !userPrompt.includes(citation.replace(/^SOURCE\s+/, "")),
		);
		return {
			formatValid: true,
			total: citations.length,
			valid: citations.length - invalid.length,
			invalid,
		};
	} catch {
		return { formatValid: false, total: 0, valid: 0, invalid: [] };
	}
}

function parseJudgeScores(content: string): JudgeScore[] {
	const parsed = JSON.parse(stripFence(content)) as { scores?: unknown };
	if (!Array.isArray(parsed.scores)) throw new Error("Judge response missing scores");
	return parsed.scores.map((item) => {
		if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Invalid score");
		const row = item as JsonRecord;
		return {
			sampleId: requireString(row, "sampleId"),
			requiredPointCoverage: boundedScore(row.requiredPointCoverage),
			conditionFidelity: boundedScore(row.conditionFidelity),
			evidenceGrounding: boundedScore(row.evidenceGrounding),
			answerabilityDiscipline: boundedScore(row.answerabilityDiscipline),
			hardFailure: row.hardFailure === true,
			rationale: requireString(row, "rationale"),
		};
	});
}

function aggregateGroup(group: string, rows: Array<JudgeScore & { group: string; total: number }>) {
	const selected = rows.filter((row) => row.group === group);
	const totals = selected.map((row) => row.total);
	return {
		group,
		samples: selected.length,
		averageTotal: average(totals),
		standardDeviationTotal: standardDeviation(totals),
		minimumTotal: totals.length > 0 ? Math.min(...totals) : null,
		maximumTotal: totals.length > 0 ? Math.max(...totals) : null,
		averageRequiredPointCoverage: average(selected.map((row) => row.requiredPointCoverage)),
		averageConditionFidelity: average(selected.map((row) => row.conditionFidelity)),
		averageEvidenceGrounding: average(selected.map((row) => row.evidenceGrounding)),
		averageAnswerabilityDiscipline: average(selected.map((row) => row.answerabilityDiscipline)),
		hardFailures: selected.filter((row) => row.hardFailure).length,
	};
}

function orderedModes(modes: ExperimentMode[], key: string): ExperimentMode[] {
	return Number.parseInt(createHash("sha256").update(key).digest("hex").slice(0, 2), 16) % 2 === 0
		? [...modes]
		: [...modes].reverse();
}

function assertStableModel(previous: string | null, current: string, stage: string): string {
	if (previous !== null && previous !== current)
		throw new Error(`${stage} model drift: ${previous} -> ${current}`);
	return current;
}

function isAnswerFormatValid(content: string): boolean {
	try {
		const parsed = JSON.parse(stripFence(content)) as JsonRecord;
		return (
			typeof parsed.answer === "string" &&
			Array.isArray(parsed.citations) &&
			typeof parsed.insufficient === "boolean"
		);
	} catch {
		return false;
	}
}

function argumentValue(name: string): string | undefined {
	const index = process.argv.indexOf(name);
	return index >= 0 ? process.argv[index + 1] : undefined;
}

function stripFence(content: string): string {
	return content
		.trim()
		.replace(/^```(?:json)?\s*/i, "")
		.replace(/\s*```$/, "");
}

function boundedScore(value: unknown): number {
	if (typeof value !== "number" || value < 0 || value > 4)
		throw new Error(`Invalid score ${String(value)}`);
	return value;
}

function average(values: number[]): number {
	return values.length === 0
		? 0
		: Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3));
}

function standardDeviation(values: number[]): number {
	if (values.length < 2) return 0;
	const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
	const variance =
		values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
	return Number(Math.sqrt(variance).toFixed(3));
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

function recordArray(value: unknown): JsonRecord[] {
	return Array.isArray(value)
		? value.filter(
				(item): item is JsonRecord =>
					Boolean(item) && typeof item === "object" && !Array.isArray(item),
			)
		: [];
}

function stringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

function sha256(value: string): string {
	return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}
