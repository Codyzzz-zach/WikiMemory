import type { Relation } from "../types/index.js";

export const RELATED_TO_SOURCE_PUBLICATION_BUDGET = 16;
export const RELATED_TO_MAX_PER_NEW_ENDPOINT = 8;

export type PostAuditCompactionState = "CANONICAL_READY" | "DEFERRED_BY_GRAPH_DIVERSITY";

export type PostAuditCompactionReason =
	| "STRONG_RELATION_BYPASS"
	| "RELATED_TO_ENDPOINT_COVERAGE"
	| "RELATED_TO_FACET_DIVERSITY"
	| "RELATED_TO_SOURCE_PUBLICATION_BUDGET"
	| "RELATED_TO_ENDPOINT_FAN_OUT"
	| "MISSING_NEW_SOURCE_ENDPOINT";

export interface PostAuditCompactionDecision {
	relation: Relation;
	state: PostAuditCompactionState;
	reason: PostAuditCompactionReason;
	newSourceEndpointId: string | null;
}

export interface PostAuditCompactionResult {
	canonical: Relation[];
	deferred: Relation[];
	decisions: PostAuditCompactionDecision[];
}

/**
 * Keep audited strong relations intact while bounding the weaker RELATED_TO layer.
 *
 * This function cannot see benchmark labels or audit outcomes beyond the fact that
 * its input already passed semantic lint. It answers a separate question: which
 * individually useful RELATED_TO edges add enough marginal set-level coverage to
 * justify canonical graph traversal cost?
 */
export function compactAuditedRelations(
	auditedRelations: Relation[],
	newSourceEndpointIds: ReadonlySet<string>,
	endpointStatements: ReadonlyMap<string, string>,
	sourcePublicationBudget = RELATED_TO_SOURCE_PUBLICATION_BUDGET,
	maximumPerNewEndpoint = RELATED_TO_MAX_PER_NEW_ENDPOINT,
): PostAuditCompactionResult {
	validateBudget("RELATED_TO source publication budget", sourcePublicationBudget, 0);
	validateBudget("RELATED_TO endpoint fan-out", maximumPerNewEndpoint, 1);

	const strong = auditedRelations.filter((relation) => relation.type !== "RELATED_TO");
	const related = auditedRelations.filter((relation) => relation.type === "RELATED_TO");
	const endpointByRelationId = new Map(
		related.map((relation) => [relation.id, newSourceEndpoint(relation, newSourceEndpointIds)]),
	);
	const relatedWithEndpoint = related.filter(
		(relation) => endpointByRelationId.get(relation.id) !== null,
	);
	const baseRanked = [...relatedWithEndpoint].sort((left, right) =>
		baseRelationOrder(left, right, endpointStatements),
	);
	const baseRank = new Map(baseRanked.map((relation, index) => [relation.id, index]));
	const byEndpoint = new Map<string, Relation[]>();
	for (const relation of baseRanked) {
		const endpoint = endpointByRelationId.get(relation.id);
		if (!endpoint) continue;
		const siblings = byEndpoint.get(endpoint) ?? [];
		siblings.push(relation);
		byEndpoint.set(endpoint, siblings);
	}
	const endpointGroups = [...byEndpoint.entries()].sort(
		([leftId, left], [rightId, right]) =>
			(baseRank.get(left[0]?.id ?? "") ?? Number.POSITIVE_INFINITY) -
				(baseRank.get(right[0]?.id ?? "") ?? Number.POSITIVE_INFINITY) ||
			leftId.localeCompare(rightId),
	);

	const selected: Relation[] = [];
	const selectedIds = new Set<string>();
	const selectedByEndpoint = new Map<string, Relation[]>();
	const reasons = new Map<string, PostAuditCompactionReason>();
	const select = (relation: Relation, reason: PostAuditCompactionReason): boolean => {
		if (selectedIds.has(relation.id)) return true;
		if (selected.length >= sourcePublicationBudget) return false;
		const endpoint = endpointByRelationId.get(relation.id);
		if (!endpoint) return false;
		const siblings = selectedByEndpoint.get(endpoint) ?? [];
		if (siblings.length >= maximumPerNewEndpoint) return false;
		selected.push(relation);
		selectedIds.add(relation.id);
		reasons.set(relation.id, reason);
		selectedByEndpoint.set(endpoint, [...siblings, relation]);
		return true;
	};

	// First preserve breadth across new Source claims.
	for (const [, candidates] of endpointGroups) {
		const candidate = candidates[0];
		if (candidate) select(candidate, "RELATED_TO_ENDPOINT_COVERAGE");
	}

	// Then add one marginally distinct facet per endpoint per round. This keeps a
	// single high-degree claim from consuming the entire source budget at once.
	let madeProgress = true;
	while (madeProgress && selected.length < sourcePublicationBudget) {
		madeProgress = false;
		for (const [endpoint, candidates] of endpointGroups) {
			const siblings = selectedByEndpoint.get(endpoint) ?? [];
			if (siblings.length >= maximumPerNewEndpoint) continue;
			const candidate = candidates
				.filter((relation) => !selectedIds.has(relation.id))
				.sort(
					(left, right) =>
						marginalNovelty(right, endpoint, siblings, endpointStatements) -
							marginalNovelty(left, endpoint, siblings, endpointStatements) ||
						baseRelationOrder(left, right, endpointStatements),
				)[0];
			if (!candidate) continue;
			if (select(candidate, "RELATED_TO_FACET_DIVERSITY")) madeProgress = true;
			if (selected.length >= sourcePublicationBudget) break;
		}
	}

	const decisions: PostAuditCompactionDecision[] = [
		...strong.map((relation) => ({
			relation,
			state: "CANONICAL_READY" as const,
			reason: "STRONG_RELATION_BYPASS" as const,
			newSourceEndpointId: newSourceEndpoint(relation, newSourceEndpointIds),
		})),
		...related.map((relation) => {
			const endpoint = endpointByRelationId.get(relation.id) ?? null;
			if (selectedIds.has(relation.id)) {
				return {
					relation,
					state: "CANONICAL_READY" as const,
					reason: reasons.get(relation.id) ?? ("RELATED_TO_FACET_DIVERSITY" as const),
					newSourceEndpointId: endpoint,
				};
			}
			const endpointCount = endpoint ? (selectedByEndpoint.get(endpoint)?.length ?? 0) : 0;
			return {
				relation: { ...relation, publicationState: "CANDIDATE" as const },
				state: "DEFERRED_BY_GRAPH_DIVERSITY" as const,
				reason: endpoint
					? endpointCount >= maximumPerNewEndpoint
						? ("RELATED_TO_ENDPOINT_FAN_OUT" as const)
						: ("RELATED_TO_SOURCE_PUBLICATION_BUDGET" as const)
					: ("MISSING_NEW_SOURCE_ENDPOINT" as const),
				newSourceEndpointId: endpoint,
			};
		}),
	];
	return {
		canonical: [...strong, ...selected],
		deferred: decisions
			.filter((decision) => decision.state === "DEFERRED_BY_GRAPH_DIVERSITY")
			.map((decision) => decision.relation),
		decisions,
	};
}

function validateBudget(label: string, value: number, minimum: number): void {
	if (value === Number.POSITIVE_INFINITY) return;
	if (!Number.isSafeInteger(value) || value < minimum) {
		throw new Error(`Invalid ${label}: ${value}`);
	}
}

function newSourceEndpoint(
	relation: Relation,
	newSourceEndpointIds: ReadonlySet<string>,
): string | null {
	const endpoints = [relation.from as string, relation.to as string]
		.filter((endpoint) => newSourceEndpointIds.has(endpoint))
		.sort();
	return endpoints[0] ?? null;
}

function baseRelationOrder(
	left: Relation,
	right: Relation,
	endpointStatements: ReadonlyMap<string, string>,
): number {
	return (
		right.confidence - left.confidence ||
		lexicalAffinity(
			endpointStatements.get(right.from as string) ?? "",
			endpointStatements.get(right.to as string) ?? "",
		) -
			lexicalAffinity(
				endpointStatements.get(left.from as string) ?? "",
				endpointStatements.get(left.to as string) ?? "",
			) ||
		left.id.localeCompare(right.id)
	);
}

function marginalNovelty(
	relation: Relation,
	newEndpoint: string,
	selectedSiblings: Relation[],
	endpointStatements: ReadonlyMap<string, string>,
): number {
	if (selectedSiblings.length === 0) return 1;
	const statement = endpointStatements.get(oppositeEndpoint(relation, newEndpoint)) ?? "";
	const maximumSimilarity = Math.max(
		0,
		...selectedSiblings.map((sibling) =>
			lexicalAffinity(
				statement,
				endpointStatements.get(oppositeEndpoint(sibling, newEndpoint)) ?? "",
			),
		),
	);
	return 1 - maximumSimilarity;
}

function oppositeEndpoint(relation: Relation, endpoint: string): string {
	return (relation.from as string) === endpoint
		? (relation.to as string)
		: (relation.from as string);
}

/** Same domain-neutral tokenizer used by pre-audit scheduling, intentionally label-blind. */
function lexicalAffinity(left: string, right: string): number {
	const leftTokens = lexicalTokens(left);
	const rightTokens = lexicalTokens(right);
	if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
	let overlap = 0;
	for (const token of leftTokens) if (rightTokens.has(token)) overlap += 1;
	return overlap / Math.min(leftTokens.size, rightTokens.size);
}

function lexicalTokens(value: string): Set<string> {
	const normalized = value.normalize("NFKC").toLocaleLowerCase("und");
	const tokens = new Set(normalized.match(/[\p{Script=Latin}\p{N}]+/gu) ?? []);
	const cjkCharacters = normalized.match(
		/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu,
	);
	if (!cjkCharacters) return tokens;
	if (cjkCharacters.length === 1) tokens.add(cjkCharacters[0] as string);
	for (let index = 0; index < cjkCharacters.length - 1; index += 1) {
		tokens.add(`${cjkCharacters[index]}${cjkCharacters[index + 1]}`);
	}
	return tokens;
}
