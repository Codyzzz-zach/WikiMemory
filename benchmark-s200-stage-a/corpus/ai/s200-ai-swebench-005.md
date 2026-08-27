---
sourceId: s200-ai-swebench-005
title: "SWE-bench full text (ar5iv HTML mirror of arXiv:2310.06770) — abstract and introduction"
domain: ai
clusterId: cluster-ai-swebench-01
sourceRole: P-primary
platform: arxiv
author: "Carlos E. Jimenez, John Yang, Alexander Wettig, Shunyu Yao, Kexin Pei, Ofir Press, Karthik Narasimhan"
canonicalUrl: "https://ar5iv.labs.arxiv.org/html/2310.06770"
publishedAt: "2023-10-10"
capturedAt: "2026-08-10T12:35:00+08:00"
versionRef: "arXiv:2310.06770 (ar5iv HTML mirror); ICLR 2024 version"
mediaType: paper
language: en
usage: internal-only
accessStatus: full
snapshotHash: "sha256:c7c0f5829774303f1109d269a1a08ef74f5d6853f5753153e29210d2c1d99687"
collectionMethod: public-page
licenseOrUsageNote: "ar5iv 为 arXiv 论文 HTML 镜像；内部评测只保留可定位摘录。"
collectionNotes: "与 s200-ai-swebench-003（ar5iv 引言摘录）互补；本文件补充 2024 版摘要与引言中'SWE-Llama'与数字。CSS 渲染数字重复伪影已剔除。"
---

# SWE-bench full text (ar5iv HTML mirror of arXiv:2310.06770) — abstract and introduction

## Source Snapshot

*Verbatim excerpts from https://ar5iv.labs.arxiv.org/html/2310.06770 (captured 2026-08-10).*

### Introduction (verbatim excerpts)

> Language models (LMs) are rapidly being deployed in commercial products such as chatbots and coding assistants.
>
> At the same time, existing benchmarks have become saturated (Kiela et al., 2021; Ott et al., 2022) and fail to capture the frontier of what state-of-the-art LMs can and cannot do.
>
> There is a need for challenging benchmarks that more accurately reflect real-world applications of LMs to help shape their future development and usage (Srivastava et al., 2023).

> However, existing coding benchmarks, such as HumanEval (Chen et al., 2021), mostly involve self-contained problems that can be solved in a few lines of code.
>
> In the real world, software engineering is not as simple.
>
> Fixing a bug might involve navigating a large repository, understanding the interplay between functions in different files, or spotting a small error in convoluted code.

> We evaluate SWE-bench on multiple state-of-the-art LMs and find that they fail to solve all except the simplest issues.
>
> For instance, Claude 2 and GPT-4 only resolve 4.8% and 1.7% of tasks respectively; even using an oracle that retrieves the files to edit from a reference solution.
>
> Using a BM25 retriever, performance drops further to 1.96% for Claude 2.

> To aid open model development in this direction, we release a training dataset, SWE-bench-train consisting of 19000 non-testing task instances from 37 other repositories.

## Research Notes

- 来源角色 P-primary：SWE-bench 论文全文镜像（ar5iv），版本为 ICLR 2024 定稿。
- 版本差异测试点：v3 摘要/正文（Claude 2 4.8%/GPT-4 1.7% oracle）与 2023 v1 摘要（Claude 2 1.96% BM25，s200-ai-swebench-001）——同论文不同版本数字。
- SWE-bench-train（19,000 例/37 仓库）、SWE-Llama（7b/13b）为训练数据事实。
- 引文只选提取干净的完整句子（ar5iv CSS 数字伪影已剔除并披露）。
