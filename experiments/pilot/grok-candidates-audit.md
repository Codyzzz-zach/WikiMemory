# Grok 候选题池审计

审计对象：[grok-candidates.cleaned.json](./grok-candidates.cleaned.json)

审计结论：这份产物可以作为候选题与评分锚点的参考，但不能直接替换或冻结为五篇材料 Pilot 的 Gold。清洗只删除了平台注入的 24 个上传链接，没有改写题意、证据或生成器元数据。

## 一、机械校验

| 项目 | 结果 |
|---|---:|
| 声明题数 / 实际题数 | 24 / 24 |
| 类别分布 | D 6、H2 7、H3 5、C 4、INSUFFICIENT 2 |
| evidence exactQuote 总数 | 75 |
| 能在声明来源中原样命中 | 69（92%） |
| heading 能在声明来源中命中 | 75（100%） |
| 平台注入链接 | 24，已机械删除 |

生成器元数据写的是 `Perplexity`，而接收说明称由 Grok 生成。该 provenance 冲突被原样保留，不能由我们擅自改成其中任一说法。

## 二、阻止直接冻结的两个硬问题

1. Pilot 锁定语料是 01、02、03、05、09；这份题池实际使用的是 01、02、03、04、05。它包含 6 次 `04-equations.md` 依赖，却对 `09-functional-analysis.md` 零覆盖。
2. 题型数量达标不代表题目路径达标。部分 H3 只是单章内部多点复述，部分题把“共享同一概念”写成了因果依赖，不能据此检验跨材料 Graph 或 WikiModule 的增益。

## 三、逐题裁决

裁决含义：

- `ACCEPT_CANDIDATE`：可进入最终人工候选池，但仍不是冻结 Gold。
- `REPAIR_REVIEW`：题意可用，必须先修 exactQuote 或收紧推理路径，再复审。
- `REJECT_CURRENT`：当前版本不进入本轮 Pilot；不表示主题永远不可用。

| 题号 | 裁决 | 核心理由 |
|---|---|---|
| CAND-D01 | ACCEPT_CANDIDATE | 2/2 精确证据；递归结构到归纳法的解释链清楚 |
| CAND-D02 | ACCEPT_CANDIDATE | 2/2 精确证据；结构升级与代价配对明确 |
| CAND-D03 | REPAIR_REVIEW | 2/3 精确证据；表格引用把 `C[0,1]` 误写成 `C` |
| CAND-D04 | ACCEPT_CANDIDATE | 3/3 精确证据；量词顺序与直觉解释可评分 |
| CAND-D05 | REJECT_CURRENT | 依赖未锁定的 04 章 |
| CAND-D06 | ACCEPT_CANDIDATE | 5/5 精确证据；同章多层抽象题可用，但不是跨材料题 |
| CAND-H201 | ACCEPT_CANDIDATE | 4/4 精确证据；完备性跨 01/02 的连接成立 |
| CAND-H202 | ACCEPT_CANDIDATE | 4/4 精确证据；表示与变换两个层面区分清楚 |
| CAND-H203 | ACCEPT_CANDIDATE | 3/3 精确证据；Cauchy 性到完备性的连接成立 |
| CAND-H204 | REPAIR_REVIEW | 2/3 精确证据；一条引用损坏，且“推导”只能要求材料给出的思路，不能要求完整证明 |
| CAND-H205 | REJECT_CURRENT | 依赖未锁定的 04 章 |
| CAND-H206 | ACCEPT_CANDIDATE | 4/4 精确证据；线性映射与结构保持的连接成立 |
| CAND-H207 | REJECT_CURRENT | 依赖未锁定的 04 章 |
| CAND-H301 | REJECT_CURRENT | 一条引用不精确；更关键的是把有理数不完备写成 `C[0,1]` 在不同范数下完备性差异的因果起点 |
| CAND-H302 | ACCEPT_CANDIDATE | 4/4 精确证据；指数—三角—Hilbert 投影—频域分解路径成立 |
| CAND-H303 | ACCEPT_CANDIDATE | 5/5 精确证据；范数—度量—拓扑—连续性—一致收敛路径成立 |
| CAND-H304 | REJECT_CURRENT | 仅依赖 04 章，既越过语料边界，也不足以检验跨材料路径 |
| CAND-H305 | REJECT_CURRENT | 依赖 04 章且 1 条引用不精确；可另写成 02/05/09 的无限维算子题，但不能静默改题 |
| CAND-C01 | REPAIR_REVIEW | 条件判断正确，但算子范数公式引用未原样命中 |
| CAND-C02 | ACCEPT_CANDIDATE | 2/2 精确证据；“项趋零只是必要条件”是干净的条件保真题 |
| CAND-C03 | REJECT_CURRENT | 依赖未锁定的 04 章，且一条公式引用不精确 |
| CAND-C04 | ACCEPT_CANDIDATE | 3/3 精确证据；同表中的 Q/R 对照足以反驳“稠密推出完备” |
| CAND-I01 | ACCEPT_CANDIDATE | 当前五篇没有弱/强收敛定理及证明，适合作为不足证据候选 |
| CAND-I02 | ACCEPT_CANDIDATE | 当前五篇没有三维 Navier–Stokes 全局正则性证明，适合作为不足证据候选 |

汇总：14 题可保留为候选，3 题需修复复审，7 题按当前版本淘汰。

## 四、对正式 16 题的影响

这份题池不应整体替换现有 [questions.json](./questions.json)。现有题集覆盖第 09 章，并刻意包含 02/05/09 的 Riesz、谱分解和 Banach 定理路径，这是 Grok 题池缺失的产品判别能力。

建议只吸收三类价值：

1. 用 CAND-D01 的问法和评分锚点强化自然数题，使其从“列举 Peano 公理”升级为“解释递归结构为何支持归纳法”。
2. 优先用 CAND-C02 替换或补充当前“一致收敛是否保证可导”题。原始第 03 章对可导性存在过强表述，后者会混入源材料错误；“项趋零只是级数收敛必要条件”则证据干净、判分明确。
3. 参考 CAND-H302、CAND-H303 的路径描述完善 H3 评分锚点，但最终 H3 仍必须保留至少一题真实使用第 09 章。

## 五、下一动作

在冻结前完成以下工作：

1. 对最终 16 题补齐逐题 exactQuote、0/1/2 分锚点和 source-risk 标记。
2. 保持 4D + 5H2 + 3H3 + 3C + 1 INSUFFICIENT 的正式分布，并确保 09 章有直接题和多跳题覆盖。
3. 人类只审核最终 16 题，不需要审核全部 24 题；确认后再把状态改为 `FROZEN`。
4. 冻结后生成 snapshot，先跑 1 题 × 3 组冒烟，再运行 16 × 3 的同预算盲测。
