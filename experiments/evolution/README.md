# Evolution benchmark inbox

这个目录定义下一阶段的产品测试输入：不是再测“单篇文章能否编译”，而是测同一知识库经历
T0 初始知识、T1 增量知识、T2 纠错、T3 无权威冲突后，Agent 是否能更新答案，同时不伤害无关知识。

## 需要的数据规模

- 3 个差异明显的领域，每个领域 8 篇 Markdown，共 24 篇。
- 每篇 1,500–4,000 个中文字符；只使用 Markdown，暂不提交 TeX/PDF。
- 每个领域 12 道冻结题，共 36 道：4 道受纠错影响、4 道无关回归、2 道跨文档综合、
  2 道证据不足。
- 每个领域必须同时包含：无条件全局替代、有条件局部例外、无明确权威的冲突、纯增量更新。

建议使用虚构但真实感强的组织和产品，确保正确答案完全由材料决定，不依赖模型的世界知识：

1. `platform-engineering`：API 版本、发布审批、安全策略和弃用规则。
2. `commerce-operations`：退款、会员权益、SLA、地区政策和价格规则。
3. `research-operations`：实验协议、评测口径、数据使用限制和复现实验结论。

## 交付目录

```text
delivery/
  manifest.json
  questions.json
  platform-engineering/
    t0/*.md
    t1/*.md
    t2/*.md
    t3/*.md
  commerce-operations/
    t0/*.md
    t1/*.md
    t2/*.md
    t3/*.md
  research-operations/
    t0/*.md
    t1/*.md
    t2/*.md
    t3/*.md
```

`t0` 是基线；`t1` 只能增加知识，不能修改旧规则；`t2` 包含正式纠错；`t3` 放置没有足够
权威信息判定赢家的冲突材料。文档正文不能出现“测试目标”“正确答案”“SUPERSEDES”等标注。

## 冻结与验收原则

- Gold 使用 `documentId` 和原文事实描述，不预填系统生成的 Claim/Relation ID。
- 每个纠错都要写清生效时间、适用范围、是否完全替代、权威依据和原文中的明确措辞。
- 有条件例外不能伪装成全局替代；T3 冲突不能强行选赢家。
- 无关回归题在 T0/T1/T2/T3 的答案应保持不变。
- 证据不足题必须明确缺少什么，不能靠常识补全。
- 生成模型负责初稿；Codex 会做格式、逻辑和泄漏检查后冻结。产品负责人至少抽查每个领域的
  1 个全局替代和 1 个条件例外，否则只能称“合成银标准”，不能称人工金标准。

完整生成提示词见 [gemini-generation-prompt.md](./gemini-generation-prompt.md)，字段示例见
[delivery-template.json](./delivery-template.json)。
