# WikiMemory 实施状态

> 更新时间：2026-08-13
> 文档职责：只记录当前代码和数据真实做到了什么，不定义理想架构。目标架构以根目录 `architecture-baseline.html` 为准；历史 v3.3 快照见 `docs/history/architecture-baseline-v3.3-2026-08-12.html`。

## 当前裁决

WikiMemory 已达到 **Integration-ready knowledge kernel + local Agent integration boundary**。I0 的 Application/runtime/单写者/Job/Worker、容器镜像与单机卷恢复边界已完成，I1 的 MCP stdio 四工具已由官方客户端真实握手并完成一次容器内在线编译/查询/Trace；I2 工程链已覆盖自然语言受限解析、Proposal、权限分流、偏好常驻指令、幂等提交、FACT 争议、物质证据升级、关联边演化、Wiki 局部重建和受控回滚；I3 已具备 BASELINE/WIKIMEMORY 双臂隐私观测底座。当前尚未达到 Product-MVP：长期真实不复发、无关任务稳定与相对基线增益仍待验证。

## 代码基线

| 能力 | 当前事实 | 裁决 |
|---|---|---|
| Loader / Ingest | Markdown Loader、Source/Span、hash 去重已实现；其他格式只有合同边界 | 可作为 MCP ingest 后端 |
| Compiler | token 预算分批、有界重试、telemetry、Claim/Relation 分阶段编译；调用日志可按 Source/Run/Stage 汇总 provider token、缓存命中、截断/无效解析和 tokens/Claim | 工程基线成立；尚未冻结生产成本阈值 |
| Publication | Canonical/Quarantine 物理隔离、原子替换、generation | 工程基线成立 |
| Retrieval | Unicode/别名 Seed、持久局部索引、generation fail-closed | R0 可作为读取默认 |
| Graph | 类型语义、审计门禁、候选导航和历史 R1 实验存在 | 治理底座保留；在线策略未获生产批准 |
| Context Pack | 预算、证据闭包、选择 Trace、compact transport；偏好作为作用域常驻指令并携带 AssertedRecord；MCP 核验完整可见负载 token | Agent DTO 不暴露内部 diagnostics |
| Wiki | M1/M2/H1-A 证明纠错与自动形成机制 | 单 Source/章节工程基线；跨来源长期主题未完成 |
| Evolution | 自然语言解析与提交分权；typed Proposal；PERSONAL/PROJECT 权限分流；幂等 commit；FACT 争议不自动确真；新证据必须编译成物质证据 FACT，并经审计版 SUPERSEDES/CONTRADICTS 接入快照事务；Wiki 局部重建；崩溃恢复收据；禁止旧快照覆盖后续知识 | 工程链闭合；真实 Agent 长期不复发尚未验证 |
| Application | query/status/trace 与完整 ingest/cross-material 状态机均在 Application；CLI/MCP 不复制业务规则 | 文件存储尚未抽成完整 Repository ports |
| MCP / HTTP | 官方 TypeScript SDK v2 stdio；I1 四工具 + capability-gated typed/natural-language correction、FACT 证据演化、两类受控回滚，以及 opt-in Pilot outcome/status/checkpoint；身份由进程注入，工具不能自报 principal；真实子进程 E2E | HTTP 未实现；MCP 当前为单用户本地入口 |
| Pilot observation | 查询收据保存 task/context HMAC、knowledgeVersion、选中对象和 visible token；反馈保存 answer HMAC、结果、重复解释、纠错复发、硬失败和用户接受；原文不落盘、principal 隔离 | 观测底座完成；尚无真实 30 天数据，不能计算产品增益 |
| Runtime / Lock | `WGE_RUNTIME_ROOT`、显式 `init`、layout v2、v1 显式迁移、Canonical 单写者、durable Job、Worker abandoned-job 恢复 | 跨主机只按 heartbeat 超时恢复；无分布式租约 |
| Docker | allowlist 多阶段镜像、非 root UID 1000、MCP/Worker/CLI compose、共享 `/data` 命名卷；镜像实机构建、内容审计、生产依赖 0 漏洞；PENDING Job 跨容器恢复；真实 MCP + Worker + DeepSeek 完成小型 Markdown 的语义编译、查询与 Trace（4,032 tokens） | 远程部署/多主机和长期负载未验证；单个小材料不代表规模结论 |

## 当前主知识状态

`npm run dev -- status` 实测：

- 382 SourceSpan；
- 375 active canonical Claim；
- 26 quarantined Claim；
- 99 stored Relation；当前 audit v2.8 下 0 条可消费 Relation；
- 0 个 Source 达到当前状态机 `COMPLETED`；5 个为 `COMPILED`，1 个为 `SOURCE_INGESTED`。

这些数字是历史 Demo 工作区状态，不是未来容器的默认种子数据，也不代表内核代码失效。

## 自动化验证

- Vitest：45 files / 300 tests；
- TypeScript：`src` 与 `scripts` 严格 typecheck；
- Biome：`src` 与 `scripts` 全量检查；
- I0/I1 新增覆盖：Application 与生产核心语义 parity、完整 ingest 状态机、持久 Job 幂等与失败、abandoned Worker 恢复、runtime v1→v2 显式迁移、MCP 官方客户端握手、默认只读/显式 ingest capability、MCP durable submission、Docker allowlist/Compose 合同；
- 当前缺口：HTTP、远程/多主机运行、长期不复发回归和真实 Agent 人工验收。自然语言解析和 FACT 新证据升级已完成工程测试，但不能写成真实使用已验证。

## 历史 Goal 结算

| 阶段 | 冻结裁决 | 继续承担的作用 |
|---|---|---|
| Goal 0 | PASS | Trace、hash、usage 与闭包回归 |
| Goal 1 | ENGINEERING GATE / NO PRODUCT GAIN | Relation 安全门禁回归 |
| Goal 2 | REWORK | 失败 R1 作为反例；R0 保持默认 |
| Goal 3 | PARTIAL | 持久索引、读取 parity、成本回归 |
| Goal 4 | 组件缓解成立 / 系统预算失败 | SUPPORTS 预筛成本回归 |
| M1 | PASS_MECHANISM_ONLY | Wiki 纠错、回滚、不复发机制 |
| M2 | PASS_DEVELOPMENT_MECHANISM | 多断言 Wiki 完整性机制 |
| H1-A | PASS_ENGINEERING_SAFE_BASELINE | 自动形成工程回归；不是泛化证明 |
| H1 Blind | 未执行 | 暂缓，先完成 Agent 产品入口 |

## 测试资产使用情况

- Batch A：14 Source、62 候选任务；Dev/Regression。
- Batch B：12 Source、32 题；32 题已进入在线回答或诊断；Dev/Regression。
- Batch C：12 Source、18 题、54 份 B/P-seed/P-graph 首轮答案；已揭示，Dev/Regression。
- Evolution：24 时序文档、3 领域、36 题、144 四时点 Gold；用于 M1/M2 和纠正回归。
- S200：冻结 140 Source、60 题、20 episode；历史只反复编译 3/4/12 Source canary，未全量编译 140 Source。
- 数学材料：20 篇 Markdown；根知识状态只摄入 6 篇，继续仅作条件保真回归。

历史 `tests/dev`、`tests/evolution`、`tests/held-out` 已归入 `benchmarks/legacy-question-sets/`，避免与 `src/**/*.test.ts` 的自动化代码测试混淆；这是纯路径整理，不改变题目内容。

## 当前工程风险

1. 本轮已按 `docs/verification/reproducible-baseline-scope-2026-08-13.md` 收口代码与证据边界；
   基线提交和 clean-worktree 验证完成后，以该提交作为当前镜像与后续 Pilot 的代码身份。
2. 文件持久化仍以具体 JSON/JSONL 模块为主；未来换数据库必须先补 Repository ports，不得让 Transport 直接迁移存储逻辑。
3. 根主状态的 Relation 全部 fail-closed，不能用于 MCP 产品演示的 Graph 正向声明。
4. Benchmark/Gold、生产知识状态和运行日志必须在 Docker 与 MCP 阶段物理隔离。
5. Trace 已对 Claim scope、Relation 审计门禁和 Wiki 支持合同 fail-closed，并禁止按 Span ID 任意浏览；MCP capability 与本地 principal/project role 已拆分，组织级策略不在个人 MVP 范围。
6. Docker 单机镜像、卷恢复和一次小型在线编译已经通过；远程网络策略、多主机共享存储和长期负载仍未验证。
7. 摄入调用已有 provider usage 留痕和 `npm run economics:ingest` 只读汇总；它能回答单次 Source 编译用了多少 token、多少消耗来自失败/缩批，但没有足够真实 Pilot 数据前不得拍脑袋设统一成本上限，也尚未形成“编译成本被多少次后续任务摊销”的产品指标。

## 下一阶段

当前进入 I2 的真实使用验收，再准备 I3：

1. 以显式 `read,pilot` capability 开启本地主体 Pilot，先运行一周小样本，检查反馈覆盖率、隐私日志和硬失败分类是否可用；
2. 收集少量真实偏好、项目决策和 FACT 争议 episode，使用已经落地的自然语言 Proposal 与 FACT 补证据工具，验证相关任务改变、无关任务稳定与回滚；
3. 满足观测完整性后再扩大到 30 天/5+领域/100+真实任务；解析 LLM 始终没有提交权。

旧 Goal 不再无限延长；历史资产用于回归，新产品证据来自真实 Agent 闭环。
