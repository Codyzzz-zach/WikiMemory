import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

type JsonRecord = Record<string, unknown>;

const [reportArg, reviewArg, outputArg] = process.argv.slice(2);
if (!reportArg || !reviewArg || !outputArg) {
	throw new Error("usage: verify-goal2-offline <report.json> <review.json> <output.json>");
}
const reportPath = resolve(reportArg);
const reviewPath = resolve(reviewArg);
const outputPath = resolve(outputArg);
const reportText = readFileSync(reportPath, "utf8");
const reviewText = readFileSync(reviewPath, "utf8");
const report = JSON.parse(reportText) as JsonRecord;
const review = JSON.parse(reviewText) as JsonRecord;
const checks = asRecord(report.checks);
const reviewInput = asRecord(review.input);
const reportHashMatches = reviewInput.sha256 === sha256(reportText);
const machineChecks = {
	sameFrozenBudget: checks.sameFrozenBudget === true,
	primaryClaimCountNeverIncreases: checks.primaryClaimCountNeverIncreases === true,
	targetHasStructuralDifference: checks.targetHasStructuralDifference === true,
	closureComplete: checks.closureComplete === true,
};
const manualChecks = {
	reportHashMatches,
	controlHasNoUnrelatedGraphClaim: review.controlVerdict === "PASS_NO_UNRELATED_GRAPH_CLAIM",
	allChangedQuestionsReviewed: changedQuestions(report).every((id) =>
		reviewedQuestions(review).has(id),
	),
};
const passed = [...Object.values(machineChecks), ...Object.values(manualChecks)].every(Boolean);
const proof = {
	schemaVersion: "wge-goal2-offline-entry-proof/v1",
	status: passed ? "PASS_OFFLINE_ENTRY_GATE" : "FAIL_OFFLINE_ENTRY_GATE",
	createdAt: new Date().toISOString(),
	inputs: {
		report: { path: reportPath, sha256: sha256(reportText) },
		review: { path: reviewPath, sha256: sha256(reviewText) },
	},
	machineChecks,
	manualChecks,
	decision: passed ? "ONLINE_MICRO_AUTHORIZED" : "ONLINE_MICRO_BLOCKED",
	limitations: [
		"Offline passage authorizes only the frozen eight-question B/R0/R1 answer Micro.",
		"It does not establish answer benefit, blind value or production readiness.",
	],
};
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(proof, null, 2)}\n`, "utf8");
console.log(JSON.stringify(proof, null, 2));

function changedQuestions(reportValue: JsonRecord): string[] {
	return arrayRecords(reportValue.paired)
		.filter((row) => stringArray(row.addedGraphClaimIds).length > 0)
		.map((row) => String(row.questionId));
}

function reviewedQuestions(reviewValue: JsonRecord): Set<string> {
	return new Set(arrayRecords(reviewValue.reviews).map((row) => String(row.questionId)));
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

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}
