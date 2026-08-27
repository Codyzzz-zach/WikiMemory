/**
 * Goal 3-B structural candidate ablation (contract v1, freeze v1).
 *
 * Offline mechanism diagnostic: compares four frozen candidate arms under the
 * contract's candidate budgets — pure lexical (L10_CURRENT, L40_STRONG) and
 * same-evidence-block / same-source structural expansion (L10_BLOCK30,
 * L10_BLOCK20_SOURCE10) — on revealed Batch C evaluator Gold.
 *
 * NOT a blind product run: modelCalls=0, network=false, answers are never
 * generated and nothing is serialized into Context Pack. The report is a
 * POST_HOC_MECHANISM_DIAGNOSTIC.
 *
 * Fail-closed at startup: every frozen hash in the contract and freeze files
 * (questions, diagnostic Gold, implementation code, index pointers) is
 * re-verified before any measurement. The three tiers use the pack-v5
 * persistent indexes; each workspace root is derived from the tier's
 * current.json canonicalGenerationPath (the directory above `indexes`).
 *
 * Only this new script file is written; no other file is modified.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config/index.js";
import { findSpansByIds, readAllSpans } from "../src/linter/storage.js";
import {
	discoverStructuralCandidates,
	retrieveClaimSeedsFromPersistentIndex,
} from "../src/retrieval/persistent-index.js";
import type {
	StructuralCandidateDiagnostics,
	StructuralCandidateTrace,
} from "../src/retrieval/structure.js";
import type { Claim, SourceSpan } from "../src/types/index.js";

type JsonRecord = Record<string, unknown>;

const INDEX_SCHEMA = "wge-persistent-seed-index/v7" as const;
const DEFAULT_RUN_ID = "structural-ablation-v1";

interface FrozenFilePointer {
	path: string;
	sha256: string;
}

interface FrozenQuestionFile extends FrozenFilePointer {
	count: number;
}

interface FrozenIndexPointer {
	tier: string;
	path: string;
	pointerSha256: string;
}

interface StructuralAblationContract {
	schemaVersion: string;
	frozenInputs: {
		questions: FrozenQuestionFile;
		diagnosticGold: FrozenFilePointer;
		baselineImplementation: {
			persistentIndexSha256: string;
			structureTypesSha256: string;
		};
		indexes: FrozenIndexPointer[];
	};
	arms: Array<{
		id: string;
		candidateBudget: number;
		definition: string;
	}>;
	fixed: {
		network: boolean;
		modelCalls: number;
		seedLimit: number;
		primaryCandidateBudget: number;
		tiers: string[];
		questionCount: number;
	};
}

interface StructuralAblationFreeze {
	schemaVersion: string;
	contract: FrozenFilePointer;
	implementation: {
		persistentIndex: FrozenFilePointer;
		structureTypes: FrozenFilePointer;
		structureTests: FrozenFilePointer;
	};
	verification: {
		lint: string;
		typecheck: string;
		testFiles: number;
		testsPassed: number;
		testsFailed: number;
	};
}

interface CurrentIndexPointer {
	schemaVersion: string;
	indexVersion: string;
	snapshotRelativePath: string;
	canonicalGenerationPath: string;
}

interface MinimalGold {
	caseId: string;
	requiredEvidence: Array<{ sourceId: string; exactQuote: string }>;
}

type ArmKind = "lexical-10" | "lexical-40" | "block-30" | "block-20-source-10";

interface ArmSpec {
	id: string;
	candidateBudget: number;
	kind: ArmKind;
}

interface StructuralStageResult {
	pathKinds: string[];
	diagnostics: StructuralCandidateDiagnostics;
	candidates: Array<{ claim: Claim; traces: StructuralCandidateTrace[] }>;
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const scriptPath = fileURLToPath(import.meta.url);
const contractPath = join(
	projectRoot,
	"experiments",
	"goal3",
	"goal3-structural-ablation-contract-v1.json",
);
const freezePath = join(
	projectRoot,
	"experiments",
	"goal3",
	"goal3-structural-ablation-freeze-v1.json",
);
const runId = process.env.WGE_GOAL3_STRUCTURAL_ABLATION_RUN_ID ?? DEFAULT_RUN_ID;
const runRoot = join(projectRoot, "experiments", "goal3", "structural-ablation-runs", runId);
if (existsSync(runRoot)) {
	throw new Error(`Refusing to overwrite structural ablation run: ${runRoot}`);
}

// ─── Fail-closed frozen-hash verification ──────────────────────────────────

const contractText = readFileSync(contractPath, "utf8");
const freezeText = readFileSync(freezePath, "utf8");
const contract = JSON.parse(contractText) as StructuralAblationContract;
const freeze = JSON.parse(freezeText) as StructuralAblationFreeze;

assertSha256(contractText, freeze.contract.sha256, "contract (vs freeze)");
if (resolve(projectRoot, freeze.contract.path) !== contractPath) {
	throw new Error(`Freeze contract path drift: ${freeze.contract.path}`);
}

const questionText = readFileSync(
	resolve(projectRoot, contract.frozenInputs.questions.path),
	"utf8",
);
const goldText = readFileSync(
	resolve(projectRoot, contract.frozenInputs.diagnosticGold.path),
	"utf8",
);
assertSha256(
	questionText,
	contract.frozenInputs.questions.sha256,
	`frozen questions ${contract.frozenInputs.questions.path}`,
);
assertSha256(
	goldText,
	contract.frozenInputs.diagnosticGold.sha256,
	`frozen diagnostic Gold ${contract.frozenInputs.diagnosticGold.path}`,
);

const implementationHashes: JsonRecord = {};
for (const [key, pointer] of Object.entries(freeze.implementation)) {
	const filePath = resolve(projectRoot, pointer.path);
	const fileText = readFileSync(filePath, "utf8");
	assertSha256(fileText, pointer.sha256, `frozen implementation ${pointer.path}`);
	implementationHashes[key] = pointer.sha256;
}

const questions = readJsonlText(questionText);
if (questions.length !== contract.fixed.questionCount) {
	throw new Error(`Frozen question count drifted: ${questions.length}`);
}
const goldById = new Map(
	readJsonlText(goldText).map((row) => [requiredString(row, "caseId"), minimalGold(row)] as const),
);
const questionIds = questions.map((question) => requiredString(question, "caseId"));
const armSpecs = resolveArmSpecs(contract.arms);
const seedLimit = contract.fixed.seedLimit;
const primaryCandidateBudget = contract.fixed.primaryCandidateBudget;

// ─── Measurement ───────────────────────────────────────────────────────────

const rows: JsonRecord[] = [];
const indexPointerHashes: JsonRecord[] = [];
for (const tier of contract.frozenInputs.indexes) {
	const indexRoot = resolve(projectRoot, tier.path);
	const pointerText = readFileSync(join(indexRoot, "current.json"), "utf8");
	assertSha256(pointerText, tier.pointerSha256, `index pointer ${tier.tier}`);
	const pointer = JSON.parse(pointerText) as CurrentIndexPointer;
	if (pointer.schemaVersion !== INDEX_SCHEMA) {
		throw new Error(`Unsupported retrieval index pointer for ${tier.tier}`);
	}
	const workspaceRoot = dirname(dirname(pointer.canonicalGenerationPath));
	const appConfig = loadConfig({ projectRoot: workspaceRoot });
	const allSpans = readAllSpans(appConfig);
	indexPointerHashes.push({ tier: tier.tier, path: tier.path, sha256: sha256(pointerText) });

	for (const question of questions) {
		const questionId = requiredString(question, "caseId");
		const questionValue = requiredString(question, "question");
		const gold = goldById.get(questionId);
		if (!gold) throw new Error(`Missing diagnostic Gold for ${questionId}`);
		const requiredSourceIds = [...new Set(gold.requiredEvidence.map((item) => item.sourceId))];
		const requiredQuotes = gold.requiredEvidence.map((item) => item.exactQuote);

		const seedStarted = process.hrtime.bigint();
		const seedRetrieval = retrieveClaimSeedsFromPersistentIndex(
			indexRoot,
			questionValue,
			primaryCandidateBudget,
		);
		const seedRetrievalMilliseconds = Number(process.hrtime.bigint() - seedStarted) / 1_000_000;
		const lexicalCandidates = seedRetrieval.result.candidates;
		const seeds = lexicalCandidates.slice(0, seedLimit).map((candidate) => candidate.claim);
		const seedIds = new Set(seeds.map((claim) => claim.id));
		const topLexical = lexicalCandidates
			.slice(0, primaryCandidateBudget)
			.map((candidate) => candidate.claim);

		for (const arm of armSpecs) {
			rows.push(
				evaluateArm({
					arm,
					indexRoot,
					seeds,
					seedIds,
					topLexical,
					allSpans,
					requiredSourceIds,
					requiredQuotes,
					seedRetrievalMilliseconds,
					tier: tier.tier,
					questionId,
					questionType: question.questionType ?? null,
				}),
			);
		}
	}
}

// ─── Summaries ─────────────────────────────────────────────────────────────

const summaries = contract.frozenInputs.indexes.flatMap((tier) =>
	contract.arms.map((arm) => summarize(rows, tier.tier, arm.id)),
);
const largestTier = contract.frozenInputs.indexes.at(-1)?.tier;
const smallestTier = contract.frozenInputs.indexes[0]?.tier;
if (!largestTier || !smallestTier) throw new Error("Structural ablation contract has no tiers");

const s50BlockVsL40 = compareArms(rows, largestTier, "L10_BLOCK30", "L40_STRONG", questionIds);
const s50SourceVsL40 = compareArms(
	rows,
	largestTier,
	"L10_BLOCK20_SOURCE10",
	"L40_STRONG",
	questionIds,
);
const s50SourceVsBlock = compareArms(
	rows,
	largestTier,
	"L10_BLOCK20_SOURCE10",
	"L10_BLOCK30",
	questionIds,
);

const armBudgetById = new Map(armSpecs.map((arm) => [arm.id, arm.candidateBudget] as const));
const verdict = computeVerdict({
	rows,
	summaries,
	smallestTier,
	largestTier,
	questionIds,
	armBudgetById,
	s50BlockVsL40,
	s50SourceVsL40,
	s50SourceVsBlock,
});

const report: JsonRecord = {
	schemaVersion: "wge-goal3-structural-ablation-report/v1",
	status: "POST_HOC_MECHANISM_DIAGNOSTIC",
	blind: false,
	interpretation:
		"Revealed Batch C evaluator Gold makes this a post-hoc mechanism diagnostic, not blind product evidence.",
	runId,
	createdAt: new Date().toISOString(),
	verdict,
	provenance: {
		contractPath,
		contractSha256: sha256(contractText),
		freezePath,
		freezeSha256: sha256(freezeText),
		questionsPath: contract.frozenInputs.questions.path,
		questionsSha256: sha256(questionText),
		diagnosticGoldPath: contract.frozenInputs.diagnosticGold.path,
		diagnosticGoldSha256: sha256(goldText),
		implementationSha256: implementationHashes,
		indexPointerSha256: indexPointerHashes,
		scriptSha256: sha256(readFileSync(scriptPath, "utf8")),
		modelCalls: 0,
		network: false,
	},
	checks: {
		frozenContractVerified: true,
		frozenQuestionsVerified: true,
		frozenDiagnosticGoldVerified: true,
		frozenImplementationVerified: true,
		frozenIndexPointersVerified: true,
		boundedCandidateBudget: rows.every(
			(row) =>
				Number(row.candidateClaimCount) <=
				Number(armSpecs.find((arm) => arm.id === row.arm)?.candidateBudget ?? 0),
		),
		frozenVerification: freeze.verification,
		scaleStabilityFailures: Array.isArray(verdict.scaleStability)
			? (verdict.scaleStability as JsonRecord[]).filter((item) => item.stable !== true)
			: [],
	},
	summaries,
	s50Comparisons: {
		structuralArmVsL40: [s50BlockVsL40, s50SourceVsL40],
		block20Source10VsBlock30: s50SourceVsBlock,
	},
	scaleStability: verdict.scaleStability,
	rows,
	limitations: [
		"Revealed Batch C evaluator Gold makes this a post-hoc mechanism diagnostic, not blind product evidence.",
		"Answer generation was intentionally not run; the report only scores candidate closure against required evidence (modelCalls=0).",
		"Structural candidates are serialized into this report for mechanism diagnosis only; nothing was written into Context Pack.",
		"Latency is measured on the persistent v7 index with per-query shard reads (shared seed retrieval plus per-arm structural discovery); it is a mechanism baseline, not a production-scale architecture.",
		"Scale stability compares each structural arm against its own S12 aggregate exact-quote recall; S29 is reported but not used in the frozen decision rules.",
	],
};
writeJson(join(runRoot, "report.json"), report);
writeJson(join(runRoot, "run-manifest.json"), {
	schemaVersion: "wge-goal3-structural-ablation-run-manifest/v1",
	runId,
	status: "POST_HOC_MECHANISM_DIAGNOSTIC",
	modelCalls: 0,
	network: false,
	contractSha256: sha256(contractText),
	freezeSha256: sha256(freezeText),
	questionsSha256: sha256(questionText),
	diagnosticGoldSha256: sha256(goldText),
	implementationSha256: implementationHashes,
	indexPointerSha256: indexPointerHashes,
	scriptSha256: sha256(readFileSync(scriptPath, "utf8")),
	reportSha256: sha256(`${JSON.stringify(report, null, 2)}\n`),
});
console.log(JSON.stringify({ runRoot, verdict, checks: report.checks, summaries }, null, 2));

// ─── Arm evaluation ────────────────────────────────────────────────────────

function evaluateArm(params: {
	arm: ArmSpec;
	indexRoot: string;
	seeds: Claim[];
	seedIds: Set<string>;
	topLexical: Claim[];
	allSpans: SourceSpan[];
	requiredSourceIds: string[];
	requiredQuotes: string[];
	seedRetrievalMilliseconds: number;
	tier: string;
	questionId: string;
	questionType: unknown;
}): JsonRecord {
	const started = process.hrtime.bigint();
	let candidateClaims: Claim[] = [];
	let stages: StructuralStageResult[] = [];
	if (params.arm.kind === "lexical-10") {
		candidateClaims = params.seeds.slice(0, params.arm.candidateBudget);
	} else if (params.arm.kind === "lexical-40") {
		candidateClaims = params.topLexical;
	} else if (params.arm.kind === "block-30") {
		const block = discoverStructuralCandidates(params.indexRoot, params.seeds, {
			maxCandidates: 30,
			pathKinds: ["SAME_EVIDENCE_BLOCK"],
		});
		stages = [
			{
				pathKinds: ["SAME_EVIDENCE_BLOCK"],
				diagnostics: block.diagnostics,
				candidates: block.candidates,
			},
		];
		candidateClaims = [...params.seeds, ...block.candidates.map((candidate) => candidate.claim)];
	} else if (params.arm.kind === "block-20-source-10") {
		const block = discoverStructuralCandidates(params.indexRoot, params.seeds, {
			maxCandidates: 20,
			pathKinds: ["SAME_EVIDENCE_BLOCK"],
		});
		const alreadySelected = new Set([
			...params.seedIds,
			...block.candidates.map((candidate) => candidate.claim.id),
		]);
		const source = discoverStructuralCandidates(params.indexRoot, params.seeds, {
			maxCandidates: 30,
			pathKinds: ["SAME_SOURCE"],
		});
		const sourceOnly = source.candidates
			.filter((candidate) => !alreadySelected.has(candidate.claim.id))
			.slice(0, 10);
		stages = [
			{
				pathKinds: ["SAME_EVIDENCE_BLOCK"],
				diagnostics: block.diagnostics,
				candidates: block.candidates,
			},
			{
				pathKinds: ["SAME_SOURCE"],
				diagnostics: source.diagnostics,
				candidates: sourceOnly,
			},
		];
		candidateClaims = [
			...params.seeds,
			...block.candidates.map((candidate) => candidate.claim),
			...sourceOnly.map((candidate) => candidate.claim),
		];
	} else {
		throw new Error(`Unexpected arm kind: ${String(params.arm.kind)}`);
	}
	if (candidateClaims.length > params.arm.candidateBudget) {
		throw new Error(
			`Arm ${params.arm.id} exceeded frozen candidate budget ` +
				`${params.arm.candidateBudget}: ${candidateClaims.length}`,
		);
	}

	const candidateSpanIds = [...new Set(candidateClaims.flatMap((claim) => claim.evidenceSpanIds))];
	const candidateSpans = findSpansByIds(params.allSpans, candidateSpanIds);
	const candidateSourceIds = [...new Set(candidateSpans.map((span) => span.sourceId))];
	const candidateCharCount = candidateSpans.reduce((total, span) => total + span.text.length, 0);
	const candidateEstimatedTokens = Math.ceil(candidateCharCount / 4);
	const candidateEvidenceText = normalize(candidateSpans.map((span) => span.text).join("\n"));
	const matchedSources = params.requiredSourceIds.filter((sourceId) =>
		candidateSourceIds.some((candidateId) => sourceIdMatches(candidateId, sourceId)),
	);
	const matchedQuotes = params.requiredQuotes.filter((quote) =>
		candidateEvidenceText.includes(normalize(quote)),
	);
	const armElapsedMilliseconds = Number(process.hrtime.bigint() - started) / 1_000_000;

	const structuralDiagnostics = stages.map((stage) => ({
		pathKinds: stage.pathKinds,
		...stage.diagnostics,
	}));
	const discoveredCount = sum(stages.map((stage) => stage.diagnostics.discoveredCandidateCount));
	const inspectedCount = sum(stages.map((stage) => stage.diagnostics.inspectedCandidateCount));
	const truncatedCount = sum(stages.map((stage) => stage.diagnostics.truncatedCount));

	return {
		tier: params.tier,
		questionId: params.questionId,
		questionType: params.questionType,
		arm: params.arm.id,
		armCandidateBudget: params.arm.candidateBudget,
		elapsedMilliseconds: round(params.seedRetrievalMilliseconds + armElapsedMilliseconds),
		seedRetrievalMilliseconds: round(params.seedRetrievalMilliseconds),
		requiredSourceCount: params.requiredSourceIds.length,
		matchedSourceCount: matchedSources.length,
		requiredQuoteCount: params.requiredQuotes.length,
		matchedQuoteCount: matchedQuotes.length,
		candidateRequiredSourceRecall:
			params.requiredSourceIds.length === 0
				? null
				: round(matchedSources.length / params.requiredSourceIds.length),
		candidateRequiredEvidenceQuoteRecall:
			params.requiredQuotes.length === 0
				? null
				: round(matchedQuotes.length / params.requiredQuotes.length),
		candidateClaimIds: candidateClaims.map((claim) => claim.id),
		candidateClaimCount: candidateClaims.length,
		candidateSourceCount: candidateSourceIds.length,
		candidateSpanCount: candidateSpans.length,
		candidateCharCount,
		candidateEstimatedTokens,
		matchedSources,
		missingSources: params.requiredSourceIds.filter(
			(sourceId) => !matchedSources.includes(sourceId),
		),
		matchedQuotes,
		missingQuotes: params.requiredQuotes.filter((quote) => !matchedQuotes.includes(quote)),
		structuralTraces:
			stages.length === 0
				? null
				: stages.flatMap((stage) =>
						stage.candidates.map((candidate) => ({
							claimId: candidate.claim.id,
							traces: candidate.traces,
						})),
					),
		structuralDiagnostics: structuralDiagnostics.length === 0 ? null : structuralDiagnostics,
		structuralDiscoveredCandidateCount: stages.length === 0 ? null : discoveredCount,
		structuralInspectedCandidateCount: stages.length === 0 ? null : inspectedCount,
		structuralTruncatedCount: stages.length === 0 ? null : truncatedCount,
	};
}

// ─── Summary / comparison / verdict ────────────────────────────────────────

function summarize(rows: JsonRecord[], tier: string, arm: string): JsonRecord {
	const selected = rows.filter((row) => row.tier === tier && row.arm === arm);
	const requiredSources = sum(selected.map((row) => Number(row.requiredSourceCount)));
	const matchedSources = sum(selected.map((row) => Number(row.matchedSourceCount)));
	const requiredQuotes = sum(selected.map((row) => Number(row.requiredQuoteCount)));
	const matchedQuotes = sum(selected.map((row) => Number(row.matchedQuoteCount)));
	const latencies = selected
		.map((row) => Number(row.elapsedMilliseconds))
		.sort((left, right) => left - right);
	const discovered = nonNullNumbers(selected.map((row) => row.structuralDiscoveredCandidateCount));
	const inspected = nonNullNumbers(selected.map((row) => row.structuralInspectedCandidateCount));
	const truncated = nonNullNumbers(selected.map((row) => row.structuralTruncatedCount));
	return {
		tier,
		arm,
		questions: selected.length,
		candidateRequiredSourceRecall:
			requiredSources === 0 ? null : round(matchedSources / requiredSources),
		candidateRequiredEvidenceQuoteRecall:
			requiredQuotes === 0 ? null : round(matchedQuotes / requiredQuotes),
		questionsWithAllRequiredSources: selected.filter(
			(row) => Number(row.matchedSourceCount) === Number(row.requiredSourceCount),
		).length,
		questionsWithAllRequiredQuotes: selected.filter(
			(row) => Number(row.matchedQuoteCount) === Number(row.requiredQuoteCount),
		).length,
		averageCandidateClaimCount: round(
			average(selected.map((row) => Number(row.candidateClaimCount))),
		),
		averageCandidateSourceCount: round(
			average(selected.map((row) => Number(row.candidateSourceCount))),
		),
		averageCandidateSpanCount: round(
			average(selected.map((row) => Number(row.candidateSpanCount))),
		),
		averageCandidateCharCount: round(
			average(selected.map((row) => Number(row.candidateCharCount))),
		),
		averageEvidenceClosureTokens: round(
			average(selected.map((row) => Number(row.candidateEstimatedTokens))),
		),
		averageQueryMilliseconds: round(average(latencies)),
		p95QueryMilliseconds: round(percentile(latencies, 0.95)),
		averageStructuralDiscoveredCandidateCount:
			discovered.length === 0 ? null : round(average(discovered)),
		averageStructuralInspectedCandidateCount:
			inspected.length === 0 ? null : round(average(inspected)),
		averageStructuralTruncatedCount: truncated.length === 0 ? null : round(average(truncated)),
	};
}

function compareArms(
	rows: JsonRecord[],
	tier: string,
	structuralArm: string,
	baselineArm: string,
	questionIds: string[],
): JsonRecord {
	const structural = rows.filter((row) => row.tier === tier && row.arm === structuralArm);
	const baseline = rows.filter((row) => row.tier === tier && row.arm === baselineArm);
	const structuralByQuestion = new Map(structural.map((row) => [row.questionId, row] as const));
	const baselineByQuestion = new Map(baseline.map((row) => [row.questionId, row] as const));
	const perQuestion = questionIds.map((questionId) => {
		const structuralRow = structuralByQuestion.get(questionId);
		const baselineRow = baselineByQuestion.get(questionId);
		if (!structuralRow || !baselineRow) {
			throw new Error(
				`Missing comparison rows ${tier}/${structuralArm}/${baselineArm}/${questionId}`,
			);
		}
		const sourceDelta =
			Number(structuralRow.matchedSourceCount) - Number(baselineRow.matchedSourceCount);
		const quoteDelta =
			Number(structuralRow.matchedQuoteCount) - Number(baselineRow.matchedQuoteCount);
		const structuralSources = new Set(stringArray(structuralRow.matchedSources));
		const baselineSources = new Set(stringArray(baselineRow.matchedSources));
		const structuralQuotes = new Set(stringArray(structuralRow.matchedQuotes));
		const baselineQuotes = new Set(stringArray(baselineRow.matchedQuotes));
		const gainedSources = [...structuralSources].filter((item) => !baselineSources.has(item));
		const lostSources = [...baselineSources].filter((item) => !structuralSources.has(item));
		const gainedQuotes = [...structuralQuotes].filter((item) => !baselineQuotes.has(item));
		const lostQuotes = [...baselineQuotes].filter((item) => !structuralQuotes.has(item));
		const baselineTokens = Number(baselineRow.candidateEstimatedTokens);
		return {
			questionId,
			sourceDelta,
			quoteDelta,
			gainedSources,
			lostSources,
			gainedQuotes,
			lostQuotes,
			sourceOutcome: lostSources.length > 0 ? "loss" : gainedSources.length > 0 ? "win" : "tie",
			quoteOutcome: lostQuotes.length > 0 ? "loss" : gainedQuotes.length > 0 ? "win" : "tie",
			tokenRatio:
				baselineTokens === 0
					? null
					: round(Number(structuralRow.candidateEstimatedTokens) / baselineTokens),
			structuralMatchedSources: Number(structuralRow.matchedSourceCount),
			baselineMatchedSources: Number(baselineRow.matchedSourceCount),
			structuralMatchedQuotes: Number(structuralRow.matchedQuoteCount),
			baselineMatchedQuotes: Number(baselineRow.matchedQuoteCount),
		};
	});
	const sourceWins = perQuestion.filter((row) => row.sourceOutcome === "win").length;
	const sourceLosses = perQuestion.filter((row) => row.sourceOutcome === "loss").length;
	const sourceTies = perQuestion.filter((row) => row.sourceOutcome === "tie").length;
	const quoteWins = perQuestion.filter((row) => row.quoteOutcome === "win").length;
	const quoteLosses = perQuestion.filter((row) => row.quoteOutcome === "loss").length;
	const quoteTies = perQuestion.filter((row) => row.quoteOutcome === "tie").length;
	const structuralTokenAverage = average(
		structural.map((row) => Number(row.candidateEstimatedTokens)),
	);
	const baselineTokenAverage = average(baseline.map((row) => Number(row.candidateEstimatedTokens)));
	const structuralP95 = percentile(
		structural.map((row) => Number(row.elapsedMilliseconds)).sort((a, b) => a - b),
		0.95,
	);
	const baselineP95 = percentile(
		baseline.map((row) => Number(row.elapsedMilliseconds)).sort((a, b) => a - b),
		0.95,
	);
	return {
		tier,
		structuralArm,
		baselineArm,
		perQuestion,
		sourceWins,
		sourceLosses,
		sourceTies,
		quoteWins,
		quoteLosses,
		quoteTies,
		anyStrictWin: sourceWins + quoteWins > 0,
		anyItemGain: perQuestion.some(
			(row) => row.gainedSources.length > 0 || row.gainedQuotes.length > 0,
		),
		anyLoss: sourceLosses + quoteLosses > 0,
		matchedSourceDelta: round(sum(perQuestion.map((row) => Number(row.sourceDelta)))),
		matchedQuoteDelta: round(sum(perQuestion.map((row) => Number(row.quoteDelta)))),
		matchedTotalDelta: round(
			sum(perQuestion.map((row) => Number(row.sourceDelta) + Number(row.quoteDelta))),
		),
		structuralAverageTokens: round(structuralTokenAverage),
		baselineAverageTokens: round(baselineTokenAverage),
		averageTokenRatio:
			baselineTokenAverage === 0 ? null : round(structuralTokenAverage / baselineTokenAverage),
		tokenCeilingPass:
			baselineTokenAverage === 0 ? true : structuralTokenAverage <= baselineTokenAverage * 1.1,
		structuralP95Milliseconds: round(structuralP95),
		baselineP95Milliseconds: round(baselineP95),
		latencyCeilingMilliseconds: round(Math.max(baselineP95 * 2, baselineP95 + 50)),
		latencyPass: structuralP95 <= Math.max(baselineP95 * 2, baselineP95 + 50),
	};
}

function computeVerdict(params: {
	rows: JsonRecord[];
	summaries: JsonRecord[];
	smallestTier: string;
	largestTier: string;
	questionIds: string[];
	armBudgetById: ReadonlyMap<string, number>;
	s50BlockVsL40: JsonRecord;
	s50SourceVsL40: JsonRecord;
	s50SourceVsBlock: JsonRecord;
}): JsonRecord {
	const summaryAt = (tier: string, arm: string): JsonRecord => {
		const row = params.summaries.find((item) => item.tier === tier && item.arm === arm);
		if (!row) throw new Error(`Missing summary ${tier}/${arm}`);
		return row;
	};
	const s50 = {
		L40_STRONG: summaryAt(params.largestTier, "L40_STRONG"),
		L10_BLOCK30: summaryAt(params.largestTier, "L10_BLOCK30"),
		L10_BLOCK20_SOURCE10: summaryAt(params.largestTier, "L10_BLOCK20_SOURCE10"),
	};
	const s12 = {
		L10_BLOCK30: summaryAt(params.smallestTier, "L10_BLOCK30"),
		L10_BLOCK20_SOURCE10: summaryAt(params.smallestTier, "L10_BLOCK20_SOURCE10"),
	};
	const recallAtLeast = (arm: JsonRecord, baseline: JsonRecord): boolean =>
		Number(arm.candidateRequiredSourceRecall ?? 0) >=
			Number(baseline.candidateRequiredSourceRecall ?? 0) &&
		Number(arm.candidateRequiredEvidenceQuoteRecall ?? 0) >=
			Number(baseline.candidateRequiredEvidenceQuoteRecall ?? 0);

	const safetyAndCost = (
		armId: string,
		arm: JsonRecord,
		baseline: JsonRecord,
		comparison: JsonRecord,
	): JsonRecord => ({
		recallAtLeastBaseline: recallAtLeast(arm, baseline),
		anyStrictWin: comparison.anyStrictWin,
		zeroLosses: !comparison.anyLoss,
		budgetPass: params.rows.every(
			(row) =>
				row.tier !== params.largestTier ||
				row.arm !== armId ||
				Number(row.candidateClaimCount) <= (params.armBudgetById.get(armId) ?? 0),
		),
		tokenCeilingPass: comparison.tokenCeilingPass,
		latencyPass: comparison.latencyPass,
	});

	const blockSafety = safetyAndCost(
		"L10_BLOCK30",
		s50.L10_BLOCK30,
		s50.L40_STRONG,
		params.s50BlockVsL40,
	);
	const blockSignal = {
		condition:
			blockSafety.recallAtLeastBaseline &&
			blockSafety.anyStrictWin &&
			blockSafety.zeroLosses &&
			blockSafety.budgetPass &&
			blockSafety.tokenCeilingPass &&
			blockSafety.latencyPass,
		checks: {
			...blockSafety,
			arm: "L10_BLOCK30",
			baseline: "L40_STRONG",
			averageTokenRatio: params.s50BlockVsL40.averageTokenRatio,
			p95LatencyRatio: round(
				Number(params.s50BlockVsL40.structuralP95Milliseconds) /
					Math.max(0.001, Number(params.s50BlockVsL40.baselineP95Milliseconds)),
			),
		},
	};

	const sourceSafety = safetyAndCost(
		"L10_BLOCK20_SOURCE10",
		s50.L10_BLOCK20_SOURCE10,
		s50.L40_STRONG,
		params.s50SourceVsL40,
	);
	const sourceMoreMatched = Number(params.s50SourceVsBlock.matchedTotalDelta) > 0;
	const sourceNoLossVsBlock = !params.s50SourceVsBlock.anyLoss;
	const sourceMarginalSignal = {
		condition:
			sourceSafety.recallAtLeastBaseline &&
			sourceSafety.anyStrictWin &&
			sourceSafety.zeroLosses &&
			sourceSafety.budgetPass &&
			sourceSafety.tokenCeilingPass &&
			sourceSafety.latencyPass &&
			sourceMoreMatched &&
			sourceNoLossVsBlock,
		checks: {
			...sourceSafety,
			arm: "L10_BLOCK20_SOURCE10",
			baseline: "L40_STRONG",
			moreMatchedThanBlock30: sourceMoreMatched,
			zeroLossesVsBlock30: sourceNoLossVsBlock,
			matchedTotalDeltaVsBlock30: params.s50SourceVsBlock.matchedTotalDelta,
			averageTokenRatio: params.s50SourceVsL40.averageTokenRatio,
		},
	};

	const scaleStability = [
		{
			arm: "L10_BLOCK30",
			s12ExactQuoteRecall: s12.L10_BLOCK30.candidateRequiredEvidenceQuoteRecall,
			s50ExactQuoteRecall: s50.L10_BLOCK30.candidateRequiredEvidenceQuoteRecall,
			delta: round(
				Number(s50.L10_BLOCK30.candidateRequiredEvidenceQuoteRecall ?? 0) -
					Number(s12.L10_BLOCK30.candidateRequiredEvidenceQuoteRecall ?? 0),
			),
		},
		{
			arm: "L10_BLOCK20_SOURCE10",
			s12ExactQuoteRecall: s12.L10_BLOCK20_SOURCE10.candidateRequiredEvidenceQuoteRecall,
			s50ExactQuoteRecall: s50.L10_BLOCK20_SOURCE10.candidateRequiredEvidenceQuoteRecall,
			delta: round(
				Number(s50.L10_BLOCK20_SOURCE10.candidateRequiredEvidenceQuoteRecall ?? 0) -
					Number(s12.L10_BLOCK20_SOURCE10.candidateRequiredEvidenceQuoteRecall ?? 0),
			),
		},
	].map((item) => ({ ...item, stable: Number(item.delta) >= -0.05 }));

	const blockHasNoWinVsL40 = !params.s50BlockVsL40.anyItemGain;
	const sourceHasNoWinVsL40 = !params.s50SourceVsL40.anyItemGain;
	const noStructuralBenefit = {
		condition: blockHasNoWinVsL40 && sourceHasNoWinVsL40,
		checks: {
			blockAnyStrictWinVsL40: params.s50BlockVsL40.anyStrictWin,
			sourceAnyStrictWinVsL40: params.s50SourceVsL40.anyStrictWin,
		},
	};

	const reworkChecksFor = (armId: string, comparison: JsonRecord): JsonRecord => ({
		recallGain: comparison.anyItemGain === true,
		tokenOverheadExceeds10Percent:
			Number(comparison.structuralAverageTokens) > Number(comparison.baselineAverageTokens) * 1.1,
		budgetViolation: params.rows.some(
			(row) =>
				row.arm === armId &&
				Number(row.candidateClaimCount) > (params.armBudgetById.get(armId) ?? 0),
		),
		perQuestionLosses: comparison.anyLoss,
	});
	const blockRework = reworkChecksFor("L10_BLOCK30", params.s50BlockVsL40);
	const sourceRework = reworkChecksFor("L10_BLOCK20_SOURCE10", params.s50SourceVsL40);
	const rework = {
		condition:
			(blockRework.recallGain &&
				(blockRework.tokenOverheadExceeds10Percent ||
					blockRework.budgetViolation ||
					blockRework.perQuestionLosses)) ||
			(sourceRework.recallGain &&
				(sourceRework.tokenOverheadExceeds10Percent ||
					sourceRework.budgetViolation ||
					sourceRework.perQuestionLosses)),
		checks: { L10_BLOCK30: blockRework, L10_BLOCK20_SOURCE10: sourceRework },
	};

	const label = rework.condition
		? "REWORK"
		: blockSignal.condition && sourceMarginalSignal.condition
			? "BLOCK_AND_SOURCE_MARGINAL_SIGNAL"
			: blockSignal.condition
				? "BLOCK_SIGNAL"
				: sourceMarginalSignal.condition
					? "SOURCE_MARGINAL_SIGNAL"
					: noStructuralBenefit.condition
						? "NO_STRUCTURAL_BENEFIT"
						: "INCONCLUSIVE";

	return {
		label,
		blockSignal,
		sourceMarginalSignal,
		scaleStability,
		scaleStabilityPass: scaleStability.every((item) => item.stable),
		noStructuralBenefit,
		rework,
	};
}

// ─── Helpers (JSON / hash / normalize semantics shared with scale retrieval) ─

function resolveArmSpecs(arms: StructuralAblationContract["arms"]): ArmSpec[] {
	const kinds: Record<string, ArmKind> = {
		L10_CURRENT: "lexical-10",
		L40_STRONG: "lexical-40",
		L10_BLOCK30: "block-30",
		L10_BLOCK20_SOURCE10: "block-20-source-10",
	};
	return arms.map((arm) => {
		const kind = kinds[arm.id];
		if (!kind) throw new Error(`Unknown frozen arm id: ${arm.id}`);
		return { id: arm.id, candidateBudget: arm.candidateBudget, kind };
	});
}

function minimalGold(row: JsonRecord): MinimalGold {
	return {
		caseId: requiredString(row, "caseId"),
		// Only scoring-relevant Gold is retained: answers and forbidden claims are not copied.
		requiredEvidence: recordArray(row.requiredEvidence).map((item) => ({
			sourceId: requiredString(item, "sourceId"),
			exactQuote: requiredString(item, "exactQuote"),
		})),
	};
}

function sourceIdMatches(canonicalId: string, benchmarkId: string): boolean {
	return canonicalId === benchmarkId || canonicalId.startsWith(`source:${benchmarkId}-`);
}

function nonNullNumbers(values: unknown[]): number[] {
	return values
		.map((value) => (value === null || value === undefined ? Number.NaN : Number(value)))
		.filter((value) => Number.isFinite(value));
}

function stringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

function readJsonlText(text: string): JsonRecord[] {
	return text
		.split(/\r?\n/u)
		.filter((line) => line.trim().length > 0)
		.map((line) => recordValue(JSON.parse(line)));
}

/**
 * Quote normalization MUST stay identical to run-goal3-scale-retrieval.ts so
 * exact-quote matching is comparable across the scale and ablation runs.
 */
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

function requiredString(record: JsonRecord, key: string): string {
	const value = record[key];
	if (typeof value !== "string" || value.length === 0) throw new Error(`Missing string ${key}`);
	return value;
}

function assertSha256(value: string, expected: string, label: string): void {
	const actual = sha256(value);
	if (actual !== expected) {
		throw new Error(`Fail-closed: ${label} hash mismatch (expected ${expected}, got ${actual})`);
	}
}

function writeJson(path: string, value: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
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
