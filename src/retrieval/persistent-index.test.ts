import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../config/index.js";
import { markCanonicalStateChanged } from "../linter/storage.js";
import { RELATION_AUDIT_VERSION } from "../prompts/index.js";
import {
	type Claim,
	type Relation,
	type Source,
	type SourceSpan,
	claimRef,
} from "../types/index.js";
import { retrieveClaimSeeds } from "./index.js";
import {
	buildPersistentSeedIndex,
	ensurePersistentSeedIndexReady,
	loadPersistentKnowledgeNeighborhood,
	retrieveClaimSeedsFromPersistentIndex,
} from "./persistent-index.js";

const temporaryRoots: string[] = [];
afterEach(() => {
	for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("persistent Seed index", () => {
	it("preserves live ranking while reading only touched shards", () => {
		const root = mkdtempSync(join(tmpdir(), "wge-persistent-index-"));
		temporaryRoots.push(root);
		for (const directory of ["sources", "publications", "indexes", "wiki", "quarantine", "runs"]) {
			mkdirSync(join(root, directory), { recursive: true });
		}
		const claims = [
			fixture("climate", "Net removals are limited to 225 million tonnes of CO2 equivalent."),
			fixture("software", "API migrations preserve backward compatibility before removal."),
			fixture("history", "The scroll was imaged using phase-contrast tomography."),
		];
		claims[0].retrievalAliases = ["净碳移除量上限为二亿二千五百万吨二氧化碳当量"];
		const spans = claims.map(
			(claim, index): SourceSpan => ({
				id: claim.evidenceSpanIds[0] ?? "",
				sourceId: `source:s${index}`,
				blockId: "b0",
				charStart: 0,
				charEnd: claim.statement.length,
				text: claim.statement,
			}),
		);
		for (let index = 0; index < spans.length; index++) {
			const source = sourceFixture(`source:s${index}`, `source-${index}.md`);
			writeFileSync(join(root, "sources", `s${index}.json`), JSON.stringify(source));
			writeFileSync(
				join(root, "sources", `s${index}.spans.jsonl`),
				`${JSON.stringify(spans[index])}\n`,
			);
		}
		writeFileSync(
			join(root, "publications", "fixture.json"),
			JSON.stringify({
				schemaVersion: "v1",
				sourceId: "source:fixture",
				runId: "test",
				publishedAt: "2026-07-30T00:00:00.000Z",
				claims,
				concepts: [],
				relations: [],
			}),
		);
		const config = loadConfig({ projectRoot: root });
		const query = "净碳移除量上限是多少？";
		const live = retrieveClaimSeeds(claims, spans, query, 10);
		const built = buildPersistentSeedIndex(config);
		const indexed = retrieveClaimSeedsFromPersistentIndex(
			join(root, "indexes", "retrieval-v1"),
			query,
			10,
		);
		expect(indexed.result.candidates.map((candidate) => candidate.claim.id)).toEqual(
			live.candidates.map((candidate) => candidate.claim.id),
		);
		expect(indexed.result.candidates.map((candidate) => candidate.score)).toEqual(
			live.candidates.map((candidate) => candidate.score),
		);
		expect(indexed.result.candidates[0]?.channels).toContain("alias");
		expect(indexed.diagnostics.totalIndexedClaims).toBe(3);
		expect(indexed.diagnostics.candidateClaimsLoaded).toBeLessThan(3);
		expect(indexed.diagnostics.postingShardsRead).toBeGreaterThan(0);
		expect(built.reused).toBe(false);
		expect(buildPersistentSeedIndex(config).reused).toBe(true);
		markCanonicalStateChanged(config, "test-mutation");
		expect(() =>
			retrieveClaimSeedsFromPersistentIndex(join(root, "indexes", "retrieval-v1"), query, 10),
		).toThrow(/index is stale/u);
		expect(ensurePersistentSeedIndexReady(config).status).toBe("BUILT");
		expect(
			retrieveClaimSeedsFromPersistentIndex(join(root, "indexes", "retrieval-v1"), query, 10).result
				.candidates[0]?.claim.id,
		).toBe(claims[0]?.id);
	});

	it("keeps GLOBAL, PERSONAL and PROJECT visibility partitions isolated", () => {
		const root = mkdtempSync(join(tmpdir(), "wge-persistent-scope-"));
		temporaryRoots.push(root);
		for (const directory of ["sources", "publications", "indexes", "wiki", "quarantine", "runs"]) {
			mkdirSync(join(root, directory), { recursive: true });
		}
		const global = fixture("global", "Roadmap visibility global baseline");
		const personalA = fixture("personal-a", "Roadmap visibility Alice private note");
		personalA.scope = { type: "PERSONAL", id: "alice" };
		const personalB = fixture("personal-b", "Roadmap visibility Bob private note");
		personalB.scope = { type: "PERSONAL", id: "bob" };
		const project = fixture("project", "Roadmap visibility Apollo project note");
		project.scope = { type: "PROJECT", id: "apollo" };
		const claims = [global, personalA, personalB, project];
		const globalToAlice = relationFixture("rel:global-alice", global.id, personalA.id);
		const source = sourceFixture("source:scope", "scope.md");
		const spans = claims.map(
			(claim, index): SourceSpan => ({
				id: claim.evidenceSpanIds[0] ?? "",
				sourceId: source.id,
				blockId: `b${index}`,
				charStart: 0,
				charEnd: claim.statement.length,
				text: claim.statement,
			}),
		);
		writeFileSync(join(root, "sources", "scope.json"), JSON.stringify(source));
		writeFileSync(
			join(root, "sources", "scope.spans.jsonl"),
			`${spans.map((span) => JSON.stringify(span)).join("\n")}\n`,
		);
		writeFileSync(
			join(root, "publications", "scope.json"),
			JSON.stringify({
				schemaVersion: "v1",
				sourceId: source.id,
				runId: "test",
				publishedAt: "2026-07-30T00:00:00.000Z",
				claims,
				concepts: [],
				relations: [globalToAlice],
			}),
		);
		const config = loadConfig({ projectRoot: root });
		buildPersistentSeedIndex(config);
		const indexRoot = join(root, "indexes", "retrieval-v1");
		const globalIds = retrieveClaimSeedsFromPersistentIndex(
			indexRoot,
			"roadmap visibility",
			10,
		).result.candidates.map((candidate) => candidate.claim.id);
		expect(globalIds).toEqual([global.id]);

		const aliceIds = retrieveClaimSeedsFromPersistentIndex(indexRoot, "roadmap visibility", 10, {
			scopeContext: { principalId: "alice" },
		}).result.candidates.map((candidate) => candidate.claim.id);
		expect(new Set(aliceIds)).toEqual(new Set([global.id, personalA.id]));

		const apolloIds = retrieveClaimSeedsFromPersistentIndex(indexRoot, "roadmap visibility", 10, {
			scopeContext: { principalId: "alice", projectId: "apollo" },
		}).result.candidates.map((candidate) => candidate.claim.id);
		expect(new Set(apolloIds)).toEqual(new Set([global.id, personalA.id, project.id]));
		expect(apolloIds).not.toContain(personalB.id);

		const globalNeighborhood = loadPersistentKnowledgeNeighborhood(indexRoot, [global], {
			maxRelationDepth: 1,
		});
		expect(globalNeighborhood.claims.map((claim) => claim.id)).toEqual([global.id]);
		expect(globalNeighborhood.relations).toHaveLength(0);

		const aliceNeighborhood = loadPersistentKnowledgeNeighborhood(indexRoot, [global], {
			scopeContext: { principalId: "alice" },
			maxRelationDepth: 1,
		});
		expect(new Set(aliceNeighborhood.claims.map((claim) => claim.id))).toEqual(
			new Set([global.id, personalA.id]),
		);
		expect(aliceNeighborhood.relations.map((relation) => relation.id)).toEqual([globalToAlice.id]);
		expect(aliceNeighborhood.spans).toHaveLength(2);
		expect(aliceNeighborhood.sources.map((item) => item.id)).toEqual([source.id]);
		expect(aliceNeighborhood.diagnostics.hydratedClaimCount).toBe(2);
	});

	it("hydrates deterministic char-range evidence from its persisted parent Span", () => {
		const root = mkdtempSync(join(tmpdir(), "wge-persistent-child-span-"));
		temporaryRoots.push(root);
		for (const directory of ["sources", "publications", "indexes", "wiki", "quarantine", "runs"]) {
			mkdirSync(join(root, directory), { recursive: true });
		}
		const source = sourceFixture("source:child", "child.md");
		const parentText = "prefix exact evidence suffix";
		const parentSpan: SourceSpan = {
			id: "span:child",
			sourceId: source.id,
			blockId: "b0",
			charStart: 0,
			charEnd: parentText.length,
			text: parentText,
		};
		const claim = fixture("child", "exact evidence");
		claim.evidenceSpanIds = ["span:child#chars-7-21"];
		claim.provenanceRefs = [{ type: "SourceSpan", spanId: claim.evidenceSpanIds[0] }];
		claim.supportingEvidenceRefs = [{ type: "SourceSpan", spanId: claim.evidenceSpanIds[0] }];
		const sibling = fixture("child-sibling", "same block sibling");
		sibling.evidenceSpanIds = ["span:child#chars-0-6"];
		sibling.provenanceRefs = [{ type: "SourceSpan", spanId: sibling.evidenceSpanIds[0] }];
		sibling.supportingEvidenceRefs = [{ type: "SourceSpan", spanId: sibling.evidenceSpanIds[0] }];
		writeFileSync(join(root, "sources", "child.json"), JSON.stringify(source));
		writeFileSync(join(root, "sources", "child.spans.jsonl"), `${JSON.stringify(parentSpan)}\n`);
		writeFileSync(
			join(root, "publications", "child.json"),
			JSON.stringify({
				schemaVersion: "v1",
				sourceId: source.id,
				runId: "test",
				publishedAt: "2026-07-30T00:00:00.000Z",
				claims: [claim, sibling],
				concepts: [],
				relations: [],
			}),
		);
		const config = loadConfig({ projectRoot: root });
		buildPersistentSeedIndex(config);
		const neighborhood = loadPersistentKnowledgeNeighborhood(
			join(root, "indexes", "retrieval-v1"),
			[claim],
			{ includeEvidenceBlockSiblings: true },
		);
		expect(neighborhood.claims.map((item) => item.id)).toEqual([claim.id, sibling.id]);
		expect(neighborhood.spans).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: "span:child#chars-7-21",
					charStart: 7,
					charEnd: 21,
					text: "exact evidence",
				}),
			]),
		);
	});
});

function fixture(id: string, statement: string): Claim {
	const spanId = `span:${id}`;
	return {
		id: `claim:${id}`,
		statement,
		evidenceSpanIds: [spanId],
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
		provenanceRefs: [{ type: "SourceSpan", spanId }],
		supportingEvidenceRefs: [{ type: "SourceSpan", spanId }],
		knowledgeVersion: "test",
		recordedAt: "2026-07-30T00:00:00.000Z",
	};
}

function relationFixture(id: string, from: string, to: string): Relation {
	return {
		id,
		from: claimRef(from),
		to: claimRef(to),
		type: "SUPPORTS",
		conditions: [],
		conditionStatus: "EXPLICIT_NONE",
		supersessionEffect: null,
		relationAuditVersion: RELATION_AUDIT_VERSION,
		evidenceSpanIds: ["span:global"],
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

function sourceFixture(id: string, uri: string): Source {
	return {
		id,
		hash: "hash",
		uri,
		parsedText: "fixture",
		sourceType: "md",
		loaderVersion: "test",
		metadata: {},
		createdAt: "2026-07-30T00:00:00.000Z",
	};
}
