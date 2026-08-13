# Benchmark 资产边界

本目录是 Benchmark 资产的索引和归档入口。历史冻结运行依赖若干根目录路径，为保留 hash 与脚本可复现性，本轮不强行改写这些路径。

## 当前 legacy frozen roots

- `../workbuddy-batch-a/`
- `../workbuddy-batch-b/`
- `../batch-c-stage-a/`
- `../batch-c-stage-b-sealed/`
- `../benchmark-s200-stage-a/`
- `../benchmark-s200-stage-a-v1.1-candidate/`
- `../benchmark-s200-stage-b-sealed/`
- `../benchmark-s200-stage-b-v1.1-sealed/`
- `../mathtest-material/`
- `../meta-eval-dataset.json`
- `../meta-eval-seed-spans.md`
- `legacy-question-sets/`（原 `tests/` 下的历史数据，不是 Vitest 代码）

这些资产不得进入生产 Docker 镜像，不得被 MCP 默认读取，也不得与 `runtime-data/` 共用挂载卷。

## 合同

数据采集与密封合同统一位于 `../docs/benchmarks/`。

## 归档

`archive/` 保存历史交付 zip。目录副本仍保留原路径，直到冻结脚本迁移具有独立 hash 兼容证明。

## 新实验约定

新实验一律放入：

```text
benchmarks/
  datasets/<dataset-id>/
  sealed/<dataset-id>/      # 必须物理隔离，生产工具不可见
  runs/<run-id>/            # 不可覆盖首轮结果
```

历史 `experiments/` 和 `runs/` 只作归档/回归，不继续扩展新的目录命名体系。
