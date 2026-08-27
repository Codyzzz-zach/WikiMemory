# C1.5-A Question Association Bridge · Zero-call Gate

> 日期：2026-08-26
> 裁决：`PASS_ZERO_CALL / READY_FOR_PROVIDER_SEND_AUTHORIZATION`
> Provider calls：0
> Canonical mutation：0

## 1. 本轮拿下了什么

Question Association Bridge v1 已从方向性建议变为可重放的影子合同、冻结输入和确定性 Gate：

- 18 个不透明 `Claim × Question` pair：7 ATTACH、8 REJECT、3 UNCERTAIN；
- A0 名称卡和 A1 证据身份卡使用同一 Claim、Question、模型合同与 batch；
- oracle 与 provider payload 物理分离；
- 每个问题候选来自新 Source 进入前的 Question transaction snapshot；
- identity card 最多包含 6 条跨 Source/知识版本的代表性既有 Claim；
- response schema、引用、Evidence、reason code、三值语义和 Canonical hash 全部 fail-closed；
- 不创建 Question，不修改 lifecycle、formationSignals、WikiModule、Context Pack 或 C1 projection。

这不是语义实验 PASS，也不证明 A1 优于 A0。它只证明实验输入、时间边界、泄漏边界、验收器和
实际发送 envelope 已准备完毕。

## 2. C1-D 结论修正

C1-D 的 6 个“未关联焦点 Question”的 Source 均已在 Canonical Question state 中形成或更新其他
QuestionFrame。原 Source-level coverage 无法区分：正确拒绝、错误挂接、错误新建和真实漏接。

Bridge 因此把验收单位改为 Claim-level pair，并把 `false ATTACH = 0` 设为最高优先级门禁。当前
系统已经存在的批量挂接风险也进入 Hard REJECT：例如 PNAS URL、Hacker News thread identity 和
thread 创建时间被 formation proposal 与其他 Claims 整组挂入问题闭包。

## 3. 冻结时发现并修复的两类泄漏

1. 初始 18-pair 表中有 3 个 Claim 发生时目标 Question 尚未存在，会把 CREATE 混成 association。
   已替换为真实的后续跨来源 UPDATE 或竞争候选；三值数量与预算不变。
2. 初始 `PSY-A1/R1/U1` 名称会泄露 Gold。所有 provider-visible ID 已改为不透明的
   `QAB-PSY-01` 等格式；payload builder 不接受 oracle 结构，response parser 也拒绝未知字段。

## 4. 时间性与输入收据

- I3 runtime final Question state SHA-256：
  `da1df59a5058852f6c25184c86577410ccdd53eda050043265929cbc9c12f300`；
- 18 个 pair 使用 10 个逐 Source transaction snapshots；
- 每个 snapshot 内 `questions/state.json` 的 hash 必须等于 transaction receipt 的
  `beforeQuestionStateHash`；
- 18/18 Question 在输入 Source 到达前存在；
- 18/18 prior question closure 不包含当前 Source 或当前 Claim；
- 所有 Claim Evidence ref 都解析到冻结 SourceSpan 的 base ref；
- 仓库 fixture `input.json` SHA-256：
  `85d7ee87e29e2bde331cc6c8744f4f1e5dd58a160bed389cb70b08020c6ee05c`；
- oracle SHA-256：
  `c40fbac9be60488d737c047c3670106fbd3c176b59f3844ff5b9e28d6c22b78c`。

## 5. 精确 provider-visible envelope

除固定 system prompt 外，只计划发送下列 6 个 JSON；不发送 `oracle.json`、`input.json`、manifest、
runtime logs、raw LLM outputs、回答或 Pilot records。

| Domain / variant | Bytes | 估算 input tokens | SHA-256 |
|---|---:|---:|---|
| law A0 | 7,304 | 1,826 | `cc01bc1cd91acf892a28a0b95ca0dece4cc32b69e6a920dd06e43df4681d72fa` |
| law A1 | 23,544 | 5,886 | `7e72dcd2ccdb47f8682ac9e7faef1cab9f9f68a6603acd0b9806825c9768f582` |
| psychology A0 | 6,711 | 1,678 | `fba61ad04d51a6a3f9765921dbb5c59aaf77dcdb4252d470a7975f4e0a003e49` |
| psychology A1 | 21,803 | 5,451 | `e278aa01d90487bc0ea503f4a8b53ef53d90164f48304896bfa9c95abf2806b8` |
| technology A0 | 6,278 | 1,570 | `af749bbead2ca1d66e750a2c27b6c59e0edf9e68cbc7dc5e391b6354e9669f94` |
| technology A1 | 15,692 | 3,923 | `72adb761353ebce38e3889ab730f95417d0ae924cd7ad7663f56fd50fd93242b` |

固定 system prompt SHA-256：
`c96cfca6457e5cac6d8ba56f4e683c6573f800c3cda00bdd9bd8cf9b02d24548`。

六次主调用在响应前的总输入估算为 22,152 tokens；每次 response 上限 4,096 tokens。合同总预算仍为
最多 8 calls / 90,000 provider tokens，其中最多 2 次只允许修复 JSON/schema，不允许语义调参。

## 6. Zero-call 验收证据

- `npm run typecheck`：PASS；
- `src/wiki/question-association-shadow.test.ts`：4/4 PASS；
- `src/integration/question-association-bridge.test.ts`：4/4 PASS；
- 全仓 `npm test`：58 files / 364 tests PASS；
- `npm run lint`、`npm run build`、`git diff --check`：PASS；
- 6/6 payload 可由冻结 input byte-for-byte 重建；
- case 顺序反转不改变 payload；
- synthetic exact-oracle output 只用于验证 Gate 可达性，A0/A1 × 3 domains 全部通过；
- unknown response field、当前 Source 泄漏、带 Gold 的 case ID、虚构 Evidence 和 Canonical hash
  改变均被确定性拒绝。
- `WikiMemory-src` full code graph：1,968 nodes / 7,863 edges / 0 skipped；新增 payload builder
  的 inbound callers 只有 unit/integration tests，没有进入 production maintenance/materialization 链。

## 7. 下一边界

下一步只允许在产品负责人明确授权发送第 5 节六个 payload 后执行 A0/A1 配对调用。Provider output
只能写隔离 shadow runtime，先过自动 Gate，再揭示 oracle 做一次人工复核。

调用结果必须以 `PASS_IDENTITY_CARD | NO_MARGINAL_VALUE | REWORK_ASSOCIATION_SEMANTICS |
NARROW_TO_DETERMINISTIC | STOP_BRIDGE` 之一闭合，不因失败自动增加调用或修改生产 proposer。
