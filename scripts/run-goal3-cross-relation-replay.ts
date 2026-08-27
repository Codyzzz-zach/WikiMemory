import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadConfig } from "../src/config/index.js";
import { createLLMProvider } from "../src/core/llm-provider.js";
import { lintRelationsAgainstCanonicalClaims } from "../src/linter/index.js";
import type { SourcePublication, SourceQuarantinePublication } from "../src/linter/storage.js";
import { classifySourceMetadataClaim } from "../src/relations/semantics.js";
import type { Relation, SourceSpan } from "../src/types/index.js";

const projectRoot = resolve(import.meta.dirname, "..");
const baselineName =
	process.env.WGE_CROSS_REPLAY_BASELINE?.trim() || "compile-v4-12source-regression";
const replayName = process.env.WGE_CROSS_REPLAY_NAME?.trim() || "cross-replay-v1";
for (const value of [baselineName, replayName]) {
	if (!/^[a-zA-Z0-9._-]+$/.test(value)) throw new Error(`Invalid run name: ${value}`);
}
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
const quarantineBySource = new Map(
	quarantines.map((publication) => [publication.sourceId, publication]),
);
const relationGroups = publications
	.map((publication) => ({
		sourceId: publication.sourceId,
		relations: uniqueById([
			...publication.relations,
			...(quarantineBySource.get(publication.sourceId)?.relations.map((item) => item.relation) ??
				[]),
		])
			.filter((relation) => relation.source === "cross-material-detect")
			.map(resetRelation),
	}))
	.filter((group) => group.relations.length > 0);
const relationCount = relationGroups.reduce((sum, group) => sum + group.relations.length, 0);
const spans = readdirSync(join(baselineRoot, "sources"))
	.filter((name) => name.endsWith(".spans.jsonl"))
	.sort()
	.flatMap((name) => readJsonl<SourceSpan>(join(baselineRoot, "sources", name)));

const config = loadConfig({ projectRoot: replayRoot, model: "deepseek-v4-flash", temperature: 0 });
if (!config.apiKey) throw new Error("DEEPSEEK_API_KEY not set");
const provider = createLLMProvider(config);
const started = process.hrtime.bigint();
type RelationDecision = Awaited<ReturnType<typeof lintRelationsAgainstCanonicalClaims>>[number];
const decisionEntries: Array<{ ownerSourceId: string; decision: RelationDecision }> = [];
const runIds: string[] = [];
for (const group of relationGroups) {
	const run = { sourceId: group.sourceId, runId: randomUUID(), model: config.model };
	runIds.push(run.runId);
	const groupDecisions = await lintRelationsAgainstCanonicalClaims(
		config,
		group.relations,
		claims,
		spans,
		provider,
		{ run },
	);
	decisionEntries.push(
		...groupDecisions.map((decision) => ({ ownerSourceId: group.sourceId, decision })),
	);
}
const elapsedMilliseconds = Number(process.hrtime.bigint() - started) / 1_000_000;
const decisions = decisionEntries.map(({ decision }) => decision);
const canonical = decisions.filter((item) => item.finalState === "CANONICAL");
const quarantined = decisions.filter((item) => item.finalState === "QUARANTINED");

writeJsonl(
	join(replayRoot, "relation-decisions.jsonl"),
	decisionEntries.map(({ ownerSourceId, decision: item }) => {
		const fromClaim = claimById.get(item.object.from as string);
		const toClaim = claimById.get(item.object.to as string);
		return {
			ownerSourceId,
			id: item.object.id,
			type: item.object.type,
			finalState: item.finalState,
			issueCodes: item.issues.map((issue) => issue.code),
			fromStatement: fromClaim?.statement ?? null,
			toStatement: toClaim?.statement ?? null,
			fromMetadataKind: fromClaim ? classifySourceMetadataClaim(fromClaim.statement) : null,
			toMetadataKind: toClaim ? classifySourceMetadataClaim(toClaim.statement) : null,
		};
	}),
);
const report = {
	schemaVersion: "wge-goal3-cross-relation-replay/v1",
	status: "PASS",
	stageBRead: false,
	baseline: `${baselineName} frozen cross-material candidates`,
	model: config.model,
	temperature: config.temperature,
	runIds,
	input: {
		claims: claims.length,
		relations: relationCount,
		spans: spans.length,
		sourceGroups: relationGroups.length,
	},
	output: {
		canonicalRelations: canonical.length,
		quarantinedRelations: quarantined.length,
		provenanceOnly: quarantined.filter((item) =>
			item.issues.some((issue) => issue.code === "RELATION_PROVENANCE_ONLY"),
		).length,
		utilityLow: quarantined.filter((item) =>
			item.issues.some((issue) => issue.code === "RELATION_UTILITY_LOW"),
		).length,
	},
	elapsedMilliseconds: Math.round(elapsedMilliseconds),
	createdAt: new Date().toISOString(),
};
writeFileSync(join(replayRoot, "report.json"), `${JSON.stringify(report, null, 2)}\n`, {
	encoding: "utf8",
	flag: "wx",
});
console.log(JSON.stringify(report, null, 2));

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
