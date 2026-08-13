---
sourceId: s200-tech-gomod-005
title: "Go += Package Versioning (vgo-intro, research.swtch.com)"
domain: technology
clusterId: cluster-tech-go-modules-01
sourceRole: S-analysis
platform: personal-blog
author: "Russ Cox (Go team lead, personal blog)"
canonicalUrl: "https://research.swtch.com/vgo-intro"
publishedAt: "2018-02-20"
capturedAt: "2026-08-10T12:50:00+08:00"
versionRef: "research.swtch.com/vgo-intro, published 2018-02-20"
mediaType: article
language: en
usage: internal-only
accessStatus: full
snapshotHash: "sha256:84e68aa84eecab0747e12ae513bded3be62cefdee5c7fd43a61d88a5a020665c"
collectionMethod: public-page
licenseOrUsageNote: "rsc 个人博客（公开文章）；内部评测使用。"
collectionNotes: "Russ Cox 个人设计随笔，早于官方 proposal issue（2018-03-07）两周；作者为 Go 核心维护者，身份特殊，属'带利益关联的解读/设计文档'。"
---

# Go += Package Versioning (vgo-intro, research.swtch.com)

## Source Snapshot


> research!rsc
> Thoughts and links about programming, by Russ Cox
>
> Go += Package Versioning
> (Go & Versioning, Part 1)
> Russ Cox
> February 20, 2018

> We need to add package versioning to Go.
>
> More precisely, we need to add the concept of package versions to the working vocabulary of both Go developers and our tools, so that they can all be precise when talking to each other about exactly which program should be built, run, or analyzed.
>
> The go command needs to be able to tell developers exactly which versions of which packages are in a particular build, and vice versa.
>
> Versioning will let us enable reproducible builds, so that if I tell you to try the latest version of my program, I know you're going to get not just the latest version of my code but the exact same versions of all the packages my code depends on, so that you and I will build completely equivalent binaries.
>
> Versioning will also let us ensure that a program builds exactly the same way tomorrow as it does today.
>
> Even when there are newer versions of my dependencies, the go command shouldn't start using them until asked.

> Although we must add versioning, we also must not remove the best parts of the current go command: its simplicity, speed, and understandability.

> In short, we need to add package versioning, but we need to do it without breaking go get.
>
> This post sketches a proposal for doing exactly that, along with a prototype demonstration that you can try today and that hopefully will be the basis for eventual go command integration.
>
> I intend this post to be the start of a productive discussion about what works and what doesn't. Based on that discussion, I will make adjustments to both the proposal and the prototype, and then I will submit an official Go proposal, for integration into Go 1.11 as an opt-in feature.

> This proposal keeps the best parts of go get, adds reproducible builds, adopts semantic versioning, eliminates vendoring, deprecates GOPATH in favor of a project-based workflow, and provides for a smooth migration from dep and its predecessors.

## Research Notes
> Curator provenance: Verbatim from https://research.swtch.com/vgo-intro (captured 2026-08-10).（本行为 curator 添加的采集说明，非上游文本。）

- 来源角色 S-analysis（特殊）：作者是 Go 核心维护者（rsc），本文是其个人设计随笔——比官方 proposal issue 早两周（2018-02-20 vs 2018-03-07），属于"提案前设计讨论"层。
- 该文明确声称设计目标是"eliminates vendoring, deprecates GOPATH"——与现行模块系统（s200-tech-gomod-001）一致，但"eliminate vendoring"在后续实践中被修订（vendor 仍保留并受支持），可测试"设计意图 vs 最终实现"的演化。
- 与 s200-tech-gomod-003（issue #24301）构成设计→提案的因果链。
