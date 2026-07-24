import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { estimateTokens } from "../compiler/telemetry.js";
import type { AppConfig } from "../config/types.js";
import { getRelationTypeSemantics } from "../graph/index.js";
import { publishSourceResult, writeJsonl } from "../linter/storage.js";
import { RELATION_AUDIT_VERSION } from "../prompts/index.js";
import type { Claim, Relation, SourceSpan } from "../types/index.js";
import { claimRef } from "../types/index.js";
import { buildContextPack } from "./index.js";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Context Pack contract", () => {
	it("returns Claim nodes, stable knowledge version, and Global-only data without scope context", () => {
		const config = fixture();
		const first = buildContextPack(config, "Alpha", 4000, 2);
		const second = buildContextPack(config, "Alpha", 4000, 2);
		expect(first.knowledgeVersion).toBe(second.knowledgeVersion);
		expect(first.subgraph.claims.map((claim) => claim.id)).toContain("claim:global");
		expect(first.subgraph.claims.map((claim) => claim.id)).not.toContain("claim:personal");
		expect(first.subgraph.relations).toHaveLength(0);
	});

	it("surfaces Relation conditions when the scoped endpoint is allowed", () => {
		const pack = buildContextPack(fixture(), "Alpha", 4000, 2, { principalId: "user:alice" });
		expect(pack.subgraph.claims.map((claim) => claim.id)).toEqual(
			expect.arrayContaining(["claim:global", "claim:personal"]),
		);
		expect(pack.subgraph.relations).toHaveLength(1);
		expect(pack.conflictsAndConditions.join("\n")).toContain("仅在测试环境");
	});

	it("includes RELATED_TO for navigation without changing its non-supporting semantics", () => {
		const pack = buildContextPack(fixture("RELATED_TO"), "Alpha", 4000, 2, {
			principalId: "user:alice",
		});
		expect(pack.subgraph.relations).toContainEqual(
			expect.objectContaining({ id: "rel:scoped", type: "RELATED_TO" }),
		);
		expect(getRelationTypeSemantics("RELATED_TO").canSupportConclusion).toBe(false);
	});

	it("enforces the serialized token budget while preserving graph/evidence closure", () => {
		const budget = 350;
		const pack = buildContextPack(fixture(), "Alpha", budget, 2, {
			principalId: "user:alice",
		});
		expect(estimateTokens(JSON.stringify(pack))).toBeLessThanOrEqual(budget);
		const claimIds = new Set(pack.subgraph.claims.map((claim) => claim.id));
		const evidenceIds = new Set(pack.evidenceSpans.map((span) => span.id));
		for (const claim of pack.subgraph.claims) {
			expect(claim.evidenceSpanIds.every((spanId) => evidenceIds.has(spanId))).toBe(true);
		}
		for (const relation of pack.subgraph.relations) {
			expect(claimIds.has(relation.from as string)).toBe(true);
			expect(claimIds.has(relation.to as string)).toBe(true);
		}
	});
});

function fixture(relationType: Relation["type"] = "SUPPORTS"): AppConfig {
	const projectRoot = mkdtempSync(join(tmpdir(), "wge-context-"));
	roots.push(projectRoot);
	const config: AppConfig = {
		projectRoot,
		sourcesDir: join(projectRoot, "sources"),
		wikiDir: join(projectRoot, "wiki"),
		quarantineDir: join(projectRoot, "quarantine"),
		indexesDir: join(projectRoot, "indexes"),
		runsDir: join(projectRoot, "runs"),
		apiKey: "test",
		baseUrl: "http://localhost",
		model: "test-model",
		temperature: 0,
	};
	const spans: SourceSpan[] = [
		{
			id: "span:global",
			sourceId: "source:test",
			blockId: "b0",
			charStart: 0,
			charEnd: 13,
			text: "Alpha global.",
		},
		{
			id: "span:personal",
			sourceId: "source:test",
			blockId: "b1",
			charStart: 14,
			charEnd: 29,
			text: "Alpha personal.",
		},
	];
	writeJsonl(join(config.sourcesDir, "test.spans.jsonl"), spans);
	const global = claim("claim:global", "Alpha global theorem", "span:global", { type: "GLOBAL" });
	const personal = claim("claim:personal", "Alpha personal note", "span:personal", {
		type: "PERSONAL",
		id: "user:alice",
	});
	const relation: Relation = {
		id: "rel:scoped",
		from: claimRef(global.id),
		to: claimRef(personal.id),
		type: relationType,
		conditions: ["仅在测试环境"],
		conditionStatus: "PRESERVED",
		relationAuditVersion: RELATION_AUDIT_VERSION,
		evidenceSpanIds: ["span:global", "span:personal"],
		derivation: "INFERRED",
		validity: "SUPPORTED",
		lifecycle: "ACTIVE",
		publicationState: "CANONICAL",
		validFrom: null,
		validTo: null,
		compilerVersion: "test",
		source: "cross-material-detect",
		confidence: 0.8,
		consumedBy: [],
	};
	publishSourceResult(
		config,
		{
			schemaVersion: "v1",
			sourceId: "source:test",
			runId: "run:test",
			publishedAt: "2026-07-23T00:00:00.000Z",
			claims: [global, personal],
			concepts: [],
			relations: [relation],
		},
		{
			schemaVersion: "v1",
			sourceId: "source:test",
			runId: "run:test",
			publishedAt: "2026-07-23T00:00:00.000Z",
			claims: [],
			relations: [],
		},
	);
	return config;
}

function claim(id: string, statement: string, spanId: string, scope: Claim["scope"]): Claim {
	return {
		id,
		statement,
		evidenceSpanIds: [spanId],
		conditions: [],
		derivation: "EXTRACTED",
		validity: "SUPPORTED",
		lifecycle: "ACTIVE",
		publicationState: "CANONICAL",
		validFrom: "2026-07-23T00:00:00.000Z",
		validTo: null,
		compilerVersion: "test",
		confidence: 1,
		claimKind: "FACT",
		scope,
		provenanceRefs: [{ type: "SourceSpan", spanId }],
		supportingEvidenceRefs: [{ type: "SourceSpan", spanId }],
		knowledgeVersion: "test",
		recordedAt: "2026-07-23T00:00:00.000Z",
	};
}
