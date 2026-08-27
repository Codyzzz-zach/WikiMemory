---
sourceId: tech-redis-antirez-003
title: "Redis is open source again (antirez.com news/151)"
domain: technology
sourceRole: "S"
platform: personal-blog
author: "Salvatore Sanfilippo (antirez) — Redis 创始人，发文时已重新加入 Redis 任职"
canonicalUrl: "https://antirez.com/news/151"
publishedAt: "2025-05-01T00:00:00Z"
capturedAt: "2026-07-27T06:36:50Z"
versionRef: null
mediaType: article
language: en
usage: internal-only
accessStatus: full
contentHash: "sha256:a6feea32d9f367fed1739a6e72769787295c0ea99d7d11c3f3d45bcc10ecbc89"
---

# Redis is open source again (antirez.com news/151)

## Source Snapshot

[FULL POST] 以下为博文正文全文逐字快照（<pre> 正文块）。

Five months ago, I rejoined Redis and quickly started to talk with my colleagues about a possible switch to the AGPL license, only to discover that there was already an ongoing discussion, a very old one, too. Many people, within the company, had the feeling that the AGPL was a better pick than SSPL, and while eventually Redis switched to the SSPL license, the internal discussion continued.

I tried to give more strength to the ongoing pro-AGPL license side. My feeling was that the SSPL, in practical terms, failed to be accepted by the community. The OSI wouldn’t accept it, nor would the software community regard the SSPL as an open license. In little time, I saw the hypothesis getting more and more traction, at all levels within the company hierarchy.

I’ll be honest: I truly wanted the code I wrote for the new Vector Sets data type to be released under an open source license. Writing open source software is too rooted in me: I rarely wrote anything else in my career. I’m too old to start now. This may be childish, but I wrote Vector Sets with a huge amount of enthusiasm exactly because I knew Redis (and my new work) was going to be open source again.

I understand that the core of our work is to improve Redis, to continue building a good system, useful, simple, able to change with the requirements of the software stack. Yet, returning back to an open source license is the basis for such efforts to be coherent with the Redis project, to be accepted by the user base, and to contribute to a human collective effort that is larger than any single company. So, honestly, while I can’t take credit for the license switch, I hope I contributed a little bit to it, because today I’m happy. I’m happy that Redis is open source software again, under the terms of the AGPLv3 license.

Now, time to go back to the terminal, to show Redis users some respect by writing the best code I’m able to write, and make Vector Sets more useful and practical: I have a few more ideas for improvements, and I hope that more will be stimulated by your feedback (it is already happening). Good hacking!

P.S. Redis 8, the first version of Redis with the new license, is also GA today, with a many new features and speed improvements of the core: https://redis.io/blog/redis-8-ga/

You can also find the Redis CEO blog post here: https://redis.io/blog/agplv3/

## Research Notes

- 角色：科技域长篇当事人解读。注意：作者不是独立第三方——antirez 是 Redis 创始人且发文时受雇于 Redis，本文应作为"带利益关联的解释性材料"测试归属能力，而非中立二手解读。
- 与其他 sourceId 的关系：解释 tech-redis-blog-2025-002 的决策过程（自述五个月前回归后即讨论 AGPL 切换）；文末明确链接 Redis 8 GA 博文与 CEO 博文；tech-redis-hn-004 中 c0l0、simonw 等直接回应本文。
- 事实/观点区分："Five months ago, I rejoined Redis" 为自述经历（experience）；关于社区会如何反应的期待是预测（prediction）；AGPL 切换动机的叙述是当事人视角（author-opinion）。
- publishedAt：页面仅显示相对时间（抓取时 "451 days ago"），结合 HN 提交时间 2025-05-01T15:56:35Z 定为 2025-05-01（uncertainty: 精确时刻未知）。
- 页面显示 407134 views（抓取时快照值）。
