# ADR 0002：在 I3 前插入 Question-Centered Memory 阶段

- 状态：Accepted（I2.5 机制已闭合；Q6→I3 后续路线由 ADR-0003 取代）
- 日期：2026-08-20

## 背景

产品定义将“按长期问题维护 WikiModule”列为 Product MVP P0，但当前实现状态只有单 Source、
章节结构驱动的自动形成工程基线。现有 `formWikiModuleSeeds` 以 Source heading 作为分组和地址
信号，且未进入生产 ingest 链；现有 evolution 只能重建已经存在的模块。

I0–I2 已完成运行边界、Agent 读取、自然语言纠正和知识演化工程链。若直接进入 I3，长期 Pilot
主要测量 Claim 检索、Context Pack 和纠错能力，不能有效检验围绕长期问题的 Memory 复利。

2026-08-20，产品负责人明确确认以下方向：自动形成并持续维护长期问题 WikiModule；问题身份
独立于文章结构；无答案问题保留为 Gap；自动 merge/split 必须版本化、可解释、可回滚。

## 决策

1. 在 I2 与 I3 之间插入 I2.5 `Question-Centered Memory` 产品阶段；I3 不取消，后移一个门禁。
2. 引入持久化、可重建的派生 `QuestionFrame`，将长期问题身份与 WikiModule 当前答案分离。
3. WikiModule 升级为结构化物化视图，保留当前认识、条件分支、争议、未解决项、Gap 和历史引用。
4. 自动形成采用语义提议与确定性门禁分权；解析/生成模型没有发布权。
5. Question evolution 位于跨材料 Relation 审计发布之后、ingest COMPLETE 之前。
6. 保存最小 QuestionEvolutionDecision 以支持解释、重放、局部重建和回滚；不建设通用 Agent
   事件记忆，也不把运行日志变成知识输入。
7. 使用 `docs/specs/question-centered-memory-contract.md` 的 A1–A10 合取验收函数；历史
   Benchmark 只承担回归，不启动新的昂贵泛化证明。

## 实施顺序

- Q0：合同、验收函数和 Episode；
- Q1：QuestionFrame、WikiModule V2、演化决策领域模型；
- Q2：Schema、Lint、存储、版本兼容和回滚；
- Q3：shadow formation、确定性门禁和生命周期；
- Q4：ingest 状态机、原子发布与失败恢复；
- Q5：Context Pack、Trace 和 Material Impact Report；
- Q6：小型真实使用通过后进入 I3。

## 结果

- 2026-08-20 的 I2.5 机制和真实材料开发验收已完成，作为 K2 Long-Question Identity 基线保留。
- 2026-08-24 的 I3-Sim 以 NO-GO 闭合；它证明 K3 Weighted Semantic Flow 未完成。后续不再执行
  Q6→旧 I3 路线，改按 C1→C3 收敛合同推进。
- 原 I3 一周/30 天 Pilot 计划在 Q1–Q5 硬门禁通过前不作为 WikiMemory Product-MVP 裁决；
  ADR-0003 接受后，该计划继续暂停，直至新的 C3 合同冻结。
- Compiler、Relation audit、R0 Retrieval、MCP Transport 和 Pilot observation 不在 I2.5 主变量内。
- 单篇材料仍可产生立即可用的 ACTIVE 问题，但 stable identity 不允许依赖 Source ID 或 heading。
- 派生层失败不能回滚已经安全发布的 Canonical Claim；它进入显式 pending/retry，且旧模块不能
  冒充当前 knowledgeVersion。

## 参考

- `WGEMemory4LLM-Product-Definition.html`：PD-05；
- `docs/status/implementation-status.md`：Wiki 当前缺口；
- `docs/adr/0003-weighted-evidence-flow-and-convergence-stages.md`：后续加权语义与收敛路线；
- `experiments/h1-wiki-formation/adjudication-v1.json`：H1-A 工程基线裁决；
- `AI-Native项目迭代闭环的故事哲学_研究更新版_2026-08`：可能性、拓扑、测量、历史、学习与治理
  的抽象方法；该文档提供迭代透镜，不产生产品输入扩张。
