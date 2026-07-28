# WGEMemory Benchmark Seed — Batch B（泛化候选）

状态：来源快照已冻结；后续模型标注一律保持 `candidate`，不冒充 human Gold。

## 领域簇

| 领域 | 主题 | 主要压力 |
|---|---|---|
| health-biology | SARS-CoV-2 空气传播与术语演化 | 高风险条件、时间变化、一手结论与二手批评 |
| history-humanities | 赫库兰尼姆纸卷的非破坏性解读 | 论文/实现/报道归属、阶段性成果、技术与人文合成 |
| design-accessibility | WCAG 2.1 → 2.2 | 规范版本、条件范围、提案争议与最终标准 |

## 隔离规则

- 不复用 Batch A 的作者、主题或 sourceId。
- 本批先作为 `dev-candidate/validation-candidate`；在题目公开前不声称 blind holdout。
- 健康类来源只支持证据审计和信息演化测试，不构成医疗建议。
- 规范、论文、报道与社区意见必须保留来源角色，不允许互相冒充。

