# WikiMemory Agent Working Boundary

## Code discovery

- Product architecture lives in `src/`. Root-level code graphs are polluted by frozen Benchmark,
  historical experiments, legacy runtime state and external reference repositories.
- Prefer the codebase-memory project `WikiMemory-src`. If it is absent or stale, index
  `/Users/mixi/Desktop/WikiMemory/src` as `WikiMemory-src` before architecture analysis.
- When using the root `WikiMemory` graph for change impact, always add `file_pattern="src/**/*.ts"`
  or a `src/` path scope. Never cite root graph file/node counts as product-code metrics.
- Use filesystem search for documentation, contracts, hashes, configs and literal paths.

## Frozen assets

- Do not move `batch-c-*`, `workbuddy-*`, `benchmark-s200-*`, `mathtest-material/`, `experiments/`
  or `runs/` merely for visual cleanup. Historical contracts and artifact hashes depend on paths.
- New Benchmark assets belong under `benchmarks/`; new runtime state belongs under an explicit
  ignored `WGE_RUNTIME_ROOT`.
