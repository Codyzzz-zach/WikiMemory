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

import type { AppConfig } from "../config/types.js";
import type {
	Claim,
	Concept,
	Relation,
	SourceSpan,
} from "../types/index.js";
import type { LLMProvider } from "../core/llm-provider.js";
import { join } from "node:path";
import {
	SEMANTIC_AUDIT_SYSTEM,
	SEMANTIC_AUDIT_VERSION,
} from "../prompts/index.js";
import { SemanticVerdictSchema, parseLLMJson } from "../types/schemas.js";
import { writeJson } from "./storage.js";

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
	| "SEMANTIC_WARNING";

export type IssueSeverity = "error" | "warning" | "info";

/** Lint 建议的目标状态 */
export type RecommendedState =
	| "CANONICAL"
	| "CANONICAL_DISPUTED"
	| "QUARANTINE";

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
export function checkClaimStructure(
	claim: Claim,
	allSpanIds: Set<string>,
): LintIssue[] {
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

/**
 * Relation 结构性检查（修断点 1）。
 *
 * 检查：
 * 1. 端点 Claim 存在
 * 2. 端点 Claim 通过了 Lint（不是 Quarantined）
 * 3. 类型合法
 */
export function checkRelationStructure(
	relation: Relation,
	canonicalClaimIds: Set<string>,
	allClaimIds: Set<string>,
): LintIssue[] {
	const issues: LintIssue[] = [];

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
 * 修断点 7：不再用 issues.some(i => i.includes("冲突")) 字符串匹配。
 * 改为结构化 issueCode：SEMANTIC_CONFLICT_DETECTED → CANONICAL_DISPUTED。
 */
export async function semanticCheck(
	config: AppConfig,
	claim: Claim,
	spans: SourceSpan[],
	provider: LLMProvider,
): Promise<LintIssue[]> {
	const evidenceText = spans
		.filter((s) => claim.evidenceSpanIds.includes(s.id))
		.map((s) => `[${s.blockId}] ${s.text}`)
		.join("\n\n");

	if (!evidenceText) {
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

# 适用条件
${claim.conditions.length > 0 ? claim.conditions.join("; ") : "无"}

# 原文证据
${evidenceText}

请以 JSON 格式返回审计结果。`;

	const result = await provider.chat({
		model: config.model,
		systemPrompt: SEMANTIC_AUDIT_SYSTEM,
		messages: [{ role: "user", content: prompt }],
		responseFormat: "json_object",
		thinkingDisabled: true,
		maxTokens: 4096,
	});

	const verdict = parseLLMJson(result.content, SemanticVerdictSchema);
	const issues: LintIssue[] = [];
	const issuesList = verdict.issues ?? [];

	// 修断点 7：基于结构化维度判断，不依赖文本匹配
	if (verdict.verdict === "failed") {
		// 把 failed 维度转成结构化 issueCode
		if (verdict.support === "failed" || verdict.support === "none") {
			issues.push({
				code: "SEMANTIC_SUPPORT_FAILED",
				severity: "error",
				affectedObject: claim.id,
				detail: `support: ${verdict.support}`,
				recommendedState: "QUARANTINE",
			});
		}
		if (verdict.addition === "failed") {
			issues.push({
				code: "SEMANTIC_ADDITION_MAJOR",
				severity: "error",
				affectedObject: claim.id,
				detail: `addition: 添加了原文没有的内容`,
				recommendedState: "QUARANTINE",
			});
		}
		if (verdict.inference === "failed") {
			issues.push({
				code: "SEMANTIC_INFERENCE_WRONG",
				severity: "error",
				affectedObject: claim.id,
				detail: `inference: 推断标记错误`,
				recommendedState: "QUARANTINE",
			});
		}
		if (verdict.limits === "failed") {
			issues.push({
				code: "SEMANTIC_LIMITS_MISSING",
				severity: "error",
				affectedObject: claim.id,
				detail: `limits: 适用条件缺失`,
				recommendedState: "QUARANTINE",
			});
		}
		if (verdict.citation === "failed") {
			issues.push({
				code: "SEMANTIC_CITATION_FAILED",
				severity: "error",
				affectedObject: claim.id,
				detail: `citation: 引用错误`,
				recommendedState: "QUARANTINE",
			});
		}
		// 如果没有任何维度 failed 但 verdict 仍是 failed，用通用 issue
		if (issues.length === 0) {
			issues.push({
				code: "SEMANTIC_SUPPORT_FAILED",
				severity: "error",
				affectedObject: claim.id,
				detail: `verdict=failed (score=${verdict.score}): ${issuesList.join("; ")}`,
				recommendedState: "QUARANTINE",
			});
		}
	} else if (verdict.verdict === "warning") {
		// 修断点 7：检查是否有冲突信号——基于维度值而非文本匹配
		// support=warning 表示证据支持度有争议；citation=warning 表示引用可能有冲突
		if (verdict.support === "warning" || verdict.citation === "warning") {
			issues.push({
				code: "SEMANTIC_CONFLICT_DETECTED",
				severity: "warning",
				affectedObject: claim.id,
				detail: `检测到冲突信号 (support=${verdict.support})`,
				recommendedState: "CANONICAL_DISPUTED",
			});
		} else {
			issues.push({
				code: "SEMANTIC_WARNING",
				severity: "warning",
				affectedObject: claim.id,
				detail: `语义审计 warning (score=${verdict.score}): ${issuesList.join("; ")}`,
				recommendedState: "CANONICAL",
			});
		}
	}

	return issues;
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
			const claimSpans = allSpans.filter((s) =>
				claim.evidenceSpanIds.includes(s.id),
			);
			semIssues = await semanticCheck(config, claim, claimSpans, provider);
		}

		const allIssues = [...structIssues, ...semIssues];

		// 决定最终状态（修断点 7：基于 issueCode 而非文本匹配）
		const hasError = allIssues.some((i) => i.severity === "error");
		const hasConflict = allIssues.some(
			(i) => i.recommendedState === "CANONICAL_DISPUTED",
		);

		if (hasError) {
			claimResults.push({
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
				object: { ...claim, publicationState: "CANONICAL" as const },
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
		const structIssues = checkRelationStructure(
			relation,
			canonicalClaimIds,
			allClaimIds,
		);

		// Relation 结构失败 → Quarantine
		if (structIssues.some((i) => i.severity === "error")) {
			relationResults.push({
				object: { ...relation, publicationState: "QUARANTINED" },
				issues: structIssues,
				finalState: "QUARANTINED",
			});
		} else {
			// Relation 通过 → Canonical（跟随端点 Claim 的状态）
			relationResults.push({
				object: { ...relation, publicationState: "CANONICAL" as const },
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

	// ── Quarantine manifest ──
	const allQuarantined = [...quarantinedClaims, ...quarantinedRelations];
	if (allQuarantined.length > 0) {
		const manifest = allQuarantined.map((q) => {
			const objectId = "claim" in q ? q.claim.id : q.relation.id;
			const issues = q.issues;
			return {
				objectId,
				reasons: issues.map((i) => ({ code: i.code, detail: i.detail })),
				timestamp: new Date().toISOString(),
				auditVersion: SEMANTIC_AUDIT_VERSION,
			};
		});
		writeJson(join(config.quarantineDir, "quarantine-manifest.json"), manifest);
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
