# Goal 3-B2 跨域来源路由与评分器纠偏裁决 v2

## 最终裁决

**状态：`SOURCE_DISCOVERY_REPLICATED / CORRECTED_QUOTE_RISK_REMAINS / ONLINE_SELECTION_NOT_APPROVED`。**

`SR12_40` 的来源发现信号已经跨 Batch C 与 Batch B 复现：50 道题合计 required-source 2 胜、0 负。它分别找到 lexical L40 截断线外、首个 Claim 排名 48 和 42 的必要来源。因此“扩大来源视野”是值得保留的通用能力，不是五篇数学材料或单一领域上的偶然奖励。

但是当前做法会先为最多 12 个来源各保证一条 Claim，再填满 40 条候选。它仍可能挤掉 L40 中不可替代的精确证据。纠正评分器后，Batch B 的表面 quote 损失被证明是假阴性，但 Batch C 仍保留一个真实逐题损失，所以当前选择器不得进入在线 Context Pack。

## 1. 两轮冻结实验

| 数据集 | 领域 | 题数 | 强基线 | 实验组 | required-source 逐题 | 旧 quote 逐题 | 纠正后 exact-evidence 逐题 |
|---|---|---:|---|---|---|---|---|
| Batch C S50 | 心理、气候、法律 | 18 | `L40_STRONG` | `SR12_40` | 1 胜 / 0 负 | 1 胜 / 1 负 | 1 胜 / 1 负 |
| Batch B S50 | 健康、历史、设计 | 32 | `L40_STRONG` | `SR12_40` | 1 胜 / 0 负 | 0 胜 / 1 负 | 0 胜 / 0 负 |
| 合计 | 6 个领域 | 50 | — | — | **2 胜 / 0 负** | — | **1 胜 / 1 负** |

Batch C 的 aggregate exact-evidence 计数为 L40=17/31、SR=17/31；这不是“无损持平”，而是一道题增加、一道题丢失。逐题零损失始终优先于 aggregate 总量。

两份原始报告保持不可覆盖：

- Batch C：`source-routing-runs/source-routing-v1/report.json`
- Batch B：`source-routing-breadth-runs/source-routing-breadth-v1/report.json`

## 2. 旧评分器为什么产生假损失

旧评分器为了判断 Gold quote 是否存在，会把候选 Claim 指向的多个 span 按 **Claim 排名顺序**连接后搜索 quote。这在 Batch B 的 `B-F-HEALTH-010` 上制造了错误：L40 与 SR 都包含同一原文块中的两个相邻 child spans，但 SR 的 Claim 排名把其他 span 插在二者之间。原文中本来连续的文字因此在拼接字符串里被人为隔开，SR 被判为漏掉 quote。

评分器的真实契约应是 `(sourceId, normalized exactQuote)`：

1. 只在 Gold 指定来源内匹配；
2. child-span 必须回到持久化 base span 的字符坐标；
3. 按原文字符位置排序；
4. 只合并重叠或间隔仅为空白的连续区间；
5. 不跨 base span、非连续区间或来源拼接。

通用实现位于 `src/retrieval/evidence-coverage.ts`，12 个单元测试覆盖相邻 child spans、非连续间隔、source binding、乱序、重复和 unresolved fail-closed。冻结候选集没有重新检索，只用新评分器重算 exact evidence；不可覆盖报告为：

`evidence-coverage-rescore-runs/evidence-coverage-rescore-v1/report.json`

其报告 SHA-256 为 `94764d515f5a0b88a693135512b67e9dcf8e5d6247958d9ef093a6c65f28cabe`。

## 3. 哪部分风险是真的

Batch C 的 `C-K-PSYCH-001` 仍真实丢失以下 source-bound exact evidence：

> the data are consistent with the opposite conclusion, namely, that the reproducibility of psychological science is quite high.

L40 含有对应 child span；SR 没有。该损失不是 span 顺序、评分器归一化或来源绑定造成的，而是最终候选集确实不同：`SR12_40` 为来源代表预留名额时，挤掉了 L40 第 39 名附近的同来源独有证据。

因此当前机制只能证明：

- 120 条路由池能发现 40 条 Claim 截断线之外的相关来源；
- 固定 40 条最终预算可保持；
- 来源发现不等于安全的内容替换；
- 仅看 aggregate quote recall 会掩盖逐题证据交换。

它不能证明：

- 当前 12 个来源配额是正确参数；
- 来源代表应无条件进入最终 40 条候选；
- 当前 SR 可作为默认在线检索；
- Graph/Context Pack 已获得产品收益。

## 4. 下一冻结假设：保留证据的来源插入

下一轮不再调 12/40，也不增加 Prompt 上限。候选机制从 `L40_STRONG` 出发，把 L40 视为需要保护的强基线：

1. 仍用 top-120 lexical pool 发现 L40 外的新来源代表；
2. 新代表只有在 40 条候选内存在**可证明安全的替换位**时才能进入；
3. 安全替换位的最小定义是：被移除 Claim 的 evidence closure 已被其余候选完整覆盖，移除它不会删除任何唯一持久化 evidence interval；
4. 若找不到安全替换位，则拒绝插入该来源，不为“来源多样性”牺牲已有证据；
5. 规则只使用 query、lexical rank、source/evidence 元数据和固定预算，不读取题号、领域标签或 Gold。

这一步刻意把两个问题分开：先验证能否在不伤害已有证据的前提下扩大来源；同块 evidence completion 是后续独立假设，不能和来源插入一次性混做后再猜因果。

## 5. 下一轮硬门槛

同一冻结实现同时重跑 Batch C S50 与 Batch B S50：

- 候选数每题不超过 40；
- required-source recall 不低于 L40；
- 两个数据集逐题 required-source loss 都为 0；
- 至少保留 1 个跨数据集 strict source win，否则结论为 `SAFE_BUT_NO_DISCOVERY`；
- source-bound exact-evidence 逐题 loss 为 0；
- Evidence token 不超过 L40 的 110%；
- 不读 Gold 排序，不接 Context Pack，不调用回答模型；
- 首轮报告不可覆盖，候选集与配置均有 hash。

只有同时通过来源和 exact-evidence 门槛，才允许把该候选层带回 G2-Rework 或购买在线答案实验。若安全替换找不到任何来源增益，不能放宽证据门槛；应转向更强的索引元数据、evidence-block-aware reranking 或独立的来源召回阶段。
