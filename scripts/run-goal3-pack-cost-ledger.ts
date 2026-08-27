/**
 * Goal 3B3 frozen Pack cost ledger.
 *
 * Rehydrates the exact L40_STRONG/EPSI40 candidate identities from the
 * immutable first EPSI report. It does not rerun retrieval, read Gold,
 * traverse Relations, build a production ContextPack, call a model/network,
 * or mutate canonical state.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config/index.js";
import { readAllClaims, readAllSources, readAllSpans } from "../src/linter/storage.js";
import {
	buildEvidenceIntervalProjection,
	claimCommunicationProjection,
	claimSemanticProjection,
	hashStableValue,
	measureTextCost,
	sourceMetadataProjection,
	stableStringify,
} from "../src/retrieval/pack-cost-ledger.js";
import type { Claim, Source, SourceSpan } from "../src/types/index.js";

type JsonRecord = Record<string, unknown>;
type ArmId = "L40_STRONG" | "EPSI40";

interface FrozenPointer {
	path: string;
	sha256: string;
}

interface CostLedgerContract {
	schemaVersion: string;
	status: string;
	supersedes: FrozenPointer & { reason: string };
	frozenInputs: {
		epsiFirstReport: FrozenPointer & { rowCount: number; questionCount: number };
		epsiCorrectedAggregate: FrozenPointer;
		s50IndexPointer: FrozenPointer & { indexVersion: string };
		persistentIndexImplementation: FrozenPointer;
		knowledgeTypes: FrozenPointer;
	};
	frozenPopulation: {
		arms: ArmId[];
		datasets: Record<string, number>;
		questionCount: number;
		rowCount: number;
		candidateBudgetCeilingPerRow: number;
		candidateCountMustMatchFirstReport: boolean;
		candidateSetsMustComeFromFirstReport: boolean;
		rerunRetrieval: boolean;
	};
}

interface CostLedgerFreeze {
	schemaVersion: string;
	status: string;
	frozenAt: string;
	contract: FrozenPointer;
	implementation: {
		ledger: FrozenPointer;
		ledgerTests: FrozenPointer;
		runner: FrozenPointer;
	};
}

interface CurrentIndexPointer {
	schemaVersion: string;
	indexVersion: string;
	snapshotRelativePath: string;
	canonicalGenerationPath: string;
}

interface FrozenCandidateRow {
	datasetId: string;
	questionId: string;
	arm: ArmId;
	candidateClaimIds: string[];
	candidateSpanIds: string[];
	candidateSourceIds: string[];
	candidateClaimCount: number;
	lexicalCandidateRecordsLoaded: number;
	lexicalDiagnostics: {
		candidateClaimsLoaded: number;
		postingShardsRead: number;
		recordShardsRead: number;
		postingRowsDecoded: number;
		recordRowsDecoded: number;
	};
	candidateSetHashes: { claims: string; spans: string; sources: string };
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const contractPath = join(
	projectRoot,
	"experiments",
	"goal3",
	"goal3-pack-cost-ledger-contract-v1-1.json",
);
const freezePath = join(
	projectRoot,
	"experiments",
	"goal3",
	"goal3-pack-cost-ledger-freeze-v1-1.json",
);
const runId = process.env.WGE_GOAL3_PACK_COST_RUN_ID ?? "pack-cost-ledger-v1-1";
const runRoot = join(projectRoot, "experiments", "goal3", "pack-cost-ledger-runs", runId);

if (existsSync(runRoot)) throw new Error(`Refusing to overwrite cost-ledger run: ${runRoot}`);
if (!existsSync(freezePath)) {
	throw new Error(`Fail-closed: missing cost-ledger freeze: ${freezePath}`);
}

const contractText = readFileSync(contractPath, "utf8");
const freezeText = readFileSync(freezePath, "utf8");
const contract = JSON.parse(contractText) as CostLedgerContract;
const freeze = JSON.parse(freezeText) as CostLedgerFreeze;

assertHash(contractText, freeze.contract.sha256, "contract");
assertFrozenFile(contract.supersedes, "superseded v1 contract");
for (const [label, pointer] of Object.entries(freeze.implementation)) {
	assertFrozenFile(pointer, `implementation.${label}`);
}
for (const [label, pointer] of Object.entries(contract.frozenInputs)) {
	assertFrozenFile(pointer, `frozenInputs.${label}`);
}
assertContract(contract);

const firstReportText = readFileSync(
	resolve(projectRoot, contract.frozenInputs.epsiFirstReport.path),
	"utf8",
);
const firstReport = JSON.parse(firstReportText) as JsonRecord;
const rows = requiredArray(firstReport, "rows").map(parseFrozenCandidateRow);
assertFrozenRows(rows, contract);

const pointerText = readFileSync(
	resolve(projectRoot, contract.frozenInputs.s50IndexPointer.path),
	"utf8",
);
const pointer = JSON.parse(pointerText) as CurrentIndexPointer;
if (pointer.indexVersion !== contract.frozenInputs.s50IndexPointer.indexVersion) {
	throw new Error(`S50 index version drift: ${pointer.indexVersion}`);
}
const workspaceRoot = dirname(dirname(pointer.canonicalGenerationPath));
const config = loadConfig({ projectRoot: workspaceRoot });
const allClaims = readAllClaims(config);
const allSpans = readAllSpans(config);
const allSources = readAllSources(config);
const claimById = uniqueMap(allClaims, "Claim");
const sourceById = uniqueMap(allSources, "Source");

const measuredRows = rows.map((row) => measureRow(row, claimById, sourceById, allSpans));
const allIntegrityPass = measuredRows.every((row) => {
	const integrity = row.integrity as JsonRecord;
	return Object.values(integrity).every((value) => value === true);
});
const aggregates = [
	aggregateRows(measuredRows, "combined", null),
	aggregateRows(measuredRows, "combined", "L40_STRONG"),
	aggregateRows(measuredRows, "combined", "EPSI40"),
	aggregateRows(measuredRows, "batchC", "L40_STRONG"),
	aggregateRows(measuredRows, "batchC", "EPSI40"),
	aggregateRows(measuredRows, "batchB", "L40_STRONG"),
	aggregateRows(measuredRows, "batchB", "EPSI40"),
];
const combined = aggregates[0] as JsonRecord;
const savings = requiredNumber(combined, "rawToMergedPackEstimatedTokenSavingsRatio");
const rowsLargerAfterMerge = measuredRows.filter(
	(row) =>
		requiredNumber(row.cost as JsonRecord, "mergedPackEstimatedTokens") >
		requiredNumber(row.cost as JsonRecord, "rawPackEstimatedTokens"),
).length;
const intervalRendererEligible = savings >= 0.05;
const intervalRendererPass =
	intervalRendererEligible && allIntegrityPass && rowsLargerAfterMerge === 0;
const verdict = !allIntegrityPass
	? "REWORK"
	: intervalRendererPass
		? "GO_G3C"
		: intervalRendererEligible
			? "NARROW_G3C"
			: "MEASURED_NO_ACTIONABLE_REDUNDANCY";

const report = {
	schemaVersion: "wge-goal3-pack-cost-ledger-report/v1",
	status: "POST_HOC_DEV_REGRESSION",
	blind: false,
	runId,
	createdAt: new Date().toISOString(),
	verdict,
	interpretation:
		"Offline cost evidence over frozen candidate identities. GO_G3C approves only the measured mechanism as a frozen input for later held-out validation; it does not approve production ContextPack behavior or establish answer quality.",
	provenance: {
		contractPath: relativePath(contractPath),
		contractSha256: sha256(contractText),
		freezePath: relativePath(freezePath),
		freezeSha256: sha256(freezeText),
		epsiFirstReportPath: contract.frozenInputs.epsiFirstReport.path,
		epsiFirstReportSha256: sha256(firstReportText),
		s50IndexPointerPath: contract.frozenInputs.s50IndexPointer.path,
		s50IndexPointerSha256: sha256(pointerText),
		s50IndexVersion: pointer.indexVersion,
		workspaceRoot,
	},
	fixed: {
		networkUsed: false,
		modelCallsUsed: 0,
		goldRead: false,
		retrievalRerun: false,
		relationUsed: false,
		productionContextPackBuilt: false,
		canonicalMutation: false,
		providerUsage: "NOT_MEASURED_NO_MODEL_CALL",
		estimatedTokenMethod: "repository mixed Chinese/ASCII deterministic estimator",
	},
	checks: {
		allIntegrityPass,
		rowCount: measuredRows.length,
		questionCount: new Set(measuredRows.map((row) => `${row.datasetId}/${row.questionId}`)).size,
		rowsLargerAfterMerge,
		intervalRendererEligible,
		intervalRendererPass,
	},
	selectedOptimization: intervalRendererEligible
		? {
				family: "INTERVAL_AWARE_RENDERER",
				status: intervalRendererPass ? "OFFLINE_GATE_PASS" : "OFFLINE_GATE_FAIL",
				reason:
					"Selected by the preregistered >=5% combined RAW-pack estimated-token redundancy rule.",
			}
		: null,
	aggregates,
	rows: measuredRows,
	limitations: [
		"The 50 questions and their historical evaluation are revealed Dev/Regression data, not a blind holdout.",
		"The final payload is a deterministic offline projection, not the production ContextPack contract.",
		"Estimated tokens are not provider billing tokens; no model call was made.",
		"Index diagnostics are copied from the immutable first EPSI report; latency is not a verdict metric.",
	],
};

mkdirSync(runRoot, { recursive: true });
const reportText = `${JSON.stringify(report, null, 2)}\n`;
writeFileSync(join(runRoot, "report.json"), reportText, { encoding: "utf8", flag: "wx" });
writeFileSync(
	join(runRoot, "completion-proof.json"),
	`${JSON.stringify(
		{
			schemaVersion: "wge-goal3-pack-cost-ledger-completion-proof/v1",
			runId,
			verdict,
			reportSha256: sha256(reportText),
			rowCount: measuredRows.length,
			allIntegrityPass,
			providerUsage: "NOT_MEASURED_NO_MODEL_CALL",
		},
		null,
		2,
	)}\n`,
	{ encoding: "utf8", flag: "wx" },
);

console.log(
	JSON.stringify(
		{
			runId,
			verdict,
			report: relativePath(join(runRoot, "report.json")),
			reportSha256: sha256(reportText),
			rawToMergedPackEstimatedTokenSavingsRatio: savings,
			rowsLargerAfterMerge,
			allIntegrityPass,
		},
		null,
		2,
	),
);

function measureRow(
	row: FrozenCandidateRow,
	claimById: ReadonlyMap<string, Claim>,
	sourceById: ReadonlyMap<string, Source>,
	allSpans: SourceSpan[],
): JsonRecord {
	const claims = row.candidateClaimIds.map((id) => requiredMapped(claimById, id, "Claim"));
	const sources = row.candidateSourceIds.map((id) => requiredMapped(sourceById, id, "Source"));
	const candidateClaimSpanIds = [...new Set(claims.flatMap((claim) => claim.evidenceSpanIds))];
	const evidence = buildEvidenceIntervalProjection(allSpans, row.candidateSpanIds);
	const resolvedSourceIds = [...new Set(evidence.raw.map((interval) => interval.sourceId))];

	const claimCommunication = claims.map((claim, index) =>
		claimCommunicationProjection(claim, index + 1),
	);
	const claimSemantics = claims.map(claimSemanticProjection);
	const sourceMetadata = sources.map(sourceMetadataProjection);
	const rawEvidence = evidence.raw.map((interval) => ({
		baseSpanId: interval.baseSpanId,
		blockId: interval.blockId,
		charEnd: interval.charEnd,
		charStart: interval.charStart,
		sourceId: interval.sourceId,
		spanIds: [interval.spanId],
		text: interval.text,
	}));
	const mergedEvidence = evidence.merged;

	const statementText = stableStringify(claimCommunication);
	const semanticsText = stableStringify(claimSemantics);
	const sourceText = stableStringify(sourceMetadata);
	const rawEvidenceText = stableStringify(rawEvidence);
	const mergedEvidenceText = stableStringify(mergedEvidence);
	const rawPack = {
		schemaVersion: "wge-offline-candidate-pack-projection/v1",
		arm: row.arm,
		claims: claimCommunication,
		semantics: claimSemantics,
		sources: sourceMetadata,
		evidence: rawEvidence,
	};
	const mergedPack = { ...rawPack, evidence: mergedEvidence };
	const rawPackText = stableStringify(rawPack);
	const mergedPackText = stableStringify(mergedPack);
	const statementCost = measureTextCost(statementText);
	const semanticsCost = measureTextCost(semanticsText);
	const sourceCost = measureTextCost(sourceText);
	const rawEvidenceCost = measureTextCost(rawEvidenceText);
	const mergedEvidenceCost = measureTextCost(mergedEvidenceText);
	const rawPackCost = measureTextCost(rawPackText);
	const mergedPackCost = measureTextCost(mergedPackText);

	const integrity = {
		candidateClaimCountPreserved: claims.length === row.candidateClaimCount,
		candidateClaimIdsPreserved: arraysEqual(
			row.candidateClaimIds,
			claims.map((claim) => claim.id),
		),
		candidateSpanIdsPreserved: setsEqual(row.candidateSpanIds, candidateClaimSpanIds),
		candidateSourceIdsPreserved: setsEqual(row.candidateSourceIds, resolvedSourceIds),
		candidateClaimHashPreserved:
			sha256(JSON.stringify(row.candidateClaimIds)) === row.candidateSetHashes.claims,
		candidateSpanHashPreserved:
			sha256(JSON.stringify(row.candidateSpanIds)) === row.candidateSetHashes.spans,
		candidateSourceHashPreserved:
			sha256(JSON.stringify(row.candidateSourceIds)) === row.candidateSetHashes.sources,
		intervalUnionPreserved: evidence.intervalUnionPreserved,
		globalScopePreserved: claims.every((claim) => claim.scope.type === "GLOBAL"),
	};

	return {
		datasetId: row.datasetId,
		questionId: row.questionId,
		arm: row.arm,
		candidateCounts: {
			claims: claims.length,
			spans: row.candidateSpanIds.length,
			sources: row.candidateSourceIds.length,
			rawEvidenceIntervals: rawEvidence.length,
			mergedEvidenceIntervals: mergedEvidence.length,
		},
		cost: {
			claimStatement: statementCost,
			conditionsProvenance: semanticsCost,
			sourceMetadata: sourceCost,
			evidenceRawIntervals: rawEvidenceCost,
			evidenceMergedIntervals: mergedEvidenceCost,
			rawPack: rawPackCost,
			mergedPack: mergedPackCost,
			rawPackEstimatedTokens: rawPackCost.estimatedTokens,
			mergedPackEstimatedTokens: mergedPackCost.estimatedTokens,
			rawToMergedPackEstimatedTokenSavingsRatio: ratio(
				rawPackCost.estimatedTokens - mergedPackCost.estimatedTokens,
				rawPackCost.estimatedTokens,
			),
		},
		indexRead: row.lexicalDiagnostics,
		lexicalCandidateRecordsLoaded: row.lexicalCandidateRecordsLoaded,
		integrity,
		hashes: {
			candidateClaims: hashStableValue(row.candidateClaimIds),
			candidateSpans: hashStableValue(row.candidateSpanIds),
			candidateSources: hashStableValue(row.candidateSourceIds),
			rawIntervalUnion: evidence.rawUnionHash,
			mergedIntervalUnion: evidence.mergedUnionHash,
			rawPack: hashStableValue(rawPack),
			mergedPack: hashStableValue(mergedPack),
		},
	};
}

function aggregateRows(rows: JsonRecord[], datasetId: string, arm: ArmId | null): JsonRecord {
	const selected = rows.filter(
		(row) =>
			(datasetId === "combined" || row.datasetId === datasetId) &&
			(arm === null || row.arm === arm),
	);
	const sumCost = (field: string): number =>
		selected.reduce((total, row) => total + requiredNumber(row.cost as JsonRecord, field), 0);
	const rawTokens = sumCost("rawPackEstimatedTokens");
	const mergedTokens = sumCost("mergedPackEstimatedTokens");
	const sumIndex = (field: string): number =>
		selected.reduce((total, row) => total + requiredNumber(row.indexRead as JsonRecord, field), 0);
	return {
		datasetId,
		arm: arm ?? "ALL_ARMS",
		rowCount: selected.length,
		rawPackEstimatedTokens: rawTokens,
		mergedPackEstimatedTokens: mergedTokens,
		rawToMergedPackEstimatedTokenSavingsRatio: ratio(rawTokens - mergedTokens, rawTokens),
		averageRawPackEstimatedTokens: round(rawTokens / selected.length),
		averageMergedPackEstimatedTokens: round(mergedTokens / selected.length),
		averageLayerEstimatedTokens: {
			claimStatement: round(sumNestedTokens(selected, "claimStatement") / selected.length),
			conditionsProvenance: round(
				sumNestedTokens(selected, "conditionsProvenance") / selected.length,
			),
			sourceMetadata: round(sumNestedTokens(selected, "sourceMetadata") / selected.length),
			evidenceRawIntervals: round(
				sumNestedTokens(selected, "evidenceRawIntervals") / selected.length,
			),
			evidenceMergedIntervals: round(
				sumNestedTokens(selected, "evidenceMergedIntervals") / selected.length,
			),
		},
		averageIndexRead: {
			candidateClaimsLoaded: round(sumIndex("candidateClaimsLoaded") / selected.length),
			postingShardsRead: round(sumIndex("postingShardsRead") / selected.length),
			recordShardsRead: round(sumIndex("recordShardsRead") / selected.length),
			postingRowsDecoded: round(sumIndex("postingRowsDecoded") / selected.length),
			recordRowsDecoded: round(sumIndex("recordRowsDecoded") / selected.length),
		},
		rowsWithIntervalCompaction: selected.filter((row) => {
			const counts = row.candidateCounts as JsonRecord;
			return (
				requiredNumber(counts, "mergedEvidenceIntervals") <
				requiredNumber(counts, "rawEvidenceIntervals")
			);
		}).length,
	};
}

function sumNestedTokens(rows: JsonRecord[], layer: string): number {
	return rows.reduce((total, row) => {
		const cost = row.cost as JsonRecord;
		return total + requiredNumber(cost[layer] as JsonRecord, "estimatedTokens");
	}, 0);
}

function parseFrozenCandidateRow(value: unknown): FrozenCandidateRow {
	const row = recordValue(value);
	const arm = requiredString(row, "arm");
	if (arm !== "L40_STRONG" && arm !== "EPSI40") throw new Error(`Unexpected arm: ${arm}`);
	const diagnostics = recordValue(row.lexicalDiagnostics);
	const hashes = recordValue(row.candidateSetHashes);
	return {
		datasetId: requiredString(row, "datasetId"),
		questionId: requiredString(row, "questionId"),
		arm,
		candidateClaimIds: stringArray(row.candidateClaimIds),
		candidateSpanIds: stringArray(row.candidateSpanIds),
		candidateSourceIds: stringArray(row.candidateSourceIds),
		candidateClaimCount: requiredNumber(row, "candidateClaimCount"),
		lexicalCandidateRecordsLoaded: requiredNumber(row, "lexicalCandidateRecordsLoaded"),
		lexicalDiagnostics: {
			candidateClaimsLoaded: requiredNumber(diagnostics, "candidateClaimsLoaded"),
			postingShardsRead: requiredNumber(diagnostics, "postingShardsRead"),
			recordShardsRead: requiredNumber(diagnostics, "recordShardsRead"),
			postingRowsDecoded: requiredNumber(diagnostics, "postingRowsDecoded"),
			recordRowsDecoded: requiredNumber(diagnostics, "recordRowsDecoded"),
		},
		candidateSetHashes: {
			claims: requiredString(hashes, "claims"),
			spans: requiredString(hashes, "spans"),
			sources: requiredString(hashes, "sources"),
		},
	};
}

function assertFrozenRows(rows: FrozenCandidateRow[], contractValue: CostLedgerContract): void {
	if (rows.length !== contractValue.frozenPopulation.rowCount) {
		throw new Error(`Frozen row count drift: ${rows.length}`);
	}
	const keys = new Set(rows.map((row) => `${row.datasetId}/${row.questionId}/${row.arm}`));
	if (keys.size !== rows.length) throw new Error("Duplicate frozen candidate row identity");
	const questions = new Set(rows.map((row) => `${row.datasetId}/${row.questionId}`));
	if (questions.size !== contractValue.frozenPopulation.questionCount) {
		throw new Error(`Frozen question count drift: ${questions.size}`);
	}
	for (const key of questions) {
		const arms = rows
			.filter((row) => `${row.datasetId}/${row.questionId}` === key)
			.map((row) => row.arm);
		if (!setsEqual(arms, contractValue.frozenPopulation.arms)) {
			throw new Error(`Frozen arms drift for ${key}`);
		}
	}
	for (const row of rows) {
		if (
			row.candidateClaimCount < 1 ||
			row.candidateClaimCount > contractValue.frozenPopulation.candidateBudgetCeilingPerRow ||
			row.candidateClaimCount !== row.candidateClaimIds.length
		) {
			throw new Error(`Candidate count/ceiling drift for ${row.questionId}/${row.arm}`);
		}
	}
}

function assertContract(value: CostLedgerContract): void {
	if (value.schemaVersion !== "wge-goal3-pack-cost-ledger-contract/v1.1") {
		throw new Error(`Unexpected cost-ledger contract: ${value.schemaVersion}`);
	}
	if (value.frozenPopulation.rerunRetrieval !== false) {
		throw new Error("Contract must prohibit retrieval rerun");
	}
	if (value.frozenPopulation.candidateSetsMustComeFromFirstReport !== true) {
		throw new Error("Contract must require first-report candidate identities");
	}
	if (value.frozenPopulation.candidateCountMustMatchFirstReport !== true) {
		throw new Error("Contract must require first-report candidate counts");
	}
}

function assertFrozenFile(pointerValue: unknown, label: string): void {
	const pointer = recordValue(pointerValue) as unknown as FrozenPointer;
	if (typeof pointer.path !== "string" || typeof pointer.sha256 !== "string") {
		throw new Error(`Invalid frozen pointer: ${label}`);
	}
	const text = readFileSync(resolve(projectRoot, pointer.path), "utf8");
	assertHash(text, pointer.sha256, label);
}

function assertHash(text: string, expected: string, label: string): void {
	const actual = sha256(text);
	if (actual !== expected)
		throw new Error(`${label} hash mismatch: expected ${expected}, got ${actual}`);
}

function uniqueMap<T extends { id: string }>(items: T[], label: string): Map<string, T> {
	const result = new Map<string, T>();
	for (const item of items) {
		if (result.has(item.id)) throw new Error(`Duplicate ${label}: ${item.id}`);
		result.set(item.id, item);
	}
	return result;
}

function requiredMapped<T>(map: ReadonlyMap<string, T>, id: string, label: string): T {
	const value = map.get(id);
	if (!value) throw new Error(`Missing frozen ${label}: ${id}`);
	return value;
}

function requiredArray(record: JsonRecord, key: string): unknown[] {
	const value = record[key];
	if (!Array.isArray(value)) throw new Error(`Expected array: ${key}`);
	return value;
}

function stringArray(value: unknown): string[] {
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
		throw new Error("Expected string array");
	}
	return [...value] as string[];
}

function requiredString(record: JsonRecord, key: string): string {
	const value = record[key];
	if (typeof value !== "string" || value.length === 0) throw new Error(`Expected string: ${key}`);
	return value;
}

function requiredNumber(record: JsonRecord, key: string): number {
	const value = record[key];
	if (typeof value !== "number" || !Number.isFinite(value))
		throw new Error(`Expected number: ${key}`);
	return value;
}

function recordValue(value: unknown): JsonRecord {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("Expected object");
	return value as JsonRecord;
}

function arraysEqual(left: string[], right: string[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

function setsEqual(left: string[], right: string[]): boolean {
	return arraysEqual([...new Set(left)].sort(), [...new Set(right)].sort());
}

function ratio(numerator: number, denominator: number): number {
	return denominator === 0 ? 0 : round(numerator / denominator);
}

function round(value: number): number {
	return Number(value.toFixed(6));
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function relativePath(path: string): string {
	return path.startsWith(`${projectRoot}/`) ? path.slice(projectRoot.length + 1) : path;
}
