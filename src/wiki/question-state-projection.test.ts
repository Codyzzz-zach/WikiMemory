import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { writeQuestionStateProjectionShadow } from "./question-state-projection-storage.js";
import {
	type ProjectionClaimInput,
	type ProjectionEvidenceSpanInput,
	type ProjectionRelationInput,
	type QuestionStateBranchAssessment,
	type QuestionStateProjection,
	type QuestionStateProjectionInput,
	projectQuestionState,
	questionStateInputClosureHash,
	serializeQuestionStateProjection,
} from "./question-state-projection.js";

interface ExpectedBranch {
	branchId: string;
	claimRefs: string[];
	standing: string;
	qualifiers: string[];
	applicability: string[];
	conditions: string[];
	requiredReasonCodes: string[];
}

interface ExpectedUnresolvedFactor {
	reasonCode: string;
}

interface MicroSnapshot {
	timeline: string;
	knowledgeVersion: string;
	claimRefs: string[];
	relationIds: string[];
	evidenceSpanIds: string[];
	inputClosureHash: string;
	expectedTransitionCodes: string[];
	expectedBranchAssessments: ExpectedBranch[];
	expectedUnresolvedFactors: ExpectedUnresolvedFactor[];
}

interface EvolutionMicro {
	questionRef: string;
	claims: ProjectionClaimInput[];
	relations: ProjectionRelationInput[];
	evidenceSpans: ProjectionEvidenceSpanInput[];
	snapshots: MicroSnapshot[];
}

const root = resolve(import.meta.dirname, "../..");
const fixture = readJson<EvolutionMicro>(
	"benchmarks/c1-weighted-question-state-v1/fixtures/evolution-micro.json",
);

describe("C1 pure question state projection", () => {
	it("matches the frozen T0/T2/T3 semantic oracle without provider calls", () => {
		for (const snapshot of fixture.snapshots) {
			const projection = projectQuestionState(inputFor(snapshot));
			for (const expected of snapshot.expectedBranchAssessments) {
				const actual = branchByClaims(projection, expected.claimRefs);
				expect(actual.standing, `${snapshot.timeline}:${expected.branchId}`).toBe(
					expected.standing,
				);
				expect(actual.qualifiers, `${snapshot.timeline}:${expected.branchId}`).toEqual(
					expected.qualifiers,
				);
				expect(actual.scope.applicability, `${snapshot.timeline}:${expected.branchId}`).toEqual(
					expected.applicability,
				);
				expect(actual.conditions, `${snapshot.timeline}:${expected.branchId}`).toEqual(
					expected.conditions,
				);
				const reasonCodes = new Set<string>(
					actual.dimensionReasons.flatMap((reason) => reason.reasonCodes),
				);
				expect(
					expected.requiredReasonCodes.every((code) => reasonCodes.has(code)),
					`${snapshot.timeline}:${expected.branchId}`,
				).toBe(true);
			}
			const unresolvedCodes = new Set<string>(
				projection.unresolvedFactors.map((factor) => factor.reasonCode),
			);
			expect(
				snapshot.expectedUnresolvedFactors.every((factor) =>
					unresolvedCodes.has(factor.reasonCode),
				),
			).toBe(true);
		}
	});

	it("satisfies the four deterministic Micro transitions", () => {
		const t0 = projectQuestionState(inputFor(snapshot("T0")));
		const t2 = projectQuestionState(inputFor(snapshot("T2")));
		const t3 = projectQuestionState(inputFor(snapshot("T3")));
		expect(t0.branchAssessments.filter((branch) => branch.standing === "LEADING")).toHaveLength(3);
		expect(branchByClaims(t2, ["claim:c1-micro:t0-external-tls12"]).standing).toBe("HISTORICAL");
		expect(branchByClaims(t2, ["claim:c1-micro:t0-internal-http"])).toMatchObject({
			standing: "HISTORICAL",
			qualifiers: ["CONDITIONAL"],
		});
		expect(
			branchByClaims(t2, [
				"claim:c1-micro:t0-independent-controls",
				"claim:c1-micro:t2-independent-controls-preserved",
			]).standing,
		).toBe("LEADING");
		expect(branchByClaims(t3, ["claim:c1-micro:t3-disable-mtls-proposal"])).toMatchObject({
			standing: "UNRANKED",
			qualifiers: ["CONDITIONAL", "CONTESTED", "UNRESOLVED"],
		});
		expect(branchByClaims(t3, ["claim:c1-micro:t3-maintain-mtls-position"])).toMatchObject({
			standing: "UNRANKED",
			qualifiers: ["CONTESTED", "UNRESOLVED"],
		});
		expect(new Set(t3.unresolvedFactors.map((factor) => factor.reasonCode))).toEqual(
			new Set(["PEER_CONFLICT_UNRESOLVED", "NO_AUTHORIZED_DECISION"]),
		);
	});

	it("grounds every reason and unresolved factor in the input closure", () => {
		for (const frozenSnapshot of fixture.snapshots) {
			const input = inputFor(frozenSnapshot);
			const projection = projectQuestionState(input);
			const claimRefs = new Set(input.claims.map((claim) => claim.id));
			const relationIds = new Set(input.relations.map((relation) => relation.id));
			const evidenceSpanIds = new Set(input.evidenceSpans.map((span) => span.id));
			for (const branch of projection.branchAssessments) {
				for (const reason of branch.dimensionReasons) {
					expect(reason.claimRefs.length).toBeGreaterThan(0);
					expect(reason.evidenceSpanIds.length).toBeGreaterThan(0);
					expect(reason.claimRefs.every((ref) => claimRefs.has(ref))).toBe(true);
					expect(reason.relationIds.every((id) => relationIds.has(id))).toBe(true);
					expect(reason.evidenceSpanIds.every((id) => evidenceSpanIds.has(id))).toBe(true);
				}
			}
			for (const factor of projection.unresolvedFactors) {
				expect(factor.claimRefs.length).toBeGreaterThan(0);
				expect(factor.relationIds.length).toBeGreaterThan(0);
				expect(factor.evidenceSpanIds.length).toBeGreaterThan(0);
				expect(factor.claimRefs.every((ref) => claimRefs.has(ref))).toBe(true);
				expect(factor.relationIds.every((id) => relationIds.has(id))).toBe(true);
				expect(factor.evidenceSpanIds.every((id) => evidenceSpanIds.has(id))).toBe(true);
			}
		}
	});

	it("is byte-replayable, order-independent, and does not mutate input", () => {
		const input = inputFor(snapshot("T3"));
		const before = JSON.stringify(input);
		const first = projectQuestionState(input);
		const second = projectQuestionState({
			...input,
			claims: [...input.claims].reverse(),
			relations: [...input.relations].reverse(),
			evidenceSpans: [...input.evidenceSpans].reverse(),
		});
		expect(first).toEqual(second);
		expect(serializeQuestionStateProjection(first)).toBe(serializeQuestionStateProjection(second));
		expect(JSON.stringify(input)).toBe(before);
		expect(first.projectionHash).toMatch(/^[a-f0-9]{64}$/);
		expect(() =>
			serializeQuestionStateProjection({ ...first, projectionHash: "0".repeat(64) }),
		).toThrow(/hash mismatch/);
	});

	it("fails closed on missing evidence, closure drift, and conditional supersession", () => {
		const t2 = inputFor(snapshot("T2"));
		expect(() => projectQuestionState({ ...t2, inputClosureHash: "0".repeat(64) })).toThrow(
			/input closure hash mismatch/,
		);
		const withoutSpan = {
			...t2,
			evidenceSpans: t2.evidenceSpans.filter(
				(span) => span.id !== "span:c1-micro:t2-replaced-sections",
			),
		};
		expect(() => projectQuestionState(rehash(withoutSpan))).toThrow(/missing EvidenceSpan/);

		const relationId = "relation:c1-micro:t2-internal-supersedes-t0";
		const conditionalInput = rehash({
			...t2,
			relations: t2.relations.map((relation) =>
				relation.id === relationId
					? {
							...relation,
							applicability: ["only one peak-event service"],
							conditions: ["only when a service-specific exception is approved"],
						}
					: relation,
			),
		});
		const conditionalProjection = projectQuestionState(conditionalInput);
		const oldBranch = branchByClaims(conditionalProjection, ["claim:c1-micro:t0-internal-http"]);
		expect(oldBranch.standing).toBe("LEADING");
		expect(oldBranch.qualifiers).toContain("CONDITIONAL");
		expect(oldBranch.conditions).toContain("only when a service-specific exception is approved");
		expect(oldBranch.dimensionReasons.flatMap((reason) => reason.reasonCodes)).toContain(
			"APPLICABILITY_PARTIAL",
		);
	});

	it("writes only to a non-overlapping atomic shadow root and preserves an unrelated sentinel", () => {
		const temporaryRoot = mkdtempSync(join(tmpdir(), "wge-c1-shadow-test-"));
		const canonicalRoot = join(temporaryRoot, "canonical-runtime");
		const shadowRoot = join(temporaryRoot, "c1-shadow-runtime");
		mkdirSync(canonicalRoot, { recursive: true });
		const canonicalSentinel = join(canonicalRoot, "sentinel.json");
		writeFileSync(canonicalSentinel, '{"canonical":true}\n', "utf8");
		const canonicalBefore = sha256File(canonicalSentinel);
		const t3 = projectQuestionState(inputFor(snapshot("T3")));
		const unrelatedInput = rehash({
			...inputFor(snapshot("T0")),
			questionRef: "question:c1-micro:unrelated-sentinel",
		});
		const unrelated = projectQuestionState(unrelatedInput);
		const unrelatedBefore = serializeQuestionStateProjection(unrelated);
		const firstReceipt = writeQuestionStateProjectionShadow(
			{ shadowRoot, canonicalRuntimeRoot: canonicalRoot },
			t3,
		);
		const secondReceipt = writeQuestionStateProjectionShadow(
			{ shadowRoot, canonicalRuntimeRoot: canonicalRoot },
			t3,
		);
		const t2Receipt = writeQuestionStateProjectionShadow(
			{ shadowRoot, canonicalRuntimeRoot: canonicalRoot },
			projectQuestionState(inputFor(snapshot("T2"))),
		);
		expect(firstReceipt).toEqual(secondReceipt);
		expect(t2Receipt.path).not.toBe(firstReceipt.path);
		expect(readFileSync(firstReceipt.path, "utf8")).toBe(serializeQuestionStateProjection(t3));
		expect(sha256File(canonicalSentinel)).toBe(canonicalBefore);
		expect(serializeQuestionStateProjection(projectQuestionState(unrelatedInput))).toBe(
			unrelatedBefore,
		);
		expect(() =>
			writeQuestionStateProjectionShadow(
				{ shadowRoot: join(canonicalRoot, "nested-shadow"), canonicalRuntimeRoot: canonicalRoot },
				t3,
			),
		).toThrow(/must not overlap canonical runtime/);
	});
});

function inputFor(frozenSnapshot: MicroSnapshot): QuestionStateProjectionInput {
	return {
		questionRef: fixture.questionRef,
		knowledgeVersion: frozenSnapshot.knowledgeVersion,
		inputClosureHash: frozenSnapshot.inputClosureHash,
		claims: selectByIds(fixture.claims, frozenSnapshot.claimRefs),
		relations: selectByIds(fixture.relations, frozenSnapshot.relationIds),
		evidenceSpans: selectByIds(fixture.evidenceSpans, frozenSnapshot.evidenceSpanIds),
	};
}

function rehash(
	input: Omit<QuestionStateProjectionInput, "inputClosureHash"> & { inputClosureHash?: string },
): QuestionStateProjectionInput {
	const { inputClosureHash: _ignored, ...withoutHash } = input;
	return { ...withoutHash, inputClosureHash: questionStateInputClosureHash(withoutHash) };
}

function snapshot(timeline: string): MicroSnapshot {
	const result = fixture.snapshots.find((item) => item.timeline === timeline);
	if (!result) throw new Error(`Missing C1 Micro snapshot: ${timeline}`);
	return result;
}

function branchByClaims(
	projection: QuestionStateProjection,
	claimRefs: string[],
): QuestionStateBranchAssessment {
	const key = [...claimRefs].sort().join("|");
	const branch = projection.branchAssessments.find(
		(candidate) => [...candidate.claimRefs].sort().join("|") === key,
	);
	if (!branch) throw new Error(`Missing projected branch for claims: ${key}`);
	return branch;
}

function selectByIds<T extends { id: string }>(items: T[], ids: string[]): T[] {
	const byId = new Map(items.map((item) => [item.id, item]));
	return [...ids].sort().map((id) => {
		const item = byId.get(id);
		if (!item) throw new Error(`Missing frozen C1 input: ${id}`);
		return item;
	});
}

function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(resolve(root, path), "utf8")) as T;
}

function sha256File(path: string): string {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}
