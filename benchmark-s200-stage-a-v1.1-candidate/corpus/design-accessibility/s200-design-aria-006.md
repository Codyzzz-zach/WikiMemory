---
sourceId: s200-design-aria-006
title: "Introduction to ARIA — WebAIM"
domain: design-accessibility
clusterId: cluster-design-aria-01
sourceRole: S-analysis
platform: accessibility-education
author: "WebAIM"
canonicalUrl: "https://webaim.org/techniques/aria/"
publishedAt: "unknown"
capturedAt: "2026-08-10T13:30:00+08:00"
versionRef: "WebAIM article captured 2026-08-10"
mediaType: article
language: en
usage: internal-only
accessStatus: full
snapshotHash: "sha256:38c09c517a26728942df8b58b6c923c54114014bfab6fd67b21219e569d80625"
collectionMethod: public-page
licenseOrUsageNote: "版权 WebAIM；内部评测使用（连续短摘录）。"
collectionNotes: "WebAIM ARIA 导论；五条 ARIA 使用规则为广为人知的实践总结。"
---

# Introduction to ARIA — WebAIM

## Source Snapshot


> WAI-ARIA (Accessible Rich Internet Applications or ARIA) is a W3C specification for enhancing accessibility in ways that plain HTML cannot. When used properly, ARIA can...
>
> - enhance accessibility of interactive controls, such as tree menus, sliders, pop-ups, etc.
> - define helpful landmarks for page structure
> - define dynamically-updated "live regions"
> - improve keyboard accessibility and interactivity
> - and much more

### Rules of ARIA Use (verbatim)

> Rule #1 - If you can use HTML a native HTML element or attribute, then do so.
>
> HTML is the foundation of web accessibility. ARIA should not be used when HTML provides sufficient semantics for accessibility! When used incorrectly, ARIA can introduce significant accessibility barriers.

> Rule #2 - Do not change native semantics, unless you really have to.

> Rule #3 - All interactive ARIA controls must be usable with the keyboard.

> Rule #4 - Interactive controls must have proper semantics and cannot be hidden

> Rule #5 - All interactive elements must have an accessible name

## Research Notes
> Curator provenance: Verbatim excerpts from https://webaim.org/techniques/aria/ (captured 2026-08-10). Copyright WebAIM; internal benchmark use only.（本行为 curator 添加的采集说明，非上游文本。）

- 来源角色 S-analysis：WebAIM 实践指南（教育性二手来源），"五条规则"是社区广泛引用的实践总结。
- 注意：规则是对规范精神的提炼，不是规范原文——归属测试（"规则来自 WebAIM 而非 W3C 规范"）。
- 与 s200-design-aria-005（MDN）同属解释层；可作为二手解释质量与来源归因的测试对象。
