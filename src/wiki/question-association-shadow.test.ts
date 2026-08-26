import { describe, expect, it } from "vitest";
import {
	type QuestionAssociationDecision,
	type QuestionAssociationFixtureCase,
	type QuestionAssociationOracleCase,
	auditQuestionAssociationDecisions,
	buildQuestionAssociationPayload,
	buildQuestionIdentityCard,
	parseQuestionAssociationDecisions,
} from "./question-association-shadow.js";

describe("Question Association Bridge shadow", () => {
	it("builds deterministic A0/A1 cards without leaking the current Source or oracle", () => {
		const input = fixture();
		const reversed = { ...input, priorClaims: [...input.priorClaims].reverse() };
		const a0 = buildQuestionIdentityCard(input, "A0_NAME_CARD");
		const a1 = buildQuestionIdentityCard(input, "A1_EVIDENCE_IDENTITY_CARD", 2);
		const replay = buildQuestionIdentityCard(reversed, "A1_EVIDENCE_IDENTITY_CARD", 2);

		expect(a0.representativeClaims).toEqual([]);
		expect(a0.evolutionSummary).toEqual([]);
		expect(a1).toEqual(replay);
		expect(a1.representativeClaims).toHaveLength(2);
		expect(new Set(a1.representativeClaims.map((claim) => claim.sourceId)).size).toBe(2);
		expect(a1.representativeClaims.some((claim) => claim.sourceId === input.sourceId)).toBe(false);

		const payload = buildQuestionAssociationPayload([input], "A1_EVIDENCE_IDENTITY_CARD");
		const serialized = JSON.stringify(payload);
		expect(serialized).not.toContain("expectedVerdict");
		expect(serialized).not.toContain("oracle");
		expect(payload.decisionContract).toMatchObject({
			manyToMany: true,
			createQuestionAllowed: false,
			canonicalMutationAllowed: false,
		});
	});

	it("rejects temporal leakage, label-bearing IDs, and unknown response fields", () => {
		const leaked = fixture();
		leaked.priorClaims[0] = { ...leaked.priorClaims[0], sourceId: leaked.sourceId };
		expect(() => buildQuestionIdentityCard(leaked, "A1_EVIDENCE_IDENTITY_CARD")).toThrow(
			/leaks current Source/,
		);

		const labeled = { ...fixture(), caseId: "QAB-PSY-ATTACH-01" };
		expect(() => buildQuestionIdentityCard(labeled, "A0_NAME_CARD")).toThrow(/not opaque/);

		expect(() =>
			parseQuestionAssociationDecisions({ decisions: [], expectedVerdict: "ATTACH" }),
		).toThrow(/keys mismatch/);
	});

	it("passes only grounded, exact-oracle decisions with an unchanged Canonical state hash", () => {
		const input = fixture();
		const oracle = oracleFixture();
		const decision = decisionFixture(input);
		const result = auditQuestionAssociationDecisions({
			variant: "A1_EVIDENCE_IDENTITY_CARD",
			cases: [input],
			oracle: [oracle],
			decisions: { decisions: [decision] },
			canonicalStateHashBefore: "canonical-state-hash",
			canonicalStateHashAfter: "canonical-state-hash",
		});
		expect(result.status).toBe("PASS");
		expect(result.summary).toEqual({
			caseCount: 1,
			attachCount: 1,
			rejectCount: 0,
			uncertainCount: 0,
			hardPositiveErrors: 0,
			falseAttachCount: 0,
			uncertaintyErrors: 0,
			canonicalMutationCount: 0,
		});
	});

	it("fails closed on false attachment, invented grounding, and Canonical mutation", () => {
		const input = fixture();
		const oracle = { ...oracleFixture(), expectedVerdict: "REJECT" as const };
		const decision = {
			...decisionFixture(input),
			groundedEvidenceRefs: ["span:invented"],
		};
		const result = auditQuestionAssociationDecisions({
			variant: "A1_EVIDENCE_IDENTITY_CARD",
			cases: [input],
			oracle: [oracle],
			decisions: { decisions: [decision] },
			canonicalStateHashBefore: "before",
			canonicalStateHashAfter: "after",
		});
		expect(result.status).toBe("FAIL");
		expect(result.summary.falseAttachCount).toBe(1);
		expect(result.summary.canonicalMutationCount).toBe(1);
		expect(result.blockers.map((blocker) => blocker.code)).toEqual([
			"CANONICAL_STATE_MUTATED",
			"FALSE_ATTACH_OR_REJECT_ERROR",
			"UNKNOWN_EVIDENCE_REF",
		]);
	});
});

function fixture(): QuestionAssociationFixtureCase {
	return {
		caseId: "QAB-PSY-01",
		domain: "psychology-reproducibility",
		sourceId: "source:new",
		snapshotId: "snapshot:before-new",
		beforeQuestionStateHash: "question-state-before",
		claim: claim("claim:new", "新的发表偏倚结果", "source:new", "kv:new"),
		question: {
			ref: "question:publication-bias",
			canonicalQuestion: "存在多大程度的发表偏倚？",
			aliases: ["发表偏倚程度"],
			boundaries: ["包括发表偏倚程度，不包括一般有效性"],
			domain: "psychology-reproducibility",
			scope: { type: "GLOBAL" },
			lifecycle: "ACTIVE",
			stateHash: "question-state-before",
		},
		priorClaims: [
			claim("claim:old-a", "研究发现显著发表偏倚", "source:old-a", "kv:old-a"),
			claim("claim:old-b", "偏倚程度可能为中度", "source:old-b", "kv:old-b"),
		],
		priorEvolution: [
			{
				action: "CREATE",
				sourceId: "source:old-a",
				knowledgeVersion: "kv:old-a",
				affectedClaimRefs: ["claim:old-a"],
				createdAt: "2026-08-01T00:00:00.000Z",
			},
			{
				action: "UPDATE",
				sourceId: "source:old-b",
				knowledgeVersion: "kv:old-b",
				affectedClaimRefs: ["claim:old-b"],
				createdAt: "2026-08-02T00:00:00.000Z",
			},
		],
	};
}

function claim(ref: string, statement: string, sourceId: string, knowledgeVersion: string) {
	return {
		ref,
		statement,
		conditions: [],
		validity: "SUPPORTED",
		claimKind: "FACT",
		scope: { type: "GLOBAL" },
		sourceId,
		knowledgeVersion,
		evidenceRefs: [{ ref: `span:${ref}`, baseSpanRef: `span:${ref}`, sourceId }],
	};
}

function oracleFixture(): QuestionAssociationOracleCase {
	return {
		caseId: "QAB-PSY-01",
		domain: "psychology-reproducibility",
		claimRef: "claim:new",
		questionRef: "question:publication-bias",
		expectedVerdict: "ATTACH",
		reasonCodes: ["IN_BOUND_SUPPORT"],
	};
}

function decisionFixture(input: QuestionAssociationFixtureCase): QuestionAssociationDecision {
	const card = buildQuestionIdentityCard(input, "A1_EVIDENCE_IDENTITY_CARD");
	return {
		caseId: input.caseId,
		claimRef: input.claim.ref,
		questionRef: input.question.ref,
		verdict: "ATTACH",
		reasonCodes: ["IN_BOUND_SUPPORT"],
		groundedClaimRefs: [input.claim.ref, card.representativeClaims[0]?.claimRef as string],
		groundedEvidenceRefs: [input.claim.evidenceRefs[0]?.ref as string],
		groundedQuestionClaimRefs: [card.representativeClaims[0]?.claimRef as string],
		boundaryNotes: [input.question.boundaries[0] as string],
		competingQuestionRefs: [],
	};
}
