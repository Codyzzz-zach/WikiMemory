import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { loadConfig } from "../src/config/index.js";
import { createLLMProvider } from "../src/core/llm-provider.js";
import { lintRelationsAgainstCanonicalClaims } from "../src/linter/index.js";
import { readAllClaims, readAllSpans } from "../src/linter/storage.js";
import type { Claim, Relation } from "../src/types/index.js";

type JsonRecord = Record<string, unknown>;
interface CandidateLedgerRow {
	sourceId: string;
	relation: Relation;
	selectionState: "SELECTED_FOR_AUDIT" | "DEFERRED_BY_BUDGET";
}

const projectRoot = resolve(import.meta.dirname, "..");
const contractPath = join(
	projectRoot,
	"experiments",
	"goal3",
	"goal3-relation-lifecycle-e2e-repair-contract-v1.json",
);
const contract = readJson<JsonRecord>(contractPath);
if (contract.status !== "FROZEN_BEFORE_COUNTERFACTUAL_REPLAY" || contract.stageBRead !== false) {
	throw new Error("E2E repair contract is not frozen or Stage B isolation drifted");
}
const frozen = requireRecord(contract, "failedValidation");
const productionRunRoot = join(
	projectRoot,
	"experiments",
	"goal3",
	"s200-runs",
	"compile-v9-relation-lifecycle-12source",
);
const productionWorkspace = join(productionRunRoot, "workspace");
const candidateLedgerPath = join(productionWorkspace, "runs", "relation-candidate-ledger.jsonl");
assertSha256(join(projectRoot, requireString(frozen, "path")), requireString(frozen, "sha256"));
assertSha256(join(productionRunRoot, "completion.json"), requireString(frozen, "completionSha256"));
assertSha256(candidateLedgerPath, requireString(frozen, "candidateLedgerSha256"));

const replayName = process.env.WGE_RELATION_LIFECYCLE_COUNTERFACTUAL?.trim() || "v9-unbounded-v1";
if (!/^[a-zA-Z0-9._-]+$/.test(replayName)) throw new Error(`Invalid replay name: ${replayName}`);
const replayRoot = join(
	projectRoot,
	"experiments",
	"goal3",
	"relation-lifecycle-counterfactuals",
	replayName,
);
if (existsSync(replayRoot)) throw new Error(`Counterfactual output already exists: ${replayRoot}`);
for (const directory of ["sources", "wiki", "quarantine", "indexes", "runs", "publications"]) {
	mkdirSync(join(replayRoot, directory), { recursive: true });
}

const candidateRows = readJsonl<CandidateLedgerRow>(candidateLedgerPath);
const bySource = groupBy(candidateRows, (row) => row.sourceId);
// The frozen contract defines pressure as generated > 24. Keep the executable threshold explicit.
const pressureSources = [...bySource.entries()].filter(([, rows]) => rows.length > 24);
if (pressureSources.length !== 1) {
	throw new Error(`Expected exactly one frozen pressure source, found ${pressureSources.length}`);
}
const [pressureSourceId, pressureRows] = pressureSources[0] as [string, CandidateLedgerRow[]];
if (pressureRows.length !== 42)
	throw new Error(`Frozen pressure candidate drift: ${pressureRows.length}`);

const productionConfig = loadConfig({ projectRoot: productionWorkspace, apiKey: "" });
const canonicalClaims = readAllClaims(productionConfig);
const allSpans = readAllSpans(productionConfig);
const claimsById = new Map(canonicalClaims.map((claim) => [claim.id, claim]));
const relations = pressureRows.map((row) => resetRelation(row.relation));
const unresolvedEndpoints = relations.flatMap((relation) =>
	[relation.from as string, relation.to as string].filter((id) => !claimsById.has(id)),
);
if (unresolvedEndpoints.length > 0) {
	throw new Error(`Counterfactual has unresolved endpoints: ${unresolvedEndpoints.join(", ")}`);
}

const config = loadConfig({
	projectRoot: replayRoot,
	model: "deepseek-v4-flash",
	temperature: 0,
});
if (!config.apiKey) throw new Error("DEEPSEEK_API_KEY not set");
const provider = createLLMProvider(config);
const run = { sourceId: pressureSourceId, runId: randomUUID(), model: config.model };
const started = process.hrtime.bigint();
const results = await lintRelationsAgainstCanonicalClaims(
	config,
	relations,
	canonicalClaims,
	allSpans,
	provider,
	{ run },
);
const elapsedMilliseconds = Number(process.hrtime.bigint() - started) / 1_000_000;
writeJsonl(
	join(replayRoot, "relation-decisions.jsonl"),
	results.map((result) => ({
		relationId: result.object.id,
		finalState: result.finalState,
		issueCodes: result.issues.map((issue) => issue.code),
	})),
);

const deferredRows = pressureRows.filter((row) => row.selectionState === "DEFERRED_BY_BUDGET");
const deferredSample = deterministicSample(deferredRows, 12, replayName).map((row) => ({
	sourceId: row.sourceId,
	relationId: row.relation.id,
	type: row.relation.type,
	confidence: row.relation.confidence,
	from: endpoint(claimsById, row.relation.from as string),
	to: endpoint(claimsById, row.relation.to as string),
	conditions: row.relation.conditions,
}));
writeJsonl(join(replayRoot, "deferred-sample.jsonl"), deferredSample);

const replayCalls = readJsonl<JsonRecord>(join(replayRoot, "runs", "llm-calls.jsonl"));
const unboundedAuditTokens = replayCalls.reduce(
	(sum, call) => sum + Number((call.usage as JsonRecord | undefined)?.totalTokens ?? 0),
	0,
);
const unboundedAuditCalls = replayCalls.filter((call) => call.usage !== undefined).length;
const actualSelectedAuditTokens = crossAuditTokensForSource(productionWorkspace, pressureSourceId);
const actualSelected = pressureRows.filter(
	(row) => row.selectionState === "SELECTED_FOR_AUDIT",
).length;
const tokenReduction =
	unboundedAuditTokens === 0 ? 0 : 1 - actualSelectedAuditTokens / unboundedAuditTokens;
const candidateReduction = deferredRows.length / pressureRows.length;
const acceptance = requireRecord(contract, "acceptance");
const machineGate = {
	candidateAccountingExact: pressureRows.length === actualSelected + deferredRows.length,
	pressureCandidateReduction:
		candidateReduction >= Number(acceptance.minimumCandidateReductionWithinPressureSources),
	relationAuditTokenReduction:
		tokenReduction >=
		Number(acceptance.minimumRelationAuditTokenReductionAgainstSameRunUnboundedReplay),
	noCanonicalPublicationWrites: readdirSync(join(replayRoot, "publications")).length === 0,
};
const report = {
	schemaVersion: "wge-goal3-relation-lifecycle-counterfactual/v1",
	status: Object.values(machineGate).every(Boolean)
		? "MACHINE_GATE_PASS_PENDING_DEFERRED_REVIEW"
		: "MACHINE_GATE_FAIL",
	stageBRead: false,
	contract: relative(projectRoot, contractPath),
	contractSha256: sha256(readFileSync(contractPath)),
	pressureSourceId,
	input: {
		generatedCandidates: pressureRows.length,
		actualSelectedCandidates: actualSelected,
		deferredCandidates: deferredRows.length,
	},
	cost: {
		actualSelectedAuditTokens,
		unboundedAuditTokens,
		unboundedAuditCalls,
		relationAuditTokenReduction: Number(tokenReduction.toFixed(6)),
		candidateReduction: Number(candidateReduction.toFixed(6)),
	},
	replayOutcome: {
		canonicalWouldBe: results.filter((result) => result.finalState === "CANONICAL").length,
		quarantinedWouldBe: results.filter((result) => result.finalState === "QUARANTINED").length,
	},
	machineGate,
	elapsedMilliseconds: Math.round(elapsedMilliseconds),
	createdAt: new Date().toISOString(),
};
writeJson(join(replayRoot, "report.json"), report);
console.log(JSON.stringify(report, null, 2));

function resetRelation(relation: Relation): Relation {
	return {
		...relation,
		validity: "UNRESOLVED",
		publicationState: "CANDIDATE",
		conditionStatus: "UNVERIFIED",
		supersessionEffect: null,
		relationAuditVersion: null,
	};
}

function endpoint(claims: Map<string, Claim>, id: string) {
	const claim = claims.get(id);
	return { id, statement: claim?.statement ?? null, conditions: claim?.conditions ?? [] };
}

function crossAuditTokensForSource(workspace: string, sourceId: string): number {
	const funnel = readJsonl<JsonRecord>(join(workspace, "runs", "relation-funnel.jsonl"));
	const calls = readJsonl<JsonRecord>(join(workspace, "runs", "llm-calls.jsonl"));
	const detection = funnel.find(
		(event) => event.stage === "DETECTION" && event.sourceId === sourceId,
	);
	if (!detection) throw new Error(`Missing cross detection event for ${sourceId}`);
	const lint = funnel.find(
		(event) =>
			event.stage === "LINT" &&
			event.runId === detection.runId &&
			Date.parse(String(event.timestamp)) >= Date.parse(String(detection.timestamp)),
	);
	if (!lint) throw new Error(`Missing cross lint event for ${sourceId}`);
	return calls
		.filter(
			(call) =>
				call.stage === "LINT" &&
				call.usage !== undefined &&
				call.runId === detection.runId &&
				Date.parse(String(call.timestamp)) >= Date.parse(String(detection.timestamp)) &&
				Date.parse(String(call.timestamp)) <= Date.parse(String(lint.timestamp)),
		)
		.reduce(
			(sum, call) => sum + Number((call.usage as JsonRecord | undefined)?.totalTokens ?? 0),
			0,
		);
}

function deterministicSample<T extends { relation: Relation }>(
	items: T[],
	limit: number,
	seed: string,
): T[] {
	return [...items]
		.sort((left, right) =>
			sha256(Buffer.from(`${seed}\n${left.relation.id}`)).localeCompare(
				sha256(Buffer.from(`${seed}\n${right.relation.id}`)),
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
