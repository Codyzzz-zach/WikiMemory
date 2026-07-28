# WGEMemory Benchmark Seed — Batch A（候选交付）

> **状态：全部为 `status: candidate`，非 Gold / verified / human-reviewed。**
> 本文件夹将提交给 Codex 审核（原文、manifest、exactQuote、关系、题目、演化事件），
> 由其决定哪些升级为正式 Gold。任何模型生成内容均未伪装成人工核验。

## 1. 交付清单

```
workbuddy-batch-a/
├── README.md
├── corpus/inbox/
│   ├── ai/          (4 份 .md: spec / PR206 / latent / HN)
│   ├── technology/  (4 份 .md: redis2024 / redis2025 / antirez / HN)
│   └── finance/     (4 份 .md: nvda-q1 / nvda-q2 / 21jingji / HN)
├── manifests/source-manifest.jsonl      (12 条，含 sourceRole/contentHash/versionRef)
├── candidates/facts.jsonl               (84 条，含 24 风险项)
├── candidates/relations.jsonl           (19 条)
├── candidates/tasks.jsonl               (62 题)
├── candidates/evolution-episodes.jsonl (3 组，每域 1)
├── reports/coverage-matrix.md
├── reports/collection-log.md
└── reports/unresolved-and-access-failures.md
```

## 2. 实际收集数量与分布

- **材料**：12 份（AI / 科技 / 金融 各 4）。来源角色：P×3、C×1、C/P×2、S×3、U×3。
  - 每域均覆盖 P、C/P、S、U（满足"至少 3 种来源角色"）。
- **候选事实**：84 条（每材料 7，区间 5–8 ✅），其中 **24 条风险项**（每材料 2）。
- **关系**：19 条（SUPERSEDES / CONTRADICTS / SUPPORTS / REQUIRES / REPORTS_EXPERIENCE / NARROWS），构成 T0→T1 演化图，无孤立节点。
- **候选题**：62 题，分布 F12 / R8 / X8 / C6 / K6 / T6 / E6 / A4 / **U6**（U 取每域 2）。
  - 跨来源/冲突/时间/演化合计 X+K+T+E = **26** ≥ 20。
- **演化事件**：3 组（EV-AI-001 / EV-TECH-001 / EV-FIN-001），每域 1。

## 3. 缺失项与原因

本批无"材料缺失"（12/12 齐全），但存在**证据/版本级缺口**，需在 Gold 化前补齐：

| 缺失 | 原因 | 影响 |
|---|---|---|
| MCP 2025-03-26 正式规范正文 | 代理/抓取未冻结，仅 PR #206 | EV-AI-001 / REL-AI-001 等以 PR 为据 |
| OpenAI / Google MCP 官方公告 | 未冻结，仅 latent 注记（S）记载日期 | REL-AI-002 / K-AI-001 证据为二手 |
| HN NVDA 线程引用的 The Register 文章 | 代理 502 | 未纳入证据 |
| Reddit 金融社区信号 | 代理 502 | 金融 U 改为 HN（小样本） |
| NVIDIA Q3 FY2026 H20 指引 | 材料未含（未来） | A-FIN-001 标 insufficient |

## 4. 仅 partial / metadata 的内容

- **ai-mcp-latent-003（S, partial）**：二手叙事，含主观时间线判断。
- **ai-mcp-hn-004（U, partial）**：MCP 发布社区反应，观点/体验非规范。
- **tech-redis-hn-004（U, partial）**：Redis 许可社区反应，含 mmaunder 对 AGPL 的商业解读（观点）。
- **fin-nvda-hn-004（U, partial）**：仅 15 分、约 11 条评论，**代表性不足**。
- **fin-nvda-21jingji-003（S, full 抓取但版权受限）**：仅保存短证据片段，未再分发全文。

## 5. 候选题型数量

| 题型 | F | R | X | C | K | T | E | A | U | 合计 |
|---|---|---|---|---|---|---|---|---|---|---|
| 数量 | 12 | 8 | 8 | 6 | 6 | 6 | 6 | 4 | 6 | **62** |

## 6. 可能重复 / 泄漏来源簇

- **同知识网络多材料成簇**（MCP 规范+PR；Redis 2024+2025；NVDA Q1+Q2）属预期演化设计。split 建议按领域隔离：AI/金融=`dev`，科技=`test`，降低同簇泄漏。
- **社区(U)与官方(P/C)报道同事件**：命题已用 `sourcePriorityRule` 强制区分"观点/体验" vs "规范事实"，但建议 Codex 抽查 K/X 题的证据归属一致性。
- **无跨批重复来源**（所有 sourceId 唯一）。

## 7. 最值得 Codex 优先审核的 10 个高风险候选

1. **fin-nvda-21jingji-003**（S，版权受限）：仅短片段，须确认无"超读"为全文结论。
2. **EV-AI-001 / REL-AI-001**：2025-03-26 正式规范未冻结，PR 口径 claim 需对照正式文本确认。
3. **REL-AI-002 / K-AI-001**：melvinmelih "DOA" 为条件预言，前提（OpenAI 转向别的标准）已被证伪——逻辑易误读为"预测失败"。
4. **RISK-FIN-003 / F-FIN-003 / C-FIN-001**："`对中国大陆`零 H20 销售" vs "对中国以外 $650M" 的主体范围陷阱，最易被简化为"Q2 H20 归零"。
5. **ai-mcp-latent-003**（S）：二手叙事；OpenAI/Google 官方公告缺失，时间序列仅二手记载。
6. **ai-mcp-hn-004 / tech-redis-hn-004 / fin-nvda-hn-004**（U）：社区观点非事实；fin-nvda-hn-004 仅 15 分，不得概括社区整体。
7. **C-TECH-001 / RISK-TECH-001**："`云服务商`需商业协议"的主体限定极易丢失，误扩到所有使用方。
8. **FACT-FIN-003 / FACT-FIN-004**：Q1 的 `$4.5B 费用` / `$4.6B 管制前销售` / `$2.5B 未能发货` 三者需严格区分。
9. **REL-TECH-007 / K-TECH-001**：mmaunder "AGPL 致 IP 感染风险、被迫买商业许可"是 U 观点，须保持其来源归属，不得当官方动机。
10. **全部 U 任务（U-AI/Tech/Fin ×2）**：研究员提出的候选，须明确"非用户偏好"，并核对风险边界是否可证。

## 8. 自动化工具、模型与抓取日期

- **运行时**：托管 Python 3.13.12，隔离 venv `/Users/mixi/.workbuddy/binaries/python/envs/default`。
- **抽取库**：beautifulsoup4 4.15.0 + lxml。
- **生成脚本**（工作目录 `/tmp/batch-a-raw/`，非交付物）：`build_corpus.py`、`gen_candidates.py`、`gen_tasks.py`、`gen_episodes.py`；逐字校验内置 `_extract_verbatim()`（容忍 nbsp/破折号/换行/Markdown 标记，存储源文件逐字片段）。
- **模型角色**：WorkBuddy（对话模型）担任"测试资料研究员/候选标注员"，执行检索、claims 撰写、题库与证据构建；全部标记 `status: candidate`。
- **抓取日期（capturedAt）**：`2026-07-27T06:36:50Z`（统一记录）。
- **源获取途径**：GitHub Contents API（MCP 规范，固定 commit）、NVIDIA 投资者关系新闻稿、redis.io/blog、antirez 博客、m.21jingji.com、HN Algolia API。
