---
sourceId: s200-design-aria-002
title: "WAI-ARIA 1.2 (W3C Recommendation, 06 June 2023)"
domain: design-accessibility
clusterId: cluster-design-aria-01
sourceRole: P-primary
platform: official-standard
author: "W3C Accessible Rich Internet Applications Working Group"
canonicalUrl: "https://www.w3.org/TR/wai-aria-1.2/"
publishedAt: "2023-06-06"
capturedAt: "2026-08-10T13:30:00+08:00"
versionRef: "W3C Recommendation 06 June 2023"
mediaType: standard
language: en
usage: internal-only
accessStatus: full
snapshotHash: "sha256:6ad548fd80baefada03b83d21596612436eabc2b5184c20da837dd1deb0acac0"
collectionMethod: public-page
licenseOrUsageNote: "W3C 文档（开放许可）；内部评测使用。"
collectionNotes: "w3.org 对 curl 有 Cloudflare 拦截；文本经 WebFetch 抓取并逐字核验。"
---

# WAI-ARIA 1.2 (W3C Recommendation, 06 June 2023)

## Source Snapshot

*Verbatim from https://www.w3.org/TR/wai-aria-1.2/ (captured 2026-08-10).*

### Title and status

> Accessible Rich Internet Applications (WAI-ARIA) 1.2
>
> W3C Recommendation 06 June 2023

### Abstract (verbatim)

> Accessibility of web content requires semantic information about widgets, structures, and behaviors, in order to allow assistive technologies to convey appropriate information to persons with disabilities. This specification provides an ontology of roles, states, and properties that define accessible user interface elements and can be used to improve the accessibility and interoperability of web content and applications. These semantics are designed to allow an author to properly convey user interface behaviors and structural information to assistive technologies in document-level markup. This version adds features new since WAI-ARIA 1.1 to improve interoperability with assistive technologies to form a more consistent accessibility model for HTML and SVG2. This specification complements both HTML and SVG2.

> This document is part of the WAI-ARIA suite described in the WAI-ARIA Overview.

### Deprecated definition (verbatim)

> A deprecated role, state, or property is one which has been outdated by newer constructs or changed circumstances, and which may be removed in future versions of the WAI-ARIA specification. User agents are encouraged to continue to support items identified as deprecated for backward compatibility.

## Research Notes

- 来源角色 P-primary：W3C 正式推荐标准（ARIA 1.2，2023-06-06），现行 REC。
- 版本链：1.1（2017）→ 1.2（2023）→ 1.3 ED（2026，s200-design-aria-003）。
- ARIA 1.2 引入 aria-braillelabel / aria-brailleroledescription 等属性（对应 PR #923，s200-design-aria-004）——实现与规范版本对应关系可测试。
- 注意 ARIA 1.2 的 Abstract 与 1.1 几乎逐字相同（仅"HTML5"→"HTML"），版本差异更多体现在属性和角色表——需精确检索具体条款。
