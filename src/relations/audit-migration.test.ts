import { describe, expect, it } from "vitest";
import type { ObjectLintResult } from "../linter/index.js";
import type { Claim, Relation, RelationType, SourceSpan } from "../types/index.js";
import {
	decideRelationAuditSampleGate,
	inspectRelationCorpus,
	normalizeRelationAuditInput,
	scoreRelationAuditReview,
	selectStratifiedRelationSample,
	verifyRelationAuditLedger,
} from "./audit-migration.js";

describe("Relation audit migration contracts", () => {
	it("requires both strong precision and recall and does not call AI review human gold", () => {
		const score = scoreRelationAuditReview(
			[
				{ relationId: "accepted", type: "SUPPORTS", auditDecision: "accept" },
				{ relationId: "missed", type: "REQUIRES", auditDecision: "reject" },
			],
			[
				{ relationId: "accepted", decision: "accept" },
				{ relationId: "missed", decision: "accept" },
			],
		);
		const failed = decideRelationAuditSampleGate({
			score,
			strongPrecisionThreshold: 0.9,
			strongRecallThreshold: 0.7,
			reviewerType: "AI_REVIEW_NOT_HUMAN_GOLD",
			goldStatus: "DEV_PROXY",
		});
		expect(score.strong.precision).toBe(1);
		expect(score.strong.recall).toBe(0.5);
		expect(failed).toMatchObject({
			decision: "FAIL_SAMPLE_GATE",
			evidenceTier: "DEV_PROXY",
			failures: ["strong-recall-below-threshold"],
		});

		const passingScore = scoreRelationAuditReview(
			[{ relationId: "accepted", type: "SUPPORTS", auditDecision: "accept" }],
			[{ relationId: "accepted", decision: "accept" }],
		);
		expect(
			decideRelationAuditSampleGate({
				score: passingScore,
				strongPrecisionThreshold: 0.9,
				strongRecallThreshold: 0.7,
				reviewerType: "AI_REVIEW_NOT_HUMAN_GOLD",
				goldStatus: "DEV_PROXY",
			}).decision,
		).toBe("PASS_DEV_PROXY_GATE");
	});

	it("scores strong edges separately and fails closure on review drift", () => {
		const score = scoreRelationAuditReview(
			[
				{ relationId: "strong-good", type: "SUPPORTS", auditDecision: "accept" },
				{ relationId: "strong-bad", type: "CONTRADICTS", auditDecision: "accept" },
				{ relationId: "weak", type: "RELATED_TO", auditDecision: "reject" },
			],
			[
				{ relationId: "strong-good", decision: "accept" },
				{ relationId: "strong-bad", decision: "reject" },
				{ relationId: "weak", decision: "reject" },
			],
		);

		expect(score.closed).toBe(true);
		expect(score.overall).toMatchObject({ total: 3, tp: 1, fp: 1, tn: 1, fn: 0 });
		expect(score.strong).toMatchObject({ total: 2, tp: 1, fp: 1, tn: 0, fn: 0 });
		expect(score.strong.precision).toBe(0.5);

		const drifted = scoreRelationAuditReview(
			[{ relationId: "only", type: "SUPPORTS", auditDecision: "accept" }],
			[{ relationId: "other", decision: "accept" }],
		);
		expect(drifted.closed).toBe(false);
		expect(drifted.missingReviewIds).toEqual(["only"]);
		expect(drifted.unexpectedReviewIds).toEqual(["other"]);
	});

	it("distinguishes legitimate EXPLICIT_NONE from missing EQUIVALENT_UNDER conditions", () => {
		const claims = [claim("claim:a"), claim("claim:b")];
		const spans = [span("span:a")];
		const relations = [
			relation("rel:support", "SUPPORTS", "EXPLICIT_NONE", [], "v1.7"),
			relation("rel:equivalent", "EQUIVALENT_UNDER", "PRESERVED", [], "v1.7"),
		];
		const inspection = inspectRelationCorpus(relations, claims, spans, "v1.7");
		expect(inspection.strongExplicitNone).toBe(1);
		expect(inspection.equivalentUnderMissingConditions).toBe(1);
	});

	it("selects a deterministic sample across type/source strata", () => {
		const relations = [
			relation("rel:1", "SUPPORTS", "EXPLICIT_NONE", [], "v1.2", "intra-material-compile"),
			relation("rel:2", "SUPPORTS", "EXPLICIT_NONE", [], "v1.2", "cross-material-detect"),
			relation("rel:3", "REQUIRES", "EXPLICIT_NONE", [], "v1.2", "intra-material-compile"),
			relation("rel:4", "CONTRADICTS", "EXPLICIT_NONE", [], "v1.2", "intra-material-compile"),
			relation("rel:5", "RELATED_TO", "EXPLICIT_NONE", [], "v1.2", "intra-material-compile"),
		];
		const first = selectStratifiedRelationSample(relations, 4, "frozen-seed");
		const second = selectStratifiedRelationSample(relations, 4, "frozen-seed");
		expect(first.map((item) => item.id)).toEqual(second.map((item) => item.id));
		expect(new Set(first.map((item) => `${item.type}|${item.source}`)).size).toBe(4);
	});

	it("normalizes only exact legacy empty-condition sentinels", () => {
		const normalized = normalizeRelationAuditInput({
			...relation("rel:1", "SUPPORTS", "PRESERVED", ["无", "适用于有限空间"], "v1.2"),
		});
		expect(normalized.relation.conditions).toEqual(["适用于有限空间"]);
		expect(normalized.removedConditionPlaceholders).toEqual(["无"]);
		const meaningful = normalizeRelationAuditInput({
			...relation("rel:2", "SUPPORTS", "PRESERVED", ["无额外限制时"], "v1.2"),
		});
		expect(meaningful.relation.conditions).toEqual(["无额外限制时"]);
	});

	it("fails closed when an accepted result lacks current audit or resolvable evidence", () => {
		const input = [relation("rel:1", "SUPPORTS", "EXPLICIT_NONE", [], "v1.2")];
		const badResult: ObjectLintResult<Relation> = {
			object: { ...input[0], relationAuditVersion: "v1.2", evidenceSpanIds: [] },
			issues: [],
			finalState: "CANONICAL",
		};
		const ledger = verifyRelationAuditLedger(
			input,
			[badResult],
			[claim("claim:a"), claim("claim:b")],
			[span("span:a")],
			"v1.7",
		);
		expect(ledger.closed).toBe(false);
		expect(ledger.canonicalContractViolations[0]?.reasons).toEqual(
			expect.arrayContaining(["audit-version-mismatch", "broken-evidence"]),
		);
	});

	it("closes the ledger only when every input has one safe result", () => {
		const input = [relation("rel:1", "SUPPORTS", "EXPLICIT_NONE", [], "v1.2")];
		const accepted: ObjectLintResult<Relation> = {
			object: { ...input[0], relationAuditVersion: "v1.7" },
			issues: [],
			finalState: "CANONICAL",
		};
		const ledger = verifyRelationAuditLedger(
			input,
			[accepted],
			[claim("claim:a"), claim("claim:b")],
			[span("span:a")],
			"v1.7",
		);
		expect(ledger).toMatchObject({ input: 1, canonical: 1, quarantined: 0, closed: true });
	});
});

function relation(
	id: string,
	type: RelationType,
	conditionStatus: Relation["conditionStatus"],
	conditions: string[],
	relationAuditVersion: string | null,
	source: Relation["source"] = "intra-material-compile",
): Relation {
	return {
		id,
		from: "claim:a" as Relation["from"],
		to: "claim:b" as Relation["to"],
		type,
		conditions,
		conditionStatus,
		supersessionEffect: null,
		relationAuditVersion,
		evidenceSpanIds: ["span:a"],
		derivation: "INFERRED",
		validity: "SUPPORTED",
		lifecycle: "ACTIVE",
		publicationState: "CANONICAL",
		validFrom: null,
		validTo: null,
		compilerVersion: "test",
		source,
		confidence: 1,
		consumedBy: [],
	};
}

function claim(id: string): Claim {
	return {
		id,
		statement: id,
		conditions: [],
		claimKind: "FACT",
		scope: { type: "GLOBAL" },
		derivation: "EXTRACTED",
		validity: "SUPPORTED",
		lifecycle: "ACTIVE",
		publicationState: "CANONICAL",
		confidence: 1,
		evidenceSpanIds: ["span:a"],
		provenanceRefs: [{ type: "SourceSpan", spanId: "span:a" }],
		supportingEvidenceRefs: [{ type: "SourceSpan", spanId: "span:a" }],
		compilerVersion: "test",
		knowledgeVersion: "kv:test",
		validFrom: null,
		validTo: null,
		recordedAt: "2026-01-01T00:00:00.000Z",
	};
}

function span(id: string): SourceSpan {
	return {
		id,
		sourceId: "source:test",
		blockId: "block:test",
		charStart: 0,
		charEnd: 4,
		text: "test",
	};
}
