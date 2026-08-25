# C1-A/B Freeze 与 Contract/Micro 验证记录

> 日期：2026-08-25
>
> 裁决：`PASS_CONTRACT_MICRO_FREEZE`
>
> 边界：本裁决只关闭 C1-A/B，并授权 0-provider-call 的 C1-C Pure Shadow；不是 C1 `PASS`，
> 不授权 C1-D ambiguity calls、materialization 替换、C1.5、C2 或真实 Pilot。

## 1. 合同身份

- Accepted contract：`docs/specs/c1-weighted-question-state-contract-v1.md`；
- acceptance commit：`b89c746b171afacca837205947381b5c234b2f48`；
- contract SHA-256：`18da4349f7cac0bc31adeb10cbdf2a015a1f7f6a721c7384ff4ed24d82970f71`；
- C1 manifest：`benchmarks/c1-weighted-question-state-v1/manifest.json`；
- manifest SHA-256：`1f1a9a7819ab0fd4815e8e8b86ff64144272fe920b1778e03a101aa2348c3317`。

产品负责人确认的四项决策均已进入可机读合同：QuestionFrame 冻结、身份作为输入假设、C2 成本变量
不进入 sidecar、12 calls / 180k tokens / 120 分钟为后续硬上限，以及三个 I3 Episode 与一个
Evolution Micro 必须合取通过且 0 hard failures 才能宣称 C1 `PASS`。

## 2. 架构边界复核

通过 `WikiMemory-src` codebase-memory 图复核：

- `QuestionFrame` 是 35 入度的核心模型；C1-A/B 没有改动该接口；
- `materializeQuestionWikiModule` 是已有消费接缝，当前仍用 `assertionRoleV2` 按单条 Claim 的
  validity/conditions 形成角色；C1-A/B 没有替换该路径；
- question formation、identity、lifecycle 与 materialization 分属不同调用簇；C1-A/B 只新增合同资产
  与测试，没有修改 `question-proposer`、`question-formation-v2` 或 `question-lifecycle`；
- C1 sidecar 显式分离 knowledge scope 与 semantic applicability，避免把权限作用域误当成事实适用范围。

## 3. 冻结资产

| 资产 | SHA-256 |
|---|---|
| `input-receipt.json` | `d932b5af8af8eed62330a398dcf08d43a5339d79acd863b3a2080483a56524d5` |
| `reason-codes.json` | `935cd2b901666fd351b57720aa0535e8e20cb9ad2e99174c05c6e85cd9b417d1` |
| `question-state-projection.schema.json` | `e6e6cebe6acb1d87250540ce2040353963c3e67fead23034ad7d359f88277a13` |
| `fixtures/evolution-micro.json` | `34d3099e9a61a015831d302b693ac8073cd18657f0e031e42ca16d86ef9e24bc` |
| `fixtures/i3-failure-samples.json` | `3b80f3b88fcbc6791d99fa91834ccbdd47fe2bd5d38e628f33516d531151ba69` |

Projection schema 冻结 `LEADING/CO_LEADING/ALTERNATIVE/HISTORICAL/UNRANKED` 与
`CONDITIONAL/CONTESTED/UNRESOLVED`，保留 grounding、authority、currentness、applicability、
relational support 与 uncertainty 六个理由维度，不生成综合概率。顶层 `additionalProperties=false`，
且没有 `task_relevance` 或 `marginal_cost`。

## 4. Evolution Micro 预注册

Micro 只使用三份 Synthetic/Silver 材料，不宣称真实领域泛化：

| 时间 | 输入闭包 SHA-256 | 预注册语义 |
|---|---|---|
| T0 | `71e2ef02ad602e74fc7ff911f41e35158f842e3f0d454466d1b2c8be1de16a84` | 外部 TLS、条件性内部 HTTP 与独立控制形成基线 |
| T2 | `093919cfddba2aaf30ccebee1a041e18614dd05cf81066b2fd60c08526f70065` | TLS 1.3/mTLS 限域取代；T0 保留为历史；独立控制继续有效 |
| T3 | `0b2611dabe99497c301e04c9c0b81bdbdb471b973c1e6480867c90d15eedd991` | 两个同级委员会立场均为 `UNRANKED` 且 `UNRESOLVED`；无授权裁决不得制造赢家 |

所有 Micro EvidenceSpan 均能解析到冻结文件：T0/T2 用真实 Markdown 标题定位，T3 因原文没有二级
标题，使用稳定段落片段定位。条件、applicability、Claim、Relation 与 Evidence 引用均在各时点输入
闭包中存在。

## 5. I3 失败样例

- PSY：冻结 `CONFLICT_FLATTENED`，要求 `DISPUTE_PRESERVED` 与 `AUTHORITY_NOT_FLATTENED`；
- TEC：冻结 `UNSUPPORTED_ASSERTION`，要求 proposal 历史保留与条件保真，禁止模型常识补写当前状态；
- LAW：冻结 attribution/condition gap，要求法规、官方行动和评论分层；
- 历史 12 份回答只允许失败诊断，不得支撑 projection、重新计分或进入 Canonical Knowledge。

## 6. 输入与隔离收据

冻结 host 复核结果：

- I3 canonical aggregate：76 files，`3274bab9cb13ba1fcd9104eec7722b22b4b1450a2088246394f31e7dd1028b27`；
- Question state file：`da1df59a5058852f6c25184c86577410ccdd53eda050043265929cbc9c12f300`；
- internal state hash：`eabfb6000f1b58a55b7749b16c20458f9009a2bdf172071a639cb2a5826816eb`；
- 34 QuestionFrames / 64 decisions；
- Wiki absolute-path aggregate：21 files，`6449ce9ba9e5eebf24c2e88496ea0e19a285586f28cd13057e352c1c781d8fb9`；
- paired report：`8d699e035f4b8185ab319691e5a1a94b41d0dfb2045d8840b963620942fdc2b8`；
- I2.5 三个稳定问题 ID 与四份回归材料已进入 receipt；没有重新运行 formation。

冻结 runtime 是 `/private/tmp` 加速缓存，不是仓库可携带权威。路径缺失或 hash 不匹配时必须进入
`INPUT_REFREEZE_REQUIRED`，不得静默重建或切换到主 runtime。

## 7. 自动化结果

| 验证 | 结果 |
|---|---|
| C1 contract test | 6/6 PASS |
| Full Vitest | 54 files / 346 tests PASS |
| TypeScript | `src` + `scripts` strict typecheck PASS |
| Biome | 200 files PASS |
| Build | ESM + DTS PASS |
| Provider usage | 0 calls / 0 tokens |
| Answer calls | 0 |
| Frozen-material recompilation | 0 |

## 8. 裁决与下一边界

C1-A/B 的输入、schema、reason code、Micro oracle、失败样例和可携带校验已经充分冻结，因此裁决为
`PASS_CONTRACT_MICRO_FREEZE`。下一责任层是 C1-C：实现纯函数 sidecar projection，并在隔离 runtime
验证 grounding、byte/hash replay、局部重算 isolation 与 Question/Canonical immutability。

C1-C 仍保持 0 provider calls，且不得把 projection 接入现有 WikiModule 或 Context Pack 消费链。
只有 C1-C deterministic Micro 全通过，才有资格按 Accepted Contract 评估是否进入 C1-D；资格不等于
必须消费模型预算。
