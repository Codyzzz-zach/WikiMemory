# WorkBuddy 上传与交付操作单：S200 + T0→Tn

## 上传给 WorkBuddy

必须上传：

1. `WGEMemory4LLM-Benchmark.html`
2. `benchmark-s200-workbuddy-contract.md`
3. `workbuddy-batch-a/refined/source-manifest.jsonl`
4. `workbuddy-batch-b/generated/source-manifest.jsonl`
5. `batch-c-stage-a/manifests/source-manifest.jsonl`

可选上传：`WGEMemory4LLM-Product-Definition.html`。

不要上传：任何历史 Stage B、Gold、评分报告、候选答案目录、Post-hoc 结果。

## 对话框发送

复制 `benchmark-s200-workbuddy-contract.md` 第 0 节的完整文本发送。若 WorkBuddy 要求缩小任务，不要放弃两阶段隔离；允许按领域分批搜集，但最终必须合并成同一 Stage A manifest、统一复算 hash，并保证 Stage B 在 Stage A 交付前已经密封。

## 第一次只交付

```text
benchmark-s200-stage-a/
```

或只包含该目录的 zip。

不要交付 `benchmark-s200-stage-b-sealed/`。不要把两个目录放在同一 zip，也不要粘贴 Stage B 摘要。

## 何时交付 Stage B

只有在 Codex 完成以下动作并明确请求后：

1. 验证 Stage A 目录、hash、来源合法性与历史重叠；
2. 冻结代码、配置、知识快照和题目 hash；
3. 编译 Source；
4. 运行离线 S200/T0→Tn 候选发现；
5. 封存候选输出目录 hash；
6. 输出“可以交付 Stage B”的完成证明。

Stage B 揭示后，只评分已封存候选；任何修复进入新的 post-hoc run，不覆盖首轮。
