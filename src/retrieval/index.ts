import { getConsumptionRule } from "../linter/index.js";
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
}

export interface SeedRetrievalResult {
	candidates: SeedCandidate[];
	diagnostics: SeedRetrievalDiagnostics;
}

interface IndexedClaim {
	claim: Claim;
	features: Set<string>;
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
): SeedRetrievalResult {
	const spanText = new Map(spans.map((span) => [span.id, span.text]));
	const eligible = claims.filter((claim) => {
		const rule = getConsumptionRule(claim.publicationState, claim.lifecycle, claim.validity);
		return rule.allowRetrieval;
	});
	const indexed: IndexedClaim[] = eligible.map((claim) => {
		const evidence = claim.evidenceSpanIds
			.map((spanId) => spanText.get(spanId) ?? "")
			.filter(Boolean)
			.join("\n");
		const text = [claim.statement, claim.conditions.join(" "), evidence].filter(Boolean).join("\n");
		return {
			claim,
			features: lexicalFeatures(text),
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
			const matchedWords = matched.filter((feature) => feature.startsWith("w:"));
			const matchedTrigrams = matched.filter((feature) => feature.startsWith("c3:"));
			const matchedBigrams = matched.filter((feature) => feature.startsWith("c2:"));
			// 查询中的拉丁/数字标识通常是实体名、版本或符号；候选若完全没有它，
			// 不能仅凭“什么/不同/条件”等中文片段成为 Seed。
			if (queryWords.length > 0 && matchedWords.length === 0) return null;
			if (queryWords.length === 0 && matchedTrigrams.length === 0 && matchedBigrams.length < 2) {
				return null;
			}

			let score = 0;
			const channels = new Set<string>();
			for (const feature of matched) {
				const frequency = documentFrequency.get(feature) ?? 0;
				const idf = Math.log((indexed.length + 1) / (frequency + 1)) + 1;
				const weight = feature.startsWith("w:")
					? 2
					: feature.startsWith("c3:")
						? 1.5
						: feature.startsWith("c2:")
							? 1
							: 0.25;
				score += idf * weight;
				channels.add(feature.slice(0, feature.indexOf(":")));
			}
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
			usedEvidenceText: spans.length > 0,
		},
	};
}
