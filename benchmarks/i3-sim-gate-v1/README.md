# I3-Sim Gate v1

这个切片用于在真实用户 Pilot 前，以仓库中已经由人选择的多领域材料模拟 WikiMemory 的长期问题维护。它是 revealed、diagnostic、shadow，不是新的 Blind Benchmark，也不声明产品增益。

## 固定边界

- 只使用 S200 v1.1 Stage A 已公开材料；Stage B 继续 sealed，Gate 和 runner 都不得读取它。
- Agent run、对话、回答、Pilot outcome 和 Benchmark Gold 不进入 Canonical Knowledge。
- 公开问题只用于定位能力条件；Gate 使用重新表述的自然任务，不使用或推断 Gold。
- 18 个来源覆盖 psychology-reproducibility、technology、law-public-policy 三个领域。
- 三个 Episode 分别覆盖 dispute、supersede 和 new-evidence。

## 运行层级

静态门禁不调用模型：

```bash
npm run i3:sim:gate -- verify
```

为显式、隔离的 runtime 创建会话：

```bash
npm run i3:sim:gate -- prepare --runtime-root /absolute/path/to/i3-sim-runtime
```

每次最多摄入一个 Source。只有静态门禁通过、代码提交与会话冻结提交一致、工作树干净时才允许执行：

```bash
npm run i3:sim:gate -- run-next --runtime-root /absolute/path/to/i3-sim-runtime
npm run i3:sim:gate -- status --runtime-root /absolute/path/to/i3-sim-runtime
```

若在线编译因连接等瞬时故障进入 `STOP_REVIEW`，先检查 receipt；只有 stop reasons 全部属于编译失败且工作树已经形成新的 clean commit 时，才允许显式恢复失败 Source：

```bash
npm run i3:sim:gate -- resume --runtime-root /absolute/path/to/i3-sim-runtime --reason "reviewed transient provider connection failure"
```

`resume` 会从最后一个失败 receipt 重建 cursor，不允许跳到下一个 Source，并追加不可覆盖的恢复收据。Wiki support、无 Wiki 消费或成本超限等产品/经济性停止原因不能用该命令绕过。

每个 Source 后记录 provider token、Question/Wiki 状态变化和编译状态。每个 timepoint 结束后才做无模型的 Context Pack 消费检查。编译失败、被 support gate 拒绝的 WikiModule 仍泄漏进 Context Pack、timepoint 结束仍无 WikiModule 消费，或单 Source provider token 超过软上限时，会话进入 `STOP_REVIEW`，不会自动扩大。正常的 fail-closed rejection 作为诊断信号保留，不计为硬失败。

## 验收解释

Gate 的自动化结果只回答“机制是否值得进入下一小步”。Episode 的语义迁移仍需按 manifest 中的 `targetTransitions` 做人工裁决。三个 Episode 全部通过后，才允许进入 7 天真实任务 Micro Pilot；本切片不能替代真实用户价值验收。
