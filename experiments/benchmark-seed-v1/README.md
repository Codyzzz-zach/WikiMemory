# 六领域 Benchmark Seed v1

这个目录把两批资料变成一个可执行、但不过度宣称的实验合同。

## 数据角色

- Batch A（AI / 科技 / 金融）是开发集。它可以帮助定位管道错误、改机制和跑 12 题结构 canary，但不能单独证明产品有效。
- Batch B（健康生物 / 历史人文 / 设计无障碍）是第一次跨域公开验证集。它用于判断在没有针对这三个领域调参的前提下，系统是否仍保留事实、条件、时间、来源归属，并改善回答。
- Batch B 的题目已经被我们看过，所以它不是盲测。第一次结果落盘后，它也只能作为普通 validation 使用。
- 真正确认性结果需要未来 Batch C：新领域或新来源簇、冻结前不向施工方暴露题目和答案。

## 为什么先 E1，再 E4

E1 测编译产物本身：12 份 Source Snapshot 中的 36 个事实锚点、9 条关系和 3 个演化事件，经过 ingest/compile 后有没有丢条件、丢时间、错归属或生成无证据内容。它回答“知识输入是否可信”。

E4 测产品效果：同一回答模型、同一上下文预算下，比较原文检索 B、Claim/Graph P、P 加最小 WikiModule 的 E-min。它回答“可信知识是否真的让 Agent 更好”。

如果 E1 不过，E4 的差异没有可解释性；如果只做 E1，不做 E4，则只能证明管道可靠，不能证明产品有价值。

## 执行节奏

1. `npm run benchmark:batch-b:build` 重建静态候选和干净编译语料。
2. `npm run benchmark:batch-b:validate` 校验 source/fact/relation/task/episode 的证据链。
3. `npm run benchmark:seed:validate` 校验跨 Batch 隔离和实验合同。
4. Batch A 的 12 题只做离线装载 smoke。
5. Batch B 先编译 12 份干净 Source Snapshot，运行 E1。
6. E1 无硬失败后，E4a 先跑每域 2 题（共 6 题 × B/P），并保存检索阶段漏斗。
7. E-min 暂不伪造：只有通用、与题目 Gold 隔离的 WikiModule builder 落地并独立审计后，才进入 E4b。
8. 离线上下文先执行 `npm run benchmark:e4:prepare`；检查召回、图扩展和预算裁剪信号后，再决定是否调用回答模型。

当前没有通用 WikiModule 生成器。手工根据 `requiredPoints` 编写模块会把答案泄漏进实验输入，因此 E-min 的正确状态是 `BLOCKED_MISSING_GENERIC_WIKIMODULE_BUILDER`，不是用空模块冒充第三组。

`suite-manifest.json` 是本阶段的约束源；任何结果报告都必须带 suiteId、输入哈希、代码版本、模型配置和首次运行标记。
