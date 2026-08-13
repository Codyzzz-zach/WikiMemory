# WikiMemory 仓库地图

> 这是一张“从哪里开始看”的责任地图，不是目标架构。目标架构见根目录
> `architecture-baseline.html`，当前实现见 `docs/status/implementation-status.md`。

## 五个边界

| 边界 | 目录 | 是否生产输入 | 是否可直接移动 |
|---|---|---:|---:|
| 产品内核 | `src/` | 是 | 否，需代码重构 |
| 运维与研究工具 | `scripts/` | 否 | 暂否，历史命令和相对 import 仍依赖路径 |
| 规范与操作文档 | `docs/` + 根目录五份产品文档 | 否 | 按文档分权整理 |
| Benchmark 与实验 | `benchmarks/`、legacy `batch-*` / `workbuddy-*` / `benchmark-s200-*`、`experiments/` | 否 | 冻结路径先不动 |
| 运行时与生成物 | legacy 根状态、`runs/`、`indexes/`、`dist/`、`node_modules/` | 只有显式 runtime root | 不作为源码整理对象 |

## 读代码的最短路径

```text
src/
├── application/      # 用例编排：Transport 只调用这里
├── transport/mcp/    # 当前 Agent 协议入口
├── workers/          # 异步摄入 Worker
├── infrastructure/   # Job、锁和本地持久边界
├── ingestor/         # Markdown → Source / SourceSpan
├── compiler/         # Source → Claim / Concept / Relation 草案
├── linter/           # 语义门禁、Canonical / Quarantine 存储
├── retrieval/        # Seed、Source 路由、证据闭包与预算
├── graph/            # Relation 治理与候选导航
├── context-pack/     # Agent 可见 DTO
├── wiki/             # WikiModule 形成、物化与重建
├── evolution/        # 版本、事务与影响传播
├── pilot/            # 历史实验层；产品观测入口在 application/
├── types/            # 知识对象类型与 schema
└── cli/              # 兼容和运维入口，不是最终 Agent 合同
```

生产调用主线：

```text
MCP / CLI
  → Application Service
  → Ingest Job + Worker，或 Query / Trace / Correction / Pilot 用例
  → Compiler / Linter / Retrieval / Graph / Wiki / Evolution
  → 显式 runtime root
```

## 文档怎么读

```text
产品目标        WGEMemory4LLM-Product-Definition.html
理想架构        architecture-baseline.html
知识语义        docs/specs/knowledge-contract.md
当前事实        docs/status/implementation-status.md
当前施工合同    WGEMemory4LLM-Iteration-Operating-Plan.md
真实 Pilot      docs/operations/pilot-runbook.md
验证证据        docs/verification/
历史快照        docs/history/
```

## 为什么根目录仍有很多数据目录

`batch-c-*`、`workbuddy-*`、`benchmark-s200-*` 和 `mathtest-material/` 已被历史脚本、
合同、裁决或工件 hash 按原路径引用。把它们直接挪到 `benchmarks/` 会让“目录更好看”，
但会破坏旧实验复现。因此本轮只建立清晰入口，并规定新数据进入 `benchmarks/`；旧目录只有在
“路径重写 + hash 不变 + 历史脚本回放”三项兼容证明同时通过后才迁移。

同理，根目录 `sources/`、`publications/`、`quarantine/`、`versions/`、`wiki/` 和
`manifest.jsonl` 是 legacy Demo 状态，不是生产镜像种子。新运行必须使用独立
`WGE_RUNTIME_ROOT`，建议放在仓库外或被 Git 忽略的 `runtime-data/`。

## 工具视野

根目录代码图会被外部参考、实验、Benchmark、运行日志和 legacy 知识状态污染；这些目录中还有
大量 JSON/HTML/Python/Rust，根图的文件数和语言数不能代表 WikiMemory 产品代码。仓库级
`AGENTS.md` 因此要求架构分析使用独立 `WikiMemory-src` 索引，或至少把查询 scope 到 `src/`。

本轮曾验证本地参考 CodeGraph 项目的 `codegraph.json` 排除机制，但当前接入的是另一套
`codebase-memory-mcp`，配置不互通；没有把一份实际不生效的配置留在仓库里冒充隔离。
