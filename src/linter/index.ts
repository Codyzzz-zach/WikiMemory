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

import { createHash } from "node:crypto";
import { join } from "node:path";
import type { CompileRunHandle } from "../compiler/run-state.js";
import { observedChat, recordParseResult } from "../compiler/telemetry.js";
import type { AppConfig } from "../config/types.js";
import type { LLMProvider } from "../core/llm-provider.js";
import type { ChatOptions } from "../core/types.js";
import {
	RELATION_AUDIT_SYSTEM,
	RELATION_AUDIT_VERSION,
	SEMANTIC_AUDIT_SYSTEM,
	SEMANTIC_AUDIT_VERSION,
} from "../prompts/index.js";
import type {
	AssertedRecord,
	Claim,
	Concept,
	Relation,
	Scope,
	SourceSpan,
} from "../types/index.js";
import {
	RelationSemanticVerdictSchema,
	SemanticVerdictSchema,
	parseLLMJson,
} from "../types/schemas.js";
import type {
	AuditDimensionName,
	RelationAuditDimensionName,
	RelationSemanticVerdict,
	SemanticVerdict,
} from "../types/schemas.js";
import {
	appendAuditMetric,
	appendJsonl,
	findSpansByIds,
	readAllAssertedRecords,
	readJson,
	resolveSpanById,
	writeJsonAtomic,
} from "./storage.js";

// ─── 结构化 Lint Issue（修断点 7）──────────────────────────────

/** Lint issue 的稳定编码——不依赖文本匹配 */
export type IssueCode =
	| "MISSING_EVIDENCE"
	| "MISSING_PROVENANCE"
	| "INVALID_SUPPORTING_EVIDENCE"
	| "INVALID_ASSERTED_RECORD"
	| "INVALID_SCOPE"
	| "BROKEN_REFERENCE"
	| "EMPTY_STATEMENT"
	| "INVALID_PUBLICATION_STATE"
	| "BROKEN_RELATION_ENDPOINT"
	| "INVALID_RELATION_TYPE"
	| "RELATION_ENDPOINT_QUARANTINED"
	| "RELATION_CONDITION_REQUIRED"
	| "RELATION_EQUIVALENCE_REVIEW_REQUIRED"
	| "HUMAN_REVIEW_REJECTED"
	| "RELATION_SEMANTIC_FAILED"
	| "RELATION_IDENTITY_MISMATCH"
	| "RELATION_TYPE_MISMATCH"
	| "RELATION_DIRECTION_MISMATCH"
	| "RELATION_CONDITIONS_MISSING"
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

const SEMANTIC_AUDIT_CONCURRENCY = 4;

// ─── 确定性硬门禁 ────────────────────────────────────────────────

/** Claim 结构性检查 */
export function checkClaimStructure(
	claim: Claim,
	allSpans: SourceSpan[],
	assertedRecords: AssertedRecord[] = [],
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

	if (claim.provenanceRefs.length === 0) {
		issues.push({
			code: "MISSING_PROVENANCE",
			severity: "error",
			affectedObject: claim.id,
			detail: "无来源血缘（provenanceRefs 为空）",
			recommendedState: "QUARANTINE",
		});
	}

	if (claim.supportingEvidenceRefs.length === 0) {
		issues.push({
			code: "INVALID_SUPPORTING_EVIDENCE",
			severity: "error",
			affectedObject: claim.id,
			detail: "无成立依据（supportingEvidenceRefs 为空）",
			recommendedState: "QUARANTINE",
		});
	}

	if (claim.scope.type !== "GLOBAL" && !claim.scope.id) {
		issues.push({
			code: "INVALID_SCOPE",
			severity: "error",
			affectedObject: claim.id,
			detail: `${claim.scope.type} Claim 缺少 scope.id`,
			recommendedState: "QUARANTINE",
		});
	}
	if (claim.scope.type === "GLOBAL" && claim.scope.id) {
		issues.push({
			code: "INVALID_SCOPE",
			severity: "error",
			affectedObject: claim.id,
			detail: "GLOBAL Claim 不应携带 scope.id",
			recommendedState: "QUARANTINE",
		});
	}

	const sourceSupportIds = new Set(
		claim.supportingEvidenceRefs
			.filter((ref) => ref.type === "SourceSpan")
			.map((ref) => ref.spanId),
	);
	for (const spanId of claim.evidenceSpanIds) {
		if (!sourceSupportIds.has(spanId)) {
			issues.push({
				code: "INVALID_SUPPORTING_EVIDENCE",
				severity: "error",
				affectedObject: claim.id,
				detail: `evidenceSpanIds 中的 ${spanId} 未在 supportingEvidenceRefs 中声明`,
				recommendedState: "QUARANTINE",
			});
		}
	}
	for (const spanId of sourceSupportIds) {
		if (!claim.evidenceSpanIds.includes(spanId)) {
			issues.push({
				code: "INVALID_SUPPORTING_EVIDENCE",
				severity: "error",
				affectedObject: claim.id,
				detail: `supportingEvidenceRefs 中的 SourceSpan ${spanId} 未同步到 evidenceSpanIds`,
				recommendedState: "QUARANTINE",
			});
		}
	}

	const hasMaterialSupport = claim.supportingEvidenceRefs.some(
		(ref) => ref.type === "SourceSpan" || ref.type === "ExperimentRecord",
	);
	const hasAssertedSupport = claim.supportingEvidenceRefs.some(
		(ref) => ref.type === "AssertedRecord",
	);
	if (claim.claimKind === "FACT" && (!hasMaterialSupport || hasAssertedSupport)) {
		issues.push({
			code: "INVALID_SUPPORTING_EVIDENCE",
			severity: "error",
			affectedObject: claim.id,
			detail:
				"FACT 的 supportingEvidenceRefs 只能使用 SourceSpan/ExperimentRecord；AssertedRecord 只能记录在 provenanceRefs",
			recommendedState: "QUARANTINE",
		});
	}
	if ((claim.claimKind === "DECISION" || claim.claimKind === "PREFERENCE") && !hasAssertedSupport) {
		issues.push({
			code: "INVALID_SUPPORTING_EVIDENCE",
			severity: "error",
			affectedObject: claim.id,
			detail: `${claim.claimKind} 需要经过权限/主体校验的 AssertedRecord 作为成立依据`,
			recommendedState: "QUARANTINE",
		});
	}
	if (claim.claimKind === "DECISION" && claim.scope.type !== "PROJECT") {
		issues.push(invalidAssertedRecordIssue(claim, "DECISION 必须绑定 PROJECT scope"));
	}
	if (claim.claimKind === "PREFERENCE" && claim.scope.type !== "PERSONAL") {
		issues.push(invalidAssertedRecordIssue(claim, "PREFERENCE 必须绑定 PERSONAL scope"));
	}

	const recordsById = new Map(assertedRecords.map((record) => [record.assertionId, record]));
	const provenanceAssertionIds = new Set(
		claim.provenanceRefs
			.filter((ref) => ref.type === "AssertedRecord")
			.map((ref) => ref.assertionId),
	);
	for (const ref of [...claim.provenanceRefs, ...claim.supportingEvidenceRefs]) {
		if (ref.type !== "AssertedRecord") continue;
		const record = recordsById.get(ref.assertionId);
		if (!record) {
			issues.push(invalidAssertedRecordIssue(claim, `找不到 AssertedRecord: ${ref.assertionId}`));
			continue;
		}
		issues.push(...validateAssertedRecord(claim, record));
	}
	for (const ref of claim.supportingEvidenceRefs) {
		if (ref.type === "AssertedRecord" && !provenanceAssertionIds.has(ref.assertionId)) {
			issues.push(
				invalidAssertedRecordIssue(
					claim,
					`作为 support 的 AssertedRecord ${ref.assertionId} 也必须出现在 provenanceRefs`,
				),
			);
		}
	}

	for (const spanId of claim.evidenceSpanIds) {
		if (!resolveSpanById(allSpans, spanId)) {
			issues.push({
				code: "BROKEN_REFERENCE",
				severity: "error",
				affectedObject: claim.id,
				detail: `引用了不存在的 spanId: ${spanId}`,
				recommendedState: "QUARANTINE",
			});
		}
	}
	for (const ref of [...claim.provenanceRefs, ...claim.supportingEvidenceRefs]) {
		if (ref.type === "SourceSpan" && !resolveSpanById(allSpans, ref.spanId)) {
			issues.push({
				code: "BROKEN_REFERENCE",
				severity: "error",
				affectedObject: claim.id,
				detail: `KnowledgeRef 引用了不存在的 spanId: ${ref.spanId}`,
				recommendedState: "QUARANTINE",
			});
		}
	}

	return issues;
}

function invalidAssertedRecordIssue(claim: Claim, detail: string): LintIssue {
	return {
		code: "INVALID_ASSERTED_RECORD",
		severity: "error",
		affectedObject: claim.id,
		detail,
		recommendedState: "QUARANTINE",
	};
}

function validateAssertedRecord(claim: Claim, record: AssertedRecord): LintIssue[] {
	const problems: string[] = [];
	if (record.claimId !== claim.id) problems.push(`claimId=${record.claimId} 与 ${claim.id} 不一致`);
	if (!sameScope(record.scope, claim.scope)) problems.push("scope 与 Claim 不一致");
	if (!record.assertedBy.trim()) problems.push("assertedBy 为空");
	if (!record.assertionText.trim()) problems.push("assertionText 为空");
	if (!record.authorityBasis.trim()) problems.push("authorityBasis 为空");
	if (Number.isNaN(Date.parse(record.assertedAt))) problems.push("assertedAt 不是合法时间");
	if (
		claim.claimKind === "PREFERENCE" &&
		claim.scope.type === "PERSONAL" &&
		record.assertedBy !== claim.scope.id
	) {
		problems.push("PREFERENCE 的 assertedBy 必须是 PERSONAL scope 主体");
	}
	return problems.map((problem) =>
		invalidAssertedRecordIssue(claim, `AssertedRecord ${record.assertionId}: ${problem}`),
	);
}

function sameScope(left: Scope, right: Scope): boolean {
	return left.type === right.type && left.id === right.id;
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
	allSpans: SourceSpan[] = [],
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

	if (relation.type === "EQUIVALENT_UNDER" && relation.conditions.length === 0) {
		issues.push({
			code: "RELATION_CONDITION_REQUIRED",
			severity: "error",
			affectedObject: relation.id,
			detail: "EQUIVALENT_UNDER 必须声明等价成立的明确条件；无条件重复 Claim 应在去重阶段合并",
			recommendedState: "QUARANTINE",
		});
	}
	if (relation.type === "EQUIVALENT_UNDER") {
		issues.push({
			code: "RELATION_EQUIVALENCE_REVIEW_REQUIRED",
			severity: "error",
			affectedObject: relation.id,
			detail:
				"EQUIVALENT_UNDER 自动审计在真实抽检中 4/4 误判；独立人工复核或校准门禁完成前禁止自动晋级",
			recommendedState: "QUARANTINE",
		});
	}

	if (relation.evidenceSpanIds.length === 0) {
		issues.push({
			code: "MISSING_EVIDENCE",
			severity: "error",
			affectedObject: relation.id,
			detail: "Relation 没有边级证据候选",
			recommendedState: "QUARANTINE",
		});
	}
	for (const spanId of relation.evidenceSpanIds) {
		if (allSpans.length > 0 && !resolveSpanById(allSpans, spanId)) {
			issues.push({
				code: "BROKEN_REFERENCE",
				severity: "error",
				affectedObject: relation.id,
				detail: `Relation 引用了不存在的 spanId: ${spanId}`,
				recommendedState: "QUARANTINE",
			});
		}
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
	run?: CompileRunHandle,
): Promise<LintIssue[]> {
	const evidenceSpans = spans.filter((s) => claim.evidenceSpanIds.includes(s.id));
	const evidenceText = evidenceSpans
		.map((span, index) => `[证据 ${index}][block=${span.blockId}][span=${span.id}]\n${span.text}`)
		.join("\n\n");

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

按系统指令的 5 维度对照检查。只能用上面的证据编号返回严格 JSON。`;

	const baseChatOptions: ChatOptions = {
		model: config.model,
		temperature: config.temperature,
		systemPrompt: SEMANTIC_AUDIT_SYSTEM,
		messages: [{ role: "user", content: prompt }],
		responseFormat: "json_object" as const,
		thinkingDisabled: true,
		maxTokens: 4096,
	};
	let parsed: SemanticVerdict | null = null;
	let lastAuditError: unknown = null;
	const cachePath = semanticAuditCachePath(config, claim, prompt);
	const cached = readJson<{
		auditVersion: string;
		model: string;
		temperature?: number;
		verdict: unknown;
	}>(cachePath);
	if (
		cached?.auditVersion === SEMANTIC_AUDIT_VERSION &&
		cached.model === config.model &&
		cached.temperature === config.temperature
	) {
		const cacheResult = SemanticVerdictSchema.safeParse(cached.verdict);
		if (cacheResult.success) {
			try {
				validateSemanticVerdict(cacheResult.data, evidenceSpans.length);
				parsed = cacheResult.data;
				if (run) {
					appendJsonl(join(config.runsDir, "llm-calls.jsonl"), [
						{
							eventType: "LLM_AUDIT_CACHE_HIT",
							runId: run.runId,
							sourceId: run.sourceId,
							stage: "LINT",
							batchId: `audit-${claim.id}`,
							cacheRef: cachePath.slice(config.projectRoot.length + 1),
							timestamp: new Date().toISOString(),
						},
					]);
				}
			} catch {
				// Generated cache is only an optimization. Invalid entries are ignored and replaced.
			}
		}
	}

	for (let attempt = 1; !parsed && attempt <= 2; attempt++) {
		const chatOptions: ChatOptions = {
			...baseChatOptions,
			messages: [
				{
					role: "user",
					content:
						attempt === 1
							? prompt
							: `${prompt}\n\n机器协议重试：不要复述原文、不要输出自由文本，只输出枚举、证据整数下标和固定 JSON 键。`,
				},
			],
		};
		const telemetryContext = run
			? {
					runId: run.runId,
					sourceId: run.sourceId,
					stage: "LINT" as const,
					batchId: `audit-${claim.id}`,
					attempt,
				}
			: null;
		const observed = telemetryContext
			? await observedChat(config, provider, chatOptions, telemetryContext)
			: null;
		const result = observed ? observed.result : await provider.chat(chatOptions);
		try {
			if (result.finishReason === "length") {
				throw new Error("语义审计输出被 maxTokens 截断");
			}
			const candidate = parseLLMJson(result.content, SemanticVerdictSchema);
			validateSemanticVerdict(candidate, evidenceSpans.length);
			parsed = candidate;
			if (observed && telemetryContext) {
				recordParseResult(config, telemetryContext, observed.callId, "VALID");
			}
			writeJsonAtomic(cachePath, {
				auditVersion: SEMANTIC_AUDIT_VERSION,
				model: config.model,
				temperature: config.temperature,
				verdict: parsed,
			});
			break;
		} catch (error) {
			lastAuditError = error;
			if (observed && telemetryContext) {
				recordParseResult(config, telemetryContext, observed.callId, "INVALID", error);
			}
		}
	}
	if (!parsed) {
		recordAuditMetric(config, claim.id, "skipped", "schema-reject");
		throw new Error(
			`语义审计连续两次无法产生可信结构化结果: ${
				lastAuditError instanceof Error ? lastAuditError.message : String(lastAuditError)
			}`,
		);
	}
	const verdict: SemanticVerdict = parsed;

	const issues: LintIssue[] = [];
	const dims = verdict.dimensions;

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
			const issueCode = dimToIssueCode[dimName] ?? "SEMANTIC_WARNING";
			issues.push({
				code: issueCode,
				severity: hardFailDims.has(dimName) ? "error" : "warning",
				affectedObject: claim.id,
				detail: `${dimensionFailureDetail(dimName as AuditDimensionName)}；证据 ${formatEvidenceReferences(dim.evidenceSpanIndexes.length > 0 ? dim.evidenceSpanIndexes : [verdict.anchorSpanIndex], evidenceSpans)}`,
				recommendedState: hardFailDims.has(dimName) ? "QUARANTINE" : "CANONICAL",
			});
			recordAuditMetric(config, claim.id, "dim-fail", dimName);
		}
	}

	if (issues.length === 0 && verdict.verdict === "passed") {
		recordAuditMetric(config, claim.id, "passed", "-");
	}

	return issues;
}

export interface RelationSemanticCheckResult {
	issues: LintIssue[];
	evidenceSpanIds: string[];
	conditionStatus: Relation["conditionStatus"];
	relationAuditVersion: string | null;
}

/**
 * 审计“边”而不是重复审计两个端点。端点各自为真并不能推出 Relation 成立。
 * 通过时只保留审计器明确选中的边级证据；任何维度失败都隔离该边。
 */
export async function relationSemanticCheck(
	config: AppConfig,
	relation: Relation,
	fromClaim: Claim,
	toClaim: Claim,
	spans: SourceSpan[],
	provider: LLMProvider,
	run?: CompileRunHandle,
): Promise<RelationSemanticCheckResult> {
	const evidenceSpans = findSpansByIds(spans, relation.evidenceSpanIds);
	if (evidenceSpans.length === 0) {
		return {
			issues: [
				{
					code: "MISSING_EVIDENCE",
					severity: "error",
					affectedObject: relation.id,
					detail: "无法获取 Relation 的候选证据原文",
					recommendedState: "QUARANTINE",
				},
			],
			evidenceSpanIds: [],
			conditionStatus: "UNVERIFIED",
			relationAuditVersion: null,
		};
	}

	const fromEvidenceIds = new Set(fromClaim.evidenceSpanIds);
	const toEvidenceIds = new Set(toClaim.evidenceSpanIds);
	const evidenceText = evidenceSpans
		.map((span, index) => {
			const roles = [
				...(fromEvidenceIds.has(span.id) ? ["FROM"] : []),
				...(toEvidenceIds.has(span.id) ? ["TO"] : []),
			];
			return `[证据 ${index}][roles=${roles.join(",") || "RELATION"}][source=${span.sourceId}][block=${span.blockId}][span=${span.id}]\n${span.text}`;
		})
		.join("\n\n");
	const prompt = `请审计以下候选 Relation。

# From Claim
${fromClaim.statement}
条件：${fromClaim.conditions.join("; ") || "无"}

# Relation
${relation.type}
条件：${relation.conditions.join("; ") || "无"}

# To Claim
${toClaim.statement}
条件：${toClaim.conditions.join("; ") || "无"}

# 候选原文证据
${evidenceText}

只能使用以上证据编号，按系统指令返回严格 JSON。`;

	const baseChatOptions: ChatOptions = {
		model: config.model,
		temperature: config.temperature,
		systemPrompt: RELATION_AUDIT_SYSTEM,
		messages: [{ role: "user", content: prompt }],
		responseFormat: "json_object",
		thinkingDisabled: true,
		maxTokens: 4096,
	};
	const cachePath = relationAuditCachePath(config, relation, prompt);
	const cached = readJson<{
		auditVersion: string;
		model: string;
		temperature?: number;
		verdict: unknown;
	}>(cachePath);
	let verdict: RelationSemanticVerdict | null = null;
	if (
		cached?.auditVersion === RELATION_AUDIT_VERSION &&
		cached.model === config.model &&
		cached.temperature === config.temperature
	) {
		const parsedCache = RelationSemanticVerdictSchema.safeParse(cached.verdict);
		if (parsedCache.success) {
			try {
				validateRelationSemanticVerdict(parsedCache.data, evidenceSpans.length);
				verdict = parsedCache.data;
			} catch {
				// Invalid generated cache is ignored and replaced.
			}
		}
	}

	let lastError: unknown = null;
	for (let attempt = 1; !verdict && attempt <= 2; attempt++) {
		const chatOptions: ChatOptions = {
			...baseChatOptions,
			messages: [
				{
					role: "user",
					content:
						attempt === 1
							? prompt
							: `${prompt}\n\n机器协议重试：只输出固定 JSON 键、枚举值和证据整数下标。`,
				},
			],
		};
		const telemetryContext = run
			? {
					runId: run.runId,
					sourceId: run.sourceId,
					stage: "LINT" as const,
					batchId: `relation-audit-${relation.id}`,
					attempt,
				}
			: null;
		const observed = telemetryContext
			? await observedChat(config, provider, chatOptions, telemetryContext)
			: null;
		const result = observed ? observed.result : await provider.chat(chatOptions);
		try {
			if (result.finishReason === "length") throw new Error("Relation 审计输出被截断");
			const candidate = parseLLMJson(result.content, RelationSemanticVerdictSchema);
			validateRelationSemanticVerdict(candidate, evidenceSpans.length);
			verdict = candidate;
			if (observed && telemetryContext) {
				recordParseResult(config, telemetryContext, observed.callId, "VALID");
			}
			writeJsonAtomic(cachePath, {
				auditVersion: RELATION_AUDIT_VERSION,
				model: config.model,
				temperature: config.temperature,
				verdict,
			});
		} catch (error) {
			lastError = error;
			if (observed && telemetryContext) {
				recordParseResult(config, telemetryContext, observed.callId, "INVALID", error);
			}
		}
	}
	if (!verdict) {
		throw new Error(
			`Relation 语义审计连续两次无法产生可信结果: ${
				lastError instanceof Error ? lastError.message : String(lastError)
			}`,
		);
	}

	const issueCodes: Record<RelationAuditDimensionName, IssueCode> = {
		identity: "RELATION_IDENTITY_MISMATCH",
		relation: "RELATION_SEMANTIC_FAILED",
		type: "RELATION_TYPE_MISMATCH",
		direction: "RELATION_DIRECTION_MISMATCH",
		conditions: "RELATION_CONDITIONS_MISSING",
	};
	const issues: LintIssue[] = [];
	for (const dimension of RELATION_AUDIT_DIMENSIONS) {
		if (verdict.dimensions[dimension].result === "fail") {
			issues.push({
				code: issueCodes[dimension],
				severity: "error",
				affectedObject: relation.id,
				detail: `${dimension}：Relation 未通过边级语义审计；证据 ${formatEvidenceReferences(
					verdict.dimensions[dimension].evidenceSpanIndexes.length > 0
						? verdict.dimensions[dimension].evidenceSpanIndexes
						: [verdict.anchorSpanIndex],
					evidenceSpans,
				)}`,
				recommendedState: "QUARANTINE",
			});
		}
	}
	const selectedEvidenceIds = verdict.supportingEvidenceSpanIndexes.map(
		(index) => (evidenceSpans[index] as SourceSpan).id,
	);
	if (
		verdict.verdict === "passed" &&
		(!selectedEvidenceIds.some((spanId) => fromEvidenceIds.has(spanId)) ||
			!selectedEvidenceIds.some((spanId) => toEvidenceIds.has(spanId)))
	) {
		issues.push({
			code: "RELATION_SEMANTIC_FAILED",
			severity: "error",
			affectedObject: relation.id,
			detail:
				"Relation 审计虽返回 passed，但边级支持证据未同时覆盖 FROM 与 TO 端点；拒绝用单侧证据和模型外部知识补全关系",
			recommendedState: "QUARANTINE",
		});
	}
	return {
		issues,
		evidenceSpanIds: selectedEvidenceIds,
		conditionStatus: relation.conditions.length > 0 ? "PRESERVED" : "EXPLICIT_NONE",
		relationAuditVersion: RELATION_AUDIT_VERSION,
	};
}

const RELATION_AUDIT_DIMENSIONS: RelationAuditDimensionName[] = [
	"identity",
	"relation",
	"type",
	"direction",
	"conditions",
];

function validateRelationSemanticVerdict(
	verdict: RelationSemanticVerdict,
	evidenceCount: number,
): void {
	const indexes = [
		verdict.anchorSpanIndex,
		...verdict.supportingEvidenceSpanIndexes,
		...RELATION_AUDIT_DIMENSIONS.flatMap(
			(dimension) => verdict.dimensions[dimension].evidenceSpanIndexes,
		),
	];
	const invalid = indexes.find(
		(index) => !Number.isInteger(index) || index < 0 || index >= evidenceCount,
	);
	if (invalid !== undefined) throw new Error(`Relation 审计引用了不存在的证据下标: ${invalid}`);

	const actualFailed = RELATION_AUDIT_DIMENSIONS.filter(
		(dimension) => verdict.dimensions[dimension].result === "fail",
	).sort();
	const declaredFailed = [...new Set(verdict.failedDimensions)].sort();
	if (JSON.stringify(actualFailed) !== JSON.stringify(declaredFailed)) {
		throw new Error("Relation 审计 failedDimensions 与维度结果不一致");
	}
	const expected = actualFailed.length === 0 ? "passed" : "failed";
	if (verdict.verdict !== expected) {
		throw new Error(`Relation 审计 verdict 不一致: expected=${expected} actual=${verdict.verdict}`);
	}
	if (verdict.verdict === "passed" && verdict.supportingEvidenceSpanIndexes.length === 0) {
		throw new Error("通过的 Relation 审计必须提供至少一条边级支持证据");
	}
}

function relationAuditCachePath(config: AppConfig, relation: Relation, prompt: string): string {
	const hash = createHash("sha256")
		.update(
			JSON.stringify({
				auditVersion: RELATION_AUDIT_VERSION,
				model: config.model,
				temperature: config.temperature,
				relationId: relation.id,
				systemPrompt: RELATION_AUDIT_SYSTEM,
				prompt,
			}),
		)
		.digest("hex");
	return join(config.runsDir, "relation-audit-cache", `${hash}.json`);
}

const AUDIT_DIMENSIONS: AuditDimensionName[] = [
	"support",
	"addition",
	"inference",
	"limits",
	"citation",
];
const HARD_FAIL_AUDIT_DIMENSIONS = new Set<AuditDimensionName>(["support", "addition", "citation"]);

/** Validate semantic consistency beyond the JSON shape before an audit can affect publication. */
function validateSemanticVerdict(verdict: SemanticVerdict, evidenceCount: number): void {
	const referencedIndexes = [
		verdict.anchorSpanIndex,
		...AUDIT_DIMENSIONS.flatMap((dimension) => verdict.dimensions[dimension].evidenceSpanIndexes),
	];
	const invalidIndex = referencedIndexes.find(
		(index) => index < 0 || !Number.isInteger(index) || index >= evidenceCount,
	);
	if (invalidIndex !== undefined) {
		throw new Error(`语义审计引用了不存在的证据下标: ${invalidIndex}`);
	}

	const actualFailed = AUDIT_DIMENSIONS.filter(
		(dimension) => verdict.dimensions[dimension].result === "fail",
	).sort();
	const declaredFailed = [...new Set(verdict.failedDimensions)].sort();
	if (JSON.stringify(actualFailed) !== JSON.stringify(declaredFailed)) {
		throw new Error(
			`语义审计 failedDimensions 与维度结果不一致: actual=${actualFailed.join(",")} declared=${declaredFailed.join(",")}`,
		);
	}

	const expectedVerdict = actualFailed.some((dimension) =>
		HARD_FAIL_AUDIT_DIMENSIONS.has(dimension),
	)
		? "failed"
		: actualFailed.length > 0
			? "warning"
			: "passed";
	if (verdict.verdict !== expectedVerdict) {
		throw new Error(
			`语义审计 verdict 与维度结果不一致: expected=${expectedVerdict} actual=${verdict.verdict}`,
		);
	}
}

function semanticAuditCachePath(config: AppConfig, claim: Claim, prompt: string): string {
	const hash = createHash("sha256")
		.update(
			JSON.stringify({
				auditVersion: SEMANTIC_AUDIT_VERSION,
				model: config.model,
				temperature: config.temperature,
				systemPrompt: SEMANTIC_AUDIT_SYSTEM,
				prompt,
			}),
		)
		.digest("hex");
	const sourceKey = claim.id
		.replace(/^claim:/, "")
		.split("-")[0]
		?.replace(/[^a-zA-Z0-9._-]/g, "_");
	return join(config.runsDir, "audit-cache", sourceKey || "unknown-source", `${hash}.json`);
}

function dimensionFailureDetail(dimension: AuditDimensionName): string {
	const details: Record<AuditDimensionName, string> = {
		support: "support：证据没有明确支持 Claim 的全部断言",
		addition: "addition：Claim 添加了证据未表达的内容",
		inference: "inference：Claim 把推断表述成了原文事实",
		limits: "limits：Claim 丢失了证据中的条件、例外或限定词",
		citation: "citation：Claim 与所引用的证据位置不对应",
	};
	return details[dimension];
}

function formatEvidenceReferences(indexes: number[], spans: SourceSpan[]): string {
	return [...new Set(indexes)]
		.map((index) => {
			const span = spans[index];
			if (!span) return `[${index}:INVALID]`;
			const excerpt = span.text.replace(/\s+/g, " ").trim().slice(0, 80);
			return `[${index}:${span.blockId}] “${excerpt}”`;
		})
		.join("; ");
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

async function mapWithConcurrency<T, R>(
	items: T[],
	concurrency: number,
	worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let nextIndex = 0;
	let firstError: unknown = null;
	const workers = Array.from(
		{ length: Math.min(Math.max(concurrency, 1), items.length) },
		async () => {
			while (firstError === null) {
				const index = nextIndex++;
				const item = items[index];
				if (item === undefined) return;
				try {
					results[index] = await worker(item, index);
				} catch (error) {
					firstError = error;
				}
			}
		},
	);
	await Promise.all(workers);
	if (firstError !== null) throw firstError;
	return results;
}

// ─── 原子 Lint 流程（修断点 1+5+6）────────────────────────────

export async function lintRelationsAgainstCanonicalClaims(
	config: AppConfig,
	relations: Relation[],
	canonicalClaims: Claim[],
	allSpans: SourceSpan[],
	provider: LLMProvider | null,
	options?: { skipSemantic?: boolean; run?: CompileRunHandle },
	allKnownClaimIds: Set<string> = new Set(canonicalClaims.map((claim) => claim.id)),
): Promise<ObjectLintResult<Relation>[]> {
	const eligibleClaims = canonicalClaims.filter(
		(claim) => claim.publicationState === "CANONICAL" && claim.lifecycle === "ACTIVE",
	);
	const canonicalClaimIds = new Set(eligibleClaims.map((claim) => claim.id));
	const canonicalClaimsById = new Map(eligibleClaims.map((claim) => [claim.id, claim]));
	return mapWithConcurrency(
		relations,
		SEMANTIC_AUDIT_CONCURRENCY,
		async (relation): Promise<ObjectLintResult<Relation>> => {
			const structIssues = checkRelationStructure(
				relation,
				canonicalClaimIds,
				allKnownClaimIds,
				allSpans,
			);
			if (structIssues.some((issue) => issue.severity === "error")) {
				return {
					object: { ...relation, publicationState: "QUARANTINED" },
					issues: structIssues,
					finalState: "QUARANTINED",
				};
			}
			const fromClaim = canonicalClaimsById.get(relation.from as string);
			const toClaim = canonicalClaimsById.get(relation.to as string);
			if (!fromClaim || !toClaim) {
				throw new Error(`Relation ${relation.id} 通过结构检查后仍无法解析 Canonical 端点`);
			}
			const semanticWasRun = !options?.skipSemantic && provider !== null;
			const semanticResult = semanticWasRun
				? await relationSemanticCheck(
						config,
						relation,
						fromClaim,
						toClaim,
						allSpans,
						provider,
						options?.run,
					)
				: {
						issues: [] as LintIssue[],
						evidenceSpanIds: relation.evidenceSpanIds,
						conditionStatus: "UNVERIFIED" as const,
						relationAuditVersion: null,
					};
			const allIssues = [...structIssues, ...semanticResult.issues];
			if (allIssues.some((issue) => issue.severity === "error")) {
				return {
					object: {
						...relation,
						publicationState: "QUARANTINED",
						conditionStatus: semanticResult.conditionStatus,
						relationAuditVersion: semanticResult.relationAuditVersion,
					},
					issues: allIssues,
					finalState: "QUARANTINED",
				};
			}
			const endpointsSupported =
				fromClaim.validity === "SUPPORTED" && toClaim.validity === "SUPPORTED";
			return {
				object: {
					...relation,
					evidenceSpanIds: semanticResult.evidenceSpanIds,
					conditionStatus: semanticResult.conditionStatus,
					relationAuditVersion: semanticResult.relationAuditVersion,
					publicationState: "CANONICAL",
					validity:
						semanticWasRun && endpointsSupported ? ("SUPPORTED" as const) : ("UNRESOLVED" as const),
				},
				issues: allIssues,
				finalState: "CANONICAL",
			};
		},
	);
}

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
	options?: { skipSemantic?: boolean; run?: CompileRunHandle },
): Promise<CompileLintResult> {
	const allClaimIds = new Set(claims.map((c) => c.id));
	const assertedRecords = readAllAssertedRecords(config);

	// ── Phase 1: Claim Lint ──
	const claimResults = await mapWithConcurrency(
		claims,
		SEMANTIC_AUDIT_CONCURRENCY,
		async (claim): Promise<ObjectLintResult<Claim>> => {
			// 结构性硬门禁
			const structIssues = checkClaimStructure(claim, allSpans, assertedRecords);

			// 如果结构失败，直接 Quarantine（不跑语义）
			if (structIssues.some((i) => i.severity === "error")) {
				return {
					object: { ...claim, publicationState: "QUARANTINED" },
					issues: structIssues,
					finalState: "QUARANTINED",
				};
			}

			// 语义门禁（可选跳过）
			let semIssues: LintIssue[] = [];
			if (claim.claimKind === "FACT" && !options?.skipSemantic && provider) {
				const claimSpans = findSpansByIds(allSpans, claim.evidenceSpanIds);
				semIssues = await semanticCheck(config, claim, claimSpans, provider, options?.run);
			}

			const allIssues = [...structIssues, ...semIssues];

			// 决定最终状态（修断点 7：基于 issueCode 而非文本匹配）
			const hasError = allIssues.some((i) => i.severity === "error");
			const hasConflict = allIssues.some((i) => i.recommendedState === "CANONICAL_DISPUTED");

			if (hasError) {
				return {
					// 结构/语义硬失败 → QUARANTINED，validity 保持 UNRESOLVED（不升级）
					object: { ...claim, publicationState: "QUARANTINED" },
					issues: allIssues,
					finalState: "QUARANTINED",
				};
			}
			if (hasConflict) {
				return {
					object: {
						...claim,
						publicationState: "CANONICAL",
						validity: "DISPUTED" as const,
					},
					issues: allIssues,
					finalState: "CANONICAL_DISPUTED",
				};
			}
			const publicationGatePassed =
				claim.claimKind !== "FACT" || (!options?.skipSemantic && provider !== null);
			return {
				// 只有语义门禁实际运行且通过，才允许 UNRESOLVED → SUPPORTED。
				object: {
					...claim,
					publicationState: "CANONICAL" as const,
					validity: publicationGatePassed ? ("SUPPORTED" as const) : claim.validity,
				},
				issues: allIssues,
				finalState: "CANONICAL",
			};
		},
	);

	// ── Phase 2: 确定 Canonical Claim 集合 ──
	const canonicalClaimsForRelations = claimResults
		.filter(
			(result) => result.finalState === "CANONICAL" || result.finalState === "CANONICAL_DISPUTED",
		)
		.map((result) => result.object);

	// ── Phase 3: Relation Lint（修断点 1）──
	const relationResults = await lintRelationsAgainstCanonicalClaims(
		config,
		relations,
		canonicalClaimsForRelations,
		allSpans,
		provider,
		options,
		allClaimIds,
	);

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
