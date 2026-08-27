import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { selectCrossRelationsForAudit } from "../src/compiler/index.js";
import type { SourcePublication, SourceQuarantinePublication } from "../src/linter/storage.js";
import type { Claim, Relation } from "../src/types/index.js";

type JsonRecord = Record<string, unknown>;
interface BaselineRelationRow {
	sourceId: string;
	relation: Relation;
	baselineState: "CANONICAL" | "QUARANTINED";
}

const projectRoot = resolve(import.meta.dirname, "..");
const contractPath = join(
	projectRoot,
	"experiments",
	"goal3",
	"goal3-relation-lifecycle-contract-v1.json",
);
const contract = readJson<JsonRecord>(contractPath);
if (contract.status !== "FROZEN_BEFORE_IMPLEMENTATION" || contract.stageBRead !== false) {
	throw new Error("Relation lifecycle contract is not frozen or Stage B isolation drifted");
}
const repairContractPath = join(
	projectRoot,
	"experiments",
	"goal3",
	"goal3-relation-lifecycle-repair-contract-v1.json",
);
const repairContract = readJson<JsonRecord>(repairContractPath);
if (
	repairContract.status !== "FROZEN_BEFORE_REPAIR_IMPLEMENTATION" ||
	repairContract.stageBRead !== false
) {
	throw new Error("Relation lifecycle repair contract is not frozen or Stage B isolation drifted");
}
const failedRun = requireRecord(repairContract, "failedRun");
assertSha256(
	join(projectRoot, requireString(failedRun, "report")),
	requireString(failedRun, "reportSha256"),
);
assertSha256(
	join(projectRoot, requireString(failedRun, "deferredReview")),
	requireString(failedRun, "deferredReviewSha256"),
);
const repairContractV2Path = join(
	projectRoot,
	"experiments",
	"goal3",
	"goal3-relation-lifecycle-repair-contract-v2.json",
);
const repairContractV2 = readJson<JsonRecord>(repairContractV2Path);
if (
	repairContractV2.status !== "FROZEN_BEFORE_REPAIR_IMPLEMENTATION" ||
	repairContractV2.stageBRead !== false
) {
	throw new Error(
		"Relation lifecycle v2 repair contract is not frozen or Stage B isolation drifted",
	);
}
const failedRunV2 = requireRecord(repairContractV2, "failedRun");
assertSha256(
	join(projectRoot, requireString(failedRunV2, "report")),
	requireString(failedRunV2, "reportSha256"),
);
assertSha256(
	join(projectRoot, requireString(failedRunV2, "deferredReview")),
	requireString(failedRunV2, "deferredReviewSha256"),
);
const repairAddendumPath = join(
	projectRoot,
	"experiments",
	"goal3",
	"goal3-relation-lifecycle-repair-contract-v2.1-addendum.json",
);
const repairAddendum = readJson<JsonRecord>(repairAddendumPath);
if (
	repairAddendum.status !== "FROZEN_BEFORE_SCHEMA_COMPLETION" ||
	repairAddendum.stageBRead !== false
) {
	throw new Error("Relation lifecycle v2.1 addendum is not frozen or Stage B isolation drifted");
}
const baseline = requireRecord(contract, "baseline");
const baselineRun = requireString(baseline, "run");
const baselineRoot = join(projectRoot, baselineRun, "workspace");
assertSha256(
	join(projectRoot, baselineRun, "completion.json"),
	requireString(baseline, "completionSha256"),
);
assertSha256(
	join(baselineRoot, "runs", "relation-funnel.jsonl"),
	requireString(baseline, "relationFunnelSha256"),
);
assertPublicationAggregate(
	baselineRoot,
	requireString(baseline, "publicationAndQuarantineAggregateSha256"),
);

const runId = process.env.WGE_GOAL3_RELATION_LIFECYCLE_RUN_ID ?? "lifecycle-offline-v1";
if (!/^[a-zA-Z0-9._-]+$/.test(runId)) throw new Error(`Invalid run id: ${runId}`);
const runRoot = join(projectRoot, "experiments", "goal3", "relation-lifecycle-runs", runId);
if (existsSync(runRoot)) throw new Error(`Replay output already exists: ${runRoot}`);
mkdirSync(runRoot, { recursive: true });

const publications = readJsonDirectory<SourcePublication>(join(baselineRoot, "publications"));
const quarantines = readJsonDirectory<SourceQuarantinePublication>(
	join(baselineRoot, "quarantine", "publications"),
);
const claims = uniqueById([
	...publications.flatMap((publication) => publication.claims),
	...quarantines.flatMap((publication) => publication.claims.map((item) => item.claim)),
]);
const claimById = new Map(claims.map((claim) => [claim.id, claim]));
const endpointStatements = new Map(claims.map((claim) => [claim.id, claim.statement]));
const newClaimIdsBySource = new Map(
	publications.map((publication) => [
		publication.sourceId,
		new Set(publication.claims.map((claim) => claim.id)),
	]),
);
const rows: BaselineRelationRow[] = uniqueRelationRows([
	...publications.flatMap((publication) =>
		publication.relations
			.filter((relation) => relation.source === "cross-material-detect")
			.map((relation) => ({
				sourceId: publication.sourceId,
				relation,
				baselineState: "CANONICAL" as const,
			})),
	),
	...quarantines.flatMap((publication) =>
		publication.relations
			.filter((item) => item.relation.source === "cross-material-detect")
			.map((item) => ({
				sourceId: publication.sourceId,
				relation: item.relation,
				baselineState: "QUARANTINED" as const,
			})),
	),
]);
const bySource = groupBySource(rows);
const arms = requireArray(contract, "offlineArms").map((value) => {
	const arm = asRecord(value, "offline arm");
	return {
		id: requireString(arm, "id"),
		auditBudgetPerSource: nullableNumber(arm.auditBudgetPerSource, "auditBudgetPerSource"),
		maxEndpointFanOut: nullableNumber(arm.maxEndpointFanOut, "maxEndpointFanOut"),
	};
});
const repairArm = requireRecord(repairContract, "repairArm");
arms.push({
	id: requireString(repairArm, "id"),
	auditBudgetPerSource: nullableNumber(repairArm.auditBudgetPerSource, "auditBudgetPerSource"),
	maxEndpointFanOut: nullableNumber(repairArm.maxEndpointFanOut, "maxEndpointFanOut"),
});
const repairArmV2 = requireRecord(repairContractV2, "repairArm");
arms.push({
	id: requireString(repairArmV2, "id"),
	auditBudgetPerSource: nullableNumber(repairArmV2.auditBudgetPerSource, "auditBudgetPerSource"),
	maxEndpointFanOut: nullableNumber(repairArmV2.maxNewEndpointFanOut, "maxNewEndpointFanOut"),
});
const primaryArmId = requireString(repairArmV2, "id");
const diagnosticCanonicalIds = new Set(
	requireArray(baseline, "canonicalCrossRelationIdsDiagnosticOnly").map((value) => String(value)),
);
const reports = [];
for (const arm of arms) {
	const decisions: Array<{
		sourceId: string;
		relation: Relation;
		baselineState: string;
		generatedRank: number;
		selectionState: string;
		selectionReason: string;
	}> = [];
	for (const [sourceId, sourceRows] of [...bySource.entries()].sort(([left], [right]) =>
		left.localeCompare(right),
	)) {
		const relationById = new Map(sourceRows.map((row) => [row.relation.id, row]));
		const selection = selectCrossRelationsForAudit(
			sourceRows.map((row) => row.relation),
			arm.auditBudgetPerSource ?? Number.POSITIVE_INFINITY,
			arm.maxEndpointFanOut ?? Number.POSITIVE_INFINITY,
			arm.id === primaryArmId || arm.id === requireString(repairArm, "id")
				? (newClaimIdsBySource.get(sourceId) ?? new Set())
				: new Set(),
			arm.id === primaryArmId ? endpointStatements : new Map(),
			arm.id === primaryArmId ? "COVERAGE_ENDPOINTS" : "ALL_ENDPOINTS",
		);
		for (const decision of selection.decisions) {
			const baselineRow = relationById.get(decision.relation.id);
			if (!baselineRow) throw new Error(`Missing baseline row: ${decision.relation.id}`);
			decisions.push({ sourceId, baselineState: baselineRow.baselineState, ...decision });
		}
	}
	const selectedIds = new Set(
		decisions
			.filter((decision) => decision.selectionState === "SELECTED_FOR_AUDIT")
			.map((decision) => decision.relation.id),
	);
	const deferred = decisions.filter((decision) => decision.selectionState === "DEFERRED_BY_BUDGET");
	const diagnosticKept = [...diagnosticCanonicalIds].filter((id) => selectedIds.has(id));
	const generatedCoverageEndpoints = coverageEndpoints(decisions, newClaimIdsBySource);
	const selectedCoverageEndpoints = coverageEndpoints(
		decisions.filter((decision) => decision.selectionState === "SELECTED_FOR_AUDIT"),
		newClaimIdsBySource,
	);
	const report = {
		id: arm.id,
		auditBudgetPerSource: arm.auditBudgetPerSource,
		maxEndpointFanOut: arm.maxEndpointFanOut,
		generated: decisions.length,
		selectedForAudit: selectedIds.size,
		deferred: deferred.length,
		candidateAccountingExact: decisions.length === selectedIds.size + deferred.length,
		candidateCompression:
			decisions.length === 0 ? 0 : Number((deferred.length / decisions.length).toFixed(6)),
		diagnosticCanonicalKept: diagnosticKept.length,
		diagnosticCanonicalTotal: diagnosticCanonicalIds.size,
		diagnosticCanonicalRecall:
			diagnosticCanonicalIds.size === 0
				? 1
				: Number((diagnosticKept.length / diagnosticCanonicalIds.size).toFixed(6)),
		diagnosticCanonicalMissed: [...diagnosticCanonicalIds].filter((id) => !selectedIds.has(id)),
		newEndpointCoverage:
			generatedCoverageEndpoints.size === 0
				? 1
				: Number((selectedCoverageEndpoints.size / generatedCoverageEndpoints.size).toFixed(6)),
		coveredNewEndpoints: selectedCoverageEndpoints.size,
		generatedNewEndpointsWithCandidates: generatedCoverageEndpoints.size,
		maxSelectedEndpointDegreePerSource: maxEndpointDegreePerSource(
			decisions.filter((decision) => decision.selectionState === "SELECTED_FOR_AUDIT"),
		),
		maxSelectedNewEndpointDegree: maxCoverageEndpointDegree(
			decisions.filter((decision) => decision.selectionState === "SELECTED_FOR_AUDIT"),
			newClaimIdsBySource,
		),
	};
	reports.push(report);
	writeJsonl(join(runRoot, `decisions-${arm.id}.jsonl`), decisions);
	if (arm.id === primaryArmId) {
		const sample = deterministicSample(deferred, 24, arm.id).map((decision) => ({
			sourceId: decision.sourceId,
			relationId: decision.relation.id,
			type: decision.relation.type,
			confidence: decision.relation.confidence,
			selectionReason: decision.selectionReason,
			from: endpoint(claimById, decision.relation.from as string),
			to: endpoint(claimById, decision.relation.to as string),
			conditions: decision.relation.conditions,
			evidenceSpanIds: decision.relation.evidenceSpanIds,
		}));
		writeJsonl(join(runRoot, `deferred-sample-${arm.id}.jsonl`), sample);
	}
}

const acceptance = requireRecord(repairContractV2, "acceptance");
const primary = reports.find((report) => report.id === primaryArmId);
if (!primary) throw new Error(`Missing primary arm: ${primaryArmId}`);
const machineGate = {
	candidateAccountingExact: primary.candidateAccountingExact,
	diagnosticCanonicalRecall:
		primary.diagnosticCanonicalRecall >= Number(acceptance.diagnosticCanonicalRecall),
	minimumCandidateCompression:
		primary.candidateCompression >= Number(acceptance.minimumCandidateCompression),
	minimumNewEndpointCoverage:
		primary.newEndpointCoverage >= Number(acceptance.minimumNewEndpointCoverage),
	maximumNewEndpointDegree:
		primary.maxSelectedNewEndpointDegree <= Number(acceptance.maximumNewEndpointDegree),
	modelCalls: Number(acceptance.modelCalls) === 0,
	deferredConsumerExposure: Number(acceptance.deferredConsumerExposure) === 0,
};
const report = {
	schemaVersion: "wge-goal3-relation-lifecycle-replay/v1",
	status: Object.values(machineGate).every(Boolean)
		? "MACHINE_GATE_PASS_PENDING_DEFERRED_REVIEW"
		: "MACHINE_GATE_FAIL",
	stageBRead: false,
	contract: relative(projectRoot, contractPath),
	contractSha256: sha256(readFileSync(contractPath)),
	repairContract: relative(projectRoot, repairContractPath),
	repairContractSha256: sha256(readFileSync(repairContractPath)),
	repairContractV2: relative(projectRoot, repairContractV2Path),
	repairContractV2Sha256: sha256(readFileSync(repairContractV2Path)),
	repairAddendum: relative(projectRoot, repairAddendumPath),
	repairAddendumSha256: sha256(readFileSync(repairAddendumPath)),
	baselineRun,
	modelCalls: 0,
	input: { sources: bySource.size, relations: rows.length, claims: claims.length },
	arms: reports,
	primaryArm: primaryArmId,
	machineGate,
	createdAt: new Date().toISOString(),
};
writeJson(join(runRoot, "report.json"), report);
console.log(JSON.stringify(report, null, 2));

function endpoint(claimsById: Map<string, Claim>, id: string) {
	const claim = claimsById.get(id);
	return { id, statement: claim?.statement ?? null, conditions: claim?.conditions ?? [] };
}

function deterministicSample<T extends { relation: Relation }>(
	items: T[],
	limit: number,
	seed: string,
) {
	return [...items]
		.sort((left, right) =>
			sha256(Buffer.from(`${seed}\n${left.relation.id}`)).localeCompare(
				sha256(Buffer.from(`${seed}\n${right.relation.id}`)),
			),
		)
		.slice(0, limit);
}

function coverageEndpoints<T extends { sourceId: string; relation: Relation }>(
	items: T[],
	coverageIdsBySource: Map<string, Set<string>>,
): Set<string> {
	const covered = new Set<string>();
	for (const item of items) {
		const coverageIds = coverageIdsBySource.get(item.sourceId) ?? new Set<string>();
		for (const endpointId of [item.relation.from as string, item.relation.to as string]) {
			if (coverageIds.has(endpointId)) covered.add(`${item.sourceId}\n${endpointId}`);
		}
	}
	return covered;
}

function maxEndpointDegreePerSource<T extends { sourceId: string; relation: Relation }>(
	items: T[],
): number {
	const degreesBySource = new Map<string, Map<string, number>>();
	for (const item of items) {
		const degrees = degreesBySource.get(item.sourceId) ?? new Map<string, number>();
		degrees.set(item.relation.from as string, (degrees.get(item.relation.from as string) ?? 0) + 1);
		degrees.set(item.relation.to as string, (degrees.get(item.relation.to as string) ?? 0) + 1);
		degreesBySource.set(item.sourceId, degrees);
	}
	return Math.max(0, ...[...degreesBySource.values()].flatMap((degrees) => [...degrees.values()]));
}

function maxCoverageEndpointDegree<T extends { sourceId: string; relation: Relation }>(
	items: T[],
	coverageIdsBySource: Map<string, Set<string>>,
): number {
	const degrees = new Map<string, number>();
	for (const item of items) {
		const coverageIds = coverageIdsBySource.get(item.sourceId) ?? new Set<string>();
		for (const endpointId of [item.relation.from as string, item.relation.to as string]) {
			if (!coverageIds.has(endpointId)) continue;
			const key = `${item.sourceId}\n${endpointId}`;
			degrees.set(key, (degrees.get(key) ?? 0) + 1);
		}
	}
	return Math.max(0, ...degrees.values());
}

function uniqueRelationRows<T extends { relation: Relation }>(items: T[]): T[] {
	return [...new Map(items.map((item) => [item.relation.id, item])).values()];
}

function groupBySource(items: BaselineRelationRow[]): Map<string, BaselineRelationRow[]> {
	const grouped = new Map<string, BaselineRelationRow[]>();
	for (const item of items) {
		const existing = grouped.get(item.sourceId) ?? [];
		existing.push(item);
		grouped.set(item.sourceId, existing);
	}
	return grouped;
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
	return [...new Map(items.map((item) => [item.id, item])).values()];
}

function readJsonDirectory<T>(directory: string): T[] {
	return readdirSync(directory)
		.filter((name) => name.endsWith(".json"))
		.sort()
		.map((name) => readJson<T>(join(directory, name)));
}

function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, "utf8")) as T;
}

function writeJson(path: string, value: unknown): void {
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
}

function writeJsonl(path: string, rows: unknown[]): void {
	writeFileSync(path, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, {
		encoding: "utf8",
		flag: "wx",
	});
}

function assertSha256(path: string, expected: string): void {
	const actual = sha256(readFileSync(path));
	if (actual !== expected) throw new Error(`Frozen input drift: ${relative(projectRoot, path)}`);
}

function assertPublicationAggregate(baselineWorkspace: string, expected: string): void {
	const paths = [
		...files(join(baselineWorkspace, "publications")),
		...files(join(baselineWorkspace, "quarantine", "publications")),
	].sort();
	const manifest = paths
		.map((path) => `${sha256(readFileSync(path))}  ${relative(projectRoot, path)}\n`)
		.join("");
	const actual = sha256(Buffer.from(manifest));
	if (actual !== expected) throw new Error("Frozen publication aggregate drift");
}

function files(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		return entry.isDirectory() ? files(path) : [path];
	});
}

function sha256(value: Buffer): string {
	return createHash("sha256").update(value).digest("hex");
}

function requireRecord(value: JsonRecord, key: string): JsonRecord {
	return asRecord(value[key], key);
}

function requireArray(value: JsonRecord, key: string): unknown[] {
	const candidate = value[key];
	if (!Array.isArray(candidate)) throw new Error(`Expected array: ${key}`);
	return candidate;
}

function requireString(value: JsonRecord, key: string): string {
	const candidate = value[key];
	if (typeof candidate !== "string" || candidate.length === 0)
		throw new Error(`Expected string: ${key}`);
	return candidate;
}

function nullableNumber(value: unknown, label: string): number | null {
	if (value === null) return null;
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
		throw new Error(`Expected positive integer or null: ${label}`);
	}
	return value;
}

function asRecord(value: unknown, label: string): JsonRecord {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`Expected object: ${label}`);
	}
	return value as JsonRecord;
}
