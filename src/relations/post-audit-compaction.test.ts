import { describe, expect, it } from "vitest";
import type { Relation } from "../types/index.js";
import { claimRef } from "../types/index.js";
import { compactAuditedRelations } from "./post-audit-compaction.js";

describe("post-audit Relation compaction", () => {
	it("keeps strong audited relations outside the RELATED_TO budget", () => {
		const strong = relation("strong", "new", "old-strong", "REQUIRES");
		const related = [relation("r1", "new", "old-1"), relation("r2", "new", "old-2")];
		const result = compactAuditedRelations(
			[strong, ...related],
			new Set(["claim:new"]),
			statements(),
			1,
			1,
		);

		expect(result.canonical.map((item) => item.id)).toContain("rel:strong");
		expect(result.canonical).toHaveLength(2);
		expect(result.deferred).toHaveLength(1);
		expect(result.decisions.find((item) => item.relation.id === "rel:strong")).toMatchObject({
			state: "CANONICAL_READY",
			reason: "STRONG_RELATION_BYPASS",
		});
	});

	it("keeps endpoint breadth before spending budget on additional facets", () => {
		const relations = [
			relation("a1", "new-a", "old-1"),
			relation("a2", "new-a", "old-2"),
			relation("b1", "new-b", "old-3"),
		];
		const result = compactAuditedRelations(
			relations,
			new Set(["claim:new-a", "claim:new-b"]),
			statements(),
			2,
			2,
		);

		expect(result.canonical.some((item) => item.id === "rel:b1")).toBe(true);
		expect(
			new Set(
				result.decisions
					.filter((item) => item.state === "CANONICAL_READY")
					.map((item) => item.newSourceEndpointId),
			),
		).toEqual(new Set(["claim:new-a", "claim:new-b"]));
	});

	it("uses marginal facet diversity and leaves audited drops recoverable but non-canonical", () => {
		const relations = [
			relation("context-8", "new", "context-8"),
			relation("context-70", "new", "context-70"),
			relation("license", "new", "license"),
		];
		const statementMap = statements({
			"claim:new": "Llama 3.1 model family",
			"claim:context-8": "Llama 3.1 8B context length is 128k",
			"claim:context-70": "Llama 3.1 70B context length is 128k",
			"claim:license": "Llama 3.1 uses the Community License",
		});
		const result = compactAuditedRelations(relations, new Set(["claim:new"]), statementMap, 2, 2);

		expect(result.canonical.map((item) => item.id)).toContain("rel:license");
		expect(result.deferred).toHaveLength(1);
		expect(result.deferred[0]?.publicationState).toBe("CANDIDATE");
		expect(
			result.decisions.find((item) => item.state === "DEFERRED_BY_GRAPH_DIVERSITY"),
		).toMatchObject({
			reason: "RELATED_TO_ENDPOINT_FAN_OUT",
		});
	});

	it("fails closed when a purported cross-material edge has no new Source endpoint", () => {
		const result = compactAuditedRelations(
			[relation("old-old", "old-1", "old-2")],
			new Set(["claim:new"]),
			statements(),
		);
		expect(result.canonical).toEqual([]);
		expect(result.deferred).toHaveLength(1);
		expect(result.decisions[0]).toMatchObject({
			state: "DEFERRED_BY_GRAPH_DIVERSITY",
			reason: "MISSING_NEW_SOURCE_ENDPOINT",
		});
	});
});

function relation(
	id: string,
	from: string,
	to: string,
	type: Relation["type"] = "RELATED_TO",
): Relation {
	return {
		id: `rel:${id}`,
		from: claimRef(`claim:${from}`),
		to: claimRef(`claim:${to}`),
		type,
		conditions: [],
		conditionStatus: "EXPLICIT_NONE",
		supersessionEffect: null,
		relationAuditVersion: "relation-audit-v2.8",
		evidenceSpanIds: ["span:test"],
		derivation: "INFERRED",
		validity: "SUPPORTED",
		lifecycle: "ACTIVE",
		publicationState: "CANONICAL",
		validFrom: null,
		validTo: null,
		compilerVersion: "test",
		source: "cross-material-detect",
		confidence: 0.9,
		consumedBy: [],
	};
}

function statements(overrides: Record<string, string> = {}): Map<string, string> {
	return new Map([
		["claim:new", "new claim"],
		["claim:new-a", "new claim a"],
		["claim:new-b", "new claim b"],
		["claim:old-1", "old claim one"],
		["claim:old-2", "old claim two"],
		["claim:old-3", "old claim three"],
		["claim:old-strong", "old strong claim"],
		...Object.entries(overrides),
	]);
}
