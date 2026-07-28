import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "js-yaml";

type JsonRecord = Record<string, unknown>;

interface FactSeed {
	id: string;
	sourceId: string;
	claim: string;
	start: string;
	end?: string;
	statementKind?: string;
	conditions?: string[];
	timeScope?: string | null;
}

interface TaskSeed {
	id: string;
	domain: string;
	type: string;
	question: string;
	facts: string[];
	requiredPoints: string[];
	forbiddenClaims: string[];
	answerability?: "answerable" | "partial" | "insufficient";
	diagnosticOwner?: string;
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const batchRoot = resolve(process.argv[2] ?? join(projectRoot, "workbuddy-batch-b"));
const corpusRoot = join(batchRoot, "corpus");
const outputRoot = join(batchRoot, "generated");

rmSync(outputRoot, { recursive: true, force: true });
mkdirSync(join(outputRoot, "candidates"), { recursive: true });
mkdirSync(join(outputRoot, "compilation-corpus"), { recursive: true });
mkdirSync(join(outputRoot, "reports"), { recursive: true });

const sourceFiles = listMarkdown(corpusRoot);
const sources = new Map<
	string,
	{ metadata: JsonRecord; snapshot: string; content: string; path: string }
>();
const manifest = sourceFiles.map((path) => {
	const content = normalizeNewlines(readFileSync(path, "utf8"));
	const metadata = parseFrontmatter(content);
	const sourceId = requireString(metadata, "sourceId");
	const snapshot = extractSnapshot(content);
	if (sources.has(sourceId)) throw new Error(`Duplicate sourceId: ${sourceId}`);
	sources.set(sourceId, { metadata, snapshot, content, path });
	const domain = requireString(metadata, "domain");
	const title = requireString(metadata, "title");
	const compilationPath = join("generated", "compilation-corpus", domain, `${sourceId}.md`);
	const compilationArtifact = `# ${title}\n\n${snapshot}`;
	mkdirSync(dirname(join(batchRoot, compilationPath)), { recursive: true });
	writeFileSync(join(batchRoot, compilationPath), compilationArtifact, "utf8");
	return {
		...metadata,
		domain,
		title,
		hashVersion: "wge-source-hash/v1",
		hashInput: {
			algorithm: "sha256",
			encoding: "utf8",
			newline: "LF",
			snapshotBoundary: "after Source Snapshot heading, before Research Notes, trim + final LF",
			artifactBoundary: "entire Markdown with LF newlines",
		},
		snapshotHash: sha256(snapshot),
		artifactHash: sha256(content),
		contentPath: relative(batchRoot, path),
		compilationPath,
		compilationHash: sha256(compilationArtifact),
		status: "source-frozen-candidate",
	};
});

const factSeeds: FactSeed[] = [
	{
		id: "FACT-HEALTH-001",
		sourceId: "health-who-march-2020-001",
		claim: "WHO 2020-03-29 简报将空气传播定义为可长期悬浮并可在超过 1 米距离传播的微生物颗粒核。",
		start: "Airborne transmission is different",
		end: "distances greater than 1 m.",
		timeScope: "as-of:2020-03-29",
	},
	{
		id: "FACT-HEALTH-002",
		sourceId: "health-who-march-2020-001",
		claim: "WHO 2020-03-29 简报只在产生气溶胶的特定医疗程序和场景中承认 COVID-19 空气传播可能性。",
		start: "In the context of COVID-19",
		conditions: ["历史版本", "限定于产生气溶胶的程序或支持治疗"],
		timeScope: "as-of:2020-03-29",
	},
	{
		id: "FACT-HEALTH-003",
		sourceId: "health-who-march-2020-001",
		claim: "该 3 月简报列举的产生气溶胶程序包括插管、支气管镜、开放吸痰和心肺复苏等。",
		start: "In the context of COVID-19",
		statementKind: "fact",
		timeScope: "as-of:2020-03-29",
	},
	{
		id: "FACT-HEALTH-004",
		sourceId: "health-who-july-2020-002",
		claim: "WHO 2020-07-09 简报明确说明它更新了 2020-03-29 的传播模式简报。",
		start: "This document is an update",
		end: "virus that causes COVID-19.",
		timeScope: "as-of:2020-07-09",
	},
	{
		id: "FACT-HEALTH-005",
		sourceId: "health-who-july-2020-002",
		claim:
			"7 月简报称，在拥挤、通风不足且与感染者长时间共处的特定室内地点，短距离气溶胶传播不能被排除。",
		start: "Short-range aerosol transmission",
		conditions: ["特定室内地点", "拥挤且通风不足", "与感染者长时间共处"],
		timeScope: "as-of:2020-07-09",
	},
	{
		id: "FACT-HEALTH-006",
		sourceId: "health-who-july-2020-002",
		claim: "7 月简报使用的是‘不能排除’，不是‘已证明所有室内传播均为空气传播’。",
		start: "Short-range aerosol transmission",
		statementKind: "scope-interpretation",
		conditions: ["不得提高证据强度"],
		timeScope: "as-of:2020-07-09",
	},
	{
		id: "FACT-HEALTH-007",
		sourceId: "health-nature-airborne-2022-003",
		claim: "Nature 特写称 WHO 在 2021-12-23 才把 airborne 一词用于 SARS-CoV-2。",
		start: "On 23 December",
		end: "‘airborne’.",
		statementKind: "reported-chronology",
		timeScope: "as-reported:2022-04-07",
	},
	{
		id: "FACT-HEALTH-008",
		sourceId: "health-nature-airborne-2022-003",
		claim:
			"Nature 将 WHO 的变化描述为：2020-10 承认特定室内场景的气溶胶传播，随后逐步扩大相关表述。",
		start: "It took until 20 October 2020",
		statementKind: "author-synthesis",
		timeScope: "as-reported:2022-04-07",
	},
	{
		id: "FACT-HEALTH-009",
		sourceId: "health-nature-airborne-2022-003",
		claim: "该 Nature 材料是对 WHO 口径演化的二手叙事，不是 WHO 自述。",
		start: "It took until 20 October 2020",
		statementKind: "source-attribution",
	},
	{
		id: "FACT-HEALTH-010",
		sourceId: "health-who-terminology-2024-004",
		claim: "WHO 2024 术语框架把 through the air 作为病原体在空气中旅行或悬浮的一般描述。",
		start: "The descriptor ‘through the air’",
		end: "two descriptors can be used:",
		timeScope: "as-of:2024-04-18",
	},
	{
		id: "FACT-HEALTH-011",
		sourceId: "health-who-terminology-2024-004",
		claim:
			"2024 框架把 airborne transmission or inhalation 描述为吸入被排出的感染性呼吸颗粒，可发生在近距离或远距离。",
		start: "1. Airborne transmission or inhalation",
		conditions: ["距离受气流、湿度、温度和通风等因素影响"],
		timeScope: "as-of:2024-04-18",
	},
	{
		id: "FACT-HEALTH-012",
		sourceId: "health-who-terminology-2024-004",
		claim: "2024 框架把 direct deposition 与吸入并列为 through the air transmission 下的另一描述。",
		start: "2. Direct deposition",
		timeScope: "as-of:2024-04-18",
	},
	{
		id: "FACT-HIST-001",
		sourceId: "history-educelab-paper-2023-001",
		claim: "EduceLab 论文提出结合 X-ray CT、机器学习以及连接 3D/2D 图像的几何框架来虚拟展开纸卷。",
		start: "We present a complete software pipeline",
		end: "linking 3D and 2D images.",
	},
	{
		id: "FACT-HIST-002",
		sourceId: "history-educelab-paper-2023-001",
		claim: "论文称其在有已知 ground truth 的纸卷碎片上恢复准确文本行。",
		start: "Our method is capable",
		end: "known ground truth.",
		conditions: ["对象是有已知 ground truth 的碎片"],
	},
	{
		id: "FACT-HIST-003",
		sourceId: "history-educelab-paper-2023-001",
		claim: "恢复文本通过视觉确认、定量图像指标和学术审读进行验证。",
		start: "Revealed text is verified",
		end: "scholarly review.",
	},
	{
		id: "FACT-HIST-004",
		sourceId: "history-vesuvius-github-2024-002",
		claim: "ScrollPrize/vesuvius 仓库在 2024-11-21 被归档并转为只读。",
		start: "This repository was archived",
		end: "read-only.",
		timeScope: "as-of:2024-11-21",
	},
	{
		id: "FACT-HIST-005",
		sourceId: "history-vesuvius-github-2024-002",
		claim: "归档 README 指向 ScrollPrize/villa 中的 vesuvius 作为后继维护位置。",
		start: "NOTE: Now maintained",
	},
	{
		id: "FACT-HIST-006",
		sourceId: "history-vesuvius-github-2024-002",
		claim: "该库处于 beta，接口可能改变，而且并非所有 Vesuvius Challenge 数据都可用。",
		start: "`vesuvius` is in beta",
		conditions: ["beta", "数据覆盖不完整"],
	},
	{
		id: "FACT-HIST-007",
		sourceId: "history-nature-scroll-2024-003",
		claim: "Nature 报道一组学生研究者从被火山掩埋的炭化纸卷中揭示了希腊文内容。",
		start: "A team of student researchers",
	},
	{
		id: "FACT-HIST-008",
		sourceId: "history-nature-scroll-2024-003",
		claim: "报道说获奖者在卷起纸莎草的扫描上训练机器学习算法。",
		start: "The winners of a contest",
		end: "rolled-up papyrus",
	},
	{
		id: "FACT-HIST-009",
		sourceId: "history-nature-scroll-2024-003",
		claim: "Nature 把恢复内容描述为讨论感官与快乐的一部此前未知的哲学作品。",
		start: "The winners of a contest",
		statementKind: "reported-interpretation",
	},
	{
		id: "FACT-HIST-010",
		sourceId: "history-scrollprize-2026-004",
		claim:
			"Vesuvius Challenge 于 2023 年 3 月启动，大奖目标是从一份纸卷恢复四段各 140 个字符的文本。",
		start: "Vesuvius Challenge launched",
		end: "Herculaneum scroll.",
		timeScope: "as-of:2023-03",
	},
	{
		id: "FACT-HIST-011",
		sourceId: "history-scrollprize-2026-004",
		claim: "项目官网称 PHerc. 1667 在 2026 年成为首份被虚拟展开并从头到尾读完的赫库兰尼姆纸卷。",
		start: "In 2026",
		end: "read end to end.",
		statementKind: "project-reported-result",
		timeScope: "as-of:2026",
	},
	{
		id: "FACT-HIST-012",
		sourceId: "history-scrollprize-2026-004",
		claim: "项目在该里程碑后把下一阶段设为阅读多份完整纸卷。",
		start: "The challenge now moves",
	},
	{
		id: "FACT-DESIGN-001",
		sourceId: "design-wcag21-2018-001",
		claim: "WCAG 2.1 声明向后兼容 WCAG 2.0。",
		start: "WCAG 2.1 builds on",
	},
	{
		id: "FACT-DESIGN-002",
		sourceId: "design-wcag21-2018-001",
		claim: "WCAG 2.1 的 4.1.1 Parsing 是 Level A 成功标准。",
		start: "Success Criterion 4.1.1 Parsing",
		end: "(Level A)",
		timeScope: "standard:WCAG-2.1",
	},
	{
		id: "FACT-DESIGN-003",
		sourceId: "design-wcag21-2018-001",
		claim:
			"WCAG 2.1 的 Parsing 条目要求标记具备完整起止标签、正确嵌套、无重复属性且 ID 唯一等条件。",
		start: "Success Criterion 4.1.1 Parsing",
		conditions: ["适用于用标记语言实现的内容", "规范允许的例外除外"],
		timeScope: "standard:WCAG-2.1",
	},
	{
		id: "FACT-DESIGN-004",
		sourceId: "design-wcag22-2023-002",
		claim: "WCAG 2.2 声明向后兼容 2.1，但移除了 4.1.1 Parsing。",
		start: "WCAG 2.2 builds on",
		end: "4.1.1 Parsing.",
		timeScope: "standard:WCAG-2.2",
	},
	{
		id: "FACT-DESIGN-005",
		sourceId: "design-wcag22-2023-002",
		claim: "即使采用 WCAG 2.2，受政策约束必须符合 2.0 或 2.1 的作者仍可能需要测试和报告 4.1.1。",
		start: "Authors that are required",
		end: "report 4.1.1.",
		conditions: ["适用政策仍引用 WCAG 2.0 或 2.1"],
	},
	{
		id: "FACT-DESIGN-006",
		sourceId: "design-wcag22-2023-002",
		claim: "WCAG 2.2 新增九项成功标准，其中 2.5.7 Dragging Movements 为 AA。",
		start: "The following success criteria",
		end: "3.3.9 Accessible Authentication (Enhanced) (AAA)",
	},
	{
		id: "FACT-DESIGN-007",
		sourceId: "design-wcag-issue-2705-003",
		claim:
			"GitHub issue #2705 引用了 2.5.7 的草案文本：拖拽功能应能由无需拖拽的单指针操作完成，除非拖拽不可替代等。",
		start: "Success Criterion 2.5.7",
		end: "not modified by the author.",
		statementKind: "proposal-quotation",
	},
	{
		id: "FACT-DESIGN-008",
		sourceId: "design-wcag-issue-2705-003",
		claim: "issue 作者请求在完成各输入方式研究之前移除该成功标准。",
		start: "We kindly request",
		statementKind: "author-proposal",
	},
	{
		id: "FACT-DESIGN-009",
		sourceId: "design-wcag-issue-2705-003",
		claim: "issue 作者认为不应把所有移动端要求强加给所有桌面内容。",
		start: "We believe more considerations",
		statementKind: "author-opinion",
	},
	{
		id: "FACT-DESIGN-010",
		sourceId: "design-webaim-checklist-2024-004",
		claim: "WebAIM 清单称 4.1.1 已在 2023 年从 WCAG 移除。",
		start: "Success Criterion 4.1.1 Parsing",
		statementKind: "secondary-summary",
	},
	{
		id: "FACT-DESIGN-011",
		sourceId: "design-webaim-checklist-2024-004",
		claim: "WebAIM 把 4.1.1 的移除归因于该成功标准不再有用。",
		start: "Success Criterion 4.1.1 Parsing",
		statementKind: "secondary-summary",
	},
	{
		id: "FACT-DESIGN-012",
		sourceId: "design-webaim-checklist-2024-004",
		claim: "WebAIM 的移除表述带有 2023 年时间条件，不能用于改写 2018 年 WCAG 2.1 的历史要求。",
		start: "Success Criterion 4.1.1 Parsing",
		statementKind: "scope-interpretation",
		conditions: ["版本与时间必须保留"],
	},
];

const facts = factSeeds.map((seed) => {
	const exactQuote = quote(seed.sourceId, seed.start, seed.end);
	return {
		candidateId: seed.id,
		status: "candidate",
		sourceId: seed.sourceId,
		claim: seed.claim,
		exactQuote,
		locator: "Source Snapshot",
		statementKind: seed.statementKind ?? "fact",
		conditions: seed.conditions ?? [],
		timeScope: seed.timeScope ?? null,
		uncertainties: [],
	};
});
const factById = new Map(facts.map((fact) => [fact.candidateId, fact]));

const relations = [
	relation(
		"REL-HEALTH-001",
		"FACT-HEALTH-005",
		"SUPERSEDES",
		"FACT-HEALTH-002",
		["2020-07-09 更新 2020-03-29 简报", "只扩大到简报明确描述的特定室内条件"],
		["FACT-HEALTH-004", "FACT-HEALTH-005", "FACT-HEALTH-002"],
	),
	relation(
		"REL-HEALTH-002",
		"FACT-HEALTH-008",
		"DERIVED_FROM",
		"FACT-HEALTH-005",
		["Nature 是二手时间线解释，不是 WHO 规范文本"],
		["FACT-HEALTH-008", "FACT-HEALTH-005"],
	),
	relation(
		"REL-HEALTH-003",
		"FACT-HEALTH-010",
		"RELATED_TO",
		"FACT-HEALTH-005",
		["2024 是跨病原体术语框架，2020 是 COVID-19 科学简报；不能标成直接替代"],
		["FACT-HEALTH-010", "FACT-HEALTH-005"],
	),
	relation(
		"REL-HIST-001",
		"FACT-HIST-008",
		"RELATED_TO",
		"FACT-HIST-001",
		["报道中的竞赛方法与论文管线共享技术主题，但不是同一项结果"],
		["FACT-HIST-008", "FACT-HIST-001"],
	),
	relation(
		"REL-HIST-002",
		"FACT-HIST-011",
		"SUPERSEDES",
		"FACT-HIST-010",
		["仅在‘项目已达到的最高阅读里程碑’这一状态槽位内", "项目官网自述，需论文交叉验证"],
		["FACT-HIST-011", "FACT-HIST-010"],
	),
	relation(
		"REL-HIST-003",
		"FACT-HIST-005",
		"RELATED_TO",
		"FACT-HIST-004",
		["归档 README 明确给出后继维护位置"],
		["FACT-HIST-004", "FACT-HIST-005"],
	),
	relation(
		"REL-DESIGN-001",
		"FACT-DESIGN-004",
		"SUPERSEDES",
		"FACT-DESIGN-002",
		["仅当符合性目标是 WCAG 2.2", "仍受 WCAG 2.0/2.1 政策约束时可能继续测试 4.1.1"],
		["FACT-DESIGN-004", "FACT-DESIGN-005", "FACT-DESIGN-002"],
	),
	relation(
		"REL-DESIGN-002",
		"FACT-DESIGN-008",
		"CONTRADICTS",
		"FACT-DESIGN-006",
		["冲突是 issue 作者的移除建议与最终标准保留 2.5.7，不是世界事实冲突"],
		["FACT-DESIGN-008", "FACT-DESIGN-006"],
	),
	relation(
		"REL-DESIGN-003",
		"FACT-DESIGN-010",
		"SUPPORTS",
		"FACT-DESIGN-004",
		["WebAIM 为二手清单，不能增加独立规范权威"],
		["FACT-DESIGN-010", "FACT-DESIGN-004"],
	),
];

const taskSeeds: TaskSeed[] = [
	task(
		"B-F-HEALTH-001",
		"health-biology",
		"F",
		"判断：WHO 2020-03-29 已无条件确认 COVID-19 可在所有室内环境通过空气传播。",
		["FACT-HEALTH-002"],
		["不忠实；原文限定产生气溶胶的特定程序或场景"],
		["不得删除历史版本和场景条件"],
	),
	task(
		"B-C-HEALTH-002",
		"health-biology",
		"C",
		"2020-07 简报在什么条件下说短距离气溶胶传播不能被排除？",
		["FACT-HEALTH-005"],
		["拥挤、通风不足、长时间与感染者共处的特定室内地点"],
		["不得改成所有室内场景"],
	),
	task(
		"B-T-HEALTH-003",
		"health-biology",
		"T",
		"按时间排列 WHO 3 月简报、7 月更新、Nature 所述后续口径和 2024 术语框架。",
		["FACT-HEALTH-002", "FACT-HEALTH-004", "FACT-HEALTH-008", "FACT-HEALTH-010"],
		["2020-03→2020-07→2022 报道回顾→2024 术语框架", "区分事件时间和报道时间"],
		["不得把 2022 报道当作 2020 原始文件"],
	),
	task(
		"B-K-HEALTH-004",
		"health-biology",
		"K",
		"Nature 对 WHO 演变的描述能否直接作为 WHO 自己承认失误的声明？",
		["FACT-HEALTH-008", "FACT-HEALTH-009"],
		["不能；Nature 是二手叙事", "可以引用其报道，但必须归属"],
		["不得把记者叙事写成 WHO 自述"],
	),
	task(
		"B-E-HEALTH-005",
		"health-biology",
		"E",
		"从 2020-03 到 2020-07，空气传播适用范围发生了什么可证实变化？",
		["FACT-HEALTH-002", "FACT-HEALTH-004", "FACT-HEALTH-005"],
		["7 月文件明确更新 3 月文件", "从产生气溶胶医疗程序扩展到不能排除特定室内短距离气溶胶传播"],
		["不得提高为无条件结论"],
	),
	task(
		"B-X-HEALTH-006",
		"health-biology",
		"X",
		"2024 的 through the air 框架与 2020 COVID 简报是否是同一个范围的规则？",
		["FACT-HEALTH-005", "FACT-HEALTH-010", "FACT-HEALTH-012"],
		["不是；2024 是跨病原体术语框架", "两者相关但不能简单标为直接替代"],
		["不得把术语框架当传播占比结论"],
	),
	task(
		"B-R-HEALTH-007",
		"health-biology",
		"R",
		"找出支持‘direct deposition 与 inhalation 并列’的来源。",
		["FACT-HEALTH-011", "FACT-HEALTH-012"],
		["WHO 2024 术语发布"],
		["不得引用 2020 简报替代 2024 定义"],
	),
	task(
		"B-A-HEALTH-008",
		"health-biology",
		"A",
		"根据本批材料，空气传播在 2026 年所有呼吸道感染中的精确占比是多少？",
		[],
		["材料没有提供精确占比，必须回答证据不足"],
		["不得编造百分比"],
		"insufficient",
	),
	task(
		"B-U-HEALTH-009",
		"health-biology",
		"U",
		"给公共空间写一段基于这些历史材料的通风建议。",
		["FACT-HEALTH-005", "FACT-HEALTH-011"],
		["只能做证据摘要", "应注明历史版本与非医疗建议边界"],
		["不得替代当前卫生指南或个体医疗建议"],
		"partial",
	),
	task(
		"B-F-HEALTH-010",
		"health-biology",
		"F",
		"判断：WHO 2024 框架把 direct deposition 排除在 through the air transmission 之外。",
		["FACT-HEALTH-010", "FACT-HEALTH-012"],
		["错误；它被列为该框架下两种描述之一"],
		["不得反转分类"],
	),
	task(
		"B-R-HEALTH-011",
		"health-biology",
		"R",
		"哪份材料使用了‘cannot be ruled out’，这句话的证据强度是什么？",
		["FACT-HEALTH-005", "FACT-HEALTH-006"],
		["WHO 2020-07 更新", "表示不能排除而非无条件证实"],
		["不得把可能性改成必然性"],
	),

	task(
		"B-F-HIST-001",
		"history-humanities",
		"F",
		"判断：EduceLab 论文已经证明所有密封赫库兰尼姆纸卷都能完整恢复。",
		["FACT-HIST-002", "FACT-HIST-003"],
		["不忠实；证据明确涉及有 ground truth 的碎片", "验证方法不等于所有纸卷完整恢复"],
		["不得丢失对象范围"],
	),
	task(
		"B-R-HIST-002",
		"history-humanities",
		"R",
		"恢复文本使用了哪三类验证方式？",
		["FACT-HIST-003"],
		["视觉确认、定量图像指标、学术审读"],
		["不得简化为仅由 AI 自评"],
	),
	task(
		"B-C-HIST-003",
		"history-humanities",
		"C",
		"使用归档 vesuvius 仓库时必须保留哪些状态条件？",
		["FACT-HIST-004", "FACT-HIST-005", "FACT-HIST-006"],
		["已归档只读", "后继维护位置", "beta 且数据覆盖不完整"],
		["不得把归档仓库说成当前稳定 API"],
	),
	task(
		"B-K-HIST-004",
		"history-humanities",
		"K",
		"Nature 所说的哲学作品主题是项目官网已正式定论，还是报道归属？",
		["FACT-HIST-009"],
		["是 Nature 报道中的解释，应保留报道归属"],
		["不得冒充原始纸卷自带元数据"],
	),
	task(
		"B-E-HIST-005",
		"history-humanities",
		"E",
		"Vesuvius Challenge 从 2023 大奖目标到 2026 官网里程碑如何变化？",
		["FACT-HIST-010", "FACT-HIST-011", "FACT-HIST-012"],
		["从四段各 140 字符到官网称整卷端到端读取", "下一阶段转为多份完整纸卷"],
		["不得省略官网自述边界"],
	),
	task(
		"B-X-HIST-006",
		"history-humanities",
		"X",
		"论文、GitHub 库和 Nature 报道分别能回答哪一层问题？",
		["FACT-HIST-001", "FACT-HIST-005", "FACT-HIST-008", "FACT-HIST-009"],
		["论文回答方法与验证", "GitHub 回答实现和维护状态", "Nature 回答报道与人文解释"],
		["不得用二手报道替代实现版本"],
	),
	task(
		"B-A-HIST-007",
		"history-humanities",
		"A",
		"PHerc. 1667 的作者是谁？",
		["FACT-HIST-011"],
		["本批证据没有作者信息"],
		["不得从讨论快乐主题推断作者"],
		"insufficient",
	),
	task(
		"B-U-HIST-008",
		"history-humanities",
		"U",
		"为博物馆观众写一段‘AI 已读完所有纸卷’的展签。",
		["FACT-HIST-010", "FACT-HIST-011", "FACT-HIST-012"],
		["必须拒绝错误前提", "只能说官网称一卷端到端读取，目标是多卷"],
		["不得写成所有纸卷已读完"],
	),
	task(
		"B-T-HIST-009",
		"history-humanities",
		"T",
		"归档仓库与 2026 项目进展的时间关系是什么？",
		["FACT-HIST-004", "FACT-HIST-005", "FACT-HIST-011"],
		["旧库 2024-11 归档并迁移", "2026 里程碑不能归因于归档仓库默认分支"],
		["不得混淆代码维护时间与研究成果时间"],
	),
	task(
		"B-F-HIST-010",
		"history-humanities",
		"F",
		"判断：Nature 2024 报道的是整卷从头到尾已经读完。",
		["FACT-HIST-007", "FACT-HIST-008", "FACT-HIST-011"],
		["错误；2024 是 passages，整卷里程碑来自 2026 官网"],
		["不得发生时间穿越"],
	),

	task(
		"B-F-DESIGN-001",
		"design-accessibility",
		"F",
		"判断：WCAG 2.2 完全废弃并取代 WCAG 2.1，旧政策不再相关。",
		["FACT-DESIGN-004", "FACT-DESIGN-005"],
		["错误；2.2 声明向后兼容", "旧政策仍可能要求测试 4.1.1"],
		["不得把版本升级写成法律自动替代"],
	),
	task(
		"B-C-DESIGN-002",
		"design-accessibility",
		"C",
		"在什么条件下采用 WCAG 2.2 后仍可能需要报告 4.1.1？",
		["FACT-DESIGN-005"],
		["适用政策仍要求符合 WCAG 2.0 或 2.1"],
		["不得无条件删除旧测试"],
	),
	task(
		"B-E-DESIGN-003",
		"design-accessibility",
		"E",
		"4.1.1 Parsing 从 WCAG 2.1 到 2.2 发生了什么变化？",
		["FACT-DESIGN-002", "FACT-DESIGN-004", "FACT-DESIGN-005"],
		["2.1 中为 Level A", "2.2 中移除", "旧政策可能仍要求"],
		["不得反向改写 2.1 历史文本"],
	),
	task(
		"B-K-DESIGN-004",
		"design-accessibility",
		"K",
		"GitHub issue #2705 的移除建议是否代表 W3C 最终决定？",
		["FACT-DESIGN-008", "FACT-DESIGN-006"],
		["不是；它是作者建议", "最终 2.2 仍列出 2.5.7"],
		["不得把 issue 当规范"],
	),
	task(
		"B-X-DESIGN-005",
		"design-accessibility",
		"X",
		"比较 issue #2705 与最终 WCAG 2.2 对 Dragging Movements 的关系。",
		["FACT-DESIGN-007", "FACT-DESIGN-008", "FACT-DESIGN-006"],
		["issue 引用草案并建议移除", "最终标准保留为 AA", "冲突是提案立场与最终结果"],
		["不得说两份都是同等权威规范"],
	),
	task(
		"B-R-DESIGN-006",
		"design-accessibility",
		"R",
		"WCAG 2.2 新增了多少项成功标准，2.5.7 属于哪个级别？",
		["FACT-DESIGN-006"],
		["九项", "2.5.7 为 AA"],
		["不得把 2.5.7 写成 AAA"],
	),
	task(
		"B-F-DESIGN-007",
		"design-accessibility",
		"F",
		"判断：WebAIM 的‘2023 年移除’说明 WCAG 2.1 从发布之日起就没有 4.1.1。",
		["FACT-DESIGN-002", "FACT-DESIGN-010", "FACT-DESIGN-012"],
		["错误；发生时间与版本错位"],
		["不得用新清单抹除历史规范"],
	),
	task(
		"B-U-DESIGN-008",
		"design-accessibility",
		"U",
		"为仍受 WCAG 2.1 合同约束的产品生成 2.2 升级清单。",
		["FACT-DESIGN-004", "FACT-DESIGN-005", "FACT-DESIGN-006"],
		["加入九项新标准", "保留适用合同要求的 4.1.1 测试", "核对政策而非自动删项"],
		["不得输出法律合规保证"],
		"partial",
	),
	task(
		"B-A-DESIGN-009",
		"design-accessibility",
		"A",
		"该产品是否符合欧洲无障碍法全部要求？",
		[],
		["本批只有 WCAG 摘录，没有产品审计或完整法律范围"],
		["不得给出合规保证"],
		"insufficient",
	),
	task(
		"B-C-DESIGN-010",
		"design-accessibility",
		"C",
		"2.5.7 的例外条件是什么？",
		["FACT-DESIGN-007"],
		["拖拽不可替代，或功能由用户代理决定且作者未修改"],
		["不得说所有拖拽绝对禁止"],
	),
	task(
		"B-K-DESIGN-011",
		"design-accessibility",
		"K",
		"WebAIM 与 W3C 都说 4.1.1 被移除，这是否构成两个独立规范来源？",
		["FACT-DESIGN-004", "FACT-DESIGN-010"],
		["不构成；W3C 是规范，WebAIM 是二手清单", "可相互印证但权威和独立性不同"],
		["不得把二手清单升级为规范"],
	),
];

const tasks = taskSeeds.map((seed) => ({
	caseId: seed.id,
	status: "candidate",
	split: "validation-candidate-public",
	domain: [seed.domain],
	questionType: seed.type,
	capabilities: capabilities(seed.type),
	question: seed.question,
	requiredPoints: seed.requiredPoints,
	forbiddenClaims: seed.forbiddenClaims,
	requiredEvidence: seed.facts.map((factId) => evidenceForFact(factId)),
	answerability: seed.answerability ?? "answerable",
	diagnosticOwner: seed.diagnosticOwner ?? ownerFor(seed.type),
	difficulty: seed.facts.length > 2 ? "multi-hop" : seed.facts.length > 1 ? "two-source" : "direct",
	sourcePriorityRule:
		"P/C 决定规范、论文与实现事实；S 只能作为有归属的解释，不能推翻一手版本文本。",
	generatorNotes: "Codex curated Batch B candidate; not human Gold.",
}));

const episodes = [
	episode(
		"EV-HEALTH-001",
		"health-biology",
		["health-who-march-2020-001"],
		["health-who-july-2020-002", "health-who-terminology-2024-004"],
		["FACT-HEALTH-002"],
		["FACT-HEALTH-005", "FACT-HEALTH-010", "FACT-HEALTH-012"],
		["不得把 3 月的医疗程序限定继续写成整个演化期唯一范围", "不得把 2024 术语框架写成传播占比结论"],
	),
	episode(
		"EV-HIST-001",
		"history-humanities",
		["history-educelab-paper-2023-001", "history-nature-scroll-2024-003"],
		["history-scrollprize-2026-004"],
		["FACT-HIST-007", "FACT-HIST-010"],
		["FACT-HIST-011", "FACT-HIST-012"],
		["不得再把 passages 说成项目最新最高里程碑", "不得把一卷扩成所有纸卷"],
	),
	episode(
		"EV-DESIGN-001",
		"design-accessibility",
		["design-wcag21-2018-001"],
		["design-wcag22-2023-002", "design-wcag-issue-2705-003"],
		["FACT-DESIGN-002"],
		["FACT-DESIGN-004", "FACT-DESIGN-005", "FACT-DESIGN-006"],
		["不得在 WCAG 2.2-only 范围继续把 4.1.1 当现行标准", "不得在旧政策范围无条件停止报告 4.1.1"],
	),
];

writeJsonl(join(outputRoot, "source-manifest.jsonl"), manifest);
writeJsonl(join(outputRoot, "candidates", "facts.jsonl"), facts);
writeJsonl(join(outputRoot, "candidates", "relations.jsonl"), relations);
writeJsonl(join(outputRoot, "candidates", "tasks.jsonl"), tasks);
writeJsonl(join(outputRoot, "candidates", "evolution-episodes.jsonl"), episodes);
writeJson(join(outputRoot, "reports", "build-summary.json"), {
	schemaVersion: "wge-batch-build-summary/v1",
	status: "candidate-not-human-gold",
	counts: {
		sources: manifest.length,
		facts: facts.length,
		relations: relations.length,
		tasks: tasks.length,
		episodes: episodes.length,
	},
	domainCounts: Object.fromEntries(
		["health-biology", "history-humanities", "design-accessibility"].map((domain) => [
			domain,
			manifest.filter((item) => item.domain === domain).length,
		]),
	),
	splitBoundary:
		"Public validation candidates only. Batch B is unseen-domain material for E4, but not a blind holdout.",
});

console.log(`Batch B generated at ${relative(projectRoot, outputRoot)}`);
console.log(
	JSON.stringify(
		{
			sources: manifest.length,
			facts: facts.length,
			relations: relations.length,
			tasks: tasks.length,
			episodes: episodes.length,
		},
		null,
		2,
	),
);

function relation(
	id: string,
	from: string,
	type: string,
	to: string,
	conditions: string[],
	factIds: string[],
): JsonRecord {
	return {
		candidateId: id,
		status: "candidate",
		from,
		type,
		to,
		conditions,
		directionReason: `Curated candidate relation ${from} -> ${to}; requires independent semantic audit.`,
		evidence: factIds.map((factId) => evidenceForFact(factId)),
		uncertainties: ["尚未经过独立 Relation critic 或人工 Gold 审计"],
	};
}

function task(
	id: string,
	domain: string,
	type: string,
	question: string,
	factsValue: string[],
	requiredPoints: string[],
	forbiddenClaims: string[],
	answerability?: "answerable" | "partial" | "insufficient",
): TaskSeed {
	return {
		id,
		domain,
		type,
		question,
		facts: factsValue,
		requiredPoints,
		forbiddenClaims,
		answerability,
	};
}

function episode(
	id: string,
	domain: string,
	t0Sources: string[],
	t1Sources: string[],
	oldFacts: string[],
	newFacts: string[],
	forbiddenAfterT1: string[],
): JsonRecord {
	return {
		episodeId: id,
		status: "candidate",
		domain,
		t0Sources,
		t1Sources,
		changeType: "evolution",
		oldClaimsThatMustChange: oldFacts.map((factId) => requireFact(factId).claim),
		claimsThatMustRemain: [],
		newClaims: newFacts.map((factId) => requireFact(factId).claim),
		forbiddenAfterT1,
		chronologyEvidence: [...oldFacts, ...newFacts].map((factId) => evidenceForFact(factId)),
		uncertainties: [
			"candidate episode; chronology is frozen but semantic Gold requires independent review",
		],
	};
}

function evidenceForFact(factId: string): JsonRecord {
	const fact = requireFact(factId);
	return {
		sourceId: fact.sourceId,
		exactQuote: fact.exactQuote,
		locator: fact.locator,
		role: "supports",
		factId,
	};
}

function requireFact(factId: string): JsonRecord {
	const fact = factById.get(factId);
	if (!fact) throw new Error(`Unknown fact: ${factId}`);
	return fact;
}

function quote(sourceId: string, start: string, end?: string): string {
	const source = sources.get(sourceId);
	if (!source) throw new Error(`Unknown source: ${sourceId}`);
	const startIndex = source.snapshot.indexOf(start);
	if (startIndex < 0) throw new Error(`Missing start marker in ${sourceId}: ${start}`);
	if (!end) {
		const paragraphEnd = source.snapshot.indexOf("\n\n", startIndex);
		return source.snapshot
			.slice(startIndex, paragraphEnd < 0 ? source.snapshot.length : paragraphEnd)
			.trim();
	}
	const endIndex = source.snapshot.indexOf(end, startIndex);
	if (endIndex < 0) throw new Error(`Missing end marker in ${sourceId}: ${end}`);
	return source.snapshot.slice(startIndex, endIndex + end.length);
}

function capabilities(type: string): string[] {
	const mapping: Record<string, string[]> = {
		F: ["faithfulness"],
		R: ["retrieval"],
		X: ["cross-source", "synthesis"],
		C: ["condition-scope"],
		K: ["conflict-attribution"],
		T: ["temporal-ordering"],
		E: ["evolution"],
		A: ["unanswerable"],
		U: ["user-task"],
	};
	return mapping[type] ?? ["unknown"];
}

function ownerFor(type: string): string {
	if (type === "R" || type === "A") return "retrieval";
	if (["X", "K", "T"].includes(type)) return "graph";
	if (type === "C") return "context-pack";
	if (type === "E") return "compiler";
	return "answer";
}

function listMarkdown(root: string): string[] {
	return readdirSync(root, { withFileTypes: true })
		.flatMap((entry) => {
			const path = join(root, entry.name);
			return entry.isDirectory() ? listMarkdown(path) : path.endsWith(".md") ? [path] : [];
		})
		.sort();
}

function parseFrontmatter(content: string): JsonRecord {
	const match = /^---\n([\s\S]*?)\n---/.exec(content);
	if (!match) throw new Error("Missing YAML frontmatter");
	const result = load(match[1]);
	if (!isRecord(result)) throw new Error("Frontmatter must be an object");
	return result;
}

function extractSnapshot(content: string): string {
	const heading = "## Source Snapshot";
	const start = content.indexOf(heading);
	const bodyStart = content.indexOf("\n", start + heading.length) + 1;
	const end = content.indexOf("## Research Notes", bodyStart);
	if (start < 0 || bodyStart === 0 || end < 0)
		throw new Error("Invalid Source Snapshot boundaries");
	return `${content.slice(bodyStart, end).trim()}\n`;
}

function normalizeNewlines(value: string): string {
	return value.replace(/\r\n?/g, "\n");
}

function sha256(value: string): string {
	return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function writeJsonl(path: string, values: JsonRecord[]): void {
	writeFileSync(path, `${values.map((value) => JSON.stringify(value)).join("\n")}\n`, "utf8");
}

function writeJson(path: string, value: unknown): void {
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function requireString(record: JsonRecord, key: string): string {
	const value = record[key];
	if (typeof value !== "string" || value.length === 0) throw new Error(`Missing string ${key}`);
	return value;
}

function isRecord(value: unknown): value is JsonRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
