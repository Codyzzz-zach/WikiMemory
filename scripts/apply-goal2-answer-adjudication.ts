import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

type JsonRecord = Record<string, unknown>;

const [reportArg, reviewArg, outputArg] = process.argv.slice(2);
if (!reportArg || !reviewArg || !outputArg) {
	throw new Error("usage: apply-goal2-answer-adjudication <raw-report> <review> <output>");
}
const reportPath = resolve(reportArg);
const reviewPath = resolve(reviewArg);
const outputPath = resolve(outputArg);
const reportText = readFileSync(reportPath, "utf8");
const reviewText = readFileSync(reviewPath, "utf8");
const report = JSON.parse(reportText) as JsonRecord;
const review = JSON.parse(reviewText) as JsonRecord;
const expectedHash = asRecord(review.input).sha256;
if (expectedHash !== sha256(reportText)) throw new Error("Adjudication input hash mismatch");

const overrideBySample = new Map(
	arrayRecords(review.overrides).map((row) => [String(row.sampleId), row]),
);
const scores = arrayRecords(report.scores).map((score) => {
	const override = overrideBySample.get(String(score.sampleId));
	if (!override) return score;
	if (override.questionId !== score.questionId || override.group !== score.group) {
		throw new Error(`Adjudication identity mismatch: ${String(score.sampleId)}`);
	}
	const evidenceGrounding = boundedScore(override.evidenceGrounding, "evidenceGrounding");
	const total =
		numberValue(score.requiredClaimCoverage) +
		numberValue(score.conditionFidelity) +
		evidenceGrounding +
		numberValue(score.answerabilityDiscipline);
	return {
		...score,
		evidenceGrounding,
		hardFailure: override.hardFailure === true,
		rationale: String(override.rationale),
		total,
		adjudication: {
			rawEvidenceGrounding: score.evidenceGrounding,
			rawHardFailure: score.hardFailure,
			rawRationale: score.rationale,
		},
	};
});
for (const sampleId of overrideBySample.keys()) {
	if (!scores.some((score) => score.sampleId === sampleId)) {
		throw new Error(`Adjudication sample missing from report: ${sampleId}`);
	}
}
const result = {
	...report,
	schemaVersion: "wge-goal2-r1-answer-micro-adjudicated/v1",
	status: "POST_HOC_DEV_CONTRACT_ADJUDICATED",
	rawReport: { path: reportPath, sha256: sha256(reportText) },
	adjudication: { path: reviewPath, sha256: sha256(reviewText) },
	scores,
	limitations: [
		...stringArray(report.limitations),
		"Aggregates in this artifact are raw-run aggregates; authoritative adjudicated aggregates are computed by the Goal 2 verifier from adjudicated scores and immutable records.",
	],
};
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(
	JSON.stringify(
		{
			outputPath,
			overridesApplied: overrideBySample.size,
			outputHash: sha256(JSON.stringify(result)),
		},
		null,
		2,
	),
);

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
	if (typeof value !== "number" || !Number.isFinite(value))
		throw new Error("Expected finite score");
	return value;
}

function boundedScore(value: unknown, label: string): number {
	const score = numberValue(value);
	if (!Number.isInteger(score) || score < 0 || score > 2) throw new Error(`Invalid ${label}`);
	return score;
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}
