# C0 Convergence Baseline 闭合报告

> 日期：2026-08-24
>
> 裁决：**PASS / C0 CLOSED**
>
> 含义：产品方向、能力账本、加权证据流与阶段闭合机制已经形成一致、可回退的仓库基线；
> 不表示 C1 已获授权、K3 已实现或产品价值已证明。

## 1. Stage Question

能否把产品命题、产品边界、能力账本、加权证据流与阶段闭合规则固定为一致的权威文档，
使项目不再因单轮发现自动移动目标？

## 2. 主变量与边界

- Primary Variable：文档中的产品/阶段语义是否收敛；
- Input Slice：Product Definition、User Stories、Architecture、Question Contract、Implementation
  Status、Git 历史、I2.5 验收与 I3-Sim NO-GO；
- Hard Invariants：Evidence grounding、authority/scope、历史分支保留、知识输入边界、可重放与隔离；
- Non-goals：代码实现、最终权重算法、DeepSeek 新调用、真实 Pilot、Loader/检索/UI 扩展；
- Cost：0 次外部模型调用；仅本地文档审阅和仓库回归。

## 3. 闭合产物

| 产物 | 作用 | SHA-256 |
|---|---|---|
| `docs/specs/wikimemory-convergence-baseline-v1.md` | 产品命题、K0–K5 账本、C0–C3 路线、阶段合同 | `8a27a76e17fba128d63f7f173e6826846791b23a9117811aefef594e8a2ee539` |
| `docs/adr/0003-weighted-evidence-flow-and-convergence-stages.md` | 接受加权证据流并取代旧后续路线 | `ec770f268ca41779b4e65a28cdbe81e6a211c65c78602864f6675d2dd2aaa7e3` |
| `WGEMemory4LLM-Iteration-Operating-Plan.md` | v3.0 收敛执行合同与统一验收函数 | `ae649432b7a2500c1c6910ceb226535ae1dc56a97f33b6604b1e00ae6e26b7ea` |
| `docs/status/discovery-backlog.md` | 隔离非当前主变量的新发现 | 随 C0 提交版本化 |
| `docs/verification/i3-sim-gate-result-2026-08-24.md` | 冻结 NO-GO 输入证据 | `7467a6d7cef13a3bc3d5e7611157b016db371dd98ee19f30d3578f1cfec8699c` |

同步更新了 Product Definition v1.6、User Stories v1.6、Target Architecture 1.1、Question Contract
v1.1、Knowledge Contract 对齐头、Implementation Status、README、文档/仓库地图和历史 ADR 状态。
Pilot Runbook 被明确标记为暂停，不再构成当前执行承诺。

## 4. 语义验收

以下表述已在当前权威文档中一致：

1. 产品只编译人主动选择的材料及显式授权的声明/纠正；Agent run、工具日志、一般对话和任务结果
   不自动进入 Canonical Knowledge；
2. `CURRENT` 是给定 knowledgeVersion、scope 和 task 下当前领先/证据支持更强的投影，不是客观真理；
3. 新材料增加重新检查与当前性的优先级，不自动获得高于旧证据的权威；
4. 争议、限域、取代、未决和历史是带依据的信息流动，分支不得静默删除；
5. I0–I2.5 作为 K0–K2 能力基线保留；I3-Sim 保持 NO-GO；
6. C1 是下一候选阶段，但合同冻结前不授权代码或付费实验；
7. 新发现进入 Discovery Backlog，只有产品负责人能改变 North Star 或当前阶段主变量。

## 5. 仓库验证

2026-08-24 在 `/Users/mixi/Desktop/WikiMemory` 执行：

| 验证 | 结果 |
|---|---|
| `git diff --check` | PASS |
| 当前权威文档旧路线/旧版本/固定阈值扫描 | PASS；没有残留当前 I0–I3 路线、v1.5/Architecture 1.0 权威引用或旧 30%/5% 当前阈值 |
| 三份 HTML 配对标签/UTF-8 结构检查 | PASS |
| `npm test` | PASS；53 files / 340 tests |
| `npm run typecheck` | PASS；src + scripts |
| `npm run lint` | PASS；199 files，0 fixes |
| `npm run build` | PASS；ESM + DTS |

本阶段没有修改 `src/`、`scripts/`、Benchmark、冻结实验产物或运行时知识状态，也没有产生新的
Provider 调用和费用。

## 6. Closure Decision

C0 以 `PASS` 闭合。下一次工作若继续，必须先形成独立的 C1 阶段合同，并冻结精确输入 hash、
Acceptance Vector 阈值、Token/调用/人工预算、Non-goals 与 Stop Conditions。C0 闭合不会自动启动 C1。
