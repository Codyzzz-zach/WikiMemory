# G3-D Cross-material Graph 效用门离线裁决

## 裁决

`PASS_OFFLINE_GATE / GO_3_SOURCE_CANARY / 12_SOURCE_CONDITIONAL`

本轮不扩大语料或题目，而是在冻结的 12-source 产物上隔离验证两个领域无关的结构修复：

1. 标题、作者/账号、文档与帖子 ID、URL/DOI、发布时间、发布者及 release 管理字段属于 Source/provenance 元数据，不进入跨材料领域 Graph 候选；Claim 与原文仍保留可检索。
2. 语义主审通过的 `RELATED_TO` 还必须通过独立导航效用 critic。它仍是弱导航边，不能支持推理结论。

## 冻结输入

- 基线运行：`compile-v4-12source-regression`
- Cross-material 候选：249
- 冻结主审通过 / 失败：12 / 237
- Claim / Span：280 / 146
- 模型：DeepSeek `deepseek-v4-flash`
- temperature：0（不解释为字节级确定性）
- Stage B：未读取

离线效用实验固定旧主审决定：237 条旧主审失败边不重新调用模型；只对旧主审通过的 12 条边执行新门禁。这样测到的是效用门本身，而不是重新主审造成的随机漂移。

## 有效结果

运行：`utility-replay-v3-fixed-primary-v27`

| 项目 | 结果 |
|---|---:|
| 冻结候选 | 249 |
| 冻结主审失败，保持隔离 | 237 |
| provenance 元数据边，确定性排除 | 9 |
| 进入独立效用 critic | 3 |
| 最终 Canonical / Quarantine | 2 / 247 |
| utility low / invalid | 1 / 0 |
| 新增模型调用 | 3 |
| 耗时 | 3,686 ms |

三条内容边的证据级裁决：

- 保留：许可证允许用 Llama 输出改进其他模型 ↔ 当前自定义商业许可证。两端分别提供许可变化和当前许可制度，具有互补导航价值。
- 淘汰：许可证“发生重大变化” ↔ 当前许可证名称。前者没有说明变化内容，属于空泛元陈述，失败模式为 `NO_NAVIGATION_GAIN`。
- 保留：405B 达到 GPT-4+ 比较级别 ↔ Llama 3.1 在行业基准上优于许多模型。两端提供不同的比较基线，不是同义复述。

这 2 条不是人工 Gold precision 统计，只是对冻结小样本的证据级诊断。离线门通过的依据是规则表现符合预注册方向：元数据 9/9 被移出领域 Graph，空泛边被移除，互补许可证与基准信息没有被一刀切。

## 被否决的实验路径

所有失败实验均保留，未覆盖首轮结果：

1. `cross-replay-v1-utility-v25`：把效用维度混入批量主审，0/249 通过。批内错误模式污染，否决。
2. `cross-replay-v2-single-utility-critic-v25`：独立 critic 正确，但 replay 把全部 Source 混成一个主审队列，0/249 通过。批边界不等价于生产，否决。
3. `cross-replay-v3-source-isolated-utility-v25`：恢复 Source 边界，但重新调用了随机主审，0/249 通过。没有隔离效用变量，否决。
4. `utility-replay-v1-fixed-primary`：第一次正确冻结主审，结果 1/249；发现 critic 把“不同基准比较”误判为复述。
5. `utility-replay-v2-fixed-primary-v26`：仅补充复述定义仍为 1/249，说明模糊文字不足以约束判定顺序。
6. `utility-replay-v3-fixed-primary-v27`：明确先抽取两端独有事实，再判断替换是否损失信息，得到最终有效结果。

## 下一门槛

先运行 3-source canary，再条件性运行 12-source 回归。两级都必须满足：

1. 每个 Source 最终状态明确，Claim/Relation 账平，证据和端点可解析；
2. provenance 元数据不得重新进入 cross-material canonical Graph；
3. `RELATED_TO` 必须经过独立效用门；强边仍经过既有类型 critic；
4. 记录候选数、主审通过数、效用通过数、调用、token、耗时和异常；
5. 不能因减少弱边而把候选生成、审计调用或 Context Pack token 转移到其他未观测路径；
6. 3-source 不通过则停止；12-source 不通过则继续停在 12，不进入 30/50/140。

本报告只裁决 Graph 工程与候选质量，不代表 Stage B 盲测效果，也不证明产品北极星已经达成。

## 3-source 全链路回归

首轮运行 `compile-v5-graph-utility-3source` 使用 v2.7，共完成 3/3 Source，但人工检查发现错误放行：系统把训练数据量 `15T+ token` 与上下文窗口 `128K token` 连接为有用弱边。主审和效用 critic 都把共享单位误当成同一测量槽位，因此该轮判为 `FAIL_QUALITY`，没有启动 12-source。

修复采用领域无关规则 `MEASUREMENT_SLOT_MISMATCH`：相同单位或表面术语不等于相同属性/测量角色；训练数据量与上下文容量、价格与市值、摄入量与体内浓度等若无明确转换、比较或依赖，不构成导航边。冻结该轮主审结果的 `utility-replay-v4-3source-fixed-primary-v28` 正确淘汰错误 token 边，并保留 405B 参数总述与包含架构/上下文信息的具体描述。

v2.8 新运行 `compile-v6-graph-utility-3source-v28`：

| 指标 | 结果 |
|---|---:|
| Source | 3 completed / 0 failed |
| 调用 / token | 48 / 170,097 |
| Claim canonical / quarantine | 71 / 0 |
| Relation canonical / quarantine | 6 / 63 |
| Cross proposed / canonical / quarantine | 3 / 1 / 2 |
| 独立效用 critic 调用 | 7 |
| 协议无效输出 | 1（既有 strong-edge critic 截断并恢复） |

唯一 canonical cross 边连接 Llama 3 的 8B–70B 模型范围与 Llama 3.1 的 8B–405B 范围，具有具体版本比较价值。端点、Evidence 与审计版本均可解析，0 provenance 元数据边。该轮判为 `PASS_3_SOURCE`，授权 12-source。

## 12-source v2.8 回归

运行：`compile-v7-graph-utility-12source-v28`

| 指标 | v2.4 基线 | v2.8 本轮 |
|---|---:|---:|
| Source | 12 / 0 failed | 12 / 0 failed |
| 总调用 | 194 | 269 |
| 总 token | 878,293 | 1,006,261 |
| Lint 调用 / token | 125 / 592,910 | 200 / 722,373 |
| Claim canonical / quarantine | 273 / 7 | 274 / 6 |
| Relation canonical / quarantine | 61 / 437 | 29 / 507 |
| Cross proposed | 249 | 249 |
| Cross canonical / quarantine | 12 / 237 | 7 / 242 |

本轮 29 条 canonical Relation 全部带 `relationAuditVersion=v2.8`，无 `UNVERIFIED` 条件，无缺失 Evidence 或悬空端点。7 条 canonical cross 边包括 5 条 `RELATED_TO` 和 2 条 `SUPPORTS`；逐条人工检查均具有具体版本、模型能力或编译器技术联系，未发现 provenance 元数据、宽泛主题边或测量槽位错配。

新效用 critic 共 55 次调用 / 60,010 tokens，其中 cross 仅 11 次 / 12,326 tokens；其余 44 次 / 47,684 tokens 用于 intra-material `RELATED_TO`。保持全 Graph 一致的 canonical 质量合同是合理的，但该成本必须继续优化，不能通过只治理 cross 边来制造指标改善。

真正的成本瓶颈仍在候选生成与主审：249 条 cross 候选只有 7 条最终通过。detector 生成 134 条 `SUPPORTS`，只有 2 条通过；242 条隔离边中 228 条 relation 失败、229 条 type 失败。Cross detector 3 次截断，strong-edge critic 15 次截断，均 fail-closed 恢复。总 token 相对基线上升 14.57%，因此不满足扩大规模的成本门。

## 最终裁决与下一目标

`PASS_GRAPH_QUALITY / FAIL_SCALE_COST / STOP_BEFORE_30`

本轮证明了 provenance 分层和独立弱边效用门能显著改善 canonical cross Graph 的可用性，但没有解决候选洪泛。下一目标不是减少原材料或把旧 Claim 召回 40 直接砍到 20，而是正式建立“候选 Relation / 待审 Relation / canonical Relation”三层合同：

1. 保留宽召回，避免为了本批数据牺牲长尾关系；
2. 在昂贵主审前引入有界候选边预算和端点 fan-out 约束，溢出边必须持久化为 deferred candidate，不能静默丢弃；
3. 预注册预算档位、好边 recall、候选压缩率、审计 token 和人工忠实度，再用冻结的 249 条及 3-source 新运行做离线模拟；
4. 只有在不损失冻结好边且显著降低审计成本后，才重跑 3→12；30/50/140 继续不授权。

对本轮 249 条按模型 confidence 回放：每 Source 审计预算 24 可从 249 条降到约 152 条并保住本轮 7 条好边；加入端点 fan-out 4 可降到约 134 条并仍保住 7 条。但这是 post-hoc 诊断，不是生产参数，也不能写成已通过的实验结论。

### 追加留痕

- v2.7 失败 canary：`experiments/goal3/s200-runs/compile-v5-graph-utility-3source/`
- v2.8 冻结失败边复验：`experiments/goal3/s200-runs/utility-replay-v4-3source-fixed-primary-v28/`
- v2.8 通过 canary：`experiments/goal3/s200-runs/compile-v6-graph-utility-3source-v28/`
- v2.8 12-source：`experiments/goal3/s200-runs/compile-v7-graph-utility-12source-v28/`
