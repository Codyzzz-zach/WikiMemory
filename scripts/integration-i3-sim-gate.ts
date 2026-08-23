#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import {
	IngestApplicationService,
	KnowledgeApplicationService,
	initializeRuntime,
} from "../src/application/index.js";
import { loadConfig } from "../src/config/index.js";
import { currentKnowledgeVersion } from "../src/evolution/version-store.js";
import {
	readAllClaims,
	readAllRelations,
	readAllSources,
	readAllWikiModules,
} from "../src/linter/storage.js";
import { readQuestionState } from "../src/wiki/question-storage.js";

type JsonRecord = Record<string, unknown>;

export interface I3SimTask {
	taskId: string;
	seedCaseId: string;
	prompt: string;
}

export interface I3SimTimepoint {
	timepoint: string;
	sourceIds: string[];
}

export interface I3SimEpisode {
	episodeId: string;
	domain: string;
	clusterId: string;
	changeClassHint: string;
	timepoints: I3SimTimepoint[];
	tasks: I3SimTask[];
	targetTransitions: string[];
}

export interface I3SimContract {
	schemaVersion: "wge-i3-sim-gate/v1";
	status: "FROZEN_SHADOW_DIAGNOSTIC";
	authority: {
		productBoundary: string;
		stageAUse: string;
		stageBUse: string;
		stageBRead: boolean;
		prohibitedKnowledgeInputs: string[];
	};
	sourceFreeze: {
		freezeRoot: string;
		freezeManifest: string;
		freezeManifestSha256: string;
		sourceMetadata: string;
		sourceMetadataSha256: string;
		publicQuestions: string;
		publicQuestionsSha256: string;
		publicEpisodes: string;
		publicEpisodesSha256: string;
	};
	execution: {
		compilerModel: string;
		temperature: number;
		semanticLint: boolean;
		knowledgeAccess: "MANAGED";
		stageBRead: boolean;
	};
	slice: {
		sourceCount: number;
		domainCount: number;
		taskCount: number;
		episodeCount: number;
		episodes: I3SimEpisode[];
	};
	budgets: {
		contextTokensPerTask: number;
		maxSourcesPerCommand: number;
		providerTokenSoftLimitPerSource: number;
		answerCallsBeforeStructuralPass: number;
		maxPairedAnswerCallsPerEpisodeReview: number;
		stopAfterSameFailureCount: number;
	};
	promotion: {
		hardFailureTolerance: number;
		minimumCausalWins: number;
		minimumWinningDomains: number;
		minimumPairedOutcomeCoverage: number;
		scopeLeakTolerance: number;
	};
}

interface SourceMetadataRow extends JsonRecord {
	sourceId: string;
	domain: string;
	sourceRole: string;
	clusterId: string;
	contentPath: string;
}

interface PublicQuestionRow extends JsonRecord {
	caseId: string;
	clusterIds: string[];
	question: string;
	status: string;
}

interface PublicEpisodeRow extends JsonRecord {
	episodeId: string;
	domain: string;
	clusterId: string;
	changeClassHint: string;
	timeline: I3SimTimepoint[];
	publicQuestions: string[];
	status: string;
}

export interface I3SimGateReport {
	schemaVersion: "wge-i3-sim-gate-report/v1";
	status: "PASS";
	stageBRead: false;
	manifestSha256: string;
	freezeManifestSha256: string;
	domains: string[];
	episodes: Array<{
		episodeId: string;
		domain: string;
		changeClassHint: string;
		sources: number;
		tasks: number;
		roles: string[];
	}>;
	totals: { sources: number; tasks: number; episodes: number; domains: number };
	nextStep: { episodeId: string; timepoint: string; sourceId: string };
}

interface ValidatedGate {
	contract: I3SimContract;
	report: I3SimGateReport;
	manifestPath: string;
	manifestSha256: string;
	freezeRoot: string;
	sourceRows: Map<string, SourceMetadataRow>;
}

interface Cursor {
	episodeIndex: number;
	timepointIndex: number;
	sourceIndex: number;
}

interface GateSession {
	schemaVersion: "wge-i3-sim-session/v1";
	status: "READY" | "STOP_REVIEW" | "COMPLETE";
	createdAt: string;
	updatedAt: string;
	codeCommit: string;
	gateManifestSha256: string;
	runtimeRoot: string;
	cursor: Cursor;
	completedIterations: number;
	stopReasons: string[];
	resumeCount?: number;
}

interface StateSnapshot {
	knowledgeVersion: string;
	sources: number;
	claims: number;
	relations: number;
	questionFrames: number;
	questionDecisions: number;
	questionStateHash: string;
	wikiModules: number;
	wikiStateHash: string;
}

interface LlmTotals {
	providerCalls: number;
	providerFailures: number;
	invalidParses: number;
	totalTokens: number;
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");

export function loadAndValidateGate(
	root = projectRoot,
	manifestPath = join(root, "benchmarks", "i3-sim-gate-v1", "manifest.json"),
): ValidatedGate {
	const raw = readJson(manifestPath);
	return validateGateContract(root, raw, manifestPath);
}

export function validateGateContract(
	root: string,
	raw: unknown,
	manifestPath = join(root, "benchmarks", "i3-sim-gate-v1", "manifest.json"),
): ValidatedGate {
	const contract = parseContract(raw);
	assert(contract.authority.stageBRead === false, "Authority must keep Stage B unread");
	assert(contract.execution.stageBRead === false, "Execution must keep Stage B unread");
	assert(
		contract.authority.productBoundary === "HUMAN_SELECTED_MATERIALS_ONLY",
		"Product boundary drifted",
	);
	assert(contract.budgets.maxSourcesPerCommand === 1, "Each command must compile one Source");
	assert(
		contract.budgets.answerCallsBeforeStructuralPass === 0,
		"Answer calls must be blocked before structural PASS",
	);
	assert(contract.execution.temperature === 0, "Compiler temperature must be zero");

	const freezeManifestPath = resolveInput(root, contract.sourceFreeze.freezeManifest);
	const sourceMetadataPath = resolveInput(root, contract.sourceFreeze.sourceMetadata);
	const publicQuestionsPath = resolveInput(root, contract.sourceFreeze.publicQuestions);
	const publicEpisodesPath = resolveInput(root, contract.sourceFreeze.publicEpisodes);
	assertFileHash(freezeManifestPath, contract.sourceFreeze.freezeManifestSha256);
	assertFileHash(sourceMetadataPath, contract.sourceFreeze.sourceMetadataSha256);
	assertFileHash(publicQuestionsPath, contract.sourceFreeze.publicQuestionsSha256);
	assertFileHash(publicEpisodesPath, contract.sourceFreeze.publicEpisodesSha256);

	const freezeManifest = readJson(freezeManifestPath);
	assert(
		freezeManifest.status === "ACCEPTED_STAGE_A_DEV_SCALE",
		"S200 Stage A freeze is not accepted",
	);
	assert(freezeManifest.stageBRead === false, "Historical S200 freeze read Stage B");
	const freezeInventory = new Map<string, string>();
	for (const item of requireArray(freezeManifest, "fileInventoryExcludingManifest")) {
		const row = asRecord(item, "freeze inventory item");
		freezeInventory.set(requireString(row, "path"), requireString(row, "sha256"));
	}

	const sourceRows = new Map(
		readJsonl(sourceMetadataPath).map((row) => {
			const parsed = parseSourceRow(row);
			return [parsed.sourceId, parsed] as const;
		}),
	);
	const questionRows = new Map(
		readJsonl(publicQuestionsPath).map((row) => {
			const parsed = parseQuestionRow(row);
			return [parsed.caseId, parsed] as const;
		}),
	);
	const episodeRows = new Map(
		readJsonl(publicEpisodesPath).map((row) => {
			const parsed = parseEpisodeRow(row);
			return [parsed.episodeId, parsed] as const;
		}),
	);

	const episodeIds = new Set<string>();
	const sourceIds = new Set<string>();
	const taskIds = new Set<string>();
	const seedCaseIds = new Set<string>();
	const domains = new Set<string>();
	const changeClasses = new Set<string>();
	const episodeReports: I3SimGateReport["episodes"] = [];
	const freezeRoot = resolveInput(root, contract.sourceFreeze.freezeRoot);

	for (const episode of contract.slice.episodes) {
		assertUnique(episodeIds, episode.episodeId, "episodeId");
		domains.add(episode.domain);
		changeClasses.add(episode.changeClassHint);
		const publicEpisode = episodeRows.get(episode.episodeId);
		assert(publicEpisode, `Missing public episode: ${episode.episodeId}`);
		assert(publicEpisode.status === "candidate-public-sealed-gold", "Episode status drifted");
		assert(publicEpisode.domain === episode.domain, `Episode domain drift: ${episode.episodeId}`);
		assert(
			publicEpisode.clusterId === episode.clusterId,
			`Episode cluster drift: ${episode.episodeId}`,
		);
		assert(
			publicEpisode.changeClassHint === episode.changeClassHint,
			`Episode change class drift: ${episode.episodeId}`,
		);
		assert(
			stableJson(publicEpisode.timeline) === stableJson(episode.timepoints),
			`Episode timeline drift: ${episode.episodeId}`,
		);

		const roles = new Set<string>();
		for (const timepoint of episode.timepoints) {
			assert(/^T\d+$/.test(timepoint.timepoint), `Invalid timepoint: ${timepoint.timepoint}`);
			assert(timepoint.sourceIds.length > 0, `Empty timepoint: ${episode.episodeId}`);
			for (const sourceId of timepoint.sourceIds) {
				assertUnique(sourceIds, sourceId, "sourceId");
				const source = sourceRows.get(sourceId);
				assert(source, `Missing source metadata: ${sourceId}`);
				assert(source.domain === episode.domain, `Source domain drift: ${sourceId}`);
				assert(source.clusterId === episode.clusterId, `Source cluster drift: ${sourceId}`);
				roles.add(source.sourceRole);
				const frozenPath = `compilation-corpus/${source.domain}/${sourceId}.md`;
				const expectedHash = freezeInventory.get(frozenPath);
				assert(expectedHash, `Source is absent from frozen inventory: ${sourceId}`);
				assertFileHash(join(freezeRoot, frozenPath), expectedHash);
			}
		}
		assert(roles.has("P-primary"), `Episode lacks primary material: ${episode.episodeId}`);
		assert(roles.size >= 2, `Episode lacks source-role contrast: ${episode.episodeId}`);

		for (const task of episode.tasks) {
			assertUnique(taskIds, task.taskId, "taskId");
			assertUnique(seedCaseIds, task.seedCaseId, "seedCaseId");
			const question = questionRows.get(task.seedCaseId);
			assert(question, `Missing public question seed: ${task.seedCaseId}`);
			assert(question.status === "candidate-public-sealed-gold", "Question status drifted");
			assert(
				question.clusterIds.includes(episode.clusterId),
				`Question seed is outside episode cluster: ${task.seedCaseId}`,
			);
			assert(task.prompt.trim().length >= 30, `Natural task is too short: ${task.taskId}`);
			assert(
				task.prompt.trim() !== question.question.trim(),
				`Task copied public question: ${task.taskId}`,
			);
		}
		episodeReports.push({
			episodeId: episode.episodeId,
			domain: episode.domain,
			changeClassHint: episode.changeClassHint,
			sources: episode.timepoints.reduce((sum, item) => sum + item.sourceIds.length, 0),
			tasks: episode.tasks.length,
			roles: [...roles].sort(),
		});
	}

	assert(sourceIds.size === contract.slice.sourceCount, "Declared source count drifted");
	assert(taskIds.size === contract.slice.taskCount, "Declared task count drifted");
	assert(episodeIds.size === contract.slice.episodeCount, "Declared episode count drifted");
	assert(domains.size === contract.slice.domainCount, "Declared domain count drifted");
	assert(sourceIds.size >= 12 && sourceIds.size <= 18, "Shadow Slice must contain 12..18 sources");
	assert(taskIds.size >= 6 && taskIds.size <= 10, "Shadow Slice must contain 6..10 tasks");
	for (const required of ["dispute", "supersede", "new-evidence"]) {
		assert(changeClasses.has(required), `Missing change class: ${required}`);
	}

	const first = contract.slice.episodes[0];
	const firstTimepoint = first?.timepoints[0];
	const firstSource = firstTimepoint?.sourceIds[0];
	assert(first && firstTimepoint && firstSource, "Slice has no first Source");
	const manifestSha256 = `sha256:${sha256Bytes(readFileSync(manifestPath))}`;
	return {
		contract,
		manifestPath,
		manifestSha256,
		freezeRoot,
		sourceRows,
		report: {
			schemaVersion: "wge-i3-sim-gate-report/v1",
			status: "PASS",
			stageBRead: false,
			manifestSha256,
			freezeManifestSha256: contract.sourceFreeze.freezeManifestSha256,
			domains: [...domains].sort(),
			episodes: episodeReports,
			totals: {
				sources: sourceIds.size,
				tasks: taskIds.size,
				episodes: episodeIds.size,
				domains: domains.size,
			},
			nextStep: {
				episodeId: first.episodeId,
				timepoint: firstTimepoint.timepoint,
				sourceId: firstSource,
			},
		},
	};
}

async function prepare(runtimeRootInput: string): Promise<void> {
	const gate = loadAndValidateGate();
	assertCleanWorktree();
	const runtimeRoot = validateRuntimeRoot(runtimeRootInput);
	const config = loadConfig({ runtimeRoot });
	initializeRuntime(config);
	const sessionPath = getSessionPath(runtimeRoot);
	if (existsSync(sessionPath)) {
		const existing = parseSession(readJson(sessionPath));
		assert(
			existing.gateManifestSha256 === gate.manifestSha256,
			"Existing session uses another Gate",
		);
		assert(
			existing.codeCommit === git(["rev-parse", "HEAD"]),
			"Existing session uses another commit",
		);
		console.log(JSON.stringify({ reused: true, session: existing, gate: gate.report }, null, 2));
		return;
	}
	mkdirSync(dirname(sessionPath), { recursive: true });
	const now = new Date().toISOString();
	const session: GateSession = {
		schemaVersion: "wge-i3-sim-session/v1",
		status: "READY",
		createdAt: now,
		updatedAt: now,
		codeCommit: git(["rev-parse", "HEAD"]),
		gateManifestSha256: gate.manifestSha256,
		runtimeRoot,
		cursor: { episodeIndex: 0, timepointIndex: 0, sourceIndex: 0 },
		completedIterations: 0,
		stopReasons: [],
		resumeCount: 0,
	};
	writeFileSync(sessionPath, `${JSON.stringify(session, null, 2)}\n`, { flag: "wx" });
	console.log(JSON.stringify({ reused: false, session, gate: gate.report }, null, 2));
}

async function runNext(runtimeRootInput: string): Promise<void> {
	const gate = loadAndValidateGate();
	assertCleanWorktree();
	const runtimeRoot = validateRuntimeRoot(runtimeRootInput);
	const sessionPath = getSessionPath(runtimeRoot);
	assert(existsSync(sessionPath), "I3-Sim session is not prepared");
	const session = parseSession(readJson(sessionPath));
	assert(session.status === "READY", `Session cannot run from status ${session.status}`);
	assert(session.gateManifestSha256 === gate.manifestSha256, "Gate manifest changed after prepare");
	assert(session.codeCommit === git(["rev-parse", "HEAD"]), "Code commit changed after prepare");
	const selected = selectionAt(gate.contract, session.cursor);
	assert(selected, "Session cursor is already complete");
	const source = gate.sourceRows.get(selected.sourceId);
	assert(source, `Missing selected Source: ${selected.sourceId}`);
	const sourcePath = join(
		gate.freezeRoot,
		"compilation-corpus",
		source.domain,
		`${source.sourceId}.md`,
	);
	const config = loadConfig({
		runtimeRoot,
		model: gate.contract.execution.compilerModel,
		temperature: gate.contract.execution.temperature,
	});
	assert(config.apiKey.length > 0, "DEEPSEEK_API_KEY is required for run-next");
	const before = snapshotState(config);
	const usageBefore = readLlmTotals(config.runsDir);
	let compile: JsonRecord | null = null;
	let compileError: string | null = null;
	try {
		const response = await new IngestApplicationService(config, {
			onProgress: (event) => {
				console.error(`[${event.stage}] ${event.message}`);
			},
		}).ingestMaterial({
			filePath: sourcePath,
			domain: selected.episode.domain,
			semantic: gate.contract.execution.semanticLint,
		});
		compile = response as unknown as JsonRecord;
	} catch (error) {
		compileError = errorMessage(error);
	}
	const after = snapshotState(config);
	const usageAfter = readLlmTotals(config.runsDir);
	const usage = subtractUsage(usageAfter, usageBefore);
	const timepointComplete = session.cursor.sourceIndex === selected.timepoint.sourceIds.length - 1;
	const consumption =
		timepointComplete && compileError === null
			? inspectConsumption(config, selected.episode, gate.contract.budgets.contextTokensPerTask)
			: [];
	const stopReasons: string[] = [];
	if (compileError) stopReasons.push("COMPILE_FAILED");
	if (compile?.compileState !== "COMPLETED") stopReasons.push("COMPILE_NOT_COMPLETED");
	if (usage.totalTokens > gate.contract.budgets.providerTokenSoftLimitPerSource) {
		stopReasons.push("PROVIDER_TOKEN_SOFT_LIMIT");
	}
	if (consumption.some((item) => item.supportLeakCount > 0)) {
		stopReasons.push("WIKI_SUPPORT_FAIL_OPEN");
	}
	if (timepointComplete && consumption.every((item) => item.wikiModuleIds.length === 0)) {
		stopReasons.push("NO_WIKI_CONSUMPTION_AT_TIMEPOINT");
	}
	const nextCursor = cursorAfterAttempt(gate.contract, session.cursor, stopReasons);
	const nextStatus = stopReasons.length > 0 ? "STOP_REVIEW" : nextCursor ? "READY" : "COMPLETE";
	const iterationNumber = session.completedIterations + 1;
	const receipt = {
		schemaVersion: "wge-i3-sim-iteration/v1",
		iterationNumber,
		startedFromCommit: session.codeCommit,
		gateManifestSha256: gate.manifestSha256,
		episodeId: selected.episode.episodeId,
		timepoint: selected.timepoint.timepoint,
		sourceId: selected.sourceId,
		sourcePath: relative(projectRoot, sourcePath),
		timepointComplete,
		before,
		after,
		compile,
		compileError,
		providerUsage: usage,
		consumption,
		result: stopReasons.length === 0 ? "PASS_TO_NEXT_SOURCE" : "STOP_REVIEW",
		stopReasons,
		finishedAt: new Date().toISOString(),
	};
	const receiptPath = join(
		dirname(sessionPath),
		`iteration-${String(iterationNumber).padStart(3, "0")}.json`,
	);
	writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx" });
	const updated: GateSession = {
		...session,
		status: nextStatus,
		updatedAt: new Date().toISOString(),
		cursor: nextCursor ?? session.cursor,
		completedIterations: iterationNumber,
		stopReasons,
	};
	writeJsonAtomic(sessionPath, updated);
	console.log(JSON.stringify({ session: updated, receipt }, null, 2));
}

function resumeSession(runtimeRootInput: string, reasonInput: string): void {
	const gate = loadAndValidateGate();
	assertCleanWorktree();
	const runtimeRoot = validateRuntimeRoot(runtimeRootInput);
	const sessionPath = getSessionPath(runtimeRoot);
	assert(existsSync(sessionPath), "I3-Sim session is not prepared");
	const session = parseSession(readJson(sessionPath));
	assert(session.status === "STOP_REVIEW", `Session cannot resume from status ${session.status}`);
	const reason = reasonInput.trim();
	assert(reason.length >= 12, "Resume reason must contain at least 12 characters");
	assert(session.completedIterations > 0, "Stopped session has no failed iteration");
	const receiptPath = join(
		dirname(sessionPath),
		`iteration-${String(session.completedIterations).padStart(3, "0")}.json`,
	);
	const failedReceipt = readJson(receiptPath);
	const compileFailureReasons = new Set(["COMPILE_FAILED", "COMPILE_NOT_COMPLETED"]);
	const isCompileFailure = session.stopReasons.every((item) => compileFailureReasons.has(item));
	const isLegacyFailClosedStop =
		session.stopReasons.length === 1 && session.stopReasons[0] === "WIKI_SUPPORT_GATE_REJECTION";
	assert(
		isCompileFailure || isLegacyFailClosedStop,
		`Stop reasons require product review, not retry: ${session.stopReasons.join(",")}`,
	);
	let reviewEvidence: ReturnType<typeof inspectConsumption> | null = null;
	let resumeCursor: Cursor;
	if (isCompileFailure) {
		resumeCursor = findCursorForReceipt(gate.contract, failedReceipt);
	} else {
		const episodeId = requireString(failedReceipt, "episodeId");
		const episode = gate.contract.slice.episodes.find((item) => item.episodeId === episodeId);
		assert(episode, `Failed receipt episode is outside Gate: ${episodeId}`);
		const config = loadConfig({ runtimeRoot });
		reviewEvidence = inspectConsumption(
			config,
			episode,
			gate.contract.budgets.contextTokensPerTask,
		);
		assert(
			reviewEvidence.every((item) => item.supportLeakCount === 0),
			"Rejected WikiModule remained visible; fail-open cannot be resumed",
		);
		resumeCursor = session.cursor;
	}
	const currentCommit = git(["rev-parse", "HEAD"]);
	const resumeNumber = (session.resumeCount ?? 0) + 1;
	const resumeReceipt = {
		schemaVersion: "wge-i3-sim-resume/v1",
		resumeNumber,
		failedIteration: session.completedIterations,
		fromCommit: session.codeCommit,
		toCommit: currentCommit,
		previousStopReasons: session.stopReasons,
		cursor: resumeCursor,
		reviewEvidence,
		reason,
		resumedAt: new Date().toISOString(),
	};
	writeFileSync(
		join(dirname(sessionPath), `resume-${String(resumeNumber).padStart(3, "0")}.json`),
		`${JSON.stringify(resumeReceipt, null, 2)}\n`,
		{ flag: "wx" },
	);
	const updated: GateSession = {
		...session,
		status: "READY",
		updatedAt: new Date().toISOString(),
		codeCommit: currentCommit,
		cursor: resumeCursor,
		stopReasons: [],
		resumeCount: resumeNumber,
	};
	writeJsonAtomic(sessionPath, updated);
	console.log(JSON.stringify({ session: updated, resume: resumeReceipt }, null, 2));
}

function inspectConsumption(
	config: ReturnType<typeof loadConfig>,
	episode: I3SimEpisode,
	budgetTokens: number,
): Array<{
	taskId: string;
	claimCount: number;
	relationCount: number;
	wikiModuleIds: string[];
	supportRejections: number;
	rejectedModuleIds: string[];
	supportLeakCount: number;
	estimatedTokens: number;
}> {
	const service = new KnowledgeApplicationService(config);
	return episode.tasks.map((task) => {
		const response = service.queryContext({
			task: task.prompt,
			budgetTokens,
			maxGraphDepth: 3,
			knowledgeAccess: "MANAGED",
			indexFailurePolicy: "LEGACY_FALLBACK",
		});
		const wikiModuleIds = response.pack.wikiModules.map((module) => module.id).sort();
		const rejectedModuleIds = response.diagnostics.wiki.supportGates
			.filter((gate) => !gate.accepted)
			.map((gate) => gate.moduleId)
			.sort();
		return {
			taskId: task.taskId,
			claimCount: response.pack.subgraph.claims.length,
			relationCount: response.pack.subgraph.relations.length,
			wikiModuleIds,
			supportRejections: rejectedModuleIds.length,
			rejectedModuleIds,
			supportLeakCount: countSupportLeaks(response.diagnostics.wiki.supportGates, wikiModuleIds),
			estimatedTokens: response.diagnostics.budget.finalEstimatedTokens,
		};
	});
}

export function countSupportLeaks(
	gates: Array<{ moduleId: string; accepted: boolean }>,
	visibleModuleIds: string[],
): number {
	const rejected = new Set(gates.filter((gate) => !gate.accepted).map((gate) => gate.moduleId));
	return visibleModuleIds.filter((moduleId) => rejected.has(moduleId)).length;
}

function snapshotState(config: ReturnType<typeof loadConfig>): StateSnapshot {
	const questions = readQuestionState(config);
	const wikiModules = readAllWikiModules(config).sort((left, right) =>
		left.id.localeCompare(right.id),
	);
	return {
		knowledgeVersion: currentKnowledgeVersion(config),
		sources: readAllSources(config).length,
		claims: readAllClaims(config).length,
		relations: readAllRelations(config).length,
		questionFrames: questions.frames.length,
		questionDecisions: questions.decisions.length,
		questionStateHash: questions.stateHash,
		wikiModules: wikiModules.length,
		wikiStateHash: `sha256:${sha256Bytes(Buffer.from(stableJson(wikiModules)))}`,
	};
}

function readLlmTotals(runsDir: string): LlmTotals {
	const path = join(runsDir, "llm-calls.jsonl");
	const rows = existsSync(path) ? readJsonl(path) : [];
	const invalidCallIds = new Set(
		rows
			.filter((row) => row.eventType === "LLM_PARSE_RESULT" && row.outcome === "INVALID")
			.map((row) => String(row.callId ?? "")),
	);
	let providerCalls = 0;
	let providerFailures = 0;
	let totalTokens = 0;
	for (const row of rows) {
		if (row.eventType === "LLM_CALL_COMPLETED") {
			providerCalls++;
			const usage = asRecord(row.usage ?? {}, "LLM usage");
			const value = usage.totalTokens;
			if (typeof value === "number" && Number.isFinite(value)) totalTokens += value;
		} else if (row.eventType === "LLM_CALL_FAILED") {
			providerFailures++;
		}
	}
	return { providerCalls, providerFailures, invalidParses: invalidCallIds.size, totalTokens };
}

function subtractUsage(after: LlmTotals, before: LlmTotals): LlmTotals {
	return {
		providerCalls: after.providerCalls - before.providerCalls,
		providerFailures: after.providerFailures - before.providerFailures,
		invalidParses: after.invalidParses - before.invalidParses,
		totalTokens: after.totalTokens - before.totalTokens,
	};
}

function selectionAt(contract: I3SimContract, cursor: Cursor) {
	const episode = contract.slice.episodes[cursor.episodeIndex];
	const timepoint = episode?.timepoints[cursor.timepointIndex];
	const sourceId = timepoint?.sourceIds[cursor.sourceIndex];
	return episode && timepoint && sourceId ? { episode, timepoint, sourceId } : null;
}

function advanceCursor(contract: I3SimContract, cursor: Cursor): Cursor | null {
	const episode = contract.slice.episodes[cursor.episodeIndex];
	const timepoint = episode?.timepoints[cursor.timepointIndex];
	if (!episode || !timepoint) return null;
	if (cursor.sourceIndex + 1 < timepoint.sourceIds.length) {
		return { ...cursor, sourceIndex: cursor.sourceIndex + 1 };
	}
	if (cursor.timepointIndex + 1 < episode.timepoints.length) {
		return {
			episodeIndex: cursor.episodeIndex,
			timepointIndex: cursor.timepointIndex + 1,
			sourceIndex: 0,
		};
	}
	if (cursor.episodeIndex + 1 < contract.slice.episodes.length) {
		return { episodeIndex: cursor.episodeIndex + 1, timepointIndex: 0, sourceIndex: 0 };
	}
	return null;
}

export function cursorAfterAttempt(
	contract: I3SimContract,
	cursor: Cursor,
	stopReasons: string[],
): Cursor | null {
	if (stopReasons.includes("COMPILE_FAILED") || stopReasons.includes("COMPILE_NOT_COMPLETED")) {
		return cursor;
	}
	return advanceCursor(contract, cursor);
}

function findCursorForReceipt(contract: I3SimContract, receipt: JsonRecord): Cursor {
	const episodeId = requireString(receipt, "episodeId");
	const timepointName = requireString(receipt, "timepoint");
	const sourceId = requireString(receipt, "sourceId");
	for (const [episodeIndex, episode] of contract.slice.episodes.entries()) {
		if (episode.episodeId !== episodeId) continue;
		for (const [timepointIndex, timepoint] of episode.timepoints.entries()) {
			if (timepoint.timepoint !== timepointName) continue;
			const sourceIndex = timepoint.sourceIds.indexOf(sourceId);
			if (sourceIndex >= 0) return { episodeIndex, timepointIndex, sourceIndex };
		}
	}
	throw new Error(
		`Failed receipt is outside the frozen Gate: ${episodeId}/${timepointName}/${sourceId}`,
	);
}

function parseContract(value: unknown): I3SimContract {
	const record = asRecord(value, "I3-Sim manifest");
	assert(record.schemaVersion === "wge-i3-sim-gate/v1", "Unsupported I3-Sim schema");
	assert(record.status === "FROZEN_SHADOW_DIAGNOSTIC", "I3-Sim manifest is not frozen");
	return record as unknown as I3SimContract;
}

function parseSourceRow(value: JsonRecord): SourceMetadataRow {
	return {
		...value,
		sourceId: requireString(value, "sourceId"),
		domain: requireString(value, "domain"),
		sourceRole: requireString(value, "sourceRole"),
		clusterId: requireString(value, "clusterId"),
		contentPath: requireString(value, "contentPath"),
	};
}

function parseQuestionRow(value: JsonRecord): PublicQuestionRow {
	return {
		...value,
		caseId: requireString(value, "caseId"),
		clusterIds: requireStringArray(value, "clusterIds"),
		question: requireString(value, "question"),
		status: requireString(value, "status"),
	};
}

function parseEpisodeRow(value: JsonRecord): PublicEpisodeRow {
	const timeline = requireArray(value, "timeline").map((item) => {
		const row = asRecord(item, "public episode timepoint");
		return {
			timepoint: requireString(row, "timepoint"),
			sourceIds: requireStringArray(row, "sourceIds"),
		};
	});
	return {
		...value,
		episodeId: requireString(value, "episodeId"),
		domain: requireString(value, "domain"),
		clusterId: requireString(value, "clusterId"),
		changeClassHint: requireString(value, "changeClassHint"),
		timeline,
		publicQuestions: requireStringArray(value, "publicQuestions"),
		status: requireString(value, "status"),
	};
}

function parseSession(value: JsonRecord): GateSession {
	assert(value.schemaVersion === "wge-i3-sim-session/v1", "Unsupported I3-Sim session");
	return value as unknown as GateSession;
}

function validateRuntimeRoot(value: string): string {
	assert(isAbsolute(value), "--runtime-root must be an absolute path");
	const runtimeRoot = resolve(value);
	assert(runtimeRoot !== projectRoot, "I3-Sim cannot use the repository root as runtime");
	assert(
		!/(^|[/\\])(stage-b|gold)([/\\]|$)/i.test(runtimeRoot),
		"Runtime path cannot reference sealed data",
	);
	return runtimeRoot;
}

function resolveInput(root: string, input: string): string {
	assert(!isAbsolute(input), `Frozen input must be repository-relative: ${input}`);
	assert(!/(^|[/\\])(stage-b|gold)([/\\]|$)/i.test(input), `Sealed input is prohibited: ${input}`);
	const resolved = resolve(root, input);
	assert(resolved.startsWith(`${resolve(root)}${sep}`), `Input escapes repository: ${input}`);
	return resolved;
}

function assertFileHash(path: string, expected: string): void {
	assert(existsSync(path), `Missing frozen input: ${relative(projectRoot, path)}`);
	const actual = `sha256:${sha256Bytes(readFileSync(path))}`;
	assert(actual === expected, `Frozen input drift: ${relative(projectRoot, path)}`);
}

function assertCleanWorktree(): void {
	const status = git(["status", "--porcelain"]);
	assert(status.length === 0, "I3-Sim prepare/run-next requires a clean worktree");
}

function git(args: string[]): string {
	const result = spawnSync("git", args, { cwd: projectRoot, encoding: "utf8" });
	if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(" ")} failed`);
	return result.stdout.trim();
}

function getSessionPath(runtimeRoot: string): string {
	return join(runtimeRoot, "runs", "i3-sim-gate", "session.json");
}

function writeJsonAtomic(path: string, value: unknown): void {
	const temporary = `${path}.tmp-${process.pid}`;
	writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
	renameSync(temporary, path);
}

function readJson(path: string): JsonRecord {
	return asRecord(JSON.parse(readFileSync(path, "utf8")) as unknown, path);
}

function readJsonl(path: string): JsonRecord[] {
	return readFileSync(path, "utf8")
		.split(/\r?\n/)
		.filter((line) => line.trim().length > 0)
		.map((line, index) => asRecord(JSON.parse(line) as unknown, `${path}:${index + 1}`));
}

function requireArray(value: JsonRecord, key: string): unknown[] {
	const candidate = value[key];
	assert(Array.isArray(candidate), `Expected array: ${key}`);
	return candidate;
}

function requireStringArray(value: JsonRecord, key: string): string[] {
	const candidate = requireArray(value, key);
	assert(
		candidate.every((item) => typeof item === "string"),
		`Expected string array: ${key}`,
	);
	return candidate as string[];
}

function requireString(value: JsonRecord, key: string): string {
	const candidate = value[key];
	assert(typeof candidate === "string" && candidate.length > 0, `Expected string: ${key}`);
	return candidate;
}

function asRecord(value: unknown, label: string): JsonRecord {
	assert(
		typeof value === "object" && value !== null && !Array.isArray(value),
		`Expected object: ${label}`,
	);
	return value as JsonRecord;
}

function assertUnique(values: Set<string>, value: string, label: string): void {
	assert(!values.has(value), `Duplicate ${label}: ${value}`);
	values.add(value);
}

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function stableJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
	if (value && typeof value === "object") {
		return `{${Object.entries(value as JsonRecord)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}

function sha256Bytes(value: Buffer): string {
	return createHash("sha256").update(value).digest("hex");
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function showStatus(runtimeRootInput: string): void {
	const runtimeRoot = validateRuntimeRoot(runtimeRootInput);
	const sessionPath = getSessionPath(runtimeRoot);
	assert(existsSync(sessionPath), "I3-Sim session is not prepared");
	const session = parseSession(readJson(sessionPath));
	const receiptRoot = dirname(sessionPath);
	const receipts = Array.from({ length: session.completedIterations }, (_, index) => {
		const path = join(receiptRoot, `iteration-${String(index + 1).padStart(3, "0")}.json`);
		return readJson(path);
	});
	console.log(JSON.stringify({ session, receipts }, null, 2));
}

async function main(): Promise<void> {
	const program = new Command();
	program.name("integration-i3-sim-gate");
	program
		.command("verify", { isDefault: true })
		.description("Validate frozen Stage A inputs and the Shadow Slice without model calls")
		.action(() => console.log(JSON.stringify(loadAndValidateGate().report, null, 2)));
	program
		.command("prepare")
		.requiredOption("--runtime-root <absolute-path>")
		.action((options: { runtimeRoot: string }) => prepare(options.runtimeRoot));
	program
		.command("run-next")
		.requiredOption("--runtime-root <absolute-path>")
		.action((options: { runtimeRoot: string }) => runNext(options.runtimeRoot));
	program
		.command("resume")
		.requiredOption("--runtime-root <absolute-path>")
		.requiredOption("--reason <text>")
		.action((options: { runtimeRoot: string; reason: string }) =>
			resumeSession(options.runtimeRoot, options.reason),
		);
	program
		.command("status")
		.requiredOption("--runtime-root <absolute-path>")
		.action((options: { runtimeRoot: string }) => showStatus(options.runtimeRoot));
	await program.parseAsync(process.argv);
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
	main().catch((error) => {
		console.error(errorMessage(error));
		process.exitCode = 1;
	});
}
