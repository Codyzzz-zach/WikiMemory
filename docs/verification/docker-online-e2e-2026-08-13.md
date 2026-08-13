# Docker 在线集成验证 · 2026-08-13

> 结论范围：证明当前镜像能通过真实 MCP/Worker/DeepSeek 完成一份小型 Markdown 的持久摄入、编译、语义门禁、查询与 SourceSpan 追溯。它不证明长期 Agent 任务质量，也不属于 Blind Benchmark。

## 隔离与输入

- Compose project：`wge-online-e2e`（验证后已删除容器、网络与命名卷）；
- Source：`source:online-e2e-policy-7fbd009933a79cb3`；
- 材料：两句中文发布审批规则；
- 模型：`deepseek-v4-flash`；temperature `0`；
- 首次提交故意使用 `semantic:false`，随后同 Source 使用 `semantic:true + recompile:true` 验证缓存与状态升级。

## 首次结构编译

- Job：`bebec956-3a47-40d1-b769-6cc492ea2c68`；
- 结果：Job `COMPLETED`，Source `COMPILE_PARTIAL`；这是关闭 semantic lint 后的设计内降级，不是失败；
- 4 次调用均 `finishReason=stop` 且 parse `VALID`；
- usage：752 + 640 + 354 + 749 = **2,495 tokens**；
- 产物：2 条 `UNRESOLVED` Claim、2 段可解析 SourceSpan；查询显式报告 known gaps。

## 语义升级

- Job：`ee5f5c77-6eff-4b7f-ac10-4cdf6ec1e2af`；
- Run：`22008bed-f3f8-47da-8a89-c9ce510e02a7`；
- 前四阶段命中持久编译缓存，只新增一次 LINT 模型调用；
- LINT usage：**1,537 tokens**，`finishReason=stop`，parse `VALID`；
- 最终 Source：`COMPLETED / COMPLETE`；
- 两条 Claim：`SUPPORTED + ACTIVE + CANONICAL`；
- knowledgeVersion：`kv:05d147d474fbd0d6ff0b08c5`。

## 查询与追溯

- 任务：询问生产发布审批条件；
- Context Pack：758 / 1,200 visible tokens；
- 召回：2 条正确 Claim、2 段原文，0 条关系（单 Source 小材料不需要关系路径）；
- Trace：从 Claim 回到 `memory://online-e2e-policy` 和精确 SourceSpan 字符区间；missing evidence 为 0。

总在线模型 usage：**4,032 tokens**。未运行答案模型，故不能由本报告推断回答质量。

## 暴露的后续观察项

条件短语当前被完整保留在 Claim statement 中，但本例的 `conditions` 数组为空。简单规则的语义未丢失；复杂条件、例外与量词是否稳定进入结构化 conditions，继续由历史条件保真回归和真实 Pilot 观察，不能凭本例判定通过。
