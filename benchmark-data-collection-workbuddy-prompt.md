# WorkBuddy 任务包：WGEMemory Benchmark Seed · Batch A

## 你的角色

你是“测试资料研究员与候选标注员”，不是产品架构师，也不是最终事实裁判。

你的任务是为 WGEMemory4LLM 收集可追溯的真实材料，并从材料中生成候选测试数据。Codex 会在你完成后审核证据、去重、分层和冻结 Gold。

请完整阅读随任务上传的 `WGEMemory4LLM-Benchmark.html`，以其中 v2.0 的来源角色、题型、数据切分和版权规则为最高约束。

## 本轮目标

构建 Benchmark Seed Batch A：

- 领域：AI、科技、金融。
- 每个领域 4 份材料，共 12 份。
- 每个领域至少覆盖 3 种来源角色。
- 生成 6 个真实用户任务候选，每领域 2 个。
- 至少构建 3 组 Evolution Episode，每领域至少 1 组。
- 生成约 60 道候选测试题，但不要为了凑数制造重复题。

所有模型生成内容必须标记为 `candidate`，绝不标记为 `verified`、`human-reviewed` 或 Gold。

## 来源角色与每领域配额

每个领域收集以下 4 份材料：

1. `P`：一手规范、官方数据、官方博客、论文、监管公告、财报等。
2. `C/P`：GitHub 仓库、release、issue、PR、源码，或另一份独立的一手材料。
3. `S`：科技自媒体、B 站 UP、微信公众号、研究解读或长篇分析。
4. `U/S`：Reddit、X、GitHub Discussion、社区讨论，或与第 3 份观点不同的二手材料。

优先选择彼此存在下列关系的材料，而不是 12 篇互不相关的文章：

- 官方说法与实际实现；
- 新旧版本变化；
- 一手数据与媒体解释；
- 官方结论与社区体验；
- 支持、限制、反驳、补充条件或争议。

## 默认主题建议

你可以根据材料质量调整具体主题，但三个领域内应各自形成一个小型知识网络。

### AI

围绕一个真实模型/API/Agent 技术变化：官方发布、文档或论文、GitHub 实现、技术解读、社区反馈。

### 科技

围绕一个具体软硬件平台、开源工具或开发者技术变化：官网/规范、源码或 release、专业解读、真实使用讨论。

### 金融

围绕一个有明确时间和原始数据的事件：监管规则、公司财报、宏观数据或产品规则，并配套媒体解释和社区观点。不得把投资观点写成确定事实。

## 合法性与安全边界

- 不绕过登录、验证码、robots、付费墙、地域限制或访问控制。
- 不使用泄露文件、私人信息、非公开群聊或明显违法来源。
- 不公开复制受版权保护的整篇文章或完整视频字幕。
- 内部材料可以保存必要的结构化摘要与短证据片段；必须保留原链接、作者、时间和定位信息。
- B 站/视频材料优先使用官方字幕、作者公开文字稿或可合法访问的转录，并保留时间戳。
- GitHub 必须固定到 commit/tag/release；不得只写会漂移的默认分支状态。
- X、Reddit、issue 等社区内容必须保留线程上下文、发帖时间、账号和编辑/删除状态（如可见）。
- 如果页面无法合法获取，在 manifest 中写明 `accessStatus`，不要根据搜索摘要伪造正文。

## 材料文件要求

每份材料创建一个 Markdown 文件，必须包含 YAML frontmatter：

```yaml
---
sourceId: ai-example-001
title: "原始标题"
domain: ai
sourceRole: P
platform: official
author: "作者或机构"
canonicalUrl: "https://..."
publishedAt: "2026-01-01T00:00:00Z"
capturedAt: "2026-07-27T00:00:00Z"
versionRef: "版本、commit、tag 或 null"
mediaType: article
language: zh-CN
usage: internal-only
accessStatus: full | partial | metadata-only
contentHash: "sha256:..."
---
```

正文按以下结构保存：

```markdown
# 原始标题

## Source Snapshot

保留可合法使用的原始正文、必要摘录、代码、表格或带时间戳的转录。不要改写 exact quote。

## Research Notes

- 这份材料在小型知识网络中的角色。
- 它与其他 sourceId 的潜在关系。
- 哪些内容是事实、作者观点、预测、传闻或个人体验。
- 未能获取或无法确认的内容。
```

`Research Notes` 不能混入 `Source Snapshot`，避免研究员解释被误当成原文。

## source-manifest.jsonl

每份材料写一条 JSON，至少包含：

```json
{
  "sourceId": "ai-example-001",
  "title": "...",
  "domain": "ai",
  "sourceRole": "P",
  "platform": "official",
  "author": "...",
  "canonicalUrl": "https://...",
  "publishedAt": "ISO-8601 或 unknown",
  "capturedAt": "ISO-8601",
  "versionRef": null,
  "contentHash": "sha256:...",
  "mediaType": "article",
  "language": "zh-CN",
  "usage": "internal-only",
  "accessStatus": "full",
  "contentPath": "corpus/inbox/ai/ai-example-001.md",
  "collectionNotes": "..."
}
```

## 候选事实与关系

对每份材料生成：

- 5–8 条原子事实候选；
- 2–4 条关系候选；
- 2 条容易丢条件、时间、主体或适用范围的风险项。

输出到 `candidates/facts.jsonl` 和 `candidates/relations.jsonl`。

事实候选格式：

```json
{
  "candidateId": "FACT-AI-001",
  "status": "candidate",
  "sourceId": "ai-example-001",
  "claim": "严格忠实于原文的候选断言",
  "exactQuote": "原文逐字证据",
  "locator": "标题层级、段落、行号、时间戳或代码路径",
  "statementKind": "fact | author-opinion | prediction | rumor | experience",
  "conditions": ["适用条件"],
  "timeScope": "适用时间或 null",
  "uncertainties": []
}
```

关系候选格式：

```json
{
  "candidateId": "REL-AI-001",
  "status": "candidate",
  "from": "候选事实、概念或 sourceId",
  "type": "SUPPORTS | CONTRADICTS | REQUIRES | NARROWS | SUPERSEDES | IMPLEMENTS | REPORTS_EXPERIENCE",
  "to": "候选事实、概念或 sourceId",
  "directionReason": "为什么是这个方向",
  "conditions": ["关系成立条件"],
  "evidence": [
    {"sourceId": "...", "exactQuote": "...", "locator": "..."}
  ],
  "uncertainties": []
}
```

如果关系需要常识补全、无法从材料组合中证明，保留为 `uncertainties` 或直接不生成。

## 候选测试题

共生成约 60 题，按以下目标分布：

- F 忠实性：12 题；
- R 检索：8 题；
- X 跨来源合成：8 题；
- C 条件与范围：6 题；
- K 冲突与归属：6 题；
- T 时间与版本：6 题；
- E 演化：6 题；
- A 不可回答：4 题；
- U 真实用户任务：4 题。

允许根据材料质量上下浮动，但 X/K/T/E 合计不能少于 20 题。

输出到 `candidates/tasks.jsonl`：

```json
{
  "caseId": "X-AI-001",
  "status": "candidate",
  "splitSuggestion": "dev",
  "domain": ["ai", "software"],
  "capabilities": ["cross-source", "temporal"],
  "question": "...",
  "timeScope": "as-of:YYYY-MM-DD 或 null",
  "requiredPoints": ["答案必须包含的要点"],
  "acceptableVariants": ["可接受表述"],
  "forbiddenClaims": ["材料不支持或已过时的断言"],
  "requiredEvidence": [
    {"sourceId": "...", "exactQuote": "...", "locator": "...", "role": "supports"}
  ],
  "answerability": "answerable | partial | insufficient",
  "sourcePriorityRule": "为什么某类来源只代表观点/体验，某类来源决定规范事实",
  "diagnosticOwner": "compiler | retrieval | graph | context-pack | answer",
  "difficulty": "direct | two-source | multi-hop | adversarial",
  "generatorNotes": "..."
}
```

题目必须做到：

- 不看材料不能稳定回答；
- 能由 requiredEvidence 核验；
- 不把来源自身的错误偷偷改成世界真理；
- 至少包含条件、时序、冲突、不可回答中的一种高风险能力；
- 不通过同义改写制造重复题；
- 不故意让文件检索基线处于劣势。

## Evolution Episode

每个领域至少建立 1 组，共至少 3 组；优先寻找：

- 官方文档或价格发生版本变化；
- release 修复或撤回旧行为；
- 预测被新数据确认或证伪；
- 媒体早期说法被一手材料缩窄；
- 社区传闻后来得到确认或否定。

输出到 `candidates/evolution-episodes.jsonl`：

```json
{
  "episodeId": "EV-AI-001",
  "status": "candidate",
  "domain": "ai",
  "t0Sources": ["sourceId"],
  "t1Sources": ["sourceId"],
  "changeType": "supersede | contradict | narrow | confirm | retract",
  "oldClaimsThatMustChange": ["..."],
  "claimsThatMustRemain": ["..."],
  "expectedAffectedObjects": ["Claim", "Relation", "WikiModule", "Task"],
  "preQuestions": ["..."],
  "postQuestions": ["..."],
  "forbiddenAfterT1": ["..."],
  "uncertainties": ["..."],
  "chronologyEvidence": [
    {"sourceId": "...", "publishedAt": "...", "exactQuote": "..."}
  ]
}
```

## 真实用户任务候选

每领域生成 2 个，但必须写明这是研究员根据材料提出的候选，而不是代替用户偏好。

任务应类似：

- 基于官方规则、实际实现与社区反馈，给出带风险边界的技术选型备忘录；
- 根据新旧财报/公告解释观点为什么需要更新；
- 比较两个来源的分歧并指出还缺什么证据；
- 追踪一个技术或政策在 T0→T1 的变化及影响范围。

## 输出目录

最终提交一个文件夹或 zip：

```text
workbuddy-batch-a/
├── README.md
├── corpus/inbox/
│   ├── ai/*.md
│   ├── technology/*.md
│   └── finance/*.md
├── manifests/source-manifest.jsonl
├── candidates/facts.jsonl
├── candidates/relations.jsonl
├── candidates/tasks.jsonl
├── candidates/evolution-episodes.jsonl
├── reports/coverage-matrix.md
├── reports/collection-log.md
└── reports/unresolved-and-access-failures.md
```

`README.md` 必须给出：

- 实际收集数量及每领域/来源角色分布；
- 缺失项和原因；
- 哪些内容只拿到 metadata/partial；
- 候选题型数量；
- 可能重复或存在泄漏关系的来源簇；
- 最值得 Codex 优先审核的 10 个高风险候选；
- 所有自动化工具、模型与抓取日期。

## 完成前自检

1. 12 个 sourceId 唯一，manifest 与文件一一对应。
2. 所有 exactQuote 能在对应 Markdown 的 Source Snapshot 中逐字找到。
3. 所有 URL、作者、时间和版本字段均有值或明确写 unknown/null。
4. 没有将搜索摘要、Research Notes 或模型常识伪装成原文。
5. 没有绕过访问控制或公开复制不允许再分发的全文。
6. 约 60 题分布合理，跨来源/冲突/时间/演化题不低于约定下限。
7. 所有候选均为 `status: candidate`。
8. 将失败、缺失和不确定项如实写入报告，不静默丢弃。

如果无法满足某项，不要伪造完成；提交可用部分，并在 `unresolved-and-access-failures.md` 中说明。
