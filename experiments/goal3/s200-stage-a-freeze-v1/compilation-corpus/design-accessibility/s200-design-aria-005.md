---
sourceId: s200-design-aria-005
title: ARIA (Accessible Rich Internet Applications) — MDN Web Docs
domain: design-accessibility
clusterId: cluster-design-aria-01
sourceRole: S-analysis
platform: documentation
author: MDN contributors (Mozilla)
canonicalUrl: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA
publishedAt: unknown
capturedAt: '2026-08-10T13:30:00+08:00'
versionRef: MDN page captured 2026-08-10
mediaType: docs
language: en
usage: internal-only
accessStatus: full
evaluatorRawSnapshotHash: sha256:31d801ddeb9d09368fd94ef5650243de57594cf47cb65259d53e84c5c3a0f3c1
evaluatorNormalizedSnapshotHash: sha256:31d801ddeb9d09368fd94ef5650243de57594cf47cb65259d53e84c5c3a0f3c1
evaluatorUpstreamArtifactHash: sha256:f45ec9fe9032a7cd8a68026742d8846d3a0b0082c5207a9c293af784cd5ed4ad
---

# ARIA (Accessible Rich Internet Applications) — MDN Web Docs

## Source Snapshot

### Overview content (verbatim)

> Accessible Rich Internet Applications (ARIA) is a set of roles and attributes that define ways to make web content and web applications (especially those developed with JavaScript) more accessible to people with disabilities.

> ARIA supplements HTML so that interactions and widgets commonly used in applications can be passed to assistive technologies when there is not otherwise a mechanism. For example, ARIA enables accessible JavaScript widgets, form hints and error messages, live content updates, and more.

### Before using ARIA (verbatim)

> Warning:
>
> Many of these widgets are fully supported in modern browsers. Developers should prefer using the correct semantic HTML element over using ARIA, if such an element exists. For instance, native elements have built-in keyboard accessibility, roles and states. However, if you choose to use ARIA, you are responsible for mimicking the equivalent browser behavior in script.

> The first rule of ARIA use is "If you can use a native HTML element or attribute with the semantics and behavior you require already built in, instead of re-purposing an element and adding an ARIA role, state or property to make it accessible, then do so."

> Note:
>
> There is a saying "No ARIA is better than bad ARIA." In WebAim's survey of over one million home pages, they found that Home pages with ARIA present averaged 41% more detected errors than those without ARIA. While ARIA is designed to make web pages more accessible, if used incorrectly, it can do more harm than good.
