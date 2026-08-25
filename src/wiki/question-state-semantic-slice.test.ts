import { describe, expect, it } from "vitest";
import {
	type SemanticSliceAuditInput,
	auditQuestionStateSemanticSlice,
} from "./question-state-semantic-slice.js";

describe("C1 semantic slice association gate", () => {
	it("fails closed when an Episode source is not associated with a frozen QuestionFrame", () => {
		const audit = auditQuestionStateSemanticSlice(fixture());
		expect(audit.status).toBe("STOP_UPSTREAM_QUESTION_ASSOCIATION");
		expect(audit.summary).toEqual({
			episodeCount: 1,
			questionCount: 1,
			expectedSourceCount: 3,
			coveredSourceCount: 2,
			missingSourceCount: 1,
			claimCount: 2,
			relationCount: 0,
			blockerCount: 1,
		});
		expect(audit.episodes[0]).toMatchObject({
			status: "STOP_UPSTREAM_QUESTION_ASSOCIATION",
			coveredSourceIds: ["source-a", "source-b"],
			missingSourceIds: ["source-c"],
		});
		expect(audit.episodes[0]?.timepoints).toEqual([
			{
				timepoint: "T0",
				expectedSourceIds: ["source-a"],
				associatedSourceIds: ["source-a"],
				missingSourceIds: [],
				coverageRatio: 1,
			},
			{
				timepoint: "T1",
				expectedSourceIds: ["source-b", "source-c"],
				associatedSourceIds: ["source-b"],
				missingSourceIds: ["source-c"],
				coverageRatio: 0.5,
			},
		]);
	});

	it("is ready only when every frozen source identity and QuestionFrame association resolves", () => {
		const input = fixture();
		input.frames[0]?.formationSignals.push({
			sourceIds: ["source-ref-c"],
			claimRefs: ["claim:c"],
			relationIds: ["relation:c"],
		});
		input.sourceIdentities.push({ ref: "source-ref-c", sourceId: "source-c" });
		const audit = auditQuestionStateSemanticSlice(input);
		expect(audit.status).toBe("READY_FOR_AMBIGUITY_REVIEW");
		expect(audit.summary).toMatchObject({
			coveredSourceCount: 3,
			missingSourceCount: 0,
			claimCount: 3,
			relationCount: 1,
			blockerCount: 0,
		});
	});

	it("reports missing frames and dangling canonical Source refs without inventing matches", () => {
		const input = fixture();
		input.episodes[0]?.questionRefs.push("question:missing");
		input.frames[0]?.formationSignals.push({
			sourceIds: ["source-ref-dangling"],
			claimRefs: ["claim:dangling"],
			relationIds: [],
		});
		const audit = auditQuestionStateSemanticSlice(input);
		expect(audit.episodes[0]?.blockers.map((blocker) => blocker.code)).toEqual([
			"CANONICAL_SOURCE_IDENTITY_MISSING",
			"FROZEN_QUESTION_FRAME_MISSING",
			"SOURCE_NOT_ASSOCIATED_WITH_FROZEN_QUESTION",
		]);
	});

	it("rejects duplicate identities and duplicate pre-registered timepoints", () => {
		const duplicateIdentity = fixture();
		duplicateIdentity.sourceIdentities.push({ ref: "source-ref-a", sourceId: "source-z" });
		expect(() => auditQuestionStateSemanticSlice(duplicateIdentity)).toThrow(
			/Duplicate Source identity/,
		);

		const duplicateTimepoint = fixture();
		duplicateTimepoint.episodes[0]?.timepoints.push({
			timepoint: "T0",
			sourceIds: ["source-a"],
		});
		expect(() => auditQuestionStateSemanticSlice(duplicateTimepoint)).toThrow(
			/timepoints.*duplicates/,
		);
	});
});

function fixture(): SemanticSliceAuditInput {
	return {
		episodes: [
			{
				episodeId: "episode:1",
				questionRefs: ["question:1"],
				timepoints: [
					{ timepoint: "T0", sourceIds: ["source-a"] },
					{ timepoint: "T1", sourceIds: ["source-b", "source-c"] },
				],
				targetTransitions: ["SAME_QUESTION_UPDATE"],
			},
		],
		frames: [
			{
				id: "question:1",
				formationSignals: [
					{
						sourceIds: ["source-ref-a", "source-ref-b", "source-ref-a"],
						claimRefs: ["claim:a", "claim:b", "claim:a"],
						relationIds: [],
					},
				],
			},
		],
		sourceIdentities: [
			{ ref: "source-ref-a", sourceId: "source-a" },
			{ ref: "source-ref-b", sourceId: "source-b" },
		],
	};
}
