import { describe, expect, it } from "vitest";
import {
	EVOLUTION_ANSWER_SYSTEM,
	EVOLUTION_JUDGE_SYSTEM,
	aggregateEvolutionScores,
	buildCitationRepairInstruction,
	collectCitationIdentifiers,
	parseEvolutionAnswer,
	validateAnswerCitations,
} from "./evaluation.js";

describe("evolution answer evaluation", () => {
	it("requires citation identifiers to be copied verbatim without prefix rewriting", () => {
		expect(EVOLUTION_ANSWER_SYSTEM).toContain("逐字符复制");
		expect(EVOLUTION_ANSWER_SYSTEM).toContain("不得把 span: 改成 claim:");
		expect(EVOLUTION_ANSWER_SYSTEM).toContain("不得伪造引用");
	});

	it("forbids the judge from inferring specific gold facts from broad answer language", () => {
		expect(EVOLUTION_JUDGE_SYSTEM).toContain("所有 requiredFacts 均被答案明确表达");
		expect(EVOLUTION_JUDGE_SYSTEM).toContain("不得把“测试通过”");
		expect(EVOLUTION_JUDGE_SYSTEM).toContain("所有 requiredConditions 均被明确保留");
	});

	it("builds a closed citation allowlist and repair instruction", () => {
		const identifiers = collectCitationIdentifiers(
			JSON.stringify({
				claim: { id: "claim:a", evidenceSpanIds: ["span:s#chars-0-2"] },
				relation: { id: "rel:r" },
				wiki: { id: "wiki:w", text: "claim:not-an-id inside prose" },
			}),
		);
		expect(identifiers).toEqual(["claim:a", "rel:r", "span:s#chars-0-2"]);
		const instruction = buildCitationRepairInstruction(["claim:made-up"], identifiers);
		expect(instruction).toContain('"claim:made-up"');
		expect(instruction).toContain('"span:s#chars-0-2"');
		expect(instruction).toContain("只能逐字符复制");
	});

	it("parses strict answers and validates citations against only the supplied context", () => {
		const answer = parseEvolutionAnswer(
			'{"answer":"尚未裁决","citations":["claim:a"],"insufficient":false,"uncertainties":["无赢家"]}',
		);
		expect(validateAnswerCitations(answer, "## CLAIM claim:a\n内容")).toEqual({
			valid: true,
			invalid: [],
		});
		expect(validateAnswerCitations(answer, "## CLAIM claim:b\n内容").valid).toBe(false);
		expect(
			validateAnswerCitations(
				{ ...answer, citations: ["evidence:span:abc#chars-0-5"] },
				"## EVIDENCE span:abc#chars-0-5\n内容",
			).valid,
		).toBe(true);
		expect(
			validateAnswerCitations(
				{ answer: "insufficient", citations: [], insufficient: true, uncertainties: [] },
				"## KNOWN GAPS\n没有相关证据",
			),
		).toEqual({ valid: true, invalid: [] });
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
