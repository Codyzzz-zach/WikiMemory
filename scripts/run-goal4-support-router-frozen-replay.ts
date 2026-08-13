import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadConfig } from "../src/config/index.js";
import { createLLMProvider } from "../src/core/llm-provider.js";
import { lintRelationsAgainstCanonicalClaims } from "../src/linter/index.js";
import { readAllClaims, readAllSpans, readJsonl } from "../src/linter/storage.js";
import { SUPPORT_PREAUDIT_ROUTER_VERSION } from "../src/prompts/index.js";
import { routeSupportCandidates } from "../src/relations/support-router.js";
import type { Claim, Relation } from "../src/types/index.js";

interface CandidateLedgerEntry {
	schemaVersion: string;
	sourceId: string;
	selectionState: string;
	relation: Relation;
}

interface LlmCallCompleted {
	eventType: string;
	stage: string;
	batchId: string;
	usage: { totalTokens?: number } | null;
}

const root = resolve(process.cwd());
const sourceId = "source:s200-ai-llama-004-0c1360ce9e6039ce";
const baselineRoot = join(
	root,
	"experiments/goal3/s200-runs/compile-v10-post-audit-compaction-4source/workspace",
);
const outputRoot = join(root, "experiments/goal4/support-router-runs/frozen-v10-source004-v1");
const reportPath = join(outputRoot, "report.json");
const contractPath = join(root, "experiments/goal4/goal4-support-preaudit-router-contract-v1.json");
const candidateLedgerPath = join(baselineRoot, "runs/relation-candidate-ledger.jsonl");
if (existsSync(reportPath)) {
	throw new Error(`Frozen replay is immutable once reported: ${reportPath}`);
}

const baselineConfig = loadConfig({ projectRoot: baselineRoot });
const outputConfig = {
	...loadConfig({ projectRoot: join(outputRoot, "workspace") }),
	temperature: 0,
};
if (!outputConfig.apiKey) throw new Error("DEEPSEEK_API_KEY not set");
mkdirSync(outputRoot, { recursive: true });

const selected = readJsonl<CandidateLedgerEntry>(candidateLedgerPath)
	.filter(
		(entry) =>
			entry.schemaVersion === "wge-relation-candidate-ledger/v1" &&
			entry.sourceId === sourceId &&
			entry.selectionState === "SELECTED_FOR_AUDIT",
	)
	.map((entry) => entry.relation);
assertCount("selected candidates", selected.length, 40);
assertCount(
	"SUPPORTS candidates",
	selected.filter((relation) => relation.type === "SUPPORTS").length,
	23,
);
assertCount(
	"RELATED_TO candidates",
	selected.filter((relation) => relation.type === "RELATED_TO").length,
	17,
);

const claims = readAllClaims(baselineConfig);
const spans = readAllSpans(baselineConfig);
const claimsById = new Map(claims.map((claim) => [claim.id, claim]));
const supportInputs = selected
	.filter((relation) => relation.type === "SUPPORTS")
	.map((relation) => ({
		relation,
		fromClaim: requiredClaim(claimsById, relation.from as string),
		toClaim: requiredClaim(claimsById, relation.to as string),
	}));
const run = {
	sourceId,
	runId: "goal4-frozen-v10-source004-v1",
	model: outputConfig.model,
};
const provider = createLLMProvider(outputConfig);
const routing = await routeSupportCandidates(outputConfig, supportInputs, provider, run);
const fullSupportIds = new Set(routing.fullAudit.map((relation) => relation.id));
const fullAuditRelations = selected.filter(
	(relation) => relation.type !== "SUPPORTS" || fullSupportIds.has(relation.id),
);
const lintResults = await lintRelationsAgainstCanonicalClaims(
	outputConfig,
	fullAuditRelations,
	claims,
	spans,
	provider,
	{ run },
);
const canonical = lintResults
	.filter((result) => result.finalState === "CANONICAL")
	.map((result) => result.object);
const quarantined = lintResults
	.filter((result) => result.finalState === "QUARANTINED")
	.map((result) => ({
		relation: result.object,
		issueCodes: result.issues.map((issue) => issue.code),
	}));
const calls = readJsonl<LlmCallCompleted>(join(outputConfig.runsDir, "llm-calls.jsonl")).filter(
	(call) => call.eventType === "LLM_CALL_COMPLETED",
);
const routerTokens = tokenSum(calls.filter((call) => call.batchId.startsWith("support-router-")));
const replayAuditTokens = tokenSum(
	calls.filter(
		(call) =>
			call.batchId.startsWith("relation-audit-") ||
			call.batchId.startsWith("relation-type-critic-") ||
			call.batchId.startsWith("related-to-utility-"),
	),
);
const baselineTotalRelationAuditTokens = 50_732;
const baselineLocalRelationAuditTokens = 3_784;
const baselineCrossRelationAuditTokens =
	baselineTotalRelationAuditTokens - baselineLocalRelationAuditTokens;
const comparableTotalTokens = baselineLocalRelationAuditTokens + routerTokens + replayAuditTokens;
const totalReduction = fraction(
	baselineTotalRelationAuditTokens - comparableTotalTokens,
	baselineTotalRelationAuditTokens,
);
const crossStageReduction = fraction(
	baselineCrossRelationAuditTokens - (routerTokens + replayAuditTokens),
	baselineCrossRelationAuditTokens,
);
const report = {
	schemaVersion: "wge-goal4-support-router-frozen-replay/v1",
	createdAt: new Date().toISOString(),
	stageBRead: false,
	mode: "ZERO_PUBLICATION_FROZEN_CANDIDATE_REPLAY",
	contract: "experiments/goal4/goal4-support-preaudit-router-contract-v1.json",
	contractSha256: hashFile(contractPath),
	baselineCandidateLedger:
		"experiments/goal3/s200-runs/compile-v10-post-audit-compaction-4source/workspace/runs/relation-candidate-ledger.jsonl",
	baselineCandidateLedgerSha256: hashFile(candidateLedgerPath),
	sourceId,
	routerVersion: SUPPORT_PREAUDIT_ROUTER_VERSION,
	model: outputConfig.model,
	temperature: outputConfig.temperature,
	counts: {
		selectedCandidates: selected.length,
		supportCandidates: supportInputs.length,
		relatedToBypassCandidates: selected.filter((relation) => relation.type === "RELATED_TO").length,
		supportFullAudit: routing.fullAudit.length,
		supportDeferredByTypeRouter: routing.deferred.length,
		fullAuditTotal: fullAuditRelations.length,
		canonicalAfterUnchangedAudit: canonical.length,
		quarantinedAfterUnchangedAudit: quarantined.length,
	},
	cost: {
		baselineTotalRelationAuditTokens,
		baselineLocalRelationAuditTokens,
		baselineCrossRelationAuditTokens,
		routerTokens,
		replayAuditTokens,
		comparableTotalTokens,
		totalReduction,
		crossStageReduction,
	},
	gates: {
		maximumThreeSupportCandidatesRoutedToFullAudit: routing.fullAudit.length <= 3,
		allSeventeenRelatedToCandidatesBypassedRouter:
			fullAuditRelations.filter((relation) => relation.type === "RELATED_TO").length === 17,
		minimumThirtyPercentComparableTokenReduction: totalReduction >= 0.3,
		accountingExact:
			selected.length === fullAuditRelations.length + routing.deferred.length &&
			fullAuditRelations.length === canonical.length + quarantined.length,
		zeroCanonicalPublicationWrites: true,
		manualReviewEveryCanonicalEdge: canonical.length === 0 ? true : "PENDING_MANUAL_REVIEW",
	},
	routerDecisions: routing.decisions.map((decision) => ({
		relationId: decision.relation.id,
		decision: decision.decision,
		failureModes: decision.failureModes,
		decisionSource: decision.decisionSource,
		error: decision.error ?? null,
	})),
	canonical,
	quarantined,
};
writeFileSync(reportPath, `${JSON.stringify(report, null, "\t")}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));

function requiredClaim(claimsById: Map<string, Claim>, id: string): Claim {
	const claim = claimsById.get(id);
	if (!claim) throw new Error(`Missing frozen canonical Claim: ${id}`);
	return claim;
}

function tokenSum(calls: LlmCallCompleted[]): number {
	return calls.reduce((sum, call) => sum + (call.usage?.totalTokens ?? 0), 0);
}

function fraction(numerator: number, denominator: number): number {
	return denominator === 0 ? 0 : Number((numerator / denominator).toFixed(6));
}

function assertCount(label: string, actual: number, expected: number): void {
	if (actual !== expected) throw new Error(`${label}: expected ${expected}, received ${actual}`);
}

function hashFile(path: string): string {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}
