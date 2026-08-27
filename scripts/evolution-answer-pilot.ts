#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { estimateTokens } from "../src/compiler/telemetry.js";
import { loadConfig } from "../src/config/index.js";
import { createLLMProvider } from "../src/core/llm-provider.js";
import {
	EVOLUTION_ANSWER_SYSTEM,
	EVOLUTION_JUDGE_SYSTEM,
	aggregateEvolutionScores,
	parseEvolutionAnswer,
	parseEvolutionJudgeScores,
	validateAnswerCitations,
} from "../src/evolution/evaluation.js";
import { writeJsonAtomic } from "../src/linter/storage.js";
import type { PilotGroup } from "../src/pilot/index.js";

type Timeline = "T0" | "T1" | "T2" | "T3";

interface State {
	runId: string;
	repoCommit: string;
	configHash: string;
	workspace: string;
	timelines: Array<{ timeline: Timeline; knowledgeVersion: string }>;
}

interface ExperimentConfig {
	schemaVersion: "wge-evolution-experiment-config/v1";
	status: "LOCKED";
	answer: ModelConfig;
	judge: ModelConfig;
}

interface ModelConfig {
	model: string;
	temperature: number;
	thinkingDisabled: boolean;
	maxOutputTokens: number;
}

interface Question {
	id: string;
	domain: string;
	category: string;
	question: string;
	goldByTimeline: Record<
		Timeline,
		{
			answerability: "ANSWERABLE" | "INSUFFICIENT" | "DISPUTED";
			expectedAnswer: string;
			requiredFacts: string[];
			requiredConditions: string[];
			forbiddenFacts: string[];
			sourceDocumentIds: string[];
		}
	>;
}

interface ContextRecord {
	context: string;
	contextHash: string;
	estimatedContextTokens: number;
	retrievedClaims: string[];
	retrievedRelations: string[];
	evidenceSpans: string[];
	retrievedSources: string[];
	droppedContext: unknown[];
	knowledgeVersion: string | null;
	toolCalls: number;
}

interface AnswerRecord {
	sampleId: string;
	questionId: string;
	category: string;
	group: PilotGroup;
	answer: string;
	formatValid: boolean;
	citationValidation: { valid: boolean; invalid: string[] };
	[key: string]: unknown;
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDirectory, "..");
const runsRoot = join(root, "experiments", "evolution", "runs");
const configPath = join(root, "experiments", "evolution", "config.json");
const selectionPath = join(root, "experiments", "evolution", "pilot-v1.json");
const groups: PilotGroup[] = ["B", "P", "E-min"];

const program = new Command();
program.name("evolution-answer-pilot");

program
	.command("run")
	.requiredOption("--run-id <id>")
	.requiredOption("--timeline <timeline>")
	.action(async (options: { runId: string; timeline: string }) => {
		const { runDirectory, state, timeline, config, questions } = loadInputs(options);
		const answerDirectory = join(runDirectory, "timelines", timeline, "answer-pilot");
		mkdirSync(join(answerDirectory, "records"), { recursive: true });
		const providerConfig = loadConfig({
			projectRoot: state.workspace,
			model: config.answer.model,
			temperature: config.answer.temperature,
		});
		if (!providerConfig.apiKey) throw new Error("DEEPSEEK_API_KEY 未设置");
		const provider = createLLMProvider(providerConfig);
		let returnedModel: string | null = null;
		for (const question of questions) {
			for (const group of deterministicGroups(state.runId, question.id)) {
				const recordPath = join(answerDirectory, "records", `${question.id}--${group}.json`);
				if (existsSync(recordPath)) continue;
				const context = readJson<ContextRecord>(
					join(runDirectory, "timelines", timeline, "contexts", `${question.id}--${group}.json`),
				);
				const userPrompt = `# 问题\n${question.question}\n\n# 检索上下文\n${context.context}`;
				const started = Date.now();
				const result = await provider.chat({
					model: config.answer.model,
					temperature: config.answer.temperature,
					thinkingDisabled: config.answer.thinkingDisabled,
					systemPrompt: EVOLUTION_ANSWER_SYSTEM,
					messages: [{ role: "user", content: userPrompt }],
					responseFormat: "json_object",
					maxTokens: config.answer.maxOutputTokens,
				});
				if (returnedModel === null) returnedModel = result.model;
				if (returnedModel !== result.model) throw new Error("同一答案 Pilot 中模型快照漂移");
				let formatValid = true;
				let citationValidation = { valid: false, invalid: [] as string[] };
				try {
					citationValidation = validateAnswerCitations(
						parseEvolutionAnswer(result.content),
						context.context,
					);
				} catch {
					formatValid = false;
				}
				const record: AnswerRecord = {
					sampleId: `sample-${sha256(`${state.runId}:${timeline}:${question.id}:${group}`).slice(0, 20)}`,
					questionId: question.id,
					category: question.category,
					group,
					answer: result.content,
					formatValid,
					citationValidation,
					modelRequested: config.answer.model,
					modelReturned: result.model,
					temperature: config.answer.temperature,
					promptHash: sha256(`${EVOLUTION_ANSWER_SYSTEM}\n${userPrompt}`),
					contextHash: context.contextHash,
					estimatedContextTokens: context.estimatedContextTokens,
					estimatedTotalInputTokens: estimateTokens(`${EVOLUTION_ANSWER_SYSTEM}\n${userPrompt}`),
					usage: result.usage,
					latencyMs: Date.now() - started,
					finishReason: result.finishReason,
					toolCalls: context.toolCalls,
					retrievedClaims: context.retrievedClaims,
					retrievedRelations: context.retrievedRelations,
					evidenceSpans: context.evidenceSpans,
					retrievedSources: context.retrievedSources,
					droppedContext: context.droppedContext,
					knowledgeVersion: context.knowledgeVersion ?? state.timelines.at(-1)?.knowledgeVersion,
				};
				writeJsonAtomic(recordPath, record);
				console.error(`completed ${question.id} ${group}`);
			}
		}
		const records = readAnswerRecords(answerDirectory, questions);
		writeJsonAtomic(
			join(answerDirectory, "blind-answers.json"),
			deterministicShuffle(
				records.map(({ sampleId, questionId, answer, formatValid, citationValidation }) => ({
					sampleId,
					questionId,
					answer,
					formatValid,
					citationValidation,
				})),
				`${state.runId}:blind`,
			),
		);
		writeJsonAtomic(
			join(answerDirectory, "blinding-key.json"),
			records.map(({ sampleId, questionId, group, category }) => ({
				sampleId,
				questionId,
				group,
				category,
			})),
		);
		writeJsonAtomic(join(answerDirectory, "manifest.json"), {
			runId: state.runId,
			timeline,
			selectionHash: sha256(readFileSync(selectionPath)),
			questions: questions.map((question) => question.id),
			groups,
			modelReturned: returnedModel,
			createdAt: new Date().toISOString(),
		});
		console.log(answerDirectory);
	});

program
	.command("score")
	.requiredOption("--run-id <id>")
	.requiredOption("--timeline <timeline>")
	.action(async (options: { runId: string; timeline: string }) => {
		const { runDirectory, state, timeline, config, questions } = loadInputs(options);
		const answerDirectory = join(runDirectory, "timelines", timeline, "answer-pilot");
		const blindAnswers = readJson<
			Array<{
				sampleId: string;
				questionId: string;
				answer: string;
				formatValid: boolean;
				citationValidation: { valid: boolean; invalid: string[] };
			}>
		>(join(answerDirectory, "blind-answers.json"));
		const key = readJson<
			Array<{ sampleId: string; questionId: string; group: PilotGroup; category: string }>
		>(join(answerDirectory, "blinding-key.json"));
		const keyById = new Map(key.map((item) => [item.sampleId, item]));
		const judgeConfig = loadConfig({
			projectRoot: state.workspace,
			model: config.judge.model,
			temperature: config.judge.temperature,
		});
		if (!judgeConfig.apiKey) throw new Error("DEEPSEEK_API_KEY 未设置");
		const provider = createLLMProvider(judgeConfig);
		mkdirSync(join(answerDirectory, "judge-records"), { recursive: true });
		const scored = [];
		for (const question of questions) {
			const recordPath = join(answerDirectory, "judge-records", `${question.id}.json`);
			let parsed: ReturnType<typeof parseEvolutionJudgeScores>;
			if (existsSync(recordPath)) {
				parsed = readJson<{ parsed: typeof parsed }>(recordPath).parsed;
			} else {
				const samples = blindAnswers.filter((item) => item.questionId === question.id);
				const gold = question.goldByTimeline[timeline];
				const userPrompt = `# Gold\n${JSON.stringify(
					{
						question: question.question,
						answerability: gold.answerability,
						expectedAnswer: gold.expectedAnswer,
						requiredFacts: gold.requiredFacts,
						requiredConditions: gold.requiredConditions,
						forbiddenFacts: gold.forbiddenFacts,
					},
					null,
					2,
				)}\n\n# 匿名答案\n${JSON.stringify(samples, null, 2)}`;
				const result = await provider.chat({
					model: config.judge.model,
					temperature: config.judge.temperature,
					thinkingDisabled: config.judge.thinkingDisabled,
					systemPrompt: EVOLUTION_JUDGE_SYSTEM,
					messages: [{ role: "user", content: userPrompt }],
					responseFormat: "json_object",
					maxTokens: config.judge.maxOutputTokens,
				});
				parsed = parseEvolutionJudgeScores(result.content);
				const expected = new Set(samples.map((item) => item.sampleId));
				if (
					parsed.length !== expected.size ||
					parsed.some((item) => !expected.has(item.sampleId))
				) {
					throw new Error(`评分样本集合不一致: ${question.id}`);
				}
				writeJsonAtomic(recordPath, {
					questionId: question.id,
					request: userPrompt,
					raw: result.content,
					parsed,
					usage: result.usage,
				});
				console.error(`scored ${question.id}`);
			}
			for (const row of parsed) {
				const identity = keyById.get(row.sampleId);
				if (!identity) throw new Error(`盲化键缺少样本: ${row.sampleId}`);
				const rawTotal =
					row.requiredFactCoverage +
					row.conditionFidelity +
					row.answerabilityDiscipline +
					row.evidenceGrounding;
				scored.push({
					...row,
					...identity,
					total: row.hardFailure ? Math.min(2, rawTotal) : rawTotal,
				});
			}
		}
		const report = aggregateEvolutionScores(scored);
		writeJsonAtomic(join(answerDirectory, "scores.unblinded.json"), scored);
		writeJsonAtomic(join(answerDirectory, "score-report.json"), {
			runId: state.runId,
			timeline,
			judgeType: "model-generated-not-human-gold",
			generatedAt: new Date().toISOString(),
			report,
		});
		console.log(JSON.stringify(report, null, 2));
	});

program.parseAsync(process.argv).catch((error: unknown) => {
	console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
	process.exitCode = 1;
});

function loadInputs(options: { runId: string; timeline: string }) {
	if (!/^[a-zA-Z0-9._-]+$/u.test(options.runId)) throw new Error("非法 runId");
	if (!(["T0", "T1", "T2", "T3"] as string[]).includes(options.timeline))
		throw new Error("非法 timeline");
	const timeline = options.timeline as Timeline;
	const runDirectory = join(runsRoot, options.runId);
	const state = readJson<State>(join(runDirectory, "state.json"));
	if (resolve(state.workspace) !== resolve(runDirectory, "workspace"))
		throw new Error("workspace 路径不匹配");
	if (state.repoCommit !== gitCommit())
		throw new Error("实验代码版本已漂移；请从冻结快照 fork 新 run");
	if (state.timelines.at(-1)?.timeline !== timeline) throw new Error("只能评测最新 timeline");
	const config = readJson<ExperimentConfig>(configPath);
	if (state.configHash !== hashJson("config", config)) throw new Error("实验配置已漂移");
	const selection = readJson<{
		schemaVersion: string;
		status: string;
		questionIds: string[];
	}>(selectionPath);
	if (
		selection.schemaVersion !== "wge-evolution-pilot-selection/v1" ||
		selection.status !== "FROZEN"
	)
		throw new Error("Pilot 选择集未冻结");
	const questionFile = readJson<{ questions: Question[] }>(join(runDirectory, "questions.json"));
	const byId = new Map(questionFile.questions.map((question) => [question.id, question]));
	const questions = selection.questionIds.map((id) => {
		const question = byId.get(id);
		if (!question) throw new Error(`选择集题目不存在: ${id}`);
		return question;
	});
	return { runDirectory, state, timeline, config, questions };
}

function readAnswerRecords(directory: string, questions: Question[]): AnswerRecord[] {
	return questions.flatMap((question) =>
		groups.map((group) =>
			readJson<AnswerRecord>(join(directory, "records", `${question.id}--${group}.json`)),
		),
	);
}

function deterministicGroups(runId: string, questionId: string): PilotGroup[] {
	return deterministicShuffle(groups, `${runId}:${questionId}`);
}

function deterministicShuffle<T>(values: T[], seed: string): T[] {
	return [...values].sort((left, right) =>
		sha256(`${seed}:${String(left)}`).localeCompare(sha256(`${seed}:${String(right)}`)),
	);
}

function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, "utf-8")) as T;
}

function sha256(value: string | Buffer): string {
	return createHash("sha256").update(value).digest("hex");
}

function hashJson(prefix: string, value: unknown): string {
	return `${prefix}:${sha256(JSON.stringify(value)).slice(0, 24)}`;
}

function gitCommit(): string {
	const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf-8" });
	if (result.status !== 0) throw new Error("无法读取 Git commit");
	return result.stdout.trim();
}
