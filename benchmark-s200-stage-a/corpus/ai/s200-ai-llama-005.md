---
sourceId: s200-ai-llama-005
title: "Introducing Llama 3.1: Our most capable models to date (Simon Willison)"
domain: ai
clusterId: cluster-ai-llama-01
sourceRole: S-analysis
platform: personal-blog
author: "Simon Willison"
canonicalUrl: "https://simonwillison.net/2024/Jul/23/introducing-llama-31/"
publishedAt: "2024-07-23T15:40:00Z"
capturedAt: "2026-08-10T12:35:00+08:00"
versionRef: null
mediaType: article
language: en
usage: internal-only
accessStatus: full
snapshotHash: "sha256:80d85be4306188f6e2a95832f351429def1f5638fe3de7eca6c9ba5b83a86880"
collectionMethod: public-page
licenseOrUsageNote: "simonwillison.net 博客为 CC BY 4.0；内部评测使用，保留作者署名。"
collectionNotes: "链接博客（link blog）正文完整抓取；作者是知名开发者/博客作者，属二手分析角色。"
---

# Introducing Llama 3.1: Our most capable models to date (Simon Willison)

## Source Snapshot

*Verbatim from https://simonwillison.net/2024/Jul/23/introducing-llama-31/ (captured 2026-08-10). CC BY 4.0.*

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

## Research Notes

- 来源角色 S-analysis：独立开发者/研究者对发布当日的解读（2024-07-23，与发布同日）。
- 文中引用了 Meta 的"first frontier-level open source AI model"措辞与 FP8 量化说明——但要注意：文中以引述形式转述 Meta 原文（引用块），属二手引用。
- 与 s200-ai-llama-006（HN）为同一事件（Llama 3.1 发布）的不同证据层。
- 可测试点：作者对"open source"一词的使用与 LICENSE（s200-ai-llama-004）实际条款（700M MAU 门槛）之间的张力。
