# Batch C Stage A — Materials and Public Questions

**Version:** v1.0
**Generated:** 2026-07-28T14:00:00+08:00
**Status:** candidate-public-blind
**Contract:** benchmark-batch-c-workbuddy-contract.md v1.0

## Overview

This is Stage A of WGEMemory Batch C — a cross-domain, source-cluster-isolated confirmatory holdout set. It contains 12 source snapshots across 3 new domains and 18 neutral (blind) questions. **No Gold data, answers, or scoring criteria are included.**

## Domains

1. **psychology-reproducibility** — The replication crisis in psychological science: original large-scale replication study, complementary multi-lab replication, methodological critique, and community perception survey.
2. **climate-energy-policy** — Climate science and policy: IPCC AR6 consensus, EU Climate Law targets, policy analysis, and IEA energy outlook.
3. **law-public-policy** — Technology regulation and data protection: EU AI Act, GDPR enforcement (Meta €1.2B fine), legal analysis, and industry/privacy advocacy response.

## Why These Domains Were Chosen

These are the three default domains specified in the contract (Section 3):
- "心理学与研究复现" (psychology-reproducibility)
- "气候与能源政策" (climate-energy-policy)
- "法律与公共政策" (law-public-policy)

All have high-quality, publicly accessible sources. None overlap with Batch A/B domains (AI/tech, finance, math, health communication, ancient texts, WCAG).

## Directory Structure

```
batch-c-stage-a/
├── README.md                          ← this file
├── contract-manifest.json              ← directory metadata and integrity manifest
├── corpus/
│   ├── psychology-reproducibility/     ← 4 source snapshots
│   ├── climate-energy-policy/          ← 4 source snapshots
│   └── law-public-policy/              ← 4 source snapshots
├── manifests/
│   └── source-manifest.jsonl           ← all 12 source metadata entries
├── questions/
│   └── questions-public.jsonl          ← 18 neutral questions (NO Gold)
└── reports/
    ├── coverage-matrix.md              ← source × question cross-reference
    ├── collection-log.md               ← access methods and hash methodology
    ├── overlap-check.md                ← Batch A/B isolation verification
    └── unresolved-and-access-failures.md ← limitations and transparency notes
```

## Source Cluster Design

Each domain has 4 sources covering:
1. P-primary: Official/original authoritative source
2. P/C-implementation: Follow-up version, replication, or enforcement action
3. S-analysis: Professional analysis or interpretation
4. U/S-response: Community discussion or alternative viewpoint

## Question Distribution (18 total, 6 per domain)

- F (Faithfulness): 3 questions — exact recall from single source
- C (Condition/Scope): 3 questions — conditions, exceptions, scope
- T (Temporal/Evolution): 3 questions — version changes, corrections, disputes
- X (Cross-source): 3 questions — multi-source synthesis
- K (Conflict/Attribution): 3 questions — source role awareness, conflict preservation
- A (Answerability): 3 questions — evidence boundary, when to refuse

## Stage B Status

Stage B (sealed Gold: facts, relations, tasks, evolution episodes) has been generated and stored in `batch-c-stage-b-sealed/`. It will NOT be delivered until the user explicitly requests "交付 Stage B". Stage A and Stage B are connected only by caseId, factId, relationId, and sourceId.

## Contract Compliance Checklist

- [x] 12 source snapshots across 3 new domains
- [x] 18 neutral questions — no requiredPoints, forbiddenClaims, exactQuote, Gold answers
- [x] Source clusters isolated from Batch A/B
- [x] Per-domain coverage: P, P/C-implementation, S-analysis, U/S-response
- [x] Per-domain question types: F, C, T, X, K, A
- [x] 9/18 questions require 2+ sources
- [x] All exactQuotes verifiable in source snapshots
- [x] All hashes computable at document boundary
- [x] Access failures and limitations documented
- [x] Stage B sealed and separate

## Usage Constraints

- This folder is for **internal benchmark evaluation only**.
- Do not distribute source snapshots that contain copyrighted material beyond the short excerpts preserved here.
- Stage B must not be examined, summarized, or leaked before the evaluator explicitly requests it.
