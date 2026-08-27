---
sourceId: s200-ai-llama-001
title: "The Llama 3 Herd of Models (arXiv:2407.21783)"
domain: ai
clusterId: cluster-ai-llama-01
sourceRole: P-primary
platform: arxiv
author: "Aaron Grattafiori et al. (Meta AI, 558+ authors)"
canonicalUrl: "https://arxiv.org/abs/2407.21783"
publishedAt: "2024-07-31T17:54:27Z"
capturedAt: "2026-08-10T12:35:00+08:00"
versionRef: "arXiv:2407.21783v3 (last revised 2024-11-23); DOI 10.48550/arXiv.2407.21783"
mediaType: paper
language: en
usage: internal-only
accessStatus: full
snapshotHash: "sha256:62c7fd2235643324e538e164da321b63477a058ce30da379d46b64267b50d118"
collectionMethod: public-page
licenseOrUsageNote: "arXiv 摘要页公开内容；论文文本受版权保护，此处只保存官方摘要与元数据。"
collectionNotes: "arXiv 摘要页（abs 2407.21783）。作者列表极长，只保留代表性摘录与 et al. 表述。"
---

# The Llama 3 Herd of Models (arXiv:2407.21783)

## Source Snapshot

*Verbatim from https://arxiv.org/abs/2407.21783 (captured 2026-08-10).*

### Metadata

> Computer Science > Artificial Intelligence
>
> arXiv:2407.21783 (cs)
>
> [Submitted on 31 Jul 2024 (v1), last revised 23 Nov 2024 (this version, v3)]
>
> Title: The Llama 3 Herd of Models
>
> Authors: Aaron Grattafiori, Abhimanyu Dubey, Abhinav Jauhri, Abhinav Pandey, Abhishek Kadian, Ahmad Al-Dahle, Aiesha Letman, Akhil Mathur, Alan Schelten, ... et al. (460 additional authors not shown)

### Abstract (verbatim)

> Modern artificial intelligence (AI) systems are powered by foundation models. This paper presents a new set of foundation models, called Llama 3. It is a herd of language models that natively support multilinguality, coding, reasoning, and tool usage. Our largest model is a dense Transformer with 405B parameters and a context window of up to 128K tokens. This paper presents an extensive empirical evaluation of Llama 3. We find that Llama 3 delivers comparable quality to leading language models such as GPT-4 on a plethora of tasks. We publicly release Llama 3, including pre-trained and post-trained versions of the 405B parameter language model and our Llama Guard 3 model for input and output safety. The paper also presents the results of experiments in which we integrate image, video, and speech capabilities into Llama 3 via a compositional approach. We observe this approach performs competitively with the state-of-the-art on image, video, and speech recognition tasks. The resulting models are not yet being broadly released as they are still under development.

### Subjects / Cite as / History

> Subjects: Artificial Intelligence (cs.AI); Computation and Language (cs.CL); Computer Vision and Pattern Recognition (cs.CV)
>
> Cite as: arXiv:2407.21783 [cs.AI] (or arXiv:2407.21783v3 [cs.AI] for this version)
>
> https://doi.org/10.48550/arXiv.2407.21783

> Submission history
> From: Laurens Van Der Maaten [view email]
> [v1] Wed, 31 Jul 2024 17:54:27 UTC (6,715 KB)
> [v2] Thu, 15 Aug 2024 13:57:20 UTC (6,723 KB)
> [v3] Sat, 23 Nov 2024 23:27:33 UTC (6,722 KB)

## Research Notes

- 来源角色 P-primary：Meta 官方论文（含 405B/128K 上下文/与 GPT-4 对比等核心声明）。
- 版本链：v1（2024-07-31）→ v2（2024-08-15）→ v3（2024-11-23），arXiv 版本可追踪。
- 与 s200-ai-llama-002（model card）互补：论文面向训练/评估方法，model card 面向部署与许可。
- 论文中模型发布与 s200-ai-llama-005（Simon Willison）解读、s200-ai-llama-006（HN）同日事件形成 T0 事件簇。
- 注意：论文称"publicly release ... pre-trained and post-trained versions of the 405B"——与社区对"开源"定义的争论（见 HN 线程）构成归属/术语冲突测试点。
