import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { resolveSpanById } from "../src/linter/storage.js";
import type { Claim, Relation, SourceSpan } from "../src/types/index.js";

type JsonRecord = Record<string, unknown>;

const projectRoot = resolve(process.cwd());
const runRoot = join(
	projectRoot,
	"experiments/goal3/s200-runs/compile-v10-post-audit-compaction-4source",
);
const workspaceRoot = join(runRoot, "workspace");
const runsRoot = join(workspaceRoot, "runs");
const completionPath = join(runRoot, "completion.json");
const ledgerPath = join(runsRoot, "relation-candidate-ledger.jsonl");
const funnelPath = join(runsRoot, "relation-funnel.jsonl");
const llmCallsPath = join(runsRoot, "llm-calls.jsonl");
const outputPath = join(runRoot, "validation.json");

const completion = readJson(completionPath);
const ledger = readJsonl(ledgerPath);
const funnel = readJsonl(funnelPath);
const llmCalls = readJsonl(llmCallsPath);
const publications = readDirectoryJson(join(workspaceRoot, "publications"));
const allClaims = publications.flatMap((publication) =>
	Array.isArray(publication.claims) ? (publication.claims as Claim[]) : [],
);
const allRelations = publications.flatMap((publication) =>
	Array.isArray(publication.relations) ? (publication.relations as Relation[]) : [],
);
const allSpans = readdirSync(join(workspaceRoot, "sources"))
	.filter((file) => file.endsWith(".spans.jsonl"))
	.flatMap((file) => readJsonl<SourceSpan>(join(workspaceRoot, "sources", file)));
const claimIds = new Set(allClaims.map((claim) => claim.id));

const stages = ["DETECTION", "LINT", "COMPACTION", "PUBLISH"] as const;
const eventsBySource = new Map<string, Map<string, JsonRecord>>();
for (const event of funnel) {
	const sourceId = String(event.sourceId ?? "");
	const stage = String(event.stage ?? "");
	const sourceEvents = eventsBySource.get(sourceId) ?? new Map<string, JsonRecord>();
	sourceEvents.set(stage, event);
	eventsBySource.set(sourceId, sourceEvents);
}

const sourceAccounting = [...eventsBySource.entries()].map(([sourceId, events]) => {
	const detection = payload(events.get("DETECTION"));
	const lint = payload(events.get("LINT"));
	const compaction = payload(events.get("COMPACTION"));
	const publish = payload(events.get("PUBLISH"));
	const lintResults = asArray(lint.results);
	const generated = number(detection.generatedRelationCount);
	const selectedForAudit = number(detection.selectedForAuditCount);
	const deferredByAuditBudget = number(detection.deferredRelationCount);
	const auditedPassed = lintResults.filter(
		(item) => asRecord(item).finalState === "CANONICAL",
	).length;
	const quarantined = lintResults.filter(
		(item) => asRecord(item).finalState === "QUARANTINED",
	).length;
	const canonicalReady = number(compaction.canonicalReadyCount);
	const deferredByGraphDiversity = number(compaction.deferredByGraphDiversityCount);
	return {
		sourceId,
		allStagesExecuted: stages.every((stage) => events.has(stage)),
		generated,
		selectedForAudit,
		deferredByAuditBudget,
		auditedPassed,
		quarantined,
		canonicalReady,
		deferredByGraphDiversity,
		publishedCanonical: asArray(publish.canonicalRelationIds).length,
		publishedQuarantine: asArray(publish.quarantinedRelationIds).length,
		preAuditAccountingExact: generated === selectedForAudit + deferredByAuditBudget,
		semanticAuditAccountingExact: selectedForAudit === auditedPassed + quarantined,
		postAuditAccountingExact: auditedPassed === canonicalReady + deferredByGraphDiversity,
		publicationAccountingExact:
			canonicalReady === asArray(publish.canonicalRelationIds).length &&
			quarantined === asArray(publish.quarantinedRelationIds).length,
	};
});

const completedCalls = llmCalls.filter((event) => event.eventType === "LLM_CALL_COMPLETED");
const parseEvents = llmCalls.filter((event) => event.eventType === "LLM_PARSE_RESULT");
const utilityCalls = completedCalls.filter((event) =>
	String(event.batchId ?? "").startsWith("related-to-utility-batch-"),
);
const utilityBatchSizes = utilityCalls.map((event) => {
	const match = String(event.batchId).match(/^related-to-utility-batch-(\d+)-/u);
	return match ? Number(match[1]) : Number.NaN;
});
const utilityParseValid = utilityCalls.every((call) =>
	parseEvents.some((event) => event.callId === call.callId && event.outcome === "VALID"),
);
const postAuditLedger = ledger.filter(
	(entry) => entry.schemaVersion === "wge-relation-post-audit-ledger/v1",
);
const postAuditDeferred = postAuditLedger.filter(
	(entry) => entry.selectionState === "DEFERRED_BY_GRAPH_DIVERSITY",
);
const preAuditDeferred = ledger.filter((entry) => entry.selectionState === "DEFERRED_BY_BUDGET");
const deferredIds = new Set(
	[...postAuditDeferred, ...preAuditDeferred].map((entry) =>
		String(asRecord(entry.relation).id ?? ""),
	),
);
const publishedRelationIds = new Set(allRelations.map((relation) => relation.id));
const canonicalCrossRelations = allRelations.filter(
	(relation) => relation.source === "cross-material-detect",
);
const canonicalResolvable = canonicalCrossRelations.every(
	(relation) =>
		claimIds.has(relation.from as string) &&
		claimIds.has(relation.to as string) &&
		relation.evidenceSpanIds.length > 0 &&
		relation.evidenceSpanIds.every((id) => resolveSpanById(allSpans, id) !== null),
);
const totalTokens = completedCalls.reduce(
	(sum, event) => sum + number(asRecord(event.usage).totalTokens),
	0,
);
const utilityTokens = utilityCalls.reduce(
	(sum, event) => sum + number(asRecord(event.usage).totalTokens),
	0,
);
const generatedTypes = ledger
	.filter((entry) => entry.schemaVersion === "wge-relation-candidate-ledger/v1")
	.reduce<Record<string, number>>((counts, entry) => {
		const type = String(asRecord(entry.relation).type ?? "UNKNOWN");
		counts[type] = (counts[type] ?? 0) + 1;
		return counts;
	}, {});
const issueCounts = funnel
	.filter((event) => event.stage === "LINT")
	.flatMap((event) => asArray(payload(event).results))
	.flatMap((result) => asArray(asRecord(result).issueCodes))
	.reduce<Record<string, number>>((counts, code) => {
		const key = String(code);
		counts[key] = (counts[key] ?? 0) + 1;
		return counts;
	}, {});

const allAccountingPass = sourceAccounting.every(
	(source) =>
		source.allStagesExecuted &&
		source.preAuditAccountingExact &&
		source.semanticAuditAccountingExact &&
		source.postAuditAccountingExact &&
		source.publicationAccountingExact,
);
const deferredConsumerExposure = [...deferredIds].filter((id) =>
	publishedRelationIds.has(id),
).length;
const deferredByGraphDiversityCount = postAuditDeferred.length;
const machinePass =
	completion.status === "CANARY_PASS" &&
	number(completion.failed) === 0 &&
	totalTokens <= 450_000 &&
	allAccountingPass &&
	utilityBatchSizes.every((size) => Number.isSafeInteger(size) && size <= 8) &&
	utilityParseValid &&
	deferredConsumerExposure === 0 &&
	canonicalResolvable;

const report = {
	schemaVersion: "wge-goal3-post-audit-compaction-canary-validation/v1",
	createdAt: new Date().toISOString(),
	stageBRead: false,
	contract: "experiments/goal3/goal3-post-audit-compaction-canary-contract-v1.json",
	inputs: {
		completionSha256: sha256(completionPath),
		candidateLedgerSha256: sha256(ledgerPath),
		relationFunnelSha256: sha256(funnelPath),
		llmCallsSha256: sha256(llmCallsPath),
	},
	run: {
		status: completion.status,
		sources: number(completion.selectedSourceCount),
		failures: number(completion.failed),
		model: completion.model,
		temperature: completion.temperature,
		totalModelCalls: completedCalls.length,
		totalTokens,
		maximumTotalTokens: 450000,
	},
	sourceAccounting,
	utilityBatch: {
		calls: utilityCalls.length,
		batchSizes: utilityBatchSizes,
		maximumBatchSize: Math.max(0, ...utilityBatchSizes),
		allParseResultsValid: utilityParseValid,
		tokens: utilityTokens,
	},
	lifecycle: {
		generatedTypes,
		preAuditDeferred: preAuditDeferred.length,
		postAuditLedgerEntries: postAuditLedger.length,
		deferredByGraphDiversity: deferredByGraphDiversityCount,
		deferredConsumerExposure,
		canonicalCrossRelations: canonicalCrossRelations.length,
		canonicalEndpointsAndEvidenceResolvable: canonicalResolvable,
		strongRelationBypassExercised: postAuditLedger.some(
			(entry) => entry.selectionReason === "STRONG_RELATION_BYPASS",
		),
	},
	observedSignals: {
		issueCounts,
		strongSupportCandidatesGenerated: generatedTypes.SUPPORTS ?? 0,
		strongSupportCandidatesPublished: canonicalCrossRelations.filter(
			(relation) => relation.type === "SUPPORTS",
		).length,
		note: "The semantic gate rejected every generated SUPPORTS candidate. This is safe but indicates detector over-classification and avoidable audit cost; it is not a compaction failure.",
	},
	machineGates: {
		completionAndBudget: completion.status === "CANARY_PASS" && totalTokens <= 450_000,
		allAccountingExact: allAccountingPass,
		utilityBatchBoundedAndValid:
			utilityBatchSizes.every((size) => Number.isSafeInteger(size) && size <= 8) &&
			utilityParseValid,
		deferredConsumerIsolation: deferredConsumerExposure === 0,
		canonicalReferencesResolvable: canonicalResolvable,
	},
	status: machinePass
		? deferredByGraphDiversityCount > 0
			? "REAL_PRESSURE_PASS_PENDING_MANUAL_CANONICAL_SET_REVIEW"
			: "PASS_WITHOUT_POST_AUDIT_PRESSURE"
		: "FAIL",
};

writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

function readJson(path: string): JsonRecord {
	return asRecord(JSON.parse(readFileSync(path, "utf8")) as unknown);
}

function readJsonl<T = JsonRecord>(path: string): T[] {
	return readFileSync(path, "utf8")
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line) as T);
}

function readDirectoryJson(path: string): JsonRecord[] {
	return readdirSync(path)
		.filter((file) => file.endsWith(".json"))
		.map((file) => readJson(join(path, file)));
}

function payload(event: JsonRecord | undefined): JsonRecord {
	return asRecord(event?.payload);
}

function asRecord(value: unknown): JsonRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as JsonRecord)
		: {};
}

function asArray(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function number(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function sha256(path: string): string {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}
