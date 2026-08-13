---
sourceId: s200-design-apca-008
title: "APCA in a Nutshell (Myndex/SAPC-APCA documentation)"
domain: design-accessibility
clusterId: cluster-design-apca-01
sourceRole: P-primary
platform: github
author: "Myndex (Andrew Somers)"
canonicalUrl: "https://github.com/Myndex/SAPC-APCA/blob/master/documentation/APCA_in_a_Nutshell.md"
publishedAt: "unknown"
capturedAt: "2026-08-10T13:30:00+08:00"
versionRef: "Myndex/SAPC-APCA documentation/APCA_in_a_Nutshell.md (master)"
mediaType: article
language: en
usage: internal-only
accessStatus: full
snapshotHash: "sha256:55ee0463ad1dc7acf3da4463bffec7c26a4a9f942695010b5ad00a895cab7b8f"
collectionMethod: public-api
licenseOrUsageNote: "BSD-2-Clause 仓库文档；内部评测使用。"
collectionNotes: "APCA 官方简述文档（Lc 值体系）。"
---

# APCA in a Nutshell (Myndex/SAPC-APCA documentation)

## Source Snapshot

*Verbatim from https://raw.githubusercontent.com/Myndex/SAPC-APCA/master/documentation/APCA_in_a_Nutshell.md (captured 2026-08-10).*

> # APCA in a Nutshell
>
> Accessible Perceptual Contrast Algorithm is a new method for calculating and predicting readability contrast. APCA is a part of the larger S-Luv Accessible Color Appearance Model known as SACAM (formerly SAPC). These models are specifically optimized for accessible color appearance on self-illuminated RGB computer displays & devices, and also for modeling accessible user needs, with a focus on visual readability.
>
> APCA is the candidate contrast method for the future WCAG 3, and is also developing as the APCA Readability Criterion, an independent standard hosted by Inclusive Reading Technologies.

### Lightness contrast Lc (verbatim)

> The APCA generates a lightness/darkness contrast value based on a minimum font size and color pair, and this value is perceptually based: that is, regardless of how light or dark the colors are, a contrast value of Lc 60 represents the same _perceived_ readability contrast. This is absolutely not the case with WCAG 2.x, which overstates contrast for dark colors to the point that 4.5:1 can be functionally unreadable when one of the colors in a pair is near black. As a result, WCAG 2.x contrast cannot be used for guidance designing "dark mode".

### Levels (verbatim)

> APCA reports contrast as an Lc value (lightness contrast) from **Lc 0** to **Lc 105+**. For accessibility, consider Lc 15 the point of invisibility for many users, and Lc 90 as preferred for body text.
>
> * **Lc 90** • Preferred level for fluent text and columns of body text with a font no smaller than 18px/weight 300 or 14px/weight 400 (normal), or non-body text with a font no smaller than 12px/400.
> * **Lc 75** • The _minimum_ level for columns of body text with a font no smaller than 24px/300 weight, 18px/400, 16px/500 and 14px/700.
> * **Lc 60** • The _minimum_ level recommended for content text that is not body, column, or block text.

## Research Notes

- 来源角色 P-primary：APCA 官方简述（作者为算法发明人）。
- 关键主张：Lc 60 感知一致、"WCAG 2.x 4.5:1 在深色下可能功能性不可读"、"APCA 为 WCAG 3 的候选对比度方法"——这些是作者观点/主张，测试时应与 WCAG 3 草案（s200-design-apca-001）的实际状态区分。
- Lc 0–105+ 数值体系与 README（s200-design-apca-002）、WhyAPCA（s200-design-apca-004）一致——同作者文档一致性测试。
