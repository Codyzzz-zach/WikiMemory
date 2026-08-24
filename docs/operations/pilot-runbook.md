# WikiMemory 一周 Pilot 操作合同

> 状态：历史可执行草案，2026-08-24 起暂停。I3-Sim 已以 NO-GO 闭合；C1/C2 完成并冻结新的
> C3 合同前，不按本文启动真实 Pilot，本文中的 10–20 任务与 30 天扩展不构成当前承诺。
>
> 目的：先验证观测链、权限、隐私和双臂执行是否可持续，再扩大到 30 天产品实验。本文不是 Benchmark Gold，也不预设 WikiMemory 必须胜出。

## 1. 启动条件

- 使用独立 `runtime-data`，不要直接把仓库根状态当个人生产知识库；
- 固定 Agent 模型、系统提示、工具权限和总提示预算；
- 本地生成一个 16 字符以上的随机 `WGE_PILOT_HASH_KEY`，不要提交到 Git；
- `pilot` 必须与 `read` 同时启用，且注入固定 principal；
- 原始任务/回答由用户自己的 Agent 会话保存；WikiMemory 只保存 HMAC 和结构化结果信号。

```bash
npm run dev -- --runtime-root ./runtime-data init

WGE_RUNTIME_ROOT=./runtime-data \
WGE_MCP_CAPABILITIES=read,pilot,ingest,correct \
WGE_MCP_PRINCIPAL_ID=mixi \
WGE_MCP_PROJECT_ROLES='{"wikimemory":"owner"}' \
WGE_PILOT_HASH_KEY='replace-with-a-random-local-secret' \
npm run mcp
```

需要编译新材料时另启 Worker，并使用相同 runtime root：

```bash
WGE_RUNTIME_ROOT=./runtime-data npm run worker
```

## 2. 每个配对任务怎么跑

同一真实任务建立两个臂。顺序随机或交替，不能总让第二个臂利用第一个答案。

### BASELINE

1. 调用 `register_pilot_baseline(task, budgetTokens, idempotencyKey)`；
2. 让同一 Agent 只使用预注册的文件夹/原文搜索能力，不调用 `query_context`；
3. 完成后用返回的 `traceId` 调 `record_pilot_outcome`。

### WIKIMEMORY

1. 调用 `query_context(task, budgetTokens)`；这会自动生成 WIKIMEMORY 查询收据；
2. Agent 使用返回的 Context Pack 完成任务；
3. 用响应的 `traceId` 调 `record_pilot_outcome`。

`budgetTokens` 只约束 WikiMemory 可见上下文。执行者还必须在 Agent 外层保持相同模型、系统提示、工具权限和总提示预算；系统当前不会替你强制这四项。

## 3. 结果字段

- `outcome`：`SUCCESS | PARTIAL | FAILURE`；
- `repeatedExplanation`：用户是否不得不再次解释已经提供过的信息；
- `correctedErrorRecurrence`：已发布纠正后是否仍复发旧错；
- `hardFailures`：
  - `UNSUPPORTED_ASSERTION`：无依据断言；
  - `CORRECTED_ERROR_RECURRENCE`：已纠正错误复发；
  - `CONFLICT_FLATTENED`：已知冲突被静默抹平；
  - `CITATION_FAILURE`：关键结论无法追溯；
  - `SCOPE_LEAK`：个人/项目知识越权泄漏；
- `userAccepted`：用户是否接受结果；不确定时传 `null`。

首个 Outcome 是不可变原件。标错后不要覆盖；应保留原记录并在 Pilot 裁决中说明。

## 4. 一周 Micro 退出条件

先收集 10–20 个真实任务，至少覆盖 3 个领域和 3 个纠正/偏好 episode。扩大前必须同时满足：

- `pairedTasks` 覆盖计划任务，且 `pairedOutcomes` 不低于 80%；
- 原始任务和回答没有出现在 `runs/pilot/`；
- 两臂模型、工具权限、顺序规则和总预算有外部执行记录；
- 没有 `SCOPE_LEAK`；
- 失败能够归因到编译、检索、Context 使用、纠正传播或 Agent 执行之一；
- 用户确认这些字段足以表达真实体验，或先修改观测合同再扩大。

一周 Micro 只验证 Pilot 可执行性，不宣称产品增益。本文原设计的 30 天产品实验、5+领域、100+
真实任务和 2+纠正周期均保留为历史候选参数；新的 C3 合同必须根据 C1/C2 结果重新冻结，不能自动
继承这些数字。

## 5. 状态与检查点

- `get_pilot_status`：按 BASELINE/WIKIMEMORY 分臂查看查询、反馈覆盖、结果、复发、硬失败、用户接受和平均 WikiMemory 可见 token；
- `mark_trusted_checkpoint(label)`：记录用户信任的当前知识版本与 Pilot 状态，不修改知识；
- `runs/pilot/` 不进入知识快照，知识回滚不能删除失败证据；
- 不删除首轮日志，不把一周 Micro 重新命名成 Blind。

## 6. 摄入经济性台账

Pilot 不能只记录查询侧可见 token。每次新 Source 编译或重编后，保留相同 runtime root 的
`runs/llm-calls.jsonl`，并生成只读汇总：

```bash
npm run --silent economics:ingest -- --runtime-root ./runtime-data --json
# 诊断历史缩批/重试时才使用 --all-runs
npm run economics:ingest -- --runtime-root ./runtime-data --all-runs
```

周结算至少报告：每 Source 的 provider 总 token、各 stage token、缓存命中、无效解析/截断消耗、
成功映射 Claim 数和 tokens/Claim。调用日志中的 usage 是 provider 实际返回值；cache hit 不虚构为
provider token。它仍只是摄入成本，不等于价值：只有再结合该 Source 在后续多少真实任务中被选中、
减少了多少重复解释或错误复发，才能讨论摊销收益。
