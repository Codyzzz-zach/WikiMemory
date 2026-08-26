import { describe, expect, it } from "vitest";
import {
	type VariantSummary,
	classifyExperimentOutcome,
	formatRepairInstruction,
	validateQuestionAssociationResponse,
} from "../../scripts/run-question-association-bridge-experiment.js";
import type {
	QuestionAssociationDecision,
	QuestionAssociationPayload,
	QuestionAssociationVariant,
} from "../wiki/question-association-shadow.js";

describe("Question Association Bridge experiment runner", () => {
	it("accepts exact pair accounting and rejects duplicate decisions", () => {
		const exact = decision();
		expect(validateQuestionAssociationResponse({ decisions: [exact] }, payload())).toEqual([exact]);
		expect(() =>
			validateQuestionAssociationResponse({ decisions: [exact, exact] }, payload()),
		).toThrow(/accounting mismatch|Duplicate decision/);
	});

	it("keeps format repair explicitly non-semantic", () => {
		const instruction = formatRepairInstruction(new Error("missing decisions array"));
		expect(instruction).toContain("FORMAT_REPAIR_V1");
		expect(instruction).toContain("不得改变");
		expect(instruction).not.toContain("expectedVerdict");
	});

	it("closes the automatic result branches conservatively", () => {
		expect(
			classifyExperimentOutcome({
				a0: variant("A0_NAME_CARD", "PASS"),
				a1: variant("A1_EVIDENCE_IDENTITY_CARD", "PASS"),
				correctedCaseIds: [],
				introducedFailureCaseIds: [],
			}),
		).toBe("NO_MARGINAL_VALUE");
		expect(
			classifyExperimentOutcome({
				a0: variant("A0_NAME_CARD", "FAIL"),
				a1: variant("A1_EVIDENCE_IDENTITY_CARD", "PASS"),
				correctedCaseIds: ["QAB-PSY-01"],
				introducedFailureCaseIds: [],
			}),
		).toBe("PASS_IDENTITY_CARD");
		expect(
			classifyExperimentOutcome({
				a0: variant("A0_NAME_CARD", "FAIL"),
				a1: variant("A1_EVIDENCE_IDENTITY_CARD", "FAIL", 1),
				correctedCaseIds: [],
				introducedFailureCaseIds: [],
			}),
		).toBe("STOP_BRIDGE");
	});
});

function payload(): QuestionAssociationPayload {
	return {
		schemaVersion: "wge-question-association-input/v1",
		variant: "A0_NAME_CARD",
		domain: "psychology-reproducibility",
		decisionContract: {
			verdicts: ["ATTACH", "REJECT", "UNCERTAIN"],
			reasonCodes: ["IN_BOUND_SUPPORT"],
			manyToMany: true,
			createQuestionAllowed: false,
			canonicalMutationAllowed: false,
		},
		cases: [
			{
				caseId: "QAB-PSY-01",
				claim: {
					claimRef: "claim:new",
					statement: "新的发表偏倚结果",
					conditions: [],
					validity: "SUPPORTED",
					claimKind: "FACT",
					scope: { type: "GLOBAL" },
					evidenceRefs: ["span:new"],
				},
				question: {
					schemaVersion: "wge-question-identity-card/v1",
					questionRef: "question:publication-bias",
					canonicalQuestion: "存在多大程度的发表偏倚？",
					aliases: [],
					boundaries: ["包括偏倚程度"],
					domain: "psychology-reproducibility",
					scope: { type: "GLOBAL" },
					lifecycle: "ACTIVE",
					representativeClaims: [],
					evolutionSummary: [],
					closureSummary: {
						claimCount: 1,
						sourceCount: 1,
						knowledgeVersionCount: 1,
						omittedClaimCount: 1,
					},
				},
			},
		],
	};
}

function decision(): QuestionAssociationDecision {
	return {
		caseId: "QAB-PSY-01",
		claimRef: "claim:new",
		questionRef: "question:publication-bias",
		verdict: "ATTACH",
		reasonCodes: ["IN_BOUND_SUPPORT"],
		groundedClaimRefs: ["claim:new"],
		groundedEvidenceRefs: ["span:new"],
		groundedQuestionClaimRefs: [],
		boundaryNotes: ["包括偏倚程度"],
		competingQuestionRefs: [],
	};
}

function variant(
	name: QuestionAssociationVariant,
	status: "PASS" | "FAIL",
	falseAttachCount = 0,
): VariantSummary {
	return {
		variant: name,
		status,
		blockers: [],
		failedCaseIds: status === "PASS" ? [] : ["QAB-PSY-01"],
		summary: {
			caseCount: 18,
			attachCount: 0,
			rejectCount: 0,
			uncertainCount: 0,
			hardPositiveErrors: 0,
			falseAttachCount,
			uncertaintyErrors: 0,
			canonicalMutationCount: 0,
		},
	};
}
