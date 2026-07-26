/**
 * Compiler — bounded, observable knowledge compilation.
 *
 * Large Sources are compiled through token-budgeted batches. Claims receive stable IDs first;
 * Concepts are consolidated and Relations are detected only after the complete Claim set exists.
 */

import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import type { ZodType, ZodTypeDef } from "zod";
import type { AppConfig } from "../config/types.js";
import type { LLMProvider } from "../core/llm-provider.js";
import { mapQuoteToSpan } from "../ingestor/index.js";
import { appendJsonl, readJson, writeJsonAtomic } from "../linter/storage.js";
import {
	CLAIM_COMPILE_SYSTEM,
	COMPILE_VERSION,
	CONCEPT_CONSOLIDATE_SYSTEM,
	PROPOSITION_EXTRACT_SYSTEM,
	RELATION_DETECT_SYSTEM,
} from "../prompts/index.js";
import { isSourceMetadataClaim } from "../relations/semantics.js";
import type {
	Claim,
	Concept,
	EdgeSource,
	PropositionDraft,
	Relation,
	Source,
	SourceSpan,
} from "../types/index.js";
import { claimRef } from "../types/index.js";
import {
	ClaimBatchResponseSchema,
	ConceptResponseSchema,
	PropositionResponseSchema,
	RelationResponseSchema,
	parseLLMJson,
} from "../types/schemas.js";
import type {
	ClaimDraft,
	ConceptDraft,
	PropositionResponse,
	RelationOnlyDraft,
} from "../types/schemas.js";
import type { CompileRunHandle, CompileStage } from "./run-state.js";
import { recordCompileStage } from "./run-state.js";
import { estimateTokens, observedChat, recordParseResult } from "./telemetry.js";
import type { LLMCallContext } from "./telemetry.js";

const INPUT_TOKEN_BUDGET = 12_000;
const MAX_PROPOSITION_BLOCKS_PER_BATCH = 24;
const RELATION_GROUP_TOKEN_BUDGET = 5_000;
const PROPOSITION_MAX_OUTPUT_TOKENS = 8_192;
const CLAIM_MAX_OUTPUT_TOKENS = 8_192;
const CONCEPT_MAX_OUTPUT_TOKENS = 4_096;
const RELATION_MAX_OUTPUT_TOKENS = 8_192;
const MAX_SPLIT_DEPTH = 8;

export interface CompileResult {
	claims: Claim[];
	concepts: Concept[];
	relations: Relation[];
	propositions: PropositionDraft[];
	compileStats: CompileStats;
}

export interface CompileStats {
	runId: string;
	sourceId: string;
	totalBlocks: number;
	coveredBlocks: number;
	uncoveredBlockIds: string[];
	eligibleBlocks: number;
	coveredEligibleBlocks: number;
	uncoveredEligibleBlockIds: string[];
	totalPropositions: number;
	mappedPropositions: number;
	skippedPropositions: Array<{ blockId: string; exactQuote: string; reason: string }>;
	totalClaimDrafts: number;
	mappedClaims: number;
	skippedClaims: Array<{ statement: string; reason: string }>;
	totalRelationDrafts: number;
	validRelations: number;
	skippedRelations: Array<{ fromIndex: number; toIndex: number; reason: string }>;
	timestamp: string;
}

export interface CompileOptions {
	run?: CompileRunHandle;
	/** 已发布的全局 Concept，用于跨来源复用身份与同名异义分叉。 */
	existingConcepts?: Concept[];
}

interface IndexedProposition {
	index: number;
	proposition: PropositionDraft;
}

interface IndexedClaim {
	index: number;
	claim: Claim;
}

interface RelationTask {
	left: IndexedClaim[];
	right: IndexedClaim[];
	sameGroup: boolean;
}

export interface CrossMaterialCompileResult {
	relations: Relation[];
	candidateClaimIds: string[];
}

class TruncatedOutputError extends Error {}

export async function compileSource(
	config: AppConfig,
	source: Source,
	spans: SourceSpan[],
	provider: LLMProvider,
	options: CompileOptions = {},
): Promise<CompileResult> {
	const runId = options.run?.runId ?? randomUUID();
	const stats: CompileStats = {
		runId,
		sourceId: source.id,
		totalBlocks: spans.length,
		coveredBlocks: 0,
		uncoveredBlockIds: spans.map((span) => span.blockId),
		eligibleBlocks: spans.filter(isKnowledgeBearingSpan).length,
		coveredEligibleBlocks: 0,
		uncoveredEligibleBlockIds: spans.filter(isKnowledgeBearingSpan).map((span) => span.blockId),
		totalPropositions: 0,
		mappedPropositions: 0,
		skippedPropositions: [],
		totalClaimDrafts: 0,
		mappedClaims: 0,
		skippedClaims: [],
		totalRelationDrafts: 0,
		validRelations: 0,
		skippedRelations: [],
		timestamp: new Date().toISOString(),
	};
	persistStats(config, stats, "PROPOSITION_EXTRACTION");

	setStage(config, options.run, "PROPOSITION_EXTRACTION");
	const spanBatches = partitionByTokenBudget(
		spans,
		(span) => renderBlock(span),
		INPUT_TOKEN_BUDGET - estimateTokens(PROPOSITION_EXTRACT_SYSTEM),
		MAX_PROPOSITION_BLOCKS_PER_BATCH,
	);
	const propositions: PropositionDraft[] = [];
	const propositionKeys = new Set<string>();

	for (let batchIndex = 0; batchIndex < spanBatches.length; batchIndex++) {
		const batch = spanBatches[batchIndex] ?? [];
		const extracted = await extractPropositionBatch(
			config,
			provider,
			runId,
			source.id,
			batch,
			`prop-${batchIndex}`,
			0,
		);
		collectMappedPropositions(source, spans, extracted, propositions, propositionKeys, stats);
		persistStats(config, stats, "PROPOSITION_EXTRACTION");
	}

	const initiallyCoveredBlockIds = new Set(propositions.map((proposition) => proposition.blockId));
	const uncoveredEligibleSpans = spans.filter(
		(span) => isKnowledgeBearingSpan(span) && !initiallyCoveredBlockIds.has(span.blockId),
	);
	const repairBatches = partitionByTokenBudget(
		uncoveredEligibleSpans,
		(span) => renderBlock(span),
		INPUT_TOKEN_BUDGET - estimateTokens(PROPOSITION_EXTRACT_SYSTEM),
		MAX_PROPOSITION_BLOCKS_PER_BATCH,
	);
	for (let batchIndex = 0; batchIndex < repairBatches.length; batchIndex++) {
		const batch = repairBatches[batchIndex] ?? [];
		const extracted = await extractPropositionBatch(
			config,
			provider,
			runId,
			source.id,
			batch,
			`prop-repair-${batchIndex}`,
			0,
			true,
		);
		collectMappedPropositions(source, spans, extracted, propositions, propositionKeys, stats);
		persistStats(config, stats, "PROPOSITION_EXTRACTION");
	}
	const coveredBlockIds = new Set(propositions.map((proposition) => proposition.blockId));
	stats.coveredBlocks = coveredBlockIds.size;
	stats.uncoveredBlockIds = spans
		.map((span) => span.blockId)
		.filter((blockId) => !coveredBlockIds.has(blockId));
	stats.coveredEligibleBlocks = spans.filter(
		(span) => isKnowledgeBearingSpan(span) && coveredBlockIds.has(span.blockId),
	).length;
	stats.uncoveredEligibleBlockIds = spans
		.filter(isKnowledgeBearingSpan)
		.map((span) => span.blockId)
		.filter((blockId) => !coveredBlockIds.has(blockId));
	persistStats(config, stats, "PROPOSITION_EXTRACTION");

	if (propositions.length === 0) {
		return { claims: [], concepts: [], relations: [], propositions, compileStats: stats };
	}

	setStage(config, options.run, "CLAIM_COMPILATION");
	const indexedPropositions = propositions.map((proposition, index) => ({ index, proposition }));
	const propositionBatches = partitionByTokenBudget(
		indexedPropositions,
		renderProposition,
		INPUT_TOKEN_BUDGET - estimateTokens(CLAIM_COMPILE_SYSTEM),
	);
	const claimDrafts: ClaimDraft[] = [];
	for (let batchIndex = 0; batchIndex < propositionBatches.length; batchIndex++) {
		claimDrafts.push(
			...(await compileClaimBatch(
				config,
				provider,
				runId,
				source.id,
				propositionBatches[batchIndex] ?? [],
				`claim-${batchIndex}`,
				0,
			)),
		);
	}

	const claims = buildClaims(source, spans, claimDrafts, stats);
	persistStats(config, stats, "CLAIM_COMPILATION");

	setStage(config, options.run, "CONCEPT_CONSOLIDATION");
	const concepts = await compileConcepts(
		config,
		provider,
		runId,
		source,
		claims,
		options.existingConcepts ?? [],
	);

	setStage(config, options.run, "RELATION_DETECTION");
	const relations = await compileRelations(config, provider, runId, source, claims, stats);
	persistStats(config, stats, "RELATION_DETECTION");

	return { claims, concepts, relations, propositions, compileStats: stats };
}

async function extractPropositionBatch(
	config: AppConfig,
	provider: LLMProvider,
	runId: string,
	sourceId: string,
	spans: SourceSpan[],
	batchId: string,
	depth: number,
	coverageRepair = false,
): Promise<Array<{ text: string; exactQuote: string; blockId: string }>> {
	const context = callContext(runId, sourceId, "PROPOSITION_EXTRACTION", batchId, depth + 1);
	try {
		const data = await callStructured<PropositionResponse>(
			config,
			provider,
			{
				model: config.model,
				temperature: config.temperature,
				systemPrompt: PROPOSITION_EXTRACT_SYSTEM,
				messages: [{ role: "user", content: buildPropositionPrompt(spans, coverageRepair) }],
				responseFormat: "json_object",
				thinkingDisabled: true,
				maxTokens: PROPOSITION_MAX_OUTPUT_TOKENS,
			},
			context,
			PropositionResponseSchema,
		);
		return data.propositions;
	} catch (error) {
		if (error instanceof TruncatedOutputError) {
			return splitAndRetry(spans, depth, batchId, (left, childId, childDepth) =>
				extractPropositionBatch(
					config,
					provider,
					runId,
					sourceId,
					left,
					childId,
					childDepth,
					coverageRepair,
				),
			);
		}
		throw error;
	}
}

function collectMappedPropositions(
	source: Source,
	spans: SourceSpan[],
	extracted: Array<{ text: string; exactQuote: string; blockId: string }>,
	propositions: PropositionDraft[],
	propositionKeys: Set<string>,
	stats: CompileStats,
): void {
	stats.totalPropositions += extracted.length;
	for (const item of extracted) {
		const mappedSpan = mapQuoteToSpan(spans, item.blockId, item.exactQuote);
		if (!mappedSpan) {
			stats.skippedPropositions.push({
				blockId: item.blockId,
				exactQuote: item.exactQuote.slice(0, 200),
				reason: "EXACT_QUOTE_NOT_FOUND_IN_BLOCK",
			});
			continue;
		}
		stats.mappedPropositions++;
		const key = `${item.blockId}\n${item.text}\n${mappedSpan.id}`;
		if (propositionKeys.has(key)) continue;
		propositionKeys.add(key);
		propositions.push({
			sourceId: source.id,
			blockId: item.blockId,
			text: item.text,
			exactQuote: item.exactQuote,
		});
	}
}

async function compileClaimBatch(
	config: AppConfig,
	provider: LLMProvider,
	runId: string,
	sourceId: string,
	propositions: IndexedProposition[],
	batchId: string,
	depth: number,
): Promise<ClaimDraft[]> {
	const context = callContext(runId, sourceId, "CLAIM_COMPILATION", batchId, depth + 1);
	try {
		const data = await callStructured<{ claims: ClaimDraft[] }>(
			config,
			provider,
			{
				model: config.model,
				temperature: config.temperature,
				systemPrompt: CLAIM_COMPILE_SYSTEM,
				messages: [{ role: "user", content: buildClaimPrompt(propositions) }],
				responseFormat: "json_object",
				thinkingDisabled: true,
				maxTokens: CLAIM_MAX_OUTPUT_TOKENS,
			},
			context,
			ClaimBatchResponseSchema,
		);
		return data.claims;
	} catch (error) {
		if (error instanceof TruncatedOutputError) {
			return splitAndRetry(propositions, depth, batchId, (left, childId, childDepth) =>
				compileClaimBatch(config, provider, runId, sourceId, left, childId, childDepth),
			);
		}
		throw error;
	}
}

function buildClaims(
	source: Source,
	spans: SourceSpan[],
	drafts: ClaimDraft[],
	stats: CompileStats,
): Claim[] {
	const byKey = new Map<string, Claim>();
	const now = new Date().toISOString();
	for (const draft of drafts) {
		stats.totalClaimDrafts++;
		if (draft.evidenceQuotes.length !== draft.blockIds.length) {
			stats.skippedClaims.push({
				statement: draft.statement.slice(0, 200),
				reason: "EVIDENCE_BLOCK_COUNT_MISMATCH",
			});
			continue;
		}

		const evidenceSpanIds: string[] = [];
		let evidenceFailure = false;
		for (let index = 0; index < draft.evidenceQuotes.length; index++) {
			const quote = draft.evidenceQuotes[index];
			const blockId = draft.blockIds[index];
			if (!quote || !blockId) {
				evidenceFailure = true;
				break;
			}
			const mapped = mapQuoteToSpan(spans, blockId, quote);
			if (!mapped) {
				evidenceFailure = true;
				break;
			}
			evidenceSpanIds.push(mapped.id);
		}
		if (evidenceFailure || evidenceSpanIds.length === 0) {
			stats.skippedClaims.push({
				statement: draft.statement.slice(0, 200),
				reason: "EVIDENCE_QUOTE_NOT_RESOLVABLE",
			});
			continue;
		}

		stats.mappedClaims++;
		const uniqueEvidenceIds = [...new Set(evidenceSpanIds)].sort();
		const normalizedConditions = [
			...new Set(draft.conditions.map((item) => item.trim()).filter(Boolean)),
		].sort();
		const claimKey = `${normalizeClaimForDedup(draft.statement)}\n${normalizedConditions
			.map(normalizeClaimForDedup)
			.join("\n")}`;
		const existing = byKey.get(claimKey);
		if (existing) {
			stats.skippedClaims.push({
				statement: draft.statement.slice(0, 200),
				reason: "DUPLICATE_CLAIM_MERGED",
			});
			const mergedEvidenceIds = [
				...new Set([...existing.evidenceSpanIds, ...uniqueEvidenceIds]),
			].sort();
			byKey.set(claimKey, {
				...existing,
				evidenceSpanIds: mergedEvidenceIds,
				provenanceRefs: mergedEvidenceIds.map((spanId) => ({ type: "SourceSpan", spanId })),
				supportingEvidenceRefs: mergedEvidenceIds.map((spanId) => ({
					type: "SourceSpan",
					spanId,
				})),
				confidence: Math.min(existing.confidence, draft.confidence),
				derivation:
					existing.derivation === "INFERRED" || draft.derivation === "INFERRED"
						? "INFERRED"
						: "EXTRACTED",
			});
			continue;
		}

		const id = `claim:${source.hash}-${stableHash(claimKey)}`;
		byKey.set(claimKey, {
			id,
			statement: draft.statement,
			evidenceSpanIds: uniqueEvidenceIds,
			conditions: normalizedConditions,
			derivation: draft.derivation,
			validity: "UNRESOLVED",
			lifecycle: "ACTIVE",
			publicationState: "CANDIDATE",
			validFrom: now,
			validTo: null,
			compilerVersion: COMPILE_VERSION,
			confidence: draft.confidence,
			claimKind: "FACT",
			scope: { type: "GLOBAL" },
			provenanceRefs: uniqueEvidenceIds.map((spanId) => ({ type: "SourceSpan", spanId })),
			supportingEvidenceRefs: uniqueEvidenceIds.map((spanId) => ({
				type: "SourceSpan",
				spanId,
			})),
			knowledgeVersion: "v1",
			recordedAt: now,
		});
	}
	return [...byKey.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function normalizeClaimForDedup(value: string): string {
	return value
		.normalize("NFKC")
		.toLowerCase()
		.replace(/\*\*|__|`|\$/g, "")
		.replace(/[，,；;：:。.!！?？“”"'（）()\[\]{}]/g, "")
		.replace(/\s+/g, "")
		.trim();
}

async function compileConcepts(
	config: AppConfig,
	provider: LLMProvider,
	runId: string,
	source: Source,
	claims: Claim[],
	existingConcepts: Concept[],
): Promise<Concept[]> {
	if (claims.length === 0) return [];
	const indexedClaims = claims.map((claim, index) => ({ index, claim }));
	const batches = partitionByTokenBudget(
		indexedClaims,
		renderClaim,
		INPUT_TOKEN_BUDGET - estimateTokens(CONCEPT_CONSOLIDATE_SYSTEM),
	);
	const drafts: ConceptDraft[] = [];
	for (let index = 0; index < batches.length; index++) {
		drafts.push(
			...(await compileConceptBatch(
				config,
				provider,
				runId,
				source.id,
				batches[index] ?? [],
				`concept-${index}`,
				0,
			)),
		);
	}
	return mergeConcepts(drafts, existingConcepts);
}

async function compileConceptBatch(
	config: AppConfig,
	provider: LLMProvider,
	runId: string,
	sourceId: string,
	claims: IndexedClaim[],
	batchId: string,
	depth: number,
): Promise<ConceptDraft[]> {
	const context = callContext(runId, sourceId, "CONCEPT_CONSOLIDATION", batchId, depth + 1);
	try {
		const data = await callStructured<{ concepts: ConceptDraft[] }>(
			config,
			provider,
			{
				model: config.model,
				temperature: config.temperature,
				systemPrompt: CONCEPT_CONSOLIDATE_SYSTEM,
				messages: [{ role: "user", content: buildConceptPrompt(claims) }],
				responseFormat: "json_object",
				thinkingDisabled: true,
				maxTokens: CONCEPT_MAX_OUTPUT_TOKENS,
			},
			context,
			ConceptResponseSchema,
		);
		return data.concepts;
	} catch (error) {
		if (error instanceof TruncatedOutputError) {
			return splitAndRetry(claims, depth, batchId, (left, childId, childDepth) =>
				compileConceptBatch(config, provider, runId, sourceId, left, childId, childDepth),
			);
		}
		throw error;
	}
}

function mergeConcepts(drafts: ConceptDraft[], existingConcepts: Concept[]): Concept[] {
	const merged = new Map<string, Concept>();
	for (const draft of drafts) {
		const name = draft.name.trim();
		if (!name) continue;
		const aliases = [...new Set(draft.aliases.map((alias) => alias.trim()).filter(Boolean))].sort();
		const candidates = [...existingConcepts, ...merged.values()].filter(
			(concept) =>
				conceptNamesOverlap(concept, name, aliases) &&
				sameConceptDomain(concept.domain, draft.domain),
		);
		const compatible = candidates.filter((concept) =>
			boundariesCompatible(concept.boundary, draft.boundary),
		);
		const matched = compatible.length === 1 ? compatible[0] : undefined;
		const identitySeed = matched
			? matched.id
			: candidates.length > 0
				? `${normalizeConceptName(draft.domain)}\n${normalizeConceptName(name)}\n${normalizeConceptName(draft.boundary)}`
				: `${normalizeConceptName(draft.domain)}\n${normalizeConceptName(name)}`;
		const id = matched?.id ?? `concept:${stableHash(identitySeed)}`;
		const previous = merged.get(id) ?? matched;
		merged.set(id, {
			id,
			name: previous && previous.name.length <= name.length ? previous.name : name,
			aliases: [...new Set([...(previous?.aliases ?? []), ...aliases])].sort(),
			boundary:
				(previous?.boundary.length ?? 0) >= draft.boundary.length
					? (previous?.boundary ?? "")
					: draft.boundary,
			domain: previous?.domain || draft.domain || "未分类",
		});
	}
	return [...merged.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function conceptNamesOverlap(concept: Concept, name: string, aliases: string[]): boolean {
	const existingNames = [concept.name, ...concept.aliases].map(normalizeConceptName);
	const incomingNames = [name, ...aliases].map(normalizeConceptName);
	return incomingNames.some((incoming) => incoming && existingNames.includes(incoming));
}

function sameConceptDomain(left: string, right: string): boolean {
	const normalizedLeft = normalizeConceptName(left || "未分类");
	const normalizedRight = normalizeConceptName(right || "未分类");
	return normalizedLeft === normalizedRight || !normalizedLeft || !normalizedRight;
}

function boundariesCompatible(left: string, right: string): boolean {
	const normalizedLeft = normalizeConceptName(left);
	const normalizedRight = normalizeConceptName(right);
	if (!normalizedLeft || !normalizedRight) return true;
	if (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft))
		return true;
	const leftBigrams = new Set(textBigrams(normalizedLeft));
	const rightBigrams = new Set(textBigrams(normalizedRight));
	if (leftBigrams.size === 0 || rightBigrams.size === 0) return false;
	let overlap = 0;
	for (const gram of leftBigrams) if (rightBigrams.has(gram)) overlap++;
	return overlap / Math.min(leftBigrams.size, rightBigrams.size) >= 0.35;
}

function textBigrams(value: string): string[] {
	const characters = [...value];
	return characters.slice(0, -1).map((character, index) => character + characters[index + 1]);
}

async function compileRelations(
	config: AppConfig,
	provider: LLMProvider,
	runId: string,
	source: Source,
	claims: Claim[],
	stats: CompileStats,
): Promise<Relation[]> {
	if (claims.length < 2) return [];
	const indexedClaims = claims.map((claim, index) => ({ index, claim }));
	const groups = partitionByTokenBudget(indexedClaims, renderClaim, RELATION_GROUP_TOKEN_BUDGET);
	const drafts: RelationOnlyDraft[] = [];
	for (let leftIndex = 0; leftIndex < groups.length; leftIndex++) {
		for (let rightIndex = leftIndex; rightIndex < groups.length; rightIndex++) {
			const left = groups[leftIndex] ?? [];
			const right = groups[rightIndex] ?? [];
			drafts.push(
				...(await detectRelationTask(
					config,
					provider,
					runId,
					source.id,
					stats,
					{ left, right, sameGroup: leftIndex === rightIndex },
					`relation-${leftIndex}-${rightIndex}`,
					0,
				)),
			);
		}
	}
	return buildRelations(source, claims, drafts, stats);
}

/**
 * 阶段 2：只在新 Source 与召回的旧 Claim 之间检测关系，禁止退化成全库两两比较。
 * 召回只使用 Concept/关键词，MVP 不依赖 embedding。
 */
export async function compileCrossMaterialRelations(
	config: AppConfig,
	provider: LLMProvider,
	runId: string,
	source: Source,
	newClaims: Claim[],
	newConcepts: Concept[],
	existingClaims: Claim[],
	existingSources: Source[] = [],
): Promise<CrossMaterialCompileResult> {
	const relationEligibleNewClaims = newClaims.filter(
		(claim) => !isSourceMetadataClaim(claim.statement),
	);
	const explicitlyReferencedSourceIds = findExplicitlyReferencedSourceIds(source, existingSources);
	const candidates = selectCrossMaterialCandidates(
		relationEligibleNewClaims,
		newConcepts,
		existingClaims,
		40,
		explicitlyReferencedSourceIds,
	);
	if (relationEligibleNewClaims.length === 0 || candidates.length === 0) {
		return { relations: [], candidateClaimIds: candidates.map((claim) => claim.id) };
	}
	const combined = [...relationEligibleNewClaims, ...candidates];
	const indexedNew = relationEligibleNewClaims.map((claim, index) => ({ index, claim }));
	const indexedOld = candidates.map((claim, index) => ({
		index: relationEligibleNewClaims.length + index,
		claim,
	}));
	const newGroups = partitionByTokenBudget(indexedNew, renderClaim, RELATION_GROUP_TOKEN_BUDGET);
	const oldGroups = partitionByTokenBudget(indexedOld, renderClaim, RELATION_GROUP_TOKEN_BUDGET);
	const stats = emptyCompileStats(runId, source.id);
	const drafts: RelationOnlyDraft[] = [];
	for (let leftIndex = 0; leftIndex < newGroups.length; leftIndex++) {
		for (let rightIndex = 0; rightIndex < oldGroups.length; rightIndex++) {
			drafts.push(
				...(await detectRelationTask(
					config,
					provider,
					runId,
					source.id,
					stats,
					{
						left: newGroups[leftIndex] ?? [],
						right: oldGroups[rightIndex] ?? [],
						sameGroup: false,
					},
					`cross-relation-${leftIndex}-${rightIndex}`,
					0,
					"CROSS_MATERIAL_RELATION_DETECTION",
				)),
			);
		}
	}
	const explicitDeclarations = indexedNew.filter((item) =>
		isExplicitReplacementDeclaration(item.claim.statement),
	);
	if (explicitDeclarations.length > 0 && explicitlyReferencedSourceIds.size > 0) {
		const explicitlyReferencedOldClaims = indexedOld.filter((item) =>
			[...explicitlyReferencedSourceIds].some((sourceId) =>
				claimBelongsToSource(item.claim, sourceId),
			),
		);
		for (const oldItem of explicitlyReferencedOldClaims) {
			const concreteReplacements = indexedNew
				.filter(
					(item) =>
						!isExplicitReplacementDeclaration(item.claim.statement) &&
						!isRetainedRuleDeclaration(item.claim.statement),
				)
				.map((item) => ({
					item,
					score: bigramOverlap(
						normalizeClaimForDedup(item.claim.statement),
						normalizeClaimForDedup(oldItem.claim.statement),
					),
				}))
				.sort(
					(left, right) =>
						right.score - left.score || left.item.claim.id.localeCompare(right.item.claim.id),
				);
			const concreteReplacement = concreteReplacements[0];
			const proposedByConcreteRule = drafts.some((draft) => {
				if (draft.type !== "SUPERSEDES" || draft.toClaimIndex !== oldItem.index) return false;
				const proposedFrom = concreteReplacements.find(
					(candidate) => candidate.item.index === draft.fromClaimIndex,
				);
				return (proposedFrom?.score ?? 0) >= 0.12;
			});
			if (proposedByConcreteRule) continue;
			const declaration = explicitDeclarations[0] as IndexedClaim;
			const fromItem =
				concreteReplacement && concreteReplacement.score >= 0.12
					? concreteReplacement.item
					: declaration;
			drafts.push({
				fromClaimIndex: fromItem.index,
				toClaimIndex: oldItem.index,
				type: "SUPERSEDES",
				conditions: [...declaration.claim.conditions],
				confidence: 0.95,
			});
			stats.totalRelationDrafts++;
		}
	}
	const supersessionContextClaims = newClaims.filter((claim) =>
		isSupersessionContext(claim.statement),
	);
	const supersessionEvidenceSpanIds = supersessionContextClaims.flatMap(
		(claim) => claim.evidenceSpanIds,
	);
	const supersessionConditions = supersessionContextClaims.flatMap((claim) => [
		claim.statement,
		...claim.conditions,
	]);
	const relations = buildRelations(source, combined, drafts, stats, "cross-material-detect").map(
		(relation) =>
			relation.type === "SUPERSEDES"
				? {
						...relation,
						conditions: [...new Set([...relation.conditions, ...supersessionConditions])],
						evidenceSpanIds: [
							...new Set([...relation.evidenceSpanIds, ...supersessionEvidenceSpanIds]),
						],
					}
				: relation,
	);
	return {
		relations,
		candidateClaimIds: candidates.map((claim) => claim.id),
	};
}

export function selectCrossMaterialCandidates(
	newClaims: Claim[],
	newConcepts: Concept[],
	existingClaims: Claim[],
	limit = 40,
	explicitlyReferencedSourceIds: ReadonlySet<string> = new Set(),
): Claim[] {
	const conceptTerms = new Set(
		newConcepts
			.flatMap((concept) => [concept.name, ...concept.aliases])
			.map(normalizeClaimForDedup)
			.filter((term) => term.length >= 2),
	);
	const newTexts = newClaims.map((claim) => normalizeClaimForDedup(claim.statement));
	return existingClaims
		.filter(
			(claim) =>
				claim.publicationState === "CANONICAL" &&
				claim.lifecycle === "ACTIVE" &&
				!isSourceMetadataClaim(claim.statement) &&
				!newClaims.some((newClaim) => newClaim.id === claim.id),
		)
		.map((claim) => {
			const text = normalizeClaimForDedup(claim.statement);
			const explicitlyReferenced = [...explicitlyReferencedSourceIds].some((sourceId) =>
				claimBelongsToSource(claim, sourceId),
			);
			let conceptScore = 0;
			for (const term of conceptTerms) if (text.includes(term)) conceptScore += 4;
			const semanticSimilarity = Math.max(
				0,
				...newTexts.map((newText) => bigramOverlap(text, newText)),
			);
			return {
				claim,
				score: (explicitlyReferenced ? 100 : 0) + conceptScore + semanticSimilarity,
				eligible: explicitlyReferenced || conceptScore > 0 || semanticSimilarity >= 0.18,
			};
		})
		.filter((item) => item.eligible)
		.sort((left, right) => right.score - left.score || left.claim.id.localeCompare(right.claim.id))
		.slice(0, limit)
		.map((item) => item.claim);
}

export function findExplicitlyReferencedSourceIds(
	newSource: Source,
	existingSources: Source[],
): Set<string> {
	const newIdentifiers = documentIdentifiers(newSource.parsedText);
	return new Set(
		existingSources
			.filter((source) =>
				[...documentIdentifiers(source.parsedText)].some((identifier) =>
					newIdentifiers.has(identifier),
				),
			)
			.map((source) => source.id),
	);
}

function documentIdentifiers(text: string): Set<string> {
	return new Set(text.toUpperCase().match(/\b[A-Z]{2,}(?:-[A-Z0-9]+){2,}\b/gu) ?? []);
}

function claimBelongsToSource(claim: Claim, sourceId: string): boolean {
	const sourceKey = sourceId.replace(/^source:/u, "");
	return claim.evidenceSpanIds.some((spanId) => spanId.startsWith(`span:${sourceKey}-`));
}

function isSupersessionContext(statement: string): boolean {
	return /(?:取代|替代|废止|不再适用|继续有效|仍(?:然)?有效|不在本次替代范围|未被.+取消|生效日期|无需回算|\beffective date\b|\bremain(?:s|ed)? in effect\b|\breplac(?:e|es|ed|ing)\b|\bsupersed(?:e|es|ed|ing)\b)/iu.test(
		statement,
	);
}

function isExplicitReplacementDeclaration(statement: string): boolean {
	return /(?:取代|替代|废止|\breplac(?:e|es|ed|ing)\b|\bsupersed(?:e|es|ed|ing)\b)/iu.test(
		statement,
	);
}

function isRetainedRuleDeclaration(statement: string): boolean {
	return /(?:继续有效|仍(?:然)?有效|不在本次替代范围|未被.+取消|\bremain(?:s|ed)? in effect\b)/iu.test(
		statement,
	);
}

function bigramOverlap(left: string, right: string): number {
	const leftSet = new Set(textBigrams(left));
	const rightSet = new Set(textBigrams(right));
	if (leftSet.size === 0 || rightSet.size === 0) return 0;
	let overlap = 0;
	for (const gram of leftSet) if (rightSet.has(gram)) overlap++;
	return overlap / Math.min(leftSet.size, rightSet.size);
}

function emptyCompileStats(runId: string, sourceId: string): CompileStats {
	return {
		runId,
		sourceId,
		totalBlocks: 0,
		coveredBlocks: 0,
		uncoveredBlockIds: [],
		eligibleBlocks: 0,
		coveredEligibleBlocks: 0,
		uncoveredEligibleBlockIds: [],
		totalPropositions: 0,
		mappedPropositions: 0,
		skippedPropositions: [],
		totalClaimDrafts: 0,
		mappedClaims: 0,
		skippedClaims: [],
		totalRelationDrafts: 0,
		validRelations: 0,
		skippedRelations: [],
		timestamp: new Date().toISOString(),
	};
}

async function detectRelationTask(
	config: AppConfig,
	provider: LLMProvider,
	runId: string,
	sourceId: string,
	stats: CompileStats,
	task: RelationTask,
	batchId: string,
	depth: number,
	stage: CompileStage = "RELATION_DETECTION",
): Promise<RelationOnlyDraft[]> {
	const context = callContext(runId, sourceId, stage, batchId, depth + 1);
	try {
		const data = await callStructured<{ relations: RelationOnlyDraft[] }>(
			config,
			provider,
			{
				model: config.model,
				temperature: config.temperature,
				systemPrompt: RELATION_DETECT_SYSTEM,
				messages: [{ role: "user", content: buildRelationPrompt(task) }],
				responseFormat: "json_object",
				thinkingDisabled: true,
				maxTokens: RELATION_MAX_OUTPUT_TOKENS,
			},
			context,
			RelationResponseSchema,
		);
		const leftIndexes = new Set(task.left.map((item) => item.index));
		const rightIndexes = new Set(task.right.map((item) => item.index));
		return data.relations.filter((relation) => {
			stats.totalRelationDrafts++;
			const fromLeft = leftIndexes.has(relation.fromClaimIndex);
			const toLeft = leftIndexes.has(relation.toClaimIndex);
			const fromRight = rightIndexes.has(relation.fromClaimIndex);
			const toRight = rightIndexes.has(relation.toClaimIndex);
			const allowed = task.sameGroup
				? fromLeft && toLeft
				: (fromLeft && toRight) || (fromRight && toLeft);
			if (!allowed) {
				stats.skippedRelations.push({
					fromIndex: relation.fromClaimIndex,
					toIndex: relation.toClaimIndex,
					reason: "RELATION_ENDPOINT_OUTSIDE_ASSIGNED_BATCH",
				});
			}
			return allowed;
		});
	} catch (error) {
		if (!(error instanceof TruncatedOutputError)) throw error;
		if (depth >= MAX_SPLIT_DEPTH) {
			throw new Error(`Relation batch ${batchId} 缩批超过 ${MAX_SPLIT_DEPTH} 次`);
		}
		const childTasks = splitRelationTask(task);
		if (childTasks.length === 0) {
			throw new Error(`Relation batch ${batchId} 只剩最小 Claim 对仍被截断`);
		}
		const results: RelationOnlyDraft[] = [];
		for (let index = 0; index < childTasks.length; index++) {
			results.push(
				...(await detectRelationTask(
					config,
					provider,
					runId,
					sourceId,
					stats,
					childTasks[index] as RelationTask,
					`${batchId}.${index}`,
					depth + 1,
					stage,
				)),
			);
		}
		return results;
	}
}

function buildRelations(
	source: Source,
	claims: Claim[],
	drafts: RelationOnlyDraft[],
	stats: CompileStats,
	edgeSource: EdgeSource = "intra-material-compile",
): Relation[] {
	const byId = new Map<string, Relation>();
	const now = new Date().toISOString();
	for (const draft of drafts) {
		const fromClaim = claims[draft.fromClaimIndex];
		const toClaim = claims[draft.toClaimIndex];
		if (!fromClaim || !toClaim || fromClaim.id === toClaim.id) {
			stats.skippedRelations.push({
				fromIndex: draft.fromClaimIndex,
				toIndex: draft.toClaimIndex,
				reason: !fromClaim || !toClaim ? "RELATION_ENDPOINT_NOT_FOUND" : "RELATION_SELF_LOOP",
			});
			continue;
		}
		const conditions = [
			...new Set(
				[...fromClaim.conditions, ...toClaim.conditions, ...draft.conditions]
					.map((condition) => condition.trim())
					.filter(Boolean),
			),
		].sort();
		stats.validRelations++;
		const relationKey = `${fromClaim.id}\n${draft.type}\n${toClaim.id}\n${conditions.join("\n")}`;
		const id = `rel:${edgeSource === "cross-material-detect" ? "cross" : source.hash}-${stableHash(relationKey)}`;
		byId.set(id, {
			id,
			from: claimRef(fromClaim.id),
			to: claimRef(toClaim.id),
			type: draft.type,
			conditions,
			conditionStatus: "UNVERIFIED",
			supersessionEffect: null,
			relationAuditVersion: null,
			evidenceSpanIds: [
				...new Set([...fromClaim.evidenceSpanIds, ...toClaim.evidenceSpanIds]),
			].sort(),
			derivation: "INFERRED",
			validity: "UNRESOLVED",
			lifecycle: "ACTIVE",
			publicationState: "CANDIDATE",
			validFrom: now,
			validTo: null,
			compilerVersion: COMPILE_VERSION,
			source: edgeSource,
			confidence: draft.confidence,
			consumedBy: [],
		});
	}
	return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

async function callStructured<T>(
	config: AppConfig,
	provider: LLMProvider,
	options: Parameters<LLMProvider["chat"]>[0],
	context: LLMCallContext,
	schema: ZodType<T, ZodTypeDef, unknown>,
): Promise<T> {
	const prompt = [options.systemPrompt, ...options.messages.map((message) => message.content)].join(
		"\n",
	);
	const cacheKey = stableHash(
		JSON.stringify({
			model: options.model,
			thinkingMode: options.thinkingDisabled ? "disabled" : "default",
			responseFormat: options.responseFormat,
			maxTokens: options.maxTokens,
			prompt,
		}),
	);
	const cachePath = join(
		config.runsDir,
		"compile-cache",
		context.sourceId.replace(/^source:/, "").replace(/[^a-zA-Z0-9._-]/g, "_"),
		`${context.stage}-${cacheKey}.json`,
	);
	type CachedBatch =
		| { kind: "VALID"; content: string; model: string; outputHash: string }
		| { kind: "TRUNCATED"; reason: string };
	const cached = readJson<CachedBatch>(cachePath);
	if (cached) {
		if (cached.kind === "TRUNCATED") {
			appendJsonl(join(config.runsDir, "llm-calls.jsonl"), [
				{
					eventType: "LLM_CACHE_SPLIT_HINT",
					...context,
					reason: cached.reason,
					cacheRef: cachePath.slice(config.projectRoot.length + 1),
					timestamp: new Date().toISOString(),
				},
			]);
			throw new TruncatedOutputError(cached.reason);
		}
		try {
			const parsed = parseLLMJson(cached.content, schema);
			appendJsonl(join(config.runsDir, "llm-calls.jsonl"), [
				{
					eventType: "LLM_CACHE_HIT",
					...context,
					modelReturned: cached.model,
					outputHash: cached.outputHash,
					cacheRef: cachePath.slice(config.projectRoot.length + 1),
					timestamp: new Date().toISOString(),
				},
			]);
			return parsed;
		} catch (error) {
			throw new Error(`编译批次缓存损坏 ${cachePath}: ${errorMessage(error)}`);
		}
	}

	let lastError: unknown = null;
	for (let formatAttempt = 0; formatAttempt < 2; formatAttempt++) {
		const attemptContext = { ...context, attempt: context.attempt + formatAttempt };
		const attemptOptions =
			formatAttempt === 0
				? options
				: {
						...options,
						messages: [
							...options.messages,
							{
								role: "user" as const,
								content:
									"机器格式重试：保持任务结果不变，只返回严格合法 JSON。字符串内部的双引号和反斜杠必须按 JSON 规范转义，不要输出 Markdown 围栏。",
							},
						],
					};
		const observed = await observedChat(config, provider, attemptOptions, attemptContext);
		if (observed.result.finishReason === "length") {
			const error = new TruncatedOutputError("LLM finishReason=length");
			recordParseResult(config, attemptContext, observed.callId, "INVALID", error);
			writeJsonAtomic(cachePath, { kind: "TRUNCATED", reason: error.message });
			throw error;
		}
		try {
			const parsed = parseLLMJson(observed.result.content, schema);
			recordParseResult(config, attemptContext, observed.callId, "VALID");
			writeJsonAtomic(cachePath, {
				kind: "VALID",
				content: observed.result.content,
				model: observed.result.model,
				outputHash: stableHash(observed.result.content),
			});
			return parsed;
		} catch (error) {
			lastError = error;
			recordParseResult(config, attemptContext, observed.callId, "INVALID", error);
			const maxTokens = options.maxTokens ?? 0;
			const usedTokens = observed.result.usage?.completionTokens ?? 0;
			if (maxTokens > 0 && usedTokens >= maxTokens * 0.95) {
				const truncated = new TruncatedOutputError(
					`JSON 解析失败且 completionTokens=${usedTokens} 接近 maxTokens=${maxTokens}`,
				);
				writeJsonAtomic(cachePath, { kind: "TRUNCATED", reason: truncated.message });
				throw truncated;
			}
		}
	}
	throw lastError;
}

async function splitAndRetry<T, R>(
	items: T[],
	depth: number,
	batchId: string,
	worker: (items: T[], batchId: string, depth: number) => Promise<R[]>,
): Promise<R[]> {
	if (items.length <= 1) throw new Error(`Batch ${batchId} 只剩一个项目仍被截断`);
	if (depth >= MAX_SPLIT_DEPTH) {
		throw new Error(`Batch ${batchId} 缩批超过 ${MAX_SPLIT_DEPTH} 次`);
	}
	const middle = Math.ceil(items.length / 2);
	const left = await worker(items.slice(0, middle), `${batchId}.0`, depth + 1);
	const right = await worker(items.slice(middle), `${batchId}.1`, depth + 1);
	return [...left, ...right];
}

function splitRelationTask(task: RelationTask): RelationTask[] {
	if (task.sameGroup) {
		if (task.left.length <= 1) return [];
		const middle = Math.ceil(task.left.length / 2);
		const left = task.left.slice(0, middle);
		const right = task.left.slice(middle);
		return [
			{ left, right: left, sameGroup: true },
			{ left: right, right, sameGroup: true },
			{ left, right, sameGroup: false },
		];
	}
	if (task.left.length >= task.right.length && task.left.length > 1) {
		const middle = Math.ceil(task.left.length / 2);
		return [
			{ left: task.left.slice(0, middle), right: task.right, sameGroup: false },
			{ left: task.left.slice(middle), right: task.right, sameGroup: false },
		];
	}
	if (task.right.length > 1) {
		const middle = Math.ceil(task.right.length / 2);
		return [
			{ left: task.left, right: task.right.slice(0, middle), sameGroup: false },
			{ left: task.left, right: task.right.slice(middle), sameGroup: false },
		];
	}
	return [];
}

function partitionByTokenBudget<T>(
	items: T[],
	render: (item: T) => string,
	tokenBudget: number,
	maxItems = Number.POSITIVE_INFINITY,
): T[][] {
	const batches: T[][] = [];
	let current: T[] = [];
	let currentTokens = 0;
	for (const item of items) {
		const itemTokens = estimateTokens(render(item));
		if (
			current.length > 0 &&
			(currentTokens + itemTokens > tokenBudget || current.length >= maxItems)
		) {
			batches.push(current);
			current = [];
			currentTokens = 0;
		}
		current.push(item);
		currentTokens += itemTokens;
	}
	if (current.length > 0) batches.push(current);
	return batches;
}

function buildPropositionPrompt(spans: SourceSpan[], coverageRepair = false): string {
	const repairInstruction = coverageRepair
		? "\n\n# 覆盖修复\n这些块在上一轮没有得到可验证命题。请逐块处理，每个 blockId 至少输出一条忠实命题；不得跨块拼接 exactQuote。"
		: "";
	return `请将以下章节块拆分为原子命题。${repairInstruction}\n\n# 可用块列表\n${spans
		.map(renderBlock)
		.join("\n\n")}\n\n请返回严格 JSON。`;
}

function buildClaimPrompt(propositions: IndexedProposition[]): string {
	return `请编译以下原子命题。\n\n${propositions
		.map(renderProposition)
		.join("\n\n")}\n\n请返回严格 JSON。`;
}

function buildConceptPrompt(claims: IndexedClaim[]): string {
	return `请从以下已稳定 Claim 中提取并整理概念。\n\n${claims
		.map(renderClaim)
		.join("\n\n")}\n\n请返回严格 JSON。`;
}

function buildRelationPrompt(task: RelationTask): string {
	if (task.sameGroup) {
		return `检测以下 Claim 集合内部的明确关系。\n\n${task.left
			.map(renderClaim)
			.join("\n\n")}\n\n请返回严格 JSON。`;
	}
	return `检测集合 A 与集合 B 之间的明确关系；不要输出集合内部关系。\n\n# 集合 A\n${task.left
		.map(renderClaim)
		.join("\n\n")}\n\n# 集合 B\n${task.right.map(renderClaim).join("\n\n")}\n\n请返回严格 JSON。`;
}

function renderBlock(span: SourceSpan): string {
	return `[${span.blockId}] ${span.text}`;
}

function isKnowledgeBearingSpan(span: SourceSpan): boolean {
	const text = span.text.trim();
	if (text.length < 2) return false;
	if (/^#{1,6}\s/u.test(text)) return false;
	if (/^-{3,}$/u.test(text)) return false;
	if (/^```/u.test(text)) return false;
	if (/^!\[[^\]]*\]\([^)]*\)$/su.test(text)) return false;
	if (/^<\/?[a-z][^>]*>$/iu.test(text)) return false;
	return true;
}

function renderProposition(item: IndexedProposition): string {
	return `[prop ${item.index}] blockId=${item.proposition.blockId}\ntext: ${
		item.proposition.text
	}\nexactQuote: ${item.proposition.exactQuote}`;
}

function renderClaim(item: IndexedClaim): string {
	const sourceIds = [
		...new Set(item.claim.evidenceSpanIds.map((spanId) => spanId.split("#chars-")[0] ?? spanId)),
	];
	return `[claim ${item.index}] ${item.claim.statement}\nsource evidence: ${sourceIds.join(", ") || "无"}\nconditions: ${
		item.claim.conditions.join("; ") || "无"
	}`;
}

function callContext(
	runId: string,
	sourceId: string,
	stage: CompileStage,
	batchId: string,
	attempt: number,
): LLMCallContext {
	return { runId, sourceId, stage, batchId, attempt };
}

function setStage(config: AppConfig, run: CompileRunHandle | undefined, stage: CompileStage): void {
	if (run) recordCompileStage(config, run, stage);
}

function persistStats(config: AppConfig, stats: CompileStats, stage: CompileStage): void {
	stats.timestamp = new Date().toISOString();
	appendJsonl(join(config.runsDir, "compile-stats.jsonl"), [
		{ eventType: "COMPILE_STATS_SNAPSHOT", stage, ...stats },
	]);
}

function stableHash(value: string): string {
	return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function normalizeConceptName(name: string): string {
	return name.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}
