import { describe, expect, it } from "vitest";
import type { Claim, QuestionFrame, SourceSpan } from "../types/index.js";
import { claimRef, questionRef } from "../types/index.js";
import { gateQuestionLifecycleProposals } from "./question-lifecycle.js";

describe("Question lifecycle gate", () => {
	it("merges multiple stable questions with explicit identity migration", () => {
		const result = gateQuestionLifecycleProposals({
			...baseInput(),
			existingFrames: [frame("delivery", "投递保证是什么？"), frame("dedup", "去重语义是什么？")],
			proposals: [
				{
					proposalId: "lifecycle:merge-delivery",
					action: "MERGE",
					questionRefs: [questionRef("question:delivery"), questionRef("question:dedup")],
					targets: [
						{
							canonicalQuestion: "消息系统的端到端投递语义是什么？",
							aliases: ["端到端投递保证"],
							boundaries: ["包括 broker 投递与消费端去重"],
						},
					],
					claimIds: ["claim:evidence"],
					relationIds: [],
					reasonCodes: ["BOUNDARIES_OVERLAP"],
					rationale: "两个问题在后续材料中总是由同一组证据共同更新",
				},
			],
		});

		expect(result.decisions).toEqual([
			expect.objectContaining({ accepted: true, reasonCodes: ["BOUNDARIES_OVERLAP", "MERGE"] }),
		]);
		const target = result.framesToPublish.find((item) => item.lifecycle === "ACTIVE");
		const merged = result.framesToPublish.filter((item) => item.lifecycle === "MERGED");
		expect(target?.parentQuestionRefs).toEqual(
			expect.arrayContaining([questionRef("question:delivery"), questionRef("question:dedup")]),
		);
		expect(merged.map((item) => item.mergedInto)).toEqual([target?.id, target?.id]);
		expect(result.evolutionDecisions[0]).toMatchObject({
			action: "MERGE",
			beforeHash: expect.any(String),
			afterHash: expect.any(String),
		});
	});

	it("splits one broad question while preserving parent-child migration", () => {
		const result = gateQuestionLifecycleProposals({
			...baseInput(),
			existingFrames: [frame("broad", "消息系统语义是什么？")],
			proposals: [
				{
					proposalId: "lifecycle:split-message",
					action: "SPLIT",
					questionRefs: [questionRef("question:broad")],
					targets: [
						{
							canonicalQuestion: "消息系统的投递语义是什么？",
							aliases: [],
							boundaries: ["仅讨论 broker 投递"],
						},
						{
							canonicalQuestion: "消息消费端如何去重？",
							aliases: [],
							boundaries: ["仅讨论消费端"],
						},
					],
					claimIds: ["claim:evidence"],
					relationIds: [],
					reasonCodes: ["BOUNDARY_TOO_BROAD"],
					rationale: "新材料显示两个子问题拥有不同条件与更新节奏",
				},
			],
		});

		const parent = result.framesToPublish.find((item) => item.id === "question:broad");
		const children = result.framesToPublish.filter((item) => item.id !== "question:broad");
		if (!parent) throw new Error("expected split parent");
		expect(parent).toMatchObject({ lifecycle: "SPLIT" });
		expect(parent.childQuestionRefs).toEqual(children.map((item) => item.id));
		expect(children.every((item) => item.parentQuestionRefs.includes(parent.id))).toBe(true);
	});

	it("rejects cross-scope merge and duplicate target identity", () => {
		const global = frame("delivery", "投递保证是什么？");
		const project = {
			...frame("dedup", "去重语义是什么？"),
			scope: { type: "PROJECT" as const, id: "p1" },
		};
		const result = gateQuestionLifecycleProposals({
			...baseInput(),
			existingFrames: [global, project],
			proposals: [
				{
					proposalId: "lifecycle:invalid",
					action: "MERGE",
					questionRefs: [global.id, project.id],
					targets: [
						{
							canonicalQuestion: global.canonicalQuestion,
							aliases: [],
							boundaries: ["重复目标"],
						},
					],
					claimIds: ["claim:evidence"],
					relationIds: [],
					reasonCodes: ["TEST"],
					rationale: "invalid fixture",
				},
			],
		});
		expect(result.decisions[0]?.reasonCodes).toEqual(
			expect.arrayContaining(["CROSS_DOMAIN_OR_SCOPE_MIGRATION", "DUPLICATE_TARGET_QUESTION"]),
		);
	});

	it("archives a candidate without creating an invalid state-axis combination", () => {
		const candidate = {
			...frame("candidate", "候选问题是否仍值得维护？"),
			lifecycle: "CANDIDATE" as const,
			publicationState: "CANDIDATE" as const,
		};
		const result = gateQuestionLifecycleProposals({
			...baseInput(),
			existingFrames: [candidate],
			proposals: [
				{
					proposalId: "lifecycle:archive-candidate",
					action: "ARCHIVE",
					questionRefs: [candidate.id],
					targets: [],
					claimIds: ["claim:evidence"],
					relationIds: [],
					reasonCodes: ["NO_LONG_TERM_VALUE"],
					rationale: "后续证据确认该问题只与单篇材料结构有关",
				},
			],
		});
		expect(result.framesToPublish[0]).toMatchObject({
			lifecycle: "ARCHIVED",
			publicationState: "CANONICAL",
		});
	});
});

function baseInput() {
	return {
		sourceId: "source:new",
		knowledgeVersion: "kv:2",
		proposals: [],
		existingFrames: [],
		claims: [claim()],
		relations: [],
		spans: [span()],
		now: "2026-08-20T00:00:00.000Z",
	};
}

function frame(suffix: string, canonicalQuestion: string): QuestionFrame {
	return {
		id: questionRef(`question:${suffix}`),
		stableAddress: `question/distributed-systems/${suffix}`,
		canonicalQuestion,
		aliases: [],
		domain: "distributed-systems",
		scope: { type: "GLOBAL" },
		boundaries: [`${suffix} boundary`],
		lifecycle: "ACTIVE",
		parentQuestionRefs: [],
		childQuestionRefs: [],
		mergedInto: null,
		formationSignals: [
			{
				type: "CLAIM_CLUSTER",
				sourceIds: ["source:old"],
				claimRefs: [claimRef("claim:evidence")],
				relationIds: [],
				conceptRefs: [],
				reason: "existing stable question",
			},
		],
		publicationState: "CANONICAL",
		createdAtKnowledgeVersion: "kv:1",
		updatedAtKnowledgeVersion: "kv:1",
		createdAt: "2026-08-19T00:00:00.000Z",
		updatedAt: "2026-08-19T00:00:00.000Z",
	};
}

function claim(): Claim {
	return {
		id: "claim:evidence",
		statement: "端到端语义取决于投递与消费端去重",
		evidenceSpanIds: ["span:evidence"],
		conditions: [],
		derivation: "EXTRACTED",
		validity: "SUPPORTED",
		lifecycle: "ACTIVE",
		publicationState: "CANONICAL",
		validFrom: null,
		validTo: null,
		compilerVersion: "test",
		confidence: 1,
		claimKind: "FACT",
		scope: { type: "GLOBAL" },
		provenanceRefs: [{ type: "SourceSpan", spanId: "span:evidence" }],
		supportingEvidenceRefs: [{ type: "SourceSpan", spanId: "span:evidence" }],
		knowledgeVersion: "kv:2",
		recordedAt: "2026-08-20T00:00:00.000Z",
	};
}

function span(): SourceSpan {
	return {
		id: "span:evidence",
		sourceId: "source:new",
		blockId: "b0",
		charStart: 0,
		charEnd: 10,
		text: "端到端语义取决于投递与消费端去重",
	};
}
