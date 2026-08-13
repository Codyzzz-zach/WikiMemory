---
sourceId: s200-tech-http3-003
title: "HTTP/3 with curl (curl.se docs)"
domain: technology
clusterId: cluster-tech-http3-01
sourceRole: C-implementation
platform: official
author: "curl project (Daniel Stenberg et al.)"
canonicalUrl: "https://curl.se/docs/http3.html"
publishedAt: "unknown"
capturedAt: "2026-08-10T12:50:00+08:00"
versionRef: "curl HTTP/3 docs captured 2026-08-10; ngtcp2 backend stable, quiche experimental"
mediaType: docs
language: en
usage: internal-only
accessStatus: full
snapshotHash: "sha256:f8e356a1c451cebc49338bc8c49fc7734cc9a8f03fa624d3a5696aa97d8990d9"
collectionMethod: public-page
licenseOrUsageNote: "curl 官方文档（MIT 许可项目文档）；内部评测使用。"
collectionNotes: "curl 官方 HTTP/3 支持文档。"
---

# HTTP/3 with curl (curl.se docs)

## Source Snapshot

*Verbatim from https://curl.se/docs/http3.html (captured 2026-08-10).*

> curl / Docs / Protocols / HTTP/3 with curl
>
> HTTP3 (and QUIC)

### Resources

> Resources
> HTTP/3 Explained - the online free book describing the protocols involved.
> quicwg.org - home of the official protocol drafts
>
> QUIC libraries
> QUIC libraries we are using:
> ngtcp2
> quiche - EXPERIMENTAL

### Experimental status (verbatim)

> Experimental
> HTTP/3 support using quiche in curl is considered EXPERIMENTAL until further notice. Only the ngtcp2 backend is not experimental.
>
> Further development and tweaking of the HTTP/3 support in curl happens in the master branch using pull-requests like ordinary changes.
>
> To fix before we remove the experimental label:
> - the used QUIC library needs to consider itself non-beta
> - it is fine to "leave" individual backends as experimental if necessary

### Building with ngtcp2 (verbatim)

> Building curl with ngtcp2 involves 3 components: ngtcp2 itself, nghttp3 and a QUIC supporting TLS library. The supported TLS libraries are covered below.
>
> While any version of ngtcp2 and nghttp3 from v1.0.0 on are expected to work, using the latest versions often brings functional and performance improvements.
>
> The build examples use $NGHTTP3_VERSION and $NGTCP2_VERSION as placeholders for the version you build.
>
> Build with OpenSSL or fork
> OpenSSL v3.5.0+ requires ngtcp2 v1.12.0+. Earlier versions do not work.

## Research Notes

- 来源角色 C-implementation：主流命令行客户端 curl 的 HTTP/3 支持文档——"实现层"证据。
- 关键信息：ngtcp2 后端为唯一非实验性实现；quiche 后端标注 EXPERIMENTAL。可用于"官方协议 vs 实现状态"的对照（RFC 已发布但实现仍分后端、部分实验性）。
- 与 s200-tech-http3-004（Cloudflare 博客）同属 HTTP/3 落地生态：一方是客户端实现，一方是服务端边缘网络。
