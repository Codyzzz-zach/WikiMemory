import { createHash } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { AppConfig } from "../config/types.js";
import { readJson, writeJsonAtomic } from "../linter/storage.js";
import type { QuestionEvolutionDecision, QuestionFrame } from "../types/index.js";
import { validateQuestionEvolutionDecision, validateQuestionFrame } from "./question-model.js";

export type QuestionTransactionState = "PENDING" | "COMPLETED" | "ROLLED_BACK";

export interface QuestionTransactionReceipt {
	schemaVersion: "wge-question-transaction/v1";
	transactionId: string;
	runId: string;
	sourceId: string;
	canonicalEvidenceVersion: string;
	beforeQuestionStateHash: string;
	snapshotId: string;
	state: QuestionTransactionState;
	frames: QuestionFrame[];
	decisions: QuestionEvolutionDecision[];
	createdAt: string;
	updatedAt: string;
	error: string | null;
}

export interface BeginQuestionTransactionInput {
	runId: string;
	sourceId: string;
	canonicalEvidenceVersion: string;
	beforeQuestionStateHash: string;
	snapshotId: string;
	frames: QuestionFrame[];
	decisions: QuestionEvolutionDecision[];
	createdAt: string;
}

export function beginQuestionTransaction(
	config: AppConfig,
	input: BeginQuestionTransactionInput,
): QuestionTransactionReceipt {
	const identity = JSON.stringify({
		runId: input.runId,
		sourceId: input.sourceId,
		canonicalEvidenceVersion: input.canonicalEvidenceVersion,
		frames: input.frames.map((frame) => String(frame.id)).sort(),
		decisions: input.decisions.map((decision) => decision.id).sort(),
	});
	const transactionId = `question-tx:${createHash("sha256")
		.update(identity)
		.digest("hex")
		.slice(0, 24)}`;
	const existing = readQuestionTransaction(config, transactionId);
	if (existing) return existing;
	const receipt: QuestionTransactionReceipt = validateReceipt({
		schemaVersion: "wge-question-transaction/v1",
		transactionId,
		runId: input.runId,
		sourceId: input.sourceId,
		canonicalEvidenceVersion: input.canonicalEvidenceVersion,
		beforeQuestionStateHash: input.beforeQuestionStateHash,
		snapshotId: input.snapshotId,
		state: "PENDING",
		frames: input.frames,
		decisions: input.decisions,
		createdAt: input.createdAt,
		updatedAt: input.createdAt,
		error: null,
	});
	writeJsonAtomic(receiptPath(config, transactionId), receipt);
	return receipt;
}

export function finishQuestionTransaction(
	config: AppConfig,
	receipt: QuestionTransactionReceipt,
	state: Exclude<QuestionTransactionState, "PENDING">,
	updatedAt: string,
	error: string | null = null,
): QuestionTransactionReceipt {
	const current = readQuestionTransaction(config, receipt.transactionId);
	if (!current) throw new Error(`Question transaction receipt missing: ${receipt.transactionId}`);
	if (current.state !== "PENDING" && current.state !== state) {
		throw new Error(
			`Question transaction already finalized: ${receipt.transactionId} is ${current.state}`,
		);
	}
	const next = validateReceipt({ ...current, state, updatedAt, error });
	writeJsonAtomic(receiptPath(config, receipt.transactionId), next);
	return next;
}

export function readPendingQuestionTransactions(config: AppConfig): QuestionTransactionReceipt[] {
	const root = receiptRoot(config);
	if (!existsSync(root)) return [];
	return readdirSync(root)
		.filter((file) => file.endsWith(".json"))
		.sort()
		.flatMap((file) => {
			const receipt = readJson<QuestionTransactionReceipt>(join(root, file));
			return receipt ? [validateReceipt(receipt)] : [];
		})
		.filter((receipt) => receipt.state === "PENDING")
		.sort(
			(left, right) =>
				left.createdAt.localeCompare(right.createdAt) ||
				left.transactionId.localeCompare(right.transactionId),
		);
}

export function readQuestionTransaction(
	config: AppConfig,
	transactionId: string,
): QuestionTransactionReceipt | null {
	const stored = readJson<QuestionTransactionReceipt>(receiptPath(config, transactionId));
	return stored ? validateReceipt(stored) : null;
}

function validateReceipt(receipt: QuestionTransactionReceipt): QuestionTransactionReceipt {
	if (receipt.schemaVersion !== "wge-question-transaction/v1") {
		throw new Error(`Unsupported Question transaction schema: ${String(receipt.schemaVersion)}`);
	}
	if (!/^question-tx:[a-f0-9]{24}$/.test(receipt.transactionId)) {
		throw new Error(`Invalid Question transaction ID: ${receipt.transactionId}`);
	}
	if (!receipt.runId || !receipt.sourceId || !receipt.snapshotId) {
		throw new Error(`Incomplete Question transaction receipt: ${receipt.transactionId}`);
	}
	if (
		!Number.isFinite(Date.parse(receipt.createdAt)) ||
		!Number.isFinite(Date.parse(receipt.updatedAt))
	) {
		throw new Error(`Invalid Question transaction timestamp: ${receipt.transactionId}`);
	}
	return {
		...receipt,
		frames: receipt.frames.map(validateQuestionFrame),
		decisions: receipt.decisions.map(validateQuestionEvolutionDecision),
	};
}

function receiptRoot(config: AppConfig): string {
	return join(config.runsDir, "question-transactions");
}

function receiptPath(config: AppConfig, transactionId: string): string {
	if (!/^question-tx:[a-f0-9]{24}$/.test(transactionId)) {
		throw new Error(`Invalid Question transaction ID: ${transactionId}`);
	}
	return join(receiptRoot(config), `${transactionId.replace(":", "-")}.json`);
}
