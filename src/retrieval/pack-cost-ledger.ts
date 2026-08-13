import { createHash } from "node:crypto";
import { estimateTokens } from "../compiler/telemetry.js";
import type { Claim, Source, SourceSpan } from "../types/index.js";

const CHILD_SPAN_PATTERN = /^(.*)#chars-(\d+)-(\d+)$/u;

export interface TextCostMeasurement {
	utf8Bytes: number;
	characters: number;
	estimatedTokens: number;
}

export interface RawEvidenceInterval {
	spanId: string;
	baseSpanId: string;
	sourceId: string;
	blockId: string;
	charStart: number;
	charEnd: number;
	text: string;
}

export interface MergedEvidenceInterval {
	baseSpanId: string;
	sourceId: string;
	blockId: string;
	charStart: number;
	charEnd: number;
	spanIds: string[];
	text: string;
}

export interface EvidenceIntervalProjection {
	raw: RawEvidenceInterval[];
	merged: MergedEvidenceInterval[];
	rawUnionHash: string;
	mergedUnionHash: string;
	intervalUnionPreserved: boolean;
}

interface ResolvedEvidenceInterval extends RawEvidenceInterval {
	baseSpan: SourceSpan;
}

export function measureTextCost(text: string): TextCostMeasurement {
	return {
		utf8Bytes: Buffer.byteLength(text, "utf8"),
		characters: [...text].length,
		estimatedTokens: estimateTokens(text),
	};
}

/** Stable object-key order while preserving array order (candidate rank is meaningful). */
export function stableStringify(value: unknown): string {
	return JSON.stringify(sortObjectKeys(value));
}

export function claimCommunicationProjection(claim: Claim, rank: number): Record<string, unknown> {
	return {
		rank,
		claimId: claim.id,
		statement: claim.statement,
		retrievalAliases: [...(claim.retrievalAliases ?? [])].sort(),
	};
}

export function claimSemanticProjection(claim: Claim): Record<string, unknown> {
	return {
		claimId: claim.id,
		conditions: [...claim.conditions].sort(),
		claimKind: claim.claimKind,
		scope: claim.scope,
		derivation: claim.derivation,
		validity: claim.validity,
		lifecycle: claim.lifecycle,
		publicationState: claim.publicationState,
		validFrom: claim.validFrom,
		validTo: claim.validTo,
		provenanceRefs: sortKnowledgeRefs(claim.provenanceRefs),
		supportingEvidenceRefs: sortKnowledgeRefs(claim.supportingEvidenceRefs),
		knowledgeVersion: claim.knowledgeVersion,
		recordedAt: claim.recordedAt,
	};
}

export function sourceMetadataProjection(source: Source): Record<string, unknown> {
	return {
		sourceId: source.id,
		hash: source.hash,
		uri: source.uri,
		sourceType: source.sourceType,
		loaderVersion: source.loaderVersion,
		metadata: source.metadata ?? {},
		createdAt: source.createdAt,
	};
}

/**
 * Build two renderings of exactly the same source-bound character union.
 * Only overlap and strict adjacency may merge. Whitespace gaps are preserved
 * as gaps because absorbing them would invalidate the zero-loss proof.
 */
export function buildEvidenceIntervalProjection(
	allSpans: SourceSpan[],
	spanIds: string[],
): EvidenceIntervalProjection {
	const baseById = new Map(allSpans.map((span) => [span.id, span] as const));
	const uniqueSpanIds = [...new Set(spanIds)];
	const resolved = uniqueSpanIds.map((spanId) => resolveEvidenceInterval(baseById, spanId));
	const raw = resolved.map(({ baseSpan: _baseSpan, ...interval }) => interval);
	const groups = new Map<string, ResolvedEvidenceInterval[]>();
	for (const interval of resolved) {
		const key = `${interval.sourceId}\u0000${interval.baseSpanId}`;
		const group = groups.get(key);
		if (group) group.push(interval);
		else groups.set(key, [interval]);
	}

	const merged: MergedEvidenceInterval[] = [];
	for (const key of [...groups.keys()].sort()) {
		const group = [...(groups.get(key) ?? [])].sort(
			(left, right) =>
				left.charStart - right.charStart ||
				left.charEnd - right.charEnd ||
				left.spanId.localeCompare(right.spanId),
		);
		for (const interval of group) {
			const last = merged[merged.length - 1];
			if (
				last &&
				last.sourceId === interval.sourceId &&
				last.baseSpanId === interval.baseSpanId &&
				interval.charStart <= last.charEnd
			) {
				last.charEnd = Math.max(last.charEnd, interval.charEnd);
				last.spanIds = [...new Set([...last.spanIds, interval.spanId])].sort();
				last.text = interval.baseSpan.text.slice(
					last.charStart - interval.baseSpan.charStart,
					last.charEnd - interval.baseSpan.charStart,
				);
				continue;
			}
			merged.push({
				baseSpanId: interval.baseSpanId,
				sourceId: interval.sourceId,
				blockId: interval.blockId,
				charStart: interval.charStart,
				charEnd: interval.charEnd,
				spanIds: [interval.spanId],
				text: interval.text,
			});
		}
	}

	const rawUnionHash = hashIntervalUnion(raw);
	const mergedUnionHash = hashIntervalUnion(merged);
	return {
		raw,
		merged,
		rawUnionHash,
		mergedUnionHash,
		intervalUnionPreserved: rawUnionHash === mergedUnionHash,
	};
}

export function hashStableValue(value: unknown): string {
	return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function resolveEvidenceInterval(
	baseById: ReadonlyMap<string, SourceSpan>,
	spanId: string,
): ResolvedEvidenceInterval {
	const persisted = baseById.get(spanId);
	if (persisted) {
		return {
			spanId,
			baseSpanId: persisted.id,
			sourceId: persisted.sourceId,
			blockId: persisted.blockId,
			charStart: persisted.charStart,
			charEnd: persisted.charEnd,
			text: persisted.text,
			baseSpan: persisted,
		};
	}

	const match = CHILD_SPAN_PATTERN.exec(spanId);
	if (!match) throw new Error(`Unresolved evidence span: ${spanId}`);
	const [, baseSpanId, startText, endText] = match;
	const baseSpan = baseById.get(baseSpanId ?? "");
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
		throw new Error(`Invalid child evidence span: ${spanId}`);
	}
	return {
		spanId,
		baseSpanId: baseSpan.id,
		sourceId: baseSpan.sourceId,
		blockId: baseSpan.blockId,
		charStart,
		charEnd,
		text: baseSpan.text.slice(charStart - baseSpan.charStart, charEnd - baseSpan.charStart),
		baseSpan,
	};
}

function hashIntervalUnion(
	intervals: Array<{ sourceId: string; baseSpanId: string; charStart: number; charEnd: number }>,
): string {
	const groups = new Map<string, Array<{ charStart: number; charEnd: number }>>();
	for (const interval of intervals) {
		const key = `${interval.sourceId}\u0000${interval.baseSpanId}`;
		const group = groups.get(key);
		const value = { charStart: interval.charStart, charEnd: interval.charEnd };
		if (group) group.push(value);
		else groups.set(key, [value]);
	}
	const union: Array<Record<string, unknown>> = [];
	for (const key of [...groups.keys()].sort()) {
		const [sourceId, baseSpanId] = key.split("\u0000");
		const sorted = [...(groups.get(key) ?? [])].sort(
			(left, right) => left.charStart - right.charStart || left.charEnd - right.charEnd,
		);
		const ranges: Array<{ charStart: number; charEnd: number }> = [];
		for (const interval of sorted) {
			const last = ranges[ranges.length - 1];
			if (last && interval.charStart <= last.charEnd) {
				last.charEnd = Math.max(last.charEnd, interval.charEnd);
			} else {
				ranges.push({ ...interval });
			}
		}
		union.push({ sourceId, baseSpanId, ranges });
	}
	return hashStableValue(union);
}

function sortKnowledgeRefs(refs: Claim["provenanceRefs"]): Claim["provenanceRefs"] {
	return [...refs].sort((left, right) =>
		stableStringify(left).localeCompare(stableStringify(right)),
	);
}

function sortObjectKeys(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortObjectKeys);
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>)
				.filter(([, entry]) => entry !== undefined)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([key, entry]) => [key, sortObjectKeys(entry)]),
		);
	}
	return value;
}
