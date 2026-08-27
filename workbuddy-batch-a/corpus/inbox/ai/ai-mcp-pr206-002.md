---
sourceId: ai-mcp-pr206-002
title: "[RFC] Replace HTTP+SSE with new \"Streamable HTTP\" transport (PR #206)"
domain: ai
sourceRole: "C"
platform: github
author: "jspahrsummers (Justin Spahr-Summers)"
canonicalUrl: "https://github.com/modelcontextprotocol/modelcontextprotocol/pull/206"
publishedAt: "2025-03-17T09:38:57Z"
capturedAt: "2026-07-27T06:36:50Z"
versionRef: "merge commit 880673aef59430dec5292c9b381f88857690a7a9; merged 2025-03-24T11:51:34Z; incorporated into spec revision 2025-03-26"
mediaType: thread
language: en
usage: internal-only
accessStatus: full
contentHash: "sha256:c176a7819b9a52720d9866fde0912d1880ae28a6d25cdcc6b9b0ef7a156ff0e7"
---

# [RFC] Replace HTTP+SSE with new "Streamable HTTP" transport (PR #206)

## Source Snapshot

PR #206: [RFC] Replace HTTP+SSE with new "Streamable HTTP" transport
Repository: modelcontextprotocol/modelcontextprotocol (at PR time: modelcontextprotocol/specification)
Author: jspahrsummers
Created: 2025-03-17T09:38:57Z
Merged: 2025-03-24T11:51:34Z
Merge commit: 880673aef59430dec5292c9b381f88857690a7a9
State: closed

--- PR BODY (verbatim) ---

This PR introduces the Streamable HTTP transport for MCP, addressing key limitations of the current HTTP+SSE transport while maintaining its advantages.

Our deep appreciation to @atesgoral and @topherbullock (Shopify), @samuelcolvin and @Kludex (Pydantic), @calclavia, Cloudflare, LangChain, Vercel, the Anthropic team, and many others in the MCP community for their thoughts and input! This proposal was only possible thanks to the valuable feedback received in [the GitHub Discussion](https://github.com/modelcontextprotocol/specification/discussions/102).

## TL;DR

As compared with the [current HTTP+SSE transport](https://spec.modelcontextprotocol.io/specification/2024-11-05/basic/transports/#http-with-sse):

1. We remove the `/sse` endpoint
2. All client → server messages go through the `/message` (or similar) endpoint
3. All client → server requests could be upgraded by the server to be SSE, and used to send notifications/requests
4. Servers can choose to establish a session ID to maintain state
5. Client can initiate an SSE stream with an empty GET to `/message`

This approach can be implemented backwards compatibly, and allows servers to be fully stateless if desired.

## Motivation

Remote MCP currently works over HTTP+SSE transport which:
- Does not support resumability
- Requires the server to maintain a long-lived connection with high availability
- Can only deliver server messages over SSE

## Benefits

- **Stateless servers are now possible**—eliminating the requirement for high availability long-lived connections
- **Plain HTTP implementation**—MCP can be implemented in a plain HTTP server without requiring SSE
- **Infrastructure compatibility**—it's "just HTTP," ensuring compatibility with middleware and infrastructure
- **Backwards compatibility**—this is an incremental evolution of our current transport
- **Flexible upgrade path**—servers can choose to use SSE for streaming responses when needed

## Example use cases

### Stateless server

A completely stateless server, without support for long-lived connections, can be implemented in this proposal.

For example, a server that just offers LLM tools and utilizes no other features could be implemented like so:

1. Always acknowledge initialization (but no need to persist any state from it)  
2. Respond to any incoming `ToolListRequest` with a single JSON-RPC response  
3. Handle any `CallToolRequest` by executing the tool, waiting for it to complete, then sending a single `CallToolResponse` as the HTTP response body

### Stateless server with streaming

A server that is fully stateless and does not support long-lived connections can still take advantage of streaming in this design.

For example, to issue progress notifications during a tool call:

1. When the incoming POST request is a `CallToolRequest`, server indicates the response will be SSE  
2. Server starts executing the tool  
3. Server sends any number of `ProgressNotification`s over SSE while the tool is executing  
4. When the tool execution completes, the server sends a `CallToolResponse` over SSE  
5. Server closes the SSE stream

### Stateful server

A stateful server would be implemented very similarly to today. The main difference is that the server will need to generate a session ID, and the client will need to pass that back with every request.

The server can then use the session ID for sticky routing _or_ routing messages on a message bus—that is, a POST message can arrive at any server node in a horizontally-scaled deployment, so must be routed to the existing session using a broker like Redis.

## Why not WebSocket?

The core team thoroughly discussed making WebSocket the primary remote transport (instead of SSE), and applying similar work to it to make it disconnectable and resumable. We ultimately decided not to pursue WS right now because:

1. Wanting to use MCP in an "RPC-like" way (e.g., a stateless MCP server that just exposes basic tools) would incur a lot of unnecessary operational and network overhead if a WebSocket is required for each call.  
2. From a browser, there is no way to attach headers (like `Authorization`), and unlike SSE, third-party libraries cannot reimplement WebSocket from scratch in the browser.  
3. Only GET requests can be transparently upgraded to WebSocket (other HTTP methods are not supported for upgrading), meaning that some kind of two-step upgrade process would be required on a POST endpoint, introducing complexity and latency.

We're also avoiding making WebSocket an additional *option* in the spec, because we want to limit the number of transports officially specified for MCP, to avoid a combinatorial compatibility problem between clients and servers. (Although this does not prevent community adoption of a non-standard WebSocket transport.)

The proposal in this doc does not preclude further exploration of WebSocket in future, if we conclude that SSE has not worked well.

# To do

- [x] Move session ID responsibility to server
    - [x] Define acceptable space of session IDs
    - [x] Ensure session IDs are introspectable by middleware/WAF
- [x] Make cancellation explicit
- [x] Require centralized SSE GET for server -> client requests and notifications
- [x] Convert resumability into a per-stream concept
- [x] Design a way to proactively "end session"
- [x] "if the client has an auth token, it should include it in every MCP request"

## Follow ups

- Standardize support for JSON-RPC batching
- Support for streaming request bodies?
- Put some recommendations about timeouts into the spec, and maybe codify conventions like "issuing a progress notification should reset default timeouts."

## Research Notes

- 角色：AI 域一手实现/变更提案（T1 证据）。提出以 Streamable HTTP 取代 2024-11-05 版的 HTTP+SSE transport。
- 与其他 sourceId 的关系：SUPERSEDES ai-mcp-spec-2024-11-05-001 中的 HTTP with SSE transport（PR 明确 "We remove the /sse endpoint"）；该变更后被纳入 2025-03-26 版规范（本批未单独冻结 2025-03-26 规范全文，uncertainty：规范正式文本与 PR 描述可能有措辞差异）。
- 事实/观点区分：TL;DR 与变更列表为提案事实；"Benefits" 部分（如 backwards compatible、stateless servers possible）是作者论证，实施效果属预期而非实测结论。
- PR body 全文冻结；PR 下的社区评论未冻结（数量大，仅保留 body）。
- 注意：PR 创建于 2025-03-17，合并于 2025-03-24；生效的规范版本号是 2025-03-26。
