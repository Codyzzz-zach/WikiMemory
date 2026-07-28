# 交给 WorkBuddy 的文件与操作说明

## 必须上传

1. `WGEMemory4LLM-Benchmark.html`
2. `benchmark-data-collection-workbuddy-prompt.md`

## 可选上传

3. `WGEMemory4LLM-Product-Definition.html`

只有当 WorkBuddy 需要理解更高层产品目标时才上传第 3 个文件。资料收集本身以前两个文件为准，避免上下文过长。

## 在 WorkBuddy 对话框发送

```text
请完整读取我上传的两个文件。

将 benchmark-data-collection-workbuddy-prompt.md 作为本轮执行合同，开始完成 WGEMemory Benchmark Seed Batch A。不要先输出泛泛计划；先建立 coverage matrix，再进行合法的公开资料检索、材料冻结和候选测试数据构建。

默认领域为 AI、科技、金融。所有模型生成标注必须保持 candidate，不得伪装成人工 Gold。遇到访问限制、证据不足、时间或版本不明时如实记录，不能补写或猜测。

最终交付 workbuddy-batch-a 文件夹或 zip，并在 README 中给出资产数量、来源分布、失败项、候选题分布和最需要 Codex 审核的 10 个高风险项目。
```

## WorkBuddy 完成后交给 Codex

请把整个 `workbuddy-batch-a` 文件夹或 zip 交给 Codex，不要只粘贴 README 或部分 JSON。Codex 需要原始 Markdown、manifest、候选事实、关系、题目和演化事件一起做证据审计。
