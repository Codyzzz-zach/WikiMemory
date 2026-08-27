---
sourceId: s200-tech-http3-003
title: HTTP/3 with curl (curl.se docs)
domain: technology
clusterId: cluster-tech-http3-01
sourceRole: C-implementation
platform: official
author: curl project (Daniel Stenberg et al.)
canonicalUrl: https://curl.se/docs/http3.html
publishedAt: unknown
capturedAt: '2026-08-10T12:50:00+08:00'
versionRef: curl HTTP/3 docs captured 2026-08-10; ngtcp2 backend stable, quiche experimental
mediaType: docs
language: en
usage: internal-only
accessStatus: full
evaluatorRawSnapshotHash: sha256:5b980444422d6d5de6dcce2654cba33dba03c24603d3cb4222dfadc59e81940f
evaluatorNormalizedSnapshotHash: sha256:5b980444422d6d5de6dcce2654cba33dba03c24603d3cb4222dfadc59e81940f
evaluatorUpstreamArtifactHash: sha256:84ee6d1cf6bde06fc91aff73bb0b756bd26fc2631cae38e99ad65e1e5fbb2250
---

# HTTP/3 with curl (curl.se docs)

## Source Snapshot

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
