#!/usr/bin/env node

import { setTimeout as delay } from "node:timers/promises";
import { IngestJobApplicationService, assertRuntimeReady } from "../application/index.js";
import { loadConfig } from "../config/index.js";

const once = process.argv.includes("--once");
const pollMs = parsePositiveInteger(process.env.WGE_WORKER_POLL_MS, 1000, "WGE_WORKER_POLL_MS");
const config = loadConfig();
assertRuntimeReady(config);
const worker = new IngestJobApplicationService(config, {
	onProgress: (event) => console.error(`[worker:${event.stage}] ${event.message}`),
});

let keepRunning = true;
while (keepRunning) {
	const result = await worker.runOnce();
	if (result.job) {
		console.error(`[worker] job=${result.job.jobId} state=${result.job.state}`);
	}
	if (once) keepRunning = false;
	if (!result.processed) await delay(pollMs);
}

function parsePositiveInteger(raw: string | undefined, fallback: number, name: string): number {
	const value = raw === undefined ? fallback : Number.parseInt(raw, 10);
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new Error(`${name} must be a positive safe integer, received: ${raw}`);
	}
	return value;
}
