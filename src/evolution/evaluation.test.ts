import { describe, expect, it } from "vitest";
import {
	aggregateEvolutionScores,
	parseEvolutionAnswer,
	validateAnswerCitations,
} from "./evaluation.js";

describe("evolution answer evaluation", () => {
	it("parses strict answers and validates citations against only the supplied context", () => {
		const answer = parseEvolutionAnswer(
			'{"answer":"尚未裁决","citations":["claim:a"],"insufficient":false,"uncertainties":["无赢家"]}',
		);
		expect(validateAnswerCitations(answer, "## CLAIM claim:a\n内容")).toEqual({
			valid: true,
			invalid: [],
		});
		expect(validateAnswerCitations(answer, "## CLAIM claim:b\n内容").valid).toBe(false);
	});

	it("aggregates blinded scores by group and category", () => {
		const rows = [
			{
				sampleId: "s1",
				questionId: "q1",
				group: "B" as const,
				category: "dispute",
				requiredFactCoverage: 2,
				conditionFidelity: 1,
				answerabilityDiscipline: 2,
				evidenceGrounding: 1,
				hardFailure: false,
				rationale: "ok",
				total: 6,
			},
		];
		expect(aggregateEvolutionScores(rows)).toMatchObject({
			byGroup: { B: { n: 1, averageTotal: 6 }, P: { n: 0 }, "E-min": { n: 0 } },
			byCategoryAndGroup: { "dispute:B": { n: 1, hardFailures: 0 } },
		});
	});
});
