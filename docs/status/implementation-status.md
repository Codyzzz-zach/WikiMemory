# WikiMemory 实施状态

> 更新时间：2026-08-25
> 文档职责：只记录当前代码和数据真实做到了什么，不定义理想架构。目标架构以根目录 `architecture-baseline.html` 为准；历史 v3.3 快照见 `docs/history/architecture-baseline-v3.3-2026-08-12.html`。

## 当前裁决

WikiMemory 已达到 **Integration-ready knowledge kernel + question-centered derived memory**。I0 的 Application/runtime/单写者/Job/Worker、容器镜像与单机卷恢复边界已完成，I1 的 MCP stdio 已通过真实协议验证；I2 工程链已覆盖自然语言纠正、权限分流、FACT 补证据、关联边演化和受控回滚；I2.5 已加入稳定 QuestionFrame、语义提议与确定性门控、WikiModule V2、merge/split/archive/reopen、ingest pending/retry、崩溃重放收据、Context Pack/Trace 与 Material Impact Report。

2026-08-24 的 I3-Sim 已按冻结合同以 **NO-GO** 闭合：18/18 材料完成编译、6/7 任务形成配对结果、2 个 causal wins，但只有 1 个 winning domain，出现 2 个 hard failures，且 3 个目标 Episode 均未完整成立。该结果证明可追溯 Wiki 可被 Agent 消费，也证明当前 `CURRENT/CONDITIONAL/DISPUTE/SUPERSEDED` 物化仍不能表达产品需要的加权语义流。项目当前处于 **C0 已闭合、P0 问题假设语义增补已接受、C1 合同已接受、C1-A/B 已通过并进入 C1-C Pure Shadow**；deterministic Micro 通过前外部模型预算为 0，不是 Product-MVP，也未授权真实 Pilot。I2.5 证明的是问题身份机制，不是问题假设已经获得长期语义身份。

### 能力账本

| 层级 | 当前事实 |
|---|---|
| K0 · Evidence Kernel | 已形成稳定基础，可作为后续硬不变量 |
| K1 · Agent Runtime | 已形成稳定基础，可作为后续硬不变量 |
| K2-M · Question Identity Mechanism | I2.5 机制已闭合；真实材料开发验收通过 |
| K2-S · Question Identity Semantics | 未证明；AI 匹配、长期稳定性与可消费/身份成熟分离待 C1.5 验证 |
| K3 · Weighted Semantic Flow | 未完成；I3-Sim 暴露关系召回、条件表达、权威与跨版本分支缺口 |
| K4 · Budgeted Task Value | 部分具备；I3-Sim Wiki arm 平均总 token 比 baseline 高约 52.4%，尚未形成边际价值策略 |
| K5 · Longitudinal Product Value | 未证明；旧 30 天 Pilot 指标不是当前承诺 |

## 代码基线

| 能力 | 当前事实 | 裁决 |
|---|---|---|
| Loader / Ingest | Markdown Loader、Source/Span、hash 去重已实现；其他格式只有合同边界 | 可作为 MCP ingest 后端 |
| Compiler | token 预算分批、有界重试、telemetry、Claim/Relation 分阶段编译；调用日志可按 Source/Run/Stage 汇总 provider token、缓存命中、截断/无效解析和 tokens/Claim | 工程基线成立；尚未冻结生产成本阈值 |
| Publication | Canonical/Quarantine 物理隔离、原子替换、generation | 工程基线成立 |
| Retrieval | Unicode/别名 Seed、持久局部索引、generation fail-closed | R0 可作为读取默认 |
| Graph | 类型语义、审计门禁、候选导航和历史 R1 实验存在 | 治理底座保留；在线策略未获生产批准 |
| Context Pack | 预算、证据闭包、选择 Trace、compact transport；ACTIVE QuestionFrame 对应的 WikiModule V2 只有在 Question/Claim/Relation/局部支撑闭包全部一致时才可见，结构化 Gap 进入 knownGaps；indexed 模式会为已命中模块回填索引邻域外的完整支撑证据 | 工程闭包成立；多模块同时消费仍服从最终 token budget |
| Wiki | 稳定 QuestionFrame 地址与 Source/heading 身份分离；同问题更新、候选晋升、merge/split/archive/reopen、条件/争议/未决/Gap 分态物化、局部稳定哨兵与 Material Impact Report 已实现 | K2-M 机制闭合；`ACTIVE/CANONICAL` 仍同时容易被解读为可消费与长期稳定，K2-S 未证明。I3-Sim 中 155 assertions 为 145 CURRENT、10 CONDITIONAL、0 DISPUTE、0 SUPERSEDED，不能宣称加权语义流已完成 |
| Evolution | 自然语言解析与提交分权；typed Proposal；PERSONAL/PROJECT 权限分流；幂等 commit；FACT 争议不自动确真；新证据必须编译成物质证据 FACT，并经审计版 SUPERSEDES/CONTRADICTS 接入快照事务；Wiki 局部重建；崩溃恢复收据；禁止旧快照覆盖后续知识 | 工程链闭合；真实 Agent 长期不复发尚未验证 |
| Application | query/status/trace 与 ingest/cross-material/question/wiki 状态机均在 Application；Question/Wiki 失败进入 `QUESTION_UPDATE_PENDING`，同步失败补偿回滚，进程中断由持久收据幂等重放 | 文件存储尚未抽成完整 Repository ports |
| MCP / HTTP | 官方 TypeScript SDK v2 stdio；I1 四工具 + capability-gated typed/natural-language correction、FACT 证据演化、两类受控回滚，以及 opt-in Pilot outcome/status/checkpoint；身份由进程注入，工具不能自报 principal；真实子进程 E2E | HTTP 未实现；MCP 当前为单用户本地入口 |
| Pilot observation | 查询收据保存 task/context HMAC、knowledgeVersion、选中对象和 visible token；反馈保存 answer HMAC、结果、重复解释、纠错复发、硬失败和用户接受；原文不落盘、principal 隔离 | 观测底座完成；I3-Sim 是模拟 Gate 且结果 NO-GO，尚无真实长期数据，不能计算产品增益 |
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

- Vitest：54 files / 346 tests；
- TypeScript：`src` 与 `scripts` 严格 typecheck；
- Biome：`src` 与 `scripts` 全量检查；
- I0/I1 新增覆盖：Application 与生产核心语义 parity、完整 ingest 状态机、持久 Job 幂等与失败、abandoned Worker 恢复、runtime v1→v2 显式迁移、MCP 官方客户端握手、默认只读/显式 ingest capability、MCP durable submission、Docker allowlist/Compose 合同；
- I2.5 新增覆盖：输入顺序身份稳定、跨材料命中既有问题、候选/晋升、条件/争议/未决/Gap 分态、merge/split 身份迁移、无关哨兵 byte-stable、同步回滚、进程中断重放、Context Pack fail-closed 与 Question Trace；这些是 K2-M 机制证据，不证明跨来源、跨时间的 K2-S 身份成熟；
- 2026-08-20 已用 4 篇数学材料完成一次开发验收：首篇形成、无关材料隔离、三个跨材料问题更新、26/26 模块局部支撑闭包以及 indexed Context 消费通过；详见 `docs/verification/question-centered-memory-real-material-acceptance-2026-08-20.md`。
- 2026-08-24 已完成 I3-Sim：18 Sources、201 Claims、2 Canonical Relations、21 WikiModules；6 个 paired tasks 中 2 wins / 1 winning domain / 2 hard failures，最终 NO-GO。详见 `docs/verification/i3-sim-gate-result-2026-08-24.md`。
- 当前核心缺口：围绕冻结问题的加权语义流，以及问题假设的跨来源/跨时间持续身份；关系召回、技术域条件表达、逐断言引用覆盖与质量—成本边际价值仍是相邻缺口。HTTP、远程/多主机运行未实现，但不是 C1/C1.5 主变量。

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
| I2.5 | PASS_MECHANISM / K2-M CLOSED | 问题身份持久化、物化、恢复和消费机制；不是 K2-S 身份持续性或 K3 加权语义证明 |
| I3-Sim | NO-GO | 保留 18 份冻结材料、6 个 paired tasks、成本台账和 hard failures，作为 C1 输入证据 |

## 测试资产使用情况

- Batch A：14 Source、62 候选任务；Dev/Regression。
- Batch B：12 Source、32 题；32 题已进入在线回答或诊断；Dev/Regression。
- Batch C：12 Source、18 题、54 份 B/P-seed/P-graph 首轮答案；已揭示，Dev/Regression。
- Evolution：24 时序文档、3 领域、36 题、144 四时点 Gold；用于 M1/M2 和纠正回归。
- S200：冻结 140 Source、60 题、20 episode；历史只反复编译 3/4/12 Source canary，未全量编译 140 Source。
- 数学材料：20 篇 Markdown；根知识状态只摄入 6 篇，继续仅作条件保真回归。
- I3-Sim：18 份 Stage A 冻结材料、3 个领域、7 个任务、6 个完整 paired outcomes；用于 C1 加权状态输入切片和 C2 成本基线，不再冒充新 Blind。

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
8. 现有 schema 的 `ACTIVE/SUPERSEDED` 与 Wiki assertion role 是工程状态，不应直接展示为客观真理；`ACTIVE/CANONICAL` 也不应展示为长期身份成熟。`CURRENT` 只应表示给定知识版本、适用范围和任务下的领先投影；该投影机制尚未实现。

## 下一阶段

当前完成 **C1-A/B Freeze 与 Contract/Micro**，进入 **C1-C Pure Shadow**：

1. 冻结唯一问题：同一长期问题下，新旧证据如何形成可解释的领先、争议、限域、取代、未决和历史分支；
2. 冻结 QuestionFrame 集合；形成、匹配、promotion、merge/split/archive/reopen 不进入 C1 主变量；
3. 优先复用 I3-Sim 三个 Episode 与六个 paired tasks、I2.5 真实材料、Evolution 纠正/取代、数学条件陷阱和跨域无关哨兵；
4. 输入收据、projection schema、reason code、Evolution Micro 与失败样例已冻结并通过 portable/freeze-host 校验；
5. 不同时扩 Loader、检索、UI、知识来源或 Pilot；不继续修补 I3-Sim 来改写 NO-GO；
6. C1-C 只实现纯函数 sidecar projection、隔离写入、grounding、replay 与 unrelated-sentinel 校验，保持 0 provider calls；只有 deterministic Micro 通过后才可按合同进入后续歧义调用决策；
7. C1 闭合后再冻结 C1.5 合同，独立验证 QuestionHypothesis 的复用、重叠、分裂、合并与身份成熟。

权威路线见 `docs/specs/wikimemory-convergence-baseline-v1.md` 与 `WGEMemory4LLM-Iteration-Operating-Plan.md`。旧 Goal 不再无限延长，Discovery Backlog 不自动改变当前阶段。
