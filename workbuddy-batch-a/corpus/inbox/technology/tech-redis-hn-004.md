---
sourceId: tech-redis-hn-004
title: "Hacker News thread: \"Redis is open source again\" (item 43859446)"
domain: technology
sourceRole: "U"
platform: hackernews
author: "antirez (submitter) + multiple commenters"
canonicalUrl: "https://news.ycombinator.com/item?id=43859446"
publishedAt: "2025-05-01T15:56:35Z"
capturedAt: "2026-07-27T06:36:50Z"
versionRef: null
mediaType: thread
language: en
usage: internal-only
accessStatus: partial
contentHash: "sha256:285c67d57db1572074cf64eeb3ba0f47271964fb23e18f69386c5c920d757b36"
---

# Hacker News thread: "Redis is open source again" (item 43859446)

## Source Snapshot

[SELECTION NOTICE] 线程共 93 条顶层评论（总分 1896）。以下为按"直接回复数"排序的前 14 条顶层评论逐字快照（HN Algolia API；HTML 已剥离、空白归一化）；嵌套回复未包含。编辑/删除状态不可见。

THREAD: Redis is open source again | by antirez | 2025-05-01T15:56:35.000Z | 1896 pts

[c0l0 | 2025-05-01T16:24:08.000Z | 15 direct replies]
I contributed a minor (but imho still neat :p) improvement to Redis under its original license, and personally moved to using redict when the unexpected license change to SSPL was announced - and I was feeling betrayed as a contributor to a properly-FOSS-codebase. (Had they switched to AGPL right away, I'd have been perfectly fine with that change from a moral perspective, ftr.) I have a great deal of respect for antirez and recgnize him as a kind and benevolent member of the FOSS community, but no matter what Redis, Inc. announced or does, they have lost my trust for good, and I will continue to use Redis forks for as long as they exist.

[placatedmayhem | 2025-05-01T16:09:35.000Z | 6 direct replies]
I'm curious whether the community will trust Redis-the-company again after this, or if they'll choose to stick with Valkey. The other concern is at least some big company legal departments are wary of AGPL software, which makes Valkey, still BSD, more attractive to them. Edit: Regardless, thank you and the rest of the folks inside Redis for pushing to bring this back to OSS!

[mmaunder | 2025-05-01T16:34:32.000Z | 6 direct replies]
Here's the play: Open source with AGPL, then offer an enterprise license. You get two wins. The OSS community applauds your adoption of an agressive OSS license. Enterprise customers can't use software under AGPL because it risks infecting their IP, so they're forced to buy an enterprise license.

[simonw | 2025-05-01T17:55:00.000Z | 6 direct replies]
Lots of cynical takes in this thread - and I get it, there isn't a guarantee they won't relicense again in the future (they have a CLA that would let them) and people feel betrayed by the last license change. I think we should celebrate this anyway. It's a smart decision, it's what the community wanted to happen and it would be great if other companies with janky licenses could see "Redis relicensed to open source and had a great boost out of it", not 'Redis relicensed to open source and it didn't help them at all". I'm delighted. Thank you, team Redis.

[dismalaf | 2025-05-01T16:14:24.000Z | 5 direct replies]
AGPL is cancer. Valkey already exists, people already switched, it's already landed in a bunch of distros. I don't see anyone moving back, especially when Valkey has some big corporate support. And for my personal usage, Rails 8 has moved Redis functionality into the database by default, which works fine.

[md3911027514 | 2025-05-01T16:14:58.000Z | 4 direct replies]
Our company made the switch over to Valkey, and we've invested hundreds of engineering hours into it already. I don't see us switching back at this point especially when it's clear Redis could easily pull the bait-and-switch again.

[tiffanyh | 2025-05-01T16:37:47.000Z | 4 direct replies]
While I applaud the effort to repair developer trust, do note that many organizations prohibit the use of AGPL. Linked below is Google's own stance on why AGPL is banned: https://opensource.google/documentation/reference/using/agpl...

[aftbit | 2025-05-01T21:15:20.000Z | 4 direct replies]
From the CEO blog post - https://redis.io/blog/agplv3/ >This achieved our goal—AWS and Google now maintain their own fork Was this really the goal though? Forcing your biggest users to fork your software and maintain their own divergent version is not really good for anyone. Sure, Amazon and Google (or AWS and GCP - type confusion in the source material) now have to contribute some more engineering hours to the open fork, but why would anyone still want to use Redis now that there's a permissively licensed alternative maintained by the same cloud hyperscalers who will end up running it for you?

[kamranjon | 2025-05-01T16:22:05.000Z | 3 direct replies]
One of the big things I love about Redis is that it’s become this tool for me to learn new techniques and explore data. Like, the new vector sets feature has let me really explore dense vectors and custom search and taxonomy mapping and all sorts of areas that seemed like a high barrier to entry for me, but now I’m just streaming stuff into llama.cpp with an embedding model and storing it in Redis and being able to do mappings between different data sets super efficiently. A big part of that is API design - I can’t think of another system that is as well thought out as the Redis API - it’s deceptively simple and because of that I didn’t have to wait for client libraries to incorporate the new Redis features - they just work cause they all speak RESP and I can just send raw commands. All of this is to say that I was really happy to hear Antirez was back working on Redis and it’s paying off in more ways than I could have imagined. People can use valkey or whatever they want as an alternative - but I like Redis because it’s always pushing forward and letting me explore new things that otherwise wouldn’t feel as “at my fingertips” as it does in Redis.

[dec0dedab0de | 2025-05-01T17:35:37.000Z | 3 direct replies]
So with redis being AGPL, who counts as a user? If you have a webapp that uses redis on the backend for a task queue, do the users of the webapp count as users of redis, and you then have to provide source to redis? Is there a chance that you might have to release your apps code to be compliant?

[umajho | 2025-05-01T18:18:45.000Z | 3 direct replies]
MinIO also switched to AGPLv3 a while back, and they stated that “the AGPL license requires that all software connecting with MinIO be 100% open source for you/your users not to be in violation of the license.”[^1] Since Redis and MinIO are somewhat similar, (Both can be used to store and retrieve data. Redis uses a custom protocol, and MinIO uses an S3-compatible API.) Should I assume that this statement also applies to Redis? [^1]: https://github.com/minio/minio/issues/13308#issuecomment-929...

[ezekg | 2025-05-01T16:10:48.000Z | 2 direct replies]
Of course it's the AGPL, which is essentially the SSPL in practice.

[bravetraveler | 2025-05-01T16:18:46.000Z | 2 direct replies]
After what Mullenweg has pulled, in the era of Blogging CEOs I have to be cynical. Valkey.

[not_your_vase | 2025-05-01T16:20:23.000Z | 2 direct replies]
This will be very relevant when Valkey decides to go closed source. It's better than the previous state of course, but it would have been even better if the previous license change didn't happen. As the french people say: fool me once, shame on you...



## Research Notes

- 角色：科技域社区信号。对 Redis 回归 AGPL 的即时社区反应，观点显著分裂。
- 与其他 sourceId 的关系：直接回应 tech-redis-blog-2025-002 与 tech-redis-antirez-003；c0l0/md3911027514 的"信任已失、已迁移 Valkey/redict 不回头"与官方叙事构成 CONTRADICTS/REPORTS_EXPERIENCE；tiffanyh 引用 Google 对 AGPL 的禁用政策，为 AGPL 适用范围提供限制条件；simonw 持正面观点，与同线程负面观点形成内部冲突。
- 事实/观点区分：绝大多数为个人观点与公司经历自述（author-opinion / experience）；"Google bans AGPL" 之类断言的原始依据是评论中链接，本批未冻结该链接目标页（uncertainty）。
- 限制：仅前 14 条顶层评论，accessStatus=partial；选择标准为直接回复数（工程热度代理），可能偏向争议性观点。
