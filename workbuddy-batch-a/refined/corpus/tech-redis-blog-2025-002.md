---
sourceId: tech-redis-blog-2025-002
title: "Redis is now available under the AGPLv3 open source license"
domain: technology
sourceRole: "C/P"
platform: official
author: "Rowan Trollope (CEO, Redis)"
canonicalUrl: "https://redis.io/blog/agplv3/"
publishedAt: "2025-05-01T00:00:00Z"
capturedAt: "2026-07-27T06:36:50Z"
versionRef: "applies starting Redis 8"
mediaType: article
language: en
usage: internal-only
accessStatus: full
contentHash: "sha256:7e553d3b1d914c57acfa2b68edbc726100ae4172fa94f295bd642872c5c1e9ad"
---

# Redis is now available under the AGPLv3 open source license

## Source Snapshot

[EXCERPT NOTICE] 以下为官方博客正文的逐字快照（自标题起，至 "View as Markdown" 前；站点框架已去除；"Summarize with AI" 按钮文字已剔除一处）。

Redis is now available under the AGPLv3 open source license
May 01, 2025
2 minute read
Rowan Trollope
The rise of hyperscalers like AWS and GCP has unlocked incredible speed and scale for startups and enterprises alike. But for companies rooted in open source, it has posed a fundamental challenge: how do you keep innovating and investing in OSS projects when cloud providers reap the profits and control the infrastructure without proportional contributions back to the projects that they exploit?
To counter this, companies like MongoDB and Elastic adopted SSPL to protect their business from cloud providers extracting value without reinvesting. Redis initially took a different approach, creating Redis Stack as a separate distribution with a different license for advanced features. While this safeguarded innovation, it also split the developer experience and slowed progress on core Redis. What we really needed was a way to enhance Redis at its core without maintaining two separate tracks—Redis Community Edition and Redis Stack.
After I joined the company, and a year of evaluating alternatives, in March 2024, we decided to
move Redis to the SSPL license
. This achieved our goal—AWS and Google now maintain their own fork—but the change hurt our relationship with the Redis community. SSPL is not truly open source because the Open Source Initiative clarified it lacks the requisites to be an OSI-approved license.
Following our license change, in November of 2024 Salvatore Sanfillipo (antirez) decided to
rejoin Redis
as a developer evangelist. Collaborating with Salvatore on new capabilities, company strategy and community engagement has been a true privilege that has made a major impact that will pay dividends into the future.
With guidance from Salvatore, our CTO, Benjamin Renaud, and our core developers, we have made some key decisions to improve Redis going forward:
Adding the OSI-approved
AGPL
as an additional licensing option for Redis, starting with Redis 8 (available now);
Introducing vector sets—the first new data type in years—created by Salvatore;
Integrating Redis Stack technologies, including JSON, Time Series, probabilistic data types, Redis Query Engine and more into core Redis 8 under AGPL;
Delivering over 30 performance improvements with up to 87% faster commands and 2x throughput; and
Improving community engagement, particularly with client ecosystem contributions.
Redis 8 with its new capabilities and with AGPL licensing demonstrates our ongoing commitment to making a platform developers love, while advancing Redis according to Salvatore’s original vision.


## Research Notes

- 角色：科技域第二份一手材料（T1），与 2024 公告构成版本对。宣布自 Redis 8 起新增 AGPLv3 作为许可选项。
- 与其他 sourceId 的关系：SUPERSEDES（部分）tech-redis-blog-2024-001 的许可政策；与 tech-redis-antirez-003 同日发布、相互印证（antirez 文末链接本文）；tech-redis-hn-004 是对本文与 antirez 文的直接社区反应。
- 事实/观点区分：AGPLv3 自 Redis 8 可用为官方决定（fact）；关于 SSPL "wasn't accepted by the community" 与 fork 局面的叙述带官方立场色彩（author-opinion，需与社区版本对照）。
- publishedAt 取页面可见日期 "May 01, 2025"，具体时刻未知（uncertainty）。
- 本文未撤回 RSALv2/SSPLv1——AGPLv3 是新增选项而非替换，出题时注意 NARROWS 语义。
