import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadConfig } from "../src/config/index.js";
import { createLLMProvider } from "../src/core/llm-provider.js";
import { lintRelationsAgainstCanonicalClaims } from "../src/linter/index.js";
import { readAllClaims, readAllSpans, readJsonl } from "../src/linter/storage.js";
import type { Relation } from "../src/types/index.js";

interface RouterLedgerEntry {
	schemaVersion: string;
	sourceId: string;
	selectionState: string;
	relation: Relation;
}

interface LlmCallCompleted {
	eventType: string;
	batchId: string;
	usage: { totalTokens?: number } | null;
}

const root = resolve(process.cwd());
const sourceId = "source:s200-ai-llama-003-095ca9ccaaea22c6";
const canaryWorkspace = join(
	root,
	"experiments/goal3/s200-runs/compile-v11-support-router-4source/workspace",
);
const outputRoot = join(
	root,
	"experiments/goal4/support-router-runs/online-v11-source003-counterfactual-v1",
);
const reportPath = join(outputRoot, "report.json");
const contractPath = join(
	root,
	"experiments/goal4/goal4-support-router-online-counterfactual-contract-v1.json",
);
const ledgerPath = join(canaryWorkspace, "runs/relation-candidate-ledger.jsonl");
if (existsSync(reportPath)) throw new Error(`Counterfactual report already exists: ${reportPath}`);

const canaryConfig = loadConfig({ projectRoot: canaryWorkspace });
const outputConfig = {
	...loadConfig({ projectRoot: join(outputRoot, "workspace") }),
	temperature: 0,
};
if (!outputConfig.apiKey) throw new Error("DEEPSEEK_API_KEY not set");
mkdirSync(outputRoot, { recursive: true });
const deferred = readJsonl<RouterLedgerEntry>(ledgerPath)
	.filter(
		(entry) =>
			entry.schemaVersion === "wge-relation-preaudit-router-ledger/v1" &&
			entry.sourceId === sourceId &&
			entry.selectionState === "DEFER_BY_TYPE_ROUTER",
	)
	.map((entry) => entry.relation);
if (deferred.length !== 40)
	throw new Error(`Expected 40 deferred SUPPORTS, got ${deferred.length}`);
if (deferred.some((relation) => relation.type !== "SUPPORTS")) {
	throw new Error("Counterfactual input contains a non-SUPPORTS Relation");
}
const run = {
	sourceId,
	runId: "goal4-online-v11-source003-counterfactual-v1",
	model: outputConfig.model,
};
const results = await lintRelationsAgainstCanonicalClaims(
	outputConfig,
	deferred,
	readAllClaims(canaryConfig),
	readAllSpans(canaryConfig),
	createLLMProvider(outputConfig),
	{ run },
);
const canonical = results
	.filter((result) => result.finalState === "CANONICAL")
	.map((result) => result.object);
const quarantined = results
	.filter((result) => result.finalState === "QUARANTINED")
	.map((result) => ({
		relationId: result.object.id,
		issueCodes: result.issues.map((issue) => issue.code),
	}));
const calls = readJsonl<LlmCallCompleted>(join(outputConfig.runsDir, "llm-calls.jsonl")).filter(
	(call) => call.eventType === "LLM_CALL_COMPLETED",
);
const deferredFullAuditTokens = calls.reduce(
	(sum, call) => sum + (call.usage?.totalTokens ?? 0),
	0,
);
const observedCanaryTotal = 321_850;
const allRouterTokens = 9_178;
const estimatedNoRouterTotal = observedCanaryTotal - allRouterTokens + deferredFullAuditTokens;
const attributableRouterReduction = fraction(
	deferredFullAuditTokens - allRouterTokens,
	deferredFullAuditTokens,
);
const report = {
	schemaVersion: "wge-goal4-support-router-online-counterfactual/v1",
	createdAt: new Date().toISOString(),
	stageBRead: false,
	mode: "ZERO_PUBLICATION_FULL_SEMANTIC_AUDIT_REPLAY",
	contract: "experiments/goal4/goal4-support-router-online-counterfactual-contract-v1.json",
	contractSha256: hashFile(contractPath),
	inputLedgerSha256: hashFile(ledgerPath),
	sourceId,
	model: outputConfig.model,
	temperature: outputConfig.temperature,
	counts: {
		deferredSupportCandidates: deferred.length,
		canonicalAfterUnchangedAudit: canonical.length,
		quarantinedAfterUnchangedAudit: quarantined.length,
	},
	cost: {
		observedCanaryTotal,
		allRouterTokens,
		deferredFullAuditTokens,
		estimatedNoRouterTotal,
		observedRouterCanaryVersusEstimatedNoRouterSavings:
			estimatedNoRouterTotal - observedCanaryTotal,
		attributableRouterReduction,
	},
	gates: {
		allFortyAudited: results.length === 40,
		maximumCanonicalSupportEdgesZero: canonical.length === 0,
		accountingExact: results.length === canonical.length + quarantined.length,
		minimumThirtyPercentAttributableReduction: attributableRouterReduction >= 0.3,
		zeroPublicationWrites: true,
	},
	canonical,
	quarantined,
	interpretation:
		"The online canary remains failed against 300000 tokens. This paired replay only attributes whether the router caused or mitigated that failure.",
};
writeFileSync(reportPath, `${JSON.stringify(report, null, "\t")}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));

function fraction(numerator: number, denominator: number): number {
	return denominator === 0 ? 0 : Number((numerator / denominator).toFixed(6));
}

function hashFile(path: string): string {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}
