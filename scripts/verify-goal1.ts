import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

type JsonRecord = Record<string, unknown>;

const options = parseArguments(process.argv.slice(2));
const relationScorePath = resolve(options.relationScore);
const beforePath = resolve(options.before);
const experimentPath = resolve(options.experiment);
const answerPath = resolve(options.answers);
const finalPath = resolve(options.final);
const outputPath = resolve(options.output);
if (existsSync(outputPath)) throw new Error(`Refusing to overwrite Goal 1 proof: ${outputPath}`);

const relationScore = readJson<JsonRecord>(relationScorePath);
const before = readJson<JsonRecord>(beforePath);
const experiment = readJson<JsonRecord>(experimentPath);
const answers = readJson<JsonRecord>(answerPath);
const final = readJson<JsonRecord>(finalPath);
const beforeRows = recordArray(before.rows, "before.rows");
const finalRows = recordArray(final.rows, "final.rows");
const questionIds = unique(finalRows.map((row) => requireString(row, "questionId")));

const relationDecision = requireString(relationScore, "decision");
const relationGatePassed = relationDecision === "PASS_DEV_PROXY_GATE";
const strong = record(record(relationScore.score, "score").strong, "score.strong");
const experimentTriggered = stringArray(experiment.triggeredQuestionIds, "experiment triggers");
const finalTriggered = stringArray(final.triggeredQuestionIds, "final triggers");
const answerAggregates = record(answers.aggregates, "answer aggregates");
const seedAggregate = record(answerAggregates["P-seed"], "P-seed aggregate");
const graphAggregate = record(answerAggregates["P-graph"], "P-graph aggregate");
const observedQualityDelta =
	Number(graphAggregate.averageTotal) - Number(seedAggregate.averageTotal);
const observedTokenDelta =
	Number(graphAggregate.averageContextTokens) - Number(seedAggregate.averageContextTokens);

const beforeIdentity = contextIdentity(beforeRows, questionIds);
const finalIdentity = contextIdentity(finalRows, questionIds);
const invariants = {
	relationProxyGatePassed: relationGatePassed,
	strongPrecisionAtLeast090: Number(strong.precision) >= 0.9,
	strongRecallAtLeast070: Number(strong.recall) >= 0.7,
	uncalibratedUtilityBlockedAllGraph: beforeIdentity.identicalCount === questionIds.length,
	experimentActuallyTriggeredGraph: experimentTriggered.length > 0,
	experimentObservedNoQualityGain: observedQualityDelta <= 0,
	experimentObservedPositiveTokenCost: observedTokenDelta > 0,
	finalPolicyRemovedUnhelpfulExpansion: finalTriggered.length === 0,
	finalCandidateOnlyContextsStable: finalIdentity.identicalCount === questionIds.length,
};
const failures = Object.entries(invariants)
	.filter(([, passed]) => !passed)
	.map(([name]) => name);
const proof = {
	schemaVersion: "wge-goal1-proof/v1",
	status: failures.length === 0 ? "PASS_ENGINEERING_GATE_NO_PRODUCT_GAIN" : "FAIL_GOAL1_CONTRACT",
	createdAt: new Date().toISOString(),
	inputs: {
		relationScore: inputRef(relationScorePath),
		before: inputRef(beforePath),
		experiment: inputRef(experimentPath),
		answers: inputRef(answerPath),
		final: inputRef(finalPath),
	},
	relationTrust: {
		status: relationDecision,
		strongPrecision: strong.precision,
		strongRecall: strong.recall,
		labelAuthority: "AI_POST_HOC_DEV_PROXY_NOT_HUMAN_GOLD",
	},
	marginalExperiment: {
		questionIds: stringArray(answers.questionIds, "answer questionIds"),
		triggeredQuestionIds: experimentTriggered,
		seedAverageScore: seedAggregate.averageTotal,
		graphAverageScore: graphAggregate.averageTotal,
		qualityDelta: observedQualityDelta,
		seedAverageContextTokens: seedAggregate.averageContextTokens,
		graphAverageContextTokens: graphAggregate.averageContextTokens,
		tokenDelta: observedTokenDelta,
		decision: "REJECT_ONE_ANCHOR_EXPLANATORY_EXPANSION",
	},
	finalPolicy: {
		policy: "EXPLANATORY_EDGES_REQUIRE_BOTH_ENDPOINTS_AS_INDEPENDENT_SEEDS",
		safetyEdgeException:
			"REQUIRES/CONTRADICTS/SUPERSEDES/EQUIVALENT_UNDER may expand from one seed",
		questionCount: questionIds.length,
		visibleGraphQuestions: finalTriggered.length,
		seedGraphIdenticalContexts: finalIdentity.identicalCount,
	},
	invariants,
	failures,
	conclusion:
		"Goal 1 establishes a trustworthy conditional Graph gate and rejects the tested costly policy. It does not establish positive Graph product value.",
	limitations: [
		"Relation labels and answer scores are AI proxy evidence, not human Gold.",
		"The marginal answer experiment contains two post-hoc triggered questions.",
		"A future positive Graph claim requires blind questions whose independently retrieved endpoints are connected by trusted edges.",
	],
};
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(proof, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
console.log(JSON.stringify({ outputPath, ...proof }, null, 2));
if (failures.length > 0) process.exitCode = 1;

function contextIdentity(rows: JsonRecord[], questionIds: string[]): { identicalCount: number } {
	let identicalCount = 0;
	for (const questionId of questionIds) {
		const seed = uniqueRow(rows, questionId, "P-seed");
		const graph = uniqueRow(rows, questionId, "P-graph");
		if (seed.contextHash === graph.contextHash) identicalCount++;
	}
	return { identicalCount };
}

function uniqueRow(rows: JsonRecord[], questionId: string, group: string): JsonRecord {
	const matched = rows.filter((row) => row.questionId === questionId && row.group === group);
	if (matched.length !== 1) throw new Error(`Expected one row: ${questionId}/${group}`);
	return matched[0] as JsonRecord;
}

function parseArguments(argv: string[]): Record<string, string> {
	const values: Record<string, string> = {};
	for (let index = 0; index < argv.length; index += 1) {
		const flag = argv[index];
		if (!flag?.startsWith("--")) throw new Error(`Unknown argument: ${String(flag)}`);
		const value = argv[++index];
		if (!value) throw new Error(`${flag} requires a value`);
		values[flag.slice(2)] = value;
	}
	for (const key of ["relationScore", "before", "experiment", "answers", "final", "output"]) {
		if (!values[key]) throw new Error(`--${key} is required`);
	}
	return values as Record<string, string> & {
		relationScore: string;
		before: string;
		experiment: string;
		answers: string;
		final: string;
		output: string;
	};
}

function inputRef(path: string): { path: string; sha256: string } {
	return { path, sha256: sha256(readFileSync(path, "utf8")) };
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, "utf8")) as T;
}

function record(value: unknown, label: string): JsonRecord {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`Expected record: ${label}`);
	}
	return value as JsonRecord;
}

function recordArray(value: unknown, label: string): JsonRecord[] {
	if (!Array.isArray(value)) throw new Error(`Expected record array: ${label}`);
	return value.map((item) => record(item, label));
}

function requireString(row: JsonRecord, key: string): string {
	const value = row[key];
	if (typeof value !== "string") throw new Error(`Expected string: ${key}`);
	return value;
}

function stringArray(value: unknown, label: string): string[] {
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
		throw new Error(`Expected string array: ${label}`);
	}
	return value as string[];
}

function unique(values: string[]): string[] {
	return [...new Set(values)].sort();
}
