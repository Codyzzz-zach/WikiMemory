# Goal 3-B2 来源路由首轮裁决 v1

## 裁决

**状态：`SOURCE_ONLY_SIGNAL / ONLINE_SELECTION_NOT_APPROVED`。**

首轮证明了“来源发现”和“来源内证据完成”必须分层：`SR12_40` 在 S50 相对强 `L40_STRONG` 找回 1 个 required source、没有丢失任何 required source，但出现 1 个 exact-quote 增益和 1 个 exact-quote 损失。来源层通过，完整候选层未通过，因此不接 Context Pack、不运行回答模型。

## 冻结身份

- 18 道已揭示 Batch C 题，S12 / S29 / S50 三档；身份是 post-hoc mechanism diagnostic，不是 Blind。
- 两组：`L40_STRONG` 与 `SR12_40`。
- `SR12_40`：最多 120 条 lexical 路由池、12 个来源、40 条最终 Claim。
- 共 108 个唯一单元格；模型调用 0、网络关闭、预算违规 0。
- 首轮目录：`source-routing-runs/source-routing-v1`；重复运行被拒绝，report 哈希保持不变。
- 全仓 24 个测试文件、175/175 tests 通过；lint、主项目与脚本 typecheck、diff check 通过。

## 结果

| Tier | Arm | required source recall | exact quote recall | 平均候选来源 | Evidence token | 平均 lexical records loaded |
|---|---|---:|---:|---:|---:|---:|
| S12 | L40_STRONG | 0.958 | 0.516 | 4.833 | 1,138.278 | 174.444 |
| S12 | SR12_40 | 0.958 | 0.484 | 7.056 | 1,138.889 | 174.444 |
| S29 | L40_STRONG | 0.875 | 0.484 | 6.833 | 1,126.944 | 304.778 |
| S29 | SR12_40 | 0.958 | 0.484 | 9.889 | 1,133.278 | 304.778 |
| S50 | L40_STRONG | 0.875 | 0.516 | 9.000 | 1,057.333 | 505.000 |
| S50 | SR12_40 | 0.917 | 0.516 | 11.056 | 1,038.000 | 505.000 |

S50 逐题集合比较：

- required source：1 胜 / 0 负 / 17 平；新增找回 `C-X-CLIMATE-001` 的 `c-climate-003`。
- exact quote：1 胜 / 1 负 / 16 平；总量相同，但不是同一组 quote，故不能写成“无损持平”。
- source recall 从 S12 的 0.958 到 S50 的 0.917，下降 0.041，在冻结的 0.05 稳定阈值内。
- S50 Evidence 闭包估算 token 下降约 1.8%；lexical records loaded 没有下降。

报告中的 SR 延迟低于 L40，但两组固定按 L40→SR 顺序运行，SR 可能受文件系统缓存预热影响；该延迟只保留为描述性数据，不作为独立效率结论。首轮结果不覆盖，后续若需要比较延迟，必须交叉/随机化顺序并多次重复。

## 为什么来源赢了、quote 仍会丢

`C-X-CLIMATE-001` 中，相关来源 `c-climate-003` 的首个 Claim 在 lexical 路由池排到 48，超出 L40，但仍在 120 池内。来源多样化把它提升为来源代表，因此 source recall 获益。

`C-K-PSYCH-001` 中，丢失 quote 对应 Claim `claim:08f4f1f4eb388c06-b7358d918b6741a7`，它原本位于 L40 第 39，证据是 `c-psych-003` 同一父块中的精确 child span。`SR12_40` 为 12 个来源各保证一个代表 Claim，其中包含数学、医疗、工程等与该题边际相关性很弱的来源，于是只剩 28 个 lexical 填充位，第 39 名的同来源证据被挤出。

这说明当前实现把“来源上限 12”误用成了“尽量填满 12 个来源”。来源路由发现新入口有价值，但新来源进入最终 40 条候选前还缺 source relevance gate；入选来源内部也缺 Evidence-block completion。直接增加候选上限会掩盖问题，不能采用。

## 下一步

1. 先在历史 Batch B 的 32 题、健康/历史/设计三个额外领域上复跑同一 `L40_STRONG` / `SR12_40`，确认“来源增益伴随 quote 置换风险”是否跨域存在；该集合已影响过历史设计，只能作为 Dev/Regression。
2. 若跨域复现，下一实现应给来源 trace 增加通用 lexical relevance/support 信号，并把“发现来源”与“批准来源占用最终候选位”分开；不得按题号、领域或 Gold sourceId 设规则。
3. 来源门禁后，再单独测试同证据块 completion 如何在固定 40 条预算内替换低价值来源代表；不得重新引入无边界 `SAME_SOURCE`。
4. 在来源与 quote 都逐题零损失、并有可解释成本优势前，`SR12_40` 只保留为实验候选层，不进入默认在线链路。
