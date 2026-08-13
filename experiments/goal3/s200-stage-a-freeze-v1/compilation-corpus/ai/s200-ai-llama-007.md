---
sourceId: s200-ai-llama-007
title: 最大开源模型Llama 3.1 405B发布，国产曙光?（geekdaxue 知识库镜像）
domain: ai
clusterId: cluster-ai-llama-01
sourceRole: S-analysis
platform: knowledge-base
author: geekdaxue 知识库（AI大模型知识手册）
canonicalUrl: https://geekdaxue.co/read/abiao-ifgtk@etbfaz/rtc15kfx2iun00lp
publishedAt: '2025-01-03T09:05:36+08:00'
capturedAt: '2026-08-10T12:35:00+08:00'
versionRef: 'null'
mediaType: article
language: zh-CN
usage: internal-only
accessStatus: partial
evaluatorRawSnapshotHash: sha256:041fc1849682bf1dc5f1a57b7eec62cf83c4bbaf0dcac57b68155432941093ff
evaluatorNormalizedSnapshotHash: sha256:041fc1849682bf1dc5f1a57b7eec62cf83c4bbaf0dcac57b68155432941093ff
evaluatorUpstreamArtifactHash: sha256:3d32a1692fcae44999126333a6bc61ca309ccd683537a462e1e7ddbff56e698a
---

# 最大开源模型Llama 3.1 405B发布，国产曙光?（geekdaxue 知识库镜像）

## Source Snapshot

### 概要

> 刚才Meta如约发布了Llama3.1系列模型，其中就有大家翘首以盼的405B模型。

> 这是是全球最大、最有能力的可公开获取的基础模型，标志着开源大型语言模型进入了新时代。

> 该模型支持八种语言，上下文长度达到 128K，并且在多个基准数据集上进行了评估，表现出与 GPT-4 和其他高端模型相当的竞争力。

> Meta 还提供了 Llama Guard 3 和 Prompt Guard 等安全工具，以及 Llama Stack API 的评论请求，旨在促进第三方项目更容易地利用 Llama 模型。

### 小扎声明

> 他认为开源人工智能（如 Llama 3.1）是未来发展的正确道路，它能够促进 AI 技术的更广泛的应用和创新，同时也有助于 Meta 保持技术领先地位和商业模式的可持续性。

### 模型评估

> 从评估结果来看405B模型确实超过了0314版本的GPT-4，但是405B相较于70B的提升有限，可能405B模型的训练对Llama来说也是个不小的挑战，剩下的工作就交给开源社区做了。

> 实验评估表明，旗舰模型在包括 GPT-4、GPT-4o 和 Claude 3.5 Sonnet 在内的一系列任务上具有竞争力。

### 模型架构

> 由于Llama 3.1 405B的训练量超过了15 万亿个Token。总共使用了 16,000 个 H100 GPU 才完成，这个量级在国内几个大厂还是可以拿出来的。

> 为了支持 405B 规模模型的大规模生产推理，将模型从 16 位 (BF16) 量化到 8 位 (FP8) 数值，从而有效降低了计算要求，使模型可以在单个服务器节点内运行。
