# WikiMemory

WikiMemory 是面向通用 Agent 的可演化知识与长期记忆层。它把人主动选择的多领域知识材料，以及经显式权限合同提交的权威声明与纠正，转化为围绕长期问题、可追溯、可版本化、可撤销的加权证据拓扑，并按任务生成有预算、保留证据闭包的 Context Pack。Agent 运行、工具日志、任务结果和一般对话不会自动成为知识输入。

它不是一个给人维护页面的 Wiki，也不是把 Graph 遍历结果全部塞进 Prompt 的 RAG 包装器。长期目标和当前实现必须分开阅读：

如果你只想弄清“这个目录里每一类东西是什么”，先看 [仓库地图](docs/repository-map.md)。

- [产品定义](WGEMemory4LLM-Product-Definition.html)：为什么存在、什么结果才算成功；
- [目标架构](architecture-baseline.html)：理想 WikiMemory 的模块、数据、接口、权限与部署边界；
- [知识语义合同](docs/specs/knowledge-contract.md)：Claim、Relation、scope、状态与时间语义；
- [长期问题合同](docs/specs/question-centered-memory-contract.md)：QuestionFrame、WikiModule 与加权状态语义；
- [收敛基线](docs/specs/wikimemory-convergence-baseline-v1.md)：能力账本、C0–C3 阶段与闭合规则；
- [实施状态](docs/status/implementation-status.md)：代码目前真实做到了什么；
- [收敛迭代合同](WGEMemory4LLM-Iteration-Operating-Plan.md)：C0–C3 施工顺序、验收向量、预算与停止规则；
- [Benchmark 手册](WGEMemory4LLM-Benchmark.html)：如何构造开发、回归、盲测和长期产品证据。
- [I3-Sim 最终验收](docs/verification/i3-sim-gate-result-2026-08-24.md)：本轮 NO-GO、成本台账和下一阶段输入证据。

## 当前裁决

当前内核是 **integration-ready，尚非 Product-MVP**：I0–I2 的应用、协议、纠正和演化工程链已闭合；I2.5 已完成围绕长期问题形成和维护 WikiModule 的机制，包括稳定 QuestionFrame、语义提议/确定性门控、结构化 WikiModule V2、问题拓扑演化、pending/retry、崩溃重放、Context Pack/Trace 和 Material Impact Report。FACT 不由用户断言或 Wiki 文本反向确真。

I3-Sim 已于 2026-08-24 以 **NO-GO** 闭合：结构运行和 Wiki 消费成立，但只有 2 个 causal wins / 1 个 winning domain，出现 2 个 hard failures，且争议、取代、条件和权威差异没有形成充分的产品语义。当前最核心缺口不是再做一轮 Pilot，而是 K3 Weighted Semantic Flow：让 `CURRENT` 只表示给定知识版本、适用范围和任务下可解释的领先分支，并保留争议、条件、未决与历史分支。

当前使用收敛路线；每阶段都必须先冻结主变量、输入、接受向量、预算、非目标、停止条件和闭合产物：

1. **C0 · Convergence Baseline**：已闭合；固定产品边界、能力账本、加权证据流与阶段纪律；
2. **C1 · Weighted Question State**：当前仅起草合同；只处理领先、争议、限域、取代、未决和历史分支；
3. **C2 · Budgeted Information Flow**：确定性机制优先，模型预算只用于高价值歧义；
4. **C3 · Longitudinal Use**：C1/C2 稳定后才设计真实跨时间使用，不预承诺旧 30 天固定阈值。

## 仓库结构

```text
.
├── src/                         # 当前知识内核；单元/集成测试与实现并置
├── scripts/                     # 历史实验、审计、迁移和诊断入口；不是产品 API
├── docs/
│   ├── specs/                   # 稳定语义与接口合同
│   ├── status/                  # 当前实现事实
│   ├── operations/              # 可执行 Runbook
│   ├── verification/            # 有日期的验证证据
│   ├── benchmarks/              # 数据采集与密封合同
│   └── history/                 # 被取代的方向/架构/计划快照
├── benchmarks/                  # 新 Benchmark 命名入口与历史问题集索引
├── experiments/                 # 已揭示实验结果；只作历史和回归
├── references/                  # 外部论文与参考仓库，不属于产品代码
├── sources/ publications/       # 当前 legacy 知识状态
├── quarantine/ versions/ wiki/  # 隔离、版本和物化视图
├── runs/ indexes/               # 历史运行与可重建索引
└── mathtest-material/、batch-*/、workbuddy-*/、benchmark-s200-*/
                                  # hash 冻结的 legacy 数据路径，待兼容迁移后归位
```

为什么仍保留若干根目录数据集：历史脚本、manifest 与密封合同记录了这些路径和 hash。当前整理优先修正责任边界，不为了目录整齐破坏复现。新实验统一进入 `benchmarks/`；外部参考已进入 `references/`。

## 本地验证

要求 Node.js 20 或更高版本。

```bash
npm install
cp .env.example .env
# 配置 DEEPSEEK_API_KEY；不要提交 .env

npm run typecheck
npm run lint
npm test
npm run build
```

本地 Agent 接入使用 MCP stdio。运行根必须先显式初始化；默认 MCP 仅注册读取工具，摄入能力必须明确开启：

```bash
npm run dev -- --runtime-root ./runtime-data init
WGE_RUNTIME_ROOT=./runtime-data npm run mcp

# 需要提交材料时才给该 MCP 进程摄入能力；耗时编译由独立 Worker 执行
WGE_RUNTIME_ROOT=./runtime-data WGE_MCP_CAPABILITIES=read,ingest npm run mcp
WGE_RUNTIME_ROOT=./runtime-data npm run worker

# 纠正能力还要求在进程边界注入身份与项目角色；工具参数不能自报 principal
WGE_RUNTIME_ROOT=./runtime-data \
WGE_MCP_CAPABILITIES=read,correct \
WGE_MCP_PRINCIPAL_ID=mixi \
WGE_MCP_PROJECT_ROLES='{"wikimemory":"owner"}' \
npm run mcp

# 真实长期 Pilot：只有显式 pilot capability 才保存 HMAC 化查询收据和结果信号
WGE_RUNTIME_ROOT=./runtime-data \
WGE_MCP_CAPABILITIES=read,pilot \
WGE_MCP_PRINCIPAL_ID=mixi \
WGE_PILOT_HASH_KEY='replace-with-a-random-local-secret' \
npm run mcp
```

`ingest_material` 接收用户明确投递的 Markdown 内容，只做不可变 Source/Span 落盘和 Job 排队，不读取任意本地路径，也不承诺调用返回时已经编译完成。建议显式传入 `domain`（也可放在 `metadata.domain`）；只有声明 domain 的材料才进入长期问题形成，未声明时 Claim/Relation 编译仍可完成但 Question 维护会明确跳过。Agent 应使用 `get_ingest_status` 查询 Job 与编译阶段。

`query_context` 只返回紧凑 Agent Context Pack，不返回内部检索/Graph diagnostics；响应同时给出请求预算和实际序列化 token。PERSONAL 偏好作为有界的 `standingInstructions` 注入本人作用域，并随附 AssertedRecord。纠正工具只有 `correct` capability 且进程已注入主体身份时才注册。自然语言解析只生成草案，权限由确定性策略决定，并要求调用者确认解析出的类型后才可提交；无目标 FACT 进入 `NEEDS_EVIDENCE`，针对既有 FACT 的纠正先把旧结论置为 `DISPUTED`。后续调用 `resolve_fact_correction` 时必须指定已审计、含物质证据的替代/冲突 Relation；`rollback_fact_resolution` 只在其后没有知识变更时允许恢复，避免抹掉后来摄入的材料。

`pilot` 是独立 opt-in 观测写 capability，并强制同时启用 `read`、注入 principal 与本地 HMAC 密钥。启用后 `query_context` 会写查询收据，因此 MCP 元数据不再把它标成纯只读或幂等；它仍不改变 Canonical 知识。`register_pilot_baseline` 为同任务、同上下文预算的外部文件夹 Agent 运行登记 BASELINE 臂，不向该臂提供 WikiMemory Context；WikiMemory 查询自动登记另一臂。两臂都通过 `record_pilot_outcome` 保存回答 HMAC、成功/失败、重复解释、纠错复发、硬失败和用户接受信号，原始任务与回答不落盘。`get_pilot_status` 按臂聚合并报告已配对任务/结果，`mark_trusted_checkpoint` 只记录信任标记而不改变知识。模型、工具权限和总提示预算仍需 Pilot 执行者按实验合同保持一致，当前协议只能验证 WikiMemory 可见上下文预算。

当前 CLI 仍是兼容/运维入口，不是最终 Agent 合同：

```bash
npm run dev -- --runtime-root ./runtime-data init
npm run dev -- --runtime-root ./runtime-data status --json
npm run dev -- --runtime-root ./runtime-data ingest-status
npm run dev -- status
npm run dev -- ingest mathtest-material/01-number-systems.md --domain mathematics --recompile --json
npm run dev -- query "Cauchy 列、实数完备性与完备空间之间的关系" --budget 12000 --depth 3 --json
npm run dev -- trace claim:example
```

Docker Compose 已定义同镜像的 MCP、Worker 与运维 CLI，并共享命名卷。2026-08-13 已在隔离 Compose project 中实测：镜像可构建、运行用户为非 root UID 1000、镜像只含 dist/package/生产依赖、生产依赖审计为 0 漏洞；通过真实 MCP 提交 PENDING ingest Job 后删除并重建容器，相同 Source、Job ID、状态与 knowledgeVersion 可从命名卷恢复；另一次隔离验证通过真实 MCP + Worker + DeepSeek 完成 Markdown 摄入、语义门禁、查询和 SourceSpan 追溯，总 usage 4,032 tokens。细节见 [Docker 在线集成验证](docs/verification/docker-online-e2e-2026-08-13.md)：

```bash
docker compose build
docker compose --profile tools run --rm wge-cli init
docker compose up wge-worker
docker compose run --rm wge-cli status --json
```

## 不变量

- Source / SourceSpan 是不可变证据根；Claim、Relation、Wiki 和索引均为派生状态。
- 只有人主动选择的知识材料或显式授权的断言/纠正可以进入编译；Agent run 和 Pilot outcome 只承担运行与评估作用。
- `CURRENT` 是给定 knowledgeVersion、scope 和 task 下的领先/证据支持更强投影，不是客观真理；新材料增加重新检查优先级但不自动覆盖旧证据。
- Graph 是长期治理基础设施，在线仅按任务条件参与候选导航；候选遍历不自动进入 Prompt。
- Quarantine、旧审计版本和越权 scope 默认 fail-closed。
- MCP、HTTP 与 CLI 必须调用同一 Application Service，不得复制业务规则。
- Benchmark/Gold、密钥、实验日志、外部参考和用户知识状态不得进入生产镜像。
- 历史数据可以重跑作回归，但已揭示集合永远不能重新命名为 Blind。
- 产品成功最终由 Agent 长期行为改善证明；当前阶段先以不变量、加权语义与质量—成本接受向量闭合，不由 Claim、Relation、Wiki 数量、发布日期或一次 Dev 分数证明。

完整当前数字、测试资产使用情况和已知风险见 [实施状态](docs/status/implementation-status.md)。
