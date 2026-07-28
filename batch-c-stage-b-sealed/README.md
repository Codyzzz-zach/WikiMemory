# Batch C Stage B — Sealed Scoring Gold

**Status:** DELIVERED (not pre-committed)
**Gold Status:** post-answer-created-model-reviewed-provisional-gold
**Generated:** 2026-07-28T15:50:00+08:00
**Generator:** WorkBuddy (CodeBuddy Code) — Model: DeepSeek-V4-Pro

## Scenario Determination

Per the delivery protocol:
- An original Stage B was generated alongside Stage A at 2026-07-28T14:00:00+08:00 with 24 facts, 8 relations, 18 tasks, 3 episodes
- The current delivery instructions contain substantially enhanced requirements (upstream source disambiguation, atomic requiredPoints, independent review, detailed seal-manifest) that the original does not meet
- **Scenario B applies:** this is an honest rebuild from frozen Stage A sources only
- Gold status reflects this: **post-answer-created-model-reviewed-provisional-gold**
- This Gold was NOT generated before Codex answers — it is created now, from Stage A sources only, without reading any Codex answers

## Contents

- `gold/facts-gold.jsonl` — 38 atomic fact anchors with upstream evidence
- `gold/relations-gold.jsonl` — 8 directional relations with endpoint evidence
- `gold/tasks-gold.jsonl` — 18 task scoring Gold entries (one per Stage A question)
- `gold/evolution-episodes-gold.jsonl` — 3 evolution episodes (1 per domain)
- `seal-manifest.json` — file integrity manifest with payloadTreeHash
- `audit/independent-review.jsonl` — 67 audit entries (self-review only)
- `audit/disagreements.md` — disagreement log
- `audit/gold-integrity-report.md` — integrity checks

## Connection to Stage A

Stage A and Stage B share: caseId, factId, relationId, sourceId. All 18 Stage B task Gold entries correspond 1:1 with Stage A questions. Stage A question file SHA-256: `3cfe6ed87ddfb88902d35c417f27c6a8ebf806e3139e0acc37d34fa9ad11a34d`.

## Integrity Rules (from contract)

- Stage B must not be opened before Stage A blind answers are frozen
- Post-hoc answer modification is prohibited
- First-run answers are permanent; fixes enter new post-hoc runId
- If seal hash does not match, entire batch is invalidated

## Review Status

All Gold marked as `post-answer-created-model-reviewed-provisional-gold`. Independent model review pending per contract Section 八.
