# WGEMemory4LLM

WGEMemory4LLM 是面向通用 Agent 的知识编译与长期记忆原型。它把 Markdown 材料机械摄入为不可变 `Source` / `SourceSpan`，再编译为带证据与条件的 Claim、Concept 和 Relation，经过结构与语义门禁后，以任务相关的 Context Pack 提供给 Agent。

当前仓库是 **Demo v0.1.0** 的正式基线。它证明知识编译、隔离、跨材料导航和 Context Pack 组装链路能够工作；尚未证明 Agent 使用后一定优于文件夹搜索。下一阶段将通过同模型、同预算的产品效果 Pilot 验证这一点。

## 当前 Demo 快照

- 6 个已摄入 Source，382 个持久化 Span
- 01 / 02 / 03 已完成编译，05 / 09 / 11 保持 `SOURCE_INGESTED`
- 261 条 canonical Claim，23 条 quarantined Claim
- 76 条可消费 Relation，全部通过 relation audit v1.2；悬空端点和坏证据均为 0
- 3 条人工复核通过的跨材料 `RELATED_TO`
- `EQUIVALENT_UNDER` 在独立校准前默认 fail-closed
- 9 个测试文件，43 个测试通过

完整事实、验收证据和已知缺口见 [架构基线](architecture-baseline.html) 与 [Demo Release 清单](docs/demo-v0.1.0.md)。

## 项目结构

```text
.
├── src/
│   ├── cli/             # ingest / relations / query / status 命令
│   ├── loaders/         # 可插拔文档 Loader；当前生产只注册 Markdown
│   ├── ingestor/        # Source、SourceSpan 与摄入幂等
│   ├── compiler/        # 有界分批编译、状态恢复与 telemetry
│   ├── linter/          # Claim / Relation 门禁、发布与 quarantine
│   ├── graph/           # 类型化 Graph 与消费语义
│   ├── context-pack/    # Map → Seed → Subgraph → Evidence
│   ├── core/            # LLM Provider 与客户端
│   ├── parser/          # Markdown 机械解析
│   ├── prompts/         # 版本化编译、审计协议
│   └── types/           # 一等对象与运行时 schema
├── mathtest-material/   # 20 篇受控数学 Markdown 语料
├── sources/             # 不可变 Source / Span 证据根
├── publications/        # 按 Source 原子替换的 canonical 快照
├── quarantine/          # 默认消费链不可见的隔离产物
├── runs/                # 状态、统计、调用记录、缓存和原始模型输出
├── tests/               # Dev / held-out / evolution 题集合同
├── scripts/             # Meta-eval 与故障复现脚本
├── docs/                # 知识合同与版本说明
└── *.html               # 产品定义、用户故事、Benchmark 与架构基线
```

`readings/` 是外部论文集合，不属于当前 Markdown Demo 的知识状态，已被 Git 忽略。`indexes/` 是可重建索引，也不进入版本库。

## 快速开始

要求 Node.js 20 或更高版本。

```bash
npm install
cp .env.example .env
# 在 .env 中配置 DEEPSEEK_API_KEY

npm run typecheck
npm run lint
npm test
npm run build
```

查看当前知识状态：

```bash
npm run dev -- status
```

生成只读 Context Pack：

```bash
npm run dev -- query "Cauchy 列、实数完备性与完备空间之间的关系" --budget 12000 --depth 3 --json
```

摄入或重编 Markdown：

```bash
npm run dev -- ingest mathtest-material/01-number-systems.md --recompile --json
```

跨材料 Relation 维护：

```bash
npm run dev -- relations backfill source:01-number-systems-80440e2182e5653f --json
npm run dev -- relations quarantine <relationId> --reason "人工复核原因"
```

## 版本化数据边界

- `.env`、构建目录、外部论文和可重建索引不提交。
- `sources/`、`publications/`、`quarantine/`、`runs/` 有意提交：它们共同构成可审计的知识状态和真实 E2E 证据。
- Gold 问题、预期路径和禁止断言不得进入 Source、Graph、prompt cache 或编译输入。
- 完整重编会产生候选知识迁移；下一阶段在扩大语料前先增加 publication diff 门禁。

## 当前已知边界

- 生产 Loader 当前仅支持 Markdown；TeX/PDF/HTML 适配器尚未实现。
- WikiModule 有读取与消费合同，但自动生成和发布门禁尚未闭环。
- 现有 3 条跨材料边均为导航用 `RELATED_TO`，不可支撑结论；可信跨材料强边仍缺少正样本。
- LLM 自动 Relation 审计不能替代人工质量抽检。
- 当前 CLI 生成 Context Pack，但尚没有统一的 Agent 回答与 B/P/E 盲测运行器。

## 关键文档

- [产品定义](WGEMemory4LLM-Product-Definition.html)
- [用户故事](WGEMemory4LLM-User-Stories.html)
- [Benchmark](WGEMemory4LLM-Benchmark.html)
- [测试前一致性审计](WGEMemory4LLM-Pre-Test-Alignment-Audit.html)
- [架构基线 v1.5](architecture-baseline.html)
- [知识合同](docs/knowledge-contract.md)

