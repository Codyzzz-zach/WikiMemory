import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config/index.js";
import {
	readAllClaims,
	readAllRelations,
	readAllSources,
	readAllSpans,
	readSourcePublications,
	resolveSpanById,
} from "../src/linter/storage.js";

type JsonRecord = Record<string, unknown>;

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const experimentRoot = join(projectRoot, "experiments", "benchmark-seed-v1");
const workspaceRoot = join(experimentRoot, "workspace");
const batchRoot = join(projectRoot, "workbuddy-batch-b", "generated");
const reportRoot = join(experimentRoot, "reports", "e1");
const config = loadConfig({ projectRoot: workspaceRoot });

const facts = readJsonl(join(batchRoot, "candidates", "facts.jsonl"));
const relationAnchors = readJsonl(join(batchRoot, "candidates", "relations.jsonl"));
const sourceManifest = readJsonl(join(batchRoot, "source-manifest.jsonl"));
const sources = readAllSources(config);
const spans = readAllSpans(config);
const claims = readAllClaims(config);
const relations = readAllRelations(config);
const publications = readSourcePublications(config);

const sourceBySeedId = new Map(
	sourceManifest.map((row) => {
		const seedId = requireString(row, "sourceId");
		const source = sources.find((item) => basename(item.uri, ".md") === seedId);
		if (!source) throw new Error(`E1 workspace missing source ${seedId}`);
		return [seedId, source] as const;
	}),
);
const publicationBySource = new Map(publications.map((item) => [item.sourceId, item]));

let brokenEvidence = 0;
for (const claim of claims) {
	for (const spanId of claim.evidenceSpanIds) {
		if (!resolveSpanById(spans, spanId)) brokenEvidence++;
	}
}

const factRows = facts.map((fact) => {
	const factId = requireString(fact, "candidateId");
	const seedSourceId = requireString(fact, "sourceId");
	const source = sourceBySeedId.get(seedSourceId);
	if (!source) throw new Error(`Unknown source for ${factId}`);
	const publication = publicationBySource.get(source.id);
	if (!publication) throw new Error(`Missing publication for ${factId}`);
	const exactQuote = requireString(fact, "exactQuote");
	const matchedClaims = publication.claims.filter((claim) =>
		claim.evidenceSpanIds.some((spanId) => {
			const span = resolveSpanById(spans, spanId);
			return span ? overlapsEvidence(exactQuote, span.text) : false;
		}),
	);
	const expectedConditions = stringArray(fact.conditions);
	const timeScope = typeof fact.timeScope === "string" ? fact.timeScope : null;
	const attributionLabel = expectedAttribution(seedSourceId, String(fact.statementKind ?? "fact"));
	return {
		factId,
		sourceId: seedSourceId,
		statementKind: fact.statementKind,
		matchedClaimIds: matchedClaims.map((claim) => claim.id),
		matchedStatements: matchedClaims.map((claim) => claim.statement),
		evidenceCovered: matchedClaims.length > 0,
		conditionsExpected: expectedConditions,
		conditionsExplicit:
			expectedConditions.length === 0 || matchedClaims.some((claim) => claim.conditions.length > 0),
		timeScopeExpected: timeScope,
		timeScopeExplicit:
			timeScope === null ||
			matchedClaims.some((claim) => hasTimeSignal(claim.statement, timeScope)),
		attributionExpected: attributionLabel,
		attributionExplicit:
			attributionLabel === null ||
			matchedClaims.some((claim) =>
				normalize(claim.statement).includes(normalize(attributionLabel)),
			),
	};
});

const factMatches = new Map(
	factRows.map((row) => [row.factId, new Set(row.matchedClaimIds)] as const),
);
const relationRows = relationAnchors.map((anchor) => {
	const anchorId = requireString(anchor, "candidateId");
	const fromFact = requireString(anchor, "from");
	const toFact = requireString(anchor, "to");
	const expectedType = requireString(anchor, "type");
	const fromClaims = factMatches.get(fromFact) ?? new Set<string>();
	const toClaims = factMatches.get(toFact) ?? new Set<string>();
	const matched = relations.filter(
		(relation) =>
			relation.type === expectedType && fromClaims.has(relation.from) && toClaims.has(relation.to),
	);
	return {
		anchorId,
		fromFact,
		toFact,
		expectedType,
		matchedRelationIds: matched.map((relation) => relation.id),
		typeAndDirectionMatched: matched.length > 0,
		conditionsExpected: stringArray(anchor.conditions),
		conditionsExplicit: matched.some((relation) => relation.conditions.length > 0),
	};
});

const factsWithConditions = factRows.filter((row) => row.conditionsExpected.length > 0);
const factsWithTime = factRows.filter((row) => row.timeScopeExpected !== null);
const factsWithAttribution = factRows.filter((row) => row.attributionExpected !== null);
const metrics = {
	factEvidenceRecall: ratio(factRows.filter((row) => row.evidenceCovered).length, factRows.length),
	conditionExplicitRecall: ratio(
		factsWithConditions.filter((row) => row.conditionsExplicit).length,
		factsWithConditions.length,
	),
	timeScopeExplicitRecall: ratio(
		factsWithTime.filter((row) => row.timeScopeExplicit).length,
		factsWithTime.length,
	),
	attributionExplicitRecall: ratio(
		factsWithAttribution.filter((row) => row.attributionExplicit).length,
		factsWithAttribution.length,
	),
	relationTypeDirectionRecall: ratio(
		relationRows.filter((row) => row.typeAndDirectionMatched).length,
		relationRows.length,
	),
	relationConditionExplicitRecall: ratio(
		relationRows.filter((row) => row.conditionsExplicit).length,
		relationRows.length,
	),
	brokenEvidence,
};

const report = {
	schemaVersion: "wge-e1-structural-evaluation/v1",
	status: brokenEvidence === 0 ? "MEASURED" : "HARD_FAILURE",
	suiteId: "benchmark-seed-six-domain-v1",
	workspace: "experiments/benchmark-seed-v1/workspace",
	inputHashes: {
		facts: sha256(readFileSync(join(batchRoot, "candidates", "facts.jsonl"), "utf8")),
		relations: sha256(readFileSync(join(batchRoot, "candidates", "relations.jsonl"), "utf8")),
	},
	counts: {
		sources: sources.length,
		claims: claims.length,
		relations: relations.length,
		factAnchors: factRows.length,
		relationAnchors: relationRows.length,
	},
	metrics,
	hardFailures: brokenEvidence === 0 ? [] : [`${brokenEvidence} unresolved evidence spans`],
	limitations: [
		"This pass measures structural conservation, not full semantic equivalence.",
		"Condition recall only checks that conditions remain explicit; a semantic critic must check their meaning.",
		"Time and attribution checks are conservative string-signal tests and may undercount valid paraphrases.",
		"Candidate anchors are Codex-curated directional references, not independent human Gold.",
	],
	facts: factRows,
	relations: relationRows,
};

mkdirSync(reportRoot, { recursive: true });
writeFileSync(join(reportRoot, "structural-report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ status: report.status, ...report.counts, metrics }, null, 2));

function overlapsEvidence(anchor: string, evidence: string): boolean {
	const left = normalize(anchor);
	const right = normalize(evidence);
	return left.length >= 20 && right.length >= 20 && (left.includes(right) || right.includes(left));
}

function normalize(value: string): string {
	return value.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function hasTimeSignal(statement: string, timeScope: string): boolean {
	const scope = normalize(timeScope.replace(/^(as-of|as-reported|standard):/, ""));
	const text = normalize(statement);
	const years = scope.match(/20\d{2}/g) ?? [];
	if (years.length > 0) return years.some((year) => text.includes(year));
	return scope.length > 0 && text.includes(scope);
}

function expectedAttribution(sourceId: string, statementKind: string): string | null {
	if (
		!/(author|reported|source-attribution|project|proposal|opinion|secondary)/.test(statementKind)
	) {
		return null;
	}
	if (sourceId.includes("nature")) return "Nature";
	if (sourceId.includes("scrollprize")) return "project";
	if (sourceId.includes("issue")) return "issue";
	if (sourceId.includes("webaim")) return "WebAIM";
	return null;
}

function ratio(numerator: number, denominator: number): number | null {
	return denominator === 0 ? null : Number((numerator / denominator).toFixed(4));
}

function readJsonl(path: string): JsonRecord[] {
	return readFileSync(path, "utf8")
		.split("\n")
		.filter((line) => line.trim().length > 0)
		.map((line) => JSON.parse(line) as JsonRecord);
}

function requireString(record: JsonRecord, key: string): string {
	const value = record[key];
	if (typeof value !== "string" || value.length === 0) throw new Error(`Missing string ${key}`);
	return value;
}

function stringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

function sha256(value: string): string {
	return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}
