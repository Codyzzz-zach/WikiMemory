import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config/index.js";
import type { PilotConfig, PilotGroup } from "../src/pilot/index.js";
import { preparePilotContext } from "../src/pilot/index.js";

type JsonRecord = Record<string, unknown>;

interface Selection {
	schemaVersion: string;
	status: string;
	taskFile: string;
	taskFileSha256: string;
	questionIds: string[];
	groups: Array<"B" | "P">;
	eMinStatus: string;
	eMinReason: string;
}

interface FactRow {
	factId: string;
	sourceId: string;
	matchedClaimIds: string[];
}

interface AblationMode {
	id: "B" | "P-seed" | "P-graph";
	pilotGroup: "B" | "P";
	graphExpansion: boolean;
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const experimentRoot = join(projectRoot, "experiments", "benchmark-seed-v1");
const smokeRoot = join(experimentRoot, "e4-smoke");
const workspaceRoot = join(experimentRoot, "workspace");
const selectionArgument = argumentValue("--selection");
const reportName = argumentValue("--report-name") ?? "e4-smoke";
const reportRoot = join(experimentRoot, "reports", reportName);
const selectionPath = selectionArgument
	? resolve(projectRoot, selectionArgument)
	: join(smokeRoot, "selection.json");
const selection = readJson<Selection>(selectionPath);
const ablation = readJson<{ modes: AblationMode[] }>(join(smokeRoot, "ablation.json"));
const taskPath = join(projectRoot, selection.taskFile);
const taskText = readFileSync(taskPath, "utf8");
const taskHash = sha256(taskText);

if (selection.taskFileSha256 === "TO_BE_LOCKED_BY_PREPARE_SCRIPT") {
	selection.taskFileSha256 = taskHash;
	writeJson(selectionPath, selection);
} else if (selection.taskFileSha256 !== taskHash) {
	throw new Error(
		`E4 smoke task file drifted: expected ${selection.taskFileSha256}, got ${taskHash}`,
	);
}

const pilotConfig = readJson<PilotConfig>(join(smokeRoot, "config.json"));
const appConfig = loadConfig({ projectRoot: workspaceRoot });
const tasks = readJsonl(taskPath);
const taskById = new Map(tasks.map((task) => [requireString(task, "caseId"), task] as const));
const questions = selection.questionIds.map((id) => {
	const task = taskById.get(id);
	if (!task) throw new Error(`Missing frozen E4 smoke question ${id}`);
	return task;
});
const e1 = readJson<{ facts: FactRow[] }>(
	join(experimentRoot, "reports", "e1", "structural-report.json"),
);
const factById = new Map(e1.facts.map((fact) => [fact.factId, fact] as const));

mkdirSync(join(reportRoot, "contexts"), { recursive: true });
const rows: JsonRecord[] = [];
for (const question of questions) {
	const questionId = requireString(question, "caseId");
	const questionText = requireString(question, "question");
	const evidence = recordArray(question.requiredEvidence);
	for (const mode of ablation.modes) {
		const prepared = preparePilotContext(
			appConfig,
			pilotConfig,
			{ id: questionId, question: questionText },
			mode.pilotGroup as PilotGroup,
			{ graphExpansion: mode.graphExpansion },
		);
		writeFileSync(join(reportRoot, "contexts", `${questionId}--${mode.id}.txt`), prepared.context);
		const evidenceStages = evidence.map((item) =>
			classifyEvidenceStage(
				mode.pilotGroup,
				requireString(item, "sourceId"),
				requireString(item, "factId"),
				requireString(item, "exactQuote"),
				prepared,
			),
		);
		rows.push({
			questionId,
			group: mode.id,
			pilotGroup: mode.pilotGroup,
			graphExpansion: mode.graphExpansion,
			domain: question.domain,
			question: questionText,
			estimatedContextTokens: prepared.estimatedContextTokens,
			contextHash: prepared.contextHash,
			retrievedClaims: prepared.retrievedClaims,
			retrievedRelations: prepared.retrievedRelations,
			retrievedSources: prepared.retrievedSources,
			droppedContext: prepared.droppedContext,
			evidenceStages,
			allRequiredEvidenceRetrieved: evidenceStages.every((stage) => stage.status === "retrieved"),
			retrievalTrace: prepared.retrievalTrace,
		});
	}
}

const summary = ablation.modes.map((mode) => {
	const groupRows = rows.filter((row) => row.group === mode.id);
	const stages = groupRows.flatMap((row) => recordArray(row.evidenceStages));
	return {
		group: mode.id,
		pilotGroup: mode.pilotGroup,
		graphExpansion: mode.graphExpansion,
		questions: groupRows.length,
		questionsWithFullEvidence: groupRows.filter((row) => row.allRequiredEvidenceRetrieved === true)
			.length,
		requiredEvidenceItems: stages.length,
		retrievedEvidenceItems: stages.filter((stage) => stage.status === "retrieved").length,
		stageCounts: countBy(stages.map((stage) => requireString(stage, "status"))),
		averageContextTokens: average(groupRows.map((row) => Number(row.estimatedContextTokens ?? 0))),
	};
});

const report = {
	schemaVersion: "wge-e4-smoke-context-preparation/v1",
	status: "PREPARED_OFFLINE",
	suiteId: "benchmark-seed-six-domain-v1",
	taskFileSha256: taskHash,
	groups: ablation.modes.map((mode) => mode.id),
	eMin: { status: selection.eMinStatus, reason: selection.eMinReason },
	limitations: [
		"This report measures retrieval availability before answer generation; it is not an answer-quality result.",
		"Batch B is public diagnostic data visible to developers, not blind human Gold.",
		"E-min remains blocked until a generic, Gold-independent WikiModule builder exists.",
	],
	summary,
	rows,
};

writeJson(join(reportRoot, "context-preparation.json"), report);
writeFileSync(
	join(reportRoot, "context-trace.jsonl"),
	`${rows.map((row) => JSON.stringify(row)).join("\n")}\n`,
);
console.log(JSON.stringify({ status: report.status, eMin: report.eMin.status, summary }, null, 2));

function classifyEvidenceStage(
	group: "B" | "P",
	sourceId: string,
	factId: string,
	exactQuote: string,
	prepared: ReturnType<typeof preparePilotContext>,
): JsonRecord {
	const exactEvidencePresent = normalize(prepared.context).includes(normalize(exactQuote));
	if (group === "B") {
		const trace = prepared.retrievalTrace;
		const candidates = recordArray(trace.candidates);
		const sourceCandidates = candidates.filter((candidate) =>
			requireString(candidate, "id").includes(`/${sourceId}.md#`),
		);
		const selected = sourceCandidates.some((candidate) => candidate.selected === true);
		return {
			factId,
			sourceId,
			status: exactEvidencePresent
				? "retrieved"
				: sourceCandidates.length === 0
					? "lexical-no-match"
					: selected
						? "source-retrieved-evidence-miss"
						: (requireNullableString(sourceCandidates[0], "dropReason") ?? "not-selected"),
			candidateChunkIds: sourceCandidates.map((candidate) => requireString(candidate, "id")),
		};
	}

	const fact = factById.get(factId);
	if (!fact || fact.matchedClaimIds.length === 0) {
		return { factId, sourceId, status: "compiler-loss", expectedClaimIds: [] };
	}
	const expected = new Set(fact.matchedClaimIds);
	const selected = prepared.retrievedClaims.filter((id) => expected.has(id));
	if (selected.length > 0) {
		return {
			factId,
			sourceId,
			status: "retrieved",
			expectedClaimIds: [...expected],
			selected,
			exactAnchorTextPresent: exactEvidencePresent,
		};
	}
	if (exactEvidencePresent) {
		return {
			factId,
			sourceId,
			status: "retrieved",
			expectedClaimIds: [...expected],
			selected: [],
			retrievedBy: "evidence-span",
		};
	}
	const retrieval = requireRecord(prepared.retrievalTrace, "retrieval");
	const graph = requireRecord(prepared.retrievalTrace, "graph");
	const seedIds = recordArray(retrieval.candidates).map((row) => requireString(row, "claimId"));
	const expandedIds = stringArray(graph.expandedClaimIds);
	return {
		factId,
		sourceId,
		status: seedIds.some((id) => expected.has(id))
			? "post-seed-drop"
			: expandedIds.some((id) => expected.has(id))
				? "post-graph-drop"
				: "seed-and-graph-miss",
		expectedClaimIds: [...expected],
	};
}

function countBy(values: string[]): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
	return counts;
}

function average(values: number[]): number {
	return values.length === 0
		? 0
		: Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, "utf8")) as T;
}

function readJsonl(path: string): JsonRecord[] {
	return readFileSync(path, "utf8")
		.split("\n")
		.filter((line) => line.trim().length > 0)
		.map((line) => JSON.parse(line) as JsonRecord);
}

function writeJson(path: string, value: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function requireString(record: JsonRecord, key: string): string {
	const value = record[key];
	if (typeof value !== "string" || value.length === 0) throw new Error(`Missing string ${key}`);
	return value;
}

function requireNullableString(record: JsonRecord, key: string): string | null {
	const value = record[key];
	return typeof value === "string" ? value : null;
}

function requireRecord(record: JsonRecord, key: string): JsonRecord {
	const value = record[key];
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error(`Missing record ${key}`);
	return value as JsonRecord;
}

function recordArray(value: unknown): JsonRecord[] {
	return Array.isArray(value)
		? value.filter(
				(item): item is JsonRecord =>
					Boolean(item) && typeof item === "object" && !Array.isArray(item),
			)
		: [];
}

function stringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

function argumentValue(name: string): string | undefined {
	const index = process.argv.indexOf(name);
	return index >= 0 ? process.argv[index + 1] : undefined;
}

function sha256(value: string): string {
	return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function normalize(value: string): string {
	return value.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase();
}
