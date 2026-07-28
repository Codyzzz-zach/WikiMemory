import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { estimateTokens } from "../compiler/telemetry.js";
import type { AppConfig } from "../config/types.js";
import { buildContextPackWithDiagnostics } from "../context-pack/index.js";

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
	contextHash: string;
	toolCalls: number;
	retrievalTrace: Record<string, unknown>;
}

export interface PilotPreparationOptions {
	/** False isolates Seed retrieval while preserving Claim/Evidence serialization and budgets. */
	graphExpansion?: boolean;
}

interface ContextItem {
	id: string;
	text: string;
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
	return {
		group: "B",
		questionId: question.id,
		context: selected.text,
		estimatedContextTokens: estimateTokens(selected.text),
		retrievedClaims: [],
		retrievedRelations: [],
		evidenceSpans: [],
		retrievedSources: selected.selectedIds.map((id) => id.split("#L")[0] ?? id),
		droppedContext: [
			...ranked
				.slice(pilotConfig.retrieval.maxFolderChunks)
				.map(({ chunk }) => ({ id: chunk.id, reason: "max-folder-chunks" })),
			...selected.droppedIds.map((id) => ({ id, reason: "context-token-budget" })),
		],
		knowledgeVersion: null,
		contextHash: sha256(selected.text),
		toolCalls: 1,
		retrievalTrace: {
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
		},
	};
}

function prepareKnowledgeContext(
	appConfig: AppConfig,
	pilotConfig: PilotConfig,
	question: Pick<PilotQuestion, "id" | "question">,
	group: "P" | "E-min",
	options: PilotPreparationOptions,
): PreparedPilotContext {
	const graphDepth = options.graphExpansion === false ? 0 : pilotConfig.retrieval.maxGraphDepth;
	const built = buildContextPackWithDiagnostics(
		appConfig,
		question.question,
		pilotConfig.retrieval.contextBudgetTokens,
		graphDepth,
	);
	const { pack } = built;
	const items: ContextItem[] = [
		{ id: "task-map", text: `## TASK MAP\n${pack.taskMap}` },
		...pack.subgraph.claims.map((claim) => ({
			id: claim.id,
			text: `## CLAIM ${claim.id}\n${claim.statement}\nConditions: ${claim.conditions.join("; ") || "none"}\nValidity: ${claim.validity}`,
		})),
		...pack.subgraph.relations.map((relation) => ({
			id: relation.id,
			text: `## RELATION ${relation.id}\n${relation.from} --[${relation.type}]--> ${relation.to}\nConditions: ${relation.conditions.join("; ") || "none"}`,
		})),
		...(group === "E-min"
			? pack.wikiModules.map((module) => ({
					id: module.id,
					text: `## WIKI ${module.stableAddress}\nQuestion: ${module.coreQuestion}\n${module.currentUnderstanding}\nDisputes: ${module.disputes.join("; ") || "none"}`,
				}))
			: []),
		...pack.evidenceSpans.map((span) => ({
			id: span.id,
			text: `## EVIDENCE ${span.id}\n${span.text}`,
		})),
		...(pack.conflictsAndConditions.length > 0
			? [
					{
						id: "conflicts-and-conditions",
						text: `## CONFLICTS AND CONDITIONS\n${pack.conflictsAndConditions.join("\n")}`,
					},
				]
			: []),
		...(pack.knownGaps.length > 0
			? [{ id: "known-gaps", text: `## KNOWN GAPS\n${pack.knownGaps.join("\n")}` }]
			: []),
	];
	const selected = selectWithinBudget(items, pilotConfig.retrieval.contextBudgetTokens);
	const selectedIds = new Set(selected.selectedIds);
	return {
		group,
		questionId: question.id,
		context: selected.text,
		estimatedContextTokens: estimateTokens(selected.text),
		retrievedClaims: pack.subgraph.claims
			.filter((claim) => selectedIds.has(claim.id))
			.map((claim) => claim.id),
		retrievedRelations: pack.subgraph.relations
			.filter((relation) => selectedIds.has(relation.id))
			.map((relation) => relation.id),
		evidenceSpans: pack.evidenceSpans
			.filter((span) => selectedIds.has(span.id))
			.map((span) => span.id),
		retrievedSources: [
			...new Set(
				pack.evidenceSpans.filter((span) => selectedIds.has(span.id)).map((span) => span.sourceId),
			),
		],
		droppedContext: [
			...pack.selectionLog
				.filter((entry) => entry.dropped)
				.map((entry) => ({ id: entry.dropped ?? "unknown", reason: entry.dropReason ?? "pack" })),
			...selected.droppedIds.map((id) => ({ id, reason: "context-token-budget" })),
		],
		knowledgeVersion: pack.knowledgeVersion,
		contextHash: sha256(selected.text),
		toolCalls: 1,
		retrievalTrace: {
			strategy: graphDepth === 0 ? "claim-seed-only" : "claim-seed-graph",
			graphDepth,
			...built.diagnostics,
			serializationBudget: {
				selectedIds: selected.selectedIds,
				droppedIds: selected.droppedIds,
			},
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
