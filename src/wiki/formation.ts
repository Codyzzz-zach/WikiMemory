import { createHash } from "node:crypto";
import { buildGraph } from "../graph/index.js";
import { resolveSpanById } from "../linter/storage.js";
import type { Claim, Relation, SourceSpan } from "../types/index.js";
import type { WikiModuleSeed } from "./materialization.js";

export interface WikiFormationInput {
	claims: Claim[];
	relations: Relation[];
	spans: SourceSpan[];
}

export interface WikiFormationOptions {
	minClaimsPerModule?: number;
	maxClaimsPerModule?: number;
	maxEvidenceCharsPerModule?: number;
}

export interface WikiFormationDecision {
	claimId: string;
	accepted: boolean;
	reason: string;
	sectionKey: string | null;
}

export interface WikiFormationResult {
	schemaVersion: "wge-wiki-formation/v1";
	seeds: WikiModuleSeed[];
	decisions: WikiFormationDecision[];
	stats: {
		inputClaims: number;
		eligibleClaims: number;
		formedModules: number;
		formedAssertions: number;
		rejectedClaims: number;
	};
}

interface LocatedClaim {
	claim: Claim;
	span: SourceSpan;
	evidenceSpans: SourceSpan[];
	blockOrder: number;
	sectionKey: string;
	sectionTitle: string;
	sourceKey: string;
}

/**
 * Deterministic Stage-A formation. It deliberately has no task/question/Gold input.
 * Document headings establish bounded topic neighborhoods; audited Relations may be
 * recorded as dependencies but never merge unrelated sections.
 */
export function formWikiModuleSeeds(
	input: WikiFormationInput,
	options: WikiFormationOptions = {},
): WikiFormationResult {
	const minClaims = Math.max(2, options.minClaimsPerModule ?? 2);
	// The online consumer has ten primary Claim slots and protects three lexical seeds.
	// Eight assertions therefore remain atomically injectable when one assertion is
	// already a seed; larger default modules can be structurally valid yet impossible
	// to consume without silently truncating their support closure.
	const maxClaims = Math.max(minClaims, options.maxClaimsPerModule ?? 8);
	const maxEvidenceChars = Math.max(256, options.maxEvidenceCharsPerModule ?? 4000);
	const spansBySource = groupSpansBySource(input.spans);
	const decisions: WikiFormationDecision[] = [];
	const located: LocatedClaim[] = [];

	for (const claim of [...input.claims].sort((a, b) => a.id.localeCompare(b.id))) {
		if (
			claim.publicationState !== "CANONICAL" ||
			claim.lifecycle !== "ACTIVE" ||
			!["SUPPORTED", "DISPUTED", "UNRESOLVED"].includes(claim.validity)
		) {
			decisions.push({
				claimId: claim.id,
				accepted: false,
				reason: "claim-not-consumable",
				sectionKey: null,
			});
			continue;
		}
		const resolved = claim.evidenceSpanIds.map((id) => resolveSpanById(input.spans, id));
		if (resolved.length === 0 || resolved.some((span) => !span)) {
			decisions.push({
				claimId: claim.id,
				accepted: false,
				reason: "evidence-not-resolvable",
				sectionKey: null,
			});
			continue;
		}
		const evidence = resolved.filter((span): span is SourceSpan => Boolean(span));
		const claimEvidenceChars = uniqueEvidenceChars(evidence);
		if (claimEvidenceChars > maxEvidenceChars) {
			decisions.push({
				claimId: claim.id,
				accepted: false,
				reason: "claim-evidence-budget-exceeded",
				sectionKey: null,
			});
			continue;
		}
		const sourceIds = new Set(evidence.map((span) => span.sourceId));
		if (sourceIds.size !== 1) {
			decisions.push({
				claimId: claim.id,
				accepted: false,
				reason: "cross-source-claim",
				sectionKey: null,
			});
			continue;
		}
		const span = [...evidence].sort(compareSpans)[0];
		if (!span) continue;
		const sourceSpans = spansBySource.get(span.sourceId) ?? [];
		const blockOrder = blockOrdinal(span.blockId);
		const heading = nearestHeading(sourceSpans, blockOrder);
		if (!heading) {
			decisions.push({
				claimId: claim.id,
				accepted: false,
				reason: "missing-structural-heading",
				sectionKey: null,
			});
			continue;
		}
		const sourceKey = sourceStructuralKey(span.blockId);
		const sectionKey = `${span.sourceId}::${heading.blockId}`;
		located.push({
			claim,
			span,
			evidenceSpans: evidence,
			blockOrder,
			sectionKey,
			sectionTitle: heading.title,
			sourceKey,
		});
		decisions.push({
			claimId: claim.id,
			accepted: true,
			reason: "same-structural-section",
			sectionKey,
		});
	}

	const groups = new Map<string, LocatedClaim[]>();
	for (const item of located)
		groups.set(item.sectionKey, [...(groups.get(item.sectionKey) ?? []), item]);
	const consumableRelations = buildGraph(input.claims, [], input.relations).relations;
	const seeds: WikiModuleSeed[] = [];
	for (const section of [...groups.values()].sort(compareSections)) {
		const ordered = [...section].sort(
			(a, b) =>
				a.blockOrder - b.blockOrder ||
				a.span.charStart - b.span.charStart ||
				a.claim.id.localeCompare(b.claim.id),
		);
		if (ordered.length < minClaims) {
			for (const item of ordered) {
				const decision = decisions.find((candidate) => candidate.claimId === item.claim.id);
				if (decision) Object.assign(decision, { accepted: false, reason: "section-below-minimum" });
			}
			continue;
		}
		for (const [chunkIndex, chunk] of chunkLocatedSection(
			ordered,
			maxClaims,
			maxEvidenceChars,
			minClaims,
		).entries()) {
			if (chunk.length < minClaims) {
				for (const item of chunk) {
					const decision = decisions.find((candidate) => candidate.claimId === item.claim.id);
					if (decision) Object.assign(decision, { accepted: false, reason: "tail-below-minimum" });
				}
				continue;
			}
			const first = chunk[0];
			if (!first) continue;
			const stableAddress = `auto/${slug(first.sourceKey)}/${slug(first.sectionTitle)}/${chunkIndex + 1}`;
			const claimIds = chunk.map((item) => item.claim.id);
			const claimIdSet = new Set(claimIds);
			const dependencies = consumableRelations
				.filter(
					(relation) =>
						claimIdSet.has(String(relation.from)) && claimIdSet.has(String(relation.to)),
				)
				.map((relation) => relation.id)
				.sort();
			seeds.push({
				id: `wiki:auto:${hash(stableAddress).slice(0, 24)}`,
				stableAddress,
				coreQuestion: `关于“${first.sectionTitle}”的当前知识是什么？`,
				claimRefs: claimIds,
				dependencies,
			});
		}
	}
	seeds.sort((a, b) => a.stableAddress.localeCompare(b.stableAddress));
	return {
		schemaVersion: "wge-wiki-formation/v1",
		seeds,
		decisions,
		stats: {
			inputClaims: input.claims.length,
			eligibleClaims: decisions.filter((decision) => decision.accepted).length,
			formedModules: seeds.length,
			formedAssertions: seeds.reduce((total, seed) => total + seed.claimRefs.length, 0),
			rejectedClaims: decisions.filter((decision) => !decision.accepted).length,
		},
	};
}

function groupSpansBySource(spans: SourceSpan[]): Map<string, SourceSpan[]> {
	const result = new Map<string, SourceSpan[]>();
	for (const span of spans) result.set(span.sourceId, [...(result.get(span.sourceId) ?? []), span]);
	for (const group of result.values())
		group.sort((a, b) => blockOrdinal(a.blockId) - blockOrdinal(b.blockId));
	return result;
}

function nearestHeading(
	spans: SourceSpan[],
	order: number,
): { blockId: string; title: string } | null {
	let result: { blockId: string; title: string } | null = null;
	for (const span of spans) {
		if (blockOrdinal(span.blockId) > order) break;
		const match = /^#{1,6}\s+(.+?)\s*$/u.exec(span.text.trim());
		if (match?.[1]) result = { blockId: span.blockId, title: match[1].trim() };
	}
	return result;
}

export function chunkWikiFormationSection<T extends { span: SourceSpan }>(
	items: T[],
	maxClaims: number,
	maxEvidenceChars: number,
	minClaims = 2,
): T[][] {
	const chunks: T[][] = [];
	let current: T[] = [];
	let chars = 0;
	for (const item of items) {
		const itemChars = item.span.text.length;
		if (
			current.length > 0 &&
			(current.length >= maxClaims || chars + itemChars > maxEvidenceChars)
		) {
			chunks.push(current);
			current = [];
			chars = 0;
		}
		current.push(item);
		chars += itemChars;
	}
	if (current.length > 0) chunks.push(current);
	const tail = chunks.at(-1);
	const previous = chunks.at(-2);
	if (tail && previous && tail.length < minClaims) {
		while (tail.length < minClaims && previous.length > minClaims) {
			const moved = previous.pop();
			if (!moved) break;
			tail.unshift(moved);
		}
	}
	return chunks;
}

function chunkLocatedSection(
	items: LocatedClaim[],
	maxClaims: number,
	maxEvidenceChars: number,
	minClaims: number,
): LocatedClaim[][] {
	const chunks: LocatedClaim[][] = [];
	let current: LocatedClaim[] = [];
	for (const item of items) {
		const next = [...current, item];
		if (
			current.length > 0 &&
			(current.length >= maxClaims || locatedEvidenceChars(next) > maxEvidenceChars)
		) {
			chunks.push(current);
			current = [];
		}
		current.push(item);
	}
	if (current.length > 0) chunks.push(current);
	const tail = chunks.at(-1);
	const previous = chunks.at(-2);
	if (tail && previous && tail.length < minClaims) {
		while (tail.length < minClaims && previous.length > minClaims) {
			const candidate = previous.at(-1);
			if (!candidate || locatedEvidenceChars([candidate, ...tail]) > maxEvidenceChars) break;
			previous.pop();
			tail.unshift(candidate);
		}
	}
	return chunks;
}

function locatedEvidenceChars(items: LocatedClaim[]): number {
	return uniqueEvidenceChars(items.flatMap((item) => item.evidenceSpans));
}

function uniqueEvidenceChars(spans: SourceSpan[]): number {
	const byId = new Map(spans.map((span) => [span.id, span]));
	return [...byId.values()].reduce((total, span) => total + span.text.length, 0);
}

function compareSections(left: LocatedClaim[], right: LocatedClaim[]): number {
	const a = left[0];
	const b = right[0];
	if (!a || !b) return left.length - right.length;
	return (
		a.sourceKey.localeCompare(b.sourceKey) ||
		a.blockOrder - b.blockOrder ||
		a.sectionKey.localeCompare(b.sectionKey)
	);
}

function compareSpans(a: SourceSpan, b: SourceSpan): number {
	return (
		blockOrdinal(a.blockId) - blockOrdinal(b.blockId) ||
		a.charStart - b.charStart ||
		a.id.localeCompare(b.id)
	);
}

function blockOrdinal(blockId: string): number {
	const match = /#block-(\d+)$/u.exec(blockId);
	return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function sourceStructuralKey(blockId: string): string {
	return blockId.replace(/#block-\d+$/u, "") || "source";
}

function slug(value: string): string {
	const normalized = value.normalize("NFKC").toLowerCase();
	const compact = normalized.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/gu, "");
	return compact.slice(0, 80) || hash(value).slice(0, 16);
}

function hash(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}
