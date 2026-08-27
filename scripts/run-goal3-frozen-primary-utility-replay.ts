import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadConfig } from "../src/config/index.js";
import { createLLMProvider } from "../src/core/llm-provider.js";
import { reviewRelatedToUtility } from "../src/linter/index.js";
import type { SourcePublication, SourceQuarantinePublication } from "../src/linter/storage.js";
import { classifySourceMetadataClaim } from "../src/relations/semantics.js";
import type { SourceSpan } from "../src/types/index.js";

const projectRoot = resolve(import.meta.dirname, "..");
const baselineName =
	process.env.WGE_UTILITY_REPLAY_BASELINE?.trim() || "compile-v4-12source-regression";
if (!/^[a-zA-Z0-9._-]+$/.test(baselineName))
	throw new Error(`Invalid replay baseline: ${baselineName}`);
const replayName = process.env.WGE_UTILITY_REPLAY_NAME?.trim() || "utility-replay-v1";
if (!/^[a-zA-Z0-9._-]+$/.test(replayName)) throw new Error(`Invalid replay name: ${replayName}`);
const baselineRoot = join(
	projectRoot,
	"experiments",
	"goal3",
	"s200-runs",
	baselineName,
	"workspace",
);
const replayRoot = join(projectRoot, "experiments", "goal3", "s200-runs", replayName);
if (existsSync(join(replayRoot, "report.json"))) {
	throw new Error(`Replay output already exists: ${replayRoot}`);
}
for (const directory of ["sources", "wiki", "quarantine", "indexes", "runs", "publications"]) {
	mkdirSync(join(replayRoot, directory), { recursive: true });
}

const publications = readJsonDirectory<SourcePublication>(join(baselineRoot, "publications"));
const quarantines = readJsonDirectory<SourceQuarantinePublication>(
	join(baselineRoot, "quarantine", "publications"),
);
const claims = uniqueById([
	...publications.flatMap((publication) => publication.claims),
	...quarantines.flatMap((publication) => publication.claims.map((item) => item.claim)),
]);
const claimById = new Map(claims.map((claim) => [claim.id, claim]));
const downstreamOnlyIssueCodes = new Set(["RELATION_PROVENANCE_ONLY", "RELATION_UTILITY_LOW"]);
const frozenPrimaryPassed = [
	...publications.flatMap((publication) =>
		publication.relations
			.filter((relation) => relation.source === "cross-material-detect")
			.map((relation) => ({ ownerSourceId: publication.sourceId, relation })),
	),
	...quarantines.flatMap((publication) =>
		publication.relations
			.filter(
				(item) =>
					item.relation.source === "cross-material-detect" &&
					item.issues.length > 0 &&
					item.issues.every((issue) => downstreamOnlyIssueCodes.has(issueCode(issue))),
			)
			.map((item) => ({ ownerSourceId: publication.sourceId, relation: item.relation })),
	),
];
const frozenPrimaryPassedIds = new Set(frozenPrimaryPassed.map(({ relation }) => relation.id));
const frozenPrimaryFailed = quarantines.flatMap((publication) =>
	publication.relations
		.filter(
			(item) =>
				item.relation.source === "cross-material-detect" &&
				!frozenPrimaryPassedIds.has(item.relation.id),
		)
		.map((item) => ({ ownerSourceId: publication.sourceId, item })),
);
const spans = readdirSync(join(baselineRoot, "sources"))
	.filter((name) => name.endsWith(".spans.jsonl"))
	.sort()
	.flatMap((name) => readJsonl<SourceSpan>(join(baselineRoot, "sources", name)));

const config = loadConfig({ projectRoot: replayRoot, model: "deepseek-v4-flash", temperature: 0 });
if (!config.apiKey) throw new Error("DEEPSEEK_API_KEY not set");
const provider = createLLMProvider(config);
const decisions: Array<Record<string, unknown>> = frozenPrimaryFailed.map(
	({ ownerSourceId, item }) => ({
		ownerSourceId,
		id: item.relation.id,
		type: item.relation.type,
		finalState: "QUARANTINED",
		decisionLayer: "FROZEN_PRIMARY",
		issueCodes: item.issues.map((issue) =>
			typeof issue === "object" && issue !== null && "code" in issue ? issue.code : "UNKNOWN",
		),
	}),
);
const started = process.hrtime.bigint();
let provenanceOnly = 0;
let utilityLow = 0;
let utilityInvalid = 0;
for (const { ownerSourceId, relation } of frozenPrimaryPassed) {
	const fromClaim = claimById.get(relation.from as string);
	const toClaim = claimById.get(relation.to as string);
	if (!fromClaim || !toClaim) throw new Error(`Missing endpoint for ${relation.id}`);
	const fromMetadataKind = classifySourceMetadataClaim(fromClaim.statement);
	const toMetadataKind = classifySourceMetadataClaim(toClaim.statement);
	if (fromMetadataKind || toMetadataKind) {
		provenanceOnly++;
		decisions.push({
			ownerSourceId,
			id: relation.id,
			type: relation.type,
			finalState: "QUARANTINED",
			decisionLayer: "PROVENANCE_GATE",
			issueCodes: ["RELATION_PROVENANCE_ONLY"],
			fromStatement: fromClaim.statement,
			toStatement: toClaim.statement,
			fromMetadataKind,
			toMetadataKind,
		});
		continue;
	}
	const run = { sourceId: ownerSourceId, runId: randomUUID(), model: config.model };
	try {
		const verdict = await reviewRelatedToUtility(
			config,
			relation,
			fromClaim,
			toClaim,
			spans,
			provider,
			run,
		);
		if (verdict.verdict === "failed") utilityLow++;
		decisions.push({
			ownerSourceId,
			id: relation.id,
			type: relation.type,
			finalState: verdict.verdict === "passed" ? "CANONICAL" : "QUARANTINED",
			decisionLayer: "UTILITY_CRITIC",
			issueCodes: verdict.verdict === "passed" ? [] : ["RELATION_UTILITY_LOW"],
			failureModes: verdict.failureModes,
			fromStatement: fromClaim.statement,
			toStatement: toClaim.statement,
		});
	} catch (error) {
		utilityInvalid++;
		decisions.push({
			ownerSourceId,
			id: relation.id,
			type: relation.type,
			finalState: "QUARANTINED",
			decisionLayer: "UTILITY_CRITIC",
			issueCodes: ["RELATION_AUDIT_INVALID"],
			error: error instanceof Error ? error.message : String(error),
			fromStatement: fromClaim.statement,
			toStatement: toClaim.statement,
		});
	}
}
const elapsedMilliseconds = Number(process.hrtime.bigint() - started) / 1_000_000;
const canonicalRelations = decisions.filter((item) => item.finalState === "CANONICAL").length;
const quarantinedRelations = decisions.filter((item) => item.finalState === "QUARANTINED").length;
writeJsonl(join(replayRoot, "relation-decisions.jsonl"), decisions);
const report = {
	schemaVersion: "wge-goal3-frozen-primary-utility-replay/v1",
	status: "PASS",
	stageBRead: false,
	baseline: `${baselineName} frozen primary Relation decisions`,
	model: config.model,
	temperature: config.temperature,
	input: {
		claims: claims.length,
		frozenPrimaryPassed: frozenPrimaryPassed.length,
		frozenPrimaryFailed: frozenPrimaryFailed.length,
		spans: spans.length,
	},
	output: {
		canonicalRelations,
		quarantinedRelations,
		provenanceOnly,
		utilityLow,
		utilityInvalid,
	},
	elapsedMilliseconds: Math.round(elapsedMilliseconds),
	createdAt: new Date().toISOString(),
};
writeFileSync(join(replayRoot, "report.json"), `${JSON.stringify(report, null, 2)}\n`, {
	encoding: "utf8",
	flag: "wx",
});
console.log(JSON.stringify(report, null, 2));

function readJsonDirectory<T>(directory: string): T[] {
	return readdirSync(directory)
		.filter((name) => name.endsWith(".json"))
		.sort()
		.map((name) => JSON.parse(readFileSync(join(directory, name), "utf8")) as T);
}

function readJsonl<T>(path: string): T[] {
	return readFileSync(path, "utf8")
		.split("\n")
		.filter((row) => row.trim().length > 0)
		.map((row) => JSON.parse(row) as T);
}

function writeJsonl(path: string, rows: unknown[]): void {
	writeFileSync(path, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, {
		encoding: "utf8",
		flag: "wx",
	});
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
	return [...new Map(items.map((item) => [item.id, item])).values()];
}

function issueCode(issue: unknown): string {
	return typeof issue === "object" && issue !== null && "code" in issue
		? String(issue.code)
		: "UNKNOWN";
}
