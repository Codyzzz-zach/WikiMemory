# 仓库结构与 Kimi 第二轮建议核验

> 日期：2026-08-13。范围：只核验当前工作树、代码依赖、文档入口、运行留痕和目录职责；
> 不把审查意见直接当成事实。

## 裁决

| 审查意见 | 当前裁决 | 处理 |
|---|---|---|
| 当前工作未形成可复现 commit | **成立，仍是 P0 工程风险** | HEAD 仍为 `8829e40`；本轮没有在未厘清已有 staged/user 资产时盲目提交 |
| README 仍写 audit v2.3 / G3-C 下一步 | **对当前工作树不成立** | README 已指向 I0–I3 和 audit v2.8 实施状态；本轮进一步增加唯一仓库地图入口 |
| 摄入成本没有进入 Pilot 账本 | **部分成立** | `llm-calls.jsonl` 已有真实 provider usage，但此前没有按 Source/Run/Stage 的稳定汇总；新增 `npm run economics:ingest`。成本阈值和长期摊销仍未建立 |

M1、M2、H1-A 的裁决文件和代码语义与审查描述基本一致；它们仍只证明相应工程机制，不证明长期产品增益。
M1/M2 裁决内列出的权威工件 sha256 已逐项重算吻合。Kimi 把“三份都有 sha256 钉死的工件链”
说宽了：审查当时 H1-A 只记录 authoritative run/diagnostic 名称。基线收口时已为 H1-A 补入
contract、held-out contract、formation report/modules 与 dev diagnostic report/rows 六项 SHA-256，
并逐项重算；这提升的是证据封存强度，不把开发集机制证据升级成产品结论。

## 混乱的真实来源

根目录同时承载五种生命周期：产品源码、规范文档、密封 Benchmark、历史实验、legacy 运行状态。
其中 `experiments/` 约 686 MB / 66,489 文件，`runs/` 约 27 MB / 5,246 文件，外部
`references/` 约 272 MB / 2,322 文件。它们让人类目录浏览和默认代码图都产生噪声，
但不是 `src/` 产品分层失控的证据。

本轮采取：

1. 文档物理分为 `specs/`、`status/`、`operations/`、`verification/`、`history/`；
2. 新增 `docs/repository-map.md`，给出唯一的人类入口和产品代码最短阅读路径；
3. 新增 `AGENTS.md`，强制架构发现使用 `WikiMemory-src` 或 `src/` scope；根图不得用于产品代码计数；
4. 保留 hash/合同引用的 legacy frozen roots 原位，不以视觉整洁破坏历史复现；
5. 新数据统一进入 `benchmarks/`，新运行统一进入显式 `WGE_RUNTIME_ROOT`。
6. Git 只保留实验合同、冻结输入、裁决和紧凑权威报告；`workspace/`、索引、raw LLM 输出、
   逐题 contexts/records 与 preparations 属于可再生中间物，保留在本地或外部工件存储，不进入基线提交。
7. `benchmark-s200-stage-b-sealed/` 与 v1.1 密封目录仍满足“候选冻结前不得交付”的合同条件，
   本轮只确认 README/manifest 元数据，不读取 Gold 内容，也不把密封目录提交到 Git。

## 尚未完成

1. 当前大工作树还没有提交，镜像和实验代码仍缺 commit identity；这是结构整理不能替代的问题。
2. legacy frozen roots 的物理迁移需单独 migration：重写路径、证明文件 hash 不变、回放历史脚本。
3. `scripts/` 仍有大量 Goal 时代入口；在工件链迁移前只做责任标记，不随意分目录。
4. 摄入经济性已有单次成本台账，但“编译成本 / 后续真实任务收益”的 30 天摊销指标必须由 Pilot 产生，不能从旧 Benchmark 猜出。

## 工具隔离复核

直接重建根级 `codebase-memory-mcp` 图后，函数面从历史混合图的 2,171 个收敛到 547 个，
但工具仍为 `experiments/` 保留 9,414 个 File 节点，并残留 S200 Python 入口。原因是本地参考
CodeGraph 的 `codegraph.json` 与当前 `codebase-memory-mcp` 不共享配置。该尝试已撤回。

最终独立索引 `WikiMemory-src` 直接以 `src/` 为根建立：**63 files、全部 TypeScript、1,215
nodes / 4,275 edges**；入口、hotspot 和 cluster 均只来自产品内核，不再出现实验、S200 或外部
Rust 仓库。后续架构证据统一使用该 scope。
