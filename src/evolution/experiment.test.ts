import { describe, expect, it } from "vitest";
import { assertTimelineTransition, summarizeRetrieval } from "./experiment.js";

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
});
