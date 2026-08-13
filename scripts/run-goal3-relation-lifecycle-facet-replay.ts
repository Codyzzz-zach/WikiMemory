import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { endpointLexicalAffinity, selectCrossRelationsForAudit } from "../src/compiler/index.js";
import { loadConfig } from "../src/config/index.js";
import { readAllClaims } from "../src/linter/storage.js";
import type { Claim, Relation } from "../src/types/index.js";

type JsonRecord = Record<string, unknown>;
interface CandidateLedgerRow {
	sourceId: string;
	relation: Relation;
	selectionState: "SELECTED_FOR_AUDIT" | "DEFERRED_BY_BUDGET";
}
interface CounterfactualDecision {
	relationId: string;
	finalState: "CANONICAL" | "QUARANTINED";
}

const projectRoot = resolve(import.meta.dirname, "..");
const contractPath = join(
	projectRoot,
	"experiments",
	"goal3",
	"goal3-relation-lifecycle-facet-repair-contract-v1.json",
);
const contract = readJson<JsonRecord>(contractPath);
if (
	contract.status !== "FROZEN_BEFORE_FACET_REPAIR_IMPLEMENTATION" ||
	contract.stageBRead !== false
) {
	throw new Error("Facet repair contract is not frozen or Stage B isolation drifted");
}
const failed = requireRecord(contract, "failedCounterfactual");
for (const [pathKey, hashKey] of [
	["report", "reportSha256"],
	["deferredReview", "deferredReviewSha256"],
	["counterfactualDecisions", "counterfactualDecisionsSha256"],
] as const) {
	assertSha256(join(projectRoot, requireString(failed, pathKey)), requireString(failed, hashKey));
}

const productionWorkspace = join(
	projectRoot,
	"experiments",
	"goal3",
	"s200-runs",
	"compile-v9-relation-lifecycle-12source",
	"workspace",
);
const ledger = readJsonl<CandidateLedgerRow>(
	join(productionWorkspace, "runs", "relation-candidate-ledger.jsonl"),
);
const bySource = groupBy(ledger, (row) => row.sourceId);
const pressureSources = [...bySource.entries()].filter(([, rows]) => rows.length > 24);
if (pressureSources.length !== 1) throw new Error("Frozen v9 pressure-source count drifted");
const [sourceId, rows] = pressureSources[0] as [string, CandidateLedgerRow[]];
const config = loadConfig({ projectRoot: productionWorkspace, apiKey: "" });
const claims = readAllClaims(config);
const claimsById = new Map(claims.map((claim) => [claim.id, claim]));
const endpointStatements = new Map(claims.map((claim) => [claim.id, claim.statement]));
const publication = readJson<{ sourceId: string; claims: Claim[] }>(
	join(productionWorkspace, "publications", `${sourceId.slice("source:".length)}.json`),
);
if (publication.sourceId !== sourceId) throw new Error("Pressure publication source drifted");
const newEndpointIds = new Set(publication.claims.map((claim) => claim.id));
const relations = rows.map((row) => row.relation);
const selection = selectCrossRelationsForAudit(
	relations,
	24,
	4,
	newEndpointIds,
	endpointStatements,
	"COVERAGE_ENDPOINTS",
);

const previousSelected = rows
	.filter((row) => row.selectionState === "SELECTED_FOR_AUDIT")
	.map((row) => row.relation);
const counterfactual = readJsonl<CounterfactualDecision>(
	join(projectRoot, requireString(failed, "counterfactualDecisions")),
);
const diagnosticCanonicalIds = new Set(
	counterfactual
		.filter((decision) => decision.finalState === "CANONICAL")
		.map((decision) => decision.relationId),
);
const selectedIds = new Set(selection.selected.map((relation) => relation.id));
const diagnosticKept = [...diagnosticCanonicalIds].filter((id) => selectedIds.has(id));
const previousSimilarity = meanSiblingSimilarity(
	previousSelected,
	newEndpointIds,
	endpointStatements,
);
const repairedSimilarity = meanSiblingSimilarity(
	selection.selected,
	newEndpointIds,
	endpointStatements,
);
const similarityRatio =
	previousSimilarity === 0 ? 1 : Number((repairedSimilarity / previousSimilarity).toFixed(6));
const acceptance = requireRecord(contract, "offlineAcceptance");
const candidateReduction = selection.deferred.length / relations.length;
const machineGate = {
	candidateAccountingExact:
		relations.length === selection.selected.length + selection.deferred.length,
	selectedAtMostAuditBudget: selection.selected.length <= 24,
	maximumNewEndpointDegree:
		maxNewEndpointDegree(selection.selected, newEndpointIds) <=
		Number(acceptance.maximumNewEndpointDegree),
	minimumPressureCandidateReduction:
		candidateReduction >= Number(acceptance.minimumPressureCandidateReduction),
	counterfactualCanonicalDiagnosticRecall:
		diagnosticCanonicalIds.size === 0 ||
		diagnosticKept.length / diagnosticCanonicalIds.size >=
			Number(acceptance.counterfactualCanonicalDiagnosticRecall),
	maximumMeanSiblingSimilarityVersusPreviousSelector:
		similarityRatio <= Number(acceptance.maximumMeanSiblingSimilarityVersusPreviousSelector),
	modelCalls: Number(acceptance.modelCalls) === 0,
	deferredConsumerExposure: Number(acceptance.deferredConsumerExposure) === 0,
};

const runId = process.env.WGE_RELATION_LIFECYCLE_FACET_REPLAY?.trim() || "v9-facet-mmr-v1";
if (!/^[a-zA-Z0-9._-]+$/.test(runId)) throw new Error(`Invalid replay id: ${runId}`);
const runRoot = join(projectRoot, "experiments", "goal3", "relation-lifecycle-facet-runs", runId);
if (existsSync(runRoot)) throw new Error(`Facet replay already exists: ${runRoot}`);
mkdirSync(runRoot, { recursive: true });

writeJsonl(
	join(runRoot, "decisions.jsonl"),
	selection.decisions.map((decision) => ({ sourceId, ...decision })),
);
const sample = deterministicSample(selection.deferred, 12, runId).map((relation) => ({
	relationId: relation.id,
	type: relation.type,
	confidence: relation.confidence,
	from: endpoint(claimsById, relation.from as string),
	to: endpoint(claimsById, relation.to as string),
	conditions: relation.conditions,
	counterfactualFinalState:
		counterfactual.find((decision) => decision.relationId === relation.id)?.finalState ?? null,
}));
writeJsonl(join(runRoot, "deferred-sample.jsonl"), sample);
const report = {
	schemaVersion: "wge-goal3-relation-lifecycle-facet-replay/v1",
	status: Object.values(machineGate).every(Boolean)
		? "MACHINE_GATE_PASS_PENDING_DEFERRED_REVIEW"
		: "MACHINE_GATE_FAIL",
	stageBRead: false,
	contract: relative(projectRoot, contractPath),
	contractSha256: sha256(readFileSync(contractPath)),
	sourceId,
	input: { generated: relations.length, previousSelected: previousSelected.length },
	output: {
		selected: selection.selected.length,
		deferred: selection.deferred.length,
		candidateReduction: Number(candidateReduction.toFixed(6)),
		maxNewEndpointDegree: maxNewEndpointDegree(selection.selected, newEndpointIds),
		diagnosticCanonicalKept: diagnosticKept.length,
		diagnosticCanonicalTotal: diagnosticCanonicalIds.size,
		diagnosticCanonicalMissed: [...diagnosticCanonicalIds].filter((id) => !selectedIds.has(id)),
		previousMeanSiblingSimilarity: Number(previousSimilarity.toFixed(6)),
		repairedMeanSiblingSimilarity: Number(repairedSimilarity.toFixed(6)),
		similarityRatio,
	},
	machineGate,
	modelCalls: 0,
	createdAt: new Date().toISOString(),
};
writeJson(join(runRoot, "report.json"), report);
console.log(JSON.stringify(report, null, 2));

function meanSiblingSimilarity(
	relations: Relation[],
	newEndpointIds: Set<string>,
	statements: Map<string, string>,
): number {
	const oppositeByEndpoint = new Map<string, string[]>();
	for (const relation of relations) {
		for (const endpointId of [relation.from as string, relation.to as string]) {
			if (!newEndpointIds.has(endpointId)) continue;
			const oppositeId =
				(relation.from as string) === endpointId
					? (relation.to as string)
					: (relation.from as string);
			const existing = oppositeByEndpoint.get(endpointId) ?? [];
			existing.push(statements.get(oppositeId) ?? "");
			oppositeByEndpoint.set(endpointId, existing);
		}
	}
	const similarities: number[] = [];
	for (const siblings of oppositeByEndpoint.values()) {
		for (let left = 0; left < siblings.length; left += 1) {
			for (let right = left + 1; right < siblings.length; right += 1) {
				similarities.push(endpointLexicalAffinity(siblings[left] ?? "", siblings[right] ?? ""));
			}
		}
	}
	return similarities.length === 0
		? 0
		: similarities.reduce((sum, value) => sum + value, 0) / similarities.length;
}

function maxNewEndpointDegree(relations: Relation[], newEndpointIds: Set<string>): number {
	const degree = new Map<string, number>();
	for (const relation of relations) {
		for (const endpointId of [relation.from as string, relation.to as string]) {
			if (newEndpointIds.has(endpointId)) {
				degree.set(endpointId, (degree.get(endpointId) ?? 0) + 1);
			}
		}
	}
	return Math.max(0, ...degree.values());
}

function endpoint(claims: Map<string, Claim>, id: string) {
	const claim = claims.get(id);
	return { id, statement: claim?.statement ?? null, conditions: claim?.conditions ?? [] };
}

function deterministicSample(relations: Relation[], limit: number, seed: string): Relation[] {
	return [...relations]
		.sort((left, right) =>
			sha256(Buffer.from(`${seed}\n${left.id}`)).localeCompare(
				sha256(Buffer.from(`${seed}\n${right.id}`)),
			),
		)
		.slice(0, limit);
}

function groupBy<T, K>(items: T[], key: (item: T) => K): Map<K, T[]> {
	const grouped = new Map<K, T[]>();
	for (const item of items) {
		const groupKey = key(item);
		const existing = grouped.get(groupKey) ?? [];
		existing.push(item);
		grouped.set(groupKey, existing);
	}
	return grouped;
}

function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, "utf8")) as T;
}

function readJsonl<T>(path: string): T[] {
	return readFileSync(path, "utf8")
		.split("\n")
		.filter((row) => row.trim().length > 0)
		.map((row) => JSON.parse(row) as T);
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
	if (sha256(readFileSync(path)) !== expected) throw new Error(`Frozen input drift: ${path}`);
}

function sha256(value: Buffer): string {
	return createHash("sha256").update(value).digest("hex");
}

function requireRecord(value: JsonRecord, key: string): JsonRecord {
	const candidate = value[key];
	if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
		throw new Error(`Expected object: ${key}`);
	}
	return candidate as JsonRecord;
}

function requireString(value: JsonRecord, key: string): string {
	const candidate = value[key];
	if (typeof candidate !== "string" || candidate.length === 0) {
		throw new Error(`Expected string: ${key}`);
	}
	return candidate;
}
