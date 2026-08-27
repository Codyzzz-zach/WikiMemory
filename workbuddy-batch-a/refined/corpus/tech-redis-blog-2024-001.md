---
sourceId: tech-redis-blog-2024-001
title: "Redis Adopts Dual Source-Available Licensing"
domain: technology
sourceRole: "P"
platform: official
author: "Redis (official blog; bylined "Redis")"
canonicalUrl: "https://redis.io/blog/redis-adopts-dual-source-available-licensing/"
publishedAt: "2024-03-20T00:00:00Z"
capturedAt: "2026-07-27T06:36:50Z"
versionRef: "applies starting Redis 7.4"
mediaType: article
language: en
usage: internal-only
accessStatus: full
contentHash: "sha256:eaa8bac31247f6fe6efe8db83c8160a8e96ec13beb85078ee262b42ea53cb593"
---

# Redis Adopts Dual Source-Available Licensing

## Source Snapshot

[EXCERPT NOTICE] 以下为官方博客正文的逐字快照（自标题起，至页尾 CTA 前；导航等站点框架已去除；页面内嵌 "Summarize with AI" 按钮文字已剔除一处）。

Redis Adopts Dual Source-Available Licensing
March 20, 2024
16 minute read
Redis
Future Redis releases will continue to offer free and permissive use of the source code under dual RSALv2 and SSPLv1 licenses; these releases will combine advanced data types and processing engines previously only available in Redis Stack.
Beginning today, all future versions of Redis will be released with source-available licenses. Starting with Redis 7.4, Redis will be dual-licensed under the
Redis Source Available License (RSALv2)
and
Server Side Public License (SSPLv1)
. Consequently, Redis will no longer be distributed under the three-clause Berkeley Software Distribution (BSD).
From day one, Redis has provided a foundation of performance and simplicity for the applications and data infrastructure that power the modern Internet. Now, 15 years later, we’re proud to serve millions of developers across the globe by supporting real-time applications the world depends on every day. We have already implemented dual licensing for our advanced Redis modules under the Redis Stack distribution, which has been well received by the community. In fact, more than 50% of redis.io downloads – from Redis 6 and beyond – come from Redis Stack. We now believe that extending this licensing to Redis itself will enable us to continue to evolve the most holistic set of data models, processing engines, and developer capabilities for our users.
The new source-available licenses allow us to sustainably provide permissive use of our source code. We’re leading Redis into its next phase of development as a real-time data platform with a unified set of clients, tools, and core Redis product offerings. The
Redis source code
will continue to be freely available to developers, customers, and partners through Redis Community Edition. Future Redis source-available releases will unify core Redis with Redis Stack, including search, JSON, vector, probabilistic, and time-series data models in one free, easy-to-use package as downloadable software. This will allow anyone to easily use Redis across a variety of contexts, including as a high-performance key/value and document store, a powerful query engine, and a low-latency
vector database
powering generative AI applications.
The success of Redis has created a unique set of challenges. Redis has been sponsoring the bulk of development alongside a dynamic community of developers eager to contribute. However, the majority of Redis’ commercial sales are channeled through the largest cloud service providers, who commoditize Redis’ investments and its open source community. Despite efforts to support a community-led governance model, and our desire to
maintain the BSD license
, delivering multiple software distributions simultaneously – across open-source, source-available, and commercial software optimized for different on-premises and cloud platforms – is at odds with our ability to drive Redis successfully into the future.
Under the new license, cloud service providers hosting Redis offerings will no longer be permitted to use the source code of Redis free of charge. For example, cloud service providers will be able to deliver Redis 7.4 only after agreeing to licensing terms with Redis, the maintainers of the Redis code. These agreements will underpin support for existing integrated solutions and provide full access to forthcoming Redis innovations.
“We look forward to continuing our collaborative work to support developers with the latest data storage and management innovations,” said Julia Liuson, President, Developer Division at Microsoft. “Our collaboration continues to support integrated solutions like Azure Cache for Redis, and will provide Microsoft customers with exclusive access to expanded features within Redis offerings.”
In practice, nothing changes for the Redis developer community who will continue to enjoy permissive licensing under the dual license. At the same time, all the Redis client libraries under the responsibility of Redis will remain open source licensed. Redis will continue to support its vast partner ecosystem – including managed service providers and system integrators – with exclusive access to all future releases, updates, and features developed and delivered by Redis through its
Partner Program
. There is no change for existing Redis Enterprise customers.
Our new licensing approach strikes the best balance between making Redis source code broadly available, supporting the developer community with minimal limitations, and protecting our ability to continue investing in feature-rich, free-of-charge software and enterprise products.
As we have always done, our team, our community, and our customers and partners will continue to lead the way in creating, advancing, and deploying Redis as the leading real-time data platform.
For more information, please read the FAQ on the license change below.
1. What did Redis announce today?
Redis announced a transition from the BSD 3-Clause License to a dual license approach for Redis core software, using the
Redis Source Available License version 2
(RSALv2) or the Server Side Public License version 1 (SSPLv1) starting with Redis v7.4 and for all future releases of Redis.
RSALv2 is a permissive non-copyleft license, allowing the right to “use, copy, distribute, make available, and prepare derivative works of the software” and has only two primary limitations. Under RSALv2, you may not:
-Commercialize the software or provide it to others as a managed service; and
-Remove or obscure any licensing, copyright, or other notices.
Our dual license approach is not new; we released Redis modules (including RedisJSON, Redis Stack, etc.) under the dual licenses on Nov. 15, 2022. Now, we are moving to dual licensing for all our freely available software. We believe that the permissive approach of RSALv2 and the standard wording we use to define its limitations solve many of the challenges raised by our community.
This dual-license approach allows users to choose between a permissive but less well-known license, RSALv2, or a more commonly used but copyleft license, such as SSPLv1.
To be clear, neither RSALv2 nor SSPL is an OSI-approved license, and each has its restrictions. Simply put, RSALv2 places some limits on commercializing the software. SSPLv1 requires that if you provide the product as a service, you must publicly release any modifications and the source code of your management layers under SSPL.
The necessity of source-available licenses in the cloud era has been discussed many times, and we are proud to contribute to this effort by adopting standards developers already know and use. We believe the dual license provides clarity and flexibility for Redis developers in how they can leverage our latest technologies.
Other permissively licensed technologies associated with Redis such as various language-specific client libraries, Terraform and Pulumi providers, and more are unaffected by this change.
Further, starting with Redis 8 we plan to include in our offerings, by default, new data types and processing engines which previously were licensed under the RSALv2 or SSPLv1 as part of Redis Stack.
As a result, we are also announcing the end of life for Redis Stack once Redis 8 is available, as a result of this change. It will no longer be necessary to provide a separate build of these capabilities as they will be part of Redis itself starting with Redis 8.
2. Why is Redis Inc. making this change?
We want all developers to have access to the best technology we have to offer. But, we had to do all of these module gymnastics to advance things which honestly should be in the core of Redis itself. We weren’t being true to the original manifesto — we’re against complexity. So, this change aligns the licensing in a way that we can simplify the packaging and release of additional data types and more in a way that is simple and consistent.
We strongly believe in the value of openly sharing source code and enabling practitioners to solve their problems, build communities, and create transparency. Redis provides feature-rich products to the community for free, and that development is made possible by our commercial customers who partner with us. By shifting to this license, Redis can better manage commercial uses of our source code and continue to invest in our thriving community of practitioners, some of whom are also contributors, in a manner that will not impede their work.
3. What are the implications of this change for end users of Redis’ open source products?
For end users who are using Redis’ open source version of Redis and new releases using either of the dual licenses for their internal or personal usage, there is no change.
4. What are the implications of this change for third-party libraries which leverage Redis?
For integration partners who built client libraries or other integrations with Redis, there is no change.
5. What are the implications of this change for commercial customers of Redis?
For commercial customers of Redis there is no change. Those customers get our technology under separately negotiated licensing terms.
6. Who is impacted by this change?
Organizations providing competitive offerings to Redis will no longer be permitted to use new versions of the source code of Redis free of charge under either of the dual licenses. Commercial licensing terms are available and can enable use cases beyond the RSALv2 or SSPLv1 license limitations. If you are building a solution that leverages Redis, but does not specifically compete with Redis itself, there is no impact. If you have specific concerns or questions that you wish to discuss, please email
redis_licensing@redis.com
.
7. What is a “competitive offering” as defined under the Redis RSALv2 or SSPLv1 licenses?
A “competitive offering” is a product that is sold to third parties, including through paid support arrangements, that is derived from the Redis’ code-base and significantly overlaps the capabilities of a Redis commercial product. For example, this definition would include hosting or embedding Redis as part of a solution that is sold competitively against our commercial versions of Redis (either Redis Enterprise Software or Redis Cloud). Custom licensing terms are also available to provide more clarity and enable use cases beyond the RSALv2 or SSPLv1 limitations. If you need further clarification with respect to a particular use case, you can email
redis_licensing@redis.com
.
8. What products will be covered by RSALv2 or SSPLv1 in their next release?
This change effectively aligns the licensing of all of our source available modules with the core of Redis.
9. What is the SSPLv1 License?
The
SSPL
is based on the GNU Affero General Public License (AGPL), with a modified Section 13 that requires that those making SSPL-licensed software available to third-parties (modified or not) as part of a “service” must release the source code for the entirety of the service, including without limitation all “management software, user interfaces, application program interfaces, automation software, monitoring software, backup software, storage software and hosting software, all such that a user could run an instance of the service using the Service Source Code you make available”, under the SSPL. MongoDB is the publisher of this license. You can find their original FAQ about the license
here
.
10. If I modify the source code of software licensed under the SSPL, can I redistribute my modified version under another license?
No. Your modified version consists of the original software and your modifications, which together constitute a derivative work of the original software. The SSPL license does not grant you the right to redistribute under another license.
However, if you choose to use the RSALv2 license (under the dual license), you may modify and redistribute the code, provided that you don’t make the functionality of the Software or a Modified version available to third parties as a service or distribute the Software or a Modified version in a manner that makes the functionality of the Software available to third parties
11. Can I continue to use versions of the products that were provided under the original 3-clause BSD license?
Yes. The license change is not retroactive. This means all source code and releases prior to the change remain under the 3-clause BSD license. You may continue to use those versions indefinitely under the original license, as long as you abide by its terms and conditions. Redis plans to continue to provide security updates and address other critical defects within these releases until Redis Community Edition is available per our current
security policy
.
12. Will Redis backport security patches to previous releases under the 3-clause BSD license?
Redis will continue to backport critical security patches, as available, to existing versions under the 3-clause license until Redis Community Edition 9.0 is released, consistent with the
current security policy
. Any patches after that date will be provided under the new dual license.
13. Does Redis still believe in open source?
First, we openly acknowledge that this change means Redis is no longer open source under the
OSI definition
.
Second, we give away more technology than we monetize. Every day someone is using a free version of Redis in amazing and incredibly innovative ways and we applaud that. We will continue to invest to ensure that Redis remains a compelling and competitive platform for years to come.
Third, changing the license term to protect one’s brand and IP has become a natural part of the evolution of many open source projects in order for commercial entities which back those technologies to survive and thrive as businesses.
Finally, Redis remains a proponent of the open source philosophy and maintains a large number of open source projects, including many of the language specific client libraries (see https://github.com/redis) used with Redis, integration tooling such as the Redis Input-Output Tool (see https://github.com/redis-developer) and more. For those who wish to contribute, we remain open to accepting future contributions – as we have done with our source available modules over the past five years.
14. How does Redis now refer to the freely available versions of products that were formerly known as open source (or OSS)?
We have referred to versions of our products as either open source (OSS), Enterprise, or Cloud. Redis v7.2 and prior releases will continue to be called Redis OSS. Starting with Redis v7.4, we will refer to the open, freely available versions as Redis Community Edition. Both the RSALv2 and SSPL v1 licenses provide open and free access to the underlying source code of Redis Community Edition. However, it does not meet the definition of open source as defined by OSI, and that is why we will refer to the products as the “community edition” rather than the “open source” edition, as we did previously. There are many references to open source on our websites, and we are actively working to clarify these language changes in the coming weeks.
15. How do I work with Redis to offer managed services?
Integration and managed service provider partners can continue building, operating, and delivering solutions that leverage Redis Community Edition and Enterprise in a non-competitive offering by entering into a partnership with Redis. Community and Enterprise level partners will continue to benefit from incentives, technical training, certification, and sales training. Crucially, partners will receive exclusive access to forthcoming Redis technologies, features, and releases that will be protected under the dual license. To become a Redis partner or learn more about our partner benefits, please visit our
Partner Program site
. For existing partners with any questions regarding the licensing change, please email
redis_licensing@redis.com
.
16. I’m building (or have built) a product that embeds Redis, and I’m concerned you may view it as competitive. How can I get clarity as to whether my product will violate the RSALv2 or SSPLv1 licenses?
Please reach out to us. We are happy to speak with you. The best way to begin the conversation is at
redis_licensing@redis.com
. We can provide timely feedback to your questions and discuss constructive solutions, including potential exemptions and/or partnership arrangements.
17. I am the author of an open-source project that uses Redis in a non-competitive way. If someone else uses my project to produce a competitive product or hosted service (e.g., starts using my project in their SaaS solution), am I at risk of being considered competitive and violating the dual license? Do I need to track all users of my project and report suspected infringing use?
Only those who are embedding or hosting Redis products in a competitive manner are in violation of the license. The violation does not extend to a project owner who is not doing so and does not require asking others to do so on its behalf. The project owner has no obligation to monitor or report on how others are using their project.
18. Can I continue to provide professional services around Redis products?
Yes. We have a large ecosystem of systems integrator partners that provide consulting and professional services to help users deploy, manage, and operate our products for their internal use. The change to our license is not intended to deter partners from providing those services, and we will continue to encourage and support these types of systems integrator partners. Instead, the RSALv2 simply prevents embedding or hosting our community products in a manner competitive with ours.
19. Can I mix the code made available under either RSALv2 or SSPLv1 with code provided under a different license (i.e., Apache, MPL, etc.) in my project?
Yes, provided that each of the components keep their own license, and you do not mix the RSALv2 or SSPLv1 code with strong copyleft licensed code such as GPL. With respect to some permissive licenses like Apache, you may also provide the whole program under RSALv2 or SSPLv1, but include a notice for the Apache portion (this is possible because Apache, unlike some other open source licenses, grants the right to sublicense). Keep in mind that if you mix code under different licenses, you may not be able to re-distribute it in a way that complies with all the licenses.
20. Can I host Redis as a service internal to my organization?
Yes. The terms of the RSALv2 or SSPLv1 allow for all non-production and production usage, except for providing competitive offerings to third parties that embed or host our software. Hosting the products for the internal use of your organization is permitted. An organization includes its affiliates and subsidiaries. This means one division can host Redis for use by another internal division.
21. What if Redis releases a new product or feature in the future that makes my project competitive?
If Redis creates an offering in the future that is competitive with a product you are already offering in production, your continued use of the hosted or embedded Redis product will not be considered a violation of the RSALv2 or SSPLv1, as long as the version you are using was released before Redis released its new offering.
22. Are there updated requirements for the usage of “Redis” in my product name?
Yes, there are updated requirements on the use of “Redis” in product names. You can no longer use “Redis” or “for Redis” in your product name, but you can use the name “Redis” in your product descriptions or specify that your product is Redis-compatible or based on legacy-Redis. Additional information around usage of the Redis name and logo can be found in our
Trademark Policy
.
23. Where can I learn more about this announcement or ask further questions?
Read the
Blog Post
or reach out to us at
redis_licensing@redis.com
.
24. Will Redis accept community contributions under the new license?
Redis remains a proponent of the open source philosophy and maintains a large number of open source projects. For those who wish to contribute, we remain open to accepting future contributions – as we have done with our source available modules over the past five years.Going forward, acceptance of the
contributor license agreement
(CLA) by the contributor is necessary in order for us to consider the contribution.
View as Markdown
Share


## Research Notes

- 角色：科技域一手官方公告（T0）。宣布自 Redis 7.4 起以 RSALv2 + SSPLv1 双许可发布，不再使用 BSD 三条款。
- 与其他 sourceId 的关系：被 tech-redis-blog-2025-002（AGPLv3 公告）在 2025-05-01 部分 SUPERSEDES（新增 AGPLv3 选项）；tech-redis-antirez-003 从当事开发者角度回溯此决定；tech-redis-hn-004 中社区对此前变更表达持续不信任。
- 事实/观点区分："Beginning today, all future versions..." 为官方决定（fact）；关于云服务商获益不回馈的论述是官方立场（author-opinion）；"more than 50% of redis.io downloads ... come from Redis Stack" 为官方自述数据（self-reported）。
- publishedAt 取页面可见日期 "March 20, 2024"，具体时刻未知（记 00:00:00Z，uncertainty）。
- 注意：本公告发布时对"未来所有版本"的表述在 2025-05 被新公告修改——出题时严禁把本文当作 2025-05 之后的现行政策。
