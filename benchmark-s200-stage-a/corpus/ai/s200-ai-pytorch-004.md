---
sourceId: s200-ai-pytorch-004
title: "PyTorch v2.0.0 git tag ref (GitHub API)"
domain: ai
clusterId: cluster-ai-pytorch-01
sourceRole: C-implementation
platform: github
author: "pytorch/pytorch repository (GitHub)"
canonicalUrl: "https://api.github.com/repos/pytorch/pytorch/git/ref/tags/v2.0.0"
publishedAt: "2023-03-09T22:42:00Z"
capturedAt: "2026-08-10T12:35:00+08:00"
versionRef: "git ref refs/tags/v2.0.0 -> commit c263bd43e8e8502d4726643bc6fd046f0130ac0e"
mediaType: code
language: en
usage: internal-only
accessStatus: full
snapshotHash: "sha256:0ef5f2f35de38329e5809dc4db07c35a8363cfd34ddfb6148705f5f39b00a85d"
collectionMethod: public-api
licenseOrUsageNote: "GitHub REST API public data; internal benchmark use only."
collectionNotes: "Git tag 对象本身（指向 commit 而非 annotated tag object）。提供 v2.0.0 的不可变 commit 定位。"
---

# PyTorch v2.0.0 git tag ref (GitHub API)

## Source Snapshot

*Verbatim JSON from GitHub REST API, https://api.github.com/repos/pytorch/pytorch/git/ref/tags/v2.0.0 (captured 2026-08-10).*

```json
{
  "ref": "refs/tags/v2.0.0",
  "node_id": "MDM6UmVmNjU2MDA5NzU6cmVmcy90YWdzL3YyLjAuMA==",
  "url": "https://api.github.com/repos/pytorch/pytorch/git/refs/tags/v2.0.0",
  "object": {
    "sha": "c263bd43e8e8502d4726643bc6fd046f0130ac0e",
    "type": "commit",
    "url": "https://api.github.com/repos/pytorch/pytorch/git/commits/c263bd43e8e8502d4726643bc6fd046f0130ac0e"
  }
}
```

## Research Notes

- 来源角色 C-implementation：Git tag 的不可变 commit 定位，用于把"PyTorch 2.0.0"版本锚定到具体 commit c263bd43。
- 与 s200-ai-pytorch-003（v2.0.0 release）构成版本证据对：release（含正文） + tag（含 commit）。
- 数据是 API 原始 JSON，逐字保留，无截断。
