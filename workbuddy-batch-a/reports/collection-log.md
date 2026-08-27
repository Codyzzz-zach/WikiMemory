# Collection Log — WGEMemory Benchmark Seed Batch A（候选）

> 记录执行过程、检索/冻结方法、所用工具与模型、失败与绕过、自检结果。
> 所有候选产物均为 `status: candidate`。

## 1. 执行时间线

- 抓取与冻结：`capturedAt = 2026-07-27T06:36:50Z`（统一记录于每份材料 frontmatter 与 manifest）。
- 候选生成：事实/关系、测试题、演化事件分批由脚本生成（见第 4 节），均通过逐字校验。
- 本报告生成：同会话内，晚于上述步骤。

## 2. 每材料检索与冻结方法

| sourceId | 获取途径 | 冻结锚点 |
|---|---|---|
| ai-mcp-spec-2024-11-05-001 | GitHub Contents API（`api.github.com/repos/modelcontextprotocol/modelcontextprotocol/contents/...`，base64 解码） | repo commit `7634684382c3d14cf7e9f14073fe40a2d8ace3fa`，file blob `14dd7e59...` |
| ai-mcp-pr206-002 | GitHub PR 元数据 + BODY（API/网页） | PR #206，Merged `2025-03-24T11:51:34Z` |
| ai-mcp-latent-003 | 网页抓取（latent.mcp 或镜像） | 文首更新注记（OpenAI 3/27、Google 4/9） |
| ai-mcp-hn-004 | HN Algolia API（`hn.algolia.com`） | 线程 item `42237424`，发布 2024-11-25 |
| tech-redis-blog-2024-001 | redis.io/blog 网页抓取 + bs4 抽取 | 发布 2024-03-20 |
| tech-redis-blog-2025-002 | redis.io/blog 网页抓取 + bs4 抽取 | 发布 2025-05-01（Redis 8 / AGPLv3） |
| tech-redis-antirez-003 | antirez 博客网页抓取 | 发布 2025-05-01 |
| tech-redis-hn-004 | HN Algolia API | 线程 item `43859446`，发布 2025-05-01 |
| fin-nvda-q1fy26-001 | NVIDIA 投资者关系新闻稿网页抓取 + bs4 | 发布 2025-05-28，财季截至 2025-04-27 |
| fin-nvda-q2fy26-002 | NVIDIA 投资者关系新闻稿网页抓取 + bs4 | 发布 2025-08-27，财季截至 2025-07-27 |
| fin-nvda-21jingji-003 | m.21jingji.com 网页抓取 + bs4（**仅存短证据片段**） | 发布 2025-04-16，版权受限 |
| fin-nvda-hn-004 | HN Algolia API | 线程 item `43714294`，发布 2025-04-17 |

## 3. 冻结原则落实

- **GitHub**：固定 commit / blob sha，写进 `versionRef` 与 `contentHash`。
- **网页**：记录 `publishedAt` + `capturedAt` + `contentHash = sha256(Source Snapshot 文本)`。
- **视频/社区**：本批无视频；社区（HN）保留 item id、发布时间、评论上下文。
- **contentHash 全覆盖**：12/12 材料均有 `contentHash` ✅。

## 4. 自动化工具与模型

- 运行时：托管 Python 3.13.12，隔离 venv `/Users/mixi/.workbuddy/binaries/python/envs/default`。
- 抽取库：beautifulsoup4 4.15.0 + lxml。
- 生成脚本（位于工作目录 `/tmp/batch-a-raw/`，非交付物）：
  - `build_corpus.py`：由原始抓取生成 12 份 `.md` 材料 + `source-manifest.jsonl`。
  - `gen_candidates.py`：生成 `facts.jsonl` + `relations.jsonl`；内置 `_extract_verbatim()` 做逐字断言（容忍 nbsp/破折号/换行/Markdown 标记差异，但**存储的 exactQuote 为源文件逐字片段**）。
  - `gen_tasks.py`：生成 `tasks.jsonl`；证据 exactQuote 复用 `facts.jsonl` 逐字引用，保证可回查。
  - `gen_episodes.py`：生成 `evolution-episodes.jsonl`；时序证据复用事实逐字引用。
- 模型角色：本批"测试资料研究员/候选标注员"由 WorkBuddy（对话模型）执行检索、撰写 claims、构建考题与证据；所有模型生成内容标记 `status: candidate`，**未伪装**为 Gold/verified/human-reviewed。

## 5. 访问失败与绕过

| 失败 | 处理 |
|---|---|
| `raw.githubusercontent.com` 直连超时（exit 28） | 改用 GitHub Contents API（base64 解码）获取 MCP 规范，固定 commit。 |
| Reddit JSON API 返回 502 | 放弃 Reddit 作为金融 U 来源，改用 HN 线程 `43714294`。 |
| The Register / Axios / CNBC 被代理拦截（502/404） | 金融 S 角色改用 21 财经中文长篇分析（m.21jingji.com，成功抓取）。 |
| HN 链接的 The Register 文章未冻结 | 记入 `unresolved-and-access-failures.md`，不作为证据。 |

## 6. 正文抽取问题与修正

- NVIDIA / antirez 正文初抽为空或极短（选择器不适配新闻稿结构）→ 改用 `.article-body/#main-content/main` 并先 `decompose(script/style)`；antirez 正文在 `<pre>` 内，单独处理。
- 21 财经初抽仅 2893 字符（"加载全文"前内容）→ 改用全文 `get_text` 重抽得完整正文（约 2731 字符关键段）。
- 逐字校验中暴露若干**不可见字符差异**（non-breaking space、en/em dash、Markdown `**`/`` ` ``）：`gen_candidates.py` / `gen_tasks.py` 的 `_extract_verbatim()` 在容忍差异的同时**存储源文件逐字片段**，最终由独立脚本复核 0 处失败（见第 7 节）。

## 7. 自检结果（完成前核对）

1. **12 个 sourceId 唯一**，manifest 与 `corpus/inbox/*/*.md` 一一对应 ✅。
2. **所有 exactQuote 逐字可回查**：facts 84 条、relations 19 条证据、tasks 62 条证据、episodes 3 条时序证据，独立脚本复核 **0 处失败** ✅。
3. **URL/作者/时间/版本字段**：manifest 均有值或显式 `unknown/null`（本批均填值）✅。
4. **无伪装**：未将搜索摘要 / Research Notes / 模型常识当作原文；Research Notes 与 Source Snapshot 分节隔离 ✅。
5. **无越权/再分发**：21jingji 仅存短片段，未公开复制全文 ✅。
6. **约 60 题分布合理**：62 题，X+K+T+E=26 ≥ 20 ✅。
7. **全 candidate**：facts/relations/tasks/episodes 全部 `status: candidate` ✅。
8. **失败/缺失/不确定已写入报告**：见 `unresolved-and-access-failures.md` ✅。
