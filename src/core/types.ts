/**
 * ChatOptions / ChatResult — LLM 调用的输入输出合同
 *
 * 从旧项目 lite-llmwiki 迁移，设计良好直接复用。
 * 与具体 Provider 解耦——DeepSeekClient 和未来的其他 Provider 都满足这个接口。
 */

export interface ChatOptions {
	model: string;
	systemPrompt: string;
	messages: Array<{ role: "user" | "assistant"; content: string }>;
	/** 强制 JSON 输出 */
	responseFormat?: "json_object" | "text";
	/** 最大输出 token 数 */
	maxTokens?: number;
	/** 显式采样温度；生产编译/审计必须传入，避免依赖 Provider 默认值 */
	temperature?: number;
	/** 流式输出回调（可选） */
	onStream?: (delta: string) => void;
	/** 中止信号 */
	signal?: AbortSignal;
	/** 关闭 V4 思考模式（thinking: disabled），节省 token 和延迟 */
	thinkingDisabled?: boolean;
}

export interface ChatResult {
	content: string;
	model: string;
	/** Provider termination reason; "length" proves output-budget truncation. */
	finishReason: string | null;
	/** Non-zero indicates that the provider actually used thinking mode. */
	reasoningContentChars: number;
	usage: {
		promptTokens: number;
		completionTokens: number;
		totalTokens: number;
		promptCacheHitTokens: number;
		promptCacheMissTokens: number;
		reasoningTokens: number;
	} | null;
}
