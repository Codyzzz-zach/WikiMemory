---
sourceId: s200-ai-llama-003
title: "Meta Llama 3 repository README (deprecated repo, pinned)"
domain: ai
clusterId: cluster-ai-llama-01
sourceRole: H-historical
platform: github
author: "meta-llama"
canonicalUrl: "https://github.com/meta-llama/llama3/blob/main/README.md"
publishedAt: "2024-04-18"
capturedAt: "2026-08-10T12:35:00+08:00"
versionRef: "commit a0940f9cf7065d45bb6675660f80d305c041a754 (2025-01-26); repository deprecated after Llama 3.1"
mediaType: repository-readme
language: en
usage: internal-only
accessStatus: full
snapshotHash: "sha256:9335dfba64e807949d3948aaea21f28ca98e5513f8be5a9ea5f81ae9921f2bf0"
collectionMethod: public-api
licenseOrUsageNote: "MIT-licensed repository content; internal benchmark use only."
collectionNotes: "meta-llama/llama3 为已被 Llama 3.1 取代的历史仓库（README 自带弃用声明）。该快照是 H-historical 角色：描述 Llama 3（8B/70B），不含 405B。"
---

# Meta Llama 3 repository README (deprecated repo, pinned)

## Source Snapshot


### Note of deprecation (verbatim)

> ## **Note of deprecation**
>
> Thank you for developing with Llama models. As part of the Llama 3.1 release, we've consolidated GitHub repos and added some additional repos as we've expanded Llama's functionality into being an e2e Llama Stack. Please use the following repos going forward:
>
> - [llama-models](https://github.com/meta-llama/llama-models) - Central repo for the foundation models including basic utilities, model cards, license and use policies
> - [PurpleLlama](https://github.com/meta-llama/PurpleLlama) - Key component of Llama Stack focusing on safety risks and inference time mitigations
> - [llama-toolchain](https://github.com/meta-llama/llama-toolchain) - Model development (inference/fine-tuning/safety shields/synthetic data generation) interfaces and canonical implementations
> - [llama-agentic-system](https://github.com/meta-llama/llama-agentic-system) - E2E standalone Llama Stack system, along with opinionated underlying interface, that enables creation of agentic applications
> - [llama-cookbook](https://github.com/meta-llama/llama-recipes) - Community driven scripts and integrations

### Repository body (verbatim, pre-deprecation content)

> # (Deprecated) Meta Llama 3
>
> We are unlocking the power of large language models. Our latest version of Llama is now accessible to individuals, creators, researchers, and businesses of all sizes so that they can experiment, innovate, and scale their ideas responsibly.
>
> This release includes model weights and starting code for pre-trained and instruction-tuned Llama 3 language models — including sizes of 8B to 70B parameters.
>
> This repository is a minimal example of loading Llama 3 models and running inference. For more detailed examples, see [llama-cookbook](https://github.com/facebookresearch/llama-recipes/).

### Download (verbatim)

> To download the model weights and tokenizer, please visit the [Meta Llama website](https://llama.meta.com/llama-downloads/) and accept our License.
>
> Once your request is approved, you will receive a signed URL over email. Then, run the download.sh script, passing the URL provided when prompted to start the download.
>
> Pre-requisites: Ensure you have `wget` and `md5sum` installed. Then run the script: `./download.sh`.
>
> Remember that the links expire after 24 hours and a certain amount of downloads. You can always re-request a link if you start seeing errors such as `403: Forbidden`.

## Research Notes
> Curator provenance: Verbatim from https://raw.githubusercontent.com/meta-llama/llama3/a0940f9cf7065d45bb6675660f80d305c041a754/README.md (captured 2026-08-10).（本行为 curator 添加的采集说明，非上游文本。）

- 来源角色 H-historical：这是被 Llama 3.1 取代的历史仓库快照，README 中"8B to 70B parameters"只描述 Llama 3（无 405B）。
- 与 s200-ai-llama-002（Llama 3.1 model card）构成版本演化对照：Llama 3（8B/70B）→ Llama 3.1（8B/70B/405B + 128k context + 许可变更）。
- 仓库弃用声明证明"meta-llama/llama3 已归档，迁移至 llama-models 等仓库"——影响追踪测试材料。
- 该仓库默认分支为 main（快照固定到 commit a0940f9c）。
