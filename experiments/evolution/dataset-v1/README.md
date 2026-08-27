# Controlled evolution dataset v1

这是从外部 24 篇提纲重新构造的可执行“合成银标准”。它不是现实世界知识集，也不用于证明系统在
大规模语料上的召回能力；它先隔离验证产品最核心的行为：知识随时间积累、正式规则替代旧规则、
局部条件不丢失、未裁决冲突不强选赢家、无关答案不退化、证据不足时不编造。

## 规模与分布

- 3 个互异领域，24 篇独立 Markdown，正文约 1.35 万字符。
- 每域 T0=3、T1=2、T2=2、T3=1。
- 36 题、144 个时间点 Gold。
- 每域题型：affected=4、unaffected=3、synthesis=2、dispute=1、insufficient=2。

该规模是“演化行为 Pilot”，不是“容量/长文压力测试”。行为闭环通过后，再把相同语义合同迁移到
更长的真实材料与 held-out 领域，避免一开始把检索规模噪声和演化逻辑缺陷混在一起。

## 文件

- `manifest.json`：文档时间、权威、范围、变更类型与替代目标。
- `questions.json`：每题 T0/T1/T2/T3 的答案、条件、禁止旧事实和来源文档。
- 三个领域目录：只包含供摄入的自然 Markdown，不含系统 Claim/Relation ID 或 Gold 标签。

## 验证

```bash
npm run evolution:validate
```

验证器检查数量分布、路径安全、文档长度、时间线引用、替代目标、题型分布、未来信息泄漏以及四时点
Gold 完整性。通过结构验证仍不等于人工金标准；当前标签固定为 `SYNTHETIC_SILVER`。
