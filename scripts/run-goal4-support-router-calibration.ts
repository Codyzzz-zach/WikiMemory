import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadConfig } from "../src/config/index.js";
import { createLLMProvider } from "../src/core/llm-provider.js";
import {
	SUPPORT_PREAUDIT_ROUTER_SYSTEM,
	SUPPORT_PREAUDIT_ROUTER_VERSION,
} from "../src/prompts/index.js";
import { SupportRouterVerdictBatchSchema, parseLLMJson } from "../src/types/schemas.js";
import type { SupportRouterVerdict } from "../src/types/schemas.js";

type ExpectedDecision = SupportRouterVerdict["decision"];

interface RouterCase {
	caseId: string;
	domain: string;
	from: string;
	to: string;
	expectedDecision: ExpectedDecision;
	rationale: string;
}

interface RouterCalibration {
	status: string;
	stageBRead: false;
	cases: RouterCase[];
}

const root = resolve(process.cwd());
const calibrationPath = join(root, "experiments/goal4/goal4-support-router-calibration-v1.json");
const contractPath = join(root, "experiments/goal4/goal4-support-preaudit-router-contract-v1.json");
const outputRoot = join(root, "experiments/goal4/support-router-runs/calibration-v1");
const rawRoot = join(outputRoot, "raw-outputs");
const calibration = JSON.parse(readFileSync(calibrationPath, "utf8")) as RouterCalibration;
if (
	calibration.status !== "FROZEN_BEFORE_ROUTER_IMPLEMENTATION" ||
	calibration.stageBRead !== false
) {
	throw new Error("Goal4 SUPPORTS router calibration is not frozen");
}
const config = loadConfig({ projectRoot: join(outputRoot, "workspace") });
if (!config.apiKey) throw new Error("DEEPSEEK_API_KEY not set");
const provider = createLLMProvider(config);
mkdirSync(rawRoot, { recursive: true });

const verdicts = new Map<string, SupportRouterVerdict>();
let totalTokens = 0;
let calls = 0;
for (let offset = 0; offset < calibration.cases.length; offset += 8) {
	const batch = calibration.cases.slice(offset, offset + 8);
	const response = await provider.chat({
		model: config.model,
		temperature: 0,
		systemPrompt: SUPPORT_PREAUDIT_ROUTER_SYSTEM,
		messages: [{ role: "user", content: routerPrompt(batch) }],
		responseFormat: "json_object",
		thinkingDisabled: true,
		maxTokens: Math.max(2048, batch.length * 320),
	});
	calls += 1;
	if (response.finishReason === "length") throw new Error(`Router batch ${offset / 8} truncated`);
	const parsed = parseLLMJson(response.content, SupportRouterVerdictBatchSchema);
	const expectedIds = batch.map((item) => item.caseId).sort();
	const returnedIds = parsed.items.map((item) => item.objectId).sort();
	if (JSON.stringify(expectedIds) !== JSON.stringify(returnedIds)) {
		throw new Error(`Router object accounting mismatch in batch ${offset / 8}`);
	}
	for (const returned of parsed.items) {
		validateVerdict(returned.verdict);
		verdicts.set(returned.objectId, returned.verdict);
	}
	totalTokens += response.usage?.totalTokens ?? 0;
	writeFileSync(join(rawRoot, `batch-${offset / 8}.txt`), `${response.content}\n`, "utf8");
}

const results = calibration.cases.map((item) => {
	const verdict = verdicts.get(item.caseId);
	if (!verdict) throw new Error(`Missing router verdict: ${item.caseId}`);
	return {
		caseId: item.caseId,
		domain: item.domain,
		expectedDecision: item.expectedDecision,
		decision: verdict.decision,
		failureModes: verdict.failureModes,
		correct: verdict.decision === item.expectedDecision,
	};
});
const positives = results.filter((item) => item.expectedDecision === "FULL_AUDIT");
const negatives = results.filter((item) => item.expectedDecision === "DEFER_BY_TYPE_ROUTER");
const positiveRecall = fraction(
	positives.filter((item) => item.decision === "FULL_AUDIT").length,
	positives.length,
);
const deferredPrecision = fraction(
	negatives.filter((item) => item.decision === "DEFER_BY_TYPE_ROUTER").length,
	negatives.length,
);
const gates = {
	positiveFullAuditRecall: positiveRecall >= 0.8333,
	negativeDeferredPrecision: deferredPrecision >= 0.8333,
	objectAccountingExact: verdicts.size === calibration.cases.length,
};
const report = {
	schemaVersion: "wge-goal4-support-router-calibration-run/v1",
	createdAt: new Date().toISOString(),
	stageBRead: false,
	contract: "experiments/goal4/goal4-support-preaudit-router-contract-v1.json",
	contractSha256: hashFile(contractPath),
	calibrationSha256: hashFile(calibrationPath),
	routerVersion: SUPPORT_PREAUDIT_ROUTER_VERSION,
	model: config.model,
	temperature: 0,
	thinkingDisabled: true,
	labelIsolation: {
		labelsIncludedInModelPrompt: false,
		promptFields: ["caseId", "from", "to"],
	},
	metrics: {
		cases: results.length,
		calls,
		totalTokens,
		positiveFullAuditRecall: positiveRecall,
		negativeDeferredPrecision: deferredPrecision,
	},
	gates,
	results,
	status: Object.values(gates).every(Boolean) ? "PASS" : "FAIL",
};
writeFileSync(join(outputRoot, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

function routerPrompt(items: RouterCase[]): string {
	return `调度以下 ${items.length} 条 From SUPPORTS To 候选。\n\n${items
		.map(
			(item) =>
				`## objectId=${item.caseId}\nFrom: ${item.from}\nFrom conditions: 无\nTo: ${item.to}\nTo conditions: 无`,
		)
		.join("\n\n---\n\n")}\n\n只输出批处理 JSON envelope。`;
}

function validateVerdict(verdict: SupportRouterVerdict): void {
	if (verdict.decision === "FULL_AUDIT" && verdict.failureModes.length > 0) {
		throw new Error("FULL_AUDIT cannot contain failure modes");
	}
	if (verdict.decision === "DEFER_BY_TYPE_ROUTER" && verdict.failureModes.length === 0) {
		throw new Error("DEFER_BY_TYPE_ROUTER requires a failure mode");
	}
}

function fraction(numerator: number, denominator: number): number {
	return denominator === 0 ? 0 : Number((numerator / denominator).toFixed(4));
}

function hashFile(path: string): string {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}
