/**
 * DeepSeekClient — DeepSeek API 客户端
 *
 * 从旧项目 lite-llmwiki 迁移。封装 openai npm 包，提供 chat / chatStream。
 * DeepSeek API 与 OpenAI API 兼容，只需改 baseURL。
 *
 * 保留旧项目的 maxRetries: 3 + timeout: 120s（experience-index 好设计 5.5）。
 */

import OpenAI from "openai";
import type {
	ChatCompletionCreateParamsNonStreaming,
	ChatCompletionCreateParamsStreaming,
	ChatCompletionMessageParam,
} from "openai/resources/chat/completions";
import type { AppConfig } from "../config/types.js";
import type { ChatOptions, ChatResult } from "./types.js";

export class DeepSeekClient {
	private client: OpenAI;

	constructor(config: AppConfig) {
		this.client = new OpenAI({
			apiKey: config.apiKey,
			baseURL: config.baseUrl,
			maxRetries: 3,
			timeout: 120_000,
		});
	}

	async chat(opts: ChatOptions): Promise<ChatResult> {
		const openAiMessages: ChatCompletionMessageParam[] = [
			{ role: "system", content: opts.systemPrompt },
			...opts.messages.map((m) =>
				m.role === "user"
					? ({ role: "user", content: m.content } as const)
					: ({ role: "assistant", content: m.content } as const),
			),
		];

		const request = buildDeepSeekRequest(opts, openAiMessages, false);
		const response = await this.client.chat.completions.create(request, { signal: opts.signal });

		const choice = response.choices[0];
		const content = choice?.message?.content ?? "";
		const reasoningContent = (choice?.message as unknown as { reasoning_content?: string | null })
			?.reasoning_content;
		const usage = response.usage;

		return {
			content,
			model: response.model,
			finishReason: choice?.finish_reason ?? null,
			reasoningContentChars: reasoningContent?.length ?? 0,
			usage: usage
				? {
						promptTokens: usage.prompt_tokens ?? 0,
						completionTokens: usage.completion_tokens ?? 0,
						totalTokens: usage.total_tokens ?? 0,
						promptCacheHitTokens:
							(usage as unknown as Record<string, number>).prompt_cache_hit_tokens ?? 0,
						promptCacheMissTokens:
							(usage as unknown as Record<string, number>).prompt_cache_miss_tokens ?? 0,
						reasoningTokens: extractReasoningTokens(usage),
					}
				: null,
		};
	}

	async chatStream(opts: ChatOptions): Promise<ChatResult> {
		const openAiMessages: ChatCompletionMessageParam[] = [
			{ role: "system", content: opts.systemPrompt },
			...opts.messages.map((m) =>
				m.role === "user"
					? ({ role: "user", content: m.content } as const)
					: ({ role: "assistant", content: m.content } as const),
			),
		];

		const request = buildDeepSeekRequest(opts, openAiMessages, true);
		const stream = await this.client.chat.completions.create(request, { signal: opts.signal });

		let fullContent = "";
		let usage: ChatResult["usage"] = null;
		let finishReason: string | null = null;
		let reasoningContentChars = 0;

		for await (const chunk of stream) {
			const delta = chunk.choices[0]?.delta?.content;
			if (delta) {
				fullContent += delta;
				opts.onStream?.(delta);
			}
			if (chunk.choices[0]?.finish_reason) {
				finishReason = chunk.choices[0].finish_reason;
			}
			const reasoningDelta = (
				chunk.choices[0]?.delta as unknown as { reasoning_content?: string | null }
			)?.reasoning_content;
			if (reasoningDelta) reasoningContentChars += reasoningDelta.length;
			if (chunk.usage) {
				usage = {
					promptTokens: chunk.usage.prompt_tokens ?? 0,
					completionTokens: chunk.usage.completion_tokens ?? 0,
					totalTokens: chunk.usage.total_tokens ?? 0,
					promptCacheHitTokens:
						(chunk.usage as unknown as Record<string, number>).prompt_cache_hit_tokens ?? 0,
					promptCacheMissTokens:
						(chunk.usage as unknown as Record<string, number>).prompt_cache_miss_tokens ?? 0,
					reasoningTokens: extractReasoningTokens(chunk.usage),
				};
			}
		}

		return {
			content: fullContent,
			model: opts.model,
			finishReason,
			reasoningContentChars,
			usage,
		};
	}
}

type DeepSeekThinkingControl = { thinking?: { type: "disabled" } };

export function buildDeepSeekRequest(
	opts: ChatOptions,
	messages: ChatCompletionMessageParam[],
	stream: false,
): ChatCompletionCreateParamsNonStreaming & DeepSeekThinkingControl;
export function buildDeepSeekRequest(
	opts: ChatOptions,
	messages: ChatCompletionMessageParam[],
	stream: true,
): ChatCompletionCreateParamsStreaming & DeepSeekThinkingControl;
export function buildDeepSeekRequest(
	opts: ChatOptions,
	messages: ChatCompletionMessageParam[],
	stream: boolean,
):
	| (ChatCompletionCreateParamsNonStreaming & DeepSeekThinkingControl)
	| (ChatCompletionCreateParamsStreaming & DeepSeekThinkingControl) {
	return {
		model: opts.model,
		messages,
		response_format:
			opts.responseFormat === "json_object" ? { type: "json_object" as const } : undefined,
		max_tokens: opts.maxTokens,
		stream,
		...(opts.thinkingDisabled ? { thinking: { type: "disabled" as const } } : {}),
	} as
		| (ChatCompletionCreateParamsNonStreaming & DeepSeekThinkingControl)
		| (ChatCompletionCreateParamsStreaming & DeepSeekThinkingControl);
}

function extractReasoningTokens(usage: unknown): number {
	const details = (
		usage as { completion_tokens_details?: { reasoning_tokens?: number | null } } | null
	)?.completion_tokens_details;
	return details?.reasoning_tokens ?? 0;
}
