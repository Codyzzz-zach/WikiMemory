# 历史问题集

这里保存原 `tests/` 下的 Dev、Evolution 与 Held-out 数据合同。它们是 Benchmark 数据，不是 Vitest 测试代码。

- `dev/`：开发与快速回归；
- `evolution/`：时间演化和纠正问题；
- `held-out/`：历史已冻结/已揭示集合，按其各自 manifest 判断可见性。

生产镜像和 MCP 运行时不得读取本目录。TypeScript 单元/集成测试继续与实现并置在 `src/**/*.test.ts`。
