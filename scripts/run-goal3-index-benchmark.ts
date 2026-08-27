import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config/index.js";
import { buildGraph, walkGraph } from "../src/graph/index.js";
import {
	readAllClaims,
	readAllConcepts,
	readAllRelations,
	readAllSources,
	readAllSpans,
} from "../src/linter/storage.js";
import { retrieveClaimSeeds } from "../src/retrieval/index.js";
import {
	buildPersistentSeedIndex,
	loadPersistentKnowledgeNeighborhood,
	retrieveClaimSeedsFromPersistentIndex,
} from "../src/retrieval/persistent-index.js";

type JsonRecord = Record<string, unknown>;

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const runId = process.env.WGE_GOAL3_INDEX_RUN_ID ?? "index-v1";
const runRoot = join(projectRoot, "experiments", "goal3", "index-runs", runId);
if (existsSync(runRoot)) throw new Error(`Refusing to overwrite index benchmark: ${runRoot}`);
const questionPath = join(
	projectRoot,
	"experiments",
	"benchmark-batch-c",
	"stage-a-freeze",
	"questions-public.jsonl",
);
const questionText = readFileSync(questionPath, "utf8");
const questions = readJsonl(questionText);
const repetitions = 3;
const tiers = ["S12", "S29", "S50"];
const rows: JsonRecord[] = [];
const builds: JsonRecord[] = [];

mkdirSync(runRoot, { recursive: true });
for (const tier of tiers) {
	const workspaceRoot = join(
		projectRoot,
		"experiments",
		"goal3",
		"runs",
		"scale-v5",
		"workspaces",
		tier,
	);
	const config = loadConfig({ projectRoot: workspaceRoot });
	const indexRoot = join(runRoot, "indexes", tier);
	const buildStarted = process.hrtime.bigint();
	const build = buildPersistentSeedIndex(config, indexRoot);
	const buildMilliseconds = elapsed(buildStarted);
	builds.push({
		tier,
		...build,
		buildMilliseconds,
		indexBytes: directoryBytes(indexRoot),
	});

	for (let repetition = 1; repetition <= repetitions; repetition++) {
		for (const question of questions) {
			const questionId = requiredString(question, "caseId");
			const query = requiredString(question, "question");
			const liveStarted = process.hrtime.bigint();
			const claims = readAllClaims(config);
			const spans = readAllSpans(config);
			const sources = readAllSources(config);
			const sourceSearchText = new Map(
				sources.map(
					(source) =>
						[
							source.id,
							[source.uri, source.sourceType, ...Object.entries(source.metadata ?? {}).flat()].join(
								"\n",
							),
						] as const,
				),
			);
			const live = retrieveClaimSeeds(claims, spans, query, 10, sourceSearchText);
			const liveMilliseconds = elapsed(liveStarted);

			const indexedStarted = process.hrtime.bigint();
			const indexed = retrieveClaimSeedsFromPersistentIndex(indexRoot, query, 10);
			const indexedMilliseconds = elapsed(indexedStarted);

			const liveNeighborhoodStarted = process.hrtime.bigint();
			const liveGraph = buildGraph(claims, readAllConcepts(config), readAllRelations(config));
			const liveNeighborhood = walkGraph(
				liveGraph,
				live.candidates.map((candidate) => candidate.claim.id),
				1,
			);
			const liveNeighborhoodMilliseconds = elapsed(liveNeighborhoodStarted);
			const liveSpanIds = new Set(
				liveNeighborhood.claims.flatMap((claim) => claim.evidenceSpanIds),
			);
			const liveNeighborhoodSpans = spans.filter((span) => liveSpanIds.has(span.id));
			const liveSourceIds = [...new Set(liveNeighborhoodSpans.map((span) => span.sourceId))].sort();

			const indexedNeighborhoodStarted = process.hrtime.bigint();
			const indexedNeighborhood = loadPersistentKnowledgeNeighborhood(
				indexRoot,
				indexed.result.candidates.map((candidate) => candidate.claim),
				{ maxRelationDepth: 1, maxClaims: 40 },
			);
			const indexedNeighborhoodMilliseconds = elapsed(indexedNeighborhoodStarted);
			const liveShape = resultShape(live);
			const indexedShape = resultShape(indexed.result);
			const neighborhoodClaimParity = sameIds(
				liveNeighborhood.claims.map((claim) => claim.id),
				indexedNeighborhood.claims.map((claim) => claim.id),
			);
			const neighborhoodRelationParity = sameIds(
				liveNeighborhood.relations.map((relation) => relation.id),
				indexedNeighborhood.relations.map((relation) => relation.id),
			);
			const neighborhoodSpanParity = sameIds(
				liveNeighborhoodSpans.map((span) => span.id),
				indexedNeighborhood.spans.map((span) => span.id),
			);
			const neighborhoodSourceParity = sameIds(
				liveSourceIds,
				indexedNeighborhood.sources.map((source) => source.id),
			);
			rows.push({
				tier,
				repetition,
				questionId,
				liveMilliseconds,
				indexedMilliseconds,
				liveNeighborhoodMilliseconds,
				indexedNeighborhoodMilliseconds,
				candidateParity: JSON.stringify(liveShape) === JSON.stringify(indexedShape),
				neighborhoodClaimParity,
				neighborhoodRelationParity,
				neighborhoodSpanParity,
				neighborhoodSourceParity,
				liveCandidateIds: liveShape.map((candidate) => candidate.id),
				indexedCandidateIds: indexedShape.map((candidate) => candidate.id),
				...indexed.diagnostics,
				neighborhoodDiagnostics: indexedNeighborhood.diagnostics,
				loadedClaimRatio:
					indexed.diagnostics.totalIndexedClaims === 0
						? 0
						: round(
								indexed.diagnostics.candidateClaimsLoaded / indexed.diagnostics.totalIndexedClaims,
							),
			});
		}
	}
}

const summaries = tiers.map((tier) => {
	const selected = rows.filter((row) => row.tier === tier);
	const liveTimes = selected.map((row) => Number(row.liveMilliseconds)).sort((a, b) => a - b);
	const indexedTimes = selected.map((row) => Number(row.indexedMilliseconds)).sort((a, b) => a - b);
	const liveNeighborhoodTimes = selected
		.map((row) => Number(row.liveNeighborhoodMilliseconds))
		.sort((a, b) => a - b);
	const indexedNeighborhoodTimes = selected
		.map((row) => Number(row.indexedNeighborhoodMilliseconds))
		.sort((a, b) => a - b);
	return {
		tier,
		queries: selected.length,
		candidateParity: selected.every((row) => row.candidateParity === true),
		neighborhoodParity: selected.every(
			(row) =>
				row.neighborhoodClaimParity === true &&
				row.neighborhoodRelationParity === true &&
				row.neighborhoodSpanParity === true &&
				row.neighborhoodSourceParity === true,
		),
		averageLiveMilliseconds: round(average(liveTimes)),
		averageIndexedMilliseconds: round(average(indexedTimes)),
		p95LiveMilliseconds: round(percentile(liveTimes, 0.95)),
		p95IndexedMilliseconds: round(percentile(indexedTimes, 0.95)),
		averageLiveNeighborhoodMilliseconds: round(average(liveNeighborhoodTimes)),
		averageIndexedNeighborhoodMilliseconds: round(average(indexedNeighborhoodTimes)),
		p95LiveNeighborhoodMilliseconds: round(percentile(liveNeighborhoodTimes, 0.95)),
		p95IndexedNeighborhoodMilliseconds: round(percentile(indexedNeighborhoodTimes, 0.95)),
		averageLoadedClaimRatio: round(average(selected.map((row) => Number(row.loadedClaimRatio)))),
		maximumLoadedClaimRatio: Math.max(...selected.map((row) => Number(row.loadedClaimRatio))),
		averagePostingShardsRead: round(average(selected.map((row) => Number(row.postingShardsRead)))),
		averageRecordShardsRead: round(average(selected.map((row) => Number(row.recordShardsRead)))),
	};
});
const report = {
	schemaVersion: "wge-goal3-persistent-index-benchmark/v1",
	status: summaries.every((summary) => summary.candidateParity && summary.neighborhoodParity)
		? "PASS_RANKING_PARITY"
		: "FAIL_INDEX_PARITY",
	runId,
	createdAt: new Date().toISOString(),
	provenance: {
		questionsPath: questionPath,
		questionsSha256: sha256(questionText),
		scaleWorkspaceRun: "experiments/goal3/runs/scale-v5",
		repetitions,
		modelCalls: 0,
		network: false,
	},
	checks: {
		candidateParityAllQueries: rows.every((row) => row.candidateParity === true),
		neighborhoodParityAllQueries: rows.every(
			(row) =>
				row.neighborhoodClaimParity === true &&
				row.neighborhoodRelationParity === true &&
				row.neighborhoodSpanParity === true &&
				row.neighborhoodSourceParity === true,
		),
		indexedReadsLessThanFullCorpus: rows.every((row) => Number(row.loadedClaimRatio) < 1),
		indexedReadRatioDoesNotGrow: nonIncreasing(
			summaries.map((summary) => summary.averageLoadedClaimRatio),
		),
	},
	builds,
	summaries,
	rows,
	limitations: [
		"This isolates Seed retrieval only; Context Pack still uses the legacy full-state path.",
		"Filesystem page cache affects latency; object-count and shard-read metrics are the primary engineering signals.",
		"The index is immutable and rebuildable, but publication-time invalidation is not integrated yet.",
	],
};
writeJson(join(runRoot, "report.json"), report);
console.log(
	JSON.stringify(
		{ runRoot, status: report.status, checks: report.checks, builds, summaries },
		null,
		2,
	),
);

function resultShape(result: ReturnType<typeof retrieveClaimSeeds>) {
	return result.candidates.map((candidate) => ({
		id: candidate.claim.id,
		score: candidate.score,
		channels: candidate.channels,
		matchedFeatures: candidate.matchedFeatures,
	}));
}

function sameIds(left: string[], right: string[]): boolean {
	return JSON.stringify([...new Set(left)].sort()) === JSON.stringify([...new Set(right)].sort());
}

function readJsonl(text: string): JsonRecord[] {
	return text
		.split(/\r?\n/u)
		.filter((line) => line.trim().length > 0)
		.map((line) => JSON.parse(line) as JsonRecord);
}

function requiredString(record: JsonRecord, key: string): string {
	const value = record[key];
	if (typeof value !== "string" || value.length === 0) throw new Error(`Missing string ${key}`);
	return value;
}

function directoryBytes(path: string): number {
	if (!existsSync(path)) return 0;
	const stats = statSync(path);
	if (stats.isFile()) return stats.size;
	return readdirSync(path).reduce((total, entry) => total + directoryBytes(join(path, entry)), 0);
}

function elapsed(started: bigint): number {
	return round(Number(process.hrtime.bigint() - started) / 1_000_000);
}

function writeJson(path: string, value: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function nonIncreasing(values: number[]): boolean {
	return values.every((value, index) => index === 0 || value <= (values[index - 1] ?? value));
}

function average(values: number[]): number {
	return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: number[], quantile: number): number {
	if (values.length === 0) return 0;
	return values[Math.min(values.length - 1, Math.ceil(values.length * quantile) - 1)] ?? 0;
}

function round(value: number): number {
	return Math.round(value * 1000) / 1000;
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}
