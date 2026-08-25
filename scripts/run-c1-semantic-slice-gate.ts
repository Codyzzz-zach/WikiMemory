import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
	type SemanticSliceEpisode,
	type SemanticSliceQuestionFrame,
	type SemanticSliceSourceIdentity,
	auditQuestionStateSemanticSlice,
} from "../src/wiki/question-state-semantic-slice.js";

interface SemanticSlicePlan {
	schemaVersion: string;
	status: string;
	inputs: {
		i3Manifest: string;
		i3ManifestSha256: string;
		canonicalRuntime: string;
		canonicalAggregateSha256: string;
		questionStateFileSha256: string;
		sourceMetadata: string;
		sourceMetadataSha256: string;
	};
	episodes: Array<{ episodeId: string; questionRefs: string[] }>;
	gate: {
		requireEveryEpisodeSourceAssociated: boolean;
		missingAssociationAction: string;
		allowSemanticMatchInsideC1: boolean;
		providerCallsBeforeReady: number;
		answerCalls: number;
		recompilationCalls: number;
	};
}

interface I3Manifest {
	slice: {
		episodes: Array<{
			episodeId: string;
			timepoints: Array<{ timepoint: string; sourceIds: string[] }>;
			targetTransitions: string[];
		}>;
	};
}

interface QuestionState {
	frames: SemanticSliceQuestionFrame[];
	decisions: unknown[];
	stateHash: string;
}

interface RuntimeSource {
	id: string;
	metadata: { sourceId: string };
}

const projectRoot = resolve(import.meta.dirname, "..");
const shadowRoot = requiredAbsoluteArgument("--shadow-root");
const canonicalRuntimeRoot = requiredAbsoluteArgument("--canonical-runtime-root");
assertRootsIsolated(shadowRoot, canonicalRuntimeRoot);

const planPath = join(
	projectRoot,
	"benchmarks/c1-weighted-question-state-v1/semantic-slice-plan.json",
);
const plan = readJson<SemanticSlicePlan>(planPath);
if (plan.schemaVersion !== "wge-c1-semantic-slice-plan/v1") {
	throw new Error(`Unsupported C1-D semantic slice plan: ${plan.schemaVersion}`);
}
if (plan.status !== "FROZEN_BEFORE_C1_D_EXECUTION") {
	throw new Error(`C1-D semantic slice plan is not frozen: ${plan.status}`);
}
if (resolve(plan.inputs.canonicalRuntime) !== canonicalRuntimeRoot) {
	throw new Error(
		`C1-D canonical runtime differs from frozen plan: ${canonicalRuntimeRoot} != ${plan.inputs.canonicalRuntime}`,
	);
}
const i3ManifestPath = resolve(projectRoot, plan.inputs.i3Manifest);
const sourceMetadataPath = resolve(projectRoot, plan.inputs.sourceMetadata);
assertFileHash(i3ManifestPath, plan.inputs.i3ManifestSha256);
assertFileHash(sourceMetadataPath, plan.inputs.sourceMetadataSha256);

const questionStatePath = join(canonicalRuntimeRoot, "questions/state.json");
assertFileHash(questionStatePath, plan.inputs.questionStateFileSha256);
const canonicalBefore = canonicalAggregate(canonicalRuntimeRoot);
if (canonicalBefore.sha256 !== plan.inputs.canonicalAggregateSha256) {
	throw new Error(
		`C1-D canonical aggregate drift: ${canonicalBefore.sha256} != ${plan.inputs.canonicalAggregateSha256}`,
	);
}

const questionState = readJson<QuestionState>(questionStatePath);
const i3Manifest = readJson<I3Manifest>(i3ManifestPath);
const episodeById = uniqueIndex(
	i3Manifest.slice.episodes,
	"I3 Episode",
	(episode) => episode.episodeId,
);
const plannedEpisodeById = uniqueIndex(
	plan.episodes,
	"planned C1-D Episode",
	(episode) => episode.episodeId,
);
const plannedEpisodeIds = [...plannedEpisodeById.keys()].sort();
const manifestEpisodeIds = [...episodeById.keys()].sort();
if (JSON.stringify(plannedEpisodeIds) !== JSON.stringify(manifestEpisodeIds)) {
	throw new Error(
		`C1-D plan does not exactly cover frozen I3 Episodes: ${plannedEpisodeIds.join(",")} != ${manifestEpisodeIds.join(",")}`,
	);
}
const episodes: SemanticSliceEpisode[] = [...plannedEpisodeById.values()].map((plannedEpisode) => {
	const episode = episodeById.get(plannedEpisode.episodeId);
	if (!episode)
		throw new Error(`C1-D planned Episode is absent from I3 manifest: ${plannedEpisode.episodeId}`);
	return {
		episodeId: episode.episodeId,
		questionRefs: plannedEpisode.questionRefs,
		timepoints: episode.timepoints,
		targetTransitions: episode.targetTransitions,
	};
});

const sourceIdentities = loadRuntimeSourceIdentities(canonicalRuntimeRoot);
const audit = auditQuestionStateSemanticSlice({
	episodes,
	frames: questionState.frames,
	sourceIdentities,
});
const expectedResult =
	audit.status === "READY_FOR_AMBIGUITY_REVIEW"
		? "READY_FOR_AMBIGUITY_REVIEW"
		: "REWORK_UPSTREAM_QUESTION_ASSOCIATION";
const providerEligible = audit.status === "READY_FOR_AMBIGUITY_REVIEW";
if (!providerEligible && audit.summary.missingSourceCount === 0) {
	throw new Error("C1-D stopped without a missing-source receipt");
}
if (!providerEligible && plan.gate.missingAssociationAction !== audit.status) {
	throw new Error(
		`C1-D stop action drift: ${audit.status} != ${plan.gate.missingAssociationAction}`,
	);
}
if (
	!plan.gate.requireEveryEpisodeSourceAssociated ||
	plan.gate.allowSemanticMatchInsideC1 ||
	plan.gate.providerCallsBeforeReady !== 0 ||
	plan.gate.answerCalls !== 0 ||
	plan.gate.recompilationCalls !== 0
) {
	throw new Error("C1-D frozen gate would permit an unauthorized precondition bypass");
}

mkdirSync(shadowRoot, { recursive: true });
const coveragePath = join(shadowRoot, "semantic-slice-coverage.json");
writeAtomic(coveragePath, stableJson(audit));
const canonicalAfter = canonicalAggregate(canonicalRuntimeRoot);
const questionStateAfter = sha256File(questionStatePath);
if (
	canonicalBefore.sha256 !== canonicalAfter.sha256 ||
	plan.inputs.questionStateFileSha256 !== questionStateAfter
) {
	throw new Error("C1-D semantic slice gate mutated canonical runtime");
}

const report = {
	schemaVersion: "wge-c1-semantic-slice-gate-report/v1",
	stage: "C1-D",
	result: expectedResult,
	c1Terminal: providerEligible ? null : "REWORK",
	generatedOn: "2026-08-25",
	contractAcceptanceCommit: "b89c746b171afacca837205947381b5c234b2f48",
	pureShadowCommit: "5ae7e07e0077e27537e637b629179dba35c99e4a",
	inputReceipt: {
		planPath: relative(projectRoot, planPath),
		planSha256: sha256File(planPath),
		i3ManifestPath: plan.inputs.i3Manifest,
		i3ManifestSha256: sha256File(i3ManifestPath),
		sourceMetadataPath: plan.inputs.sourceMetadata,
		sourceMetadataSha256: sha256File(sourceMetadataPath),
	},
	providerUsage: {
		calls: 0,
		tokens: 0,
		answerCalls: 0,
		recompilationCalls: 0,
		providerEligible,
	},
	canonicalRuntime: {
		path: canonicalRuntimeRoot,
		aggregateBefore: canonicalBefore,
		aggregateAfter: canonicalAfter,
		questionStateFileBefore: plan.inputs.questionStateFileSha256,
		questionStateFileAfter: questionStateAfter,
		questionStateInternalHash: questionState.stateHash,
		questionFrameCount: questionState.frames.length,
		questionDecisionCount: questionState.decisions.length,
		mutationCount: 0,
	},
	coverageArtifact: {
		path: relative(shadowRoot, coveragePath),
		sha256: sha256File(coveragePath),
	},
	audit,
	stopDecision: providerEligible
		? null
		: {
				code: "STOP_UPSTREAM_QUESTION_ASSOCIATION",
				contractBoundary: "Question formation and semantic matching are frozen in C1.",
				contractStopCondition: "Section 9.3",
				reason:
					"Some Episode sources have no Canonical Claim association to the pre-registered QuestionFrames. Ambiguity calls cannot repair this without taking on the excluded K2-S/C1.5 responsibility.",
				nextAction:
					"Close C1-D as REWORK and require an explicit new contract before changing question association or resuming C1 semantic evaluation.",
			},
};
const reportPath = join(shadowRoot, "report.json");
writeAtomic(reportPath, stableJson(report));
process.stdout.write(
	`${JSON.stringify(
		{
			reportPath,
			result: report.result,
			providerUsage: report.providerUsage,
			summary: audit.summary,
			episodes: audit.episodes.map((episode) => ({
				episodeId: episode.episodeId,
				status: episode.status,
				coveredSourceCount: episode.coveredSourceIds.length,
				missingSourceIds: episode.missingSourceIds,
				claimCount: episode.claimRefs.length,
				relationCount: episode.relationIds.length,
			})),
		},
		null,
		2,
	)}\n`,
);

function loadRuntimeSourceIdentities(runtimeRoot: string): SemanticSliceSourceIdentity[] {
	return readdirSync(join(runtimeRoot, "sources"))
		.filter((entry) => entry.endsWith(".json"))
		.map((entry) => readJson<RuntimeSource>(join(runtimeRoot, "sources", entry)))
		.map((source) => {
			if (!source.id.startsWith("source:") || !source.metadata.sourceId.trim()) {
				throw new Error(`C1-D invalid runtime Source identity: ${JSON.stringify(source)}`);
			}
			return { ref: source.id, sourceId: source.metadata.sourceId };
		});
}

function canonicalAggregate(runtimeRoot: string): { fileCount: number; sha256: string } {
	const directories = [
		"claims",
		"relations",
		"sources",
		"assertions",
		"concepts",
		"questions",
		"wiki",
		"publications",
	];
	const files = directories
		.flatMap((directory) => walk(join(runtimeRoot, directory)))
		.sort((left, right) => left.localeCompare(right));
	const checksumLines = files
		.map((path) => `${sha256File(path)}  ${relative(runtimeRoot, path)}\n`)
		.join("");
	return { fileCount: files.length, sha256: sha256(checksumLines) };
}

function walk(path: string): string[] {
	return readdirSync(path).flatMap((entry) => {
		const child = join(path, entry);
		return statSync(child).isDirectory() ? walk(child) : [child];
	});
}

function assertFileHash(path: string, expected: string): void {
	const actual = sha256File(path);
	if (actual !== expected)
		throw new Error(`C1-D frozen input drift: ${path}: ${actual} != ${expected}`);
}

function requiredAbsoluteArgument(name: string): string {
	const index = process.argv.indexOf(name);
	const value = index >= 0 ? process.argv[index + 1] : undefined;
	if (!value) throw new Error(`Missing required argument: ${name}`);
	if (!isAbsolute(value)) throw new Error(`${name} must be absolute: ${value}`);
	const result = resolve(value);
	if (result === sep || dirname(result) === result || basename(result) === "..") {
		throw new Error(`${name} is too broad: ${value}`);
	}
	return result;
}

function assertRootsIsolated(shadow: string, canonical: string): void {
	if (isSameOrInside(shadow, canonical) || isSameOrInside(canonical, shadow)) {
		throw new Error(
			`C1-D shadow root must not overlap canonical runtime: ${shadow} <-> ${canonical}`,
		);
	}
}

function isSameOrInside(candidate: string, parent: string): boolean {
	const path = relative(parent, candidate);
	return path === "" || (!path.startsWith(`..${sep}`) && path !== "..");
}

function writeAtomic(path: string, value: string): void {
	mkdirSync(dirname(path), { recursive: true });
	const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
	writeFileSync(temporary, value, "utf8");
	renameSync(temporary, path);
}

function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, "utf8")) as T;
}

function uniqueIndex<T>(items: T[], label: string, key: (item: T) => string): Map<string, T> {
	const index = new Map<string, T>();
	for (const item of items) {
		const id = key(item);
		if (index.has(id)) throw new Error(`Duplicate ${label}: ${id}`);
		index.set(id, item);
	}
	return index;
}

function sha256File(path: string): string {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: unknown): string {
	return `${JSON.stringify(sortObjectKeys(value))}\n`;
}

function sortObjectKeys(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortObjectKeys);
	if (value !== null && typeof value === "object") {
		const record = value as Record<string, unknown>;
		return Object.fromEntries(
			Object.keys(record)
				.sort()
				.map((key) => [key, sortObjectKeys(record[key])]),
		);
	}
	return value;
}
