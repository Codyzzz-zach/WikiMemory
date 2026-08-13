---
sourceId: s200-tech-http3-004
title: "HTTP/3: the past, the present, and the future (Cloudflare Blog)"
domain: technology
clusterId: cluster-tech-http3-01
sourceRole: S-analysis
platform: corporate-blog
author: "Alessandro Ghedini and Rustam Lalkaka (Cloudflare)"
canonicalUrl: "https://blog.cloudflare.com/http3-the-past-present-and-future/"
publishedAt: "2019-09-26"
capturedAt: "2026-08-10T12:50:00+08:00"
versionRef: null
mediaType: article
language: en
usage: internal-only
accessStatus: partial
snapshotHash: "sha256:4f9013a30cb55c2fb9826df15e5972b27c9644250c975d3ad17657feafd7c3b4"
collectionMethod: public-page
licenseOrUsageNote: "版权 Cloudflare；仅保存内部评测所需的连续短摘录。"
collectionNotes: "Cloudflare 官方博客（2019-09-26）。属于厂商解读/实施方视角（S），非中立第三方。"
---

# HTTP/3: the past, the present, and the future (Cloudflare Blog)

## Source Snapshot

*Verbatim excerpts from https://blog.cloudflare.com/http3-the-past-present-and-future/ (captured 2026-08-10). Copyright Cloudflare; internal benchmark use only.*

> September 26, 2019
> HTTP/3: the past, the present, and the future
> Alessandro Ghedini and Rustam Lalkaka
> 14 minute read

> During last year's Birthday Week we announced preliminary support for QUIC and HTTP/3 (or "HTTP over QUIC" as it was known back then), the new standard for the web, enabling faster, more reliable, and more secure connections to web endpoints like websites and APIs. We also let our customers join a waiting list to try QUIC and HTTP/3 as soon as they became available.
>
> Since then, we've been working with industry peers through the Internet Engineering Task Force, including Google Chrome and Mozilla Firefox, to iterate on the HTTP/3 and QUIC standards documents. In parallel with the standards maturing, we've also worked on improving support on our network.
>
> We are now happy to announce that QUIC and HTTP/3 support is available on the Cloudflare edge network. We're excited to be joined in this announcement by Google Chrome and Mozilla Firefox, two of the leading browser vendors and partners in our effort to make the web faster and more reliable for all.

> In the words of Ryan Hamilton, Staff Software Engineer at Google, "HTTP/3 should make the web better for everyone. The Chrome and Cloudflare teams have worked together closely to bring HTTP/3 and QUIC from nascent standards to widely adopted technologies for improving the web."

> What does this announcement mean if you're a user of the Internet interacting with sites and APIs through a browser and other clients? Starting today, you can use Chrome Canary to interact with Cloudflare and other servers over HTTP/3. For those of you looking for a command line client, curl also provides support for HTTP/3.

> Eric Rescorla, CTO of Firefox, summed it up nicely: "Developing a new network protocol is hard, and getting it right requires everyone to work together. Over the past few years, we've been working with Cloudflare and other industry partners to test TLS 1.3 and now HTTP/3 and QUIC."

## Research Notes

- 来源角色 S-analysis（厂商视角）：Cloudflare 宣布边缘网络支持 HTTP/3（2019-09-26），早于 RFC 9114 定稿（2022-06）近三年——"草案期部署"案例。
- 注意利益关联：Cloudflare 是服务提供方（部署方），其"支持"声明应与其商业立场区分；Google/Firefox 高管引言属他人意见引用。
- 与 RFC 9114（s200-tech-http3-001）时间差是"标准 vs 先行实现"的演化测试点。
- 版权受限，只保留连续短摘录。
