import type { Claim } from "../types/index.js";
import {
	claimCommunicationProjection,
	claimSemanticProjection,
	hashStableValue,
} from "./pack-cost-ledger.js";

export const STRUCTURED_CLAIM_COLUMNS = [
	"rank",
	"claimId",
	"statement",
	"retrievalAliases",
	"conditions",
	"claimKind",
	"scope",
	"derivation",
	"validity",
	"lifecycle",
	"publicationState",
	"validFrom",
	"validTo",
	"provenanceRefs",
	"supportingEvidenceRefs",
	"knowledgeVersion",
	"recordedAt",
] as const;

export interface StructuredClaimTable {
	schemaVersion: "wge-structured-claim-table/v1";
	columns: typeof STRUCTURED_CLAIM_COLUMNS;
	rows: unknown[][];
}

export interface LegacyClaimSections {
	claims: Array<Record<string, unknown>>;
	semantics: Array<Record<string, unknown>>;
}

export function buildLegacyClaimSections(claims: Claim[]): LegacyClaimSections {
	return {
		claims: claims.map((claim, index) => claimCommunicationProjection(claim, index + 1)),
		semantics: claims.map(claimSemanticProjection),
	};
}

export function buildStructuredClaimTable(claims: Claim[]): StructuredClaimTable {
	const legacy = buildLegacyClaimSections(claims);
	return {
		schemaVersion: "wge-structured-claim-table/v1",
		columns: STRUCTURED_CLAIM_COLUMNS,
		rows: legacy.claims.map((communication, index) => {
			const semantics = legacy.semantics[index];
			if (!semantics) throw new Error(`Missing semantic projection at Claim rank ${index + 1}`);
			return [
				communication.rank,
				communication.claimId,
				communication.statement,
				communication.retrievalAliases,
				semantics.conditions,
				semantics.claimKind,
				semantics.scope,
				semantics.derivation,
				semantics.validity,
				semantics.lifecycle,
				semantics.publicationState,
				semantics.validFrom,
				semantics.validTo,
				semantics.provenanceRefs,
				semantics.supportingEvidenceRefs,
				semantics.knowledgeVersion,
				semantics.recordedAt,
			];
		}),
	};
}

export function decodeStructuredClaimTable(value: unknown): LegacyClaimSections {
	const table = requireStructuredClaimTable(value);
	if (
		table.columns.length !== STRUCTURED_CLAIM_COLUMNS.length ||
		table.columns.some((column, index) => column !== STRUCTURED_CLAIM_COLUMNS[index])
	) {
		throw new Error("Structured Claim columns drifted");
	}
	const claims: Array<Record<string, unknown>> = [];
	const semantics: Array<Record<string, unknown>> = [];
	for (const [index, row] of table.rows.entries()) {
		if (row.length !== STRUCTURED_CLAIM_COLUMNS.length) {
			throw new Error(`Structured Claim row ${index + 1} has ${row.length} columns`);
		}
		const [
			rank,
			claimId,
			statement,
			retrievalAliases,
			conditions,
			claimKind,
			scope,
			derivation,
			validity,
			lifecycle,
			publicationState,
			validFrom,
			validTo,
			provenanceRefs,
			supportingEvidenceRefs,
			knowledgeVersion,
			recordedAt,
		] = row;
		assertStructuredClaimRow(row, index);
		claims.push({ rank, claimId, statement, retrievalAliases });
		semantics.push({
			claimId,
			conditions,
			claimKind,
			scope,
			derivation,
			validity,
			lifecycle,
			publicationState,
			validFrom,
			validTo,
			provenanceRefs,
			supportingEvidenceRefs,
			knowledgeVersion,
			recordedAt,
		});
	}
	return { claims, semantics };
}

function requireStructuredClaimTable(value: unknown): StructuredClaimTable {
	if (!isRecord(value)) throw new Error("Structured Claim table must be an object");
	if (value.schemaVersion !== "wge-structured-claim-table/v1") {
		throw new Error(`Unsupported structured Claim table: ${String(value.schemaVersion)}`);
	}
	if (!Array.isArray(value.columns)) throw new Error("Structured Claim columns must be an array");
	if (
		value.columns.length !== STRUCTURED_CLAIM_COLUMNS.length ||
		value.columns.some((column, index) => column !== STRUCTURED_CLAIM_COLUMNS[index])
	) {
		throw new Error("Structured Claim columns drifted");
	}
	if (!Array.isArray(value.rows) || value.rows.some((row) => !Array.isArray(row))) {
		throw new Error("Structured Claim rows must be arrays");
	}
	return value as unknown as StructuredClaimTable;
}

function assertStructuredClaimRow(row: unknown[], index: number): void {
	const label = `Structured Claim row ${index + 1}`;
	const [
		rank,
		claimId,
		statement,
		retrievalAliases,
		conditions,
		claimKind,
		scope,
		derivation,
		validity,
		lifecycle,
		publicationState,
		validFrom,
		validTo,
		provenanceRefs,
		supportingEvidenceRefs,
		knowledgeVersion,
		recordedAt,
	] = row;
	if (!Number.isSafeInteger(rank) || Number(rank) <= 0)
		throw new Error(`${label} has invalid rank`);
	for (const [name, field] of [
		["claimId", claimId],
		["statement", statement],
		["knowledgeVersion", knowledgeVersion],
		["recordedAt", recordedAt],
	] as const) {
		if (typeof field !== "string" || field.length === 0)
			throw new Error(`${label} has invalid ${name}`);
	}
	assertStringArray(retrievalAliases, `${label} retrievalAliases`);
	assertStringArray(conditions, `${label} conditions`);
	assertEnum(claimKind, ["FACT", "DECISION", "PREFERENCE"], `${label} claimKind`);
	if (!isRecord(scope)) throw new Error(`${label} has invalid scope`);
	assertEnum(scope.type, ["GLOBAL", "PERSONAL", "PROJECT"], `${label} scope.type`);
	if (scope.id !== undefined && typeof scope.id !== "string") {
		throw new Error(`${label} has invalid scope.id`);
	}
	assertEnum(derivation, ["EXTRACTED", "INFERRED", "HUMAN_ASSERTED"], `${label} derivation`);
	assertEnum(validity, ["SUPPORTED", "DISPUTED", "UNRESOLVED"], `${label} validity`);
	assertEnum(lifecycle, ["ACTIVE", "SUPERSEDED"], `${label} lifecycle`);
	assertEnum(
		publicationState,
		["CANDIDATE", "CANONICAL", "QUARANTINED"],
		`${label} publicationState`,
	);
	for (const [name, field] of [
		["validFrom", validFrom],
		["validTo", validTo],
	] as const) {
		if (field !== null && typeof field !== "string")
			throw new Error(`${label} has invalid ${name}`);
	}
	assertKnowledgeRefs(provenanceRefs, `${label} provenanceRefs`);
	assertKnowledgeRefs(supportingEvidenceRefs, `${label} supportingEvidenceRefs`);
}

function assertStringArray(value: unknown, label: string): asserts value is string[] {
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
		throw new Error(`${label} must be a string array`);
	}
}

function assertKnowledgeRefs(value: unknown, label: string): void {
	if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
	for (const ref of value) {
		if (!isRecord(ref)) throw new Error(`${label} contains an invalid reference`);
		if (ref.type === "SourceSpan" && typeof ref.spanId === "string") continue;
		if (ref.type === "AssertedRecord" && typeof ref.assertionId === "string") continue;
		if (ref.type === "ExperimentRecord" && typeof ref.experimentId === "string") continue;
		throw new Error(`${label} contains an invalid reference`);
	}
}

function assertEnum(value: unknown, allowed: readonly string[], label: string): void {
	if (typeof value !== "string" || !allowed.includes(value)) throw new Error(`${label} is invalid`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function claimSectionsHash(sections: LegacyClaimSections): string {
	return hashStableValue(sections);
}
