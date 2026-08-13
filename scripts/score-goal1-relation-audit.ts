import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import {
	type RelationAuditPredictionItem,
	type RelationAuditReviewItem,
	decideRelationAuditSampleGate,
	scoreRelationAuditReview,
} from "../src/relations/audit-migration.js";

interface ReviewFile {
	reviewedRunId: string;
	reviewer: string;
	reviewerType: string;
	goldStatus: string;
	reviews: RelationAuditReviewItem[];
}

const args = parseArguments(process.argv.slice(2));
const runDirectory = resolve(args.runDirectory);
const reviewPath = resolve(args.reviewPath);
const packetPath = join(runDirectory, "review-packet.json");
if (!existsSync(packetPath)) throw new Error(`Missing review packet: ${packetPath}`);
if (!existsSync(reviewPath)) throw new Error(`Missing review file: ${reviewPath}`);

const allPredictions = readJson<RelationAuditPredictionItem[]>(packetPath);
const review = readJson<ReviewFile>(reviewPath);
const runId = basename(runDirectory);
const predictions =
	args.scope === "accepted"
		? allPredictions.filter((prediction) => prediction.auditDecision === "accept")
		: allPredictions;
const score = scoreRelationAuditReview(predictions, review.reviews);
const strongPrecisionTarget = 0.9;
const strongRecallTarget = 0.7;
const gate = decideRelationAuditSampleGate({
	score,
	strongPrecisionThreshold: strongPrecisionTarget,
	strongRecallThreshold: strongRecallTarget,
	reviewerType: review.reviewerType,
	goldStatus: review.goldStatus,
});
const acceptedPrecisionPassed =
	score.closed &&
	score.strong.precision !== null &&
	score.strong.precision >= strongPrecisionTarget;
const output = {
	schemaVersion: "wge-goal1-relation-audit-score/v2",
	runId,
	predictionScope: args.scope,
	sourceReviewRunId: review.reviewedRunId,
	reusedFrozenLabels: review.reviewedRunId !== runId,
	reviewer: review.reviewer,
	reviewerType: review.reviewerType,
	goldStatus: review.goldStatus,
	claimDiscipline: {
		mayBeCalledHumanGold: review.reviewerType === "HUMAN" && review.goldStatus === "GOLD",
		devProxyOnly: review.goldStatus === "DEV_PROXY",
	},
	thresholds: { strongPrecision: strongPrecisionTarget, strongRecall: strongRecallTarget },
	score,
	gate:
		args.scope === "all"
			? gate
			: {
					decision: acceptedPrecisionPassed
						? "PASS_ACCEPTED_PRECISION_DEV_PROXY"
						: "FAIL_ACCEPTED_PRECISION_GATE",
					metricsPassed: acceptedPrecisionPassed,
					evidenceTier: "DEV_PROXY",
					failures: acceptedPrecisionPassed ? [] : ["strong-precision-below-threshold"],
				},
	decision:
		args.scope === "all"
			? gate.decision
			: acceptedPrecisionPassed
				? "PASS_ACCEPTED_PRECISION_DEV_PROXY"
				: "FAIL_ACCEPTED_PRECISION_GATE",
};
const outputPath = resolve(args.outputPath ?? join(runDirectory, `score-${basename(reviewPath)}`));
writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
console.log(JSON.stringify({ outputPath, ...output }, null, 2));

function parseArguments(argv: string[]): {
	runDirectory: string;
	reviewPath: string;
	outputPath?: string;
	scope: "all" | "accepted";
} {
	let runDirectory: string | undefined;
	let reviewPath: string | undefined;
	let outputPath: string | undefined;
	let scope: "all" | "accepted" = "all";
	for (let index = 0; index < argv.length; index += 1) {
		const value = argv[index];
		if (value === "--run") runDirectory = requiredValue(argv, ++index, value);
		else if (value === "--review") reviewPath = requiredValue(argv, ++index, value);
		else if (value === "--output") outputPath = requiredValue(argv, ++index, value);
		else if (value === "--scope") {
			const requested = requiredValue(argv, ++index, value);
			if (requested !== "all" && requested !== "accepted") {
				throw new Error(`Invalid scope: ${requested}`);
			}
			scope = requested;
		} else throw new Error(`Unknown argument: ${value}`);
	}
	if (!runDirectory || !reviewPath) throw new Error("--run and --review are required");
	return { runDirectory, reviewPath, outputPath, scope };
}

function requiredValue(argv: string[], index: number, flag: string): string {
	const value = argv[index];
	if (!value) throw new Error(`${flag} requires a value`);
	return value;
}

function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, "utf8")) as T;
}
