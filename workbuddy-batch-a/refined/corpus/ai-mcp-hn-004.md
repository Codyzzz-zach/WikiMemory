---
sourceId: ai-mcp-hn-004
title: "Hacker News thread: \"Model Context Protocol\" (item 42237424)"
domain: ai
sourceRole: "U"
platform: hackernews
author: "benocodes (submitter) + multiple commenters"
canonicalUrl: "https://news.ycombinator.com/item?id=42237424"
publishedAt: "2024-11-25T16:14:22Z"
capturedAt: "2026-07-27T06:36:50Z"
versionRef: null
mediaType: thread
language: en
usage: internal-only
accessStatus: partial
contentHash: "sha256:f6293e84b87eb823d1b5583751cf0afd43d6ed30ea8bd31c869e01cae5555cc4"
---

# Hacker News thread: "Model Context Protocol" (item 42237424)

## Source Snapshot

[SELECTION NOTICE] 线程共 254 个节点（67 条顶层评论）。以下为按"直接回复数"排序的前 14 条顶层评论逐字快照（经 HN Algolia API 获取，HTML 标签已剥离、空白已归一化）；嵌套回复未包含。评论的编辑/删除状态不可见于该 API。

THREAD: Model Context Protocol | by benocodes | 2024-11-25T16:14:22.000Z | 872 pts

[somnium_sn | 2024-11-25T16:30:39.000Z | 29 direct replies]
@jspahrsummers and I have been working on this for the last few months at Anthropic. I am happy to answer any questions people might have.

[melvinmelih | 2024-11-25T20:55:35.000Z | 6 direct replies]
This is great but will be DOA if OpenAI (80% market share) decides to support something else. The industry trend is that everything seems to converge to OpenAI API standard (see also the recent Gemini SDK support for OpenAI API).

[jascha_eng | 2024-11-25T18:21:50.000Z | 5 direct replies]
Hmm I like the idea of providing a unified interface to all LLMs to interact with outside data. But I don't really understand why this is local only. It would be a lot more interesting if I could connect this to my github in the web app and claude automatically has access to my code repositories. I guess I can do this for my local file system now? I also wonder if I build an LLM powered app, and currently simply to RAG and then inject the retrieved data into my prompts, should this replace it? Can I integrate this in a useful way even? The use case of on your machine with your specific data, seems very narrow to me right now, considering how many different context sources and use cases there are.

[bionhoward | 2024-11-25T19:46:25.000Z | 4 direct replies]
I love how they’re pretending to be champions of open source while leaving this gem in their terms of use “”” You may not access or use, or help another person to access or use, our Services in the following ways: … To develop any products or services that compete with our Services, including to develop or train any artificial intelligence or machine learning algorithms or models. “””

[gyre007 | 2024-11-25T22:01:30.000Z | 4 direct replies]
Something is telling me this _might_ turn out to be a huge deal; I can't quite put a finger on what is that makes me feel that, but opening private data and tools via an open protocol to AI apps just feels like a game changer.

[outlore | 2024-11-25T17:17:43.000Z | 3 direct replies]
i am curious: why this instead of feeding your LLM an OpenAPI spec?

[killthebuddha | 2024-11-25T20:01:09.000Z | 3 direct replies]
I see a good number of comments that seem skeptical or confused about what's going on here or what the value is. One thing that some people may not realize is that right now there's a MASSIVE amount of effort duplication around developing something that could maybe end up looking like MCP. Everyone building an LLM agent (or pseudo-agent, or whatever) right now is writing a bunch of boilerplate for mapping between message formats, tool specification formats, prompt templating, etc. Now, having said that, I do feel a little bit like there's a few mistakes being made by Anthropic here. The big one to me is that it seems like they've set the scope too big. For example, why are they shipping standalone clients and servers rather than client/server libraries for all the existing and wildly popular ways to fetch and serve HTTP? When I've seen similar mistakes made (e.g. by LangChain), I assume they're targeting brand new developers who don't realize that they just want to make some HTTP calls. Another thing that I think adds to the confusion is that, while the boilerplate-ish stuff I mentioned above is annoying, what's REALLY annoying and actually hard is generating a series of contexts using variations of similar prompts in response to errors/anomalies/features detected in generated text. IMO this is how I define "prompt engineering" and it's the actual hard problem we have to solve. By naming the protocol the Model Context Protocol, I assumed they were solving prompt engineering problems (maybe by standardizing common prompting techniques like ReAct, CoT, etc).

[ianbutler | 2024-11-25T17:34:08.000Z | 2 direct replies]
I’m glad they're pushing for standards here, literally everyone has been writing their own integrations and the level of fragmentation (as they also mention) and repetition going into building the infra around agents is super high. We’re building an in terminal coding agent and our next step was to connect to external services like sentry and github where we would also be making a bespoke integration or using a closed source provider. We appreciate that they have mcp integrations already for those services. Thanks Anthropic!

[WhatIsDukkha | 2024-11-25T18:39:23.000Z | 2 direct replies]
I don't understand the value of this abstraction. I can see the value of something like DSPy where there is some higher level abstractions in wiring together a system of llms. But this seems like an abstraction that doesn't really offer much besides "function calling but you use our python code". I see the value of language server protocol but I don't see the mapping to this piece of code. That's actually negative value if you are integrating into an existing software system or just you know... exposing functions that you've defined vs remapping functions you've defined into this intermediate abstraction.

[orliesaurus | 2024-11-25T18:41:37.000Z | 2 direct replies]
Are there any other Desktop apps other than Claude's supporting this?

[keybits | 2024-11-25T19:11:09.000Z | 2 direct replies]
The Zed editor team collaborated with Anthropic on this, so you can try features of this in Zed as of today: https://zed.dev/blog/mcp

[bentiger88 | 2024-11-25T19:25:41.000Z | 2 direct replies]
One thing I dont understand.. does this rely on vector embeddings? Or how does the AI interact with the data? The example is a sqllite satabase with prices, and it shows claude being asked to give the average price and to suggest pricing optimizations. So does the entire db get fed into the context? Or is there another layer in between. What if the database is huge, and you want to ask the AI for the most expensive or best selling items? With RAG that was only vaguely possible and didnt work very well. Sorry I am a bit new but trying to learn more.

[punkpeye | 2024-11-25T23:35:21.000Z | 2 direct replies]
I took time to read everything on Twitter/Reddit/Documentation about this. I think I have a complete picture. Here is a quickstart for anyone who is just getting into it. https://glama.ai/blog/2024-11-25-model-context-protocol-quic...

[bluerooibos | 2024-11-26T00:06:11.000Z | 2 direct replies]
Awesome! In the "Protocol Handshake" section of what's happening under the hood - it would be great to have more info on what's actually happening. For example, more details on what's actually happening to translate the natural language to a DB query. How much config do I need to do for this to work? What if the queries it makes are inefficient/wrong and my database gets hammered - can I customise them? How do I ensure sensitive data isn't returned in a query?



## Research Notes

- 角色：AI 域社区信号（MCP 发布当日的第一时间反应，2024-11-25，872 分）。
- 与其他 sourceId 的关系：somnium_sn 自述为 Anthropic 开发者并答疑（一手当事人混入社区线程，归属时需注意）；melvinmelih 预言 "will be DOA if OpenAI ... decides to support something else"——后被 ai-mcp-latent-003 记录的 OpenAI (3/27) 采纳事件证伪，构成演化对；bionhoward 对 Anthropic 服务条款竞业条款的批评是对官方叙事的反驳信号。
- 事实/观点区分：几乎全部为个人观点/预测/体验（statementKind: author-opinion / prediction / experience）；不可当作 MCP 的规范事实。
- 限制：仅前 14 条顶层评论（按直接回复数），accessStatus=partial；HN Algolia API 不显示编辑状态；点数/评论数为抓取时快照值。
