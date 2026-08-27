# Goal 3 规模机制诊断 v1

日期：2026-07-30
性质：已揭示 Gold 上的 post-hoc 开发诊断，不是盲测或产品收益证明。

## 结论

12→29→50 Source 的多领域规模梯度已经跑通。规模增加使当前全库检索发生可测退化，但 R1 Graph 候选导航没有找回缺失来源。原因不是候选上限或 Prompt token，而是当前可消费语义图对目标 Source 不连通。

- S12：259 Claim / 57 当前审计 Relation。
- S29：701 Claim / 200 Relation。
- S50：1,143 Claim / 351 Relation。
- R0 最终 Prompt 必需来源召回：0.917 → 0.875 → 0.833。
- S50 查询平均扫描约 1,135 条 eligible Claim，并检查 351 条 Relation；当前实现仍是读取完整知识状态并请求时建图。
- S50 R1 候选节点平均 18.5，R0 为 13.6；Graph 确实扩张，但 candidate/prompt 来源召回均没有增益或损失。
- 四道缺失来源题中，目标 Source 各有 21–24 条 Claim；从当前 Seed 沿可信边搜索到深度 4 仍无路径。

因此本轮裁决是 `NO_CANDIDATE_BENEFIT + ENGINEERING_SCALE_BLOCKER`。它否定的是当前“稀疏语义 Relation + 全库读取 + RWR”的实现，不否定 Typed Graph 的长期治理与局部导航目标。

## Relation 迁移

Batch C 原有 117 条 Relation 全部因旧审计版本被 fail-closed 拒绝。经用户明确授权，在隔离副本中使用 DeepSeek v2.3 合同完整重审：

- 输入 117；通过 57；隔离 60；账本闭合。
- 通过边：RELATED_TO 41、SUPPORTS 14、CONTRADICTS 2；其中跨 Source 边 17。
- 模型调用 157 次，总计 341,162 provider tokens；其中 prompt cache hit 245,120，cache miss 48,982，completion 47,060，reasoning 23,343。
- 审计权威仍是 `DEEPSEEK_DEV_PROXY_NOT_HUMAN_GOLD`，不得发布为人工 Gold 或主知识状态。

## CodeGraph 对照后的架构判断

CodeGraph 的结构排序建立在高覆盖、确定性 calls/imports/references 图上，并且只在文本索引先圈定的局部子图上运行。WGEMemory 当前只借用了有界 RWR，尚未具备另外两个必要条件：

1. 查询仍全量读取 Claim/Span/Source/Relation，并临时重建整图；
2. 在线图主要由低覆盖、需语义审计的 Claim Relation 构成，缺少不承担事实推理权的确定性结构导航层。

一般知识库不能把“共享概念/来源/证据/版本”冒充 SUPPORTS 或 REQUIRES。后续应把结构连接与语义断言严格分层：结构边只用于候选定位；语义边继续按现有审计门禁决定能否支持关系解释或结论。

## 下一执行顺序

1. **G3-A 持久索引与局部读取：**建立可重建的 Claim 检索索引、Source/Span 定位表与 Relation 邻接索引；查询先取有界入口，再加载局部对象。验收看读取对象数、延迟曲线和索引一致性，不看回答分数。
2. **G3-B 确定性结构导航：**设计 `EVIDENCED_BY / FROM_SOURCE / MENTIONS_CONCEPT / VERSION_OF` 等非语义导航连接，或等价的倒排表；不得具有 `canSupportConclusion=true`。用通用不变量和多领域数据验证，不针对四道失败题手写连接。
3. **G3-C 候选消融：**重新比较 lexical-only 与 lexical+structural+audited-semantic 的 bounded candidate recall；只有候选层出现稳定收益，才重做 Prompt selector。
4. **G2-Rework：**仅在候选层赢后处理 candidate→Prompt 转换和完整 Claim+Evidence 成本；R0 继续为默认在线路径。
5. **200 Source 与 T0→Tn：**50 Source 的线性扫描问题修复后再扩，不用更大规模掩盖已知架构瓶颈。

## 证据

- 冻结合同：`experiments/goal3/goal3-scale-contract-v3.json`
- 有效规模报告：`experiments/goal3/runs/scale-v5/scale-report.json`
- 审计账本：`experiments/goal3/runs/scale-v4/workspaces/S12/experiments/goal1/runs/goal3-batch-c-audit-v3/ledger.json`
- 隔离审计快照：`experiments/goal3/audited-batch-c-v1/workspace/manifest.json`
