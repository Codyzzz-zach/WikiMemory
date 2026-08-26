# WikiMemory 文档地图

文档按“规范、现状、操作、验证、数据合同、裁决、历史”分权。新读者先看根目录
`README.md`，需要理解整个仓库时看 `repository-map.md`。

## 规范：系统应该是什么

1. `../WGEMemory4LLM-Product-Definition.html`：产品目标、价值证据与停止信号；最高产品约束。
2. `../WGEMemory4LLM-User-Stories.html`：用户和 Agent 可观察行为。
3. `../architecture-baseline.html`：稳定目标架构，不记录短期统计。
4. `specs/knowledge-contract.md`：Claim、Relation、scope、状态、时间和 provenance 语义。
5. `specs/question-centered-memory-contract.md`：问题假设、持续身份、WikiModule V2、形成边界与加权状态上位合同。
6. `specs/wikimemory-convergence-baseline-v1.md`：当前能力账本、加权证据流、C0–C3（含 C1.5）路线与阶段闭合规则。
7. `specs/c1-weighted-question-state-contract-v1.md`：已接受的 C1 输入、sidecar 表示、验收向量、预算、实施顺序与停止条件。
8. `specs/question-association-bridge-contract-v1.md`：已接受的 C1.5-A Claim 级关联三值语义、18-pair 冻结切片、A0/A1 单变量、预算与停止线。

## 现状：代码真实做到了什么

9. `status/implementation-status.md`：当前实现、主知识状态、历史 Goal/I3-Sim 结算和真实缺口。
10. `../WGEMemory4LLM-Iteration-Operating-Plan.md`：当前 C0–C3（含 C1.5）施工依赖、验收函数、预算与停止规则。
11. `status/discovery-backlog.md`：不属于当前主变量的新发现；不自动产生施工优先级。

## 操作：人和 Agent 如何执行

12. `operations/pilot-runbook.md`：历史一周双臂 Pilot 合同；C3 合同冻结前不执行。
13. `../README.md`：本地、MCP、Worker 与 Docker 快速入口。

## 验证与实验方法

14. `../WGEMemory4LLM-Benchmark.html`：测试数据、开发回归、盲测和产品证据方法。
15. `benchmarks/`：WorkBuddy 数据采集、修复、上传和密封合同。
16. `verification/`：有日期的实机/在线验证证据；包括 I2.5 验收、I3-Sim NO-GO 与 C1.5-A zero-call Gate，不得升级为长期产品结论。
17. `adr/`：架构裁决和原因；ADR-0003 固定加权证据流与收敛阶段，ADR-0004 补充问题假设与持续身份语义。

## 仓库与历史

18. `repository-map.md`：生产代码、Benchmark、实验、运行时与生成物的责任边界。
19. `history/`：被取代的架构、计划、审计和发布说明，保留原始结论。

历史文档不是当前规范源。实验目录里的裁决文件是对应实验的证据源，但不定义产品或架构。
