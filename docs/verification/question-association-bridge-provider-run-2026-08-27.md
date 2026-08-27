# C1.5-A Question Association Bridge · Provider Run

> 日期：2026-08-27（Asia/Shanghai）  
> 运行裁决：`STOPPED_BEFORE_ORACLE_GATE / NO_SEMANTIC_RESULT`  
> Provider calls：5/8（3 main + 2 format repair）  
> Provider tokens：31,547/90,000  
> Canonical mutation：0

## 1. 结论

本轮严格按冻结 envelope 启动，但在第 3 个 main batch 的 response schema Gate 停止。3/3 main
responses 都把 `boundaryNotes` 返回为 JSON string，而冻结 schema 要求 JSON string array。前两个 batch
分别使用一次授权内的纯格式修复；第 3 次同型失败发生时，两次修复额度已经耗尽，runner 因而没有发送
剩余 3 个 main payload，也没有追加第 9 次调用。

这不是 `PASS_IDENTITY_CARD`、`NO_MARGINAL_VALUE` 或一次 association semantics 的失败结论。完整
A0/A1 配对数据尚未形成，oracle 也没有被 runner 加载；现在选择五个产品结果分支中的任何一个，都会把
wire contract 缺陷误写成问题关联能力结论。因此本轮只闭合为“运行停止、无语义结果”，保留下一次重新
冻结输出合同的决策边界。

## 2. 实际调用与成本

| Call | Kind | Payload | Prompt | Completion | Total |
|---:|---|---|---:|---:|---:|
| 1 | main | law A0 | 2,317 | 1,219 | 3,536 |
| 2 | format repair | law A0 | 3,650 | 1,225 | 4,875 |
| 3 | main | law A1 | 8,039 | 1,189 | 9,228 |
| 4 | format repair | law A1 | 9,342 | 1,195 | 10,537 |
| 5 | main | psychology A0 | 2,216 | 1,155 | 3,371 |
| **合计** | **3 main + 2 repair** |  | **25,564** | **5,983** | **31,547** |

两次 repair 消耗 15,412 tokens，占本次总 provider tokens 的 48.9%。这是重要的成本证据：如果一个
可确定的 wire-shape 偏差依赖第二次模型调用修复，成本会接近翻倍；该责任不应继续隐藏在语义实验里。

5/5 calls 都有 provider usage，`finishReason=stop`，reasoning tokens 与 reasoning content 均为 0。
没有输出长度截断，也没有越过 8 calls / 90,000 tokens 上限。

## 3. 失败归因

本地、未读取 oracle 的结构审计得到：

- 3 个 main responses 都是可解析 JSON；
- 每个 response 都包含冻结 batch 的 6 个 case；
- `reasonCodes`、`groundedClaimRefs`、`groundedEvidenceRefs`、
  `groundedQuestionClaimRefs`、`competingQuestionRefs` 均为 array；
- 18/18 decisions 的唯一类型错误都是 `boundaryNotes: string`；
- 两个 repair responses 只把 `boundaryNotes: string` 包装为 `[string]`；对 main response 做同一机械
  normalization 后，与 repair response 的逐字段 diff 为空，verdict、reason、grounding 和 note 文本
  均未变化。

因此，当前证据把责任定位在 **semantic decision 与 wire serialization 之间的 adapter contract**，而
不是 token budget、thinking、JSON 整体可用性或 A0/A1 身份卡本身。固定 system prompt 虽声明“其余
复数字段都是 JSON string array”，但没有逐字段给出类型示例；Provider 在三个独立 main calls 中稳定
把语义上单条的 boundary note 输出为 scalar。

## 4. 隔离与盲性

- 只发送了 law A0、law A1、psychology A0 三个冻结 payload 与固定 system prompt；
- 两次 repair 只附带对应冻结 payload、Provider 自己的上一响应和固定纯格式修复指令；
- `input.json`、`oracle.json`、expected verdict、回答、Pilot、Agent trace 均未发送；
- session 的 `oracleLoadedAt` 为 `null`；失败发生后没有为凑齐语义结论而揭示 oracle；
- I3 runtime Question state 的 before/after SHA-256 均为
  `da1df59a5058852f6c25184c86577410ccdd53eda050043265929cbc9c12f300`；
- 所有 raw outputs 只存在隔离 runtime
  `/private/tmp/wikimemory-qab-v1-Q8TyqE`，仓库只保留去内容化的调用/hash/token receipt。

## 5. 对架构的直接启发

本轮证明了一个此前合同没有显式分层的事实：**关联语义可以是概率判断，但输出线协议必须由确定性层
负责。** 当前 v1 把两者一起交给模型，并用第二次模型调用修 wire shape，导致同一确定性错误重复发生且
占用近一半成本。

可讨论的 v1.1 方向只有输出责任层，不应趁机修改 A0/A1、18-pair、三值语义或生产 proposer：

1. 在 provider adapter 接受明确白名单内的 `string | string[]`，只做可证明无语义变化的
   singleton wrapping，再进入现有严格 Canonical parser；
2. 或使用 Provider 真正支持并经过小型零语义 canary 验证的 JSON Schema structured output；不能只因
   OpenAI-compatible 就假设支持；
3. 将“原始 Provider schema compliance”和“确定性 normalized contract compliance”分开记账，任何
   normalization 都必须在 receipt 中可见，不得伪装成模型原生合规。

这三条都属于新合同，不得隐式应用到本轮剩余 payload。重新运行前必须先冻结 v1.1、明确本地
normalization 是否计入 repair budget，并重新取得剩余数据发送/费用授权。

## 6. 可重放证据

- 执行器：`scripts/run-question-association-bridge-experiment.ts`；
- 去内容化 receipt：
  `benchmarks/question-association-bridge-v1/results/2026-08-27-stopped-run-receipt.json`；
- 原始隔离 session：`/private/tmp/wikimemory-qab-v1-Q8TyqE/session.json`；
- 固定 prompt SHA-256：
  `c96cfca6457e5cac6d8ba56f4e683c6573f800c3cda00bdd9bd8cf9b02d24548`；
- preflight：lint、双层 typecheck、11 个相关测试与 6/6 payload hash 全部 PASS。
