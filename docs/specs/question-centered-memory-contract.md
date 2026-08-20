# WikiMemory 长期问题记忆合同 v1.0

> 状态：Accepted for I2.5 implementation
> 生效日期：2026-08-20
> 产品授权：用户确认自动形成并持续维护围绕长期问题的 WikiModule
> 上位约束：`WGEMemory4LLM-Product-Definition.html`、`WGEMemory4LLM-User-Stories.html`、`docs/specs/knowledge-contract.md`

## 1. 产品边界

WikiMemory 只从人主动选择并提交的知识材料中学习。Agent 运行、对话、工具调用、Git
历史、Pilot outcome 和一般运行日志不自动成为 Canonical Knowledge。

若人选择的材料记录了一次失败、实验或决定，该材料中的陈述可以按现有 Claim、Scope、
Evidence 与 Authority 合同编译；运行事件本身不跨越知识输入边界。

## 2. 核心定义

### 2.1 QuestionFrame

`QuestionFrame` 是长期问题的稳定、持久化、可重建派生身份。它不是真理来源，不得反向
支持 Claim。

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

模块必须结构化区分：

- 当前有支持的认识；
- 带适用条件的分支；
- 真实争议；
- 未解决认识；
- 已知 Gap；
- 被取代但可追溯的旧认识；
- Claim、Relation 与 Evidence 闭包。

模块文本和问题身份都不得成为 Claim 的反向证据来源。

### 2.3 QuestionEvolutionDecision

`QuestionEvolutionDecision` 是追加式派生决策记录，描述一个知识版本为何触发
`CREATE | UPDATE | PROMOTE | MERGE | SPLIT | ARCHIVE | REOPEN | NO_CHANGE`。

它只用于解释、重放、局部重建、回滚和回归，不属于 Canonical Knowledge。

## 3. 形成与维护原则

1. 形成采用“语义提议 + 确定性门禁”；LLM 没有发布权。
2. 形成输入只允许 Canonical Claim/Relation/Concept、SourceSpan、已有 QuestionFrame、
   显式 domain/scope 和配置。
3. 单篇材料可以形成 ACTIVE 问题，但必须通过问题稳定性、语义边界、证据闭包和非文章
   特有性门禁；否则保持 CANDIDATE。
4. 新材料优先匹配并更新已有问题，不因标题或语言变化复制模块。
5. merge、split、archive 和 reopen 可以自动发生，但必须有 reason code、before/after hash、
   身份迁移和可回滚记录。
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

### A4 · StateSemantics

- SUPPORTED、DISPUTED、UNRESOLVED、条件分支和 SUPERSEDED 不被压成同一种文本状态；
- Evidence Gap 与真实反证分离；
- 条件性 SUPERSEDES 不得全局删除旧结论；
- 没有当前支持结论时诚实返回 Gap。

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
3. 反例形成争议或条件分支；
4. 审计 TOTAL SUPERSEDES 更新当前认识并保留历史；
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
  gap_honesty,
  context_compression_utility,
  provider_tokens_and_latency
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
- 若长期问题模块在真实小型使用中不优于 Claim-only 阅读，则在进入 I3 前收缩 formation 或
  Wiki 消费范围，不以模块数量为价值证明。
