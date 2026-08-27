import { describe, expect, it } from "vitest";
import { questionRef } from "../types/index.js";
import {
	isQuestionFrameConsumable,
	questionFrameHash,
	validateQuestionFrame,
} from "./question-model.js";

describe("QuestionFrame model", () => {
	it("normalizes unordered signals without changing semantic identity", () => {
		const first = validateQuestionFrame(frame());
		const reversed = validateQuestionFrame({
			...frame(),
			aliases: ["Delivery semantics", "投递保证"],
			boundaries: ["不讨论业务重试策略", "仅讨论消息系统语义"],
		});
		expect(questionFrameHash(first)).toBe(questionFrameHash(reversed));
		expect(isQuestionFrameConsumable(first)).toBe(true);
	});

	it("rejects article-shaped stable addresses", () => {
		expect(() =>
			validateQuestionFrame({
				...frame(),
				stableAddress: "question/source:article-1/#block-2",
			}),
		).toThrow(/Source\/Block/);
	});

	it("requires merge lineage and semantic boundaries", () => {
		expect(() =>
			validateQuestionFrame({ ...frame(), lifecycle: "MERGED", mergedInto: null }),
		).toThrow(/mergedInto/);
		expect(() => validateQuestionFrame({ ...frame(), boundaries: [] })).toThrow(/语义边界/);
	});
});

function frame() {
	return {
		id: questionRef("question:delivery-semantics"),
		stableAddress: "question/distributed-systems/delivery-semantics",
		canonicalQuestion: "消息系统能提供哪些投递语义？",
		aliases: ["投递保证", "Delivery semantics"],
		domain: "distributed-systems",
		scope: { type: "GLOBAL" as const },
		boundaries: ["仅讨论消息系统语义", "不讨论业务重试策略"],
		lifecycle: "ACTIVE" as const,
		parentQuestionRefs: [],
		childQuestionRefs: [],
		mergedInto: null,
		formationSignals: [
			{
				type: "STABLE_CONCEPT" as const,
				sourceIds: ["source:b", "source:a"],
				claimRefs: [],
				relationIds: [],
				conceptRefs: [],
				reason: "稳定概念跨材料复现",
			},
		],
		publicationState: "CANONICAL" as const,
		createdAtKnowledgeVersion: "kv:1",
		updatedAtKnowledgeVersion: "kv:1",
		createdAt: "2026-08-20T00:00:00.000Z",
		updatedAt: "2026-08-20T00:00:00.000Z",
	};
}
