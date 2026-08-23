# Scripts 边界

`scripts/` 当前包含历史 Benchmark、Goal、审计、迁移和故障复现脚本。它们接受与生产代码相同的 lint/typecheck，但不是 WikiMemory 的产品 API。

新脚本按以下原则增加：

- 产品运行入口放 `src/transport/`，不放这里；
- 一次性数据迁移必须写明输入、输出、幂等性和回滚；
- Benchmark 运行必须冻结 config/hash，首轮输出不可覆盖；
- 调试脚本必须声明非生产入口；
- 新的 I0–I3 验收脚本使用 `scripts/integration-*` 前缀，避免继续扩展 Goal 编号。

当前集成 Gate：

- `npm run i3:sim:gate -- verify`：验证 I3-Sim 的 Stage A 冻结引用、三领域切片、自然任务和 Stage B 隔离；
- `npm run i3:sim:gate -- prepare --runtime-root <absolute-path>`：创建绑定当前 clean commit 的隔离会话；
- `npm run i3:sim:gate -- run-next --runtime-root <absolute-path>`：每次最多摄入一个冻结 Source，并在扩大前执行成本与结构门禁；
- `npm run i3:sim:gate -- status --runtime-root <absolute-path>`：读取当前 cursor 和不可覆盖的 iteration receipts。

当前仍有大量 legacy `goal*` / `benchmark*` 脚本。它们是历史实验的可复现入口，不是新项目结构的
范例；在对应工件路径和 hash 迁移有兼容证明前不做纯视觉移动。

维护类只读入口：

- `npm run economics:ingest -- --runtime-root <path>`：按最新 Source run 汇总摄入模型 token；机器读取 JSON 时用 `npm run --silent economics:ingest -- --runtime-root <path> --json`，避免 npm 横幅混入 stdout；
- 加 `--all-runs` 才查看重编历史与失败消耗；加 `--json` 输出稳定机器格式。
