# Goal 3-B2 Evidence-Preserving Source Insertion 裁决 v1

## 裁决

**`SAFE_SOURCE_DISCOVERY / COST_UNPROVEN / ONLINE_NOT_APPROVED`。**

EPSI40 解决了 SR12_40 的真实缺陷：发现 L40 之外来源时，不再无条件挤掉 L40 里的独有证据。它在 50 道跨域 Dev/Regression 题上保住了所有 L40 evidence spans，同时保留一个严格 required-source 增益。但它没有降低任何非延迟成本，所以尚未达到 Goal 3-B2 的完整通过条件。

## 结果

| 指标 | L40_STRONG | EPSI40 | 裁决 |
|---|---:|---:|---|
| 题数 | 50 | 50 | — |
| required-source recall | 0.841 | 0.855 | 改善 |
| source-bound exact-evidence recall | 0.398 | 0.398 | 持平 |
| required-source 逐题 | — | 1 胜 / 0 负 / 49 平 | 通过 |
| exact-evidence 逐题 | — | 0 胜 / 0 负 / 50 平 | 通过 |
| L40 evidence-span 并集保留 | — | 50 / 50 | 通过 |
| 平均候选 Claim | 29.94 | 29.94 | 持平 |
| 平均 Evidence token | 807.2 | 817.04 | +1.2% |
| 平均 lexical records loaded | 384.22 | 384.22 | 持平 |

严格 source win 仍是 `C-X-CLIMATE-001`，新增找回 `c-climate-003`。Batch B 32 题为 0 胜/0 负；它证明机制没有跨域损失，但未复现第二个 source win。

## 机制

EPSI40 从同一 top-120 lexical pool 构造 L40，然后只检查 L40 之外的新来源代表。现有候选只有在以下条件全部成立时才能被移除：

- 至少有一个 evidenceSpanId；
- 该 Claim 的每个 evidenceSpanId 都由另一个当前候选继续引用；
- 使用精确持久化 span 身份，不以语义相似或 Gold 证明冗余。

50 题中有 11 题发生安全插入，共接受 31 次；其余尝试因没有安全 eviction slot 被拒绝。最终新增 31 个 evidence span，丢失 0 个。

## 两次报告修复

1. 旧 source-routing 的 quote scorer 会按 Claim 排名连接 span；已通过 source-bound interval scorer 修复。
2. EPSI 首轮 runner 的 Batch C/Batch B 摘要与 50 题逐题比较正确，但 combined summary 错误过滤 `datasetId == combined`，得到 0 题/null recall。原始报告保持不可覆盖，随后只对其 100 条冻结 row 重算 aggregate；没有重检索、读取 Gold 或改变候选。

权威修复报告：

`epsi-aggregate-rescore-runs/epsi-aggregate-rescore-v1/report.json`

SHA-256：`c37035a755be76c09d281688be0f1ec100e5fa983eed57edd1a1dbe1149feac9`

候选集合总哈希：`c2d5008a123712221c7d668cfa896c1933f9a4070ca755e085c9d814fe180ffa`

## 为什么成本不可能在本轮自动下降

EPSI40 的安全合同要求“L40 evidence-span 并集是最终并集的子集”。只要成功找回新来源，就会增加新 evidence；因此按 evidence closure 计费时，token 理论上只能相等或增加。这个门禁适合证明安全，不适合同时证明压缩。

这不是失败后修改目标的理由，而是下一层实验的因果边界：来源发现、证据保留和在线压缩必须分别测量。若把它们混在一个算法里，只看到总分变化，无法知道 token 下降来自真实去重还是偷偷删掉了信息。

## 下一步：G3-B3 成本分解后再选机制

先在冻结 L40/EPSI 候选上测五类成本：

1. Claim statement；
2. conditions 与 provenance；
3. source-bound、按原文区间合并后的 Evidence；
4. postings/records/shards 的索引读取；
5. 最终 Context Pack 的真实 estimated/provider token。

然后只选择证据指向的机制：

- 若主要浪费来自重复/重叠 evidence spans，建设 interval-aware renderer；
- 若主要浪费来自读取大量 Claim 才发现来源，建设 source-level persistent index，再在命中来源内局部读 Claim；
- 若主要浪费来自 Claim/condition/provenance 重复，建设保持引用闭包的结构化 Pack renderer。

下一机制仍以 L40 为强基线，要求逐题 source/evidence 零损失；成本必须在真实可见 Pack 或持久索引层严格改善，不能把候选数不变写成成本收益。通过前不购买在线回答实验。
