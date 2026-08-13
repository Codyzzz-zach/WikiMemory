import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config/index.js";
import { buildGraph, walkGraph } from "../src/graph/index.js";
import {
	readAllClaims,
	readAllConcepts,
	readAllRelations,
	readAllSources,
	readAllSpans,
} from "../src/linter/storage.js";
import {
	buildPersistentSeedIndex,
	loadPersistentKnowledgeNeighborhood,
} from "../src/retrieval/persistent-index.js";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const runId = process.env.WGE_GOAL3_CLOSURE_RUN_ID ?? "closure-v1";
const runRoot = join(projectRoot, "experiments", "goal3", "closure-runs", runId);
if (existsSync(runRoot)) throw new Error(`Refusing to overwrite closure run: ${runRoot}`);
mkdirSync(runRoot, { recursive: true });

const config = loadConfig({ projectRoot });
const claims = readAllClaims(config).filter((claim) => claim.scope.type === "GLOBAL");
const spans = readAllSpans(config);
const spanById = new Map(spans.map((span) => [span.id, span]));
const sources = readAllSources(config);
const sourceIds = new Set(sources.map((source) => source.id));
const graph = buildGraph(claims, readAllConcepts(config), readAllRelations(config));
const resolvableClaims = claims.filter((claim) =>
	claim.evidenceSpanIds.some((spanId) => {
		const span = spanById.get(spanId);
		return span !== undefined && sourceIds.has(span.sourceId);
	}),
);
const selected = selectAcrossSources(resolvableClaims, spanById, 24);
if (selected.length < 12) {
	throw new Error(`Insufficient resolvable evidence samples: ${selected.length}`);
}

const indexRoot = join(runRoot, "index");
const build = buildPersistentSeedIndex(config, indexRoot);
const rows = selected.map((seed) => {
	const live = walkGraph(graph, [seed.id], 1);
	const expectedSpanIds = new Set(live.claims.flatMap((claim) => claim.evidenceSpanIds));
	const expectedSpans = spans.filter((span) => expectedSpanIds.has(span.id));
	const expectedSourceIds = [...new Set(expectedSpans.map((span) => span.sourceId))];
	const indexed = loadPersistentKnowledgeNeighborhood(indexRoot, [seed], {
		maxRelationDepth: 1,
		maxClaims: 40,
	});
	return {
		seedClaimId: seed.id,
		claimParity: sameIds(
			live.claims.map((claim) => claim.id),
			indexed.claims.map((claim) => claim.id),
		),
		relationParity: sameIds(
			live.relations.map((relation) => relation.id),
			indexed.relations.map((relation) => relation.id),
		),
		spanParity: sameIds(
			expectedSpans.map((span) => span.id),
			indexed.spans.map((span) => span.id),
		),
		sourceParity: sameIds(
			expectedSourceIds,
			indexed.sources.map((source) => source.id),
		),
		expectedSpans: expectedSpans.length,
		hydratedSpans: indexed.spans.length,
		expectedSources: expectedSourceIds.length,
		hydratedSources: indexed.sources.length,
		diagnostics: indexed.diagnostics,
	};
});
const report = {
	schemaVersion: "wge-goal3-local-closure/v1",
	runId,
	createdAt: new Date().toISOString(),
	status: rows.every(
		(row) => row.claimParity && row.relationParity && row.spanParity && row.sourceParity,
	)
		? "PASS_LOCAL_CLOSURE_PARITY"
		: "FAIL_LOCAL_CLOSURE_PARITY",
	provenance: {
		projectRoot,
		canonicalClaimFingerprint: sha256(JSON.stringify(claims.map((claim) => claim.id).sort())),
		modelCalls: 0,
		network: false,
	},
	corpus: {
		globalClaims: claims.length,
		spans: spans.length,
		sources: sources.length,
		resolvableClaims: resolvableClaims.length,
		selectedClaims: selected.length,
	},
	build,
	checks: {
		allClaimsParity: rows.every((row) => row.claimParity),
		allRelationsParity: rows.every((row) => row.relationParity),
		allSpansParity: rows.every((row) => row.spanParity),
		allSourcesParity: rows.every((row) => row.sourceParity),
		allSamplesHaveEvidence: rows.every((row) => row.expectedSpans > 0 && row.hydratedSpans > 0),
	},
	rows,
};
writeFileSync(join(runRoot, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(
	JSON.stringify(
		{ runRoot, status: report.status, corpus: report.corpus, checks: report.checks },
		null,
		2,
	),
);

function selectAcrossSources(
	availableClaims: typeof claims,
	availableSpans: ReadonlyMap<string, (typeof spans)[number]>,
	limit: number,
) {
	const bySource = new Map<string, typeof claims>();
	for (const claim of availableClaims) {
		const sourceId = claim.evidenceSpanIds
			.map((spanId) => availableSpans.get(spanId)?.sourceId)
			.find((item): item is string => item !== undefined);
		if (!sourceId) continue;
		const bucket = bySource.get(sourceId) ?? [];
		bucket.push(claim);
		bySource.set(sourceId, bucket);
	}
	const selected: typeof claims = [];
	const buckets = [...bySource.values()].map((bucket) =>
		bucket.sort((left, right) => left.id.localeCompare(right.id)),
	);
	for (let offset = 0; selected.length < limit; offset++) {
		let added = false;
		for (const bucket of buckets) {
			const claim = bucket[offset];
			if (!claim) continue;
			selected.push(claim);
			added = true;
			if (selected.length === limit) break;
		}
		if (!added) break;
	}
	return selected;
}

function sameIds(left: string[], right: string[]): boolean {
	return JSON.stringify([...new Set(left)].sort()) === JSON.stringify([...new Set(right)].sort());
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}
