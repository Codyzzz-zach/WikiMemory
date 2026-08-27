import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

type JsonRecord = Record<string, unknown>;
type Group = "B" | "R0" | "R1";

const [answerReportArg, preparationReportArg, outputArg] = process.argv.slice(2);
if (!answerReportArg || !preparationReportArg || !outputArg) {
	throw new Error(
		"usage: verify-goal2-answer-micro <score-report.json> <offline-report.json> <proof.json>",
	);
}
const answerReportPath = resolve(answerReportArg);
const preparationReportPath = resolve(preparationReportArg);
const outputPath = resolve(outputArg);
const answerRoot = dirname(answerReportPath);
const answerText = readFileSync(answerReportPath, "utf8");
const preparationText = readFileSync(preparationReportPath, "utf8");
const answerReport = JSON.parse(answerText) as JsonRecord;
const preparation = JSON.parse(preparationText) as JsonRecord;
const questionIds = stringArray(answerReport.questionIds);
if (questionIds.length !== 8)
	throw new Error(`Expected frozen eight-question Micro: ${questionIds.length}`);

const answerScores = arrayRecords(answerReport.scores);
const preparationPairs = new Map(
	arrayRecords(preparation.paired).map((row) => [String(row.questionId), row]),
);
const questionRows = questionIds.map((questionId) => {
	const pair = preparationPairs.get(questionId);
	if (!pair) throw new Error(`Missing preparation pair: ${questionId}`);
	const groups = Object.fromEntries(
		(["B", "R0", "R1"] as const).map((group) => {
			const score = uniqueScore(answerScores, questionId, group);
			const recordPath = join(answerRoot, "records", `${questionId}--${group}.json`);
			const record = JSON.parse(readFileSync(recordPath, "utf8")) as JsonRecord;
			const usage = asRecord(record.usage);
			return [
				group,
				{
					totalScore: numberValue(score.total),
					hardFailure: score.hardFailure === true,
					evidenceGrounding: numberValue(score.evidenceGrounding),
					contextTokens: numberValue(record.estimatedContextTokens),
					providerInputTokens: usageNumber(usage, ["promptTokens", "inputTokens"]),
					providerOutputTokens: usageNumber(usage, ["completionTokens", "outputTokens"]),
					latencyMs: numberValue(record.latencyMs),
					answerFormatValid: record.answerFormatValid === true,
					citationsValid: asRecord(record.citationValidation).valid === true,
				},
			];
		}),
	) as Record<Group, GroupMetrics>;
	const r0Cost = totalProviderTokens(groups.R0);
	const r1Cost = totalProviderTokens(groups.R1);
	const r0DominatesR1 =
		groups.R0.totalScore >= groups.R1.totalScore &&
		r0Cost <= r1Cost &&
		(groups.R0.totalScore > groups.R1.totalScore || r0Cost < r1Cost);
	const addedGraphClaimIds = stringArray(pair.addedGraphClaimIds);
	const reordered = pair.contextChanged === true;
	return {
		questionId,
		questionClass: String(pair.questionClass),
		groups,
		r1VsR0: {
			scoreDelta: groups.R1.totalScore - groups.R0.totalScore,
			evidenceGroundingDelta: groups.R1.evidenceGrounding - groups.R0.evidenceGrounding,
			providerTokenDelta: r1Cost - r0Cost,
			contextTokenDelta: groups.R1.contextTokens - groups.R0.contextTokens,
			latencyDeltaMs: groups.R1.latencyMs - groups.R0.latencyMs,
			r0DominatesR1,
		},
		selectionTrace: {
			changed: reordered,
			addedGraphClaimIds,
			removedLexicalSeedIds: stringArray(pair.removedLexicalSeedIds),
		},
	};
});

const targetRows = questionRows.filter((row) => row.questionClass === "target");
const controlRows = questionRows.filter((row) => row.questionClass === "control");
const aggregate = {
	B: aggregateGroup(questionRows, "B"),
	R0: aggregateGroup(questionRows, "R0"),
	R1: aggregateGroup(questionRows, "R1"),
};
const aggregateR0DominatesR1 =
	aggregate.R0.averageScore >= aggregate.R1.averageScore &&
	aggregate.R0.providerTokens <= aggregate.R1.providerTokens &&
	(aggregate.R0.averageScore > aggregate.R1.averageScore ||
		aggregate.R0.providerTokens < aggregate.R1.providerTokens);
const traceableTargetBenefits = targetRows
	.filter(
		(row) => row.selectionTrace.changed && row.r1VsR0.scoreDelta > 0 && !row.groups.R1.hardFailure,
	)
	.map((row) => row.questionId);
const checks = {
	allAnswerContractsValid: questionRows.every((row) =>
		Object.values(row.groups).every((group) => group.answerFormatValid && group.citationsValid),
	),
	noAdditionalHardFailure: questionRows.every(
		(row) => !(row.groups.R1.hardFailure && !row.groups.R0.hardFailure),
	),
	controlsHaveNoHardRegression: controlRows.every(
		(row) => !(row.groups.R1.hardFailure && !row.groups.R0.hardFailure),
	),
	aggregateParetoNondominated: !aggregateR0DominatesR1,
	traceableTargetRankingBenefit: traceableTargetBenefits.length > 0,
	graphWasReplacementNotAppend: questionRows.every(
		(row) =>
			stringArray(preparationPairs.get(row.questionId)?.r0PrimaryClaimIds).length ===
			stringArray(preparationPairs.get(row.questionId)?.r1PrimaryClaimIds).length,
	),
};
const microGatePassed = Object.values(checks).every(Boolean);
const decision = microGatePassed
	? "GO_DEV_CORE"
	: traceableTargetBenefits.length > 0 && checks.noAdditionalHardFailure
		? "NARROW_OR_RECALIBRATE_BEFORE_DEV_CORE"
		: "REWORK_R1_NO_DEV_CORE";
const proof = {
	schemaVersion: "wge-goal2-answer-micro-proof/v1",
	status: microGatePassed ? "PASS_ANSWER_MICRO_GATE" : "FAIL_ANSWER_MICRO_GATE",
	createdAt: new Date().toISOString(),
	inputs: {
		answerReport: { path: answerReportPath, sha256: sha256(answerText) },
		preparationReport: { path: preparationReportPath, sha256: sha256(preparationText) },
	},
	checks,
	decision,
	traceableTargetBenefits,
	aggregate,
	questionRows,
	failureAttribution: failureAttribution(questionRows, checks),
	limitations: [
		"Scores are AI-proxy judgments over revealed Dev questions, not human Gold adjudication.",
		"A PASS authorizes Dev Core; it does not complete Goal 2 or establish blind product value.",
		"A target score gain is traceable to a changed R1 context but is not causal proof by itself.",
	],
};
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(proof, null, 2)}\n`, "utf8");
console.log(JSON.stringify(proof, null, 2));

interface GroupMetrics {
	totalScore: number;
	hardFailure: boolean;
	evidenceGrounding: number;
	contextTokens: number;
	providerInputTokens: number;
	providerOutputTokens: number;
	latencyMs: number;
	answerFormatValid: boolean;
	citationsValid: boolean;
}

interface GroupAggregate {
	averageScore: number;
	hardFailures: number;
	averageContextTokens: number;
	providerTokens: number;
	averageLatencyMs: number;
}

function aggregateGroup(
	rows: Array<{ groups: Record<Group, GroupMetrics> }>,
	group: Group,
): GroupAggregate {
	const metrics = rows.map((row) => row.groups[group]);
	return {
		averageScore: average(metrics.map((row) => row.totalScore)),
		hardFailures: metrics.filter((row) => row.hardFailure).length,
		averageContextTokens: average(metrics.map((row) => row.contextTokens)),
		providerTokens: sum(metrics.map(totalProviderTokens)),
		averageLatencyMs: average(metrics.map((row) => row.latencyMs)),
	};
}

function failureAttribution(
	rows: Array<{
		questionId: string;
		selectionTrace: { changed: boolean };
		r1VsR0: { scoreDelta: number; providerTokenDelta: number; r0DominatesR1: boolean };
	}>,
	checks: Record<string, boolean>,
): JsonRecord[] {
	const failures: JsonRecord[] = [];
	if (!checks.allAnswerContractsValid)
		failures.push({ layer: "answer-contract", reason: "invalid-format-or-citation" });
	if (!checks.noAdditionalHardFailure)
		failures.push({ layer: "answer-safety", reason: "additional-r1-hard-failure" });
	if (!checks.aggregateParetoNondominated)
		failures.push({ layer: "product-utility", reason: "r0-aggregate-dominates-r1" });
	if (!checks.traceableTargetRankingBenefit)
		failures.push({ layer: "selection-value", reason: "no-target-score-gain-on-changed-context" });
	for (const row of rows.filter((candidate) => candidate.r1VsR0.r0DominatesR1)) {
		failures.push({
			layer: row.selectionTrace.changed ? "r1-selection" : "answer-variance",
			questionId: row.questionId,
			reason: "r0-pair-dominates-r1",
			scoreDelta: row.r1VsR0.scoreDelta,
			providerTokenDelta: row.r1VsR0.providerTokenDelta,
		});
	}
	return failures;
}

function uniqueScore(rows: JsonRecord[], questionId: string, group: Group): JsonRecord {
	const selected = rows.filter((row) => row.questionId === questionId && row.group === group);
	if (selected.length !== 1) throw new Error(`Expected one score: ${questionId}/${group}`);
	return selected[0] as JsonRecord;
}

function usageNumber(record: JsonRecord, keys: string[]): number {
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "number" && Number.isFinite(value)) return value;
	}
	return 0;
}

function totalProviderTokens(value: GroupMetrics): number {
	return value.providerInputTokens + value.providerOutputTokens;
}

function arrayRecords(value: unknown): JsonRecord[] {
	return Array.isArray(value) ? value.map(asRecord) : [];
}

function stringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

function asRecord(value: unknown): JsonRecord {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function numberValue(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function average(values: number[]): number {
	return values.length === 0
		? 0
		: Number((values.reduce((total, value) => total + value, 0) / values.length).toFixed(3));
}

function sum(values: number[]): number {
	return values.reduce((total, value) => total + value, 0);
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}
