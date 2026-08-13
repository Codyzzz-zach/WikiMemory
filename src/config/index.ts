/**
 * config — 配置加载
 *
 * 修正旧项目坑（experience-index 4.1）：
 * - findProjectRoot 只找不建（不做 ensureDir）
 * - 要求 sources/ 和 wiki/ 都存在
 * - 支持 --project-root 显式指定
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AppConfig } from "./types.js";
import { DEFAULT_BASE_URL, DEFAULT_MODEL, DEFAULT_TEMPERATURE } from "./types.js";

/**
 * 从 cwd 向上找项目根目录。
 * 要求 sources/ 和 wiki/ 都存在（不是或——修旧项目坑：只找 raw 或 wiki 之一会误命中）。
 * 只找不建——不做 ensureDir，避免误建目录短路搜索。
 */
export function findProjectRoot(start?: string): string {
	const dir = start ?? process.cwd();
	const candidates = [dir];

	let parent = dir;
	for (let i = 0; i < 5; i++) {
		const next = resolve(parent, "..");
		if (next === parent) break;
		candidates.push(next);
		parent = next;
	}

	for (const c of candidates) {
		if (existsSync(join(c, "sources")) && existsSync(join(c, "wiki"))) {
			return c;
		}
	}

	return dir;
}

/**
 * 从环境变量或 .env 文件加载 API key。
 */
export function loadApiKey(): string {
	const envKey = process.env.DEEPSEEK_API_KEY;
	if (envKey) return envKey;

	try {
		const envPath = join(process.cwd(), ".env");
		if (existsSync(envPath)) {
			const content = readFileSync(envPath, "utf-8");
			const match = content.match(/^DEEPSEEK_API_KEY=(.+)$/m);
			if (match) return match[1].trim();
		}
	} catch {
		// ignore
	}

	return "";
}

/**
 * 加载配置。
 * @param overrides - 可选覆盖（如 CLI --project-root）
 */
export function loadConfig(overrides?: Partial<AppConfig>): AppConfig {
	const legacyRoot = overrides?.projectRoot ?? findProjectRoot();
	const runtimeRoot = resolve(overrides?.runtimeRoot ?? process.env.WGE_RUNTIME_ROOT ?? legacyRoot);
	const environmentTemperature = process.env.WGE_TEMPERATURE;
	const temperature =
		overrides?.temperature ??
		(environmentTemperature === undefined
			? DEFAULT_TEMPERATURE
			: Number.parseFloat(environmentTemperature));
	if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
		throw new Error(`WGE_TEMPERATURE 必须是 0 到 2 之间的数，收到: ${environmentTemperature}`);
	}

	return {
		// Keep projectRoot as a compatibility alias until legacy scripts migrate.
		projectRoot: runtimeRoot,
		runtimeRoot,
		sourcesDir: join(runtimeRoot, "sources"),
		wikiDir: join(runtimeRoot, "wiki"),
		quarantineDir: join(runtimeRoot, "quarantine"),
		indexesDir: join(runtimeRoot, "indexes"),
		runsDir: join(runtimeRoot, "runs"),
		apiKey: overrides?.apiKey ?? loadApiKey(),
		baseUrl: overrides?.baseUrl ?? process.env.DEEPSEEK_BASE_URL ?? DEFAULT_BASE_URL,
		model: overrides?.model ?? process.env.WGE_MODEL ?? DEFAULT_MODEL,
		temperature,
	};
}

/** 确保目录存在（只在显式 init 时调用，不在 loadConfig 里调） */
export function ensureDir(dir: string): void {
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
}
