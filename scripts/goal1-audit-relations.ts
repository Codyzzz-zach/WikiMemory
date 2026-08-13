import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { loadConfig } from "../src/config/index.js";
import { createLLMProvider } from "../src/core/llm-provider.js";
import { currentKnowledgeVersion } from "../src/evolution/version-store.js";
import { lintRelationsAgainstCanonicalClaims } from "../src/linter/index.js";
import {
	readAllClaims,
	readAllRelations,
	readAllSpans,
	resolveSpanById,
} from "../src/linter/storage.js";
import { RELATION_AUDIT_VERSION } from "../src/prompts/index.js";
import {
	inspectRelationCorpus,
	normalizeRelationAuditInput,
	selectStratifiedRelationSample,
	verifyRelationAuditLedger,
} from "../src/relations/audit-migration.js";
import type { Relation } from "../src/types/index.js";

interface Arguments {
	mode: "baseline" | "audit";
	runId: string;
	sampleSize: number;
	seed: string;
	relationIdsFile?: string;
	projectRoot?: string;
}

const args = parseArguments(process.argv.slice(2));
const config = loadConfig({
	projectRoot: args.projectRoot ? resolve(process.cwd(), args.projectRoot) : undefined,
});
const outputDirectory = resolve(config.projectRoot, "experiments", "goal1", "runs", args.runId);
if (existsSync(outputDirectory))
	throw new Error(`Refusing to overwrite Goal 1 run: ${outputDirectory}`);
mkdirSync(outputDirectory, { recursive: true });

const claims = readAllClaims(config);
const relations = readAllRelations(config);
const spans = readAllSpans(config);
const baseline = inspectRelationCorpus(relations, claims, spans, RELATION_AUDIT_VERSION);
const requestedRelationIds = args.relationIdsFile
	? readRelationIds(resolve(config.projectRoot, args.relationIdsFile))
	: null;
const originalSample = requestedRelationIds
	? selectRelationsById(relations, requestedRelationIds)
	: selectStratifiedRelationSample(
			relations,
			Math.min(args.sampleSize, relations.length),
			args.seed,
		);
const normalizedSample = originalSample.map(normalizeRelationAuditInput);
const sample = normalizedSample.map((item) => item.relation);
const inputSnapshotHash = hashJson({
	claims: claims.map((claim) => claim.id).sort(),
	relations: relations.map((relation) => relation).sort(compareRelations),
	spans: spans
		.map((span) => ({ id: span.id, text: span.text }))
		.sort((a, b) => a.id.localeCompare(b.id)),
});
const runtimeCodeHash = hashRuntime(config.projectRoot);
const manifest = {
	schemaVersion: "wge-goal1-relation-audit-run/v1",
	status: args.mode === "audit" ? "AUDIT_RUNNING" : "BASELINE_ONLY",
	createdAt: new Date().toISOString(),
	runId: args.runId,
	mode: args.mode,
	projectRoot: config.projectRoot,
	knowledgeVersion: currentKnowledgeVersion(config),
	inputSnapshotHash,
	runtimeCodeHash,
	model: config.model,
	temperature: config.temperature,
	relationAuditVersion: RELATION_AUDIT_VERSION,
	seed: args.seed,
	sampleSize: sample.length,
	selection: requestedRelationIds
		? {
				mode: "EXPLICIT_RELATION_IDS",
				relationIdsFile: args.relationIdsFile,
				relationIdsHash: hashJson(requestedRelationIds),
			}
		: { mode: "STRATIFIED_SEED", relationIdsFile: null, relationIdsHash: null },
	thresholds: {
		endpointResolution: 1,
		evidenceResolution: 1,
		strongEdgeHumanPrecision: 0.9,
		factRecall: 0.9,
		conditionFidelity: 0.9,
		ledgerClosure: 1,
	},
	conditionContract: {
		unverifiedAllowed: false,
		equivalentUnderRequiresNonEmptyConditions: true,
		explicitNoneAllowedWhenEvidenceEstablishesNoCondition: true,
		fabricatedConditionsAllowed: false,
	},
	normalization: {
		changedRelations: normalizedSample.filter(
			(item) => item.removedConditionPlaceholders.length > 0,
		).length,
		removedConditionPlaceholders: normalizedSample.flatMap((item) =>
			item.removedConditionPlaceholders.map((placeholder) => ({
				relationId: item.relation.id,
				placeholder,
			})),
		),
	},
	baseline,
};
writeJson(join(outputDirectory, "manifest.json"), manifest);
writeJson(join(outputDirectory, "sample-input-original.json"), originalSample);
writeJson(join(outputDirectory, "sample-input.json"), sample);

if (args.mode === "baseline") {
	writeJson(join(outputDirectory, "completion.json"), {
		status: "PASS_BASELINE",
		runId: args.runId,
		baseline,
	});
	console.log(JSON.stringify({ outputDirectory, status: "PASS_BASELINE", baseline }, null, 2));
	process.exit(0);
}

if (!config.apiKey) throw new Error("DEEPSEEK_API_KEY is required for Goal 1 relation audit");
const provider = createLLMProvider(config);
const results = await lintRelationsAgainstCanonicalClaims(
	config,
	sample,
	claims,
	spans,
	provider,
	{
		run: {
			runId: args.runId,
			sourceId: "goal1:relation-audit",
			model: config.model,
		},
	},
	new Set(claims.map((claim) => claim.id)),
);
const ledger = verifyRelationAuditLedger(sample, results, claims, spans, RELATION_AUDIT_VERSION);
const reviewPacket = results.map((result) => {
	const relation = result.object;
	const from = claims.find((claim) => claim.id === (relation.from as string));
	const to = claims.find((claim) => claim.id === (relation.to as string));
	return {
		relationId: relation.id,
		from: { id: relation.from, statement: from?.statement, conditions: from?.conditions ?? [] },
		to: { id: relation.to, statement: to?.statement, conditions: to?.conditions ?? [] },
		type: relation.type,
		conditions: relation.conditions,
		conditionStatus: relation.conditionStatus,
		auditDecision: result.finalState === "CANONICAL" ? "accept" : "reject",
		auditVersion: relation.relationAuditVersion,
		issues: result.issues,
		evidence: relation.evidenceSpanIds.map((spanId) => {
			const span = resolveSpanById(spans, spanId);
			return { spanId, sourceId: span?.sourceId, text: span?.text };
		}),
		humanReview: {
			decision: null,
			typeCorrect: null,
			directionCorrect: null,
			conditionsFaithful: null,
			evidenceSupportsEdge: null,
			notes: null,
		},
	};
});
writeJson(join(outputDirectory, "audit-results.json"), results);
writeJson(join(outputDirectory, "review-packet.json"), reviewPacket);
writeJson(join(outputDirectory, "ledger.json"), ledger);
writeJson(join(outputDirectory, "completion.json"), {
	status: ledger.closed ? "PASS_CANDIDATE_AUDIT" : "FAIL_CONTRACT",
	runId: args.runId,
	ledger,
	humanReviewStatus: "PENDING",
	publicationMutated: false,
});
console.log(
	JSON.stringify(
		{
			outputDirectory,
			status: ledger.closed ? "PASS_CANDIDATE_AUDIT" : "FAIL_CONTRACT",
			ledger,
			humanReviewStatus: "PENDING",
			publicationMutated: false,
		},
		null,
		2,
	),
);
if (!ledger.closed) process.exitCode = 1;

function parseArguments(argv: string[]): Arguments {
	let mode: Arguments["mode"] = "baseline";
	let runId = `goal1-${new Date().toISOString().replace(/[:.]/g, "-")}`;
	let sampleSize = 20;
	let seed = "goal1-v1-frozen";
	let relationIdsFile: string | undefined;
	let projectRoot: string | undefined;
	for (let index = 0; index < argv.length; index += 1) {
		const value = argv[index];
		if (value === "--mode") mode = requiredValue(argv, ++index, value) as Arguments["mode"];
		else if (value === "--run-id") runId = requiredValue(argv, ++index, value);
		else if (value === "--sample-size") {
			sampleSize = Number.parseInt(requiredValue(argv, ++index, value), 10);
		} else if (value === "--seed") seed = requiredValue(argv, ++index, value);
		else if (value === "--project-root") projectRoot = requiredValue(argv, ++index, value);
		else if (value === "--relation-ids-file") {
			relationIdsFile = requiredValue(argv, ++index, value);
		} else throw new Error(`Unknown argument: ${value}`);
	}
	if (mode !== "baseline" && mode !== "audit") throw new Error(`Invalid mode: ${mode}`);
	if (!Number.isInteger(sampleSize) || sampleSize < 1) throw new Error("sample-size must be >= 1");
	if (!/^[a-zA-Z0-9._-]+$/.test(runId)) throw new Error("run-id contains unsafe characters");
	return { mode, runId, sampleSize, seed, relationIdsFile, projectRoot };
}

function readRelationIds(path: string): string[] {
	if (!existsSync(path)) throw new Error(`Missing relation IDs file: ${path}`);
	const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
	if (!Array.isArray(parsed) || parsed.some((id) => typeof id !== "string" || id.length === 0)) {
		throw new Error("relation IDs file must be a JSON string array");
	}
	const ids = parsed as string[];
	if (new Set(ids).size !== ids.length) throw new Error("relation IDs file contains duplicates");
	return ids;
}

function selectRelationsById(relations: Relation[], ids: string[]): Relation[] {
	const byId = new Map(relations.map((relation) => [relation.id, relation]));
	const missing = ids.filter((id) => !byId.has(id));
	if (missing.length > 0) throw new Error(`Unknown relation IDs: ${missing.join(", ")}`);
	return ids.map((id) => byId.get(id) as Relation);
}

function requiredValue(argv: string[], index: number, flag: string): string {
	const value = argv[index];
	if (!value) throw new Error(`${flag} requires a value`);
	return value;
}

function writeJson(path: string, value: unknown): void {
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
}

function hashJson(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function hashRuntime(projectRoot: string): string {
	const files = [
		...walk(join(projectRoot, "src")),
		...walk(join(projectRoot, "scripts")),
		join(projectRoot, "package.json"),
		join(projectRoot, "package-lock.json"),
	]
		.filter((path) => existsSync(path))
		.sort();
	const digest = createHash("sha256");
	for (const path of files) {
		digest.update(relative(projectRoot, path));
		digest.update("\0");
		digest.update(readFileSync(path));
		digest.update("\0");
	}
	return digest.digest("hex");
}

function walk(path: string): string[] {
	if (!existsSync(path)) return [];
	if (statSync(path).isFile()) return [path];
	return readdirSync(path).flatMap((entry) => walk(join(path, entry)));
}

function compareRelations(left: Relation, right: Relation): number {
	return left.id.localeCompare(right.id);
}
