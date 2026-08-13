import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadConfig } from "../src/config/index.js";
import { createLLMProvider } from "../src/core/llm-provider.js";
import { lintCompileResult } from "../src/linter/index.js";
import type { SourcePublication, SourceQuarantinePublication } from "../src/linter/storage.js";
import type { Claim, Relation, SourceSpan } from "../src/types/index.js";

const projectRoot = resolve(import.meta.dirname, "..");
const baselineRoot = join(
	projectRoot,
	"experiments",
	"goal3",
	"s200-runs",
	"compile-v1",
	"workspace",
);
const replayName = process.env.WGE_AUDIT_REPLAY_NAME?.trim() || "audit-replay-v1";
if (!/^[a-zA-Z0-9._-]+$/.test(replayName)) throw new Error(`Invalid replay name: ${replayName}`);
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
]).map(resetClaim);
const relations = uniqueById([
	...publications.flatMap((publication) => publication.relations),
	...quarantines.flatMap((publication) => publication.relations.map((item) => item.relation)),
]).map(resetRelation);
const spans = readdirSync(join(baselineRoot, "sources"))
	.filter((name) => name.endsWith(".spans.jsonl"))
	.sort()
	.flatMap((name) => readJsonl<SourceSpan>(join(baselineRoot, "sources", name)));

const config = loadConfig({
	projectRoot: replayRoot,
	model: "deepseek-v4-flash",
	temperature: 0,
});
if (!config.apiKey) throw new Error("DEEPSEEK_API_KEY not set");
const provider = createLLMProvider(config);
const run = {
	sourceId: "source:s200-fixed-candidate-replay",
	runId: randomUUID(),
	model: config.model,
};
const started = process.hrtime.bigint();
const result = await lintCompileResult(config, claims, relations, [], spans, provider, { run });
const elapsedMilliseconds = Number(process.hrtime.bigint() - started) / 1_000_000;

writeJsonl(
	join(replayRoot, "claim-decisions.jsonl"),
	result.claims.map((item) => ({
		id: item.object.id,
		finalState: item.finalState,
		issueCodes: item.issues.map((issue) => issue.code),
	})),
);
writeJsonl(
	join(replayRoot, "relation-decisions.jsonl"),
	result.relations.map((item) => ({
		id: item.object.id,
		finalState: item.finalState,
		issueCodes: item.issues.map((issue) => issue.code),
	})),
);
const report = {
	schemaVersion: "wge-goal3-audit-replay/v1",
	status: "PASS",
	stageBRead: false,
	baseline: "compile-v1 frozen candidate objects",
	model: config.model,
	temperature: config.temperature,
	runId: run.runId,
	input: { claims: claims.length, relations: relations.length, spans: spans.length },
	output: {
		canonicalClaims: result.canonicalClaims.length,
		quarantinedClaims: result.quarantinedClaims.length,
		canonicalRelations: result.canonicalRelations.length,
		quarantinedRelations: result.quarantinedRelations.length,
	},
	elapsedMilliseconds: Math.round(elapsedMilliseconds),
	createdAt: new Date().toISOString(),
};
writeFileSync(join(replayRoot, "report.json"), `${JSON.stringify(report, null, 2)}\n`, {
	encoding: "utf8",
	flag: "wx",
});
console.log(JSON.stringify(report, null, 2));

function resetClaim(claim: Claim): Claim {
	return { ...claim, validity: "UNRESOLVED", publicationState: "CANDIDATE" };
}

function resetRelation(relation: Relation): Relation {
	return {
		...relation,
		validity: "UNRESOLVED",
		publicationState: "CANDIDATE",
		conditionStatus: "UNVERIFIED",
		supersessionEffect: null,
		relationAuditVersion: null,
	};
}

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
