---
sourceId: s200-ai-pytorch-005
title: What's New in PyTorch 2.0? torch.compile (PyImageSearch)
domain: ai
clusterId: cluster-ai-pytorch-01
sourceRole: S-analysis
platform: education-blog
author: Puneet Mangla (PyImageSearch)
canonicalUrl: https://pyimagesearch.com/2023/03/27/whats-new-in-pytorch-2-0-torch-compile/
publishedAt: '2023-03-27'
capturedAt: '2026-08-10T12:35:00+08:00'
versionRef: 'null'
mediaType: tutorial
language: en
usage: internal-only
accessStatus: partial
evaluatorRawSnapshotHash: sha256:d48390322db46d94d16d7cb51d43bb7c60eb60326a501890c902d783c09af02e
evaluatorNormalizedSnapshotHash: sha256:d48390322db46d94d16d7cb51d43bb7c60eb60326a501890c902d783c09af02e
evaluatorUpstreamArtifactHash: sha256:5afeea78ea342020258b4376fa7a34230b180633822e535ac9bc501950ec8679
---

# What's New in PyTorch 2.0? torch.compile (PyImageSearch)

## Source Snapshot

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
