import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { AppConfig } from "../config/types.js";
import type { LLMProvider } from "../core/llm-provider.js";
import type { ChatOptions, ChatResult } from "../core/types.js";
import { appendJsonl } from "../linter/storage.js";
import type { CompileStage } from "./run-state.js";

export interface LLMCallContext {
	runId: string;
	sourceId: string;
	stage: CompileStage;
	batchId: string;
	attempt: number;
}

export interface ObservedChatResult {
	callId: string;
	result: ChatResult;
}

export async function observedChat(
	config: AppConfig,
	provider: LLMProvider,
	options: ChatOptions,
	context: LLMCallContext,
): Promise<ObservedChatResult> {
	const callId = randomUUID();
	const prompt = [options.systemPrompt, ...options.messages.map((message) => message.content)].join(
		"\n",
	);
	const common = {
		runId: context.runId,
		sourceId: context.sourceId,
		stage: context.stage,
		batchId: context.batchId,
		attempt: context.attempt,
		callId,
		modelRequested: options.model,
		promptHash: createHash("sha256").update(prompt).digest("hex"),
		promptChars: prompt.length,
		estimatedPromptTokens: estimateTokens(prompt),
		maxTokens: options.maxTokens ?? null,
		timestamp: new Date().toISOString(),
	};

	try {
		const result = await provider.chat(options);
		const rawDirectory = join(config.runsDir, context.runId, "raw-llm-output");
		mkdirSync(rawDirectory, { recursive: true });
		const rawPath = join(rawDirectory, `${callId}.txt`);
		writeFileSync(rawPath, result.content, "utf-8");
		appendJsonl(join(config.runsDir, "llm-calls.jsonl"), [
			{
				eventType: "LLM_CALL_COMPLETED",
				...common,
				modelReturned: result.model,
				finishReason: result.finishReason,
				reasoningContentChars: result.reasoningContentChars,
				usage: result.usage,
				contentChars: result.content.length,
				outputHash: createHash("sha256").update(result.content).digest("hex"),
				rawOutputRef: relative(config.projectRoot, rawPath),
			},
		]);
		return { callId, result };
	} catch (error) {
		appendJsonl(join(config.runsDir, "llm-calls.jsonl"), [
			{
				eventType: "LLM_CALL_FAILED",
				...common,
				error: errorMessage(error),
			},
		]);
		throw error;
	}
}

export function recordParseResult(
	config: AppConfig,
	context: LLMCallContext,
	callId: string,
	outcome: "VALID" | "INVALID",
	error?: unknown,
): void {
	appendJsonl(join(config.runsDir, "llm-calls.jsonl"), [
		{
			eventType: "LLM_PARSE_RESULT",
			runId: context.runId,
			sourceId: context.sourceId,
			stage: context.stage,
			batchId: context.batchId,
			attempt: context.attempt,
			callId,
			outcome,
			timestamp: new Date().toISOString(),
			...(error ? { error: errorMessage(error) } : {}),
		},
	]);
}

/** Conservative tokenizer-independent estimate suitable for batching mixed Chinese/English text. */
export function estimateTokens(text: string): number {
	let tokens = 0;
	let asciiRun = 0;
	const flushAscii = () => {
		tokens += Math.ceil(asciiRun / 4);
		asciiRun = 0;
	};
	for (const character of text) {
		if (character.charCodeAt(0) <= 0x7f) {
			asciiRun++;
		} else {
			flushAscii();
			tokens++;
		}
	}
	flushAscii();
	return Math.max(tokens, 1);
}

export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
