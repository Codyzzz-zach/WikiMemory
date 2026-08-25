# C1-D Semantic Slice Gate 验证结果

> 日期：2026-08-25
>
> 裁决：`REWORK_UPSTREAM_QUESTION_ASSOCIATION`
>
> C1 合法终局：`REWORK`
>
> 边界：C1-A/B Contract/Micro 与 C1-C Pure Shadow 仍然有效；本裁决停止 C1-D，不启动
> C1-E Materialization Shadow，不授权 C1.5、C2、真实 Pilot 或回答重跑。

## 1. 结论

C1-D 在任何 ambiguity/provider 调用之前发现了硬前置缺口：I3-Sim 三个 Episode 冻结的 18 份材料中，
只有 12 份材料的 Canonical Claim 已关联到 7 个聚焦 QuestionFrames。其余 6 份材料虽然已经编译为
Canonical Knowledge，却不在这些冻结问题的 formation closure 内。

若 C1 直接把这 6 份材料加入问题投影，就必须重新判断“新材料是否属于同一个长期问题”。这正是
C1 合同冻结并排除的 question formation / semantic matching 责任，而不是冻结问题内部的 authority、
applicability 或 branch ambiguity。因此 Gate 按合同第 9.3 节 fail-closed，未调用模型，也未用
Episode task、历史回答或目标迁移替代缺失的 Canonical association。

## 2. 冻结输入与实现身份

- Accepted contract commit：`b89c746b171afacca837205947381b5c234b2f48`；
- C1-A/B commit：`a864b9134a490cb7ab3a7232a2c317438deeed9d`；
- C1-C commit：`5ae7e07e0077e27537e637b629179dba35c99e4a`；
- semantic slice plan：`benchmarks/c1-weighted-question-state-v1/semantic-slice-plan.json`；
- plan SHA-256：`cd694180186f4a9788eb8e9c9d38c973424bbc409bca144f09483de294ee26ee`；
- runner：`scripts/run-c1-semantic-slice-gate.ts`；
- shadow root：`/private/tmp/wikimemory-c1-semantic-slice-5ae7e07-final`；
- runtime report SHA-256：`92939b5f5e48ff7f9efa6d2b6843f30bb03327a0ec3ca432881c6776213e2856`；
- coverage artifact SHA-256：`6000f490f54d2654471fa70f29c9ed0cdb6c2ebc746912b7f65754b01a1c2878`。

Plan 在 Gate 执行前冻结，只包含合同已列出的 Episode→QuestionFrame 映射、输入 hash 和停止规则，
不包含本次 coverage 结果。Gate 只读取 I3 manifest、冻结 question state 和 runtime Source identity；
不读取历史回答、裁决、Gold、Agent run 或一般对话。

## 3. Closure coverage

| Episode | QuestionFrames | 冻结 Sources | 已关联 | 缺失 | Claims | Relations | 裁决 |
|---|---:|---:|---:|---:|---:|---:|---|
| PSY · S200-EV-016 | 2 | 5 | 5 | 0 | 18 | 0 | `READY_FOR_AMBIGUITY_REVIEW` |
| TEC · S200-EV-004 | 3 | 6 | 3 | 3 | 22 | 0 | `STOP_UPSTREAM_QUESTION_ASSOCIATION` |
| LAW · S200-EV-020 | 2 | 7 | 4 | 3 | 15 | 1 | `STOP_UPSTREAM_QUESTION_ASSOCIATION` |
| **合计** | **7** | **18** | **12** | **6** | **55 unique** | **1 unique** | **REWORK** |

时间点结果：

- PSY：T0 1/1、T1 3/3、T2 1/1；
- TEC：T0 2/2、T1 1/2、T2 0/2；缺失 `s200-tech-gomod-001/004/007`；
- LAW：T0 1/2、T1 3/3、T2 0/2；缺失 `s200-law-dma-002/004/007`。

TEC 与 LAW 的 T2 都没有进入冻结问题闭包。因此在不承担 semantic matching 的前提下，C1 无法检验
TEC 的 `SUPERSEDED_HISTORY_RETAINED/CONDITION_PRESERVED`，也无法检验 LAW 的
`NEW_EVIDENCE_ADDED/CONFLICT_ATTRIBUTED`。PSY 虽具备完整 source association，但合同要求三个 Episode
合取通过；发现全局 Stop Condition 后，不继续用 PSY 单域调用制造局部成功。

## 4. 为什么不花 ambiguity budget

本次剩余问题不是“两个已关联 Claim 到底是 SUPPORTS 还是 CONTRADICTS”，而是“尚未关联的 Source/Claim
是否属于这些长期问题”。将其发给 DeepSeek 会同时违反三个边界：

1. C1 的 QuestionFrame identity 与 semantic match 已冻结；
2. ambiguity budget 只允许解决冻结问题内部、会改变 Episode 裁决的语义歧义；
3. projection sidecar 不能反向制造 Canonical Question association。

因此实际 usage 为 0 provider calls / 0 provider tokens / 0 answer calls / 0 recompilation calls。
这不是预算不足，也不是模型失败，而是 Gate 在花费前识别了错误责任层。

## 5. Hard invariants

- Canonical aggregate 前后均为 76 files / `3274bab9cb13ba1fcd9104eec7722b22b4b1450a2088246394f31e7dd1028b27`；
- `questions/state.json` 前后均为
  `da1df59a5058852f6c25184c86577410ccdd53eda050043265929cbc9c12f300`；
- 34 个 QuestionFrames、64 个 QuestionEvolutionDecisions 与内部 state hash 未变；
- 0 个新 Question decision，0 Canonical mutation，0 shadow/canonical path overlap；
- Gate 不创建 projection、不写 WikiModule/Context Pack、不改 Relation audit；
- 相同冻结输入连续运行生成 byte-identical coverage/report。

## 6. 自动化验证

| 验证 | 结果 |
|---|---|
| C1 contract + pure projection + association Gate | 16/16 PASS |
| Freeze-host semantic slice Gate | `REWORK_UPSTREAM_QUESTION_ASSOCIATION`（预期 fail-closed 终局） |
| Full Vitest | 56 files / 356 tests PASS |
| TypeScript | `src` + `scripts` strict typecheck PASS |
| Biome | 207 files PASS |
| Build | ESM + DTS PASS |
| `WikiMemory-src` full graph index | 0 skipped / 1,906 nodes / 7,674 edges |
| Replay | 两个独立 shadow roots 的 coverage/report byte-identical |
| Provider usage | 0 calls / 0 tokens |
| Answer calls / recompilation | 0 / 0 |
| Canonical mutation | 0 |

## 7. 阶段闭合与下一决策

C1 以 `REWORK` 闭合，而不是继续把目标向后移动：

- 已拿下：独立加权投影表示、Micro 上的条件取代/历史/未决保留、hash/replay/isolation，以及真实
  Episode 的 association completeness Gate；
- 尚未拿下：三个真实 Episode 的完整加权状态语义；
- 已定位责任边界：至少要先证明 Canonical Claim 如何被持续关联到既有 QuestionHypothesis，才能让
  C1 的真实闭包拥有完整时间序列。

下一步需要产品负责人显式接受一份新合同。推荐候选是一个窄的 **Question Association Bridge**：只
验证新 Canonical Claims 对冻结 QuestionHypothesis 的 attach/reject/uncertain 与可追溯理由，不同时承担
promotion、merge/split/archive/reopen、materialization、retrieval 或回答价值。它可以被编排为 C1.5 的
前置窄切片，也可以成为 C1 rework 的独立依赖；本报告不替产品负责人自动选择顺序。
