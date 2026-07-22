/**
 * DeepSeekClient — DeepSeek API 客户端
 *
 * 从旧项目 lite-llmwiki 迁移。封装 openai npm 包，提供 chat / chatStream。
 * DeepSeek API 与 OpenAI API 兼容，只需改 baseURL。
 *
 * 保留旧项目的 maxRetries: 3 + timeout: 120s（experience-index 好设计 5.5）。
 */

import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
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

		const response = await this.client.chat.completions.create(
			{
				model: opts.model,
				messages: openAiMessages,
				response_format:
					opts.responseFormat === "json_object"
						? { type: "json_object" }
						: undefined,
				max_tokens: opts.maxTokens,
				stream: false,
			},
			{
				signal: opts.signal,
				...(opts.thinkingDisabled
					? { extra_body: { thinking: { type: "disabled" } } }
					: {}),
			},
		);

		const choice = response.choices[0];
		const content = choice?.message?.content ?? "";
		const usage = response.usage;

		return {
			content,
			model: response.model,
			usage: usage
				? {
						promptTokens: usage.prompt_tokens ?? 0,
						completionTokens: usage.completion_tokens ?? 0,
						totalTokens: usage.total_tokens ?? 0,
						promptCacheHitTokens:
							(usage as unknown as Record<string, number>).prompt_cache_hit_tokens ?? 0,
						promptCacheMissTokens:
							(usage as unknown as Record<string, number>).prompt_cache_miss_tokens ?? 0,
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

		const stream = await this.client.chat.completions.create(
			{
				model: opts.model,
				messages: openAiMessages,
				response_format:
					opts.responseFormat === "json_object"
						? { type: "json_object" }
						: undefined,
				max_tokens: opts.maxTokens,
				stream: true,
			},
			{
				signal: opts.signal,
				...(opts.thinkingDisabled
					? { extra_body: { thinking: { type: "disabled" } } }
					: {}),
			},
		);

		let fullContent = "";
		let usage: ChatResult["usage"] = null;

		for await (const chunk of stream) {
			const delta = chunk.choices[0]?.delta?.content;
			if (delta) {
				fullContent += delta;
				opts.onStream?.(delta);
			}
			if (chunk.usage) {
				usage = {
					promptTokens: chunk.usage.prompt_tokens ?? 0,
					completionTokens: chunk.usage.completion_tokens ?? 0,
					totalTokens: chunk.usage.total_tokens ?? 0,
					promptCacheHitTokens:
						(chunk.usage as unknown as Record<string, number>).prompt_cache_hit_tokens ?? 0,
					promptCacheMissTokens:
						(chunk.usage as unknown as Record<string, number>).prompt_cache_miss_tokens ?? 0,
				};
			}
		}

		return {
			content: fullContent,
			model: opts.model,
			usage,
		};
	}
}
