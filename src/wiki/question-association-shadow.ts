import { createHash } from "node:crypto";

export const QUESTION_ASSOCIATION_SHADOW_SYSTEM = `你是 WikiMemory 的问题关联影子裁决器。
你只能判断输入 Claim 是否会更新给定的既有 QuestionHypothesis，不能创建问题、改变 lifecycle 或写入知识。
逐个 case 输出 ATTACH、REJECT 或 UNCERTAIN：
- ATTACH：Claim 在问题边界内，并能支持、反驳、限域、取代、改变当前状态或明确暴露 Evidence Gap；
- REJECT：仅主题相近、同领域、相同实体、Source 元数据或只回答相邻问题；
- UNCERTAIN：authority、适用范围、边界重叠或内容不足，无法可靠强判。
不要追求挂接率。一个 Claim 对不同问题可以有不同 verdict。只引用输入中出现的 Claim、Evidence 和 Question refs。
返回严格 JSON：{"decisions":[QuestionAssociationDecision...]}。
每个 decision 必须且只能包含：caseId、claimRef、questionRef、verdict、reasonCodes、groundedClaimRefs、groundedEvidenceRefs、groundedQuestionClaimRefs、boundaryNotes、competingQuestionRefs。
除 verdict 外，其余复数字段都是 JSON string array；caseId/claimRef/questionRef 必须原样复制当前 case。没有值时返回空数组，不要省略字段，不要增加 confidence 或 rationale 字段。`;

export const QUESTION_ASSOCIATION_REASON_CODES = [
	"IN_BOUND_SUPPORT",
	"IN_BOUND_CHALLENGE",
	"IN_BOUND_CONDITION",
	"IN_BOUND_SUPERSESSION",
	"EXPLICIT_GAP_SIGNAL",
	"OUT_OF_BOUNDARY",
	"ADJACENT_QUESTION_ONLY",
	"SOURCE_METADATA_ONLY",
	"INSUFFICIENT_CLAIM_CONTENT",
	"AUTHORITY_OR_APPLICABILITY_UNCLEAR",
	"BOUNDARY_OVERLAP",
	"COMPETING_QUESTION",
	"UNRESOLVED_EVIDENCE",
	"UNKNOWN_REFERENCE",
] as const;

export type QuestionAssociationReasonCode = (typeof QUESTION_ASSOCIATION_REASON_CODES)[number];
export type QuestionAssociationVerdict = "ATTACH" | "REJECT" | "UNCERTAIN";
export type QuestionAssociationVariant = "A0_NAME_CARD" | "A1_EVIDENCE_IDENTITY_CARD";

export interface AssociationEvidenceRef {
	ref: string;
	baseSpanRef: string;
	sourceId: string;
}

export interface AssociationClaim {
	ref: string;
	statement: string;
	conditions: string[];
	validity: string;
	claimKind: string;
	scope: unknown;
	sourceId: string;
	knowledgeVersion: string;
	evidenceRefs: AssociationEvidenceRef[];
}

export interface AssociationQuestionSnapshot {
	ref: string;
	canonicalQuestion: string;
	aliases: string[];
	boundaries: string[];
	domain: string;
	scope: unknown;
	lifecycle: string;
	stateHash: string;
}

export interface AssociationEvolutionEvent {
	action: string;
	sourceId: string;
	knowledgeVersion: string;
	affectedClaimRefs: string[];
	createdAt: string;
}

export interface QuestionAssociationFixtureCase {
	caseId: string;
	domain: string;
	sourceId: string;
	snapshotId: string;
	beforeQuestionStateHash: string;
	claim: AssociationClaim;
	question: AssociationQuestionSnapshot;
	priorClaims: AssociationClaim[];
	priorEvolution: AssociationEvolutionEvent[];
}

export interface QuestionAssociationOracleCase {
	caseId: string;
	domain: string;
	claimRef: string;
	questionRef: string;
	expectedVerdict: QuestionAssociationVerdict;
	reasonCodes: QuestionAssociationReasonCode[];
}

export interface QuestionIdentityCard {
	schemaVersion: "wge-question-identity-card/v1";
	questionRef: string;
	canonicalQuestion: string;
	aliases: string[];
	boundaries: string[];
	domain: string;
	scope: unknown;
	lifecycle: string;
	representativeClaims: Array<{
		claimRef: string;
		statement: string;
		evidenceRefs: string[];
		sourceId: string;
		knowledgeVersion: string;
		selectionReasons: string[];
	}>;
	evolutionSummary: Array<{
		action: string;
		sourceId: string;
		knowledgeVersion: string;
		affectedClaimCount: number;
		createdAt: string;
	}>;
	closureSummary: {
		claimCount: number;
		sourceCount: number;
		knowledgeVersionCount: number;
		omittedClaimCount: number;
	};
}

export interface QuestionAssociationPayload {
	schemaVersion: "wge-question-association-input/v1";
	variant: QuestionAssociationVariant;
	domain: string;
	decisionContract: {
		verdicts: QuestionAssociationVerdict[];
		reasonCodes: QuestionAssociationReasonCode[];
		manyToMany: true;
		createQuestionAllowed: false;
		canonicalMutationAllowed: false;
	};
	cases: Array<{
		caseId: string;
		claim: {
			claimRef: string;
			statement: string;
			conditions: string[];
			validity: string;
			claimKind: string;
			scope: unknown;
			evidenceRefs: string[];
		};
		question: QuestionIdentityCard;
	}>;
}

export interface QuestionAssociationDecision {
	caseId: string;
	claimRef: string;
	questionRef: string;
	verdict: QuestionAssociationVerdict;
	reasonCodes: QuestionAssociationReasonCode[];
	groundedClaimRefs: string[];
	groundedEvidenceRefs: string[];
	groundedQuestionClaimRefs: string[];
	boundaryNotes: string[];
	competingQuestionRefs: string[];
}

export interface QuestionAssociationGateResult {
	schemaVersion: "wge-question-association-gate/v1";
	status: "PASS" | "FAIL";
	variant: QuestionAssociationVariant;
	decisionHash: string;
	blockers: Array<{
		caseId: string | null;
		code: string;
		detail: string;
	}>;
	summary: {
		caseCount: number;
		attachCount: number;
		rejectCount: number;
		uncertainCount: number;
		hardPositiveErrors: number;
		falseAttachCount: number;
		uncertaintyErrors: number;
		canonicalMutationCount: number;
	};
}

const FIXTURE_CASE_KEYS = [
	"beforeQuestionStateHash",
	"caseId",
	"claim",
	"domain",
	"priorClaims",
	"priorEvolution",
	"question",
	"snapshotId",
	"sourceId",
];
const ATTACH_REASONS = new Set<QuestionAssociationReasonCode>([
	"IN_BOUND_SUPPORT",
	"IN_BOUND_CHALLENGE",
	"IN_BOUND_CONDITION",
	"IN_BOUND_SUPERSESSION",
	"EXPLICIT_GAP_SIGNAL",
]);
const REJECT_REASONS = new Set<QuestionAssociationReasonCode>([
	"OUT_OF_BOUNDARY",
	"ADJACENT_QUESTION_ONLY",
	"SOURCE_METADATA_ONLY",
	"INSUFFICIENT_CLAIM_CONTENT",
]);
const UNCERTAIN_REASONS = new Set<QuestionAssociationReasonCode>([
	"EXPLICIT_GAP_SIGNAL",
	"AUTHORITY_OR_APPLICABILITY_UNCLEAR",
	"BOUNDARY_OVERLAP",
	"COMPETING_QUESTION",
	"UNRESOLVED_EVIDENCE",
]);

export function buildQuestionIdentityCard(
	input: QuestionAssociationFixtureCase,
	variant: QuestionAssociationVariant,
	claimLimit = 6,
): QuestionIdentityCard {
	validateFixtureCase(input);
	if (!Number.isInteger(claimLimit) || claimLimit < 0 || claimLimit > 6) {
		throw new Error("Question identity card claim limit must be an integer in [0, 6]");
	}
	const selected =
		variant === "A1_EVIDENCE_IDENTITY_CARD"
			? selectRepresentativeClaims(input.priorClaims, input.question.boundaries, claimLimit)
			: [];
	const sourceCount = new Set(input.priorClaims.map((claim) => claim.sourceId)).size;
	const knowledgeVersionCount = new Set(input.priorClaims.map((claim) => claim.knowledgeVersion))
		.size;
	return {
		schemaVersion: "wge-question-identity-card/v1",
		questionRef: input.question.ref,
		canonicalQuestion: input.question.canonicalQuestion,
		aliases: uniqueSorted(input.question.aliases),
		boundaries: uniqueSorted(input.question.boundaries),
		domain: input.question.domain,
		scope: sortObjectKeys(input.question.scope),
		lifecycle: input.question.lifecycle,
		representativeClaims: selected,
		evolutionSummary:
			variant === "A1_EVIDENCE_IDENTITY_CARD"
				? [...input.priorEvolution].sort(compareEvolution).map((event) => ({
						action: event.action,
						sourceId: event.sourceId,
						knowledgeVersion: event.knowledgeVersion,
						affectedClaimCount: uniqueSorted(event.affectedClaimRefs).length,
						createdAt: event.createdAt,
					}))
				: [],
		closureSummary: {
			claimCount: input.priorClaims.length,
			sourceCount,
			knowledgeVersionCount,
			omittedClaimCount: input.priorClaims.length - selected.length,
		},
	};
}

export function buildQuestionAssociationPayload(
	cases: QuestionAssociationFixtureCase[],
	variant: QuestionAssociationVariant,
): QuestionAssociationPayload {
	if (cases.length === 0) throw new Error("Question association payload requires cases");
	for (const item of cases) validateFixtureCase(item);
	const domains = uniqueSorted(cases.map((item) => item.domain));
	if (domains.length !== 1) {
		throw new Error(`Question association payload must contain one domain: ${domains.join(", ")}`);
	}
	const caseIds = cases.map((item) => item.caseId);
	if (new Set(caseIds).size !== caseIds.length) {
		throw new Error("Question association payload contains duplicate case IDs");
	}
	return {
		schemaVersion: "wge-question-association-input/v1",
		variant,
		domain: domains[0] as string,
		decisionContract: {
			verdicts: ["ATTACH", "REJECT", "UNCERTAIN"],
			reasonCodes: [...QUESTION_ASSOCIATION_REASON_CODES],
			manyToMany: true,
			createQuestionAllowed: false,
			canonicalMutationAllowed: false,
		},
		cases: [...cases]
			.sort((left, right) => left.caseId.localeCompare(right.caseId))
			.map((item) => ({
				caseId: item.caseId,
				claim: {
					claimRef: item.claim.ref,
					statement: item.claim.statement,
					conditions: uniqueSorted(item.claim.conditions),
					validity: item.claim.validity,
					claimKind: item.claim.claimKind,
					scope: sortObjectKeys(item.claim.scope),
					evidenceRefs: uniqueSorted(item.claim.evidenceRefs.map((ref) => ref.ref)),
				},
				question: buildQuestionIdentityCard(item, variant),
			})),
	};
}

export function serializeQuestionAssociationPayload(payload: QuestionAssociationPayload): string {
	return `${stableStringify(payload)}\n`;
}

export function parseQuestionAssociationDecisions(raw: unknown): QuestionAssociationDecision[] {
	const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
	const record = asRecord(parsed, "Question association response");
	assertExactKeys(record, ["decisions"], "Question association response");
	if (!Array.isArray(record.decisions)) {
		throw new Error("Question association response decisions must be an array");
	}
	return record.decisions.map((item, index) => parseDecision(item, index));
}

export function auditQuestionAssociationDecisions(input: {
	variant: QuestionAssociationVariant;
	cases: QuestionAssociationFixtureCase[];
	oracle: QuestionAssociationOracleCase[];
	decisions: unknown;
	canonicalStateHashBefore: string;
	canonicalStateHashAfter: string;
}): QuestionAssociationGateResult {
	const decisions = parseQuestionAssociationDecisions(input.decisions);
	const caseById = uniqueIndex(input.cases, (item) => item.caseId, "fixture case");
	const oracleById = uniqueIndex(input.oracle, (item) => item.caseId, "oracle case");
	const decisionById = uniqueIndex(decisions, (item) => item.caseId, "association decision");
	const blockers: QuestionAssociationGateResult["blockers"] = [];
	for (const caseId of uniqueSorted([...caseById.keys(), ...oracleById.keys()])) {
		const fixture = caseById.get(caseId);
		const oracle = oracleById.get(caseId);
		const decision = decisionById.get(caseId);
		if (!fixture || !oracle) {
			blockers.push({ caseId, code: "FIXTURE_OR_ORACLE_MISSING", detail: caseId });
			continue;
		}
		if (!decision) {
			blockers.push({ caseId, code: "DECISION_MISSING", detail: caseId });
			continue;
		}
		validateDecisionGrounding(input.variant, input.cases, fixture, decision, blockers);
		if (decision.verdict !== oracle.expectedVerdict) {
			blockers.push({
				caseId,
				code:
					oracle.expectedVerdict === "ATTACH"
						? "HARD_POSITIVE_ERROR"
						: oracle.expectedVerdict === "REJECT"
							? "FALSE_ATTACH_OR_REJECT_ERROR"
							: "UNCERTAINTY_NOT_PRESERVED",
				detail: `expected ${oracle.expectedVerdict}, received ${decision.verdict}`,
			});
		}
	}
	for (const decision of decisions) {
		if (!caseById.has(decision.caseId)) {
			blockers.push({
				caseId: decision.caseId,
				code: "UNKNOWN_CASE_DECISION",
				detail: decision.caseId,
			});
		}
	}
	const canonicalMutationCount =
		input.canonicalStateHashBefore === input.canonicalStateHashAfter ? 0 : 1;
	if (canonicalMutationCount > 0) {
		blockers.push({
			caseId: null,
			code: "CANONICAL_STATE_MUTATED",
			detail: `${input.canonicalStateHashBefore} != ${input.canonicalStateHashAfter}`,
		});
	}
	const sortedDecisions = [...decisions].sort((left, right) =>
		left.caseId.localeCompare(right.caseId),
	);
	return {
		schemaVersion: "wge-question-association-gate/v1",
		status: blockers.length === 0 ? "PASS" : "FAIL",
		variant: input.variant,
		decisionHash: hashCanonical(sortedDecisions),
		blockers: blockers.sort(compareBlocker),
		summary: {
			caseCount: input.cases.length,
			attachCount: decisions.filter((item) => item.verdict === "ATTACH").length,
			rejectCount: decisions.filter((item) => item.verdict === "REJECT").length,
			uncertainCount: decisions.filter((item) => item.verdict === "UNCERTAIN").length,
			hardPositiveErrors: blockers.filter((item) => item.code === "HARD_POSITIVE_ERROR").length,
			falseAttachCount: blockers.filter(
				(item) =>
					item.code === "FALSE_ATTACH_OR_REJECT_ERROR" &&
					decisionById.get(item.caseId ?? "")?.verdict === "ATTACH",
			).length,
			uncertaintyErrors: blockers.filter((item) => item.code === "UNCERTAINTY_NOT_PRESERVED")
				.length,
			canonicalMutationCount,
		},
	};
}

function validateDecisionGrounding(
	variant: QuestionAssociationVariant,
	allCases: QuestionAssociationFixtureCase[],
	fixture: QuestionAssociationFixtureCase,
	decision: QuestionAssociationDecision,
	blockers: QuestionAssociationGateResult["blockers"],
): void {
	if (decision.claimRef !== fixture.claim.ref || decision.questionRef !== fixture.question.ref) {
		blockers.push({
			caseId: fixture.caseId,
			code: "PAIR_REFERENCE_MISMATCH",
			detail: `${decision.claimRef} × ${decision.questionRef}`,
		});
	}
	const card = buildQuestionIdentityCard(fixture, variant);
	const visibleQuestionClaimRefs = new Set(
		card.representativeClaims.map((claim) => claim.claimRef),
	);
	const visibleClaimRefs = new Set([fixture.claim.ref, ...visibleQuestionClaimRefs]);
	const visibleEvidenceRefs = new Set([
		...fixture.claim.evidenceRefs.map((ref) => ref.ref),
		...card.representativeClaims.flatMap((claim) => claim.evidenceRefs),
	]);
	if (!decision.groundedClaimRefs.includes(fixture.claim.ref)) {
		blockers.push({
			caseId: fixture.caseId,
			code: "INPUT_CLAIM_NOT_GROUNDED",
			detail: fixture.claim.ref,
		});
	}
	for (const ref of decision.groundedClaimRefs) {
		if (!visibleClaimRefs.has(ref)) {
			blockers.push({ caseId: fixture.caseId, code: "UNKNOWN_CLAIM_REF", detail: ref });
		}
	}
	if (decision.groundedEvidenceRefs.length === 0) {
		blockers.push({
			caseId: fixture.caseId,
			code: "EVIDENCE_GROUNDING_MISSING",
			detail: fixture.claim.ref,
		});
	}
	for (const ref of decision.groundedEvidenceRefs) {
		if (!visibleEvidenceRefs.has(ref)) {
			blockers.push({ caseId: fixture.caseId, code: "UNKNOWN_EVIDENCE_REF", detail: ref });
		}
	}
	for (const ref of decision.groundedQuestionClaimRefs) {
		if (!visibleQuestionClaimRefs.has(ref)) {
			blockers.push({
				caseId: fixture.caseId,
				code: "UNKNOWN_QUESTION_CLAIM_REF",
				detail: ref,
			});
		}
	}
	if (decision.boundaryNotes.length === 0 && decision.groundedQuestionClaimRefs.length === 0) {
		blockers.push({
			caseId: fixture.caseId,
			code: "QUESTION_GROUNDING_MISSING",
			detail: fixture.question.ref,
		});
	}
	const reasonSet =
		decision.verdict === "ATTACH"
			? ATTACH_REASONS
			: decision.verdict === "REJECT"
				? REJECT_REASONS
				: UNCERTAIN_REASONS;
	if (!decision.reasonCodes.some((code) => reasonSet.has(code))) {
		blockers.push({
			caseId: fixture.caseId,
			code: "VERDICT_REASON_MISMATCH",
			detail: `${decision.verdict}: ${decision.reasonCodes.join(", ")}`,
		});
	}
	const visibleQuestionRefs = new Set(allCases.map((item) => item.question.ref));
	for (const ref of decision.competingQuestionRefs) {
		if (!visibleQuestionRefs.has(ref)) {
			blockers.push({ caseId: fixture.caseId, code: "UNKNOWN_COMPETING_QUESTION", detail: ref });
		}
	}
}

function selectRepresentativeClaims(
	claims: AssociationClaim[],
	boundaries: string[],
	limit: number,
): QuestionIdentityCard["representativeClaims"] {
	const bySource = new Map<string, AssociationClaim[]>();
	for (const claim of [...claims].sort((left, right) => left.ref.localeCompare(right.ref))) {
		const group = bySource.get(claim.sourceId) ?? [];
		group.push(claim);
		bySource.set(claim.sourceId, group);
	}
	for (const group of bySource.values()) {
		group.sort((left, right) => {
			const score =
				boundaryOverlap(right.statement, boundaries) - boundaryOverlap(left.statement, boundaries);
			return score || left.ref.localeCompare(right.ref);
		});
	}
	const selected: AssociationClaim[] = [];
	const sourceIds = [...bySource.keys()].sort();
	let round = 0;
	while (selected.length < limit) {
		let added = false;
		for (const sourceId of sourceIds) {
			const claim = bySource.get(sourceId)?.[round];
			if (!claim) continue;
			selected.push(claim);
			added = true;
			if (selected.length === limit) break;
		}
		if (!added) break;
		round += 1;
	}
	return selected.map((claim) => ({
		claimRef: claim.ref,
		statement: claim.statement,
		evidenceRefs: uniqueSorted(claim.evidenceRefs.map((ref) => ref.ref)),
		sourceId: claim.sourceId,
		knowledgeVersion: claim.knowledgeVersion,
		selectionReasons: [
			"SOURCE_DIVERSITY",
			"KNOWLEDGE_VERSION_DIVERSITY",
			boundaryOverlap(claim.statement, boundaries) > 0
				? "BOUNDARY_LEXICAL_COVERAGE"
				: "STABLE_CLAIM_ORDER",
		],
	}));
}

function validateFixtureCase(input: QuestionAssociationFixtureCase): void {
	const record = asRecord(input, `Fixture case ${input?.caseId ?? "unknown"}`);
	assertExactKeys(record, FIXTURE_CASE_KEYS, `Fixture case ${input.caseId}`);
	if (!/^QAB-(PSY|TEC|LAW)-\d{2}$/.test(input.caseId)) {
		throw new Error(`Fixture case ID is not opaque: ${input.caseId}`);
	}
	if (input.domain !== input.question.domain) {
		throw new Error(`Fixture domain mismatch for ${input.caseId}`);
	}
	if (input.sourceId !== input.claim.sourceId) {
		throw new Error(`Fixture source mismatch for ${input.caseId}`);
	}
	if (input.priorClaims.some((claim) => claim.sourceId === input.sourceId)) {
		throw new Error(`Fixture ${input.caseId} leaks current Source into the prior question closure`);
	}
	if (input.priorClaims.some((claim) => claim.ref === input.claim.ref)) {
		throw new Error(`Fixture ${input.caseId} leaks the input Claim into the identity card`);
	}
	if (
		input.claim.evidenceRefs.length === 0 ||
		input.claim.evidenceRefs.some((ref) => !ref.baseSpanRef)
	) {
		throw new Error(`Fixture ${input.caseId} has unresolved input Claim evidence`);
	}
	for (const claim of input.priorClaims) {
		if (claim.evidenceRefs.length === 0 || claim.evidenceRefs.some((ref) => !ref.baseSpanRef)) {
			throw new Error(`Fixture ${input.caseId} has unresolved prior Claim evidence: ${claim.ref}`);
		}
	}
}

function parseDecision(input: unknown, index: number): QuestionAssociationDecision {
	const record = asRecord(input, `Question association decision ${index}`);
	assertExactKeys(
		record,
		[
			"boundaryNotes",
			"caseId",
			"claimRef",
			"competingQuestionRefs",
			"groundedClaimRefs",
			"groundedEvidenceRefs",
			"groundedQuestionClaimRefs",
			"questionRef",
			"reasonCodes",
			"verdict",
		],
		`Question association decision ${index}`,
	);
	const verdict = requireEnum(record.verdict, ["ATTACH", "REJECT", "UNCERTAIN"], "verdict");
	const reasonCodes = requireStringArray(record.reasonCodes, "reasonCodes").map((code) =>
		requireEnum(code, QUESTION_ASSOCIATION_REASON_CODES, "reason code"),
	);
	if (reasonCodes.length === 0) throw new Error(`Decision ${index} has no reason code`);
	return {
		caseId: requireString(record.caseId, "caseId"),
		claimRef: requireString(record.claimRef, "claimRef"),
		questionRef: requireString(record.questionRef, "questionRef"),
		verdict,
		reasonCodes: uniqueSorted(reasonCodes) as QuestionAssociationReasonCode[],
		groundedClaimRefs: uniqueSorted(
			requireStringArray(record.groundedClaimRefs, "groundedClaimRefs"),
		),
		groundedEvidenceRefs: uniqueSorted(
			requireStringArray(record.groundedEvidenceRefs, "groundedEvidenceRefs"),
		),
		groundedQuestionClaimRefs: uniqueSorted(
			requireStringArray(record.groundedQuestionClaimRefs, "groundedQuestionClaimRefs"),
		),
		boundaryNotes: uniqueSorted(requireStringArray(record.boundaryNotes, "boundaryNotes")),
		competingQuestionRefs: uniqueSorted(
			requireStringArray(record.competingQuestionRefs, "competingQuestionRefs"),
		),
	};
}

function boundaryOverlap(statement: string, boundaries: string[]): number {
	const statementTokens = lexicalTokens(statement);
	const boundaryTokens = new Set(boundaries.flatMap(lexicalTokens));
	return [...statementTokens].filter((token) => boundaryTokens.has(token)).length;
}

function lexicalTokens(value: string): string[] {
	const normalized = value.normalize("NFKC").toLowerCase();
	const words = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
	const tokens = new Set<string>();
	for (const word of words) {
		if (/^\p{Script=Han}+$/u.test(word)) {
			const chars = [...word];
			for (let index = 0; index < chars.length - 1; index += 1) {
				tokens.add(`${chars[index]}${chars[index + 1]}`);
			}
		} else if (word.length >= 2) {
			tokens.add(word);
		}
	}
	return [...tokens].sort();
}

function compareEvolution(
	left: AssociationEvolutionEvent,
	right: AssociationEvolutionEvent,
): number {
	return (
		left.createdAt.localeCompare(right.createdAt) || left.sourceId.localeCompare(right.sourceId)
	);
}

function compareBlocker(
	left: QuestionAssociationGateResult["blockers"][number],
	right: QuestionAssociationGateResult["blockers"][number],
): number {
	return (
		(left.caseId ?? "").localeCompare(right.caseId ?? "") || left.code.localeCompare(right.code)
	);
}

function uniqueIndex<T>(values: T[], keyOf: (value: T) => string, label: string): Map<string, T> {
	const result = new Map<string, T>();
	for (const value of values) {
		const key = keyOf(value);
		if (result.has(key)) throw new Error(`Duplicate ${label}: ${key}`);
		result.set(key, value);
	}
	return result;
}

function hashCanonical(value: unknown): string {
	return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value: unknown): string {
	return JSON.stringify(sortObjectKeys(value));
}

function sortObjectKeys(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortObjectKeys);
	if (!value || typeof value !== "object") return value;
	return Object.fromEntries(
		Object.entries(value as Record<string, unknown>)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, item]) => [key, sortObjectKeys(item)]),
	);
}

function uniqueSorted(values: string[]): string[] {
	return [...new Set(values)].sort();
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${label} must be an object`);
	}
	return value as Record<string, unknown>;
}

function assertExactKeys(record: Record<string, unknown>, keys: string[], label: string): void {
	const actual = Object.keys(record).sort();
	const expected = [...keys].sort();
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(`${label} keys mismatch: ${actual.join(", ")}`);
	}
}

function requireString(value: unknown, label: string): string {
	if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a string`);
	return value;
}

function requireStringArray(value: unknown, label: string): string[] {
	if (
		!Array.isArray(value) ||
		value.some((item) => typeof item !== "string" || item.length === 0)
	) {
		throw new Error(`${label} must be a string array`);
	}
	return value as string[];
}

function requireEnum<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
	if (typeof value !== "string" || !allowed.includes(value as T)) {
		throw new Error(`${label} is not allowed: ${String(value)}`);
	}
	return value as T;
}
