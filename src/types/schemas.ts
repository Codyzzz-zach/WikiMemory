/**
 * LLM 输出 Zod Schema 定义
 *
 * 修 GPT 问题 5.6：TypeScript 类型运行时不存在，不能校验 LLM 输出。
 * 所有 LLM 调用的输出用 Zod schema 运行时校验。
 * 校验失败抛错（带原文片段），不静默吞掉（修旧项目坑 3.3）。
 *
 * 集中管理（修旧项目坑 3.1：prompt 散落 7+ 文件无管理）。
 */

import { z } from "zod";

// ─── 公共枚举（与 types/index.ts 对齐）──────────────────────────

export const DerivationSchema = z.enum(["EXTRACTED", "INFERRED", "HUMAN_ASSERTED"]);
export const ValiditySchema = z.enum(["SUPPORTED", "DISPUTED", "UNRESOLVED"]);
export const RelationTypeSchema = z.enum([
	"REQUIRES",
	"DERIVED_FROM",
	"SUPPORTS",
	"CONTRADICTS",
	"SUPERSEDES",
	"EQUIVALENT_UNDER",
	"RELATED_TO",
]);

// ─── 命题切分 LLM 输出（Compiler 第一步）────────────────────────

export const PropositionItemSchema = z.object({
	text: z.string().min(1, "命题文本不能为空"),
	exactQuote: z.string().min(1, "原文引用不能为空"),
	blockId: z.string().min(1, "blockId 不能为空"),
	relatesTo: z.preprocess(
		(value) => (value === null ? undefined : value),
		z
			.object({
				fromPropIndex: z.number().int().nonnegative(),
				type: RelationTypeSchema,
			})
			.optional(),
	),
});

export const PropositionResponseSchema = z.object({
	propositions: z.array(PropositionItemSchema).min(1, "至少需要一条命题"),
});

export type PropositionResponse = z.infer<typeof PropositionResponseSchema>;

// ─── Claim 编译 LLM 输出（Compiler 第三步）──────────────────────

export const ClaimDraftSchema = z.object({
	statement: z.string().min(1, "Claim 陈述不能为空"),
	evidenceQuotes: z.array(z.string()).min(1, "至少需要一个原文引用"),
	blockIds: z.array(z.string()).min(1, "至少需要一个 blockId"),
	conditions: z.array(z.string()).default([]),
	derivation: DerivationSchema.default("EXTRACTED"),
	confidence: z.number().min(0).max(1).default(0.75),
});
export type ClaimDraft = z.infer<typeof ClaimDraftSchema>;

export const ConceptDraftSchema = z.object({
	name: z.string().min(1),
	aliases: z.array(z.string()).default([]),
	boundary: z.string().default(""),
	domain: z.string().default(""),
});
export type ConceptDraft = z.infer<typeof ConceptDraftSchema>;

export const RelationDraftSchema = z.object({
	fromStatement: z.string().min(1),
	toStatement: z.string().min(1),
	type: RelationTypeSchema,
	conditions: z.array(z.string()).default([]),
	confidence: z.number().min(0).max(1).default(0.7),
});

export const CompileResponseSchema = z.object({
	claims: z.array(ClaimDraftSchema),
	concepts: z.array(ConceptDraftSchema).default([]),
	relations: z
		.array(
			z.object({
				fromClaimIndex: z.number().int().nonnegative(),
				toClaimIndex: z.number().int().nonnegative(),
				...RelationDraftSchema.shape,
			}),
		)
		.default([]),
});

export type CompileResponse = z.infer<typeof CompileResponseSchema>;

/** Token-batched Claim compilation deliberately excludes Concept/Relation generation. */
export const ClaimBatchResponseSchema = z.object({
	claims: z.array(ClaimDraftSchema),
});

export const ConceptResponseSchema = z.object({
	concepts: z.array(ConceptDraftSchema).default([]),
});

export const RelationOnlyDraftSchema = z.object({
	fromClaimIndex: z.number().int().nonnegative(),
	toClaimIndex: z.number().int().nonnegative(),
	type: RelationTypeSchema,
	conditions: z.array(z.string()).default([]),
	confidence: z.number().min(0).max(1).default(0.7),
});
export type RelationOnlyDraft = z.infer<typeof RelationOnlyDraftSchema>;

export const RelationResponseSchema = z.object({
	relations: z.array(RelationOnlyDraftSchema).default([]),
});

// ─── 语义审计 LLM 输出（Linter）──────────────────────────────────
//
// v1.1 改造：5 维度改 binary verdict（pass/fail）+ 每维必带 evidence（原文片段）。
// 消除旧版 score 0-1 的评分方差（faithfulness 是两次随机 LLM 调用，分数不稳定）。
// anchor 是整体判断的原文锚点，程序验证它真实存在于 SourceSpan（防 LLM 编造证据）。

const DimensionResultSchema = z.enum(["pass", "fail"]);
export const AuditDimensionNameSchema = z.enum([
	"support",
	"addition",
	"inference",
	"limits",
	"citation",
]);
export type AuditDimensionName = z.infer<typeof AuditDimensionNameSchema>;

export const DimensionVerdictSchema = z.object({
	result: DimensionResultSchema,
	/** 输入证据数组的下标。避免模型复述原文时产生转义错误或伪造 quote。 */
	evidenceSpanIndexes: z.array(z.number().int().nonnegative()),
});

export const SemanticVerdictSchema = z.object({
	verdict: z.enum(["passed", "warning", "failed"]),
	dimensions: z.object({
		support: DimensionVerdictSchema,
		addition: DimensionVerdictSchema,
		inference: DimensionVerdictSchema,
		limits: DimensionVerdictSchema,
		citation: DimensionVerdictSchema,
	}),
	/** 整体判断的证据锚点，必须是输入证据数组中的有效下标。 */
	anchorSpanIndex: z.number().int().nonnegative(),
	failedDimensions: z.array(AuditDimensionNameSchema),
});

export type SemanticVerdict = z.infer<typeof SemanticVerdictSchema>;
export type DimensionVerdict = z.infer<typeof DimensionVerdictSchema>;

// ─── Relation 语义审计输出 ──────────────────────────────────────

export const RelationAuditDimensionNameSchema = z.enum([
	"identity",
	"relation",
	"type",
	"direction",
	"conditions",
]);
export type RelationAuditDimensionName = z.infer<typeof RelationAuditDimensionNameSchema>;

export const RelationSemanticVerdictSchema = z.object({
	verdict: z.enum(["passed", "failed"]),
	dimensions: z.object({
		identity: DimensionVerdictSchema,
		relation: DimensionVerdictSchema,
		type: DimensionVerdictSchema,
		direction: DimensionVerdictSchema,
		conditions: DimensionVerdictSchema,
	}),
	anchorSpanIndex: z.number().int().nonnegative(),
	failedDimensions: z.array(RelationAuditDimensionNameSchema),
	/** 真正支撑“边”而不仅是端点的证据下标；失败判定允许为空。 */
	supportingEvidenceSpanIndexes: z.array(z.number().int().nonnegative()),
});
export type RelationSemanticVerdict = z.infer<typeof RelationSemanticVerdictSchema>;

// ─── 矛盾检测 LLM 输出（Compiler Step 4）────────────────────────

export const ContradictionCandidateSchema = z.object({
	claimA: z.string().min(1),
	claimB: z.string().min(1),
	reason: z.string().min(1),
	confidence: z.number().min(0).max(1),
	evidenceQuote: z.string().min(1),
});

export const ContradictionResponseSchema = z.object({
	contradictions: z.array(ContradictionCandidateSchema).default([]),
});

export type ContradictionResponse = z.infer<typeof ContradictionResponseSchema>;

// ─── 统一 JSON 解析工具（修旧项目坑 3.3）────────────────────────

/**
 * 解析 LLM 返回的 JSON 内容。
 * 剥除可能的 markdown 围栏（```json ... ```），然后 JSON.parse。
 * 失败抛带原文的诊断 Error（不静默吞掉）。
 */
export function parseLLMJson<T>(content: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>): T {
	let cleaned = content.trim();

	// 剥除 markdown 围栏
	if (cleaned.startsWith("```")) {
		const end = cleaned.indexOf("\n", 3);
		if (end !== -1) {
			cleaned = cleaned.slice(end + 1);
			if (cleaned.endsWith("```")) {
				cleaned = cleaned.slice(0, -3);
			}
			cleaned = cleaned.trim();
		}
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(cleaned);
	} catch {
		throw new Error(
			`LLM 返回的内容不是合法 JSON:\n${cleaned.slice(0, 500)}${cleaned.length > 500 ? "..." : ""}`,
		);
	}

	const result = schema.safeParse(parsed);
	if (!result.success) {
		const issues = result.error.issues
			.map((i) => `  [${i.path.join(".")}] ${i.message}`)
			.join("\n");
		throw new Error(`LLM 输出不符合 schema:\n${issues}\n\n原文片段:\n${cleaned.slice(0, 300)}`);
	}

	return result.data;
}
