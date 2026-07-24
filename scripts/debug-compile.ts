/**
 * Legacy capacity-reproduction harness.
 *
 * This intentionally exercises the retired one-shot COMPILE_SYSTEM path with maxTokens=8192 so
 * truncation/JSON failures can be reproduced. It is not the production ingest implementation;
 * production uses compileSource() batching, run-state recovery, lint, and atomic publication.
 */
import { loadConfig } from "../src/config/index.js";
import { createLLMProvider } from "../src/core/llm-provider.js";
import { ingestMarkdownFile, mapQuoteToSpan } from "../src/ingestor/index.js";
import { COMPILE_SYSTEM, PROPOSITION_EXTRACT_SYSTEM } from "../src/prompts/index.js";
import {
	CompileResponseSchema,
	PropositionResponseSchema,
	parseLLMJson,
} from "../src/types/schemas.js";
import type { PropositionResponse } from "../src/types/schemas.js";

async function main() {
	const config = loadConfig();
	const provider = createLLMProvider(config);

	// Step 1: 摄入
	const ingest = ingestMarkdownFile(config, "mathtest-material/02-spaces.md");
	console.log("Source:", ingest.source.id, "Blocks:", ingest.spans.length);

	// Step 2: 命题切分
	const blockList = ingest.spans.map((s) => `[${s.blockId}] ${s.text.slice(0, 500)}`).join("\n\n");
	const propPrompt = `请将以下章节块拆分为原子命题。\n\n# 可用块列表\n${blockList}\n\n请以 JSON 格式返回结果。`;

	const propResult = await provider.chat({
		model: config.model,
		systemPrompt: PROPOSITION_EXTRACT_SYSTEM,
		messages: [{ role: "user", content: propPrompt }],
		responseFormat: "json_object",
		thinkingDisabled: true,
		maxTokens: 32768,
	});
	console.log("\n=== 命题切分结果 ===");
	console.log("completion tokens:", propResult.usage?.completionTokens);
	console.log("content 前 200 字:", propResult.content.slice(0, 200));

	let propData: PropositionResponse;
	try {
		propData = parseLLMJson(propResult.content, PropositionResponseSchema);
		console.log("命题数:", propData.propositions.length);
	} catch (e) {
		console.log("命题切分解析失败:", (e as Error).message.slice(0, 300));
		return;
	}

	// Step 3: 映射
	const propositions = [];
	for (const item of propData.propositions) {
		const mappedSpan = mapQuoteToSpan(ingest.spans, item.blockId, item.exactQuote);
		if (!mappedSpan) continue;
		propositions.push({
			sourceId: ingest.source.id,
			blockId: item.blockId,
			text: item.text,
			exactQuote: item.exactQuote,
		});
	}
	console.log("映射成功:", propositions.length, "/", propData.propositions.length);
	if (propositions.length === 0) {
		console.log("无命题，退出");
		return;
	}

	// Step 4: Claim 编译
	const propList = propositions
		.map(
			(p, i) =>
				`[prop ${i}] blockId=${p.blockId}\n  text: ${p.text}\n  exactQuote: ${p.exactQuote}`,
		)
		.join("\n\n");
	const compilePrompt = `请基于以下原子命题编译 Claim、Concept 和 Relation。\n\n# 命题列表\n${propList}\n\n# 关键提醒\n- evidenceQuotes 必须是上面 exactQuote 字段中确实存在的原文片段\n- blockIds 必须是上面 blockId 字段的值\n请以 JSON 格式返回结果。`;

	console.log("\n=== Claim 编译请求 ===");
	console.log("prompt 长度:", compilePrompt.length, "chars");

	const compileResult = await provider.chat({
		model: config.model,
		systemPrompt: COMPILE_SYSTEM,
		messages: [{ role: "user", content: compilePrompt }],
		responseFormat: "json_object",
		thinkingDisabled: true,
		maxTokens: 8192,
	});

	console.log("\n=== Claim 编译结果 ===");
	console.log("completion tokens:", compileResult.usage?.completionTokens);
	console.log("content 长度:", compileResult.content.length);
	console.log("content 前 500 字:", compileResult.content.slice(0, 500));
	console.log("...\ncontent 末 200 字:", compileResult.content.slice(-200));

	// 尝试解析
	try {
		const data = parseLLMJson(compileResult.content, CompileResponseSchema);
		console.log(
			`\n✅ 解析成功: claims=${data.claims.length} concepts=${data.concepts?.length ?? 0} relations=${data.relations?.length ?? 0}`,
		);
	} catch (e) {
		console.log("\n❌ 解析失败:", (e as Error).message.slice(0, 500));
	}
}
main().catch((e) => {
	console.error(e);
	process.exit(1);
});
