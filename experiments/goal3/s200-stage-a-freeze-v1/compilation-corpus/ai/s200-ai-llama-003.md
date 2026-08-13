---
sourceId: s200-ai-llama-003
title: Meta Llama 3 repository README (deprecated repo, pinned)
domain: ai
clusterId: cluster-ai-llama-01
sourceRole: H-historical
platform: github
author: meta-llama
canonicalUrl: https://github.com/meta-llama/llama3/blob/main/README.md
publishedAt: '2024-04-18'
capturedAt: '2026-08-10T12:35:00+08:00'
versionRef: commit a0940f9cf7065d45bb6675660f80d305c041a754 (2025-01-26); repository deprecated after Llama 3.1
mediaType: repository-readme
language: en
usage: internal-only
accessStatus: full
evaluatorRawSnapshotHash: sha256:9335dfba64e807949d3948aaea21f28ca98e5513f8be5a9ea5f81ae9921f2bf0
evaluatorNormalizedSnapshotHash: sha256:9335dfba64e807949d3948aaea21f28ca98e5513f8be5a9ea5f81ae9921f2bf0
evaluatorUpstreamArtifactHash: sha256:0c30a82748154ea90f45f2f1637a26d90b24fead2840d8efec1f381520d26678
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
