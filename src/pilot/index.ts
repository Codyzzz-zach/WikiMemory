import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { estimateTokens } from "../compiler/telemetry.js";
import type { AppConfig } from "../config/types.js";
import { buildManagedContextPackWithDiagnostics } from "../context-pack/index.js";
import type { ContextPack } from "../types/index.js";

export type PilotGroup = "B" | "P" | "E-min";

export interface PilotConfig {
	schemaVersion: "wge-pilot-config/v1";
	status: "LOCKED";
	corpus: string[];
	compiler: { model: string; temperature: number; thinkingDisabled: boolean };
	answer: {
		model: string;
		temperature: number;
		thinkingDisabled: boolean;
		maxOutputTokens: number;
	};
	judge: {
		model: string;
		temperature: number;
		thinkingDisabled: boolean;
		maxOutputTokens: number;
	};
	retrieval: {
		contextBudgetTokens: number;
		maxGraphDepth: number;
		maxFolderChunks: number;
		folderChunkChars: number;
	};
	execution: {
		groups: PilotGroup[];
		externalRetrievalNetwork: false;
		maxToolCalls: number;
		timeoutMs: number;
	};
}

export interface PilotQuestion {
	id: string;
	benchmarkId: string;
	category: string;
	question: string;
	answerability: string;
	requiredSources: string[];
	requiredClaims: string[];
	expectedPath: string[];
	mustMentionConditions: string[];
	forbiddenClaims: string[];
}

export interface PreparedPilotContext {
	group: PilotGroup;
	questionId: string;
	context: string;
	estimatedContextTokens: number;
	retrievedClaims: string[];
	retrievedRelations: string[];
	evidenceSpans: string[];
	retrievedSources: string[];
	droppedContext: Array<{ id: string; reason: string }>;
	knowledgeVersion: string | null;
	questionHash: string;
	configHash: string;
	knowledgeSnapshotHash: string | null;
	/** Hash/version of the actual retrieval input: raw corpus for B, knowledge state for P/E-min. */
	inputSnapshotHash: string;
	contextHash: string;
	traceHash: string;
	toolCalls: number;
	retrievalTrace: Record<string, unknown>;
}

export interface PilotPreparationOptions {
	/** False isolates Seed retrieval while preserving Claim/Evidence serialization and budgets. */
	graphExpansion?: boolean;
	/** Goal 2 paired retrieval arms. Explicit mode takes precedence over graphExpansion. */
	retrievalMode?: "R0" | "R1";
}

interface ContextItem {
	id: string;
	text: string;
}

export type ContextUnitKind =
	| "task-map"
	| "claim"
	| "relation"
	| "wiki"
	| "evidence"
	| "conditions"
	| "known-gaps";

export interface ContextUnitDecision {
	id: string;
	kind: ContextUnitKind;
	selected: boolean;
	reason: string;
	estimatedMarginalTokens: number;
}

export interface KnowledgeSerializationResult {
	text: string;
	estimatedTokens: number;
	selectedClaimIds: string[];
	selectedRelationIds: string[];
	selectedEvidenceSpanIds: string[];
	selectedWikiModuleIds: string[];
	decisions: ContextUnitDecision[];
	closure: {
		complete: boolean;
		missingClaimEvidence: Array<{ claimId: string; spanId: string }>;
		missingRelationEndpoints: Array<{ relationId: string; endpointId: string }>;
	};
}

interface FolderChunk {
	id: string;
	source: string;
	lineStart: number;
	lineEnd: number;
	text: string;
}

/** Build the retrieval context without exposing any Gold field beyond the question text. */
export function preparePilotContext(
	appConfig: AppConfig,
	pilotConfig: PilotConfig,
	question: Pick<PilotQuestion, "id" | "question">,
	group: PilotGroup,
	options: PilotPreparationOptions = {},
): PreparedPilotContext {
	if (group === "B") return prepareFolderContext(appConfig, pilotConfig, question);
	return prepareKnowledgeContext(appConfig, pilotConfig, question, group, options);
}

function prepareFolderContext(
	appConfig: AppConfig,
	pilotConfig: PilotConfig,
	question: Pick<PilotQuestion, "id" | "question">,
): PreparedPilotContext {
	const questionHash = sha256(stableJson(question));
	const configHash = sha256(stableJson(pilotConfig));
	const inputSnapshotHash = hashCorpusSnapshot(appConfig.projectRoot, pilotConfig.corpus);
	const chunks = pilotConfig.corpus.flatMap((relativePath) =>
		chunkMarkdown(
			relativePath,
			readFileSync(join(appConfig.projectRoot, relativePath), "utf-8"),
			pilotConfig.retrieval.folderChunkChars,
		),
	);
	const documentFrequency = featureDocumentFrequency(chunks);
	const ranked = chunks
		.map((chunk) => ({
			chunk,
			score: lexicalScore(question.question, chunk.text, documentFrequency),
		}))
		.filter((entry) => entry.score > 0)
		.sort((left, right) => right.score - left.score || left.chunk.id.localeCompare(right.chunk.id));
	const retrievalLimited = ranked.slice(0, pilotConfig.retrieval.maxFolderChunks);
	const items = retrievalLimited.map(({ chunk, score }) => ({
		id: chunk.id,
		text: `## SOURCE ${chunk.source}:${chunk.lineStart}-${chunk.lineEnd} score=${score.toFixed(3)}\n${chunk.text}`,
	}));
	const selected = selectWithinBudget(items, pilotConfig.retrieval.contextBudgetTokens);
	const retrievalTrace = {
		schemaVersion: "wge-context-trace/v1",
		hashes: {
			questionHash,
			configHash,
			knowledgeSnapshotHash: null,
			inputSnapshotHash,
			contextHash: sha256(selected.text),
		},
		strategy: "folder-lexical",
		queryFeatureCount: new Set(textFeatures(question.question)).size,
		corpusChunkCount: chunks.length,
		matchedChunkCount: ranked.length,
		maxFolderChunks: pilotConfig.retrieval.maxFolderChunks,
		candidates: ranked.map(({ chunk, score }, index) => ({
			id: chunk.id,
			rank: index + 1,
			score,
			selected: selected.selectedIds.includes(chunk.id),
			dropReason:
				index >= pilotConfig.retrieval.maxFolderChunks
					? "max-folder-chunks"
					: selected.droppedIds.includes(chunk.id)
						? "context-token-budget"
						: null,
		})),
		budget: {
			limitTokens: pilotConfig.retrieval.contextBudgetTokens,
			finalEstimatedTokens: estimateTokens(selected.text),
		},
	};
	return {
		group: "B",
		questionId: question.id,
		context: selected.text,
		estimatedContextTokens: estimateTokens(selected.text),
		retrievedClaims: [],
		retrievedRelations: [],
		evidenceSpans: [],
		retrievedSources: [...new Set(selected.selectedIds.map((id) => id.split("#L")[0] ?? id))],
		droppedContext: [
			...ranked
				.slice(pilotConfig.retrieval.maxFolderChunks)
				.map(({ chunk }) => ({ id: chunk.id, reason: "max-folder-chunks" })),
			...selected.droppedIds.map((id) => ({ id, reason: "context-token-budget" })),
		],
		knowledgeVersion: null,
		questionHash,
		configHash,
		knowledgeSnapshotHash: null,
		inputSnapshotHash,
		contextHash: sha256(selected.text),
		traceHash: sha256(stableJson(retrievalTrace)),
		toolCalls: 1,
		retrievalTrace,
	};
}

function prepareKnowledgeContext(
	appConfig: AppConfig,
	pilotConfig: PilotConfig,
	question: Pick<PilotQuestion, "id" | "question">,
	group: "P" | "E-min",
	options: PilotPreparationOptions,
): PreparedPilotContext {
	const graphDepth =
		options.retrievalMode === "R0" || options.graphExpansion === false
			? 0
			: pilotConfig.retrieval.maxGraphDepth;
	const built = buildManagedContextPackWithDiagnostics(
		appConfig,
		question.question,
		pilotConfig.retrieval.contextBudgetTokens,
		graphDepth,
		undefined,
		options.retrievalMode ? { selectionMode: options.retrievalMode } : undefined,
	);
	const { pack } = built;
	const selected = serializeKnowledgeContext(
		pack,
		pilotConfig.retrieval.contextBudgetTokens,
		group === "E-min",
	);
	const questionHash = sha256(stableJson(question));
	const configHash = sha256(stableJson(pilotConfig));
	const contextHash = sha256(selected.text);
	const packDropReasons = new Map(
		built.diagnostics.budget.dropped.map((entry) => [entry.id, entry.reason]),
	);
	const selectedPackClaimIds = new Set(built.diagnostics.budget.selectedClaimIds);
	const selectedPackRelationIds = new Set(built.diagnostics.budget.selectedRelationIds);
	const retrievalTrace = {
		schemaVersion: "wge-context-trace/v1",
		hashes: {
			questionHash,
			configHash,
			knowledgeSnapshotHash: pack.knowledgeVersion,
			inputSnapshotHash: pack.knowledgeVersion,
			contextHash,
		},
		strategy:
			options.retrievalMode === "R1"
				? "claim-r1-graph-replacement"
				: graphDepth === 0
					? "claim-seed-only"
					: "claim-seed-graph-conditional",
		graphDepth,
		candidateFlow: {
			seed: built.diagnostics.retrieval.candidates,
			coEvidenceSeedClaimIds: built.diagnostics.graph.seedClaimIds.filter(
				(id) =>
					!built.diagnostics.retrieval.candidates.some(
						(candidate) => candidate.selected && candidate.claimId === id,
					),
			),
			graphClaims: built.diagnostics.graph.expandedClaimIds.map((id, index) => ({
				id,
				rank: index + 1,
				selectedInPack: selectedPackClaimIds.has(id),
				dropReason: selectedPackClaimIds.has(id)
					? null
					: (packDropReasons.get(id) ?? "not-selected-by-pack"),
			})),
			graphRelations: built.diagnostics.graph.expandedRelationIds.map((id, index) => ({
				id,
				rank: index + 1,
				selectedInPack: selectedPackRelationIds.has(id),
				dropReason: selectedPackRelationIds.has(id)
					? null
					: (packDropReasons.get(id) ?? "not-selected-by-pack"),
			})),
			relationGates: built.diagnostics.graph.relationGates,
			graphActivation: built.diagnostics.graph.activation,
		},
		knowledgeAccess: built.diagnostics.knowledgeAccess,
		packBuild: built.diagnostics,
		serialization: {
			budgetTokens: pilotConfig.retrieval.contextBudgetTokens,
			finalEstimatedTokens: selected.estimatedTokens,
			decisions: selected.decisions,
		},
		closure: selected.closure,
	};
	return {
		group,
		questionId: question.id,
		context: selected.text,
		estimatedContextTokens: selected.estimatedTokens,
		retrievedClaims: selected.selectedClaimIds,
		retrievedRelations: selected.selectedRelationIds,
		evidenceSpans: selected.selectedEvidenceSpanIds,
		retrievedSources: [
			...new Set(
				pack.evidenceSpans
					.filter((span) => selected.selectedEvidenceSpanIds.includes(span.id))
					.map((span) => span.sourceId),
			),
		],
		droppedContext: [
			...built.diagnostics.budget.dropped,
			...selected.decisions
				.filter((decision) => !decision.selected)
				.map((decision) => ({ id: decision.id, reason: decision.reason })),
		],
		knowledgeVersion: pack.knowledgeVersion,
		questionHash,
		configHash,
		knowledgeSnapshotHash: pack.knowledgeVersion,
		inputSnapshotHash: pack.knowledgeVersion,
		contextHash,
		traceHash: sha256(stableJson(retrievalTrace)),
		toolCalls: 1,
		retrievalTrace,
	};
}

/**
 * Serialize final Agent-visible knowledge as atomic Claim→Evidence bundles.
 * A Relation is admitted only after both endpoint Claim bundles are visible.
 */
export function serializeKnowledgeContext(
	pack: ContextPack,
	budget: number,
	includeWiki: boolean,
): KnowledgeSerializationResult {
	if (!Number.isSafeInteger(budget) || budget <= 0) throw new Error(`非法 Pilot budget: ${budget}`);
	const evidenceById = new Map(pack.evidenceSpans.map((span) => [span.id, span]));
	const selectedClaims = [] as ContextPack["subgraph"]["claims"];
	const selectedRelations = [] as ContextPack["subgraph"]["relations"];
	const selectedWiki = [] as ContextPack["wikiModules"];
	const selectedEvidenceIds = new Set<string>();
	const decisions: ContextUnitDecision[] = [];
	let includeTaskMap = true;
	let includeConditions = false;
	let includeKnownGaps = false;

	const render = (): string => {
		const sections: string[] = [];
		if (includeTaskMap) sections.push(`## TASK MAP\n${pack.taskMap}`);
		for (const claim of selectedClaims) {
			sections.push(
				`## CLAIM ${claim.id}\n${claim.statement}\nConditions: ${claim.conditions.join("; ") || "none"}\nValidity: ${claim.validity}\nProvenance: ${stableJson(claim.provenanceRefs)}\nSupporting evidence refs: ${stableJson(claim.supportingEvidenceRefs)}`,
			);
		}
		for (const relation of selectedRelations) {
			sections.push(
				`## RELATION ${relation.id}\n${relation.from} --[${relation.type}]--> ${relation.to}\nConditions: ${relation.conditions.join("; ") || "none"}`,
			);
		}
		for (const module of selectedWiki) {
			sections.push(
				`## WIKI ${module.stableAddress}\nQuestion: ${module.coreQuestion}\n${module.currentUnderstanding}\nDisputes: ${module.disputes.join("; ") || "none"}`,
			);
		}
		for (const span of pack.evidenceSpans) {
			if (selectedEvidenceIds.has(span.id)) sections.push(`## EVIDENCE ${span.id}\n${span.text}`);
		}
		if (includeConditions && pack.conflictsAndConditions.length > 0) {
			sections.push(`## CONFLICTS AND CONDITIONS\n${pack.conflictsAndConditions.join("\n")}`);
		}
		if (includeKnownGaps && pack.knownGaps.length > 0) {
			sections.push(`## KNOWN GAPS\n${pack.knownGaps.join("\n")}`);
		}
		return sections.join("\n\n");
	};
	const attempt = (id: string, kind: ContextUnitKind, apply: () => void, rollback: () => void) => {
		const before = estimateTokens(render());
		apply();
		const after = estimateTokens(render());
		if (after <= budget) {
			decisions.push({
				id,
				kind,
				selected: true,
				reason: "selected-within-budget",
				estimatedMarginalTokens: Math.max(0, after - before),
			});
			return true;
		}
		rollback();
		decisions.push({
			id,
			kind,
			selected: false,
			reason: "final-context-token-budget",
			estimatedMarginalTokens: Math.max(0, after - before),
		});
		return false;
	};

	if (estimateTokens(render()) > budget) {
		includeTaskMap = false;
		decisions.push({
			id: "task-map",
			kind: "task-map",
			selected: false,
			reason: "final-context-token-budget",
			estimatedMarginalTokens: estimateTokens(`## TASK MAP\n${pack.taskMap}`),
		});
	} else {
		decisions.push({
			id: "task-map",
			kind: "task-map",
			selected: true,
			reason: "selected-within-budget",
			estimatedMarginalTokens: estimateTokens(render()),
		});
	}

	for (const claim of pack.subgraph.claims) {
		const missing = claim.evidenceSpanIds.filter((spanId) => !evidenceById.has(spanId));
		if (missing.length > 0) {
			decisions.push({
				id: claim.id,
				kind: "claim",
				selected: false,
				reason: `missing-evidence:${missing.join(",")}`,
				estimatedMarginalTokens: 0,
			});
			continue;
		}
		const addedEvidence = claim.evidenceSpanIds.filter(
			(spanId) => !selectedEvidenceIds.has(spanId),
		);
		attempt(
			claim.id,
			"claim",
			() => {
				selectedClaims.push(claim);
				for (const spanId of addedEvidence) selectedEvidenceIds.add(spanId);
			},
			() => {
				selectedClaims.pop();
				for (const spanId of addedEvidence) selectedEvidenceIds.delete(spanId);
			},
		);
	}

	const selectedClaimIds = new Set(selectedClaims.map((claim) => claim.id));
	for (const relation of pack.subgraph.relations) {
		const missingEndpoints = [relation.from as string, relation.to as string].filter(
			(id) => !selectedClaimIds.has(id),
		);
		if (missingEndpoints.length > 0) {
			decisions.push({
				id: relation.id,
				kind: "relation",
				selected: false,
				reason: `endpoint-not-visible:${missingEndpoints.join(",")}`,
				estimatedMarginalTokens: 0,
			});
			continue;
		}
		attempt(
			relation.id,
			"relation",
			() => selectedRelations.push(relation),
			() => {
				selectedRelations.pop();
			},
		);
	}

	if (includeWiki) {
		for (const module of pack.wikiModules) {
			if (!module.claimRefs.some((claimId) => selectedClaimIds.has(claimId as string))) {
				decisions.push({
					id: module.id,
					kind: "wiki",
					selected: false,
					reason: "no-visible-claim-ref",
					estimatedMarginalTokens: 0,
				});
				continue;
			}
			attempt(
				module.id,
				"wiki",
				() => selectedWiki.push(module),
				() => {
					selectedWiki.pop();
				},
			);
		}
	}
	if (pack.conflictsAndConditions.length > 0) {
		attempt(
			"conflicts-and-conditions",
			"conditions",
			() => {
				includeConditions = true;
			},
			() => {
				includeConditions = false;
			},
		);
	}
	if (pack.knownGaps.length > 0) {
		attempt(
			"known-gaps",
			"known-gaps",
			() => {
				includeKnownGaps = true;
			},
			() => {
				includeKnownGaps = false;
			},
		);
	}

	const text = render();
	const finalClaimIds = new Set(selectedClaims.map((claim) => claim.id));
	const missingClaimEvidence = selectedClaims.flatMap((claim) =>
		claim.evidenceSpanIds
			.filter((spanId) => !selectedEvidenceIds.has(spanId))
			.map((spanId) => ({ claimId: claim.id, spanId })),
	);
	const missingRelationEndpoints = selectedRelations.flatMap((relation) =>
		[relation.from as string, relation.to as string]
			.filter((endpointId) => !finalClaimIds.has(endpointId))
			.map((endpointId) => ({ relationId: relation.id, endpointId })),
	);
	for (const span of pack.evidenceSpans) {
		decisions.push({
			id: span.id,
			kind: "evidence",
			selected: selectedEvidenceIds.has(span.id),
			reason: selectedEvidenceIds.has(span.id)
				? "required-by-selected-claim"
				: "no-selected-claim-requires-evidence",
			estimatedMarginalTokens: estimateTokens(`## EVIDENCE ${span.id}\n${span.text}`),
		});
	}
	return {
		text,
		estimatedTokens: estimateTokens(text),
		selectedClaimIds: selectedClaims.map((claim) => claim.id),
		selectedRelationIds: selectedRelations.map((relation) => relation.id),
		selectedEvidenceSpanIds: [...selectedEvidenceIds],
		selectedWikiModuleIds: selectedWiki.map((module) => module.id),
		decisions,
		closure: {
			complete: missingClaimEvidence.length === 0 && missingRelationEndpoints.length === 0,
			missingClaimEvidence,
			missingRelationEndpoints,
		},
	};
}

function chunkMarkdown(path: string, markdown: string, maxChars: number): FolderChunk[] {
	const lines = markdown.split("\n");
	const chunks: FolderChunk[] = [];
	let start = 0;
	let buffer: string[] = [];
	const flush = (endExclusive: number) => {
		const text = buffer.join("\n").trim();
		if (text) {
			chunks.push({
				id: `${path}#L${start + 1}-L${endExclusive}`,
				source: path,
				lineStart: start + 1,
				lineEnd: endExclusive,
				text,
			});
		}
		buffer = [];
		start = endExclusive;
	};
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index] ?? "";
		const nextLength = buffer.join("\n").length + line.length + 1;
		const semanticBoundary = /^#{1,4}\s/.test(line) && buffer.length > 0;
		if (semanticBoundary || nextLength > maxChars) flush(index);
		if (buffer.length === 0) start = index;
		buffer.push(line);
	}
	flush(lines.length);
	return chunks;
}

function featureDocumentFrequency(chunks: FolderChunk[]): Map<string, number> {
	const frequency = new Map<string, number>();
	for (const chunk of chunks) {
		for (const feature of new Set(textFeatures(chunk.text))) {
			frequency.set(feature, (frequency.get(feature) ?? 0) + 1);
		}
	}
	frequency.set("__documents__", chunks.length);
	return frequency;
}

function lexicalScore(query: string, text: string, documentFrequency: Map<string, number>): number {
	const queryFeatures = new Set(textFeatures(query));
	const textFeatureSet = new Set(textFeatures(text));
	const documents = documentFrequency.get("__documents__") ?? 1;
	let score = 0;
	for (const feature of queryFeatures) {
		if (!textFeatureSet.has(feature)) continue;
		const frequency = documentFrequency.get(feature) ?? 0;
		score += Math.log((documents + 1) / (frequency + 1)) + 1;
	}
	return score;
}

function textFeatures(value: string): string[] {
	const normalized = value.normalize("NFKC").toLowerCase();
	const identifiers = normalized.match(/\b\d+(?:\.\d+){1,}\b/g) ?? [];
	const words = normalized.match(/[a-z0-9²ᵖπ]+/g) ?? [];
	const chinese = [...normalized.replaceAll(/[^㐀-鿿]/g, "")];
	const bigrams = chinese.slice(0, -1).map((character, index) => character + chinese[index + 1]);
	return [
		...identifiers.map((identifier) => `id:${identifier}`),
		...words.filter((word) => word.length > 1),
		...bigrams,
	];
}

function selectWithinBudget(
	items: ContextItem[],
	budget: number,
): { text: string; selectedIds: string[]; droppedIds: string[] } {
	const selected: ContextItem[] = [];
	const droppedIds: string[] = [];
	let used = 0;
	for (const item of items) {
		const tokens = estimateTokens(item.text);
		if (used + tokens > budget) {
			droppedIds.push(item.id);
			continue;
		}
		selected.push(item);
		used += tokens;
	}
	return {
		text: selected.map((item) => item.text).join("\n\n"),
		selectedIds: selected.map((item) => item.id),
		droppedIds,
	};
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function hashCorpusSnapshot(root: string, paths: string[]): string {
	const hash = createHash("sha256");
	for (const path of [...paths].sort()) {
		hash.update(path);
		hash.update("\0");
		hash.update(readFileSync(join(root, path)));
		hash.update("\0");
	}
	return `corpus:${hash.digest("hex")}`;
}

function stableJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
	if (value && typeof value === "object") {
		return `{${Object.entries(value as Record<string, unknown>)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}
