---
sourceId: s200-design-apca-008
title: APCA in a Nutshell (Myndex/SAPC-APCA documentation)
domain: design-accessibility
clusterId: cluster-design-apca-01
sourceRole: P-primary
platform: github
author: Myndex (Andrew Somers)
canonicalUrl: https://github.com/Myndex/SAPC-APCA/blob/master/documentation/APCA_in_a_Nutshell.md
publishedAt: unknown
capturedAt: '2026-08-10T13:30:00+08:00'
versionRef: Myndex/SAPC-APCA documentation/APCA_in_a_Nutshell.md (master)
mediaType: article
language: en
usage: internal-only
accessStatus: full
evaluatorRawSnapshotHash: sha256:398a6a1367be2b622582aff31e2b5293284ca0849e2b237de865f27773886d93
evaluatorNormalizedSnapshotHash: sha256:398a6a1367be2b622582aff31e2b5293284ca0849e2b237de865f27773886d93
evaluatorUpstreamArtifactHash: sha256:77eb9ca029e78c92b65030d4799418de3cfc82c5f77ca69dea503b5c99460049
---

# APCA in a Nutshell (Myndex/SAPC-APCA documentation)

## Source Snapshot

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
