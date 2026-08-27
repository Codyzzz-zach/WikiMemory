---
sourceId: s200-tech-http3-006
title: "RFC 9000: QUIC — A UDP-Based Multiplexed and Secure Transport"
domain: technology
clusterId: cluster-tech-http3-01
sourceRole: P-primary
platform: rfc-editor
author: "J. Iyengar, Ed. (Fastly); M. Thomson, Ed. (Mozilla); IETF"
canonicalUrl: "https://www.rfc-editor.org/rfc/rfc9000.txt"
publishedAt: "2021-05-27"
capturedAt: "2026-08-10T12:50:00+08:00"
versionRef: "RFC 9000, May 2021, Standards Track; DOI 10.17487/RFC9000"
mediaType: standard
language: en
usage: internal-only
accessStatus: full
snapshotHash: "sha256:a4f71a56933d72d551a65f535abd5b79dd0108ef9a75026da310e31684f421b4"
collectionMethod: public-page
licenseOrUsageNote: "RFC 文本（IETF Trust 许可）；内部评测使用。"
collectionNotes: "rfc-editor.org 纯文本抓取。QUIC 为 HTTP/3 的底层传输（版本链根部）。"
---

# RFC 9000: QUIC — A UDP-Based Multiplexed and Secure Transport

## Source Snapshot

*Verbatim from https://www.rfc-editor.org/rfc/rfc9000.txt (captured 2026-08-10).*

### Header

> Internet Engineering Task Force (IETF)                   J. Iyengar, Ed.
> Request for Comments: 9000                                        Fastly
> Category: Standards Track                             M. Thomson, Ed.
> ISSN: 2070-1721                                           Mozilla
>                                                                May 2021
>
>                  QUIC: A UDP-Based Multiplexed and Secure Transport

### Abstract

> This document defines the core of the QUIC transport protocol. QUIC provides applications with flow-controlled streams for structured communication, low-latency connection establishment, and network path migration. QUIC includes security measures that ensure confidentiality, integrity, and availability in a range of deployment circumstances. Accompanying documents describe the integration of TLS for key negotiation, loss detection, and congestion control.

## Research Notes

- 来源角色 P-primary：QUIC 核心规范（RFC 9000，2021-05），HTTP/3（RFC 9114，s200-tech-http3-001）的底层传输。
- 版本链根：QUIC（RFC 9000，2021）→ HTTP/3（RFC 9114，2022）——协议栈层级关系（REQUIRES 型候选）。
- RFC 为固定版本来源，逐字引用安全。
