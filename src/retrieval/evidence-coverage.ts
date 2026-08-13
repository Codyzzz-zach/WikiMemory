/**
 * Goal 3 evidence-coverage rescore contract (v1) — pure offline evaluator.
 *
 * Implements the fixedAlgorithm from
 * experiments/goal3/goal3-evidence-coverage-rescore-contract-v1.json:
 *
 * - A required evidence item is the pair (required sourceId, normalized
 *   exactQuote); quote text from a different source cannot satisfy it.
 * - Each candidate evidenceSpanId is resolved to its persisted base span and
 *   char interval (`id#chars-start-end` children carve an interval out of the
 *   persisted base span; a persisted span id uses its full interval).
 * - Candidate intervals are grouped by base span, sorted by source character
 *   position, and merged only when intervals overlap or the gap between them
 *   in the persisted base text is exclusively whitespace.
 * - Each merged segment is reconstructed from the persisted base span text,
 *   never by concatenating candidates in Claim/input order, never across
 *   base spans or sources.
 * - A requirement matches only when one reconstructed segment from a
 *   matching source contains the normalized exactQuote.
 *
 * Purely functional: no Gold, Relation, Context Pack, model or network access.
 * Every invalid or unresolved candidate span id fails closed by throwing.
 */

import type { SourceSpan } from "../types/index.js";

export interface EvidenceRequirement {
	sourceId: string;
	exactQuote: string;
}

export interface ClosureSegment {
	/** The persisted base span this segment was reconstructed from. */
	baseSpanId: string;
	/** Canonical source id of the base span. */
	sourceId: string;
	charStart: number;
	charEnd: number;
	/** Merged text reconstructed from the persisted base span text. */
	text: string;
	/** Quote-normalized form of `text` (shared with run-goal3-source-routing.ts). */
	normalizedText: string;
}

export interface EvidenceCoverageResult {
	/** Requirements satisfied by at least one matching reconstructed segment. */
	matchedEvidence: EvidenceRequirement[];
	/** Requirements not satisfied by any reconstructed segment. */
	missingEvidence: EvidenceRequirement[];
	/** Stable keys for matched requirements (sourceId + normalized quote). */
	matchedEvidenceKeys: string[];
	/** Stable keys for missing requirements (sourceId + normalized quote). */
	missingEvidenceKeys: string[];
	/** Merged segments grouped by base span, in stable (base id, char) order. */
	closureSegments: ClosureSegment[];
	matchedCount: number;
	requiredCount: number;
	/** matchedCount / requiredCount, or null when requiredCount is 0. */
	recall: number | null;
}

/** Deterministic `#chars-start-end` child span id pattern. */
const CHILD_SPAN_ID_PATTERN = /^(.*)#chars-(\d+)-(\d+)$/u;

/**
 * Quote normalization MUST stay byte-for-byte identical to
 * scripts/run-goal3-source-routing.ts (NFKC, markdown line markers,
 * emphasis/code markers, whitespace collapse).
 */
export function normalizeEvidenceQuote(value: string): string {
	return value
		.normalize("NFKC")
		.replace(/(^|\s)[>*#-]+\s+/gu, "$1")
		.replace(/[*_`]+/gu, "")
		.replace(/\s+/gu, " ")
		.trim();
}

/**
 * Canonical sourceId matching semantics from the existing benchmark
 * (run-goal3-source-routing.ts sourceIdMatches): the first argument is the
 * canonical id and the second is the benchmark id.
 */
export function canonicalSourceIdsMatch(canonicalId: string, benchmarkId: string): boolean {
	return canonicalId === benchmarkId || canonicalId.startsWith(`source:${benchmarkId}-`);
}

function stableRequirementKey(requirement: EvidenceRequirement): string {
	return `${requirement.sourceId}\u0000${normalizeEvidenceQuote(requirement.exactQuote)}`;
}

interface ResolvedInterval {
	baseSpan: SourceSpan;
	charStart: number;
	charEnd: number;
}

function resolveCandidateInterval(spans: SourceSpan[], spanId: string): ResolvedInterval {
	const persisted = spans.find((span) => span.id === spanId);
	if (persisted) {
		return {
			baseSpan: persisted,
			charStart: persisted.charStart,
			charEnd: persisted.charEnd,
		};
	}
	const match = CHILD_SPAN_ID_PATTERN.exec(spanId);
	if (!match) {
		throw new Error(
			`Unresolved candidate evidenceSpanId (no persisted span, no #chars- suffix): ${spanId}`,
		);
	}
	const [, baseSpanId, startText, endText] = match;
	const baseSpan = spans.find((span) => span.id === baseSpanId);
	const charStart = Number(startText);
	const charEnd = Number(endText);
	if (
		!baseSpan ||
		!Number.isSafeInteger(charStart) ||
		!Number.isSafeInteger(charEnd) ||
		charStart < baseSpan.charStart ||
		charEnd > baseSpan.charEnd ||
		charEnd <= charStart
	) {
		throw new Error(`Unresolved candidate child evidenceSpanId: ${spanId}`);
	}
	return { baseSpan, charStart, charEnd };
}

/** Merge intervals that overlap, or whose gap in the base text is all whitespace. */
function mergeIntervals(
	baseSpan: SourceSpan,
	intervals: ResolvedInterval[],
): Array<{ charStart: number; charEnd: number }> {
	const sorted = [...intervals].sort((a, b) => a.charStart - b.charStart || a.charEnd - b.charEnd);
	const merged: Array<{ charStart: number; charEnd: number }> = [];
	for (const interval of sorted) {
		const last = merged[merged.length - 1];
		if (!last) {
			merged.push({ charStart: interval.charStart, charEnd: interval.charEnd });
			continue;
		}
		if (interval.charStart <= last.charEnd) {
			// Overlap (or exact adjacency): extend the merged segment.
			last.charEnd = Math.max(last.charEnd, interval.charEnd);
			continue;
		}
		const gap = baseSpan.text.slice(
			last.charEnd - baseSpan.charStart,
			interval.charStart - baseSpan.charStart,
		);
		if (gap.trim().length === 0) {
			// Whitespace-only gap may bridge.
			last.charEnd = interval.charEnd;
			continue;
		}
		merged.push({ charStart: interval.charStart, charEnd: interval.charEnd });
	}
	return merged;
}

function reconstructSegments(spans: SourceSpan[], candidateSpanIds: string[]): ClosureSegment[] {
	// Deduplicate ids and preserve the canonical SourceSpan objects; duplicates
	// must not change the result, and candidate order must not matter.
	const uniqueIds = [...new Set(candidateSpanIds)];
	const intervals = uniqueIds.map((spanId) => resolveCandidateInterval(spans, spanId));

	// Group by base span (stable order by base span id), then merge per base.
	const byBaseSpanId = new Map<string, ResolvedInterval[]>();
	for (const interval of intervals) {
		const group = byBaseSpanId.get(interval.baseSpan.id);
		if (group) group.push(interval);
		else byBaseSpanId.set(interval.baseSpan.id, [interval]);
	}

	const segments: ClosureSegment[] = [];
	for (const baseSpanId of [...byBaseSpanId.keys()].sort()) {
		const group = byBaseSpanId.get(baseSpanId) ?? [];
		const baseSpan = group[0]?.baseSpan;
		if (!baseSpan) continue;
		for (const merged of mergeIntervals(baseSpan, group)) {
			const text = baseSpan.text.slice(
				merged.charStart - baseSpan.charStart,
				merged.charEnd - baseSpan.charStart,
			);
			segments.push({
				baseSpanId,
				sourceId: baseSpan.sourceId,
				charStart: merged.charStart,
				charEnd: merged.charEnd,
				text,
				normalizedText: normalizeEvidenceQuote(text),
			});
		}
	}
	return segments;
}

export function evaluateEvidenceCoverage(
	spans: SourceSpan[],
	candidateSpanIds: string[],
	requirements: EvidenceRequirement[],
): EvidenceCoverageResult {
	const closureSegments = reconstructSegments(spans, candidateSpanIds);

	const matched: EvidenceRequirement[] = [];
	const missing: EvidenceRequirement[] = [];
	for (const requirement of requirements) {
		const normalizedQuote = normalizeEvidenceQuote(requirement.exactQuote);
		if (requirement.sourceId.trim().length === 0 || normalizedQuote.length === 0) {
			throw new Error("Evidence requirement must contain a non-empty sourceId and exactQuote");
		}
		const satisfied = closureSegments.some(
			(segment) =>
				canonicalSourceIdsMatch(segment.sourceId, requirement.sourceId) &&
				segment.normalizedText.includes(normalizedQuote),
		);
		if (satisfied) matched.push(requirement);
		else missing.push(requirement);
	}

	const matchedEvidenceKeys = [...new Set(matched.map(stableRequirementKey))];
	const missingEvidenceKeys = [...new Set(missing.map(stableRequirementKey))];
	const requiredCount = requirements.length;
	return {
		matchedEvidence: matched,
		missingEvidence: missing,
		matchedEvidenceKeys,
		missingEvidenceKeys,
		closureSegments,
		matchedCount: matched.length,
		requiredCount,
		recall: requiredCount === 0 ? null : matched.length / requiredCount,
	};
}
