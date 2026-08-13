# Goal 3-B 结构候选同预算消融裁决 v1

## 裁决

**状态：`NO_STRUCTURAL_BENEFIT / RAW_STRUCTURE_NOT_APPROVED_FOR_ONLINE_SELECTION`。**

本轮没有否定 Graph 的长期治理与导航价值。它否定的是一个更窄、已经被预注册的实现假设：以 10 个 lexical Seed 为入口，仅沿 `SAME_EVIDENCE_BLOCK` / `SAME_SOURCE` 扩展，不能在 40 个 Claim 的相同候选上限内替代强 lexical 检索。

因此：

- 结构候选 API 保留为只读、可审计的基础设施；
- 当前结构候选不得接入 Context Pack，也不得升为默认在线选择器；
- 不在已揭示的 18 题上继续调路径配额并把结果称作确认性收益；
- 下一轮必须先解决“发现新来源”，再测试“来源内部补齐证据”。

## 实验身份与冻结

本实验使用已经揭示 exact-evidence Gold 的 Batch C 18 题，因此身份是 **post-hoc mechanism diagnostic**，不是 Blind Held-out。

- 冻结合同：`goal3-structural-ablation-contract-v1.json`
- 冻结实现：`goal3-structural-ablation-freeze-v1.json`
- 首轮报告：`structural-ablation-runs/structural-ablation-v1/report.json`
- 首轮 manifest：`structural-ablation-runs/structural-ablation-v1/run-manifest.json`
- 规模阶梯：S12 / S29 / S50
- 处理组：4
- 题目：18
- 完整单元格：`3 × 4 × 18 = 216`，实际 216，且 `(tier, questionId, arm)` 无重复
- 模型调用：0；网络：关闭
- 候选预算违规：0
- 首轮目录拒绝覆盖；拒绝后 report 与 manifest 哈希保持不变

## 同预算结果

| Tier | Arm | required source recall | exact quote recall | 平均候选 | 平均来源 | Evidence 闭包估算 token |
|---|---|---:|---:|---:|---:|---:|
| S12 | L10_CURRENT | 0.750 | 0.355 | 9.889 | 2.500 | 333.667 |
| S12 | L40_STRONG | 0.958 | 0.516 | 36.944 | 4.833 | 1,138.278 |
| S12 | L10_BLOCK30 | 0.750 | 0.419 | 19.111 | 2.500 | 549.722 |
| S12 | L10_BLOCK20_SOURCE10 | 0.750 | 0.484 | 27.500 | 2.500 | 808.778 |
| S29 | L10_CURRENT | 0.708 | 0.355 | 10.000 | 2.889 | 325.056 |
| S29 | L40_STRONG | 0.875 | 0.484 | 37.722 | 6.833 | 1,126.944 |
| S29 | L10_BLOCK30 | 0.708 | 0.419 | 19.278 | 2.889 | 532.278 |
| S29 | L10_BLOCK20_SOURCE10 | 0.708 | 0.484 | 27.389 | 2.889 | 785.389 |
| S50 | L10_CURRENT | 0.708 | 0.355 | 10.000 | 3.222 | 307.278 |
| S50 | L40_STRONG | 0.875 | 0.516 | 38.000 | 9.000 | 1,057.333 |
| S50 | L10_BLOCK30 | 0.708 | 0.387 | 19.333 | 3.222 | 493.833 |
| S50 | L10_BLOCK20_SOURCE10 | 0.708 | 0.452 | 27.667 | 3.222 | 759.056 |

S50 上，两种结构组相对 `L40_STRONG` 都没有任何逐题严格胜出：

- `L10_BLOCK30`：来源 0 胜 / 4 负；quote 0 胜 / 4 负；总匹配差 `-8`。
- `L10_BLOCK20_SOURCE10`：来源 0 胜 / 4 负；quote 0 胜 / 2 负；总匹配差 `-6`。

加入同来源路径相对纯同块路径确有局部作用：quote 2 胜 / 0 负，但平均 Evidence token 从 493.833 增至 759.056，增加约 53.7%，仍被强 lexical 基线支配。这是“来源内部补证据”的弱信号，不是在线机制通过。

## 第一性原理诊断

当前结构路径为：

```text
已找到的 Claim
  → 它已有的 Span
  → Span 所属 Source
  → 同一 Source 内的其他 Claim
```

这条路径可以提高同一来源内的证据完整度，但它不包含跳向新来源的连接。实测也完全吻合：S50 的 18 道题中，两种结构组的 `candidateSourceCount` 与 `L10_CURRENT` 逐题完全相同，差异数为 0；平均来源数都为 3.222。`L40_STRONG` 的平均来源数为 9.000，并因此找回四个结构组没有覆盖的 required source。

所以根因不是“Graph 候选太少”，而是当前结构层承担了它在拓扑上做不到的职责：**让来源内部导航去补偿来源发现失败。** 扩大 `SAME_SOURCE` 配额只会读取更多已知来源内容，不会创造新的来源入口。

## 架构结论

在线检索应明确拆成两个阶段：

1. **Source discovery / routing：**从查询出发，发现有界且多样的候选来源；它负责跨来源召回。
2. **Within-source evidence completion：**在已经选中的来源内，用 Claim lexical、同块、标题/章节和受审计结构补齐最小证据闭包；它负责完整性与成本。

Typed Graph 仍承担长期治理、冲突、版本、依赖和跨来源语义桥。只有经过审计、能真正跨来源的 Relation 或稳定概念身份，才可能在 source discovery 阶段提供新入口。`SAME_SOURCE` 是结构倒排路径，不应伪装成跨来源 Graph。

## 下一轮：G3-B2 Source Routing

下一轮只验证一个问题：**在不增加 40 个 Claim 候选上限、不进入回答 Prompt 的前提下，先做有界来源发现、再做来源内证据选择，能否达到或超过 `L40_STRONG` 的 required-source / exact-quote recall，并减少读取与闭包成本。**

设计约束：

- 强基线仍为 `L40_STRONG`，不得退回 L10 作为主要对照；
- 来源排序只能使用通用的 query、Source metadata、标题、alias、聚合 Claim lexical 信号和允许的审计连接；不得使用题号、Gold sourceId、领域白名单或材料专用规则；
- 来源候选数、每来源 Claim 数和总 Claim 数分别有界；最终总候选不得超过 40；
- 结构补齐必须替换同预算内低价值候选，不能在 L40 后追加；
- 继续使用 S12/S29/S50 观察规模稳定性；当前 18 题仅作 Dev 机制诊断；
- 通过至少要求 S50 required-source recall 不低于 L40、exact-quote recall 不低于 L40、逐题 required source 零损失、候选上限合规，并在读取量、闭包 token 或延迟之一形成可解释优势；
- 若 source routing 仍不能追平 L40，停止配额微调，转向跨语言 alias、Source 元数据质量或审计跨来源连接的责任层诊断。

在 G3-B2 离线候选层通过之前，不购买新的在线回答实验，也不修改默认 Context Pack。
