---
sourceId: s200-tech-gomod-001
title: "Go Modules Reference (go.dev/ref/mod)"
domain: technology
clusterId: cluster-tech-go-modules-01
sourceRole: P-primary
platform: official
author: "Go team (Google)"
canonicalUrl: "https://go.dev/ref/mod"
publishedAt: "unknown"
capturedAt: "2026-08-10T12:50:00+08:00"
versionRef: "official reference captured 2026-08-10; documents Go module system (GA since Go 1.13)"
mediaType: docs
language: en
usage: internal-only
accessStatus: full
snapshotHash: "sha256:d9b8eed6073bb58db0dbd63eab4092ae32b4f7e396209039d6609c0294aed73e"
collectionMethod: public-page
licenseOrUsageNote: "Go 官方文档（BSD 许可的项目文档）；内部评测使用。"
collectionNotes: "go.dev/ref/mod 官方模块系统参考手册；页面服务端渲染，经 <main> 区域提取。"
---

# Go Modules Reference (go.dev/ref/mod)

## Source Snapshot


### Introduction

> Modules are how Go manages dependencies.
>
> This document is a detailed reference manual for Go's module system. For an introduction to creating Go projects, see How to Write Go Code. For information on using modules, migrating projects to modules, and other topics, see the blog series starting with Using Go Modules.

### Modules, packages, and versions

> A module is a collection of packages that are released, versioned, and distributed together. Modules may be downloaded directly from version control repositories or from module proxy servers.
>
> A module is identified by a module path, which is declared in a go.mod file, together with information about the module's dependencies. The module root directory is the directory that contains the go.mod file. The main module is the module containing the directory where the go command is invoked.
>
> Each package within a module is a collection of source files in the same directory that are compiled together. A package is defined by the directory containing the package's source files, with the package import path declared in the package's `package` declaration.

## Research Notes
> Curator provenance: Verbatim from https://go.dev/ref/mod (captured 2026-08-10).（本行为 curator 添加的采集说明，非上游文本。）

- 来源角色 P-primary：Go 官方模块系统参考手册（规范级文档，固定版本可追踪）。
- 与 s200-tech-gomod-002（2019 入门博客）、s200-tech-gomod-003（vgo 提案 issue）、s200-tech-gomod-004（Go 1.25 release notes）构成"模块系统从提案到现行规范"的版本链。
- 该页为现行参考；早期文档（如 2019 博客）声明 Go 1.11/1.12 为"preliminary support"，而现行版本模块为默认——版本演化证据。
