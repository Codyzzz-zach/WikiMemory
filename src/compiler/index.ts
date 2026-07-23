/**
 * Compiler — 知识编译核心
 *
 * 三步编译：
 * 1. 命题切分：LLM 返回 blockId + exactQuote + relatesTo（不返回 charStart/charEnd）
 * 2. SourceSpan 映射：程序用 exactQuote 在 block 内做字符串匹配（修 GPT 问题 7）
 * 3. Claim/Concept/Relation 编译：LLM 基于命题 + 原文产出结构化知识
 *
 * Proposition 是中间产物（决策 4A），不长期存储。
 */

import type { AppConfig } from "../config/types.js";
import type { LLMProvider } from "../core/llm-provider.js";
import { mapQuoteToSpan } from "../ingestor/index.js";
import { COMPILE_SYSTEM, COMPILE_VERSION, PROPOSITION_EXTRACT_SYSTEM } from "../prompts/index.js";
import type {
	Claim,
	Concept,
	PropositionDraft,
	Relation,
	Source,
	SourceSpan,
} from "../types/index.js";
import { claimRef } from "../types/index.js";
import {
	CompileResponseSchema,
	PropositionResponseSchema,
	parseLLMJson,
} from "../types/schemas.js";

/** 编译结果 */
export interface CompileResult {
	claims: Claim[];
	concepts: Concept[];
	relations: Relation[];
	propositions: PropositionDraft[]; // 中间产物（供调试/审计用）
}

/**
 * 编译一个 Source 的知识。
 *
 * @param config - 配置
 * @param source - 不可变原文
 * @param spans - 原文的 SourceSpan 列表（每个 block 一个）
 * @param provider - LLM Provider
 * @returns 编译出的 Claim/Concept/Relation
 */
export async function compileSource(
	config: AppConfig,
	source: Source,
	spans: SourceSpan[],
	provider: LLMProvider,
): Promise<CompileResult> {
	// ── 第一步：命题切分 ──
	const propPrompt = buildPropositionPrompt(source, spans);
	const propResult = await provider.chat({
		model: config.model,
		systemPrompt: PROPOSITION_EXTRACT_SYSTEM,
		messages: [{ role: "user", content: propPrompt }],
		responseFormat: "json_object",
		thinkingDisabled: true,
		maxTokens: 32768,
	});

	const propData = parseLLMJson(propResult.content, PropositionResponseSchema);

	// ── 第二步：exactQuote → SourceSpan 映射 ──
	const propositions: PropositionDraft[] = [];
	for (const item of propData.propositions) {
		// 用 exactQuote 在 blockId 对应的 block 内做字符串匹配
		const mappedSpan = mapQuoteToSpan(spans, item.blockId, item.exactQuote);
		if (!mappedSpan) {
			// 匹配失败——跳过这条命题（不信任 LLM 的引用）
			continue;
		}
		propositions.push({
			sourceId: source.id,
			blockId: item.blockId,
			text: item.text,
			exactQuote: item.exactQuote,
			relatesTo: item.relatesTo
				? {
						fromPropIndex: item.relatesTo.fromPropIndex,
						type: item.relatesTo.type,
					}
				: undefined,
		});
	}

	if (propositions.length === 0) {
		return { claims: [], concepts: [], relations: [], propositions: [] };
	}

	// ── 第三步：Claim/Concept/Relation 编译 ──
	const compilePrompt = buildCompilePrompt(source, spans, propositions);
	const compileResult = await provider.chat({
		model: config.model,
		systemPrompt: COMPILE_SYSTEM,
		messages: [{ role: "user", content: compilePrompt }],
		responseFormat: "json_object",
		thinkingDisabled: true,
		maxTokens: 8192,
	});

	const compileData = parseLLMJson(compileResult.content, CompileResponseSchema);

	// ── 构造一等对象 ──
	const now = new Date().toISOString();
	const claims: Claim[] = [];

	for (const draft of compileData.claims) {
		// 为每条 Claim 的 evidenceQuotes 找到精确 SourceSpan
		const evidenceSpanIds: string[] = [];
		const blockIds = draft.blockIds ?? [];
		const evidenceQuotes = draft.evidenceQuotes ?? [];
		for (let i = 0; i < evidenceQuotes.length; i++) {
			const quote = evidenceQuotes[i]!;
			const blockId = blockIds[i] ?? blockIds[0] ?? "";
			const mapped = mapQuoteToSpan(spans, blockId, quote);
			if (mapped) {
				evidenceSpanIds.push(mapped.id);
			}
		}

		// 如果没有找到任何 evidence，跳过这条 Claim
		if (evidenceSpanIds.length === 0) continue;

		claims.push({
			id: `claim:${source.hash}-${claims.length}`,
			statement: draft.statement,
			evidenceSpanIds,
			conditions: draft.conditions ?? [],
			derivation: draft.derivation ?? "EXTRACTED",
			// 门禁前置：新 Claim 初始 UNRESOLVED（待证明），门禁通过才 SUPPORTED
			// 依据：audit_reliability_research.md + Review 断点 1（不假定可信，审计后才放行）
			validity: "UNRESOLVED",
			lifecycle: "ACTIVE",
			publicationState: "CANDIDATE",
			validFrom: now,
			validTo: null,
			compilerVersion: COMPILE_VERSION,
			confidence: draft.confidence ?? 0.75,
		});
	}

	const concepts: Concept[] = (compileData.concepts ?? []).map((c, idx) => ({
		id: `concept:${source.hash}-${idx}`,
		name: c.name,
		aliases: c.aliases ?? [],
		boundary: c.boundary ?? "",
		domain: c.domain || "未分类",
	}));

	const relations: Relation[] = [];
	for (const rel of compileData.relations ?? []) {
		const fromClaim = claims[rel.fromClaimIndex];
		const toClaim = claims[rel.toClaimIndex];
		if (!fromClaim || !toClaim) continue;

		relations.push({
			id: `rel:${source.hash}-${relations.length}`,
			from: claimRef(fromClaim.id),
			to: claimRef(toClaim.id),
			type: rel.type,
			conditions: rel.conditions ?? [],
			evidenceSpanIds: [...fromClaim.evidenceSpanIds, ...toClaim.evidenceSpanIds],
			derivation: "INFERRED",
			// Relation 跟随 Claim：初始 UNRESOLVED，门禁通过后跟随端点 Claim 状态
			validity: "UNRESOLVED",
			lifecycle: "ACTIVE",
			publicationState: "CANDIDATE",
			validFrom: now,
			validTo: null,
			compilerVersion: COMPILE_VERSION,
			source: "intra-material-compile",
			confidence: rel.confidence ?? 0.7,
			consumedBy: [],
		});
	}

	return { claims, concepts, relations, propositions };
}

// ─── Prompt 构造（私有）──────────────────────────────────────────

function buildPropositionPrompt(_source: Source, spans: SourceSpan[]): string {
	// 只给 LLM 块的 blockId + text（不给 charStart/charEnd——那是程序管的）
	const blockList = spans.map((s) => `[${s.blockId}] ${s.text.slice(0, 500)}`).join("\n\n");

	return `请将以下章节块拆分为原子命题。

# 可用块列表（blockId + 文本）
${blockList}

请以 JSON 格式返回结果。`;
}

function buildCompilePrompt(
	_source: Source,
	_spans: SourceSpan[],
	propositions: PropositionDraft[],
): string {
	const propList = propositions
		.map(
			(p, i) =>
				`[prop ${i}] blockId=${p.blockId}\n  text: ${p.text}\n  exactQuote: ${p.exactQuote}${
					p.relatesTo
						? `\n  relatesTo: prop ${p.relatesTo.fromPropIndex} (${p.relatesTo.type})`
						: ""
				}`,
		)
		.join("\n\n");

	return `请基于以下原子命题编译 Claim、Concept 和 Relation。

# 命题列表
${propList}

# 关键提醒
- evidenceQuotes 必须是上面 exactQuote 字段中确实存在的原文片段
- blockIds 必须是上面 blockId 字段的值
- relations 的 fromClaimIndex/toClaimIndex 指向 claims 数组的索引（0-based）
- 如果命题列表中有 relatesTo，优先复用这些关系标注

请以 JSON 格式返回结果。`;
}
