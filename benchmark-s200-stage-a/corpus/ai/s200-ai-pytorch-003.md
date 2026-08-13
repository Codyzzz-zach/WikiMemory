---
sourceId: s200-ai-pytorch-003
title: "PyTorch 2.0.0 Release (GitHub release notes)"
domain: ai
clusterId: cluster-ai-pytorch-01
sourceRole: C-implementation
platform: github
author: "PyTorch team (GitHub release published by drisspg)"
canonicalUrl: "https://github.com/pytorch/pytorch/releases/tag/v2.0.0"
publishedAt: "2023-03-15T19:38:58Z"
capturedAt: "2026-08-10T12:35:00+08:00"
versionRef: "GitHub tag v2.0.0; target_commitish release/2.0; published 2023-03-15"
mediaType: release-notes
language: en
usage: internal-only
accessStatus: full
snapshotHash: "sha256:b7c549c23f89d8470f76aa819af878bad0ab8c6d39dd62ae4d82c5e247cebeca"
collectionMethod: public-api
licenseOrUsageNote: "GitHub release notes (MIT-licensed repo); internal benchmark use only."
collectionNotes: "经 GitHub Releases API 抓取 v2.0.0 release note 主体（Highlights 段）。tag 指向 commit c263bd43e8e8502d4726643bc6fd046f0130ac0e（见 s200-ai-pytorch-004）。"
---

# PyTorch 2.0.0 Release (GitHub release notes)

## Source Snapshot

*Verbatim from GitHub Releases API, https://api.github.com/repos/pytorch/pytorch/releases/tags/v2.0.0 (captured 2026-08-10).*

### Release metadata

```json
{
  "html_url": "https://github.com/pytorch/pytorch/releases/tag/v2.0.0",
  "tag_name": "v2.0.0",
  "target_commitish": "release/2.0",
  "name": "PyTorch 2.0: Our next generation release that is faster, more Pythonic and Dynamic as ever",
  "draft": false,
  "prerelease": false,
  "created_at": "2023-03-09T22:42:00Z",
  "published_at": "2023-03-15T19:38:58Z"
}
```

### Highlights (verbatim from release body)

> We are excited to announce the release of PyTorch® 2.0 ([release note](https://github.com/pytorch/pytorch/releases)) which we highlighted during the [PyTorch Conference](https://www.youtube.com/@PyTorch/playlists?view=50&sort=dd&shelf_id=2) on 12/2/22! PyTorch 2.0 offers the same eager-mode development and user experience, while fundamentally changing and supercharging how PyTorch operates at compiler level under the hood with faster performance and support for Dynamic Shapes and Distributed.

> This next-generation release includes a Stable version of Accelerated Transformers (formerly called Better Transformers); Beta includes torch.compile as the main API for PyTorch 2.0, the scaled_dot_product_attention function as part of torch.nn.functional, the MPS backend, functorch APIs in the torch.func module; and other Beta/Prototype improvements across various inferences, performance and training optimization features on GPUs and CPUs.

> Along with 2.0, we are also releasing a series of beta updates to the PyTorch domain libraries, including those that are in-tree, and separate libraries including TorchAudio, TorchVision, and TorchText. An update for TorchX is also being released as it moves to community supported mode.

> This release is composed of over 4,541 commits and 428 contributors since 1.13.1. We want to sincerely thank our dedicated community for your contributions.

### Asset (verbatim from release assets)

```json
{
  "name": "pytorch-v2.0.0.tar.gz",
  "content_type": "application/gzip",
  "state": "uploaded",
  "size": 276643781,
  "download_count": 3641,
  "browser_download_url": "https://github.com/pytorch/pytorch/releases/download/v2.0.0/pytorch-v2.0.0.tar.gz"
}
```

## Research Notes

- 来源角色 C-implementation：官方发布产物（release + tag），固定版本来源。
- 版本链锚点：2.0.0 发布于 2023-03-15（与 s200-ai-pytorch-001 介绍页同日）；2.6.0（s200-ai-pytorch-002）发布于 2025-01-29。
- torch.compile 在 2.0 中为 Beta 状态（"Beta includes torch.compile as the main API"）——与 2.6 中 "torch.compile can now be used with Python 3.13" 对应，可测试"能力从 Beta 到生产"的版本演化。
- 与 s200-ai-pytorch-004（tag→commit 映射）同属实现层证据。
