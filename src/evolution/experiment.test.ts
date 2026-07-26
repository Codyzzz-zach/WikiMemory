import { describe, expect, it } from "vitest";
import {
	assertTimelineTransition,
	summarizeEvolutionCoverage,
	summarizeRetrieval,
	validateEvolutionApproval,
} from "./experiment.js";

describe("isolated evolution experiment contracts", () => {
	it("allows only a contiguous forward timeline", () => {
		expect(() => assertTimelineTransition([], "T0")).not.toThrow();
		expect(() => assertTimelineTransition(["T0", "T1"], "T2")).not.toThrow();
		expect(() => assertTimelineTransition([], "T1")).toThrow("下一个允许");
		expect(() => assertTimelineTransition(["T0", "T2"], "T3")).toThrow("不是连续");
		expect(() => assertTimelineTransition(["T0", "T0"], "T1")).toThrow("重复");
	});

	it("reports document recall, precision, and empty contexts by group", () => {
		const summary = summarizeRetrieval([
			{
				questionId: "q1",
				group: "B",
				expectedDocumentIds: ["d1", "d2"],
				retrievedDocumentIds: ["d1", "noise"],
				contextEmpty: false,
			},
			{
				questionId: "q2",
				group: "B",
				expectedDocumentIds: [],
				retrievedDocumentIds: [],
				contextEmpty: true,
			},
			{
				questionId: "q1",
				group: "P",
				expectedDocumentIds: ["d1", "d2"],
				retrievedDocumentIds: ["d1", "d2"],
				contextEmpty: false,
			},
		]);
		expect(summary.B).toMatchObject({
			questions: 2,
			requiredDocuments: 2,
			hits: 1,
			retrievedDocuments: 2,
			recall: 0.5,
			precision: 0.5,
			emptyContexts: 1,
		});
		expect(summary.P).toMatchObject({ recall: 1, precision: 1, emptyContexts: 0 });
	});

	it("requires evolution coverage per expected document instead of any nonzero edge count", () => {
		const expected = [
			{ documentId: "new-a", sourceId: "source:new-a", targetSourceIds: ["source:old-a"] },
			{ documentId: "new-b", sourceId: "source:new-b", targetSourceIds: ["source:old-b"] },
		];
		expect(
			summarizeEvolutionCoverage("T2", expected, [
				{ fromSourceId: "source:new-a", toSourceId: "source:old-a" },
			]),
		).toEqual({
			expectedDocumentIds: ["new-a", "new-b"],
			coveredDocumentIds: ["new-a"],
			missingDocumentIds: ["new-b"],
		});
		expect(
			summarizeEvolutionCoverage(
				"T3",
				[{ documentId: "conflict", sourceId: "source:conflict", targetSourceIds: [] }],
				[{ fromSourceId: "source:conflict", toSourceId: "source:conflict" }],
			),
		).toMatchObject({ missingDocumentIds: [] });
	});

	it("requires a complete, disjoint per-edge approval decision", () => {
		const approval = {
			schemaVersion: "wge-evolution-approval/v1" as const,
			runId: "run-1",
			timeline: "T2" as const,
			reviewer: "reviewer:alice",
			reviewedAt: "2026-07-26T00:00:00.000Z",
			approvedRelationIds: ["rel:a"],
			rejectedRelations: [{ relationId: "rel:b", reason: "作用域不完整" }],
		};
		expect(validateEvolutionApproval(approval, "run-1", "T2", ["rel:a", "rel:b"])).toBe(approval);
		expect(() =>
			validateEvolutionApproval({ ...approval, rejectedRelations: [] }, "run-1", "T2", [
				"rel:a",
				"rel:b",
			]),
		).toThrow("未逐条审查");
		expect(() =>
			validateEvolutionApproval(
				{ ...approval, rejectedRelations: [{ relationId: "rel:a", reason: "冲突" }] },
				"run-1",
				"T2",
				["rel:a"],
			),
		).toThrow("非法批准");
	});
});
