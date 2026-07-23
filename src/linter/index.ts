/**
 * Write-time Linter — 消费前门禁（Claim + Relation 原子候选 diff）
 *
 * 修 GPT 审计断点 1：Relation 没有经过 Lint 晋级，直接 appendRelations 导致 Graph 空壳。
 * 修 GPT 审计断点 5：Canonical 消费矩阵未定义，UNRESOLVED 可能被当普通节点用。
 * 修 GPT 审计断点 6：原子发布缺失，Claim/Concept/Relation 分别追加会产生不一致状态。
 *
 * 决策 2A：Lint 通过自动 Canonical，不等人类确认。
 * 失败进 Quarantine（物理隔离）。
 * 冲突内容可 Canonical + validity=DISPUTED（不要求人类选边）。
 *
 * Product Definition 哲学 09：语义 CI 必须发生在消费前。
 */

import { join } from "node:path";
import type { AppConfig } from "../config/types.js";
import type { LLMProvider } from "../core/llm-provider.js";
import { SEMANTIC_AUDIT_SYSTEM, SEMANTIC_AUDIT_VERSION } from "../prompts/index.js";
import type { Claim, Concept, Relation, SourceSpan } from "../types/index.js";
import { SemanticVerdictSchema, parseLLMJson } from "../types/schemas.js";
import type { SemanticVerdict } from "../types/schemas.js";
import { appendAuditMetric, appendJsonl } from "./storage.js";

// ─── 结构化 Lint Issue（修断点 7）──────────────────────────────

/** Lint issue 的稳定编码——不依赖文本匹配 */
export type IssueCode =
	| "MISSING_EVIDENCE"
	| "BROKEN_REFERENCE"
	| "EMPTY_STATEMENT"
	| "INVALID_PUBLICATION_STATE"
	| "BROKEN_RELATION_ENDPOINT"
	| "INVALID_RELATION_TYPE"
	| "RELATION_ENDPOINT_QUARANTINED"
	| "SEMANTIC_SUPPORT_FAILED"
	| "SEMANTIC_ADDITION_MAJOR"
	| "SEMANTIC_INFERENCE_WRONG"
	| "SEMANTIC_LIMITS_MISSING"
	| "SEMANTIC_CITATION_FAILED"
	| "SEMANTIC_CONFLICT_DETECTED"
	| "SEMANTIC_ANCHOR_FABRICATED" // v1.1：审计 anchor 编造——审计结论本身不可信
	| "SEMANTIC_WARNING";

export type IssueSeverity = "error" | "warning" | "info";

/** Lint 建议的目标状态 */
export type RecommendedState = "CANONICAL" | "CANONICAL_DISPUTED" | "QUARANTINE";

export interface LintIssue {
	code: IssueCode;
	severity: IssueSeverity;
	/** 被影响的对象 ID */
	affectedObject: string;
	/** 人类可读描述 */
	detail: string;
	/** 建议的目标发布状态 */
	recommendedState: RecommendedState;
}

// ─── Lint 结果 ──────────────────────────────────────────────────

/** 单个对象的 Lint 结果 */
export interface ObjectLintResult<T> {
	object: T;
	issues: LintIssue[];
	/** 最终决定的发布状态 */
	finalState: "CANONICAL" | "CANONICAL_DISPUTED" | "QUARANTINED";
}

/** 一次编译的完整 Lint 结果（原子候选 diff） */
export interface CompileLintResult {
	claims: ObjectLintResult<Claim>[];
	relations: ObjectLintResult<Relation>[];
	concepts: Concept[];
	/** 通过 Lint 的 Canonical Claim */
	canonicalClaims: Claim[];
	/** 通过 Lint 的 Canonical Relation */
	canonicalRelations: Relation[];
	/** 被隔离的 Claim */
	quarantinedClaims: Array<{ claim: Claim; issues: LintIssue[] }>;
	/** 被隔离的 Relation */
	quarantinedRelations: Array<{ relation: Relation; issues: LintIssue[] }>;
}

// ─── 确定性硬门禁 ────────────────────────────────────────────────

/** Claim 结构性检查 */
export function checkClaimStructure(claim: Claim, allSpanIds: Set<string>): LintIssue[] {
	const issues: LintIssue[] = [];

	if (!claim.statement || claim.statement.trim().length === 0) {
		issues.push({
			code: "EMPTY_STATEMENT",
			severity: "error",
			affectedObject: claim.id,
			detail: "statement 为空",
			recommendedState: "QUARANTINE",
		});
	}

	if (claim.evidenceSpanIds.length === 0) {
		issues.push({
			code: "MISSING_EVIDENCE",
			severity: "error",
			affectedObject: claim.id,
			detail: "无证据（evidenceSpanIds 为空）",
			recommendedState: "QUARANTINE",
		});
	}

	for (const spanId of claim.evidenceSpanIds) {
		if (!allSpanIds.has(spanId)) {
			issues.push({
				code: "BROKEN_REFERENCE",
				severity: "error",
				affectedObject: claim.id,
				detail: `引用了不存在的 spanId: ${spanId}`,
				recommendedState: "QUARANTINE",
			});
		}
	}

	return issues;
}

/** 合法的 RelationType 集合——用于 type 合法性硬检查 */
const VALID_RELATION_TYPES = new Set<string>([
	"REQUIRES",
	"DERIVED_FROM",
	"SUPPORTS",
	"CONTRADICTS",
	"SUPERSEDES",
	"EQUIVALENT_UNDER",
	"RELATED_TO",
]);

/**
 * Relation 结构性检查（修断点 1）。
 *
 * 检查：
 * 1. 类型合法（未知类型 = 硬失败，不降级为 RELATED_TO）
 * 2. 端点 Claim 存在
 * 3. 端点 Claim 通过了 Lint（不是 Quarantined）
 */
export function checkRelationStructure(
	relation: Relation,
	canonicalClaimIds: Set<string>,
	allClaimIds: Set<string>,
): LintIssue[] {
	const issues: LintIssue[] = [];

	// 类型合法性检查（偏离 1 修复：合同要求"未知类型硬失败"）
	if (!VALID_RELATION_TYPES.has(relation.type)) {
		issues.push({
			code: "INVALID_RELATION_TYPE",
			severity: "error",
			affectedObject: relation.id,
			detail: `未知的 Relation 类型: ${relation.type}（合法值: REQUIRES | DERIVED_FROM | SUPPORTS | CONTRADICTS | SUPERSEDES | EQUIVALENT_UNDER | RELATED_TO）`,
			recommendedState: "QUARANTINE",
		});
	}

	const fromId = relation.from as string;
	const toId = relation.to as string;

	// 端点存在
	if (!allClaimIds.has(fromId)) {
		issues.push({
			code: "BROKEN_RELATION_ENDPOINT",
			severity: "error",
			affectedObject: relation.id,
			detail: `from 端点不存在: ${fromId}`,
			recommendedState: "QUARANTINE",
		});
	}
	if (!allClaimIds.has(toId)) {
		issues.push({
			code: "BROKEN_RELATION_ENDPOINT",
			severity: "error",
			affectedObject: relation.id,
			detail: `to 端点不存在: ${toId}`,
			recommendedState: "QUARANTINE",
		});
	}

	// 端点是否 Quarantined（修断点 1：依赖坏端点的边不进图）
	if (!canonicalClaimIds.has(fromId) && allClaimIds.has(fromId)) {
		issues.push({
			code: "RELATION_ENDPOINT_QUARANTINED",
			severity: "error",
			affectedObject: relation.id,
			detail: `from 端点未通过 Lint（Quarantined）: ${fromId}`,
			recommendedState: "QUARANTINE",
		});
	}
	if (!canonicalClaimIds.has(toId) && allClaimIds.has(toId)) {
		issues.push({
			code: "RELATION_ENDPOINT_QUARANTINED",
			severity: "error",
			affectedObject: relation.id,
			detail: `to 端点未通过 Lint（Quarantined）: ${toId}`,
			recommendedState: "QUARANTINE",
		});
	}

	return issues;
}

// ─── 语义门禁 ────────────────────────────────────────────────────

/**
 * 语义门禁（1 次 LLM/claim）。
 *
 * v1.1 改造（audit_reliability_research.md）：
 * - 审计边界收窄为封闭对照："Claim 是否忠实于 SourceSpan"，不判对错
 * - 5 维度改 binary verdict，消除评分方差
 * - anchor 验证：审计结论必须溯源到原文，编造的 evidence 被 reject 并记 SEMANTIC_ANCHOR_FABRICATED
 * - 不再用 support=warning 等价 DISPUTED（证据不足 ≠ 存在反证）
 *
 * 可观测（轨道 B）：
 * - 每次审计记录 model 快照（pin 版本，防 criterion drift）
 * - 按维度分桶统计（meta-eval 校准用）
 */
export async function semanticCheck(
	config: AppConfig,
	claim: Claim,
	spans: SourceSpan[],
	provider: LLMProvider,
): Promise<LintIssue[]> {
	const evidenceSpans = spans.filter((s) => claim.evidenceSpanIds.includes(s.id));
	const evidenceText = evidenceSpans.map((s) => `[${s.blockId}] ${s.text}`).join("\n\n");

	if (!evidenceText) {
		recordAuditMetric(config, claim.id, "skipped", "no-evidence");
		return [
			{
				code: "SEMANTIC_CITATION_FAILED",
				severity: "error",
				affectedObject: claim.id,
				detail: "无法获取证据原文",
				recommendedState: "QUARANTINE",
			},
		];
	}

	const prompt = `请审计以下 Claim 是否忠实于原文证据。

# Claim
${claim.statement}

# 适用条件（Claim 自报的）
${claim.conditions.length > 0 ? claim.conditions.join("; ") : "无"}

# 原文证据（SourceSpan）
${evidenceText}

按系统指令的 5 维度对照检查，返回严格 JSON。`;

	const result = await provider.chat({
		model: config.model,
		systemPrompt: SEMANTIC_AUDIT_SYSTEM,
		messages: [{ role: "user", content: prompt }],
		responseFormat: "json_object",
		thinkingDisabled: true,
		maxTokens: 4096,
	});

	// 解析审计输出（失败直接 return，不继续）
	let parsed: SemanticVerdict;
	try {
		parsed = parseLLMJson(result.content, SemanticVerdictSchema);
	} catch (e) {
		// LLM 返回不符合 schema（含 JSON 解析失败）
		recordAuditMetric(config, claim.id, "skipped", "schema-reject");
		return [
			{
				code: "SEMANTIC_CITATION_FAILED",
				severity: "error",
				affectedObject: claim.id,
				detail: `审计输出不符合 schema: ${(e as Error).message.slice(0, 200)}`,
				recommendedState: "QUARANTINE",
			},
		];
	}
	const verdict: SemanticVerdict = parsed;

	const issues: LintIssue[] = [];
	const dims = verdict.dimensions;

	// anchor 验证：anchor 和每维 evidence 必须真实存在于某个 SourceSpan
	const allEvidenceText = evidenceSpans.map((s) => s.text).join("\n");
	const anchorValid = isQuoteInText(verdict.anchor, allEvidenceText);
	if (!anchorValid) {
		// anchor 编造——审计结论本身不可信，降级为 QUARANTINE
		recordAuditMetric(config, claim.id, "anchor-fabricated", "anchor");
		issues.push({
			code: "SEMANTIC_ANCHOR_FABRICATED",
			severity: "error",
			affectedObject: claim.id,
			detail: `审计 anchor 不在原文中: "${verdict.anchor.slice(0, 60)}..."`,
			recommendedState: "QUARANTINE",
		});
		return issues;
	}

	// 按维度生成 issueCode（binary verdict）
	const dimToIssueCode: Record<string, IssueCode> = {
		support: "SEMANTIC_SUPPORT_FAILED",
		addition: "SEMANTIC_ADDITION_MAJOR",
		inference: "SEMANTIC_INFERENCE_WRONG",
		limits: "SEMANTIC_LIMITS_MISSING",
		citation: "SEMANTIC_CITATION_FAILED",
	};

	// 硬伤维度（fail → QUARANTINE）：support / addition / citation
	// 软伤维度（fail → CANONICAL 但需修正）：inference / limits
	const hardFailDims = new Set(["support", "addition", "citation"]);

	for (const dimName of ["support", "addition", "inference", "limits", "citation"]) {
		const dim = dims[dimName as keyof typeof dims];
		if (dim.result === "fail") {
			// 验证 evidence 也真实存在
			const evidenceValid = isQuoteInText(dim.evidence, allEvidenceText);
			const issueCode = dimToIssueCode[dimName] ?? "SEMANTIC_WARNING";
			issues.push({
				code: issueCode,
				severity: hardFailDims.has(dimName) ? "error" : "warning",
				affectedObject: claim.id,
				detail: `${dimName}: ${dim.evidence.slice(0, 100)}${evidenceValid ? "" : " (evidence 也不在原文中)"}`,
				recommendedState: hardFailDims.has(dimName) ? "QUARANTINE" : "CANONICAL",
			});
			recordAuditMetric(config, claim.id, "dim-fail", dimName);
		}
	}

	// 如果 verdict=failed 但无硬伤维度 issue（理论上不该发生，防御性兜底）
	if (verdict.verdict === "failed" && !issues.some((i) => i.severity === "error")) {
		issues.push({
			code: "SEMANTIC_SUPPORT_FAILED",
			severity: "error",
			affectedObject: claim.id,
			detail: `verdict=failed 但无硬伤维度: ${(verdict.issues ?? []).join("; ")}`,
			recommendedState: "QUARANTINE",
		});
	}

	if (issues.length === 0 && verdict.verdict === "passed") {
		recordAuditMetric(config, claim.id, "passed", "-");
	}

	return issues;
}

// ─── 可观测：审计指标记录（轨道 B）──────────────────────────────

/**
 * 审计指标——记录每次审计的结果与维度分布。
 * 写入 runs/audit-metrics.jsonl，用于 meta-eval 校准（算 TPR/TNR）。
 *
 * criterion drift 防御：记录 model 快照（pin 版本，不依赖浮动别名）。
 */
export function recordAuditMetric(
	config: AppConfig,
	claimId: string,
	outcome: "passed" | "dim-fail" | "skipped" | "anchor-fabricated",
	dimension: string,
): void {
	const metric = {
		claimId,
		outcome,
		dimension,
		model: config.model,
		auditVersion: SEMANTIC_AUDIT_VERSION,
		timestamp: new Date().toISOString(),
	};
	appendAuditMetric(config, metric);
}

/**
 * 判断 quote 是否真实存在于 text 中。
 *
 * meta-eval 校准发现：精确字符串匹配会导致大量误杀——LLM 返回的 anchor
 * 语义上确实来自原文，但做了符号替换（LaTeX→unicode）或轻微改写。
 *
 * 三层容错（从严到宽）：
 * 1. 精确子串匹配
 * 2. 归一化匹配：统一 LaTeX 命令、unicode 数学符号、空白、标点后再匹配
 * 3. token 重叠率：anchor 拆词后 ≥50% 出现在原文，认为有效（处理轻改写/拼接）
 */
export function isQuoteInText(quote: string, text: string): boolean {
	if (!quote || quote.trim().length === 0) return false;
	const q = quote.trim();

	// 层 1：精确匹配
	if (text.includes(q)) return true;

	// 层 2：归一化匹配
	const normQ = normalizeForMatching(q);
	const normT = normalizeForMatching(text);
	if (normQ.length > 4 && normT.includes(normQ)) return true;

	// 层 3：token 重叠率（防 LLM 改写句序/拼接多句）
	const overlap = tokenOverlap(normQ, normT);
	return overlap >= 0.5;
}

/**
 * 归一化文本用于 anchor/evidence 匹配。
 *
 * 分层规则表（领域无关架构，符号层可扩展）：
 * 1. 结构层（通用）：$/$$ 剥除、标点空白引号归一化——所有领域都需要
 * 2. LaTeX 层（通用+领域扩展）：
 *    - 通用命令（\frac→除法、\text→内容、\mathbf→去命令留内容）——数学/论文/金融共用
 *    - 兜底：未知 \xxx 命令统一去掉（对任何领域安全）
 * 3. 符号层（可扩展）：unicode 数学符号映射（ℚ→Q 等）
 *    - 当前覆盖：数学数集符号（基于实际语料分析）
 *    - 扩展方式：往 LATEX_COMMAND_MAP / UNICODE_MAP 加条目即可
 *
 * 数据依据：readings/ 论文集与 mathtest-material/ 的 LaTeX 命令频率分析。
 * 两领域共用 \frac \mathbb \text \theta；论文特有 \mathcal \mathbf \hat \tilde。
 */
function normalizeForMatching(s: string): string {
	return (
		s
			// ── 1. 结构层（通用）──
			.replace(/\$\$/g, "")
			.replace(/\$/g, "")
			// ── 2. LaTeX 层 ──
			// 带参数的命令（提取内容）
			.replace(/\\mathbb\{\\?(\w+)\}/g, "$1")
			.replace(/\\mathbb\{(\w)\}/g, "$1")
			.replace(/\\mathcal\{(\w+)\}/g, "$1")
			.replace(/\\mathbf\{([^}]*)\}/g, "$1")
			.replace(/\\boldsymbol\{([^}]*)\}/g, "$1")
			.replace(/\\hat\{([^}]*)\}/g, "$1")
			.replace(/\\tilde\{([^}]*)\}/g, "$1")
			.replace(/\\text\{([^}]*)\}/g, "$1")
			.replace(/\\textbf\{([^}]*)\}/g, "$1")
			.replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, "$1/$2")
			.replace(/\\(?:ldots|cdots|dots)/g, "...")
			// 符号命令 → unicode（数学+论文共用）
			.replace(/\\(?:le|leq)/g, "≤")
			.replace(/\\(?:ge|geq)/g, "≥")
			.replace(/\\(?:ne|neq)/g, "≠")
			.replace(/\\(?:to|rightarrow)/g, "→")
			.replace(/\\(?:implies|Rightarrow)/g, "⇒")
			.replace(/\\(?:infty)/g, "∞")
			.replace(/\\(?:cup|cap)/g, "∪")
			.replace(/\\(?:cdot|times)/g, "×")
			// 去量词符号（不携带语义，匹配时去掉）
			.replace(/\\(?:forall|exists|sum|lim|sup|inf|min|max|arg|log|exp)/g, "")
			.replace(/\\(?:cite|ref|label)\{[^}]*\}/g, "") // 论文引用标记
			// 兜底：其余未知 \xxx 命令去掉（对任何领域安全）
			.replace(/\\[a-zA-Z]+/g, "")
			// ── 3. 符号层（unicode 数学符号 → ASCII）──
			.replace(/ℚ/g, "Q")
			.replace(/ℝ/g, "R")
			.replace(/ℕ/g, "N")
			.replace(/ℤ/g, "Z")
			.replace(/ℂ/g, "C")
			.replace(/ℍ/g, "H")
			.replace(/∀/g, "")
			.replace(/∃/g, "")
			// ── 4. 标点空白归一化（通用）──
			.replace(/[""'']/g, "'")
			.replace(/[「『]/g, "")
			.replace(/[」』]/g, "")
			.replace(/[（(]/g, "(")
			.replace(/[）)]/g, ")")
			.replace(/\s+/g, " ")
			.replace(/[，,；;：:。.!！?？]/g, " ")
			.trim()
			.replace(/\s+/g, " ")
	);
}

/**
 * 计算重叠比例——用字符级 2-gram(bigram)。
 * 中文不分词，按空格切 token 无效；bigram 对中英文都有效且不依赖分词器。
 * 返回 query 的 bigram 有多少比例出现在 source 中。
 */
function tokenOverlap(query: string, source: string): number {
	const qGrams = bigrams(query);
	if (qGrams.length === 0) return 0;
	const sGrams = new Set(bigrams(source));
	let hit = 0;
	for (const g of qGrams) {
		if (sGrams.has(g)) hit++;
	}
	return hit / qGrams.length;
}

/** 生成字符级 2-gram（跳过空白） */
function bigrams(s: string): string[] {
	const chars = [...s].filter((c) => !/\s/.test(c));
	const grams: string[] = [];
	for (let i = 0; i < chars.length - 1; i++) {
		const a = chars[i];
		const b = chars[i + 1];
		if (a && b) grams.push(a + b);
	}
	return grams;
}

// ─── 原子 Lint 流程（修断点 1+5+6）────────────────────────────

/**
 * 对一次编译的全部候选（Claim + Relation）做原子 Lint。
 *
 * 流程（修断点 6：原子发布）：
 * 1. 先对所有 Claim 做结构 + 语义 Lint
 * 2. 确定 Canonical Claim 集合
 * 3. 再对 Relation 做结构 Lint（端点必须是 Canonical Claim）
 * 4. 整体结果一次性返回（不分别追加）
 *
 * @param config - 配置
 * @param claims - 待 lint 的 Claim（publicationState=CANDIDATE）
 * @param relations - 待 lint 的 Relation（publicationState=CANDIDATE）
 * @param concepts - Concept（不做语义 Lint，直接通过）
 * @param allSpans - 所有 SourceSpan
 * @param provider - LLM Provider（语义门禁用，null 则跳过语义）
 * @param options - 可选：跳过语义门禁
 */
export async function lintCompileResult(
	config: AppConfig,
	claims: Claim[],
	relations: Relation[],
	_concepts: Concept[],
	allSpans: SourceSpan[],
	provider: LLMProvider | null,
	options?: { skipSemantic?: boolean },
): Promise<CompileLintResult> {
	const allSpanIds = new Set(allSpans.map((s) => s.id));
	const allClaimIds = new Set(claims.map((c) => c.id));

	// ── Phase 1: Claim Lint ──
	const claimResults: ObjectLintResult<Claim>[] = [];

	for (const claim of claims) {
		// 结构性硬门禁
		const structIssues = checkClaimStructure(claim, allSpanIds);

		// 如果结构失败，直接 Quarantine（不跑语义）
		if (structIssues.some((i) => i.severity === "error")) {
			claimResults.push({
				object: { ...claim, publicationState: "QUARANTINED" },
				issues: structIssues,
				finalState: "QUARANTINED",
			});
			continue;
		}

		// 语义门禁（可选跳过）
		let semIssues: LintIssue[] = [];
		if (!options?.skipSemantic && provider) {
			const claimSpans = allSpans.filter((s) => claim.evidenceSpanIds.includes(s.id));
			semIssues = await semanticCheck(config, claim, claimSpans, provider);
		}

		const allIssues = [...structIssues, ...semIssues];

		// 决定最终状态（修断点 7：基于 issueCode 而非文本匹配）
		const hasError = allIssues.some((i) => i.severity === "error");
		const hasConflict = allIssues.some((i) => i.recommendedState === "CANONICAL_DISPUTED");

		if (hasError) {
			claimResults.push({
				// 结构/语义硬失败 → QUARANTINED，validity 保持 UNRESOLVED（不升级）
				object: { ...claim, publicationState: "QUARANTINED" },
				issues: allIssues,
				finalState: "QUARANTINED",
			});
		} else if (hasConflict) {
			claimResults.push({
				object: {
					...claim,
					publicationState: "CANONICAL",
					validity: "DISPUTED" as const,
				},
				issues: allIssues,
				finalState: "CANONICAL_DISPUTED",
			});
		} else {
			claimResults.push({
				// 门禁通过：UNRESOLVED → SUPPORTED（审计已证明忠实于原文）
				object: {
					...claim,
					publicationState: "CANONICAL" as const,
					validity: "SUPPORTED" as const,
				},
				issues: allIssues,
				finalState: "CANONICAL",
			});
		}
	}

	// ── Phase 2: 确定 Canonical Claim 集合 ──
	const canonicalClaimIds = new Set(
		claimResults
			.filter((r) => r.finalState === "CANONICAL" || r.finalState === "CANONICAL_DISPUTED")
			.map((r) => r.object.id),
	);

	// ── Phase 3: Relation Lint（修断点 1）──
	const relationResults: ObjectLintResult<Relation>[] = [];

	for (const relation of relations) {
		const structIssues = checkRelationStructure(relation, canonicalClaimIds, allClaimIds);

		// Relation 结构失败 → Quarantine，validity 保持 UNRESOLVED
		if (structIssues.some((i) => i.severity === "error")) {
			relationResults.push({
				object: { ...relation, publicationState: "QUARANTINED" },
				issues: structIssues,
				finalState: "QUARANTINED",
			});
		} else {
			// Relation 通过 → Canonical + SUPPORTED（跟随端点 Claim，端点已通过门禁）
			relationResults.push({
				object: {
					...relation,
					publicationState: "CANONICAL" as const,
					validity: "SUPPORTED" as const,
				},
				issues: structIssues,
				finalState: "CANONICAL",
			});
		}
	}

	// ── 汇总结果 ──
	const canonicalClaims = claimResults
		.filter((r) => r.finalState === "CANONICAL" || r.finalState === "CANONICAL_DISPUTED")
		.map((r) => r.object);

	const canonicalRelations = relationResults
		.filter((r) => r.finalState === "CANONICAL")
		.map((r) => r.object);

	const quarantinedClaims = claimResults
		.filter((r) => r.finalState === "QUARANTINED")
		.map((r) => ({ claim: r.object, issues: r.issues }));

	const quarantinedRelations = relationResults
		.filter((r) => r.finalState === "QUARANTINED")
		.map((r) => ({ relation: r.object, issues: r.issues }));

	// ── Quarantine manifest（偏离 3 修复：追加而非覆盖，防历史丢失）──
	const allQuarantined = [...quarantinedClaims, ...quarantinedRelations];
	if (allQuarantined.length > 0) {
		const manifestEntries = allQuarantined.map((q) => {
			const objectId = "claim" in q ? q.claim.id : q.relation.id;
			const issues = q.issues;
			return {
				objectId,
				reasons: issues.map((i) => ({ code: i.code, detail: i.detail })),
				timestamp: new Date().toISOString(),
				auditVersion: SEMANTIC_AUDIT_VERSION,
			};
		});
		appendJsonl(join(config.quarantineDir, "quarantine-manifest.jsonl"), manifestEntries);
	}

	return {
		claims: claimResults,
		relations: relationResults,
		concepts: _concepts,
		canonicalClaims,
		canonicalRelations,
		quarantinedClaims,
		quarantinedRelations,
	};
}

// ─── Canonical 消费矩阵（修断点 5）──────────────────────────────

/**
 * Canonical 消费矩阵——定义不同状态组合的消费规则。
 *
 * 修 GPT 审计断点 5：Canonical 不等于"能否支撑推理"。
 * UNRESOLVED 可用于导航但不能独立支撑结论。
 * DISPUTED 必须进入 conflictsAndConditions。
 */
export interface ConsumptionRule {
	/** 是否允许进入检索/展示 */
	allowRetrieval: boolean;
	/** 是否可以独立支撑结论 */
	allowReasoning: boolean;
	/** Context Pack 中的处置 */
	packBehavior: "normal" | "conflictsAndConditions" | "knownGaps" | "excluded";
}

/** 根据四轴状态返回消费规则 */
export function getConsumptionRule(
	publicationState: string,
	lifecycle: string,
	validity: string,
): ConsumptionRule {
	// CANDIDATE / QUARANTINED → 完全排除
	if (publicationState !== "CANONICAL") {
		return {
			allowRetrieval: false,
			allowReasoning: false,
			packBehavior: "excluded",
		};
	}

	// SUPERSEDED → 仅历史查询
	if (lifecycle === "SUPERSEDED") {
		return {
			allowRetrieval: false,
			allowReasoning: false,
			packBehavior: "excluded",
		};
	}

	// CANONICAL + ACTIVE 的三种子情况
	if (validity === "DISPUTED") {
		return {
			allowRetrieval: true,
			allowReasoning: false, // 不能作为无争议单一结论
			packBehavior: "conflictsAndConditions",
		};
	}

	if (validity === "UNRESOLVED") {
		return {
			allowRetrieval: true, // 可用于导航和缺口
			allowReasoning: false, // 禁止独立支撑结论
			packBehavior: "knownGaps",
		};
	}

	// SUPPORTED → 正常使用
	return {
		allowRetrieval: true,
		allowReasoning: true,
		packBehavior: "normal",
	};
}
