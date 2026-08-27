# Goal 0 Completion Record — 2026-07-29

Status: **PASS**

This record closes Goal 0 only: attributable retrieval/process Trace and final Prompt
evidence closure. It does not claim that Graph ranking or answer quality is optimal.

## Authoritative artifacts

- Budget/drop stress preparation: `preparations/goal0-contract-pressure-v4/`
- Stress Contract proof: `preparations/goal0-contract-pressure-v4/goal0-contract-proof.json`
- Relation-visible preparation: `preparations/goal0-contract-relations-v4/`
- Relation Contract proof: `preparations/goal0-contract-relations-v4/goal0-contract-proof.json`
- Online answer run: `answers/batch-c-posthoc-2026-07-29T07-44-41-449Z/`
- Online Contract proof: `answers/batch-c-posthoc-2026-07-29T07-44-41-449Z/goal0-online-contract-proof-v2.json`
  - 除 Context / Trace / 输入快照 hash 外，v2 还逐条确认实际发送给 DeepSeek 的 `userPrompt` 以对应的已验证 Context 结尾，避免“验证了一份 Context、模型却收到另一份”的断链。

Earlier `goal0-micro-*` and `goal0-contract-*-v1` through `v3` directories are
developmental post-hoc evidence. They remain immutable and are superseded by v4; they must not
be reported as the authoritative Goal 0 result.

## Contract evidence

The v4 Relation proof verifies:

- 6 questions and 18 prepared B / P-seed / P-graph contexts;
- 18/18 input snapshot hashes, Context hashes, and Trace hashes;
- 12/12 knowledge contexts within budget and with complete closure;
- 278 visible Claim→Evidence links;
- 130 visible Relation→Endpoint links;
- 1,014 Seed candidates, including 858 explicit Seed cutoff decisions;
- 1,404 Relation gate decisions and 105 Graph traversal/path records;
- 40 Pack drop decisions and 644 unit-level token decisions;
- 30 preparation/answer tool-call records;
- 12/12 online answer records with actual model usage and Prompt hashes.

The v4 2,500-token stress proof separately verifies 502 real Pack drops while all 12 knowledge
contexts retain closure. This prevents the Relation-visible run's larger budget from hiding a
low-budget closure failure.

## Actual online usage

Four questions were run in paired B / P-seed / P-graph groups with `deepseek-v4-flash`,
temperature 0. All 12 calls ended with `finishReason=stop` and valid JSON answer format.

| Group | Calls | Prompt tokens | Completion tokens | Total tokens | Mean latency | Tool calls |
|---|---:|---:|---:|---:|---:|---:|
| B | 4 | 10,352 | 723 | 11,075 | 2,348 ms | 4 |
| P-seed | 4 | 18,383 | 1,537 | 19,920 | 3,405 ms | 4 |
| P-graph | 4 | 29,931 | 1,256 | 31,187 | 3,074 ms | 4 |

These are observability measurements, not a quality verdict. Citation validation was 2/4 for B
and 3/4 for both P groups, so answer/citation behavior remains a downstream diagnostic rather
than a Goal 0 success claim.

## Scope and invariants

- Seed Top-K and Graph BFS ranking/ordering were not changed.
- Added Graph work is traversal/gate explanation only; R0 truthfully records
  `structureScore=null` with `not-computed-in-r0-bfs`.
- Final knowledge rendering now budgets Claim + conditions + provenance + all Evidence as an
  atomic unit. Relation is visible only when both endpoint Claims are visible.
- No file under `experiments/benchmark-batch-c/blind-first-run/` was modified.
- Every new run/proof lives under a fresh `post-hoc` directory; proof writers reject overwrite.

## Engineering verification

- `npm run typecheck`: PASS
- `npm run lint`: PASS (73 TypeScript files)
- `npx vitest run src`: PASS (18 files, 107 tests)
- `npm run build`: PASS
- `git diff --check`: PASS
