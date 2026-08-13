/** Goal 3B3 structured semantic renderer — frozen offline child experiment. */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config/index.js";
import { readAllClaims, readAllSources, readAllSpans } from "../src/linter/storage.js";
import {
	buildEvidenceIntervalProjection,
	hashStableValue,
	measureTextCost,
	sourceMetadataProjection,
	stableStringify,
} from "../src/retrieval/pack-cost-ledger.js";
import {
	buildLegacyClaimSections,
	buildStructuredClaimTable,
	claimSectionsHash,
	decodeStructuredClaimTable,
} from "../src/retrieval/structured-pack-renderer.js";
import type { Claim, Source, SourceSpan } from "../src/types/index.js";

type JsonRecord = Record<string, unknown>;

interface FrozenPointer {
	path: string;
	sha256: string;
}

interface RendererContract {
	schemaVersion: string;
	frozenInputs: Record<string, FrozenPointer & { indexVersion?: string; rowCount?: number }>;
	passGate: {
		combinedRawPackEstimatedTokenReductionAtLeast: number;
		perRowIncreaseAllowed: boolean;
	};
}

interface RendererRepairContract {
	schemaVersion: string;
	supersedes: FrozenPointer;
	requiredRunId: string;
}

interface RendererFreeze {
	contract: FrozenPointer;
	repairContract: FrozenPointer;
	implementation: Record<string, FrozenPointer>;
}

interface IndexPointer {
	indexVersion: string;
	canonicalGenerationPath: string;
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const contractPath = join(
	projectRoot,
	"experiments",
	"goal3",
	"goal3-structured-pack-renderer-contract-v1.json",
);
const freezePath = join(
	projectRoot,
	"experiments",
	"goal3",
	"goal3-structured-pack-renderer-freeze-v1-1.json",
);
const repairContractPath = join(
	projectRoot,
	"experiments",
	"goal3",
	"goal3-structured-pack-renderer-contract-v1-1.json",
);
const repairContractText = readFileSync(repairContractPath, "utf8");
const repairContract = JSON.parse(repairContractText) as RendererRepairContract;
const runId = process.env.WGE_GOAL3_STRUCTURED_PACK_RUN_ID ?? repairContract.requiredRunId;
const runRoot = join(projectRoot, "experiments", "goal3", "structured-pack-renderer-runs", runId);
if (existsSync(runRoot)) throw new Error(`Refusing to overwrite renderer run: ${runRoot}`);
if (!existsSync(freezePath)) throw new Error(`Fail-closed: missing renderer freeze: ${freezePath}`);

const contractText = readFileSync(contractPath, "utf8");
const freezeText = readFileSync(freezePath, "utf8");
const contract = JSON.parse(contractText) as RendererContract;
const freeze = JSON.parse(freezeText) as RendererFreeze;
if (repairContract.schemaVersion !== "wge-goal3-structured-pack-renderer-contract/v1.1") {
	throw new Error(`Unexpected renderer repair contract: ${repairContract.schemaVersion}`);
}
assertHash(contractText, repairContract.supersedes.sha256, "superseded v1 contract");
assertHash(contractText, freeze.contract.sha256, "contract");
assertHash(repairContractText, freeze.repairContract.sha256, "repair contract");
for (const [label, pointer] of Object.entries(contract.frozenInputs)) {
	assertFrozenFile(pointer, `frozenInputs.${label}`);
}
for (const [label, pointer] of Object.entries(freeze.implementation)) {
	assertFrozenFile(pointer, `implementation.${label}`);
}
if (contract.schemaVersion !== "wge-goal3-structured-pack-renderer-contract/v1") {
	throw new Error(`Unexpected renderer contract: ${contract.schemaVersion}`);
}
if (
	contract.passGate.combinedRawPackEstimatedTokenReductionAtLeast !== 0.05 ||
	contract.passGate.perRowIncreaseAllowed !== false
) {
	throw new Error("Renderer pass gate drifted");
}

const baselinePointer = requiredPointer(contract, "costBaselineReport");
const baseline = JSON.parse(
	readFileSync(resolve(projectRoot, baselinePointer.path), "utf8"),
) as JsonRecord;
const baselineRows = requiredArray(baseline, "rows");
if (baselineRows.length !== 100)
	throw new Error(`Baseline row count drift: ${baselineRows.length}`);

const indexPointerInfo = requiredPointer(contract, "s50IndexPointer");
const indexPointer = JSON.parse(
	readFileSync(resolve(projectRoot, indexPointerInfo.path), "utf8"),
) as IndexPointer;
if (indexPointer.indexVersion !== indexPointerInfo.indexVersion) {
	throw new Error(`S50 index version drift: ${indexPointer.indexVersion}`);
}
const workspaceRoot = dirname(dirname(indexPointer.canonicalGenerationPath));
const config = loadConfig({ projectRoot: workspaceRoot });
const claimById = uniqueMap(readAllClaims(config), "Claim");
const sourceById = uniqueMap(readAllSources(config), "Source");
const spans = readAllSpans(config);
let cachedEpsiRows: Map<string, JsonRecord> | null = null;

const rows = baselineRows.map((value) =>
	evaluateRow(recordValue(value), claimById, sourceById, spans),
);
const allZeroLoss = rows.every((row) =>
	Object.values(row.integrity as JsonRecord).every((value) => value === true),
);
const rawTokens = rows.reduce(
	(total, row) => total + requiredNumber(row.cost as JsonRecord, "rawPackEstimatedTokens"),
	0,
);
const structuredTokens = rows.reduce(
	(total, row) => total + requiredNumber(row.cost as JsonRecord, "structuredPackEstimatedTokens"),
	0,
);
const savings = ratio(rawTokens - structuredTokens, rawTokens);
const rowsLarger = rows.filter(
	(row) =>
		requiredNumber(row.cost as JsonRecord, "structuredPackEstimatedTokens") >
		requiredNumber(row.cost as JsonRecord, "rawPackEstimatedTokens"),
).length;
const deterministic = rows.every(
	(row) =>
		(row.hashes as JsonRecord).structuredPack === (row.hashes as JsonRecord).structuredPackRerun,
);
const pass = allZeroLoss && deterministic && rowsLarger === 0 && savings >= 0.05;
const verdict = !allZeroLoss || !deterministic ? "REWORK" : pass ? "GO_G3C" : "NARROW_G3C";
const report = {
	schemaVersion: "wge-goal3-structured-pack-renderer-report/v1",
	status: "POST_HOC_DEV_REGRESSION",
	blind: false,
	runId,
	createdAt: new Date().toISOString(),
	verdict,
	interpretation:
		"This report validates only a generic lossless Claim serialization mechanism on revealed Dev/Regression candidates. It does not establish answer quality or approve production rollout.",
	provenance: {
		contractPath: relativePath(contractPath),
		contractSha256: sha256(contractText),
		freezePath: relativePath(freezePath),
		freezeSha256: sha256(freezeText),
		baselineReportPath: baselinePointer.path,
		baselineReportSha256: baselinePointer.sha256,
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
		reasonixUsed: false,
		reasonixReason:
			"Current Reasonix sandbox exposes the whole repository as a write root and does not prove Gold path isolation.",
	},
	checks: {
		rowCount: rows.length,
		questionCount: new Set(rows.map((row) => `${row.datasetId}/${row.questionId}`)).size,
		allZeroLoss,
		deterministic,
		rowsLarger,
		minimumSavings: contract.passGate.combinedRawPackEstimatedTokenReductionAtLeast,
		observedSavings: savings,
		pass,
	},
	aggregates: aggregate(rows),
	rows,
	limitations: [
		"Revealed Batch B/C Dev/Regression inputs; not a held-out product result.",
		"The structured payload is an offline projection and must pass G3-C integration/parity before production use.",
		"Estimated tokens are deterministic engineering estimates, not provider billing usage.",
	],
};

mkdirSync(runRoot, { recursive: true });
const reportText = `${JSON.stringify(report, null, 2)}\n`;
writeFileSync(join(runRoot, "report.json"), reportText, { encoding: "utf8", flag: "wx" });
writeFileSync(
	join(runRoot, "completion-proof.json"),
	`${JSON.stringify(
		{
			schemaVersion: "wge-goal3-structured-pack-renderer-completion-proof/v1",
			runId,
			verdict,
			reportSha256: sha256(reportText),
			rowCount: rows.length,
			allZeroLoss,
			deterministic,
			observedSavings: savings,
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
			observedSavings: savings,
			rowsLarger,
			allZeroLoss,
			deterministic,
		},
		null,
		2,
	),
);

function evaluateRow(
	baselineRow: JsonRecord,
	claimById: ReadonlyMap<string, Claim>,
	sourceById: ReadonlyMap<string, Source>,
	spans: SourceSpan[],
): JsonRecord {
	const datasetId = requiredString(baselineRow, "datasetId");
	const questionId = requiredString(baselineRow, "questionId");
	const arm = requiredString(baselineRow, "arm");
	const candidateCounts = recordValue(baselineRow.candidateCounts);
	const baselineHashes = recordValue(baselineRow.hashes);
	const candidateClaimIds = stringArrayFromHashRow(baselineRow, "candidateClaims");
	const candidateSpanIds = stringArrayFromHashRow(baselineRow, "candidateSpans");
	const candidateSourceIds = stringArrayFromHashRow(baselineRow, "candidateSources");
	const claims = candidateClaimIds.map((id) => requiredMapped(claimById, id, "Claim"));
	const sources = candidateSourceIds.map((id) => requiredMapped(sourceById, id, "Source"));
	const evidence = buildEvidenceIntervalProjection(spans, candidateSpanIds);
	const rawEvidence = evidence.raw.map((interval) => ({
		baseSpanId: interval.baseSpanId,
		blockId: interval.blockId,
		charEnd: interval.charEnd,
		charStart: interval.charStart,
		sourceId: interval.sourceId,
		spanIds: [interval.spanId],
		text: interval.text,
	}));
	const sourceMetadata = sources.map(sourceMetadataProjection);
	const legacy = buildLegacyClaimSections(claims);
	const table = buildStructuredClaimTable(claims);
	const decoded = decodeStructuredClaimTable(table);
	const rawPack = {
		schemaVersion: "wge-offline-candidate-pack-projection/v1",
		arm,
		claims: legacy.claims,
		semantics: legacy.semantics,
		sources: sourceMetadata,
		evidence: rawEvidence,
	};
	const structuredPack = {
		schemaVersion: "wge-offline-structured-candidate-pack-projection/v1",
		arm,
		claimTable: table,
		sources: sourceMetadata,
		evidence: rawEvidence,
	};
	const rawPackCost = measureTextCost(stableStringify(rawPack));
	const structuredPackCost = measureTextCost(stableStringify(structuredPack));
	const structuredPackRerun = {
		schemaVersion: "wge-offline-structured-candidate-pack-projection/v1",
		arm,
		claimTable: buildStructuredClaimTable(claims),
		sources: sources.map(sourceMetadataProjection),
		evidence: rawEvidence,
	};
	const sourceEvidenceHash = hashStableValue({ sources: sourceMetadata, evidence: rawEvidence });
	const structuredSourceEvidenceHash = hashStableValue({
		sources: structuredPack.sources,
		evidence: structuredPack.evidence,
	});
	return {
		datasetId,
		questionId,
		arm,
		cost: {
			rawPackEstimatedTokens: rawPackCost.estimatedTokens,
			structuredPackEstimatedTokens: structuredPackCost.estimatedTokens,
			estimatedTokenSavingsRatio: ratio(
				rawPackCost.estimatedTokens - structuredPackCost.estimatedTokens,
				rawPackCost.estimatedTokens,
			),
			rawPack: rawPackCost,
			structuredPack: structuredPackCost,
		},
		integrity: {
			baselineRawPackReproduced: hashStableValue(rawPack) === baselineHashes.rawPack,
			claimCountPreserved: claims.length === requiredNumber(candidateCounts, "claims"),
			spanCountPreserved: candidateSpanIds.length === requiredNumber(candidateCounts, "spans"),
			sourceCountPreserved:
				candidateSourceIds.length === requiredNumber(candidateCounts, "sources"),
			claimSectionsRoundTrip: claimSectionsHash(decoded) === claimSectionsHash(legacy),
			evidenceIntervalUnionPreserved: evidence.intervalUnionPreserved,
			sourceEvidencePayloadPreserved: sourceEvidenceHash === structuredSourceEvidenceHash,
			globalScopePreserved: claims.every((claim) => claim.scope.type === "GLOBAL"),
		},
		hashes: {
			candidateClaims: hashStableValue(candidateClaimIds),
			candidateSpans: hashStableValue(candidateSpanIds),
			candidateSources: hashStableValue(candidateSourceIds),
			legacyClaimSections: claimSectionsHash(legacy),
			decodedClaimSections: claimSectionsHash(decoded),
			sourceEvidencePayload: sourceEvidenceHash,
			structuredSourceEvidencePayload: structuredSourceEvidenceHash,
			structuredPack: hashStableValue(structuredPack),
			structuredPackRerun: hashStableValue(structuredPackRerun),
		},
	};
}

/** Candidate identity arrays are taken from the frozen baseline hashes by joining the immutable EPSI row. */
function stringArrayFromHashRow(baselineRow: JsonRecord, field: string): string[] {
	const epsiReport = getEpsiRows();
	const key = `${requiredString(baselineRow, "datasetId")}/${requiredString(baselineRow, "questionId")}/${requiredString(baselineRow, "arm")}`;
	const row = epsiReport.get(key);
	if (!row) throw new Error(`Missing immutable EPSI row: ${key}`);
	const sourceField =
		field === "candidateClaims"
			? "candidateClaimIds"
			: field === "candidateSpans"
				? "candidateSpanIds"
				: "candidateSourceIds";
	const values = stringArray(row[sourceField]);
	const baselineHash = requiredString(recordValue(baselineRow.hashes), field);
	if (hashStableValue(values) !== baselineHash)
		throw new Error(`Baseline identity hash drift: ${key}/${field}`);
	return values;
}

function getEpsiRows(): Map<string, JsonRecord> {
	if (cachedEpsiRows) return cachedEpsiRows;
	const pointer = requiredPointer(contract, "epsiFirstReport");
	const report = JSON.parse(readFileSync(resolve(projectRoot, pointer.path), "utf8")) as JsonRecord;
	cachedEpsiRows = new Map(
		requiredArray(report, "rows").map((value) => {
			const row = recordValue(value);
			return [
				`${requiredString(row, "datasetId")}/${requiredString(row, "questionId")}/${requiredString(row, "arm")}`,
				row,
			] as const;
		}),
	);
	return cachedEpsiRows;
}

function aggregate(rows: JsonRecord[]): JsonRecord[] {
	return [
		aggregateGroup(rows, "combined", "ALL_ARMS"),
		aggregateGroup(rows, "combined", "L40_STRONG"),
		aggregateGroup(rows, "combined", "EPSI40"),
		aggregateGroup(rows, "batchC", "L40_STRONG"),
		aggregateGroup(rows, "batchC", "EPSI40"),
		aggregateGroup(rows, "batchB", "L40_STRONG"),
		aggregateGroup(rows, "batchB", "EPSI40"),
	];
}

function aggregateGroup(rows: JsonRecord[], datasetId: string, arm: string): JsonRecord {
	const selected = rows.filter(
		(row) =>
			(datasetId === "combined" || row.datasetId === datasetId) &&
			(arm === "ALL_ARMS" || row.arm === arm),
	);
	const raw = selected.reduce(
		(total, row) => total + requiredNumber(row.cost as JsonRecord, "rawPackEstimatedTokens"),
		0,
	);
	const structured = selected.reduce(
		(total, row) => total + requiredNumber(row.cost as JsonRecord, "structuredPackEstimatedTokens"),
		0,
	);
	return {
		datasetId,
		arm,
		rowCount: selected.length,
		rawPackEstimatedTokens: raw,
		structuredPackEstimatedTokens: structured,
		estimatedTokenSavingsRatio: ratio(raw - structured, raw),
		averageRawPackEstimatedTokens: round(raw / selected.length),
		averageStructuredPackEstimatedTokens: round(structured / selected.length),
	};
}

function requiredPointer(
	value: RendererContract,
	key: string,
): FrozenPointer & { indexVersion?: string } {
	const pointer = value.frozenInputs[key];
	if (!pointer) throw new Error(`Missing frozen pointer: ${key}`);
	return pointer;
}

function assertFrozenFile(pointer: FrozenPointer, label: string): void {
	const text = readFileSync(resolve(projectRoot, pointer.path), "utf8");
	assertHash(text, pointer.sha256, label);
}

function assertHash(text: string, expected: string, label: string): void {
	const actual = sha256(text);
	if (actual !== expected) throw new Error(`${label} hash mismatch: ${actual}`);
}

function uniqueMap<T extends { id: string }>(items: T[], label: string): Map<string, T> {
	const map = new Map<string, T>();
	for (const item of items) {
		if (map.has(item.id)) throw new Error(`Duplicate ${label}: ${item.id}`);
		map.set(item.id, item);
	}
	return map;
}

function requiredMapped<T>(map: ReadonlyMap<string, T>, id: string, label: string): T {
	const value = map.get(id);
	if (!value) throw new Error(`Missing ${label}: ${id}`);
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
