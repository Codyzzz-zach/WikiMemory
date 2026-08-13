---
sourceId: s200-ai-swebench-002
title: "SWE-bench repository README (pinned commit)"
domain: ai
clusterId: cluster-ai-swebench-01
sourceRole: C-implementation
platform: github
author: "SWE-bench team (Princeton NLP)"
canonicalUrl: "https://github.com/SWE-bench/SWE-bench/blob/main/README.md"
publishedAt: "2023-10-10"
capturedAt: "2026-08-10T12:35:00+08:00"
versionRef: "commit 2f106b56ffc9e73f7179a962d4d0f45673319ac5 (2025-12-01); repo renamed from princeton-nlp/SWE-bench"
mediaType: repository-readme
language: en
usage: internal-only
accessStatus: full
snapshotHash: "sha256:c3565bd4267be49d677f8fe228ebb5c8e0ec31071da7f30e0301244079ecab56"
collectionMethod: public-api
licenseOrUsageNote: "MIT-licensed repository content; internal benchmark use only."
collectionNotes: "raw.githubusercontent.com 按 commit 固定抓取。README 记录了项目时间线（ICLR 2024 oral、SWE-agent、Docker harness、SWE-bench Verified、Multimodal）。"
---

# SWE-bench repository README (pinned commit)

## Source Snapshot

*Verbatim from https://raw.githubusercontent.com/SWE-bench/SWE-bench/2f106b56ffc9e73f7179a962d4d0f45673319ac5/README.md (captured 2026-08-10).*

### Header

> Code and data for the following works:
> * [ICLR 2025] SWE-bench Multimodal: Do AI Systems Generalize to Visual Software Domains?
> * [ICLR 2024 Oral] SWE-bench: Can Language Models Resolve Real-World GitHub Issues?

### News timeline (verbatim)

> * **[Jan. 13, 2025]**: We've integrated [SWE-bench Multimodal](https://swebench.com/multimodal) ([paper](https://arxiv.org/abs/2410.03859), [dataset](https://huggingface.co/datasets/SWE-bench/SWE-bench_Multimodal)) into this repository! Unlike SWE-bench, we've kept evaluation for the test split *private*. Submit to the leaderboard using [sb-cli](https://github.com/swe-bench/sb-cli/tree/main), our new cloud-based evaluation tool.
> * **[Jan. 11, 2025]**: Thanks to [Modal](https://modal.com/), you can now run evaluations entirely on the cloud!
> * **[Aug. 13, 2024]**: Introducing *SWE-bench Verified*! Part 2 of our collaboration with [OpenAI Preparedness](https://openai.com/preparedness/). A subset of 500 problems that real software engineers have confirmed are solvable. Check out more in the [report](https://openai.com/index/introducing-swe-bench-verified/)!
> * **[Jun. 27, 2024]**: We have an exciting update for SWE-bench - with support from [OpenAI's Preparedness](https://openai.com/preparedness/) team: We're moving to a fully containerized evaluation harness using Docker for more reproducible evaluations!
> * **[Apr. 2, 2024]**: We have released [SWE-agent](https://github.com/SWE-agent/SWE-agent), which sets the state-of-the-art on the full SWE-bench test set!
> * **[Jan. 16, 2024]**: SWE-bench has been accepted to ICLR 2024 as an oral presentation!

### Overview (verbatim)

> SWE-bench is a benchmark for evaluating large language models on real world software issues collected from GitHub.
>
> Given a *codebase* and an *issue*, a language model is tasked with generating a *patch* that resolves the described problem.
>
> To access SWE-bench, copy and run the following code:
>
> ```python
> from datasets import load_dataset
> swebench = load_dataset('princeton-nlp/SWE-bench', split='test')
> ```

### Set Up / Warning (verbatim)

> SWE-bench uses Docker for reproducible evaluations.
>
> > [!WARNING]
> > SWE-bench evaluation can be resource intensive
> > We recommend running on an `x86_64` machine with at least 120GB of free storage, 16GB of RAM, and 8 CPU cores.

## Research Notes

- 来源角色 C-implementation：官方仓库 README（MIT），固定到 commit 2f106b56。
- 事件簇：README 的 News 时间线是"SWE-bench → SWE-agent → Docker harness → Verified → Multimodal"演化的官方记录，用于 T0→Tn 影响追踪。
- SWE-bench Verified（2024-08-13，500 题子集，OpenAI Preparedness 合作）是与 s200-ai-swebench-006（HN 讨论）同一事件。
- 仓库已从 princeton-nlp/SWE-bench 更名 SWE-bench/SWE-bench（canonicalUrl 用新名）。
