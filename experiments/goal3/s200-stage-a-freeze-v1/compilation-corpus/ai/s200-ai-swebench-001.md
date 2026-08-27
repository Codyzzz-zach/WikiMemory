---
sourceId: s200-ai-swebench-001
title: 'SWE-bench: Can Language Models Resolve Real-World GitHub Issues? (arXiv:2310.06770v1, initial version)'
domain: ai
clusterId: cluster-ai-swebench-01
sourceRole: P-primary
platform: arxiv
author: Carlos E. Jimenez, John Yang, Alexander Wettig, Shunyu Yao, Kexin Pei, Ofir Press, Karthik Narasimhan
canonicalUrl: https://arxiv.org/abs/2310.06770v1
publishedAt: '2023-10-10T16:47:29Z'
capturedAt: '2026-08-10T23:55:00+08:00'
versionRef: arXiv:2310.06770v1 (submitted 2023-10-10)
mediaType: paper
language: en
usage: internal-only
accessStatus: full
evaluatorRawSnapshotHash: sha256:c96021718ff2cd8ef2b98cedbf69c22386053534bfdffd1d48c3ca1f872e9d49
evaluatorNormalizedSnapshotHash: sha256:c96021718ff2cd8ef2b98cedbf69c22386053534bfdffd1d48c3ca1f872e9d49
evaluatorUpstreamArtifactHash: sha256:34c34542fe0399a0d76bb7e4ff01971befb7dace1716347507d96f99accce7d6
---

# SWE-bench: Can Language Models Resolve Real-World GitHub Issues? (arXiv:2310.06770v1, initial version)

## Source Snapshot

### Metadata

> Computer Science > Computation and Language
>
> arXiv:2310.06770v1 (cs)
>
> [Submitted on 10 Oct 2023 (this version), latest version 11 Nov 2024 (v3)]
>
> Title: SWE-bench: Can Language Models Resolve Real-World GitHub Issues?
>
> Authors: Carlos E. Jimenez, John Yang, Alexander Wettig, Shunyu Yao, Kexin Pei, Ofir Press, Karthik Narasimhan

### Abstract (verbatim, v1)

> Language models have outpaced our ability to evaluate them effectively, but for their future development it is essential to study the frontier of their capabilities. We consider real-world software engineering to be a rich, sustainable, and challenging testbed for evaluating the next generation of language models. We therefore introduce SWE-bench, an evaluation framework including $2,294$ software engineering problems drawn from real GitHub issues and corresponding pull requests across $12$ popular Python repositories. Given a codebase along with a description of an issue to be resolved, a language model is tasked with editing the codebase to address the issue. Resolving issues in SWE-bench frequently requires understanding and coordinating changes across multiple functions, classes, and even files simultaneously, calling for models to interact with execution environments, process extremely long contexts and perform complex reasoning that goes far beyond traditional code generation. Our evaluations show that both state-of-the-art proprietary models and our fine-tuned model SWE-Llama can resolve only the simplest issues. Claude 2 and GPT-4 solve a mere $4.8$% and $1.7$% of instances respectively, even when provided with an oracle retriever. Advances on SWE-bench represent steps towards LMs that are more practical, intelligent, and autonomous.

### Subjects / Cite as

> Subjects: Computation and Language (cs.CL); Artificial Intelligence (cs.AI); Software Engineering (cs.SE)
>
> Cite as: arXiv:2310.06770 [cs.CL] (or arXiv:2310.06770v1 [cs.CL] for this version)
>
> https://doi.org/10.48550/arXiv.2310.06770

> Submission history
> From: Carlos E. Jimenez [view email]
> [v1] Tue, 10 Oct 2023 16:47:29 UTC (2,003 KB)
> [v2] Fri, 5 Apr 2024 18:16:29 UTC (2,258 KB)
> [v3] Mon, 11 Nov 2024 23:05:04 UTC (2,398 KB)
