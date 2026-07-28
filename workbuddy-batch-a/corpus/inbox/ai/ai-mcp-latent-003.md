---
sourceId: ai-mcp-latent-003
title: "Why MCP Won (Latent.Space)"
domain: ai
sourceRole: "S"
platform: newsletter
author: "swyx (Latent.Space)"
canonicalUrl: "https://www.latent.space/p/why-mcp-won"
publishedAt: "2025-03-10T19:46:53Z"
capturedAt: "2026-07-27T06:36:50Z"
versionRef: null
mediaType: article
language: en
usage: internal-only
accessStatus: partial
contentHash: "sha256:8b0388f9ab0a49137af803d32c71af5a75e7e3c4e1304ff9d4dea063d2ee78ba"
---

# Why MCP Won (Latent.Space)

## Source Snapshot

[EXCERPT NOTICE] 以下为文章开头至中段的逐字节选（约 6,000 字符）。抓取到的页面文本在正文中段截断（Substack 页面动态加载），未获得文章全文；节选之外的论点不在本快照证据范围内。

Since this post,
OpenAI
(3/27) and
Google
(4/9) announced MCP support.
Dear AI Engineers,
I’m sorry for all the MCP filling your timeline right now.
The
Model Context Protocol
launched in November 2024
and it was
decently well received
, but the
initial flurry of excitement
(with everyone from
Copilot
to
Cognition
to
Cursor
adding support) died down
1
right until
the Feb 26-27 AI Engineer Summit
, where a chance conversation with
Barry Zhang
led to us booking
Mahesh Murag
(who wrote the MCP servers). I simply thought it’d be a nice change from Anthropic’s
2023
and
2024
prompting workshops, but then this happened:
Normally workshops are great for live attendees but it’s rare for an online audience to keep the attention span for a full 2 hours. But then
livetweets of the workshop
started going viral, because for the first time the community was getting announcements of the highly anticipated official registry, and also comprehensive deep dives into every part of the protocol spec like this:
We then bumped up the editing
2
process to release the workshop video, and, with almost
300k combined views
in the past week, this happened:
everybody complaining about too much MCP
One “reach” goal I have with Latent Space is to try to offer editorial opinions slightly ahead of the consensus. In November we said
GPT Wrappers Are Good, Actually
, and now
a16z is excited about them
.  In December we told $200/month Pro haters that
You’re all wrong, $2k/month “ChatGPT Max” is coming
and now we have confirmation that
$2-20k/month agents are planned
. But I have to admit MCP’s popularity caught even me offguard, mostly because I have seen many attempted
XKCD 927
’s come and go, and MCP was initially presented as a way to write local, privacy-respecting integrations for Claude Desktop, which I’m willing to bet only a small % of the AI Engineer population have even downloaded (as opposed to say
ChatGPT Desktop
and even
Raycast AI
).
Even though we made the workshop happen, I still feel that I underestimated MCP.
To paraphrase Ben Thompson, the #1 feature of any network is the people already on it. Accordingly,
the power of any new protocol derives from its adoption (aka ecosystem)
, and it’s fair to say that MCP has captured enough critical mass and momentum right now that it is already the presumptive winner of the 2023-2025 “agent open standard” wars. At current pace,
MCP will overtake OpenAPI in July
:
See for yourself
. Add Langchain if you’re curious but it skews the chart too much
Widely accepted standards, like Kubernetes and React and HTTP, accommodate the vast diversity of data emitters and consumers by
converting exploding MxN problems into tractable M+N ecosystem solutions
, and are therefore immensely valuable IF they can get critical mass. Indeed even OpenAI had the previous AI standard
3
with even
Gemini
,
Anthropic
and
Ollama
advertising OpenAI SDK compatibility.
I’m not arrogant enough to think the AIE Summit workshop
caused
this acceleration; we merely poured fuel on a fire we already saw spreading. But as a
student of developer tooling startups
, many of which try and fail to create momentum for open standards
4
, I feel I cannot miss the opportunity to study this closer while it is still fresh, so as to serve as a handbook for future standard creation. Besides, I get asked my MCP thoughts 2x a day so
it’s time
to write it down.
Why MCP Won (in short)
aka “won” status as de facto standard, over not-exactly-equivalent-but-alternative approaches like OpenAPI and LangChain/LangGraph. In rough descending order.
MCP is “AI-Native” version of old idea
MCP is an “open standard” with a big backer
Anthropic has the best developer AI brand
MCP based off LSP, an existing successful protocol
MCP dogfooded with complete set of 1st party client, servers, tooling, SDKs
MCP started with minimal base, but with frequent roadmap updates
Non-Factors:
Things that we think surprisingly did
not
contribute to MCP’s success
Lining up launch partners like Zed, SourceGraph Cody, and Replit
Launching with great documentation
I will now elaborate with some screengrabs.
oh
look
, another
god box
: "We can solve any problem by introducing an extra level of indirection."
MCP is “AI-Native” version of old idea
A lot of the “old school developer” types, myself included, would initially be confused by MCP’s success because, at a technical level, MCP is mostly capable of the same
5
kinds of capabilities enabled by existing standards like OpenAPI / OData / GraphQL / SOAP / etc.
So the implicit assumption is that the older, Lindy, standard should win.
However, to dismiss ideas on a technical basis is to neglect the sociological context that human engineers operate in. In other words, saying that “the old thing does the same, you should prefer the old thing” falls prey to the same
Lavers’ Law
fallacy of fashion every developer comes to, the same kind of attitude that leads one to dismiss
the Rise of the AI Engineer
because you assume it sufficiently closely maps on to an existing job. To paraphrase
Eugene Wei’s Status as a Service
, each new generation of developer actively looks for new ground to make their mark, basically because you already made your mark in yours.
The
reflexive
nature of the value of protocols - remember, they only have value because they can get adoption - mean that there is very little
ex ante
value to any of these ideas. MCP is valuable because the AI influencers deem it so, and therefore it
does become valuable
.
It’s also valuable that it is a revision of an
old idea
, meaning that it actually does fill a need we know we have, and not a made up need that is unproven.
However it is
ALSO
too dismissive to say that MCP is exactly equivalent to OpenAPI and it is mere cynical faddish cycles that drive its success. This is why I choose to describe this success factor as “
AI Native
” - in this case, MCP was born from lessons felt in
Claude Sonnet’s #1 SWE-Bench result
and articulated in
Building Effective Agents
, primarily this slide:

## Research Notes

- 角色：AI 域二手解释。作者 swyx 论证 MCP 为何在诸多 LLM 工具协议中胜出（AI Engineer Summit workshop 走红、OpenAI/Google 后续采纳、最小表面积 + 高频路线图更新等）。
- 与其他 sourceId 的关系：解释/评论 ai-mcp-spec-2024-11-05-001 的生态意义；文首更新注记 "Since this post, OpenAI (3/27) and Google (4/9) announced MCP support" 提供了带日期的采纳信号，可与 ai-mcp-hn-004 中 2024-11 的怀疑论（如 melvinmelih 预言 OpenAI 不支持则 DOA）构成时间演化对照。
- 事实/观点区分：发布日期、观看量（300k combined views）为作者自述数据（fact/self-reported）；"Why MCP Won" 的归因分析是作者观点（author-opinion）；"editorial opinions slightly ahead of the consensus" 为自我定位。
- 限制：accessStatus=partial，正文中段后未捕获；作者署名 swyx 依据 Latent.Space 站点惯例与文中第一人称叙述，页面 meta author 字段显示为 "Subscribers"（uncertainty）。
- publishedAt 取页面 JSON-LD datePublished（2025-03-10T19:46:53Z）；注意文中更新注记提及 3/27、4/9 事件，说明文章发布后有过编辑。
