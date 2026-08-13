import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config/index.js";
import {
	agentContextPackProjectionHash,
	buildAgentContextPackProjection,
	decodeCompactContextPack,
	encodeCompactContextPack,
} from "../src/context-pack/compact-transport.js";
import { buildContextPackWithDiagnostics } from "../src/context-pack/index.js";
import { measureTextCost, stableStringify } from "../src/retrieval/pack-cost-ledger.js";

type JsonRecord = Record<string, unknown>;

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const contractPath = join(
	projectRoot,
	"experiments",
	"goal3",
	"goal3-context-pack-transport-parity-contract-v1.json",
);
const contract = readJson(contractPath);
if (contract.schemaVersion !== "wge-goal3-context-pack-transport-parity-contract/v1") {
	throw new Error(`Unexpected transport parity contract: ${String(contract.schemaVersion)}`);
}
const frozenInputs = requireRecord(contract, "frozenInputs");
for (const [label, pointerValue] of Object.entries(frozenInputs)) {
	const pointer = asRecord(pointerValue, label);
	const path = requireString(pointer, "path");
	const expected = requireString(pointer, "sha256");
	const actual = sha256Bytes(readFileSync(join(projectRoot, path)));
	if (actual !== expected) throw new Error(`Frozen input drift: ${label}`);
}

const runId = process.env.WGE_GOAL3_TRANSPORT_RUN_ID ?? "context-pack-transport-parity-v1";
const runRoot = join(projectRoot, "experiments", "goal3", "context-pack-transport-runs", runId);
if (existsSync(runRoot)) throw new Error(`Refusing to overwrite transport parity run: ${runRoot}`);

const questionPointer = requireRecord(frozenInputs, "questionFile");
const questionText = readFileSync(
	join(projectRoot, requireString(questionPointer, "path")),
	"utf8",
);
const questions = readJsonl(questionText).map((row) => ({
	id: requireString(row, "caseId"),
	task: requireString(row, "question"),
}));
if (questions.length !== 18) throw new Error(`Question count drift: ${questions.length}`);

const indexPointer = requireRecord(frozenInputs, "s50IndexPointer");
const pointerPath = join(projectRoot, requireString(indexPointer, "path"));
const pointer = readJson(pointerPath);
const canonicalGenerationPath = requireString(pointer, "canonicalGenerationPath");
const workspaceRoot = dirname(dirname(canonicalGenerationPath));
const indexRoot = dirname(pointerPath);
const config = loadConfig({ projectRoot: workspaceRoot });

const rows: JsonRecord[] = [];
for (const selectionMode of ["R0", "LEGACY_CONDITIONAL"] as const) {
	for (const question of questions) {
		const built = buildContextPackWithDiagnostics(config, question.task, 4000, 2, undefined, {
			selectionMode,
			knowledgeAccess: "INDEXED",
			indexRoot,
		});
		const legacy = buildAgentContextPackProjection(built.pack);
		const encoded = encodeCompactContextPack(built.pack);
		const decoded = decodeCompactContextPack(encoded);
		const rerun = encodeCompactContextPack(built.pack);
		const legacyText = stableStringify(legacy);
		const compactText = stableStringify(encoded);
		const legacyCost = measureTextCost(legacyText);
		const compactCost = measureTextCost(compactText);
		rows.push({
			questionId: question.id,
			selectionMode,
			counts: {
				claims: built.pack.subgraph.claims.length,
				relations: built.pack.subgraph.relations.length,
				evidenceSpans: built.pack.evidenceSpans.length,
				wikiModules: built.pack.wikiModules.length,
			},
			parity: {
				projectionHash: agentContextPackProjectionHash(legacy),
				decodedHash: agentContextPackProjectionHash(decoded),
				matches: agentContextPackProjectionHash(legacy) === agentContextPackProjectionHash(decoded),
				deterministic: stableStringify(encoded) === stableStringify(rerun),
			},
			cost: {
				legacy: legacyCost,
				compact: compactCost,
				estimatedTokenReduction: ratio(
					legacyCost.estimatedTokens - compactCost.estimatedTokens,
					legacyCost.estimatedTokens,
				),
			},
		});
	}
}

const legacyTokens = rows.reduce(
	(sum, row) =>
		sum + requireNumber(requireRecord(requireRecord(row, "cost"), "legacy"), "estimatedTokens"),
	0,
);
const compactTokens = rows.reduce(
	(sum, row) =>
		sum + requireNumber(requireRecord(requireRecord(row, "cost"), "compact"), "estimatedTokens"),
	0,
);
const allParity = rows.every((row) => requireRecord(row, "parity").matches === true);
const allDeterministic = rows.every((row) => requireRecord(row, "parity").deterministic === true);
const rowsLarger = rows.filter((row) => {
	const cost = requireRecord(row, "cost");
	return (
		requireNumber(requireRecord(cost, "compact"), "estimatedTokens") >
		requireNumber(requireRecord(cost, "legacy"), "estimatedTokens")
	);
}).length;
const observedReduction = ratio(legacyTokens - compactTokens, legacyTokens);
const pass = allParity && allDeterministic && rowsLarger === 0 && observedReduction >= 0.05;
const verdict =
	!allParity || !allDeterministic ? "REWORK" : pass ? "PASS_OFFLINE_INTEGRATION" : "NARROW";
const report = {
	schemaVersion: "wge-goal3-context-pack-transport-parity-report/v1",
	runId,
	verdict,
	status: "POST_HOC_DEV_REGRESSION",
	blind: false,
	createdAt: new Date().toISOString(),
	provenance: {
		contractPath: relativePath(contractPath),
		contractSha256: sha256Bytes(readFileSync(contractPath)),
		workspaceRoot,
		indexRoot,
		questionFileSha256: sha256(questionText),
		modelCalls: 0,
		network: false,
		stageBRead: false,
	},
	checks: {
		rowCount: rows.length,
		allParity,
		allDeterministic,
		rowsLarger,
		legacyEstimatedTokens: legacyTokens,
		compactEstimatedTokens: compactTokens,
		observedReduction,
		minimumReduction: 0.05,
		pass,
	},
	limitations: [
		"This measures deterministic estimated tokens, not provider usage.",
		"The 18 questions are revealed Dev/Regression inputs, not held-out product evidence.",
		"Consumer/model compatibility and answer parity still require a separate provider-backed run.",
	],
	rows,
};
mkdirSync(runRoot, { recursive: true });
const reportText = `${JSON.stringify(report, null, 2)}\n`;
writeFileSync(join(runRoot, "report.json"), reportText, { encoding: "utf8", flag: "wx" });
writeFileSync(
	join(runRoot, "completion-proof.json"),
	`${JSON.stringify(
		{
			schemaVersion: "wge-goal3-context-pack-transport-parity-completion-proof/v1",
			runId,
			verdict,
			reportSha256: sha256(reportText),
			rowCount: rows.length,
			stageBRead: false,
		},
		null,
		2,
	)}\n`,
	{ encoding: "utf8", flag: "wx" },
);
console.log(JSON.stringify({ runRoot, verdict, checks: report.checks }, null, 2));

function requireRecord(value: JsonRecord, key: string): JsonRecord {
	return asRecord(value[key], key);
}

function asRecord(value: unknown, label: string): JsonRecord {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`Expected object: ${label}`);
	}
	return value as JsonRecord;
}

function requireString(value: JsonRecord, key: string): string {
	const candidate = value[key];
	if (typeof candidate !== "string" || candidate.length === 0)
		throw new Error(`Expected string: ${key}`);
	return candidate;
}

function requireNumber(value: JsonRecord, key: string): number {
	const candidate = value[key];
	if (typeof candidate !== "number" || !Number.isFinite(candidate)) {
		throw new Error(`Expected number: ${key}`);
	}
	return candidate;
}

function readJson(path: string): JsonRecord {
	return asRecord(JSON.parse(readFileSync(path, "utf8")) as unknown, path);
}

function readJsonl(text: string): JsonRecord[] {
	return text
		.split(/\r?\n/u)
		.filter((line) => line.trim().length > 0)
		.map((line) => asRecord(JSON.parse(line) as unknown, "JSONL row"));
}

function ratio(numerator: number, denominator: number): number {
	return denominator === 0 ? 0 : numerator / denominator;
}

function relativePath(path: string): string {
	return path.startsWith(`${projectRoot}/`) ? path.slice(projectRoot.length + 1) : path;
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function sha256Bytes(value: Buffer): string {
	return createHash("sha256").update(value).digest("hex");
}
