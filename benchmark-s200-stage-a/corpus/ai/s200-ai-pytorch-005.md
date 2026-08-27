---
sourceId: s200-ai-pytorch-005
title: "What's New in PyTorch 2.0? torch.compile (PyImageSearch)"
domain: ai
clusterId: cluster-ai-pytorch-01
sourceRole: S-analysis
platform: education-blog
author: "Puneet Mangla (PyImageSearch)"
canonicalUrl: "https://pyimagesearch.com/2023/03/27/whats-new-in-pytorch-2-0-torch-compile/"
publishedAt: "2023-03-27"
capturedAt: "2026-08-10T12:35:00+08:00"
versionRef: null
mediaType: tutorial
language: en
usage: internal-only
accessStatus: partial
snapshotHash: "sha256:2aa4e44ae87bcec9a7aca4a85f0bb6625866f15da4bea81ed1e8b749bc3cbb40"
collectionMethod: public-page
licenseOrUsageNote: "Copyright PyImageSearch; 仅保存内部评测所需的连续短摘录，不公开再发布全文。"
collectionNotes: "版权受限：只保留 4-6 个连续片段（介绍、时间线、结论），不保存代码正文全文。"
---

# What's New in PyTorch 2.0? torch.compile (PyImageSearch)

## Source Snapshot

*Verbatim excerpts from https://pyimagesearch.com/2023/03/27/whats-new-in-pytorch-2-0-torch-compile/ (captured 2026-08-10). Copyright PyImageSearch; internal benchmark use only.*

> What's New in PyTorch 2.0? torch.compile
>
> by Puneet Mangla on March 27, 2023

> Over the last few years, PyTorch has evolved as a popular and widely used framework for training deep neural networks (DNNs). The success of PyTorch is attributed to its simplicity, first-class Python integration, and imperative style of programming. Since the launch of PyTorch in 2017, it has strived for high performance and eager execution. It has provided some of the best abstractions for distributed training, data loading, and automatic differentiation.

> With continuous innovation from the PyTorch team, PyTorch has moved from version 1.0 to the most recent version, 1.13. However, over all these years, hardware accelerators like GPUs have become 15x and 2x faster in compute and memory access, respectively. Thus, to leverage these resources and deliver high-performance eager execution, the team moved substantial parts of PyTorch internals to C++.

> On December 2, 2022, the team announced the launch of PyTorch 2.0, a next-generation release that will make training deep neural networks much faster and support dynamic shapes. The stable release of PyTorch 2.0 is planned for March 2023. This blog series aims to understand and test the capabilities of PyTorch 2.0 via its beta release.

> This lesson is the 1st of a 2-part series on Accelerating Deep Learning Models with PyTorch 2.0:
> - What's New in PyTorch 2.0? torch.compile (today's tutorial)
> - What's Behind PyTorch 2.0? TorchDynamo and TorchInductor (primarily for developers)

> Like previous versions, PyTorch 2.0 is available as a Python pip package. However, to successfully install PyTorch 2.0, your system should have installed the latest CUDA (Compute Unified Device Architecture) versions (11.6 and 11.7).

> Since torch.compile is backward compatible, all other operations (e.g., reading and updating attributes, serialization, distributed learning, inference, and export) would work just as PyTorch 1.x. Whenever you wrap your model under torch.compile, the model goes through the following steps before execution (Figure 3): Graph Acquisition: The model is broken down and re-written into subgraphs. Subgraphs that can be compiled/optimized are flattened, whereas other subgraphs which can't be compiled fall back to the eager model. Graph Lowering: All PyTorch operations are decomposed into their chosen backend-specific kernels. Graph Compilation: All the backend kernels call their corresponding low-level device operations.

## Research Notes

- 来源角色 S-analysis：第三方教育博客对 PyTorch 2.0 的解读与教程（2023-03-27，晚于官方发布 12 天）。
- 与官方材料关系：该文复述官方"15x/2x 加速"与"12/2/22 宣布"等事实，可用于测试"二手解释是否忠实于一手来源"（归属/条件）。
- 版权受限：仅保存连续短摘录，正文与代码未全部收录；不得将其作为官方事实的独立裁判。
