import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../config/index.js";
import { KnowledgeApplicationService } from "./knowledge-service.js";
import { PilotObservationApplicationService } from "./pilot-observation-service.js";
import { initializeRuntime } from "./runtime.js";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("PilotObservationApplicationService", () => {
	it("persists privacy-preserving query receipts and immutable outcomes", () => {
		const { config, pilot, knowledge } = fixture();
		const task = "请根据我的历史偏好回答这个私密问题";
		const answer = "这是不应写入观测文件的原始回答";
		const queried = knowledge.queryAgentContext({
			task,
			budgetTokens: 1_200,
			scopeContext: { principalId: "alice" },
		});
		const request = {
			traceId: queried.traceId,
			answer,
			outcome: "FAILURE" as const,
			repeatedExplanation: true,
			correctedErrorRecurrence: true,
			hardFailures: [],
			userAccepted: false,
			idempotencyKey: "pilot-outcome-1",
		};
		const recorded = pilot.recordOutcome(request);

		expect(recorded.hardFailures).toEqual(["CORRECTED_ERROR_RECURRENCE"]);
		expect(recorded).not.toHaveProperty("idempotencyKey");
		expect(recorded).not.toHaveProperty("requestHash");
		expect(recorded).not.toHaveProperty("answerHmac");
		expect(pilot.recordOutcome(request)).toEqual(recorded);
		expect(() => pilot.recordOutcome({ ...request, outcome: "SUCCESS" })).toThrow("immutable");
		const persisted = readPilotFiles(config.runsDir).join("\n");
		expect(persisted).not.toContain(task);
		expect(persisted).not.toContain(answer);
		expect(persisted).not.toContain("DEEPSEEK");
		expect(pilot.getStatus()).toEqual(
			expect.objectContaining({
				queries: 1,
				feedbackRecorded: 1,
				feedbackPending: 0,
				outcomes: { SUCCESS: 0, PARTIAL: 0, FAILURE: 1 },
				repeatedExplanationCount: 1,
				correctedErrorRecurrenceCount: 1,
				hardFailureCount: 1,
				userRejectedCount: 1,
			}),
		);
	});

	it("isolates principals and freezes a trusted checkpoint without changing knowledge", () => {
		const { config, pilot, knowledge } = fixture();
		const before = knowledge.getStatus();
		const queried = knowledge.queryAgentContext({
			task: "项目状态",
			budgetTokens: 800,
			scopeContext: { principalId: "alice" },
		});
		const mallory = new PilotObservationApplicationService(
			config,
			{ principalId: "mallory", projectRoles: {} },
			"another-long-pilot-key",
		);
		expect(() =>
			mallory.recordOutcome({
				traceId: queried.traceId,
				answer: "冒充反馈",
				outcome: "SUCCESS",
				repeatedExplanation: false,
				correctedErrorRecurrence: false,
				hardFailures: [],
				userAccepted: true,
				idempotencyKey: "impersonate",
			}),
		).toThrow("querying principal");
		expect(mallory.getStatus().queries).toBe(0);

		const checkpoint = pilot.markTrustedCheckpoint("第一周人工确认");
		expect(checkpoint).toEqual(
			expect.objectContaining({
				principalId: "alice",
				label: "第一周人工确认",
				status: expect.objectContaining({ queries: 1, feedbackPending: 1 }),
			}),
		);
		expect(knowledge.getStatus()).toEqual(before);
	});

	it("pairs equal-budget BASELINE and WIKIMEMORY receipts without exposing Baseline content", () => {
		const { config, pilot, knowledge } = fixture();
		const task = "同一个需要做成双臂比较的真实任务";
		const baseline = pilot.registerBaseline({
			task,
			budgetTokens: 1_000,
			idempotencyKey: "baseline-pair-1",
		});
		expect(
			pilot.registerBaseline({
				task,
				budgetTokens: 1_000,
				idempotencyKey: "baseline-pair-1",
			}),
		).toEqual(baseline);
		knowledge.queryAgentContext({
			task,
			budgetTokens: 1_000,
			scopeContext: { principalId: "alice" },
		});

		expect(pilot.getStatus()).toEqual(
			expect.objectContaining({
				queries: 2,
				armCounts: { BASELINE: 1, WIKIMEMORY: 1 },
				pairedTasks: 1,
				pairedOutcomes: 0,
				armMetrics: {
					BASELINE: expect.objectContaining({ queries: 1, feedbackRecorded: 0 }),
					WIKIMEMORY: expect.objectContaining({ queries: 1, feedbackRecorded: 0 }),
				},
			}),
		);
		expect(readPilotFiles(config.runsDir).join("\n")).not.toContain(task);
	});
});

function fixture() {
	const root = mkdtempSync(join(tmpdir(), "wge-pilot-observation-"));
	roots.push(root);
	const config = loadConfig({ runtimeRoot: root, apiKey: "" });
	initializeRuntime(config);
	const pilot = new PilotObservationApplicationService(
		config,
		{ principalId: "alice", projectRoles: {} },
		"test-pilot-hash-key-1234",
	);
	const knowledge = new KnowledgeApplicationService(config, {
		observeAgentQuery: (_config, task, response) => pilot.recordQuery(task, response),
	});
	return { config, pilot, knowledge };
}

function readPilotFiles(runsDir: string): string[] {
	const root = join(runsDir, "pilot");
	if (!existsSync(root)) return [];
	return readdirSync(root, { recursive: true })
		.filter((entry): entry is string => typeof entry === "string" && entry.endsWith(".json"))
		.map((entry) => readFileSync(join(root, entry), "utf-8"));
}
