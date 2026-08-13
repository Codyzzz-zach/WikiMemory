---
sourceId: s200-ai-llama-005
title: 'Introducing Llama 3.1: Our most capable models to date (Simon Willison)'
domain: ai
clusterId: cluster-ai-llama-01
sourceRole: S-analysis
platform: personal-blog
author: Simon Willison
canonicalUrl: https://simonwillison.net/2024/Jul/23/introducing-llama-31/
publishedAt: '2024-07-23T15:40:00Z'
capturedAt: '2026-08-10T12:35:00+08:00'
versionRef: 'null'
mediaType: article
language: en
usage: internal-only
accessStatus: full
evaluatorRawSnapshotHash: sha256:cec5cbfb0782f5f7bb82849eae5180fd042c9dfe9445720877593aa521416313
evaluatorNormalizedSnapshotHash: sha256:cec5cbfb0782f5f7bb82849eae5180fd042c9dfe9445720877593aa521416313
evaluatorUpstreamArtifactHash: sha256:4afb4c8c2d15806fd4db3a4bafe7099c29512628e0e2f0ecb0744fdffd073b74
---

# Introducing Llama 3.1: Our most capable models to date (Simon Willison)

## Source Snapshot

> 23rd July 2024 - Link Blog

> Introducing Llama 3.1: Our most capable models to date. We've been waiting for the largest release of the Llama 3 model for a few months, and now we're getting a whole new model family instead.

> Meta are calling Llama 3.1 405B "the first frontier-level open source AI model" and it really is benchmarking in that GPT-4+ class, competitive with both GPT-4o and Claude 3.5 Sonnet.

> I'm equally excited by the new 8B and 70B 3.1 models - both of which now support a 128,000 token context and benchmark significantly higher than their Llama 3 equivalents. Same-sized models getting more powerful and capable a very reassuring trend. I expect the 8B model (or variants of it) to run comfortably on an array of consumer hardware, and I've run a 70B model on a 64GB M2 in the past.

> The 405B model can at least be run on a single server-class node:

> To support large-scale production inference for a model at the scale of the 405B, we quantized our models from 16-bit (BF16) to 8-bit (FP8) numerics, effectively lowering the compute requirements needed and allowing the model to run within a single server node.

> Meta also made a significant change to the license:

> We've also updated our license to allow developers to use the outputs from Llama models — including 405B — to improve other models for the first time.

> I'm really pleased to see this. Using models to help improve other models has been a crucial technique in LLM research for over a year now, especially for fine-tuned community models release on Hugging Face. Researchers have mostly been ignoring this restriction, so it's reassuring to see the uncertainty around that finally cleared up.

> Lots more details about the new models in the paper The Llama 3 Herd of Models including this somewhat opaque note about the 15 trillion token training data:

> Our final data mix contains roughly 50% of tokens corresponding to general knowledge, 25% of mathematical and reasoning tokens, 17% code tokens, and 8% multilingual tokens.

> Update: I got the Llama 3.1 8B Instruct model working with my LLM tool via a new plugin, llm-gguf.
