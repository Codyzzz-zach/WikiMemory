import { describe, expect, it } from "vitest";
import type { Claim, Concept, SourceSpan } from "../types/index.js";
import { type QuestionCandidateProposal, gateQuestionProposals } from "./question-formation-v2.js";

describe("question-centered formation gate", () => {
	it("forms a source-independent active question and is input-order invariant", () => {
		const first = gateQuestionProposals(input());
		const reversed = gateQuestionProposals({
			...input(),
			claims: [...input().claims].reverse(),
			spans: [...input().spans].reverse(),
			proposals: [
				{
					...proposal(),
					claimIds: [...proposal().claimIds].reverse(),
					aliases: [...proposal().aliases].reverse(),
					boundaries: [...proposal().boundaries].reverse(),
				},
			],
		});
		expect(first.framesToPublish).toEqual(reversed.framesToPublish);
		expect(first.framesToPublish[0]?.lifecycle).toBe("ACTIVE");
		expect(first.framesToPublish[0]?.stableAddress).not.toContain("source:");
		expect(first.stats).toMatchObject({ proposed: 1, accepted: 1, created: 1 });
	});

	it("updates an existing semantic question instead of creating a duplicate", () => {
		const created = gateQuestionProposals(input()).framesToPublish[0];
		if (!created) throw new Error("expected frame");
		const result = gateQuestionProposals({
			...input(),
			existingFrames: [created],
			proposals: [{ ...proposal(), matchQuestionRef: created.id }],
			knowledgeVersion: "kv:2",
			sourceId: "source:second",
		});
		expect(result.framesToPublish[0]?.id).toBe(created.id);
		expect(result.evolutionDecisions[0]?.action).toBe("UPDATE");
	});

	it("keeps an active question consumable on a weak update recommendation", () => {
		const created = gateQuestionProposals(input()).framesToPublish[0];
		if (!created) throw new Error("expected frame");
		const base = input();
		const firstClaim = base.claims[0];
		const firstSpan = base.spans[0];
		if (!firstClaim || !firstSpan) throw new Error("expected one-claim fixture");
		const result = gateQuestionProposals({
			...base,
			claims: [firstClaim],
			spans: [firstSpan],
			existingFrames: [created],
			proposals: [
				{
					...proposal(),
					matchQuestionRef: created.id,
					claimIds: ["claim:first"],
					recommendedLifecycle: "CANDIDATE",
				},
			],
			knowledgeVersion: "kv:2",
			sourceId: "source:second",
		});
		expect(result.framesToPublish[0]?.lifecycle).toBe("ACTIVE");
		expect(result.framesToPublish[0]?.publicationState).toBe("CANONICAL");
	});

	it("keeps weak one-claim proposals as candidates", () => {
		const base = input();
		const firstClaim = base.claims[0];
		const firstSpan = base.spans[0];
		if (!firstClaim || !firstSpan) throw new Error("expected one-claim fixture");
		const result = gateQuestionProposals({
			...base,
			claims: [firstClaim],
			spans: [firstSpan],
			proposals: [{ ...proposal(), claimIds: ["claim:first"] }],
		});
		expect(result.framesToPublish[0]?.lifecycle).toBe("CANDIDATE");
		expect(result.framesToPublish[0]?.publicationState).toBe("CANDIDATE");
	});

	it("rejects article-shaped questions and ungrounded membership", () => {
		const result = gateQuestionProposals({
			...input(),
			proposals: [
				{
					...proposal(),
					canonicalQuestion: "关于“第二章”的当前知识是什么？",
					claimIds: ["claim:missing"],
				},
			],
		});
		expect(result.decisions[0]).toMatchObject({ accepted: false, questionRef: null });
		expect(result.decisions[0]?.reasonCodes).toEqual(
			expect.arrayContaining(["ARTICLE_SHAPED_GENERIC_QUESTION", "UNKNOWN_CLAIM"]),
		);
	});

	it("rejects a duplicate semantic question when the proposal omits its match", () => {
		const created = gateQuestionProposals(input()).framesToPublish[0];
		if (!created) throw new Error("expected frame");
		const result = gateQuestionProposals({ ...input(), existingFrames: [created] });
		expect(result.decisions[0]?.reasonCodes).toContain("DUPLICATE_EXISTING_QUESTION");
	});

	it("accepts compiler char-range evidence derived from a persisted SourceSpan", () => {
		const base = input();
		const claims = base.claims.map((item, index) => {
			const persistedSpan = base.spans[index];
			if (!persistedSpan) throw new Error("expected persisted span");
			const derivedSpanId = `${persistedSpan.id}#chars-1-5`;
			return {
				...item,
				evidenceSpanIds: [derivedSpanId],
				provenanceRefs: [{ type: "SourceSpan" as const, spanId: derivedSpanId }],
				supportingEvidenceRefs: [{ type: "SourceSpan" as const, spanId: derivedSpanId }],
			};
		});
		const result = gateQuestionProposals({ ...base, claims });
		expect(result.decisions[0]?.accepted).toBe(true);
		expect(result.framesToPublish[0]?.formationSignals[0]?.sourceIds).toEqual(["source:first"]);
	});

	it("rejects a Question update whose cumulative Wiki closure exceeds 24 Claims", () => {
		const claims = Array.from({ length: 25 }, (_, index) =>
			claim(`claim:${index}`, `span:${index}`),
		);
		const spans = claims.map((_, index) => span(`span:${index}`, "source:first"));
		const result = gateQuestionProposals({
			...input(),
			claims,
			spans,
			proposals: [{ ...proposal(), claimIds: claims.map((item) => item.id) }],
		});
		expect(result.decisions[0]?.accepted).toBe(false);
		expect(result.decisions[0]?.reasonCodes).toContain("QUESTION_CLAIM_LIMIT_EXCEEDED");
	});
});

function input() {
	const claims = [claim("claim:first", "span:first"), claim("claim:second", "span:second")];
	const spans = [span("span:first", "source:first"), span("span:second", "source:first")];
	return {
		sourceId: "source:first",
		knowledgeVersion: "kv:1",
		declaredDomain: "distributed-systems",
		proposals: [proposal()],
		claims,
		relations: [],
		concepts: [concept()],
		spans,
		existingFrames: [],
		now: "2026-08-20T00:00:00.000Z",
	};
}

function proposal(): QuestionCandidateProposal {
	return {
		proposalId: "proposal:delivery-semantics",
		matchQuestionRef: null,
		canonicalQuestion: "消息系统能提供哪些投递语义？",
		aliases: ["Delivery semantics", "投递保证"],
		domain: "distributed-systems",
		scope: { type: "GLOBAL" },
		boundaries: ["仅讨论消息系统语义", "不讨论业务层重试"],
		claimIds: ["claim:first", "claim:second"],
		relationIds: [],
		conceptIds: ["concept:delivery"],
		recommendedLifecycle: "ACTIVE",
		rationale: "该问题跨实现长期稳定，后续材料可以持续补充和修正",
	};
}

function claim(id: string, spanId: string): Claim {
	return {
		id,
		statement: `${id} statement`,
		evidenceSpanIds: [spanId],
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
		provenanceRefs: [{ type: "SourceSpan", spanId }],
		supportingEvidenceRefs: [{ type: "SourceSpan", spanId }],
		knowledgeVersion: "kv:1",
		recordedAt: "2026-08-20T00:00:00.000Z",
	};
}

function span(id: string, sourceId: string): SourceSpan {
	return { id, sourceId, blockId: `${sourceId}#block-1`, charStart: 0, charEnd: 10, text: id };
}

function concept(): Concept {
	return {
		id: "concept:delivery",
		name: "消息投递语义",
		aliases: ["delivery semantics"],
		boundary: "消息系统对重复与丢失的保证",
		domain: "distributed-systems",
	};
}
