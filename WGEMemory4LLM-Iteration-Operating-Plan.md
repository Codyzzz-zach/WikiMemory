# WikiMemory 集成迭代合同 v2.0

> 生效日期：2026-08-12
> 当前路线：I0 运行边界 → I1 MCP 读取闭环 → I2 纠正闭环 → I2.5 长期问题 Memory → I3 长期 Pilot
> 历史计划：`docs/history/WGEMemory4LLM-Iteration-Operating-Plan-v1.5-2026-08-12.md`

## 1. 为什么切换路线

知识内核已经拥有摄入、编译、隔离、发布、检索、Graph、Wiki 机制、演化事务和大量工程回归。继续延长 G0–H1 只会继续证明内部组件，而不会回答用户能否让通用 Agent 真正使用 WikiMemory。

因此当前目标从“再优化一个内部检索机制”切换为“把内核封装成可持久运行、可被 Agent 调用、可纠正的产品闭环”。历史 Goal 与数据永久保留为 Dev/Regression，不删除、不改写，也不再冒充新 Blind。

## 2. 单一工作流

每个集成门都遵守同一 Loop：

1. 冻结一个可证伪的合同与基线 hash；
2. 先跑 4–8 个快速 Contract/Micro；
3. 只修责任层内的通用缺陷；
4. 重跑 Micro + 固定跨域哨兵；
5. 通过后运行相应历史回归或故障注入；
6. 保存过程 Trace、结果、成本、失败原件和裁决；
7. 更新 `docs/status/implementation-status.md`，不把当前事实写回目标架构。

一次 Loop 只允许一个主变量。接口、检索策略、编译 Prompt 和 Judge 不得在同一轮同时变化。

## 3. I0 · 运行边界与 Docker

### 目标

把当前目录驱动的内核封装为可替换 Transport 共同调用的 Application Service，并建立明确的 runtime root、单写者、Job 恢复与容器持久卷。

### 交付

- `src/application/`：ingest、status、query、trace 的 use case 与 DTO；
- `src/domain/ports/`：知识仓库、Job、模型、时钟、身份的 ports；
- `src/infrastructure/`：现有文件存储的 adapter，不重写知识算法；
- `runtime-data/`：显式运行根目录；旧根状态仅作迁移输入；
- Dockerfile / Compose：镜像 allowlist、非 root、healthcheck、持久卷；
- 单写者租约、幂等键和启动兼容性检查。

### Eval

| 门禁 | 通过条件 |
|---|---|
| Application parity | 同一冻结请求经 CLI facade 与直接 Application 调用，结构化 payload 逐字段一致 |
| 镜像边界 | 镜像不包含 `.env`、Gold、Benchmark、experiments、runs、references 或用户知识状态 |
| 持久恢复 | 删除并重建容器后，证据、Canonical、knowledgeVersion 与 pending Job 可恢复 |
| 单写者 | 两个并发写入只允许一个提交 generation；另一请求可重试且不产生半发布 |
| 故障注入 | Worker 在 Claim 发布前/后、索引重建时失败，上一健康版本仍可查询，状态不假报 COMPLETED |

### 停止规则

如果 I0 要求重写 Compiler、Graph 或 Wiki 算法，说明分层边界错误；退回 facade/adapter 设计，不以架构整理为名重做内核。

## 4. I1 · Agent 的 MCP 读取闭环

### 目标

让真实 MCP Client 在不知道仓库文件结构的情况下完成材料摄入、状态轮询、任务查询和证据追踪。

### 最小工具面

- `ingest_material`
- `get_ingest_status`
- `query_context`
- `trace_knowledge`

工具只接收产品 DTO，不暴露任意文件读写、任意 Graph 查询或内部 publication 路径。stdio 与未来 Streamable HTTP 调用同一 Application Service。

### Eval

| 门禁 | 通过条件 |
|---|---|
| 协议 parity | MCP 与 Application 直接调用的规范化 payload、错误码、knowledgeVersion 与 traceId 一致 |
| 权限 | read/query 与 ingest capability 分离；路径只能落入 allowlist；Gold/Quarantine 默认不可见 |
| 产品闭环 | 真实 Agent 摄入一份 Markdown，轮询到稳定状态，回答一项跨来源任务并追到 SourceSpan |
| 预算 | Context Pack 仍受固定 visible-context 上限控制；MCP 序列化开销单独记录 |
| 回归 | Batch B/C、Evolution 的固定跨域哨兵不因协议接入产生语义或证据闭包退化 |

### 停止规则

如果 Agent 必须解析 CLI 文本、猜本地路径或理解 `P-seed/P-graph/R0/R1` 才能工作，I1 不通过。内部实验标签不得进入产品接口。

## 5. I2 · 自然语言纠正与知识演化

### 目标

把用户纠正变成有权威边界、可预览影响、可提交、可回滚的 Evolution Transaction，并让后续 Agent 行为改变。

### 交付

- `propose_correction`：解析 FACT / DECISION / PREFERENCE、scope、旧对象与影响计划；
- `commit_correction`：要求 proposalId、expectedKnowledgeVersion、幂等键和 actor；
- project/personal/global 权限矩阵；
- Claim/Relation/Wiki/索引局部失效与重建；
- checkpoint 与 rollback 的产品入口。

### 当前工程状态（2026-08-13）

typed 与自然语言 Proposal、PERSONAL/PROJECT 权威分流、FACT 争议、幂等 commit、Wiki 局部重建和受控回滚已经进入 Application 与 MCP。FACT 补证据路径也已实现：只有新材料编译出的物质证据 FACT 与 audit-current 的 `SUPERSEDES/CONTRADICTS` Relation 才能触发现有 Evolution Transaction；用户断言本身不成为事实证据。快照回滚在出现后续知识变更时 fail-closed，要求补偿性纠正，不能覆盖后来材料。该结论是 44 files / 296 tests 的工程证据，不是长期产品效果证据。

### Eval

使用 Evolution 现有 24 文档、20 episode 和用户新增真实纠正日志，固定 affected/unaffected 配对：

- 偏好在 PERSONAL scope 生效，不污染 GLOBAL；
- 项目决策只在有权角色和 project scope 生效；
- 外部事实纠正先让旧结论 DISPUTED/UNRESOLVED，不自动把用户新说法确认为世界事实；
- 下一次相关任务不复发旧错，所有无关对照保持稳定；
- 失败或回滚后索引与知识版本一致。

## 6. I2.5 · Question-Centered Memory

### 目标

在长期 Pilot 前完成 Product Definition PD-05：从人主动选择的材料中自动形成并持续维护围绕
长期问题的 WikiModule，使跨材料新增、条件、冲突、取代和 Gap 更新同一个稳定问题，而不是按
输入文章生成摘要模块。

### 施工合同

以 `docs/specs/question-centered-memory-contract.md` 和 ADR 0002 为准，按 Q0–Q6 推进。
Question evolution 位于跨材料 Relation 审计发布后、ingest COMPLETE 前；形成模型只有提议权，
确定性门禁与原子发布拥有 Canonical 派生视图写入权。

### 验收

- A1–A10 硬门禁全部通过，不使用加权平均豁免失败；
- 第一篇材料可形成稳定问题，后续材料更新同一身份；
- 条件、争议、UNRESOLVED、Gap 与 SUPERSEDED 保持不同语义；
- 所有可见断言保持 Claim → Evidence 闭包；
- 无关模块 hash 稳定，失败可恢复，merge/split 可解释、可回滚；
- Context Pack 只消费 ACTIVE 且 support contract 与 knowledgeVersion 有效的模块。

### 停止规则

若实现要求摄入 Agent run、让 Wiki 文本成为证据、重启 R1 竞赛或同时重写 Compiler/Graph，立即
退回责任边界。若小型真实使用显示长期问题视图不优于 Claim-only 阅读，则在 I3 前收缩 formation
或 Wiki consumption，不以模块数量续命。

## 7. I3 · 真实长期 Pilot

### 目标

最终判断 WikiMemory 是否值得作为独立产品存在，而不是判断某个内部组件分数高低。

### 最小设计

- 30 天；
- 5 个以上真实领域；
- 100 个以上真实任务；
- 至少 2 次纠正/替代周期；
- 基线为同一 Agent + 文件夹/强原文检索；
- 同模型、同工具权限、报告总 token/延迟/人工维护。

### 当前观测底座（2026-08-13）

MCP 已增加独立 `pilot` 观测写 capability。启用时，每次 `query_context` 自动产生不含原始任务的 WIKIMEMORY 查询收据，记录 task/context HMAC、knowledgeVersion、选中 Claim/Relation/Wiki/Source 与实际可见 token；`register_pilot_baseline` 为同任务、同上下文预算登记不接收 WikiMemory Context 的 BASELINE 臂。两臂都通过 `record_pilot_outcome` 显式提交回答 HMAC、成功/失败、重复解释、已纠正错误复发、硬失败和用户接受信号。`get_pilot_status` 按臂聚合并区分“查询已配对”和“两臂结果均已提交”，`mark_trusted_checkpoint` 冻结当时知识版本与 Pilot 状态。观测目录位于 `runs/pilot/`，不属于知识快照，避免知识回滚抹掉坏结果证据。该底座允许开始小样本真实 Pilot，但没有真实数据前不得宣称指标改善；当前协议不能强制外部 Baseline 的模型、工具权限和总提示 token，执行者仍须按预注册实验合同冻结这些变量。

### 产品通过条件

- 重复解释下降至少 30%；
- 已纠正旧错复发不高于 5%；
- 跨来源完整性优于基线且 hard failure 不增加；
- 关键结论可回到条件与 SourceSpan；
- 成本和恢复负担可接受，用户愿意继续使用。

若文件夹 + Agent 长期稳定等效，收缩在线组件或产品范围；不得用 Claim、Relation 或 Wiki 数量为产品续命。

## 8. 数据与权限

- 当前不需要再搜一批大 Benchmark 才能开始 I0/I1；现有资产足够做接口和回归。
- I2 需要用户提供少量真实纠正/决定/偏好 episode，尤其是作用域边界样本。
- I3 必须来自用户真实任务日志；模型生成题只能作为 Dev/Silver。
- Blind 候选生成者、Evaluator 与最终裁决者必须在文件与工具权限上隔离；提示词承诺不算权限隔离。

## 9. 文档与裁决纪律

- Product Definition：为什么存在、必须达成什么；
- Architecture Baseline：理想系统的模块与不变量；
- Knowledge Contract：知识对象和状态语义；
- Implementation Status：当前事实和差距；
- 本文：当前施工顺序、门禁与停止规则；
- Benchmark：如何构造证据；
- README：入口，不产生新决策。

方向改变必须来自新产品约束、可复现事故、跨域重复证据或用户明确拍板，并以 ADR 留痕。单次 Dev 分数不得改写架构。
