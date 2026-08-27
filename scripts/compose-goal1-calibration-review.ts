import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

interface Review {
	relationId: string;
	decision: "accept" | "reject";
	reason: string;
}

interface ReviewFile {
	reviews: Review[];
}

interface AdjudicationFile {
	adjudications: Array<{
		relationId: string;
		adjudicatedDecision: "accept" | "reject";
		reason: string;
	}>;
}

const args = parseArguments(process.argv.slice(2));
const outputPath = resolve(args.output);
if (existsSync(outputPath)) throw new Error(`Refusing to overwrite review: ${outputPath}`);
const relationIds = readJson<string[]>(resolve(args.relationIds));
const byId = new Map<string, Review>();
for (const review of readJson<ReviewFile>(resolve(args.base)).reviews) {
	byId.set(review.relationId, review);
}
for (const review of readJson<ReviewFile>(resolve(args.accepted)).reviews) {
	byId.set(review.relationId, review);
}
for (const item of readJson<AdjudicationFile>(resolve(args.adjudication)).adjudications) {
	byId.set(item.relationId, {
		relationId: item.relationId,
		decision: item.adjudicatedDecision,
		reason: item.reason,
	});
}
const missing = relationIds.filter((id) => !byId.has(id));
if (missing.length > 0) throw new Error(`Missing calibration labels: ${missing.join(", ")}`);
const reviews = relationIds.map((id) => byId.get(id) as Review);
writeFileSync(
	outputPath,
	`${JSON.stringify(
		{
			schemaVersion: "wge-goal1-relation-review/v1",
			reviewedRunId: "goal1-v2.3-calibration-v1",
			reviewer: "Codex composite post-hoc calibration proxy",
			reviewerType: "AI_REVIEW_NOT_HUMAN_GOLD",
			goldStatus: "POST_HOC_DEV_PROXY",
			frozenBeforeCalibrationRun: true,
			blindStatus: "NOT_BLIND_DEV",
			compositionPriority: ["base-frozen-review", "accepted-edge-review", "explicit-adjudication"],
			reviews,
		},
		null,
		2,
	)}\n`,
	{ encoding: "utf8", flag: "wx" },
);
console.log(JSON.stringify({ outputPath, reviews: reviews.length }, null, 2));

function parseArguments(argv: string[]): {
	base: string;
	accepted: string;
	adjudication: string;
	relationIds: string;
	output: string;
} {
	const values = new Map<string, string>();
	for (let index = 0; index < argv.length; index += 2) {
		const flag = argv[index];
		const value = argv[index + 1];
		if (!flag?.startsWith("--") || !value) throw new Error("Expected --flag value pairs");
		values.set(flag.slice(2), value);
	}
	const required = (key: string): string => {
		const value = values.get(key);
		if (!value) throw new Error(`Missing --${key}`);
		return value;
	};
	return {
		base: required("base"),
		accepted: required("accepted"),
		adjudication: required("adjudication"),
		relationIds: required("relation-ids"),
		output: required("output"),
	};
}

function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, "utf8")) as T;
}
