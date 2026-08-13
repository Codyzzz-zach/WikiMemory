import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

type JsonRecord = Record<string, unknown>;

interface UsageTotals {
	promptTokens: number;
	completionTokens: number;
	totalTokens: number;
	promptCacheHitTokens: number;
	promptCacheMissTokens: number;
}

interface StageTotals extends UsageTotals {
	providerCalls: number;
	providerFailures: number;
	cacheHits: number;
	invalidParses: number;
	truncatedCalls: number;
	retrySignalTokens: number;
}

interface RunReport extends StageTotals {
	runId: string;
	sourceId: string;
	models: string[];
	finalState: string | null;
	finalStage: string | null;
	mappedClaims: number | null;
	tokensPerMappedClaim: number | null;
	stages: Record<string, StageTotals>;
}

const args = parseArgs(process.argv.slice(2));
const runtimeRoot = resolve(args.runtimeRoot ?? process.env.WGE_RUNTIME_ROOT ?? process.cwd());
const runsRoot = join(runtimeRoot, "runs");
const calls = readJsonl(join(runsRoot, "llm-calls.jsonl"));
const states = readJsonl(join(runsRoot, "compile-state.jsonl"));
const stats = readJsonl(join(runsRoot, "compile-stats.jsonl"));

const matchingReports = buildReports(calls, states, stats).filter(
	(report) => !args.source || report.sourceId.includes(args.source),
);
const latestRunBySource = new Map<string, RunReport>();
for (const report of matchingReports) latestRunBySource.set(report.sourceId, report);
const reports = args.allRuns ? matchingReports : [...latestRunBySource.values()];

if (args.json) {
	console.log(
		JSON.stringify({ schemaVersion: "wge-ingest-economics/v1", runtimeRoot, reports }, null, 2),
	);
} else {
	printHuman(runtimeRoot, reports, args.allRuns);
}

function buildReports(calls: JsonRecord[], states: JsonRecord[], stats: JsonRecord[]): RunReport[] {
	const invalidCallIds = new Set(
		calls
			.filter((row) => row.eventType === "LLM_PARSE_RESULT" && row.outcome === "INVALID")
			.map((row) => string(row.callId))
			.filter(Boolean),
	);
	const latestState = new Map<string, JsonRecord>();
	for (const row of states) {
		if (string(row.runId)) latestState.set(string(row.runId), row);
	}
	const latestStats = new Map<string, JsonRecord>();
	for (const row of stats) {
		if (string(row.runId)) latestStats.set(string(row.runId), row);
	}

	const byRun = new Map<string, RunReport>();
	for (const row of calls) {
		const runId = string(row.runId);
		const sourceId = string(row.sourceId);
		if (!runId || !sourceId) continue;
		const report = byRun.get(runId) ?? emptyReport(runId, sourceId);
		byRun.set(runId, report);
		const stageName = string(row.stage) || "UNKNOWN";
		const stage = report.stages[stageName] ?? emptyStage();
		report.stages[stageName] = stage;

		if (row.eventType === "LLM_CALL_COMPLETED") {
			const usage = record(row.usage);
			const values = usageTotals(usage);
			addUsage(report, values);
			addUsage(stage, values);
			report.providerCalls++;
			stage.providerCalls++;
			const model = string(row.modelReturned) || string(row.modelRequested);
			if (model && !report.models.includes(model)) report.models.push(model);
			if (row.finishReason === "length") {
				report.truncatedCalls++;
				stage.truncatedCalls++;
			}
			if (invalidCallIds.has(string(row.callId))) {
				report.invalidParses++;
				stage.invalidParses++;
				report.retrySignalTokens += values.totalTokens;
				stage.retrySignalTokens += values.totalTokens;
			}
		} else if (row.eventType === "LLM_CALL_FAILED") {
			report.providerFailures++;
			stage.providerFailures++;
		} else if (row.eventType === "LLM_CACHE_HIT") {
			report.cacheHits++;
			stage.cacheHits++;
		}
	}

	for (const report of byRun.values()) {
		const state = latestState.get(report.runId);
		report.finalState = state ? string(state.state) || null : null;
		report.finalStage = state ? string(state.stage) || null : null;
		const runStats = latestStats.get(report.runId);
		const mappedClaims = runStats ? number(runStats.mappedClaims) : null;
		report.mappedClaims = mappedClaims;
		report.tokensPerMappedClaim =
			mappedClaims && mappedClaims > 0 ? round(report.totalTokens / mappedClaims) : null;
	}
	return [...byRun.values()];
}

function emptyReport(runId: string, sourceId: string): RunReport {
	return {
		...emptyStage(),
		runId,
		sourceId,
		models: [],
		finalState: null,
		finalStage: null,
		mappedClaims: null,
		tokensPerMappedClaim: null,
		stages: {},
	};
}

function emptyStage(): StageTotals {
	return {
		providerCalls: 0,
		providerFailures: 0,
		cacheHits: 0,
		invalidParses: 0,
		truncatedCalls: 0,
		retrySignalTokens: 0,
		promptTokens: 0,
		completionTokens: 0,
		totalTokens: 0,
		promptCacheHitTokens: 0,
		promptCacheMissTokens: 0,
	};
}

function usageTotals(usage: JsonRecord): UsageTotals {
	return {
		promptTokens: number(usage.promptTokens) ?? 0,
		completionTokens: number(usage.completionTokens) ?? 0,
		totalTokens: number(usage.totalTokens) ?? 0,
		promptCacheHitTokens: number(usage.promptCacheHitTokens) ?? 0,
		promptCacheMissTokens: number(usage.promptCacheMissTokens) ?? 0,
	};
}

function addUsage(target: UsageTotals, values: UsageTotals): void {
	target.promptTokens += values.promptTokens;
	target.completionTokens += values.completionTokens;
	target.totalTokens += values.totalTokens;
	target.promptCacheHitTokens += values.promptCacheHitTokens;
	target.promptCacheMissTokens += values.promptCacheMissTokens;
}

function printHuman(runtimeRoot: string, reports: RunReport[], allRuns: boolean): void {
	console.log(`Ingest economics (${allRuns ? "all runs" : "latest run per source"})`);
	console.log(`runtime: ${runtimeRoot}`);
	if (reports.length === 0) {
		console.log("No matching provider-backed compile runs found.");
		return;
	}
	for (const report of reports) {
		console.log(`\n${report.sourceId}`);
		console.log(`  run/state: ${report.runId} / ${report.finalState ?? "UNKNOWN"}`);
		console.log(`  provider/cache calls: ${report.providerCalls} / ${report.cacheHits}`);
		console.log(
			`  tokens: ${report.totalTokens} total (${report.promptTokens} prompt + ${report.completionTokens} completion)`,
		);
		console.log(
			`  retry signals: ${report.retrySignalTokens} tokens; invalid=${report.invalidParses}; truncated=${report.truncatedCalls}; failures=${report.providerFailures}`,
		);
		console.log(
			`  mapped claims: ${report.mappedClaims ?? "n/a"}; tokens/mapped claim: ${report.tokensPerMappedClaim ?? "n/a"}`,
		);
	}
	const totals = reports.reduce((sum, report) => sum + report.totalTokens, 0);
	console.log(`\nselected total provider tokens: ${totals}`);
}

function readJsonl(path: string): JsonRecord[] {
	if (!existsSync(path)) return [];
	return readFileSync(path, "utf8")
		.split(/\r?\n/)
		.filter((line) => line.trim().length > 0)
		.map((line, index) => {
			try {
				return record(JSON.parse(line));
			} catch (error) {
				throw new Error(`${path}:${index + 1} is not valid JSON: ${String(error)}`);
			}
		});
}

function parseArgs(values: string[]): {
	runtimeRoot?: string;
	source?: string;
	allRuns: boolean;
	json: boolean;
} {
	const result: { runtimeRoot?: string; source?: string; allRuns: boolean; json: boolean } = {
		allRuns: false,
		json: false,
	};
	for (let index = 0; index < values.length; index++) {
		const value = values[index];
		if (value === "--runtime-root") result.runtimeRoot = requireValue(values, ++index, value);
		else if (value === "--source") result.source = requireValue(values, ++index, value);
		else if (value === "--all-runs") result.allRuns = true;
		else if (value === "--json") result.json = true;
		else throw new Error(`Unknown argument: ${value}`);
	}
	return result;
}

function requireValue(values: string[], index: number, option: string): string {
	const value = values[index];
	if (!value) throw new Error(`${option} requires a value`);
	return value;
}

function record(value: unknown): JsonRecord {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function string(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function number(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function round(value: number): number {
	return Math.round(value * 100) / 100;
}
