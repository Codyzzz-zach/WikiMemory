# Batch A Gold Refinement v1 阶段报告

日期：2026-07-27  
状态：**完成模型审计与可复算修订；仍不是 human Gold 或 blind holdout。**

## 1. 本轮完成内容

- 保留 `candidates/` 与原始 `corpus/inbox/`，不原地修改 WorkBuddy 交付；
- 新增 MCP 2025-03-26 transport 正式规范摘录与 Redis 官方许可概览；
- 为 14 份来源生成明确输入边界的 `snapshotHash` 与 `artifactHash`；
- 60 条普通 Fact 与 24 条风险设计注释分离，防止风险说明被 Compiler 当知识摄入；
- 修复 16 条证据范围不足或 Claim 口径不忠实的 Fact；
- Relation 审计结果固定为 10 条保留、9 条拒绝；保留项均带 `relationAuditVersion`；
- 修复 17 道高风险任务的逻辑、地理范围、法律/投资 answerability；
- 修复 3 个 Evolution Episode；
- 建立 12 题 provisional canary 的结构、哈希、证据链和运行合同验证。

## 2. 关键设计边界

1. `refined/data/facts-reviewed.jsonl` 是模型审计后的 provisional 数据，不冒充人工 Gold。
2. `adversarial-risks.jsonl` 只服务于失败模式设计，设置 `compilerPolicy=exclude-from-knowledge-ingest`。
3. 被拒 Relation 保存在 `relations-rejected.jsonl`，用于回归和 critic 训练，不进入可消费关系图。
4. 法律与投资类题目只允许在冻结证据范围内回答；材料不足时降为 `partial/insufficient`。
5. Canary 只验证测试基础设施，不以 12 题分数奖励或修改架构。

## 3. 可复现命令

```bash
npm run benchmark:refine
npm run benchmark:canary
```

生成器会清空并重建 `workbuddy-batch-a/refined/`。验收要求是同一输入连续两次生成的目录树 SHA-256 完全一致。正式知识输入标识使用 `canary-validation.json` 中由全部 source snapshot 计算的 `knowledgeVersion`，而不是把临时目录树哈希写死为产品版本。

## 4. 验证结果

- `benchmark:canary`：14/14 来源 hash 可复算；12/12 canary 可装载；全量 Fact、Risk、Task、Relation、Episode evidence 可解析；Relation 端点全部存在。
- `typecheck`：通过。
- `lint`：通过。
- `vitest`：17 个测试文件、88/88 测试通过。

## 5. 尚未完成

- 尚无第二位人类审计者，因此不能升级为 human Gold；
- Batch A 只有三个主题簇，不能形成可信 blind split；
- 尚未执行回答模型，不存在 promptHash、token 消耗或产品效果分数；
- 下一阶段应扩展 Batch B 的独立来源簇，然后建立 20–40 题 Goal Micro，而不是在本 Canary 上继续调参。
