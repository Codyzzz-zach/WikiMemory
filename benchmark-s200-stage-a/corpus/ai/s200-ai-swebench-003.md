---
sourceId: s200-ai-swebench-003
title: "SWE-bench full text (ar5iv HTML mirror of arXiv:2310.06770)"
domain: ai
clusterId: cluster-ai-swebench-01
sourceRole: P-primary
platform: arxiv
author: "Carlos E. Jimenez, John Yang, Alexander Wettig, Shunyu Yao, Kexin Pei, Ofir Press, Karthik Narasimhan"
canonicalUrl: "https://ar5iv.labs.arxiv.org/html/2310.06770"
publishedAt: "2023-10-10T16:47:29Z"
capturedAt: "2026-08-10T12:35:00+08:00"
versionRef: "arXiv:2310.06770 (ar5iv HTML mirror); ICLR 2024 version"
mediaType: paper
language: en
usage: internal-only
accessStatus: full
snapshotHash: "sha256:d0efffd9f6cc70893c80517d45ac259cb28191d74d5b4ff7935519c852bd5321"
collectionMethod: public-page
licenseOrUsageNote: "ar5iv 为 arXiv 论文的 HTML 镜像；内部评测只保留可定位的连续摘录。"
collectionNotes: "ar5iv.labs.arxiv.org 全文 HTML。CSS 渲染导致部分数字在文本提取中重复（如 22942294），引文只选择提取干净的句子。"
---

# SWE-bench full text (ar5iv HTML mirror of arXiv:2310.06770)

## Source Snapshot

*Verbatim excerpts from https://ar5iv.labs.arxiv.org/html/2310.06770 (captured 2026-08-10).*

### Title page

> SWE-bench: Can Language Models Resolve Real-World GitHub Issues?
>
> Carlos E. Jimenez* 1,2  John Yang* 1,2  Alexander Wettig1,2
> Shunyu Yao1,2  Kexin Pei3  Ofir Press1,2  Karthik Narasimhan1,2
> 1Princeton University  2Princeton Language and Intelligence  3University of Chicago

### 1 Introduction (verbatim excerpts)

> Language models (LMs) are rapidly being deployed in commercial products such as chatbots and coding assistants.
>
> At the same time, existing benchmarks have become saturated (Kiela et al., 2021; Ott et al., 2022) and fail to capture the frontier of what state-of-the-art LMs can and cannot do.
>
> There is a need for challenging benchmarks that more accurately reflect real-world applications of LMs to help shape their future development and usage (Srivastava et al., 2023).

> Building a good benchmark is difficult since tasks must be challenging enough to stump existing models, but model predictions must also be easy to verify (Martínez-Plumed et al., 2021).
>
> Coding tasks are appealing as they pose challenging problems to LMs and generated solutions can be easily verified by running unit tests.
>
> However, existing coding benchmarks, such as HumanEval (Chen et al., 2021), mostly involve self-contained problems that can be solved in a few lines of code.
>
> In the real world, software engineering is not as simple.
>
> Fixing a bug might involve navigating a large repository, understanding the interplay between functions in different files, or spotting a small error in convoluted code.

> Inspired by this, we introduce SWE-bench, a benchmark that evaluates LMs in a realistic software engineering setting.
>
> As shown in Figure 1, models are tasked to resolve issues (typically a bug report or a feature request) submitted to popular GitHub repositories.
>
> Each task requires generating a patch describing changes to apply to the existing codebase.
>
> The revised codebase is then evaluated using the repository's testing framework.

> We evaluate SWE-bench on multiple state-of-the-art LMs and find that they fail to solve all except the simplest issues.
>
> For instance, Claude 2 and GPT-4 only resolve 4.8% and 1.7% of tasks respectively; even using an oracle that retrieves the files to edit from a reference solution.
>
> Using a BM25 retriever, performance drops further to 1.96% for Claude 2.

> To aid open model development in this direction, we release a training dataset, SWE-bench-train consisting of 19000 non-testing task instances from 37 other repositories.
>
> Using this dataset, we finetune two models, SWE-Llama 7b and 13b based on CodeLlama (Rozière et al., 2023), that are competitive with Claude 2 and can solve issues using over 100000 tokens as context.

### 2.1 Benchmark Construction (verbatim excerpt)

> To find high-quality task instances at scale, we use a 3-stage pipeline as follows.
>
> Stage I: Repo selection and data scraping.
>
> We start by collecting pull requests (PRs) from 12 popular open-source Python repositories on GitHub, producing about ~90000 PRs in total.
>
> We focus on popular repositories as they tend be better maintained, have clear contributor guidelines, and have better test coverage.
>
> Each PR has an associated codebase, which is the state of the repository before the PR was merged.

## Research Notes

- 来源角色 P-primary：论文全文镜像（ar5iv）。
- 版本差异：v3 正文给出"Claude 2 与 GPT-4 在 oracle 检索下分别 4.8% 与 1.7%"；而 2023 版摘要（s200-ai-swebench-001）只提"Claude 2 解 1.96%"（BM25）。这是"为什么答案随时间改变"的候选测试点。
- 引文说明：ar5iv 的 CSS 渲染导致数字字符在纯文本提取中重复（如 "4.84.8"），故本快照只选择提取干净的连续句子，并在 Research Notes 中披露。
- SWE-Llama（7b/13b）、SWE-bench-train（19,000 例/37 仓库）数据点为后续版本演化提供 T0 基线。
