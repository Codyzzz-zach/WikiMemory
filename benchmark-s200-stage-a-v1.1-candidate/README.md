# WGEMemory S200 · Stage A v1.1-candidate（WorkBuddy 采集批次）完成证明

> 生效合同：`benchmark-s200-workbuddy-contract.md` v1.0 + `benchmark-s200-workbuddy-repair-addendum-v1.md`；
> 服从 `WGEMemory4LLM-Benchmark.html` v3.0。
> 生成时间：2026-08-10（v1.1 修复版，基于 Codex 机器验收 ACCEPT_WITH_REPAIRS_BLOCK_FREEZE 的 5 项阻断错误修复）。
> 生成器：WorkBuddy（资料研究员 + 候选标注员）。本目录为 **v1.1-candidate**，不覆盖首轮 `benchmark-s200-stage-a/`。

## 0. v1.1 修复记录（相对首轮交付）

| # | 验收错误/问题 | v1.1 处理 |
|---|---|---|
| 1 | SWE-bench 同一 arXiv 论文重复登记为三个 Source（canonicalUrl/identity 撞车） | s200-ai-swebench-001 固定为 arXiv v1（canonicalUrl 显式 `/abs/2310.06770v1`，快照取自 v1 摘要页）；s200-ai-swebench-003 固定为 v3（canonicalUrl `/abs/2310.06770v3`，快照为 ar5iv 渲染的 v3 全文摘录）；删除内容子集型 s200-ai-swebench-005；新增 s200-ai-swebench-006（SWE-bench 官方文档 docs/index.md，固定 commit） |
| 2 | S200-EV-004 引用不存在的 s200-tech-gomod-008 | 移除失效引用（T2 保留 gomod-004/007） |
| 3 | S200-EV-005 引用不存在的 s200-tech-k8s-009 | 移除失效引用（T0 保留 k8s-001/006） |
| 4 | S200-EV-007 引用不存在的 s200-fin-fed-007 | 移除失效引用（T0 保留 fed-001/006） |
| 5 | 完成证明陈旧数字（150 份等）+ 题型分布与 JSONL 不一致 | 本 README 全部数字由最终 JSONL 程序化统计生成（见 §1）；题型 F×4/T×13/K×11/C×11/X×8/A×3/U×6/E×4 |
| 6 | 140/140 Snapshot 首行为 curator 撰写的 "Verbatim from…" | 全部移入 Research Notes（`> Curator provenance: …`），Snapshot 区仅保留上游文本；snapshotHash/artifactHash/fileInventory 全量重算 |
| 7 | leakage-scan 报告自身枚举合同禁止字段名 | 报告只写"按合同 denylist 扫描 + denylist sha256"，不展开字段名；公开 payload 与扫描器配置严格区分 |
| 8 | historicalOverlapEvidence 全空、第 4 层仅 cluster-name 碰撞 | 21 新簇 × 9 历史簇语义复核矩阵 `reports/semantic-overlap-review.md`；manifest 每行填充 evidence |
| 9 | 20 份 full 短快照需区分 full-page / targeted-excerpt | `reports/full-snapshot-classification.md`：30 份 <1,000 字符 = full-page 6 + targeted-excerpt 24（banner 移除后短快照数由 20 变为 30） |
| 10 | 3 个域低于"原则上 14..22"（软约束） | 见 §9 deviations；不补源以免破坏簇规模/比例，逐域说明 |

## 1. 数量与覆盖（数字由最终 JSONL 自动生成）

| 项 | 数量 |
|---|---|
| 新增真实 Source Snapshot | **140**（合同目标 150±10 ✓） |
| 历史已有来源（三个 manifest） | 38（Batch A 14 + Batch B 12 + Batch C 12） |
| 合计规模 | **178 ≈ 约 S200** |
| 领域 | 9 个（ai 18 / technology 22 / finance 16 / design-accessibility 16 / health-biology 16 / history-humanities 13 / psychology-reproducibility 13 / climate-energy-policy 12 / law-public-policy 14；均 ≤22 上限，无单域超 25%） |
| 来源簇 | 21 个新簇 + 9 个历史簇 = 30（合同 20–30 ✓，每簇 4–8 份，≥2 角色） |
| 公开题面 | 60 道（合同 48–64 ✓）；中文题面 60 道（100% ≥ 60% ✓）；中文提问-英文证据 54 道（≥20 ✓）；same-language 6 道 |
| Episode | 20 组（合同 12–20 ✓），覆盖 version-change / supersede / correction / dispute / new-evidence / additive |

题型分布：F×4、T×13、K×11、C×11、X×8、A×3、U×6、E×4（与 questions-public.jsonl 逐项一致）。
Graph-native（T/X/K/E 跨源/版本/冲突）36 ≥ 24 ✓；控制题（F/C/A/U 直接事实/条件/不可回答）24 ≥ 20 ✓。

## 2. 目录 hash 算法与结果

- 每份 Source 的 `snapshotHash` = sha256(UTF-8/LF，`## Source Snapshot` 与 `## Research Notes` 之间内容 trim + 末尾 LF)。
- `artifactHash` 口径裁决（repair addendum §artifactHash）：**以 `manifests/source-manifest.jsonl` 中的 `artifactHash` 为权威**（= sha256 完整存储 .md 文件字节）；Source frontmatter **不要求 artifactHash**（避免自引用 hash）。本 README 与 `contract-manifest.json` 均明确该口径。
- 整目录 file hash 清单见 `contract-manifest.json` → `fileInventory`（逐文件 sha256，文件数以清单为准）。

## 3. 与三个历史 manifest 的四层去重

- 层1（normalized URL）、层2（snapshot/artifact hash）、层3（repo+commit/tag、DOI、CELEX、法规编号）、层4（事件簇）全部比对。
- 结果：**140 份新源全部判为 `new-cluster`，无任何一层重叠**（详见 `reports/overlap-denylist-report.md` 与 manifest 中每行的 `historicalOverlapVerdict`）。
- 第 4 层语义复核：`reports/semantic-overlap-review.md` 给出 21 新簇 × 9 历史簇的逐簇证据（为何不是同一公告/论文版本/产品发布/政策事件）；manifest 每行 `historicalOverlapEvidence` 均已填充。
- 允许领域重叠、不允许来源簇重叠；数学材料未通过改标题/翻译/摘录混入。

## 4. full / partial / metadata-only 与访问失败

- full 84（60.0%，≥60% ✓）、partial 55、metadata-only 1（欧委会新闻稿标题级，未用于任何答案证据）。
- full 中 <1,000 字符快照 30 份：**full-page 6 + targeted-excerpt 24**（逐条分类见 `reports/full-snapshot-classification.md`；未机械扩写）。
- 访问失败/受限共 20+ 起，全部记录于 `reports/unresolved-and-access-failures.md` 与 `collection-log.md`（Cloudflare/anti-bot、JS 渲染、网关 502、连接失败；未绕过任何登录/付费墙/robots/验证码）。
- 逐字引文约束：Stage B v1.1 的全部引文程序化取自本目录 corpus 快照文本，并经审计脚本逐字验证（详见密封目录审计）。

## 5. Stage A Gold 字段扫描

`reports/stage-a-leakage-scan.md`：按合同 denylist（Stage B 专用字段名集合，报告仅给出 denylist 的 sha256，不展开字段名）扫描全部 Stage A 数据文件（corpus / manifests / questions / episodes / reports）——**0 命中**。公开数据 payload 与扫描器配置严格区分。

## 6. Stage B v1.1 密封状态

- 目录：`/Users/mixi/Desktop/WikiMemory/benchmark-s200-stage-b-v1.1-sealed/`（与 Stage A v1.1 同级独立目录）。
- 生成时间：2026-08-10（v1.1 同步重建，基于修复后的 Stage A）；状态：**已密封，未交付、未概述、未粘贴任何内容**。
- 整目录 hash（payloadTreeHash，排除密封清单自身）见该目录密封清单——此处**不列出**其文件内容 hash。
- 两阶段**不在同一压缩包**；本批次只交付 `benchmark-s200-stage-a-v1.1-candidate/`（+独立 zip）。

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
14. `s200-ai-swebench-001/003`：SWE-bench 论文 v1 摘要（oracle 4.8%/1.7%）vs v3 正文（oracle 4.8%/1.7% + BM25 1.96%）数字差异——v1.1 已按显式版本化 canonicalUrl 固定。
15. `s200-fin-fed-002/001`：FOMC 声明逐字措辞演化（"has made progress" 等）。
16. `s200-climate-cbam-001`：EUR-Lex 序言/条款的页面代理提取可靠性。
17. `s200-law-chinaai-003`：AI 专门立法状态（预备审议项目）与 2026 年最新进展核对。
18. `s200-health-mpox-005`：卫报报道数字（14,000+/524）与 WHO 原始数据核对。
19. `s200-psych-prereg-002`：Simmons 2011 元数据级快照（无摘要）——不可作为答案证据。
20. `s200-design-apca-004/009`：APCA 作者利益关联文档的归属性标注。

## 8. 请求

只将 **Stage A v1.1-candidate** 交给 Codex 运行；**Stage B v1.1（gold）继续由用户密封保管**，待候选实现冻结后再揭示。任何修复进入新的 post-hoc run，不覆盖首轮。

## 9. Deviations（软约束说明）

- **领域规模**：合同"原则上每域 14–22"，3 个域低于下限——climate-energy-policy 12、history-humanities 13、psychology-reproducibility 13。原因：这些域的历史源与主题容量受限（climate 域中 CBAM/核能两簇合计 10 源 + 2 增量；history 域 hobbit/rosetta 两簇 4–8 源上限约束）；为保持簇规模 4–8、full 比例 ≥60% 与总量 150±10 的硬约束，未强行补源。此为软约束，特此声明，不写"每域全部达标"。
- **full 短快照**：30 份 <1,000 字符的 full 快照分类为 full-page 6 + targeted-excerpt 24（见 §4 与 full-snapshot-classification.md）；60% 门槛同时参考 full 总数（84/140 = 60.0%）。
- **accessStatus=full 口径**：指"采集时可完整定位并保存原文连续内容"；targeted-excerpt 为保守子类，未扩写。

## 目录结构

```text
benchmark-s200-stage-a-v1.1-candidate/
├── README.md                  （本文件）
├── contract-manifest.json     （hash 规范 + 全目录 fileInventory）
├── corpus/<domain>/<sourceId>.md   （140 份快照）
├── manifests/source-manifest.jsonl （140 行，含四层去重 verdict + 语义重叠 evidence）
├── questions/questions-public.jsonl （60 道中性题面）
├── episodes/episodes-public.jsonl   （20 组注入顺序）
└── reports/                   （9 份报告，含 semantic-overlap-review 与 full-snapshot-classification）
```
