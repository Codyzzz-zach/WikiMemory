# C1-C Pure Shadow 验证结果

> 日期：2026-08-25
>
> 裁决：`PASS_PURE_SHADOW`
>
> 边界：本裁决只关闭 C1-C deterministic shadow；不是 C1 `PASS`，不替换 WikiModule/Context Pack，
> 不证明三个 I3-Sim 真实 Episode 已通过，也不证明 Question Identity Semantics。

## 1. 实现身份

- Accepted contract commit：`b89c746b171afacca837205947381b5c234b2f48`；
- C1-A/B commit：`a864b9134a490cb7ab3a7232a2c317438deeed9d`；
- runner：`scripts/run-c1-pure-shadow.ts`；
- shadow root：`/private/tmp/wikimemory-c1-pure-shadow-a864b913-final`；
- runtime report SHA-256：`8ce5496f9f617bb7661217846f6fc39c4103b161459a58974e38c10ac9618ca2`。

本阶段新增独立的 `QuestionStateProjection` 纯函数与 shadow-only storage，没有修改 `QuestionFrame`、
question formation、question lifecycle、Claim/Relation Canonical schema、materialization 或 Context Pack。

## 2. 表示与判定边界

Pure Shadow 只消费显式结构化输入，不从 statement 文本猜测事实：

- Claim：authority、authority class、effective/proposed/observed、effective date、knowledge scope、
  applicability、conditions 与 EvidenceSpan；
- Relation：显式 `SUPERSEDES/CONTRADICTS/SUPPORTS`、relation status、applicability、conditions 与
  EvidenceSpan；
- `OBSERVED` Claim 只支撑 uncertainty，不自动成为问题答案分支；
- 同权威、同 knowledge scope、同 applicability 的有效 `SUPPORTS` 才能合并为同一分支；
- 显式且已生效的 `SUPERSEDES` 才能把旧分支标为 `HISTORICAL`；存在非生效型条件时旧分支继续保留，
  并产生 `APPLICABILITY_PARTIAL/CONDITION_REQUIRED`；
- 同级未裁决冲突产生 `UNRANKED + CONTESTED + UNRESOLVED`，不存在授权裁决时不制造赢家；
- output hash 使用递归 key-sort canonical JSON，artifact 按 question + knowledgeVersion + projectionHash
  分版保存。

## 3. 实跑结果

| 时间 | Projection hash | Artifact SHA-256 | Bytes | Semantic checks | Grounded reasons |
|---|---|---|---:|---:|---:|
| T0 | `80e23df7b2f5e5fb45dce7ca629d080812d41260ad6fed4971ce0c81a2758c5b` | `32809018a2e51b85c34e72d5559fb456a51174db79ef6a1407b3bee394a47b04` | 3,409 | 16 | 9 |
| T2 | `c8025c2120d438e402cbd5ac42c1fe83a9818957050d207e81d821d3bcc36d0f` | `36d88f417002c03f849b7a61df784caebf7a22e4e1c8ed62a3f5261d9442579b` | 9,328 | 26 | 23 |
| T3 | `622cc48c49ad4bef679fbc25232739c80a64383b1c574a8f0357d6d6ab11da4a` | `d81d048ea23982b9491a7b03a2370b14ac2283ff2aec7ef26687628886a64aff` | 16,576 | 36 | 39 |

合计：3/3 frozen snapshots、78/78 semantic checks、71/71 grounded reasons；0 replay failures、
0 grounding failures、0 hard semantic failures。

无关哨兵 `question:c1-micro:unrelated-sentinel` 前后 projection hash 均为
`ca482f08151f6afb32a9d990b72dcbce2d2960d1d15dddaf811b1c1919588ba1`，artifact SHA-256 为
`ab46395653540e8a115bc36c65441881552dbdd85d3536d04363f314f6476cd0`。

## 4. Isolation 与 replay

- Canonical aggregate 前后均为 76 files / `3274bab9cb13ba1fcd9104eec7722b22b4b1450a2088246394f31e7dd1028b27`；
- Question state file 前后均为 `da1df59a5058852f6c25184c86577410ccdd53eda050043265929cbc9c12f300`；
- storage 拒绝 shadow root 与 canonical runtime 相同、互相嵌套或覆盖；
- 同一输入连续两次 output byte/hash identical；输入数组次序反转不改变 projection；
- projection 函数不修改输入对象；篡改 projectionHash 时序列化 fail-closed。

## 5. 实跑中发现并修复的问题

第一次 runner 实跑使用只含 questionRef 的 artifact 文件名，导致 T0/T2/T3 同一问题的版本互相覆盖。
这不影响内存投影计算，但违反历史保留与 closure artifact 要求，因此该次 runtime 不计证据。storage
随后改为 `questionRef + knowledgeVersion + projectionHash` 分版命名，并在全新 shadow root 重跑；最终
三个版本文件与无关哨兵同时存在。

另一个确定性反例是：若用自然语言 applicability 字符串等值判断全量取代，同义表述会误判。
当前规则改为由显式 SUPERSEDES 目标和生效条件决定；非生效型条件一律阻止旧分支全局历史化。

## 6. 自动化与成本

| 验证 | 结果 |
|---|---|
| C1 contract + projection tests | 12/12 PASS |
| Full Vitest | 55 files / 352 tests PASS |
| TypeScript | `src` + `scripts` strict typecheck PASS |
| Biome | 204 files PASS |
| Build | ESM + DTS PASS |
| Provider usage | 0 calls / 0 tokens |
| Answer calls / recompilation | 0 / 0 |

## 7. 裁决与下一边界

C1-C 的纯函数、grounding、replay、isolation、history/condition/uncertainty preservation 均通过，裁决为
`PASS_PURE_SHADOW`。它证明“加权状态表示可以在不改变问题身份和 Canonical Knowledge 的前提下被
确定性计算”，但只在 Synthetic/Silver Micro 上成立。

下一责任层是 C1-D Semantic Slice：为 I3-Sim 的 7 个冻结 QuestionFrames 建立 shadow adapter，先用
确定性规则映射已有 Canonical Claim/Relation/Evidence；只有真正影响 Episode 裁决、且规则无法解析的
authority/applicability/branch ambiguity 才能进入已接受的模型预算。C1-D 仍不得把 projection 接入现有
WikiModule 或 Context Pack，也不得重新编译材料或重跑回答 arm。
