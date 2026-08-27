import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadConfig } from "../src/config/index.js";
import { DeepSeekClient } from "../src/core/client.js";

type JsonRecord = Record<string, unknown>;
type Group = "B" | "P-seed" | "P-graph";

interface JudgeRow {
	sampleId: string;
	requiredPointCoverage: number;
	conditionFidelity: number;
	evidenceGrounding: number;
	answerabilityDiscipline: number;
	sourceRoleTemporalDiscipline: number;
	hardFailure: boolean;
	hardFailureTypes: string[];
	rationale: string;
}

const JUDGE_SYSTEM_PROMPT = `你是知识记忆系统的盲评裁判。你不知道样本来自哪个检索组，也不得猜测。
只依据给定的冻结题目、评估方 Gold 和答案评分。Gold 是 provisional：若 Gold 自身明确标注证据不足，奖励识别不足，不奖励补全外部常识。
每个维度只能给 0、1、2、3、4：
1. requiredPointCoverage：覆盖原子要点；
2. conditionFidelity：条件、范围、例外和不确定性；
3. evidenceGrounding：引用是否存在且支撑关键结论；
4. answerabilityDiscipline：该回答时回答，该 partial/拒答时不越界；
5. sourceRoleTemporalDiscipline：区分正式事实、分析、观点及时间版本。
出现 Gold hardFailureRules、伪造证据、主体/方向反转、把提案写成现行法、把 partial 写成确定结论时 hardFailure=true。
每条 rationale 不超过 80 个中文字符。只输出严格 JSON 数组，每个输入 sampleId 正好一项：
[{"sampleId":"...","requiredPointCoverage":0,"conditionFidelity":0,"evidenceGrounding":0,"answerabilityDiscipline":0,"sourceRoleTemporalDiscipline":0,"hardFailure":false,"hardFailureTypes":[],"rationale":"简短可审计理由"}]`;

const projectRoot = process.cwd();
const normalizedRoot = join(
	projectRoot,
	"experiments",
	"benchmark-batch-c",
	"stage-b-evaluator",
	"normalized-gold",
);
const blindFirstAnswerRoot = join(
	projectRoot,
	"experiments",
	"benchmark-batch-c",
	"blind-first-run",
	"answers",
	"batch-c-blind-first-2026-07-28T07-22-04-418Z",
);
const candidateAnswerRunId = process.env.WGE_BATCH_C_CANDIDATE_ANSWER_RUN_ID;
const answerRunRoot = candidateAnswerRunId
	? join(
			projectRoot,
			"experiments",
			"benchmark-batch-c",
			"post-hoc",
			"answers",
			candidateAnswerRunId,
		)
	: blindFirstAnswerRoot;
const evaluatorRoot = join(projectRoot, "experiments", "benchmark-batch-c", "stage-b-evaluator");
const runId =
	process.env.WGE_BATCH_C_SCORE_RUN_ID ??
	`score-${new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-")}`;
const runRoot = join(evaluatorRoot, "scoring", runId);
const tasks = readJsonl(join(normalizedRoot, "tasks.jsonl"));
const taskById = new Map(tasks.map((task) => [requireString(task, "caseId"), task]));
const questions = new Map(
	readJsonl(join(projectRoot, "batch-c-stage-a", "questions", "questions-public.jsonl")).map(
		(question) => [requireString(question, "caseId"), question],
	),
);
let blindAnswers = readJson(join(answerRunRoot, "blind-answers.json")) as unknown as JsonRecord[];
let blindingKey = readJson(join(answerRunRoot, "blinding-key.json")) as unknown as JsonRecord[];
if (candidateAnswerRunId) {
	const candidateQuestionIds = new Set(blindingKey.map((row) => requireString(row, "questionId")));
	const baselineKey = (
		readJson(join(blindFirstAnswerRoot, "blinding-key.json")) as JsonRecord[]
	).filter(
		(row) =>
			requireString(row, "group") === "B" &&
			candidateQuestionIds.has(requireString(row, "questionId")),
	);
	const baselineSampleIds = new Set(baselineKey.map((row) => requireString(row, "sampleId")));
	const baselineAnswers = (
		readJson(join(blindFirstAnswerRoot, "blind-answers.json")) as JsonRecord[]
	).filter((row) => baselineSampleIds.has(requireString(row, "sampleId")));
	blindAnswers = [...blindAnswers, ...baselineAnswers];
	blindingKey = [...blindingKey, ...baselineKey];
}
const keyBySample = new Map(
	blindingKey.map((row) => [
		requireString(row, "sampleId"),
		requireGroup(requireString(row, "group")),
	]),
);
const answersByQuestion = groupBy(blindAnswers, (row) => requireString(row, "questionId"));
const config = loadConfig({ projectRoot, model: "deepseek-v4-flash", temperature: 0 });
const client = new DeepSeekClient(config);
const scored: Array<JudgeRow & { questionId: string; group: Group; scoreEligibility: string }> = [];

mkdirSync(join(runRoot, "judge-records"), { recursive: true });
for (const [questionId, answers] of [...answersByQuestion.entries()].sort(([a], [b]) =>
	a.localeCompare(b),
)) {
	const task = taskById.get(questionId);
	const question = questions.get(questionId);
	if (!task || !question) throw new Error(`Missing task/question ${questionId}`);
	if (answers.length !== 3) throw new Error(`${questionId} must have exactly 3 answers`);
	const randomizedAnswers = [...answers].sort((left, right) =>
		sha256(`${questionId}:${requireString(left, "sampleId")}`).localeCompare(
			sha256(`${questionId}:${requireString(right, "sampleId")}`),
		),
	);
	const prompt = buildJudgePrompt(question, task, randomizedAnswers);
	const recordPath = join(runRoot, "judge-records", `${questionId}.json`);
	let rows: JudgeRow[];
	if (existsSync(recordPath)) {
		const record = asRecord(readJson(recordPath), "judge record");
		if (requireString(record, "promptHash") !== sha256(prompt)) {
			throw new Error(`Existing judge record prompt mismatch for ${questionId}`);
		}
		if (!Array.isArray(record.rows))
			throw new Error(`Existing judge rows missing for ${questionId}`);
		rows = record.rows.map(parseJudgeRow);
		console.error(`reused ${questionId}`);
	} else {
		const result = await judgeWithBoundedRetry(questionId, prompt);
		rows = parseJudgeRows(result.content);
		writeJson(recordPath, {
			questionId,
			promptHash: sha256(prompt),
			modelRequested: config.model,
			modelReturned: result.model,
			finishReason: result.finishReason,
			usage: result.usage,
			raw: result.content,
			rows,
		});
		console.error(`scored ${questionId}`);
	}
	const expectedSampleIds = randomizedAnswers.map((row) => requireString(row, "sampleId")).sort();
	const actualSampleIds = rows.map((row) => row.sampleId).sort();
	if (JSON.stringify(expectedSampleIds) !== JSON.stringify(actualSampleIds)) {
		throw new Error(`Judge sample mismatch for ${questionId}`);
	}
	for (const row of rows) {
		const group = keyBySample.get(row.sampleId);
		if (!group) throw new Error(`Missing blinding key ${row.sampleId}`);
		scored.push({
			...row,
			questionId,
			group,
			scoreEligibility: requireString(task, "scoreEligibility"),
		});
	}
}

const primaryRows = scored.filter((row) => row.scoreEligibility === "primary");
const diagnosticRows = scored.filter((row) => row.scoreEligibility !== "primary");
const answerRecords = readAnswerRecords(
	join(answerRunRoot, "records"),
	blindingKey,
	candidateAnswerRunId ? join(blindFirstAnswerRoot, "records") : undefined,
);
const report = {
	schemaVersion: "wge-batch-c-first-run-score/v1",
	status: "PROVISIONAL_POST_ANSWER_GOLD_DIAGNOSTIC",
	runId,
	answerRunId: candidateAnswerRunId ?? "batch-c-blind-first-2026-07-28T07-22-04-418Z",
	judgeModel: config.model,
	judgeTemperature: 0,
	goldStatus: "evaluator-reviewed-provisional-gold",
	primaryQuestions: new Set(primaryRows.map((row) => row.questionId)).size,
	diagnosticOnlyQuestions: [...new Set(diagnosticRows.map((row) => row.questionId))].sort(),
	primary: aggregate(primaryRows),
	diagnosticOnly: aggregate(diagnosticRows),
	paired: paired(primaryRows),
	cost: aggregateCost(answerRecords),
	limitations: [
		"Stage B Gold was created after answers and is suitable for diagnostic iteration, not confirmatory claims.",
		"The judge model is from the same model family as the answer model; scores require human spot-checking.",
		"All supplied Relation Gold was rejected, so graph relation recall/precision is not reported.",
	],
};
writeJsonl(join(runRoot, "scores-blinded-unsealed.jsonl"), scored);
writeJson(join(runRoot, "report.json"), report);
writeJsonReplace(join(evaluatorRoot, "LATEST_SCORE_RUN.json"), { runId, runRoot });
console.log(JSON.stringify(report, null, 2));

async function judgeWithBoundedRetry(questionId: string, prompt: string) {
	for (const maxTokens of [6400, 8192]) {
		const result = await client.chat({
			systemPrompt: JUDGE_SYSTEM_PROMPT,
			messages: [{ role: "user", content: prompt }],
			model: config.model,
			maxTokens,
			temperature: 0,
		});
		if (result.finishReason === "stop") return result;
		console.error(
			`judge ${questionId} finishReason=${result.finishReason}; retrying with larger cap`,
		);
	}
	throw new Error(`Judge ${questionId} remained truncated after bounded retry`);
}

function buildJudgePrompt(question: JsonRecord, task: JsonRecord, answers: JsonRecord[]) {
	return JSON.stringify(
		{
			question: {
				caseId: requireString(question, "caseId"),
				text: requireString(question, "question"),
				timeScope: question.timeScope,
			},
			gold: {
				answerability: task.answerability,
				requiredPoints: task.requiredPoints,
				acceptableVariants: task.acceptableVariants,
				forbiddenClaims: task.forbiddenClaims,
				requiredEvidence: task.requiredEvidence,
				sourcePriorityRule: task.sourcePriorityRule,
				answerabilityReason: task.answerabilityReason,
				hardFailureRules: task.hardFailureRules,
			},
			answers: answers.map((answer) => ({
				sampleId: requireString(answer, "sampleId"),
				answer: requireString(answer, "answer"),
				citationContractValidation: answer.citationValidation,
			})),
		},
		null,
		2,
	);
}

function parseJudgeRows(content: string): JudgeRow[] {
	const cleaned = content
		.trim()
		.replace(/^```(?:json)?\s*/u, "")
		.replace(/\s*```$/u, "");
	const value = JSON.parse(cleaned) as unknown;
	if (!Array.isArray(value)) throw new Error("Judge output must be an array");
	return value.map(parseJudgeRow);
}

function parseJudgeRow(item: unknown): JudgeRow {
	const row = asRecord(item, "judge row");
	return {
		sampleId: requireString(row, "sampleId"),
		requiredPointCoverage: score(row, "requiredPointCoverage"),
		conditionFidelity: score(row, "conditionFidelity"),
		evidenceGrounding: score(row, "evidenceGrounding"),
		answerabilityDiscipline: score(row, "answerabilityDiscipline"),
		sourceRoleTemporalDiscipline: score(row, "sourceRoleTemporalDiscipline"),
		hardFailure: row.hardFailure === true,
		hardFailureTypes: Array.isArray(row.hardFailureTypes) ? row.hardFailureTypes.map(String) : [],
		rationale: requireString(row, "rationale"),
	};
}

function score(record: JsonRecord, key: string) {
	const value = record[key];
	if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 4) {
		throw new Error(`${key} must be an integer 0..4`);
	}
	return Number(value);
}

function total(row: JudgeRow) {
	return (
		row.requiredPointCoverage +
		row.conditionFidelity +
		row.evidenceGrounding +
		row.answerabilityDiscipline +
		row.sourceRoleTemporalDiscipline
	);
}

function aggregate(rows: Array<JudgeRow & { group: Group }>) {
	return Object.fromEntries(
		(["B", "P-seed", "P-graph"] as Group[]).map((group) => {
			const selected = rows.filter((row) => row.group === group);
			return [
				group,
				{
					samples: selected.length,
					averageTotal: average(selected.map(total)),
					averageRequiredPointCoverage: average(selected.map((row) => row.requiredPointCoverage)),
					averageConditionFidelity: average(selected.map((row) => row.conditionFidelity)),
					averageEvidenceGrounding: average(selected.map((row) => row.evidenceGrounding)),
					averageAnswerabilityDiscipline: average(
						selected.map((row) => row.answerabilityDiscipline),
					),
					averageSourceRoleTemporalDiscipline: average(
						selected.map((row) => row.sourceRoleTemporalDiscipline),
					),
					hardFailures: selected.filter((row) => row.hardFailure).length,
				},
			];
		}),
	);
}

function paired(rows: Array<JudgeRow & { questionId: string; group: Group }>) {
	const byQuestion = groupBy(rows, (row) => row.questionId);
	return (["P-seed", "P-graph"] as Group[]).map((group) => {
		const differences = [...byQuestion.values()].map((questionRows) => {
			const baseline = questionRows.find((row) => row.group === "B");
			const candidate = questionRows.find((row) => row.group === group);
			if (!baseline || !candidate) throw new Error(`Missing paired row for ${group}`);
			return total(candidate) - total(baseline);
		});
		return {
			comparison: `${group}-minus-B`,
			questions: differences.length,
			averageDifference: average(differences),
			wins: differences.filter((value) => value > 0).length,
			ties: differences.filter((value) => value === 0).length,
			losses: differences.filter((value) => value < 0).length,
		};
	});
}

function readAnswerRecords(recordsRoot: string, key: JsonRecord[], baselineRecordsRoot?: string) {
	return key.map((keyRow) => {
		const questionId = requireString(keyRow, "questionId");
		const group = requireGroup(requireString(keyRow, "group"));
		const primaryPath = join(recordsRoot, `${questionId}--${group}.json`);
		const path = existsSync(primaryPath)
			? primaryPath
			: join(baselineRecordsRoot ?? recordsRoot, `${questionId}--${group}.json`);
		return {
			...asRecord(readJson(path), "answer record"),
			group,
		};
	});
}

function aggregateCost(rows: Array<JsonRecord & { group: Group }>) {
	return Object.fromEntries(
		(["B", "P-seed", "P-graph"] as Group[]).map((group) => {
			const selected = rows.filter((row) => row.group === group);
			const usage = selected.map((row) => asRecord(row.usage, "usage"));
			return [
				group,
				{
					promptTokens: sum(usage.map((row) => requireNumber(row, "promptTokens"))),
					completionTokens: sum(usage.map((row) => requireNumber(row, "completionTokens"))),
					totalTokens: sum(usage.map((row) => requireNumber(row, "totalTokens"))),
					citationContractFailures: selected.filter(
						(row) => asRecord(row.citationValidation, "citationValidation").valid !== true,
					).length,
				},
			];
		}),
	);
}

function groupBy<T>(values: T[], key: (value: T) => string) {
	const result = new Map<string, T[]>();
	for (const value of values) {
		const itemKey = key(value);
		const rows = result.get(itemKey) ?? [];
		rows.push(value);
		result.set(itemKey, rows);
	}
	return result;
}

function average(values: number[]) {
	return values.length === 0 ? null : Math.round((sum(values) / values.length) * 1000) / 1000;
}

function sum(values: number[]) {
	return values.reduce((total, value) => total + value, 0);
}

function requireGroup(value: string): Group {
	if (value !== "B" && value !== "P-seed" && value !== "P-graph") {
		throw new Error(`Unknown group ${value}`);
	}
	return value;
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
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
}

function writeJsonReplace(path: string, value: unknown) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeJsonl(path: string, rows: unknown[]) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, {
		encoding: "utf8",
		flag: "wx",
	});
}

function asRecord(value: unknown, label: string): JsonRecord {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${label} must be an object`);
	}
	return value as JsonRecord;
}

function requireString(record: JsonRecord, key: string) {
	const value = record[key];
	if (typeof value !== "string" || value.length === 0) throw new Error(`${key} must be a string`);
	return value;
}

function requireNumber(record: JsonRecord, key: string) {
	const value = record[key];
	if (typeof value !== "number" || !Number.isFinite(value))
		throw new Error(`${key} must be a number`);
	return value;
}

function sha256(value: string) {
	return createHash("sha256").update(value).digest("hex");
}
