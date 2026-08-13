# Goal 3-A 持久 Seed 索引阶段报告 v1

## 裁决

**状态：`LOCAL_INDEX_PARITY_PASS / ONLINE_ADAPTER_PENDING`。**

本轮先证明了“Seed 检索不必每题重新读取并索引完整 Claim/Span/Source”，随后完成 Indexed Context Pack 双跑与默认运行编排。新索引已经证明可生成与 legacy 完全相同的 Agent 可见 Pack；CLI query 与 Pilot 通过受管入口验证索引 generation，缺失/旧 schema/陈旧状态才同步重建，失败时显式记录并读取实时 Canonical legacy，不能消费陈旧索引。

## 冻结输入

- 题目：Batch C Stage A 的 18 道中文公开问题；SHA-256 `3cfe6ed87ddfb88902d35c417f27c6a8ebf806e3139e0acc37d34fa9ad11a34d`
- 规模：`S12=259`、`S29=701`、`S50=1,143` 条可索引 Claim
- 每题重复 3 次，共 162 个查询对照
- 模型调用：0；网络：否
- 首轮不可覆盖结果：`experiments/goal3/index-runs/index-v1/report.json`
- 压缩实验：`index-v2`；加入 generation、局部邻接和 Evidence 定位后的规模结果：`experiments/goal3/index-runs/index-v5/report.json`
- 可解析 Evidence 的真实状态补验：`experiments/goal3/closure-runs/closure-v1/report.json`

## v5 规模实测

| 层级 | 排名完全一致 | 旧路径平均延迟 | 索引平均延迟 | 旧路径 P95 | 索引 P95 | 平均加载 Claim 比例 | 索引大小 |
|---|---:|---:|---:|---:|---:|---:|---:|
| S12 | 是 | 105.870 ms | 16.584 ms | 120.161 ms | 29.198 ms | 68.1% | 4.20 MB |
| S29 | 是 | 163.936 ms | 23.345 ms | 188.413 ms | 34.074 ms | 43.8% | 6.38 MB |
| S50 | 是 | 228.561 ms | 31.974 ms | 245.702 ms | 44.152 ms | 44.5% | 9.40 MB |

162/162 个查询的候选 ID、顺序、分数、命中通道和命中特征完全一致；深度 1 的 Claim/Relation 邻接集合也全部一致。S50 的局部邻接平均耗时由 14.285 ms 降到 1.593 ms，P95 由 20.310 ms 降到 2.870 ms。v1 使用完整 Claim ID 和重复特征数组，S50 索引约 30.9 MB；当前加入 Span、Source、Relation 邻接与 Source→Claim 定位后为 9.40 MB。schema、scope 与 Canonical generation 均进入 snapshot 合同，旧格式和陈旧知识不会静默复用。

必须说明：`scale-v5` 工作区的合成 Claim 使用 `#chars-...` evidence ID，而复制 Span 不含这些 ID，所以该规模实验里的 Evidence/Source “一致”是双方都解析为 0，不能作为 Evidence closure 证明。这个假阳性被永久保留，没有覆盖。随后使用根知识状态中 157 条 Evidence 可解析 Claim，跨来源抽取 24 条做 `closure-v1`；24/24 的 Claim、Relation、Span、Source 集合全部与全库路径一致，且每个样本都实际水合到非空 Evidence。

## 没有通过的部分

1. 少数宽泛查询仍加载接近全库，最大加载比例为 S12 100%、S29 77.2%、S50 86.0%。平均比例随 S12→S50 从 68.1% 降到 44.5%，但不能宣称每个查询都严格局部。
2. CLI query 与 Pilot 已切换受管索引；底层 `buildContextPack` 的 legacy 行为刻意保留，作为兼容 API、回归基线和显式故障回退，不应误写成生产入口仍未切换。
3. 发布失效协议已完成：Source/Relation 发布、人工隔离、Alias、legacy append、Wiki 隔离、Evolution 与 Snapshot restore 都会在写入前更换 generation；陈旧查询 fail-closed，构建期间 generation 改变则拒绝发布 pointer。尚未实现自动后台重建，因此失效后需要显式重建。
4. GLOBAL/PERSONAL/PROJECT 候选、文档频率和总文档数已按可见 scope 隔离，并有泄露回归测试；但规模实验仍只有 GLOBAL 数据，尚未做大规模 overlay 压力验证。
5. JSON 分片是无额外依赖、便于审计的工程原型。每题仍会打开较多 posting/record 分片；更大规模前要比较嵌入式 KV/SQLite 等后端，但上层排序合同不得绑定具体存储实现。

## 下一步

1. 完整 Pack 双跑已由 `pack-v5` 通过，默认运行编排也已接入 CLI/Pilot；G3-A 完成。
2. G3-B 开始实现确定性结构导航；`EVIDENCED_BY / FROM_SOURCE / MENTIONS_CONCEPT / VERSION_OF` 只能扩大候选，不能作为事实证明。
3. 使用 50 Source Dev 状态先做候选层 recall/token/latency 消融；候选收益未通过前不运行回答模型，也不扩 Prompt 上限。

本报告不修改 Goal 2 的产品裁决：R0 仍是默认在线选择模式，R1 仍为 opt-in 失败实验。持久索引解决的是访问复杂度，不证明 Graph 已改善回答质量。

## 完整 Context Pack 双跑补验（pack-v1 → pack-v5）

- 冻结通过报告：`experiments/goal3/pack-runs/pack-v5/report.json`
- 覆盖：S12 / S29 / S50 的 Batch C 18 题，以及根知识状态 24 条可解析 Evidence 查询；每题同时运行 R0 与 `LEGACY_CONDITIONAL`，共 156 组 legacy/indexed 对照。
- 结果：最终 Pack 156/156 完全相同；时序排除集合 156/156 相同；最终预算选中 Claim / Relation / Span / WikiModule 与 token 估算 156/156 相同。
- 延迟：全组 legacy 平均 172.752 ms，indexed 平均 41.252 ms，约 4.19× 加速；该数字是本机离线读取基准，不是线上 SLA。
- 失败留痕：`pack-v1` 暴露字符区间 Evidence 无法从父 Span 还原；`pack-v2` 暴露同块邻居和预算后悬空条件；`pack-v3` 暴露时序必须在排名前过滤；`pack-v4` 暴露证据块身份应为 `sourceId + blockId`，以及无可见关系提示必须在最终裁剪后闭包刷新。失败报告均未覆盖。
- 测试口径：排除 Claim 的列表顺序、中间淘汰轨迹属于实现细节；门禁比较集合语义、最终选择、最终 token 与完整 Agent payload，防止把内部顺序伪装成产品退化。

## 默认运行编排

- `ensurePersistentSeedIndexReady` 先只读取 pointer/meta/generation；有效索引直接标记 `REUSED`，不会为每次查询重新扫描 Canonical。
- 缺失、旧 schema 或 generation 不匹配时同步构建新 immutable snapshot，并在构建前后校验 Canonical generation，成功后才原子更新 pointer，状态记为 `BUILT`。
- 构建或读取失败时，默认只允许显式 `LEGACY_FALLBACK` 到实时 Canonical 状态；diagnostics 和 Pilot retrieval trace 保存失败原因。CLI `--fail-on-index-error` 可改为直接失败，`--legacy-read` 只用于诊断消融。
- 根知识状态真实 CLI 查询已生成并消费 `wge-persistent-seed-index/v7`：375 Claim、382 Span、6 Source；该实跑不调用回答模型。
