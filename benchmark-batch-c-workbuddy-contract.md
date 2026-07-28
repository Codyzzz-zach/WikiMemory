# WGEMemory Batch C：WorkBuddy 搜集 Prompt 与两阶段盲测合同

版本：v1.0  
用途：构建小型、跨领域、来源簇隔离的确认性持出集。  
状态边界：WorkBuddy 产物只能标记为 `candidate` 或 `model-reviewed`；未经人类复核不得称为 human Gold。

## 一、给用户的最短操作说明

上传给 WorkBuddy：

1. `WGEMemory4LLM-Benchmark.html`
2. 本文件 `benchmark-batch-c-workbuddy-contract.md`

在 WorkBuddy 对话框发送：

```text
请完整读取我上传的两个文件，以 benchmark-batch-c-workbuddy-contract.md 为本轮强制执行合同。

先执行 Stage A，只交付 batch-c-stage-a 文件夹或 zip。不要在 Stage A 的任何文件、文件名、README、日志或压缩包元数据中放入 requiredPoints、forbiddenClaims、Gold exactQuote、标准答案或关系 Gold。

Stage B 必须独立生成并保存在 batch-c-stage-b-sealed 文件夹中，在我明确说“交付 Stage B”以前不要上传、粘贴、概述或泄漏其内容。Stage A 与 Stage B 只能通过 caseId、factId、relationId 和 sourceId 连接。

默认领域为心理学与研究复现、气候与能源政策、法律与公共政策。若其中某领域无法合法获得高质量来源，可以替换，但不得与现有 AI/科技/金融/数学/健康传播/古卷研究/WCAG 来源簇重叠。

所有来源必须合法获取、可追溯、固定版本；所有 exactQuote 必须逐字存在于对应 Source Snapshot。不能根据搜索摘要、模型记忆或 Research Notes 补写原文。
```

## 二、为什么必须分两次交付

Batch C 要回答的是：在开发者没有见过新题 Gold 时，现有 Compiler、Retrieval 和 Graph 是否能迁移到新领域。

因此：

1. Codex 先冻结代码、运行配置和知识快照；
2. Stage A 才进入仓库，Codex 编译材料并生成全部匿名回答；
3. 回答文件、promptHash、contextHash 和代码版本落盘后禁止覆盖；
4. 用户再交付 Stage B；
5. 评分器只对已封存回答评分，不允许修改后重答；
6. 若首轮失败，首轮仍永久保留。后续修复只能产生新的 post-hoc 诊断轮，不能覆盖 blind baseline。

“回答模型没看到 Gold”还不够。开发者在改代码前也不能看到 Gold，否则仍可能针对题目调参。

## 三、Batch C 最小规模

- 3 个此前未参与开发的新领域；
- 每领域 4 份材料，共 12 份 Source Snapshot；
- 每领域形成一个相互关联的来源簇，而不是 4 篇互不相关的文章；
- 每领域 6 题，共 18 题；
- 每领域 10–15 个事实锚点，共 30–45 个；
- 每领域 2–3 个关系锚点，共 6–9 个；
- 每领域至少 1 个版本变化、纠错、范围收窄或争议 episode。

默认领域：

1. `psychology-reproducibility`：原始论文、预注册/数据、复现或更正、专业讨论；
2. `climate-energy-policy`：官方规则/数据、修订版本、实施材料、专业或社区解释；
3. `law-public-policy`：正式法规/判决/监管说明、修订或解释、实施案例、二手评论。

可以替换领域，但必须在 Stage A README 中说明原因。不得复用 Batch A/B 的 canonical URL、同一 GitHub 仓库、同一标准版本链或同一事件簇。

## 四、每个领域的 4 份材料

每个来源簇尽量包含：

1. `P-primary`：官方规范、法规、原始论文、官方数据或正式公告；
2. `P/C-implementation`：后续正式版本、勘误、数据/代码、GitHub release/issue、执行细则；
3. `S-analysis`：专业媒体、研究解读、官方博客之外的长篇分析；
4. `U/S-response`：社区讨论、从业者经验或另一份立场不同的二手来源。

来源角色决定可回答范围：

- P/C 可以决定“规范写了什么、版本何时变化、实现做了什么”；
- S 只能决定“该作者如何解释”；
- U 只能决定“该用户报告了什么体验”；
- 二手来源不能无条件推翻正式文本；
- 多个相关来源不自动等于独立证据。

## 五、合法性与快照要求

- 不绕过登录、验证码、付费墙、robots、地域限制或访问控制；
- 不复制禁止再分发的完整文章、视频字幕或私人内容；
- 对受版权限制材料只保存必要短摘录、结构化摘要、URL 和定位信息；
- GitHub 固定 commit/tag/release，不使用会漂移的默认分支；
- 论文记录 DOI/版本/撤稿或勘误状态；
- 法规和政策记录法域、生效时间、适用对象和版本；
- X、Reddit、issue 等记录作者、时间、线程上下文和可见的编辑状态；
- 页面只能看到搜索摘要时标记 `metadata-only`，不得伪造正文；
- `Research Notes` 与 `Source Snapshot` 严格隔离；
- 对 Source Snapshot 计算 `snapshotHash`，对完整 Markdown 计算 `artifactHash`，明确 UTF-8 与 LF 规范。

## 六、Stage A：材料与公开题面

### 6.1 目录结构

```text
batch-c-stage-a/
├── README.md
├── contract-manifest.json
├── corpus/
│   ├── psychology-reproducibility/*.md
│   ├── climate-energy-policy/*.md
│   └── law-public-policy/*.md
├── manifests/
│   └── source-manifest.jsonl
├── questions/
│   └── questions-public.jsonl
└── reports/
    ├── coverage-matrix.md
    ├── collection-log.md
    ├── overlap-check.md
    └── unresolved-and-access-failures.md
```

### 6.2 Source Markdown

```yaml
---
sourceId: c-psych-example-001
title: "原始标题"
domain: psychology-reproducibility
sourceRole: P-primary
platform: journal
author: "作者或机构"
canonicalUrl: "https://..."
publishedAt: "ISO-8601 或 unknown"
capturedAt: "ISO-8601"
versionRef: "DOI/version/commit/tag 或 null"
mediaType: paper
language: en
usage: internal-only
accessStatus: full
snapshotHash: "sha256:..."
artifactHash: "sha256:..."
---

# 原始标题

## Source Snapshot

合法冻结的原始文本或必要摘录。

## Research Notes

- 来源角色及其权限边界；
- 与同簇其他来源的候选关系；
- 无法获取或不确定的部分。
```

### 6.3 `questions-public.jsonl`

Stage A 只允许出现中性题面：

```json
{
  "caseId": "C-C-PSYCH-001",
  "status": "candidate-public-blind",
  "split": "batch-c-first-run-holdout",
  "domain": ["psychology-reproducibility"],
  "questionType": "C",
  "capabilities": ["condition-scope"],
  "question": "中性题面，不在措辞中泄漏答案",
  "timeScope": "as-of:YYYY-MM-DD 或 null",
  "answerability": "answerable | partial | insufficient",
  "difficulty": "direct | two-source | multi-hop | adversarial"
}
```

Stage A 严禁出现：

- `requiredPoints`
- `acceptableVariants`
- `forbiddenClaims`
- `requiredEvidence`
- `exactQuote`
- `expectedAnswer`
- `sourcePriorityRule` 的答案性描述
- 任何标准答案、评分理由或“正确关系类型”

### 6.4 18 题固定分布

每个领域各 6 题：

- F：单来源忠实性 1 题；
- C：条件、范围或例外 1 题；
- T/E：时间、版本或纠错演化 1 题；
- X：跨来源综合 1 题；
- K：冲突、来源角色或观点归属 1 题；
- A：材料不足、应拒答或只能 partial 1 题。

不能用同义改写凑数。至少 9/18 题需要两个以上来源，但 B 基线仍必须有公平机会检索到这些来源。

## 七、Stage B：延迟揭示的评分 Gold

### 7.1 目录结构

```text
batch-c-stage-b-sealed/
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
    └── gold-integrity-report.md
```

Stage B 在 Stage A 完成时就必须生成并计算整目录 hash，但不得提前上传。`seal-manifest.json` 记录文件 hash、生成模型、生成时间和审查状态。Stage B 交付后，Codex 将验证其 caseId 与 Stage A 一致、文件 hash 未漂移。

### 7.2 `tasks-gold.jsonl`

```json
{
  "caseId": "C-C-PSYCH-001",
  "requiredPoints": ["答案必须覆盖的原子要点"],
  "acceptableVariants": ["允许的等价表述"],
  "forbiddenClaims": ["材料不支持、过时或丢条件的断言"],
  "requiredEvidence": [
    {
      "sourceId": "c-psych-example-001",
      "exactQuote": "Source Snapshot 中逐字存在的短证据",
      "locator": "标题/段落/页码/行号/时间戳",
      "role": "supports | refutes | context"
    }
  ],
  "sourcePriorityRule": "哪些来源决定正式事实，哪些只代表解释或体验",
  "answerabilityReason": "为何 answerable、partial 或 insufficient",
  "hardFailureRules": ["反转归属、删除条件、伪造证据等"]
}
```

### 7.3 Fact 与 Relation Gold

Fact 必须是原子断言，并逐项记录：主体、谓词、对象、条件、时间、来源角色、逐字证据和不确定性。

Relation 只允许在两个端点均有证据时生成：

- `SUPPORTS`
- `CONTRADICTS`
- `REQUIRES`
- `NARROWS`
- `SUPERSEDES`
- `IMPLEMENTS`
- `REPORTS_EXPERIENCE`

必须说明方向和条件。以下情况不能标成 Relation Gold：

- 两个来源只是在讨论同一主题；
- 两种观点可以同时成立却被写成冲突；
- 后文只是更新而非完全推翻旧文；
- 阅读顺序被误写成知识依赖；
- 需要外部常识才能连接端点。

## 八、独立审查要求

WorkBuddy 完成候选后，应由另一个独立模型/会话进行审查，审查者不能读取生成器 reasoning。至少检查：

1. exactQuote 是否逐字存在；
2. quote 是否支持完整 Claim；
3. 条件、时间、主体和来源角色是否丢失；
4. Relation 是否真实存在、类型和方向是否正确；
5. answerability 是否超过材料；
6. 题面是否泄漏答案；
7. Stage A 是否意外包含 Gold 字段；
8. 与 Batch A/B 的 URL、仓库、标准链和事件簇是否重叠。

所有分歧写入 `disagreements.md`，不得用多数投票静默掩盖。若没有人类复核，最终状态写 `model-reviewed-provisional-gold`。

## 九、两阶段交付合同

### Codex 接收 Stage A 后

1. 验证目录、hash、来源合法性和新来源簇隔离；
2. 冻结 Git commit、运行配置、模型名、temperature、上下文预算和题目文件 hash；
3. 编译 12 份材料；
4. 运行离线 Evidence/Graph/预算检查，但不读取 Gold；
5. 对 18 题生成 `B / P-seed / P-graph` 回答并封存；
6. 输出回答目录 hash 和完成证明；
7. 明确请求用户交付 Stage B。

### 用户交付 Stage B 后

1. 验证 seal hash 与 caseId 对齐；
2. 确认回答时间早于 Gold 揭示时间；
3. 仅评分已封存回答；
4. 报告逐题配对差值、证据召回、条件保真、引用有效性、token 成本和 hard failure；
5. 抽检 Relation 增益是否来自忠实路径，而非上下文噪声或裁判偏差；
6. 第一轮报告永久只读，任何修复进入新的 post-hoc runId。

## 十、停止规则

- Stage A 出现 Gold 泄漏：整批降级为 development，不再称 holdout；
- 与 Batch A/B 来源簇重叠：替换来源后重新封存；
- exactQuote 不可验证率超过 5%：不运行在线实验；
- Relation 独立审查精度低于 90%：Graph 指标暂停，只跑 B/P-seed；
- 编译出现断证据、归属反转或无条件替代：先修 Compiler，不揭示 Stage B；
- 在线回答格式错误或硬失败超过 25%：停止扩大运行；
- 不得因预期分数不好而更换题目、Gold 或删除失败样本。

## 十一、WorkBuddy 完成前自检

1. Stage A 12 个来源、18 个中性题面齐全；
2. Stage A 不含任何 Gold 字段或答案性说明；
3. Stage B 与 Stage A caseId 完全一致；
4. 所有 exactQuote 逐字存在于 Source Snapshot；
5. 所有 hash 可按文档边界复算；
6. 3 个来源簇均与现有 Batch A/B 隔离；
7. 每领域至少覆盖 P、实现/修订、专业解释、社区/二手反应；
8. 每领域包含 F/C/T-or-E/X/K/A 各一题；
9. 不确定、访问失败和审查分歧全部留痕；
10. Stage B 保持封存，等待用户明确索取。
