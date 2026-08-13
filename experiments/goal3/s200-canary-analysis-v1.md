# G3-C S200 编译 Canary 裁决（v1）

## 裁决

`CANARY_PIPELINE_PASS / FULL_140_PAUSED / AUDIT_COST_REWORK_REQUIRED`

S200 Stage A v1.1 已通过 evaluator 独立验收并冻结；Stage B 未读取。随后使用冻结的 `deepseek-v4-flash / temperature=0 / thinking disabled` 配置，顺序编译同一 Llama 来源簇的 3 份材料。三份材料均完成 Proposition → Claim → Concept → Relation → Claim/Relation Lint → 原子发布 → 跨材料 Relation 扫描，状态均为 `COMPLETED`。

全量 140 份编译在 canary 后主动暂停。原因不是链路失败，而是 canary 暴露了不可接受的逐对象审计放大：当前 Lint 为每条 Claim 和几乎每条候选 Relation 单独调用模型。在已经明确知道成本结构失控后继续全量运行，不构成有效规模实验。

## 真实数据

| 指标 | 3 份 canary |
|---|---:|
| Proposition / Canonical Claim | 71 / 71 |
| 本地候选 Relation | 94 |
| 本地 Canonical / Quarantined Relation | 12 / 82 |
| 跨材料候选 Claim 数 | 41 |
| 跨材料 Canonical / Quarantined Relation | 0 / 10 |
| 模型调用 | 192 |
| Prompt / Completion / Total tokens | 329,069 / 59,347 / 388,416 |
| LINT 调用 | 177（92.19%） |
| LINT tokens | 333,867（85.96%） |
| 解析成功 | 192 / 192 |
| 总耗时 | 217,784 ms |

在“每份材料与 canary 相同、跨材料成本不增长”的过度乐观假设下，线性外推 140 份仍约为：

- `8,960` 次模型调用；
- `18,126,080` total tokens；
- 其中 LINT 约 `15,580,460` tokens；
- 约 `2.82` 小时纯串行耗时。

真实全量成本很可能更高，因为后续 Source 的跨材料候选集合和边审计机会会增长。

## 质量信号

1. 3 份材料的 eligible block coverage 均达到 100%；71 条 Claim 全部可映射并通过 Claim 门禁。
2. Llama model-card 的表格有 2 条 Proposition exact quote 初次映射失败，但覆盖修复阶段补足了 eligible block coverage；失败清单已持久化。
3. 本地 Relation 仅 12/94 进入 Canonical，说明语义门禁确实在阻挡弱边；不能为了省 token 删除 Relation 审计。
4. 跨材料 10 条候选边全部被隔离，说明当前小簇没有可消费 cross edge；这不是“Graph 没执行”，候选选择、检测、Lint、发布四阶段均有事件留痕。

## 下一轮预注册方向

只优化审计编排，不降低审计语义：

1. 将多个 Claim 的独立证据包放入有界 batch，一次返回按 `claimId` 对齐的原 `SemanticVerdict`；每条 Claim 仍独立验证 evidence index、failedDimensions、verdict 和缓存。
2. 将多个 Relation 的独立端点/证据包放入有界 batch；每条边仍独立执行 identity、relation、type、direction、conditions、双端证据覆盖和强边 critic 门禁。
3. schema、结果数量、对象 ID、证据下标或 finishReason 任一异常时缩批重试；单项仍失败则只隔离该对象，不放宽规则。
4. 使用这次 canary 的逐对象结果作为 Dev/Regression 对照。新编排必须做到：对象账平、hard-pass/hard-fail 决策无静默缺失、Evidence 引用可解析、调用数显著下降；差异必须逐项输出，不以汇总比例掩盖。
5. 在新隔离工作区重跑相同 3 份材料。只有审计调用至少下降 70%、总 token 至少下降 40%、Canonical/Quarantine 账平且人工抽检无忠实度退化，才恢复 140 份全量编译。

## 留痕

- Stage A freeze：`experiments/goal3/s200-stage-a-freeze-v1/`
- 编译进度：`experiments/goal3/s200-runs/compile-v1/progress.jsonl`
- 每 Source stdout/stderr：`experiments/goal3/s200-runs/compile-v1/logs/`
- LLM 调用与 usage：`experiments/goal3/s200-runs/compile-v1/workspace/runs/llm-calls.jsonl`
- 编译覆盖：`experiments/goal3/s200-runs/compile-v1/workspace/runs/compile-stats.jsonl`
- Relation 漏斗：`experiments/goal3/s200-runs/compile-v1/workspace/runs/relation-funnel.jsonl`

本报告是已揭示 Stage A 的工程/规模诊断，不是 Blind 产品效果结论。
