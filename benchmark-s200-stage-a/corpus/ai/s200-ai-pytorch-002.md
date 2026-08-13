---
sourceId: s200-ai-pytorch-002
title: "PyTorch 2.6.0 Release (GitHub release notes)"
domain: ai
clusterId: cluster-ai-pytorch-01
sourceRole: P-primary
platform: github
author: "PyTorch team (GitHub release published by HDCharles)"
canonicalUrl: "https://github.com/pytorch/pytorch/releases/tag/v2.6.0"
publishedAt: "2025-01-29T17:18:54Z"
capturedAt: "2026-08-10T12:35:00+08:00"
versionRef: "GitHub tag v2.6.0; target_commitish release/2.6; published 2025-01-29"
mediaType: release-notes
language: en
usage: internal-only
accessStatus: full
snapshotHash: "sha256:c8d677959cc640ddc7913e5027ff9859fc6a924a5944d4177a276885edf1189e"
collectionMethod: public-api
licenseOrUsageNote: "GitHub release notes (MIT-licensed repo); internal benchmark use only."
collectionNotes: "经 GitHub Releases API 抓取 v2.6.0 完整 release note（JSON body）。与 v2.0.0（s200-ai-pytorch-003）构成版本链。"
---

# PyTorch 2.6.0 Release (GitHub release notes)

## Source Snapshot

*Verbatim from GitHub Releases API, https://api.github.com/repos/pytorch/pytorch/releases/tags/v2.6.0 (captured 2026-08-10).*

### Release metadata

```json
{
  "html_url": "https://github.com/pytorch/pytorch/releases/tag/v2.6.0",
  "tag_name": "v2.6.0",
  "target_commitish": "release/2.6",
  "name": "PyTorch 2.6.0 Release",
  "draft": false,
  "prerelease": false,
  "created_at": "2025-01-29T00:09:34Z",
  "published_at": "2025-01-29T17:18:54Z"
}
```

### Highlights (verbatim from release body)

> We are excited to announce the release of PyTorch® 2.6 ([release notes](https://github.com/pytorch/pytorch/releases/tag/v2.6.0))! This release features multiple improvements for PT2: `torch.compile` can now be used with Python 3.13; new performance-related knob `torch.compiler.set_stance`; several AOTInductor enhancements. Besides the PT2 improvements, another highlight is FP16 support on X86 CPUs.

> NOTE: Starting with this release we are not going to publish on Conda, please see [[Announcement] Deprecating PyTorch's official Anaconda channel](https://github.com/pytorch/pytorch/issues/138506) for the details.

> For this release the experimental Linux binaries shipped with CUDA 12.6.3 (as well as Linux Aarch64, Linux ROCm 6.2.4, and Linux XPU binaries) are built with CXX11_ABI=1 and are [using the Manylinux 2.28 build platform](https://dev-discuss.pytorch.org/t/pytorch-linux-wheels-switching-to-new-wheel-build-platform-manylinux-2-28-on-november-12-2024/2581). If you build PyTorch extensions with custom C++ or CUDA extensions, please update these builds to use CXX_ABI=1 as well and report any issues you are seeing. For the next PyTorch 2.7 release we plan to switch all Linux builds to Manylinux 2.28 and CXX11_ABI=1, please see [[RFC] PyTorch next wheel build platform: manylinux-2.28](https://github.com/pytorch/pytorch/issues/123649) for the details and discussion.

> Also in this release as an important security improvement measure we have changed the default value for `weights_only` parameter of `torch.load`. This is a backward compatibility-breaking change, please see [this forum post](https://dev-discuss.pytorch.org/t/bc-breaking-change-torch-load-is-being-flipped-to-use-weights-only-true-by-default-in-the-nightlies-after-137602/2573) for more details.

> This release is composed of 3892 commits from 520 contributors since PyTorch 2.5. We want to sincerely thank our dedicated community for your contributions. As always, we encourage you to try these out and report any issues as we improve PyTorch.

## Research Notes

- 来源角色 P-primary：官方 release note，属于固定版本来源（tag v2.6.0）。
- 与 s200-ai-pytorch-001（2.0 介绍）的候选联系：本文明确 `torch.load` 默认参数变更属于"backward compatibility-breaking change"，可用于测试"2.0 声称 100% 向后兼容"的范围边界（仅指 torch.compile additive 性质）。
- 与 s200-ai-pytorch-003（v2.0.0 release）构成版本链：2.0（2023-03-15）→ 2.6（2025-01-29）。
- 社区信号 s200-ai-pytorch-006 中有用户对 conda/Python 3.11 的讨论；2.6 起不再发布 Conda 包，可作时间演化对照。
