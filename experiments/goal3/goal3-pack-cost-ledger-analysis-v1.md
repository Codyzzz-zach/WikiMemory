# Goal 3B3：真实 Pack 成本账本与最小通用优化

## 裁决

`GO_G3C / OFFLINE_MECHANISM_ONLY / PRODUCTION_NOT_APPROVED`

G3-B3 已回答“当前 Pack 成本主要花在哪里”和“哪个通用压缩方向值得进入集成验证”：

- Evidence 区间合并只降低总 Pack 估算 token `0.5707%`，低于预注册 `5%` 门槛；不能继续优化或奖励该路线。
- 可见载荷中，Claim statement 平均 `1,867` tokens，条件/provenance 平均 `4,192.27` tokens；二者合计约占 RAW Pack `59.66%`。
- 固定 17 列的结构化 Claim 表，在不删字段、不摘要、不做领域特例的条件下，将总估算 token 从 `1,015,644` 降到 `808,861`，下降 `20.3598%`。
- `100/100` 行通过 Claim 语义可逆、candidate identity、Source/Evidence payload、scope 和确定性检查；`0` 行变大；单行最小改善 `9.085%`。

这只说明“通用序列化机制值得进入 G3-C”。它不证明回答更好，也不允许直接替换生产 Context Pack。

## 基线过程信号

| 成本层 | 每行平均估算 token | 含义 |
|---|---:|---|
| Claim statement | 1,867.00 | Claim 身份、正文、跨语检索别名 |
| Conditions / provenance | 4,192.27 | 条件、作用域、时态、来源/支持引用等语义安全字段 |
| Source metadata | 1,274.80 | Source 身份、URI、hash、类型和 metadata |
| RAW Evidence intervals | 2,792.42 | 每个候选证据区间独立渲染 |
| MERGED Evidence intervals | 2,734.47 | 只合并重叠/严格相邻区间 |
| RAW final projection | 10,156.44 | 离线候选 Pack 投影，不是生产 ContextPack |

索引侧每行平均读取 `384.22` 个候选 Claim record、`54.08` 个 posting shard、`173.02` 个 record shard，解码 `5,885.68` posting rows 和 `772.72` record rows。这个 read amplification 仍是 G3-C/S200 的规模风险，但本轮没有用第二种优化去追它。

## 为什么没有继续压 Evidence

46/100 行存在可合并区间，但总体只省 `0.5707%`，且由于 citation ID 数组开销，15 行反而轻微变大。继续在这条线上调格式会违反停止规则，并可能为了五十道已揭示题制造 reward。

## 结构化渲染为什么是通用优化

它只消除表示层冗余：旧格式给每条 Claim 重复写对象字段名，并在 communication/semantics 两段重复 claimId；新格式将 17 个字段名写一次，值仍按 Claim rank 逐行保存。它没有：

- 删除 conditions、provenance、scope、validity、time 或 null；
- 改写 statement、证据或 Source；
- 使用题目、领域、语言、caseId 或 Gold；
- 改变候选排名与身份。

因此收益来自数据结构，而不是针对测试集内容的奖励塑形。

## 两次 fail-closed 的留痕

1. 成本合同 v1 把“最多 40”误写成“恰好 40”；报告写入前停止。v1.1 只修正为 40 上限，候选数严格取 immutable first report。
2. 结构化 runner v1 的缓存声明触发 JavaScript TDZ；报告写入前停止。v1.1 只上移声明。

两次修复均使用新合同、新 freeze 和新 run id；阈值、候选身份和首轮有效报告未覆盖。

## G3-C 的冻结入口

G3-C 只允许做集成与 held-out 验证：

1. 给生产 Context Pack 增加版本化的 compact transport 或 renderer；内部 canonical 对象保持不变。
2. 新旧编码器/解码器逐字段 parity，schema/列数/列序漂移 fail closed。
3. Context Pack 消费者兼容性测试；不能假设所有 Agent 都理解位置数组。
4. 在 S200/新领域 Stage A 冻结后运行，不重用这 50 题调参。
5. 首次购买 provider token usage，并做同预算回答 A/B；离线估算不能替代真实计费 token。
6. 同时测 persistent index read amplification；若规模增长时仍近似全库读取，单独进入 source-level routing 目标，不能与 renderer 混成一轮。

## 权威产物

- 成本基线：`pack-cost-ledger-runs/pack-cost-ledger-v1-1/report.json`
- 结构化候选：`structured-pack-renderer-runs/structured-pack-renderer-v1-1/report.json`
- Reasonix 边界：`reasonix-execution-boundary-v1.md`
- WorkBuddy 合同：根目录 `benchmark-s200-workbuddy-contract.md`
