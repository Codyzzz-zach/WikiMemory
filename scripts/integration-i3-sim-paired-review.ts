#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { estimateTokens } from "../src/compiler/telemetry.js";
import { loadConfig } from "../src/config/index.js";
import { buildManagedContextPackWithDiagnostics } from "../src/context-pack/index.js";
import { createLLMProvider } from "../src/core/llm-provider.js";
import {
	EVOLUTION_ANSWER_SYSTEM,
	parseEvolutionAnswer,
	validateAnswerCitations,
} from "../src/evolution/evaluation.js";
import { writeJsonAtomic } from "../src/linter/storage.js";
import type { I3SimContract, I3SimEpisode, I3SimTask } from "./integration-i3-sim-gate.js";

type Variant = "BASELINE_NO_WIKI" | "WIKIMEMORY";

interface GateSession {
	status: string;
	codeCommit: string;
	gateManifestSha256: string;
}

interface AnswerAssessment {
	formatValid: boolean;
	citationValidation: { valid: boolean; invalid: string[] };
	citations: string[];
}

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(scriptPath), "..");
const gateManifestPath = join(projectRoot, "benchmarks/i3-sim-gate-v1/manifest.json");

export function selectPairedReviewTasks(
	episodes: I3SimEpisode[],
	maxPerEpisode: number,
): Array<{ episodeId: string; domain: string; targetTransitions: string[]; task: I3SimTask }> {
	return episodes.flatMap((episode) => {
		if (maxPerEpisode <= 0) return [];
		const selected =
			episode.tasks.length <= maxPerEpisode
				? episode.tasks
				: [episode.tasks[0], episode.tasks.at(-1)].filter(
						(task): task is I3SimTask => task !== undefined,
					);
		return selected.slice(0, maxPerEpisode).map((task) => ({
			episodeId: episode.episodeId,
			domain: episode.domain,
			targetTransitions: episode.targetTransitions,
			task,
		}));
	});
}

export function hasTraceableWikiUse(
	citations: string[],
	candidateOnlyClaimIds: string[],
	candidateOnlyEvidenceSpanIds: string[],
): boolean {
	const exclusive = [...candidateOnlyClaimIds, ...candidateOnlyEvidenceSpanIds];
	return citations.some((citation) => exclusive.some((id) => citation.includes(id)));
}

async function run(runtimeRootInput: string): Promise<void> {
	const runtimeRoot = validateRuntimeRoot(runtimeRootInput);
	assertCleanWorktree();
	const contract = readJson<I3SimContract>(gateManifestPath);
	assert(contract.authority.stageBRead === false, "Stage B must remain unread");
	assert(contract.execution.stageBRead === false, "Execution must keep Stage B unread");
	const sessionPath = join(runtimeRoot, "runs/i3-sim-gate/session.json");
	const session = readJson<GateSession>(sessionPath);
	assert(session.status === "COMPLETE", `Structural Gate is not complete: ${session.status}`);
	const selected = selectPairedReviewTasks(
		contract.slice.episodes,
		contract.budgets.maxPairedAnswerCallsPerEpisodeReview,
	);
	const totalTasks = contract.slice.episodes.reduce(
		(sum, episode) => sum + episode.tasks.length,
		0,
	);
	const coverage = selected.length / totalTasks;
	assert(
		coverage >= contract.promotion.minimumPairedOutcomeCoverage,
		`Frozen paired selection coverage is too low: ${coverage}`,
	);
	const outputRoot = join(runtimeRoot, "runs/i3-sim-gate/paired-review-v1");
	const recordsRoot = join(outputRoot, "records");
	mkdirSync(recordsRoot, { recursive: true });
	const config = loadConfig({
		runtimeRoot,
		model: contract.execution.compilerModel,
		temperature: contract.execution.temperature,
	});
	assert(config.apiKey.length > 0, "DEEPSEEK_API_KEY is required for paired review");
	const provider = createLLMProvider(config);
	const reviewCommit = git(["rev-parse", "HEAD"]);

	for (const selection of selected) {
		const baseline = buildManagedContextPackWithDiagnostics(
			config,
			selection.task.prompt,
			contract.budgets.contextTokensPerTask,
			3,
			undefined,
			{ indexFailurePolicy: "LEGACY_FALLBACK", wikiMode: "DISABLED" },
		);
		const candidate = buildManagedContextPackWithDiagnostics(
			config,
			selection.task.prompt,
			contract.budgets.contextTokensPerTask,
			3,
			undefined,
			{ indexFailurePolicy: "LEGACY_FALLBACK", wikiMode: "MATERIALIZED" },
		);
		assert(
			baseline.pack.knowledgeVersion === candidate.pack.knowledgeVersion,
			`Knowledge version mismatch for ${selection.task.taskId}`,
		);
		assert(baseline.pack.wikiModules.length === 0, "Baseline unexpectedly contains WikiModule");
		assert(
			candidate.pack.wikiModules.length > 0,
			`Candidate has no WikiModule: ${selection.task.taskId}`,
		);
		const baselineClaimIds = new Set(baseline.pack.subgraph.claims.map((claim) => claim.id));
		const baselineSpanIds = new Set(baseline.pack.evidenceSpans.map((span) => span.id));
		const candidateOnlyClaimIds = candidate.pack.subgraph.claims
			.map((claim) => claim.id)
			.filter((id) => !baselineClaimIds.has(id));
		const candidateOnlyEvidenceSpanIds = candidate.pack.evidenceSpans
			.map((span) => span.id)
			.filter((id) => !baselineSpanIds.has(id));

		for (const variant of deterministicVariants(selection.task.taskId)) {
			const recordPath = join(recordsRoot, `${selection.task.taskId}--${variant}.json`);
			if (existsSync(recordPath)) continue;
			const built = variant === "WIKIMEMORY" ? candidate : baseline;
			const context = JSON.stringify(built.pack);
			const userPrompt = `# 问题\n${selection.task.prompt}\n\n# 检索上下文\n${context}`;
			const startedAt = Date.now();
			const result = await provider.chat({
				model: contract.execution.compilerModel,
				temperature: contract.execution.temperature,
				thinkingDisabled: true,
				systemPrompt: EVOLUTION_ANSWER_SYSTEM,
				messages: [{ role: "user", content: userPrompt }],
				responseFormat: "json_object",
				maxTokens: 1800,
			});
			const assessment = assessAnswer(result.content, context);
			writeJsonAtomic(recordPath, {
				schemaVersion: "wge-i3-sim-paired-answer/v1",
				taskId: selection.task.taskId,
				episodeId: selection.episodeId,
				domain: selection.domain,
				targetTransitions: selection.targetTransitions,
				variant,
				answer: result.content,
				...assessment,
				wikiModuleIds: built.pack.wikiModules.map((module) => module.id).sort(),
				claimIds: built.pack.subgraph.claims.map((claim) => claim.id).sort(),
				evidenceSpanIds: built.pack.evidenceSpans.map((span) => span.id).sort(),
				candidateOnlyClaimIds,
				candidateOnlyEvidenceSpanIds,
				knowledgeVersion: built.pack.knowledgeVersion,
				contextHash: sha256(context),
				promptHash: sha256(`${EVOLUTION_ANSWER_SYSTEM}\n${userPrompt}`),
				estimatedInputTokens: estimateTokens(`${EVOLUTION_ANSWER_SYSTEM}\n${userPrompt}`),
				usage: result.usage,
				modelReturned: result.model,
				finishReason: result.finishReason,
				latencyMs: Date.now() - startedAt,
			});
			console.error(`completed ${selection.task.taskId} ${variant}`);
		}
	}

	const pairs = selected.map((selection) => {
		const baseline = readJson<Record<string, unknown>>(
			join(recordsRoot, `${selection.task.taskId}--BASELINE_NO_WIKI.json`),
		);
		const candidate = readJson<Record<string, unknown>>(
			join(recordsRoot, `${selection.task.taskId}--WIKIMEMORY.json`),
		);
		const citations = stringArray(candidate.citations);
		const traceableWikiUse = hasTraceableWikiUse(
			citations,
			stringArray(candidate.candidateOnlyClaimIds),
			stringArray(candidate.candidateOnlyEvidenceSpanIds),
		);
		return {
			taskId: selection.task.taskId,
			episodeId: selection.episodeId,
			domain: selection.domain,
			targetTransitions: selection.targetTransitions,
			baselineContractValid:
				baseline.formatValid === true &&
				(baseline.citationValidation as { valid?: boolean } | undefined)?.valid === true,
			candidateContractValid:
				candidate.formatValid === true &&
				(candidate.citationValidation as { valid?: boolean } | undefined)?.valid === true,
			traceableWikiUse,
			wikiModuleIds: stringArray(candidate.wikiModuleIds),
			candidateOnlyClaimIds: stringArray(candidate.candidateOnlyClaimIds),
			candidateOnlyEvidenceSpanIds: stringArray(candidate.candidateOnlyEvidenceSpanIds),
		};
	});
	const report = {
		schemaVersion: "wge-i3-sim-paired-review/v1",
		status: "COMPLETE_REQUIRES_SEMANTIC_ADJUDICATION",
		structuralCommit: session.codeCommit,
		reviewCommit,
		gateManifestSha256: session.gateManifestSha256,
		stageBRead: false,
		selectedTasks: selected.length,
		totalTasks,
		coverage,
		answerCalls: selected.length * 2,
		contractValidPairs: pairs.filter(
			(pair) => pair.baselineContractValid && pair.candidateContractValid,
		).length,
		traceableWikiUsePairs: pairs.filter((pair) => pair.traceableWikiUse).length,
		traceableWikiUseDomains: [
			...new Set(pairs.filter((pair) => pair.traceableWikiUse).map((pair) => pair.domain)),
		].sort(),
		pairs,
		limitations: [
			"Traceable Wiki use proves causal context use, not answer-quality improvement.",
			"Semantic transition targets still require post-run adjudication without Stage B or Gold.",
			"Answers and review artifacts remain outside Canonical Knowledge.",
		],
	};
	writeJsonAtomic(join(outputRoot, "report.json"), report);
	console.log(JSON.stringify(report, null, 2));
}

function assessAnswer(content: string, context: string): AnswerAssessment {
	try {
		const parsed = parseEvolutionAnswer(content);
		return {
			formatValid: true,
			citationValidation: validateAnswerCitations(parsed, context),
			citations: parsed.citations,
		};
	} catch {
		return { formatValid: false, citationValidation: { valid: false, invalid: [] }, citations: [] };
	}
}

function deterministicVariants(taskId: string): Variant[] {
	return Number.parseInt(sha256(taskId).slice(0, 2), 16) % 2 === 0
		? ["BASELINE_NO_WIKI", "WIKIMEMORY"]
		: ["WIKIMEMORY", "BASELINE_NO_WIKI"];
}

function validateRuntimeRoot(value: string): string {
	assert(isAbsolute(value), "runtime-root must be absolute");
	const resolved = resolve(value);
	assert(resolved !== projectRoot, "paired review cannot use the repository root as runtime");
	return resolved;
}

function assertCleanWorktree(): void {
	assert(git(["status", "--porcelain"]).length === 0, "paired review requires a clean worktree");
}

function git(args: string[]): string {
	const result = spawnSync("git", args, { cwd: projectRoot, encoding: "utf8" });
	if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${args.join(" ")} failed`);
	return result.stdout.trim();
}

function sha256(value: string | Buffer): string {
	return createHash("sha256").update(value).digest("hex");
}

function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, "utf8")) as T;
}

function stringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.map(String) : [];
}

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
	const program = new Command();
	program
		.name("integration-i3-sim-paired-review")
		.command("run", { isDefault: true })
		.requiredOption("--runtime-root <absolute-path>")
		.action((options: { runtimeRoot: string }) => run(options.runtimeRoot));
	await program.parseAsync(process.argv);
}

if (resolve(process.argv[1] ?? "") === scriptPath) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
