/**
 * Post-hoc repair for the immutable EPSI v1 report's combined-summary filter.
 * No retrieval, Gold, model, network, Relation or Context Pack access.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type JsonRecord = Record<string, unknown>;
type ArmId = "L40_STRONG" | "EPSI40";

interface FrozenPointer {
	path: string;
	sha256: string;
}

interface RescoreContract {
	schemaVersion: string;
	frozenInputs: {
		sourceReport: FrozenPointer;
		sourceManifest: FrozenPointer;
		sourceContract: FrozenPointer;
		sourceFreeze: FrozenPointer;
	};
	fixed: {
		network: boolean;
		modelCalls: number;
		retrievalCalls: number;
		expectedRows: number;
		expectedQuestions: number;
		arms: ArmId[];
		tokenCeilingRatio: number;
	};
}

interface RescoreFreeze {
	schemaVersion: string;
	status: string;
	contract: FrozenPointer;
	implementation: { runner: FrozenPointer };
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const scriptPath = fileURLToPath(import.meta.url);
const contractPath = join(
	projectRoot,
	"experiments",
	"goal3",
	"goal3-epsi-aggregate-rescore-contract-v1.json",
);
const freezePath = join(
	projectRoot,
	"experiments",
	"goal3",
	"goal3-epsi-aggregate-rescore-freeze-v1.json",
);
const runId = process.env.WGE_GOAL3_EPSI_RESCORE_RUN_ID ?? "epsi-aggregate-rescore-v1";
const runRoot = join(projectRoot, "experiments", "goal3", "epsi-aggregate-rescore-runs", runId);
if (existsSync(runRoot)) throw new Error(`Refusing to overwrite EPSI rescore run: ${runRoot}`);

const contractText = readFileSync(contractPath, "utf8");
if (!existsSync(freezePath)) {
	throw new Error(
		`Fail-closed: EPSI aggregate rescore freeze not found. Create ${freezePath} with contract sha256=${sha256(contractText)} and runner sha256=${sha256(readFileSync(scriptPath, "utf8"))}.`,
	);
}
const freezeText = readFileSync(freezePath, "utf8");
const contract = JSON.parse(contractText) as RescoreContract;
const freeze = JSON.parse(freezeText) as RescoreFreeze;
assertPointer(freeze.contract, contractPath, contractText, "rescore contract");
assertPointer(
	freeze.implementation.runner,
	scriptPath,
	readFileSync(scriptPath, "utf8"),
	"rescore runner",
);

const frozenTexts = Object.fromEntries(
	Object.entries(contract.frozenInputs).map(([key, pointer]) => {
		const absolutePath = resolve(projectRoot, pointer.path);
		const text = readFileSync(absolutePath, "utf8");
		assertSha256(text, pointer.sha256, `frozen ${key}`);
		return [key, text];
	}),
) as Record<keyof RescoreContract["frozenInputs"], string>;

confirmFixedContract(contract);
const sourceReport = recordValue(JSON.parse(frozenTexts.sourceReport));
const sourceManifest = recordValue(JSON.parse(frozenTexts.sourceManifest));
if (sourceManifest.reportSha256 !== contract.frozenInputs.sourceReport.sha256) {
	throw new Error("Source manifest reportSha256 does not match frozen source report");
}
const rows = recordArray(sourceReport.rows);
const rowKeys = new Set(rows.map(rowKey));
const questionIds = unique(rows.map((row) => requiredString(row, "questionId")));
const rowAlignmentPass =
	rows.length === contract.fixed.expectedRows &&
	rowKeys.size === rows.length &&
	questionIds.length === contract.fixed.expectedQuestions &&
	questionIds.every((questionId) =>
		contract.fixed.arms.every((arm) =>
			rowKeys.has(`${requiredDatasetForQuestion(rows, questionId)}/${questionId}/${arm}`),
		),
	);
if (!rowAlignmentPass) throw new Error("Frozen source report row pairing/alignment failed");

const candidateRows = rows
	.map((row) => ({
		key: rowKey(row),
		claimIds: stringArray(row.candidateClaimIds),
		spanIds: stringArray(row.candidateSpanIds),
		sourceIds: stringArray(row.candidateSourceIds),
	}))
	.sort((left, right) => left.key.localeCompare(right.key));
const candidateSetHash = sha256(JSON.stringify(candidateRows));

const correctedSummaries = [
	summarize(rows, "combined", "L40_STRONG"),
	summarize(rows, "combined", "EPSI40"),
	summarize(rows, "batchC", "L40_STRONG"),
	summarize(rows, "batchC", "EPSI40"),
	summarize(rows, "batchB", "L40_STRONG"),
	summarize(rows, "batchB", "EPSI40"),
];
const sourceDatasets = recordValue(sourceReport.datasets);
const batchCSummaries = recordArray(recordValue(sourceDatasets.batchC).summaries);
const batchBSummaries = recordArray(recordValue(sourceDatasets.batchB).summaries);
const batchCSummaryStable = semanticEqual(
	correctedSummaries.filter((row) => row.datasetId === "batchC"),
	batchCSummaries,
);
const batchBSummaryStable = semanticEqual(
	correctedSummaries.filter((row) => row.datasetId === "batchB"),
	batchBSummaries,
);

const correctedComparison = compareRows(rows, questionIds);
const sourceCombined = recordValue(sourceReport.combined);
const sourceComparison = recordValue(sourceCombined.comparison);
const combinedComparisonStable = semanticEqual(correctedComparison, sourceComparison);
const sourceUnion = recordValue(sourceReport.evidenceUnionPreservation);
const unionPreserved = sourceUnion.baselineEvidenceSpanUnionPreserved === true;
const sourceChecks = recordValue(sourceReport.checks);
const budgetsPass = recordValue(sourceChecks.boundedBudgets).pass === true;
const safetyPass =
	rowAlignmentPass &&
	batchCSummaryStable &&
	batchBSummaryStable &&
	combinedComparisonStable &&
	unionPreserved &&
	budgetsPass;
const verdict = computeVerdict(
	correctedSummaries,
	correctedComparison,
	safetyPass,
	contract.fixed.tokenCeilingRatio,
);

const report = {
	schemaVersion: "wge-goal3-epsi-aggregate-rescore-report/v1",
	status: "POST_HOC_REPORT_REPAIR",
	blind: false,
	runId,
	createdAt: new Date().toISOString(),
	verdict,
	provenance: {
		contractPath,
		contractSha256: sha256(contractText),
		freezePath,
		freezeSha256: sha256(freezeText),
		sourceReport: contract.frozenInputs.sourceReport,
		sourceManifest: contract.frozenInputs.sourceManifest,
		runnerPath: scriptPath,
		runnerSha256: sha256(readFileSync(scriptPath, "utf8")),
		network: false,
		modelCalls: 0,
		retrievalCalls: 0,
	},
	checks: {
		frozenInputsVerified: true,
		rowAlignmentPass,
		candidateSetsCopiedUnchanged: true,
		candidateSetHash,
		batchCSummaryStable,
		batchBSummaryStable,
		combinedComparisonStable,
		unionPreserved,
		budgetsPass,
		firstRunUniqueness: true,
	},
	corrected: {
		summaries: correctedSummaries,
		combinedComparison: correctedComparison,
	},
	defectRepair: {
		oldCombinedSummaries: recordArray(sourceCombined.summaries),
		oldCombinedQuestions: recordArray(sourceCombined.summaries).map((row) => row.questions),
		correctedCombinedQuestions: correctedSummaries
			.filter((row) => row.datasetId === "combined")
			.map((row) => row.questions),
		candidateRowsRecomputed: false,
		retrievalRerun: false,
	},
	limitations: [
		"This is a post-hoc aggregation repair on revealed Dev/Regression data, not blind product evidence.",
		"No candidate row, Gold match or cost row was changed; only summaries and the dependent verdict were recomputed.",
	],
};

writeJsonExclusive(join(runRoot, "report.json"), report);
writeJsonExclusive(join(runRoot, "run-manifest.json"), {
	schemaVersion: "wge-goal3-epsi-aggregate-rescore-run-manifest/v1",
	runId,
	status: "POST_HOC_REPORT_REPAIR",
	contractSha256: sha256(contractText),
	freezeSha256: sha256(freezeText),
	sourceReportSha256: sha256(frozenTexts.sourceReport),
	candidateSetHash,
	runnerSha256: sha256(readFileSync(scriptPath, "utf8")),
	reportSha256: sha256(`${JSON.stringify(report, null, 2)}\n`),
	network: false,
	modelCalls: 0,
	retrievalCalls: 0,
});
console.log(
	JSON.stringify({ runRoot, verdict, checks: report.checks, correctedSummaries }, null, 2),
);

function summarize(rowsValue: JsonRecord[], datasetId: string, arm: ArmId): JsonRecord {
	const selected = rowsValue.filter(
		(row) => row.arm === arm && (datasetId === "combined" || row.datasetId === datasetId),
	);
	const requiredSources = sum(selected.map((row) => Number(row.requiredSourceCount)));
	const matchedSources = sum(selected.map((row) => Number(row.matchedSourceCount)));
	const requiredEvidence = sum(selected.map((row) => Number(row.requiredEvidenceCount)));
	const matchedEvidence = sum(selected.map((row) => Number(row.matchedEvidenceCount)));
	return {
		datasetId,
		arm,
		questions: selected.length,
		candidateRequiredSourceRecall:
			requiredSources === 0 ? null : round(matchedSources / requiredSources),
		sourceBoundExactEvidenceRecall:
			requiredEvidence === 0 ? null : round(matchedEvidence / requiredEvidence),
		questionsWithAllRequiredSources: selected.filter(
			(row) =>
				Number(row.requiredSourceCount) > 0 &&
				Number(row.matchedSourceCount) === Number(row.requiredSourceCount),
		).length,
		questionsWithAllRequiredEvidence: selected.filter(
			(row) =>
				Number(row.requiredEvidenceCount) > 0 &&
				Number(row.matchedEvidenceCount) === Number(row.requiredEvidenceCount),
		).length,
		averageCandidateClaimCount: round(
			average(selected.map((row) => Number(row.candidateClaimCount))),
		),
		averageCandidateSourceCount: round(
			average(selected.map((row) => Number(row.candidateSourceCount))),
		),
		averageEvidenceClosureTokens: round(
			average(selected.map((row) => Number(row.candidateEstimatedTokens))),
		),
		averageLexicalCandidateRecordsLoaded: round(
			average(selected.map((row) => Number(row.lexicalCandidateRecordsLoaded))),
		),
		averageRetrievalMilliseconds: round(
			average(selected.map((row) => Number(row.retrievalMilliseconds))),
		),
		totalNovelSourcesConsidered: sum(
			selected.map((row) => Number(row.epsiNovelSourcesConsidered ?? 0)),
		),
		totalAcceptedInsertions: sum(selected.map((row) => Number(row.epsiAcceptedInsertions ?? 0))),
		totalRejectedNoSafeEviction: sum(
			selected.map((row) => Number(row.epsiRejectedNoSafeEviction ?? 0)),
		),
	};
}

function compareRows(rowsValue: JsonRecord[], questionIdsValue: string[]): JsonRecord {
	const byKey = new Map(rowsValue.map((row) => [`${row.questionId}/${row.arm}`, row] as const));
	const perQuestion = questionIdsValue.map((questionId) => {
		const epsi = byKey.get(`${questionId}/EPSI40`);
		const l40 = byKey.get(`${questionId}/L40_STRONG`);
		if (!epsi || !l40) throw new Error(`Missing paired rows for ${questionId}`);
		const epsiSources = new Set(stringArray(epsi.matchedSources));
		const l40Sources = new Set(stringArray(l40.matchedSources));
		const epsiEvidence = new Set(stringArray(epsi.matchedEvidenceKeys));
		const l40Evidence = new Set(stringArray(l40.matchedEvidenceKeys));
		const gainedSources = [...epsiSources].filter((item) => !l40Sources.has(item));
		const lostSources = [...l40Sources].filter((item) => !epsiSources.has(item));
		const gainedEvidenceKeys = [...epsiEvidence].filter((item) => !l40Evidence.has(item));
		const lostEvidenceKeys = [...l40Evidence].filter((item) => !epsiEvidence.has(item));
		const l40Tokens = Number(l40.candidateEstimatedTokens);
		return {
			datasetId: "combined",
			questionId,
			sourceDelta: epsiSources.size - l40Sources.size,
			evidenceDelta: epsiEvidence.size - l40Evidence.size,
			gainedSources,
			lostSources,
			gainedEvidenceKeys,
			lostEvidenceKeys,
			sourceOutcome: lostSources.length > 0 ? "loss" : gainedSources.length > 0 ? "win" : "tie",
			evidenceOutcome:
				lostEvidenceKeys.length > 0 ? "loss" : gainedEvidenceKeys.length > 0 ? "win" : "tie",
			tokenRatio: l40Tokens === 0 ? null : round(Number(epsi.candidateEstimatedTokens) / l40Tokens),
			unionPreserved: epsi.baselineEvidenceSpanUnionPreserved === true,
			epsiNovelSourcesConsidered: Number(epsi.epsiNovelSourcesConsidered ?? 0),
			epsiAcceptedInsertions: Number(epsi.epsiAcceptedInsertions ?? 0),
			epsiRejectedNoSafeEviction: Number(epsi.epsiRejectedNoSafeEviction ?? 0),
			epsiCandidateCount: Number(epsi.candidateClaimCount),
			l40CandidateCount: Number(l40.candidateClaimCount),
			epsiMatchedSources: epsiSources.size,
			l40MatchedSources: l40Sources.size,
			epsiMatchedEvidence: epsiEvidence.size,
			l40MatchedEvidence: l40Evidence.size,
		};
	});
	const epsiRows = rowsValue.filter((row) => row.arm === "EPSI40");
	const l40Rows = rowsValue.filter((row) => row.arm === "L40_STRONG");
	const epsiTokens = average(epsiRows.map((row) => Number(row.candidateEstimatedTokens)));
	const l40Tokens = average(l40Rows.map((row) => Number(row.candidateEstimatedTokens)));
	const epsiLoaded = average(epsiRows.map((row) => Number(row.lexicalCandidateRecordsLoaded)));
	const l40Loaded = average(l40Rows.map((row) => Number(row.lexicalCandidateRecordsLoaded)));
	const sourceWins = perQuestion.filter((row) => row.sourceOutcome === "win").length;
	const sourceLosses = perQuestion.filter((row) => row.sourceOutcome === "loss").length;
	const evidenceWins = perQuestion.filter((row) => row.evidenceOutcome === "win").length;
	const evidenceLosses = perQuestion.filter((row) => row.evidenceOutcome === "loss").length;
	return {
		datasetId: "combined",
		perQuestion,
		sourceWins,
		sourceLosses,
		sourceTies: perQuestion.length - sourceWins - sourceLosses,
		evidenceWins,
		evidenceLosses,
		evidenceTies: perQuestion.length - evidenceWins - evidenceLosses,
		anyStrictSourceWin: sourceWins > 0,
		anySourceLoss: sourceLosses > 0,
		anyEvidenceLoss: evidenceLosses > 0,
		anyEvidenceWin: evidenceWins > 0,
		matchedSourceDelta: round(sum(perQuestion.map((row) => Number(row.sourceDelta)))),
		matchedEvidenceDelta: round(sum(perQuestion.map((row) => Number(row.evidenceDelta)))),
		unionPreserved: perQuestion.every((row) => row.unionPreserved === true),
		averageTokenRatio: l40Tokens === 0 ? null : round(epsiTokens / l40Tokens),
		tokenCeilingPass: l40Tokens === 0 ? true : epsiTokens <= l40Tokens * 1.1,
		epsiAverageTokens: round(epsiTokens),
		l40AverageTokens: round(l40Tokens),
		epsiAverageLexicalRecordsLoaded: round(epsiLoaded),
		l40AverageLexicalRecordsLoaded: round(l40Loaded),
		anyCostAdvantage: epsiTokens < l40Tokens || epsiLoaded < l40Loaded,
		tokenAdvantage: epsiTokens < l40Tokens,
		loadedRecordAdvantage: epsiLoaded < l40Loaded,
	};
}

function computeVerdict(
	summaries: JsonRecord[],
	comparison: JsonRecord,
	safetyPass: boolean,
	tokenCeilingRatio: number,
): JsonRecord {
	const l40 = summaries.find((row) => row.datasetId === "combined" && row.arm === "L40_STRONG");
	const epsi = summaries.find((row) => row.datasetId === "combined" && row.arm === "EPSI40");
	if (!l40 || !epsi) throw new Error("Corrected combined summaries missing");
	const sourceWins = Number(comparison.sourceWins);
	const sourceLosses = Number(comparison.sourceLosses);
	const evidenceLosses = Number(comparison.evidenceLosses);
	const tokenRatio = Number(comparison.averageTokenRatio);
	const costAdvantage = comparison.anyCostAdvantage === true;
	const rework =
		!safetyPass ||
		sourceLosses > 0 ||
		evidenceLosses > 0 ||
		comparison.unionPreserved !== true ||
		tokenRatio > tokenCeilingRatio;
	const fullPass = !rework && sourceWins > 0 && costAdvantage;
	const label = rework
		? "REWORK"
		: fullPass
			? "CORRECTED_FULL_PASS"
			: sourceWins > 0
				? "CORRECTED_SAFE_DISCOVERY_COST_UNPROVEN"
				: "CORRECTED_SAFE_BUT_NO_DISCOVERY";
	return {
		label,
		rework,
		fullPass,
		strictSourceWins: sourceWins,
		zeroSourceLosses: sourceLosses === 0,
		zeroExactEvidenceLosses: evidenceLosses === 0,
		baselineEvidenceSpanUnionPreserved: comparison.unionPreserved === true,
		tokenCeilingPass: tokenRatio <= tokenCeilingRatio,
		anyCostAdvantage: costAdvantage,
		correctedRequiredSourceRecall: epsi.candidateRequiredSourceRecall,
		l40RequiredSourceRecall: l40.candidateRequiredSourceRecall,
		correctedExactEvidenceRecall: epsi.sourceBoundExactEvidenceRecall,
		l40ExactEvidenceRecall: l40.sourceBoundExactEvidenceRecall,
		averageTokenRatio: comparison.averageTokenRatio,
	};
}

function requiredDatasetForQuestion(rowsValue: JsonRecord[], questionId: string): string {
	const datasets = unique(
		rowsValue
			.filter((row) => row.questionId === questionId)
			.map((row) => requiredString(row, "datasetId")),
	);
	if (datasets.length !== 1 || !["batchC", "batchB"].includes(datasets[0])) {
		throw new Error(`Invalid dataset identity for ${questionId}: ${datasets.join(",")}`);
	}
	return datasets[0];
}

function rowKey(row: JsonRecord): string {
	return `${requiredString(row, "datasetId")}/${requiredString(row, "questionId")}/${requiredString(row, "arm")}`;
}

function confirmFixedContract(contractValue: RescoreContract): void {
	const fixed = contractValue.fixed;
	if (
		fixed.network !== false ||
		fixed.modelCalls !== 0 ||
		fixed.retrievalCalls !== 0 ||
		fixed.expectedRows !== 100 ||
		fixed.expectedQuestions !== 50 ||
		fixed.tokenCeilingRatio !== 1.1 ||
		!semanticEqual(fixed.arms, ["L40_STRONG", "EPSI40"])
	) {
		throw new Error("Aggregate rescore fixed contract drifted");
	}
}

function assertPointer(
	pointer: FrozenPointer,
	expectedPath: string,
	text: string,
	label: string,
): void {
	if (resolve(projectRoot, pointer.path) !== expectedPath) throw new Error(`${label} path drifted`);
	assertSha256(text, pointer.sha256, label);
}

function assertSha256(text: string, expected: string, label: string): void {
	const actual = sha256(text);
	if (actual !== expected) throw new Error(`${label} hash mismatch: ${actual} != ${expected}`);
}

function semanticEqual(left: unknown, right: unknown): boolean {
	return JSON.stringify(sortKeys(left)) === JSON.stringify(sortKeys(right));
}

function sortKeys(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortKeys);
	if (!value || typeof value !== "object") return value;
	return Object.fromEntries(
		Object.entries(value as JsonRecord)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, item]) => [key, sortKeys(item)]),
	);
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

function requiredString(row: JsonRecord, key: string): string {
	const value = row[key];
	if (typeof value !== "string" || value.length === 0) throw new Error(`Missing string ${key}`);
	return value;
}

function unique(values: string[]): string[] {
	return [...new Set(values)];
}

function sum(values: number[]): number {
	return values.reduce((total, value) => total + value, 0);
}

function average(values: number[]): number {
	return values.length === 0 ? 0 : sum(values) / values.length;
}

function round(value: number): number {
	return Math.round(value * 1000) / 1000;
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function writeJsonExclusive(path: string, value: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
}
