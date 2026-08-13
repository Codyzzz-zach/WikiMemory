import { z } from "zod";
import type { PilotGroup } from "../pilot/index.js";

export const EVOLUTION_ANSWER_SYSTEM = `你是一个受证据约束的问答 Agent。只使用本次请求提供的检索上下文回答问题。
要求：
1. 保留所有影响结论的条件、例外、时间边界和不确定性。
2. 每个关键结论引用上下文中的 SOURCE、EVIDENCE、CLAIM 或 RELATION 标识。
3. citations 中的每个标识必须从上下文的 id 字段逐字符复制，保留原始前缀和完整后缀；不得把 span: 改成 claim:，不得自行拼接、缩写或推测标识。
4. 若找不到可逐字符复制的标识，就把该信息列入 uncertainties，不得伪造引用。
5. 遇到未决冲突时必须呈现冲突双方和未决原因，不得擅自选择赢家。
6. 如果上下文不足，明确回答 insufficient，不得依赖外部常识补齐。
7. 只输出严格 JSON：{"answer":"...","citations":["..."],"insufficient":false,"uncertainties":["..."]}。`;

export const EVOLUTION_JUDGE_SYSTEM = `你是知识演化实验的盲测评分员。你不知道答案来自哪个实验组，只按 Gold 和评分合同评价匿名答案。
每项 0-2 分：requiredFactCoverage、conditionFidelity、answerabilityDiscipline、evidenceGrounding。
requiredFactCoverage：2=所有 requiredFacts 均被答案明确表达；1=只明确表达一部分；0=没有表达或与之矛盾。不得把“测试通过”等宽泛表述推断成“覆盖率达到具体阈值”“没有严重漏洞”等未写出的事实。
conditionFidelity：2=所有 requiredConditions 均被明确保留；1=只保留一部分；0=遗漏关键条件、变成无条件结论或条件相反。
若答案使用 forbiddenFacts、对 DISPUTED 问题擅自选边、对 INSUFFICIENT 问题编造结论，hardFailure=true。
evidenceGrounding 必须结合系统提供的 citationValidation 判断；不得因引用格式看起来专业而加分。
只输出严格 JSON：{"scores":[{"sampleId":"...","requiredFactCoverage":0,"conditionFidelity":0,"answerabilityDiscipline":0,"evidenceGrounding":0,"hardFailure":false,"rationale":"..."}]}。`;

const AnswerSchema = z.object({
	answer: z.string().min(1),
	citations: z.array(z.string()),
	insufficient: z.boolean(),
	uncertainties: z.array(z.string()),
});

const JudgeScoreSchema = z.object({
	sampleId: z.string().min(1),
	requiredFactCoverage: z.number().int().min(0).max(2),
	conditionFidelity: z.number().int().min(0).max(2),
	answerabilityDiscipline: z.number().int().min(0).max(2),
	evidenceGrounding: z.number().int().min(0).max(2),
	hardFailure: z.boolean(),
	rationale: z.string(),
});

export interface ParsedEvolutionAnswer {
	answer: string;
	citations: string[];
	insufficient: boolean;
	uncertainties: string[];
}

export interface EvolutionJudgeScore extends z.infer<typeof JudgeScoreSchema> {
	questionId: string;
	total: number;
	group?: PilotGroup;
}

export function parseEvolutionAnswer(content: string): ParsedEvolutionAnswer {
	return AnswerSchema.parse(parseJsonEnvelope(content));
}

export function parseEvolutionJudgeScores(
	content: string,
): Array<z.infer<typeof JudgeScoreSchema>> {
	return z.object({ scores: z.array(JudgeScoreSchema) }).parse(parseJsonEnvelope(content)).scores;
}

export function validateAnswerCitations(
	answer: ParsedEvolutionAnswer,
	context: string,
): { valid: boolean; invalid: string[] } {
	if (answer.insufficient && answer.citations.length === 0) return { valid: true, invalid: [] };
	const invalid = answer.citations.filter((citation) => {
		if (context.includes(citation)) return false;
		const embeddedIdentifier = citation.match(/(?:claim|rel|span|source):[^\s\],)"']+/iu)?.[0];
		return !embeddedIdentifier || !context.includes(embeddedIdentifier);
	});
	return { valid: invalid.length === 0 && answer.citations.length > 0, invalid };
}

export function collectCitationIdentifiers(context: string): string[] {
	const identifiers = new Set<string>();
	visitJsonValue(JSON.parse(context), (value) => {
		if (/^(?:claim|rel|span|source):\S+$/u.test(value)) identifiers.add(value);
	});
	return [...identifiers].sort();
}

export function buildCitationRepairInstruction(
	invalidCitations: string[],
	allowedIdentifiers: string[],
): string {
	return `上一份输出被引用门禁拒绝。请重新输出完整 JSON 答案，并遵守以下修复约束：
1. 保留有证据支持的回答内容；删除无法被允许标识支持的内容，不得补充外部知识。
2. citations 只能逐字符复制“允许标识”数组中的字符串，不得修改、拼接或推测。
3. 不要在 citations 中再次使用“被拒绝标识”。

被拒绝标识：${JSON.stringify(invalidCitations)}
允许标识：${JSON.stringify(allowedIdentifiers)}`;
}

export function aggregateEvolutionScores(
	rows: Array<EvolutionJudgeScore & { group: PilotGroup; category: string }>,
): Record<string, unknown> {
	const summarize = (selected: typeof rows) => {
		const average = (values: number[]) =>
			values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
		return {
			n: selected.length,
			averageTotal: average(selected.map((row) => row.total)),
			averageRequiredFactCoverage: average(selected.map((row) => row.requiredFactCoverage)),
			averageConditionFidelity: average(selected.map((row) => row.conditionFidelity)),
			averageAnswerabilityDiscipline: average(selected.map((row) => row.answerabilityDiscipline)),
			averageEvidenceGrounding: average(selected.map((row) => row.evidenceGrounding)),
			hardFailures: selected.filter((row) => row.hardFailure).length,
		};
	};
	return {
		byGroup: Object.fromEntries(
			(["B", "P", "E-min"] as PilotGroup[]).map((group) => [
				group,
				summarize(rows.filter((row) => row.group === group)),
			]),
		),
		byCategoryAndGroup: Object.fromEntries(
			[...new Set(rows.map((row) => row.category))]
				.sort()
				.flatMap((category) =>
					(["B", "P", "E-min"] as PilotGroup[]).map((group) => [
						`${category}:${group}`,
						summarize(rows.filter((row) => row.category === category && row.group === group)),
					]),
				),
		),
	};
}

function parseJsonEnvelope(content: string): unknown {
	return JSON.parse(
		content
			.trim()
			.replace(/^```(?:json)?\s*/iu, "")
			.replace(/\s*```$/u, ""),
	);
}

function visitJsonValue(value: unknown, visit: (value: string) => void): void {
	if (typeof value === "string") {
		visit(value);
		return;
	}
	if (Array.isArray(value)) {
		for (const item of value) visitJsonValue(item, visit);
		return;
	}
	if (typeof value === "object" && value !== null) {
		for (const item of Object.values(value)) visitJsonValue(item, visit);
	}
}
