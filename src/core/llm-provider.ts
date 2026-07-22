/**
 * LLMProvider — LLM 调用抽象层
 *
 * 从旧项目 lite-llmwiki 迁移。将 LLM 调用与具体模型/API 解耦。
 * compile/audit/query 等模块调 LLMProvider，不直接依赖 DeepSeekClient。
 * 为跨模型审计（Product Definition 哲学 08：模型黑盒产品责任白盒）提供基础设施。
 */

import type { AppConfig } from "../config/types.js";
import type { ChatOptions, ChatResult } from "./types.js";
import { DeepSeekClient } from "./client.js";

/** LLM 调用接口——所有 LLM 交互的统一入口 */
export interface LLMProvider {
	chat(opts: ChatOptions): Promise<ChatResult>;
	chatWithThinking(opts: ChatOptions): Promise<ChatResult>;
}

/** DeepSeek LLM Provider */
export class DeepSeekProvider implements LLMProvider {
	private client: DeepSeekClient;

	constructor(config: AppConfig) {
		this.client = new DeepSeekClient(config);
	}

	async chat(opts: ChatOptions): Promise<ChatResult> {
		return this.client.chat(opts);
	}

	async chatWithThinking(opts: ChatOptions): Promise<ChatResult> {
		return this.client.chat(opts);
	}
}

/** 工厂函数——从 config 创建默认 LLMProvider */
export function createLLMProvider(config: AppConfig): LLMProvider {
	return new DeepSeekProvider(config);
}

export type { ChatOptions, ChatResult } from "./types.js";
