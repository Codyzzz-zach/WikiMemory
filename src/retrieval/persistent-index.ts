import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AppConfig } from "../config/types.js";
import { buildGraph } from "../graph/index.js";
import {
	computeKnowledgeVersion,
	ensureCanonicalStateGeneration,
	readAllAssertedRecords,
	readAllClaims,
	readAllConcepts,
	readAllRelations,
	readAllSources,
	readAllSpans,
	readAllWikiModules,
	readCanonicalStateGeneration,
	resolveSpanById,
	writeJsonAtomic,
} from "../linter/storage.js";
import type { Claim, Relation, Scope, ScopeContext, Source, SourceSpan } from "../types/index.js";
import {
	type SeedRetrievalResult,
	type SeedSearchCorpus,
	type SeedSearchDocument,
	buildSeedSearchCorpus,
	extractExplicitTemporalMonthRange,
	lexicalFeatures,
	retrieveClaimSeedsFromCorpus,
} from "./index.js";
import {
	type SourceRoutingPoolClaim,
	clampSourceRoutingOptions,
	selectSourceRoutedCandidates,
} from "./source-routing.js";
import {
	type StructuralCandidate,
	type StructuralCandidateAggregate,
	type StructuralCandidateOptions,
	type StructuralCandidateResult,
	type StructuralCandidateTrace,
	type StructuralPathKind,
	orderStructuralCandidates,
} from "./structure.js";

const INDEX_SCHEMA = "wge-persistent-seed-index/v7" as const;

interface PersistedSeedDocument {
	documentId: number;
	claim: Claim;
	normalizedBaseText: string;
	normalizedTotalText: string;
	temporalMonths: number[];
}

interface ClaimLocator {
	claimId: string;
	documentId: number;
}

export interface PersistedSourceDescriptor {
	id: string;
	hash: string;
	uri: string;
	sourceType: Source["sourceType"];
	loaderVersion: string;
	metadata?: Record<string, string>;
	createdAt: string;
}

interface RelationAdjacencyRecord {
	nodeId: string;
	relations: Relation[];
}

interface SourceClaimsRecord {
	sourceId: string;
	claimIds: string[];
}

interface SpanClaimsRecord {
	blockKey: string;
	claimIds: string[];
}

interface FeaturePosting {
	feature: string;
	baseDocumentIds: number[];
	totalDocumentIds: number[];
	aliasDocumentIds: number[];
	sourceDocumentIds: number[];
	baseDocumentFrequency: number;
	totalDocumentFrequency: number;
}

interface PersistentIndexMeta {
	schemaVersion: typeof INDEX_SCHEMA;
	indexVersion: string;
	builtAt: string;
	canonicalStateGeneration: string;
	knowledgeVersion: string;
	totalDocumentCount: number;
	featureCount: number;
	scopeKeysByDocument: string[];
	claimIdsByDocument: string[];
	temporalMonthsByDocument: number[][];
	spanCount: number;
	sourceCount: number;
	auditedRelationCount: number;
	diagnostics: SeedSearchCorpus["diagnostics"];
}

interface CurrentIndexPointer {
	schemaVersion: typeof INDEX_SCHEMA;
	indexVersion: string;
	snapshotRelativePath: string;
	canonicalGenerationPath: string;
}

export interface PersistentSeedIndexBuildResult {
	indexVersion: string;
	snapshotPath: string;
	reused: boolean;
	totalDocumentCount: number;
	featureCount: number;
}

export interface PersistentSeedIndexReadyResult {
	status: "REUSED" | "BUILT";
	indexVersion: string;
	canonicalStateGeneration: string;
	indexRoot: string;
}

export interface PersistentSeedRetrievalDiagnostics {
	indexVersion: string;
	canonicalStateGeneration: string;
	knowledgeVersion: string;
	totalIndexedClaims: number;
	queryFeatureCount: number;
	postingShardsRead: number;
	recordShardsRead: number;
	postingRowsDecoded: number;
	recordRowsDecoded: number;
	candidateClaimsLoaded: number;
	temporalScope: {
		applied: boolean;
		startMonth: string | null;
		endMonth: string | null;
		excludedClaimIds: string[];
	};
}

export interface PersistentSeedRetrievalResult {
	result: SeedRetrievalResult;
	/** All scope-visible documents touched by query features; used by map-first parity checks. */
	matchedClaims: Claim[];
	diagnostics: PersistentSeedRetrievalDiagnostics;
}

export interface PersistentSeedQueryOptions {
	/** Missing context is deliberately GLOBAL-only, matching Context Pack's scope contract. */
	scopeContext?: ScopeContext;
}

export interface PersistentNeighborhoodOptions extends PersistentSeedQueryOptions {
	maxRelationDepth?: number;
	maxClaims?: number;
	includeSourceSiblings?: boolean;
	includeEvidenceBlockSiblings?: boolean;
	temporalQuery?: string;
}

export interface PersistentSourceRoutingOptions extends PersistentSeedQueryOptions {
	/** routing pool 预算：默认/上限 120（Goal 3-B2 契约 v1）。 */
	routingPoolBudget?: number;
	/** source 预算：默认/上限 12（Goal 3-B2 契约 v1）。 */
	sourceBudget?: number;
	/** 候选预算：默认/上限 40（Goal 3-B2 契约 v1）。 */
	candidateBudget?: number;
	/** 与现有 neighborhood/structural 检索相同的显式月份区间语义；缺省时从 query 提取。 */
	temporalQuery?: string;
}

export interface PersistentSourceRoutedCandidate {
	claim: Claim;
	/** 该 Claim 在 routing pool 中的 1-based 词法排位。 */
	lexicalRank: number;
	/** 该 Claim 映射到的 selected sources，按 source 选择顺序。 */
	routedSourceIds: string[];
	/** 是否为某个 selected source 的最高排位 Claim（阶段 1 保证项）。 */
	guaranteed: boolean;
}

export interface PersistentSourceRoutingTrace {
	sourceId: string;
	firstLexicalRank: number;
	/** 路由到该 source 的 routing-pool Claim ID，按词法顺序。 */
	claimIds: string[];
	selected: boolean;
}

export interface PersistentSourceRoutingDiagnostics {
	indexVersion: string;
	canonicalStateGeneration: string;
	knowledgeVersion: string;
	/** routing pool 大小（clamp 后、evidence 解析前）。 */
	routingPoolClaimCount: number;
	discoveredSourceCount: number;
	selectedSourceCount: number;
	candidateClaimCount: number;
	/** 最终候选实际涉及的 selected source 数（≤ selectedSourceCount）。 */
	candidateSourceCount: number;
	spanShardsReadForRouting: number;
	/** 无法解析出任何 evidence source 的 routing-pool Claim 数。 */
	unresolvedEvidenceCount: number;
	/** routing 阶段无法解析的 evidence span 引用数。 */
	unresolvedEvidenceRefCount: number;
	temporalScope: {
		applied: boolean;
		startMonth: string | null;
		endMonth: string | null;
		excludedClaimIds: string[];
	};
	lexical: {
		queryFeatureCount: number;
		eligibleClaimCount: number;
		matchedClaimCount: number;
		postingShardsRead: number;
		recordShardsRead: number;
		postingRowsDecoded: number;
		recordRowsDecoded: number;
		candidateClaimsLoaded: number;
		resolvedEvidenceRefCount: number;
		unresolvedEvidenceRefCount: number;
	};
}

export interface PersistentSourceRoutingResult {
	candidates: PersistentSourceRoutedCandidate[];
	/** selected source 描述，按 source 选择顺序。 */
	sources: PersistedSourceDescriptor[];
	/** 全部 discovered sources 的显式路由 trace。 */
	traces: PersistentSourceRoutingTrace[];
	diagnostics: PersistentSourceRoutingDiagnostics;
}

export interface PersistentKnowledgeNeighborhood {
	claims: Claim[];
	relations: Relation[];
	spans: SourceSpan[];
	sources: PersistedSourceDescriptor[];
	diagnostics: {
		indexVersion: string;
		canonicalStateGeneration: string;
		claimLocatorShardsRead: number;
		claimRecordShardsRead: number;
		relationAdjacencyShardsRead: number;
		spanShardsRead: number;
		sourceShardsRead: number;
		sourceClaimShardsRead: number;
		spanClaimShardsRead: number;
		seedClaimCount: number;
		hydratedClaimCount: number;
		hydratedRelationCount: number;
		hydratedSpanCount: number;
		hydratedSourceCount: number;
	};
}

/** Build an immutable, sharded and fully rebuildable query index from Canonical state. */
export function buildPersistentSeedIndex(
	config: AppConfig,
	indexRoot = join(config.indexesDir, "retrieval-v1"),
): PersistentSeedIndexBuildResult {
	const canonicalStateGeneration = ensureCanonicalStateGeneration(config);
	const claims = readAllClaims(config);
	const spans = readAllSpans(config);
	const sources = readAllSources(config);
	const concepts = readAllConcepts(config);
	const allRelations = readAllRelations(config);
	const wikiModules = readAllWikiModules(config);
	const knowledgeVersion = computeKnowledgeVersion(
		claims,
		concepts,
		allRelations,
		wikiModules,
		readAllAssertedRecords(config),
	);
	const auditedRelations = buildGraph(claims, concepts, allRelations).relations;
	const sourceSearchText = new Map(
		sources.map(
			(source) =>
				[
					source.id,
					[source.uri, source.sourceType, ...Object.entries(source.metadata ?? {}).flat()].join(
						"\n",
					),
				] as const,
		),
	);
	const corpus = buildSeedSearchCorpus(claims, spans, sourceSearchText);
	const orderedDocuments = [...corpus.documents].sort((left, right) =>
		left.claim.id.localeCompare(right.claim.id),
	);
	const persistedDocuments = orderedDocuments.map((document, documentId) =>
		serializeDocument(document, documentId),
	);
	const claimLocators = persistedDocuments.map(
		(document): ClaimLocator => ({
			claimId: document.claim.id,
			documentId: document.documentId,
		}),
	);
	const sourceDescriptors = sources
		.map(toSourceDescriptor)
		.sort((left, right) => left.id.localeCompare(right.id));
	const orderedSpans = [...spans].sort((left, right) => left.id.localeCompare(right.id));
	const relationAdjacency = buildRelationAdjacency(auditedRelations);
	const sourceClaims = buildSourceClaims(persistedDocuments, orderedSpans);
	const spanClaims = buildSpanClaims(persistedDocuments, orderedSpans);
	const postings = buildPostings(orderedDocuments);
	const scopeKeysByDocument = orderedDocuments.map((document) => scopeKey(document.claim.scope));
	const claimIdsByDocument = orderedDocuments.map((document) => document.claim.id);
	const temporalMonthsByDocument = orderedDocuments.map((document) => document.temporalMonths);
	const indexVersion = hash(
		JSON.stringify({
			schemaVersion: INDEX_SCHEMA,
			canonicalStateGeneration,
			knowledgeVersion,
			documents: persistedDocuments,
			scopeKeysByDocument,
			claimIdsByDocument,
			temporalMonthsByDocument,
			spans: orderedSpans,
			sources: sourceDescriptors,
			relationAdjacency,
			sourceClaims,
			spanClaims,
			frequencies: postings.map((posting) => [
				posting.feature,
				posting.baseDocumentFrequency,
				posting.totalDocumentFrequency,
			]),
		}),
	);
	const snapshotRelativePath = join("snapshots", indexVersion);
	const snapshotPath = join(indexRoot, snapshotRelativePath);
	const metaPath = join(snapshotPath, "meta.json");
	const reused = existsSync(metaPath);
	if (!reused) {
		mkdirSync(join(snapshotPath, "postings"), { recursive: true });
		mkdirSync(join(snapshotPath, "records"), { recursive: true });
		mkdirSync(join(snapshotPath, "claim-locators"), { recursive: true });
		mkdirSync(join(snapshotPath, "spans"), { recursive: true });
		mkdirSync(join(snapshotPath, "sources"), { recursive: true });
		mkdirSync(join(snapshotPath, "relation-adjacency"), { recursive: true });
		mkdirSync(join(snapshotPath, "source-claims"), { recursive: true });
		mkdirSync(join(snapshotPath, "span-claims"), { recursive: true });
		writeShards(join(snapshotPath, "postings"), postings, (posting) => posting.feature);
		writeShards(
			join(snapshotPath, "records"),
			persistedDocuments,
			(document) => document.documentId,
		);
		writeShards(join(snapshotPath, "claim-locators"), claimLocators, (item) => item.claimId);
		writeShards(join(snapshotPath, "spans"), orderedSpans, (span) => span.id);
		writeShards(join(snapshotPath, "sources"), sourceDescriptors, (source) => source.id);
		writeShards(join(snapshotPath, "relation-adjacency"), relationAdjacency, (item) => item.nodeId);
		writeShards(join(snapshotPath, "source-claims"), sourceClaims, (item) => item.sourceId);
		writeShards(join(snapshotPath, "span-claims"), spanClaims, (item) => item.blockKey);
		const meta: PersistentIndexMeta = {
			schemaVersion: INDEX_SCHEMA,
			indexVersion,
			builtAt: new Date().toISOString(),
			canonicalStateGeneration,
			knowledgeVersion,
			totalDocumentCount: corpus.totalDocumentCount,
			featureCount: postings.length,
			scopeKeysByDocument,
			claimIdsByDocument,
			temporalMonthsByDocument,
			spanCount: orderedSpans.length,
			sourceCount: sourceDescriptors.length,
			auditedRelationCount: auditedRelations.length,
			diagnostics: corpus.diagnostics,
		};
		writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
	}
	if (readCanonicalStateGeneration(config) !== canonicalStateGeneration) {
		throw new Error("Canonical state changed while building persistent retrieval index");
	}
	const pointer: CurrentIndexPointer = {
		schemaVersion: INDEX_SCHEMA,
		indexVersion,
		snapshotRelativePath,
		canonicalGenerationPath: join(config.indexesDir, "canonical-state-generation.json"),
	};
	writeJsonAtomic(join(indexRoot, "current.json"), pointer);
	return {
		indexVersion,
		snapshotPath,
		reused,
		totalDocumentCount: corpus.totalDocumentCount,
		featureCount: postings.length,
	};
}

/**
 * Fast operational readiness check. A valid pointer is reused without scanning
 * Canonical state; missing, old-schema or stale pointers trigger a synchronous rebuild.
 * Stale snapshots are never returned to a caller.
 */
export function ensurePersistentSeedIndexReady(
	config: AppConfig,
	indexRoot = join(config.indexesDir, "retrieval-v1"),
): PersistentSeedIndexReadyResult {
	try {
		const { meta } = openCurrentIndex(indexRoot);
		return {
			status: "REUSED",
			indexVersion: meta.indexVersion,
			canonicalStateGeneration: meta.canonicalStateGeneration,
			indexRoot,
		};
	} catch {
		const built = buildPersistentSeedIndex(config, indexRoot);
		const { meta } = openCurrentIndex(indexRoot);
		return {
			status: "BUILT",
			indexVersion: built.indexVersion,
			canonicalStateGeneration: meta.canonicalStateGeneration,
			indexRoot,
		};
	}
}

/** Query only feature and record shards touched by the current task. */
export function retrieveClaimSeedsFromPersistentIndex(
	indexRoot: string,
	query: string,
	limit = 10,
	options: PersistentSeedQueryOptions = {},
): PersistentSeedRetrievalResult {
	const pointer = readJson<CurrentIndexPointer>(join(indexRoot, "current.json"));
	if (pointer.schemaVersion !== INDEX_SCHEMA)
		throw new Error("Unsupported retrieval index pointer");
	const snapshotPath = join(indexRoot, pointer.snapshotRelativePath);
	const meta = readJson<PersistentIndexMeta>(join(snapshotPath, "meta.json"));
	if (meta.schemaVersion !== INDEX_SCHEMA || meta.indexVersion !== pointer.indexVersion) {
		throw new Error("Persistent retrieval index pointer/meta mismatch");
	}
	const currentGeneration = readCanonicalStateGenerationAtPath(pointer.canonicalGenerationPath);
	if (currentGeneration !== meta.canonicalStateGeneration) {
		throw new Error(
			`Persistent retrieval index is stale: indexed=${meta.canonicalStateGeneration}, current=${currentGeneration}`,
		);
	}
	const queryFeatures = [...lexicalFeatures(query)];
	const postingShardNames = [...new Set(queryFeatures.map(shardName))];
	const queryFeatureSet = new Set(queryFeatures);
	const postingRows = postingShardNames.flatMap((name) =>
		readJsonl<FeaturePosting>(join(snapshotPath, "postings", `${name}.jsonl`)),
	);
	const matchedPostings = postingRows.filter((posting) => queryFeatureSet.has(posting.feature));
	const allowedScopeKeys = visibleScopeKeys(options.scopeContext);
	const temporalRange = extractExplicitTemporalMonthRange(query);
	const isTemporallyVisible = (documentId: number) =>
		isDocumentInTemporalRange(meta, documentId, temporalRange);
	const isVisibleDocument = (documentId: number) =>
		allowedScopeKeys.has(meta.scopeKeysByDocument[documentId] ?? "GLOBAL") &&
		isTemporallyVisible(documentId);
	const candidateIds = new Set(
		matchedPostings.flatMap((posting) => posting.totalDocumentIds).filter(isVisibleDocument),
	);
	const recordShardNames = [...new Set([...candidateIds].map(recordShardName))];
	const recordRows = recordShardNames.flatMap((name) =>
		readJsonl<PersistedSeedDocument>(join(snapshotPath, "records", `${name}.jsonl`)),
	);
	const matchedFeaturesByDocument = buildMatchedFeaturesByDocument(matchedPostings);
	const documents = recordRows
		.filter((document) => candidateIds.has(document.documentId))
		.map((document) =>
			deserializeDocument(document, matchedFeaturesByDocument.get(document.documentId)),
		);
	const baseDocumentFrequency = new Map(
		matchedPostings.map((posting) => [
			posting.feature,
			posting.baseDocumentIds.filter(isVisibleDocument).length,
		]),
	);
	const totalDocumentFrequency = new Map(
		matchedPostings.map((posting) => [
			posting.feature,
			posting.totalDocumentIds.filter(isVisibleDocument).length,
		]),
	);
	const visibleDocumentCount = meta.scopeKeysByDocument.filter(
		(key, documentId) => allowedScopeKeys.has(key) && isTemporallyVisible(documentId),
	).length;
	const corpus: SeedSearchCorpus = {
		documents,
		totalDocumentCount: visibleDocumentCount,
		baseDocumentFrequency,
		totalDocumentFrequency,
		diagnostics: { ...meta.diagnostics, eligibleClaimCount: visibleDocumentCount },
	};
	return {
		result: retrieveClaimSeedsFromCorpus(corpus, query, limit),
		matchedClaims: documents.map((document) => document.claim),
		diagnostics: {
			indexVersion: meta.indexVersion,
			canonicalStateGeneration: meta.canonicalStateGeneration,
			knowledgeVersion: meta.knowledgeVersion,
			totalIndexedClaims: visibleDocumentCount,
			queryFeatureCount: queryFeatures.length,
			postingShardsRead: postingShardNames.length,
			recordShardsRead: recordShardNames.length,
			postingRowsDecoded: postingRows.length,
			recordRowsDecoded: recordRows.length,
			candidateClaimsLoaded: documents.length,
			temporalScope: {
				applied: temporalRange !== null,
				startMonth: temporalRange ? formatMonthNumber(temporalRange.start) : null,
				endMonth: temporalRange ? formatMonthNumber(temporalRange.end) : null,
				excludedClaimIds: temporalRange
					? meta.claimIdsByDocument.filter(
							(_claimId, documentId) =>
								allowedScopeKeys.has(meta.scopeKeysByDocument[documentId] ?? "GLOBAL") &&
								!isTemporallyVisible(documentId),
						)
					: [],
			},
		},
	};
}

/** Hydrate only the evidence and audited relation neighborhood reachable from selected Seeds. */
export function loadPersistentKnowledgeNeighborhood(
	indexRoot: string,
	seedClaims: Claim[],
	options: PersistentNeighborhoodOptions = {},
): PersistentKnowledgeNeighborhood {
	const { snapshotPath, meta } = openCurrentIndex(indexRoot);
	const maxRelationDepth = Math.max(0, Math.min(options.maxRelationDepth ?? 1, 4));
	const maxClaims = Math.max(seedClaims.length, options.maxClaims ?? 40);
	const allowedScopeKeys = visibleScopeKeys(options.scopeContext);
	const temporalRange = options.temporalQuery
		? extractExplicitTemporalMonthRange(options.temporalQuery)
		: null;
	const visible = (documentId: number) =>
		allowedScopeKeys.has(meta.scopeKeysByDocument[documentId] ?? "GLOBAL") &&
		isDocumentInTemporalRange(meta, documentId, temporalRange);
	const claims = new Map(
		seedClaims
			.filter((claim) => allowedScopeKeys.has(scopeKey(claim.scope)))
			.map((claim) => [claim.id, claim] as const),
	);
	const relations = new Map<string, Relation>();
	const claimLocatorShards = new Set<string>();
	const claimRecordShards = new Set<string>();
	const relationAdjacencyShards = new Set<string>();
	const spanShards = new Set<string>();
	const sourceShards = new Set<string>();
	const sourceClaimShards = new Set<string>();
	const spanClaimShards = new Set<string>();
	let frontier = [...claims.keys()];

	for (let depth = 0; depth < maxRelationDepth && frontier.length > 0; depth++) {
		const adjacency = readShardedRows<RelationAdjacencyRecord>(
			join(snapshotPath, "relation-adjacency"),
			frontier,
		);
		addAll(relationAdjacencyShards, adjacency.shardNames);
		const candidates = adjacency.rows
			.filter((row) => frontier.includes(row.nodeId))
			.flatMap((row) => row.relations)
			.filter((relation, index, all) => all.findIndex((item) => item.id === relation.id) === index)
			.sort((left, right) => left.id.localeCompare(right.id));
		const endpointIds = [
			...new Set(
				candidates.flatMap((relation) => [relation.from as string, relation.to as string]),
			),
		].filter((id) => id.startsWith("claim:") && !claims.has(id));
		const remainingSlots = Math.max(0, maxClaims - claims.size);
		const hydrated = hydrateClaimsByIds(
			snapshotPath,
			endpointIds.slice(0, remainingSlots),
			visible,
		);
		addAll(claimLocatorShards, hydrated.locatorShards);
		addAll(claimRecordShards, hydrated.recordShards);
		for (const claim of hydrated.claims) claims.set(claim.id, claim);
		for (const relation of candidates) {
			if (claims.has(relation.from as string) && claims.has(relation.to as string)) {
				relations.set(relation.id, relation);
			}
		}
		frontier = hydrated.claims.map((claim) => claim.id);
	}

	let spanResult = hydrateSpansForClaims(snapshotPath, [...claims.values()]);
	addAll(spanShards, spanResult.shardNames);
	if (options.includeEvidenceBlockSiblings && claims.size < maxClaims) {
		const seedSpanIds = new Set(seedClaims.flatMap((claim) => claim.evidenceSpanIds));
		const blockKeys = [
			...new Set(
				spanResult.spans
					.filter((span) => seedSpanIds.has(span.id))
					.map((span) => evidenceBlockKey(span)),
			),
		];
		const siblingRows = readShardedRows<SpanClaimsRecord>(
			join(snapshotPath, "span-claims"),
			blockKeys,
		);
		addAll(spanClaimShards, siblingRows.shardNames);
		const siblingIds = [
			...new Set(
				siblingRows.rows
					.filter((row) => blockKeys.includes(row.blockKey))
					.flatMap((row) => row.claimIds),
			),
		].filter((id) => !claims.has(id));
		const hydrated = hydrateClaimsByIds(
			snapshotPath,
			siblingIds.slice(0, Math.max(0, maxClaims - claims.size)),
			visible,
		);
		addAll(claimLocatorShards, hydrated.locatorShards);
		addAll(claimRecordShards, hydrated.recordShards);
		for (const claim of hydrated.claims) claims.set(claim.id, claim);
		spanResult = hydrateSpansForClaims(snapshotPath, [...claims.values()]);
		addAll(spanShards, spanResult.shardNames);
	}
	if (options.includeSourceSiblings && claims.size < maxClaims) {
		const sourceIds = [...new Set(spanResult.spans.map((span) => span.sourceId))];
		const siblingRows = readShardedRows<SourceClaimsRecord>(
			join(snapshotPath, "source-claims"),
			sourceIds,
		);
		addAll(sourceClaimShards, siblingRows.shardNames);
		const siblingIds = [
			...new Set(
				siblingRows.rows
					.filter((row) => sourceIds.includes(row.sourceId))
					.flatMap((row) => row.claimIds),
			),
		].filter((id) => !claims.has(id));
		const hydrated = hydrateClaimsByIds(
			snapshotPath,
			siblingIds.slice(0, Math.max(0, maxClaims - claims.size)),
			visible,
		);
		addAll(claimLocatorShards, hydrated.locatorShards);
		addAll(claimRecordShards, hydrated.recordShards);
		for (const claim of hydrated.claims) claims.set(claim.id, claim);
		spanResult = hydrateSpansForClaims(snapshotPath, [...claims.values()]);
		addAll(spanShards, spanResult.shardNames);
	}
	const sourceIds = [...new Set(spanResult.spans.map((span) => span.sourceId))];
	const sourceResult = readShardedRows<PersistedSourceDescriptor>(
		join(snapshotPath, "sources"),
		sourceIds,
	);
	addAll(sourceShards, sourceResult.shardNames);
	const sources = sourceResult.rows
		.filter((source) => sourceIds.includes(source.id))
		.sort((left, right) => left.id.localeCompare(right.id));

	return {
		claims: [...claims.values()],
		relations: [...relations.values()].sort((left, right) => left.id.localeCompare(right.id)),
		spans: spanResult.spans,
		sources,
		diagnostics: {
			indexVersion: meta.indexVersion,
			canonicalStateGeneration: meta.canonicalStateGeneration,
			claimLocatorShardsRead: claimLocatorShards.size,
			claimRecordShardsRead: claimRecordShards.size,
			relationAdjacencyShardsRead: relationAdjacencyShards.size,
			spanShardsRead: spanShards.size,
			sourceShardsRead: sourceShards.size,
			sourceClaimShardsRead: sourceClaimShards.size,
			spanClaimShardsRead: spanClaimShards.size,
			seedClaimCount: seedClaims.length,
			hydratedClaimCount: claims.size,
			hydratedRelationCount: relations.size,
			hydratedSpanCount: spanResult.spans.length,
			hydratedSourceCount: sources.length,
		},
	};
}

/**
 * Goal 3-B 第一小包：基于 v7 索引的 span-claims / source-claims adjacency
 * 做纯结构候选发现。只扩大候选视野，不承担事实推理权；不构造图边、
 * 不返回 Relation、不写 knowledge state / index。可见性与排序语义与现有
 * lexical 检索一致（Seed 不混入 candidates）。
 */
export function discoverStructuralCandidates(
	indexRoot: string,
	seedClaims: Claim[],
	options: StructuralCandidateOptions = {},
): StructuralCandidateResult {
	const { snapshotPath, meta } = openCurrentIndex(indexRoot);
	const maxCandidates = Math.max(0, options.maxCandidates ?? 40);
	const allowedScopeKeys = visibleScopeKeys(options.scopeContext);
	const temporalRange = options.temporalQuery
		? extractExplicitTemporalMonthRange(options.temporalQuery)
		: null;
	const visible = (documentId: number) =>
		allowedScopeKeys.has(meta.scopeKeysByDocument[documentId] ?? "GLOBAL") &&
		isDocumentInTemporalRange(meta, documentId, temporalRange);
	const seeds = [...new Map(seedClaims.map((claim) => [claim.id, claim] as const)).values()].filter(
		(claim) => allowedScopeKeys.has(scopeKey(claim.scope)),
	);
	const seedOrder = new Map(seeds.map((claim, index) => [claim.id, index] as const));

	// Goal 3-B 离线消融：pathKinds 过滤必须在 adjacency 读取与 trace 生成
	// 之前完成；缺省 = 两类全开（与既有行为完全一致），空数组 = 不读取
	// 任何 adjacency shard、不生成 trace（仍走上方 openCurrentIndex 的
	// stale fail-closed）。
	const enabledPathKinds: ReadonlySet<StructuralPathKind> = new Set(
		options.pathKinds ?? ["SAME_EVIDENCE_BLOCK", "SAME_SOURCE"],
	);
	const wantBlockPaths = enabledPathKinds.has("SAME_EVIDENCE_BLOCK");
	const wantSourcePaths = enabledPathKinds.has("SAME_SOURCE");

	const spanClaimShards = new Set<string>();
	const sourceClaimShards = new Set<string>();
	let seedSpans: { seed: Claim; span: SourceSpan }[] = [];
	let spanClaimRows: { rows: SpanClaimsRecord[] } = { rows: [] };
	let sourceClaimRows: { rows: SourceClaimsRecord[] } = { rows: [] };
	if (wantBlockPaths || wantSourcePaths) {
		const seedSpanIds = [
			...new Set(seeds.flatMap((seed) => seed.evidenceSpanIds.map(persistedSpanId))),
		];
		const spanResult = readShardedRows<SourceSpan>(join(snapshotPath, "spans"), seedSpanIds);
		const spanById = new Map(spanResult.rows.map((span) => [span.id, span] as const));
		seedSpans = seeds.flatMap((seed) =>
			[...new Set(seed.evidenceSpanIds.map(persistedSpanId))].flatMap((spanId) => {
				const span = spanById.get(spanId);
				return span ? [{ seed, span }] : [];
			}),
		);
		const blockKeys = [...new Set(seedSpans.map(({ span }) => evidenceBlockKey(span)))];
		const sourceIds = [...new Set(seedSpans.map(({ span }) => span.sourceId))];
		if (wantBlockPaths) {
			const rows = readShardedRows<SpanClaimsRecord>(join(snapshotPath, "span-claims"), blockKeys);
			addAll(spanClaimShards, rows.shardNames);
			spanClaimRows = rows;
		}
		if (wantSourcePaths) {
			const rows = readShardedRows<SourceClaimsRecord>(
				join(snapshotPath, "source-claims"),
				sourceIds,
			);
			addAll(sourceClaimShards, rows.shardNames);
			sourceClaimRows = rows;
		}
	}

	const traces: StructuralCandidateTrace[] = [];
	for (const { seed, span } of seedSpans) {
		const blockKey = evidenceBlockKey(span);
		if (wantBlockPaths) {
			for (const row of spanClaimRows.rows) {
				if (row.blockKey !== blockKey) continue;
				for (const claimId of row.claimIds) {
					// 排除 seedOrder 中全部 Seed id，而非仅当前 seed：否则多 Seed 时
					// 另一个 Seed 会被当作新增候选混入 candidates。
					if (seedOrder.has(claimId)) continue;
					traces.push({
						seedClaimId: seed.id,
						candidateClaimId: claimId,
						pathKind: "SAME_EVIDENCE_BLOCK",
						viaSourceId: span.sourceId,
						viaBlockId: span.blockId,
					});
				}
			}
		}
		if (wantSourcePaths) {
			for (const row of sourceClaimRows.rows) {
				if (row.sourceId !== span.sourceId) continue;
				for (const claimId of row.claimIds) {
					if (seedOrder.has(claimId)) continue;
					traces.push({
						seedClaimId: seed.id,
						candidateClaimId: claimId,
						pathKind: "SAME_SOURCE",
						viaSourceId: span.sourceId,
					});
				}
			}
		}
	}

	const aggregates = orderStructuralCandidates(traces, seedOrder);

	// 先对所有去重候选按 locator 做 scope/temporal 分类，再渐进检查 evidence；
	// 分类必须发生在截断之前，否则不可见候选会占用预算名额并挤掉后续可见候选。
	let scopeExcludedCount = 0;
	let temporalExcludedCount = 0;
	let unresolvedEvidenceExcludedCount = 0;
	const visibleAggregates: StructuralCandidateAggregate[] = [];
	if (aggregates.length > 0) {
		const locatorResult = readShardedRows<ClaimLocator>(
			join(snapshotPath, "claim-locators"),
			aggregates.map((aggregate) => aggregate.claimId),
		);
		const locatorById = new Map(
			locatorResult.rows.map((locator) => [locator.claimId, locator] as const),
		);
		for (const aggregate of aggregates) {
			const locator = locatorById.get(aggregate.claimId);
			if (!locator) {
				// span-claims / source-claims 引用的 claim 必在索引中；此分支仅为防御。
				// 缺 locator = 不可水合，与「evidence 不可解析」统一计入
				// unresolvedEvidenceExcludedCount 这一防御桶，保持诊断等式账平。
				unresolvedEvidenceExcludedCount++;
				continue;
			}
			if (!allowedScopeKeys.has(meta.scopeKeysByDocument[locator.documentId] ?? "GLOBAL")) {
				scopeExcludedCount++;
			} else if (!isDocumentInTemporalRange(meta, locator.documentId, temporalRange)) {
				temporalExcludedCount++;
			} else {
				visibleAggregates.push(aggregate);
			}
		}
	}

	// 渐进式有界优先流水线：不一次性水合全部可见候选（避免放大知识库 I/O），
	// 而是按固定小批次 hydrate + evidence 检查。遇到 evidence 不可解析的候选
	// 计入 unresolvedEvidenceExcludedCount 并继续向后扫描补位；一旦收集满
	// maxCandidates 个可解析候选即停止扫描。maxCandidates=0 时不进入扫描，
	// 所有可见候选都因预算未返回（计入 truncated）。
	const batchSize = Math.max(1, Math.min(32, maxCandidates || 1));
	const candidates: StructuralCandidate[] = [];
	let remainingSlots = maxCandidates;
	let inspectedCandidateCount = 0;
	let truncatedInBatch = 0;
	const resolvedSpanIds = new Set<string>();
	for (
		let offset = 0;
		offset < visibleAggregates.length && remainingSlots > 0;
		offset += batchSize
	) {
		const batch = visibleAggregates.slice(offset, offset + batchSize);
		const hydrated = hydrateClaimsByIds(
			snapshotPath,
			batch.map((aggregate) => aggregate.claimId),
			visible,
		);
		const claimById = new Map(hydrated.claims.map((claim) => [claim.id, claim] as const));
		// 批次内统一解析 evidence：一次取全部引用 span，再逐候选判定可解析性。
		const spanIds = [...new Set(hydrated.claims.flatMap((claim) => claim.evidenceSpanIds))];
		const persistedSpanIds = [...new Set(spanIds.map(persistedSpanId))];
		const spanRows = readShardedRows<SourceSpan>(join(snapshotPath, "spans"), persistedSpanIds);
		const resolvedById = new Map<string, SourceSpan>();
		for (const spanId of spanIds) {
			const resolved = resolveSpanById(spanRows.rows, spanId);
			if (resolved) resolvedById.set(spanId, resolved);
		}
		inspectedCandidateCount += batch.length;
		for (const aggregate of batch) {
			const claim = claimById.get(aggregate.claimId);
			// hydrate 缺失仅为同桶防御（可见分类已由 locator 保证），与 evidence
			// 不可解析一样计入 unresolvedEvidenceExcludedCount。
			if (!claim || !claim.evidenceSpanIds.every((spanId) => resolvedById.has(spanId))) {
				unresolvedEvidenceExcludedCount++;
				continue;
			}
			if (remainingSlots > 0) {
				remainingSlots--;
				candidates.push({ claim, traces: aggregate.traces });
				// resolvedEvidenceSpanCount 只统计最终返回候选的可解析证据，
				// 不统计同批次中检查过但未返回（超名额）的候选。
				for (const spanId of claim.evidenceSpanIds) {
					const resolved = resolvedById.get(spanId);
					if (resolved) resolvedSpanIds.add(resolved.id);
				}
			} else {
				// 当前检查批次中可解析但超过剩余名额的候选，计入 truncated。
				truncatedInBatch++;
			}
		}
	}
	// truncatedCount = 未检查的剩余可见候选 + 批次内可解析但超名额的候选；
	// 已计入 unresolved 的候选绝不重复计入 truncated。
	const truncatedCount = visibleAggregates.length - inspectedCandidateCount + truncatedInBatch;
	return {
		candidates,
		diagnostics: {
			indexVersion: meta.indexVersion,
			canonicalStateGeneration: meta.canonicalStateGeneration,
			seedCount: seeds.length,
			candidateCount: candidates.length,
			spanClaimShardsRead: spanClaimShards.size,
			sourceClaimShardsRead: sourceClaimShards.size,
			discoveredCandidateCount: aggregates.length,
			inspectedCandidateCount,
			scopeExcludedCount,
			temporalExcludedCount,
			truncatedCount,
			unresolvedEvidenceExcludedCount,
			resolvedEvidenceSpanCount: resolvedSpanIds.size,
		},
	};
}

/**
 * Goal 3-B2：只读 source-routing 检索（契约 goal3-source-routing-contract-v1.json）。
 *
 * 在现有 v7 持久化词法索引之上：先按现有确定性词法顺序取 routing pool
 * （严格 clamp 到 routingPoolBudget，alias 补充永不超限）；再用持久化 span
 * shards 与 child-span 语义把每个 pool Claim 解析为 evidence Source ID
 * （一个 Claim 可映射到多个 sources）；按最早词法排位（sourceId 字典序
 * tie-break）选至多 sourceBudget 个 sources；先保证每个 selected source 的
 * 最高排位 Claim，再按 pool 原始词法顺序仅用 selected sources 填充到
 * candidateBudget。只读：不写任何文件；保留 stale-index fail-closed、
 * GLOBAL 默认 scope 与显式 temporal 过滤语义；不返回 Relation / Graph /
 * Context Pack 数据，不使用任何 domain 术语或 Gold。
 */
export function retrieveSourceRoutedSeedsFromPersistentIndex(
	indexRoot: string,
	query: string,
	options: PersistentSourceRoutingOptions = {},
): PersistentSourceRoutingResult {
	const { snapshotPath, meta } = openCurrentIndex(indexRoot);
	const budgets = clampSourceRoutingOptions(options);
	const queryFeatures = [...lexicalFeatures(query)];
	const postingShardNames = [...new Set(queryFeatures.map(shardName))];
	const queryFeatureSet = new Set(queryFeatures);
	const postingRows = postingShardNames.flatMap((name) =>
		readJsonl<FeaturePosting>(join(snapshotPath, "postings", `${name}.jsonl`)),
	);
	const matchedPostings = postingRows.filter((posting) => queryFeatureSet.has(posting.feature));
	const allowedScopeKeys = visibleScopeKeys(options.scopeContext);
	const temporalRange = extractExplicitTemporalMonthRange(options.temporalQuery ?? query);
	const isTemporallyVisible = (documentId: number) =>
		isDocumentInTemporalRange(meta, documentId, temporalRange);
	const isVisibleDocument = (documentId: number) =>
		allowedScopeKeys.has(meta.scopeKeysByDocument[documentId] ?? "GLOBAL") &&
		isTemporallyVisible(documentId);
	const candidateIds = new Set(
		matchedPostings.flatMap((posting) => posting.totalDocumentIds).filter(isVisibleDocument),
	);
	const recordShardNames = [...new Set([...candidateIds].map(recordShardName))];
	const recordRows = recordShardNames.flatMap((name) =>
		readJsonl<PersistedSeedDocument>(join(snapshotPath, "records", `${name}.jsonl`)),
	);
	const matchedFeaturesByDocument = buildMatchedFeaturesByDocument(matchedPostings);
	const documents = recordRows
		.filter((document) => candidateIds.has(document.documentId))
		.map((document) =>
			deserializeDocument(document, matchedFeaturesByDocument.get(document.documentId)),
		);
	const baseDocumentFrequency = new Map(
		matchedPostings.map((posting) => [
			posting.feature,
			posting.baseDocumentIds.filter(isVisibleDocument).length,
		]),
	);
	const totalDocumentFrequency = new Map(
		matchedPostings.map((posting) => [
			posting.feature,
			posting.totalDocumentIds.filter(isVisibleDocument).length,
		]),
	);
	const visibleDocumentCount = meta.scopeKeysByDocument.filter(
		(key, documentId) => allowedScopeKeys.has(key) && isTemporallyVisible(documentId),
	).length;
	const corpus: SeedSearchCorpus = {
		documents,
		totalDocumentCount: visibleDocumentCount,
		baseDocumentFrequency,
		totalDocumentFrequency,
		diagnostics: { ...meta.diagnostics, eligibleClaimCount: visibleDocumentCount },
	};
	const retrieved = retrieveClaimSeedsFromCorpus(corpus, query, budgets.routingPoolBudget);
	// routing pool：现有确定性词法顺序（baseline + alias 补充），严格 clamp。
	const pool = retrieved.candidates.slice(0, budgets.routingPoolBudget);
	// 解析 routing-pool Claims 的 evidence → source（span shards + child-span 语义）。
	const poolSpanIds = [...new Set(pool.flatMap((candidate) => candidate.claim.evidenceSpanIds))];
	const spanResult = readShardedRows<SourceSpan>(join(snapshotPath, "spans"), [
		...new Set(poolSpanIds.map(persistedSpanId)),
	]);
	const poolClaims: SourceRoutingPoolClaim[] = [];
	let unresolvedEvidenceCount = 0;
	let unresolvedEvidenceRefCount = 0;
	for (const [index, candidate] of pool.entries()) {
		const sourceIds: string[] = [];
		for (const spanId of candidate.claim.evidenceSpanIds) {
			const span = resolveSpanById(spanResult.rows, spanId);
			if (!span) {
				unresolvedEvidenceRefCount++;
				continue;
			}
			sourceIds.push(span.sourceId);
		}
		const uniqueSourceIds = [...new Set(sourceIds)];
		if (uniqueSourceIds.length === 0) {
			unresolvedEvidenceCount++;
		} else {
			poolClaims.push({
				claimId: candidate.claim.id,
				lexicalRank: index + 1,
				sourceIds: uniqueSourceIds,
			});
		}
	}
	const selection = selectSourceRoutedCandidates(poolClaims, budgets);
	const sourceResult = readShardedRows<PersistedSourceDescriptor>(
		join(snapshotPath, "sources"),
		selection.selectedSourceIds,
	);
	const sourceById = new Map(sourceResult.rows.map((source) => [source.id, source]));
	const sources = selection.selectedSourceIds.flatMap((sourceId) => {
		const source = sourceById.get(sourceId);
		return source ? [source] : [];
	});
	if (sources.length !== selection.selectedSourceIds.length) {
		const resolved = new Set(sources.map((source) => source.id));
		const missing = selection.selectedSourceIds.filter((sourceId) => !resolved.has(sourceId));
		throw new Error(
			`Persistent retrieval index has unresolved routed sources: ${missing.join(", ")}`,
		);
	}
	const claimById = new Map(pool.map((candidate) => [candidate.claim.id, candidate.claim]));
	const candidates = selection.candidates.map((candidate) => ({
		claim: claimById.get(candidate.claimId) as Claim,
		lexicalRank: candidate.lexicalRank,
		routedSourceIds: candidate.sourceIds,
		guaranteed: candidate.guaranteed,
	}));
	const selectedSourceIdSet = new Set(selection.selectedSourceIds);
	const traces = selection.sources.map(
		(source): PersistentSourceRoutingTrace => ({
			sourceId: source.sourceId,
			firstLexicalRank: source.firstLexicalRank,
			claimIds: source.claimIds,
			selected: selectedSourceIdSet.has(source.sourceId),
		}),
	);
	return {
		candidates,
		sources,
		traces,
		diagnostics: {
			indexVersion: meta.indexVersion,
			canonicalStateGeneration: meta.canonicalStateGeneration,
			knowledgeVersion: meta.knowledgeVersion,
			routingPoolClaimCount: pool.length,
			discoveredSourceCount: selection.diagnostics.discoveredSourceCount,
			selectedSourceCount: selection.diagnostics.selectedSourceCount,
			candidateClaimCount: candidates.length,
			candidateSourceCount: new Set(candidates.flatMap((candidate) => candidate.routedSourceIds))
				.size,
			spanShardsReadForRouting: spanResult.shardNames.length,
			unresolvedEvidenceCount,
			unresolvedEvidenceRefCount,
			temporalScope: {
				applied: temporalRange !== null,
				startMonth: temporalRange ? formatMonthNumber(temporalRange.start) : null,
				endMonth: temporalRange ? formatMonthNumber(temporalRange.end) : null,
				excludedClaimIds: temporalRange
					? meta.claimIdsByDocument.filter(
							(_claimId, documentId) =>
								allowedScopeKeys.has(meta.scopeKeysByDocument[documentId] ?? "GLOBAL") &&
								!isTemporallyVisible(documentId),
						)
					: [],
			},
			lexical: {
				queryFeatureCount: queryFeatures.length,
				eligibleClaimCount: visibleDocumentCount,
				matchedClaimCount: retrieved.diagnostics.matchedClaimCount,
				postingShardsRead: postingShardNames.length,
				recordShardsRead: recordShardNames.length,
				postingRowsDecoded: postingRows.length,
				recordRowsDecoded: recordRows.length,
				candidateClaimsLoaded: documents.length,
				resolvedEvidenceRefCount: retrieved.diagnostics.resolvedEvidenceRefCount,
				unresolvedEvidenceRefCount: retrieved.diagnostics.unresolvedEvidenceRefCount,
			},
		},
	};
}

function openCurrentIndex(indexRoot: string): {
	pointer: CurrentIndexPointer;
	snapshotPath: string;
	meta: PersistentIndexMeta;
} {
	const pointer = readJson<CurrentIndexPointer>(join(indexRoot, "current.json"));
	if (pointer.schemaVersion !== INDEX_SCHEMA)
		throw new Error("Unsupported retrieval index pointer");
	const snapshotPath = join(indexRoot, pointer.snapshotRelativePath);
	const meta = readJson<PersistentIndexMeta>(join(snapshotPath, "meta.json"));
	if (meta.schemaVersion !== INDEX_SCHEMA || meta.indexVersion !== pointer.indexVersion) {
		throw new Error("Persistent retrieval index pointer/meta mismatch");
	}
	const currentGeneration = readCanonicalStateGenerationAtPath(pointer.canonicalGenerationPath);
	if (currentGeneration !== meta.canonicalStateGeneration) {
		throw new Error(
			`Persistent retrieval index is stale: indexed=${meta.canonicalStateGeneration}, current=${currentGeneration}`,
		);
	}
	return { pointer, snapshotPath, meta };
}

function hydrateClaimsByIds(
	snapshotPath: string,
	claimIds: string[],
	isVisibleDocument: (documentId: number) => boolean,
): { claims: Claim[]; locatorShards: string[]; recordShards: string[] } {
	if (claimIds.length === 0) return { claims: [], locatorShards: [], recordShards: [] };
	const wanted = new Set(claimIds);
	const locators = readShardedRows<ClaimLocator>(join(snapshotPath, "claim-locators"), claimIds);
	const documentIds = locators.rows
		.filter((item) => wanted.has(item.claimId) && isVisibleDocument(item.documentId))
		.map((item) => item.documentId);
	const recordShardNames = [...new Set(documentIds.map(recordShardName))];
	const wantedDocuments = new Set(documentIds);
	const records = recordShardNames.flatMap((name) =>
		readJsonl<PersistedSeedDocument>(join(snapshotPath, "records", `${name}.jsonl`)),
	);
	return {
		claims: records
			.filter((record) => wantedDocuments.has(record.documentId))
			.sort((left, right) => left.documentId - right.documentId)
			.map((record) => record.claim),
		locatorShards: locators.shardNames,
		recordShards: recordShardNames,
	};
}

function hydrateSpansForClaims(
	snapshotPath: string,
	claims: Claim[],
): { spans: SourceSpan[]; shardNames: string[] } {
	const spanIds = [...new Set(claims.flatMap((claim) => claim.evidenceSpanIds))];
	// Claims may cite deterministic `#chars-start-end` children while the canonical
	// store persists only their parent block Span. Read the parent shard and apply
	// the same resolver used by the legacy storage path, otherwise evidence closure
	// silently drops every Claim that cites a child Span.
	const persistedSpanIds = [...new Set(spanIds.map(persistedSpanId))];
	const result = readShardedRows<SourceSpan>(join(snapshotPath, "spans"), persistedSpanIds);
	return {
		spans: spanIds
			.flatMap((spanId) => {
				const resolved = resolveSpanById(result.rows, spanId);
				return resolved ? [resolved] : [];
			})
			.sort((left, right) => left.id.localeCompare(right.id)),
		shardNames: result.shardNames,
	};
}

function persistedSpanId(spanId: string): string {
	return /^(.*)#chars-\d+-\d+$/.exec(spanId)?.[1] ?? spanId;
}

function buildPostings(documents: SeedSearchDocument[]): FeaturePosting[] {
	const base = new Map<string, number[]>();
	const total = new Map<string, number[]>();
	const alias = new Map<string, number[]>();
	const source = new Map<string, number[]>();
	for (const [documentId, document] of documents.entries()) {
		for (const feature of document.baseFeatures) appendPosting(base, feature, documentId);
		for (const feature of document.totalFeatures) appendPosting(total, feature, documentId);
		for (const feature of document.aliasFeatures) appendPosting(alias, feature, documentId);
		for (const feature of document.sourceFeatures) appendPosting(source, feature, documentId);
	}
	return [...new Set([...base.keys(), ...total.keys()])].sort().map((feature) => ({
		feature,
		baseDocumentIds: base.get(feature) ?? [],
		totalDocumentIds: total.get(feature) ?? [],
		aliasDocumentIds: alias.get(feature) ?? [],
		sourceDocumentIds: source.get(feature) ?? [],
		baseDocumentFrequency: base.get(feature)?.length ?? 0,
		totalDocumentFrequency: total.get(feature)?.length ?? 0,
	}));
}

function toSourceDescriptor(source: Source): PersistedSourceDescriptor {
	return {
		id: source.id,
		hash: source.hash,
		uri: source.uri,
		sourceType: source.sourceType,
		loaderVersion: source.loaderVersion,
		metadata: source.metadata,
		createdAt: source.createdAt,
	};
}

function buildRelationAdjacency(relations: Relation[]): RelationAdjacencyRecord[] {
	const adjacency = new Map<string, Relation[]>();
	for (const relation of relations) {
		for (const nodeId of [relation.from as string, relation.to as string]) {
			const rows = adjacency.get(nodeId) ?? [];
			rows.push(relation);
			adjacency.set(nodeId, rows);
		}
	}
	return [...adjacency.entries()]
		.map(([nodeId, rows]) => ({
			nodeId,
			relations: rows.sort((left, right) => left.id.localeCompare(right.id)),
		}))
		.sort((left, right) => left.nodeId.localeCompare(right.nodeId));
}

function buildSourceClaims(
	documents: PersistedSeedDocument[],
	spans: SourceSpan[],
): SourceClaimsRecord[] {
	const sourceBySpan = new Map(spans.map((span) => [span.id, span.sourceId]));
	const bySource = new Map<string, Set<string>>();
	for (const document of documents) {
		for (const sourceId of new Set(
			document.claim.evidenceSpanIds.flatMap((spanId) => {
				const sourceId = sourceBySpan.get(persistedSpanId(spanId));
				return sourceId ? [sourceId] : [];
			}),
		)) {
			const claimIds = bySource.get(sourceId) ?? new Set<string>();
			claimIds.add(document.claim.id);
			bySource.set(sourceId, claimIds);
		}
	}
	return [...bySource.entries()]
		.map(([sourceId, claimIds]) => ({ sourceId, claimIds: [...claimIds].sort() }))
		.sort((left, right) => left.sourceId.localeCompare(right.sourceId));
}

function buildSpanClaims(
	documents: PersistedSeedDocument[],
	spans: SourceSpan[],
): SpanClaimsRecord[] {
	const blockKeyBySpan = new Map(spans.map((span) => [span.id, evidenceBlockKey(span)]));
	const byBlock = new Map<string, Set<string>>();
	for (const document of documents) {
		for (const blockKey of new Set(
			document.claim.evidenceSpanIds.flatMap((spanId) => {
				const key = blockKeyBySpan.get(persistedSpanId(spanId));
				return key ? [key] : [];
			}),
		)) {
			const claimIds = byBlock.get(blockKey) ?? new Set<string>();
			claimIds.add(document.claim.id);
			byBlock.set(blockKey, claimIds);
		}
	}
	return [...byBlock.entries()]
		.map(([blockKey, claimIds]) => ({ blockKey, claimIds: [...claimIds].sort() }))
		.sort((left, right) => left.blockKey.localeCompare(right.blockKey));
}

function evidenceBlockKey(span: Pick<SourceSpan, "sourceId" | "blockId">): string {
	return `${span.sourceId}\0${span.blockId}`;
}

function appendPosting(target: Map<string, number[]>, feature: string, documentId: number): void {
	const rows = target.get(feature) ?? [];
	rows.push(documentId);
	target.set(feature, rows);
}

function serializeDocument(
	document: SeedSearchDocument,
	documentId: number,
): PersistedSeedDocument {
	return {
		documentId,
		claim: document.claim,
		normalizedBaseText: document.normalizedBaseText,
		normalizedTotalText: document.normalizedTotalText,
		temporalMonths: document.temporalMonths,
	};
}

function deserializeDocument(
	document: PersistedSeedDocument,
	features: MatchedDocumentFeatures | undefined,
): SeedSearchDocument {
	return {
		claim: document.claim,
		baseFeatures: features?.base ?? new Set(),
		totalFeatures: features?.total ?? new Set(),
		aliasFeatures: features?.alias ?? new Set(),
		sourceFeatures: features?.source ?? new Set(),
		normalizedBaseText: document.normalizedBaseText,
		normalizedTotalText: document.normalizedTotalText,
		temporalMonths: document.temporalMonths,
	};
}

interface MatchedDocumentFeatures {
	base: Set<string>;
	total: Set<string>;
	alias: Set<string>;
	source: Set<string>;
}

function buildMatchedFeaturesByDocument(
	postings: FeaturePosting[],
): Map<number, MatchedDocumentFeatures> {
	const result = new Map<number, MatchedDocumentFeatures>();
	for (const posting of postings) {
		appendMatchedFeatures(result, posting.baseDocumentIds, "base", posting.feature);
		appendMatchedFeatures(result, posting.totalDocumentIds, "total", posting.feature);
		appendMatchedFeatures(result, posting.aliasDocumentIds, "alias", posting.feature);
		appendMatchedFeatures(result, posting.sourceDocumentIds, "source", posting.feature);
	}
	return result;
}

function appendMatchedFeatures(
	target: Map<number, MatchedDocumentFeatures>,
	documentIds: number[],
	channel: keyof MatchedDocumentFeatures,
	feature: string,
): void {
	for (const documentId of documentIds) {
		const features = target.get(documentId) ?? {
			base: new Set(),
			total: new Set(),
			alias: new Set(),
			source: new Set(),
		};
		features[channel].add(feature);
		target.set(documentId, features);
	}
}

function writeShards<T>(directory: string, items: T[], key: (item: T) => string | number): void {
	const shards = new Map<string, T[]>();
	for (const item of items) {
		const value = key(item);
		const name = typeof value === "number" ? recordShardName(value) : shardName(value);
		const rows = shards.get(name) ?? [];
		rows.push(item);
		shards.set(name, rows);
	}
	for (const [name, rows] of shards) {
		writeFileSync(
			join(directory, `${name}.jsonl`),
			`${rows.map((row) => JSON.stringify(row)).join("\n")}\n`,
			"utf8",
		);
	}
}

function shardName(value: string): string {
	return hash(value).slice(0, 2);
}

function recordShardName(documentId: number): string {
	return (documentId % 256).toString(16).padStart(2, "0");
}

function scopeKey(scope: Scope): string {
	if (scope.type === "GLOBAL") return "GLOBAL";
	return `${scope.type}:${scope.id ?? "<missing>"}`;
}

function visibleScopeKeys(scopeContext: ScopeContext | undefined): Set<string> {
	const keys = new Set(["GLOBAL"]);
	if (!scopeContext) return keys;
	keys.add(`PERSONAL:${scopeContext.principalId}`);
	if (scopeContext.projectId) keys.add(`PROJECT:${scopeContext.projectId}`);
	return keys;
}

function formatMonthNumber(value: number): string {
	const year = Math.floor(value / 12);
	const month = (value % 12) + 1;
	return `${year}-${String(month).padStart(2, "0")}`;
}

function isDocumentInTemporalRange(
	meta: PersistentIndexMeta,
	documentId: number,
	range: { start: number; end: number } | null,
): boolean {
	if (!range) return true;
	const months = meta.temporalMonthsByDocument[documentId] ?? [];
	return months.length === 0 || months.some((month) => month >= range.start && month <= range.end);
}

function readJson<T>(path: string): T {
	if (!existsSync(path)) throw new Error(`Missing persistent retrieval index file: ${path}`);
	return JSON.parse(readFileSync(path, "utf8")) as T;
}

function readCanonicalStateGenerationAtPath(path: string): string {
	const record = readJson<{ token?: unknown }>(path);
	if (typeof record.token !== "string" || record.token.length === 0) {
		throw new Error("Invalid canonical state generation marker");
	}
	return record.token;
}

function readJsonl<T>(path: string): T[] {
	if (!existsSync(path)) return [];
	return readFileSync(path, "utf8")
		.split(/\r?\n/u)
		.filter((line) => line.trim().length > 0)
		.map((line) => JSON.parse(line) as T);
}

function readShardedRows<T>(
	directory: string,
	keys: string[],
): { rows: T[]; shardNames: string[] } {
	const shardNames = [...new Set(keys.map(shardName))];
	return {
		rows: shardNames.flatMap((name) => readJsonl<T>(join(directory, `${name}.jsonl`))),
		shardNames,
	};
}

function addAll(target: Set<string>, values: string[]): void {
	for (const value of values) target.add(value);
}

function hash(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}
