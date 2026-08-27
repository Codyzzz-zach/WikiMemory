import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadConfig } from "../src/config/index.js";
import { createLLMProvider } from "../src/core/llm-provider.js";
import {
	type RetrievalAliasProjection,
	readAllClaims,
	retrievalAliasStatementHash,
	writeRetrievalAliasProjections,
} from "../src/linter/storage.js";

type JsonRecord = Record<string, unknown>;
const PROMPT_VERSION = "retrieval-alias-zh-v1";
const projectRoot = process.cwd();
const workspaceRoot = process.env.WGE_ALIAS_WORKSPACE
	? join(projectRoot, process.env.WGE_ALIAS_WORKSPACE)
	: projectRoot;
const config = loadConfig({
	projectRoot: workspaceRoot,
	model: process.env.WGE_MODEL ?? "deepseek-v4-flash",
	temperature: 0,
});
if (!config.apiKey) throw new Error("DEEPSEEK_API_KEY 未设置");
const provider = createLLMProvider(config);
const claims = readAllClaims(config).filter(
	(claim) =>
		!/[\p{Script=Han}]/u.test(claim.statement) && (claim.retrievalAliases ?? []).length === 0,
);
const runId = `alias-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`;
const runRoot = join(config.runsDir, "retrieval-aliases", runId);
const projections: RetrievalAliasProjection[] = [];
mkdirSync(join(runRoot, "records"), { recursive: true });

for (let offset = 0; offset < claims.length; offset += 20) {
	const batch = claims.slice(offset, offset + 20);
	const prompt = JSON.stringify({
		task: "为每条英文 Claim 生成 1-3 条忠实中文检索短语。只翻译已有含义；保留实体名、数字、日期、否定和限制；不得添加事实。短语用于召回，不是回答或证据。",
		output: { projections: [{ claimId: "原ID", aliases: ["中文检索短语"] }] },
		claims: batch.map((claim) => ({ claimId: claim.id, statement: claim.statement })),
	});
	const result = await provider.chat({
		model: config.model,
		temperature: 0,
		thinkingDisabled: true,
		systemPrompt: "你是跨语言检索索引生成器。只输出严格 JSON 对象。",
		messages: [{ role: "user", content: prompt }],
		responseFormat: "json_object",
		maxTokens: 5000,
	});
	if (result.finishReason !== "stop") throw new Error(`Alias batch ${offset} truncated`);
	const parsed = asRecord(JSON.parse(result.content), "alias response");
	const rows = recordArray(parsed.projections);
	const expected = new Map(batch.map((claim) => [claim.id, claim]));
	for (const row of rows) {
		const claimId = requireString(row, "claimId");
		const claim = expected.get(claimId);
		if (!claim) throw new Error(`Unknown alias claimId ${claimId}`);
		const aliases = stringArray(row.aliases)
			.map((value) => value.trim())
			.filter(Boolean)
			.slice(0, 3);
		if (aliases.length === 0) throw new Error(`Missing aliases for ${claimId}`);
		projections.push({
			claimId,
			statementHash: retrievalAliasStatementHash(claim.statement),
			aliases,
			model: result.model,
			promptVersion: PROMPT_VERSION,
			generatedAt: new Date().toISOString(),
		});
		expected.delete(claimId);
	}
	if (expected.size > 0) throw new Error(`Alias batch omitted ${[...expected.keys()].join(",")}`);
	writeFileSync(
		join(runRoot, "records", `batch-${String(offset / 20).padStart(3, "0")}.json`),
		`${JSON.stringify({ promptHash: sha256(prompt), usage: result.usage, rows }, null, 2)}\n`,
		"utf8",
	);
	console.error(`aliased ${Math.min(offset + batch.length, claims.length)}/${claims.length}`);
}

writeRetrievalAliasProjections(config, projections);
writeJson(join(runRoot, "manifest.json"), {
	runId,
	promptVersion: PROMPT_VERSION,
	model: config.model,
	claims: claims.length,
	projections: projections.length,
	indexPath: join(config.indexesDir, "retrieval-aliases.jsonl"),
});
console.log(JSON.stringify({ runId, runRoot, projections: projections.length }, null, 2));

function sha256(value: string) {
	return createHash("sha256").update(value).digest("hex");
}
function writeJson(path: string, value: unknown) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
function asRecord(value: unknown, label: string): JsonRecord {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error(`${label} must be an object`);
	return value as JsonRecord;
}
function recordArray(value: unknown): JsonRecord[] {
	if (!Array.isArray(value)) throw new Error("Expected projections array");
	return value.map((item) => asRecord(item, "projection"));
}
function requireString(record: JsonRecord, key: string) {
	const value = record[key];
	if (typeof value !== "string" || value.length === 0) throw new Error(`${key} must be a string`);
	return value;
}
function stringArray(value: unknown): string[] {
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
		throw new Error("Expected string array");
	return value as string[];
}
