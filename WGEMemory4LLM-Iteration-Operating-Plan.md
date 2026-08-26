# WikiMemory 收敛迭代合同 v3.1

> 生效日期：2026-08-25
>
> 当前路线：C0 Convergence Baseline → C1 Weighted Question State → C1.5 Question Hypothesis Persistence → C2 Budgeted Information Flow → C3 Longitudinal Use
>
> 当前状态：C0 已闭合；C1-A/B 与 C1-C Pure Shadow 已通过；C1-D 在 ambiguity 调用前发现
> 18 份 Episode Sources 只有 12 份进入冻结 QuestionFrames，按合同以 `REWORK` 闭合；下一合同未启动
>
> 上位基线：`docs/specs/wikimemory-convergence-baseline-v1.md`
>
> 历史路线：v2.0 的 I0–I3 细节保留在 Git 历史；v1.5 归档于 `docs/history/`

## 1. 为什么切换到收敛路线

I0–I2.5 已经形成可作为后续前提的 Evidence Kernel、Agent Runtime 和 Question Identity
Mechanism。QuestionFrame 能被提出、持久化、演化、恢复和消费，但问题假设是否具有跨来源、
跨时间的稳定语义身份仍未证明。
I3-Sim 又证明当前系统能稳定地产生可追溯 WikiModule，但真实冻结材料没有充分触发争议/取代，
条件表达和跨版本关系也存在缺口。因此同一轮继续追加补丁只会改变验收对象，无法证明产品命题。

现在的目标不是尽快交付 Alpha，而是让每轮只回答一个问题、保留全部负证据，并以可回退的文档、
报告和 Git 提交结束。阶段可以 `PASS`、`NARROW`、`REWORK`、`STOP` 或 `NO-GO`；负结果不等于
未完成，也不会自动把目标往后移动。

## 2. 已拿下能力与当前缺口

| 层级 | 当前裁决 | 后续使用方式 |
|---|---|---|
| K0 · Evidence Kernel | 已形成稳定基础 | 作为硬不变量；不重做来源、Claim、引用、版本与证据闭包 |
| K1 · Agent Runtime | 已形成稳定基础 | 作为硬不变量；复用 Application/MCP、隔离、重放、审计和 Context Pack |
| K2-M · Question Identity Mechanism | I2.5 机制已闭合 | 复用 QuestionFrame、WikiModule V2、pending/retry、merge/split 与消费链 |
| K2-S · Question Identity Semantics | 未证明 | C1.5 独立验证问题假设的持续身份；不塞入 C1 |
| K3 · Weighted Semantic Flow | 未完成 | C1 唯一主变量 |
| K4 · Budgeted Task Value | 部分具备 | C2 才统一处理确定性复用与歧义调用预算 |
| K5 · Longitudinal Product Value | 未证明 | C3 才进入真实跨时间使用 |

I3-Sim 的正式结论保持 `NO-GO`。它是 C1 的输入证据，不通过改写同一 Gate、补做样例或续跑模型
改成成功。

## 3. 单一工作流

每个阶段都使用同一闭合 Loop：

1. 冻结 `Stage Question` 与唯一 `Primary Variable`；
2. 冻结输入切片、基线 hash、硬不变量、成本预算、非目标和停止条件；
3. 先执行最小的确定性 Contract/Micro，确认失败是否能被便宜地定位；
4. 只对无法由规则回答的高价值歧义调用模型；
5. 复用未变化证据、已闭合判断和历史模型结果，不重复推理；
6. 每次改变主变量后重跑固定 Micro + 跨域哨兵；
7. 保存过程 Trace、候选产物、成本、失败原件和裁决；
8. 以闭合报告、状态更新和 Git 提交结束，不自动启动下一阶段。

新发现进入 Discovery Backlog。除非产品负责人显式改变合同，否则接口、检索、Compiler Prompt、
Judge、输入材料和通过阈值不得在同一轮共同变化。

## 4. 统一验收函数

验收不使用可被平均分掩盖失败的单一总分：

```text
STAGE_ACCEPT(r) =
  HardInvariants(r)
  AND PrimaryVariableEvidence(r)
  AND Reproducibility(r)
  AND CostWithinBudget(r)
  AND ClosureCompleteness(r)

AcceptanceVector(r) = (
  grounding,
  authority_and_scope,
  branch_and_condition_fidelity,
  uncertainty_preservation,
  task_utility,
  regression_isolation,
  provider_tokens_and_latency,
  marginal_value_per_ambiguity_call
)
```

- 任一硬不变量失败时，本轮不能用其他维度的高分抵消；
- 接受向量展示 Pareto 取舍，不聚合成伪精确概率或综合分；
- 低价值歧义可以保持 `UNRESOLVED`，不为制造确定答案付费；
- 阶段的具体样本、阈值和停止线必须在执行前冻结，不能在看到结果后补写。

## 5. 阶段合同模板

任何实现或付费实验开始前，都必须填写并冻结：

| 字段 | 合同要求 |
|---|---|
| Stage Question | 本阶段唯一要学习或证明的问题 |
| Primary Variable | 唯一允许主动改变的核心变量 |
| Input Slice | 冻结材料、历史产物、Episode 与 hash |
| Acceptance Vector | 必须报告的质量、成本、不确定性和可解释性维度 |
| Hard Invariants | K0–K2-M 中不得回退的能力 |
| Cost Budget | Token、调用、人工审阅和时间上限 |
| Non-goals | 本阶段明确不做的相邻问题 |
| Stop Conditions | 何时停止继续调用、补样例或改代码 |
| Closure Artifact | 报告、产物、决议、状态更新与 Git 提交 |

只有阶段合同被产品负责人接受，阶段才从“设计”进入“执行”。

## 6. C0 · Convergence Baseline

### Stage Question

能否把产品命题、产品边界、能力账本、加权证据流与阶段闭合规则固定为一致的权威文档？

### Closure

- Product Definition、User Stories、Architecture、Question Contract 和 README 使用一致语义；
- `CURRENT` 被定义为有版本、范围和任务条件的领先投影，不是客观真理；
- 运行日志和任务结果不自动成为产品知识；
- I3-Sim 保持 NO-GO；旧 I3 固定百分比不再是当前承诺；
- 已产生 Convergence Baseline、ADR-0003、状态更新与可回退提交。

### Non-goals

不改代码，不设计最终权重算法，不继续 DeepSeek 调用，不启动 Pilot。

## 7. C1 · Weighted Question State

### 只允许回答的问题

同一长期问题下，新旧证据如何形成可解释的领先、争议、限域、取代、未决和历史分支？

本阶段使用冻结的 QuestionFrame 集合。“同一长期问题”是输入假设，不是 C1 要证明的结果。
Question proposal、semantic match、promotion、merge、split、archive 和 reopen 不得作为主动变量。

### 建议冻结输入切片

优先复用，不新增大 Benchmark：

1. I3-Sim 三个冻结 Episode、六个 paired tasks，以及对应 WikiModule、Context Pack、Trace 和双臂评审；
2. I2.5 真实材料验收中的形成、跨来源更新、Gap、merge/split 和故障恢复 Episode；
3. Evolution 中至少一个 FACT 纠正、一个 PROJECT/DECISION 取代和一个 scope 隔离 Episode；
4. 数学条件陷阱与一个跨域无关哨兵；
5. Claim-only/Wiki ablation 的既有回答，不重复请求模型，除非合同明确指出缺失的高价值比较。

### 最小表示假设

C1 先验证可解释的权重向量或序位，不预设统一概率：

```text
(grounding, authority, currentness, applicability,
 relational_support, task_relevance, uncertainty)
```

新材料提高重新检查与当前性优先级，但不自动提高 authority。现有 `ACTIVE/SUPERSEDED` 与
`SUPPORTED/DISPUTED/UNRESOLVED` 先被视为输入信号，不直接等同产品结论。

### Non-goals

- 不增加 Loader 或新的知识来源；
- 不重启 R1/Graph 检索竞赛；
- 不改 UI、远程 Transport 或 Pilot 协议；
- 不把 MCTS 类比实现成访问计数、自博弈或收敛概率；
- 不同时解决 Context Pack 的全局预算优化。
- 不修改问题形成、语义匹配、身份成熟或 lifecycle policy。

### 开始条件

C1 阶段合同必须补齐精确输入 hash、样本清单、接受阈值、调用/Token/人工预算和停止线，并经产品
负责人接受。当前文档不授权实现。

## 8. C1.5 · Question Hypothesis Persistence

### 只允许回答的问题

从人主动选择的材料中形成的问题假设，如何通过跨来源、跨时间的证据获得复用、重叠、分裂、
合并或长期稳定身份？

### Primary Variable

只允许改变问题身份评估策略：attention boundary、evidence basin、update semantics、recurrence、
separability、软关系与身份成熟判断。C1 的加权问题状态作为冻结输入，不在本阶段继续调优。

### 最小实现假设

- 人类提供材料选择和可选 domain/scope，不要求预写标准问题；
- AI 只提出 `QuestionHypothesis` 与身份关系候选，没有直接发布或硬归并权；
- “当前可消费”与“长期身份成熟度”分离，现有 `ACTIVE/CANONICAL` 不直接代表后者；
- 优先建立追加式 `QuestionIdentityAssessment` 与软关系 shadow，不直接扩充高扇入的
  `QuestionFrame` 核心 schema；
- 无法判断时保留 `UNRESOLVED`、重叠或 split/merge candidate，不强制唯一目录。

### 建议冻结输入切片

1. I2.5 数学材料：同问题跨来源复用、条件边界与无关材料隔离；
2. Evolution：早期形成、后期更新、纠正与取代后的身份持续性；
3. I3-Sim：三个领域中已经形成的问题及失败 Episode；
4. 每个 Episode 使用时间留出、输入顺序/标题扰动和单来源移除，不新增大规模 Blind；
5. 只对确定性候选召回无法裁决的高价值问题对调用模型。

### 验收方向

```text
QUESTION_IDENTITY_ACCEPT(r) =
  InputBoundary(r)
  AND GroundedIdentityDecisions(r)
  AND TemporalRouting(r)
  AND SourceAblationStability(r)
  AND NoSilentOvermerge(r)
  AND AmbiguityPreservation(r)
  AND IdentityMigration(r)
  AND Replay(r)
  AND CostWithinBudget(r)
```

具体样本、阈值、调用/Token/人工预算和停止线已由
`docs/specs/question-association-bridge-contract-v1.md` 冻结并于 2026-08-26 接受。当前先执行
C1.5-A Question Association Bridge：只验证 Claim 对事务前冻结 QuestionHypothesis 的
`ATTACH | REJECT | UNCERTAIN`。18-pair fixture、确定性 Gate 和 6 个 A0/A1 payload 已完成零调用
冻结。2026-08-27 provider run 获得授权后，在 3 main + 2 format repair、31,547 tokens 时因
`boundaryNotes` 稳定输出为 string 而按预算停止；剩余 3 个 main payload 未发送，oracle 未加载，
没有形成 A0/A1 语义结论。下一步只能先冻结 v1.1 output adapter contract，把概率语义与确定性 wire
normalization 分层；任何新增发送、完整 C1.5、生产 proposer 集成和其他付费实验仍需另行授权。

### Non-goals

- 不扩大知识输入到 Agent run、一般对话、工具轨迹或任务结果；
- 不重新优化 C1 的分支权重；
- 不同时改 Loader、Relation audit、Retrieval、Context budget、UI 或 Pilot；
- 不把 embedding、主题模型、单一 identity score 或一次 LLM 判断当作身份真值。

## 9. C2 · Budgeted Information Flow

只解决：在质量、成本和不确定性之间，如何为具体任务选择更有价值的信息。

- 先用确定性规则处理 hash、身份、显式关系、条件传播、版本和差分；
- 仅对关系判定、分支比较、缺口和任务价值等歧义调用模型；
- 比较缓存/增量复用、批处理和低价值未决策略；
- 报告质量—成本前沿和模型调用的边际价值，不追求统一低 Token；
- C1 的语义质量不得因省 Token 回退。

## 10. C3 · Longitudinal Use

C1/C1.5/C2 稳定后，才设计真实跨时间使用。周期、领域数、任务数和改善阈值根据真实使用条件在阶段
开始前冻结，不自动继承旧 v2.0 的“30 天、100 任务、30%/5%”设想。

C3 仍须保持：

- 同模型、同工具权限和可比总提示预算；
- 文件夹/强原文检索作为真实基线；
- 关键结论可追溯，hard failure 不增加；
- 任务与回答不默认落入知识，只保存经授权的评测收据；
- 用户愿意继续使用是证据之一，不是为了交付日期强制制造的结论。

## 11. 材料与 Benchmark 的使用纪律

- 现有 Batch A/B/C、WorkBuddy、S200、数学、Evolution、I2.5 与 I3-Sim 资产首先充当机制回归、
  输入切片、跨域哨兵和成本对照；
- 历史 Blind、Gold 和首轮结果保持冻结，不因新路线改写；
- 已见样本不再冒充新 Blind，模型生成题只能作 Dev/Silver；
- 只有冻结切片无法回答高价值不确定性时才收集新材料；
- Benchmark 失败首先用于责任层归因，不直接改变 North Star；
- 生成者、Evaluator 和最终裁决者继续在文件与工具权限上隔离。

## 12. 文档与裁决纪律

- Product Definition：为什么存在、必须达成什么；
- User Stories：用户可观察行为；
- Architecture Baseline：理想系统的模块与不变量；
- Knowledge/Question Contract：对象、状态与长期问题语义；
- Convergence Baseline：能力账本、阶段路线与闭合原则；
- Implementation Status：当前事实和真实缺口；
- 本文：当前执行顺序、验收函数、预算和停止纪律；
- Benchmark/Verification：如何产生和保存证据；
- README：入口，不产生新决策。

方向改变必须来自新的产品约束、可复现事故、跨域重复证据或产品负责人明确拍板，并以 ADR 留痕。
一次实验、一次模型输出或一个漂亮 Demo 不得自动改写架构与阶段合同。
