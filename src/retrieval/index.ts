import { getConsumptionRule } from "../linter/index.js";
import { resolveSpanById } from "../linter/storage.js";
import type { Claim, SourceSpan } from "../types/index.js";

export interface SeedCandidate {
	claim: Claim;
	score: number;
	channels: string[];
	matchedFeatures: string[];
}

export interface SeedRetrievalDiagnostics {
	queryFeatureCount: number;
	eligibleClaimCount: number;
	matchedClaimCount: number;
	usedEvidenceText: boolean;
	usedSourceMetadata: boolean;
	resolvedEvidenceRefCount: number;
	unresolvedEvidenceRefCount: number;
}

export interface SeedRetrievalResult {
	candidates: SeedCandidate[];
	diagnostics: SeedRetrievalDiagnostics;
}

export interface TemporalScopeFilterResult {
	claims: Claim[];
	diagnostics: {
		applied: boolean;
		startMonth: string | null;
		endMonth: string | null;
		excludedClaimIds: string[];
	};
}

interface IndexedClaim {
	claim: Claim;
	features: Set<string>;
	aliasFeatures: Set<string>;
	sourceFeatures: Set<string>;
	normalizedText: string;
}

/**
 * 与领域无关的稀疏文本特征。
 *
 * 英文及数字保留词；连续中文生成二元、三元片段。这样既不依赖外部分词器，
 * 也不会把整句中文误当成一个 token。前缀用于区分不同粒度，避免碰撞。
 */
export function lexicalFeatures(text: string): Set<string> {
	const normalized = normalizeNotation(text);
	const features = new Set<string>();
	// Standards, laws, releases and scientific taxonomies commonly use dotted numeric
	// identifiers (for example 2.5.7 or 1.2.3). Keep the complete identifier before
	// generic tokenization splits it into one-character runs and discards it.
	for (const identifier of normalized.match(/\b\d+(?:\.\d+){1,}\b/g) ?? []) {
		features.add(`id:${identifier}`);
	}
	for (const run of normalized.match(/[\p{L}\p{N}]+/gu) ?? []) {
		if (/[\p{Script=Han}]/u.test(run)) {
			const chars = [...run];
			for (let size = 2; size <= 3; size++) {
				for (let index = 0; index + size <= chars.length; index++) {
					features.add(`c${size}:${chars.slice(index, index + size).join("")}`);
				}
			}
			continue;
		}
		if (run.length > 1) features.add(`w:${run}`);
		if (run.length >= 5) {
			for (let index = 0; index + 3 <= run.length; index++) {
				features.add(`g3:${run.slice(index, index + 3)}`);
			}
		}
	}
	return features;
}

export function normalizeSearchText(text: string): string {
	return normalizeNotation(text).replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * 对搜索有意义、但排版方式可能不同的标识做最小规范化。
 * 例如版本/变量常见的 `name^2`、`name_2` 与 Unicode 上下标会归一到 `name2`。
 */
function normalizeNotation(text: string): string {
	return text
		.normalize("NFKC")
		.toLowerCase()
		.replace(/([\p{L}])\s*[\^_]\s*(\p{N}+)/gu, "$1$2");
}

/**
 * Applies only when the query states at least two explicit year-month boundaries.
 * Claims without a precise month remain eligible; claims whose every precise month
 * is outside the closed interval are excluded from both Seed and Graph navigation.
 */
export function filterClaimsByExplicitTemporalScope(
	claims: Claim[],
	spans: SourceSpan[],
	query: string,
	sourceSearchText: ReadonlyMap<string, string> = new Map(),
): TemporalScopeFilterResult {
	const queryMonths = extractMonths(query);
	if (queryMonths.length < 2) {
		return {
			claims,
			diagnostics: { applied: false, startMonth: null, endMonth: null, excludedClaimIds: [] },
		};
	}
	const start = Math.min(...queryMonths);
	const end = Math.max(...queryMonths);
	const excludedClaimIds: string[] = [];
	const filtered = claims.filter((claim) => {
		const months = extractMonths(claimSearchText(claim, spans, sourceSearchText));
		if (months.length === 0 || months.some((month) => month >= start && month <= end)) return true;
		excludedClaimIds.push(claim.id);
		return false;
	});
	return {
		claims: filtered,
		diagnostics: {
			applied: true,
			startMonth: formatMonth(start),
			endMonth: formatMonth(end),
			excludedClaimIds,
		},
	};
}

/**
 * 从 Canonical Claim 与其原文证据中选 Seed。
 *
 * 该层只负责找到可靠起点；Relation/Graph 只能在 Seed 之后扩展，不能拿来
 * 弥补一个空查询。评分完全由当前查询和索引文本计算，不读取 Benchmark Gold。
 */
export function retrieveClaimSeeds(
	claims: Claim[],
	spans: SourceSpan[],
	query: string,
	limit = 10,
	sourceSearchText: ReadonlyMap<string, string> = new Map(),
): SeedRetrievalResult {
	const hasAliases = claims.some((claim) => (claim.retrievalAliases ?? []).length > 0);
	if (!hasAliases) return retrieveClaimSeedsOnce(claims, spans, query, limit, sourceSearchText);
	// Keep the complete original-language ranking, then add a small alias-only
	// supplement. Cross-language recall must not replace evidence that was already
	// reachable through the original statement, evidence, identifiers or metadata.
	const baseline = retrieveClaimSeedsOnce(
		claims.map((claim) => ({ ...claim, retrievalAliases: [] })),
		spans,
		query,
		limit,
		sourceSearchText,
	);
	const multilingual = retrieveClaimSeedsOnce(claims, spans, query, limit, sourceSearchText);
	const existingIds = new Set(baseline.candidates.map((candidate) => candidate.claim.id));
	const supplements = multilingual.candidates
		.filter(
			(candidate) => candidate.channels.includes("alias") && !existingIds.has(candidate.claim.id),
		)
		.slice(0, 4);
	return {
		candidates: [...baseline.candidates, ...supplements],
		diagnostics: {
			...multilingual.diagnostics,
			matchedClaimCount: baseline.candidates.length + supplements.length,
		},
	};
}

function retrieveClaimSeedsOnce(
	claims: Claim[],
	spans: SourceSpan[],
	query: string,
	limit: number,
	sourceSearchText: ReadonlyMap<string, string>,
): SeedRetrievalResult {
	let resolvedEvidenceRefCount = 0;
	let unresolvedEvidenceRefCount = 0;
	const eligible = claims.filter((claim) => {
		const rule = getConsumptionRule(claim.publicationState, claim.lifecycle, claim.validity);
		return rule.allowRetrieval;
	});
	const indexed: IndexedClaim[] = eligible.map((claim) => {
		const resolvedEvidence = claim.evidenceSpanIds.flatMap((spanId) => {
			const span = resolveSpanById(spans, spanId);
			if (!span) {
				unresolvedEvidenceRefCount++;
				return [];
			}
			resolvedEvidenceRefCount++;
			return [span];
		});
		const evidence = resolvedEvidence.map((span) => span.text).join("\n");
		const sourceMetadata = [
			...new Set(
				resolvedEvidence
					.map((span) => span.sourceId)
					.map((sourceId) => sourceSearchText.get(sourceId) ?? "")
					.filter(Boolean),
			),
		].join("\n");
		const aliases = (claim.retrievalAliases ?? []).join("\n");
		const text = [claim.statement, claim.conditions.join(" "), evidence, aliases, sourceMetadata]
			.filter(Boolean)
			.join("\n");
		return {
			claim,
			features: lexicalFeatures(text),
			aliasFeatures: lexicalFeatures(aliases),
			sourceFeatures: lexicalFeatures(sourceMetadata),
			normalizedText: normalizeSearchText(text),
		};
	});
	const queryFeatures = lexicalFeatures(query);
	const normalizedQuery = normalizeSearchText(query);
	const documentFrequency = new Map<string, number>();
	for (const entry of indexed) {
		for (const feature of entry.features) {
			documentFrequency.set(feature, (documentFrequency.get(feature) ?? 0) + 1);
		}
	}

	const candidates = indexed
		.map((entry): SeedCandidate | null => {
			const matched = [...queryFeatures].filter((feature) => entry.features.has(feature));
			const queryWords = [...queryFeatures].filter((feature) => feature.startsWith("w:"));
			const queryIdentifiers = [...queryFeatures].filter((feature) => feature.startsWith("id:"));
			const matchedWords = matched.filter((feature) => feature.startsWith("w:"));
			const matchedIdentifiers = matched.filter((feature) => feature.startsWith("id:"));
			const matchedTrigrams = matched.filter((feature) => feature.startsWith("c3:"));
			const matchedBigrams = matched.filter((feature) => feature.startsWith("c2:"));
			// 查询中的拉丁/数字标识通常是实体名、版本或符号；但混合语言查询里的
			// 日期/版本不能否决一个已经有强中文片段匹配的候选。
			if (
				queryWords.length > 0 &&
				matchedWords.length === 0 &&
				matchedIdentifiers.length === 0 &&
				matchedTrigrams.length === 0 &&
				matchedBigrams.length < 2
			) {
				return null;
			}
			if (
				queryWords.length === 0 &&
				queryIdentifiers.length > 0 &&
				matchedIdentifiers.length === 0 &&
				matchedTrigrams.length === 0 &&
				matchedBigrams.length < 2
			) {
				return null;
			}
			if (
				queryWords.length === 0 &&
				queryIdentifiers.length === 0 &&
				matchedTrigrams.length === 0 &&
				matchedBigrams.length < 2
			) {
				return null;
			}

			let score = 0;
			const channels = new Set<string>();
			for (const feature of matched) {
				const frequency = documentFrequency.get(feature) ?? 0;
				const idf = Math.log((indexed.length + 1) / (frequency + 1)) + 1;
				const weight = feature.startsWith("id:")
					? 4
					: feature.startsWith("w:")
						? 2
						: feature.startsWith("c3:")
							? 1.5
							: feature.startsWith("c2:")
								? 1
								: 0.25;
				score += idf * weight;
				channels.add(feature.slice(0, feature.indexOf(":")));
			}
			if (matched.some((feature) => entry.sourceFeatures.has(feature))) channels.add("source");
			if (matched.some((feature) => entry.aliasFeatures.has(feature))) channels.add("alias");
			const coverage = queryFeatures.size === 0 ? 0 : matched.length / queryFeatures.size;
			score *= 0.5 + coverage;
			if (normalizedQuery.length >= 4 && entry.normalizedText.includes(normalizedQuery)) {
				score += 8;
				channels.add("exact");
			}
			return {
				claim: entry.claim,
				score,
				channels: [...channels].sort(),
				matchedFeatures: matched.sort(),
			};
		})
		.filter((candidate): candidate is SeedCandidate => candidate !== null)
		.sort((left, right) => right.score - left.score || left.claim.id.localeCompare(right.claim.id))
		.slice(0, limit);

	return {
		candidates,
		diagnostics: {
			queryFeatureCount: queryFeatures.size,
			eligibleClaimCount: eligible.length,
			matchedClaimCount: candidates.length,
			usedEvidenceText: resolvedEvidenceRefCount > 0,
			usedSourceMetadata: sourceSearchText.size > 0,
			resolvedEvidenceRefCount,
			unresolvedEvidenceRefCount,
		},
	};
}

function claimSearchText(
	claim: Claim,
	spans: SourceSpan[],
	sourceSearchText: ReadonlyMap<string, string>,
): string {
	const resolved = claim.evidenceSpanIds.flatMap((spanId) => {
		const span = resolveSpanById(spans, spanId);
		return span ? [span] : [];
	});
	const sourceMetadata = [
		...new Set(resolved.map((span) => sourceSearchText.get(span.sourceId) ?? "").filter(Boolean)),
	].join("\n");
	return [
		claim.statement,
		claim.conditions.join(" "),
		resolved.map((span) => span.text).join("\n"),
		sourceMetadata,
	]
		.filter(Boolean)
		.join("\n");
}

function extractMonths(value: string): number[] {
	const normalized = value.normalize("NFKC");
	const months = new Set<number>();
	for (const match of normalized.matchAll(
		/\b((?:19|20)\d{2})\s*(?:[-/.]|年)\s*(0?[1-9]|1[0-2])(?!\d)(?:月)?/g,
	)) {
		const year = Number(match[1]);
		const month = Number(match[2]);
		months.add(year * 12 + month - 1);
	}
	const monthNumbers = new Map(
		[
			"january",
			"february",
			"march",
			"april",
			"may",
			"june",
			"july",
			"august",
			"september",
			"october",
			"november",
			"december",
		].map((month, index) => [month, index] as const),
	);
	for (const match of normalized
		.toLowerCase()
		.matchAll(
			/\b(?:\d{1,2}\s+)?(january|february|march|april|may|june|july|august|september|october|november|december)\s*,?\s*((?:19|20)\d{2})\b/g,
		)) {
		const month = monthNumbers.get(match[1] ?? "");
		const year = Number(match[2]);
		if (month !== undefined) months.add(year * 12 + month);
	}
	for (const match of normalized
		.toLowerCase()
		.matchAll(
			/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}\s*,?\s*((?:19|20)\d{2})\b/g,
		)) {
		const month = monthNumbers.get(match[1] ?? "");
		const year = Number(match[2]);
		if (month !== undefined) months.add(year * 12 + month);
	}
	return [...months];
}

function formatMonth(value: number): string {
	const year = Math.floor(value / 12);
	const month = (value % 12) + 1;
	return `${year}-${String(month).padStart(2, "0")}`;
}
