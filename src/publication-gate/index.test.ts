import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AppConfig } from "../config/types.js";
import type { SourcePublication, SourceQuarantinePublication } from "../linter/storage.js";
import { RELATION_AUDIT_VERSION } from "../prompts/index.js";
import type { Claim, Relation, Source, SourceSpan } from "../types/index.js";
import { evaluatePublicationGate } from "./index.js";

describe("publication diff gate", () => {
	it("passes the first publication when evidence and audited edges are valid", () => {
		const first = claim("claim:first", []);
		const second = claim("claim:second", []);
		const candidate = publication([first, second], [relation(first.id, second.id)]);
		const report = evaluatePublicationGate({
			config: config(),
			runId: "run:first",
			source: source(),
			baseline: null,
			candidate,
			quarantine: emptyQuarantine(),
			allSpans: [span()],
			allCanonicalClaims: [],
		});
		expect(report.status, JSON.stringify(report.issues)).toBe("PASS");
		expect(report.issues).toEqual([]);
	});

	it("blocks a condition regression even when the statement is unchanged", () => {
		const before = claim("claim:conditioned", ["在完备空间中"]);
		const after = claim("claim:unconditioned", []);
		const report = evaluatePublicationGate({
			config: config(),
			runId: "run:condition",
			source: source(),
			baseline: publication([before], []),
			candidate: publication([after], []),
			quarantine: emptyQuarantine(),
			allSpans: [span()],
			allCanonicalClaims: [before],
		});
		expect(report.status).toBe("FAIL");
		expect(report.issues.map((issue) => issue.code)).toContain("CLAIM_CONDITION_DROPPED");
	});

	it("requires explicit review for high churn and records an accepted override", () => {
		const oldClaims = [claim("claim:old-1", []), claim("claim:old-2", [])];
		const candidate = publication([claim("claim:new", [])], []);
		const baseInput = {
			config: config(),
			runId: "run:churn",
			source: source(),
			baseline: publication(oldClaims, []),
			candidate,
			quarantine: emptyQuarantine(),
			allSpans: [span()],
			allCanonicalClaims: oldClaims,
		};
		expect(evaluatePublicationGate(baseInput).status).toBe("REVIEW_REQUIRED");
		expect(evaluatePublicationGate({ ...baseInput, acceptReview: true }).status).toBe("PASS");
	});
});

function config(): AppConfig {
	const root = mkdtempSync(join(tmpdir(), "wge-publication-gate-"));
	return {
		projectRoot: root,
		sourcesDir: join(root, "sources"),
		wikiDir: join(root, "wiki"),
		quarantineDir: join(root, "quarantine"),
		indexesDir: join(root, "indexes"),
		runsDir: join(root, "runs"),
		apiKey: "test",
		baseUrl: "http://localhost",
		model: "test-model",
		temperature: 0,
	};
}

function source(): Source {
	return {
		id: "source:test",
		hash: "source-hash",
		uri: "test.md",
		parsedText: "evidence",
		sourceType: "md",
		loaderVersion: "test",
		createdAt: "2026-07-24T00:00:00.000Z",
	};
}

function span(): SourceSpan {
	return {
		id: "span:test",
		sourceId: "source:test",
		blockId: "block:test",
		charStart: 0,
		charEnd: 8,
		text: "evidence",
	};
}

function claim(id: string, conditions: string[]): Claim {
	return {
		id,
		statement: "相同命题",
		evidenceSpanIds: ["span:test"],
		conditions,
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
		provenanceRefs: [{ type: "SourceSpan", spanId: "span:test" }],
		supportingEvidenceRefs: [{ type: "SourceSpan", spanId: "span:test" }],
		knowledgeVersion: "test",
		recordedAt: "2026-07-24T00:00:00.000Z",
	};
}

function relation(from: string, to: string): Relation {
	return {
		id: "rel:test",
		from: from as Relation["from"],
		to: to as Relation["to"],
		type: "SUPPORTS",
		conditions: [],
		conditionStatus: "EXPLICIT_NONE",
		relationAuditVersion: RELATION_AUDIT_VERSION,
		evidenceSpanIds: ["span:test"],
		derivation: "INFERRED",
		validity: "SUPPORTED",
		lifecycle: "ACTIVE",
		publicationState: "CANONICAL",
		validFrom: null,
		validTo: null,
		compilerVersion: "test",
		source: "intra-material-compile",
		confidence: 1,
		consumedBy: [],
	};
}

function publication(claims: Claim[], relations: Relation[]): SourcePublication {
	return {
		schemaVersion: "v1",
		sourceId: "source:test",
		runId: "run:test",
		publishedAt: "2026-07-24T00:00:00.000Z",
		claims,
		concepts: [],
		relations,
	};
}

function emptyQuarantine(): SourceQuarantinePublication {
	return {
		schemaVersion: "v1",
		sourceId: "source:test",
		runId: "run:test",
		publishedAt: "2026-07-24T00:00:00.000Z",
		claims: [],
		relations: [],
	};
}
