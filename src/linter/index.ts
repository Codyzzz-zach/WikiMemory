/**
 * Write-time Linter — 消费前门禁
 *
 * 决策 2A：Lint 通过自动 Canonical，不等人类确认。
 * 失败进 Quarantine（物理隔离）。
 * 冲突内容可 Canonical + validity=DISPUTED（不要求人类选边）。
 *
 * 两层门禁：
 * 1. 确定性硬门禁（无 LLM）：schema 校验 + 引用存在 + 证据非空 + 结构完整
 * 2. 语义门禁（1 次 LLM/claim）：判断 claim 忠实度（5 维度）
 *
 * Product Definition 哲学 09：语义 CI 必须发生在消费前。
 */

import type { AppConfig } from "../config/types.js";
import type { Claim, SourceSpan } from "../types/index.js";
import type { LLMProvider } from "../core/llm-provider.js";
import { join } from "node:path";
import {
	SEMANTIC_AUDIT_SYSTEM,
	SEMANTIC_AUDIT_VERSION,
} from "../prompts/index.js";
import { SemanticVerdictSchema, parseLLMJson } from "../types/schemas.js";
import { writeJson } from "./storage.js";

/** Lint 结果 */
export interface LintResult {
	/** 通过的 Claim（publicationState 改为 CANONICAL） */
	canonical: Claim[];
	/** 失败的 Claim（publicationState 改为 QUARANTINED） */
	quarantined: Array<{ claim: Claim; reason: string }>;
}

/** 确定性硬门禁结果 */
export interface StructuralCheckResult {
	ok: boolean;
	reason: string;
}

/**
 * 确定性硬门禁（无 LLM）。
 * 检查 schema、引用存在、证据非空、结构完整。
 */
export function structuralCheck(
	claim: Claim,
	allSpanIds: Set<string>,
): StructuralCheckResult {
	// 1. statement 非空
	if (!claim.statement || claim.statement.trim().length === 0) {
		return { ok: false, reason: "statement 为空" };
	}

	// 2. 至少一个 evidenceSpanId
	if (claim.evidenceSpanIds.length === 0) {
		return { ok: false, reason: "无证据（evidenceSpanIds 为空）" };
	}

	// 3. 所有 evidenceSpanId 都存在
	for (const spanId of claim.evidenceSpanIds) {
		if (!allSpanIds.has(spanId)) {
			return { ok: false, reason: `引用了不存在的 spanId: ${spanId}` };
		}
	}

	// 4. publicationState 合法
	if (!["CANDIDATE", "CANONICAL", "QUARANTINED"].includes(claim.publicationState)) {
		return { ok: false, reason: `publicationState 非法: ${claim.publicationState}` };
	}

	return { ok: true, reason: "" };
}

/**
 * 语义门禁（1 次 LLM/claim）。
 * 判断 claim 是否忠实于原文证据。
 */
export async function semanticCheck(
	config: AppConfig,
	claim: Claim,
	spans: SourceSpan[],
	provider: LLMProvider,
): Promise<{ verdict: "passed" | "warning" | "failed"; score: number; issues: string[] }> {
	// 取 claim 的证据原文
	const evidenceText = spans
		.filter((s) => claim.evidenceSpanIds.includes(s.id))
		.map((s) => `[${s.blockId}] ${s.text}`)
		.join("\n\n");

	if (!evidenceText) {
		return { verdict: "failed", score: 0, issues: ["无法获取证据原文"] };
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
	return {
		verdict: verdict.verdict,
		score: verdict.score,
		issues: verdict.issues ?? [],
	};
}

/**
 * 完整的写入时 Lint 流程。
 *
 * @param config - 配置
 * @param claims - 待 lint 的 Claim（publicationState=CANDIDATE）
 * @param allSpans - 所有 SourceSpan（用于引用校验）
 * @param provider - LLM Provider（语义门禁用）
 * @param options - 可选：跳过语义门禁（纯结构 lint）
 * @returns Canonical Claim 列表 + Quarantine 列表
 */
export async function lintClaims(
	config: AppConfig,
	claims: Claim[],
	allSpans: SourceSpan[],
	provider: LLMProvider | null,
	options?: { skipSemantic?: boolean },
): Promise<LintResult> {
	const allSpanIds = new Set(allSpans.map((s) => s.id));
	const canonical: Claim[] = [];
	const quarantined: Array<{ claim: Claim; reason: string }> = [];

	for (const claim of claims) {
		// ── 第一步：确定性硬门禁 ──
		const structResult = structuralCheck(claim, allSpanIds);
		if (!structResult.ok) {
			const failedClaim = { ...claim, publicationState: "QUARANTINED" as const };
			quarantined.push({ claim: failedClaim, reason: structResult.reason });
			continue;
		}

		// ── 第二步：语义门禁（可选跳过）──
		if (!options?.skipSemantic && provider) {
			const claimSpans = allSpans.filter((s) =>
				claim.evidenceSpanIds.includes(s.id),
			);
			const semResult = await semanticCheck(config, claim, claimSpans, provider);

			if (semResult.verdict === "failed") {
				const failedClaim = { ...claim, publicationState: "QUARANTINED" as const };
				quarantined.push({
					claim: failedClaim,
					reason: `语义审计 failed (score=${semResult.score}): ${semResult.issues.join("; ")}`,
				});
				continue;
			}

			// warning 也进 Canonical，但标记 validity（如果有冲突信号）
			if (semResult.verdict === "warning" && semResult.issues.some((i) => i.includes("冲突"))) {
				const warnedClaim = {
					...claim,
					publicationState: "CANONICAL" as const,
					validity: "DISPUTED" as const,
				};
				canonical.push(warnedClaim);
				continue;
			}
		}

		// ── 通过门禁 → 自动 Canonical（决策 2A）──
		canonical.push({ ...claim, publicationState: "CANONICAL" as const });
	}

	// ── Quarantine 内容写入隔离区 ──
	if (quarantined.length > 0) {
		const manifest = quarantined.map((q) => ({
			claimId: q.claim.id,
			reason: q.reason,
			timestamp: new Date().toISOString(),
			auditVersion: SEMANTIC_AUDIT_VERSION,
		}));
		writeJson(join(config.quarantineDir, "quarantine-manifest.json"), manifest);
	}

	return { canonical, quarantined };
}
