#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { Command } from "commander";
import { getCompileState } from "../src/compiler/run-state.js";
import { estimateTokens } from "../src/compiler/telemetry.js";
import { loadConfig } from "../src/config/index.js";
import { createLLMProvider } from "../src/core/llm-provider.js";
import {
	computeKnowledgeVersion,
	readAllAssertedRecords,
	readAllClaims,
	readAllConcepts,
	readAllRelations,
	readAllSources,
	readAllSpans,
	readAllWikiModules,
	readSourcePublications,
	resolveSpanById,
} from "../src/linter/storage.js";
import {
	type PilotConfig,
	type PilotGroup,
	type PilotQuestion,
	preparePilotContext,
} from "../src/pilot/index.js";
import { RELATION_AUDIT_VERSION } from "../src/prompts/index.js";

const ANSWER_SYSTEM_PROMPT = `你是一个受证据约束的问答 Agent。只使用本次请求提供的检索上下文回答问题。
要求：
1. 保留所有影响结论的条件、例外和不确定性。
2. 每个关键结论引用上下文中的 SOURCE、EVIDENCE 或 CLAIM 标识。
3. 如果上下文不足，明确回答 insufficient，不得依赖外部常识补齐。
4. 只输出严格 JSON：{"answer":"...","citations":["..."],"insufficient":false,"uncertainties":["..."]}。`;

const JUDGE_SYSTEM_PROMPT = `你是知识系统的盲测评分员。你只按提供的 Gold 和评分合同评价匿名答案，不判断答案来自哪个实验组。
必须逐项核对 requiredClaims、mustMentionConditions、forbiddenClaims、answerability 和证据引用。
sourceRisk.present=true 时，Gold 风险说明是允许使用的人工审计结论；不得把源材料的过强表述当成正确答案。
只输出严格 JSON：{"scores":[{"sampleId":"...","requiredClaimCoverage":0,"conditionFidelity":0,"evidenceGrounding":0,"answerabilityDiscipline":0,"hardFailure":false,"rationale":"..."}]}。`;

interface QuestionFile {
	schemaVersion: string;
	setId: string;
	status: "PROPOSED_FOR_HUMAN_FREEZE" | "FROZEN";
	questions: PilotQuestion[];
}

interface GoldEvidence {
	sourceFile: string;
	heading: string;
	exactQuote: string;
	supportsRequiredClaims: number[];
}

interface GoldQuestion {
	id: string;
	sourceRisk: { present: boolean; detail: string };
	evidence: GoldEvidence[];
}

interface GoldFile {
	schemaVersion: "wge-pilot-gold/v1";
	questionSetId: string;
	status: "DRAFT" | "FROZEN";
	scoringContract: unknown;
	questionGold: GoldQuestion[];
}

interface SnapshotManifest {
	schemaVersion: "wge-pilot-snapshot/v1";
	createdAt: string;
	codeCommit: string;
	runtimeCodeHash: string;
	configHash: string;
	questionSetHash: string;
	goldHash: string;
	corpusHash: string;
	knowledgeVersion: string;
	sources: Array<{
		uri: string;
		sourceId: string;
		sourceHash: string;
		compileState: string;
		publicationRunId: string;
		compilationConfigProof: "LOCKED" | "LEGACY_FROZEN_OUTPUT";
		claims: number;
		relations: number;
	}>;
	wikiModules: number;
	integrity: {
		claimsChecked: number;
		relationsChecked: number;
		brokenEvidence: number;
		brokenEndpoints: number;
		unauditedRelations: number;
		wikiModulesChecked: number;
		brokenWikiRefs: number;
	};
}

const program = new Command();
program.name("pilot").description("Five-document B/P/E-min product pilot runner");

program
	.command("snapshot")
	.description("Freeze and verify the five-document corpus and knowledge publication")
	.action(() => {
		const rootConfig = loadConfig();
		assertCleanWorktree(rootConfig.projectRoot);
		const pilotConfig = readPilotConfig(rootConfig.projectRoot);
		const questions = readQuestions(rootConfig.projectRoot);
		const gold = readGold(rootConfig.projectRoot);
		assertQuestionsFrozen(questions);
		assertGoldFrozen(gold);
		validateGold(rootConfig.projectRoot, pilotConfig, questions, gold);
		if (
			rootConfig.model !== pilotConfig.compiler.model ||
			rootConfig.temperature !== pilotConfig.compiler.temperature
		) {
			throw new Error(
				`运行配置与锁定编译配置不一致: ${rootConfig.model}@${rootConfig.temperature}`,
			);
		}
		const sources = readAllSources(rootConfig);
		const publications = readSourcePublications(rootConfig);
		const sourceRows = pilotConfig.corpus.map((uri) => {
			const source = sources.find((item) => item.uri === uri);
			if (!source) throw new Error(`冻结语料尚未摄入: ${uri}`);
			const publication = publications.find((item) => item.sourceId === source.id);
			if (!publication) throw new Error(`冻结语料尚未发布: ${uri}`);
			const compileState = getCompileState(rootConfig, source.id);
			if (compileState !== "COMPLETED") {
				throw new Error(`冻结语料未完成两阶段编译: ${uri} (${compileState})`);
			}
			const diffProofPath = join(rootConfig.runsDir, publication.runId, "publication-diff.json");
			const diffProof = existsSync(diffProofPath)
				? readJson<{
						runtime?: { requestedModel?: string; temperature?: number };
						status?: string;
					}>(diffProofPath)
				: null;
			const compilationConfigProof =
				diffProof?.status === "PASS" &&
				diffProof.runtime?.requestedModel === pilotConfig.compiler.model &&
				diffProof.runtime?.temperature === pilotConfig.compiler.temperature
					? ("LOCKED" as const)
					: ("LEGACY_FROZEN_OUTPUT" as const);
			return {
				uri,
				sourceId: source.id,
				sourceHash: source.hash,
				compileState,
				publicationRunId: publication.runId,
				compilationConfigProof,
				claims: publication.claims.length,
				relations: publication.relations.length,
			};
		});
		const claims = readAllClaims(rootConfig);
		const concepts = readAllConcepts(rootConfig);
		const relations = readAllRelations(rootConfig);
		const spans = readAllSpans(rootConfig);
		const wikiModules = readAllWikiModules(rootConfig);
		if (wikiModules.length < 2) {
			throw new Error(`E-min 快照至少需要 2 个 WikiModule，当前只有 ${wikiModules.length} 个`);
		}
		const canonicalClaimIds = new Set(claims.map((claim) => claim.id));
		const conceptIds = new Set(concepts.map((concept) => concept.id));
		let brokenEvidence = 0;
		let brokenEndpoints = 0;
		let unauditedRelations = 0;
		let brokenWikiRefs = 0;
		for (const claim of claims) {
			brokenEvidence += claim.evidenceSpanIds.filter(
				(spanId) => !resolveSpanById(spans, spanId),
			).length;
		}
		for (const relation of relations) {
			if (
				!canonicalClaimIds.has(relation.from as string) ||
				!canonicalClaimIds.has(relation.to as string)
			) {
				brokenEndpoints++;
			}
			brokenEvidence += relation.evidenceSpanIds.filter(
				(spanId) => !resolveSpanById(spans, spanId),
			).length;
			if (
				relation.relationAuditVersion !== RELATION_AUDIT_VERSION ||
				relation.conditionStatus === "UNVERIFIED" ||
				(relation.type === "EQUIVALENT_UNDER" && relation.conditions.length === 0)
			) {
				unauditedRelations++;
			}
		}
		for (const module of wikiModules) {
			brokenWikiRefs += module.claimRefs.filter(
				(claimId) => !canonicalClaimIds.has(claimId as string),
			).length;
			brokenWikiRefs += module.conceptRefs.filter(
				(conceptId) => !conceptIds.has(conceptId as string),
			).length;
		}
		if (brokenEvidence > 0 || brokenEndpoints > 0 || unauditedRelations > 0 || brokenWikiRefs > 0) {
			throw new Error(
				`知识快照完整性失败: brokenEvidence=${brokenEvidence}, brokenEndpoints=${brokenEndpoints}, unauditedRelations=${unauditedRelations}, brokenWikiRefs=${brokenWikiRefs}`,
			);
		}
		const snapshot: SnapshotManifest = {
			schemaVersion: "wge-pilot-snapshot/v1",
			createdAt: new Date().toISOString(),
			codeCommit: git(rootConfig.projectRoot, ["rev-parse", "HEAD"]),
			runtimeCodeHash: runtimeCodeHash(rootConfig.projectRoot),
			configHash: sha256(stableJson(pilotConfig)),
			questionSetHash: sha256(stableJson(questions)),
			goldHash: sha256(stableJson(gold)),
			corpusHash: corpusHash(rootConfig.projectRoot, pilotConfig.corpus),
			knowledgeVersion: computeKnowledgeVersion(
				claims,
				concepts,
				relations,
				wikiModules,
				readAllAssertedRecords(rootConfig),
			),
			sources: sourceRows,
			wikiModules: wikiModules.length,
			integrity: {
				claimsChecked: claims.length,
				relationsChecked: relations.length,
				brokenEvidence,
				brokenEndpoints,
				unauditedRelations,
				wikiModulesChecked: wikiModules.length,
				brokenWikiRefs,
			},
		};
		const path = snapshotPath(rootConfig.projectRoot);
		writeJson(path, snapshot);
		console.log(JSON.stringify(snapshot, null, 2));
	});

program
	.command("prepare")
	.description("Prepare leak-free retrieval contexts without calling the answer model")
	.option("--question <id>", "Prepare one question")
	.option("--group <group>", "Prepare one group: B, P, or E-min")
	.action((options: { question?: string; group?: string }) => {
		const rootConfig = loadConfig();
		const pilotConfig = readPilotConfig(rootConfig.projectRoot);
		const questions = readQuestions(rootConfig.projectRoot);
		assertQuestionsFrozen(questions);
		const snapshot = assertSnapshotCurrent(rootConfig.projectRoot, pilotConfig, questions);
		const selectedQuestions = options.question
			? questions.questions.filter((question) => question.id === options.question)
			: questions.questions;
		if (selectedQuestions.length === 0) throw new Error(`找不到问题: ${options.question}`);
		const groups = selectedGroups(pilotConfig, options.group);
		const runId = `prepare-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`;
		const runDirectory = join(rootConfig.projectRoot, "experiments", "pilot", "runs", runId);
		mkdirSync(join(runDirectory, "contexts"), { recursive: true });
		const records = [];
		for (const question of selectedQuestions) {
			for (const group of groups) {
				const prepared = preparePilotContext(
					rootConfig,
					pilotConfig,
					publicQuestion(question),
					group,
				);
				const record = {
					runId,
					category: question.category,
					corpusHash: snapshot.corpusHash,
					...prepared,
					knowledgeVersion: prepared.knowledgeVersion ?? snapshot.knowledgeVersion,
				};
				writeJson(join(runDirectory, "contexts", `${question.id}--${group}.json`), record);
				records.push(record);
			}
		}
		writeJson(join(runDirectory, "manifest.json"), {
			runId,
			mode: "PREPARE_ONLY",
			createdAt: new Date().toISOString(),
			snapshot,
			records: records.map(({ context: _context, ...record }) => record),
		});
		console.log(`${records.length} contexts prepared at ${runDirectory}`);
	});

program
	.command("run")
	.description("Run answer generation for frozen questions and save anonymous judge outputs")
	.option("--question <id>", "Run one question")
	.option("--group <group>", "Run one group: B, P, or E-min")
	.action(async (options: { question?: string; group?: string }) => {
		const baseConfig = loadConfig();
		const pilotConfig = readPilotConfig(baseConfig.projectRoot);
		const questions = readQuestions(baseConfig.projectRoot);
		assertQuestionsFrozen(questions);
		const snapshot = assertSnapshotCurrent(baseConfig.projectRoot, pilotConfig, questions);
		if (!baseConfig.apiKey) throw new Error("DEEPSEEK_API_KEY 未设置");
		const answerConfig = loadConfig({
			model: pilotConfig.answer.model,
			temperature: pilotConfig.answer.temperature,
		});
		const provider = createLLMProvider(answerConfig);
		const selectedQuestions = options.question
			? questions.questions.filter((question) => question.id === options.question)
			: questions.questions;
		if (selectedQuestions.length === 0) throw new Error(`找不到问题: ${options.question}`);
		const groups = selectedGroups(pilotConfig, options.group);
		const runId = `pilot-${randomUUID()}`;
		const runDirectory = join(baseConfig.projectRoot, "experiments", "pilot", "runs", runId);
		mkdirSync(join(runDirectory, "records"), { recursive: true });
		const blindRows: Array<{ sampleId: string; questionId: string; answer: string }> = [];
		const keyRows: Array<{ sampleId: string; questionId: string; group: PilotGroup }> = [];
		let expectedReturnedModel: string | null = null;

		for (const question of selectedQuestions) {
			for (const group of shuffled(groups, `${runId}:${question.id}`)) {
				const prepared = preparePilotContext(
					baseConfig,
					pilotConfig,
					publicQuestion(question),
					group,
				);
				const userPrompt = `# 问题\n${question.question}\n\n# 检索上下文\n${prepared.context}`;
				const promptHash = sha256(`${ANSWER_SYSTEM_PROMPT}\n${userPrompt}`);
				const started = Date.now();
				const result = await provider.chat({
					model: pilotConfig.answer.model,
					temperature: pilotConfig.answer.temperature,
					thinkingDisabled: pilotConfig.answer.thinkingDisabled,
					systemPrompt: ANSWER_SYSTEM_PROMPT,
					messages: [{ role: "user", content: userPrompt }],
					responseFormat: "json_object",
					maxTokens: pilotConfig.answer.maxOutputTokens,
				});
				if (expectedReturnedModel === null) expectedReturnedModel = result.model;
				if (result.model !== expectedReturnedModel) {
					throw new Error(
						`回答模型快照在同一 Pilot 中漂移: ${expectedReturnedModel} -> ${result.model}`,
					);
				}
				const sampleId = `sample-${randomUUID()}`;
				const record = {
					runId,
					questionId: question.id,
					category: question.category,
					group,
					corpusHash: snapshot.corpusHash,
					knowledgeVersion: prepared.knowledgeVersion ?? snapshot.knowledgeVersion,
					modelRequested: pilotConfig.answer.model,
					modelReturned: result.model,
					temperature: pilotConfig.answer.temperature,
					promptHash,
					request: {
						systemPrompt: ANSWER_SYSTEM_PROMPT,
						userPrompt,
					},
					contextHash: prepared.contextHash,
					questionHash: prepared.questionHash,
					configHash: prepared.configHash,
					knowledgeSnapshotHash: prepared.knowledgeSnapshotHash,
					inputSnapshotHash: prepared.inputSnapshotHash,
					traceHash: prepared.traceHash,
					estimatedContextTokens: prepared.estimatedContextTokens,
					estimatedTotalInputTokens: estimateTokens(`${ANSWER_SYSTEM_PROMPT}\n${userPrompt}`),
					usage: result.usage,
					latencyMs: Date.now() - started,
					finishReason: result.finishReason,
					toolCalls: prepared.toolCalls,
					retrievedClaims: prepared.retrievedClaims,
					retrievedRelations: prepared.retrievedRelations,
					evidenceSpans: prepared.evidenceSpans,
					retrievedSources: prepared.retrievedSources,
					droppedContext: prepared.droppedContext,
					retrievalTrace: prepared.retrievalTrace,
					answer: result.content,
					errors: [],
				};
				writeJson(join(runDirectory, "records", `${question.id}--${group}.json`), record);
				blindRows.push({ sampleId, questionId: question.id, answer: result.content });
				keyRows.push({ sampleId, questionId: question.id, group });
				console.error(`completed ${question.id} ${group}`);
			}
		}
		writeJson(join(runDirectory, "manifest.json"), {
			runId,
			createdAt: new Date().toISOString(),
			snapshot,
			modelReturned: expectedReturnedModel,
			questions: selectedQuestions.map((question) => question.id),
			groups,
		});
		writeJson(join(runDirectory, "blind-answers.json"), shuffled(blindRows, `${runId}:blind`));
		writeJson(join(runDirectory, "blinding-key.json"), keyRows);
		console.log(runDirectory);
	});

program
	.command("score")
	.description("Blind-score a completed Pilot run, then unblind and aggregate")
	.requiredOption("--run <directory>", "Pilot run directory")
	.action(async (options: { run: string }) => {
		const baseConfig = loadConfig();
		const pilotConfig = readPilotConfig(baseConfig.projectRoot);
		const questions = readQuestions(baseConfig.projectRoot);
		const gold = readGold(baseConfig.projectRoot);
		assertQuestionsFrozen(questions);
		assertGoldFrozen(gold);
		validateGold(baseConfig.projectRoot, pilotConfig, questions, gold);
		if (!baseConfig.apiKey) throw new Error("DEEPSEEK_API_KEY 未设置");
		const runDirectory = isAbsolute(options.run)
			? options.run
			: resolve(baseConfig.projectRoot, options.run);
		const blindAnswers = readJson<Array<{ sampleId: string; questionId: string; answer: string }>>(
			join(runDirectory, "blind-answers.json"),
		);
		const blindingKey = readJson<
			Array<{ sampleId: string; questionId: string; group: PilotGroup }>
		>(join(runDirectory, "blinding-key.json"));
		const keyBySample = new Map(blindingKey.map((item) => [item.sampleId, item]));
		const goldById = new Map(gold.questionGold.map((item) => [item.id, item]));
		const judgeConfig = loadConfig({
			model: pilotConfig.judge.model,
			temperature: pilotConfig.judge.temperature,
		});
		const provider = createLLMProvider(judgeConfig);
		const blindScores: Array<JudgeScore & { questionId: string; total: number }> = [];
		let expectedReturnedModel: string | null = null;
		mkdirSync(join(runDirectory, "judge-records"), { recursive: true });

		for (const question of questions.questions) {
			const samples = blindAnswers.filter((item) => item.questionId === question.id);
			if (samples.length === 0) continue;
			const goldItem = goldById.get(question.id);
			if (!goldItem) throw new Error(`评分缺少 Gold: ${question.id}`);
			const userPrompt = buildJudgePrompt(gold.scoringContract, question, goldItem, samples);
			const result = await provider.chat({
				model: pilotConfig.judge.model,
				temperature: pilotConfig.judge.temperature,
				thinkingDisabled: pilotConfig.judge.thinkingDisabled,
				systemPrompt: JUDGE_SYSTEM_PROMPT,
				messages: [{ role: "user", content: userPrompt }],
				responseFormat: "json_object",
				maxTokens: pilotConfig.judge.maxOutputTokens,
			});
			if (expectedReturnedModel === null) expectedReturnedModel = result.model;
			if (result.model !== expectedReturnedModel) {
				throw new Error(`评分模型快照漂移: ${expectedReturnedModel} -> ${result.model}`);
			}
			const parsed = parseJudgeScores(result.content);
			const expectedIds = new Set(samples.map((item) => item.sampleId));
			if (
				parsed.length !== expectedIds.size ||
				parsed.some((item) => !expectedIds.has(item.sampleId))
			) {
				throw new Error(`评分返回样本集合不一致: ${question.id}`);
			}
			for (const score of parsed) {
				const rawTotal =
					score.requiredClaimCoverage +
					score.conditionFidelity +
					score.evidenceGrounding +
					score.answerabilityDiscipline;
				blindScores.push({
					...score,
					questionId: question.id,
					total: score.hardFailure ? Math.min(2, rawTotal) : rawTotal,
				});
			}
			writeJson(join(runDirectory, "judge-records", `${question.id}.json`), {
				questionId: question.id,
				modelRequested: pilotConfig.judge.model,
				modelReturned: result.model,
				request: { systemPrompt: JUDGE_SYSTEM_PROMPT, userPrompt },
				usage: result.usage,
				finishReason: result.finishReason,
				rawResponse: result.content,
				parsed,
			});
			console.error(`scored ${question.id}`);
		}

		const unblinded = blindScores.map((score) => {
			const key = keyBySample.get(score.sampleId);
			if (!key) throw new Error(`盲化键缺少样本: ${score.sampleId}`);
			return { ...score, group: key.group };
		});
		const report = aggregateScores(unblinded, pilotConfig.execution.groups);
		writeJson(join(runDirectory, "scores.blind.json"), blindScores);
		writeJson(join(runDirectory, "scores.unblinded.json"), unblinded);
		writeJson(join(runDirectory, "score-report.json"), {
			judgeModelRequested: pilotConfig.judge.model,
			judgeModelReturned: expectedReturnedModel,
			generatedAt: new Date().toISOString(),
			report,
		});
		console.log(JSON.stringify(report, null, 2));
	});

program.parseAsync(process.argv).catch((error: unknown) => {
	console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
	process.exitCode = 1;
});

function readPilotConfig(root: string): PilotConfig {
	return readJson<PilotConfig>(join(root, "experiments", "pilot", "config.json"));
}

function readQuestions(root: string): QuestionFile {
	return readJson<QuestionFile>(join(root, "experiments", "pilot", "questions.json"));
}

function readGold(root: string): GoldFile {
	return readJson<GoldFile>(join(root, "experiments", "pilot", "gold-rubric.json"));
}

function publicQuestion(question: PilotQuestion): Pick<PilotQuestion, "id" | "question"> {
	return { id: question.id, question: question.question };
}

function assertQuestionsFrozen(questions: QuestionFile): void {
	if (questions.status !== "FROZEN") {
		throw new Error(
			`Pilot 题集状态是 ${questions.status}；产品负责人逐题确认后才能改为 FROZEN 并运行。`,
		);
	}
}

function assertGoldFrozen(gold: GoldFile): void {
	if (gold.status !== "FROZEN") throw new Error(`Pilot Gold 状态是 ${gold.status}，尚未冻结。`);
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
	const cleaned = content
		.trim()
		.replace(/^```(?:json)?\s*/i, "")
		.replace(/\s*```$/, "");
	const value = JSON.parse(cleaned) as { scores?: unknown };
	if (!Array.isArray(value.scores)) throw new Error("评分输出缺少 scores 数组");
	return value.scores.map((candidate) => {
		if (!candidate || typeof candidate !== "object") throw new Error("评分项不是对象");
		const row = candidate as Record<string, unknown>;
		const score = (key: string): number => {
			const item = row[key];
			if (!Number.isInteger(item) || Number(item) < 0 || Number(item) > 2) {
				throw new Error(`评分维度非法: ${key}=${String(item)}`);
			}
			return Number(item);
		};
		if (typeof row.sampleId !== "string" || typeof row.rationale !== "string") {
			throw new Error("评分项缺少 sampleId/rationale");
		}
		return {
			sampleId: row.sampleId,
			requiredClaimCoverage: score("requiredClaimCoverage"),
			conditionFidelity: score("conditionFidelity"),
			evidenceGrounding: score("evidenceGrounding"),
			answerabilityDiscipline: score("answerabilityDiscipline"),
			hardFailure: row.hardFailure === true,
			rationale: row.rationale,
		};
	});
}

function aggregateScores(
	rows: Array<JudgeScore & { questionId: string; total: number; group: PilotGroup }>,
	groups: PilotGroup[],
): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const group of groups) {
		const selected = rows.filter((row) => row.group === group);
		const average = (values: number[]) =>
			values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
		result[group] = {
			n: selected.length,
			averageTotal: average(selected.map((row) => row.total)),
			averageRequiredClaimCoverage: average(selected.map((row) => row.requiredClaimCoverage)),
			averageConditionFidelity: average(selected.map((row) => row.conditionFidelity)),
			averageEvidenceGrounding: average(selected.map((row) => row.evidenceGrounding)),
			averageAnswerabilityDiscipline: average(selected.map((row) => row.answerabilityDiscipline)),
			hardFailures: selected.filter((row) => row.hardFailure).length,
		};
	}
	return result;
}

function assertSnapshotCurrent(
	root: string,
	config: PilotConfig,
	questions: QuestionFile,
): SnapshotManifest {
	const path = snapshotPath(root);
	if (!existsSync(path))
		throw new Error("缺少 snapshot-manifest.json；先执行 npm run pilot -- snapshot");
	const snapshot = readJson<SnapshotManifest>(path);
	if (snapshot.runtimeCodeHash !== runtimeCodeHash(root)) throw new Error("Pilot 运行代码已变化");
	if (snapshot.configHash !== sha256(stableJson(config))) throw new Error("Pilot 配置已变化");
	if (snapshot.questionSetHash !== sha256(stableJson(questions)))
		throw new Error("Pilot 题集已变化");
	const gold = readGold(root);
	assertGoldFrozen(gold);
	validateGold(root, config, questions, gold);
	if (snapshot.goldHash !== sha256(stableJson(gold))) throw new Error("Pilot Gold 已变化");
	if (snapshot.corpusHash !== corpusHash(root, config.corpus)) throw new Error("冻结语料已变化");
	const appConfig = loadConfig();
	const currentKnowledgeVersion = computeKnowledgeVersion(
		readAllClaims(appConfig),
		readAllConcepts(appConfig),
		readAllRelations(appConfig),
		readAllWikiModules(appConfig),
		readAllAssertedRecords(appConfig),
	);
	if (snapshot.knowledgeVersion !== currentKnowledgeVersion) throw new Error("冻结知识版本已变化");
	return snapshot;
}

function validateGold(
	root: string,
	config: PilotConfig,
	questions: QuestionFile,
	gold: GoldFile,
): void {
	if (gold.questionSetId !== questions.setId) throw new Error("Gold 与题集 setId 不一致");
	const goldById = new Map(gold.questionGold.map((item) => [item.id, item]));
	if (goldById.size !== gold.questionGold.length) throw new Error("Gold 存在重复题号");
	const corpus = new Set(config.corpus);
	for (const question of questions.questions) {
		const item = goldById.get(question.id);
		if (!item) throw new Error(`Gold 缺少题目: ${question.id}`);
		const covered = new Set<number>();
		for (const evidence of item.evidence) {
			if (!corpus.has(evidence.sourceFile)) {
				throw new Error(`Gold 证据越过冻结语料: ${question.id} -> ${evidence.sourceFile}`);
			}
			const source = readFileSync(join(root, evidence.sourceFile), "utf-8");
			if (!source.includes(evidence.heading)) {
				throw new Error(`Gold heading 无法解析: ${question.id} -> ${evidence.heading}`);
			}
			if (!source.includes(evidence.exactQuote)) {
				throw new Error(`Gold exactQuote 无法解析: ${question.id} -> ${evidence.sourceFile}`);
			}
			for (const claimIndex of evidence.supportsRequiredClaims) {
				if (claimIndex < 0 || claimIndex >= question.requiredClaims.length) {
					throw new Error(`Gold requiredClaim 下标越界: ${question.id} -> ${claimIndex}`);
				}
				covered.add(claimIndex);
			}
		}
		if (!item.sourceRisk.present && question.answerability !== "insufficient") {
			for (let index = 0; index < question.requiredClaims.length; index++) {
				if (!covered.has(index))
					throw new Error(`Gold 未覆盖 requiredClaim: ${question.id}#${index}`);
			}
		}
		if (question.answerability === "answerable_with_source_risk" && !item.sourceRisk.present) {
			throw new Error(`source-risk 题缺少风险说明: ${question.id}`);
		}
	}
	for (const item of gold.questionGold) {
		if (!questions.questions.some((question) => question.id === item.id)) {
			throw new Error(`Gold 含题集外题号: ${item.id}`);
		}
	}
}

function selectedGroups(config: PilotConfig, requested?: string): PilotGroup[] {
	if (!requested) return config.execution.groups;
	if (!config.execution.groups.includes(requested as PilotGroup)) {
		throw new Error(`未知或未注册的组: ${requested}`);
	}
	return [requested as PilotGroup];
}

function snapshotPath(root: string): string {
	return join(root, "experiments", "pilot", "snapshot-manifest.json");
}

function corpusHash(root: string, paths: string[]): string {
	const hash = createHash("sha256");
	for (const path of [...paths].sort()) {
		hash.update(path);
		hash.update("\0");
		hash.update(readFileSync(join(root, path)));
		hash.update("\0");
	}
	return hash.digest("hex");
}

function runtimeCodeHash(root: string): string {
	const tracked = git(root, [
		"ls-files",
		"src",
		"scripts/pilot.ts",
		"package.json",
		"package-lock.json",
	])
		.split("\n")
		.filter(Boolean)
		.sort();
	const hash = createHash("sha256");
	for (const path of tracked) {
		hash.update(path);
		hash.update("\0");
		hash.update(readFileSync(join(root, path)));
		hash.update("\0");
	}
	return hash.digest("hex");
}

function assertCleanWorktree(root: string): void {
	const status = git(root, ["status", "--porcelain"]);
	if (status) throw new Error("创建冻结快照前必须提交或清理工作区变化");
}

function git(root: string, args: string[]): string {
	return execFileSync("git", args, { cwd: root, encoding: "utf-8" }).trim();
}

function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, "utf-8")) as T;
}

function writeJson(path: string, value: unknown): void {
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function stableJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
	if (value && typeof value === "object") {
		return `{${Object.entries(value as Record<string, unknown>)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function shuffled<T>(items: T[], seed: string): T[] {
	return [...items]
		.map((item, index) => ({ item, key: sha256(`${seed}:${index}`) }))
		.sort((left, right) => left.key.localeCompare(right.key))
		.map(({ item }) => item);
}
