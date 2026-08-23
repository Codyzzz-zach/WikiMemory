# I3-Sim Gate 启动记录

> 日期：2026-08-23  
> 当前裁决：STATIC GATE PASS；允许冻结 clean commit 后创建隔离会话并执行首个单 Source T0。  
> 非声明：不是 Blind、不是产品增益证明、不是 7 天真实任务 Pilot。

## 冻结切片

- 18 Sources、3 domains、7 个自然任务、3 个时间 Episode；
- `S200-EV-016`：psychology-reproducibility / dispute / 5 Sources；
- `S200-EV-004`：technology / supersede / 6 Sources；
- `S200-EV-020`：law-public-policy / new-evidence / 7 Sources；
- 第一步固定为 `S200-EV-016 / T0 / s200-psych-nudge-002`，每次命令最多推进一个 Source。

公开问题只作为能力条件的 provenance seed；自然任务没有复制公开问题。S200 Stage B 继续 sealed，静态验证器拒绝任何路径、权限或 execution contract 将其纳入输入。

## 自动停止条件

以下任一条件发生后，会话进入 `STOP_REVIEW`，不自动扩大：

- Source 未完成完整编译；
- Wiki support gate 出现拒绝；
- timepoint 结束后所有自然任务均没有消费 WikiModule；
- 单 Source provider token 超过 80,000 的软上限；
- Gate manifest、冻结输入、代码 commit 或工作树状态发生漂移。

Answer model 在结构门禁通过前的调用预算为 0。结构通过后，每个 Episode review 最多允许两个配对回答调用；语义迁移仍按 manifest 的 `targetTransitions` 人工裁决。

## 启动验收

- `npm run i3:sim:gate -- verify`：PASS；
- Stage A freeze、source metadata、public questions、public episodes SHA-256：PASS；
- Stage B read：`false`；
- 防污染测试：Stage B 权限放宽和复制公开问题均 fail-closed；
- `npm run lint`：PASS，197 files；
- `npm run typecheck`：PASS；
- `npm test`：PASS，52 files / 333 tests；
- `npm run build`：PASS；
- `git diff --check`：PASS。

执行入口和边界见 `benchmarks/i3-sim-gate-v1/README.md`。运行状态必须位于显式、隔离且不提交 Git 的 runtime root；Canonical Knowledge 不读取 Agent run、回答、Pilot outcome 或 Gold。
