import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

type JsonRecord = Record<string, unknown>;

const args = parseArguments(process.argv.slice(2));
const preparationPath = resolve(args.preparationPath);
const outputPath = resolve(args.outputPath);
if (!existsSync(preparationPath)) throw new Error(`Missing preparation: ${preparationPath}`);
if (existsSync(outputPath)) throw new Error(`Refusing to overwrite proof: ${outputPath}`);
const preparation = readJson<JsonRecord>(preparationPath);
const rows = recordArray(preparation.rows, "rows");
const questionIds = stringArray(preparation.selectedQuestionIds, "selectedQuestionIds");
const pairs = questionIds.map((questionId) => {
	const seed = uniqueRow(rows, questionId, "P-seed");
	const graph = uniqueRow(rows, questionId, "P-graph");
	const trace = record(graph.retrievalTrace, `${questionId}.retrievalTrace`);
	const candidateFlow = record(trace.candidateFlow, `${questionId}.candidateFlow`);
	const activation = record(candidateFlow.graphActivation, `${questionId}.graphActivation`);
	const visibleRelationIds = stringArray(
		activation.visibleRelationIds,
		`${questionId}.visibleRelationIds`,
	);
	const seedTokens = number(seed.estimatedContextTokens, `${questionId}.seedTokens`);
	const graphTokens = number(graph.estimatedContextTokens, `${questionId}.graphTokens`);
	const selectedMarginalTokens = number(
		activation.selectedMarginalTokens,
		`${questionId}.selectedMarginalTokens`,
	);
	const marginalBudgetTokens = number(
		activation.marginalBudgetTokens,
		`${questionId}.marginalBudgetTokens`,
	);
	const noVisibleGraph = visibleRelationIds.length === 0;
	return {
		questionId,
		activationMode: string(activation.mode, `${questionId}.mode`),
		activationReason: string(activation.reason, `${questionId}.reason`),
		visibleRelationIds,
		seedTokens,
		graphTokens,
		tokenDelta: graphTokens - seedTokens,
		selectedMarginalTokens,
		marginalBudgetTokens,
		withinContextBudget:
			graphTokens <= number(preparation.contextBudgetTokens, "contextBudgetTokens"),
		withinMarginalBudget: selectedMarginalTokens <= marginalBudgetTokens,
		noVisibleGraphImpliesIdenticalContext:
			!noVisibleGraph || seed.contextHash === graph.contextHash,
		visibleGraphIdsMatchSerializedRelations:
			noVisibleGraph ||
			visibleRelationIds.every((id) =>
				stringArray(graph.retrievedRelations, "relations").includes(id),
			),
	};
});
const invariantFailures = pairs.flatMap((pair) => {
	const failures: string[] = [];
	if (!pair.withinContextBudget) failures.push("context-budget");
	if (!pair.withinMarginalBudget) failures.push("marginal-budget");
	if (!pair.noVisibleGraphImpliesIdenticalContext) failures.push("candidate-only-context-drift");
	if (!pair.visibleGraphIdsMatchSerializedRelations)
		failures.push("activation-serialization-drift");
	return failures.map((reason) => ({ questionId: pair.questionId, reason }));
});
const visibleQuestions = pairs.filter((pair) => pair.visibleRelationIds.length > 0).length;
const proof = {
	schemaVersion: "wge-goal1-conditional-graph-micro-proof/v1",
	preparationPath,
	questionCount: questionIds.length,
	visibleQuestions,
	candidateOnlyQuestions: questionIds.length - visibleQuestions,
	invariantFailures,
	pairs,
	status:
		invariantFailures.length > 0
			? "FAIL_CONTRACT"
			: visibleQuestions > 0
				? "PASS_CONDITIONAL_GRAPH_MICRO"
				: "PASS_FAIL_CLOSED_MICRO_ONLY",
	limitations: [
		"This proof validates Context and marginal-budget behavior, not answer quality.",
		...(visibleQuestions === 0
			? [
					"No question had a consumable Graph candidate; real conditional activation remains unverified.",
				]
			: []),
	],
};
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(proof, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
console.log(JSON.stringify({ outputPath, ...proof }, null, 2));
if (invariantFailures.length > 0) process.exitCode = 1;

function parseArguments(argv: string[]): { preparationPath: string; outputPath: string } {
	let preparationPath: string | undefined;
	let outputPath: string | undefined;
	for (let index = 0; index < argv.length; index += 1) {
		const value = argv[index];
		if (value === "--preparation") preparationPath = requiredValue(argv, ++index, value);
		else if (value === "--output") outputPath = requiredValue(argv, ++index, value);
		else throw new Error(`Unknown argument: ${value}`);
	}
	if (!preparationPath || !outputPath) throw new Error("--preparation and --output are required");
	return { preparationPath, outputPath };
}

function requiredValue(argv: string[], index: number, flag: string): string {
	const value = argv[index];
	if (!value) throw new Error(`${flag} requires a value`);
	return value;
}

function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, "utf8")) as T;
}

function uniqueRow(rows: JsonRecord[], questionId: string, group: string): JsonRecord {
	const matched = rows.filter((row) => row.questionId === questionId && row.group === group);
	if (matched.length !== 1)
		throw new Error(`Expected one ${questionId}/${group} row, got ${matched.length}`);
	return matched[0] as JsonRecord;
}

function record(value: unknown, label: string): JsonRecord {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`Expected record: ${label}`);
	}
	return value as JsonRecord;
}

function recordArray(value: unknown, label: string): JsonRecord[] {
	if (!Array.isArray(value)) throw new Error(`Expected record array: ${label}`);
	return value.map((item, index) => record(item, `${label}[${index}]`));
}

function stringArray(value: unknown, label: string): string[] {
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
		throw new Error(`Expected string array: ${label}`);
	}
	return value as string[];
}

function string(value: unknown, label: string): string {
	if (typeof value !== "string") throw new Error(`Expected string: ${label}`);
	return value;
}

function number(value: unknown, label: string): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new Error(`Expected finite number: ${label}`);
	}
	return value;
}
