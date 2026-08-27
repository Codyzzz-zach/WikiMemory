---
sourceId: s200-ai-pytorch-001
title: "Introducing PyTorch 2.0 (official overview page)"
domain: ai
clusterId: cluster-ai-pytorch-01
sourceRole: P-primary
platform: official
author: "PyTorch team (Linux Foundation / Meta)"
canonicalUrl: "https://pytorch.org/get-started/pytorch-2-x/"
publishedAt: "2023-03-15"
capturedAt: "2026-08-10T12:35:00+08:00"
versionRef: "PyTorch 2.0 announcement (2023-03-15); page captured 2026-08-10"
mediaType: docs
language: en
usage: internal-only
accessStatus: full
snapshotHash: "sha256:3bfc62fc1f647b111640e6a61da81411f8b50a8d340b1cb1f4e5b52d6faf164e"
collectionMethod: public-page
licenseOrUsageNote: "PyTorch docs, open documentation; internal benchmark use only."
collectionNotes: "官方 PyTorch 2.0 介绍页（get-started/pytorch-2-x）。注意 /blog/pytorch-2.0/ 与 /blog/pytorch-2.6/ 旧 slug 现跳转到活动列表页，正式内容在此页。"
---

# Introducing PyTorch 2.0 (official overview page)

## Source Snapshot

*Verbatim from https://pytorch.org/get-started/pytorch-2-x/ (captured 2026-08-10).*

### Overview

> Introducing PyTorch 2.0, our first steps toward the next generation 2-series release of PyTorch. Over the last few years we have innovated and iterated from PyTorch 1.0 to the most recent 1.13 and moved to the newly formed PyTorch Foundation, part of the Linux Foundation.
>
> PyTorch's biggest strength beyond our amazing community is that we continue as a first-class Python integration, imperative style, simplicity of the API and options. PyTorch 2.0 offers the same eager-mode development and user experience, while fundamentally changing and supercharging how PyTorch operates at compiler level under the hood. We are able to provide faster performance and support for Dynamic Shapes and Distributed.

### PyTorch 2.x: faster, more pythonic and as dynamic as ever

> Today, we announce torch.compile, a feature that pushes PyTorch performance to new heights and starts the move for parts of PyTorch from C++ back into Python. We believe that this is a substantial new direction for PyTorch – hence we call it 2.0. torch.compile is a fully additive (and optional) feature and hence 2.0 is 100% backward compatible by definition.

> Underpinning torch.compile are new technologies – TorchDynamo, AOTAutograd, PrimTorch and TorchInductor.
>
> TorchDynamo captures PyTorch programs safely using Python Frame Evaluation Hooks and is a significant innovation that was a result of 5 years of our R&D into safe graph capture
>
> AOTAutograd overloads PyTorch's autograd engine as a tracing autodiff for generating ahead-of-time backward traces.
>
> PrimTorch canonicalizes ~2000+ PyTorch operators down to a closed set of ~250 primitive operators that developers can target to build a complete PyTorch backend. This substantially lowers the barrier of writing a PyTorch feature or backend.
>
> TorchInductor is a deep learning compiler that generates fast code for multiple accelerators and backends. For NVIDIA and AMD GPUs, it uses OpenAI Triton as a key building block.

### Motivation

> Our philosophy on PyTorch has always been to keep flexibility and hackability our top priority, and performance as a close second. We strived for:
>
> High-Performance eager execution
> Pythonic internals
> Good abstractions for Distributed, Autodiff, Data loading, Accelerators, etc.
>
> Since we launched PyTorch in 2017, hardware accelerators (such as GPUs) have become ~15x faster in compute and about ~2x faster in the speed of memory access. So, to keep eager execution at high-performance, we've had to move substantial parts of PyTorch internals into C++. Moving internals into C++ makes them less hackable and increases the barrier of entry for code contributions.

### TorchDynamo: Acquiring Graphs reliably and fast

> Earlier this year, we started working on TorchDynamo, an approach that uses a CPython feature introduced in PEP-0523 called the Frame Evaluation API. We took a data-driven approach to validate its effectiveness on Graph Capture. We used 7,000+ Github projects written in PyTorch as our validation set. While TorchScript and others struggled to even acquire the graph 50% of the time, often with a big overhead, TorchDynamo acquired the graph 99% of the time, correctly, safely and with negligible overhead – without needing any changes to the original code.

### User Experience

> We introduce a simple function torch.compile that wraps your model and returns a compiled model.
>
> ```
> compiled_model = torch.compile(model)
> ```
>
> mode specifies what the compiler should be optimizing while compiling.
>
> The default mode is a preset that tries to compile efficiently without taking too long to compile or using extra memory.
>
> Other modes such as reduce-overhead reduce the framework overhead by a lot more, but cost a small amount of extra memory. max-autotune compiles for a long time, trying to give you the fastest code it can generate.

### Benchmark results

> To validate these technologies, we used a diverse set of 163 open-source models across various machine learning domains. We built this benchmark carefully to include tasks such as Image Classification, Object Detection, Image Generation, various NLP tasks such as Language Modeling, Q&A, Sequence Classification, Recommender Systems and Reinforcement Learning.

> Across these 163 open-source models torch.compile works 93% of time, and the model runs 43% faster in training on an NVIDIA A100 GPU. At Float32 precision, it runs 21% faster on average and at AMP Precision it runs 51% faster on average.

### Caveats

> On a desktop-class GPU such as a NVIDIA 3090, we've measured that speedups are lower than on server-class GPUs such as A100.
>
> As of today, our default backend TorchInductor supports CPUs and NVIDIA Volta and Ampere GPUs. It does not (yet) support other GPUs, xPUs or older NVIDIA GPUs.

## Research Notes

- 来源角色 P-primary：PyTorch 官方对 2.0 的正式介绍，包含 torch.compile 能力声明与 163 模型基准数字。
- 版本链：本文为 2.0 锚点（T0，2023-03-15）；s200-ai-pytorch-002（v2.6.0 release）与 s200-ai-pytorch-003（v2.0.0 release notes）构成后续版本点。
- 注意点：官方后来在 2.6 release note 中宣布 `torch.load` 的 `weights_only` 默认值改为 True（向后不兼容）——与本文"100% backward compatible"仅指 torch.compile 的 additive 性质，需区分范围。
- 抓取时 /blog/pytorch-2.0/ 已跳转活动页，正式文本以此 get-started 页为准（见 collection log）。
