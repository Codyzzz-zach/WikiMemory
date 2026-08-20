# Question-Centered Memory 真实材料开发验收

> 日期：2026-08-20
> 裁决：PASS — 工程与小型真实 Episode 验收
> 非声明：不是盲测，不证明产品增益或长期不复发

## 验收边界

本次只使用人已选择并保存在项目中的知识材料，不把 Agent 运行、对话、工具调用或
Benchmark Gold 编译为 Canonical Knowledge。运行状态位于
`/private/tmp/wikimemory-i25-acceptance.UI8Gmo`，未写入仓库；现有材料和冻结 Benchmark
只读使用。

材料：

- `mathtest-material/03-sequences-limits.md`
- `mathtest-material/12-calculus.md`
- `mathtest-material/02-spaces.md`
- `mathtest-material/09-functional-analysis.md`

## 真实 Episode 结果

| Episode | 实测结果 | 裁决 |
|---|---|---|
| 首篇形成 | `03-sequences-limits` 产生 85 Claims；8/8 问题提议通过，形成 7 ACTIVE + 1 CANDIDATE | PASS |
| 无关材料隔离 | `12-calculus` 形成 6 个新问题、0 个更新；未改写先前问题 | PASS |
| 边界展开 | `02-spaces` 形成 8 个新问题，明确建立 Banach/Hilbert 长期问题 | PASS |
| 跨材料更新 | `09-functional-analysis` 产生 5 CREATE + 3 UPDATE；Hilbert、Banach、变分法问题命中既有稳定 ID | PASS |
| 局部支撑闭包 | 全部 26 个 Canonical WikiModule 按当前 Claim/Relation/Span/Question 重算，26/26 可消费 | PASS |
| indexed 消费 | 拓扑空间查询返回 2 个完整 WikiModule、24 个无重复 Claim、17 个 EvidenceSpan；0 个 support rejection；9,830/12,000 tokens | PASS |

跨材料更新的稳定问题身份：

- `question:2bd863ad3b30960f1e119c2c` — Hilbert，来源闭包覆盖 `02-spaces` 与 `09-functional-analysis`；
- `question:c9932599b47f4fa86edfeff4` — Banach，来源闭包覆盖 `02-spaces` 与 `09-functional-analysis`；
- `question:ef8d8f1bcc2827e9e20efa59` — 变分法/Euler–Lagrange，来源闭包覆盖 `12-calculus` 与 `09-functional-analysis`。

最终临时运行时状态为 4 Sources、296 Claims、45 Relations、27 QuestionFrames、26
WikiModules 和 30 QuestionEvolutionDecisions（27 CREATE + 3 UPDATE）。

## 验收促成的实现修正

1. 语义提议输出改用局部索引而非长 Canonical ID，硬限制问题、Claim、Relation 和
   Concept 数量，解决真实章节输出截断；domain 始终由人声明的输入确定。
2. 问题门禁能够解析 `#chars-start-end` 派生 SourceSpan，仍在任一引用不可解析时
   fail-closed。
3. WikiModule 消费改为校验当前局部支撑闭包；无关材料推进全局 knowledge
   version 不再使未变的模块全局过期。发布与恢复门禁仍要求精确版本。
4. 支撑审计改为在完整当前 scope 上运行，不受任务时间裁剪或局部索引邻域影响。
5. 形成、物化与消费统一为单模块最多 24 Claims；消费时保留 3 个 lexical
   slots，并将 Wiki 支撑 Evidence 作为原子闭包优先回填。
6. 索引检索命中模块后，Context Pack 从完整当前 scope 回填索引邻域外的支撑
   Claim/Span；多模块超预算时先释放被拒模块的可选 Claim，不连带删除高排名模块。

以上失败都已固化为回归测试。

## A1–A10 裁决方式

- A1–A9 由真实 Episode、支撑审计、索引消费及自动化回归合取验收。
- A10 的形成、跨材料更新和无关隔离已用真实材料执行；争议、SUPERSEDES、
  merge/split、故障恢复与回滚由确定性测试验收。本轮不伪造真实反例材料。
- 任一硬门禁失败都不接受本次变更；QUALITY 只记录为向量，不用总分豁免门禁。

## 自动化与历史哨兵

- `npm run lint`：PASS；
- `npm run typecheck`：PASS；
- `npm test`：51 files / 330 tests PASS；
- `npm run build`：PASS；
- `git diff --check`：PASS；
- H1-A `adjudication-v1.json` 列出的 6 个权威冻结文件 SHA-256 全部匹配，未改写历史
  contract、report、modules 或 diagnostic rows。

## 仍然保留的不确定性

- Relation Lint 在真实章节上仍是明显的时延与 provider token 成本来源；本轮不改
  Compiler/Relation 主变量。
- 数学材料证明了机制可运行，不代表其他 domain 的问题边界与命名质量。
- 本轮未验证多周持续更新后的长期不复发，也未与 Claim-only 做产品使用效果对照。
