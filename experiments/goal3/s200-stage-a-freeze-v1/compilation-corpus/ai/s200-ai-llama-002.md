---
sourceId: s200-ai-llama-002
title: Llama 3.1 Model Card (meta-llama/llama-models)
domain: ai
clusterId: cluster-ai-llama-01
sourceRole: P-primary
platform: github
author: Meta
canonicalUrl: https://github.com/meta-llama/llama-models/blob/main/models/llama3_1/MODEL_CARD.md
publishedAt: '2024-07-23'
capturedAt: '2026-08-10T12:35:00+08:00'
versionRef: commit e2e67cd8b0feca839666b7082dcc1c4fc0ae11e2 (2024-09-30); MODEL_CARD.md for Llama 3.1
mediaType: model-card
language: en
usage: internal-only
accessStatus: full
evaluatorRawSnapshotHash: sha256:7788ac58a7d5766516165c1c91a93729fe80d766498a4ebd59c554a292a2a68c
evaluatorNormalizedSnapshotHash: sha256:7788ac58a7d5766516165c1c91a93729fe80d766498a4ebd59c554a292a2a68c
evaluatorUpstreamArtifactHash: sha256:072649538862a93a6ebd7083b8678d0bcba8dbc17fa400eb2aa887acd5396aef
---

# Llama 3.1 Model Card (meta-llama/llama-models)

## Source Snapshot

### Model Information

> The Meta Llama 3.1 collection of multilingual large language models (LLMs) is a collection of pretrained and instruction tuned generative models in 8B, 70B and 405B sizes (text in/text out). The Llama 3.1 instruction tuned text only models (8B, 70B, 405B) are optimized for multilingual dialogue use cases and outperform many of the available open source and closed chat models on common industry benchmarks.

> **Model developer:** Meta
>
> **Model Architecture:** Llama 3.1 is an auto-regressive language model that uses an optimized transformer architecture. The tuned versions use supervised fine-tuning (SFT) and reinforcement learning with human feedback (RLHF) to align with human preferences for helpfulness and safety.

> **Supported languages:** English, German, French, Italian, Portuguese, Hindi, Spanish, and Thai.

> **Model Release Date:** July 23, 2024.

> **Status:** This is a static model trained on an offline dataset. Future versions of the tuned models will be released as we improve model safety with community feedback.

> **License:** A custom commercial license, the Llama 3.1 Community License, is available at: https://github.com/meta-llama/llama-models/blob/main/models/llama3_1/LICENSE

### Size / context table (verbatim)

| | Params | Input modalities | Output modalities | Context length | GQA | Token count | Knowledge cutoff |
|---|---|---|---|---|---|---|---|
| Llama 3.1 (text only) | 8B | Multilingual Text | Multilingual Text and code | 128k | Yes | 15T+ | December 2023 |
| Llama 3.1 (text only) | 70B | Multilingual Text | Multilingual Text and code | 128k | Yes | | |
| Llama 3.1 (text only) | 405B | Multilingual Text | Multilingual Text and code | 128k | Yes | | |

> Llama 3.1 family of models. Token counts refer to pretraining data only. All model versions use Grouped-Query Attention (GQA) for improved inference scalability.

### Intended Use

> **Intended Use Cases** Llama 3.1 is intended for commercial and research use in multiple languages. Instruction tuned text only models are intended for assistant-like chat, whereas pretrained models can be adapted for a variety of natural language generation tasks. The Llama 3.1 model collection also supports the ability to leverage the outputs of its models to improve other models including synthetic data generation and distillation. The Llama 3.1 Community License allows for these use cases.

> **Out-of-scope** Use in any manner that violates applicable laws or regulations (including trade compliance laws). Use in any other way that is prohibited by the Acceptable Use Policy and Llama 3.1 Community License. Use in languages beyond those explicitly referenced as supported in this model card.

### Hardware and Software

> **Training Factors** We used custom training libraries, Meta's custom built GPU cluster, and production infrastructure for pretraining. Fine-tuning, annotation, and evaluation were also performed on production infrastructure.

> **Training Energy Use** Training utilized a cumulative of **39.3**M GPU hours of computation on H100-80GB (TDP of 700W) type hardware, per the table below. Training time is the total GPU time required for training each model and power consumption is the peak power capacity per GPU device used, adjusted for power usage efficiency.

> **Training Greenhouse Gas Emissions** Estimated total location-based greenhouse gas emissions were **11,390** tons CO2eq for training. Since 2020, Meta has maintained net zero greenhouse gas emissions in its global operations and matched 100% of its electricity use with renewable energy, therefore the total market-based greenhouse gas emissions for training were 0 tons CO2eq.
