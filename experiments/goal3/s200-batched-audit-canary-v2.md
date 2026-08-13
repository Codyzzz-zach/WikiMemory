# G3-C 有界批量审计 Canary 裁决（v2）

## 裁决

`PASS_CANARY / GO_12_SOURCE / FULL_140_NOT_YET_AUTHORIZED`

本轮只改变审计执行粒度，不删除 Claim 或 Relation 的语义门禁。Claim 与 Relation 主审按输入 token 预算分批，每个对象仍返回独立 verdict；批内 objectId、Schema、证据下标或输出完整性任一不合法时，整批结果不生效并自动二分缩批。Claim 单项连续失败仍阻断编译，Relation 单项连续失败仍只隔离该边。

对抗式 strong-edge critic 最初也被批量化，但固定候选 replay 发现同批错误模式会污染一条明确成立的 REQUIRES。最终设计恢复为逐边 critic；强边数量少，不用这部分忠实度交换少量调用。

## 真实运行

| 运行 | 输入 | 调用 | Token | Lint 调用 | Lint Token | 耗时 |
|---|---:|---:|---:|---:|---:|---:|
| 旧基线 `compile-v1` | 3 Source | 192 | 388,416 | 177 | 333,867 | 217,784 ms |
| 串行批次 `compile-v2-batched-canary` | 3 Source | 38 | 179,791 | 23 | 123,944 | 328,832 ms |
| 两路批次 `compile-v3-batched-concurrent-canary` | 3 Source | 44 | 218,471 | 29 | 156,606 | 272,007 ms |
| 固定候选 `audit-replay-v2-single-critic` | 71 Claim + 104 Relation | 26 | 125,879 | 26 | 125,879 | 122,551 ms |

完整重编的上游命题、Claim 和 Relation 生成即使 temperature=0 仍发生候选数量漂移，因此不能只用两次全链路运行的最终数量判断审计编排。固定候选 replay 直接复用旧基线的 71 Claim 和 104 Relation，只重跑新版 Lint，用于隔离评估审计本身。

固定候选相对旧 Lint：

- 调用 `177 → 26`，下降 `85.31%`；
- Token `333,867 → 125,879`，下降 `62.30%`；
- 解析异常 1 次，由原单边 critic 的既有协议重试恢复；
- 71 Claim 与 104 Relation 全部有且仅有一个最终状态，账平；
- 旧版 12 条 Canonical Relation 全部保留；
- Stage B 未读取。

## 质量裁决

1. 固定候选中唯一被新审计隔离的 Claim 把“Meta 建议使用”写入断言，但引用的子 Span 只有仓库条目，没有包含上文“以下仓库可能有用”的引导语。按“Claim 是否忠实于引用 SourceSpan”的审计边界，这次隔离正确；后续若要保留该 Claim，应由编译器补齐引导语 Span，而不是放宽审计。
2. 新审计恢复的两条 REQUIRES 都是下载步骤对明确先决条件的依赖：运行 `download.sh` 需要 `wget/md5sum`，下载权重需要先访问网站并接受许可证。旧逐条审计将方向误判；单条 strong-edge critic 已确认通过。
3. 固定 replay 新放行的其他边主要是 `RELATED_TO`。抽检显示多数属于同一规则列表、同一模型版本、下载错误与链接过期等有导航价值的弱联系；没有发现批量主审直接放行未经过 critic 的 SUPPORTS/REQUIRES 强边。
4. `RELATED_TO` 在两个完全相同输入 replay 中仍有数量波动，说明 provider 在 temperature=0 下并非字节级确定。生产内通过逐对象 audit cache 固定首次判决；实验比较必须冻结候选与输出，不能把重新调用模型当作确定性函数。

## 实现门槛

- 批输入预算：18,000 估算 token；
- Claim 每批最多 12；Relation 每批最多 8；
- 批次并发最多 2；
- strong-edge critic 保持逐边独立、并发最多 2；
- 批次异常自动二分；单对象最多协议重试 2 次；
- 审计版本升至 v2.4，旧缓存不会被误复用。

## 下一步

12-source 小型规模回归已经执行。原预注册门槛保留如下：

1. 记录 3/12 两个规模点的候选 Claim、Relation、批次数、调用、Token、耗时和缓存命中；
2. 检查 Relation 候选随 Source 增长是否出现超线性放大；
3. 保留每 Source 原子发布、账平、证据可解析和 strong-edge critic 门禁；
4. 若 12-source 出现批量协议高频缩批、调用/Source 明显上升或弱边爆炸，则停在 12，不进入 30/50；
5. 只有 12-source 通过，才另行决定 30/50 规模点；140-source 仍是候选架构冻结后的里程碑运行。

## 12-source 回归结果

运行：`compile-v4-12source-regression`

冻结条件：DeepSeek `deepseek-v4-flash`、temperature=0、Stage B 未读取、12 个 Source 全部首次尝试完成。

| 指标 | 结果 |
|---|---:|
| Source | 12 completed / 0 failed |
| 总模型调用 | 194 |
| 总 token | 878,293 |
| Lint 调用 | 125 |
| Lint token | 592,910 |
| Claim 主审批次 | 29 调用 |
| Relation 主审批次 | 68 调用 |
| 单边 strong-edge critic | 28 调用 |
| Canonical / Quarantine Claim | 273 / 7 |
| Canonical / Quarantine Relation | 61 / 437 |
| Cross-material Canonical / Quarantine | 12 / 237 |
| 总耗时 | 1,434,444 ms |

### 工程门判断

- 280 个 Claim 草稿全部落入唯一最终状态：`273 canonical + 7 quarantine = 280`；
- 498 个 Relation 候选全部落入唯一最终状态：`61 canonical + 437 quarantine = 498`；
- 97 个 Claim/Relation 主审逻辑批次对应 97 次调用，批协议没有发生一次解析失败、缩批或重试；
- 10 次无效输出均不来自新批协议：7 次属于单边 strong-edge critic 截断，3 次属于 cross-material detection 截断；均按既有 fail-closed/缩批协议处理，未把不完整结果发布；
- 3 Source 到 12 Source 的平均调用与 token 没有出现超线性上升。12 Source 平均约 16.2 次调用、73.2k token；按当前候选上限外推仍近似线性，但该外推不是 140 Source 的运行授权；
- Lint 仍占总 token 的 67.5%，说明批处理解决了逐对象调用爆炸，却没有消除低质量 Relation 候选带来的审计浪费。

### Graph 质量门判断

跨材料召回在知识量增长后很快达到每 Source 40 个候选上限；12 Source 共进入 249 个 cross-material Relation 候选，只有 12 条通过，237 条被隔离。12 条通过边全部为 `RELATED_TO`，没有跨材料强关系通过。

人工诊断这 12 条弱边时，9 条由“该帖子的标题是 Llama 3.1”或 Hacker News item 元数据连接到各种 Llama 3.1 事实。它们不一定语义为假，但治理、影响传播和候选导航价值很低。剩余许可证变更、许可条款和模型能力之间的 3 条弱边相对具有导航价值。这个 3/12 只是本轮诊断性人工判断，不是冻结 Gold precision。

问题不在于 Graph 路线无效，而在于当前实现把 Source/页面元数据型 Claim 当作领域知识节点，并且 Relation 主审只验证“边是否语义成立”，没有验证“弱边是否值得占用 Graph 与后续候选预算”。继续扩到 30/50/140 只会把更多“可能正确但没有用”的弱边送去昂贵审计。

### 最终裁决

`PASS_BATCH_AUDIT / PASS_12_SOURCE_ENGINEERING / REWORK_CROSS_GRAPH_UTILITY / STOP_BEFORE_30`

下一轮不增加论文或题目，先修两个领域无关的结构问题：

1. 扩充 Source/provenance 元数据识别，把标题、页面/帖子 ID、作者/出处等管理事实从跨材料领域 Graph 候选中排除；原 Claim 和原文仍保留可检索，不删除证据；
2. 为 `RELATED_TO` 增加独立的弱边效用门或候选层，区分“语义上能连”与“值得进入 canonical 治理/导航 Graph”；不得用特定领域关键词或本批题目答案硬编码；
3. 用本轮冻结的 249 个 cross 候选做离线 replay 和人工小样本复核，先证明低价值边下降且许可证/依赖等有用弱边不被一刀切；
4. 修复后只重跑 3→12 回归。通过后再决定 30/50；140 Source 继续保留为后续规模里程碑，不作为当前开发循环的日常全量测试。

## 留痕

- 旧基线：`experiments/goal3/s200-runs/compile-v1/`
- 首轮批处理：`experiments/goal3/s200-runs/compile-v2-batched-canary/`
- 两路并发批处理：`experiments/goal3/s200-runs/compile-v3-batched-concurrent-canary/`
- 固定候选首轮：`experiments/goal3/s200-runs/audit-replay-v1-fixed-candidates/`
- 固定候选最终：`experiments/goal3/s200-runs/audit-replay-v2-single-critic/`
- 12-source 回归：`experiments/goal3/s200-runs/compile-v4-12source-regression/`

本报告是 Stage A 工程与规模诊断，不是 Blind 产品效果结论。

后续 cross-material Graph 效用门离线修复与裁决见 `s200-cross-graph-utility-v1.md`。
