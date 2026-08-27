#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import { estimateTokens } from "../src/compiler/telemetry.js";
import { loadConfig } from "../src/config/index.js";
import { createLLMProvider } from "../src/core/llm-provider.js";
import {
	EVOLUTION_ANSWER_SYSTEM,
	EVOLUTION_JUDGE_SYSTEM,
	buildCitationRepairInstruction,
	collectCitationIdentifiers,
	parseEvolutionAnswer,
	parseEvolutionJudgeScores,
	validateAnswerCitations,
} from "../src/evolution/evaluation.js";
import { writeJsonAtomic } from "../src/linter/storage.js";
import type { ContextPack } from "../src/types/index.js";

type Milestone = "m1" | "m2";
type Variant = "R0" | "W" | "W2";

interface Question {
	id: string;
	domain: string;
	category: string;
	question: string;
	goldByTimeline: {
		T2: {
			answerability: "ANSWERABLE" | "INSUFFICIENT" | "DISPUTED";
			expectedAnswer: string;
			requiredFacts: string[];
			requiredConditions: string[];
			forbiddenFacts: string[];
		};
	};
}

interface PackArtifact {
	pack: ContextPack;
}

interface AnswerRecord {
	sampleId: string;
	questionId: string;
	category: string;
	variant: Variant;
	answer: string;
	formatValid: boolean;
	citationValidation: { valid: boolean; invalid: string[] };
	usage: unknown;
	finishReason: string | null;
	modelRequested: string;
	modelReturned: string;
	temperature: number;
	contextHash: string;
	promptHash: string;
	estimatedInputTokens: number;
	latencyMs: number;
	attempts: Array<{
		kind: "INITIAL" | "CITATION_REPAIR";
		promptHash: string;
		finishReason: string | null;
		usage: unknown;
		formatValid: boolean;
		citationValidation: { valid: boolean; invalid: string[] };
	}>;
}

const ROOT = process.cwd();
const QUESTIONS_PATH = join(ROOT, "experiments/evolution/dataset-v1/questions.json");
const CONFIG_PATH = join(ROOT, "experiments/evolution/config.json");
const SELECTED_IDS = new Set([
	"EV-COMM-001",
	"EV-COMM-005",
	"EV-PLAT-001",
	"EV-PLAT-005",
	"EV-RES-001",
	"EV-RES-005",
]);

const program = new Command();
program.name("run-m1-wiki-answer-pilot");

program
	.command("generate")
	.requiredOption("--structural-run <id>")
	.requiredOption("--run-id <id>")
	.option("--milestone <id>", "m1 or m2", "m1")
	.action(
		async ({
			structuralRun,
			runId,
			milestone,
		}: { structuralRun: string; runId: string; milestone: string }) => {
			const experiment = experimentPaths(parseMilestone(milestone));
			const runRoot = join(experiment.runsRoot, runId);
			const recordsRoot = join(runRoot, "records");
			const blindPath = join(runRoot, "blind-answers.json");
			if (existsSync(blindPath)) throw new Error(`首轮答案已封存，拒绝覆盖: ${blindPath}`);
			mkdirSync(recordsRoot, { recursive: true });

			const structuralRoot = join(experiment.structuralRunsRoot, structuralRun);
			const report = readJson<{ status: string }>(join(structuralRoot, "report.json"));
			if (report.status !== "PASS") throw new Error(`结构门禁未通过: ${structuralRun}`);
			const wPacks = readJson<Record<string, PackArtifact>>(
				join(structuralRoot, experiment.wikiPacksFile),
			);
			const r0Packs = readJson<Record<string, PackArtifact>>(
				join(structuralRoot, experiment.r0PacksFile),
			);
			// Generation authority deliberately projects away goldByTimeline.
			const questions = selectedQuestions().map(({ id, domain, category, question }) => ({
				id,
				domain,
				category,
				question,
			}));
			const modelConfig = readJson<{
				answer: {
					model: string;
					temperature: number;
					thinkingDisabled: boolean;
					maxOutputTokens: number;
				};
			}>(CONFIG_PATH).answer;
			const appConfig = loadConfig({
				projectRoot: ROOT,
				model: modelConfig.model,
				temperature: modelConfig.temperature,
			});
			if (!appConfig.apiKey) throw new Error("DEEPSEEK_API_KEY 未设置");
			const provider = createLLMProvider(appConfig);
			let returnedModel: string | null = null;

			for (const question of questions) {
				for (const variant of deterministicVariants(runId, question.id, experiment.wikiVariant)) {
					const path = join(recordsRoot, `${question.id}--${variant}.json`);
					if (existsSync(path)) continue;
					const pack = (variant === experiment.wikiVariant ? wPacks : r0Packs)[question.id]?.pack;
					if (!pack) throw new Error(`缺少 ${question.id} ${variant} Context Pack`);
					const context = JSON.stringify(pack);
					const userPrompt = `# 问题\n${question.question}\n\n# 检索上下文\n${context}`;
					const started = Date.now();
					let result = await provider.chat({
						model: modelConfig.model,
						temperature: modelConfig.temperature,
						thinkingDisabled: modelConfig.thinkingDisabled,
						systemPrompt: EVOLUTION_ANSWER_SYSTEM,
						messages: [{ role: "user", content: userPrompt }],
						responseFormat: "json_object",
						maxTokens: modelConfig.maxOutputTokens,
					});
					if (returnedModel === null) returnedModel = result.model;
					if (returnedModel !== result.model) throw new Error("同一 Wiki Pilot 模型快照漂移");
					let assessment = assessAnswer(result.content, context);
					const attempts: AnswerRecord["attempts"] = [
						{
							kind: "INITIAL",
							promptHash: sha256(`${EVOLUTION_ANSWER_SYSTEM}\n${userPrompt}`),
							finishReason: result.finishReason,
							usage: result.usage,
							...assessment,
						},
					];
					if (!assessment.formatValid || !assessment.citationValidation.valid) {
						const rejectedContent = result.content;
						const rejected = assessment.formatValid
							? assessment.citationValidation.invalid
							: ["FORMAT_INVALID"];
						const repairInstruction = buildCitationRepairInstruction(
							rejected,
							collectCitationIdentifiers(context),
						);
						const repairPromptHash = sha256(
							`${EVOLUTION_ANSWER_SYSTEM}\n${userPrompt}\n${result.content}\n${repairInstruction}`,
						);
						result = await provider.chat({
							model: modelConfig.model,
							temperature: modelConfig.temperature,
							thinkingDisabled: modelConfig.thinkingDisabled,
							systemPrompt: EVOLUTION_ANSWER_SYSTEM,
							messages: [
								{ role: "user", content: userPrompt },
								{ role: "assistant", content: rejectedContent },
								{ role: "user", content: repairInstruction },
							],
							responseFormat: "json_object",
							maxTokens: modelConfig.maxOutputTokens,
						});
						if (returnedModel !== result.model) throw new Error("引用修复期间模型快照漂移");
						assessment = assessAnswer(result.content, context);
						attempts.push({
							kind: "CITATION_REPAIR",
							promptHash: repairPromptHash,
							finishReason: result.finishReason,
							usage: result.usage,
							...assessment,
						});
					}
					const record: AnswerRecord = {
						sampleId: `${experiment.milestone}-sample-${sha256(`${runId}:${question.id}:${variant}`).slice(0, 20)}`,
						questionId: question.id,
						category: question.category,
						variant,
						answer: result.content,
						formatValid: assessment.formatValid,
						citationValidation: assessment.citationValidation,
						usage: sumDetailedUsage(attempts.map((attempt) => attempt.usage)),
						finishReason: result.finishReason,
						modelRequested: modelConfig.model,
						modelReturned: result.model,
						temperature: modelConfig.temperature,
						contextHash: sha256(context),
						promptHash: sha256(`${EVOLUTION_ANSWER_SYSTEM}\n${userPrompt}`),
						estimatedInputTokens: estimateTokens(`${EVOLUTION_ANSWER_SYSTEM}\n${userPrompt}`),
						latencyMs: Date.now() - started,
						attempts,
					};
					writeJsonAtomic(path, record);
					console.error(`generated ${question.id} ${variant}`);
				}
			}

			const records = readRecords(recordsRoot);
			if (records.length !== questions.length * 2) throw new Error("答案记录数量不完整");
			writeJsonAtomic(
				blindPath,
				deterministicShuffle(
					records.map(({ sampleId, questionId, answer, formatValid, citationValidation }) => ({
						sampleId,
						questionId,
						answer,
						formatValid,
						citationValidation,
					})),
					`${runId}:blind`,
				),
			);
			writeJsonAtomic(
				join(runRoot, "blinding-key.json"),
				records.map(({ sampleId, questionId, category, variant }) => ({
					sampleId,
					questionId,
					category,
					variant,
				})),
			);
			writeJsonAtomic(join(runRoot, "manifest.json"), {
				schemaVersion: `wge-${experiment.milestone}-wiki-answer-pilot/v1`,
				runId,
				structuralRun,
				questionsHash: sha256(readFileSync(QUESTIONS_PATH)),
				selectionHash: sha256(readFileSync(experiment.selectionPath)),
				configHash: sha256(readFileSync(CONFIG_PATH)),
				structuralArtifactHash: sha256(readFileSync(join(structuralRoot, "artifact-hashes.json"))),
				questionIds: questions.map((question) => question.id),
				variants: ["R0", experiment.wikiVariant],
				modelRequested: modelConfig.model,
				modelReturned: returnedModel,
				createdAt: new Date().toISOString(),
			});
			console.log(runRoot);
		},
	);

program
	.command("score")
	.requiredOption("--run-id <id>")
	.option("--score-id <id>")
	.option("--milestone <id>", "m1 or m2", "m1")
	.action(
		async ({
			runId,
			scoreId,
			milestone,
		}: { runId: string; scoreId?: string; milestone: string }) => {
			const experiment = experimentPaths(parseMilestone(milestone));
			const runRoot = join(experiment.runsRoot, runId);
			const scoreSuffix = scoreId ? `-${safeArtifactId(scoreId)}` : "";
			const resultPath = join(runRoot, `result${scoreSuffix}.json`);
			if (existsSync(resultPath)) throw new Error(`评分已封存，拒绝覆盖: ${resultPath}`);
			const blind = readJson<
				Array<{
					sampleId: string;
					questionId: string;
					answer: string;
					formatValid: boolean;
					citationValidation: { valid: boolean; invalid: string[] };
				}>
			>(join(runRoot, "blind-answers.json"));
			const key = readJson<
				Array<{ sampleId: string; questionId: string; category: string; variant: Variant }>
			>(join(runRoot, "blinding-key.json"));
			const keyById = new Map(key.map((item) => [item.sampleId, item]));
			const modelConfig = readJson<{
				judge: {
					model: string;
					temperature: number;
					thinkingDisabled: boolean;
					maxOutputTokens: number;
				};
			}>(CONFIG_PATH).judge;
			const appConfig = loadConfig({
				projectRoot: ROOT,
				model: modelConfig.model,
				temperature: modelConfig.temperature,
			});
			if (!appConfig.apiKey) throw new Error("DEEPSEEK_API_KEY 未设置");
			const provider = createLLMProvider(appConfig);
			const judgeRoot = join(runRoot, `judge-records${scoreSuffix}`);
			mkdirSync(judgeRoot, { recursive: true });
			const scored: Array<
				ReturnType<typeof parseEvolutionJudgeScores>[number] & {
					questionId: string;
					category: string;
					variant: Variant;
					total: number;
				}
			> = [];
			for (const question of selectedQuestions()) {
				const judgeRecordPath = join(judgeRoot, `${question.id}.json`);
				const samples = blind.filter((sample) => sample.questionId === question.id);
				if (samples.length !== 2) throw new Error(`匿名样本数量错误: ${question.id}`);
				const gold = question.goldByTimeline.T2;
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
				let parsed: ReturnType<typeof parseEvolutionJudgeScores>;
				if (existsSync(judgeRecordPath)) {
					parsed = readJson<{ parsed: typeof parsed }>(judgeRecordPath).parsed;
				} else {
					const result = await provider.chat({
						model: modelConfig.model,
						temperature: modelConfig.temperature,
						thinkingDisabled: modelConfig.thinkingDisabled,
						systemPrompt: EVOLUTION_JUDGE_SYSTEM,
						messages: [{ role: "user", content: userPrompt }],
						responseFormat: "json_object",
						maxTokens: modelConfig.maxOutputTokens,
					});
					parsed = parseEvolutionJudgeScores(result.content);
					writeJsonAtomic(judgeRecordPath, {
						questionId: question.id,
						promptHash: sha256(`${EVOLUTION_JUDGE_SYSTEM}\n${userPrompt}`),
						modelRequested: modelConfig.model,
						modelReturned: result.model,
						usage: result.usage,
						finishReason: result.finishReason,
						raw: result.content,
						parsed,
					});
				}
				if (parsed.length !== 2) throw new Error(`Judge 返回数量错误: ${question.id}`);
				for (const row of parsed) {
					const identity = keyById.get(row.sampleId);
					if (!identity || identity.questionId !== question.id) {
						throw new Error(`Judge sampleId 无法解析: ${row.sampleId}`);
					}
					scored.push({
						...row,
						questionId: question.id,
						category: identity.category,
						variant: identity.variant,
						total:
							row.requiredFactCoverage +
							row.conditionFidelity +
							row.answerabilityDiscipline +
							row.evidenceGrounding,
					});
				}
				console.error(`scored ${question.id}`);
			}

			const records = readRecords(join(runRoot, "records"));
			const affectedIds = new Set(["EV-COMM-001", "EV-PLAT-001", "EV-RES-001"]);
			const unaffectedIds = new Set(["EV-COMM-005", "EV-PLAT-005", "EV-RES-005"]);
			const wRows = scored.filter((row) => row.variant === experiment.wikiVariant);
			const gates = {
				affectedOldErrorRecurrenceZero: wRows
					.filter((row) => affectedIds.has(row.questionId))
					.every((row) => !row.hardFailure),
				unaffectedHardRegressionZero: wRows
					.filter((row) => unaffectedIds.has(row.questionId))
					.every((row) => !row.hardFailure),
				wCitationClosure: records
					.filter((record) => record.variant === experiment.wikiVariant)
					.every((record) => record.formatValid && record.citationValidation.valid),
			};
			const result = {
				schemaVersion: `wge-${experiment.milestone}-wiki-answer-result/v1`,
				runId,
				scoreId: scoreId ?? "default",
				judgeContractHash: sha256(EVOLUTION_JUDGE_SYSTEM),
				status: Object.values(gates).every(Boolean) ? "PASS" : "FAIL",
				scores: scored,
				summary: {
					R0: summarize(scored.filter((row) => row.variant === "R0")),
					[experiment.wikiVariant]: summarize(wRows),
				},
				gates,
				usage: {
					answers: sumUsage(records.map((record) => record.usage)),
					judges: sumUsage(
						readdirJson(judgeRoot).map((record) => (record as { usage?: unknown }).usage),
					),
				},
				createdAt: new Date().toISOString(),
			};
			writeJsonAtomic(resultPath, result);
			console.log(JSON.stringify(result, null, 2));
		},
	);

await program.parseAsync(process.argv);

function selectedQuestions(): Question[] {
	const payload = readJson<{ questions: Question[] }>(QUESTIONS_PATH);
	return payload.questions.filter((question) => SELECTED_IDS.has(question.id));
}

function readRecords(root: string): AnswerRecord[] {
	return readdirJson(root) as AnswerRecord[];
}

function readdirJson(root: string): unknown[] {
	return readdirSync(root)
		.filter((name) => name.endsWith(".json"))
		.sort()
		.map((name) => readJson(join(root, name)));
}

function deterministicVariants(
	runId: string,
	questionId: string,
	wikiVariant: "W" | "W2",
): Variant[] {
	return Number.parseInt(sha256(`${runId}:${questionId}:order`).slice(0, 2), 16) % 2 === 0
		? ["R0", wikiVariant]
		: [wikiVariant, "R0"];
}

function parseMilestone(value: string): Milestone {
	if (value !== "m1" && value !== "m2") throw new Error(`不支持的 milestone: ${value}`);
	return value;
}

function experimentPaths(milestone: Milestone) {
	if (milestone === "m2") {
		return {
			milestone,
			wikiVariant: "W2" as const,
			selectionPath: join(ROOT, "experiments/m2-wiki-completeness/selection-v1.json"),
			structuralRunsRoot: join(ROOT, "experiments/m2-wiki-completeness/runs"),
			runsRoot: join(ROOT, "experiments/m2-wiki-completeness/answer-runs"),
			wikiPacksFile: "w2-packs.json",
			r0PacksFile: "r0-packs.json",
		};
	}
	return {
		milestone,
		wikiVariant: "W" as const,
		selectionPath: join(ROOT, "experiments/m1-wiki-correction/selection-v1.json"),
		structuralRunsRoot: join(ROOT, "experiments/m1-wiki-correction/runs"),
		runsRoot: join(ROOT, "experiments/m1-wiki-correction/answer-runs"),
		wikiPacksFile: "after-packs.json",
		r0PacksFile: "after-r0-packs.json",
	};
}

function deterministicShuffle<T>(items: T[], seed: string): T[] {
	return [...items].sort((left, right) =>
		sha256(`${seed}:${JSON.stringify(left)}`).localeCompare(
			sha256(`${seed}:${JSON.stringify(right)}`),
		),
	);
}

function summarize(rows: Array<{ total: number; hardFailure: boolean }>) {
	return {
		n: rows.length,
		averageTotal:
			rows.length === 0 ? null : rows.reduce((sum, row) => sum + row.total, 0) / rows.length,
		hardFailures: rows.filter((row) => row.hardFailure).length,
	};
}

function assessAnswer(
	content: string,
	context: string,
): {
	formatValid: boolean;
	citationValidation: { valid: boolean; invalid: string[] };
} {
	try {
		return {
			formatValid: true,
			citationValidation: validateAnswerCitations(parseEvolutionAnswer(content), context),
		};
	} catch {
		return {
			formatValid: false,
			citationValidation: { valid: false, invalid: [] },
		};
	}
}

function sumDetailedUsage(values: unknown[]) {
	const rows = values.filter(
		(
			value,
		): value is {
			promptTokens: number;
			completionTokens: number;
			totalTokens: number;
			promptCacheHitTokens: number;
			promptCacheMissTokens: number;
			reasoningTokens: number;
		} => typeof value === "object" && value !== null && "totalTokens" in value,
	);
	return {
		promptTokens: rows.reduce((sum, row) => sum + row.promptTokens, 0),
		completionTokens: rows.reduce((sum, row) => sum + row.completionTokens, 0),
		totalTokens: rows.reduce((sum, row) => sum + row.totalTokens, 0),
		promptCacheHitTokens: rows.reduce((sum, row) => sum + row.promptCacheHitTokens, 0),
		promptCacheMissTokens: rows.reduce((sum, row) => sum + row.promptCacheMissTokens, 0),
		reasoningTokens: rows.reduce((sum, row) => sum + row.reasoningTokens, 0),
	};
}

function sumUsage(values: unknown[]) {
	const rows = values.filter(
		(value): value is { promptTokens: number; completionTokens: number; totalTokens: number } =>
			typeof value === "object" && value !== null && "totalTokens" in value,
	);
	return {
		promptTokens: rows.reduce((sum, row) => sum + row.promptTokens, 0),
		completionTokens: rows.reduce((sum, row) => sum + row.completionTokens, 0),
		totalTokens: rows.reduce((sum, row) => sum + row.totalTokens, 0),
	};
}

function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, "utf-8")) as T;
}

function sha256(value: string | Buffer): string {
	return createHash("sha256").update(value).digest("hex");
}

function safeArtifactId(value: string): string {
	if (!/^[a-z0-9][a-z0-9._-]*$/u.test(value)) {
		throw new Error(`非法 artifact id: ${value}`);
	}
	return value;
}
