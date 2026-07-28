import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { loadConfig } from "../src/config/index.js";
import { createLLMProvider } from "../src/core/llm-provider.js";
import type { PilotConfig } from "../src/pilot/index.js";

type JsonRecord = Record<string, unknown>;

interface JudgeScore {
	sampleId: string;
	requiredPointCoverage: number;
	conditionFidelity: number;
	evidenceGrounding: number;
	answerabilityDiscipline: number;
	hardFailure: boolean;
	rationale: string;
}

interface BlindAnswer {
	sampleId: string;
	questionId: string;
	answer: string;
}

interface BlindingKey {
	sampleId: string;
	questionId: string;
	group: string;
	repetition?: number;
}

const judgeSystemPrompt = `你是盲测评分员，不知道答案属于哪个实验组。只按题目、评分锚点、Gold 证据和引用预校验评价，不用外部常识修正答案。
每个维度独立使用同一 0-4 锚点：4=完整且准确；3=大部分满足，仅轻微遗漏；2=部分满足，存在重要遗漏；1=仅有极少相关内容；0=缺失、反转或与证据冲突。
requiredPointCoverage 只看 requiredPoints；conditionFidelity 看条件、时间、来源角色和不确定性；evidenceGrounding 同时看关键结论是否与 Gold 证据一致以及 citationValidation；answerabilityDiscipline 看是否越界、编造或错误拒答。
citationValidation.valid 表示引用标识确实存在于该匿名样本收到的上下文。内部 CLAIM/SPAN/SOURCE 标识不需要出现在 Gold 文本中，不得仅因此扣分；但存在性有效不代表语义必然支持，仍需对照答案内容与 Gold。
若反转来源归属、抹掉关键条件/时间、把提案当最终规范或编造关键事实，hardFailure=true。
数值必须与 rationale 一致：若 rationale 说“完整覆盖且准确”，对应维度不能低于 3。
只输出严格 JSON：{"scores":[{"sampleId":"...","requiredPointCoverage":0,"conditionFidelity":0,"evidenceGrounding":0,"answerabilityDiscipline":0,"hardFailure":false,"rationale":"..."}]}。`;

const projectRoot = resolve(import.meta.dirname, "..");
const experimentRoot = join(projectRoot, "experiments", "benchmark-seed-v1");
const workspaceRoot = join(experimentRoot, "workspace");
const smokeRoot = join(experimentRoot, "e4-smoke");
const runArgument = process.argv.indexOf("--run");
const requestedRun = runArgument >= 0 ? process.argv[runArgument + 1] : undefined;
if (!requestedRun) throw new Error("Usage: --run <E4 run directory>");
const runRoot = isAbsolute(requestedRun) ? requestedRun : resolve(projectRoot, requestedRun);
const manifest = readJson<{ questionIds: string[]; config: PilotConfig }>(
	join(runRoot, "manifest.json"),
);
const selection = readJson<{ taskFile: string }>(join(smokeRoot, "selection.json"));
const tasks = readJsonl(join(projectRoot, selection.taskFile));
const taskById = new Map(tasks.map((task) => [requireString(task, "caseId"), task] as const));
const blindAnswers = readJson<BlindAnswer[]>(join(runRoot, "blind-answers.json"));
const actualQuestionIds = [...new Set(blindAnswers.map((answer) => answer.questionId))];
const blindingKey = readJson<BlindingKey[]>(join(runRoot, "blinding-key.json"));
const keyBySample = new Map(blindingKey.map((key) => [key.sampleId, key] as const));
const baseConfig = loadConfig({ projectRoot: workspaceRoot });
if (!baseConfig.apiKey) throw new Error("DEEPSEEK_API_KEY 未设置");
const provider = createLLMProvider(
	loadConfig({
		projectRoot: workspaceRoot,
		model: manifest.config.judge.model,
		temperature: manifest.config.judge.temperature,
	}),
);
const outputRoot = join(runRoot, "rescore-v2");
mkdirSync(join(outputRoot, "judge-records"), { recursive: true });
const scores: JudgeScore[] = [];
let modelReturned: string | null = null;

for (const questionId of actualQuestionIds) {
	const question = taskById.get(questionId);
	if (!question) throw new Error(`Missing question ${questionId}`);
	const samples = blindAnswers
		.filter((sample) => sample.questionId === questionId)
		.map((sample) => ({
			sampleId: sample.sampleId,
			answer: sample.answer,
			citationValidation: validateCitations(sample, runRoot, keyBySample),
		}));
	if (samples.length === 0) continue;
	const userPrompt = JSON.stringify({
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
	const result = await provider.chat({
		model: manifest.config.judge.model,
		temperature: manifest.config.judge.temperature,
		thinkingDisabled: manifest.config.judge.thinkingDisabled,
		systemPrompt: judgeSystemPrompt,
		messages: [{ role: "user", content: userPrompt }],
		responseFormat: "json_object",
		maxTokens: Math.max(manifest.config.judge.maxOutputTokens, samples.length * 450),
	});
	if (modelReturned !== null && modelReturned !== result.model) {
		throw new Error(`Judge model drift: ${modelReturned} -> ${result.model}`);
	}
	modelReturned = result.model;
	const parsed = parseJudgeScores(result.content);
	const expectedIds = new Set(samples.map((sample) => sample.sampleId));
	if (
		parsed.length !== expectedIds.size ||
		parsed.some((score) => !expectedIds.has(score.sampleId))
	) {
		throw new Error(`Judge sample mismatch for ${questionId}`);
	}
	scores.push(...parsed);
	writeJson(join(outputRoot, "judge-records", `${questionId}.json`), {
		questionId,
		modelRequested: manifest.config.judge.model,
		modelReturned: result.model,
		finishReason: result.finishReason,
		usage: result.usage,
		request: { systemPrompt: judgeSystemPrompt, userPrompt },
		rawResponse: result.content,
		parsed,
	});
	console.error(`rescored ${questionId}`);
}

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
		repetition: key.repetition ?? 1,
		total: score.hardFailure ? Math.min(4, rawTotal) : rawTotal,
	};
});
const groups = [...new Set(unblinded.map((row) => row.group))];
const report = {
	schemaVersion: "wge-e4-rescore/v2",
	status: "DIRECTIONAL_MEASURED",
	sourceRun: runRoot,
	judgePromptHash: sha256(judgeSystemPrompt),
	judgeModelRequested: manifest.config.judge.model,
	judgeModelReturned: modelReturned,
	groups: groups.map((group) => aggregate(group, unblinded)),
	perQuestion: actualQuestionIds.map((questionId) => ({
		questionId,
		groups: groups.map((group) =>
			aggregate(
				group,
				unblinded.filter((row) => row.questionId === questionId),
			),
		),
	})),
	limitations: [
		"This remains a same-model directional judge, not human Gold adjudication.",
		"Citation prevalidation checks identifier presence, not semantic entailment.",
	],
};
writeJson(join(outputRoot, "scores.unblinded.json"), unblinded);
writeJson(join(outputRoot, "score-report.json"), report);
console.log(JSON.stringify({ outputRoot, report }, null, 2));

function validateCitations(
	sample: BlindAnswer,
	runRoot: string,
	keyBySample: Map<string, BlindingKey>,
): JsonRecord {
	const key = keyBySample.get(sample.sampleId);
	if (!key) throw new Error(`Missing key ${sample.sampleId}`);
	const recordPath = join(
		runRoot,
		"records",
		`${sample.questionId}--${key.group}--r${key.repetition ?? 1}.json`,
	);
	const record = readJson<{ request: { userPrompt: string } }>(recordPath);
	try {
		const answer = JSON.parse(stripFence(sample.answer)) as JsonRecord;
		const citations = stringArray(answer.citations);
		const invalid = citations.filter(
			(citation) => !record.request.userPrompt.includes(citation.replace(/^SOURCE\s+/, "")),
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

function aggregate(group: string, rows: Array<JudgeScore & { group: string; total: number }>) {
	const selected = rows.filter((row) => row.group === group);
	const totals = selected.map((row) => row.total);
	return {
		group,
		samples: selected.length,
		averageTotal: average(totals),
		standardDeviationTotal: standardDeviation(totals),
		minimumTotal: totals.length > 0 ? Math.min(...totals) : null,
		maximumTotal: totals.length > 0 ? Math.max(...totals) : null,
		hardFailures: selected.filter((row) => row.hardFailure).length,
	};
}

function boundedScore(value: unknown): number {
	if (typeof value !== "number" || value < 0 || value > 4)
		throw new Error(`Invalid score ${String(value)}`);
	return value;
}

function stripFence(content: string): string {
	return content
		.trim()
		.replace(/^```(?:json)?\s*/i, "")
		.replace(/\s*```$/, "");
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
	mkdirSync(join(path, ".."), { recursive: true });
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
