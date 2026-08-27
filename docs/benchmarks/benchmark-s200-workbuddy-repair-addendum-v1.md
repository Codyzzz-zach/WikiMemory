# WGEMemory S200 · WorkBuddy 交付修复附录 v1

> 本附录是 `benchmark-s200-workbuddy-contract.md` 的验收修复指令。只修复已经发现的交付完整性问题，不改变题目难度，不读取或泄漏 Stage B 内容。

## 给 WorkBuddy 的可直接执行 Prompt

```text
你交付的 S200 Stage A 已由 Codex 独立机器复核。当前裁决是：

ACCEPT_WITH_REPAIRS_BLOCK_FREEZE

在完成以下修复前，不得声明 Stage A 可冻结，也不得覆盖原目录。请以现有目录为输入，新建：

- benchmark-s200-stage-a-v1.1-candidate/
- benchmark-s200-stage-b-v1.1-sealed/
- benchmark-s200-stage-a-v1.1-candidate.zip

不得修改或删除原始 benchmark-s200-stage-a/、benchmark-s200-stage-a.zip、benchmark-s200-stage-b-sealed/。不得向 Codex 或公开输出 Stage B 的文件内容、Gold 字段值、答案、证据引文或文件清单。

必须修复的 5 个阻断错误：

1. 同一来源被重复计数：
   - s200-ai-swebench-003 与 s200-ai-swebench-005 canonical URL 完全相同；
   - s200-ai-swebench-001 / 003 / 005 实际都指向 arXiv:2310.06770。
   - 不得用“摘要页 / HTML 镜像 / 同页另一段摘录”伪装成三个 Source。
   - 推荐修法：把 v1 与 v3 做成两个真正固定版本的来源，canonicalUrl 必须显式带 v1 / v3，Snapshot 必须分别来自对应版本；删除内容子集型重复项；再补一份真正独立的 SWE-bench 官方来源（例如固定 commit 的 Verified 数据集卡或官方技术报告），使总 Source 数仍在 140..160、该簇仍为 4..8 且至少两种角色。

2. S200-EV-004 引用了不存在的 s200-tech-gomod-008。
3. S200-EV-005 引用了不存在的 s200-tech-k8s-009。
4. S200-EV-007 引用了不存在的 s200-fin-fed-007。
   - 对 2–4：恢复真实 Source 或删除失效引用均可，但不得编造占位 Source；修复后每个 timeline timepoint 不得为空，Stage A / Stage B 中所有 sourceId、caseId、episodeId 必须可解析。

5. 完成证明存在陈旧数字：README 仍出现 150 份、160 个文件等旧数据；题型、中文题面、跨语言题数也与 JSONL 实际值不一致。
   - 所有摘要数字必须从最终 JSONL 自动生成，不得手写。

必须同步修复的证据边界：

6. 140/140 个 Source Snapshot 的第一行都是研究员写的“Verbatim from ...”说明。它不是上游原文，不得位于 Source Snapshot 内。
   - 将这行移到 frontmatter 或 Research Notes；重新计算 snapshotHash、artifactHash、fileInventory、目录 hash；重新执行 Stage B exactQuote 校验。

7. reports/stage-a-leakage-scan.md 自己枚举了合同禁止的 Gold 字段名，却声称“全部 Stage A 0 命中”。
   - 报告只写“按合同 denylist 扫描”及 denylist 的 sha256，不得枚举字段名；扫描范围和排除规则必须明确区分“公开数据 payload”与“扫描器配置”。

8. historicalOverlapEvidence 140 行全部为空，现有四层去重报告的第 4 层实际只做了 cluster-name collision，不能证明 event/topic cluster 无重叠。
   - 新增 21 个新簇对 9 个历史簇的人工/模型复核矩阵；每个新簇至少给出“为什么不是同一公告、论文版本、产品发布、政策事件或同一主题资产”的简短证据。领域相同不是重叠，事件相同也不能靠改 clusterId 变成新簇。

artifactHash 口径裁决：

- artifactHash = 完整文件字节的 sha256 时，不能把该 hash 同时嵌入被哈希文件自身，否则形成自引用，不存在一般可计算的稳定值。
- 因此 v1.1 继续以 source-manifest.jsonl 中的 artifactHash 为权威；Source frontmatter 不要求 artifactHash。
- contract-manifest.json 必须明确这一点。不要为了满足旧示例把 artifactHash 写回 Source 文件。

非阻断但必须报告：

- accessStatus=full 中有 20 份 Snapshot 少于 1,000 字符。不要机械扩写；逐条确认它们是“上游页面本身很短”还是“只截了目标段落”。完成证明分别报告 full-page 与 targeted-excerpt 数，不能只靠 accessStatus=full 达成 60%。
- climate-energy-policy=12、history-humanities=13、psychology-reproducibility=13，低于合同“原则上 14..22”，但这是软约束；如不补源，必须在 deviations 中说明，而不是写“每域全部达标”。

Stage B 必须在密封状态下同步重建并复核：

- Stage A 的所有 caseId / sourceId / episodeId 与 Stage B 双向可解析；
- exactQuote 全部逐字存在于修复后的 Source Snapshot；
- metadata-only 不得成为答案证据；
- Relation / expected path 的端点全部存在；
- expected affected / unaffected 均存在且依据可解析；
- 独立复核不得读取生成器 reasoning；
- 只向 Codex报告计数、错误数、payloadTreeHash 和 agreed/disputed 汇总，不得泄漏具体 Gold。

最终必须运行：

npm run benchmark:s200:validate-stage-a -- benchmark-s200-stage-a-v1.1-candidate experiments/goal3/s200-stage-a-v1.1-workbuddy-validation.json

只有该命令退出码为 0，才可重新生成 zip 和完成证明。若验证器仍报错，继续修复，不要交付计划或辩解。

交付时只给：

1. v1.1 Stage A 目录与独立 zip；
2. Stage A treeHash、zip sha256、文件数、Source/Question/Episode/Cluster 数；
3. 验证器 0 error 的报告路径和 hash；
4. Stage B v1.1 已密封的 payloadTreeHash、计数与完整性错误数 0；
5. 明确请求 Codex 只读取 v1.1 Stage A。
```

## Codex 当前机器复核证据

- 报告：`experiments/goal3/s200-stage-a-intake-validation-v1.json`
- 状态：`ACCEPT_WITH_REPAIRS_BLOCK_FREEZE`
- Stage B：未读取
- 当前 Stage A treeHash：`sha256:8c207d0483f2ab7765352648c75c192764064ffc29e81d4703d9ea7d6506bbd2`
- 当前 zip sha256：`ff5d07146f92a52a7a0e1708ef714bf60bfe1aec9f1367139648b0ab3b2e2dff`
