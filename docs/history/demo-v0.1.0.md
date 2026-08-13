# WGEMemory4LLM Demo v0.1.0

封板日期：2026-07-24

> **历史发布说明，不是当前架构状态。** 下列数字、Gate 2 计划和 B/P/E-min 标签只描述 2026-07-24 的 Demo 封板，不随当前实现回填。2026-08-10 的现状以根目录 `architecture-baseline.html` v3.0 为准，产品方向以 Product Definition v1.4 为准，当前执行顺序以 `WGEMemory4LLM-Iteration-Operating-Plan.md` v1.2 为准。

## 版本定位

这是工程薄切片的正式 Demo 基线，不是产品效果正式结论。

它已经证明：

- Markdown → Source / SourceSpan → Claim / Concept / Relation → Context Pack 的链路可运行。
- 大材料输出截断时能够有界缩批、记录 telemetry 并恢复。
- Source 摄入状态和 Compile 状态分离，失败不会等同于完成。
- Claim 与 Relation 分别通过结构和语义门禁。
- Quarantine 与 canonical 物理隔离。
- Source publication 可原子替换，外来跨材料边在端点失效时会先隔离。
- Agent 可通过 Context Pack 看见经门禁的跨材料 `RELATED_TO`，但不能把弱边当作推理支持。

它尚未证明：

- WGEMemory 相对“文件夹 + Agent 搜索”能稳定提高任务质量。
- WikiModule 和 Typed Graph 分别带来多少独立增益。
- 事实纠正能够可靠传播，并让后续 Agent 停止复发旧错误。
- 当前自动 Relation 审计能够在无人复核条件下安全发布全部关系类型。

## 封板快照

| 项目 | 数值 / 状态 |
|---|---|
| Source | 6 |
| SourceSpan | 382 |
| COMPLETED Source | 01 / 02 / 03 |
| SOURCE_INGESTED | 05 / 09 / 11 |
| Canonical Claim | 261 |
| Quarantined Claim | 23 |
| Consumable Relation | 76 |
| Canonical cross-material Relation | 3，均为人工复核后的 `RELATED_TO` |
| Canonical `EQUIVALENT_UNDER` | 0，校准前 fail-closed |
| Relation dangling endpoints | 0 |
| Relation unresolved evidence | 0 |
| Automated tests | 9 files / 43 tests |

## 验收命令

```bash
npm run typecheck
npm run lint
npm test -- --run
npm run build
git diff --check
npm run dev -- status
```

## 版本资产

- 产品与实验合同：根目录四份 `WGEMemory4LLM-*.html`
- 当前架构与真实状态：`architecture-baseline.html`
- 不可变证据：`sources/`
- 默认消费知识：`publications/`
- 隔离审计轨迹：`quarantine/`
- 真实运行证据：`runs/`
- 受控语料：`mathtest-material/`

## 下一阶段边界

下一阶段不继续以“逐篇编译看数量”为目标，而进入 Gate 2 最小产品切片：

1. 为新旧 publication 建立语义 diff 门禁并冻结运行配置。
2. 在门禁下把 05 / 09 编译进 5 篇冻结语料。
3. 建立 B（文件搜索）/ P（ClaimGraph Prototype）/ E-min（Wiki + Typed Graph）统一回答壳。
4. 从现有 Benchmark 冻结 12–20 道 Dev/Pilot 题及 requiredClaims、requiredSources、expectedPath、conditions、forbiddenClaims。
5. 在同模型、同预算、匿名盲评条件下第一次验证 Agent 任务效果。

正式 Demo 基线应保持稳定；上述施工在独立 Git worktree 中进行。
