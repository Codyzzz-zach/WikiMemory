import { createHash, randomUUID } from "node:crypto";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import { loadConfig } from "../src/config/index.js";
import { createLLMProvider } from "../src/core/llm-provider.js";
import { lintRelationsAgainstCanonicalClaims } from "../src/linter/index.js";
import { readAllClaims, readAllSpans } from "../src/linter/storage.js";
import type { Relation } from "../src/types/index.js";

type JsonRecord = Record<string, unknown>;
interface CandidateLedgerRow {
	sourceId: string;
	relation: Relation;
}
interface PriorDecision {
	relationId: string;
	finalState: "CANONICAL" | "QUARANTINED";
}

const projectRoot = resolve(import.meta.dirname, "..");
const contractPath = join(
	projectRoot,
	"experiments",
	"goal3",
	"goal3-related-to-batch-utility-contract-v1.json",
);
const contract = readJson<JsonRecord>(contractPath);
if (contract.status !== "FROZEN_BEFORE_BATCH_IMPLEMENTATION" || contract.stageBRead !== false) {
	throw new Error("Batch utility contract is not frozen or Stage B isolation drifted");
}
const failed = requireRecord(contract, "failedPreAuditRanking");
assertSha256(
	join(projectRoot, requireString(failed, "report")),
	requireString(failed, "reportSha256"),
);
assertSha256(
	join(projectRoot, requireString(failed, "review")),
	requireString(failed, "reviewSha256"),
);
const replayContract = requireRecord(contract, "frozenReplay");
const controlledContractPath = join(
	projectRoot,
	"experiments",
	"goal3",
	"goal3-related-to-batch-utility-controlled-replay-contract-v1.json",
);
const controlledContract = readJson<JsonRecord>(controlledContractPath);
if (
	controlledContract.status !== "FROZEN_BEFORE_CONTROLLED_REPLAY" ||
	controlledContract.stageBRead !== false
) {
	throw new Error("Controlled utility replay contract is not frozen or Stage B isolation drifted");
}
const controlledFailed = requireRecord(controlledContract, "failedReplay");
assertSha256(
	join(projectRoot, requireString(controlledFailed, "report")),
	requireString(controlledFailed, "reportSha256"),
);
const control = requireRecord(controlledContract, "control");
const primaryCacheSource = join(projectRoot, requireString(control, "primaryAuditCache"));
assertDirectoryAggregate(
	primaryCacheSource,
	requireString(control, "primaryAuditCacheAggregateSha256"),
);

const productionWorkspace = join(
	projectRoot,
	"experiments",
	"goal3",
	"s200-runs",
	"compile-v9-relation-lifecycle-12source",
	"workspace",
);
const candidateRows = readJsonl<CandidateLedgerRow>(
	join(productionWorkspace, "runs", "relation-candidate-ledger.jsonl"),
);
const bySource = groupBy(candidateRows, (row) => row.sourceId);
const pressureSources = [...bySource.entries()].filter(([, rows]) => rows.length > 24);
if (pressureSources.length !== 1) throw new Error("Frozen pressure-source count drifted");
const [sourceId, pressureRows] = pressureSources[0] as [string, CandidateLedgerRow[]];
if (pressureRows.length !== 42)
	throw new Error(`Frozen pressure input drift: ${pressureRows.length}`);

const productionConfig = loadConfig({ projectRoot: productionWorkspace, apiKey: "" });
const claims = readAllClaims(productionConfig);
const spans = readAllSpans(productionConfig);
const relationIds = new Set(pressureRows.map((row) => row.relation.id));
const priorDecisions = readJsonl<PriorDecision>(
	join(
		projectRoot,
		"experiments",
		"goal3",
		"relation-lifecycle-counterfactuals",
		"v9-unbounded-v1",
		"relation-decisions.jsonl",
	),
).filter((decision) => relationIds.has(decision.relationId));
if (priorDecisions.length !== 42) throw new Error("Prior per-item decision accounting drifted");
const priorCanonicalIds = new Set(
	priorDecisions
		.filter((decision) => decision.finalState === "CANONICAL")
		.map((decision) => decision.relationId),
);

const runId = process.env.WGE_RELATED_TO_BATCH_REPLAY?.trim() || "v9-batch-utility-v1";
if (!/^[a-zA-Z0-9._-]+$/.test(runId)) throw new Error(`Invalid replay id: ${runId}`);
const runRoot = join(projectRoot, "experiments", "goal3", "related-to-batch-runs", runId);
if (existsSync(runRoot)) throw new Error(`Batch replay already exists: ${runRoot}`);
for (const directory of ["sources", "wiki", "quarantine", "indexes", "runs", "publications"]) {
	mkdirSync(join(runRoot, directory), { recursive: true });
}
const primaryCacheTarget = join(runRoot, "runs", "relation-audit-cache");
mkdirSync(primaryCacheTarget, { recursive: true });
for (const name of readdirSync(primaryCacheSource)
	.filter((item) => item.endsWith(".json"))
	.sort()) {
	copyFileSync(join(primaryCacheSource, name), join(primaryCacheTarget, name));
}

const config = loadConfig({
	projectRoot: runRoot,
	model: requireString(replayContract, "model"),
	temperature: Number(replayContract.temperature),
});
if (!config.apiKey) throw new Error("DEEPSEEK_API_KEY not set");
const provider = createLLMProvider(config);
const compileRun = { sourceId, runId: randomUUID(), model: config.model };
const results = await lintRelationsAgainstCanonicalClaims(
	config,
	pressureRows.map((row) => resetRelation(row.relation)),
	claims,
	spans,
	provider,
	{ run: compileRun },
);
writeJsonl(
	join(runRoot, "relation-decisions.jsonl"),
	results.map((result) => ({
		relationId: result.object.id,
		finalState: result.finalState,
		issueCodes: result.issues.map((issue) => issue.code),
	})),
);

const calls = readJsonl<JsonRecord>(join(runRoot, "runs", "llm-calls.jsonl"));
const modelCalls = calls.filter((call) => call.usage !== undefined);
const totalTokens = modelCalls.reduce(
	(sum, call) => sum + Number((call.usage as JsonRecord | undefined)?.totalTokens ?? 0),
	0,
);
const primaryModelCalls = modelCalls.filter((call) =>
	String(call.batchId ?? "").startsWith("relation-audit-batch-"),
);
const utilityModelCalls = modelCalls.filter((call) =>
	String(call.batchId ?? "").startsWith("related-to-utility-batch-"),
);
const utilityTokens = utilityModelCalls.reduce(
	(sum, call) => sum + Number((call.usage as JsonRecord | undefined)?.totalTokens ?? 0),
	0,
);
const priorUtilityTokens = Number(control.priorPerItemUtilityTokens);
const utilityTokenReduction = 1 - utilityTokens / priorUtilityTokens;
const canonicalIds = new Set(
	results.filter((result) => result.finalState === "CANONICAL").map((result) => result.object.id),
);
const priorCanonicalKept = [...priorCanonicalIds].filter((id) => canonicalIds.has(id));
const additionalCanonical = [...canonicalIds].filter((id) => !priorCanonicalIds.has(id));
const acceptance = requireRecord(controlledContract, "acceptance");
const parentAcceptance = requireRecord(contract, "acceptance");
const machineGate = {
	objectAccountingExact: results.length === 42,
	primaryModelCalls: primaryModelCalls.length === Number(acceptance.primaryModelCalls),
	priorCanonicalDiagnosticRecall:
		priorCanonicalIds.size === 0 ||
		priorCanonicalKept.length / priorCanonicalIds.size >=
			Number(acceptance.minimumPriorCanonicalDiagnosticRecall),
	utilityTokenReduction: utilityTokenReduction >= Number(acceptance.minimumUtilityTokenReduction),
	maximumBatchItems: utilityModelCalls.every(
		(call) => batchSize(String(call.batchId)) <= Number(parentAcceptance.maximumBatchItems),
	),
	noCanonicalPublicationWrites: readdirSync(join(runRoot, "publications")).length === 0,
};
const report = {
	schemaVersion: "wge-goal3-related-to-batch-replay/v1",
	status: Object.values(machineGate).every(Boolean)
		? "MACHINE_GATE_PASS_PENDING_ADDITIONAL_CANONICAL_REVIEW"
		: "MACHINE_GATE_FAIL",
	stageBRead: false,
	contract: relative(projectRoot, contractPath),
	contractSha256: sha256(readFileSync(contractPath)),
	controlledContract: relative(projectRoot, controlledContractPath),
	controlledContractSha256: sha256(readFileSync(controlledContractPath)),
	input: { sourceId, relations: pressureRows.length },
	output: {
		canonical: canonicalIds.size,
		quarantined: results.length - canonicalIds.size,
		priorCanonicalKept: priorCanonicalKept.length,
		priorCanonicalTotal: priorCanonicalIds.size,
		priorCanonicalMissed: [...priorCanonicalIds].filter((id) => !canonicalIds.has(id)),
		additionalCanonical,
	},
	cost: {
		priorPerItemUtilityTokens: priorUtilityTokens,
		batchedUtilityTokens: utilityTokens,
		utilityTokenReduction: Number(utilityTokenReduction.toFixed(6)),
		totalReplayTokens: totalTokens,
		modelCalls: modelCalls.length,
		primaryModelCalls: primaryModelCalls.length,
		utilityBatchCalls: utilityModelCalls.length,
	},
	machineGate,
	createdAt: new Date().toISOString(),
};
writeJson(join(runRoot, "report.json"), report);
console.log(JSON.stringify(report, null, 2));

function batchSize(batchId: string): number {
	const match = /^related-to-utility-batch-(\d+)-/.exec(batchId);
	return match ? Number(match[1]) : 0;
}

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

function assertDirectoryAggregate(directory: string, expected: string): void {
	const manifest = readdirSync(directory)
		.filter((name) => name.endsWith(".json"))
		.sort()
		.map(
			(name) =>
				`${sha256(readFileSync(join(directory, name)))}  ${relative(projectRoot, join(directory, name))}\n`,
		)
		.join("");
	if (sha256(Buffer.from(manifest)) !== expected) {
		throw new Error(`Frozen directory aggregate drift: ${directory}`);
	}
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
