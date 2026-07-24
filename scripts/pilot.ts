#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import { getCompileState } from "../src/compiler/run-state.js";
import { estimateTokens } from "../src/compiler/telemetry.js";
import { loadConfig } from "../src/config/index.js";
import { createLLMProvider } from "../src/core/llm-provider.js";
import {
	computeKnowledgeVersion,
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

interface QuestionFile {
	schemaVersion: string;
	setId: string;
	status: "PROPOSED_FOR_HUMAN_FREEZE" | "FROZEN";
	questions: PilotQuestion[];
}

interface SnapshotManifest {
	schemaVersion: "wge-pilot-snapshot/v1";
	createdAt: string;
	codeCommit: string;
	runtimeCodeHash: string;
	configHash: string;
	questionSetHash: string;
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
			corpusHash: corpusHash(rootConfig.projectRoot, pilotConfig.corpus),
			knowledgeVersion: computeKnowledgeVersion(claims, concepts, relations),
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
					contextHash: prepared.contextHash,
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
	if (snapshot.corpusHash !== corpusHash(root, config.corpus)) throw new Error("冻结语料已变化");
	const appConfig = loadConfig();
	const currentKnowledgeVersion = computeKnowledgeVersion(
		readAllClaims(appConfig),
		readAllConcepts(appConfig),
		readAllRelations(appConfig),
	);
	if (snapshot.knowledgeVersion !== currentKnowledgeVersion) throw new Error("冻结知识版本已变化");
	return snapshot;
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
