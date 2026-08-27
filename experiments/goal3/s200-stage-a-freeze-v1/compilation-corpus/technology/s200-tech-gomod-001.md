---
sourceId: s200-tech-gomod-001
title: Go Modules Reference (go.dev/ref/mod)
domain: technology
clusterId: cluster-tech-go-modules-01
sourceRole: P-primary
platform: official
author: Go team (Google)
canonicalUrl: https://go.dev/ref/mod
publishedAt: unknown
capturedAt: '2026-08-10T12:50:00+08:00'
versionRef: official reference captured 2026-08-10; documents Go module system (GA since Go 1.13)
mediaType: docs
language: en
usage: internal-only
accessStatus: full
evaluatorRawSnapshotHash: sha256:d9b8eed6073bb58db0dbd63eab4092ae32b4f7e396209039d6609c0294aed73e
evaluatorNormalizedSnapshotHash: sha256:d9b8eed6073bb58db0dbd63eab4092ae32b4f7e396209039d6609c0294aed73e
evaluatorUpstreamArtifactHash: sha256:9b89f5609f22963cba74a16e7a3e22ec244e04228ef8122a8924bc1a115b0ece
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
