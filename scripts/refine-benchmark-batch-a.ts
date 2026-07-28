import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type JsonRecord = Record<string, unknown>;

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const batchRoot = resolve(process.argv[2] ?? join(projectRoot, "workbuddy-batch-a"));
const outputRoot = join(batchRoot, "refined");
const candidateRoot = join(batchRoot, "candidates");
const supplementRoot = join(batchRoot, "refinement", "sources");

const rejectedRelationIds = new Set([
	"REL-AI-002",
	"REL-AI-004",
	"REL-AI-005",
	"REL-TECH-004",
	"REL-TECH-006",
	"REL-FIN-004",
	"REL-FIN-005",
	"REL-AI-006",
	"REL-TECH-007",
]);

const repairFactIds = new Set([
	"FACT-AI-001",
	"FACT-AI-004",
	"FACT-AI-008",
	"FACT-AI-012",
	"FACT-AI-015",
	"FACT-AI-018",
	"FACT-TECH-001",
	"FACT-TECH-003",
	"FACT-TECH-006",
	"FACT-TECH-017",
	"FACT-TECH-018",
	"FACT-TECH-019",
	"FACT-TECH-020",
	"FACT-FIN-015",
	"FACT-FIN-017",
	"FACT-FIN-020",
]);

const taskRepairIds = new Set([
	"X-AI-001",
	"K-AI-001",
	"E-AI-001",
	"E-AI-002",
	"U-AI-001",
	"U-AI-002",
	"R-TECH-003",
	"C-TECH-001",
	"C-TECH-002",
	"E-TECH-002",
	"U-TECH-001",
	"F-FIN-003",
	"E-FIN-001",
	"E-FIN-002",
	"U-FIN-001",
	"U-FIN-002",
	"A-FIN-001",
]);

const canaryIds = [
	"F-AI-001",
	"F-AI-003",
	"R-AI-001",
	"C-AI-002",
	"F-TECH-004",
	"X-TECH-001",
	"K-TECH-002",
	"T-TECH-002",
	"F-FIN-001",
	"R-FIN-001",
	"C-FIN-001",
	"X-FIN-001",
];

rmSync(outputRoot, { recursive: true, force: true });
mkdirSync(join(outputRoot, "corpus"), { recursive: true });
mkdirSync(join(outputRoot, "data"), { recursive: true });
mkdirSync(join(outputRoot, "audit"), { recursive: true });

const originalManifest = readJsonl(join(batchRoot, "manifests", "source-manifest.jsonl"));
const sourcePaths = new Map<string, string>();
const manifest: JsonRecord[] = [];

for (const entry of originalManifest) {
	const sourceId = requireString(entry, "sourceId");
	const sourcePath = resolve(batchRoot, requireString(entry, "contentPath"));
	const destination = join(outputRoot, "corpus", basename(sourcePath));
	cpSync(sourcePath, destination);
	sourcePaths.set(sourceId, destination);
	manifest.push(buildManifestEntry(entry, destination));
}

for (const filename of ["ai-mcp-spec-2025-03-26-013.md", "tech-redis-licenses-014.md"]) {
	const sourcePath = join(supplementRoot, filename);
	const destination = join(outputRoot, "corpus", filename);
	cpSync(sourcePath, destination);
	const metadata = parseFrontmatter(readFileSync(sourcePath, "utf8"));
	const sourceId = requireString(metadata, "sourceId");
	sourcePaths.set(sourceId, destination);
	manifest.push(buildManifestEntry(metadata, destination));
}

const snapshots = new Map(
	[...sourcePaths].map(([sourceId, path]) => [
		sourceId,
		extractSnapshot(readFileSync(path, "utf8")),
	]),
);

const candidateFacts = readJsonl(join(candidateRoot, "facts.jsonl"));
const risks = candidateFacts
	.filter((fact) => requireString(fact, "candidateId").startsWith("RISK-"))
	.map(refineRisk);
const facts = candidateFacts
	.filter((fact) => requireString(fact, "candidateId").startsWith("FACT-"))
	.map(refineFact);

const candidateRelations = readJsonl(join(candidateRoot, "relations.jsonl"));
const relationsRejected = candidateRelations
	.filter((relation) => rejectedRelationIds.has(requireString(relation, "candidateId")))
	.map((relation) => ({
		...relation,
		status: "rejected",
		auditDecision: "reject",
		auditReason: rejectedRelationReason(requireString(relation, "candidateId")),
	}));
const relations = candidateRelations
	.filter((relation) => !rejectedRelationIds.has(requireString(relation, "candidateId")))
	.map(refineRelation);

const tasks = readJsonl(join(candidateRoot, "tasks.jsonl")).map(refineTask);
const episodes = readJsonl(join(candidateRoot, "evolution-episodes.jsonl")).map(refineEpisode);

writeJsonl(join(outputRoot, "source-manifest.jsonl"), manifest);
writeJsonl(join(outputRoot, "data", "facts-reviewed.jsonl"), facts);
writeJsonl(join(outputRoot, "data", "adversarial-risks.jsonl"), risks);
writeJsonl(join(outputRoot, "data", "relations-reviewed.jsonl"), relations);
writeJsonl(join(outputRoot, "data", "relations-rejected.jsonl"), relationsRejected);
writeJsonl(join(outputRoot, "data", "tasks-reviewed.jsonl"), tasks);
writeJsonl(join(outputRoot, "data", "evolution-episodes-reviewed.jsonl"), episodes);

const canaryCases = canaryIds.map((caseId) => {
	const task = tasks.find((item) => item.caseId === caseId);
	if (!task) throw new Error(`Canary task missing: ${caseId}`);
	return {
		caseId,
		domain: task.domain,
		questionType: task.questionType,
		evidenceCount: Array.isArray(task.requiredEvidence) ? task.requiredEvidence.length : 0,
	};
});
writeJson(join(outputRoot, "audit", "canary.json"), {
	schemaVersion: "wge-provisional-canary/v2",
	status: "provisional-reviewed-not-human-gold",
	refinementVersion: "batch-a-gold-refinement/v1",
	purpose:
		"Only validates loading, evidence resolution, immutable input identity, and run contract.",
	prohibitions: [
		"Do not optimize architecture or prompts against aggregate canary score.",
		"Do not describe this model-reviewed canary as human Gold.",
	],
	cases: canaryCases,
});

writeJson(join(outputRoot, "audit", "refinement-summary.json"), {
	schemaVersion: "wge-batch-refinement-summary/v1",
	input: relative(projectRoot, batchRoot),
	output: relative(projectRoot, outputRoot),
	counts: {
		sources: manifest.length,
		factsReviewed: facts.length,
		factsRepaired: facts.filter((item) => item.auditDecision === "repair-evidence-or-scope").length,
		adversarialRisks: risks.length,
		relationsReviewed: relations.length,
		relationsRejected: relationsRejected.length,
		tasksReviewed: tasks.length,
		tasksRepaired: tasks.filter((item) => item.auditDecision === "repaired").length,
		evolutionEpisodes: episodes.length,
		canaryCases: canaryCases.length,
	},
	statusBoundary: "Model-reviewed provisional data; not human Gold and not blind holdout.",
});

console.log(`Refined Batch A written to ${relative(projectRoot, outputRoot)}`);
console.log(
	JSON.stringify(
		{
			sources: manifest.length,
			facts: facts.length,
			risks: risks.length,
			relations: relations.length,
			rejectedRelations: relationsRejected.length,
			tasks: tasks.length,
			episodes: episodes.length,
			canary: canaryCases.length,
		},
		null,
		2,
	),
);

function refineFact(input: JsonRecord): JsonRecord {
	const fact = { ...input };
	const id = requireString(fact, "candidateId");
	fact.status = "reviewed-provisional";
	fact.auditDecision = repairFactIds.has(id) ? "repair-evidence-or-scope" : "initial-pass";

	const replacements: Record<string, Partial<JsonRecord>> = {
		"FACT-AI-001": {
			exactQuote: span(
				"ai-mcp-spec-2024-11-05-001",
				"MCP currently defines two standard transport mechanisms",
				"2. [HTTP with Server-Sent Events](#http-with-sse) (SSE)",
			),
		},
		"FACT-AI-004": {
			exactQuote: span(
				"ai-mcp-spec-2024-11-05-001",
				"The server **MUST** provide two endpoints:",
				"server",
				3,
			),
		},
		"FACT-AI-008": {
			exactQuote: span(
				"ai-mcp-pr206-002",
				"Created: 2025-03-17T09:38:57Z",
				"Merged: 2025-03-24T11:51:34Z",
			),
		},
		"FACT-AI-012": {
			claim: "该二手材料称 MCP 于 2024 年 11 月发布，并在发布初期获得了相当积极的反响。",
			exactQuote: span("ai-mcp-latent-003", "launched in November 2024", "decently well received"),
		},
		"FACT-AI-015": {
			exactQuote: span("ai-mcp-latent-003", "AI Native", "Building Effective Agents"),
		},
		"FACT-AI-018": { exactQuote: line("ai-mcp-hn-004", "pretending to be champions") },
		"FACT-TECH-001": {
			exactQuote: span(
				"tech-redis-blog-2024-001",
				"Beginning today, all future versions",
				"three-clause Berkeley Software Distribution (BSD).",
			),
		},
		"FACT-TECH-003": {
			exactQuote: line(
				"tech-redis-blog-2024-001",
				"Under the new license, cloud service providers",
			),
		},
		"FACT-TECH-006": {
			claim: "Redis 官方宣布从 Redis 8 起把 OSI 批准的 AGPL 增加为一个许可选项。",
		},
		"FACT-TECH-017": { exactQuote: line("tech-redis-hn-004", "hundreds of engineering hours") },
		"FACT-TECH-018": { exactQuote: line("tech-redis-hn-004", "You get two wins") },
		"FACT-TECH-019": { exactQuote: line("tech-redis-hn-004", "celebrate this anyway") },
		"FACT-TECH-020": { exactQuote: line("tech-redis-hn-004", "many organizations prohibit") },
		"FACT-FIN-015": {
			claim: "21财经把 H20 描述为基于 Hopper、为中国市场特制的‘阉割版’芯片。",
			statementKind: "reported-characterization",
		},
		"FACT-FIN-017": { exactQuote: line("fin-nvda-hn-004", "never about the trade war") },
		"FACT-FIN-020": { exactQuote: line("fin-nvda-hn-004", "never about the trade war") },
	};
	return { ...fact, ...(replacements[id] ?? {}) };
}

function refineRisk(input: JsonRecord): JsonRecord {
	return {
		riskId: input.candidateId,
		status: "reviewed-adversarial-annotation",
		sourceId: input.sourceId,
		sourceFact: input.exactQuote,
		locator: input.locator,
		failurePattern: input.claim,
		requiredConditions: input.conditions,
		uncertainties: input.uncertainties,
		auditDecision: "reclassified-not-knowledge-fact",
		compilerPolicy: "exclude-from-knowledge-ingest",
	};
}

function refineRelation(input: JsonRecord): JsonRecord {
	const relation = { ...input };
	const id = requireString(relation, "candidateId");
	relation.status = "reviewed-provisional";
	relation.auditDecision = ["REL-AI-001", "REL-FIN-001", "REL-FIN-003"].includes(id)
		? "repaired"
		: "initial-pass";
	relation.relationAuditVersion = "batch-a-relation-audit/v1";

	if (id === "REL-AI-001") {
		relation.from = "ai-mcp-spec-2025-03-26-013";
		relation.directionReason =
			"2025-03-26 正式规范明确以 Streamable HTTP 取代 2024-11-05 的 HTTP+SSE；stdio 保留。";
		relation.evidence = [
			{
				sourceId: "ai-mcp-spec-2025-03-26-013",
				exactQuote: "This replaces the HTTP+SSE transport from protocol version 2024-11-05.",
				locator: "Source Snapshot > Streamable HTTP",
			},
			{
				sourceId: "ai-mcp-spec-2024-11-05-001",
				exactQuote: "The server **MUST** provide two endpoints:",
				locator: "Source Snapshot > HTTP with SSE",
			},
		];
		relation.uncertainties = [];
	}
	if (id === "REL-FIN-001") {
		relation.type = "SUPERSEDES";
		relation.directionReason = "Q1 实际计提 45 亿美元更新并取代此前约 55 亿美元的预告口径。";
	}
	if (id === "REL-FIN-003") {
		relation.to = "FACT-FIN-002";
		relation.type = "REPORTS_EXPERIENCE";
		relation.directionReason =
			"HN 评论是对 H20 出口许可事件的低样本社区反应，不是对二手媒体 Fact 的经验。";
	}
	return relation;
}

function refineTask(input: JsonRecord): JsonRecord {
	const task = { ...input };
	const id = requireString(task, "caseId");
	task.status = "reviewed-provisional";
	task.auditDecision = taskRepairIds.has(id) ? "repaired" : "initial-pass";
	task.splitSuggestion = undefined;

	const replacements: Record<string, Partial<JsonRecord>> = {
		"X-AI-001": {
			question:
				"综合 2024-11-05 与 2025-03-26 两版正式规范：标准 transport 如何变化，旧 /sse 双端点要求是否仍是当前要求？",
			requiredPoints: [
				"两版均保留 stdio",
				"2025-03-26 以 Streamable HTTP 取代 HTTP+SSE",
				"新规范要求支持 POST/GET 的单一 MCP endpoint；SSE 变为可选服务器流",
			],
			requiredEvidence: [
				evidence("ai-mcp-spec-2024-11-05-001", "The server **MUST** provide two endpoints:", "old"),
				evidence(
					"ai-mcp-spec-2025-03-26-013",
					"This replaces the HTTP+SSE transport from protocol version 2024-11-05.",
					"new",
				),
				evidence(
					"ai-mcp-spec-2025-03-26-013",
					"The server **MUST** provide a single HTTP endpoint path (hereafter referred to as the **MCP endpoint**) that supports both POST and GET methods. For example, this could be a URL like `https://example.com/mcp`.",
					"new",
				),
			],
		},
		"K-AI-001": {
			question:
				"材料能否证明 melvinmelih 的条件预言被证伪？请区分‘OpenAI 支持 MCP’与‘OpenAI 是否也支持其他标准’。",
			requiredPoints: [
				"材料只显示 OpenAI 宣布支持 MCP",
				"这不能证明 OpenAI 没有支持其他标准，也不能令条件句前提为假",
				"因此不能据现有材料判定该条件预言被证伪",
			],
			acceptableVariants: ["证据不足以裁决该条件预言"],
			forbiddenClaims: ["不得把支持 MCP 等同于不支持任何其他标准"],
		},
		"E-AI-001": {
			requiredEvidence: [
				evidence("ai-mcp-spec-2024-11-05-001", "The server **MUST** provide two endpoints:", "old"),
				evidence(
					"ai-mcp-spec-2025-03-26-013",
					"This replaces the HTTP+SSE transport from protocol version 2024-11-05.",
					"new",
				),
			],
		},
		"E-AI-002": {
			question: "按 PR #206 的设计说明，Streamable HTTP 试图解决旧 HTTP+SSE 的哪些缺陷？",
			timeScope: "proposal-as-of:2025-03-17",
		},
		"U-AI-001": {
			answerability: "partial",
			forbiddenClaims: ["不得把有限材料扩展为完整采用决策或社区成熟度结论"],
		},
		"U-AI-002": {
			answerability: "partial",
			question:
				"基于已冻结规范与 PR，列出可以确认的 MCP transport 迁移点，并明确未覆盖的 SDK 细节。",
		},
		"R-TECH-003": {
			question:
				"哪两份材料记录 antirez 重新加入 Redis 并参与 AGPL 讨论？这些材料能否证明许可证变更由他单独推动？",
			requiredPoints: [
				"官方博客与 antirez 博文都记录其回归",
				"antirez 发现讨论早已进行，不能把变更归功于他一人",
			],
			forbiddenClaims: ["不得说 antirez 单独推动或决定许可变更"],
		},
		"C-TECH-001": {
			question: "按 Redis 官方许可概览，RSALv2 是否禁止组织把 Redis 用于纯内部用途？",
			requiredPoints: [
				"概览列出的限制针对向第三方提供特定类别的托管服务",
				"不能扩展成所有内部使用都受禁",
			],
			requiredEvidence: [
				evidence(
					"tech-redis-licenses-014",
					"Under RSALv2, you can use, modify, and redistribute the software, including for commercial purposes. You may not use Redis Open Source to offer a database product, caching engine, stream processing engine, search engine, indexing engine, or ML/DL/AI serving engine that is offered as a managed service by a third party.",
					"supports",
				),
			],
		},
		"C-TECH-002": {
			question: "按 Redis 官方许可概览，Redis 8+ 与其中包含的模块采用什么许可组合？",
			requiredPoints: [
				"Redis 8+ 为 RSALv2、SSPLv1、AGPLv3 三许可",
				"Redis Open Source 所含模块采用相同三许可",
			],
			requiredEvidence: [
				evidence(
					"tech-redis-licenses-014",
					"Redis 8 and later are available under a tri-license that includes RSALv2, SSPLv1, and AGPLv3. Redis 7.4 through 7.8 are available under the dual RSALv2 and SSPLv1 licenses. Redis 7.2 and earlier are available under the BSD 3-Clause License.",
					"supports",
				),
				evidence(
					"tech-redis-licenses-014",
					"Modules included in Redis Open Source are available under the same tri-license as Redis Open Source.",
					"supports",
				),
			],
			answerability: "answerable",
		},
		"E-TECH-002": {
			answerability: "partial",
			question:
				"现有官方概览能确认 Redis 8 的许可组合发生了什么变化？哪些网络使用义务仍必须回到许可证全文判断？",
			forbiddenClaims: ["不得把概览当作完整法律意见", "不得由材料外推全部 AGPL 网络义务"],
		},
		"U-TECH-001": {
			answerability: "partial",
			question:
				"基于官方概览制作 Redis 7.4–7.8 与 Redis 8+ 的 SaaS 许可风险初筛；明确哪些结论必须交由许可证全文和法律顾问确认。",
			forbiddenClaims: ["不得输出确定性法律意见", "不得把 HN 评论当许可义务"],
		},
		"F-FIN-003": {
			question:
				"判断：“NVIDIA 在 2026 财年第二季度对 China-based customers 没有 H20 销售，但有约 6.5 亿美元无限制 H20 销售给中国以外的一名客户。”",
			requiredPoints: ["对 China-based customers 销售为 0", "约 6.5 亿美元来自中国以外的一名客户"],
			acceptableVariants: ["可忠实译作‘中国客户’，不可擅自缩成‘中国大陆客户’"],
		},
		"E-FIN-001": {
			question:
				"NVIDIA 的 H20 披露从 FY2026 Q1 到 Q2 如何变化？回答时保留 China-based customers 与中国以外单一客户的主体范围。",
			requiredPoints: [
				"Q1 有 45 亿美元费用与管制前 46 亿美元 H20 销售",
				"Q2 对 China-based customers 没有 H20 销售",
				"Q2 约 6.5 亿美元无限制 H20 销售来自中国以外的一名客户，不能表述为全部海外销售仅此金额",
			],
		},
		"E-FIN-002": {
			answerability: "partial",
			question:
				"基于 Q1→Q2 已披露数据，哪些 H20 地域与口径信息应继续拆分，哪些未来披露要求不能由材料推出？",
		},
		"U-FIN-001": {
			answerability: "partial",
			question: "制作一份只基于已披露 Q1/Q2 数据的 NVIDIA H20 风险摘要；不得把摘要升级为投资建议。",
		},
		"U-FIN-002": {
			answerability: "partial",
			question:
				"只根据已冻结的 21财经短片段，列出可直接提出的 H20 未决问题，并列明片段没有覆盖的 CloudMatrix/长鑫量化证据。",
		},
		"A-FIN-001": {
			answerability: "partial",
			requiredPoints: [
				"Q3 总营收指引为 540 亿美元±2%",
				"该 outlook 未假设对华 H20 出货",
				"没有单列 Q3 H20 销售额，不能编造数字",
			],
		},
	};
	return { ...task, ...(replacements[id] ?? {}) };
}

function refineEpisode(input: JsonRecord): JsonRecord {
	const episode: JsonRecord = {
		...input,
		status: "reviewed-provisional",
		auditDecision: "repaired",
	};
	const id = requireString(episode, "episodeId");
	if (id === "EV-AI-001") {
		episode.t1Sources = ["ai-mcp-pr206-002", "ai-mcp-spec-2025-03-26-013"];
		episode.uncertainties = ["PR 描述设计动机；正式版本事实以 2025-03-26 规范为准。"];
		episode.chronologyEvidence = [
			evidence("ai-mcp-spec-2024-11-05-001", "The server **MUST** provide two endpoints:", "old"),
			{
				...evidence(
					"ai-mcp-spec-2025-03-26-013",
					"This replaces the HTTP+SSE transport from protocol version 2024-11-05.",
					"new",
				),
				publishedAt: "2025-03-26T00:00:00Z",
			},
		];
	}
	if (id === "EV-TECH-001") {
		episode.t1Sources = [
			"tech-redis-blog-2025-002",
			"tech-redis-antirez-003",
			"tech-redis-licenses-014",
		];
		episode.oldClaimsThatMustChange = [
			"不得把 Redis 8+ 描述为仍只有 RSALv2 / SSPLv1 双许可",
			"不得把官方‘社区反应’叙事当成社区总体测量",
		];
		episode.claimsThatMustRemain = [
			"Redis 8+ 可在 RSALv2、SSPLv1、AGPLv3 三者中选择",
			"Redis 7.4–7.8 仍属于 RSALv2 / SSPLv1 双许可版本范围",
			"社区迁移经验不因后续许可变化而消失",
		];
		episode.uncertainties = ["具体使用义务必须查对应许可证全文，本数据不构成法律意见。"];
	}
	if (id === "EV-FIN-001") {
		episode.oldClaimsThatMustChange = [
			"不得继续声称 FY2026 Q2 对 China-based customers 正常销售 H20",
			"不得把 Q2 的一笔约 6.5 亿美元中国以外客户销售描述为全部海外销售上限",
		];
		episode.claimsThatMustRemain = [
			"Q1 有 46 亿美元管制前 H20 销售与 45 亿美元相关费用",
			"出口许可要求是官方披露的变化原因",
			"Q2 有约 6.5 亿美元无限制 H20 销售给中国以外的一名客户",
		];
		episode.postQuestions = [
			"Q2 对 China-based customers 的 H20 销售是多少？",
			"如何避免把一名中国以外客户的销售额误写成全部海外销售额？",
		];
		episode.forbiddenAfterT1 = [
			"不得把 China-based customers 擅自缩成中国大陆客户",
			"不得写成 Q2 全部 H20 销售为零",
		];
	}
	return episode;
}

function buildManifestEntry(input: JsonRecord, artifactPath: string): JsonRecord {
	const content = normalizeNewlines(readFileSync(artifactPath, "utf8"));
	const snapshot = extractSnapshot(content);
	return {
		...input,
		upstreamCaptureHash: input.contentHash ?? null,
		contentHash: undefined,
		hashVersion: "wge-source-hash/v1",
		hashInput: {
			algorithm: "sha256",
			encoding: "utf8",
			newline: "LF",
			snapshotBoundary:
				"content after '## Source Snapshot' and before '## Research Notes', trim + final LF",
			artifactBoundary: "entire Markdown artifact with LF newlines",
		},
		snapshotHash: sha256(snapshot),
		artifactHash: sha256(content),
		contentPath: `corpus/${basename(artifactPath)}`,
		refinementStatus: "immutable-evidence-snapshot",
	};
}

function rejectedRelationReason(id: string): string {
	const reasons: Record<string, string> = {
		"REL-AI-002": "支持 MCP 不能推出没有支持其他标准，条件预言未被证伪。",
		"REL-AI-004": "同源自支持且证据不足以覆盖完整时间线。",
		"REL-AI-005": "阅读背景不是知识语义上的 REQUIRES。",
		"REL-TECH-004": "组织采用限制不构成对开源许可事实的 NARROWS，端点错位。",
		"REL-TECH-006": "失去信任与仍值得庆祝可以同时成立，不构成事实冲突。",
		"REL-FIN-004": "指引损失与地域销售口径不同，不能互相收窄。",
		"REL-FIN-005": "营收增长不能反驳估值泡沫观点。",
		"REL-AI-006": "评论者参与项目不能 IMPLEMENTS 一份规范。",
		"REL-TECH-007": "商业动机与社区修复动机可以并存，不构成 CONTRADICTS。",
	};
	return reasons[id] ?? "Relation failed semantic audit.";
}

function span(sourceId: string, start: string, end: string, endOccurrence = 1): string {
	const snapshot = requireSnapshot(sourceId);
	const startIndex = snapshot.indexOf(start);
	if (startIndex < 0) throw new Error(`Start marker missing in ${sourceId}: ${start}`);
	let endIndex = -1;
	let searchFrom = startIndex;
	for (let occurrence = 0; occurrence < endOccurrence; occurrence += 1) {
		endIndex = snapshot.indexOf(end, searchFrom);
		if (endIndex < 0) throw new Error(`End marker missing in ${sourceId}: ${end}`);
		searchFrom = endIndex + end.length;
	}
	return snapshot.slice(startIndex, endIndex + end.length);
}

function line(sourceId: string, marker: string): string {
	const snapshot = requireSnapshot(sourceId);
	const index = snapshot.indexOf(marker);
	if (index < 0) throw new Error(`Line marker missing in ${sourceId}: ${marker}`);
	const start = snapshot.lastIndexOf("\n", index) + 1;
	const end = snapshot.indexOf("\n", index);
	return snapshot.slice(start, end < 0 ? snapshot.length : end);
}

function evidence(sourceId: string, exactQuote: string, role: string): JsonRecord {
	return { sourceId, exactQuote, locator: "Source Snapshot", role };
}

function requireSnapshot(sourceId: string): string {
	const snapshot = snapshots.get(sourceId);
	if (!snapshot) throw new Error(`Unknown source: ${sourceId}`);
	return snapshot;
}

function extractSnapshot(content: string): string {
	const normalized = normalizeNewlines(content);
	const marker = "## Source Snapshot";
	const start = normalized.indexOf(marker);
	if (start < 0) throw new Error("Missing Source Snapshot heading");
	const bodyStart = normalized.indexOf("\n", start + marker.length) + 1;
	const end = normalized.indexOf("## Research Notes", bodyStart);
	if (bodyStart === 0 || end < 0) throw new Error("Invalid Source Snapshot boundaries");
	return `${normalized.slice(bodyStart, end).trim()}\n`;
}

function normalizeNewlines(value: string): string {
	return value.replace(/\r\n?/g, "\n");
}

function sha256(value: string): string {
	return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function parseFrontmatter(content: string): JsonRecord {
	const normalized = normalizeNewlines(content);
	const match = /^---\n([\s\S]*?)\n---/.exec(normalized);
	if (!match) throw new Error("Missing frontmatter");
	const result: JsonRecord = {};
	for (const lineValue of match[1].split("\n")) {
		const separator = lineValue.indexOf(":");
		if (separator < 0) continue;
		const key = lineValue.slice(0, separator).trim();
		let value: unknown = lineValue.slice(separator + 1).trim();
		if (value === "null") value = null;
		else if (typeof value === "string" && value.startsWith('"') && value.endsWith('"')) {
			value = JSON.parse(value);
		}
		result[key] = value;
	}
	return result;
}

function readJsonl(path: string): JsonRecord[] {
	return readFileSync(path, "utf8")
		.split("\n")
		.filter((lineValue) => lineValue.trim().length > 0)
		.map((lineValue) => JSON.parse(lineValue) as JsonRecord);
}

function writeJsonl(path: string, values: JsonRecord[]): void {
	writeFileSync(path, `${values.map((value) => JSON.stringify(value)).join("\n")}\n`, "utf8");
}

function writeJson(path: string, value: unknown): void {
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function requireString(record: JsonRecord, key: string): string {
	const value = record[key];
	if (typeof value !== "string" || value.length === 0)
		throw new Error(`Missing string field: ${key}`);
	return value;
}
