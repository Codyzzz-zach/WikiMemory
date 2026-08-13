# 可复现基线提交范围

> 日期：2026-08-13。目标：让代码、合同和权威结论拥有 Git 身份，同时不把本地缓存和逐次模型输出
> 伪装成源码依赖。

## 基线必须包含

- `src/` 产品内核及同目录测试；
- `scripts/` 中被 `package.json` 或冻结实验合同使用的运行、校验与复核工具；
- Docker、MCP、Worker、构建、类型检查与 lint 配置；
- 产品定义、目标架构、知识合同、当前状态、ADR、Runbook 和验证报告；
- 已揭示 Benchmark 的冻结语料、题目、manifest 与来源报告；S200 Stage B 仍由用户侧密封，
  不进入本次 Git 基线；
- 实验合同、freeze manifest、人工/程序裁决、proof 和裁决引用的权威工件；
- 聚合 LLM usage 台账（不含 prompt/response 原文）和 legacy knowledge-as-code 状态。

## 基线不得包含

- `.env`、API key、Pilot HMAC key；
- `references/` 中的外部仓库与论文副本；
- `node_modules/`、`dist/`、本地索引和 cache；
- raw LLM output、逐题 context/record、临时 workspace、逐次 preparation 和日志；
- 尚未揭示的盲测 Gold 或通过别名泄露的臂映射。

## 可复现性的含义

基线要求一台没有当前工作树缓存的环境，仅凭 Git 内容和锁文件即可完成：

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

这证明“代码和本地测试可重建”，不证明在线模型输出逐 token 确定，也不证明产品长期增益。
在线编译还必须额外冻结 provider/model、temperature、prompt 版本、输入 hash 和 usage。

## 实验证据纪律

裁决文件引用的权威工件必须满足三项：路径存在、SHA-256 可重算、权威级别写清楚。
中间运行物可不进入 Git，但不能成为唯一结论来源；若某结论只能从未封存的本地目录恢复，
该结论在基线中应标为未验证。

历史实验把聚合报告放在多个 `*-runs/` 目录中；这些目录现在默认忽略，只有被裁决按路径和 hash
引用的紧凑工件才用显式路径纳入。新实验的 contract、freeze、proof、adjudication 应放在 goal 根目录，
避免以后继续依赖 `git add -f` 区分证据和中间物。
