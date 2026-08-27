import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../config/index.js";
import { questionRef } from "../types/index.js";
import {
	publishQuestionEvolution,
	questionStatePath,
	readAllQuestionFrames,
	readQuestionState,
} from "./question-storage.js";

describe("Question state storage", () => {
	it("publishes frames and decisions as one deterministic snapshot", () => {
		const config = fixtureConfig();
		const result = publishQuestionEvolution(config, {
			frames: [frame()],
			decisions: [decision()],
		});
		expect(result.frames.map((item) => item.id)).toEqual(["question:delivery-semantics"]);
		expect(readAllQuestionFrames(config)).toEqual(result.frames);
		expect(
			publishQuestionEvolution(config, { frames: [frame()], decisions: [decision()] }),
		).toEqual(result);
	});

	it("fails closed when the stored state hash is corrupted", () => {
		const config = fixtureConfig();
		publishQuestionEvolution(config, { frames: [frame()], decisions: [decision()] });
		const path = questionStatePath(config);
		const stored = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
		writeFileSync(path, JSON.stringify({ ...stored, stateHash: "tampered" }), "utf-8");
		expect(() => readQuestionState(config)).toThrow(/hash mismatch/);
	});
});

function fixtureConfig() {
	const root = mkdtempSync(join(tmpdir(), "wge-question-state-"));
	return loadConfig({ projectRoot: root, runtimeRoot: root, apiKey: "test" });
}

function frame() {
	return {
		id: questionRef("question:delivery-semantics"),
		stableAddress: "question/distributed-systems/delivery-semantics",
		canonicalQuestion: "消息系统能提供哪些投递语义？",
		aliases: ["投递保证"],
		domain: "distributed-systems",
		scope: { type: "GLOBAL" as const },
		boundaries: ["仅讨论消息系统语义"],
		lifecycle: "ACTIVE" as const,
		parentQuestionRefs: [],
		childQuestionRefs: [],
		mergedInto: null,
		formationSignals: [
			{
				type: "STABLE_CONCEPT" as const,
				sourceIds: ["source:article"],
				claimRefs: [],
				relationIds: [],
				conceptRefs: [],
				reason: "稳定概念",
			},
		],
		publicationState: "CANONICAL" as const,
		createdAtKnowledgeVersion: "kv:1",
		updatedAtKnowledgeVersion: "kv:1",
		createdAt: "2026-08-20T00:00:00.000Z",
		updatedAt: "2026-08-20T00:00:00.000Z",
	};
}

function decision() {
	return {
		id: "question-decision:create-delivery-semantics",
		knowledgeVersion: "kv:1",
		sourceId: "source:article",
		action: "CREATE" as const,
		questionRefs: [questionRef("question:delivery-semantics")],
		affectedClaimRefs: [],
		affectedRelationIds: [],
		reasonCodes: ["STABLE_CONCEPT"],
		beforeHash: null,
		afterHash: "after",
		formationVersion: "wge-question-formation/v1",
		createdAt: "2026-08-20T00:00:00.000Z",
	};
}
