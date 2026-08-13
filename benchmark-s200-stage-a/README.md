# WGEMemory S200 · Stage A（WorkBuddy 采集批次）完成证明

> 生效合同：`benchmark-s200-workbuddy-contract.md` v1.0；服从 `WGEMemory4LLM-Benchmark.html` v3.0。
> 生成时间：2026-08-10；生成器：WorkBuddy（资料研究员 + 候选标注员）。

## 1. 数量与覆盖

| 项 | 数量 |
|---|---|
| 新增真实 Source Snapshot | **140**（合同目标 150±10 ✓） |
| 历史已有来源（三个 manifest） | 38（Batch A 14 + Batch B 12 + Batch C 12） |
| 合计规模 | **178 ≈ 约 S200** |
| 领域 | 9 个（每域 12–18 份，全部 ≤22 上限，无单域超 25%） |
| 来源簇 | 21 个新簇 + 9 个历史簇 = 30（合同 20–30 ✓，每簇 4–8 份，≥2 角色） |
| 公开题面 | 60 道（合同 48–64 ✓）；中文题面 55 道（91.7% ≥ 60% ✓）；中文提问-英文证据 51 道（≥20 ✓） |
| Episode | 20 组（合同 12–20 ✓），覆盖 version-change / supersede / correction / dispute / new-evidence / additive |

题型分布：F×4、C×10、X×9、K×10、T×13、E×4、A×3、U×6。Graph-native（T/X/K/E 跨源/版本/冲突）≈ 36 ≥ 24 ✓；控制题（F/C/A/U 直接事实/条件/不可回答）≈ 23 ≥ 20 ✓。

## 2. 目录 hash 算法与结果

- 每份 Source 的 `snapshotHash` = sha256(UTF-8/LF，`## Source Snapshot` 与 `## Research Notes` 之间内容 trim + 末尾 LF)。
- `artifactHash` = sha256(完整存储 .md 文件字节，UTF-8/LF)——写入 `manifests/source-manifest.jsonl`（文件内不嵌入，沿用 batch A 约定）。
- 整目录 file hash 清单见 `contract-manifest.json` → `fileInventory`（160 个文件，逐文件 sha256）。

## 3. 与三个历史 manifest 的四层去重

- 层1（normalized URL）、层2（snapshot/artifact hash）、层3（repo+commit/tag、DOI、CELEX、法规编号）、层4（事件簇）全部比对。
- 结果：**150 份新源全部判为 `new-cluster`，无任何一层重叠**（详见 `reports/overlap-denylist-report.md` 与 manifest 中每行的 `historicalOverlapVerdict`）。
- 允许领域重叠、不允许来源簇重叠；数学材料未通过改标题/翻译/摘录混入。

## 4. full / partial / metadata-only 与访问失败

- full 84（60.0%，≥60% ✓）、partial 55、metadata-only 1（欧委会新闻稿标题级，未用于任何答案证据）。
- 访问失败/受限共 20+ 起，全部记录于 `reports/unresolved-and-access-failures.md` 与 `collection-log.md`（Cloudflare/anti-bot、JS 渲染、网关 502、连接失败；未绕过任何登录/付费墙/robots/验证码）。
- 逐字引文约束：Stage B 的全部引文程序化取自本目录 corpus 快照文本，并经审计脚本逐字验证（详见密封目录审计）。

## 5. Stage A Gold 字段扫描

`reports/stage-a-leakage-scan.md`：对全部 Stage A 数据文件（corpus / manifests / questions / episodes / reports）扫描合同 §6.3 与 §7.1 定义的全部 Gold-only 字段名（答案要点、证据引文、禁止断言、期望路径、期望受影响对象等）——**0 命中**（本 README 不枚举字段名，详见扫描报告）。

## 6. Stage B 密封状态

- 目录：`/Users/mixi/Desktop/WikiMemory/benchmark-s200-stage-b-sealed/`（与 Stage A 为同级独立目录）。
- 生成时间：2026-08-10（先于本次 Stage A 交付）；状态：**已密封，未交付、未概述、未粘贴任何内容**。
- 整目录 hash（payloadTreeHash，排除 seal清单.json 自身）见该目录 `密封清单`（文件名，含字段名于密封目录内）——此处**不列出**其文件内容 hash。
- 两阶段**不在同一压缩包**；本批次只交付 `benchmark-s200-stage-a/`。

## 7. 最需 Codex / 人工复核的 20 个高风险项目

1. `s200-psych-nudge-002`：Mertens 摘要两版本数字（440/450 效应量、d=0.43/0.45）——确认 PNAS 更正状态。
2. `s200-psych-nudge-001`：Maier 结论句（severe publication bias / no evidence remains）引用边界。
3. `s200-tech-k8s-005`：k8s.guru "Ethereal Elephants" 与官方 "Elli" 冲突——确认第三方博客是否为内容农场。
4. `s200-fin-asml-006`：Counterpoint "China 41%" 与 20-F "36.1%" 口径差异。
5. `s200-fin-asml-003`：FY2025 20-F 引文换行分词伪影的恢复处理。
6. `s200-hist-rosetta-002`：Budge 1913 "August 1799" vs 现代 "15 July 1799" 日期冲突。
7. `s200-health-hpv-003`：中文解读（医学新视点）数字与官方建议的一致性。
8. `s200-health-sugar-002`：<10% 强推荐 vs <5% 条件推荐的媒体转述风险。
9. `s200-law-dma-006`：罚款上限 10%/20% 口径（环球时报 vs Kaamel）。
10. `s200-ai-pytorch-005`：PyImageSearch 二手教程的官方数字转述忠实性。
11. `s200-ai-llama-007`：geekdaxue 镜像站时间戳（2025-01-03）与内容（2024-07 发布）错位。
12. `s200-tech-gomod-005`：rsc 设计随笔 "eliminate vendoring" 与最终实现不一致。
13. `s200-hist-hobbit-006`：史密森尼页面内部年代不一致（100–50 ka vs 100–60 ka）。
14. `s200-ai-swebench-001/003`：SWE-bench 论文 v1/v3 数字差异（1.96% vs 4.8%/1.7%）。
15. `s200-fin-fed-002/001`：FOMC 声明逐字措辞演化（"has made progress" 等）。
16. `s200-climate-cbam-001`：EUR-Lex 序言/条款的页面代理提取可靠性。
17. `s200-law-chinaai-003`：AI 专门立法状态（预备审议项目）与 2026 年最新进展核对。
18. `s200-health-mpox-005`：卫报报道数字（14,000+/524）与 WHO 原始数据核对。
19. `s200-psych-prereg-002`：Simmons 2011 元数据级快照（无摘要）——不可作为答案证据。
20. `s200-design-apca-004/009`：APCA 作者利益关联文档的归属性标注。

## 8. 请求

只将 **Stage A** 交给 Codex 运行；**Stage B（gold）继续由用户密封保管**，待候选实现冻结后再揭示。任何修复进入新的 post-hoc run，不覆盖首轮。

## 目录结构

```text
benchmark-s200-stage-a/
├── README.md                  （本文件）
├── contract-manifest.json     （hash 规范 + 全目录 fileInventory）
├── corpus/<domain>/<sourceId>.md   （150 份快照）
├── manifests/source-manifest.jsonl （150 行，含四层去重 verdict）
├── questions/questions-public.jsonl （60 道中性题面）
├── episodes/episodes-public.jsonl   （20 组注入顺序）
└── reports/                   （7 份报告）
```
