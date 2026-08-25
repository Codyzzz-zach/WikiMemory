import { createHash } from "node:crypto";

export const QUESTION_STATE_PROJECTION_SCHEMA_VERSION = "wge-question-state-projection/v1";
export const QUESTION_STATE_PROJECTION_VERSION = "c1-question-state-projection/v1";

export type BranchStanding = "LEADING" | "CO_LEADING" | "ALTERNATIVE" | "HISTORICAL" | "UNRANKED";
export type BranchQualifier = "CONDITIONAL" | "CONTESTED" | "UNRESOLVED";
export type ProjectionDimension =
	| "grounding"
	| "authority"
	| "currentness"
	| "applicability"
	| "relational_support"
	| "uncertainty";
export type ProjectionOrdinal = "HIGHER" | "EQUAL" | "LOWER" | "UNKNOWN";
export type ProjectionReasonCode =
	| "DIRECT_EVIDENCE_PRESENT"
	| "CLAIM_CLOSURE_COMPLETE"
	| "SAME_AUTHORITY_SUCCESSOR"
	| "PEER_AUTHORITIES_EQUAL"
	| "AUTHORITY_NOT_COMPARABLE"
	| "EFFECTIVE_BASELINE"
	| "LATER_EFFECTIVE_REPLACEMENT"
	| "APPLICABILITY_MATCH"
	| "APPLICABILITY_PARTIAL"
	| "CONDITION_REQUIRED"
	| "OUTSIDE_SUPERSESSION_SCOPE"
	| "EXPLICIT_SUPERSESSION"
	| "EXPLICIT_CONTRADICTION"
	| "PEER_CONFLICT_UNRESOLVED"
	| "NO_AUTHORIZED_DECISION"
	| "INSUFFICIENT_EVIDENCE";

export interface ProjectionKnowledgeScope {
	type: "GLOBAL" | "PERSONAL" | "PROJECT";
	id?: string;
}

export interface ProjectionEvidenceSpanInput {
	id: string;
	documentId: string;
	locator: {
		heading?: string;
		paragraphContains?: string;
	};
	sourceSha256: string;
}

export interface ProjectionClaimInput {
	id: string;
	statement: string;
	authority: string;
	authorityClass: "POLICY_OWNER" | "PEER_ADVISORY" | "FACTUAL_RECORD";
	claimStatus: "EFFECTIVE" | "PROPOSED" | "OBSERVED";
	effectiveFrom: string | null;
	knowledgeScope: ProjectionKnowledgeScope;
	applicability: string[];
	conditions: string[];
	evidenceSpanIds: string[];
}

export interface ProjectionRelationInput {
	id: string;
	from: string;
	to: string;
	type: "SUPERSEDES" | "CONTRADICTS" | "SUPPORTS";
	relationStatus: "EXPLICIT" | "UNRESOLVED";
	applicability: string[];
	conditions: string[];
	evidenceSpanIds: string[];
}

export interface QuestionStateProjectionInput {
	questionRef: string;
	knowledgeVersion: string;
	inputClosureHash: string;
	claims: ProjectionClaimInput[];
	relations: ProjectionRelationInput[];
	evidenceSpans: ProjectionEvidenceSpanInput[];
}

export interface ProjectionDimensionReason {
	dimension: ProjectionDimension;
	ordinal: ProjectionOrdinal;
	reasonCodes: ProjectionReasonCode[];
	claimRefs: string[];
	relationIds: string[];
	evidenceSpanIds: string[];
}

export interface QuestionStateBranchAssessment {
	branchId: string;
	claimRefs: string[];
	standing: BranchStanding;
	qualifiers: BranchQualifier[];
	scope: {
		knowledgeScope: ProjectionKnowledgeScope;
		applicability: string[];
	};
	conditions: string[];
	dimensionReasons: ProjectionDimensionReason[];
}

export interface QuestionStateUnresolvedFactor {
	factorId: string;
	reasonCode: "PEER_CONFLICT_UNRESOLVED" | "NO_AUTHORIZED_DECISION" | "INSUFFICIENT_EVIDENCE";
	description: string;
	claimRefs: string[];
	relationIds: string[];
	evidenceSpanIds: string[];
}

export interface QuestionStateProjection {
	schemaVersion: typeof QUESTION_STATE_PROJECTION_SCHEMA_VERSION;
	questionRef: string;
	knowledgeVersion: string;
	inputClosureHash: string;
	branchAssessments: QuestionStateBranchAssessment[];
	unresolvedFactors: QuestionStateUnresolvedFactor[];
	projectionVersion: typeof QUESTION_STATE_PROJECTION_VERSION;
	projectionHash: string;
}

interface InputIndex {
	claimById: Map<string, ProjectionClaimInput>;
	relationById: Map<string, ProjectionRelationInput>;
	evidenceSpanById: Map<string, ProjectionEvidenceSpanInput>;
}

interface ReasonSeed {
	dimension: ProjectionDimension;
	ordinal: ProjectionOrdinal;
	reasonCodes: ProjectionReasonCode[];
	claimRefs: string[];
	relationIds: string[];
}

const dimensionOrder: ProjectionDimension[] = [
	"grounding",
	"authority",
	"currentness",
	"applicability",
	"relational_support",
	"uncertainty",
];
const qualifierOrder: BranchQualifier[] = ["CONDITIONAL", "CONTESTED", "UNRESOLVED"];

export function questionStateInputClosureHash(
	input: Omit<QuestionStateProjectionInput, "inputClosureHash">,
): string {
	return hashCanonical({
		questionRef: input.questionRef,
		knowledgeVersion: input.knowledgeVersion,
		claims: sortById(input.claims),
		relations: sortById(input.relations),
		evidenceSpans: sortById(input.evidenceSpans),
	});
}

export function projectQuestionState(input: QuestionStateProjectionInput): QuestionStateProjection {
	const index = validateInput(input);
	const branchAssessments = buildBranchAssessments(input, index);
	const unresolvedFactors = buildUnresolvedFactors(input, index);
	const projectionWithoutHash: Omit<QuestionStateProjection, "projectionHash"> = {
		schemaVersion: QUESTION_STATE_PROJECTION_SCHEMA_VERSION,
		questionRef: input.questionRef,
		knowledgeVersion: input.knowledgeVersion,
		inputClosureHash: input.inputClosureHash,
		branchAssessments,
		unresolvedFactors,
		projectionVersion: QUESTION_STATE_PROJECTION_VERSION,
	};
	return {
		...projectionWithoutHash,
		projectionHash: hashCanonical(projectionWithoutHash),
	};
}

export function serializeQuestionStateProjection(projection: QuestionStateProjection): string {
	const { projectionHash, ...withoutHash } = projection;
	const expectedHash = hashCanonical(withoutHash);
	if (projectionHash !== expectedHash) {
		throw new Error(
			`QuestionStateProjection hash mismatch: ${projection.projectionHash} != ${expectedHash}`,
		);
	}
	return `${stableStringify(projection)}\n`;
}

function validateInput(input: QuestionStateProjectionInput): InputIndex {
	if (!input.questionRef.startsWith("question:")) {
		throw new Error(`QuestionStateProjection requires a question: ref: ${input.questionRef}`);
	}
	if (!input.knowledgeVersion.trim()) {
		throw new Error("QuestionStateProjection requires knowledgeVersion");
	}
	if (!/^[a-f0-9]{64}$/.test(input.inputClosureHash)) {
		throw new Error("QuestionStateProjection requires a SHA-256 inputClosureHash");
	}
	const expectedClosureHash = questionStateInputClosureHash(input);
	if (input.inputClosureHash !== expectedClosureHash) {
		throw new Error(
			`QuestionStateProjection input closure hash mismatch: ${input.inputClosureHash} != ${expectedClosureHash}`,
		);
	}
	const evidenceSpanById = uniqueIndex(input.evidenceSpans, "EvidenceSpan");
	const claimById = uniqueIndex(input.claims, "Claim");
	const relationById = uniqueIndex(input.relations, "Relation");
	for (const claim of input.claims) {
		if (!claim.id.startsWith("claim:"))
			throw new Error(`Invalid projection Claim ref: ${claim.id}`);
		if (!claim.statement.trim())
			throw new Error(`Projection Claim statement is empty: ${claim.id}`);
		if (!claim.authority.trim())
			throw new Error(`Projection Claim authority is empty: ${claim.id}`);
		assertKnowledgeScope(claim.knowledgeScope, claim.id);
		assertNonEmptyUniqueStrings(claim.applicability, `${claim.id}.applicability`);
		assertUniqueStrings(claim.conditions, `${claim.id}.conditions`);
		assertNonEmptyUniqueStrings(claim.evidenceSpanIds, `${claim.id}.evidenceSpanIds`);
		for (const spanId of claim.evidenceSpanIds) {
			if (!evidenceSpanById.has(spanId)) {
				throw new Error(
					`Projection Claim references missing EvidenceSpan: ${claim.id} -> ${spanId}`,
				);
			}
		}
		if (claim.claimStatus === "EFFECTIVE" && !claim.effectiveFrom) {
			throw new Error(`Effective projection Claim requires effectiveFrom: ${claim.id}`);
		}
		if (claim.claimStatus !== "EFFECTIVE" && claim.effectiveFrom) {
			throw new Error(`Non-effective projection Claim cannot carry effectiveFrom: ${claim.id}`);
		}
	}
	for (const relation of input.relations) {
		if (!relation.id.startsWith("relation:")) {
			throw new Error(`Invalid projection Relation ref: ${relation.id}`);
		}
		if (!claimById.has(relation.from) || !claimById.has(relation.to)) {
			throw new Error(
				`Projection Relation references missing Claim: ${relation.id}: ${relation.from} -> ${relation.to}`,
			);
		}
		if (relation.from === relation.to) {
			throw new Error(`Projection Relation cannot self-reference: ${relation.id}`);
		}
		assertNonEmptyUniqueStrings(relation.applicability, `${relation.id}.applicability`);
		assertUniqueStrings(relation.conditions, `${relation.id}.conditions`);
		assertNonEmptyUniqueStrings(relation.evidenceSpanIds, `${relation.id}.evidenceSpanIds`);
		for (const spanId of relation.evidenceSpanIds) {
			if (!evidenceSpanById.has(spanId)) {
				throw new Error(
					`Projection Relation references missing EvidenceSpan: ${relation.id} -> ${spanId}`,
				);
			}
		}
		if (relation.type === "SUPERSEDES" && relation.relationStatus !== "EXPLICIT") {
			throw new Error(`SUPERSEDES must be explicit in C1 pure shadow: ${relation.id}`);
		}
	}
	for (const span of input.evidenceSpans) {
		if (!span.id.startsWith("span:"))
			throw new Error(`Invalid projection EvidenceSpan ref: ${span.id}`);
		if (!span.documentId.trim()) throw new Error(`EvidenceSpan documentId is empty: ${span.id}`);
		if (!/^[a-f0-9]{64}$/.test(span.sourceSha256)) {
			throw new Error(`EvidenceSpan sourceSha256 is invalid: ${span.id}`);
		}
		const locatorCount =
			Number(Boolean(span.locator.heading)) + Number(Boolean(span.locator.paragraphContains));
		if (locatorCount !== 1)
			throw new Error(`EvidenceSpan requires exactly one locator: ${span.id}`);
	}
	if (!input.claims.some((claim) => claim.claimStatus !== "OBSERVED")) {
		throw new Error("QuestionStateProjection requires at least one branch Claim");
	}
	return { claimById, relationById, evidenceSpanById };
}

function buildBranchAssessments(
	input: QuestionStateProjectionInput,
	index: InputIndex,
): QuestionStateBranchAssessment[] {
	const branchClaimIds = input.claims
		.filter((claim) => claim.claimStatus !== "OBSERVED")
		.map((claim) => claim.id)
		.sort();
	const parent = new Map(branchClaimIds.map((id) => [id, id]));
	for (const relation of input.relations) {
		if (relation.type !== "SUPPORTS" || relation.relationStatus !== "EXPLICIT") continue;
		const from = index.claimById.get(relation.from);
		const to = index.claimById.get(relation.to);
		if (!from || !to || from.claimStatus !== "EFFECTIVE" || to.claimStatus !== "EFFECTIVE")
			continue;
		if (from.authority !== to.authority) continue;
		if (stableStringify(from.knowledgeScope) !== stableStringify(to.knowledgeScope)) continue;
		if (
			stableStringify([...from.applicability].sort()) !==
			stableStringify([...to.applicability].sort())
		) {
			continue;
		}
		union(parent, from.id, to.id);
	}
	const components = new Map<string, string[]>();
	for (const claimId of branchClaimIds) {
		const root = findRoot(parent, claimId);
		components.set(root, [...(components.get(root) ?? []), claimId]);
	}
	return [...components.values()]
		.map((claimRefs) => buildBranchAssessment(input, index, claimRefs.sort()))
		.sort((left, right) => left.branchId.localeCompare(right.branchId));
}

function buildBranchAssessment(
	input: QuestionStateProjectionInput,
	index: InputIndex,
	claimRefs: string[],
): QuestionStateBranchAssessment {
	const claims = claimRefs.map((claimRef) => required(index.claimById, claimRef, "Claim"));
	const claimSet = new Set(claimRefs);
	const incomingSupersessionRelations = input.relations.filter(
		(relation) =>
			relation.type === "SUPERSEDES" && claimSet.has(relation.to) && !claimSet.has(relation.from),
	);
	const outgoingSupersessionRelations = input.relations.filter(
		(relation) =>
			relation.type === "SUPERSEDES" && claimSet.has(relation.from) && !claimSet.has(relation.to),
	);
	const incomingSupersessions = incomingSupersessionRelations.filter((relation) =>
		isTotalEffectiveSupersession(relation, index),
	);
	const outgoingSupersessions = outgoingSupersessionRelations.filter((relation) =>
		isTotalEffectiveSupersession(relation, index),
	);
	const conditionalSupersessions = uniqueRelations(
		[...incomingSupersessionRelations, ...outgoingSupersessionRelations].filter(
			(relation) => !isTotalEffectiveSupersession(relation, index),
		),
	);
	const contradictions = input.relations.filter(
		(relation) =>
			relation.type === "CONTRADICTS" && (claimSet.has(relation.from) || claimSet.has(relation.to)),
	);
	const supports = input.relations.filter(
		(relation) =>
			relation.type === "SUPPORTS" && claimSet.has(relation.from) && claimSet.has(relation.to),
	);
	const unresolvedContradictions = contradictions.filter(
		(relation) => relation.relationStatus === "UNRESOLVED",
	);
	const hasProposedClaim = claims.some((claim) => claim.claimStatus === "PROPOSED");
	const conditions = uniqueSorted([
		...claims.flatMap((claim) => claim.conditions),
		...conditionalSupersessions.flatMap((relation) => relation.conditions),
	]);
	const qualifiers = new Set<BranchQualifier>();
	if (conditions.length > 0) qualifiers.add("CONDITIONAL");
	if (hasProposedClaim && contradictions.length > 0) qualifiers.add("CONTESTED");
	if (hasProposedClaim && unresolvedContradictions.length > 0) qualifiers.add("UNRESOLVED");
	const standing: BranchStanding =
		incomingSupersessions.length > 0
			? "HISTORICAL"
			: hasProposedClaim
				? unresolvedContradictions.length > 0
					? "UNRANKED"
					: "ALTERNATIVE"
				: "LEADING";
	const knowledgeScope = commonKnowledgeScope(claims);
	const applicability = uniqueSorted(claims.flatMap((claim) => claim.applicability));
	const reasonSeeds: ReasonSeed[] = [
		{
			dimension: "grounding",
			ordinal: "EQUAL",
			reasonCodes: ["DIRECT_EVIDENCE_PRESENT", "CLAIM_CLOSURE_COMPLETE"],
			claimRefs,
			relationIds: [],
		},
	];
	const totalSupersessions = uniqueRelations([...incomingSupersessions, ...outgoingSupersessions]);
	const allSupersessions = uniqueRelations([
		...incomingSupersessionRelations,
		...outgoingSupersessionRelations,
	]);
	if (allSupersessions.length > 0) {
		const allSameAuthority = allSupersessions.every((relation) => {
			const from = required(index.claimById, relation.from, "Claim");
			const to = required(index.claimById, relation.to, "Claim");
			return from.authority === to.authority;
		});
		reasonSeeds.push({
			dimension: "authority",
			ordinal: incomingSupersessions.length > 0 ? "LOWER" : "EQUAL",
			reasonCodes: [allSameAuthority ? "SAME_AUTHORITY_SUCCESSOR" : "AUTHORITY_NOT_COMPARABLE"],
			claimRefs: relationClaimRefs(allSupersessions),
			relationIds: allSupersessions.map((relation) => relation.id),
		});
	}
	if (totalSupersessions.length > 0) {
		reasonSeeds.push({
			dimension: "currentness",
			ordinal: incomingSupersessions.length > 0 ? "LOWER" : "HIGHER",
			reasonCodes: ["LATER_EFFECTIVE_REPLACEMENT"],
			claimRefs: relationClaimRefs(totalSupersessions),
			relationIds: totalSupersessions.map((relation) => relation.id),
		});
	} else if (claims.some((claim) => claim.claimStatus === "EFFECTIVE")) {
		reasonSeeds.push({
			dimension: "currentness",
			ordinal: "EQUAL",
			reasonCodes: ["EFFECTIVE_BASELINE"],
			claimRefs,
			relationIds: [],
		});
	}
	if (allSupersessions.length > 0) {
		reasonSeeds.push({
			dimension: "relational_support",
			ordinal:
				totalSupersessions.length === 0
					? "EQUAL"
					: incomingSupersessions.length > 0
						? "LOWER"
						: "HIGHER",
			reasonCodes: ["EXPLICIT_SUPERSESSION"],
			claimRefs: relationClaimRefs(allSupersessions),
			relationIds: allSupersessions.map((relation) => relation.id),
		});
	}
	if (conditions.length > 0) {
		reasonSeeds.push({
			dimension: "applicability",
			ordinal: "EQUAL",
			reasonCodes: ["CONDITION_REQUIRED"],
			claimRefs,
			relationIds: [],
		});
	} else {
		const preservesAcrossUpdate =
			supports.length > 0 && input.relations.some((relation) => relation.type === "SUPERSEDES");
		reasonSeeds.push({
			dimension: "applicability",
			ordinal: "EQUAL",
			reasonCodes: [preservesAcrossUpdate ? "OUTSIDE_SUPERSESSION_SCOPE" : "APPLICABILITY_MATCH"],
			claimRefs,
			relationIds: preservesAcrossUpdate ? supports.map((relation) => relation.id) : [],
		});
	}
	if (conditionalSupersessions.length > 0) {
		reasonSeeds.push({
			dimension: "applicability",
			ordinal: "UNKNOWN",
			reasonCodes: ["APPLICABILITY_PARTIAL"],
			claimRefs: relationClaimRefs(conditionalSupersessions),
			relationIds: conditionalSupersessions.map((relation) => relation.id),
		});
	}
	if (contradictions.length > 0) {
		const peerContradictions = contradictions.filter((relation) => isPeerConflict(relation, index));
		const nonPeerContradictions = contradictions.filter(
			(relation) => !isPeerConflict(relation, index),
		);
		if (peerContradictions.length > 0) {
			reasonSeeds.push({
				dimension: "authority",
				ordinal: "EQUAL",
				reasonCodes: ["PEER_AUTHORITIES_EQUAL"],
				claimRefs: relationClaimRefs(peerContradictions),
				relationIds: peerContradictions.map((relation) => relation.id),
			});
		}
		if (nonPeerContradictions.length > 0) {
			reasonSeeds.push({
				dimension: "authority",
				ordinal: "UNKNOWN",
				reasonCodes: ["AUTHORITY_NOT_COMPARABLE"],
				claimRefs: relationClaimRefs(nonPeerContradictions),
				relationIds: nonPeerContradictions.map((relation) => relation.id),
			});
		}
		reasonSeeds.push({
			dimension: "relational_support",
			ordinal: "EQUAL",
			reasonCodes: ["EXPLICIT_CONTRADICTION"],
			claimRefs: relationClaimRefs(contradictions),
			relationIds: contradictions.map((relation) => relation.id),
		});
		const peerConflict = unresolvedContradictions.some((relation) =>
			isPeerConflict(relation, index),
		);
		const noAuthorizedDecision = unresolvedContradictions.some((relation) =>
			hasNoAuthorizedDecisionEvidence(relation, input, index),
		);
		const uncertaintyCodes: ProjectionReasonCode[] = [];
		if (peerConflict) uncertaintyCodes.push("PEER_CONFLICT_UNRESOLVED");
		if (noAuthorizedDecision) uncertaintyCodes.push("NO_AUTHORIZED_DECISION");
		if (unresolvedContradictions.length > 0 && uncertaintyCodes.length === 0) {
			uncertaintyCodes.push("INSUFFICIENT_EVIDENCE");
		}
		if (uncertaintyCodes.length > 0) {
			reasonSeeds.push({
				dimension: "uncertainty",
				ordinal: "UNKNOWN",
				reasonCodes: uncertaintyCodes,
				claimRefs: relationClaimRefs(unresolvedContradictions),
				relationIds: unresolvedContradictions.map((relation) => relation.id),
			});
		}
	}
	const anchor = [...claims].sort((left, right) => {
		const dateOrder = (left.effectiveFrom ?? "9999").localeCompare(right.effectiveFrom ?? "9999");
		return dateOrder || left.id.localeCompare(right.id);
	})[0];
	if (!anchor) throw new Error("QuestionStateProjection branch cannot be empty");
	return {
		branchId: `branch:c1:${hashCanonical({ questionRef: input.questionRef, anchorClaimRef: anchor.id }).slice(0, 24)}`,
		claimRefs,
		standing,
		qualifiers: qualifierOrder.filter((qualifier) => qualifiers.has(qualifier)),
		scope: { knowledgeScope, applicability },
		conditions,
		dimensionReasons: reasonSeeds
			.map((seed) => materializeReason(seed, index))
			.sort(
				(left, right) =>
					dimensionOrder.indexOf(left.dimension) - dimensionOrder.indexOf(right.dimension) ||
					left.reasonCodes.join("|").localeCompare(right.reasonCodes.join("|")),
			),
	};
}

function buildUnresolvedFactors(
	input: QuestionStateProjectionInput,
	index: InputIndex,
): QuestionStateUnresolvedFactor[] {
	const seeds = new Map<
		QuestionStateUnresolvedFactor["reasonCode"],
		{ claimRefs: Set<string>; relationIds: Set<string>; evidenceSpanIds: Set<string> }
	>();
	for (const relation of input.relations) {
		if (relation.type !== "CONTRADICTS" || relation.relationStatus !== "UNRESOLVED") continue;
		const codes: QuestionStateUnresolvedFactor["reasonCode"][] = [];
		if (isPeerConflict(relation, index)) codes.push("PEER_CONFLICT_UNRESOLVED");
		if (hasNoAuthorizedDecisionEvidence(relation, input, index))
			codes.push("NO_AUTHORIZED_DECISION");
		if (codes.length === 0) codes.push("INSUFFICIENT_EVIDENCE");
		const observedClaims = observedClaimsSharingEvidence(relation, input);
		for (const code of codes) {
			const seed = seeds.get(code) ?? {
				claimRefs: new Set<string>(),
				relationIds: new Set<string>(),
				evidenceSpanIds: new Set<string>(),
			};
			seed.claimRefs.add(relation.from);
			seed.claimRefs.add(relation.to);
			for (const claim of observedClaims) {
				seed.claimRefs.add(claim.id);
				for (const spanId of claim.evidenceSpanIds) seed.evidenceSpanIds.add(spanId);
			}
			seed.relationIds.add(relation.id);
			for (const spanId of relation.evidenceSpanIds) seed.evidenceSpanIds.add(spanId);
			seeds.set(code, seed);
		}
	}
	return [...seeds.entries()]
		.map(([reasonCode, seed]) => {
			const claimRefs = [...seed.claimRefs].sort();
			const relationIds = [...seed.relationIds].sort();
			const evidenceSpanIds = [...seed.evidenceSpanIds].sort();
			return {
				factorId: `unresolved:c1:${hashCanonical({ reasonCode, claimRefs, relationIds }).slice(0, 24)}`,
				reasonCode,
				description: unresolvedDescription(reasonCode),
				claimRefs,
				relationIds,
				evidenceSpanIds,
			};
		})
		.sort((left, right) => left.factorId.localeCompare(right.factorId));
}

function materializeReason(seed: ReasonSeed, index: InputIndex): ProjectionDimensionReason {
	const claimRefs = uniqueSorted(seed.claimRefs);
	const relationIds = uniqueSorted(seed.relationIds);
	const evidenceSpanIds = uniqueSorted([
		...claimRefs.flatMap(
			(claimRef) => required(index.claimById, claimRef, "Claim").evidenceSpanIds,
		),
		...relationIds.flatMap(
			(relationId) => required(index.relationById, relationId, "Relation").evidenceSpanIds,
		),
	]);
	if (claimRefs.length === 0 || evidenceSpanIds.length === 0) {
		throw new Error(
			`Projection reason is not grounded: ${seed.dimension}:${seed.reasonCodes.join("|")}`,
		);
	}
	for (const spanId of evidenceSpanIds) required(index.evidenceSpanById, spanId, "EvidenceSpan");
	return {
		dimension: seed.dimension,
		ordinal: seed.ordinal,
		reasonCodes: uniqueSorted(seed.reasonCodes) as ProjectionReasonCode[],
		claimRefs,
		relationIds,
		evidenceSpanIds,
	};
}

function commonKnowledgeScope(claims: ProjectionClaimInput[]): ProjectionKnowledgeScope {
	const [first, ...rest] = claims;
	if (!first) throw new Error("Projection branch cannot be empty");
	const serialized = stableStringify(first.knowledgeScope);
	if (rest.some((claim) => stableStringify(claim.knowledgeScope) !== serialized)) {
		throw new Error(
			`Projection branch crosses knowledge scopes: ${claims.map((claim) => claim.id).join(", ")}`,
		);
	}
	return { ...first.knowledgeScope };
}

function isTotalEffectiveSupersession(
	relation: ProjectionRelationInput,
	index: InputIndex,
): boolean {
	if (relation.type !== "SUPERSEDES" || relation.relationStatus !== "EXPLICIT") return false;
	const successor = required(index.claimById, relation.from, "Claim");
	if (successor.claimStatus !== "EFFECTIVE" || !successor.effectiveFrom) return false;
	const effectiveCondition = `effective on or after ${successor.effectiveFrom}`;
	return relation.conditions.every((condition) => condition === effectiveCondition);
}

function isPeerConflict(relation: ProjectionRelationInput, index: InputIndex): boolean {
	const from = required(index.claimById, relation.from, "Claim");
	const to = required(index.claimById, relation.to, "Claim");
	return (
		from.authorityClass === "PEER_ADVISORY" &&
		to.authorityClass === "PEER_ADVISORY" &&
		from.authority !== to.authority
	);
}

function hasNoAuthorizedDecisionEvidence(
	relation: ProjectionRelationInput,
	input: QuestionStateProjectionInput,
	index: InputIndex,
): boolean {
	const from = required(index.claimById, relation.from, "Claim");
	const to = required(index.claimById, relation.to, "Claim");
	const hasUneffectiveProposal = [from, to].some(
		(claim) => claim.claimStatus === "PROPOSED" && claim.effectiveFrom === null,
	);
	return hasUneffectiveProposal && observedClaimsSharingEvidence(relation, input).length > 0;
}

function observedClaimsSharingEvidence(
	relation: ProjectionRelationInput,
	input: QuestionStateProjectionInput,
): ProjectionClaimInput[] {
	const relationEvidence = new Set(relation.evidenceSpanIds);
	return input.claims.filter(
		(claim) =>
			claim.claimStatus === "OBSERVED" &&
			claim.evidenceSpanIds.some((spanId) => relationEvidence.has(spanId)),
	);
}

function relationClaimRefs(relations: ProjectionRelationInput[]): string[] {
	return uniqueSorted(relations.flatMap((relation) => [relation.from, relation.to]));
}

function uniqueRelations(relations: ProjectionRelationInput[]): ProjectionRelationInput[] {
	return [...new Map(relations.map((relation) => [relation.id, relation])).values()].sort(
		(left, right) => left.id.localeCompare(right.id),
	);
}

function unresolvedDescription(code: QuestionStateUnresolvedFactor["reasonCode"]): string {
	switch (code) {
		case "PEER_CONFLICT_UNRESOLVED":
			return "Peer branches remain unresolved in the frozen evidence closure.";
		case "NO_AUTHORIZED_DECISION":
			return "No effective authorized decision resolves the frozen conflict.";
		case "INSUFFICIENT_EVIDENCE":
			return "The frozen evidence closure is insufficient to rank the conflicting branches.";
	}
}

function assertKnowledgeScope(scope: ProjectionKnowledgeScope, owner: string): void {
	if (scope.type === "PROJECT" && !scope.id?.trim()) {
		throw new Error(`PROJECT knowledge scope requires id: ${owner}`);
	}
	if (scope.type !== "PROJECT" && scope.id) {
		throw new Error(`Only PROJECT knowledge scope may carry id: ${owner}`);
	}
}

function assertNonEmptyUniqueStrings(values: string[], field: string): void {
	if (values.length === 0) throw new Error(`${field} cannot be empty`);
	assertUniqueStrings(values, field);
}

function assertUniqueStrings(values: string[], field: string): void {
	if (values.some((value) => !value.trim())) throw new Error(`${field} contains an empty value`);
	if (new Set(values).size !== values.length) throw new Error(`${field} contains duplicate values`);
}

function uniqueIndex<T extends { id: string }>(items: T[], label: string): Map<string, T> {
	const index = new Map<string, T>();
	for (const item of items) {
		if (index.has(item.id)) throw new Error(`Duplicate projection ${label}: ${item.id}`);
		index.set(item.id, item);
	}
	return index;
}

function required<T>(index: Map<string, T>, id: string, label: string): T {
	const value = index.get(id);
	if (!value) throw new Error(`Missing projection ${label}: ${id}`);
	return value;
}

function findRoot(parent: Map<string, string>, id: string): string {
	const current = required(parent, id, "branch parent");
	if (current === id) return id;
	const root = findRoot(parent, current);
	parent.set(id, root);
	return root;
}

function union(parent: Map<string, string>, left: string, right: string): void {
	const leftRoot = findRoot(parent, left);
	const rightRoot = findRoot(parent, right);
	if (leftRoot === rightRoot) return;
	const [first, second] = [leftRoot, rightRoot].sort();
	if (!first || !second) throw new Error("Projection branch union failed");
	parent.set(second, first);
}

function sortById<T extends { id: string }>(items: T[]): T[] {
	return [...items].sort((left, right) => left.id.localeCompare(right.id));
}

function uniqueSorted<T extends string>(values: T[]): T[] {
	return [...new Set(values)].sort() as T[];
}

function hashCanonical(value: unknown): string {
	return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value: unknown): string {
	return JSON.stringify(sortObjectKeys(value));
}

function sortObjectKeys(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortObjectKeys);
	if (value !== null && typeof value === "object") {
		const record = value as Record<string, unknown>;
		return Object.fromEntries(
			Object.keys(record)
				.sort()
				.map((key) => [key, sortObjectKeys(record[key])]),
		);
	}
	return value;
}
