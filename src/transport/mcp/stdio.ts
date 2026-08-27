#!/usr/bin/env node

import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createWikiMemoryMcpServer } from "./server.js";

serveStdio(() => createWikiMemoryMcpServer(), {
	onerror: (error) => console.error(`[wikimemory-mcp] ${error.message}`),
});
