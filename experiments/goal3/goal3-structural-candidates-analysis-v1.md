# Goal 3-B 结构候选发现阶段报告 v1

## 裁决

**状态：`STRUCTURAL_REACHABILITY_BASELINE_PASS / ONLINE_SELECTION_NOT_APPROVED`。**

本轮建立了与语义 Relation 分权的结构候选层。它只回答“哪些 Claim 与 Seed 共用证据块或来源”，不回答“这些 Claim 是否支持结论”。结构路径不会写入知识状态、不会序列化为 Relation，也不会进入 Context Pack。

## 实现合同

- 复用持久索引 v7 已有的 `span-claims` 与 `source-claims`，不新增 schema 或同义 adjacency。
- 路径只有 `SAME_EVIDENCE_BLOCK` 与 `SAME_SOURCE`；返回 Claim 与 trace，不返回 edge/Relation。
- Seed、路径类型、来源、块和候选 ID 形成固定排序；所有 Seed 均从新增候选中排除。
- scope 与显式时间范围先于预算过滤；不可见候选不能占用返回名额。
- Claim/evidence 按固定小批次渐进检查；坏证据不占预算，会继续向后补位。
- `maxCandidates` 约束返回数。候选宇宙、实际检查数、scope/temporal 排除、坏证据和截断分别留痕并严格账平。
- 该 API 全程只读，不调用模型，不修改索引或 Canonical 状态。

## 验证结果

- 定向：20/20 tests 通过。
- 全仓：23 个测试文件、156/156 tests 通过。
- `npm run lint`、主项目与脚本 typecheck、`git diff --check` 通过。
- 回归覆盖：确定顺序、块优先、多个 Seed/多路径、预算截断、scope/project 隔离、时间范围、child span、陈旧索引 fail-closed、Relation 零泄漏、只读哈希、多 Seed 排除、不可见候选不占预算、坏证据回填和诊断账平。

## 根索引只读实跑

输入为当前 v7 根索引（375 Claim、382 Span、6 Source），每题 5 个 lexical Seed、`maxCandidates=12`，模型调用为 0。

| 查询 | 去重结构候选 | 实际检查 | 返回 | 截断 | 坏证据 | 账平 |
|---|---:|---:|---:|---:|---:|---|
| 复数乘法与旋转有什么关系？ | 129 | 12 | 12 | 117 | 0 | 是 |
| 一致收敛为什么重要？ | 65 | 12 | 12 | 53 | 0 | 是 |
| 什么是完备空间？ | 257 | 12 | 12 | 245 | 0 | 是 |

## 这组数字意味着什么

结构可达性确实扩大了 lexical Seed 的候选视野，但 `SAME_SOURCE` 很宽。它是召回信号，不是相关性或任务必要性证明。若把这些候选直接放入 Prompt，会重演 Goal 2 的 token 膨胀，因此本轮明确禁止接入在线回答。

当前实现的返回与 Claim/evidence 水合是预算优先的；但读取一个 `source-claims` 行仍可能枚举一篇超长来源内的全部 Claim ID。故本包是可审计的候选基线，不应宣称已经具备面向任意大来源的严格在线 I/O 上限。

## 下一包进入条件

1. 在 S12/S29/S50 冻结状态上运行 lexical-only、同块候选、同块+同源候选的离线消融。
2. 指标至少包括 required-evidence recall、候选数量、实际检查数、来源/块分布、延迟和估算闭包成本；不运行回答模型。
3. 预注册结构触发规则与 path 级预算：同块优先；同源只有在 lexical 置信不足或任务需要跨段信息时才进入候选竞争。
4. 若同源候选不能在固定检查预算下提高 required-evidence recall，就不得进入 Context Pack；优先收缩或增加来源内二级索引。
5. 候选层赢得离线消融后，才允许回到 Goal 2-Rework 做“替换而非追加”的同预算 Micro。

Reasonix 在本轮承担受限文件内的机械施工与只读复核；所有设计裁决、失败判断和最终验收均以独立测试及真实索引结果为准，而非模型自述。
