import { createHash, createHmac, randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { AppConfig } from "../config/types.js";
import { currentKnowledgeVersion } from "../evolution/version-store.js";
import { withRuntimeWriteLease } from "../infrastructure/runtime-write-lock.js";
import { writeJsonAtomic } from "../linter/storage.js";
import type { AgentQueryContextResponse } from "./contracts.js";
import type { CorrectionIdentity } from "./correction-service.js";

export type PilotOutcome = "SUCCESS" | "PARTIAL" | "FAILURE";
export type PilotArm = "BASELINE" | "WIKIMEMORY";
export type PilotHardFailure =
	| "UNSUPPORTED_ASSERTION"
	| "CORRECTED_ERROR_RECURRENCE"
	| "CONFLICT_FLATTENED"
	| "CITATION_FAILURE"
	| "SCOPE_LEAK";

export interface PilotQueryReceipt {
	schemaVersion: "wge-pilot-query-receipt/v1";
	traceId: string;
	principalId: string | null;
	arm: PilotArm;
	recordedAt: string;
	taskHmac: string;
	knowledgeVersion: string;
	requestedBudgetTokens: number;
	serializedContextTokens: number;
	contextHmac: string;
	/** Present only for BASELINE idempotent registration; never returned publicly. */
	baselineIdempotencyHmac?: string;
	claimIds: string[];
	relationIds: string[];
	wikiModuleIds: string[];
	sourceIds: string[];
}

export interface RecordPilotOutcomeRequest {
	traceId: string;
	answer: string;
	outcome: PilotOutcome;
	repeatedExplanation: boolean;
	correctedErrorRecurrence: boolean;
	hardFailures: PilotHardFailure[];
	userAccepted: boolean | null;
	idempotencyKey: string;
}

export interface RegisterPilotBaselineRequest {
	task: string;
	budgetTokens: number;
	idempotencyKey: string;
}

export interface RegisterPilotBaselineResponse {
	traceId: string;
	arm: "BASELINE";
	requestedBudgetTokens: number;
	contextPolicy: "EXTERNAL_BASELINE_NO_WIKIMEMORY_CONTEXT";
}

export interface PilotOutcomeRecord {
	schemaVersion: "wge-pilot-outcome/v1";
	traceId: string;
	principalId: string;
	arm: PilotArm;
	recordedAt: string;
	idempotencyKey: string;
	requestHash: string;
	answerHmac: string;
	outcome: PilotOutcome;
	repeatedExplanation: boolean;
	correctedErrorRecurrence: boolean;
	hardFailures: PilotHardFailure[];
	userAccepted: boolean | null;
}

export type PilotOutcomeResponse = Omit<
	PilotOutcomeRecord,
	"idempotencyKey" | "requestHash" | "answerHmac"
>;

export interface PilotStatusResponse {
	principalId: string;
	queries: number;
	feedbackRecorded: number;
	feedbackPending: number;
	outcomes: Record<PilotOutcome, number>;
	repeatedExplanationCount: number;
	correctedErrorRecurrenceCount: number;
	hardFailureCount: number;
	userAcceptedCount: number;
	userRejectedCount: number;
	averageWikiMemoryContextTokens: number;
	armCounts: Record<PilotArm, number>;
	pairedTasks: number;
	pairedOutcomes: number;
	armMetrics: Record<PilotArm, PilotArmMetrics>;
	currentKnowledgeVersion: string;
}

export interface PilotArmMetrics {
	queries: number;
	feedbackRecorded: number;
	outcomes: Record<PilotOutcome, number>;
	repeatedExplanationCount: number;
	correctedErrorRecurrenceCount: number;
	hardFailureCount: number;
	userAcceptedCount: number;
	userRejectedCount: number;
	averageSerializedContextTokens: number;
}

export interface PilotCheckpoint {
	schemaVersion: "wge-pilot-checkpoint/v1";
	checkpointId: string;
	principalId: string;
	label: string;
	recordedAt: string;
	knowledgeVersion: string;
	status: PilotStatusResponse;
}

/** Explicitly enabled product telemetry. Raw tasks and answers are never persisted. */
export class PilotObservationApplicationService {
	constructor(
		private readonly config: AppConfig,
		private readonly identity: CorrectionIdentity,
		private readonly hashKey: string,
	) {
		if (!identity.principalId.trim()) throw new Error("Pilot identity requires principalId");
		if (hashKey.length < 16) throw new Error("Pilot hash key must contain at least 16 characters");
	}

	recordQuery(task: string, response: AgentQueryContextResponse): PilotQueryReceipt {
		if (response.scopeContext?.principalId !== this.identity.principalId) {
			throw new Error("Observed query principal does not match the Pilot identity");
		}
		const receipt: PilotQueryReceipt = {
			schemaVersion: "wge-pilot-query-receipt/v1",
			traceId: response.traceId,
			principalId: response.scopeContext?.principalId ?? null,
			arm: "WIKIMEMORY",
			recordedAt: new Date().toISOString(),
			taskHmac: this.hmac(task),
			knowledgeVersion: response.knowledgeVersion,
			requestedBudgetTokens: response.requestedBudgetTokens,
			serializedContextTokens: response.serializedContextTokens,
			contextHmac: this.hmac(JSON.stringify(response.contextPack)),
			claimIds: response.contextPack.claimTable.rows.map((row) => String(row[0])).sort(),
			relationIds: response.contextPack.payload.relations.map((relation) => relation.id).sort(),
			wikiModuleIds: response.contextPack.payload.wikiModules.map((module) => module.id).sort(),
			sourceIds: [
				...new Set(response.contextPack.payload.evidenceSpans.map((span) => span.sourceId)),
			].sort(),
		};
		const path = join(queryRoot(this.config), `${safeId(receipt.traceId)}.json`);
		if (existsSync(path)) throw new Error(`Pilot traceId already exists: ${receipt.traceId}`);
		writeJsonAtomic(path, receipt);
		return receipt;
	}

	registerBaseline(request: RegisterPilotBaselineRequest): RegisterPilotBaselineResponse {
		const task = request.task.trim();
		const idempotencyKey = request.idempotencyKey.trim();
		if (!task || !idempotencyKey) throw new Error("task and idempotencyKey are required");
		if (!Number.isSafeInteger(request.budgetTokens) || request.budgetTokens <= 0) {
			throw new Error("budgetTokens must be a positive safe integer");
		}
		if (idempotencyKey.length > 200)
			throw new Error("idempotencyKey must be at most 200 characters");
		return withRuntimeWriteLease(this.config, `pilot-baseline:${idempotencyKey}`, () => {
			const taskHmac = this.hmac(task);
			const existing = readJsonDirectory<PilotQueryReceipt>(queryRoot(this.config)).find(
				(receipt) =>
					receipt.principalId === this.identity.principalId &&
					receipt.arm === "BASELINE" &&
					receipt.baselineIdempotencyHmac === this.hmac(idempotencyKey),
			);
			if (existing) {
				if (
					existing.taskHmac !== taskHmac ||
					existing.requestedBudgetTokens !== request.budgetTokens
				) {
					throw new Error("idempotencyKey was already used for a different Baseline request");
				}
				return publicBaseline(existing);
			}
			const traceId = randomUUID();
			const receipt: PilotQueryReceipt = {
				schemaVersion: "wge-pilot-query-receipt/v1",
				traceId,
				principalId: this.identity.principalId,
				arm: "BASELINE",
				recordedAt: new Date().toISOString(),
				taskHmac,
				knowledgeVersion: currentKnowledgeVersion(this.config),
				requestedBudgetTokens: request.budgetTokens,
				serializedContextTokens: 0,
				contextHmac: this.hmac("EXTERNAL_BASELINE_NO_WIKIMEMORY_CONTEXT"),
				baselineIdempotencyHmac: this.hmac(idempotencyKey),
				claimIds: [],
				relationIds: [],
				wikiModuleIds: [],
				sourceIds: [],
			};
			writeJsonAtomic(join(queryRoot(this.config), `${safeId(traceId)}.json`), receipt);
			return publicBaseline(receipt);
		});
	}

	recordOutcome(request: RecordPilotOutcomeRequest): PilotOutcomeResponse {
		const normalized = normalizeOutcome(request);
		return withRuntimeWriteLease(this.config, `pilot-outcome:${normalized.traceId}`, () => {
			const receipt = readQueryReceipt(this.config, normalized.traceId);
			if (!receipt) throw new Error(`Pilot query receipt not found: ${normalized.traceId}`);
			if (receipt.principalId !== this.identity.principalId) {
				throw new Error("Only the querying principal may record its outcome");
			}
			const existing = readOutcomeRecord(this.config, normalized.traceId);
			const requestHash = this.hmac(JSON.stringify(normalized));
			if (existing) {
				if (
					existing.idempotencyKey !== normalized.idempotencyKey ||
					existing.requestHash !== requestHash
				) {
					throw new Error("Pilot outcome is immutable after first recording");
				}
				return publicOutcome(existing);
			}
			const record: PilotOutcomeRecord = {
				schemaVersion: "wge-pilot-outcome/v1",
				traceId: normalized.traceId,
				principalId: this.identity.principalId,
				arm: receipt.arm,
				recordedAt: new Date().toISOString(),
				idempotencyKey: normalized.idempotencyKey,
				requestHash,
				answerHmac: this.hmac(normalized.answer),
				outcome: normalized.outcome,
				repeatedExplanation: normalized.repeatedExplanation,
				correctedErrorRecurrence: normalized.correctedErrorRecurrence,
				hardFailures: normalized.hardFailures,
				userAccepted: normalized.userAccepted,
			};
			writeJsonAtomic(join(outcomeRoot(this.config), `${safeId(record.traceId)}.json`), record);
			return publicOutcome(record);
		});
	}

	getStatus(): PilotStatusResponse {
		const receipts = readJsonDirectory<PilotQueryReceipt>(queryRoot(this.config)).filter(
			(receipt) => receipt.principalId === this.identity.principalId,
		);
		const traceIds = new Set(receipts.map((receipt) => receipt.traceId));
		const outcomes = readJsonDirectory<PilotOutcomeRecord>(outcomeRoot(this.config)).filter(
			(outcome) =>
				outcome.principalId === this.identity.principalId && traceIds.has(outcome.traceId),
		);
		const accepted = outcomes.filter((outcome) => outcome.userAccepted === true).length;
		const rejected = outcomes.filter((outcome) => outcome.userAccepted === false).length;
		const wikiMemoryReceipts = receipts.filter((receipt) => receipt.arm === "WIKIMEMORY");
		const armsByTaskAndBudget = new Map<string, Set<PilotArm>>();
		const outcomeArmsByTaskAndBudget = new Map<string, Set<PilotArm>>();
		for (const receipt of receipts) {
			const pairKey = `${receipt.taskHmac}:${receipt.requestedBudgetTokens}`;
			const arms = armsByTaskAndBudget.get(pairKey) ?? new Set<PilotArm>();
			arms.add(receipt.arm);
			armsByTaskAndBudget.set(pairKey, arms);
			if (outcomes.some((outcome) => outcome.traceId === receipt.traceId)) {
				const outcomeArms = outcomeArmsByTaskAndBudget.get(pairKey) ?? new Set<PilotArm>();
				outcomeArms.add(receipt.arm);
				outcomeArmsByTaskAndBudget.set(pairKey, outcomeArms);
			}
		}
		return {
			principalId: this.identity.principalId,
			queries: receipts.length,
			feedbackRecorded: outcomes.length,
			feedbackPending: receipts.length - outcomes.length,
			outcomes: {
				SUCCESS: outcomes.filter((outcome) => outcome.outcome === "SUCCESS").length,
				PARTIAL: outcomes.filter((outcome) => outcome.outcome === "PARTIAL").length,
				FAILURE: outcomes.filter((outcome) => outcome.outcome === "FAILURE").length,
			},
			repeatedExplanationCount: outcomes.filter((outcome) => outcome.repeatedExplanation).length,
			correctedErrorRecurrenceCount: outcomes.filter((outcome) => outcome.correctedErrorRecurrence)
				.length,
			hardFailureCount: outcomes.reduce((total, outcome) => total + outcome.hardFailures.length, 0),
			userAcceptedCount: accepted,
			userRejectedCount: rejected,
			averageWikiMemoryContextTokens:
				wikiMemoryReceipts.length === 0
					? 0
					: wikiMemoryReceipts.reduce(
							(total, receipt) => total + receipt.serializedContextTokens,
							0,
						) / wikiMemoryReceipts.length,
			armCounts: {
				BASELINE: receipts.filter((receipt) => receipt.arm === "BASELINE").length,
				WIKIMEMORY: receipts.filter((receipt) => receipt.arm === "WIKIMEMORY").length,
			},
			pairedTasks: [...armsByTaskAndBudget.values()].filter(
				(arms) => arms.has("BASELINE") && arms.has("WIKIMEMORY"),
			).length,
			pairedOutcomes: [...outcomeArmsByTaskAndBudget.values()].filter(
				(arms) => arms.has("BASELINE") && arms.has("WIKIMEMORY"),
			).length,
			armMetrics: {
				BASELINE: summarizeArm("BASELINE", receipts, outcomes),
				WIKIMEMORY: summarizeArm("WIKIMEMORY", receipts, outcomes),
			},
			currentKnowledgeVersion: currentKnowledgeVersion(this.config),
		};
	}

	markTrustedCheckpoint(label: string): PilotCheckpoint {
		const normalizedLabel = label.trim();
		if (!normalizedLabel || normalizedLabel.length > 200) {
			throw new Error("Checkpoint label must contain 1-200 characters");
		}
		const checkpoint: PilotCheckpoint = {
			schemaVersion: "wge-pilot-checkpoint/v1",
			checkpointId: `pilot-checkpoint:${randomUUID()}`,
			principalId: this.identity.principalId,
			label: normalizedLabel,
			recordedAt: new Date().toISOString(),
			knowledgeVersion: currentKnowledgeVersion(this.config),
			status: this.getStatus(),
		};
		writeJsonAtomic(
			join(checkpointRoot(this.config), `${safeId(checkpoint.checkpointId)}.json`),
			checkpoint,
		);
		return checkpoint;
	}

	private hmac(value: string): string {
		return createHmac("sha256", this.hashKey).update(value).digest("hex");
	}
}

function summarizeArm(
	arm: PilotArm,
	receipts: PilotQueryReceipt[],
	outcomes: PilotOutcomeRecord[],
): PilotArmMetrics {
	const armReceipts = receipts.filter((receipt) => receipt.arm === arm);
	const armOutcomes = outcomes.filter((outcome) => outcome.arm === arm);
	return {
		queries: armReceipts.length,
		feedbackRecorded: armOutcomes.length,
		outcomes: {
			SUCCESS: armOutcomes.filter((outcome) => outcome.outcome === "SUCCESS").length,
			PARTIAL: armOutcomes.filter((outcome) => outcome.outcome === "PARTIAL").length,
			FAILURE: armOutcomes.filter((outcome) => outcome.outcome === "FAILURE").length,
		},
		repeatedExplanationCount: armOutcomes.filter((outcome) => outcome.repeatedExplanation).length,
		correctedErrorRecurrenceCount: armOutcomes.filter((outcome) => outcome.correctedErrorRecurrence)
			.length,
		hardFailureCount: armOutcomes.reduce(
			(total, outcome) => total + outcome.hardFailures.length,
			0,
		),
		userAcceptedCount: armOutcomes.filter((outcome) => outcome.userAccepted === true).length,
		userRejectedCount: armOutcomes.filter((outcome) => outcome.userAccepted === false).length,
		averageSerializedContextTokens:
			armReceipts.length === 0
				? 0
				: armReceipts.reduce((total, receipt) => total + receipt.serializedContextTokens, 0) /
					armReceipts.length,
	};
}

function normalizeOutcome(request: RecordPilotOutcomeRequest) {
	const traceId = request.traceId.trim();
	const answer = request.answer.trim();
	const idempotencyKey = request.idempotencyKey.trim();
	if (!traceId || !answer || !idempotencyKey) {
		throw new Error("traceId, answer and idempotencyKey are required");
	}
	if (answer.length > 100_000) throw new Error("answer must be at most 100000 characters");
	if (idempotencyKey.length > 200) throw new Error("idempotencyKey must be at most 200 characters");
	const allowedHardFailures = new Set<PilotHardFailure>([
		"UNSUPPORTED_ASSERTION",
		"CORRECTED_ERROR_RECURRENCE",
		"CONFLICT_FLATTENED",
		"CITATION_FAILURE",
		"SCOPE_LEAK",
	]);
	if (request.hardFailures.some((failure) => !allowedHardFailures.has(failure))) {
		throw new Error("hardFailures contains an unsupported value");
	}
	const hardFailures = [...new Set(request.hardFailures)].sort();
	if (request.correctedErrorRecurrence && !hardFailures.includes("CORRECTED_ERROR_RECURRENCE")) {
		hardFailures.push("CORRECTED_ERROR_RECURRENCE");
		hardFailures.sort();
	}
	return {
		traceId,
		answer,
		outcome: request.outcome,
		repeatedExplanation: request.repeatedExplanation,
		correctedErrorRecurrence: request.correctedErrorRecurrence,
		hardFailures,
		userAccepted: request.userAccepted,
		idempotencyKey,
	};
}

function readQueryReceipt(config: AppConfig, traceId: string): PilotQueryReceipt | null {
	const path = join(queryRoot(config), `${safeId(traceId)}.json`);
	if (!existsSync(path)) return null;
	return JSON.parse(readFileSync(path, "utf-8")) as PilotQueryReceipt;
}

function readOutcomeRecord(config: AppConfig, traceId: string): PilotOutcomeRecord | null {
	const path = join(outcomeRoot(config), `${safeId(traceId)}.json`);
	if (!existsSync(path)) return null;
	return JSON.parse(readFileSync(path, "utf-8")) as PilotOutcomeRecord;
}

function publicOutcome(record: PilotOutcomeRecord): PilotOutcomeResponse {
	const { idempotencyKey, requestHash, answerHmac, ...response } = record;
	void idempotencyKey;
	void requestHash;
	void answerHmac;
	return response;
}

function publicBaseline(receipt: PilotQueryReceipt): RegisterPilotBaselineResponse {
	return {
		traceId: receipt.traceId,
		arm: "BASELINE",
		requestedBudgetTokens: receipt.requestedBudgetTokens,
		contextPolicy: "EXTERNAL_BASELINE_NO_WIKIMEMORY_CONTEXT",
	};
}

function readJsonDirectory<T>(root: string): T[] {
	if (!existsSync(root)) return [];
	return readdirSync(root)
		.filter((file) => file.endsWith(".json"))
		.sort()
		.map((file) => JSON.parse(readFileSync(join(root, file), "utf-8")) as T);
}

function pilotRoot(config: AppConfig): string {
	return join(config.runsDir, "pilot");
}

function queryRoot(config: AppConfig): string {
	return join(pilotRoot(config), "queries");
}

function outcomeRoot(config: AppConfig): string {
	return join(pilotRoot(config), "outcomes");
}

function checkpointRoot(config: AppConfig): string {
	return join(pilotRoot(config), "checkpoints");
}

function safeId(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}
