# WikiMemory 长期问题记忆合同 v1.2

> 状态：Accepted；I2.5 机制基线，C1 加权状态与 C1.5 问题身份持续性上位合同
> 生效日期：2026-08-25
> 产品授权：用户确认自动形成并持续维护围绕长期问题的 WikiModule
> 上位约束：`WGEMemory4LLM-Product-Definition.html`、`WGEMemory4LLM-User-Stories.html`、`docs/specs/knowledge-contract.md`、`docs/specs/wikimemory-convergence-baseline-v1.md`

## 1. 产品边界

WikiMemory 只从人主动选择并提交的知识材料中学习。Agent 运行、对话、工具调用、Git
历史、Pilot outcome 和一般运行日志不自动成为 Canonical Knowledge。

若人选择的材料记录了一次失败、实验或决定，该材料中的陈述可以按现有 Claim、Scope、
Evidence 与 Authority 合同编译；运行事件本身不跨越知识输入边界。

## 2. 核心定义

### 2.1 QuestionFrame

`QuestionFrame` 是问题假设的稳定地址、持久化载体和可重建派生身份。它不是真理来源，不得
反向支持 Claim。地址稳定表示系统能够持续引用和演化这个假设，不等于该问题已经获得长期
语义身份。

它至少表达：

- 稳定 ID、稳定地址、规范问题与别名；
- domain、scope 和语义边界；
- `CANDIDATE | ACTIVE | MERGED | SPLIT | ARCHIVED` 生命周期；
- 父子问题与 merge 迁移；
- 形成信号、形成版本和最近更新知识版本。

文章标题、Source ID、段落顺序和模型当次措辞只能成为问题发现信号，不能单独成为稳定
身份。

### 2.2 WikiModule

`WikiModule(question, knowledgeVersion)` 是某个 QuestionFrame 在指定知识版本上的物化派生
视图。它可以丢弃和重建，工程上持久化、版本化并增量更新。

模块必须结构化区分并解释：

- 给定知识版本、适用范围和任务下当前证据支持更强的领先分支；
- 带适用条件的分支；
- 真实争议；
- 未解决认识；
- 已知 Gap；
- 被降权、限域或取代但可追溯的历史分支；
- Claim、Relation 与 Evidence 闭包。

模块文本和问题身份都不得成为 Claim 的反向证据来源。

`CURRENT` 不是 Claim 的新真值状态，也不承诺唯一答案。它是对证据拓扑的一次可解释投影；
现有 `ACTIVE | SUPERSEDED`、`SUPPORTED | DISPUTED | UNRESOLVED` 等字段继续承担存储和治理
职责，但不能单独决定产品层的领先分支。

### 2.3 QuestionEvolutionDecision

`QuestionEvolutionDecision` 是追加式派生决策记录，描述一个知识版本为何触发
`CREATE | UPDATE | PROMOTE | MERGE | SPLIT | ARCHIVE | REOPEN | NO_CHANGE`。

它只用于解释、重放、局部重建、回滚和回归，不属于 Canonical Knowledge。

### 2.4 QuestionHypothesis 与身份成熟度

人类选择材料、声明 domain/scope 或提供纠正，构成问题发现的注意力边界；人类不需要预先
穷尽或精确表述全部长期问题。LLM 可以提出规范问题、别名、边界、已有问题匹配和生命周期
建议，但这些输出首先是 `QuestionHypothesis`，不是已经成立的长期问题。

问题身份由以下四类信息共同约束：

- attention boundary：哪些经授权材料、domain 和 scope 属于候选范围；
- evidence basin：哪些 Claim、Relation、Concept 和 SourceSpan 会共同更新该问题；
- update semantics：什么样的新证据会改变其分支、范围或答案状态；
- evolution history：rename、复用、重叠、merge、split、archive 与 reopen 的可追溯历史。

“当前可消费”与“长期身份成熟度”是两个独立维度。现有 schema 尚未独立表达身份成熟度，
因此 `ACTIVE`、`CANONICAL` 或模块可见性不得被解释为长期稳定证明。具体持久化表示由 C1.5
阶段合同决定，本合同不预设新的枚举或统一概率。

## 3. 形成与维护原则

1. 形成采用“语义提议 + 确定性门禁”；LLM 没有发布权。
2. 形成输入只允许 Canonical Claim/Relation/Concept、SourceSpan、已有 QuestionFrame、
   显式 domain/scope 和配置。
3. 单篇材料可以形成有证据、当前有用的问题假设或模块，但单一来源不能独自证明长期身份；
   当前实现仍可按工程 lifecycle 形成 `ACTIVE`，该状态不得被产品层解释为身份成熟。
4. 新材料优先匹配并更新已有问题，不因标题或语言变化复制模块。
5. merge、split、archive 和 reopen 可以由模型提出，但一次模型输出没有直接发布权；硬动作必须
   通过确定性门禁，并保留 reason code、before/after hash、身份迁移和可回滚记录。证据不足时
   应先保留可解释的重叠、父子、merge/split 候选，而不是制造确定归并。
6. 问题仍重要但没有当前答案时继续存在，并显式表达 Evidence Gap；不得为了完整性编造答案。
7. 只重建受新增/变化 Claim、Relation、Concept 或 QuestionFrame 影响的模块；无关模块必须
   byte/hash stable。

## 4. 验收函数

I2.5 不使用可被平均分掩盖错误的单一总分。一次变更 `r` 只有在下式所有门禁同时通过时
才接受：

```text
ACCEPT(r) =
  Authority
  AND Grounding
  AND Identity
  AND StateSemantics
  AND Isolation
  AND Atomicity
  AND Replay
  AND Consumption
  AND Regression
  AND EpisodeTransition
```

### A1 · Authority

- 形成器未读取 Agent run、任务日志、回答、Pilot outcome、Benchmark Gold 或已知问题答案；
- QuestionFrame、WikiModule 和 QuestionEvolutionDecision 不得成为 Claim 支持证据；
- 只有 Canonical 且作用域允许的 Claim/Relation 可以进入模块。

### A2 · Grounding

- 每个可见 Wiki assertion 精确引用一个可消费 Claim；
- Claim 的 supporting evidence 可以解析到允许的 SourceSpan/AssertedRecord；
- 模块 support hash 与当前局部支持闭包一致，并保留其实际构建时的 source knowledge version；
- 无关材料推进全局 knowledge version 时，不得仅凭版本号使局部闭包未变的模块失效；
- 任一引用失效时 fail-closed，不能返回近似证据。

### A3 · Identity

- 相同材料集合改变输入顺序、标题措辞或段落顺序后，问题身份保持稳定；
- 同一长期问题的跨来源更新命中已有 QuestionFrame；
- rename 不改变 ID；merge/split 保留可解析的身份迁移；
- stable address 不包含 Source ID 或结构 heading 作为身份根。
- `ACTIVE`、`CANONICAL` 或一次跨来源匹配不单独构成长期身份成熟证明；
- 无法可靠判断同一性时保留歧义或软关系，不得静默过度合并。

### A4 · StateSemantics

- SUPPORTED、DISPUTED、UNRESOLVED、条件分支和 SUPERSEDED 不被压成同一种文本状态；
- Evidence Gap 与真实反证分离；
- 条件性 SUPERSEDES 不得全局删除旧结论；
- 没有当前支持结论时诚实返回 Gap；
- `CURRENT` 只表示给定 knowledgeVersion、scope 和 task 下当前领先/证据支持更强的分支，
  不得表达为客观真理；
- 分支投影至少能解释 grounding、authority、currentness、applicability、关系支持、任务相关性
  与 uncertainty 中实际参与判断的维度；允许序位或理由，不强制伪精确概率；
- 新材料增加重新检查和当前性优先级，但不自动获得高于旧证据的权威；
- 争议、限域、降权和取代必须保留关系依据与历史分支，不能因渲染领先分支而静默删除。

### A5 · Isolation

- 一次局部材料更新只改变受影响 QuestionFrame/WikiModule；
- 固定无关哨兵的对象、hash 与 Context 可见结果保持不变；
- PERSONAL/PROJECT/GLOBAL scope 不互相污染。

### A6 · Atomicity

- Question/Wiki 候选全部通过门禁后才原子发布；
- 失败不得产生半个 QuestionFrame、半个模块或跨版本 support hash；
- Canonical Claim 已发布而派生层失败时进入显式 pending 状态，旧模块不得冒充当前版本。

### A7 · Replay

- 给定相同 Canonical Knowledge、QuestionFrame 基线、formation version 和配置，确定性门禁与
  materialization 产生相同结果；
- before/after hash、reason code 和受影响引用足以重放 Question evolution；
- rollback 恢复精确对象 hash，且不得覆盖回滚点之后的新知识。

### A8 · Consumption

- ACTIVE 且 support contract 有效的 WikiModule 才能进入 Context Pack；
- CANDIDATE、ARCHIVED、Question 版本失配或与当前 Claim/Relation/Span 局部闭包不一致的模块不可见；
- Context Pack 保留条件、争议、Gap、Claim 和必要 Evidence，并遵守既有 token 预算。
- 单个 Question Wiki 的 Claim 闭包最多 24 条；形成与物化使用同一硬上限，超过时必须拒绝
  更新或先 split，不能静默截断。原子消费另保留 3 个受保护 lexical slots，最终仍服从请求
  token budget。

### A9 · Regression

- 现有 Claim/Relation Lint、Evolution、Context Pack、MCP、runtime 和恢复回归保持通过；
- R0 保持默认检索，不借 I2.5 重启 R1 策略实验；
- 历史 Benchmark 只作固定哨兵，不因新策略改写 Gold 或首轮结果。

### A10 · EpisodeTransition

以下产品 Episode 的状态迁移必须逐字段符合预期：

1. 第一篇材料形成稳定问题及有证据模块；
2. 第二篇材料跨来源更新同一问题而非创建重复模块；
3. 反例形成争议或条件分支，并解释两个分支为何保持并列或具有不同优先级；
4. 审计 TOTAL SUPERSEDES 改变当前领先投影并保留历史；若适用范围或权威不足，不得全局淘汰旧分支；
5. 证据不足形成 Gap，不编造答案；
6. 问题 merge/split 后身份和引用可迁移；
7. 无关材料不改变固定哨兵；
8. formation/materialization 故障后可恢复、重试和回滚。

## 5. 非豁免质量向量

硬门禁全部通过后，才用以下向量比较候选形成策略：

```text
QUALITY = (
  long_term_question_relevance,
  boundary_quality,
  cross_material_update_coherence,
  branch_weight_explainability,
  authority_and_applicability_fidelity,
  uncertainty_preservation,
  gap_honesty,
  context_compression_utility,
  provider_tokens_and_latency,
  marginal_value_per_ambiguity_call
)
```

质量向量不聚合成一个总分，也不能豁免 A1–A10。当前产品构建阶段使用少量真实材料、人工
语义裁决和固定 Episode；不新增昂贵大规模 Blind，除非小型真实使用暴露无法靠合同判断的
高价值不确定性。

## 6. 迭代与停止规则

- 每轮只改变一个主变量：问题身份、形成提议、promotion policy、生命周期、materialization
  或 consumption；不得同时调 Compiler、Graph 和 Retrieval。
- 失败必须归因到责任层，并固化为最小回归 Episode；只保存 trace 而未改变合同/实现不算学习。
- 若继续讨论的预期决策改善低于实现一个可逆 shadow slice 的成本，停止讨论并进入 shadow。
- 若新能力要求摄入 Agent run 或让 Wiki 文本成为证据，立即停止并回到产品边界。
- I2.5 已作为 `K2-M` Question Identity Mechanism 阶段闭合；`K2-S` Question Identity Semantics
  尚未证明，不回写或降格 I2.5 的机制证据。
- C1 只能改变“加权问题状态”的最小表达与判定，冻结 QuestionFrame 集合和 formation/lifecycle
  行为，不同时扩展 loader、检索、UI、知识来源或真实 Pilot。
- C1.5 才能把问题发现、语义复用、身份成熟、软关系和 merge/split 判定设为主变量；在 C1
  闭合前不得偷跑实现或付费实验。
- 若长期问题模块在冻结输入切片中不优于 Claim-only 阅读，或加权语义的边际价值不足以覆盖
  模型成本，则以 `NARROW`、`STOP` 或 `NO-GO` 闭合，不以模块数量或继续追加调用为价值证明。
- 新发现默认进入 Discovery Backlog；只有显式的人类决策才能改变 North Star 或当前阶段主变量。
