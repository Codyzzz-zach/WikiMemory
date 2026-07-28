# Codex 审计报告：WGEMemory Benchmark Seed Batch A

审计日期：2026-07-27  
审计对象：`workbuddy-batch-a/`  
结论：**候选资料库通过；Gold 数据集暂不通过；可以抽取 12 题 provisional canary，但不能直接用全部 62 题驱动架构优化。**

## 1. 总体裁决

WorkBuddy 的交付不是空壳，实际文件完整存在，且在“候选资料生产”层表现合格：

- 12 份材料、manifest、84 facts、19 relations、62 tasks、3 episodes 均存在且 JSONL 可解析；
- 所有 ID 唯一，所有产物保持 `status: candidate`；
- manifest 与 12 个 Markdown 文件一一对应；
- 本地 Source Snapshot 中，所有 facts / relations / tasks / episodes 的 `exactQuote` 都能逐字找到；
- 关键官方内容已抽样对照 MCP GitHub PR、Redis 官方博客、NVIDIA 官方新闻稿，主体数字与版本事实没有发现伪造；
- 没有静默隐藏访问失败、版权限制和二手来源风险。

但它还不能成为 Gold，原因不是格式，而是语义审计尚未过关：

1. 9/12 个 `contentHash` 无法与本地整文件、去 frontmatter 内容或 Source Snapshot 对应；
2. `exactQuote` 虽然存在，但多条只支持 Claim 的一部分；
3. 24 条 `RISK-*` 混合了来源事实与测试设计者解释，不应作为 Gold Fact；
4. Relation 中大量“观点并存”被错误标成 `CONTRADICTS`，或把阅读上下文误标成知识依赖；
5. 一些任务要求作出技术选型、法律义务或投资判断，但语料不足以支撑，`answerability` 标得过强；
6. 当前只有 3 个主题簇，不能建立真正盲测 split，更不能宣称跨领域泛化。

因此，本批正确定位是：

> **可用的候选语料与问题原料，不是可直接评分的人工 Gold。**

## 2. 自动一致性审计

| 检查项 | 结果 | 裁决 |
|---|---:|---|
| Source 文件 | 12 | 通过 |
| manifest | 12 | 通过 |
| Fact candidates | 84 | 通过格式检查 |
| Relation candidates | 19 | 通过格式检查 |
| Task candidates | 62 | 通过格式检查 |
| Evolution episodes | 3 | 通过格式检查 |
| 重复 ID | 0 | 通过 |
| 非 candidate 状态 | 0 | 通过 |
| 未知 evidence sourceId | 0 | 通过 |
| Relation 悬空端点 | 0 | 通过 |
| exactQuote 不在本地文件 | 0 | 通过 |
| exactQuote 落在 Research Notes 而非 Snapshot | 0 | 通过 |
| 规范化后完全重复 Fact/Question | 0 | 通过 |
| manifest hash 可复算 | 3/12 | **不通过** |

### Hash 问题的准确含义

12 条 manifest 都“有 hash”，但只有以下 3 条能复算为当前 Source Snapshot 的 SHA-256：

- `ai-mcp-latent-003`
- `tech-redis-antirez-003`
- `fin-nvda-21jingji-003`

其余 9 条 hash 可能来自抓取中间态、HTML 抽取前文本或另一种规范化结果，但交付物没有记录 hash 对象与算法输入。因此，“contentHash 全覆盖”只能理解为字段非空，不能理解为快照完整性已建立。

修复要求：

- 原有 `contentHash` 保留并改名为 `upstreamCaptureHash`（如果能说明其对象）；
- 对交付 Markdown 的 `Source Snapshot` 统一计算 `snapshotHash`；
- 对整份 Markdown 计算 `artifactHash`；
- hash 算法、换行规范和截取边界写进 manifest schema。

## 3. Fact 审计

### 3.1 24 条 RISK 项必须移出 Gold Fact

所有 `RISK-AI-*`、`RISK-TECH-*`、`RISK-FIN-*` 都包含“容易被误读”“不能据此概括”“这是典型夸大”等测试设计者解释。这些内容可能非常有价值，但它们不是来源直接陈述的原子事实。

处理方式：

- 不删除；
- 从 `facts.jsonl` 移到 `adversarial-risks.jsonl`；
- 字段拆成 `sourceFact`、`failurePattern`、`forbiddenGeneralization`、`requiredConditions`；
- 不允许 Compiler 把风险说明摄入为知识 Claim。

### 3.2 至少 16 条普通 Fact 的 evidence span 需要扩展或 Claim 收缩

下列 Claim 的当前 exactQuote 只支持部分语义：

| Fact | 问题 |
|---|---|
| FACT-AI-001 | quote 只说“两种”，没有包含 stdio 与 HTTP+SSE 的列表。 |
| FACT-AI-004 | quote 只说“两个端点”，没有包含两个端点的类型。 |
| FACT-AI-008 | quote 只有合并时间，不支持“创建于 2025-03-17”。 |
| FACT-AI-012 | quote 只有“2024-11 发布”，不支持热度回落与 Summit 后爆发的完整时间线。 |
| FACT-AI-015 | quote 只支持 SWE-Bench 来源，不支持附加的 Building Effective Agents。 |
| FACT-AI-018 | quote 只显示评论者批评“假装开源”，没有包含被批评条款的具体竞业内容。 |
| FACT-TECH-001 | quote 只支持“不再 BSD”，没有支持 Redis 7.4、RSALv2+SSPLv1 的完整组合。 |
| FACT-TECH-003 | quote 支持“不能免费使用”，没有直接支持“必须达成商业许可条款”的完整法律结论。 |
| FACT-TECH-006 | quote 支持“AGPL 是新增选项”，但“既有许可未撤回”需 Redis 8 tri-license 证据。 |
| FACT-TECH-017 | quote 支持已迁移并投入数百小时，没有支持“不打算迁回”。 |
| FACT-TECH-018 | quote 支持“被迫购买企业许可”的评论，不支持完整的“双赢打法”概括。 |
| FACT-TECH-019 | quote 支持未来仍可改许可，没有支持“仍应庆祝”。 |
| FACT-TECH-020 | quote 支持“许多组织禁止 AGPL”，没有包含 Google 政策链接的事实。 |
| FACT-FIN-015 | quote 是媒体的“阉割版”说法，Claim 改写成“合规版”，需要另一条证据。 |
| FACT-FIN-017 | quote 只支持“AI 行业极度高估”，没有覆盖“不是贸易战”和“泡沫”的完整 Claim。 |
| FACT-FIN-020 | quote 只支持“泡沫破裂”，没有支持 DeepSeek-r1 与 NVDA 见顶的完整因果归因。 |

这 16 条应标记 `repair-evidence`，不能以当前形态升级 Gold。其余普通 Fact 只能称为“初审通过”，仍需在冻结前进行第二人/第二模型独立审查。

### 3.3 关键措辞修复

- NVIDIA 原文是 `China-based customers`。当前任务和 episode 多处写成“中国大陆客户”，增加了原文没有的地理精度。Gold 应保留为“中国客户/总部或经营主体位于中国的客户”，除非另有官方定义。
- `author-opinion`、`prediction`、`experience` 即使逐字忠实，也不能被系统当作无归属世界事实。
- Redis 许可义务属于法律问题。没有冻结 RSALv2、SSPLv1、AGPLv3 正式许可文本时，只能回答“官方博客如何描述”，不能给出完整 SaaS 合规结论。

## 4. Relation 逐条裁决

| Relation | 裁决 | 原因 |
|---|---|---|
| REL-AI-001 | 修复后可用 | supersede 方向合理；必须补 2025-03-26 正式规范，当前只能写“PR 提议/实现”。 |
| REL-AI-002 | 拒绝 | OpenAI 支持 MCP 不等于“OpenAI 没有支持其他标准”；条件预言的前提不能这样判为被 CONTRADICT。 |
| REL-AI-003 | 初审通过 | 可以表达发布初期社区/开发者反应，但不代表总体社区。 |
| REL-AI-004 | 拒绝 | 同一来源支持由自己生成的 Fact，信息增量低；当前 quote 也不足以支持完整时间线。 |
| REL-AI-005 | 拒绝 | “理解动机需要旧背景”不是知识语义上的 REQUIRES，且 conditions 为空。 |
| REL-TECH-001 | 初审通过 | 部分 supersede 合理，条件已保留 AGPL 为新增第三选项。 |
| REL-TECH-002 | 初审通过 | 支持关系成立，但两文同日且互相引用，不能算独立证据增强。 |
| REL-TECH-003 | 初审通过 | 个体迁移经验是对官方许可变化的社区反应，scope 已限定。 |
| REL-TECH-004 | 拒绝 | “部分组织禁止 AGPL”不收窄“Redis 是开源软件”这一事实，只影响部分企业可采用性。端点错位。 |
| REL-TECH-005 | 初审通过 | 两个有利益关联的一手/当事人来源对 SSPL 地位给出一致陈述；独立性需降权。 |
| REL-TECH-006 | 拒绝 | “我不再信任”与“仍值得庆祝”可以同时成立，不构成 CONTRADICTS。 |
| REL-FIN-001 | 改类型 | 预告 55 亿到实际 45 亿是 `SUPERSEDES/UPDATES_ESTIMATE`，不是 NARROWS。 |
| REL-FIN-002 | 初审通过 | 实际结果取代先前指引，时间与方向清楚。 |
| REL-FIN-003 | 改端点 | HN 是对同一事件的反应，不是对 21 财经 Fact 的 experience；应连接事件 Concept。 |
| REL-FIN-004 | 拒绝 | 80 亿指引损失与对华零销售/海外 6.5 亿并非直接 NARROWS，口径不同且不能相互推出。 |
| REL-FIN-005 | 拒绝 | 营收增长不能反驳估值泡沫观点，候选自身也承认不能证伪。 |
| REL-FIN-006 | 初审通过 | 二手转述与官方稿在 4 月 9 日、许可证要求上相互印证；更宽细节仍只归属二手来源。 |
| REL-AI-006 | 拒绝 | “某评论者参与项目”这一 Fact 不能 IMPLEMENTS 一份规范；from 端点和类型都不成立。 |
| REL-TECH-007 | 拒绝 | 商业动机与社区修复动机可以同时成立，不构成 CONTRADICTS。 |

结果：

- 初审可用：7/19；
- 修复类型、端点或补来源后可用：3/19；
- 拒绝：9/19。

这说明候选生成器的 Fact 能力明显强于 Relation 能力。**在关系修复前，不得用这 19 条边作为 Graph recall/precision 的 Gold。**

## 5. Task 与 answerability 审计

### 5.1 当前不可直接冻结的高风险任务

以下任务需要改题、补来源或降低 answerability：

- `X-AI-001`：询问 2025-03-26 正式规范，但正式规范未冻结；应改成“按 PR #206”。
- `K-AI-001`：条件预言逻辑错误，OpenAI 支持 MCP 不能证明其没有支持别的标准。
- `E-AI-001`、`E-AI-002`：作为正式版本演化题前需补 2025-03-26 规范。
- `U-AI-001`、`U-AI-002`：当前材料不足以做 2025 年采用决策或完整 SDK 改造清单，应标 `partial`。
- `R-TECH-003`：题目暗示 antirez “推动许可证变更”，而材料明确警告不能这样归功。
- `C-TECH-001`：没有正式 RSALv2 文本，不能确定企业内部使用的完整限制。
- `C-TECH-002`、`E-TECH-002`：需要 Redis 8 tri-license 和 AGPLv3 正式文本。
- `U-TECH-001`：属于法律/许可合规建议，当前博客材料不足，必须标 `partial` 并要求咨询正式许可。
- `F-FIN-003`、`E-FIN-001`：把 `China-based customers` 擅自缩成“中国大陆”，且 E-FIN-001 使用“仅 6.5 亿”过强。
- `E-FIN-002`、`U-FIN-001`：材料可支持风险摘要，不能支持完整未来披露或投资判断；应保持 `partial`。
- `U-FIN-002`：依赖版权受限媒体片段，必须限定只能列“片段提出的未决问题”。
- `A-FIN-001`：Q2 新闻稿其实包含 Q3 指引——未假设对华 H20 出货，但没有给出独立 H20 销售额；应标 `partial`，不是简单 `insufficient`。

### 5.2 可用于首轮 provisional canary 的 12 题

这些题结构清楚、证据本地可解析，并覆盖三个领域。它们仍是 provisional，不是最终人工 Gold：

#### AI

- `F-AI-001`
- `F-AI-003`
- `R-AI-001`
- `C-AI-002`

#### Technology

- `F-TECH-004`
- `X-TECH-001`
- `K-TECH-002`
- `T-TECH-002`

#### Finance

- `F-FIN-001`
- `R-FIN-001`
- `C-FIN-001`
- `X-FIN-001`

Canary 用途仅限：验证数据装载、证据解析、题目运行记录和错误归因壳。不得根据这 12 题的总分修改架构，也不得宣称跨域产品效果。

## 6. Evolution Episode 裁决

| Episode | 裁决 | 必须修复 |
|---|---|---|
| EV-AI-001 | 暂停冻结 | 补 2025-03-26 正式规范；把“PR 设计”与“正式规范事实”分开。 |
| EV-TECH-001 | 修复后可用 | 明确 Redis 8 是 AGPLv3 + RSALv2 + SSPLv1 tri-license；补正式许可文本；不要把博客解释当完整法律义务。 |
| EV-FIN-001 | 修复后可用 | 将“中国大陆”改为 `China-based customers` 的忠实中文；删除“仅 $650M 海外”这种排他性表达。 |

本批可以测试“版本前后数据结构”，但当前 0/3 episode 可直接成为最终 Evolution Gold。

## 7. Split 裁决

WorkBuddy 建议 AI/金融=dev、科技=test。该方案不应采用：

- 每个领域只有一个主题簇；
- 把整个科技域放 test，测试的是领域差异，不是同分布泛化；
- `test` 已在交付报告中公开，不能再称 blind holdout；
- 同一来源簇内的事实、关系、题目高度相关，必须整体切分。

本批所有资产应暂时进入 `inbox/dev-candidate`。等 Batch B 提供新的作者、主题和时间簇后，再按来源簇分配 validation/holdout。

## 8. 下一步 Goal

下一 Goal 不应是“跑 62 题”，而应是：

### Goal：Batch A Gold Refinement v1

目标：

1. 修复 12 份材料的可复算 hash；
2. 将 24 个 RISK 项迁移为 adversarial risk schema；
3. 修复至少 16 条 evidence 不完整 Fact；
4. 按本报告逐条处理 19 条 Relation；
5. 修复高风险任务的 answerability 与措辞；
6. 补 MCP 2025-03-26 正式规范、Redis 正式许可文本；
7. 生成 12 题 canary manifest，并只跑结构/证据链验证。

完成门槛：

- 所有 snapshotHash/artifactHash 可复算；
- Gold Fact 的完整 Claim 被其 evidence span 支持；
- Relation Gold 人工/独立审计 precision 目标 ≥90%；
- 不把观点冲突误当事实冲突；
- 法律、金融、版本问题的 answerability 不超过现有证据；
- canary 运行只验证管道，不用于调参奖励。

完成该 Goal 后，才进入 Batch B 资料扩展和第一个 20–40 题 Goal Micro。

## 9. 外部抽样复核来源

- MCP PR #206：`https://github.com/modelcontextprotocol/modelcontextprotocol/pull/206`
- Redis 2024 双许可公告：`https://redis.io/blog/redis-adopts-dual-source-available-licensing/`
- Redis 8 / AGPLv3：`https://redis.io/blog/agplv3/`
- Redis 8 GA tri-license 补充：`https://redis.io/blog/redis-8-ga/`
- NVIDIA Q1 FY2026：`https://nvidianews.nvidia.com/news/nvidia-announces-financial-results-for-first-quarter-fiscal-2026`
- NVIDIA Q2 FY2026：`https://nvidianews.nvidia.com/news/nvidia-announces-financial-results-for-second-quarter-fiscal-2026`

外部抽样复核只能证明关键来源主体真实，不能替代逐条 Gold 审计。
