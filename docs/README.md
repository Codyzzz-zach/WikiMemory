# WikiMemory 文档地图

文档按“规范、现状、操作、验证、数据合同、裁决、历史”分权。新读者先看根目录
`README.md`，需要理解整个仓库时看 `repository-map.md`。

## 规范：系统应该是什么

1. `../WGEMemory4LLM-Product-Definition.html`：产品目标、价值证据与停止信号；最高产品约束。
2. `../WGEMemory4LLM-User-Stories.html`：用户和 Agent 可观察行为。
3. `../architecture-baseline.html`：稳定目标架构，不记录短期统计。
4. `specs/knowledge-contract.md`：Claim、Relation、scope、状态、时间和 provenance 语义。
5. `specs/question-centered-memory-contract.md`：长期问题、WikiModule V2、形成边界与 I2.5 验收函数。

## 现状：代码真实做到了什么

6. `status/implementation-status.md`：当前实现、主知识状态、历史 Goal 结算和真实缺口。
7. `../WGEMemory4LLM-Iteration-Operating-Plan.md`：当前 I0–I3 施工依赖、Eval 与停止规则。

## 操作：人和 Agent 如何执行

8. `operations/pilot-runbook.md`：一周 BASELINE/WIKIMEMORY 双臂真实任务合同。
9. `../README.md`：本地、MCP、Worker 与 Docker 快速入口。

## 验证与实验方法

10. `../WGEMemory4LLM-Benchmark.html`：测试数据、开发回归、盲测和产品证据方法。
11. `benchmarks/`：WorkBuddy 数据采集、修复、上传和密封合同。
12. `verification/`：有日期的实机/在线验证证据；包括 Docker E2E 与仓库结构核验，不得升级为长期产品结论。
13. `adr/`：架构裁决和原因；架构方向变化必须追加记录。

## 仓库与历史

14. `repository-map.md`：生产代码、Benchmark、实验、运行时与生成物的责任边界。
15. `history/`：被取代的架构、计划、审计和发布说明，保留原始结论。

历史文档不是当前规范源。实验目录里的裁决文件是对应实验的证据源，但不定义产品或架构。
