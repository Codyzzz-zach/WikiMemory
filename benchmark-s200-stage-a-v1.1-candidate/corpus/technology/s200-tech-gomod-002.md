---
sourceId: s200-tech-gomod-002
title: "Using Go Modules (Go Blog, 2019)"
domain: technology
clusterId: cluster-tech-go-modules-01
sourceRole: P-primary
platform: official
author: "Tyler Bui-Palsulich and Eno Compton (Go team)"
canonicalUrl: "https://go.dev/blog/using-go-modules"
publishedAt: "2019-03-19"
capturedAt: "2026-08-10T12:50:00+08:00"
versionRef: "Go Blog, 19 March 2019; describes Go 1.11/1.12 preliminary module support"
mediaType: article
language: en
usage: internal-only
accessStatus: full
snapshotHash: "sha256:b891796bf57f5f8ecac05c276b6184653b9eda33834c933e822ab5bd4948630a"
collectionMethod: public-page
licenseOrUsageNote: "Go Blog（BSD 许可）；内部评测使用。"
collectionNotes: "官方博客（服务端渲染，经 <main> 区域提取）。系列第一部分。"
---

# Using Go Modules (Go Blog, 2019)

## Source Snapshot


> The Go Blog
> Using Go Modules
> Tyler Bui-Palsulich and Eno Compton
> 19 March 2019

### Introduction

> This post is part 1 in a series.
>
> Part 1 — Using Go Modules (this post)
> Part 2 — Migrating To Go Modules
> Part 3 — Publishing Go Modules
> Part 4 — Go Modules: v2 and Beyond
> Part 5 — Keeping Your Modules Compatible

> Go 1.11 and 1.12 include preliminary support for modules, Go's new dependency management system that makes dependency version information explicit and easier to manage.
>
> This blog post is an introduction to the basic operations needed to get started using modules.

> A module is a collection of Go packages stored in a file tree with a go.mod file at its root.
>
> The go.mod file defines the module's module path, which is also the import path used for the root directory, and its dependency requirements, which are the other modules needed for a successful build.
>
> Each dependency requirement is written as a module path and a specific semantic version.

> As of Go 1.11, the go command enables the use of modules when the current directory or any parent directory has a go.mod, provided the directory is outside $GOPATH/src. (Inside $GOPATH/src, for compatibility, the go command still runs in the old GOPATH mode, even if a go.mod is found.)

> Starting in Go 1.13, module mode will be the default for all development.

## Research Notes
> Curator provenance: Verbatim from https://go.dev/blog/using-go-modules (captured 2026-08-10).（本行为 curator 添加的采集说明，非上游文本。）

- 来源角色 P-primary：官方博客（2019-03-19），模块系统的入门文档。
- 版本信息：明确"Go 1.11/1.12 为 preliminary support"、"Go 1.13 起默认 module mode"——与 s200-tech-gomod-001（现行参考，模块已默认）构成时间演化。
- 与 s200-tech-gomod-003（2018 vgo 提案）的关系：本文是提案落地后的官方教程，可验证"提案→发布"链条。
- 注意：文中"outside $GOPATH/src"条件与后续版本行为（GO111MODULE）的演进，测试条件保真。
