# I3-Sim Gate 最终验收

> 日期：2026-08-24  
> 裁决：**NO-GO / 不进入 7 天真实任务 Micro Pilot**  
> 含义：结构运行完成，但没有达到冻结的产品晋级函数；这不是 Blind Benchmark，也不是产品增益证明。

## 1. 冻结边界与可复核产物

- Gate manifest：`benchmarks/i3-sim-gate-v1/manifest.json`
- manifest SHA-256：`sha256:5e1b2197318fcaccb1a938cc6253bf38ca19e5d2ad9db13aaf6aaf759aca157b`
- 隔离 runtime：`/private/tmp/wikimemory-i3-sim-gate-v1-4998dfa`
- 结构运行冻结 commit：`6c856caf74e116903d7214d24b77bf2241fadea5`
- 配对回答 commit：`83681607e3306431b954de8994a4b8348eef5476`
- Stage B read：`false`
- 配对报告 SHA-256：`8d699e035f4b8185ab319691e5a1a94b41d0dfb2045d8840b963620942fdc2b8`
- 12 个回答记录的排序聚合 SHA-256：`90c93910c71e95e399cc30c4351a5fcf1a1e38fa1c534057fc70280691ffa0be`

回答与运行收据只存在于隔离 runtime，没有进入 Canonical Knowledge，也不提交到 Git。

## 2. 结构运行结果

18/18 个 Stage A 来源完成编译。20 份 iteration receipt 中 18 份成功、2 份为连接失败原件；失败 Source 均在显式恢复后重试，没有跳过。最终 Canonical 状态为：

- 18 Sources、201 Claims、2 Relations；
- 34 QuestionFrames、64 Question decisions、21 WikiModules；
- Question 生命周期累计：34 created、24 updated、6 promoted，merge/split/archive/reopen 均为 0；
- 3 个领域均出现同一长期问题的更新；
- WikiModule 共 155 个 assertions：145 `CURRENT`、10 `CONDITIONAL`、0 `DISPUTE`、0 `SUPERSEDED`；
- technology 域 9 个 WikiModule 全部只有 `CURRENT`，没有 conditional branch；
- Canonical 只有 2 条 Relation；Quarantine 中有 3 Claims、152 Relations。

因此 runner 的 `COMPLETE` 只证明机制跑完、Wiki 可被消费且没有 support leak，不等于三个 Episode 的目标语义已成立：

- psychology：`SAME_QUESTION_UPDATE` 有证据；`DISPUTE_PRESERVED` 与 `AUTHORITY_NOT_FLATTENED` 不充分；
- technology：`SAME_QUESTION_UPDATE` 有证据；`SUPERSEDED_HISTORY_RETAINED` 与 `CONDITION_PRESERVED` 不成立；
- law-public-policy：`SAME_QUESTION_UPDATE`、新增证据可见；`CONFLICT_ATTRIBUTED` 仍不充分。

## 3. Provider 与 token 台账

编译阶段：189 次 provider attempts、2 次连接失败、1 次 invalid parse 后恢复，共 510,106 provider tokens；单 Source 最大 38,830，低于 80,000 软上限。

配对阶段严格执行 6 个任务 × 2 arms，共 12 次回答调用，没有修复性重试：

| Arm | Calls | Prompt tokens | Completion tokens | Total tokens | 平均 total/task |
| --- | ---: | ---: | ---: | ---: | ---: |
| BASELINE_NO_WIKI | 6 | 56,855 | 5,192 | 62,047 | 10,341 |
| WIKIMEMORY | 6 | 90,156 | 4,393 | 94,549 | 15,758 |
| 合计 | 12 | 147,011 | 9,585 | 156,596 | 13,050 |

整个 I3-Sim 共记录 666,702 provider tokens。实际费用以 DeepSeek 账户账单为准；本报告不按可能变化的公开价格反推金额。Wiki arm 的平均总 token 比 baseline 高约 52.4%，这不是独立失败条件，但要求下一轮把“增加上下文”与“增加决策价值”分开优化。

## 4. 配对协议结果

- paired coverage：6/7 = 85.7%，达到 80% 门槛；
- 6/6 pairs 的 JSON 与引用存在性合同均有效；
- 5/6 candidate answers 引用了 baseline 不可见的 Claim/Span，覆盖全部 3 个领域；
- `I3SIM-TEC-02` 虽召回 WikiModule，但没有使用 Wiki 独有证据；
- 上述结果证明了 Wiki 上下文的可消费性，不自动证明答案质量提升。

人工裁决规则在看答案前沿用冻结合同：只有“candidate 使用独有 Wiki 证据、任务相关质量明确优于 baseline、且没有新硬失败”才计 causal win。硬失败采用 Pilot 合同中的 unsupported assertion、conflict flattened、citation failure、scope leak 等定义。

| Task | 裁决 | 依据 |
| --- | --- | --- |
| I3SIM-PSY-01 | NEUTRAL | Wiki 独有证据被引用，但 baseline 已覆盖主效应、偏倚校正、异质性和新旧认识；candidate 更短但没有新增可执行判断。 |
| I3SIM-PSY-03 | LOSS + HARD FAILURE | candidate 把“校正后无证据”写成单一受支持结论，遗漏正向元分析这一竞争主张，并把 DataColada 的批评错误归入“受到反驳”；违反 `DISPUTE_PRESERVED` / `AUTHORITY_NOT_FLATTENED`，记 `CONFLICT_FLATTENED`。 |
| I3SIM-TEC-01 | LOSS + HARD FAILURE | candidate 声称当前仍支持 `-mod=vendor`、GOPATH mode 仍可用、`go get` 职责已变化，却没有为这些当前状态提供引用；记 `UNSUPPORTED_ASSERTION`。WikiModule 自身也把早期 proposal 意图全部物化为 `CURRENT`。 |
| I3SIM-TEC-02 | TIE | 两臂答案与引用相同；candidate 没有消费 Wiki 独有证据。 |
| I3SIM-LAW-01 | CAUSAL WIN | candidate 通过独有 Wiki 闭包补入“达到数量门槛仍可反驳推定”的认定条件，并把法规、官方行动与评论显式分层。 |
| I3SIM-LAW-02 | CAUSAL WIN | baseline 错过处罚上限；candidate 通过独有 Wiki 证据补回“最高全球年营业额 20%”，同时保留适用条件与待补证项。 |

## 5. 冻结晋级函数裁决

| 条件 | 门槛 | 实际 | 结果 |
| --- | ---: | ---: | --- |
| Paired outcome coverage | ≥ 80% | 85.7% | PASS |
| Causal wins | ≥ 3 | 2 | FAIL |
| Winning domains | ≥ 2 | 1 | FAIL |
| Hard failures | = 0 | 2 | FAIL |
| Scope leaks | = 0 | 0 | PASS |
| 三个 Episode 目标迁移全部成立 | 全部 | 0/3 完整成立 | FAIL |

最终裁决为 **NO-GO**。不能把 5/6 的“可追踪 Wiki 使用”改写成 5 个 causal wins，也不能因为结构 runner 是 `COMPLETE` 就进入真实 Pilot。

## 6. 下一轮最小迭代

下一轮不增加领域、不扩大 Source 数量，继续复用本次冻结材料和 6 个配对任务：

1. 让 Question/Wiki formation 真实产出并保留 `DISPUTE`、`SUPERSEDED`、`CONDITIONAL`，而不是把不同时点和不同权威的 Claims 平铺成 `CURRENT`；优先打通被隔离 Relation 到 Wiki 状态角色的安全证据链。
2. 在 Answer contract 中增加逐断言 citation coverage：引用“存在”不够，每个关键当前状态、历史变化和条件判断都必须能映射到可见 Claim/Span；禁止用模型常识补写材料外的当前状态。
3. 收紧 Wiki 闭包的边际预算与排序。保留固定总上下文预算，比较每个新增 token 是否带来任务所需的状态转移，而不是只统计 Wiki 被召回。
4. 只重跑受影响的 PSY-03、TEC-01、TEC-02，再用 LAW-01/02 做无回归检查。达到 3 wins / 2 domains / 0 hard failures 且三个 Episode 语义目标成立后，才重开 7 天 Micro Pilot 决策。

