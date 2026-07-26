import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AppConfig } from "../config/types.js";
import { RELATION_AUDIT_VERSION } from "../prompts/index.js";
import type { Claim, Relation, SourceSpan } from "../types/index.js";
import { claimRef } from "../types/index.js";
import {
	computeKnowledgeVersion,
	findSpansByIds,
	publishCrossMaterialRelations,
	publishSourceResult,
	quarantineCanonicalRelation,
	readAllClaims,
	readAllClaimsQuarantined,
	readAllRelations,
	readAllRelationsQuarantined,
	resolveSpanById,
} from "./storage.js";

const temporaryRoots: string[] = [];

afterEach(() => {
	for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("publication storage", () => {
	it("changes the knowledge version when semantic content changes under a stable ID", () => {
		const original = claim("claim:stable", "旧条件");
		const revised = { ...original, statement: "新条件", conditions: ["仅在新版协议下"] };
		expect(computeKnowledgeVersion([original], [], [])).not.toBe(
			computeKnowledgeVersion([revised], [], []),
		);
	});

	it("atomically replaces a Source snapshot instead of appending duplicates", () => {
		const config = temporaryConfig();
		const first = claim("claim:first", "first");
		const second = claim("claim:second", "second");
		publish(config, "run-1", [first], []);
		expect(readAllClaims(config).map((item) => item.id)).toEqual(["claim:first"]);

		publish(config, "run-2", [second], [first]);
		expect(readAllClaims(config).map((item) => item.id)).toEqual(["claim:second"]);
		expect(readAllClaimsQuarantined(config).map((item) => item.id)).toEqual(["claim:first"]);
	});

	it("resolves deterministic quote spans from persisted base spans", () => {
		const base: SourceSpan = {
			id: "span:test-0",
			sourceId: "source:test",
			blockId: "b0",
			charStart: 10,
			charEnd: 16,
			text: "abcdef",
		};
		const derivedId = "span:test-0#chars-12-15";
		expect(resolveSpanById([base], derivedId)).toMatchObject({
			id: derivedId,
			charStart: 12,
			charEnd: 15,
			text: "cde",
		});
		expect(findSpansByIds([base], [derivedId, derivedId])).toHaveLength(1);
		expect(resolveSpanById([base], "span:test-0#chars-9-15")).toBeNull();
	});

	it("fails closed when reading a legacy Relation without an audit version", () => {
		const config = temporaryConfig();
		const edge = relation("rel:legacy", "intra-material-compile");
		const legacy = Object.fromEntries(
			Object.entries(edge).filter(
				([key]) => key !== "conditionStatus" && key !== "relationAuditVersion",
			),
		) as Relation;
		const publishedAt = "2026-07-23T00:00:00.000Z";
		publishSourceResult(
			config,
			{
				schemaVersion: "v1",
				sourceId: "source:test",
				runId: "run:legacy",
				publishedAt,
				claims: [],
				concepts: [],
				relations: [legacy],
			},
			{
				schemaVersion: "v1",
				sourceId: "source:test",
				runId: "run:legacy",
				publishedAt,
				claims: [],
				relations: [],
			},
		);
		expect(readAllRelations(config)[0]).toMatchObject({
			validity: "UNRESOLVED",
			conditionStatus: "UNVERIFIED",
			relationAuditVersion: null,
		});
	});

	it("replaces cross-material edges idempotently without touching local edges", () => {
		const config = temporaryConfig();
		const publishedAt = "2026-07-23T00:00:00.000Z";
		publishSourceResult(
			config,
			{
				schemaVersion: "v1",
				sourceId: "source:test",
				runId: "run:local",
				publishedAt,
				claims: [claim("claim:a", "a"), claim("claim:b", "b")],
				concepts: [],
				relations: [relation("rel:local", "intra-material-compile")],
			},
			{
				schemaVersion: "v1",
				sourceId: "source:test",
				runId: "run:local",
				publishedAt,
				claims: [],
				relations: [],
			},
		);
		publishCrossMaterialRelations(
			config,
			"source:test",
			"run:cross-1",
			[relation("rel:cross", "cross-material-detect")],
			[],
		);
		publishCrossMaterialRelations(
			config,
			"source:test",
			"run:cross-2",
			[{ ...relation("rel:cross", "cross-material-detect"), confidence: 0.9 }],
			[],
		);
		const edges = readAllRelations(config);
		expect(edges.map((edge) => edge.id).sort()).toEqual(["rel:cross", "rel:local"]);
		expect(edges.find((edge) => edge.id === "rel:cross")?.confidence).toBe(0.9);
	});

	it("quarantines a foreign cross-material edge when its target Source is recompiled", () => {
		const config = temporaryConfig();
		publishSource(config, "source:owner", "run:owner", [claim("claim:a", "a")], []);
		publishSource(config, "source:target", "run:target-1", [claim("claim:b", "b")], []);
		publishCrossMaterialRelations(
			config,
			"source:owner",
			"run:cross",
			[relation("rel:cross", "cross-material-detect")],
			[],
		);
		expect(readAllRelations(config).map((edge) => edge.id)).toContain("rel:cross");

		publishSource(config, "source:target", "run:target-2", [claim("claim:b-v2", "b v2")], []);

		expect(readAllRelations(config).map((edge) => edge.id)).not.toContain("rel:cross");
		expect(readAllRelationsQuarantined(config)).toContainEqual(
			expect.objectContaining({
				id: "rel:cross",
				validity: "UNRESOLVED",
				publicationState: "QUARANTINED",
			}),
		);
	});

	it("retains a human-rejected canonical Relation in quarantine", () => {
		const config = temporaryConfig();
		publishSource(
			config,
			"source:owner",
			"run:owner",
			[claim("claim:a", "a"), claim("claim:b", "b")],
			[relation("rel:review", "intra-material-compile")],
		);

		quarantineCanonicalRelation(config, "rel:review", "方向不成立");

		expect(readAllRelations(config).map((edge) => edge.id)).not.toContain("rel:review");
		expect(readAllRelationsQuarantined(config)).toContainEqual(
			expect.objectContaining({
				id: "rel:review",
				validity: "UNRESOLVED",
				publicationState: "QUARANTINED",
			}),
		);
	});
});

function publishSource(
	config: AppConfig,
	sourceId: string,
	runId: string,
	claims: Claim[],
	relations: Relation[],
): void {
	const publishedAt = "2026-07-23T00:00:00.000Z";
	publishSourceResult(
		config,
		{
			schemaVersion: "v1",
			sourceId,
			runId,
			publishedAt,
			claims,
			concepts: [],
			relations,
		},
		{
			schemaVersion: "v1",
			sourceId,
			runId,
			publishedAt,
			claims: [],
			relations: [],
		},
	);
}

function publish(config: AppConfig, runId: string, claims: Claim[], quarantined: Claim[]): void {
	const publishedAt = "2026-07-23T00:00:00.000Z";
	publishSourceResult(
		config,
		{
			schemaVersion: "v1",
			sourceId: "source:test",
			runId,
			publishedAt,
			claims,
			concepts: [],
			relations: [],
		},
		{
			schemaVersion: "v1",
			sourceId: "source:test",
			runId,
			publishedAt,
			claims: quarantined.map((item) => ({ claim: item, issues: [] })),
			relations: [],
		},
	);
}

function claim(id: string, statement: string): Claim {
	return {
		id,
		statement,
		evidenceSpanIds: ["span:test"],
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
		provenanceRefs: [],
		supportingEvidenceRefs: [],
		knowledgeVersion: "v1",
		recordedAt: "2026-07-23T00:00:00.000Z",
	};
}

function relation(id: string, source: Relation["source"]): Relation {
	return {
		id,
		from: claimRef("claim:a"),
		to: claimRef("claim:b"),
		type: "SUPPORTS",
		conditions: [],
		conditionStatus: "EXPLICIT_NONE",
		supersessionEffect: null,
		relationAuditVersion: RELATION_AUDIT_VERSION,
		evidenceSpanIds: ["span:test"],
		derivation: "INFERRED",
		validity: "SUPPORTED",
		lifecycle: "ACTIVE",
		publicationState: "CANONICAL",
		validFrom: null,
		validTo: null,
		compilerVersion: "test",
		source,
		confidence: 0.8,
		consumedBy: [],
	};
}

function temporaryConfig(): AppConfig {
	const projectRoot = mkdtempSync(join(tmpdir(), "wge-storage-"));
	temporaryRoots.push(projectRoot);
	return {
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
}
