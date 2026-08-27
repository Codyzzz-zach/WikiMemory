# WGEMemory4LLM 统一迭代操作合同 v1.5

> 状态：2026-08-12 起生效。本文件把 Product Definition 的目标、Architecture Baseline 的实现边界、Benchmark 的证明方法和每轮施工流程连接成同一份执行合同。它只定义“如何推进”，不重写产品目标、当前实现事实或历史实验结果。

## 0. 文档权限与新起点

根目录方向文档按以下顺序解释，低层文档不得反向改写高层事实：

1. `WGEMemory4LLM-Product-Definition.html`：为什么做、服务谁、哪些原则不可破坏；
2. `WGEMemory4LLM-User-Stories.html`：用户可观察到的行为；
3. `architecture-baseline.html`：截至指定日期，代码和数据真实做到了什么；
4. `WGEMemory4LLM-Benchmark.html`：用什么证据证明质量、泛化和长期价值；
5. 本文件：当前依赖、Goal、停止规则和施工顺序；
6. `WGEMemory4LLM-Pre-Test-Alignment-Audit.html`：一次有日期的对齐审计，不是永久需求源；
7. `README.md`：入口摘要，不创造新规则。

2026-08-12 的新起点是：G0/G1 工程门禁成立，G2 的首个在线 Graph 选择器被 Micro 否决；G3 已建立持久索引、局部读取、结构化 transport 和规模成本证据；Goal 4 接受 SUPPORTS 预审路由作为成本缓解，但四 Source 全链路 321,850 tokens 的系统预算仍失败；M1/M2 已证明证据闭包 Wiki 的纠错、回滚和人工多断言模块机制。H1-A 现已进一步通过任务盲自动形成工程门：512 个 Dev Claim 中 496 个当前可消费 Claim 全部进入 86 个证据闭包模块，16 个拒绝项均为不可消费历史记录；模块在输入逆序和移除一个 22-Claim 来源时保持确定性/无关稳定，且每模块限制 2–8 条 assertion。已揭示 6 题诊断只显示 W-auto 对 R0 的 required Claim 覆盖 11/17 对 10/17、0 题退化，不能冒充盲域产品效果。当前依赖路径更新为“**新 H1 三信封盲集 → P1 长期 Pilot**”；Graph 治理与规模回归继续作为横向基线。

## 1. 当前共同结论

WGEMemory4LLM 的产品目标不是生成更多 Claim、Wiki 页面或 Graph 边，而是让同一个通用 Agent 在持续吸收多领域材料后：

- 更少要求用户重复解释已经提供过的知识；
- 更少复发已经纠正的错误；
- 在跨来源、带条件、存在冲突或发生版本变化的任务中更完整；
- 每个关键结论仍能回到来源、条件、时间和演化记录；
- 在效果相当时，以更少的总 token、工具调用、延迟和人工维护完成任务。

当前可信结论是：安全编译、隔离、审计、版本与实验基础设施已经形成工程基线；产品效果尚未成立。历史 Pilot 证明了压缩潜力，也暴露了检索、跨语言、关系精度、最终证据闭包和实验处理组不独立等问题。所有历史分数都是证据，不是产品结论。

### 1.1 已冻结的 Graph 架构公理

以下问题不再交给小规模问答分数决定：

1. **Typed Graph 是长期知识状态的必要组成。** 它承担冲突、替代、依赖、影响发现、增量更新和 Evolution；知识规模与更新周期增加时，这些价值只会更重要。
2. **目标在线链路必须具备 Graph 候选导航能力，但按任务条件触发。** 需要优化和验证的是触发、结构排序、边权和预算，而不是把 Graph 永久关闭或对每个问题强制运行。
3. **可见 Graph 内容仍然条件触发。** Graph 参与选择不等于把关系和邻居默认追加进 Prompt；可见路径必须证明任务必要性并挤占同一预算。
4. **Eval 是优化仪器，不是 Graph 的生死投票。** R1 暂时不胜只说明当前边质量、ranking、gate、规模或成本实现未达到收益点；离线治理和长期积累继续保留。

这组公理并不保证任意 Graph 实现都会增值。错误边、身份漂移和无边界遍历也会长期复利，因此审计、稳定身份、局部索引、候选/可见分离和增量更新是 Graph 价值成立的必要工程条件。

## 2. 统一在线链路

产品只有一条目标在线链路，不把历史消融组永久产品化：

```text
Task + Scope + Time
  → lexical / alias / metadata Seed retrieval
  → graph trigger decision
  → if triggered: bounded candidate subgraph over consumable audited relations
  → graph-aware relevance and risk ranking
  → visible-context gate
  → Claim + condition + provenance + Evidence closure
  → optional compact relation path / WikiModule
  → model answer
  → citation, outcome and correction feedback
```

### 2.1 Graph 的三个角色必须分离

1. **离线知识治理 Graph：始终存在。** 用于冲突、替代、依赖、影响发现、版本迁移、Lint 和 Evolution；它是否进入 Prompt 不影响这些价值。
2. **在线候选导航 Graph：条件触发。** 可靠 Seed 出现后，只有任务需要跨来源关系、冲突/替代/依赖判断、影响追踪，或 Seed 暴露出可观测覆盖缺口时，系统才在有界候选池中使用当前审计版本、端点闭合、条件明确的 Relation 做结构排序。Graph 不能制造 Seed，也不能越过 scope/time/provenance 边界。
3. **可见 Graph 内容：条件触发。** 只有查询明确要求关系路径、选中 Claim 存在会改变答案安全性的 `REQUIRES` / `CONTRADICTS` / `SUPERSEDES` 等关系，或 Seed 存在可观测覆盖缺口时，才把最小必要路径或邻居加入 Context Pack。其余边只参与内部排序。

`RELATED_TO` 默认只作为弱导航信号，不作为结论证据；未经审计或旧审计版本 Relation 不参加在线导航。候选子图和可见 Context 子图是两个不同对象。

### 2.2 从 CodeGraph 借鉴的逻辑边界

本项目只借鉴 `/Users/mixi/Desktop/WikiMemory/codegraph-main` 中可由代码验证的通用机制：混合检索先定位入口、Graph 建立较宽但有界的候选池、结构相关性参与排序、候选经过 relevance gate、最终只渲染高价值主干并在固定输出上限内按完整单元截断。CodeGraph 的自有 Benchmark 数字未在本项目独立复现，不能写成 WGEMemory 的预期收益。

不能照搬的部分：代码图边多由静态分析产生，而知识 Relation 很多由模型生成。WGEMemory 必须把 relationAuditVersion、conditionStatus、edge provenance、关系类型和人工否决记录纳入边权重与可见性门禁。

## 3. 实验术语与历史标签

后续新实验使用以下处理组：

| 新标签 | 含义 | 用途 |
|---|---|---|
| `B` | 强原文/文件检索基线 | 判断编译知识是否值得存在 |
| `R0` | Claim Seed-only，不使用 Relation 导航 | 隔离编译投影与基础检索贡献 |
| `R1` | Graph-aware retrieval：Graph 只做候选导航与排序，可见路径按门禁加入 | 候选在线机制；首轮失败，不是当前默认 |
| `W` | `R* + WikiModule`，其中 R* 是当时通过门禁的最佳检索底座 | 验证稳定语义组织和更新价值，不与 R1 单轮绑定 |
| `FULL` | `W + Evolution feedback` | 验证持续使用后的长期改善 |

历史报告中的标签保持不改，避免篡改实验记录：

- `P-seed` 对应历史 Seed-only 处理，近似新 `R0`；
- `P-graph` 对应历史“Seed 后追加 Graph 内容”处理，不等于新 `R1`；
- `E-min` 只有在实际存在且被消费的 WikiModule 时才是独立处理组；没有处理差异时必须与对应 P 组合并解释；
- `P`、`E` 是历史阶段性简称，不能继续充当产品组件定义。

## 4. Token 与规模治理

必须分开管理四种预算：

1. **编译调用预算：** 每次模型调用的输入、输出、批次、重试和总 run 成本。
2. **候选预算：** 检索入口数、候选 Claim 数、候选 Relation 数、Graph 深度/节点上限；这些对象默认不进入 Prompt。
3. **可见 Context 预算：** 最终送给回答模型的完整知识单元；知识库扩大时仍保持固定或有限档位。
4. **任务总预算：** Context、系统提示、问题、回答输出、工具调用、重试和 Judge 的总 token/延迟/费用。

当前 12,000 是历史实验中的估算 Context 上限，不是永久产品默认值。现有 ASCII/中文启发式 token 估算可用于候选预裁剪，但最终发送前必须使用目标模型 tokenizer 或供应商 usage 进行核验，并保留安全余量。

规模扩大时，不允许查询时读取全库并临时构建整张图。目标形态是持久化词法/别名/元数据索引与 Relation 邻接索引：先召回小候选集，再在局部子图中排序。知识库规模增加可以提高允许的定向检索轮次或候选池上限，但不能线性扩大单次 Prompt。

预算裁剪必须以完整知识单元为原子：`Claim + conditions + required Evidence + provenance`；Relation 只有两端完整且证据可用时才能保留。不得在最后一层按“Claim 在前、Evidence 在后”的顺序独立裁剪而破坏闭包。

## 5. 每轮 Goal Loop

每次迭代只解决一个可证伪问题。

### 5.1 Freeze

- 写明假设、目标指标、护栏和停止规则；
- 冻结代码 commit、知识快照、数据 split/hash、模型、temperature、prompt 版本、token 档位和 Judge 版本；
- 明确使用 Dev、Held-out 还是 Post-hoc；看过 Gold 的集合永久降为 Dev。

### 5.2 Observe

先运行最小诊断集并保存过程信号，不直接根据最终总分猜根因。

最低过程留痕：

- Seed 候选、分数、匹配通道、语言/别名命中和 drop reason；
- Graph 候选边、审计版本、类型、方向、条件、结构分数和 gate 原因；
- 每个可见 Claim/Relation/Evidence 的选择原因、预计/实际 token 和闭包状态；
- Context hash、知识版本、Prompt hash、模型 usage、工具调用、延迟和错误；
- Compiler 的 proposition→claim→canonical/quarantine/skipped 账本及原因码；
- 回答引用、Judge 评分、人工抽检和 hard failure 分类。

### 5.3 Diagnose

把失败归到单一首要责任层：`source/ingest`、`compiler/audit`、`retrieval`、`graph-ranking`、`context-render`、`wiki`、`answer` 或 `evaluation`。同一题可以有次要因素，但一个 Goal 只选择一个主要可修改机制。

### 5.4 Change

在后续代码阶段实施最小通用改动。禁止加入题号、材料名、领域关键词白名单、Gold 映射或只对单一来源格式有效的奖励捷径。每个改动必须解释为什么能跨领域成立。

### 5.5 Evaluate

按成本从低到高运行：

1. 单元/属性/合同测试；
2. 4–8 题 Micro Suite，必须包含目标失败、相邻风险和至少一个无关控制；
3. Dev Core，验证平均效果与退化；
4. 只有候选版本通过前三级时才运行冻结 Held-out；
5. 重要架构决策再运行真实任务或时间演化实验。

至少报告配对质量差、hard failure、证据召回、条件保真、引用有效率、实际输入/输出 token、工具调用、延迟和跨领域分布。既报告同预算质量，也报告自然运行下的质量—总成本前沿。

### 5.6 Decide and Archive

- 达到目标且护栏通过：保留改动，记录机制解释和适用边界；
- 指标改善但只发生在目标领域：拒绝宣称泛化，增加跨域控制；
- 连续两轮无改善：停止调参，回到根因或收缩机制；
- Held-out 失败：不得继续针对该 Held-out 调参；将其封存结果转为下一周期 Dev，并建立新的盲集；
- 所有 run manifest、结果、过程 trace 和失败样本保留，不覆盖首轮结果。

## 6. Eval 金字塔和判定对象

| 层级 | 回答的问题 | 运行频率 |
|---|---|---|
| Contract | 数据结构、闭包、门禁、原子性是否正确 | 每次改动 |
| Micro | 目标机制是否改变预期失败且没有立即副作用 | 每个 Loop |
| Dev Core | 改善是否跨题型/领域，成本是否可接受 | 候选改动后 |
| Blind Held-out | 改善是否泛化到新领域、新来源簇 | 里程碑 |
| Longitudinal | 新证据/纠正是否改变未来行为且不伤害无关知识 | 阶段发布前 |

Benchmark 必须同时覆盖直接事实、条件、不可回答、冲突、版本、跨材料综合、跨语言和 Evolution。Graph 的价值不能通过故意削弱 B 或只选多跳题来证明；直接事实题同样是重要控制组。

### 6.1 架构大改后的历史测试复用纪律

历史材料和题目可以、也应该在架构大改后全量重跑，但用途必须正确：

- Batch A/B/C、数学材料、Evolution episodes 和历史失败题全部属于 `Dev/Regression`，可用于迁移、回归、成本和机制诊断；架构变化越大，越有必要重跑。
- 原始 Source Snapshot 可以重新编译；旧 publication、答案和评分保持只读。新架构必须创建新的 runId、knowledgeSnapshotHash、configHash 和输出目录，不得覆盖首轮。
- 若数据、题目或 Gold 已经影响过设计，它永远不能重新获得 Blind 身份；“换了新架构”不会恢复盲性。
- 历史分数只有在模型、Prompt、预算、Judge 和知识输入可比时才能做纵向差值；否则只比较同一新 run 内的配对处理组。
- 日常 Loop 不跑全部历史资产：Contract → 4–8 Micro → Dev Core。只有架构候选、数据迁移或里程碑版本才运行全部历史回归。
- 新 Held-out 只承担一次独立泛化确认；揭示后立即进入下一周期 Dev。

### 6.2 Benchmark 执行权限合同

Reasonix、WorkBuddy 或任何子执行器都只能充当受限 Worker，不能同时看到候选实现与 Gold。面向 Benchmark/Gold 的运行必须具备技术隔离，而不只是在提示词里说“不要读取”：

- Worker 在净化的独立 worktree 中运行，只能读取冻结代码、Stage A、运行配置和允许的知识快照，只能写入本次候选目录；
- 候选答案完成后先冻结目录 hash，Worker 不得覆盖首轮输出；
- Evaluator 只读候选和 Stage B/Gold，只写评分与差异报告，不得修改代码或候选；
- Codex 与人类负责最终归因和是否接受改动，Worker/Evaluator 不能自行宣布产品通过；
- 若工具无法提供路径级 allowlist、独立 worktree 或 Gold 隔离，该轮只能作为 Dev/Post-hoc，不能标为 Blind Held-out。

当前 Reasonix 的历史调用仅有流程性角色约束，尚未证明上述物理权限隔离，因此不能把它过去的运行写成完全隔离的盲测。实现项目级沙箱合同之前，Codex 直接负责文档、代码与验证，不把 Reasonix 结果升级为独立裁决。

## 7. Goal 梯度：接下来如何推进

每个 Goal 只解决一个主要因果问题，并以 `Go / Narrow / Rework` 收尾。Graph 的长期存在不由这些 Goal 投票；Goal 优化的是它的可信度、在线选择方式、规模收益和长期复利。

### Goal 0 · 测量可信：建立过程 Trace 与最终证据闭包

> **状态（2026-07-29）：PASS。** v4 Contract 使用 6 题/18 个离线上下文与 4 题/12 次 DeepSeek 在线调用，验证原文/知识输入快照、Seed/Graph/gate/drop/token/hash Trace、278 个 Claim→Evidence 链接、130 个 Relation→Endpoint 链接、实际 usage/latency/toolCalls 与不可覆盖 post-hoc 留痕。权威记录见 `experiments/benchmark-batch-c/post-hoc/goal0-completion-2026-07-29.md`。Goal 0 资产继续作为后续回归门禁。

- **为了什么：**确保分数变化能归因到 compiler、retrieval、graph-ranking、context-render、answer 或 judge，而不是凭总分猜测。
- **测试资产：**现有 A/B/C 中 4–8 道目标失败、相邻风险和无关控制题。
- **通过：**100% run 有知识/配置/题目/Context/Prompt hash；100% 可见 Claim 保持 condition/provenance/Evidence 闭包；Relation 端点闭合；实际模型 token、gate 和 drop reason 可核验；首轮不可覆盖。
- **不通过：**只修观测和闭包，不修改 ranking，不运行全量在线答案。

### Goal 1 · Graph 底座可信：恢复当前审计图并测语义保真

> **状态（2026-07-29）：PASS_ENGINEERING_GATE_NO_PRODUCT_GAIN。** 当时的 audit v2.3 在 35 条 AI post-hoc 组合代理集上得到强边 precision=1.00、recall=0.769；15 条通过边仅进入隔离实验视图。单锚解释扩展在两题中比 R0 多 810 Context tokens、回答代理分无增益，已被否决；策略收紧为“两锚解释边、单锚安全边”。截至 2026-08-12 当前生产门禁已升至 v2.8，主状态仍有 99 stored / 0 consumable，且缺人工 Gold。权威历史证明见 `experiments/goal1/goal1-proof-v1.json`。

- **为了什么：**恢复可信边级语义门槛，并建立“候选导航不等于 Prompt 可见”的拒绝机制；没有可信图不能评价 R1。
- **测试资产：**主库、历史 Relation 人工决定、条件陷阱、Quarantine 分层样本。
- **通过：**可消费边全部满足当前 audit version；Evidence/端点解析 100%；强边人工 precision ≥90%；事实 recall 与条件保真分别达到预注册 L2 门槛；空条件强边为 0；账本闭合；不得降低门禁换边数。
- **不通过：**修稳定身份、证据束、Relation audit 或版本迁移；Graph 继续 fail-closed。

### Goal 2 · 实现 R1：把 Graph 从追加器改成结构选择器

> **状态（2026-07-30）：COMPLETED_REWORK_NO_DEV_CORE。** R1 已在 Goal 1 的隔离可信边视图中实现为有界、可解释、只替换/重排的 opt-in 选择器；8 题冻结 Micro 证明该策略被 R0 支配，因此不得进入默认在线路径，也不得运行 Dev Core。权威证明见 `experiments/goal2/goal2-proof-v1.json`。

- **为了什么：**让 Graph 扩大候选视野、参与排序并替换低价值内容，而不是在 R0 后继续叠加邻居。
- **测试资产：**已运行 8 题 B / R0 / R1 Micro。Dev Core 原计划只在 Micro 通过后运行；本轮未运行是预注册停止规则的正确执行，不是遗漏结果。
- **通过：**候选子图与可见子图分离；只有当前可消费边参与；候选节点/深度有界；目标 Graph 案例证据覆盖改善；直接事实和不可回答控制不产生 hard regression；R1 在同预算质量或自然总成本上形成可解释的 Pareto 改善；可见 Graph 内容都有任务必要性。
- **实测裁决：**R0=7.75 分/1 hard failure/27,768 provider tokens/2.55s，R1=7.50 分/2 hard failures/28,675 tokens/3.01s；R1 质量低 0.25、多 907 tokens、慢约 18%，三个 Claim 替换案例均无涨分。裁决为 **REWORK**：保留 Graph 治理、影响分析和候选 Trace，R0 继续作为在线默认；新 R1 必须另立冻结假设，不能在本轮 Dev 题上调参后冒充确认性结果。

### Goal 3 · 规模与时间复利：证明 Graph 不随知识增长失控

- **当前状态（2026-08-04）：`G3-B2_SAFE_SOURCE_DISCOVERY / COST_UNPROVEN / ONLINE_NOT_APPROVED`。** `SR12_40` 已证明 top-120 路由池能跨六个领域发现 L40 截断线外的必要来源，但会挤掉独有证据。随后冻结的 `EPSI40` 改为从 L40 原样起步：只有某条候选的全部 evidenceSpanId 仍被其他候选引用时，才允许用新来源代表替换。Batch C 18 题 + Batch B 32 题首轮得到 required-source recall 0.841→0.855、逐题 1 胜/0 负；source-bound exact-evidence recall 均为 0.398、逐题 0 胜/0 负；50/50 题保留完整 L40 evidence-span 并集，候选上限仍为 40。代价是平均 Evidence token 807.2→817.04（+1.2%），lexical records loaded 不变，故裁决为 `CORRECTED_SAFE_DISCOVERY_COST_UNPROVEN`，不是 FULL PASS。原始 v1 报告曾把 combined summary 错误过滤成 0 题，已保留原件并通过不重检索、不改候选的聚合修复报告纠正；正确综合 recall 与裁决以 `experiments/goal3/epsi-aggregate-rescore-runs/epsi-aggregate-rescore-v1/report.json` 为准。`EPSI40` 仍不接 Context Pack、不运行回答模型、不进入默认在线链路；下一步把“来源发现”和“成本压缩”拆开，先测真实 Pack 的 Claim/Evidence/索引分层成本，再验证来源级索引或证据区间渲染，不能靠放宽证据保真换 token。
- **为了什么：**CodeGraph 的核心价值来自大规模局部导航和长期影响传播；五篇文章无法证明这一点。
- **测试资产：**全部历史材料重编回归，加 12→50→200 Source 的多领域规模阶梯，以及 T0→Tn 更新事件。
- **通过：**候选池和可见 Context 维持固定上限；单次 Prompt 不随总库线性增长；查询只读取持久索引和局部邻接；required Evidence recall 不随规模显著退化；影响发现率达到预注册门槛；无关更新 hard regression=0；报告总 token、工具调用、延迟、索引和审计成本。
- **不通过：**优先修持久索引、局部读取、来源发现、身份稳定和增量更新，而不是提高 Prompt 上限。G3-A 已通过；G3-B2 收敛为“安全发现但成本未赢”；G3-B3 已完成成本账本：Evidence 合并仅省 0.57% 后停止，结构化 Claim 表离线省 20.36% 且逐行零损失。后续 G3-C/Goal 4 已完成 transport、S200 编译与审计成本诊断；这些规模资产转为 M2 和后续 Held-out 的横向回归，不得回到已揭示 50 题调 17 列或阈值。

### Goal 4 · Relation 审计成本：在不降语义门禁的前提下减少无效 SUPPORTS

- **状态（2026-08-12）：`COMPLETE_WITH_SEPARATED_SYSTEM_BUDGET_FAILURE`。** SUPPORTS 预审路由在冻结回放、在线生命周期和人工复核中成立；同一候选反事实估算节省 23,247 tokens，因此继续启用为成本缓解。它不拥有发布或语义审计权限。
- **未通过项：**四 Source 在线 canary 实耗 321,850 tokens，高于 300,000 的全系统预算；temperature=0 仍出现 Relation 类型/数量漂移；8 条可忠实消费的 RELATED_TO 仍携带“端点摘要冒充适用条件”的元数据警告。
- **权威裁决：**`experiments/goal4/goal4-final-adjudication-v1.json`。不得把组件相对节省写成全链路预算通过，也不得因全链路失败关闭一个经配对反事实证明能降低成本的组件。

### Milestone M1 · 最小 Wiki+Correction 飞轮

- **状态（2026-08-12）：`PASS_MECHANISM_ONLY / PRODUCT_UPLIFT_NOT_ESTABLISHED`。** 3/3 受影响模块在 SUPERSEDES 后以相同 stableAddress 重建，旧 Claim 引用归零、替代引用 3/3、旧副本 3/3 隔离；3/3 无关模块字节不变；Wiki 发布后故障注入可完整恢复。最终 12 条回答达到引用闭包、旧错不复发、无关题无硬退化，但严格复核发现平台题 W 只明确覆盖 4 个 required facts 中的 1 个，R0 为 0 个；模型评分员曾把“测试通过”错误推断成具体阈值和漏洞门禁。因此 M1 只证明纠错生命周期，不宣称平均产品质量提升。权威裁决为 `experiments/m1-wiki-correction/adjudication-v1.json`。
- **为了什么：**验证稳定问题、条件、争议和当前认识的组织价值，并证明一次纠正会改变未来行为，而不是生成页面数量。
- **依赖：**完成一次 G3-C，使用当时最佳受控检索底座；不要求 R1 已成为默认。
- **测试资产：**历史 Evolution episodes、真实版本/纠正材料、affected/unaffected 配对题，以及可形成稳定问题的多来源簇。
- **通过：**W 与无 Wiki 处理有真实输入差异；模块事实可回溯 Canonical Claim；旧引用为 0；受影响对象发现率达预注册门槛；旧错复发率 ≤5%；affected 正确改变；unaffected hard regression=0；失败可恢复 last healthy。
- **不通过：**分别归因到 Wiki 组织或影响传播；Wiki 可退回离线治理视图，但不得用手工改答案掩盖 Evolution 失败。

### Milestone M2 · 完整问题模块与增量纠错

- **状态（2026-08-12）：`PASS_DEVELOPMENT_MECHANISM / LIMITED_DEVELOPMENT_EVIDENCE_ONLY`。** 6 个模块全部可消费，3/3 受影响模块经真实 SUPERSEDES 事务局部重建，stableAddress 保持、无关 assertion 保持、3 个对照模块字节不变、旧副本进入 Quarantine。6000 estimated-token 固定预算下，受影响题 required Claim 覆盖 W2=11/11、R0=6/11；12/12 首轮答案格式与引用闭包，未触发修复调用。人工显式审查为全部题 W2=11/11、R0=7/11，受影响题 W2=7/7、R0=3/7，五组非差异/对照题无硬退化。第一次结构运行把“Claim 可见但 Wiki 正文被预算淘汰”误报为 PASS，原件保留并强化 G3 后才得到 v2 真通过。权威裁决为 `experiments/m2-wiki-completeness/adjudication-v1.json`。
- **为了什么：**把 M1 的“可重建单断言”提升为真正面向稳定问题的完整 WikiModule：一个模块可以包含多个分别闭合到 Canonical Claim 的断言，回答所需条件、例外和时效不再依赖偶然进入 top-K。
- **开发资产：**继续使用已揭示的三领域 Evolution episodes；至少包含一题多条件、多事实问题，以及 affected/unaffected 配对。不得请求或读取新的 Held-out Gold。
- **冻结处理：**`R0` 使用相同检索底座；`W2` 在同一可见 token 上限内启用多断言 Wiki。模块中每条 assertion 仍必须一对一映射单个 Claim；模块完整性来自多断言组合，不来自脱离 Claim 的自由摘要。
- **过程门禁：**模块形成依据、每条 assertion→Claim→Evidence、选择/丢弃原因、更新前后 supportHash、实际可见 token、回答引用和有界修复调用全部留痕。任何 assertion 失去支撑时整个模块 fail-closed，不允许只展示“剩余部分”制造半真答案。
- **通过：**受影响模块 stableAddress 不变；只替换受影响 assertion，无关 assertion 字节稳定；多事实题 required-fact explicit coverage 高于 R0；条件与引用闭包 100%；unaffected hard regression=0；W2 最终可见 token 不超过冻结预算，并报告相对 R0 的真实 provider token/延迟。
- **停止规则：**若收益只能靠题号、领域词、Gold 映射或手工写答案获得，M2 判负；若 Wiki 完整但 Context Pack 仍遗漏其 assertion，归因 context-render；若模块形成本身漏 Claim，归因 wiki-formation。M2 未通过前不申请新 Held-out。

### Milestone H1 · 独立泛化：确认冻结候选在未见领域仍有效

- **当前状态：H1-A 工程基线通过，等待新 Held-out。** 自动形成 API 不接收题目/Gold；形成器按单 Source 的 Markdown 结构生成 86 个模块，496/496 当前可消费 Claim 进入 assertion→Claim→Evidence 闭包，输入逆序及完整移除一个来源时无关模块稳定。生产 Wiki 只能由可靠 Claim seed 触发，按排名原子占用同一主槽预算；已揭示 6 题 Dev 诊断 W-auto=11/17、R0=10/17，0 题退化。权威记录为 `experiments/h1-wiki-formation/adjudication-v1.json`，但产品结论仍为 `NOT_YET_HELD_OUT_VALIDATED`。
- **为了什么：**区分通用机制与在 A/B/C/S50/Evolution 上形成的开发集奖励。
- **测试资产：**新领域、新来源簇、中文问题—英文材料、Stage A/B 延迟揭示的 Held-out。
- **通过：**冻结候选链路相对强 B/R0 在多个领域复现质量或总成本收益；若 Graph 被触发，单独报告其边际收益；质量不劣于强文件基线超过预注册容差；hard failure 不增加；至少 20% 人工抽检；首轮封存后才揭示 Gold。
- **不通过：**首轮永久保留并转为下一周期 Dev；不针对已揭示 Gold 继续声称盲测胜出。回到失败责任层修通用机制，而不是删除 Graph 治理基础设施。

### Pilot P1 · 真实长期使用：判断产品是否值得存在

- **为了什么：**最终验证同一个 Agent 是否真的更省解释、更少复发、更完整。
- **测试资产：**至少 30 天、5+领域、100+真实任务、2+纠正周期。
- **通过：**重复解释下降 ≥30%；旧错复发 ≤5%；跨材料完整性优于基线；hard failure 不增加；总 token、延迟、索引/审计和人工维护成本可接受；用户能解释答案为何随知识变化。
- **不通过：**收缩在线组件或产品范围；若文件夹 + Agent 在长期任务上稳定等效，则否定独立产品假设，而不是继续堆复杂度。

### 7.1 当前实际执行节奏

1. **历史阶段（已完成并冻结）：**G0/G1 建立 Trace、闭包与边审计；G2 首个 R1 被否决；G3 建立规模读取和 transport 证据；Goal 4 保留无发布权的 SUPPORTS 成本路由，同时带着 321,850-token 全系统预算失败继续前进。历史结论不因后续优化改写。
2. **M1（已完成）：**最小 Wiki 的证据闭包、失效、重建、隔离、回滚和真实消费通过；单断言处理没有证明完整回答收益，模型 judge 的虚高推断已单独记录，不进入产品结论。
3. **M2（已完成）：**多断言模块在三领域 6 题 Dev Micro 中通过结构、预算、引用与人工事实覆盖门禁；结论限定为开发机制证据，不能外推自动形成或盲域收益。
4. **H1-A（已完成）：**任务盲自动形成、证据闭包、2–8 assertion 边界、完整 evidence 字符预算、输入确定性与无关来源稳定通过；Seed 锚定与按排名原子注入消除了低排名旧模块覆盖高排名当前模块的消费错误。Dev 改善只作机制信号。
5. **当前 Goal——H1 新盲集：**严格执行 `experiments/h1-wiki-formation/heldout-contract-v1.json` 的 A1 Corpus→A2 Questions→B Gold 三信封。A1 模块与 hash 冻结后才开放 A2，B/R0/W-auto 首轮回答目录 hash 冻结后才开放 B；Blind 只运行一次，揭示后永久转 Dev。
6. **真实长期 Pilot：**在 30 天、5+领域、100+真实任务、2+纠正周期上判断产品是否值得存在。Wiki、Evolution 与 Pilot 各自报告，不把多个改动塞入同一因果结论。

每轮默认先运行确定性 Contract，再运行 4–8 题 Micro；只有架构候选或迁移版本才运行全量历史回归。这样既充分复用已有数据，又避免每个小改动都消耗完整在线额度。

### 7.2 规模与时间测试合同

- `S50`：现有已揭示多领域资产，作为快速回归和故障定位，不承担泛化证明；
- `S200`：真实来源快照构成的首个产品规模门，必须覆盖多个领域、语言、来源角色、冲突和版本簇；
- `S1000`：在冻结真实核心和可追溯干扰源上做索引/延迟/预算压力测试，不把合成填充物冒充产品质量样本；
- `T0→Tn`：独立于 Source 数量，验证新增、纠正、替代和冲突后，affected 对象正确改变、unaffected 对象不退化、旧 publication 可恢复。

规模门关注“总库增长时局部工作是否仍局部”，时间门关注“知识变化时系统是否知道哪里该变”。两者都不能被单次问答总分替代。

### 7.3 外部材料依赖

Codex 可以建设执行壳、校验 hash、编译、生成候选题、运行 Dev/Eval、归因和修代码；但真实来源、用户任务、盲集隔离和高风险权威判断不能靠模型自我生成后再自我证明。需要用户/WorkBuddy 分阶段提供：S200 真实来源快照及元数据、T0→Tn 更新/纠正对、真实任务问题、密封 Stage B/Gold，以及健康/金融等高风险样本的人工权威复核。详细格式以 Benchmark 文档为准。

## 8. 可用性的统一判定

- **工程内核可用：** 可摄入、编译、隔离、发布、查询、审计和恢复；当前接近此层，但根目录主知识状态仍有旧 Relation 审计版本导致 0 可消费边，不能写成 Graph 已可用。
- **受控知识库可用：** 多领域独立 Gold 上保真、召回、条件、关系和更新门禁达到预注册标准。
- **Agent Pilot 可用：** 独立 Held-out 上，在同预算或总成本前沿中相对强原文检索获得可重复优势，hard failure 不增加。
- **产品可用：** 真实持续使用中重复解释和旧错复发下降，跨材料任务更完整，维护与恢复成本可接受。

任何层级都不能由对象数量、单篇重编成功、模型自评高分或单次 token 下降替代。

## 9. 本合同的变更纪律

架构方向只能因以下证据改变：新的产品约束、可复现实现事实、预注册 Eval 结果或明确的人类产品决策。不能因为某个 Dev 集分数短期上涨就重写产品目标。每次方向变化必须同步更新 Product Definition、Architecture Baseline、Benchmark、Pre-Test Audit、User Stories 和 README，并保留旧实验标签与历史结论。
