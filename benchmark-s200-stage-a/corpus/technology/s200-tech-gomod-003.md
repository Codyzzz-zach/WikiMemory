---
sourceId: s200-tech-gomod-003
title: "golang/go issue #24301: add package version support to Go toolchain (vgo proposal)"
domain: technology
clusterId: cluster-tech-go-modules-01
sourceRole: C-implementation
platform: github
author: "rsc (Russ Cox), golang/go maintainers"
canonicalUrl: "https://github.com/golang/go/issues/24301"
publishedAt: "2018-03-07T17:38:21Z"
capturedAt: "2026-08-10T12:50:00+08:00"
versionRef: "golang/go issue #24301; state closed 2018-07-17; labels Proposal / Proposal-Accepted; 242 comments"
mediaType: issue
language: en
usage: internal-only
accessStatus: full
snapshotHash: "sha256:64e8a7c16356ae309cbd388435adf18a95169cdff9f08d146241c7ad53122a7f"
collectionMethod: public-api
licenseOrUsageNote: "GitHub issue 公开内容；内部评测使用。"
collectionNotes: "GitHub Issues API 抓取（含 body 与状态）。vgo 提案的官方讨论场所。"
---

# golang/go issue #24301: add package version support to Go toolchain (vgo proposal)

## Source Snapshot

*Verbatim from GitHub Issues API, https://api.github.com/repos/golang/go/issues/24301 (captured 2026-08-10).*

### Issue metadata

```json
{
  "html_url": "https://github.com/golang/go/issues/24301",
  "number": 24301,
  "title": "cmd/go: add package version support to Go toolchain",
  "user": { "login": "rsc" },
  "labels": [ { "name": "Proposal" }, { "name": "Proposal-Accepted" } ],
  "state": "closed",
  "created_at": "2018-03-07T17:38:21Z",
  "closed_at": "2018-07-17T17:08:36Z",
  "comments": 242
}
```

### Issue body (verbatim)

> **proposal: add package version support to Go toolchain**
>
> It is long past time to add versions to the working vocabulary of both Go developers and our tools.
>
> The [linked proposal](https://golang.org/design/24301-versioned-go) describes a way to do that. See especially the Rationale section for a discussion of alternatives.
>
> This GitHub issue is for discussion about the substance of the proposal.
>
> Other references:
>  - <https://research.swtch.com/vgo>, the detailed designs
>  - [A Tour of Versioned Go](https://research.swtch.com/vgo-tour), a walkthrough of what it's like to use
>  - [`go get golang.org/x/vgo`](https://go.googlesource.com/vgo), the prototype implementation
>  - <https://golang.org/wiki/vgo>, links to related posts, videos, etc
>  - [vgo milestone](https://github.com/golang/go/milestone/71) on issue tracker

## Research Notes

- 来源角色 C-implementation：提案 issue（GitHub 编号 24301），2018-03-07 创建、2018-07-17 关闭、242 条评论、标记 Proposal-Accepted。
- 事件簇：vgo 提案是 Go 模块系统的源头（T0）；s200-tech-gomod-002（2019 官方教程）为落地（T1）。
- 与 s200-tech-gomod-005（rsc 个人博客 vgo-intro，2018-02-20，早于 issue）相关——设计随笔早于官方 issue，可测试"设计讨论与官方提案的时间先后"。
- 评论中关于 MVS（最小版本选择）的争议（见 s200-tech-gomod-006 HN）属于社区讨论层。
