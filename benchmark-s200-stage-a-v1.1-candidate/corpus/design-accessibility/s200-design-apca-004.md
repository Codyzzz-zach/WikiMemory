---
sourceId: s200-design-apca-004
title: "Why APCA as a New Contrast Method? (Myndex/SAPC-APCA documentation)"
domain: design-accessibility
clusterId: cluster-design-apca-01
sourceRole: S-analysis
platform: github
author: "Myndex (Andrew Somers, APCA author)"
canonicalUrl: "https://github.com/Myndex/SAPC-APCA/blob/master/documentation/WhyAPCA.md"
publishedAt: "unknown"
capturedAt: "2026-08-10T13:30:00+08:00"
versionRef: "Myndex/SAPC-APCA documentation/WhyAPCA.md (master)"
mediaType: article
language: en
usage: internal-only
accessStatus: full
snapshotHash: "sha256:bf103120da86d77d381b0bf3da535dee1b3b8807c1c12b39d478b5ce2f00be09"
collectionMethod: public-api
licenseOrUsageNote: "BSD-2-Clause 仓库文档；内部评测使用。"
collectionNotes: "APCA 作者本人的方法论说明文档——带利益关联的论证文本，测试'作者论证 vs 独立事实'。"
---

# Why APCA as a New Contrast Method? (Myndex/SAPC-APCA documentation)

## Source Snapshot


> # Why APCA as a New Contrast Method?
>
> Visual readability is a critically important aspect of web content, affecting 99% of internet users. For years, the WCAG 2.x contrast guidelines provided some guidance toward readability but are being replaced for the future WCAG 3.0. Here is an overview of the need for this change and discussion of the candidate replacement, the _Accessible Perceptual Contrast Algorithm_ (APCA).

> WCAG 2.x contrast, SC 1.4.3, and the related understandings and guidelines, were born in an era before smart phones and iPads, when displays were mostly old-school CRT type and websites used core web fonts. But that was a decade and a half ago. Today the contrast guidelines are in need of a complete overhaul due to the massive changes in computer display technology, web content, CSS functionality, and advances in vision science since 2005/2008, when WCAG 2.x was first introduced.

> There are a number of reasons that WCAG 2.x contrast is faulty, one of which is the binary pass/fail nature of the SC for a property that does not apply in a binary way across perception nor impairments. Humans are not binary computers, and it is important to understand the non-linear aspects of perception, and to set guidelines that correctly model perception as opposed to "brute forcing" arbitrary values that ultimately do more harm than good.

> Like color, contrast is not "real", it is a _perception_ and is more a result of how your brain interprets visual differences. It is not a simple measure of the distance or difference between two colors.

## Research Notes
> Curator provenance: Verbatim from https://raw.githubusercontent.com/Myndex/SAPC-APCA/master/documentation/WhyAPCA.md (captured 2026-08-10).（本行为 curator 添加的采集说明，非上游文本。）

- 来源角色 S-analysis（带利益关联）：作者为 APCA 发明人（Myndex/Andrew Somers），本文是对 WCAG 2.x 对比度的批评与 APCA 替代的论证——观点文本，非中立事实。
- 关键主张："WCAG 2.x contrast is faulty"、"are being replaced for the future WCAG 3.0"——后者需与 WCAG 3 草案状态（s200-design-apca-001：Working Draft，APCA 为候选）对照，避免把"作者论证"当"定稿事实"。
- 与 s200-design-apca-008（APCA in a Nutshell）同仓库文档；可测试"同作者文档间的一致性"。
