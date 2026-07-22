/**
 * AppConfig — 新项目配置类型
 *
 * 从旧项目迁移但修正了坑（experience-index 坑 4.1）：
 * - findProjectRoot 只找不建（不做 ensureDir）
 * - 要求 sources/ 和 wiki/ 都存在（不是或）
 * - 加 --project-root CLI 参数让用户显式指定
 * - model 走 config，不硬编码
 */

export const DEFAULT_MODEL = "deepseek-v4-flash";
export const DEFAULT_BASE_URL = "https://api.deepseek.com/v1";

export interface AppConfig {
	/** 项目根目录（含 sources/ wiki/ 等知识状态目录） */
	projectRoot: string;
	/** 不可变原文目录 */
	sourcesDir: string;
	/** Canonical WikiModule 目录 */
	wikiDir: string;
	/** 隔离区目录 */
	quarantineDir: string;
	/** 可重建索引目录（不进 Git） */
	indexesDir: string;
	/** 编译/lint manifest 目录 */
	runsDir: string;
	/** LLM API key */
	apiKey: string;
	/** LLM API base URL */
	baseUrl: string;
	/** 默认模型 */
	model: string;
}
