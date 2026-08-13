import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { resolveSpanById } from "../src/linter/storage.js";
import type { Claim, Relation, SourceSpan } from "../src/types/index.js";

type JsonRecord = Record<string, unknown>;

const projectRoot = resolve(process.cwd());
const runRoot = join(projectRoot, "experiments/goal3/s200-runs/compile-v11-support-router-4source");
const workspaceRoot = join(runRoot, "workspace");
const runsRoot = join(workspaceRoot, "runs");
const contractPath = join(
	projectRoot,
	"experiments/goal4/goal4-support-router-online-canary-contract-v1.json",
);
const outputPath = join(runRoot, "goal4-validation.json");
const completion = readJson(join(runRoot, "completion.json"));
const contract = readJson(contractPath);
const funnel = readJsonl(join(runsRoot, "relation-funnel.jsonl"));
const ledger = readJsonl(join(runsRoot, "relation-candidate-ledger.jsonl"));
const llmCalls = readJsonl(join(runsRoot, "llm-calls.jsonl"));
const publications = readDirectoryJson(join(workspaceRoot, "publications"));
const quarantines = readDirectoryJson(join(workspaceRoot, "quarantine/publications"));
const allClaims = publications.flatMap((publication) => asArray(publication.claims) as Claim[]);
const allRelations = publications.flatMap(
	(publication) => asArray(publication.relations) as Relation[],
);
const quarantinedRelations = quarantines.flatMap((publication) =>
	asArray(publication.relations).map((entry) => asRecord(entry).relation as Relation),
);
const allSpans = readdirSync(join(workspaceRoot, "sources"))
	.filter((file) => file.endsWith(".spans.jsonl"))
	.flatMap((file) => readJsonl<SourceSpan>(join(workspaceRoot, "sources", file)));
const claimIds = new Set(allClaims.map((claim) => claim.id));
const publishedRelationIds = new Set(allRelations.map((relation) => relation.id));
const quarantinedRelationIds = new Set(quarantinedRelations.map((relation) => relation.id));

const eventsBySource = new Map<string, Map<string, JsonRecord>>();
for (const event of funnel) {
	const sourceId = String(event.sourceId ?? "");
	const sourceEvents = eventsBySource.get(sourceId) ?? new Map<string, JsonRecord>();
	sourceEvents.set(String(event.stage ?? ""), event);
	eventsBySource.set(sourceId, sourceEvents);
}

const routerLedger = ledger.filter(
	(entry) => entry.schemaVersion === "wge-relation-preaudit-router-ledger/v1",
);
const routerBySource = groupBy(routerLedger, (entry) => String(entry.sourceId ?? ""));
const sourceAccounting = [...eventsBySource.entries()].map(([sourceId, events]) => {
	const detection = payload(events.get("DETECTION"));
	const routing = payload(events.get("TYPE_ROUTING"));
	const lint = payload(events.get("LINT"));
	const compaction = payload(events.get("COMPACTION"));
	const publish = payload(events.get("PUBLISH"));
	const generated = number(detection.generatedRelationCount);
	const selectedBeforeRouter = number(routing.selectedBeforeRouterCount);
	const deferredByAuditBudget = number(detection.deferredRelationCount);
	const fullAudit = number(routing.fullAuditCount);
	const deferredByTypeRouter = number(routing.deferredByTypeRouterCount);
	const lintResults = asArray(lint.results).map(asRecord);
	const auditedPassed = lintResults.filter((item) => item.finalState === "CANONICAL").length;
	const quarantined = lintResults.filter((item) => item.finalState === "QUARANTINED").length;
	const canonicalReady = number(compaction.canonicalReadyCount);
	const deferredByGraphDiversity = number(compaction.deferredByGraphDiversityCount);
	const routerEntries = routerBySource.get(sourceId) ?? [];
	const routerDecisionIds = new Set(
		routerEntries.map((entry) => String(asRecord(entry.relation).id ?? "")),
	);
	const lintIds = new Set(lintResults.map((entry) => String(entry.relationId ?? "")));
	const selectedRelations = asArray(detection.proposedRelations).map(asRecord);
	const nonSupportBypassExact = selectedRelations
		.filter((relation) => relation.type !== "SUPPORTS")
		.every(
			(relation) =>
				!routerDecisionIds.has(String(relation.id ?? "")) && lintIds.has(String(relation.id ?? "")),
		);
	const routedLifecycleExact = routerEntries.every((entry) => {
		const relation = asRecord(entry.relation);
		const id = String(relation.id ?? "");
		if (relation.type !== "SUPPORTS" || relation.publicationState !== "CANDIDATE") return false;
		return entry.selectionState === "DEFER_BY_TYPE_ROUTER"
			? !lintIds.has(id) && !publishedRelationIds.has(id) && !quarantinedRelationIds.has(id)
			: entry.selectionState === "FULL_AUDIT" && lintIds.has(id);
	});
	return {
		sourceId,
		allStagesExecuted: ["DETECTION", "TYPE_ROUTING", "LINT", "COMPACTION", "PUBLISH"].every(
			(stage) => events.has(stage),
		),
		generated,
		selectedBeforeRouter,
		deferredByAuditBudget,
		fullAudit,
		deferredByTypeRouter,
		auditedPassed,
		quarantined,
		canonicalReady,
		deferredByGraphDiversity,
		publishedCanonical: asArray(publish.canonicalRelationIds).length,
		publishedQuarantine: asArray(publish.quarantinedRelationIds).length,
		sourceBudgetAccountingExact: generated === selectedBeforeRouter + deferredByAuditBudget,
		typeRouterAccountingExact: selectedBeforeRouter === fullAudit + deferredByTypeRouter,
		semanticAuditAccountingExact: fullAudit === auditedPassed + quarantined,
		postAuditAccountingExact: auditedPassed === canonicalReady + deferredByGraphDiversity,
		publicationAccountingExact:
			canonicalReady === asArray(publish.canonicalRelationIds).length &&
			quarantined === asArray(publish.quarantinedRelationIds).length,
		nonSupportBypassExact,
		routedLifecycleExact,
	};
});

const completedCalls = llmCalls.filter((event) => event.eventType === "LLM_CALL_COMPLETED");
const parseResults = llmCalls.filter((event) => event.eventType === "LLM_PARSE_RESULT");
const routerCalls = completedCalls.filter((event) =>
	String(event.batchId ?? "").startsWith("support-router-"),
);
const routerParseValid = routerCalls.every((call) =>
	parseResults.some((event) => event.callId === call.callId && event.outcome === "VALID"),
);
const totalTokens = completedCalls.reduce(
	(sum, event) => sum + number(asRecord(event.usage).totalTokens),
	0,
);
const maximumTotalTokens = number(asRecord(contract.runtime).maximumTotalTokens);
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
const deferredEntries = routerLedger.filter(
	(entry) => entry.selectionState === "DEFER_BY_TYPE_ROUTER",
);
const failedOpenEntries = routerLedger.filter((entry) => entry.decisionSource === "FAIL_OPEN");
const accountingAndLifecyclePass = sourceAccounting.every(
	(source) =>
		source.allStagesExecuted &&
		source.sourceBudgetAccountingExact &&
		source.typeRouterAccountingExact &&
		source.semanticAuditAccountingExact &&
		source.postAuditAccountingExact &&
		source.publicationAccountingExact &&
		source.nonSupportBypassExact &&
		source.routedLifecycleExact,
);
const machineGates = {
	completion:
		completion.status === "CANARY_PASS" &&
		number(completion.selectedSourceCount) === 4 &&
		number(completion.failed) === 0,
	accountingAndLifecycle: accountingAndLifecyclePass,
	routerProtocol: routerParseValid || failedOpenEntries.length > 0,
	canonicalReferencesResolvable: canonicalResolvable,
	totalTokenBudget: totalTokens <= maximumTotalTokens,
};
const report = {
	schemaVersion: "wge-goal4-support-router-online-canary-validation/v1",
	createdAt: new Date().toISOString(),
	stageBRead: false,
	contract: "experiments/goal4/goal4-support-router-online-canary-contract-v1.json",
	inputs: {
		contractSha256: sha256(contractPath),
		completionSha256: sha256(join(runRoot, "completion.json")),
		candidateLedgerSha256: sha256(join(runsRoot, "relation-candidate-ledger.jsonl")),
		relationFunnelSha256: sha256(join(runsRoot, "relation-funnel.jsonl")),
		llmCallsSha256: sha256(join(runsRoot, "llm-calls.jsonl")),
	},
	run: {
		status: completion.status,
		sources: number(completion.selectedSourceCount),
		model: completion.model,
		temperature: completion.temperature,
		totalCalls: completedCalls.length,
		totalTokens,
		maximumTotalTokens,
	},
	sourceAccounting,
	router: {
		calls: routerCalls.length,
		tokens: routerCalls.reduce((sum, call) => sum + number(asRecord(call.usage).totalTokens), 0),
		decisions: routerLedger.length,
		fullAudit: routerLedger.filter((entry) => entry.selectionState === "FULL_AUDIT").length,
		deferred: deferredEntries.length,
		failedOpen: failedOpenEntries.length,
		allModelCallParseResultsValid: routerParseValid,
		deferredCanonicalExposure: deferredEntries.filter((entry) =>
			publishedRelationIds.has(String(asRecord(entry.relation).id ?? "")),
		).length,
		deferredQuarantineExposure: deferredEntries.filter((entry) =>
			quarantinedRelationIds.has(String(asRecord(entry.relation).id ?? "")),
		).length,
	},
	canonicalCrossRelationCount: canonicalCrossRelations.length,
	machineGates,
	status: Object.values(machineGates).every(Boolean)
		? "MACHINE_PASS_PENDING_MANUAL_REVIEW"
		: "MACHINE_FAIL_REQUIRES_DIAGNOSIS",
};
writeFileSync(outputPath, `${JSON.stringify(report, null, "\t")}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
	const groups = new Map<string, T[]>();
	for (const item of items) groups.set(key(item), [...(groups.get(key(item)) ?? []), item]);
	return groups;
}

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
