import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const timelines = ["T0", "T1", "T2", "T3"] as const;
const domains = ["platform-engineering", "commerce-operations", "research-operations"] as const;
const timelineRank = new Map(timelines.map((timeline, index) => [timeline, index]));

const documentSchema = z.object({
	documentId: z.string().min(1),
	path: z.string().min(1),
	domain: z.enum(domains),
	timeline: z.enum(timelines),
	issuedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	effectiveAt: z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}$/)
		.nullable(),
	authority: z.string().min(2),
	scope: z.string().min(2),
	changeKind: z.enum(["BASELINE", "ADDITION", "SUPERSESSION", "UNRESOLVED_CONFLICT"]),
	targetDocumentIds: z.array(z.string()),
});

const manifestSchema = z.object({
	schemaVersion: z.literal("wge-evolution-manifest/v1"),
	datasetId: z.string().min(1),
	datasetClass: z.literal("SYNTHETIC_SILVER"),
	purpose: z.string().min(10),
	documents: z.array(documentSchema).length(24),
});

const goldSchema = z.object({
	answerability: z.enum(["ANSWERABLE", "INSUFFICIENT", "DISPUTED"]),
	expectedAnswer: z.string().min(2),
	requiredFacts: z.array(z.string()),
	requiredConditions: z.array(z.string()),
	forbiddenFacts: z.array(z.string()),
	sourceDocumentIds: z.array(z.string()),
});

const questionSchema = z.object({
	id: z.string().regex(/^EV-(PLAT|COMM|RES)-\d{3}$/),
	domain: z.enum(domains),
	category: z.enum(["affected", "unaffected", "synthesis", "dispute", "insufficient"]),
	question: z.string().min(5),
	goldByTimeline: z.object({ T0: goldSchema, T1: goldSchema, T2: goldSchema, T3: goldSchema }),
});

const questionsSchema = z.object({
	schemaVersion: z.literal("wge-evolution-questions/v1"),
	datasetId: z.string().min(1),
	questions: z.array(questionSchema).length(36),
});

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultDatasetRoot = resolve(scriptDirectory, "../experiments/evolution/dataset-v1");
const datasetRoot = resolve(process.argv[2] ?? defaultDatasetRoot);
const manifest = manifestSchema.parse(readJson(join(datasetRoot, "manifest.json")));
const questions = questionsSchema.parse(readJson(join(datasetRoot, "questions.json")));
const errors: string[] = [];

if (manifest.datasetId !== questions.datasetId) errors.push("manifest/questions datasetId 不一致");
assertUnique(
	manifest.documents.map((item) => item.documentId),
	"documentId",
	errors,
);
assertUnique(
	manifest.documents.map((item) => item.path),
	"document path",
	errors,
);
assertUnique(
	questions.questions.map((item) => item.id),
	"question id",
	errors,
);

const documentById = new Map(manifest.documents.map((item) => [item.documentId, item]));
let corpusCharacters = 0;
for (const document of manifest.documents) {
	const path = resolveDatasetPath(datasetRoot, document.path, errors);
	if (!path || !existsSync(path)) {
		errors.push(`文档不存在: ${document.documentId} -> ${document.path}`);
		continue;
	}
	if (!document.path.endsWith(".md")) errors.push(`文档不是 Markdown: ${document.path}`);
	if (!document.path.includes(`/${document.timeline.toLowerCase()}/`)) {
		errors.push(`文档路径与 timeline 不一致: ${document.documentId}`);
	}
	const content = readFileSync(path, "utf-8");
	corpusCharacters += [...content].length;
	if ([...content].length < 450 || [...content].length > 5000) {
		errors.push(`文档长度越界(450..5000): ${document.documentId}=${[...content].length}`);
	}
	if (!content.startsWith("# ")) errors.push(`文档缺少一级标题: ${document.documentId}`);
	if (/\b(SUPERSEDES|CONTRADICTS|goldByTimeline|benchmark)\b/i.test(content)) {
		errors.push(`文档泄漏系统/评测词: ${document.documentId}`);
	}
	const expectedKind = {
		T0: "BASELINE",
		T1: "ADDITION",
		T2: "SUPERSESSION",
		T3: "UNRESOLVED_CONFLICT",
	}[document.timeline];
	if (document.changeKind !== expectedKind) {
		errors.push(`timeline/changeKind 不一致: ${document.documentId}`);
	}
	if (document.timeline === "T2" && document.targetDocumentIds.length === 0) {
		errors.push(`T2 缺少 targetDocumentIds: ${document.documentId}`);
	}
	if (document.timeline === "T3" && document.effectiveAt !== null) {
		errors.push(`未决 T3 不应有 effectiveAt: ${document.documentId}`);
	}
}
if (corpusCharacters < 12000) errors.push(`语料总长度不足 12000: ${corpusCharacters}`);

for (const document of manifest.documents) {
	for (const targetId of document.targetDocumentIds) {
		const target = documentById.get(targetId);
		if (!target) errors.push(`替代目标不存在: ${document.documentId} -> ${targetId}`);
		else if (target.domain !== document.domain) {
			errors.push(`变更目标必须同域: ${document.documentId} -> ${targetId}`);
		} else if (document.timeline === "T2" && target.timeline !== "T0") {
			errors.push(`T2 替代目标必须是同域 T0: ${document.documentId} -> ${targetId}`);
		} else if (
			(timelineRank.get(target.timeline) ?? 99) >= (timelineRank.get(document.timeline) ?? -1)
		) {
			errors.push(`变更目标必须来自更早时间线: ${document.documentId} -> ${targetId}`);
		}
	}
}

const expectedTimelineCounts = { T0: 3, T1: 2, T2: 2, T3: 1 } as const;
const expectedCategoryCounts = {
	affected: 4,
	unaffected: 3,
	synthesis: 2,
	dispute: 1,
	insufficient: 2,
} as const;
for (const domain of domains) {
	const domainDocuments = manifest.documents.filter((item) => item.domain === domain);
	for (const timeline of timelines) {
		const actual = domainDocuments.filter((item) => item.timeline === timeline).length;
		if (actual !== expectedTimelineCounts[timeline]) {
			errors.push(
				`${domain}/${timeline} 文档数量 ${actual} != ${expectedTimelineCounts[timeline]}`,
			);
		}
	}
	const domainQuestions = questions.questions.filter((item) => item.domain === domain);
	if (domainQuestions.length !== 12)
		errors.push(`${domain} 问题数量 ${domainQuestions.length} != 12`);
	for (const [category, expected] of Object.entries(expectedCategoryCounts)) {
		const actual = domainQuestions.filter((item) => item.category === category).length;
		if (actual !== expected) errors.push(`${domain}/${category} 问题数量 ${actual} != ${expected}`);
	}
}

for (const question of questions.questions) {
	for (const timeline of timelines) {
		const gold = question.goldByTimeline[timeline];
		for (const documentId of gold.sourceDocumentIds) {
			const source = documentById.get(documentId);
			if (!source) {
				errors.push(`${question.id}/${timeline} 引用不存在文档: ${documentId}`);
				continue;
			}
			if (source.domain !== question.domain) {
				errors.push(`${question.id}/${timeline} 跨域 Gold 引用: ${documentId}`);
			}
			if ((timelineRank.get(source.timeline) ?? 99) > (timelineRank.get(timeline) ?? -1)) {
				errors.push(`${question.id}/${timeline} 引用了未来文档: ${documentId}`);
			}
		}
		if (gold.answerability !== "INSUFFICIENT" && gold.sourceDocumentIds.length === 0) {
			errors.push(`${question.id}/${timeline} 可回答或争议 Gold 缺少来源`);
		}
	}
	if (
		question.category === "affected" &&
		question.goldByTimeline.T1.expectedAnswer === question.goldByTimeline.T2.expectedAnswer
	) {
		errors.push(`${question.id} affected 题在 T2 没有答案变化`);
	}
	if (question.category === "dispute") {
		if (question.goldByTimeline.T3.answerability !== "DISPUTED") {
			errors.push(`${question.id} dispute 题在 T3 不是 DISPUTED`);
		}
		if (
			timelines
				.slice(0, 3)
				.some((timeline) => question.goldByTimeline[timeline].answerability === "DISPUTED")
		) {
			errors.push(`${question.id} 在 T3 前提前出现 DISPUTED`);
		}
	}
	if (
		question.category === "insufficient" &&
		timelines.some((timeline) => question.goldByTimeline[timeline].answerability !== "INSUFFICIENT")
	) {
		errors.push(`${question.id} insufficient 题并非全时间线证据不足`);
	}
	if (
		question.category === "synthesis" &&
		!timelines.some((timeline) => question.goldByTimeline[timeline].sourceDocumentIds.length >= 2)
	) {
		errors.push(`${question.id} synthesis 题没有任何多来源 Gold`);
	}
}

if (errors.length > 0) {
	console.error(`Evolution dataset validation failed (${errors.length})`);
	for (const error of errors) console.error(`- ${error}`);
	process.exitCode = 1;
} else {
	console.log(
		JSON.stringify(
			{
				datasetId: manifest.datasetId,
				datasetClass: manifest.datasetClass,
				domains: domains.length,
				documents: manifest.documents.length,
				questions: questions.questions.length,
				goldStates: questions.questions.length * timelines.length,
				corpusCharacters,
				status: "PASS",
			},
			null,
			2,
		),
	);
}

function readJson(path: string): unknown {
	if (!existsSync(path)) throw new Error(`找不到数据文件: ${path}`);
	return JSON.parse(readFileSync(path, "utf-8")) as unknown;
}

function resolveDatasetPath(root: string, relativePath: string, errors: string[]): string | null {
	const normalized = normalize(relativePath);
	const absolute = resolve(root, normalized);
	const rootPrefix = `${resolve(root)}${sep}`;
	if (!absolute.startsWith(rootPrefix) || relative(root, absolute).startsWith("..")) {
		errors.push(`数据路径越界: ${relativePath}`);
		return null;
	}
	return absolute;
}

function assertUnique(values: string[], label: string, errors: string[]): void {
	const seen = new Set<string>();
	for (const value of values) {
		if (seen.has(value)) errors.push(`${label} 重复: ${value}`);
		seen.add(value);
	}
}
