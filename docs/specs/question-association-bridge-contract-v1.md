# C1.5-A · Question Association Bridge 合同 v1

> 状态：Accepted — 2026-08-26；零调用 fixture/Gate 已冻结，provider 数据发送仍需单独授权
> 上游裁决：C1-D `REWORK_UPSTREAM_QUESTION_ASSOCIATION`
> 阶段位置：C1.5 `Question Hypothesis Persistence` 的前置窄切片；不是 C1 补丁
> 知识边界：仅使用人主动选择并已编译的 Canonical Knowledge

## 1. 为什么先做 Bridge

C1-D 发现 18 个 I3-Sim Episode Sources 中只有 12 个进入 7 个预注册焦点
QuestionFrames。Claim 级回放进一步证明，另外 6 个 Source 并未丢失：它们形成或更新了 Go
模块基础、Go 版本变化、DMA 消费者影响、公众看法、已指定企业等其他问题。

因此，“Source 没进入焦点问题”不能直接等价为 Question association 失败。它混合了至少四种
不同事件：

1. 正确挂接：Claim 确实会更新已有问题；
2. 正确拒绝：材料与领域相关，但 Claim 不在该问题边界内；
3. 错误挂接：相邻主题、元数据或批量 proposal 被整体塞入已有问题；
4. 错误新建：本应更新已有问题，却形成了语义重复或碎片化问题。

Bridge 的任务不是提高挂接率，而是先让这四种事件可区分、可追溯、可重放。只有它通过，C1
才有资格使用完整的跨材料时间序列继续真实语义切片。

## 2. 唯一阶段问题

在冻结的 Canonical Claims 与冻结的 QuestionHypothesis 候选集上，WikiMemory 能否对每个
`Claim × QuestionHypothesis` 关系给出 grounded 的：

```text
ATTACH | REJECT | UNCERTAIN
```

并同时避免：

- 为追求 coverage 把相邻主题或 Source 元数据过度挂接；
- 因问题措辞变化或证据闭包不可见而错误新建；
- 在证据不足时强制二选一；
- 把一次关联裁决误写成问题成熟、promotion、merge 或 split。

## 3. Primary Variable

唯一实验变量是：**语义裁决时已有 QuestionHypothesis 的表示**。

### A0 · 当前名称卡片

保持当前 `question-proposer` 输入：

- canonical question；
- aliases；
- boundaries；
- domain / scope；
- lifecycle。

### A1 · 证据身份卡

在 A0 的基础上，只增加由冻结状态确定性生成的：

- 最多 6 条代表性既有关联 Claim，优先跨 Source、跨知识版本和边界维度；
- 每条 Claim 的可解析 Evidence ref，不发送 Wiki 文本作为证据；
- 追加式 CREATE / UPDATE 历史摘要及 source/knowledge-version 多样性；
- 明确的 in-bound / out-of-bound 提示，仍以既有 boundaries 为权威输入；
- 被确定性裁剪掉的 Claim 数量与裁剪理由。

A0 与 A1 使用完全相同的 Claim、候选 Question 集、模型、提示、温度、输出 schema 和调用批次。
候选召回在本轮由 fixture 冻结，不把 candidate retrieval 作为第二个变量。

## 4. Association 语义

### 4.1 ATTACH

只有当 Claim 在问题边界内，且它能够支持、反驳、限域、取代、改变当前状态，或明确暴露该问题
的 Evidence Gap 时，才可 `ATTACH`。仅仅主题相近、来自同一 Source、包含相同实体或描述帖子/
Issue 元数据，不足以挂接。

### 4.2 REJECT

以下情况应 `REJECT`：

- 超出 boundaries 或 scope；
- 只与同一大领域相关；
- 只描述 Source、帖子、作者、日期、分数、评论数量等元数据，且不能改变问题状态；
- 只回答相邻问题；
- 当前 Claim 没有足够内容支持任何有效更新。

`REJECT` 不表示 Source 无价值，也不阻止该 Claim 挂接到其他问题。

### 4.3 UNCERTAIN

当 Claim 可能影响该问题，但因内容截断、authority、适用范围、边界重叠或候选问题竞争而无法可靠
判定时，应保留 `UNCERTAIN`。它是合法终局，不被折算成低置信度 ATTACH。

### 4.4 多对多

一个 Claim 可以挂接多个长期问题，也可以不挂接当前候选集中的任何问题。Bridge 不要求唯一
Question owner，也不因存在一个 ATTACH 而自动拒绝其他候选。

## 5. 影子输出合同

```ts
interface QuestionAssociationDecision {
	claimRef: ClaimRef;
	questionRef: QuestionRef;
	verdict: "ATTACH" | "REJECT" | "UNCERTAIN";
	reasonCodes: QuestionAssociationReasonCode[];
	groundedClaimRefs: ClaimRef[];
	groundedEvidenceRefs: EvidenceRef[];
	groundedQuestionClaimRefs: ClaimRef[];
	boundaryNotes: string[];
	competingQuestionRefs: QuestionRef[];
}
```

最小 reason codes：

```text
IN_BOUND_SUPPORT
IN_BOUND_CHALLENGE
IN_BOUND_CONDITION
IN_BOUND_SUPERSESSION
EXPLICIT_GAP_SIGNAL
OUT_OF_BOUNDARY
ADJACENT_QUESTION_ONLY
SOURCE_METADATA_ONLY
INSUFFICIENT_CLAIM_CONTENT
AUTHORITY_OR_APPLICABILITY_UNCLEAR
BOUNDARY_OVERLAP
COMPETING_QUESTION
UNRESOLVED_EVIDENCE
UNKNOWN_REFERENCE
```

自由文本 rationale 只作解释，不能替代 reason code 和 grounded refs。

## 6. 冻结输入切片

### 6.1 权威运行状态

- I3-Sim manifest：`benchmarks/i3-sim-gate-v1/manifest.json`
- manifest SHA-256：`5e1b2197318fcaccb1a938cc6253bf38ca19e5d2ad9db13aaf6aaf759aca157b`
- 隔离 runtime：`/private/tmp/wikimemory-i3-sim-gate-v1-4998dfa`
- Question state SHA-256：`da1df59a5058852f6c25184c86577410ccdd53eda050043265929cbc9c12f300`

runtime 路径不是长期仓库依赖。合同接受后的第一步必须把本轮需要的最小 Claim、Question card、
Evidence refs 和 oracle 抽取为仓库内只读 fixture，并对每个文件重新记录 SHA-256；不得把 raw LLM
output、回答或运行日志复制进知识输入。

已冻结仓库内输入：

- `benchmarks/question-association-bridge-v1/oracle.json`：
  `c40fbac9be60488d737c047c3670106fbd3c176b59f3844ff5b9e28d6c22b78c`，provider 不可见；
- `benchmarks/question-association-bridge-v1/input.json`：
  `85d7ee87e29e2bde331cc6c8744f4f1e5dd58a160bed389cb70b08020c6ee05c`，只作本地重放；
- `benchmarks/question-association-bridge-v1/manifest.json`：记录 10 个事务前快照、6 个 provider
  payload 及各自 hash；
- 每个 case 的 Question 都来自该 Source 对应事务的 `beforeQuestionStateHash`；fixture builder
  拒绝当前 Source 或当前 Claim 出现在 prior question closure 中。

### 6.2 预注册语义对

第一轮冻结 18 个 `Claim × Question` 对，每个领域 6 个：

| Domain | Hard ATTACH | Hard REJECT | UNCERTAIN |
|---|---:|---:|---:|
| psychology | 2 | 3 | 1 |
| technology | 2 | 3 | 1 |
| law | 3 | 2 | 1 |
| 合计 | 7 | 8 | 3 |

精确预注册 pair 如下；Question 文本只用于人工阅读，stable ID 才是 fixture identity：

| Case | Claim ref | Question ref | Oracle | 冻结理由 |
|---|---|---|---|---|
| QAB-PSY-01 | `claim:6d554407ab44ff34-0c8dc4245d643e17` | `question:216bff0a347664f84a379395` | ATTACH | 直接断言助推文献存在严重发表偏倚 |
| QAB-PSY-02 | `claim:ba1c34566ae9e463-bfc65f5a6b7083c3` | `question:fd7afd5d18a0abcdba1c8a83` | ATTACH | 后续 Source 直接重申校正后的有效性结论 |
| QAB-PSY-03 | `claim:ba1c34566ae9e463-bfc65f5a6b7083c3` | `question:216bff0a347664f84a379395` | REJECT | 校正后的有效性结论不估计发表偏倚程度 |
| QAB-PSY-04 | `claim:077188d7915ccaf6-623c7ec174c1f376` | `question:216bff0a347664f84a379395` | REJECT | 只有 PNAS URL，不能改变偏倚估计或状态 |
| QAB-PSY-05 | `claim:077188d7915ccaf6-e6ecbd107ba7a8f2` | `question:fd7afd5d18a0abcdba1c8a83` | REJECT | 只有 Hacker News 线程 identity，不能支持校正结论 |
| QAB-PSY-06 | `claim:077188d7915ccaf6-0abcbd113352d05c` | `question:216bff0a347664f84a379395` | UNCERTAIN | 评论提出如何处理发表偏倚，但没有给出可裁定答案 |
| QAB-TEC-01 | `claim:661ef155a51cdc7e-df82c6beb329bc37` | `question:9461145467c7b99470b61313` | ATTACH | Proposal-Accepted 标签直接记录提案正式化过程 |
| QAB-TEC-02 | `claim:661ef155a51cdc7e-2e19fd12dba9857d` | `question:9461145467c7b99470b61313` | ATTACH | Issue 创建时间直接构成演进时间线 |
| QAB-TEC-03 | `claim:ec6a188223216072-8f626dea7924fecb` | `question:fd46a361f2c948a98df8f9f1` | REJECT | Go 1.25 一般语言变化不回答模块引入/默认化 |
| QAB-TEC-04 | `claim:d32360156bddb0d4-44650e066d4eeb68` | `question:fd46a361f2c948a98df8f9f1` | REJECT | 模块定义不回答引入/默认化时间线 |
| QAB-TEC-05 | `claim:d32360156bddb0d4-579f7f34ab0e22c5` | `question:fd46a361f2c948a98df8f9f1` | REJECT | 依赖管理用途不回答引入/默认化时间线 |
| QAB-TEC-06 | `claim:661ef155a51cdc7e-44d6591607d02f34` | `question:cf8cead85caf83ea0864ad3c` | UNCERTAIN | 后续 Issue 标题涉及 cmd/go 的版本支持，但不足以强判对 go get/工作流的具体影响 |
| QAB-LAW-01 | `claim:0cbb0a59d7c7bc5f-a745403624af6a75` | `question:6374d223d73b203bbcfb1990` | ATTACH | 直接给出 gatekeeper 用户门槛 |
| QAB-LAW-02 | `claim:f683e568138750f5-630f3d809049fa51` | `question:ef16109045a63c30da83cf06` | ATTACH | 直接列出六家 designated gatekeepers |
| QAB-LAW-03 | `claim:fd5e90d9512564b9-751b7c23e954de25` | `question:be6b53e7bf2a2bdff306f6a9` | ATTACH | 后续 Source 直接记录公众围绕 iMessage designation 的看法 |
| QAB-LAW-04 | `claim:8eb1b229ffa0652c-7e363db416ec1d1c` | `question:6374d223d73b203bbcfb1990` | REJECT | 硬件价格影响不回答 designation criteria/process |
| QAB-LAW-05 | `claim:f683e568138750f5-2c51784f3d0a04b7` | `question:be6b53e7bf2a2bdff306f6a9` | REJECT | 线程创建日期不能改变公众/专家看法 |
| QAB-LAW-06 | `claim:fd5e90d9512564b9-751b7c23e954de25` | `question:6374d223d73b203bbcfb1990` | UNCERTAIN | 同一后续 Claim 与 designation 有关，但缺少正式 criteria/process 内容 |

这 18 个样本同时覆盖：

- 已被当前系统正确 UPDATE 的跨来源正例；
- 当前批量 proposal 中疑似被整体挂接的元数据负例；
- 与焦点 Question 同领域但明确越界的负例；
- iMessage designation、发表偏倚评论和 package-version/module 边界等真实歧义；
- 至少一个 Claim 可对不同候选产生不同 verdict 的多对多哨兵。

oracle 在任何 provider 调用前冻结，单独存储，绝不发送给模型。Hard 标签只允许使用材料文本、
Question boundaries 与 Evidence refs 裁决；无法形成强证据的样本必须标为 UNCERTAIN，不能为平衡
数量强造 Gold。

### 6.3 外部正例哨兵

I2.5 数学验收中的三个稳定跨材料 UPDATE 只作 replay 正例：Hilbert、Banach、变分法/
Euler–Lagrange。它们验证 Bridge 没有破坏已经成立的跨来源复用，不用于调提示或补齐 I3 标签。

## 7. 验收函数

```text
QAB_ACCEPT(r) =
  InputBoundary(r)
  AND GroundedDecisions(r)
  AND HardPositivePreservation(r)
  AND NoFalseAttach(r)
  AND AmbiguityPreservation(r)
  AND ManyToManySemantics(r)
  AND NoCanonicalMutation(r)
  AND Replay(r)
  AND Isolation(r)
  AND MarginalValue(r)
  AND CostWithinBudget(r)
```

### G1 · InputBoundary

- 只读取冻结 Canonical Claim、Evidence refs、QuestionFrame 与 evolution decisions；
- 不读取 Agent run、对话、工具轨迹、Pilot outcome、回答或 Benchmark Gold；
- Question/Wiki 文本不能成为 Claim 的支持证据。

### G2 · GroundedDecisions

- 18/18 决策引用已知 Claim 与 Question；
- ATTACH 必须至少引用输入 Claim、可解析 Evidence 和问题身份卡中的既有 Claim 或 boundary；
- REJECT/UNCERTAIN 必须给出允许的 reason code 与可检查的 boundary note；
- 任一未知引用、虚构证据或未解析 Evidence 均 fail-closed。

### G3 · HardPositivePreservation

- 7/7 Hard ATTACH 均不得被裁成 REJECT；
- I2.5 三个 replay 正例保持命中既有稳定 ID；
- 不以创建新问题补偿漏接。本阶段根本不允许 CREATE。

### G4 · NoFalseAttach

- 8/8 Hard REJECT 中 `false ATTACH = 0`；
- `SOURCE_METADATA_ONLY`、同领域和实体重叠不能被 coverage 目标豁免；
- 这是最高优先级门禁，不用平均准确率抵消。

### G5 · AmbiguityPreservation

- 3/3 UNCERTAIN 不得在缺少新增 grounded 信息时被强制 ATTACH；
- 若输出 REJECT，必须明确证明越界，而不是只给低置信度措辞；
- 若 A1 仍无法解除歧义，保留 UNCERTAIN 即为正确结果。

### G6 · ManyToManySemantics

- 同一 Claim 对不同 Question 可以产生不同 verdict；
- 一个 ATTACH 不会静默删除其他候选；
- 无候选适合时允许全部 REJECT/UNCERTAIN。

### G7 · NoCanonicalMutation

- 全部运行只写隔离 shadow artifact；
- QuestionFrame、lifecycle、formationSignals、WikiModule、Canonical Claim 与 Context Pack 均不变；
- 不执行 promotion、merge、split、archive、reopen 或 materialization。

### G8 · Replay / Isolation

- 相同输入和配置产生相同的确定性 card、case manifest、hash 与 Gate 结果；
- 调换 case 顺序、Source 标题措辞和无关哨兵不得改变已裁决 pair；
- domain/scope 不交叉污染。

### G9 · MarginalValue

A1 必须在不增加任何 Hard false attach/false reject 的前提下，纠正至少 1 个 A0 错误或把至少 1 个
无依据的 A0 强判恢复为 UNCERTAIN。若 A0 与 A1 都通过全部语义门禁，则裁决
`NO_MARGINAL_VALUE`，不集成更重的身份卡。

### G10 · CostWithinBudget

以下预算已于 2026-08-26 被产品负责人接受：

- 3 个领域 × A0/A1 各 1 个批次：计划 6 次 answer-free association calls；
- 只允许因 JSON/schema 失败进行最多 2 次 repair，总上限 8 calls；
- provider input + output 总上限 90,000 tokens；
- 单次输出上限 4,096 tokens；
- 人工语义复核上限 60 分钟；
- 不调用回答模型，不重新编译材料，不做大规模 Blind。

精确 provider payload 发送仍需单独授权；取得授权前外部调用保持为 0。历史 DeepSeek 授权不自动
延伸到本阶段。

## 8. 结果分支与停止线

| 结果 | 条件 | 后续 |
|---|---|---|
| `PASS_IDENTITY_CARD` | A1 通过全部 Gate，且满足边际价值 | 才允许起草生产 proposer 的窄集成合同 |
| `NO_MARGINAL_VALUE` | A0/A1 均通过，A1 无额外价值 | 保留轻量表示，不集成 A1 |
| `REWORK_ASSOCIATION_SEMANTICS` | 正负例或歧义门禁失败，但责任层清晰 | 固化最小失败，不追加同轮调用 |
| `NARROW_TO_DETERMINISTIC` | 模型只在可确定规则上有效 | 将能力缩为 deterministic Gate |
| `STOP_BRIDGE` | 无法避免过度挂接、越界或知识污染 | 停止 Bridge，重排完整 C1.5 |

出现以下任一情况立即停止，不用加调用“调到通过”：

1. Hard REJECT 出现 false ATTACH；
2. Gold、Episode membership 或预期 verdict 被发送给模型；
3. 需要修改 Compiler、Relation audit、Retrieval 或 C1 projection 才能继续；
4. 需要让 Wiki/Question 文本反向支持 Claim；
5. 第一次语义失败后无法归因，只能反复改 prompt；
6. 真实回放证明所谓漏接其实全部是正确拒绝，且没有可验证的错误新建/错误挂接。

## 9. 明确不做

- 不提高 Source-level association coverage 作为目标；
- 不自动新建 Question；
- 不判断身份成熟度、promotion 或 publication state；
- 不做 merge/split/archive/reopen；
- 不恢复 C1-E，不改 materialization；
- 不改 loader、knowledge input、Relation、Graph retrieval、Context Pack、回答或 Pilot；
- 不把 embedding 相似度、统一 confidence 或一次 LLM 判断当作身份真值；
- 不摄入 Agent 运行过程。

## 10. 执行顺序

1. 产品负责人接受本合同，特别是三值语义、18-pair slice、零 false attach 与预算；**已完成**
2. 抽取仓库内最小只读 fixture，记录原始 runtime receipt 与新文件 hash；**已完成**
3. 实现纯函数 identity-card builder、schema validator 与 shadow Gate，先跑 0-call 测试；**已完成**
4. 输出将发送给 provider 的精确字段、材料范围和预计 token，再取得本阶段外部发送授权；
5. 运行 A0/A1 配对批次，先自动 Gate，再做一次冻结人工裁决；
6. 以 PASS / NO_MARGINAL_VALUE / REWORK / NARROW / STOP 之一闭合；
7. 只有 PASS 才另起生产集成合同。任何结果都不自动启动完整 C1.5、C2 或 C3。
