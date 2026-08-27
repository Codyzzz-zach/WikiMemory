#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { estimateTokens } from "../src/compiler/telemetry.js";
import { loadConfig } from "../src/config/index.js";
import { createLLMProvider } from "../src/core/llm-provider.js";
import type { ChatResult } from "../src/core/types.js";
import { writeJsonAtomic } from "../src/linter/storage.js";
import {
	QUESTION_ASSOCIATION_SHADOW_SYSTEM,
	type QuestionAssociationDecision,
	type QuestionAssociationFixtureCase,
	type QuestionAssociationGateResult,
	type QuestionAssociationOracleCase,
	type QuestionAssociationPayload,
	type QuestionAssociationVariant,
	auditQuestionAssociationDecisions,
	parseQuestionAssociationDecisions,
} from "../src/wiki/question-association-shadow.js";

const EXPERIMENT_MODEL = "deepseek-v4-flash";
const EXPERIMENT_TEMPERATURE = 0;
const EXPERIMENT_MAX_OUTPUT_TOKENS = 4096;
const PRIVATE_RUNTIME_PREFIX = "/private/tmp/wikimemory-qab-v1-";

interface FrozenManifest {
	schemaVersion: string;
	status: string;
	authority: {
		oracleProviderVisible: boolean;
		canonicalMutationAllowed: boolean;
		providerCallsMade: number;
	};
	runtimeReceipt: {
		questionStatePath: string;
		questionStateSha256: string;
	};
	files: {
		oracle: FrozenFile & { providerVisible: boolean };
		input: FrozenFile & { providerVisible: boolean };
		providerPayloads: Array<FrozenFile & { bytes: number; estimatedTokens: number }>;
	};
	providerEnvelope: {
		systemPromptSha256: string;
		systemPromptBytes: number;
		payloadCount: number;
		estimatedTokensBeforeResponses: number;
	};
	budget: {
		plannedCalls: number;
		maxRepairCalls: number;
		maxCalls: number;
		maxProviderTokens: number;
		providerCallsBeforeExplicitSendAuthorization: number;
	};
}

interface FrozenFile {
	path: string;
	sha256: string;
}

interface FrozenInput {
	schemaVersion: string;
	status: string;
	knowledgeBoundary: string;
	cases: QuestionAssociationFixtureCase[];
}

interface FrozenOracle {
	schemaVersion: string;
	status: string;
	cases: QuestionAssociationOracleCase[];
}

interface ProviderCallReceipt {
	callNumber: number;
	kind: "MAIN" | "FORMAT_REPAIR";
	payloadPath: string;
	payloadSha256: string;
	variant: QuestionAssociationVariant;
	domain: string;
	startedAt: string;
	completedAt: string;
	latencyMs: number;
	modelRequested: string;
	modelReturned: string;
	temperature: number;
	thinkingDisabled: true;
	maxOutputTokens: number;
	responseFormat: "json_object";
	systemPromptSha256: string;
	requestMessagesSha256: string;
	responseSha256: string;
	finishReason: string | null;
	reasoningContentChars: number;
	usage: ChatResult["usage"];
	rawOutputRef: string;
	repairOfCallNumber: number | null;
}

interface PayloadRunRecord {
	payloadPath: string;
	payloadSha256: string;
	domain: string;
	variant: QuestionAssociationVariant;
	mainCallNumber: number;
	finalCallNumber: number;
	repairCallNumbers: number[];
	decisions: QuestionAssociationDecision[];
}

interface SessionState {
	schemaVersion: "wge-question-association-experiment-session/v1";
	status: "RUNNING" | "STRUCTURE_VALID" | "COMPLETE" | "STOPPED";
	startedAt: string;
	completedAt: string | null;
	runtimeRoot: string;
	authorization: {
		explicitlyAuthorized: true;
		maxCalls: number;
		maxProviderTokens: number;
		feesAccepted: true;
	};
	providerEnvelope: {
		model: string;
		temperature: number;
		thinkingDisabled: true;
		maxOutputTokens: number;
		responseFormat: "json_object";
		systemPromptSha256: string;
	};
	canonicalStateSha256Before: string;
	canonicalStateSha256After: string | null;
	oracleLoadedAt: string | null;
	calls: ProviderCallReceipt[];
	totalProviderTokens: number;
	mainCalls: number;
	repairCalls: number;
	error: string | null;
}

export type ExperimentOutcome =
	| "PASS_IDENTITY_CARD"
	| "NO_MARGINAL_VALUE"
	| "REWORK_ASSOCIATION_SEMANTICS"
	| "NARROW_TO_DETERMINISTIC"
	| "STOP_BRIDGE";

export interface VariantSummary {
	variant: QuestionAssociationVariant;
	status: "PASS" | "FAIL";
	blockers: Array<QuestionAssociationGateResult["blockers"][number] & { domain: string }>;
	summary: QuestionAssociationGateResult["summary"];
	failedCaseIds: string[];
}

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(scriptPath), "..");
const benchmarkRoot = join(projectRoot, "benchmarks", "question-association-bridge-v1");
const manifestPath = join(benchmarkRoot, "manifest.json");

export function validateQuestionAssociationResponse(
	raw: unknown,
	payload: QuestionAssociationPayload,
): QuestionAssociationDecision[] {
	const decisions = parseQuestionAssociationDecisions(raw);
	if (decisions.length !== payload.cases.length) {
		throw new Error(
			`Decision accounting mismatch: expected ${payload.cases.length}, received ${decisions.length}`,
		);
	}
	const expected = new Map(payload.cases.map((item) => [item.caseId, item]));
	const seen = new Set<string>();
	for (const decision of decisions) {
		if (seen.has(decision.caseId)) throw new Error(`Duplicate decision: ${decision.caseId}`);
		seen.add(decision.caseId);
		const fixture = expected.get(decision.caseId);
		if (!fixture) throw new Error(`Unknown decision case: ${decision.caseId}`);
		if (
			decision.claimRef !== fixture.claim.claimRef ||
			decision.questionRef !== fixture.question.questionRef
		) {
			throw new Error(`Pair reference mismatch: ${decision.caseId}`);
		}
	}
	for (const caseId of expected.keys()) {
		if (!seen.has(caseId)) throw new Error(`Missing decision: ${caseId}`);
	}
	return [...decisions].sort((left, right) => left.caseId.localeCompare(right.caseId));
}

export function formatRepairInstruction(error: unknown): string {
	const detail = errorMessage(error).replaceAll(/\s+/g, " ").slice(0, 800);
	return `FORMAT_REPAIR_V1
上一条 assistant 输出未通过严格 JSON/schema 验证：${detail}
这只是格式修复，不是重新进行语义裁决。不得改变上一输出中已经存在的 verdict、reasonCodes、grounded refs、boundaryNotes 或 competingQuestionRefs；不得使用外部信息。请把上一输出规范化为 system prompt 要求的唯一 JSON envelope，并确保输入中的每个 case 恰好出现一次、字段齐全、引用原样复制。只输出 JSON。`;
}

export function classifyExperimentOutcome(input: {
	a0: VariantSummary;
	a1: VariantSummary;
	correctedCaseIds: string[];
	introducedFailureCaseIds: string[];
}): ExperimentOutcome {
	if (input.a0.status === "PASS" && input.a1.status === "PASS") {
		return "NO_MARGINAL_VALUE";
	}
	if (
		input.a1.status === "PASS" &&
		input.correctedCaseIds.length > 0 &&
		input.introducedFailureCaseIds.length === 0
	) {
		return "PASS_IDENTITY_CARD";
	}
	if (input.a1.summary.falseAttachCount > 0) return "STOP_BRIDGE";
	return "REWORK_ASSOCIATION_SEMANTICS";
}

async function runExperiment(requestedRuntimeRoot?: string): Promise<void> {
	const manifest = loadAndValidatePreflightManifest();
	const runtimeRoot = createIsolatedRuntime(requestedRuntimeRoot);
	const callsRoot = join(runtimeRoot, "calls");
	const recordsRoot = join(runtimeRoot, "records");
	mkdirSync(callsRoot, { recursive: true });
	mkdirSync(recordsRoot, { recursive: true });
	const config = loadConfig({
		projectRoot: runtimeRoot,
		runtimeRoot,
		model: EXPERIMENT_MODEL,
		temperature: EXPERIMENT_TEMPERATURE,
	});
	assert(config.apiKey.length > 0, "DEEPSEEK_API_KEY is required");
	const provider = createLLMProvider(config);
	const canonicalBefore = sha256File(manifest.runtimeReceipt.questionStatePath);
	assert(
		canonicalBefore === manifest.runtimeReceipt.questionStateSha256,
		"Frozen Canonical Question state hash drifted before provider calls",
	);
	const session: SessionState = {
		schemaVersion: "wge-question-association-experiment-session/v1",
		status: "RUNNING",
		startedAt: new Date().toISOString(),
		completedAt: null,
		runtimeRoot,
		authorization: {
			explicitlyAuthorized: true,
			maxCalls: manifest.budget.maxCalls,
			maxProviderTokens: manifest.budget.maxProviderTokens,
			feesAccepted: true,
		},
		providerEnvelope: {
			model: EXPERIMENT_MODEL,
			temperature: EXPERIMENT_TEMPERATURE,
			thinkingDisabled: true,
			maxOutputTokens: EXPERIMENT_MAX_OUTPUT_TOKENS,
			responseFormat: "json_object",
			systemPromptSha256: sha256Text(QUESTION_ASSOCIATION_SHADOW_SYSTEM),
		},
		canonicalStateSha256Before: canonicalBefore,
		canonicalStateSha256After: null,
		oracleLoadedAt: null,
		calls: [],
		totalProviderTokens: 0,
		mainCalls: 0,
		repairCalls: 0,
		error: null,
	};
	writeSession(runtimeRoot, session);
	const records: PayloadRunRecord[] = [];

	try {
		for (const frozen of manifest.files.providerPayloads) {
			verifyFrozenFile(frozen);
			const payloadText = readFileSync(projectFile(frozen.path), "utf8");
			const payload = parsePayload(payloadText);
			const main = await invokeProvider({
				provider,
				manifest,
				session,
				runtimeRoot,
				frozen,
				payload,
				messages: [{ role: "user", content: payloadText }],
				kind: "MAIN",
				repairOfCallNumber: null,
			});
			let finalCall = main;
			let decisions: QuestionAssociationDecision[] | null = null;
			const repairCallNumbers: number[] = [];
			for (;;) {
				try {
					if (finalCall.receipt.finishReason === "length") {
						throw new Error("Provider output reached max output tokens");
					}
					decisions = validateQuestionAssociationResponse(finalCall.result.content, payload);
					break;
				} catch (error) {
					assert(
						session.repairCalls < manifest.budget.maxRepairCalls,
						`Format repair budget exhausted after ${session.repairCalls} repairs: ${errorMessage(error)}`,
					);
					const repairInstruction = formatRepairInstruction(error);
					const repair = await invokeProvider({
						provider,
						manifest,
						session,
						runtimeRoot,
						frozen,
						payload,
						messages: [
							{ role: "user", content: payloadText },
							{ role: "assistant", content: finalCall.result.content },
							{ role: "user", content: repairInstruction },
						],
						kind: "FORMAT_REPAIR",
						repairOfCallNumber: finalCall.receipt.callNumber,
					});
					repairCallNumbers.push(repair.receipt.callNumber);
					writeFileSync(
						join(callsRoot, `call-${pad(repair.receipt.callNumber)}-repair-instruction.txt`),
						`${repairInstruction}\n`,
						"utf8",
					);
					writeSession(runtimeRoot, session);
					finalCall = repair;
				}
			}
			assert(decisions, `No structurally valid decisions for ${frozen.path}`);
			const record: PayloadRunRecord = {
				payloadPath: frozen.path,
				payloadSha256: frozen.sha256,
				domain: payload.domain,
				variant: payload.variant,
				mainCallNumber: main.receipt.callNumber,
				finalCallNumber: finalCall.receipt.callNumber,
				repairCallNumbers,
				decisions,
			};
			records.push(record);
			writeJsonAtomic(join(recordsRoot, `${payloadStem(frozen.path)}.json`), record);
			console.error(
				`completed ${payload.domain} ${payload.variant} call=${finalCall.receipt.callNumber}`,
			);
		}

		assert(
			session.mainCalls === manifest.budget.plannedCalls,
			`Main call accounting mismatch: ${session.mainCalls}`,
		);
		assert(
			records.length === manifest.providerEnvelope.payloadCount,
			"Payload accounting mismatch",
		);
		const canonicalAfter = sha256File(manifest.runtimeReceipt.questionStatePath);
		session.canonicalStateSha256After = canonicalAfter;
		assert(
			canonicalAfter === canonicalBefore,
			"Canonical Question state mutated during shadow run",
		);
		session.status = "STRUCTURE_VALID";
		writeSession(runtimeRoot, session);

		// Oracle and local fixture are intentionally not read until every provider output is structurally valid.
		verifyFrozenFile(manifest.files.input);
		verifyFrozenFile(manifest.files.oracle);
		const frozenInput = readJson<FrozenInput>(projectFile(manifest.files.input.path));
		const frozenOracle = readJson<FrozenOracle>(projectFile(manifest.files.oracle.path));
		session.oracleLoadedAt = new Date().toISOString();
		const report = buildExperimentReport({
			manifest,
			runtimeRoot,
			records,
			frozenInput,
			frozenOracle,
			canonicalBefore,
			canonicalAfter,
			session,
		});
		writeJsonAtomic(join(runtimeRoot, "report.json"), report);
		session.status = "COMPLETE";
		session.completedAt = new Date().toISOString();
		writeSession(runtimeRoot, session);
		process.stdout.write(
			`${JSON.stringify(
				{
					runtimeRoot,
					status: session.status,
					outcome: report.outcome,
					mainCalls: session.mainCalls,
					repairCalls: session.repairCalls,
					totalProviderTokens: session.totalProviderTokens,
				},
				null,
				2,
			)}\n`,
		);
	} catch (error) {
		session.status = "STOPPED";
		session.completedAt = new Date().toISOString();
		session.error = errorMessage(error);
		if (existsSync(manifest.runtimeReceipt.questionStatePath)) {
			session.canonicalStateSha256After = sha256File(manifest.runtimeReceipt.questionStatePath);
		}
		writeSession(runtimeRoot, session);
		throw error;
	}
}

async function invokeProvider(input: {
	provider: ReturnType<typeof createLLMProvider>;
	manifest: FrozenManifest;
	session: SessionState;
	runtimeRoot: string;
	frozen: FrozenFile;
	payload: QuestionAssociationPayload;
	messages: Array<{ role: "user" | "assistant"; content: string }>;
	kind: ProviderCallReceipt["kind"];
	repairOfCallNumber: number | null;
}): Promise<{ receipt: ProviderCallReceipt; result: ChatResult }> {
	verifyFrozenFile(input.frozen);
	assert(
		input.session.calls.length < input.manifest.budget.maxCalls,
		`Provider call budget exhausted at ${input.session.calls.length}`,
	);
	const estimatedRequestTokens = estimateTokens(
		[QUESTION_ASSOCIATION_SHADOW_SYSTEM, ...input.messages.map((item) => item.content)].join("\n"),
	);
	assert(
		input.session.totalProviderTokens + estimatedRequestTokens + EXPERIMENT_MAX_OUTPUT_TOKENS <=
			input.manifest.budget.maxProviderTokens,
		"Worst-case next call would exceed the 90,000-token provider budget",
	);
	const callNumber = input.session.calls.length + 1;
	const startedAt = new Date().toISOString();
	const startedMs = Date.now();
	const result = await input.provider.chat({
		model: EXPERIMENT_MODEL,
		temperature: EXPERIMENT_TEMPERATURE,
		thinkingDisabled: true,
		systemPrompt: QUESTION_ASSOCIATION_SHADOW_SYSTEM,
		messages: input.messages,
		responseFormat: "json_object",
		maxTokens: EXPERIMENT_MAX_OUTPUT_TOKENS,
	});
	const rawOutputRef = join("calls", `call-${pad(callNumber)}-raw.txt`);
	writeFileSync(join(input.runtimeRoot, rawOutputRef), result.content, "utf8");
	const receipt: ProviderCallReceipt = {
		callNumber,
		kind: input.kind,
		payloadPath: input.frozen.path,
		payloadSha256: input.frozen.sha256,
		variant: input.payload.variant,
		domain: input.payload.domain,
		startedAt,
		completedAt: new Date().toISOString(),
		latencyMs: Date.now() - startedMs,
		modelRequested: EXPERIMENT_MODEL,
		modelReturned: result.model,
		temperature: EXPERIMENT_TEMPERATURE,
		thinkingDisabled: true,
		maxOutputTokens: EXPERIMENT_MAX_OUTPUT_TOKENS,
		responseFormat: "json_object",
		systemPromptSha256: sha256Text(QUESTION_ASSOCIATION_SHADOW_SYSTEM),
		requestMessagesSha256: sha256Text(
			JSON.stringify(input.messages.map((item) => [item.role, item.content])),
		),
		responseSha256: sha256Text(result.content),
		finishReason: result.finishReason,
		reasoningContentChars: result.reasoningContentChars,
		usage: result.usage,
		rawOutputRef,
		repairOfCallNumber: input.repairOfCallNumber,
	};
	input.session.calls.push(receipt);
	if (input.kind === "MAIN") input.session.mainCalls += 1;
	else input.session.repairCalls += 1;
	input.session.totalProviderTokens += result.usage?.totalTokens ?? 0;
	writeJsonAtomic(
		join(input.runtimeRoot, "calls", `call-${pad(callNumber)}-receipt.json`),
		receipt,
	);
	writeSession(input.runtimeRoot, input.session);
	assert(result.usage, `Provider usage missing for call ${callNumber}`);
	assert(
		result.reasoningContentChars === 0 && result.usage.reasoningTokens === 0,
		`Thinking mode was used in call ${callNumber}`,
	);
	assert(
		input.session.totalProviderTokens <= input.manifest.budget.maxProviderTokens,
		"Provider token budget exceeded",
	);
	return { receipt, result };
}

function buildExperimentReport(input: {
	manifest: FrozenManifest;
	runtimeRoot: string;
	records: PayloadRunRecord[];
	frozenInput: FrozenInput;
	frozenOracle: FrozenOracle;
	canonicalBefore: string;
	canonicalAfter: string;
	session: SessionState;
}): Record<string, unknown> & { outcome: ExperimentOutcome } {
	assert(input.frozenInput.cases.length === 18, "Frozen input case count changed");
	assert(input.frozenOracle.cases.length === 18, "Frozen oracle case count changed");
	const gates = input.records.map((record) => {
		const cases = input.frozenInput.cases.filter((item) => item.domain === record.domain);
		const caseIds = new Set(cases.map((item) => item.caseId));
		const oracle = input.frozenOracle.cases.filter((item) => caseIds.has(item.caseId));
		const gate = auditQuestionAssociationDecisions({
			variant: record.variant,
			cases,
			oracle,
			decisions: { decisions: record.decisions },
			canonicalStateHashBefore: input.canonicalBefore,
			canonicalStateHashAfter: input.canonicalAfter,
		});
		return { domain: record.domain, ...gate };
	});
	const a0 = summarizeVariant("A0_NAME_CARD", gates);
	const a1 = summarizeVariant("A1_EVIDENCE_IDENTITY_CARD", gates);
	const correctedCaseIds = a0.failedCaseIds.filter((caseId) => !a1.failedCaseIds.includes(caseId));
	const introducedFailureCaseIds = a1.failedCaseIds.filter(
		(caseId) => !a0.failedCaseIds.includes(caseId),
	);
	const outcome = classifyExperimentOutcome({
		a0,
		a1,
		correctedCaseIds,
		introducedFailureCaseIds,
	});
	return {
		schemaVersion: "wge-question-association-experiment-report/v1",
		createdAt: new Date().toISOString(),
		status: "AUTOMATIC_GATE_COMPLETE",
		outcome,
		outcomeIsProvisionalUntilFrozenSemanticReview: true,
		knowledgeBoundary: input.frozenInput.knowledgeBoundary,
		model: EXPERIMENT_MODEL,
		temperature: EXPERIMENT_TEMPERATURE,
		thinkingDisabled: true,
		maxOutputTokens: EXPERIMENT_MAX_OUTPUT_TOKENS,
		runtimeRoot: input.runtimeRoot,
		manifestSha256: sha256File(manifestPath),
		promptSha256: sha256Text(QUESTION_ASSOCIATION_SHADOW_SYSTEM),
		oracleProviderVisible: false,
		oracleLoadedAt: input.session.oracleLoadedAt,
		canonicalState: {
			beforeSha256: input.canonicalBefore,
			afterSha256: input.canonicalAfter,
			mutated: input.canonicalBefore !== input.canonicalAfter,
		},
		budget: {
			mainCalls: input.session.mainCalls,
			repairCalls: input.session.repairCalls,
			totalCalls: input.session.calls.length,
			totalProviderTokens: input.session.totalProviderTokens,
			maxCalls: input.manifest.budget.maxCalls,
			maxProviderTokens: input.manifest.budget.maxProviderTokens,
		},
		variants: { A0_NAME_CARD: a0, A1_EVIDENCE_IDENTITY_CARD: a1 },
		marginalValue: { correctedCaseIds, introducedFailureCaseIds },
		gates,
		callReceipts: input.session.calls.map((call) => ({
			callNumber: call.callNumber,
			kind: call.kind,
			payloadPath: call.payloadPath,
			variant: call.variant,
			domain: call.domain,
			usage: call.usage,
			finishReason: call.finishReason,
			responseSha256: call.responseSha256,
		})),
	};
}

function summarizeVariant(
	variant: QuestionAssociationVariant,
	gates: Array<QuestionAssociationGateResult & { domain: string }>,
): VariantSummary {
	const selected = gates.filter((gate) => gate.variant === variant);
	assert(selected.length === 3, `Expected three domain Gates for ${variant}`);
	const blockers = selected.flatMap((gate) =>
		gate.blockers.map((blocker) => ({ domain: gate.domain, ...blocker })),
	);
	const failedCaseIds = [...new Set(blockers.map((item) => item.caseId).filter(isString))].sort();
	return {
		variant,
		status: selected.every((gate) => gate.status === "PASS") ? "PASS" : "FAIL",
		blockers,
		summary: {
			caseCount: selected.reduce((sum, gate) => sum + gate.summary.caseCount, 0),
			attachCount: selected.reduce((sum, gate) => sum + gate.summary.attachCount, 0),
			rejectCount: selected.reduce((sum, gate) => sum + gate.summary.rejectCount, 0),
			uncertainCount: selected.reduce((sum, gate) => sum + gate.summary.uncertainCount, 0),
			hardPositiveErrors: selected.reduce((sum, gate) => sum + gate.summary.hardPositiveErrors, 0),
			falseAttachCount: selected.reduce((sum, gate) => sum + gate.summary.falseAttachCount, 0),
			uncertaintyErrors: selected.reduce((sum, gate) => sum + gate.summary.uncertaintyErrors, 0),
			canonicalMutationCount: selected.reduce(
				(sum, gate) => sum + gate.summary.canonicalMutationCount,
				0,
			),
		},
		failedCaseIds,
	};
}

function loadAndValidatePreflightManifest(): FrozenManifest {
	const manifest = readJson<FrozenManifest>(manifestPath);
	assert(manifest.schemaVersion === "wge-question-association-bridge-manifest/v1", "Bad manifest");
	assert(manifest.status === "READY_FOR_ZERO_CALL_GATE", "Manifest is not frozen-ready");
	assert(manifest.authority.oracleProviderVisible === false, "Oracle visibility violation");
	assert(manifest.authority.canonicalMutationAllowed === false, "Canonical mutation is enabled");
	assert(
		manifest.authority.providerCallsMade === 0,
		"Manifest was not frozen before provider calls",
	);
	assert(
		manifest.budget.providerCallsBeforeExplicitSendAuthorization === 0,
		"Provider calls were made before authorization",
	);
	assert(manifest.budget.plannedCalls === 6, "Expected six frozen main calls");
	assert(manifest.budget.maxRepairCalls === 2, "Expected at most two repairs");
	assert(manifest.budget.maxCalls === 8, "Expected eight-call hard limit");
	assert(manifest.budget.maxProviderTokens === 90_000, "Expected 90,000-token hard limit");
	assert(manifest.providerEnvelope.payloadCount === 6, "Expected six provider payloads");
	assert(manifest.files.providerPayloads.length === 6, "Provider payload manifest mismatch");
	assert(
		sha256Text(QUESTION_ASSOCIATION_SHADOW_SYSTEM) === manifest.providerEnvelope.systemPromptSha256,
		"Frozen system prompt hash drifted",
	);
	assert(
		Buffer.byteLength(QUESTION_ASSOCIATION_SHADOW_SYSTEM, "utf8") ===
			manifest.providerEnvelope.systemPromptBytes,
		"Frozen system prompt byte count drifted",
	);
	for (const frozen of manifest.files.providerPayloads) verifyFrozenFile(frozen);
	assert(
		existsSync(manifest.runtimeReceipt.questionStatePath),
		"Frozen Canonical Question state receipt is unavailable",
	);
	return manifest;
}

function parsePayload(content: string): QuestionAssociationPayload {
	const payload = JSON.parse(content) as QuestionAssociationPayload;
	assert(payload.schemaVersion === "wge-question-association-input/v1", "Bad payload schema");
	assert(
		payload.variant === "A0_NAME_CARD" || payload.variant === "A1_EVIDENCE_IDENTITY_CARD",
		"Bad payload variant",
	);
	assert(Array.isArray(payload.cases) && payload.cases.length > 0, "Payload cases missing");
	return payload;
}

function createIsolatedRuntime(requested?: string): string {
	if (!requested) return mkdtempSync(PRIVATE_RUNTIME_PREFIX);
	const runtimeRoot = resolve(requested);
	assert(
		runtimeRoot.startsWith("/private/tmp/wikimemory-qab-v1-"),
		"Experiment runtime must be isolated under /private/tmp/wikimemory-qab-v1-*",
	);
	assert(!existsSync(runtimeRoot), `Runtime already exists: ${runtimeRoot}`);
	mkdirSync(runtimeRoot, { recursive: false });
	return runtimeRoot;
}

function projectFile(path: string): string {
	assert(!isAbsolute(path), `Frozen project file must be relative: ${path}`);
	const resolved = resolve(projectRoot, path);
	assert(resolved.startsWith(`${projectRoot}/`), `Frozen project file escapes repository: ${path}`);
	return resolved;
}

function verifyFrozenFile(file: FrozenFile): void {
	const path = projectFile(file.path);
	assert(existsSync(path), `Frozen file missing: ${file.path}`);
	assert(sha256File(path) === file.sha256, `Frozen file hash drifted: ${file.path}`);
}

function writeSession(runtimeRoot: string, session: SessionState): void {
	writeJsonAtomic(join(runtimeRoot, "session.json"), session);
}

function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, "utf8")) as T;
}

function sha256File(path: string): string {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function sha256Text(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function payloadStem(path: string): string {
	return basename(path, ".json");
}

function pad(value: number): string {
	return String(value).padStart(2, "0");
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function isString(value: string | null): value is string {
	return typeof value === "string";
}

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function isMainModule(): boolean {
	return process.argv[1] !== undefined && resolve(process.argv[1]) === scriptPath;
}

if (isMainModule()) {
	const program = new Command()
		.name("run-question-association-bridge-experiment")
		.option("--execute", "send the six frozen payloads to DeepSeek")
		.option("--runtime-root <path>", "explicit isolated /private/tmp runtime path")
		.parse();
	const options = program.opts<{ execute?: boolean; runtimeRoot?: string }>();
	if (!options.execute) {
		const manifest = loadAndValidatePreflightManifest();
		process.stdout.write(
			`${JSON.stringify(
				{
					status: "PREFLIGHT_PASS_NO_PROVIDER_CALLS",
					payloads: manifest.providerEnvelope.payloadCount,
					maxCalls: manifest.budget.maxCalls,
					maxProviderTokens: manifest.budget.maxProviderTokens,
					promptSha256: manifest.providerEnvelope.systemPromptSha256,
				},
				null,
				2,
			)}\n`,
		);
	} else {
		runExperiment(options.runtimeRoot).catch((error) => {
			console.error(errorMessage(error));
			process.exitCode = 1;
		});
	}
}
