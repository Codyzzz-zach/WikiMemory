---
sourceId: s200-tech-gomod-004
title: Go 1.25 Release Notes (go.dev/doc/go1.25)
domain: technology
clusterId: cluster-tech-go-modules-01
sourceRole: P-primary
platform: official
author: Go team (Google)
canonicalUrl: https://go.dev/doc/go1.25
publishedAt: '2025-08-05'
capturedAt: '2026-08-10T12:50:00+08:00'
versionRef: Go 1.25 (released August 2025)
mediaType: release-notes
language: en
usage: internal-only
accessStatus: full
evaluatorRawSnapshotHash: sha256:a112841b4fd5dc0400e0d8279ea385f4a23617b0008eee64ad0fbd673c2d9fac
evaluatorNormalizedSnapshotHash: sha256:a112841b4fd5dc0400e0d8279ea385f4a23617b0008eee64ad0fbd673c2d9fac
evaluatorUpstreamArtifactHash: sha256:1e9a2284eae5dd00fc2ef9079dddfe0d030cc7edf0f6ac743ab58d4933367b80
---

# Go 1.25 Release Notes (go.dev/doc/go1.25)

## Source Snapshot

### Introduction to Go 1.25

> The latest Go release, version 1.25, arrives in August 2025, six months after Go 1.24.
>
> Most of its changes are in the implementation of the toolchain, runtime, and libraries.
>
> As always, the release maintains the Go 1 promise of compatibility.
>
> We expect almost all Go programs to continue to compile and run as before.

### Changes to the language

> There are no languages changes that affect Go programs in Go 1.25.
>
> However, in the language specification the notion of core types has been removed in favor of dedicated prose.
>
> See the respective blog post for more information.

### Tools / Go command

> The go build -asan option now defaults to doing leak detection at program exit.
>
> This will report an error if memory allocated by C is not freed and is not referenced by any other memory allocated by either C or Go.
>
> These new error reports may be disabled by setting ASAN_OPTIONS=detect_leaks=0
