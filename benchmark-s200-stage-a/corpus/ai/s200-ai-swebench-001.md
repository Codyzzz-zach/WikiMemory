---
sourceId: s200-ai-swebench-001
title: "SWE-bench: Can Language Models Resolve Real-World GitHub Issues? (arXiv:2310.06770)"
domain: ai
clusterId: cluster-ai-swebench-01
sourceRole: P-primary
platform: arxiv
author: "Carlos E. Jimenez, John Yang, Alexander Wettig, Shunyu Yao, Kexin Pei, Ofir Press, Karthik Narasimhan"
canonicalUrl: "https://arxiv.org/abs/2310.06770"
publishedAt: "2023-10-10T16:47:29Z"
capturedAt: "2026-08-10T12:35:00+08:00"
versionRef: "arXiv:2310.06770v3 (last revised 2024-11-11); ICLR 2024; DOI 10.48550/arXiv.2310.06770"
mediaType: paper
language: en
usage: internal-only
accessStatus: full
snapshotHash: "sha256:0947576db2d2a288f259f7dfb1697be5dc1d46806082368497e1090c0a574466"
collectionMethod: public-page
licenseOrUsageNote: "arXiv 摘要页公开内容；论文正文受版权保护，只保存官方摘要与元数据。"
collectionNotes: "arXiv 摘要页；正文全文见 s200-ai-swebench-003（ar5iv 镜像）。"
---

# SWE-bench: Can Language Models Resolve Real-World GitHub Issues? (arXiv:2310.06770)

## Source Snapshot

*Verbatim from https://arxiv.org/abs/2310.06770 (captured 2026-08-10).*

### Metadata

> Computer Science > Computation and Language
>
> arXiv:2310.06770 (cs)
>
> [Submitted on 10 Oct 2023 (v1), last revised 11 Nov 2024 (this version, v3)]
>
> Title: SWE-bench: Can Language Models Resolve Real-World GitHub Issues?
>
> Authors: Carlos E. Jimenez, John Yang, Alexander Wettig, Shunyu Yao, Kexin Pei, Ofir Press, Karthik Narasimhan

### Abstract (verbatim)

> Language models have outpaced our ability to evaluate them effectively, but for their future development it is essential to study the frontier of their capabilities. We find real-world software engineering to be a rich, sustainable, and challenging testbed for evaluating the next generation of language models. To this end, we introduce SWE-bench, an evaluation framework consisting of $2,294$ software engineering problems drawn from real GitHub issues and corresponding pull requests across $12$ popular Python repositories. Given a codebase along with a description of an issue to be resolved, a language model is tasked with editing the codebase to address the issue. Resolving issues in SWE-bench frequently requires understanding and coordinating changes across multiple functions, classes, and even files simultaneously, calling for models to interact with execution environments, process extremely long contexts and perform complex reasoning that goes far beyond traditional code generation tasks. Our evaluations show that both state-of-the-art proprietary models and our fine-tuned model SWE-Llama can resolve only the simplest issues. The best-performing model, Claude 2, is able to solve a mere $1.96$% of the issues. Advances on SWE-bench represent steps towards LMs that are more practical, intelligent, and autonomous.

### Subjects / Cite as

> Subjects: Computation and Language (cs.CL); Artificial Intelligence (cs.AI); Software Engineering (cs.SE)
>
> Cite as: arXiv:2310.06770 [cs.CL] (or arXiv:2310.06770v3 [cs.CL] for this version)
>
> https://doi.org/10.48550/arXiv.2310.06770

> Submission history
> From: Carlos E. Jimenez [view email]
> [v1] Tue, 10 Oct 2023 16:47:29 UTC (2,003 KB)
> [v2] Fri, 5 Apr 2024 18:16:29 UTC (2,258 KB)
> [v3] Mon, 11 Nov 2024 23:05:04 UTC (2,398 KB)

## Research Notes

- 来源角色 P-primary：SWE-bench 原始论文（ICLR 2024 Oral），核心声明：2,294 题、12 个 Python 仓库、Claude 2 仅解 1.96%。
- 版本链：v1（2023-10-10）→ v2（2024-04-05）→ v3（2024-11-11）。
- 与 s200-ai-swebench-002（官方 README，含 2024-08-13 SWE-bench Verified 公告）构成"基准→Verified 子集"的演化事件。
- 摘要中 1.96% 为 Claude 2（BM25 检索下）；v3 正文将 Claude 2/GPT-4 数字更新为 4.8%/1.7%（oracle 检索）——注意版本间数字差异（见 s200-ai-swebench-003）。
