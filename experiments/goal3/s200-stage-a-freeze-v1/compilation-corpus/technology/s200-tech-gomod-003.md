---
sourceId: s200-tech-gomod-003
title: 'golang/go issue #24301: add package version support to Go toolchain (vgo proposal)'
domain: technology
clusterId: cluster-tech-go-modules-01
sourceRole: C-implementation
platform: github
author: rsc (Russ Cox), golang/go maintainers
canonicalUrl: https://github.com/golang/go/issues/24301
publishedAt: '2018-03-07T17:38:21Z'
capturedAt: '2026-08-10T12:50:00+08:00'
versionRef: 'golang/go issue #24301; state closed 2018-07-17; labels Proposal / Proposal-Accepted; 242 comments'
mediaType: issue
language: en
usage: internal-only
accessStatus: full
evaluatorRawSnapshotHash: sha256:070448bb9b40f41e004b15a20fea630c89f7dc0de3f2ed1e7719092cf3739ac4
evaluatorNormalizedSnapshotHash: sha256:070448bb9b40f41e004b15a20fea630c89f7dc0de3f2ed1e7719092cf3739ac4
evaluatorUpstreamArtifactHash: sha256:9a4c470e9413f81acfc97fb0a960ade95a899a73ec1e103e4102e4b96a111cd8
---

# golang/go issue #24301: add package version support to Go toolchain (vgo proposal)

## Source Snapshot

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
