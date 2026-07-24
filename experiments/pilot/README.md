# 五篇材料产品 Pilot

本目录承载下一阶段的最小产品效果实验，不再把“多编译一篇材料”当作成功标准。

主问题是：在同一个回答模型、同一份五篇原始语料和相同在线上下文预算下，WGEMemory 的编译知识是否比直接检索 Markdown 更能帮助 Agent 回答跨材料、条件和证据问题。

## 三个实验组

- `B`：对五篇 Markdown 做确定性词法检索，回填原文块。
- `P`：使用当前 Claim、Typed Relation 和 Evidence Context Pack，不使用 WikiModule。
- `E-min`：在 P 的基础上加入至少两个围绕稳定问题组织的 WikiModule。

当前 B 是一次确定性文件检索基线，不冒充“自主多轮搜索 Agent”。如果方向性 Pilot 成立，再把 B 升级为相同工具调用上限的 agentic folder search 做敏感性验证。

## 冻结边界

- [config.json](./config.json) 锁定五篇语料、请求模型、temperature、上下文预算、输出预算和实验组。
- [questions.json](./questions.json) 是 16 题候选 Gold。只有产品负责人逐题确认后，才能把状态从 `PROPOSED_FOR_HUMAN_FREEZE` 改成 `FROZEN`。
- Gold 字段不进入 Source、Claim、Graph、Context Pack、检索索引或回答 prompt。
- `snapshot-manifest.json` 只能在干净 Git 工作区、五篇 Source 全部 `COMPLETED` 且证据/边完整性通过后生成。

01/02/03 是门禁建立前的历史产物，因此快照会如实标为 `LEGACY_FROZEN_OUTPUT`；05/09 必须带有温度和 publication diff 证明，标为 `LOCKED`。这不把历史编译说成可复现，但冻结后的知识输入仍可用于同一快照内的 B/P/E-min 配对实验。

## 命令

```bash
# 编译配置必须与 config.json 一致；当前默认即 model=deepseek-v4-flash, temperature=0
npm run dev -- ingest mathtest-material/05-functions-mappings.md
npm run dev -- ingest mathtest-material/09-functional-analysis.md

# 提交五篇 publication 与实验代码后，生成冻结快照
npm run pilot -- snapshot

# Gold 经人类确认为 FROZEN 后，只准备上下文，不调用回答模型
npm run pilot -- prepare

# 小样本冒烟；输出同时产生匿名 blind-answers 和隔离的 blinding-key
npm run pilot -- run --question PILOT-D01

# 正式 16 × 3 配对运行
npm run pilot -- run
```

运行器对三个组使用完全相同的回答 system prompt、JSON 答案合同、model、temperature 和 max output。模型只看到题目与当前组检索上下文，不看到 requiredClaims、expectedPath、mustMentionConditions、forbiddenClaims 或 answerability 标签。
