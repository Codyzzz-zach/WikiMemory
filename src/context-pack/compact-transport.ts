import { hashStableValue } from "../retrieval/pack-cost-ledger.js";
import {
	type LegacyClaimSections,
	type StructuredClaimTable,
	buildLegacyClaimSections,
	buildStructuredClaimTable,
	decodeStructuredClaimTable,
} from "../retrieval/structured-pack-renderer.js";
import type { ContextPack } from "../types/index.js";

export const COMPACT_CONTEXT_PACK_SCHEMA = "wge-context-pack-compact/v1" as const;

/**
 * Agent-visible transport DTO. It deliberately excludes Canonical-only Claim
 * runtime fields (for example compilerVersion and confidence) and therefore
 * must never be persisted as the Canonical knowledge store.
 */
export interface AgentContextPackProjection extends LegacyClaimSections {
	knowledgeVersion: string;
	taskMap: string;
	relations: ContextPack["subgraph"]["relations"];
	wikiModules: ContextPack["wikiModules"];
	evidenceSpans: ContextPack["evidenceSpans"];
	conflictsAndConditions: string[];
	selectionLog: ContextPack["selectionLog"];
	knownGaps: string[];
}

export interface CompactContextPackTransport {
	schemaVersion: typeof COMPACT_CONTEXT_PACK_SCHEMA;
	claimTable: StructuredClaimTable;
	payload: Omit<AgentContextPackProjection, "claims" | "semantics">;
}

export function buildAgentContextPackProjection(pack: ContextPack): AgentContextPackProjection {
	const claimSections = buildLegacyClaimSections(pack.subgraph.claims);
	return {
		knowledgeVersion: pack.knowledgeVersion,
		taskMap: pack.taskMap,
		...claimSections,
		relations: pack.subgraph.relations,
		wikiModules: pack.wikiModules,
		evidenceSpans: pack.evidenceSpans,
		conflictsAndConditions: pack.conflictsAndConditions,
		selectionLog: pack.selectionLog,
		knownGaps: pack.knownGaps,
	};
}

export function encodeCompactContextPack(pack: ContextPack): CompactContextPackTransport {
	const projection = buildAgentContextPackProjection(pack);
	const { claims: _claims, semantics: _semantics, ...payload } = projection;
	return {
		schemaVersion: COMPACT_CONTEXT_PACK_SCHEMA,
		claimTable: buildStructuredClaimTable(pack.subgraph.claims),
		payload,
	};
}

/** Decode positional rows before any consumer sees them. */
export function decodeCompactContextPack(value: unknown): AgentContextPackProjection {
	if (!isRecord(value)) throw new Error("Compact Context Pack must be an object");
	const expectedTopLevelKeys = ["claimTable", "payload", "schemaVersion"];
	const actualTopLevelKeys = Object.keys(value).sort();
	if (
		actualTopLevelKeys.length !== expectedTopLevelKeys.length ||
		actualTopLevelKeys.some((key, index) => key !== expectedTopLevelKeys[index])
	) {
		throw new Error("Compact Context Pack top-level fields drifted");
	}
	if (value.schemaVersion !== COMPACT_CONTEXT_PACK_SCHEMA) {
		throw new Error(`Unsupported compact Context Pack: ${String(value.schemaVersion)}`);
	}
	if (!isRecord(value.payload)) throw new Error("Compact Context Pack payload must be an object");
	const expectedPayloadKeys = [
		"conflictsAndConditions",
		"evidenceSpans",
		"knowledgeVersion",
		"knownGaps",
		"relations",
		"selectionLog",
		"taskMap",
		"wikiModules",
	].sort();
	const actualPayloadKeys = Object.keys(value.payload).sort();
	if (
		actualPayloadKeys.length !== expectedPayloadKeys.length ||
		actualPayloadKeys.some((key, index) => key !== expectedPayloadKeys[index])
	) {
		throw new Error("Compact Context Pack payload fields drifted");
	}
	if (
		typeof value.payload.knowledgeVersion !== "string" ||
		typeof value.payload.taskMap !== "string"
	) {
		throw new Error("Compact Context Pack payload identity is invalid");
	}
	for (const key of [
		"relations",
		"wikiModules",
		"evidenceSpans",
		"conflictsAndConditions",
		"selectionLog",
		"knownGaps",
	] as const) {
		if (!Array.isArray(value.payload[key]))
			throw new Error(`Compact Context Pack ${key} must be an array`);
	}
	const claimSections = decodeStructuredClaimTable(value.claimTable);
	return {
		knowledgeVersion: value.payload.knowledgeVersion,
		taskMap: value.payload.taskMap,
		...claimSections,
		relations: value.payload.relations as AgentContextPackProjection["relations"],
		wikiModules: value.payload.wikiModules as AgentContextPackProjection["wikiModules"],
		evidenceSpans: value.payload.evidenceSpans as AgentContextPackProjection["evidenceSpans"],
		conflictsAndConditions: value.payload.conflictsAndConditions as string[],
		selectionLog: value.payload.selectionLog as AgentContextPackProjection["selectionLog"],
		knownGaps: value.payload.knownGaps as string[],
	};
}

export function agentContextPackProjectionHash(value: AgentContextPackProjection): string {
	return hashStableValue(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
