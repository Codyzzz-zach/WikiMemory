import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { join } from "node:path";
import type { AppConfig } from "../config/types.js";
import { withRuntimeWriteLease } from "../infrastructure/runtime-write-lock.js";
import { appendJsonl, readJsonl } from "../linter/storage.js";
import { RELATION_AUDIT_VERSION } from "../prompts/index.js";
import type { CompileState } from "../types/index.js";

export type CompileStage =
	| "INGESTED"
	| "PROPOSITION_EXTRACTION"
	| "CLAIM_COMPILATION"
	| "CONCEPT_CONSOLIDATION"
	| "RELATION_DETECTION"
	| "LINT"
	| "PUBLICATION_GATE"
	| "PUBLISH"
	| "CROSS_MATERIAL_RELATION_DETECTION"
	| "CROSS_MATERIAL_RELATION_LINT"
	| "CROSS_MATERIAL_RELATION_PUBLISH"
	| "QUESTION_PROPOSAL"
	| "QUESTION_GATE"
	| "QUESTION_PUBLISH"
	| "WIKI_MATERIALIZATION"
	| "WIKI_PUBLICATION_GATE"
	| "COMPLETE";

export interface CompileRunEvent {
	eventType: "COMPILE_STATE_CHANGED";
	sourceId: string;
	runId: string;
	state: CompileState;
	stage: CompileStage;
	model: string;
	timestamp: string;
	hostname: string;
	pid: number;
	/** 完成/待跨材料扫描时，证明阶段 1 使用的 Relation 审计规则版本。 */
	relationAuditVersion?: string;
	error?: string;
}

export interface CompileRunHandle {
	sourceId: string;
	runId: string;
	model: string;
}

function statePath(config: AppConfig): string {
	return join(config.runsDir, "compile-state.jsonl");
}

/** Strict by design: malformed control state must stop compilation, not trigger a duplicate run. */
export function readCompileRunEvents(config: AppConfig): CompileRunEvent[] {
	return readJsonl<CompileRunEvent>(statePath(config));
}

export function getLatestCompileEvent(config: AppConfig, sourceId: string): CompileRunEvent | null {
	const events = readCompileRunEvents(config);
	for (let index = events.length - 1; index >= 0; index--) {
		const event = events[index];
		if (event?.sourceId === sourceId) return event;
	}
	return null;
}

export function getCompileState(config: AppConfig, sourceId: string): CompileState {
	const latest = getLatestCompileEvent(config, sourceId);
	if (!latest) return "SOURCE_INGESTED";
	if (
		["COMPLETED", "RELATION_SCAN_PENDING", "QUESTION_UPDATE_PENDING"].includes(latest.state) &&
		latest.relationAuditVersion !== RELATION_AUDIT_VERSION
	) {
		return "COMPILED";
	}
	return latest.state;
}

export function beginCompileRun(
	config: AppConfig,
	sourceId: string,
	model: string,
): CompileRunHandle {
	return withRuntimeWriteLease(config, `begin-compile-run:${sourceId}`, () =>
		beginCompileRunUnlocked(config, sourceId, model),
	);
}

function beginCompileRunUnlocked(
	config: AppConfig,
	sourceId: string,
	model: string,
): CompileRunHandle {
	const latest = getLatestCompileEvent(config, sourceId);
	if (latest?.state === "COMPILE_RUNNING") {
		if (latest.hostname !== hostname()) {
			throw new Error(
				`Source ${sourceId} 正由主机 ${latest.hostname} 的 run ${latest.runId} 编译，拒绝并发运行`,
			);
		}
		if (isProcessAlive(latest.pid)) {
			throw new Error(
				`Source ${sourceId} 正由进程 ${latest.pid} 的 run ${latest.runId} 编译，拒绝并发运行`,
			);
		}
		appendEvent(config, {
			...latest,
			state: "COMPILE_FAILED",
			timestamp: new Date().toISOString(),
			error: `检测到已退出进程 ${latest.pid} 遗留的 COMPILE_RUNNING，自动封存为失败`,
		});
	}

	const handle: CompileRunHandle = { sourceId, runId: randomUUID(), model };
	appendEvent(config, eventFor(handle, "COMPILE_RUNNING", "INGESTED"));
	return handle;
}

export function recordCompileStage(
	config: AppConfig,
	handle: CompileRunHandle,
	stage: CompileStage,
): void {
	withRuntimeWriteLease(config, `record-compile-stage:${handle.sourceId}`, () => {
		assertActiveRun(config, handle);
		appendEvent(config, eventFor(handle, "COMPILE_RUNNING", stage));
	});
}

export function finishCompileRun(
	config: AppConfig,
	handle: CompileRunHandle,
	state:
		| "COMPILE_FAILED"
		| "COMPILE_PARTIAL"
		| "RELATION_SCAN_PENDING"
		| "QUESTION_UPDATE_PENDING"
		| "COMPLETED"
		| "COMPILED",
	stage: CompileStage,
	error?: string,
): void {
	withRuntimeWriteLease(config, `finish-compile-run:${handle.sourceId}`, () => {
		assertActiveRun(config, handle);
		appendEvent(config, eventFor(handle, state, stage, error));
	});
}

function assertActiveRun(config: AppConfig, handle: CompileRunHandle): void {
	const latest = getLatestCompileEvent(config, handle.sourceId);
	if (!latest || latest.runId !== handle.runId || latest.state !== "COMPILE_RUNNING") {
		throw new Error(
			`Run ${handle.runId} 不是 Source ${handle.sourceId} 的活动编译运行，拒绝状态转换`,
		);
	}
}

function eventFor(
	handle: CompileRunHandle,
	state: CompileState,
	stage: CompileStage,
	error?: string,
): CompileRunEvent {
	return {
		eventType: "COMPILE_STATE_CHANGED",
		sourceId: handle.sourceId,
		runId: handle.runId,
		state,
		stage,
		model: handle.model,
		timestamp: new Date().toISOString(),
		hostname: hostname(),
		pid: process.pid,
		...(["COMPLETED", "RELATION_SCAN_PENDING", "QUESTION_UPDATE_PENDING"].includes(state)
			? { relationAuditVersion: RELATION_AUDIT_VERSION }
			: {}),
		...(error ? { error } : {}),
	};
}

function appendEvent(config: AppConfig, event: CompileRunEvent): void {
	appendJsonl(statePath(config), [event]);
}

function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}
