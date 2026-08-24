# C1 Weighted Question State 阶段合同 v1

> 状态：ACCEPTED
>
> 起草日期：2026-08-25
>
> 接受日期：2026-08-25
>
> 合同基线提交：`ce48872cfd67938f84071f96e6e2ac1ce417be0c`（`docs: define evolving question identity`）
>
> 授权边界：产品负责人已接受本合同，授权按第 8 节顺序执行 C1。未通过 deterministic Micro
> 前，外部模型调用预算仍为 0；本合同不授权重新编译冻结材料、新回答对照、C1.5、C2 或真实 Pilot。

## 1. Stage Question

在冻结的 QuestionFrame 与 Canonical Evidence 输入下，WikiMemory 能否形成一个可解释、可重放的
`QuestionStateProjection`，使新旧证据表现为领先、并列、条件、争议、未决和历史分支，而不是
被 `CURRENT`、最新时间或一次模型判断压成唯一答案？

本阶段不回答“这个 QuestionFrame 是否真的是一个长期问题”。问题发现、语义匹配、身份成熟、
merge/split 和 archive/reopen 属于 K2-S/C1.5。

## 2. Primary Variable

唯一允许主动改变的变量是：

> 同一个冻结问题内部，Canonical Claim/Relation/Evidence 如何被组织为带理由的分支 standing、
> qualification 与历史投影。

允许修改：

- C1 独立的派生表示、纯函数评估器、reason code 和 projection hash；
- materialization 如何读取已经验收的 C1 projection；
- 只服务 C1 Micro 的 fixture、测试和 shadow 报告。

不得修改：

- Question proposal prompt、semantic match、QuestionFrame ID 或 stable address；
- promotion、merge、split、archive、reopen 和现有 Question lifecycle policy；
- Claim/Relation 编译、Relation audit、Loader、Retrieval ranking、Context Pack 全局预算、Answer
  prompt、Transport、UI 或 Pilot 协议；
- 知识输入边界、现有 I3-Sim 结果或历史 Gold。

## 3. 最小表示合同

C1 先使用独立、可丢弃、可重建的 sidecar projection，不直接扩充高扇入的 `QuestionFrame`：

```text
QuestionStateProjection {
  schemaVersion
  questionRef
  knowledgeVersion
  inputClosureHash
  branchAssessments[] {
    branchId
    claimRefs[]
    standing: LEADING | CO_LEADING | ALTERNATIVE | HISTORICAL | UNRANKED
    qualifiers: (CONDITIONAL | CONTESTED | UNRESOLVED)[]
    scope
    conditions[]
    dimensionReasons[] {
      dimension: grounding | authority | currentness |
                 applicability | relational_support | uncertainty
      ordinal: HIGHER | EQUAL | LOWER | UNKNOWN
      reasonCodes[]
      claimRefs[]
      relationIds[]
      evidenceSpanIds[]
    }
  }
  unresolvedFactors[]
  projectionVersion
  projectionHash
}
```

约束：

1. 不把多维理由压成统一概率或综合分数；
2. `standing` 与 `qualifiers` 正交：历史分支可以同时带条件，领先分支也可以处于争议中；
3. `UNKNOWN/UNRANKED` 是合法结果，不能为了填满 schema 制造确定性；
4. 每个非空 role、qualifier 和 dimension reason 必须引用参与判断的 Claim/Relation/Evidence；
5. `task_relevance` 与 `marginal_cost` 不进入持久 C1 state，它们是 C2 任务投影和预算变量；
6. projection 不反向成为 Claim 证据，不改变 QuestionFrame 或 Canonical Knowledge。

## 4. 冻结输入切片

### 4.1 I3-Sim 主语义切片

| 输入 | 冻结值 |
|---|---|
| Gate manifest | `benchmarks/i3-sim-gate-v1/manifest.json` |
| Manifest SHA-256 | `5e1b2197318fcaccb1a938cc6253bf38ca19e5d2ad9db13aaf6aaf759aca157b` |
| I3-Sim 结果 | `docs/verification/i3-sim-gate-result-2026-08-24.md` |
| 结果 SHA-256 | `7467a6d7cef13a3bc3d5e7611157b016db371dd98ee19f30d3578f1cfec8699c` |
| 冻结 runtime | `/private/tmp/wikimemory-i3-sim-gate-v1-4998dfa` |
| Canonical input aggregate SHA-256 | `3274bab9cb13ba1fcd9104eec7722b22b4b1450a2088246394f31e7dd1028b27` |
| Question state file SHA-256 | `da1df59a5058852f6c25184c86577410ccdd53eda050043265929cbc9c12f300` |
| Question state internal hash | `eabfb6000f1b58a55b7749b16c20458f9009a2bdf172071a639cb2a5826816eb` |
| Wiki aggregate SHA-256 | `6449ce9ba9e5eebf24c2e88496ea0e19a285586f28cd13057e352c1c781d8fb9` |
| Paired report SHA-256 | `8d699e035f4b8185ab319691e5a1a94b41d0dfb2045d8840b963620942fdc2b8` |

Canonical aggregate 的计算范围为冻结 runtime 下 `claims/ relations/ sources/ assertions/ concepts/
questions/ wiki/ publications/` 的相对路径排序后逐文件 SHA-256，再对 checksum 行做 SHA-256。

冻结 runtime 只是加速缓存，不是唯一权威。如果合同执行前路径缺失或任一 hash 不匹配，立即进入
`INPUT_REFREEZE_REQUIRED`；不得静默使用当前主 runtime，也不得自动花费约 510k 历史编译 token
重建。重新冻结需要产品负责人接受单独的输入收据和预算。

聚焦 QuestionFrames：

| Episode | 冻结问题 | 需要观察的状态变化 |
|---|---|---|
| PSY · S200-EV-016 | `question:216bff0a347664f84a379395`、`question:fd7afd5d18a0abcdba1c8a83` | 竞争主张并存、发表偏倚修正、研究与评论权威分离 |
| TEC · S200-EV-004 | `question:9461145467c7b99470b61313`、`question:cf8cead85caf83ea0864ad3c`、`question:fd46a361f2c948a98df8f9f1` | proposal→实现历史、默认条件、材料外当前状态禁止补写 |
| LAW · S200-EV-020 | `question:6374d223d73b203bbcfb1990`、`question:bc813fe906d1715744fb1153` | 法规、官方行动和评论分层；认定/处罚条件与冲突归因 |

I3-Sim 的 12 个历史回答和裁决只作失败诊断，不重新计分，不作为 Canonical Knowledge，也不作为
C1 PASS 的任务价值证据。C1 不运行新的回答 arm。

### 4.2 受控 Evolution Micro

只使用以下三份 Synthetic/Silver 材料构造投影层的确定性 Micro，不声称真实领域泛化：

| 时间 | 文件 | SHA-256 | 预期用途 |
|---|---|---|---|
| T0 | `experiments/evolution/dataset-v1/platform-engineering/t0/transport-security.md` | `73b18cf4eea0199adaf06344148845062547f6fafb3cf821248113b655f59100` | 基线分支 |
| T2 | `experiments/evolution/dataset-v1/platform-engineering/t2/zero-trust-transport.md` | `47a9aabe71230c81fa65d5499bdeb5982292c86b7c25ba582718c542e7a1feaf` | 有范围的取代与历史保留 |
| T3 | `experiments/evolution/dataset-v1/platform-engineering/t3/peak-event-transport-dispute.md` | `51bb68ab12e8d0ac884da3a0a72761933d076ba8867cfd7c56340420505c9159` | 同级未裁决争议 |

Dataset manifest：`experiments/evolution/dataset-v1/manifest.json`，SHA-256
`47619fe55b5470fe537b7c9b3a665c1dfc30b2c85896d3e342cd322767624227`。

Micro fixture 必须在实现前一次性冻结，只能表达材料显式的 Claim、authority、scope、conditions、
SUPERSESSION 和 UNRESOLVED_CONFLICT；不得读取实现结果后反向修改预期。

### 4.3 I2.5 身份与隔离回归

I2.5 不承担 C1 主语义评分，只保证 C1 没有重开 K2-M：

| 输入 | SHA-256 |
|---|---|
| `docs/verification/question-centered-memory-real-material-acceptance-2026-08-20.md` | `72050906896d609f5f88546e534a1168abe83fafe644015bcf7854dc3fc9548d` |
| `mathtest-material/03-sequences-limits.md` | `67d717611e97029d1321d305bffad2550489facddd896e639edf3e909dc6fdb7` |
| `mathtest-material/12-calculus.md` | `d06c12e9e88ffd74611594fbab5e006abbd4320105f169d7b88e1d51d68e2c5f` |
| `mathtest-material/02-spaces.md` | `9473a6b37f73ce18b18bb44eded94376e285e21cd98293080b9daf1824bb4286` |
| `mathtest-material/09-functional-analysis.md` | `3022edf461c92f2daeec5e1e82a06658b907ee5b03105cdc0b4229fb2f35257f` |

历史稳定问题 ID：

- `question:2bd863ad3b30960f1e119c2c`；
- `question:c9932599b47f4fa86edfeff4`；
- `question:ef8d8f1bcc2827e9e20efa59`。

C1 不重新调用 formation 来证明这些 ID；自动化回归和冻结验收报告负责约束。如果执行方案必须
重跑上述材料才能验收，视为 C1 合同扩张，停止并重新评审。

## 5. Hard Invariants

以下任一失败都不能被其他高分抵消：

1. **Input Boundary**：只读取本合同冻结的 Canonical Knowledge、fixture 和报告；Agent run、回答、
   Pilot outcome、Gold 不进入知识或 projection 支撑。
2. **Grounding**：所有可见 branch role、condition、历史状态和比较理由都能解析到 Claim/Relation/
   Evidence；无引用内容 fail-closed。
3. **K2-M Frozen**：原 I3 `questions/state.json` 字节 hash、内部 state hash、34 个 QuestionFrame ID、
   64 个 QuestionEvolutionDecision 不变；不得产生新的 Question decision。
4. **Canonical Immutability**：C1 shadow 不修改 Source、Span、Claim、Relation、Concept 或 authority。
5. **Scope/Condition Fidelity**：条件性取代不得全局删除旧分支，scope 不得扩张。
6. **History/Uncertainty Preservation**：历史和同级未决冲突必须保留；不得静默选择赢家。
7. **Isolation**：一个聚焦问题的 projection 变化不改变无关 Question projection hash。
8. **Replay**：相同输入闭包、projection version 与配置运行两次，输出 byte/hash identical。
9. **Atomic Publication**：在 shadow Gate 全部通过前，不替换当前 WikiModule 或 Context Pack 消费链。
10. **Regression**：现有 lint、typecheck、test、build 以及 I2.5 Question/Materialization/Context 回归通过。

## 6. Acceptance Vector 与阈值

### 6.1 合取接受函数

```text
C1_ACCEPT(r) =
  HardInvariants(r)
  AND EpisodeSemantics(r)
  AND Explainability(r)
  AND Reproducibility(r)
  AND CostWithinBudget(r)
  AND ClosureCompleteness(r)
```

### 6.2 不可平均的门槛

| 维度 | PASS 门槛 |
|---|---|
| Grounding coverage | 100% 可见 branch/qualifier/reason 有可解析支撑；0 `UNSUPPORTED_ASSERTION` |
| PSY Episode | `SAME_QUESTION_UPDATE`、`DISPUTE_PRESERVED`、`AUTHORITY_NOT_FLATTENED` 3/3 成立 |
| TEC Episode | `SAME_QUESTION_UPDATE`、`SUPERSEDED_HISTORY_RETAINED`、`CONDITION_PRESERVED` 3/3 成立 |
| LAW Episode | `SAME_QUESTION_UPDATE`、`NEW_EVIDENCE_ADDED`、`CONFLICT_ATTRIBUTED` 3/3 成立 |
| Evolution Micro | T0 基线、T2 限域取代、T0 历史保留、T3 同级未决冲突 4/4 成立 |
| Hard semantic failures | 0 conflict flattened、0 silent history loss、0 condition drop、0 scope leak、0 fabricated certainty |
| K2-M isolation | Question state 两个 hash 均不变；34 IDs / 64 decisions 不变；0 新 decision |
| Replay | 固定输入下连续两次 projection artifact byte/hash identical |
| Unrelated sentinel | 所有非聚焦 Question projection hash 在局部重算后不变 |
| Explanation | 每次 standing/qualifier 变化至少一个稳定 reason code，并列出实际参与的维度和引用 |
| Cost | 满足第 7 节全部上限，usage ledger 无缺失 |

不以 `DISPUTE`、`HISTORICAL` 或任一标签数量作为 PASS。只有预注册 Episode 的证据流动正确才算
成立，禁止为了达到分布目标批量改标签。

### 6.3 人工裁决边界

人工只裁决冻结 Episode 的以下问题：

- 竞争主张是否被静默抹平；
- authority、scope 和 condition 是否被正确保留；
- standing 变化的理由是否由可见输入充分支持；
- 系统是否诚实保留 `UNKNOWN/UNRANKED/UNRESOLVED`。

人工不得改写 Claim、补写材料外事实、改变 QuestionFrame、追加新样本或在看到结果后调整门槛。
每个裁决保存 `PASS | FAIL | UNRESOLVED`、reason code 和引用；`UNRESOLVED` 不自动计 FAIL，但只有
合同明确允许未决的槽位可以通过。

## 7. 成本与 Token 预算

| 阶段 | Provider calls | Provider tokens | 人工评审 | 说明 |
|---|---:|---:|---:|---|
| Contract/Micro 冻结 | 0 | 0 | ≤ 60 分钟 | 只读现有材料与报告 |
| Deterministic shadow | 0 | 0 | ≤ 30 分钟 | 先证明纯函数、hash、隔离和回放 |
| Ambiguity calls | ≤ 12 | ≤ 180,000 | ≤ 120 分钟 | 每个 Episode 最多 2 次；单次 ≤ 25,000 tokens |
| Answer/Pilot calls | 0 | 0 | 0 | C1 不重跑回答或真实任务 |

附加限制：

- 未通过 deterministic Micro 前，外部模型调用预算为 0；
- 只把规则无法判断、且会影响 Episode 裁决的歧义发送给模型；
- 调用按 inputClosureHash、projection prompt/version、model 和配置缓存；未变化输入不得重复调用；
- 不为重建 I3-Sim runtime、扩大材料或修复 Relation audit 消耗本预算；
- 预算是硬上限，不是必须花完的额度。需要超过任一上限时先以 `STOP_BUDGET` 闭合并重新评审。

## 8. 实施顺序

1. **C1-A · Freeze**：产品负责人接受本合同；生成只含路径、hash、Episode 和裁决槽位的输入收据。
2. **C1-B · Contract/Micro**：冻结 Evolution fixture、reason code、projection schema 和失败样例；0 模型调用。
3. **C1-C · Pure Shadow**：实现纯函数 sidecar projection，只写隔离 runtime；完成 replay/isolation/grounding。
4. **C1-D · Semantic Slice**：只运行三个 I3 Episode 和一个 Evolution Micro；按 ambiguity budget 调用模型。
5. **C1-E · Materialization Shadow**：Micro 全通过后，比较新旧 Wiki projection；仍不替换生产消费链。
6. **C1-F · Closure**：冻结报告、artifacts、usage ledger、失败原件和裁决；更新 Implementation Status、
   Discovery Backlog 与 Git 提交。不得自动启动 C1.5。

每个步骤完成后只允许改变下一步直接依赖的一个责任层。不得同时修改 projection、Relation audit、
materialization renderer 和 Context selection。

## 9. Stop Conditions

发生以下任一条件立即停止当前执行，不追加样例或调用：

1. 任一 Hard Invariant 失败；
2. 冻结 runtime 缺失或 hash 不匹配；
3. 发现必须改变 QuestionFrame/identity/lifecycle 才能修复，转入 C1.5 backlog；
4. 发现必须改变 Relation audit 才能形成输入，将其记录为 C1 dependency，不在本阶段顺手修；
5. 同一责任层的同一种失败在一次 representation 修订后连续出现两次；
6. 已消耗 75% ambiguity token 预算，但三个 I3 Episode 中少于两个比冻结 baseline 增加了完整目标迁移；
7. 需要第三套主表示、第三轮 prompt 调整、额外领域或新的回答对照；
8. 任何人试图在看到输出后改变 Gold、Episode、阈值或把历史 I3-Sim NO-GO 改写为 PASS。

## 10. 合法终局

- `PASS`：第 6 节全部门槛合取通过，可以提出是否让 projection 进入正式 materialization 的后续决策；
- `NARROW`：硬不变量通过，但只有明确子集的状态语义可靠；收窄产品承诺并闭合，不伪称完整 C1；
- `REWORK`：表示合同仍成立，但当前评估器无法满足 Episode，需要新的独立阶段合同；
- `STOP`：成本或边际信息不足，不继续消耗；
- `NO-GO`：出现硬失败、证据污染、不可解释确定性或无法保持历史/作用域。

任何终局都不自动授权 C1.5、C2 或真实 Pilot。

## 11. Closure Artifacts

C1 只有在以下产物同时存在时才算闭合：

1. Accepted contract 与输入收据（路径、hash、基线 commit、projection version）；
2. 冻结 Micro fixtures、预期 transition 和裁决槽位；
3. old/new projection artifacts 与 byte/hash replay 收据；
4. grounding、scope、condition、history、uncertainty、isolation 验收矩阵；
5. provider usage ledger、缓存命中、无效解析和失败原件；
6. 人工裁决记录及引用；
7. 阶段终局报告；
8. Implementation Status、Discovery Backlog、路线状态更新；
9. 可回退 Git 提交和 clean worktree 证据。

## 12. 已接受的产品决策

产品负责人于 2026-08-25 明确接受以下四项：

1. C1 使用冻结 QuestionFrame，把问题身份作为输入假设；
2. C1 sidecar projection 排除 `task_relevance/marginal_cost`，留给 C2；
3. 12 calls / 180k provider tokens / 120 分钟语义人工评审是执行硬上限；
4. 只有三个 I3 Episode 与 Evolution Micro 全部达到预注册语义迁移且 0 hard failures，才可 `PASS`。
