import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadConfig } from "../src/config/index.js";
import { createLLMProvider } from "../src/core/llm-provider.js";
import { RELATION_DETECT_SYSTEM } from "../src/prompts/index.js";
import type { RelationOnlyDraft } from "../src/types/schemas.js";
import { RelationResponseSchema, parseLLMJson } from "../src/types/schemas.js";

type ExpectedType = RelationOnlyDraft["type"] | "NONE";

interface CalibrationCase {
	caseId: string;
	domain: string;
	from: string;
	to: string;
	expectedType: ExpectedType;
	rationale: string;
}

interface CalibrationFile {
	schemaVersion: string;
	status: string;
	stageBRead: false;
	cases: CalibrationCase[];
}

const root = resolve(process.cwd());
const calibrationPath = join(root, "experiments/goal4/goal4-relation-proposal-calibration-v1.json");
const contractName =
	process.env.WGE_GOAL4_CALIBRATION_CONTRACT?.trim() ||
	"goal4-strong-relation-proposal-repair-contract-v2.json";
const contractPath = join(root, "experiments/goal4", contractName);
const runName = process.env.WGE_GOAL4_CALIBRATION_RUN_NAME?.trim() || "type-contract-v2";
if (!/^[a-zA-Z0-9._-]+$/u.test(runName)) throw new Error(`Invalid Goal4 run name: ${runName}`);
const outputRoot = join(root, "experiments/goal4/calibration-runs", runName);
const rawRoot = join(outputRoot, "raw-outputs");
const calibration = JSON.parse(readFileSync(calibrationPath, "utf8")) as CalibrationFile;
if (calibration.status !== "FROZEN_BEFORE_PROMPT_CHANGE" || calibration.stageBRead !== false) {
	throw new Error("Goal4 calibration is not frozen or Stage B isolation drifted");
}

const config = loadConfig({ projectRoot: join(outputRoot, "workspace") });
if (!config.apiKey) throw new Error("DEEPSEEK_API_KEY not set");
const provider = createLLMProvider(config);
mkdirSync(rawRoot, { recursive: true });

const strongTypes = new Set<RelationOnlyDraft["type"]>([
	"REQUIRES",
	"DERIVED_FROM",
	"SUPPORTS",
	"CONTRADICTS",
	"SUPERSEDES",
	"EQUIVALENT_UNDER",
]);
const results: Array<Record<string, unknown>> = [];
let totalTokens = 0;

for (const item of calibration.cases) {
	const userPrompt = proposalPrompt(item.from, item.to);
	const response = await provider.chat({
		model: config.model,
		temperature: 0,
		systemPrompt: RELATION_DETECT_SYSTEM,
		messages: [{ role: "user", content: userPrompt }],
		responseFormat: "json_object",
		thinkingDisabled: true,
		maxTokens: 2048,
	});
	if (response.finishReason === "length") {
		throw new Error(`Calibration output truncated: ${item.caseId}`);
	}
	const parsed = parseLLMJson(response.content, RelationResponseSchema);
	writeFileSync(join(rawRoot, `${item.caseId}.txt`), `${response.content}\n`, "utf8");
	totalTokens += response.usage?.totalTokens ?? 0;
	const crossPairRelations = parsed.relations.filter(
		(relation) =>
			(relation.fromClaimIndex === 0 && relation.toClaimIndex === 1) ||
			(relation.fromClaimIndex === 1 && relation.toClaimIndex === 0),
	);
	const exact =
		item.expectedType === "NONE"
			? crossPairRelations.length === 0
			: crossPairRelations.length === 1 &&
				crossPairRelations[0]?.fromClaimIndex === 0 &&
				crossPairRelations[0]?.toClaimIndex === 1 &&
				crossPairRelations[0]?.type === item.expectedType;
	const falseStrong =
		(item.expectedType === "RELATED_TO" || item.expectedType === "NONE") &&
		crossPairRelations.some((relation) => strongTypes.has(relation.type));
	results.push({
		caseId: item.caseId,
		domain: item.domain,
		expectedType: item.expectedType,
		predicted: crossPairRelations,
		exact,
		falseStrong,
		multipleConflictingRelations: crossPairRelations.length > 1,
		promptHash: hash(`${RELATION_DETECT_SYSTEM}\n${userPrompt}`),
		outputHash: hash(response.content),
		usage: response.usage,
	});
}

const trueStrongResults = results.filter((result) =>
	strongTypes.has(result.expectedType as RelationOnlyDraft["type"]),
);
const exactTypeAccuracy = fraction(
	results.filter((result) => result.exact === true).length,
	results.length,
);
const trueStrongExactTypeRecall = fraction(
	trueStrongResults.filter((result) => result.exact === true).length,
	trueStrongResults.length,
);
const falseStrongPredictions = results.filter((result) => result.falseStrong === true).length;
const relatedResults = results.filter((result) => result.expectedType === "RELATED_TO");
const relatedToRecall = fraction(
	relatedResults.filter((result) => result.exact === true).length,
	relatedResults.length,
);
const multipleConflictingRelations = results.filter(
	(result) => result.multipleConflictingRelations === true,
).length;
const gates = {
	exactTypeAccuracy: exactTypeAccuracy >= 0.8,
	trueStrongExactTypeRecall: trueStrongExactTypeRecall >= 0.8333,
	falseStrongPredictions: falseStrongPredictions === 0,
	multipleConflictingRelations: multipleConflictingRelations === 0,
	relatedToRecall: relatedToRecall >= 0.6667,
};
const report = {
	schemaVersion: "wge-goal4-relation-proposal-calibration-run/v1",
	createdAt: new Date().toISOString(),
	stageBRead: false,
	contract: `experiments/goal4/${contractName}`,
	contractSha256: hashFile(contractPath),
	calibrationSha256: hashFile(calibrationPath),
	model: config.model,
	temperature: 0,
	thinkingDisabled: true,
	labelIsolation: {
		labelsIncludedInModelPrompt: false,
		promptFields: ["from", "to"],
	},
	metrics: {
		cases: results.length,
		exactTypeAccuracy,
		trueStrongExactTypeRecall,
		falseStrongPredictions,
		multipleConflictingRelations,
		relatedToRecall,
		totalTokens,
	},
	gates,
	results,
	status: Object.values(gates).every(Boolean) ? "PASS" : "FAIL",
};

writeFileSync(join(outputRoot, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

function proposalPrompt(from: string, to: string): string {
	return `检测集合 A 与集合 B 之间的明确关系；不要输出集合内部关系。\n\n# 集合 A\n[claim 0] ${from}\nsource evidence: span:calibration-from\nconditions: 无\n\n# 集合 B\n[claim 1] ${to}\nsource evidence: span:calibration-to\nconditions: 无\n\n请返回严格 JSON。`;
}

function fraction(numerator: number, denominator: number): number {
	return denominator === 0 ? 0 : Number((numerator / denominator).toFixed(4));
}

function hash(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function hashFile(path: string): string {
	return hash(readFileSync(path, "utf8"));
}
