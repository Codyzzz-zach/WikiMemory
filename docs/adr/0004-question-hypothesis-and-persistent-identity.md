# ADR 0004：长期问题是逐步获得稳定身份的问题假设

- 状态：Accepted
- 日期：2026-08-25
- 修订：补充 ADR-0002 的 QuestionFrame 语义，并修订 ADR-0003 的后续收敛路线；不改写两份 ADR 的历史裁决

## 背景

I2.5 已证明 WikiMemory 能从人主动选择的材料中提出问题、通过确定性门禁形成 QuestionFrame，
并完成更新、merge/split、恢复、物化和 Context Pack 消费。该结果证明了长期问题身份的工程
机制，但没有证明人类能够预先完整定义长期问题，也没有证明一次 AI 提议或当前 `ACTIVE`
状态已经获得跨来源、跨时间的稳定语义身份。

当前实现中，AI 负责提出规范问题、边界、已有问题匹配和 lifecycle 建议；确定性 Gate 负责
证据闭包、scope、domain、引用和发布约束。问题复用的语义判断仍主要来自模型建议，规范文本
key 只能处理接近相同的表述；现有 promotion policy 也不能单独代表“长期性”。

如果把这项未知直接塞进 C1，会同时改变“问题内部的加权证据状态”和“问题本身的身份”，违反
每阶段单一主变量与失败可归因原则。如果假装它已经由 I2.5 完全证明，则会把工程闭包误写为
产品语义确定性。

## 决策

1. 人类负责选择可进入知识编译的材料，并可声明 domain、scope、纠正或治理意见；人类不需要
   预先穷尽或精确表述全部长期问题。
2. AI 产出的是 `QuestionHypothesis`：规范问题、别名、边界、候选匹配和 lifecycle 建议。一次
   模型输出不直接构成长久身份或硬 merge/split 的充分证据。
3. 问题身份的产品语义由 attention boundary、evidence basin、update semantics 和 evolution
   history 共同约束。规范问题文本是可修订投影，不是身份本体。
4. “当前可消费”与“长期身份成熟度”是独立维度。现有 `ACTIVE/CANONICAL` 继续作为工程状态，
   但不得展示或记录为长期稳定证明。
5. I2.5 裁决拆分为：`K2-M Question Identity Mechanism` 已闭合；`K2-S Question Identity
   Semantics` 未证明。该拆分不重开 I2.5，也不降低其机制证据。
6. C1 保持 Weighted Question State 的单一主变量，并冻结 QuestionFrame 集合以及形成、匹配、
   promotion、merge/split/archive 行为。
7. 在 C1 后插入 C1.5 `Question Hypothesis Persistence`，独立验证问题发现、跨来源/跨时间复用、
   重叠、身份成熟和 merge/split 判定；C2/C3 顺延但原主变量不变。
8. C1.5 优先使用追加式身份评估和软关系进行 shadow 验证。证据不足时保留竞争假设和未决，
   不为了生成单一目录而强制归并。

## C1.5 最小验收方向

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

阶段合同必须在执行前冻结具体输入、阈值、调用/Token/人工预算和停止线。优先复用 I2.5、
Evolution、数学与 I3-Sim 冻结材料，构造少量跨时间 Episode；不先启动新的大规模 Blind。

## 实施约束

- C1 期间不得修改 Question proposer、identity matching、promotion 或 lifecycle policy；
- C1.5 先建立独立纯函数评估器和追加式 assessment，再决定是否改变 QuestionFrame schema；
- 低价值或证据不足的同一性判断允许保持未决；
- 只有确定性候选召回无法处理的高价值问题对才调用模型；
- 所有判断按输入闭包 hash、prompt/model version 缓存，并只重算受新材料影响的局部问题邻域；
- 运行记录、任务回答和一般 Agent 轨迹继续只作评测证据，不自动成为 Canonical Knowledge。

## 后果

正向后果：

- 产品不再要求人类完整定义长期问题，也不把 AI 一次生成伪装成稳定本体；
- I2.5 的工程成果得到保留，同时其语义证明边界更准确；
- C1 与问题身份实验能够分别归因、分别闭合；
- 问题 rename、重叠、分裂和合并可以先保留不确定性，再由后续证据推动。

代价与风险：

- 收敛路线增加一个显式阶段，文档和状态展示更复杂；
- `ACTIVE` 等现有工程命名在 C1.5 完成前仍需产品层解释，不能直接外显为长期稳定；
- 身份评估可能引入新的派生记录和缓存，但不得在验证前扩大核心 schema 的改动面。

## 非目标

- 不摄入 Agent 全运行过程；
- 不要求人类维护问题目录；
- 不把主题模型、文本 embedding 或单一概率当作问题身份真值；
- 不在本 ADR 中选择最终 identity score、枚举、阈值或模型；
- 不授权 C1/C1.5 代码实现或新的付费模型实验。
