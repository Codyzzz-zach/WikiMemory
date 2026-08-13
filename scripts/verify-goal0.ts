import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";

type JsonRecord = Record<string, unknown>;

interface PreparationReport {
	status: string;
	contextBudgetTokens: number;
	selectedQuestionIds: string[];
	rows: JsonRecord[];
}

interface VerificationResult {
	schemaVersion: "wge-goal0-verification/v1";
	status: "PASS_OFFLINE" | "PASS";
	verifiedAt: string;
	preparationId: string;
	questions: number;
	contexts: number;
	knowledgeContexts: number;
	contextBudgetTokens: number;
	checks: {
		contextHashes: number;
		inputSnapshotHashes: number;
		traceHashes: number;
		budgetRows: number;
		closureRows: number;
		claimEvidenceLinks: number;
		relationEndpointLinks: number;
		seedCandidates: number;
		seedDropDecisions: number;
		gateDecisions: number;
		traversalSteps: number;
		dropDecisions: number;
		unitTokenDecisions: number;
		toolCallRecords: number;
		onlineAnswerRecords: number;
		onlineUsageRecords: number;
		promptHashes: number;
	};
	answerRun: string | null;
}

const program = new Command();
program
	.name("verify-goal0")
	.requiredOption("--preparation <id>", "Batch C post-hoc preparation id")
	.option("--answers <directory>", "Optional post-hoc answer run directory")
	.option("--proof <path>", "Optional new proof file; existing files are never overwritten")
	.parse();
const options = program.opts<{ preparation: string; answers?: string; proof?: string }>();

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const preparationRoot = join(
	projectRoot,
	"experiments",
	"benchmark-batch-c",
	"post-hoc",
	"preparations",
	options.preparation,
);
const report = readJson<PreparationReport>(join(preparationRoot, "context-preparation.json"));
assert(report.status === "PREPARED_POST_HOC", "Goal 0 verifier only accepts post-hoc preparations");
assert(
	report.selectedQuestionIds.length >= 4 && report.selectedQuestionIds.length <= 8,
	`Goal 0 Micro must contain 4–8 questions, found ${report.selectedQuestionIds.length}`,
);
assert(
	new Set(report.selectedQuestionIds).size === report.selectedQuestionIds.length,
	"Duplicate IDs",
);

const expectedGroups = ["B", "P-seed", "P-graph"];
const expectedRows = report.selectedQuestionIds.length * expectedGroups.length;
assert(
	report.rows.length === expectedRows,
	`Expected ${expectedRows} contexts, found ${report.rows.length}`,
);

let contextHashes = 0;
let inputSnapshotHashes = 0;
let traceHashes = 0;
let budgetRows = 0;
let closureRows = 0;
let claimEvidenceLinks = 0;
let relationEndpointLinks = 0;
let seedCandidates = 0;
let seedDropDecisions = 0;
let gateDecisions = 0;
let traversalSteps = 0;
let dropDecisions = 0;
let unitTokenDecisions = 0;
let toolCallRecords = 0;

const rowByKey = new Map<string, JsonRecord>();
for (const questionId of report.selectedQuestionIds) {
	for (const group of expectedGroups) {
		const matches = report.rows.filter(
			(row) => row.questionId === questionId && row.group === group,
		);
		assert(matches.length === 1, `Expected one row for ${questionId}/${group}`);
		const row = requireRecord(matches[0], `${questionId}/${group}`);
		rowByKey.set(`${questionId}\0${group}`, row);
		const contextPath = join(preparationRoot, "contexts", `${questionId}--${group}.txt`);
		const context = readFileSync(contextPath, "utf8");
		assert(
			sha256(context) === requireString(row, "contextHash"),
			`Context hash drift: ${questionId}/${group}`,
		);
		contextHashes++;
		requireString(row, "inputSnapshotHash");
		inputSnapshotHashes++;
		const estimatedTokens = requireNumber(row, "estimatedContextTokens");
		assert(
			estimatedTokens <= report.contextBudgetTokens,
			`Budget exceeded: ${questionId}/${group}`,
		);
		budgetRows++;
		assert(requireNumber(row, "toolCalls") >= 0, `Invalid toolCalls: ${questionId}/${group}`);
		toolCallRecords++;

		const trace = requireRecord(row.retrievalTrace, `${questionId}/${group}.retrievalTrace`);
		assert(
			trace.schemaVersion === "wge-context-trace/v1",
			`Trace schema mismatch: ${questionId}/${group}`,
		);
		assert(
			sha256(stableJson(trace)) === requireString(row, "traceHash"),
			`Trace hash drift: ${questionId}/${group}`,
		);
		traceHashes++;
		const hashes = requireRecord(trace.hashes, "trace.hashes");
		for (const key of ["questionHash", "configHash", "inputSnapshotHash", "contextHash"] as const) {
			assert(hashes[key] === row[key], `Trace ${key} mismatch: ${questionId}/${group}`);
		}

		if (group === "B") continue;
		const closure = requireRecord(trace.closure, "trace.closure");
		assert(closure.complete === true, `Closure failed: ${questionId}/${group}`);
		assert(
			requireArray(closure.missingClaimEvidence, "missingClaimEvidence").length === 0,
			"Missing Claim evidence",
		);
		assert(
			requireArray(closure.missingRelationEndpoints, "missingRelationEndpoints").length === 0,
			"Missing Relation endpoint",
		);
		closureRows++;

		const headings = parseHeadings(context);
		for (const claim of parseClaimBlocks(context)) {
			assert(claim.conditionsPresent, `Claim conditions absent: ${claim.id}`);
			assert(claim.provenancePresent, `Claim provenance absent: ${claim.id}`);
			for (const spanId of claim.supportingSpanIds) {
				assert(headings.evidence.has(spanId), `Claim ${claim.id} lacks visible Evidence ${spanId}`);
				claimEvidenceLinks++;
			}
		}
		for (const relation of parseRelations(context)) {
			assert(headings.claims.has(relation.from), `Relation ${relation.id} lacks from endpoint`);
			assert(headings.claims.has(relation.to), `Relation ${relation.id} lacks to endpoint`);
			relationEndpointLinks += 2;
		}

		const candidateFlow = requireRecord(trace.candidateFlow, "trace.candidateFlow");
		for (const seedValue of requireArray(candidateFlow.seed, "candidateFlow.seed")) {
			const seed = requireRecord(seedValue, "seedCandidate");
			requireString(seed, "claimId");
			requireNumber(seed, "rank");
			requireNumber(seed, "score");
			assert(Array.isArray(seed.channels), "Seed candidate lacks channels");
			requireNumber(seed, "matchedFeatureCount");
			assert(typeof seed.selected === "boolean", "Seed candidate lacks selected decision");
			if (seed.selected === false) {
				requireString(seed, "dropReason");
				seedDropDecisions++;
			}
			seedCandidates++;
		}
		for (const gateValue of requireArray(candidateFlow.relationGates, "relationGates")) {
			const gate = requireRecord(gateValue, "relationGate");
			for (const key of [
				"relationId",
				"from",
				"to",
				"type",
				"conditionStatus",
				"reason",
			] as const) {
				requireString(gate, key);
			}
			assert(Array.isArray(gate.conditions), "Relation gate lacks conditions");
			assert("relationAuditVersion" in gate, "Relation gate lacks audit version");
			gateDecisions++;
		}
		const packBuild = requireRecord(trace.packBuild, "trace.packBuild");
		const graph = requireRecord(packBuild.graph, "trace.packBuild.graph");
		for (const stepValue of requireArray(graph.traversal, "graph.traversal")) {
			const step = requireRecord(stepValue, "traversalStep");
			for (const key of [
				"relationId",
				"fromNodeId",
				"toNodeId",
				"navigationDirection",
				"triggerReason",
				"type",
				"conditionStatus",
				"structureScoreReason",
			] as const) {
				requireString(step, key);
			}
			assert(
				Array.isArray(step.pathNodeIds) && step.pathNodeIds.length >= 2,
				"Traversal lacks node path",
			);
			assert(
				Array.isArray(step.pathRelationIds) && step.pathRelationIds.length >= 1,
				"Traversal lacks relation path",
			);
			assert(step.structureScore === null, "R0 must not invent a structure score");
			traversalSteps++;
		}
		const buildBudget = requireRecord(packBuild.budget, "trace.packBuild.budget");
		for (const dropValue of requireArray(buildBudget.dropped, "packBuild.budget.dropped")) {
			const drop = requireRecord(dropValue, "drop");
			requireString(drop, "id");
			requireString(drop, "reason");
			dropDecisions++;
		}
		const serialization = requireRecord(trace.serialization, "trace.serialization");
		for (const decisionValue of requireArray(serialization.decisions, "serialization.decisions")) {
			const decision = requireRecord(decisionValue, "unitDecision");
			requireString(decision, "id");
			requireString(decision, "kind");
			requireString(decision, "reason");
			requireNumber(decision, "estimatedMarginalTokens");
			unitTokenDecisions++;
		}
	}
}
assert(dropDecisions > 0, "Goal 0 stress Micro did not exercise any drop decision");
assert(seedDropDecisions > 0, "Goal 0 Micro did not expose any Seed cutoff decision");

let onlineAnswerRecords = 0;
let onlineUsageRecords = 0;
let promptHashes = 0;
let answerRun: string | null = null;
const onlineQuestionIds = new Set<string>();
if (options.answers) {
	const answerRoot = resolve(projectRoot, options.answers);
	answerRun = answerRoot;
	const manifest = readJson<JsonRecord>(join(answerRoot, "manifest.json"));
	assert(manifest.status === "SEALED_POST_HOC", "Goal 0 answers must remain post-hoc");
	for (const questionId of report.selectedQuestionIds) {
		for (const group of expectedGroups) {
			const recordPath = join(answerRoot, "records", `${questionId}--${group}.json`);
			if (!existsSync(recordPath)) continue;
			const record = readJson<JsonRecord>(recordPath);
			const row = rowByKey.get(`${questionId}\0${group}`);
			assert(row, `Missing preparation row for answer ${questionId}/${group}`);
			const request = requireRecord(record.request, "answer.request");
			const userPrompt = requireString(request, "userPrompt");
			const expectedContext = readFileSync(
				join(preparationRoot, "contexts", `${questionId}--${group}.txt`),
				"utf8",
			);
			assert(
				userPrompt.endsWith(`# 检索上下文\n${expectedContext}`),
				`Actual Prompt does not contain the verified Context: ${questionId}/${group}`,
			);
			const prompt = `${requireString(request, "systemPrompt")}\n${userPrompt}`;
			assert(
				sha256(prompt) === requireString(record, "promptHash"),
				`Prompt hash drift: ${questionId}/${group}`,
			);
			promptHashes++;
			for (const key of [
				"contextHash",
				"questionHash",
				"configHash",
				"inputSnapshotHash",
				"traceHash",
			] as const) {
				assert(record[key] === row[key], `Answer ${key} mismatch: ${questionId}/${group}`);
			}
			const usage = requireRecord(record.usage, "answer.usage");
			assert(requireNumber(usage, "totalTokens") > 0, `No actual usage: ${questionId}/${group}`);
			assert(requireNumber(record, "latencyMs") >= 0, `Invalid latency: ${questionId}/${group}`);
			assert(
				record.toolCalls === row.toolCalls,
				`Answer toolCalls mismatch: ${questionId}/${group}`,
			);
			toolCallRecords++;
			requireString(record, "modelRequested");
			requireString(record, "modelReturned");
			assert("finishReason" in record, `Missing finishReason: ${questionId}/${group}`);
			onlineUsageRecords++;
			onlineAnswerRecords++;
			onlineQuestionIds.add(questionId);
		}
	}
	assert(
		onlineQuestionIds.size >= 4,
		`Online Micro must cover at least 4 questions; found ${onlineQuestionIds.size}`,
	);
	for (const questionId of onlineQuestionIds) {
		for (const group of expectedGroups) {
			assert(
				existsSync(join(answerRoot, "records", `${questionId}--${group}.json`)),
				`Online Micro lacks paired group ${questionId}/${group}`,
			);
		}
	}
}

const result: VerificationResult = {
	schemaVersion: "wge-goal0-verification/v1",
	status: options.answers ? "PASS" : "PASS_OFFLINE",
	verifiedAt: new Date().toISOString(),
	preparationId: options.preparation,
	questions: report.selectedQuestionIds.length,
	contexts: report.rows.length,
	knowledgeContexts: closureRows,
	contextBudgetTokens: report.contextBudgetTokens,
	checks: {
		contextHashes,
		inputSnapshotHashes,
		traceHashes,
		budgetRows,
		closureRows,
		claimEvidenceLinks,
		relationEndpointLinks,
		seedCandidates,
		seedDropDecisions,
		gateDecisions,
		traversalSteps,
		dropDecisions,
		unitTokenDecisions,
		toolCallRecords,
		onlineAnswerRecords,
		onlineUsageRecords,
		promptHashes,
	},
	answerRun,
};
if (options.proof) {
	const proofPath = resolve(projectRoot, options.proof);
	assert(!existsSync(proofPath), `Proof already exists and will not be overwritten: ${proofPath}`);
	writeFileSync(proofPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}
console.log(JSON.stringify(result, null, 2));

function parseHeadings(context: string): { claims: Set<string>; evidence: Set<string> } {
	return {
		claims: new Set([...context.matchAll(/^## CLAIM (.+)$/gm)].map((match) => match[1] ?? "")),
		evidence: new Set([...context.matchAll(/^## EVIDENCE (.+)$/gm)].map((match) => match[1] ?? "")),
	};
}

function parseClaimBlocks(context: string): Array<{
	id: string;
	conditionsPresent: boolean;
	provenancePresent: boolean;
	supportingSpanIds: string[];
}> {
	return [...context.matchAll(/^## CLAIM (.+)\n([\s\S]*?)(?=\n\n## |(?![\s\S]))/gm)].map(
		(match) => {
			const id = match[1] ?? "";
			const block = match[2] ?? "";
			const supportingLine = block.match(/^Supporting evidence refs: (.+)$/m)?.[1];
			assert(supportingLine, `Claim supporting evidence refs absent: ${id}`);
			const refs = JSON.parse(supportingLine) as unknown;
			return {
				id,
				conditionsPresent: /^Conditions: /m.test(block),
				provenancePresent: /^Provenance: /m.test(block),
				supportingSpanIds: requireArray(refs, `supporting refs for ${id}`).flatMap((value) => {
					const ref = requireRecord(value, `supporting ref for ${id}`);
					return ref.type === "SourceSpan" ? [requireString(ref, "spanId")] : [];
				}),
			};
		},
	);
}

function parseRelations(context: string): Array<{ id: string; from: string; to: string }> {
	return [...context.matchAll(/^## RELATION (.+)\n(.+) --\[[A-Z_]+\]--> (.+)$/gm)].map((match) => ({
		id: match[1] ?? "",
		from: match[2] ?? "",
		to: match[3] ?? "",
	}));
}

function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, "utf8")) as T;
}
function requireRecord(value: unknown, label: string): JsonRecord {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`Expected object: ${label}`);
	}
	return value as JsonRecord;
}
function requireArray(value: unknown, label: string): unknown[] {
	if (!Array.isArray(value)) throw new Error(`Expected array: ${label}`);
	return value;
}
function requireString(record: JsonRecord, key: string): string {
	const value = record[key];
	if (typeof value !== "string" || value.length === 0) throw new Error(`Missing string ${key}`);
	return value;
}
function requireNumber(record: JsonRecord, key: string): number {
	const value = record[key];
	if (typeof value !== "number" || !Number.isFinite(value))
		throw new Error(`Missing number ${key}`);
	return value;
}
function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}
function stableJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
	if (value && typeof value === "object") {
		return `{${Object.entries(value as JsonRecord)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}
function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}
