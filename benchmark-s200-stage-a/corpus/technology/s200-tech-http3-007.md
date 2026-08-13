---
sourceId: s200-tech-http3-007
title: "RFC 9110: HTTP Semantics"
domain: technology
clusterId: cluster-tech-http3-01
sourceRole: P-primary
platform: rfc-editor
author: "R. Fielding, M. Nottingham, J. Reschke; IETF"
canonicalUrl: "https://www.rfc-editor.org/rfc/rfc9110.txt"
publishedAt: "2022-06-06"
capturedAt: "2026-08-10T12:50:00+08:00"
versionRef: "RFC 9110, June 2022, Standards Track; obsoletes RFC 7230-7235"
mediaType: standard
language: en
usage: internal-only
accessStatus: full
snapshotHash: "sha256:cd46b47caa6764f73d8cb3ce386b763e8b27afa7ec2dccec4897704ccfaa628a"
collectionMethod: public-page
licenseOrUsageNote: "RFC 文本（IETF Trust 许可）；内部评测使用。"
collectionNotes: "rfc-editor.org 纯文本抓取。"
---

# RFC 9110: HTTP Semantics

## Source Snapshot

*Verbatim from https://www.rfc-editor.org/rfc/rfc9110.txt (captured 2026-08-10).*

### Header

> Internet Engineering Task Force (IETF)                          R. Fielding
> Request for Comments: 9110                                         Adobe
> Obsoletes: 7230, 7231, 7232, 7233, 7234, 7235              M. Nottingham
> Category: Standards Track                                          Fastly
> ISSN: 2070-1721                                              J. Reschke
>                                                                  greenbytes
>                                                                   June 2022
>
>                                 HTTP Semantics

### Abstract

> The Hypertext Transfer Protocol (HTTP) is a stateless application-level protocol for distributed, collaborative, hypertext information systems. This document defines the semantics of HTTP: the architecture, and the HTTP/1.1, HTTP/2, and HTTP/3 protocol instantiations of HTTP. This document obsoletes RFC 7230, RFC 7231, RFC 7232, RFC 7233, RFC 7234, and RFC 7235.

## Research Notes

- 来源角色 P-primary：HTTP 语义规范（RFC 9110）——HTTP/1.1、HTTP/2、HTTP/3 的共同语义层。
- 与 RFC 9113（s200-tech-http3-002）、RFC 9114（s200-tech-http3-001）的层级关系：语义（9110）→ 版本实例（9113/9114）——REQUIRES 型关系候选。
- RFC 固定版本，逐字引用安全。
