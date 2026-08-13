# WGEMemory S200 + T0→Tn：WorkBuddy 两阶段采集合同 v1.0

> 生效日期：2026-08-10
> 用途：为 G3-C 提供真实多领域规模材料、Graph-native 任务和时间演化事件。
> 权限：本合同服从 `WGEMemory4LLM-Benchmark.html` v3.0；任何模型产出的标注只能叫 `candidate` 或 `model-reviewed-provisional`，不能叫 human Gold。

## 0. WorkBuddy 对话框直接发送的指令

```text
请完整读取我上传的文件，并以 benchmark-s200-workbuddy-contract.md 为强制执行合同。

本轮先完成 Stage A，不要只输出计划，也不要交付 Stage B。先读取三个历史 source manifest，建立 normalized URL / 内容 hash / 仓库与版本链 / 事件簇四层 denylist，然后开始合法检索、来源冻结和目录构建。

Stage A 目标是在现有 S50 之外增加约 150 份真实 Source Snapshot，使总规模达到约 S200；材料覆盖 8–10 个领域、20–30 个相互关联的来源簇，并包含中文提问—英文材料、条件、冲突、版本、依赖和不可回答控制。不得用模型生成文章、百科填充或同一模板改写来凑 Source 数量。

Stage B 必须与 Stage A 同期生成、计算目录 hash 后密封保存在 benchmark-s200-stage-b-sealed；在我明确说“交付 Stage B”以前，不得上传、概述、粘贴或泄漏其中任何 requiredPoints、requiredEvidence、exactQuote、forbiddenClaims、expectedPath、关系类型或标准答案。

所有 exactQuote 必须逐字存在于对应 Source Snapshot。Research Notes、搜索摘要和模型常识不能充当原文。遇到登录、付费墙、robots、版权、版本或证据问题时记录失败，不得绕过限制或补写正文。

最终先只交付 benchmark-s200-stage-a 文件夹或 zip，并给出目录 hash、来源数、领域/语言/角色/簇分布、重复检查、访问失败、Stage A 泄漏自检和 Stage B 已密封证明。不要把两个阶段放在同一个压缩包。
```

## 1. 角色与成功标准

WorkBuddy 是资料研究员和候选标注员，不是产品架构师、代码施工方或最终事实裁判。

本批要帮助验证两个不同问题：

1. `S200`：知识库扩大后，检索与 Graph 是否仍只读取局部对象，Context 是否保持固定上限；
2. `T0→Tn`：新证据、纠正、替代和冲突到来后，系统能否找到 affected 对象，同时不误伤 unrelated 对象。

这不是新的完整产品 Blind。Stage B 的密封用于避免 Codex 在冻结候选路径前读取答案性标注；Stage B 揭示后的全部数据永久转为 Dev/Regression。

## 2. 必须同时上传给 WorkBuddy 的文件

1. `WGEMemory4LLM-Benchmark.html`
2. `benchmark-s200-workbuddy-contract.md`
3. `workbuddy-batch-a/refined/source-manifest.jsonl`
4. `workbuddy-batch-b/generated/source-manifest.jsonl`
5. `batch-c-stage-a/manifests/source-manifest.jsonl`

可选上传：`WGEMemory4LLM-Product-Definition.html`。不要上传任何历史 Stage B、Gold、评分报告或答案目录。

## 3. 数量与覆盖合同

### 3.1 Source

- 新增目标：`150 ± 10` 份真实 Source Snapshot；
- 领域：8–10 个，每域原则上 14–22 份；
- 来源簇：20–30 个，每簇 4–8 份，至少包含两种来源角色；
- 英文或其他非中文材料不少于 40%；
- 中文公开题面不少于 60%，并至少有 20 题属于“中文提问—英文证据”；
- 至少 60% Source 的 `accessStatus=full`；`metadata-only` 不得进入问题 Gold；
- 至少 20 个固定版本的技术/规范/论文/法规/财报来源；
- 至少 20 个社区或实践来源，但它们只能证明“谁报告了什么”，不能代替规范事实。

优先领域：软件工程、AI 系统、金融与政策、健康与生物、历史与人文、心理与社会科学、设计与无障碍、自然科学/能源。可以增加教育、媒体研究或产品管理，但不得让某一领域超过全批 25%。

### 3.2 来源角色

每个来源簇尽量覆盖：

- `P-primary`：官方规范、监管文本、论文、原始数据、财报、正式公告；
- `C-implementation`：源码、commit、release、issue、勘误、执行细则、数据集；
- `S-analysis`：专业媒体、技术博客、研究解读、微信公众号、B 站公开文字稿；
- `U-experience`：Reddit、X、论坛、GitHub Discussion、从业者体验；
- `H-historical`：被新版本取代但必须保留的历史快照。

来源角色决定它能证明什么。二手解释不能覆盖正式文本，社区样本不能代表整体人群，同主题不等于 SUPPORTS。

### 3.3 问题与 Episode

- Stage A 公开题面：48–64 题；
- 其中 Graph-native 题不少于 24：跨来源依赖、冲突/替代、版本链、影响追踪、为什么答案改变；
- 控制题不少于 20：直接事实、单来源条件、不可回答、观点归属；
- `T0→Tn` Episode：12–20 组，每组 2–5 个时间点或来源；
- 每个 Episode 至少包含 1 个 expected affected、1 个 expected unaffected 和 1 个 post-update 回归问题。

不要故意削弱文件检索基线，不要把 Graph-native 等同于“必须返回一条 Relation”。如果两份材料没有可证明的关系，Gold 应记录无强边。

## 4. 合法性与内容冻结

- 不绕过登录、验证码、robots、付费墙、地域或访问控制；
- 不获取泄漏资料、私人群聊、个人敏感数据或未公开内容；
- 受版权限制来源只保存内部评测所需的连续短摘录、结构和定位，不公开再发布全文；
- GitHub 必须固定到 commit/tag/release，网页必须记录抓取时间，论文必须记录 DOI/版本/勘误或撤稿状态；
- 视频优先使用官方字幕或作者公开文字稿，并保留时间戳；
- Source Snapshot 应保留足够上下文。建议每份 800–4,000 词；受版权限制时至少保留 3–8 个连续、可定位、能覆盖条件与上下文的片段；
- `Source Snapshot` 只能放可核验原文；研究员解释必须放在 `Research Notes`；
- 页面只能获得摘要时设为 `metadata-only`，不得根据摘要恢复正文。

## 5. 与历史资产的四层去重

先从三个历史 manifest 建立 denylist，并输出报告。逐条检查：

1. normalized canonical URL；
2. snapshot/content hash；
3. GitHub repository + commit/tag/release、论文 DOI + version、法规/标准编号 + version；
4. event/topic cluster：即使 URL 不同，同一个公告、论文版本、产品发布或政策事件也不能伪装成新簇。

允许领域重叠，不允许来源簇重叠。数学测试材料也不得通过改标题、翻译或摘录成为“新 Source”。

## 6. Stage A 目录与字段

```text
benchmark-s200-stage-a/
├── README.md
├── contract-manifest.json
├── corpus/<domain>/<sourceId>.md
├── manifests/source-manifest.jsonl
├── questions/questions-public.jsonl
├── episodes/episodes-public.jsonl
└── reports/
    ├── coverage-matrix.md
    ├── source-clusters.jsonl
    ├── overlap-denylist-report.md
    ├── language-role-domain-report.md
    ├── collection-log.md
    ├── unresolved-and-access-failures.md
    └── stage-a-leakage-scan.md
```

### 6.1 Source Markdown

```yaml
---
sourceId: s200-software-example-001
title: "原始标题"
domain: software-engineering
clusterId: cluster-software-example-01
sourceRole: P-primary
platform: official
author: "作者或机构"
canonicalUrl: "https://..."
publishedAt: "ISO-8601 或 unknown"
capturedAt: "ISO-8601"
versionRef: "commit/tag/version/DOI 或 null"
mediaType: documentation
language: en
usage: internal-only
accessStatus: full
snapshotHash: "sha256:..."
artifactHash: "sha256:..."
---

# 原始标题

## Source Snapshot

逐字原文或合法冻结的连续片段。

## Research Notes

- 来源角色和能证明的范围；
- 与同簇其他 sourceId 的候选联系；
- 缺失、争议、版权或访问限制；
- 不得写入会被误认为原文的补充事实。
```

`snapshotHash` 只覆盖规范化后的 Source Snapshot 内容；`artifactHash` 覆盖 UTF-8/LF 的完整 Markdown。`contract-manifest.json` 必须写明规范化算法。

### 6.2 source-manifest.jsonl

每行至少包含 Source frontmatter 全部字段，另加：

```json
{
  "contentPath": "corpus/software-engineering/s200-software-example-001.md",
  "collectionMethod": "official-download | public-api | public-page | manual-excerpt",
  "licenseOrUsageNote": "...",
  "historicalOverlapVerdict": "new-cluster",
  "historicalOverlapEvidence": [],
  "collectionNotes": "..."
}
```

### 6.3 questions-public.jsonl

Stage A 只能包含中性题面：

```json
{
  "caseId": "S200-X-001",
  "status": "candidate-public-sealed-gold",
  "domain": ["software-engineering"],
  "clusterIds": ["cluster-software-example-01"],
  "questionType": "F | C | X | K | T | E | A | U",
  "capabilities": ["cross-source", "version"],
  "question": "中文中性题面",
  "timeScope": "knowledge-as-of:YYYY-MM-DD 或 null",
  "answerability": "answerable | partial | insufficient",
  "difficulty": "direct | two-source | multi-hop | adversarial",
  "languageSlice": "zh-question-en-evidence | same-language | mixed"
}
```

Stage A 严禁出现标准答案、requiredPoints、requiredEvidence、exactQuote、forbiddenClaims、expectedPath、正确 Relation 类型、sourcePriorityRule 的答案性描述或任何 Gold 文件 hash。

### 6.4 episodes-public.jsonl

只公开运行所需的注入顺序：

```json
{
  "episodeId": "S200-EV-001",
  "status": "candidate-public-sealed-gold",
  "domain": "software-engineering",
  "clusterId": "cluster-software-example-01",
  "timeline": [
    {"timepoint": "T0", "sourceIds": ["..."]},
    {"timepoint": "T1", "sourceIds": ["..."]}
  ],
  "publicQuestions": ["..."],
  "changeClassHint": "version-change | correction | dispute | new-evidence"
}
```

不得公开 expected affected、unaffected、旧错禁止项或正确关系。

## 7. Stage B 密封目录

```text
benchmark-s200-stage-b-sealed/
├── README.md
├── seal-manifest.json
├── gold/
│   ├── facts-gold.jsonl
│   ├── relations-gold.jsonl
│   ├── tasks-gold.jsonl
│   └── evolution-episodes-gold.jsonl
└── audit/
    ├── independent-review.jsonl
    ├── disagreements.md
    ├── exact-quote-verification.jsonl
    └── gold-integrity-report.md
```

Stage B 必须在 Stage A 交付前生成、完成独立模型复核并计算整目录 hash，但由用户保管，不能和 Stage A 放在同一个 zip。

### 7.1 tasks-gold.jsonl

```json
{
  "caseId": "S200-X-001",
  "status": "model-reviewed-provisional",
  "requiredPoints": ["原子要点"],
  "acceptableVariants": ["等价表述"],
  "forbiddenClaims": ["丢条件、错归属、过时或无证据断言"],
  "requiredEvidence": [
    {
      "sourceId": "...",
      "exactQuote": "逐字证据",
      "locator": "标题/段落/页码/代码路径/时间戳",
      "role": "supports | refutes | context"
    }
  ],
  "expectedPath": {
    "sourceIds": ["..."],
    "relationTypes": ["REQUIRES | CONTRADICTS | SUPERSEDES | SUPPORTS | NONE"],
    "pathRequired": true
  },
  "sourcePriorityRule": "正式事实、解释和体验的权限边界",
  "answerabilityReason": "...",
  "hardFailureRules": ["..."],
  "reviewStatus": "agreed | disputed"
}
```

`expectedPath` 是评估锚点，不得进入编译、索引、Prompt 或 Stage A。`NONE` 是合法结果，不能为了 Graph 指标制造边。

### 7.2 evolution-episodes-gold.jsonl

```json
{
  "episodeId": "S200-EV-001",
  "status": "model-reviewed-provisional",
  "changeType": "supersede | contradict | narrow | confirm | retract | additive",
  "expectedAffected": ["事实、Claim 候选或稳定问题"],
  "expectedUnaffected": ["至少一个明确控制项"],
  "oldClaimsThatMustChange": ["..."],
  "claimsThatMustRemain": ["..."],
  "forbiddenAfterUpdate": ["..."],
  "chronologyEvidence": [
    {"sourceId": "...", "publishedAt": "...", "exactQuote": "...", "locator": "..."}
  ],
  "preQuestions": ["..."],
  "postQuestions": ["..."],
  "recoveryExpectation": "last healthy snapshot 应保留什么"
}
```

## 8. 独立复核与停止规则

独立复核会话不能读取生成器 reasoning。至少检查：

- exactQuote 逐字存在且支持完整要点；
- 主体、条件、时间、来源角色和版本没有丢失；
- Relation 存在性、类型、方向和条件成立；
- `SUPERSEDES` 没有把局部更新扩大成全量替代；
- `expectedAffected` 与 `expectedUnaffected` 都有材料依据；
- Stage A 没有 Gold 泄漏；
- 与历史 manifest 没有四层重叠；
- 高风险健康/金融条目明确标为待人工复核。

遇到以下情况必须停止交付并修正：

- Stage A 含任一 Gold 字段；
- 规范化 URL、版本链或事件簇重复未披露；
- exactQuote 不可验证率超过 2%；
- `metadata-only` 被用于答案证据；
- 用模型生成正文、翻译改写或模板文章凑 Source；
- 领域、语言或来源角色配额严重失衡；
- Stage B 未在 Stage A 交付前密封；
- 两阶段放进同一压缩包。

## 9. Stage A 完成证明

WorkBuddy 最终 README 必须报告：

1. Source、领域、语言、角色、簇、题目和 Episode 数；
2. 每个文件和整目录 hash 的算法与结果；
3. 与三个历史 manifest 的四层 overlap 结果；
4. full/partial/metadata-only 和访问失败分布；
5. Stage A Gold 字段扫描结果；
6. Stage B 目录 hash、生成时间和“未交付”声明，但不能列出其文件内容 hash；
7. 最需 Codex/人工复核的 20 个高风险项目；
8. 明确请求：只将 Stage A 交给 Codex，Stage B 继续由用户密封保管。
