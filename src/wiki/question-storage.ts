import { join } from "node:path";
import type { AppConfig } from "../config/types.js";
import { withRuntimeWriteLease } from "../infrastructure/runtime-write-lock.js";
import { markCanonicalStateChanged, readJson, writeJsonAtomic } from "../linter/storage.js";
import type { QuestionEvolutionDecision, QuestionFrame } from "../types/index.js";
import {
	QUESTION_STATE_SCHEMA_VERSION,
	questionStateHash,
	validateQuestionEvolutionDecision,
	validateQuestionFrame,
} from "./question-model.js";

export interface QuestionStateSnapshot {
	schemaVersion: typeof QUESTION_STATE_SCHEMA_VERSION;
	stateHash: string;
	frames: QuestionFrame[];
	decisions: QuestionEvolutionDecision[];
}

export interface PublishQuestionEvolutionInput {
	frames: QuestionFrame[];
	decisions: QuestionEvolutionDecision[];
}

export function readQuestionState(config: AppConfig): QuestionStateSnapshot {
	const stored = readJson<QuestionStateSnapshot>(questionStatePath(config));
	if (!stored) return emptyQuestionState();
	if (stored.schemaVersion !== QUESTION_STATE_SCHEMA_VERSION) {
		throw new Error(`不支持的 Question state schema: ${String(stored.schemaVersion)}`);
	}
	const frames = stored.frames.map(validateQuestionFrame);
	const decisions = stored.decisions.map(validateQuestionEvolutionDecision);
	assertUniqueQuestionState(frames, decisions);
	const expectedHash = questionStateHash(frames);
	if (stored.stateHash !== expectedHash) throw new Error("Question state hash mismatch");
	return { ...stored, frames, decisions };
}

export function readAllQuestionFrames(config: AppConfig): QuestionFrame[] {
	return readQuestionState(config).frames;
}

export function readQuestionEvolutionDecisions(config: AppConfig): QuestionEvolutionDecision[] {
	return readQuestionState(config).decisions;
}

/**
 * Atomically publish current QuestionFrame state and its append-only decisions in one snapshot.
 * The caller must provide the complete replacement frames for every changed ID.
 */
export function publishQuestionEvolution(
	config: AppConfig,
	input: PublishQuestionEvolutionInput,
): QuestionStateSnapshot {
	return withRuntimeWriteLease(config, "publish-question-evolution", () => {
		const current = readQuestionState(config);
		const framesById = new Map(current.frames.map((frame) => [String(frame.id), frame]));
		for (const rawFrame of input.frames) {
			const frame = validateQuestionFrame(rawFrame);
			framesById.set(String(frame.id), frame);
		}

		const decisionById = new Map(current.decisions.map((decision) => [decision.id, decision]));
		for (const rawDecision of input.decisions) {
			const decision = validateQuestionEvolutionDecision(rawDecision);
			const existing = decisionById.get(decision.id);
			if (existing && JSON.stringify(existing) !== JSON.stringify(decision)) {
				throw new Error(`QuestionEvolutionDecision ID 冲突: ${decision.id}`);
			}
			decisionById.set(decision.id, decision);
		}

		const frames = [...framesById.values()].sort((left, right) =>
			String(left.id).localeCompare(String(right.id)),
		);
		const decisions = [...decisionById.values()].sort(
			(left, right) =>
				left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
		);
		assertUniqueQuestionState(frames, decisions);
		const next: QuestionStateSnapshot = {
			schemaVersion: QUESTION_STATE_SCHEMA_VERSION,
			stateHash: questionStateHash(frames),
			frames,
			decisions,
		};
		if (JSON.stringify(current) === JSON.stringify(next)) return current;
		markCanonicalStateChanged(
			config,
			`publish-question-evolution:${input.frames
				.map((frame) => frame.id)
				.sort()
				.join(",")}`,
		);
		writeJsonAtomic(questionStatePath(config), next);
		return next;
	});
}

export function questionStatePath(config: AppConfig): string {
	return join(config.runtimeRoot ?? config.projectRoot, "questions", "state.json");
}

function emptyQuestionState(): QuestionStateSnapshot {
	return {
		schemaVersion: QUESTION_STATE_SCHEMA_VERSION,
		stateHash: questionStateHash([]),
		frames: [],
		decisions: [],
	};
}

function assertUniqueQuestionState(
	frames: QuestionFrame[],
	decisions: QuestionEvolutionDecision[],
): void {
	assertUnique(
		frames.map((frame) => String(frame.id)),
		"QuestionFrame id",
	);
	assertUnique(
		frames.map((frame) => frame.stableAddress),
		"QuestionFrame stableAddress",
	);
	assertUnique(
		decisions.map((decision) => decision.id),
		"QuestionEvolutionDecision id",
	);
	const frameIds = new Set(frames.map((frame) => String(frame.id)));
	for (const frame of frames) {
		for (const reference of [
			...frame.parentQuestionRefs,
			...frame.childQuestionRefs,
			...(frame.mergedInto ? [frame.mergedInto] : []),
		]) {
			if (!frameIds.has(String(reference))) {
				throw new Error(`QuestionFrame 引用不存在的问题: ${frame.id} -> ${reference}`);
			}
		}
	}
}

function assertUnique(values: string[], label: string): void {
	if (new Set(values).size !== values.length) throw new Error(`${label} 重复`);
}
