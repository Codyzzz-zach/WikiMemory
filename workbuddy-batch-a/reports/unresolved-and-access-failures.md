# Unresolved & Access Failures — WGEMemory Benchmark Seed Batch A（候选）

> 如实记录访问失败、证据不足、版权限制、版本/时间不确定与未决决策。
> 按合同要求"不静默丢弃"——以下均不得在升级为 Gold 前被忽略。

## 1. 访问失败（网络/代理）

| 来源 | 现象 | 影响 | 处置 |
|---|---|---|---|
| `raw.githubusercontent.com` | 直连超时（curl exit 28） | 无法直接拉 MCP 规范原始文件 | 改用 GitHub Contents API（固定 commit + blob sha）✅ 已解决 |
| Reddit JSON API | 代理返回 502 | 无法取得金融社区信号 | 放弃 Reddit，改用 HN 线程 `43714294`；金融 U 来源改为 HN（小样本，已标 partial） |
| The Register | 代理 502/404 | HN NVDA 线程引用的外链文章未冻结 | 不纳入证据，仅记录 |
| Axios / CNBC | 代理拦截 | 金融二手源备选不可用 | 金融 S 改用 21 财经中文分析 |

## 2. 版权限制（重要）

- **fin-nvda-21jingji-003（S）**：受版权保护，仅保存**短证据片段**（约 7 条，合计数百字符）于 Source Snapshot，未再分发全文。
  - 风险：其"地缘供应缺口 / 国产替代"框架为二手解读，不得当作官方财务事实；R-FIN-002、X-FIN-002、K-FIN-001、U-FIN-002 引用时均已标注"版权受限二手片段"。
  - 建议 Codex 审核时：仅依据片段验证，不假设未抓取全文内容。

## 3. 证据 / 版本 / 时间不确定

1. **MCP 2025-03-26 正式规范文本未冻结**（EV-AI-001、REL-AI-001、X-AI-001 等）：仅以 PR #206 为据。PR 中"Streamable HTTP 支持 GET/DELETE""无状态服务器"等措辞为 PR 口径，正式规范逐字未抓取。
   - 处置：相关 claim 的 `uncertainties` 已注明；若升级为 Gold，需补冻结 2025-03-26 规范正文。
2. **NVIDIA Q3 FY2026 H20 指引未知**（A-FIN-001、E-FIN-002）：材料仅含 Q3 总量指引 $54B（±2%），未单列 H20；未来 H20 销售为 insufficient。
3. **OpenAI / Google MCP 官方公告未冻结**（REL-AI-002、R-AI-003、K-AI-001）：仅由 latent 注记（S）记载日期，无官方原文。
4. **Redis 8 商业许可并存条款**：AGPLv3 之外 Redis 仍提供商业许可，精确条款需查官方许可文本（EV-TECH-001 `uncertainties`）。
5. **财务数字边界**：Q1 的 `$4.5B 费用` / `$4.6B 管制前销售` / `$2.5B 未能发货` 三者易混，已在 C-FIN-002、F-FIN-004、X-FIN-001 显式区分。

## 4. Partial / 仅 metadata 材料

- **ai-mcp-latent-003（S, partial）**：二手叙事文章，含主观时间线判断；非官方来源。
- **ai-mcp-hn-004（U, partial）**：MCP 发布线程，社区观点/体验，非规范事实。
- **tech-redis-hn-004（U, partial）**：Redis 许可社区反应，含 mmaunder 对 AGPL 的商业解读（观点）。
- **fin-nvda-hn-004（U, partial）**：仅 15 分、约 11 条评论的小线程，**代表性不足**；RISK-FIN-008 已标注。
- 注：fin-nvda-21jingji-003 的 `accessStatus=full`（已完整抓取页面），但其**内容**受版权限制，属独立风险，见第 2 节。

## 5. 未决决策（需人工/Codex 拍板）

1. **U 任务数量冲突**：合同"候选测试题"分布表列 U=4，但"真实用户任务候选"要求每域 2 个（=6）。本批按更具体的"每域 2 个"生成 U=6，总题 62。是否回退到 U=4 由审核方决定。
2. **关系数量（19）低于"每材料 2–4"字面下限**：关系为跨材料演化图，已保证连通且无孤立节点；是否补充域内关系以提升密度待定。
3. **部分题目的 `answerability=partial`**（C-TECH-002、R-FIN-002、E-TECH-002、E-FIN-002、A-AI-002）：因来源片段/版本未冻结导致只能部分作答，升级 Gold 前需补齐来源或改标。
4. **金融 U 来源仅 HN（小样本）**：若需更稳健的社区信号，建议补充其他社区/论坛来源。

## 6. 潜在重复 / 泄漏来源簇

- 同知识网络多材料成簇（MCP 规范+PR；Redis 2024+2025；NVDA Q1+Q2）属预期演化设计，split 建议已按领域隔离（AI/金融=dev，科技=test）。
- 社区(U)与官方(P/C)报道同一事件时，已在命题层通过 `sourcePriorityRule` 强制区分，不视为泄漏，但审核时建议抽查 K/X 题的证据归属是否一致。
