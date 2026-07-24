# Product Pilot 工作区

分支：`product-pilot`
基线：WGEMemory4LLM Demo v0.1.0，commit `a71a2ee`

## 本阶段唯一主目标

验证或否证第一条产品价值假设：

> 在相同回答模型、相同在线上下文预算和相同原始语料下，Agent 使用冻结的 WGEMemory 知识快照，是否比直接搜索 Markdown 文件，在跨材料、条件和证据任务上表现更好，同时不增加无依据断言。

本阶段不再以“多编译一篇文章”“Claim/Relation 数量增长”或“单次 E2E 跑通”作为成功标准。

## 实验对象

### B · Folder Search

- 访问原始 Markdown。
- Agent 在固定工具次数和时间内自主搜索。
- 代表最现实、最低复杂度的基线。

### P · ClaimGraph Prototype

- 使用当前 Claim + Typed Graph + Evidence Context Pack。
- 用于判断现有技术薄切片是否已经产生任务增益。
- 不能在报告中冒充完整 WGEMemory 产品。

### E-min · Minimal Product Slice

- WikiModule + Typed Graph + Evidence。
- 至少包含两个围绕稳定问题组织、能被多篇材料共同更新的 WikiModule。
- 用于判断 Wiki 语义组织叠加 Graph 后是否优于 B / P。

可选信息上限组 A 使用完整原文，但不与 B/P/E-min 混报成本公平结论。

## 实施顺序

### G2.0 · 冻结与 publication diff 门禁

- 固定 Source hash、代码版本、prompt hash、模型、temperature、预算和知识版本。
- 重编先形成候选快照，不直接覆盖当前 canonical publication。
- 输出 Claim、Condition、Relation、Concept 和 Canonical/Quarantine 迁移 diff。
- diff 未通过门禁时，Demo publication 保持不变。

### G2.1 · 五篇受控语料

固定材料：

1. `01-number-systems.md`
2. `02-spaces.md`
3. `03-sequences-limits.md`
4. `05-functions-mappings.md`
5. `09-functional-analysis.md`

05 / 09 只在 G2.0 门禁存在后编译。不得恢复逐篇试错式重编。

### G2.2 · 统一回答运行器

同一个运行器必须支持 B / P / E-min：

- 相同回答模型和 model snapshot
- 相同 system prompt 与答案 schema
- 相同 max output
- 相同最终上下文预算；Pilot 初始值 12k tokens
- 相同工具调用次数和总时间
- 主实验网络关闭
- 保存完整输入、输出、token、延迟、工具调用和错误
- 输出匿名化后才进入评分

### G2.3 · 16 道 Dev/Pilot Gold

从现有 Benchmark 选择并人工冻结：

- 4 道单文档直接题
- 5 道两跳跨材料题
- 3 道三跳题
- 3 道条件/反例题
- 1 道不可回答或证据不足题

每道题至少定义：

```json
{
  "question": "...",
  "requiredClaims": [],
  "requiredSources": [],
  "expectedPath": [],
  "mustMentionConditions": [],
  "forbiddenClaims": [],
  "answerability": "answerable | insufficient"
}
```

Gold、预期路径和 forbiddenClaims 不得进入 Source、编译 prompt、Graph、embedding 或 cache。

### G2.4 · Pilot 运行与归因

分别报告：

- Compilation：关键 Claim 覆盖、条件保真、Relation precision
- Retrieval：Required Claim Recall、Path Completeness、无关上下文比例
- Answer：Task Utility 六维评分与盲选偏好
- Safety：无依据断言、条件绝对化、冲突压平、不可回答题编造
- Cost：线上 tokens、延迟、工具调用；编译成本与回答成本分开
- Stability：固定配置下的 run-to-run variance

Pilot 只校准基础设施和判断方向，不用于宣称统计显著。

## 阶段出口

- **P 优于 B：**现有 ClaimGraph 已有价值，继续验证 Wiki 的增量。
- **P 不优于 B、E-min 优于 B：**价值主要来自 Wiki 语义组织，Graph 重新定位。
- **E-min 只在部分题类提升：**收窄产品承诺与目标场景。
- **E-min 不优于 B：**停止扩大到 20 篇，定位编译损失、检索遗漏或上下文噪音。
- **硬失败增加：**停止效果扩展，优先修知识治理。

只有 Pilot 基础设施稳定且方向成立，才进入 20 篇 / 80 题确认实验。纠错复发与 30 天真实学习属于后续 Gate 4 / Gate 5，不在本阶段冒充已验证能力。

## 施工纪律

- Demo 基线只在 `/Users/mixi/Desktop/WikiMemory` 的 `master` 保留，不在该目录继续实验。
- 本工作区所有变化留在 `product-pilot` 分支。
- 每个实验报告必须绑定 commit、corpus hash、knowledgeVersion、model、prompt hash 和预算。
- 代码实现与产品结论分开报告：implemented、unit-tested、real-data-validated、product-validated 不混写。
