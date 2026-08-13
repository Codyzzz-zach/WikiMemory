/**
 * Goal 3 evidence-coverage rescore (contract v1) — offline evaluator-repair runner.
 *
 * Repairs an order-dependent exact-quote scoring defect WITHOUT changing or
 * rerunning either retrieval arm, then rescored the immutable Batch C and
 * Batch B source-routing reports against the fixedAlgorithm from
 * experiments/goal3/goal3-evidence-coverage-rescore-contract-v1.json.
 *
 * NOT blind product evidence: status is POST_HOC_EVALUATOR_REPAIR,
 * modelCalls=0, network=false, retrievalCalls=0. No retrieval function is
 * called — candidateSpanIds and candidateClaimIds are read verbatim from the
 * frozen v1 report rows (Batch C filtered to tier S50, Batch B is S50-only),
 * and every candidate set is re-hashed and proven unchanged.
 *
 * Fail-closed at startup:
 * - the output directory must not exist (no overwrite);
 * - the freeze file experiments/goal3/goal3-evidence-coverage-rescore-freeze-v1.json
 *   must exist and pin: contract, both input reports, both Golds, the S50 span
 *   corpus digest, evidence-coverage.ts, evidence-coverage.test.ts and this
 *   runner's own hash. While the freeze is absent the script prints an
 *   actionable error containing a ready-to-write freeze skeleton;
 * - the span corpus shell manifest sha256 must exactly reproduce the contract
 *   value (sorted `*.spans.jsonl` under the sources root; per line:
 *   `<fileSha256>  <project-relative-path>/<fileName>`, LF-terminated);
 * - all report rows must align 1:1 with Gold caseIds for the rescorred tier;
 * - every rescore is computed twice and must be deterministic.
 *
 * The only score that may change is exact-quote matching via
 * evaluateEvidenceCoverage; candidate sets, source metrics, token and latency
 * metrics are never recomputed (they are copied verbatim from the frozen
 * reports).
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	type EvidenceRequirement,
	evaluateEvidenceCoverage,
} from "../src/retrieval/evidence-coverage.js";
import type { SourceSpan } from "../src/types/index.js";

type JsonRecord = Record<string, unknown>;

const DEFAULT_RUN_ID = "evidence-coverage-rescore-v1";
const L40_ARM = "L40_STRONG" as const;
const SR_ARM = "SR12_40" as const;
const TIER = "S50";
const SCOPE = "GLOBAL_ONLY";
const SPAN_FILE_SUFFIX = ".spans.jsonl";
const EXPECTED_SPAN_FILE_COUNT = 50;
const FREEZE_SCHEMA = "wge-goal3-evidence-coverage-rescore-freeze/v1";
const MANIFEST_SCHEMA = "wge-goal3-evidence-coverage-rescore-run-manifest/v1";
const REPORT_SCHEMA = "wge-goal3-evidence-coverage-rescore-report/v1";

interface FrozenFilePointer {
	path: string;
	sha256: string;
}

interface RescoreContract {
	schemaVersion: string;
	status: string;
	frozenInputs: {
		batchCReport: FrozenFilePointer;
		batchCGold: FrozenFilePointer;
		batchBReport: FrozenFilePointer;
		batchBGold: FrozenFilePointer;
		spanCorpus: {
			path: string;
			filePattern: string;
			fileCount: number;
			shellManifestSha256: string;
		};
	};
	fixedAlgorithm: string[];
	requiredTests: string[];
	prohibitions: string[];
	decisionRules: JsonRecord;
}

interface RescoreFreeze {
	schemaVersion: string;
	status: string;
	frozenAt: string;
	contract: FrozenFilePointer;
	inputs: {
		batchCReport: FrozenFilePointer;
		batchCGold: FrozenFilePointer;
		batchBReport: FrozenFilePointer;
		batchBGold: FrozenFilePointer;
		spanCorpus: {
			path: string;
			fileCount: number;
			shellManifestSha256: string;
		};
	};
	implementation: {
		evidenceCoverage: FrozenFilePointer;
		evidenceCoverageTests: FrozenFilePointer;
		rescoreRunner: FrozenFilePointer;
	};
	verification: JsonRecord;
	prohibitions: string[];
}

interface MinimalGold {
	caseId: string;
	requiredEvidence: EvidenceRequirement[];
}

interface SpanCorpusDigest {
	rootRelativePath: string;
	fileCount: number;
	shellManifestSha256: string;
}

interface ProcessedDataset {
	datasetId: "batchC" | "batchB";
	sourceReport: { path: string; sha256: string; status: string; verified: boolean };
	gold: { path: string; sha256: string; verified: boolean };
	tier: string;
	questionCount: number;
	rowCount: number;
	candidateSetHash: string;
	candidateSetRows: Array<{
		questionId: string;
		arm: string;
		claimIdsHash: string;
		spanIdsHash: string;
		combinedHash: string;
	}>;
	aggregate: Array<{
		arm: string;
		questions: number;
		oldQuoteRecall: number | null;
		correctedQuoteRecall: number | null;
		oldMatchedQuoteCount: number;
		oldRequiredQuoteCount: number;
		correctedMatchedEvidenceCount: number;
		correctedRequiredEvidenceCount: number;
		oldQuestionsWithAllQuotes: number;
		correctedQuestionsWithAllEvidence: number;
	}>;
	oldComparison: JsonRecord[];
	questions: Array<{
		questionId: string;
		tier: string;
		arms: Record<string, JsonRecord>;
		correctedComparison: JsonRecord;
		outcomeChange: JsonRecord;
	}>;
	alignment: { pass: boolean; detail: string };
	inputSafetyPass: boolean;
	determinismChecks: number;
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const scriptPath = fileURLToPath(import.meta.url);
const contractPath = join(
	projectRoot,
	"experiments",
	"goal3",
	"goal3-evidence-coverage-rescore-contract-v1.json",
);
const freezePath = join(
	projectRoot,
	"experiments",
	"goal3",
	"goal3-evidence-coverage-rescore-freeze-v1.json",
);
const runId = process.env.WGE_GOAL3_EVIDENCE_COVERAGE_RESCORE_RUN_ID ?? DEFAULT_RUN_ID;
const runRoot = join(projectRoot, "experiments", "goal3", "evidence-coverage-rescore-runs", runId);
if (existsSync(runRoot)) {
	throw new Error(`Refusing to overwrite evidence-coverage rescore run: ${runRoot}`);
}

// ─── Fail-closed frozen-input verification ─────────────────────────────────

const contractText = readFileSync(contractPath, "utf8");
const contract = JSON.parse(contractText) as RescoreContract;
if (contract.schemaVersion !== "wge-goal3-evidence-coverage-rescore-contract/v1") {
	throw new Error(`Unsupported rescore contract schema: ${contract.schemaVersion}`);
}
if (
	contract.frozenInputs.spanCorpus.filePattern !== "*.spans.jsonl" ||
	contract.frozenInputs.spanCorpus.fileCount !== EXPECTED_SPAN_FILE_COUNT
) {
	throw new Error("Unsupported frozen span corpus contract");
}

const scriptText = readFileSync(scriptPath, "utf8");
const evidenceCoveragePath = resolve(projectRoot, "src", "retrieval", "evidence-coverage.ts");
const evidenceCoverageTestsPath = resolve(
	projectRoot,
	"src",
	"retrieval",
	"evidence-coverage.test.ts",
);
const evidenceCoverageText = readFileSync(evidenceCoveragePath, "utf8");
const evidenceCoverageTestsText = readFileSync(evidenceCoverageTestsPath, "utf8");

// Span corpus shell manifest — must exactly reproduce the contract digest.
const spanCorpusDigest = computeSpanCorpusDigest(contract.frozenInputs.spanCorpus.path);
if (spanCorpusDigest.fileCount !== contract.frozenInputs.spanCorpus.fileCount) {
	throw new Error(
		`Fail-closed: span corpus fileCount drifted (expected ${contract.frozenInputs.spanCorpus.fileCount}, got ${spanCorpusDigest.fileCount})`,
	);
}
assertDigestEqual(
	spanCorpusDigest.shellManifestSha256,
	contract.frozenInputs.spanCorpus.shellManifestSha256,
	"span corpus shell manifest (vs contract)",
);

// Reports and Golds are hash-verified against the contract before any parsing.
const batchCReportText = readFileSync(
	resolve(projectRoot, contract.frozenInputs.batchCReport.path),
	"utf8",
);
const batchBReportText = readFileSync(
	resolve(projectRoot, contract.frozenInputs.batchBReport.path),
	"utf8",
);
const batchCGoldText = readFileSync(
	resolve(projectRoot, contract.frozenInputs.batchCGold.path),
	"utf8",
);
const batchBGoldText = readFileSync(
	resolve(projectRoot, contract.frozenInputs.batchBGold.path),
	"utf8",
);
assertSha256(
	batchCReportText,
	contract.frozenInputs.batchCReport.sha256,
	`frozen batch C report ${contract.frozenInputs.batchCReport.path}`,
);
assertSha256(
	batchBReportText,
	contract.frozenInputs.batchBReport.sha256,
	`frozen batch B report ${contract.frozenInputs.batchBReport.path}`,
);
assertSha256(
	batchCGoldText,
	contract.frozenInputs.batchCGold.sha256,
	`frozen batch C Gold ${contract.frozenInputs.batchCGold.path}`,
);
assertSha256(
	batchBGoldText,
	contract.frozenInputs.batchBGold.sha256,
	`frozen batch B Gold ${contract.frozenInputs.batchBGold.path}`,
);

// ─── Freeze (must exist, else actionable error with ready-to-write skeleton) ─

if (!existsSync(freezePath)) {
	const suggested = suggestedFreeze({
		contractText,
		batchCReportText,
		batchBReportText,
		batchCGoldText,
		batchBGoldText,
		evidenceCoverageText,
		evidenceCoverageTestsText,
		scriptText,
		spanCorpus: contract.frozenInputs.spanCorpus,
		computedShellManifestSha256: spanCorpusDigest.shellManifestSha256,
	});
	throw new Error(
		`Fail-closed: rescore freeze does not exist at ${freezePath}. Create it with exactly the pinned hashes below (computed from the current files), review the verification block, then re-run the rescore:\n${JSON.stringify(suggested, null, 2)}\n`,
	);
}

const freezeText = readFileSync(freezePath, "utf8");
const freeze = JSON.parse(freezeText) as RescoreFreeze;
if (freeze.schemaVersion !== FREEZE_SCHEMA) {
	throw new Error(`Unsupported rescore freeze schema: ${freeze.schemaVersion}`);
}
verifyFreeze(freeze, {
	contractPath,
	contractText,
	batchCReportPath: resolve(projectRoot, contract.frozenInputs.batchCReport.path),
	batchCReportText,
	batchBReportPath: resolve(projectRoot, contract.frozenInputs.batchBReport.path),
	batchBReportText,
	batchCGoldPath: resolve(projectRoot, contract.frozenInputs.batchCGold.path),
	batchCGoldText,
	batchBGoldPath: resolve(projectRoot, contract.frozenInputs.batchBGold.path),
	batchBGoldText,
	spanCorpus: contract.frozenInputs.spanCorpus,
	spanCorpusDigest,
	evidenceCoveragePath,
	evidenceCoverageText,
	evidenceCoverageTestsPath,
	evidenceCoverageTestsText,
	scriptPath,
	scriptText,
});

// ─── Load persisted spans once (shared S50 corpus for both datasets) ────────

const spans = loadSpans(contract.frozenInputs.spanCorpus.path);

// ─── Parse reports and Golds; align S50 rows 1:1 with Gold caseIds ─────────

const batchCReport = JSON.parse(batchCReportText) as JsonRecord;
const batchBReport = JSON.parse(batchBReportText) as JsonRecord;
const batchCGoldRows = readJsonlText(batchCGoldText);
const batchBGoldRows = readJsonlText(batchBGoldText);

const batchC = processDataset({
	datasetId: "batchC",
	report: batchCReport,
	goldRows: batchCGoldRows,
	spans,
	sourceReportPath: contract.frozenInputs.batchCReport.path,
	sourceReportSha256: contract.frozenInputs.batchCReport.sha256,
	sourceReportStatus: String(batchCReport.status ?? "unknown"),
	goldPath: contract.frozenInputs.batchCGold.path,
	goldSha256: contract.frozenInputs.batchCGold.sha256,
});
const batchB = processDataset({
	datasetId: "batchB",
	report: batchBReport,
	goldRows: batchBGoldRows,
	spans,
	sourceReportPath: contract.frozenInputs.batchBReport.path,
	sourceReportSha256: contract.frozenInputs.batchBReport.sha256,
	sourceReportStatus: String(batchBReport.status ?? "unknown"),
	goldPath: contract.frozenInputs.batchBGold.path,
	goldSha256: contract.frozenInputs.batchBGold.sha256,
});

// ─── Integrity / decision inputs (never hardcoded to any caseId) ───────────

const datasetHash = (dataset: ProcessedDataset): string => {
	const combined = dataset.candidateSetRows
		.map((row) => `${row.questionId}/${row.arm}\u0000${row.combinedHash}`)
		.sort()
		.join("\n");
	return sha256(combined);
};
const candidateSetVerified = batchC.alignment.pass && batchB.alignment.pass;
const scopeOk = batchC.inputSafetyPass && batchB.inputSafetyPass;

const oldLossToFixed: Array<{
	datasetId: "batchC" | "batchB";
	questionId: string;
	oldQuoteOutcome: string;
	correctedQuoteOutcome: string;
}> = [];
const srExactEvidenceLosses: Array<{
	datasetId: "batchC" | "batchB";
	questionId: string;
	arm: string;
	lostEvidenceKeys: string[];
}> = [];
for (const dataset of [batchC, batchB]) {
	for (const question of dataset.questions) {
		const oldQuoteOutcome = String(
			dataset.oldComparison.find((row) => row.questionId === question.questionId)?.quoteOutcome ??
				"unknown",
		);
		const correctedQuoteOutcome = String(question.correctedComparison.correctedQuoteOutcome);
		if (
			oldQuoteOutcome === "loss" &&
			(correctedQuoteOutcome === "tie" || correctedQuoteOutcome === "win")
		) {
			oldLossToFixed.push({
				datasetId: dataset.datasetId,
				questionId: question.questionId,
				oldQuoteOutcome,
				correctedQuoteOutcome,
			});
		}
		const lost = stringArray(question.correctedComparison.correctedLostQuoteKeys);
		if (lost.length > 0) {
			srExactEvidenceLosses.push({
				datasetId: dataset.datasetId,
				questionId: question.questionId,
				arm: SR_ARM,
				lostEvidenceKeys: lost,
			});
		}
	}
}

const artifactConfirmed = oldLossToFixed.length > 0;
const trueQuoteRiskRemains = srExactEvidenceLosses.length > 0;
// Any non-deterministic rescore fails closed (throws) inside processDataset,
// so reaching this point already proves determinism for every (question, arm).
const expectedDeterminismChecks = batchC.rowCount + batchB.rowCount;
const deterministic =
	batchC.determinismChecks + batchB.determinismChecks === expectedDeterminismChecks;

const reworkCondition = !deterministic || !candidateSetVerified || !scopeOk;
const verdictLabel = reworkCondition
	? "REWORK"
	: trueQuoteRiskRemains
		? "TRUE_QUOTE_RISK_REMAINS"
		: artifactConfirmed
			? "EVALUATOR_ARTIFACT_CONFIRMED"
			: "NO_SCORE_CHANGE";

// ─── Report ────────────────────────────────────────────────────────────────

const report: JsonRecord = {
	schemaVersion: REPORT_SCHEMA,
	status: "POST_HOC_EVALUATOR_REPAIR",
	blind: false,
	interpretation:
		"Post-hoc repair of an order-dependent exact-quote scorer (see contract observedDefect). " +
		"Neither retrieval arm was rerun: candidate sets are copied verbatim from the frozen v1 reports " +
		"and re-hashed unchanged; only exact-quote matching is recomputed with the source-bound interval " +
		"reconstruction from evaluateEvidenceCoverage. Not blind product evidence: modelCalls=0, network=false, retrievalCalls=0.",
	runId,
	createdAt: new Date().toISOString(),
	verdict: {
		label: verdictLabel,
		artifactConfirmed,
		trueQuoteRiskRemains,
		decision: {
			anyOldQuoteLossFixed: artifactConfirmed,
			oldQuoteLossesFixedToTie: oldLossToFixed.filter(
				(item) => item.correctedQuoteOutcome === "tie",
			),
			oldQuoteLossesFixedToWin: oldLossToFixed.filter(
				(item) => item.correctedQuoteOutcome === "win",
			),
			srExactEvidenceLossRemainingQuestionIds: srExactEvidenceLosses.map((item) => ({
				datasetId: item.datasetId,
				questionId: item.questionId,
			})),
			precedenceNote:
				"TRUE_QUOTE_RISK_REMAINS takes precedence over EVALUATOR_ARTIFACT_CONFIRMED; " +
				"both booleans are reported independently and may both be true.",
		},
		rework: {
			condition: reworkCondition,
			checks: {
				anyFrozenHashMismatch: false,
				spanCorpusVerified: true,
				candidateSetVerified,
				questionAlignment: candidateSetVerified,
				scope: scopeOk,
				tier: scopeOk,
				deterministic,
				outputNotOverwritten: true,
			},
		},
	},
	provenance: {
		contractPath,
		contractSha256: sha256(contractText),
		freezePath,
		freezeSha256: sha256(freezeText),
		batchCReport: {
			path: contract.frozenInputs.batchCReport.path,
			sha256: sha256(batchCReportText),
		},
		batchCGold: { path: contract.frozenInputs.batchCGold.path, sha256: sha256(batchCGoldText) },
		batchBReport: {
			path: contract.frozenInputs.batchBReport.path,
			sha256: sha256(batchBReportText),
		},
		batchBGold: { path: contract.frozenInputs.batchBGold.path, sha256: sha256(batchBGoldText) },
		spanCorpus: {
			path: contract.frozenInputs.spanCorpus.path,
			fileCount: spanCorpusDigest.fileCount,
			shellManifestSha256: spanCorpusDigest.shellManifestSha256,
		},
		implementationSha256: {
			evidenceCoverage: sha256(evidenceCoverageText),
			evidenceCoverageTests: sha256(evidenceCoverageTestsText),
			rescoreRunner: sha256(scriptText),
		},
		scriptPath,
		scriptSha256: sha256(scriptText),
		modelCalls: 0,
		network: false,
		retrievalCalls: 0,
	},
	checks: {
		frozenContractVerified: true,
		frozenFreezeVerified: true,
		frozenInputsVerified: true,
		frozenImplementationVerified: true,
		rescoreRunnerFrozen: true,
		spanCorpus: {
			path: spanCorpusDigest.rootRelativePath,
			fileCount: spanCorpusDigest.fileCount,
			expectedFileCount: EXPECTED_SPAN_FILE_COUNT,
			shellManifestSha256: spanCorpusDigest.shellManifestSha256,
			contractShellManifestSha256: contract.frozenInputs.spanCorpus.shellManifestSha256,
			verified:
				spanCorpusDigest.shellManifestSha256 ===
				contract.frozenInputs.spanCorpus.shellManifestSha256,
		},
		candidateSetIntegrity: {
			method:
				"candidateClaimIds/candidateSpanIds copied verbatim from the sha256-verified frozen report rows; no retrieval, no re-computation",
			verifiedUnchanged: candidateSetVerified,
			datasetHashes: {
				batchC: datasetHash(batchC),
				batchB: datasetHash(batchB),
			},
		},
		questionAlignment: {
			batchC: batchC.alignment,
			batchB: batchB.alignment,
		},
		scope: {
			value: SCOPE,
			tierFilter: `${TIER}_ONLY`,
			detail:
				"Batch C report contains S12/S29/S50 tiers; only S50 rows are rescorred because the frozen span corpus is S50. Batch B report is S50-only.",
			batchCSourceRowCount: recordArray(batchCReport.rows).length,
			batchCRescorredRowCount: batchC.rowCount,
			batchBRescorredRowCount: batchB.rowCount,
		},
		determinism: {
			checked: expectedDeterminismChecks > 0,
			deterministic,
			method: "every (question, arm) rescore computed twice and compared",
			checksRun: batchC.determinismChecks + batchB.determinismChecks,
			expectedChecks: expectedDeterminismChecks,
		},
		firstRunUniqueness: true,
		oldSourceMetricsVerbatim: true,
		oldTokenLatencyVerbatim: true,
		sourceComparisonUnchanged: true,
	},
	summaries: {
		evaluatorArtifact: {
			anyOldQuoteLossFixed: artifactConfirmed,
			note:
				"An old quote loss becomes a tie (or win) only when both arms already contained source-correct " +
				"contiguous evidence ranges under the fixed scorer, with all source metrics and candidate sets unchanged.",
			oldQuoteLossQuestionIds: oldLossToFixed.map((item) => ({
				datasetId: item.datasetId,
				questionId: item.questionId,
			})),
		},
		trueQuoteRisk: {
			anySrExactEvidenceLossRemains: trueQuoteRiskRemains,
			srExactEvidenceLossQuestionIds: srExactEvidenceLosses.map((item) => ({
				datasetId: item.datasetId,
				questionId: item.questionId,
				lostEvidenceCount: item.lostEvidenceKeys.length,
			})),
			note:
				"A remaining SR exact-evidence loss under source-bound interval reconstruction means the retrieval " +
				"risk is real, not only a scorer artifact.",
		},
		notBlindEvidence: true,
	},
	datasets: {
		batchC,
		batchB,
	},
	limitations: [
		"Revealed evaluator Gold makes this a post-hoc evaluator repair, not blind product evidence.",
		"Only exact-quote matching was recomputed; candidate sets, source metrics, token and latency metrics were copied verbatim from the frozen v1 reports and never recomputed.",
		"No retrieval function was called (retrievalCalls=0); candidate span/claim ids come from the frozen report rows only.",
		"Batch C S12/S29 rows are not rescorred: the frozen span corpus is the S50 workspace, and the rescore contract scopes rescoring to S50 for both datasets.",
		"Corrected quote wins/losses are computed on evidence keys (sourceId + normalized quote) rather than raw quote text; old quote wins/losses are reported verbatim from the frozen reports.",
	],
};
writeJsonExclusive(join(runRoot, "report.json"), report);
writeJsonExclusive(join(runRoot, "run-manifest.json"), {
	schemaVersion: MANIFEST_SCHEMA,
	runId,
	status: "POST_HOC_EVALUATOR_REPAIR",
	modelCalls: 0,
	network: false,
	retrievalCalls: 0,
	contractSha256: sha256(contractText),
	freezeSha256: sha256(freezeText),
	batchCReportSha256: sha256(batchCReportText),
	batchCGoldSha256: sha256(batchCGoldText),
	batchBReportSha256: sha256(batchBReportText),
	batchBGoldSha256: sha256(batchBGoldText),
	spanCorpusShellManifestSha256: spanCorpusDigest.shellManifestSha256,
	spanCorpusFileCount: spanCorpusDigest.fileCount,
	implementationSha256: {
		evidenceCoverage: sha256(evidenceCoverageText),
		evidenceCoverageTests: sha256(evidenceCoverageTestsText),
		rescoreRunner: sha256(scriptText),
	},
	scriptSha256: sha256(scriptText),
	reportSha256: sha256(`${JSON.stringify(report, null, 2)}\n`),
});
console.log(
	JSON.stringify(
		{
			runRoot,
			verdict: verdictLabel,
			artifactConfirmed,
			trueQuoteRiskRemains,
			datasets: {
				batchC: {
					questions: batchC.questionCount,
					rows: batchC.rowCount,
					candidateSetHash: datasetHash(batchC),
				},
				batchB: {
					questions: batchB.questionCount,
					rows: batchB.rowCount,
					candidateSetHash: datasetHash(batchB),
				},
			},
			spanCorpusShellManifestSha256: spanCorpusDigest.shellManifestSha256,
		},
		null,
		2,
	),
);

// ─── Dataset processing ─────────────────────────────────────────────────────

function processDataset(params: {
	datasetId: "batchC" | "batchB";
	report: JsonRecord;
	goldRows: JsonRecord[];
	spans: SourceSpan[];
	sourceReportPath: string;
	sourceReportSha256: string;
	sourceReportStatus: string;
	goldPath: string;
	goldSha256: string;
}): ProcessedDataset {
	const allRows = recordArray(params.report.rows);
	const s50Rows = allRows.filter((row) => requiredString(row, "tier") === TIER);
	if (s50Rows.length === 0) {
		throw new Error(`Fail-closed: no ${TIER} rows in ${params.sourceReportPath}`);
	}
	const questionIds = [...new Set(s50Rows.map((row) => requiredString(row, "questionId")))].sort();
	const goldIds = params.goldRows.map((row) => requiredString(row, "caseId")).sort();
	if (new Set(goldIds).size !== goldIds.length) {
		throw new Error(`Fail-closed: duplicate Gold caseId in ${params.datasetId}`);
	}
	if (JSON.stringify(questionIds) !== JSON.stringify(goldIds)) {
		throw new Error(
			`Fail-closed: ${params.datasetId} ${TIER} question/Gold alignment drifted — ` +
				`report has ${questionIds.length}, Gold has ${goldIds.length}`,
		);
	}

	const goldByCaseId = new Map(
		params.goldRows.map((row) => [requiredString(row, "caseId"), minimalGold(row)] as const),
	);

	// Old per-question SR-vs-L40 comparison copied verbatim from the frozen report.
	const oldComparison = extractOldComparison(params.report);
	const oldComparisonIds = oldComparison.map((row) => requiredString(row, "questionId")).sort();
	if (
		new Set(oldComparisonIds).size !== oldComparisonIds.length ||
		JSON.stringify(oldComparisonIds) !== JSON.stringify(questionIds)
	) {
		throw new Error(`Fail-closed: old comparison alignment drifted for ${params.datasetId}`);
	}

	const rowsByKey = new Map<string, JsonRecord>();
	for (const row of s50Rows) {
		const arm = requiredString(row, "arm");
		if (arm !== L40_ARM && arm !== SR_ARM) {
			throw new Error(`Fail-closed: unexpected arm ${arm} in ${params.datasetId}`);
		}
		const key = `${requiredString(row, "questionId")}/${arm}`;
		if (rowsByKey.has(key)) {
			throw new Error(`Fail-closed: duplicate report row ${params.datasetId}/${key}`);
		}
		rowsByKey.set(key, row);
	}
	if (s50Rows.length !== questionIds.length * 2 || rowsByKey.size !== s50Rows.length) {
		throw new Error(
			`Fail-closed: expected exactly two arm rows per question in ${params.datasetId}`,
		);
	}
	const reportChecks = recordValue(params.report.checks);
	const scopeTimeLeakage = recordValue(reportChecks.scopeTimeLeakage);
	const boundedBudgets = recordValue(reportChecks.boundedBudgets);
	const inputSafetyPass =
		reportChecks.uniqueRowCount === true &&
		reportChecks.staleIndexAcceptance === false &&
		scopeTimeLeakage.leak === false &&
		boundedBudgets.pass === true &&
		s50Rows.every(
			(row) =>
				stringArray(row.candidateScopeViolationIds).length === 0 &&
				stringArray(row.temporalExcludedCandidateIds).length === 0,
		);

	const arms = [L40_ARM, SR_ARM] as const;
	const oldArmCounts = new Map<string, { matched: number; required: number; allQuotes: number }>();
	for (const arm of arms) {
		oldArmCounts.set(arm, { matched: 0, required: 0, allQuotes: 0 });
	}

	const candidateSetRows: ProcessedDataset["candidateSetRows"] = [];
	const questions: ProcessedDataset["questions"] = [];
	let determinismChecks = 0;

	for (const questionId of questionIds) {
		const gold = goldByCaseId.get(questionId);
		if (!gold) throw new Error(`Fail-closed: missing Gold for ${questionId}`);
		const requirements = gold.requiredEvidence;
		const armRecords: Record<string, JsonRecord> = {};
		for (const arm of arms) {
			const row = rowsByKey.get(`${questionId}/${arm}`);
			if (!row) {
				throw new Error(`Fail-closed: missing ${questionId}/${arm} row in ${params.datasetId}`);
			}
			const claimIds = stringArray(row.candidateClaimIds);
			const spanIds = stringArray(row.candidateSpanIds);
			const claimIdsHash = sha256(JSON.stringify(claimIds));
			const spanIdsHash = sha256(JSON.stringify(spanIds));
			const combinedHash = sha256(`${claimIdsHash}\n${spanIdsHash}`);
			candidateSetRows.push({ questionId, arm, claimIdsHash, spanIdsHash, combinedHash });

			// Old per-arm fields copied verbatim (never recomputed).
			const old: JsonRecord = {
				tier: requiredString(row, "tier"),
				questionId,
				arm,
				candidateClaimCount: row.candidateClaimCount,
				candidateSourceCount: row.candidateSourceCount,
				candidateSpanCount: row.candidateSpanCount,
				candidateCharCount: row.candidateCharCount,
				candidateEstimatedTokens: row.candidateEstimatedTokens,
				candidateClaimIds: claimIds,
				candidateSourceIds: stringArray(row.candidateSourceIds),
				candidateSpanIds: spanIds,
				matchedSources: stringArray(row.matchedSources),
				missingSources: stringArray(row.missingSources),
				matchedQuotes: stringArray(row.matchedQuotes),
				missingQuotes: stringArray(row.missingQuotes),
				matchedSourceCount: row.matchedSourceCount,
				requiredSourceCount: row.requiredSourceCount,
				matchedQuoteCount: row.matchedQuoteCount,
				requiredQuoteCount: row.requiredQuoteCount,
				candidateRequiredSourceRecall: row.candidateRequiredSourceRecall,
				candidateRequiredEvidenceQuoteRecall: row.candidateRequiredEvidenceQuoteRecall,
				retrievalMilliseconds: row.retrievalMilliseconds,
				elapsedMilliseconds: row.elapsedMilliseconds,
			};

			// Corrected exact-quote scoring (twice, deterministic).
			const first = evaluateEvidenceCoverage(spans, spanIds, requirements);
			const second = evaluateEvidenceCoverage(spans, spanIds, requirements);
			if (JSON.stringify(first) !== JSON.stringify(second)) {
				throw new Error(
					`Fail-closed: non-deterministic rescore for ${params.datasetId}/${questionId}/${arm}`,
				);
			}
			determinismChecks += 1;
			const corrected: JsonRecord = {
				matchedEvidenceKeys: first.matchedEvidenceKeys,
				missingEvidenceKeys: first.missingEvidenceKeys,
				matchedCount: first.matchedCount,
				requiredCount: first.requiredCount,
				recall: first.recall,
			};
			armRecords[arm] = { old, corrected, candidateSetHash: combinedHash };

			const counts = oldArmCounts.get(arm);
			if (counts) {
				counts.matched += Number(row.matchedQuoteCount ?? 0);
				counts.required += Number(row.requiredQuoteCount ?? 0);
				if (
					Number(row.requiredQuoteCount ?? 0) > 0 &&
					Number(row.matchedQuoteCount ?? 0) === Number(row.requiredQuoteCount ?? 0)
				) {
					counts.allQuotes += 1;
				}
			}
		}

		// Corrected quote comparison: source fields verbatim from old comparison,
		// quote fields recomputed on evidence keys and cross-checked below.
		const oldPerQuestion = oldComparison.find((entry) => entry.questionId === questionId);
		if (!oldPerQuestion) {
			throw new Error(
				`Fail-closed: missing old comparison row for ${params.datasetId}/${questionId}`,
			);
		}
		const correctedComparison = correctedQuoteComparison(oldPerQuestion, armRecords);
		assertSourceFieldsUnchanged(oldPerQuestion, correctedComparison, params.datasetId, questionId);

		const oldQuoteOutcome = String(oldPerQuestion.quoteOutcome ?? "unknown");
		const newQuoteOutcome = String(correctedComparison.correctedQuoteOutcome);
		questions.push({
			questionId,
			tier: TIER,
			arms: armRecords,
			correctedComparison,
			outcomeChange: {
				oldQuoteOutcome,
				correctedQuoteOutcome: newQuoteOutcome,
				quoteOutcomeChanged: oldQuoteOutcome !== newQuoteOutcome,
				oldSourceOutcome: oldPerQuestion.sourceOutcome,
				sourceOutcomeUnchanged: true,
				description:
					oldQuoteOutcome === newQuoteOutcome
						? "unchanged"
						: `${oldQuoteOutcome} -> ${newQuoteOutcome}`,
			},
		});
	}

	const aggregate = arms.map((arm) => {
		const counts = oldArmCounts.get(arm);
		const matched = counts?.matched ?? 0;
		const required = counts?.required ?? 0;
		const correctedMatched = questions.reduce(
			(total, question) => total + Number(correctedField(question.arms[arm], "matchedCount") ?? 0),
			0,
		);
		const correctedRequired = questions.reduce(
			(total, question) => total + Number(correctedField(question.arms[arm], "requiredCount") ?? 0),
			0,
		);
		const correctedAllEvidence = questions.filter(
			(question) =>
				Number(correctedField(question.arms[arm], "requiredCount") ?? 0) > 0 &&
				stringArray(correctedField(question.arms[arm], "missingEvidenceKeys")).length === 0,
		).length;
		// Old aggregate recall is read verbatim from the frozen report summaries
		// and cross-checked against the verbatim per-row counts.
		const oldSummaryRecall = readOldSummaryRecall(params.report, arm);
		const computedOldRecall = required === 0 ? null : matched / required;
		if (oldSummaryRecall !== null && computedOldRecall !== null) {
			if (Math.abs(round(computedOldRecall) - oldSummaryRecall) > 0.0001) {
				throw new Error(
					`Fail-closed: ${params.datasetId}/${arm} old aggregate recall drift ` +
						`(summaries ${oldSummaryRecall} vs rows ${computedOldRecall})`,
				);
			}
		}
		return {
			arm,
			questions: questions.length,
			oldQuoteRecall: oldSummaryRecall,
			correctedQuoteRecall:
				correctedRequired === 0 ? null : round(correctedMatched / correctedRequired),
			oldMatchedQuoteCount: matched,
			oldRequiredQuoteCount: required,
			correctedMatchedEvidenceCount: correctedMatched,
			correctedRequiredEvidenceCount: correctedRequired,
			oldQuestionsWithAllQuotes: counts?.allQuotes ?? 0,
			correctedQuestionsWithAllEvidence: correctedAllEvidence,
		};
	});

	const combinedHashes = candidateSetRows
		.map((row) => `${row.questionId}/${row.arm}\u0000${row.combinedHash}`)
		.sort()
		.join("\n");

	return {
		datasetId: params.datasetId,
		sourceReport: {
			path: params.sourceReportPath,
			sha256: params.sourceReportSha256,
			status: params.sourceReportStatus,
			verified: true,
		},
		gold: { path: params.goldPath, sha256: params.goldSha256, verified: true },
		tier: TIER,
		questionCount: questionIds.length,
		rowCount: s50Rows.length,
		candidateSetHash: sha256(combinedHashes),
		candidateSetRows,
		aggregate,
		oldComparison,
		questions,
		alignment: {
			pass: true,
			detail: `${s50Rows.length} rows / ${questionIds.length} questions aligned with ${params.goldRows.length} Gold caseIds`,
		},
		inputSafetyPass,
		determinismChecks,
	};
}

function extractOldComparison(report: JsonRecord): JsonRecord[] {
	const s50Comparisons = recordValue(report.s50Comparisons);
	const comparison = recordValue(s50Comparisons.sourceRoutedVsL40);
	return recordArray(comparison.perQuestion).map((entry) => ({ ...entry }));
}

function correctedQuoteComparison(
	old: JsonRecord,
	armRecords: Record<string, JsonRecord>,
): JsonRecord {
	const routedKeys = stringArray(correctedField(armRecords[SR_ARM], "matchedEvidenceKeys"));
	const baselineKeys = stringArray(correctedField(armRecords[L40_ARM], "matchedEvidenceKeys"));
	const routed = new Set(routedKeys);
	const baseline = new Set(baselineKeys);
	const gained = routedKeys.filter((key) => !baseline.has(key));
	const lost = baselineKeys.filter((key) => !routed.has(key));
	const quoteDelta = routedKeys.length - baselineKeys.length;
	const quoteOutcome = lost.length > 0 ? "loss" : gained.length > 0 ? "win" : "tie";
	return {
		questionId: old.questionId,
		sourceDelta: old.sourceDelta,
		gainedSources: old.gainedSources,
		lostSources: old.lostSources,
		sourceOutcome: old.sourceOutcome,
		tokenRatio: old.tokenRatio,
		routedMatchedSources: old.routedMatchedSources,
		baselineMatchedSources: old.baselineMatchedSources,
		correctedQuoteDelta: quoteDelta,
		correctedQuoteOutcome: quoteOutcome,
		correctedGainedQuoteKeys: gained,
		correctedLostQuoteKeys: lost,
		correctedRoutedMatchedQuotes: routedKeys.length,
		correctedBaselineMatchedQuotes: baselineKeys.length,
	};
}

function assertSourceFieldsUnchanged(
	old: JsonRecord,
	corrected: JsonRecord,
	datasetId: string,
	questionId: string,
): void {
	for (const key of [
		"sourceDelta",
		"gainedSources",
		"lostSources",
		"sourceOutcome",
		"tokenRatio",
		"routedMatchedSources",
		"baselineMatchedSources",
	]) {
		if (JSON.stringify(corrected[key]) !== JSON.stringify(old[key])) {
			throw new Error(
				`Fail-closed: source metric changed during rescore ${datasetId}/${questionId} field ${key}`,
			);
		}
	}
}

function readOldSummaryRecall(report: JsonRecord, arm: string): number | null {
	const summaries = recordArray(report.summaries);
	const summary = summaries.find((entry) => entry.tier === TIER && entry.arm === arm);
	const recall = summary?.candidateRequiredEvidenceQuoteRecall;
	if (typeof recall !== "number" || !Number.isFinite(recall)) return null;
	return recall;
}

// ─── Helpers (JSON / hash / span corpus) ────────────────────────────────────

function minimalGold(row: JsonRecord): MinimalGold {
	return {
		caseId: requiredString(row, "caseId"),
		requiredEvidence: recordArray(row.requiredEvidence).map((item) => ({
			sourceId: requiredString(item, "sourceId"),
			exactQuote: requiredString(item, "exactQuote"),
		})),
	};
}

function computeSpanCorpusDigest(rootRelativePath: string): SpanCorpusDigest {
	const rootAbsolutePath = resolve(projectRoot, rootRelativePath);
	const files = readdirSync(rootAbsolutePath)
		.filter((name) => name.endsWith(SPAN_FILE_SUFFIX))
		.sort();
	const lines = files.map((name) => {
		const content = readFileSync(join(rootAbsolutePath, name));
		return `${sha256(content)}  ${rootRelativePath}/${name}`;
	});
	const manifestText = `${lines.join("\n")}\n`;
	return {
		rootRelativePath,
		fileCount: files.length,
		shellManifestSha256: sha256(manifestText),
	};
}

function loadSpans(rootRelativePath: string): SourceSpan[] {
	const rootAbsolutePath = resolve(projectRoot, rootRelativePath);
	const files = readdirSync(rootAbsolutePath)
		.filter((name) => name.endsWith(SPAN_FILE_SUFFIX))
		.sort();
	const spans: SourceSpan[] = [];
	const seen = new Set<string>();
	for (const name of files) {
		for (const line of readFileSync(join(rootAbsolutePath, name), "utf8").split(/\r?\n/u)) {
			if (line.trim().length === 0) continue;
			const span = JSON.parse(line) as SourceSpan;
			if (seen.has(span.id)) {
				throw new Error(`Fail-closed: duplicate persisted span id in corpus: ${span.id}`);
			}
			seen.add(span.id);
			spans.push(span);
		}
	}
	return spans;
}

function verifyFreeze(
	freeze: RescoreFreeze,
	ctx: {
		contractPath: string;
		contractText: string;
		batchCReportPath: string;
		batchCReportText: string;
		batchBReportPath: string;
		batchBReportText: string;
		batchCGoldPath: string;
		batchCGoldText: string;
		batchBGoldPath: string;
		batchBGoldText: string;
		spanCorpus: RescoreContract["frozenInputs"]["spanCorpus"];
		spanCorpusDigest: SpanCorpusDigest;
		evidenceCoveragePath: string;
		evidenceCoverageText: string;
		evidenceCoverageTestsPath: string;
		evidenceCoverageTestsText: string;
		scriptPath: string;
		scriptText: string;
	},
): void {
	assertResolved(freeze.contract.path, ctx.contractPath, "freeze contract");
	assertSha256(ctx.contractText, freeze.contract.sha256, "contract (vs freeze)");

	assertResolved(freeze.inputs.batchCReport.path, ctx.batchCReportPath, "freeze batch C report");
	assertSha256(
		ctx.batchCReportText,
		freeze.inputs.batchCReport.sha256,
		"batch C report (vs freeze)",
	);
	assertResolved(freeze.inputs.batchBReport.path, ctx.batchBReportPath, "freeze batch B report");
	assertSha256(
		ctx.batchBReportText,
		freeze.inputs.batchBReport.sha256,
		"batch B report (vs freeze)",
	);
	assertResolved(freeze.inputs.batchCGold.path, ctx.batchCGoldPath, "freeze batch C Gold");
	assertSha256(ctx.batchCGoldText, freeze.inputs.batchCGold.sha256, "batch C Gold (vs freeze)");
	assertResolved(freeze.inputs.batchBGold.path, ctx.batchBGoldPath, "freeze batch B Gold");
	assertSha256(ctx.batchBGoldText, freeze.inputs.batchBGold.sha256, "batch B Gold (vs freeze)");

	if (freeze.inputs.spanCorpus.path !== ctx.spanCorpus.path) {
		throw new Error(`Freeze span corpus path drift: ${freeze.inputs.spanCorpus.path}`);
	}
	if (freeze.inputs.spanCorpus.fileCount !== ctx.spanCorpus.fileCount) {
		throw new Error(`Freeze span corpus fileCount drift: ${freeze.inputs.spanCorpus.fileCount}`);
	}
	if (freeze.inputs.spanCorpus.shellManifestSha256 !== ctx.spanCorpus.shellManifestSha256) {
		throw new Error(
			`Freeze span corpus shell manifest drift: ${freeze.inputs.spanCorpus.shellManifestSha256}`,
		);
	}
	assertDigestEqual(
		ctx.spanCorpusDigest.shellManifestSha256,
		freeze.inputs.spanCorpus.shellManifestSha256,
		"span corpus shell manifest (vs freeze)",
	);

	assertResolved(
		freeze.implementation.evidenceCoverage.path,
		ctx.evidenceCoveragePath,
		"freeze evidence-coverage.ts",
	);
	assertSha256(
		ctx.evidenceCoverageText,
		freeze.implementation.evidenceCoverage.sha256,
		"evidence-coverage.ts (vs freeze)",
	);
	assertResolved(
		freeze.implementation.evidenceCoverageTests.path,
		ctx.evidenceCoverageTestsPath,
		"freeze evidence-coverage.test.ts",
	);
	assertSha256(
		ctx.evidenceCoverageTestsText,
		freeze.implementation.evidenceCoverageTests.sha256,
		"evidence-coverage.test.ts (vs freeze)",
	);
	assertResolved(freeze.implementation.rescoreRunner.path, ctx.scriptPath, "freeze rescore runner");
	assertSha256(
		ctx.scriptText,
		freeze.implementation.rescoreRunner.sha256,
		"rescore runner (vs freeze)",
	);
}

function assertResolved(freezePathValue: string, expectedPath: string, label: string): void {
	if (resolve(projectRoot, freezePathValue) !== expectedPath) {
		throw new Error(`${label} path drift: ${freezePathValue}`);
	}
}

function suggestedFreeze(params: {
	contractText: string;
	batchCReportText: string;
	batchBReportText: string;
	batchCGoldText: string;
	batchBGoldText: string;
	evidenceCoverageText: string;
	evidenceCoverageTestsText: string;
	scriptText: string;
	spanCorpus: RescoreContract["frozenInputs"]["spanCorpus"];
	computedShellManifestSha256: string;
}): JsonRecord {
	return {
		schemaVersion: FREEZE_SCHEMA,
		status: "FROZEN_BEFORE_FIRST_RESCORE",
		frozenAt: new Date().toISOString(),
		contract: {
			path: "experiments/goal3/goal3-evidence-coverage-rescore-contract-v1.json",
			sha256: sha256(params.contractText),
		},
		inputs: {
			batchCReport: {
				path: contract.frozenInputs.batchCReport.path,
				sha256: sha256(params.batchCReportText),
			},
			batchCGold: {
				path: contract.frozenInputs.batchCGold.path,
				sha256: sha256(params.batchCGoldText),
			},
			batchBReport: {
				path: contract.frozenInputs.batchBReport.path,
				sha256: sha256(params.batchBReportText),
			},
			batchBGold: {
				path: contract.frozenInputs.batchBGold.path,
				sha256: sha256(params.batchBGoldText),
			},
			spanCorpus: {
				path: params.spanCorpus.path,
				fileCount: params.spanCorpus.fileCount,
				shellManifestSha256: params.computedShellManifestSha256,
			},
		},
		implementation: {
			evidenceCoverage: {
				path: "src/retrieval/evidence-coverage.ts",
				sha256: sha256(params.evidenceCoverageText),
			},
			evidenceCoverageTests: {
				path: "src/retrieval/evidence-coverage.test.ts",
				sha256: sha256(params.evidenceCoverageTestsText),
			},
			rescoreRunner: {
				path: "scripts/rescore-goal3-evidence-coverage.ts",
				sha256: sha256(params.scriptText),
			},
		},
		verification: {
			lint: "PASS: biome check src scripts",
			typecheck: "PASS: tsc --noEmit and tsc --noEmit -p tsconfig.scripts.json",
		},
		prohibitions: contract.prohibitions,
	};
}

function recordValue(value: unknown): JsonRecord {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	return value as JsonRecord;
}

function correctedField(armRecord: JsonRecord, key: string): unknown {
	return recordValue(recordValue(armRecord).corrected)[key];
}

function recordArray(value: unknown): JsonRecord[] {
	return Array.isArray(value) ? value.map(recordValue) : [];
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

function assertDigestEqual(actual: string, expected: string, label: string): void {
	if (actual !== expected) {
		throw new Error(`Fail-closed: ${label} mismatch (expected ${expected}, got ${actual})`);
	}
}

function writeJsonExclusive(path: string, value: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, {
		encoding: "utf8",
		flag: "wx",
	});
}

function sha256(value: string | Buffer): string {
	return createHash("sha256").update(value).digest("hex");
}

function round(value: number): number {
	return Math.round(value * 1000) / 1000;
}
