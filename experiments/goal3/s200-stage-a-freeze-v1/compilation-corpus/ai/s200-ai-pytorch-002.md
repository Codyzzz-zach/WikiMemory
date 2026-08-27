---
sourceId: s200-ai-pytorch-002
title: PyTorch 2.6.0 Release (GitHub release notes)
domain: ai
clusterId: cluster-ai-pytorch-01
sourceRole: P-primary
platform: github
author: PyTorch team (GitHub release published by HDCharles)
canonicalUrl: https://github.com/pytorch/pytorch/releases/tag/v2.6.0
publishedAt: '2025-01-29T17:18:54Z'
capturedAt: '2026-08-10T12:35:00+08:00'
versionRef: GitHub tag v2.6.0; target_commitish release/2.6; published 2025-01-29
mediaType: release-notes
language: en
usage: internal-only
accessStatus: full
evaluatorRawSnapshotHash: sha256:2e85e56f466c10d341f400d965128d2fbcfd6f82df17af82d4fd5f284094bdfb
evaluatorNormalizedSnapshotHash: sha256:0d9c73a2932ae5b0745ac9af336982243779f1ee85e0858a7b4ebf992097394d
evaluatorUpstreamArtifactHash: sha256:6b8c8d3fc07be5bdb0f8bbb088e754e0bc4c733b8c4529f64b8531a75f923a62
---

# PyTorch 2.6.0 Release (GitHub release notes)

## Source Snapshot

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

### Highlights

> We are excited to announce the release of PyTorch® 2.6 ([release notes](https://github.com/pytorch/pytorch/releases/tag/v2.6.0))! This release features multiple improvements for PT2: `torch.compile` can now be used with Python 3.13; new performance-related knob `torch.compiler.set_stance`; several AOTInductor enhancements. Besides the PT2 improvements, another highlight is FP16 support on X86 CPUs.

> NOTE: Starting with this release we are not going to publish on Conda, please see [[Announcement] Deprecating PyTorch's official Anaconda channel](https://github.com/pytorch/pytorch/issues/138506) for the details.

> For this release the experimental Linux binaries shipped with CUDA 12.6.3 (as well as Linux Aarch64, Linux ROCm 6.2.4, and Linux XPU binaries) are built with CXX11_ABI=1 and are [using the Manylinux 2.28 build platform](https://dev-discuss.pytorch.org/t/pytorch-linux-wheels-switching-to-new-wheel-build-platform-manylinux-2-28-on-november-12-2024/2581). If you build PyTorch extensions with custom C++ or CUDA extensions, please update these builds to use CXX_ABI=1 as well and report any issues you are seeing. For the next PyTorch 2.7 release we plan to switch all Linux builds to Manylinux 2.28 and CXX11_ABI=1, please see [[RFC] PyTorch next wheel build platform: manylinux-2.28](https://github.com/pytorch/pytorch/issues/123649) for the details and discussion.

> Also in this release as an important security improvement measure we have changed the default value for `weights_only` parameter of `torch.load`. This is a backward compatibility-breaking change, please see [this forum post](https://dev-discuss.pytorch.org/t/bc-breaking-change-torch-load-is-being-flipped-to-use-weights-only-true-by-default-in-the-nightlies-after-137602/2573) for more details.

> This release is composed of 3892 commits from 520 contributors since PyTorch 2.5. We want to sincerely thank our dedicated community for your contributions. As always, we encourage you to try these out and report any issues as we improve PyTorch.
