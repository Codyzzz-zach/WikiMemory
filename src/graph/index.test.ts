import { describe, expect, it } from "vitest";
import { RELATION_AUDIT_VERSION } from "../prompts/index.js";
import type { Claim, Relation } from "../types/index.js";
import { claimRef } from "../types/index.js";
import { buildGraph } from "./index.js";

describe("graph publication boundary", () => {
	it("rejects an audited cross-material edge when either endpoint became stale", () => {
		const first = claim("claim:first");
		const second = claim("claim:second");
		const valid = relation("rel:valid", first.id, second.id);
		const dangling = relation("rel:dangling", first.id, "claim:removed-by-recompile");
		const graph = buildGraph([first, second], [], [valid, dangling]);
		expect(graph.relations.map((edge) => edge.id)).toEqual(["rel:valid"]);
	});
});

function claim(id: string): Claim {
	return {
		id,
		statement: "Alpha",
		evidenceSpanIds: ["span:alpha"],
		conditions: [],
		derivation: "EXTRACTED",
		validity: "SUPPORTED",
		lifecycle: "ACTIVE",
		publicationState: "CANONICAL",
		validFrom: null,
		validTo: null,
		compilerVersion: "test",
		confidence: 1,
		claimKind: "FACT",
		scope: { type: "GLOBAL" },
		provenanceRefs: [{ type: "SourceSpan", spanId: "span:alpha" }],
		supportingEvidenceRefs: [{ type: "SourceSpan", spanId: "span:alpha" }],
		knowledgeVersion: "test",
		recordedAt: "2026-07-23T00:00:00.000Z",
	};
}

function relation(id: string, from: string, to: string): Relation {
	return {
		id,
		from: claimRef(from),
		to: claimRef(to),
		type: "SUPPORTS",
		conditions: [],
		conditionStatus: "EXPLICIT_NONE",
		supersessionEffect: null,
		relationAuditVersion: RELATION_AUDIT_VERSION,
		evidenceSpanIds: ["span:alpha"],
		derivation: "INFERRED",
		validity: "SUPPORTED",
		lifecycle: "ACTIVE",
		publicationState: "CANONICAL",
		validFrom: null,
		validTo: null,
		compilerVersion: "test",
		source: "cross-material-detect",
		confidence: 1,
		consumedBy: [],
	};
}
