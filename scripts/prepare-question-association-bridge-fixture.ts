#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import {
	type AssociationClaim,
	type AssociationEvidenceRef,
	type AssociationEvolutionEvent,
	type AssociationQuestionSnapshot,
	QUESTION_ASSOCIATION_SHADOW_SYSTEM,
	type QuestionAssociationFixtureCase,
	type QuestionAssociationOracleCase,
	buildQuestionAssociationPayload,
	serializeQuestionAssociationPayload,
} from "../src/wiki/question-association-shadow.js";

type JsonRecord = Record<string, unknown>;

interface OracleFile {
	schemaVersion: string;
	status: string;
	cases: QuestionAssociationOracleCase[];
}

interface SnapshotFile {
	path: string;
	sha256: string;
	content: string;
}

interface SnapshotArchive {
	id: string;
	files: SnapshotFile[];
}

interface TransactionReceipt {
	sourceId: string;
	canonicalEvidenceVersion: string;
	beforeQuestionStateHash: string;
	snapshotId: string;
	state: string;
}

interface PublicationClaim extends JsonRecord {
	id: string;
	statement: string;
	conditions: string[];
	validity: string;
	claimKind: string;
	scope: unknown;
	evidenceSpanIds: string[];
}

interface Publication extends JsonRecord {
	sourceId: string;
	claims: PublicationClaim[];
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const benchmarkRoot = join(projectRoot, "benchmarks", "question-association-bridge-v1");

export function prepareQuestionAssociationBridgeFixture(runtimeRoot: string): void {
	const resolvedRuntime = resolve(runtimeRoot);
	assert(existsSync(resolvedRuntime), `Runtime root not found: ${resolvedRuntime}`);
	const oraclePath = join(benchmarkRoot, "oracle.json");
	const oracle = parseOracle(readJson(oraclePath));
	const currentPublications = readPublications(join(resolvedRuntime, "publications"));
	const currentClaimSource = indexClaimSources(currentPublications);
	const receipts = readTransactionReceipts(join(resolvedRuntime, "runs", "question-transactions"));
	const receiptBySource = uniqueIndex(receipts, (item) => item.sourceId, "transaction Source");
	const evidenceByBaseRef = readEvidenceRefs(join(resolvedRuntime, "sources"));
	const fixtureCases = oracle.cases.map((oracleCase) => {
		const sourceId = currentClaimSource.get(oracleCase.claimRef);
		assert(sourceId, `Oracle Claim not found in runtime publications: ${oracleCase.claimRef}`);
		const receipt = receiptBySource.get(sourceId);
		assert(receipt, `Question transaction not found for ${sourceId}`);
		assert(receipt.state === "COMPLETED", `Question transaction is not complete for ${sourceId}`);
		const snapshot = readSnapshot(resolvedRuntime, receipt.snapshotId);
		const questionState = readSnapshotJson(snapshot, "questions/state.json");
		assert(
			requireString(questionState, "stateHash") === receipt.beforeQuestionStateHash,
			`Before Question state hash mismatch for ${oracleCase.caseId}`,
		);
		const snapshotPublications = readSnapshotPublications(snapshot);
		const snapshotClaims = indexClaims(snapshotPublications);
		const frame = requireQuestionFrame(questionState, oracleCase.questionRef);
		const inputClaim = snapshotClaims.get(oracleCase.claimRef);
		assert(inputClaim, `Input Claim missing from transaction snapshot: ${oracleCase.claimRef}`);
		const priorClaimRefs = uniqueSorted(
			requireArray(frame, "formationSignals").flatMap((signal) =>
				requireStringArray(asRecord(signal, "formation signal"), "claimRefs"),
			),
		);
		const priorClaims = priorClaimRefs.map((claimRef) => {
			const claim = snapshotClaims.get(claimRef);
			assert(claim, `Prior Question Claim missing from snapshot: ${claimRef}`);
			return toAssociationClaim(claim, snapshotPublications, receiptBySource, evidenceByBaseRef);
		});
		const priorEvolution = requireArray(questionState, "decisions")
			.map((value) => asRecord(value, "question evolution decision"))
			.filter((decision) =>
				requireStringArray(decision, "questionRefs").includes(oracleCase.questionRef),
			)
			.map(toEvolutionEvent)
			.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
		return {
			caseId: oracleCase.caseId,
			domain: oracleCase.domain,
			sourceId,
			snapshotId: receipt.snapshotId,
			beforeQuestionStateHash: receipt.beforeQuestionStateHash,
			claim: toAssociationClaim(
				inputClaim,
				snapshotPublications,
				receiptBySource,
				evidenceByBaseRef,
			),
			question: toQuestionSnapshot(frame, receipt.beforeQuestionStateHash),
			priorClaims,
			priorEvolution,
		} satisfies QuestionAssociationFixtureCase;
	});

	const inputPath = join(benchmarkRoot, "input.json");
	writeJson(inputPath, {
		schemaVersion: "wge-question-association-fixture/v1",
		status: "FROZEN_ZERO_CALL_INPUT",
		knowledgeBoundary: "HUMAN_SELECTED_CANONICAL_KNOWLEDGE_ONLY",
		cases: fixtureCases.sort((left, right) => left.caseId.localeCompare(right.caseId)),
	});

	const payloadDirectory = join(benchmarkRoot, "provider-payloads");
	mkdirSync(payloadDirectory, { recursive: true });
	const payloadFiles: Array<{
		path: string;
		sha256: string;
		bytes: number;
		estimatedTokens: number;
	}> = [];
	for (const domain of uniqueSorted(fixtureCases.map((item) => item.domain))) {
		const domainCases = fixtureCases.filter((item) => item.domain === domain);
		for (const variant of ["A0_NAME_CARD", "A1_EVIDENCE_IDENTITY_CARD"] as const) {
			const payload = buildQuestionAssociationPayload(domainCases, variant);
			const fileName = `${domain.replaceAll(/[^a-z0-9]+/gi, "-").toLowerCase()}--${variant.toLowerCase()}.json`;
			const payloadPath = join(payloadDirectory, fileName);
			writeFileSync(payloadPath, serializeQuestionAssociationPayload(payload));
			const bytes = readFileSync(payloadPath).byteLength;
			payloadFiles.push({
				path: relativeProjectPath(payloadPath),
				sha256: sha256File(payloadPath),
				bytes,
				estimatedTokens: Math.ceil(bytes / 4),
			});
		}
	}

	const statePath = join(resolvedRuntime, "questions", "state.json");
	const inputBytes = readFileSync(inputPath).byteLength;
	const promptBytes = Buffer.byteLength(QUESTION_ASSOCIATION_SHADOW_SYSTEM, "utf8");
	const estimatedProviderTokens = payloadFiles.reduce(
		(total, file) => total + file.estimatedTokens + Math.ceil(promptBytes / 4),
		0,
	);
	writeJson(join(benchmarkRoot, "manifest.json"), {
		schemaVersion: "wge-question-association-bridge-manifest/v1",
		status: "READY_FOR_ZERO_CALL_GATE",
		acceptedAt: "2026-08-26",
		authority: {
			knowledgeBoundary: "HUMAN_SELECTED_CANONICAL_KNOWLEDGE_ONLY",
			oracleProviderVisible: false,
			canonicalMutationAllowed: false,
			providerCallsMade: 0,
		},
		runtimeReceipt: {
			runtimeRoot: resolvedRuntime,
			questionStatePath: statePath,
			questionStateSha256: sha256File(statePath),
			caseSnapshotCount: new Set(fixtureCases.map((item) => item.snapshotId)).size,
		},
		files: {
			oracle: {
				path: relativeProjectPath(oraclePath),
				sha256: sha256File(oraclePath),
				providerVisible: false,
			},
			input: {
				path: relativeProjectPath(inputPath),
				sha256: sha256File(inputPath),
				bytes: inputBytes,
				providerVisible: false,
			},
			providerPayloads: payloadFiles,
		},
		providerEnvelope: {
			systemPromptSha256: sha256Text(QUESTION_ASSOCIATION_SHADOW_SYSTEM),
			systemPromptBytes: promptBytes,
			payloadCount: payloadFiles.length,
			estimatedTokensBeforeResponses: estimatedProviderTokens,
		},
		budget: {
			plannedCalls: 6,
			maxRepairCalls: 2,
			maxCalls: 8,
			maxProviderTokens: 90000,
			providerCallsBeforeExplicitSendAuthorization: 0,
		},
	});
}

function readSnapshot(runtimeRoot: string, snapshotId: string): SnapshotArchive {
	const path = join(runtimeRoot, "versions", `${snapshotId}.json.gz`);
	assert(existsSync(path), `Snapshot archive not found: ${path}`);
	const parsed = JSON.parse(gunzipSync(readFileSync(path)).toString("utf8")) as SnapshotArchive;
	assert(parsed.id === snapshotId, `Snapshot ID mismatch: ${snapshotId}`);
	assert(Array.isArray(parsed.files), `Snapshot files missing: ${snapshotId}`);
	for (const file of parsed.files) {
		assert(sha256Text(file.content) === file.sha256, `Snapshot file hash mismatch: ${file.path}`);
	}
	return parsed;
}

function readSnapshotJson(snapshot: SnapshotArchive, path: string): JsonRecord {
	const file = snapshot.files.find((item) => item.path === path);
	assert(file, `Snapshot file missing: ${path}`);
	return asRecord(JSON.parse(file.content), path);
}

function readSnapshotPublications(snapshot: SnapshotArchive): Publication[] {
	return snapshot.files
		.filter((file) => file.path.startsWith("publications/") && file.path.endsWith(".json"))
		.map((file) => parsePublication(JSON.parse(file.content)));
}

function readPublications(root: string): Publication[] {
	return readdirSync(root)
		.filter((name) => name.endsWith(".json"))
		.sort()
		.map((name) => parsePublication(readJson(join(root, name))));
}

function parsePublication(value: unknown): Publication {
	const record = asRecord(value, "publication");
	return {
		...record,
		sourceId: requireString(record, "sourceId"),
		claims: requireArray(record, "claims").map((claim) => parsePublicationClaim(claim)),
	};
}

function parsePublicationClaim(value: unknown): PublicationClaim {
	const record = asRecord(value, "publication Claim");
	return {
		...record,
		id: requireString(record, "id"),
		statement: requireString(record, "statement"),
		conditions: requireStringArray(record, "conditions"),
		validity: requireString(record, "validity"),
		claimKind: requireString(record, "claimKind"),
		scope: record.scope,
		evidenceSpanIds: requireStringArray(record, "evidenceSpanIds"),
	};
}

function readTransactionReceipts(root: string): TransactionReceipt[] {
	return readdirSync(root)
		.filter((name) => name.endsWith(".json"))
		.sort()
		.map((name) => {
			const record = readJson(join(root, name));
			return {
				sourceId: requireString(record, "sourceId"),
				canonicalEvidenceVersion: requireString(record, "canonicalEvidenceVersion"),
				beforeQuestionStateHash: requireString(record, "beforeQuestionStateHash"),
				snapshotId: requireString(record, "snapshotId"),
				state: requireString(record, "state"),
			};
		});
}

function readEvidenceRefs(root: string): Map<string, AssociationEvidenceRef> {
	const result = new Map<string, AssociationEvidenceRef>();
	for (const name of readdirSync(root)
		.filter((item) => item.endsWith(".spans.jsonl"))
		.sort()) {
		for (const line of readFileSync(join(root, name), "utf8").split(/\r?\n/)) {
			if (!line.trim()) continue;
			const record = asRecord(JSON.parse(line), `SourceSpan ${name}`);
			const ref = requireString(record, "id");
			const sourceId = requireString(record, "sourceId");
			if (result.has(ref)) throw new Error(`Duplicate SourceSpan: ${ref}`);
			result.set(ref, { ref, baseSpanRef: ref, sourceId });
		}
	}
	return result;
}

function toAssociationClaim(
	claim: PublicationClaim,
	publications: Publication[],
	receiptBySource: Map<string, TransactionReceipt>,
	evidenceByBaseRef: Map<string, AssociationEvidenceRef>,
): AssociationClaim {
	const sourceId = requireClaimSource(publications, claim.id);
	const receipt = receiptBySource.get(sourceId);
	assert(receipt, `Transaction receipt missing for Claim Source: ${sourceId}`);
	return {
		ref: claim.id,
		statement: claim.statement,
		conditions: uniqueSorted(claim.conditions),
		validity: claim.validity,
		claimKind: claim.claimKind,
		scope: claim.scope,
		sourceId,
		knowledgeVersion: receipt.canonicalEvidenceVersion,
		evidenceRefs: claim.evidenceSpanIds.map((ref) => {
			const baseSpanRef = ref.split("#", 1)[0] as string;
			const evidence = evidenceByBaseRef.get(baseSpanRef);
			assert(evidence, `Evidence ref does not resolve: ${ref}`);
			assert(evidence.sourceId === sourceId, `Evidence Source mismatch: ${ref}`);
			return { ref, baseSpanRef, sourceId };
		}),
	};
}

function toQuestionSnapshot(frame: JsonRecord, stateHash: string): AssociationQuestionSnapshot {
	return {
		ref: requireString(frame, "id"),
		canonicalQuestion: requireString(frame, "canonicalQuestion"),
		aliases: uniqueSorted(requireStringArray(frame, "aliases")),
		boundaries: uniqueSorted(requireStringArray(frame, "boundaries")),
		domain: requireString(frame, "domain"),
		scope: frame.scope,
		lifecycle: requireString(frame, "lifecycle"),
		stateHash,
	};
}

function toEvolutionEvent(decision: JsonRecord): AssociationEvolutionEvent {
	return {
		action: requireString(decision, "action"),
		sourceId: requireString(decision, "sourceId"),
		knowledgeVersion: requireString(decision, "knowledgeVersion"),
		affectedClaimRefs: uniqueSorted(requireStringArray(decision, "affectedClaimRefs")),
		createdAt: requireString(decision, "createdAt"),
	};
}

function requireQuestionFrame(state: JsonRecord, questionRef: string): JsonRecord {
	const frames = requireArray(state, "frames").map((frame) => asRecord(frame, "QuestionFrame"));
	const frame = frames.find((item) => requireString(item, "id") === questionRef);
	assert(frame, `Question did not exist before input Source: ${questionRef}`);
	return frame;
}

function indexClaims(publications: Publication[]): Map<string, PublicationClaim> {
	return uniqueIndex(
		publications.flatMap((publication) => publication.claims),
		(claim) => claim.id,
		"Claim",
	);
}

function indexClaimSources(publications: Publication[]): Map<string, string> {
	const result = new Map<string, string>();
	for (const publication of publications) {
		for (const claim of publication.claims) {
			if (result.has(claim.id)) throw new Error(`Duplicate Claim: ${claim.id}`);
			result.set(claim.id, publication.sourceId);
		}
	}
	return result;
}

function requireClaimSource(publications: Publication[], claimRef: string): string {
	const matches = publications.filter((publication) =>
		publication.claims.some((claim) => claim.id === claimRef),
	);
	assert(matches.length === 1, `Claim Source is not unique: ${claimRef}`);
	return (matches[0] as Publication).sourceId;
}

function parseOracle(value: unknown): OracleFile {
	const record = asRecord(value, "Question association oracle");
	const cases = requireArray(record, "cases").map((item) => {
		const row = asRecord(item, "oracle case");
		return {
			caseId: requireString(row, "caseId"),
			domain: requireString(row, "domain"),
			claimRef: requireString(row, "claimRef"),
			questionRef: requireString(row, "questionRef"),
			expectedVerdict: requireEnum(row.expectedVerdict, ["ATTACH", "REJECT", "UNCERTAIN"]),
			reasonCodes: requireStringArray(
				row,
				"reasonCodes",
			) as QuestionAssociationOracleCase["reasonCodes"],
		};
	});
	return {
		schemaVersion: requireString(record, "schemaVersion"),
		status: requireString(record, "status"),
		cases,
	};
}

function readJson(path: string): JsonRecord {
	return asRecord(JSON.parse(readFileSync(path, "utf8")), basename(path));
}

function writeJson(path: string, value: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function sha256File(path: string): string {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function sha256Text(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function relativeProjectPath(path: string): string {
	return path.slice(projectRoot.length + 1);
}

function uniqueIndex<T>(values: T[], keyOf: (value: T) => string, label: string): Map<string, T> {
	const result = new Map<string, T>();
	for (const value of values) {
		const key = keyOf(value);
		if (result.has(key)) throw new Error(`Duplicate ${label}: ${key}`);
		result.set(key, value);
	}
	return result;
}

function uniqueSorted(values: string[]): string[] {
	return [...new Set(values)].sort();
}

function asRecord(value: unknown, label: string): JsonRecord {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${label} must be an object`);
	}
	return value as JsonRecord;
}

function requireArray(record: JsonRecord, key: string): unknown[] {
	const value = record[key];
	if (!Array.isArray(value)) throw new Error(`${key} must be an array`);
	return value;
}

function requireString(record: JsonRecord, key: string): string {
	const value = record[key];
	if (typeof value !== "string" || value.length === 0) throw new Error(`${key} must be a string`);
	return value;
}

function requireStringArray(record: JsonRecord, key: string): string[] {
	const value = record[key];
	if (
		!Array.isArray(value) ||
		value.some((item) => typeof item !== "string" || item.length === 0)
	) {
		throw new Error(`${key} must be a string array`);
	}
	return value as string[];
}

function requireEnum<T extends string>(value: unknown, allowed: readonly T[]): T {
	if (typeof value !== "string" || !allowed.includes(value as T)) {
		throw new Error(`Enum value is not allowed: ${String(value)}`);
	}
	return value as T;
}

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const runtimeRoot = process.argv[2];
	if (!runtimeRoot) {
		throw new Error(
			"Usage: node --import tsx scripts/prepare-question-association-bridge-fixture.ts <runtime-root>",
		);
	}
	prepareQuestionAssociationBridgeFixture(runtimeRoot);
}
