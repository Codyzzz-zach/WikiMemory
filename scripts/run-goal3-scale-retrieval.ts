import { createHash } from "node:crypto";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config/index.js";
import { findSpansByIds, readAllClaims, readAllSpans } from "../src/linter/storage.js";
import type { PilotConfig } from "../src/pilot/index.js";
import { preparePilotContext } from "../src/pilot/index.js";

type JsonRecord = Record<string, unknown>;

interface ScaleContract {
	schemaVersion: string;
	targetCorpus: string;
	questions: string;
	diagnosticGold: string;
	tiers: Array<{ id: string; roots: string[] }>;
	fixed: { questionCount: number; contextBudgetTokens: number };
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const contractPath = join(projectRoot, "experiments", "goal3", "goal3-scale-contract-v3.json");
const contractText = readFileSync(contractPath, "utf8");
const contract = JSON.parse(contractText) as ScaleContract;
const runId = process.env.WGE_GOAL3_SCALE_RUN_ID ?? new Date().toISOString().replaceAll(":", "-");
const runRoot = join(projectRoot, "experiments", "goal3", "runs", runId);
if (existsSync(runRoot)) throw new Error(`Refusing to overwrite scale run: ${runRoot}`);

const questionText = readFileSync(resolve(projectRoot, contract.questions), "utf8");
const goldText = readFileSync(resolve(projectRoot, contract.diagnosticGold), "utf8");
const questions = readJsonlText(questionText);
const goldById = new Map(
	readJsonlText(goldText).map((row) => [requiredString(row, "caseId"), row] as const),
);
if (questions.length !== contract.fixed.questionCount) {
	throw new Error(`Frozen question count drifted: ${questions.length}`);
}

const frozenPilot = JSON.parse(
	readFileSync(
		join(projectRoot, "experiments", "benchmark-batch-c", "stage-a-freeze", "config.json"),
		"utf8",
	),
) as PilotConfig;
const pilotConfig: PilotConfig = {
	...frozenPilot,
	retrieval: {
		...frozenPilot.retrieval,
		contextBudgetTokens: contract.fixed.contextBudgetTokens,
		maxGraphDepth: 2,
	},
};

mkdirSync(runRoot, { recursive: true });
const rows: JsonRecord[] = [];
const tierManifests: JsonRecord[] = [];
for (const tier of contract.tiers) {
	const workspaceRoot = join(runRoot, "workspaces", tier.id);
	const manifest = materializeWorkspace(
		workspaceRoot,
		tier.roots.map((root) => resolve(projectRoot, root)),
	);
	tierManifests.push({ tier: tier.id, ...manifest });
	const appConfig = loadConfig({ projectRoot: workspaceRoot });
	const allClaims = readAllClaims(appConfig);
	const allSpans = readAllSpans(appConfig);
	const claimById = new Map(allClaims.map((claim) => [claim.id, claim] as const));
	for (const question of questions) {
		const questionId = requiredString(question, "caseId");
		const questionValue = requiredString(question, "question");
		const gold = goldById.get(questionId);
		if (!gold) throw new Error(`Missing diagnostic Gold for ${questionId}`);
		const requiredEvidence = recordArray(gold.requiredEvidence);
		const requiredSourceIds = [
			...new Set(requiredEvidence.map((item) => requiredString(item, "sourceId"))),
		];
		const requiredQuotes = requiredEvidence.map((item) => requiredString(item, "exactQuote"));
		for (const arm of ["R0", "R1"] as const) {
			const started = process.hrtime.bigint();
			const prepared = preparePilotContext(
				appConfig,
				pilotConfig,
				{ id: questionId, question: questionValue },
				"P",
				{ retrievalMode: arm },
			);
			const elapsedMilliseconds = Number(process.hrtime.bigint() - started) / 1_000_000;
			const normalizedContext = normalize(prepared.context);
			const matchedSources = requiredSourceIds.filter((id) =>
				prepared.retrievedSources.some((retrievedId) => sourceIdMatches(retrievedId, id)),
			);
			const matchedQuotes = requiredQuotes.filter((quote) =>
				normalizedContext.includes(normalize(quote)),
			);
			const packBuild = recordValue(prepared.retrievalTrace.packBuild);
			const retrieval = recordValue(packBuild.retrieval);
			const graph = recordValue(packBuild.graph);
			const selection = recordValue(graph.selection);
			const candidateClaimIds = stringArray(selection.candidateNodeIds);
			const candidateSpans = findSpansByIds(
				allSpans,
				candidateClaimIds.flatMap((claimId) => claimById.get(claimId)?.evidenceSpanIds ?? []),
			);
			const candidateSourceIds = [...new Set(candidateSpans.map((span) => span.sourceId))];
			const candidateMatchedSources = requiredSourceIds.filter((id) =>
				candidateSourceIds.some((candidateId) => sourceIdMatches(candidateId, id)),
			);
			const candidateEvidenceText = normalize(candidateSpans.map((span) => span.text).join("\n"));
			const candidateMatchedQuotes = requiredQuotes.filter((quote) =>
				candidateEvidenceText.includes(normalize(quote)),
			);
			rows.push({
				tier: tier.id,
				questionId,
				questionType: question.questionType ?? null,
				arm,
				elapsedMilliseconds: round(elapsedMilliseconds),
				estimatedContextTokens: prepared.estimatedContextTokens,
				contextHash: prepared.contextHash,
				retrievedClaimCount: prepared.retrievedClaims.length,
				retrievedRelationCount: prepared.retrievedRelations.length,
				retrievedSourceCount: prepared.retrievedSources.length,
				requiredSourceCount: requiredSourceIds.length,
				matchedSourceCount: matchedSources.length,
				promptRequiredSourceRecall:
					requiredSourceIds.length === 0
						? null
						: round(matchedSources.length / requiredSourceIds.length),
				requiredQuoteCount: requiredQuotes.length,
				matchedQuoteCount: matchedQuotes.length,
				promptRequiredEvidenceQuoteRecall:
					requiredQuotes.length === 0 ? null : round(matchedQuotes.length / requiredQuotes.length),
				candidateClaimCount: candidateClaimIds.length,
				candidateSourceCount: candidateSourceIds.length,
				candidateMatchedSourceCount: candidateMatchedSources.length,
				candidateRequiredSourceRecall:
					requiredSourceIds.length === 0
						? null
						: round(candidateMatchedSources.length / requiredSourceIds.length),
				candidateMatchedQuoteCount: candidateMatchedQuotes.length,
				candidateRequiredEvidenceQuoteRecall:
					requiredQuotes.length === 0
						? null
						: round(candidateMatchedQuotes.length / requiredQuotes.length),
				matchedSources,
				missingSources: requiredSourceIds.filter((id) => !matchedSources.includes(id)),
				eligibleClaimsScanned: retrieval.eligibleClaimCount ?? null,
				relationsGateChecked: Array.isArray(graph.relationGates)
					? graph.relationGates.length
					: null,
				candidateGraphNodes: candidateClaimIds.length,
				addedGraphClaimIds: stringArray(selection.addedGraphClaimIds),
				removedLexicalSeedIds: stringArray(selection.removedLexicalSeedIds),
			});
		}
	}
}

const paired = pairRows(rows);
const summaries = contract.tiers.flatMap((tier) =>
	(["R0", "R1"] as const).map((arm) => summarize(rows, tier.id, arm)),
);
const largestTier = contract.tiers.at(-1)?.id;
if (!largestTier) throw new Error("Scale contract has no tiers");
const largestPairs = paired.filter((row) => row.tier === largestTier);
const pairedWins = largestPairs.filter((row) => Number(row.candidateSourceRecallDelta) > 0).length;
const pairedLosses = largestPairs.filter(
	(row) => Number(row.candidateSourceRecallDelta) < 0,
).length;
const evidenceLosses = largestPairs.filter(
	(row) => Number(row.candidateEvidenceRecallDelta) < 0,
).length;
const r0Largest = requiredSummary(summaries, largestTier, "R0");
const r1Largest = requiredSummary(summaries, largestTier, "R1");
const localizationSignal = pairedWins > 0 && pairedLosses === 0 && evidenceLosses === 0;
const contextCostPass =
	Number(r1Largest.averageContextTokens) <= Number(r0Largest.averageContextTokens) * 1.05;
const latencyCeiling = Math.max(
	Number(r0Largest.p95QueryMilliseconds) * 2,
	Number(r0Largest.p95QueryMilliseconds) + 100,
);
const latencyPass = Number(r1Largest.p95QueryMilliseconds) <= latencyCeiling;
const anyRegression = paired.some(
	(row) =>
		Number(row.candidateSourceRecallDelta) < 0 || Number(row.candidateEvidenceRecallDelta) < 0,
);
const anyWin = paired.some((row) => Number(row.candidateSourceRecallDelta) > 0);
const promptWinAtLargest = largestPairs.some((row) => Number(row.promptSourceRecallDelta) > 0);
const verdict = anyRegression
	? "REGRESSION"
	: localizationSignal && promptWinAtLargest && contextCostPass && latencyPass
		? "END_TO_END_RETRIEVAL_SIGNAL"
		: localizationSignal
			? "SELECTOR_GAP"
			: anyWin
				? "INCONCLUSIVE_SCALE_SIGNAL"
				: "NO_CANDIDATE_BENEFIT";

const report = {
	schemaVersion: "wge-goal3-scale-retrieval-report/v1",
	status: "POST_HOC_MECHANISM_DIAGNOSTIC",
	runId,
	createdAt: new Date().toISOString(),
	verdict,
	provenance: {
		contractPath,
		contractSha256: sha256(contractText),
		questionsSha256: sha256(questionText),
		diagnosticGoldSha256: sha256(goldText),
		modelCalls: 0,
		network: false,
	},
	checks: {
		localizationSignal,
		contextCostPass,
		latencyPass,
		promptWinAtLargest,
		pairedWinsAtLargestTier: pairedWins,
		pairedLossesAtLargestTier: pairedLosses,
		evidenceLossesAtLargestTier: evidenceLosses,
		boundedCandidateGraph: rows.every((row) => Number(row.candidateGraphNodes) <= 40),
		fullCorpusScanObserved: rows.some((row) => Number(row.eligibleClaimsScanned) > 0),
	},
	tierManifests,
	summaries,
	paired,
	rows,
	limitations: [
		"This uses revealed Batch C evaluator Gold and is diagnostic, not blind evidence.",
		"Distractor corpora enlarge the search space but do not create new cross-corpus semantic relations.",
		"The current implementation reads the full knowledge state and rebuilds the Graph per query; latency here is a baseline, not a production-scale architecture.",
		"Answer generation was intentionally not run. A retrieval mechanism must pass before it can spend model tokens.",
	],
};
writeJson(join(runRoot, "scale-report.json"), report);
writeJson(join(runRoot, "run-manifest.json"), {
	schemaVersion: "wge-goal3-scale-run-manifest/v1",
	runId,
	contractSha256: sha256(contractText),
	reportSha256: sha256(`${JSON.stringify(report, null, 2)}\n`),
	workspaceHashes: tierManifests.map((item) => ({ tier: item.tier, hash: item.workspaceHash })),
});
console.log(JSON.stringify({ runRoot, verdict, checks: report.checks, summaries }, null, 2));

function materializeWorkspace(workspaceRoot: string, roots: string[]): JsonRecord {
	for (const directory of ["publications", "sources", "indexes", "wiki", "quarantine", "runs"]) {
		mkdirSync(join(workspaceRoot, directory), { recursive: true });
	}
	const sourceIds = new Map<string, string>();
	const publicationRows: Array<{ sourceId: string; file: string; hash: string }> = [];
	const aliases = new Map<string, JsonRecord>();
	for (const root of roots) {
		const publicationDirectory = join(root, "publications");
		if (!existsSync(publicationDirectory)) throw new Error(`Missing publications: ${root}`);
		for (const file of readdirSync(publicationDirectory).filter((name) => name.endsWith(".json"))) {
			const sourcePath = join(publicationDirectory, file);
			const text = readFileSync(sourcePath, "utf8");
			const publication = JSON.parse(text) as JsonRecord;
			const sourceId = requiredString(publication, "sourceId");
			const hash = sha256(text);
			const existing = sourceIds.get(sourceId);
			if (existing && existing !== hash)
				throw new Error(`Conflicting Source publication: ${sourceId}`);
			if (existing) continue;
			sourceIds.set(sourceId, hash);
			const targetName = `${safeName(sourceId)}.json`;
			copyFileSync(sourcePath, join(workspaceRoot, "publications", targetName));
			publicationRows.push({ sourceId, file: targetName, hash });
			copySourceFiles(root, workspaceRoot, sourceId);
		}
		const aliasPath = join(root, "indexes", "retrieval-aliases.jsonl");
		if (existsSync(aliasPath)) {
			for (const alias of readJsonlText(readFileSync(aliasPath, "utf8"))) {
				const claimId = requiredString(alias, "claimId");
				const existing = aliases.get(claimId);
				if (existing && JSON.stringify(existing) !== JSON.stringify(alias)) {
					throw new Error(`Conflicting retrieval alias: ${claimId}`);
				}
				aliases.set(claimId, alias);
			}
		}
	}
	if (aliases.size > 0) {
		writeFileSync(
			join(workspaceRoot, "indexes", "retrieval-aliases.jsonl"),
			`${[...aliases.values()].map((row) => JSON.stringify(row)).join("\n")}\n`,
			"utf8",
		);
	}
	const publications = publicationRows.map(
		(row) =>
			JSON.parse(readFileSync(join(workspaceRoot, "publications", row.file), "utf8")) as JsonRecord,
	);
	const counts = {
		sources: publications.length,
		claims: sum(publications.map((item) => recordArray(item.claims).length)),
		relations: sum(publications.map((item) => recordArray(item.relations).length)),
		concepts: sum(publications.map((item) => recordArray(item.concepts).length)),
		aliases: aliases.size,
	};
	return {
		roots,
		counts,
		workspaceHash: sha256(
			publicationRows
				.map((row) => `${row.sourceId}:${row.hash}`)
				.sort()
				.join("\n"),
		),
	};
}

function copySourceFiles(root: string, workspaceRoot: string, sourceId: string): void {
	const sourceDirectory = join(root, "sources");
	if (!existsSync(sourceDirectory)) return;
	const storageStem = sourceId.startsWith("source:") ? sourceId.slice("source:".length) : sourceId;
	const candidates = readdirSync(sourceDirectory).filter(
		(name) => name === `${storageStem}.json` || name === `${storageStem}.spans.jsonl`,
	);
	for (const file of candidates)
		copyFileSync(join(sourceDirectory, file), join(workspaceRoot, "sources", file));
}

function sourceIdMatches(canonicalId: string, benchmarkId: string): boolean {
	return canonicalId === benchmarkId || canonicalId.startsWith(`source:${benchmarkId}-`);
}

function pairRows(rows: JsonRecord[]): JsonRecord[] {
	const keys = [...new Set(rows.map((row) => `${row.tier}:${row.questionId}`))];
	return keys.map((key) => {
		const [tier, questionId] = key.split(":");
		const r0 = rows.find(
			(row) => row.tier === tier && row.questionId === questionId && row.arm === "R0",
		);
		const r1 = rows.find(
			(row) => row.tier === tier && row.questionId === questionId && row.arm === "R1",
		);
		if (!r0 || !r1) throw new Error(`Missing paired rows: ${key}`);
		return {
			tier,
			questionId,
			candidateSourceRecallDelta: round(
				Number(r1.candidateRequiredSourceRecall) - Number(r0.candidateRequiredSourceRecall),
			),
			candidateEvidenceRecallDelta: round(
				Number(r1.candidateRequiredEvidenceQuoteRecall) -
					Number(r0.candidateRequiredEvidenceQuoteRecall),
			),
			promptSourceRecallDelta: round(
				Number(r1.promptRequiredSourceRecall) - Number(r0.promptRequiredSourceRecall),
			),
			promptEvidenceRecallDelta: round(
				Number(r1.promptRequiredEvidenceQuoteRecall) - Number(r0.promptRequiredEvidenceQuoteRecall),
			),
			contextTokenDelta: Number(r1.estimatedContextTokens) - Number(r0.estimatedContextTokens),
			latencyDeltaMilliseconds: round(
				Number(r1.elapsedMilliseconds) - Number(r0.elapsedMilliseconds),
			),
			r1AddedGraphClaimIds: r1.addedGraphClaimIds,
			r1RemovedLexicalSeedIds: r1.removedLexicalSeedIds,
		};
	});
}

function summarize(rows: JsonRecord[], tier: string, arm: "R0" | "R1"): JsonRecord {
	const selected = rows.filter((row) => row.tier === tier && row.arm === arm);
	const requiredSources = sum(selected.map((row) => Number(row.requiredSourceCount)));
	const matchedSources = sum(selected.map((row) => Number(row.matchedSourceCount)));
	const requiredQuotes = sum(selected.map((row) => Number(row.requiredQuoteCount)));
	const matchedQuotes = sum(selected.map((row) => Number(row.matchedQuoteCount)));
	const candidateMatchedSources = sum(
		selected.map((row) => Number(row.candidateMatchedSourceCount)),
	);
	const candidateMatchedQuotes = sum(selected.map((row) => Number(row.candidateMatchedQuoteCount)));
	const latencies = selected.map((row) => Number(row.elapsedMilliseconds)).sort((a, b) => a - b);
	return {
		tier,
		arm,
		questions: selected.length,
		candidateRequiredSourceRecall:
			requiredSources === 0 ? null : round(candidateMatchedSources / requiredSources),
		candidateRequiredEvidenceQuoteRecall:
			requiredQuotes === 0 ? null : round(candidateMatchedQuotes / requiredQuotes),
		promptRequiredSourceRecall:
			requiredSources === 0 ? null : round(matchedSources / requiredSources),
		promptRequiredEvidenceQuoteRecall:
			requiredQuotes === 0 ? null : round(matchedQuotes / requiredQuotes),
		questionsWithAllRequiredSources: selected.filter(
			(row) => Number(row.matchedSourceCount) === Number(row.requiredSourceCount),
		).length,
		averageContextTokens: round(average(selected.map((row) => Number(row.estimatedContextTokens)))),
		averageQueryMilliseconds: round(average(latencies)),
		p95QueryMilliseconds: round(percentile(latencies, 0.95)),
		averageEligibleClaimsScanned: round(
			average(selected.map((row) => Number(row.eligibleClaimsScanned))),
		),
		averageRelationsGateChecked: round(
			average(selected.map((row) => Number(row.relationsGateChecked))),
		),
		averageCandidateGraphNodes: round(
			average(selected.map((row) => Number(row.candidateGraphNodes))),
		),
	};
}

function requiredSummary(rows: JsonRecord[], tier: string, arm: string): JsonRecord {
	const row = rows.find((item) => item.tier === tier && item.arm === arm);
	if (!row) throw new Error(`Missing summary ${tier}/${arm}`);
	return row;
}

function readJsonlText(text: string): JsonRecord[] {
	return text
		.split(/\r?\n/u)
		.filter((line) => line.trim().length > 0)
		.map((line) => recordValue(JSON.parse(line)));
}

function normalize(value: string): string {
	return value
		.normalize("NFKC")
		.replace(/(^|\s)[>*#-]+\s+/gu, "$1")
		.replace(/[*_`]+/gu, "")
		.replace(/\s+/gu, " ")
		.trim();
}

function recordValue(value: unknown): JsonRecord {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	return value as JsonRecord;
}

function recordArray(value: unknown): JsonRecord[] {
	return Array.isArray(value) ? value.map(recordValue) : [];
}

function stringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

function requiredString(record: JsonRecord, key: string): string {
	const value = record[key];
	if (typeof value !== "string" || value.length === 0) throw new Error(`Missing string ${key}`);
	return value;
}

function writeJson(path: string, value: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function safeName(value: string): string {
	return basename(value).replace(/[^a-zA-Z0-9._-]/gu, "_");
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function sum(values: number[]): number {
	return values.reduce((total, value) => total + value, 0);
}

function average(values: number[]): number {
	return values.length === 0 ? 0 : sum(values) / values.length;
}

function percentile(values: number[], quantile: number): number {
	if (values.length === 0) return 0;
	return values[Math.min(values.length - 1, Math.ceil(values.length * quantile) - 1)] ?? 0;
}

function round(value: number): number {
	return Math.round(value * 1000) / 1000;
}
