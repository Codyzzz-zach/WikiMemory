import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../config/index.js";
import type { LLMProvider } from "../core/llm-provider.js";
import type { ChatOptions, ChatResult } from "../core/types.js";
import { IngestJobApplicationService } from "./ingest-job-service.js";
import { initializeRuntime } from "./runtime.js";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("IngestJobApplicationService", () => {
	it("persists an idempotent submission without invoking the compiler", () => {
		const provider = new ThrowingProvider();
		const service = fixture(provider);
		const request = {
			sourceKey: "mcp-material",
			title: "MCP material",
			content: "# Evidence\n\nA durable statement.",
			idempotencyKey: "submission-1",
		};

		const first = service.submitMaterial(request);
		const repeated = service.submitMaterial(request);

		expect(first.state).toBe("PENDING");
		expect(repeated).toEqual({ ...first, duplicate: true });
		expect(service.getJob(first.jobId ?? "")).toEqual(
			expect.objectContaining({ sourceId: first.sourceId, state: "PENDING", attempts: 0 }),
		);
		expect(provider.calls).toBe(0);
	});

	it("rejects reusing an idempotency key for different content", () => {
		const { service, root } = fixtureWithRoot(new ThrowingProvider());
		service.submitMaterial({
			sourceKey: "one",
			title: "One",
			content: "First content.",
			idempotencyKey: "same-key",
		});
		expect(() =>
			service.submitMaterial({
				sourceKey: "two",
				title: "Two",
				content: "Different content.",
				idempotencyKey: "same-key",
			}),
		).toThrow("different ingest request");
		expect(
			readdirSync(join(root, "sources")).filter((file) => file.endsWith(".json")),
		).toHaveLength(1);
	});

	it("claims a persisted job and records worker failure durably", async () => {
		const provider = new ThrowingProvider();
		const service = fixture(provider);
		const submitted = service.submitMaterial({
			sourceKey: "failure",
			title: "Failure",
			content: "# Failure\n\nThis reaches the compiler.",
			idempotencyKey: "failure-1",
		});

		const processed = await service.runOnce();

		expect(processed.processed).toBe(true);
		expect(processed.job).toEqual(
			expect.objectContaining({
				jobId: submitted.jobId,
				state: "FAILED",
				attempts: 1,
				error: "worker provider failure",
			}),
		);
		expect(service.getJob(submitted.jobId ?? "")?.state).toBe("FAILED");
	});

	it("recovers an abandoned local RUNNING job before the next worker claim", async () => {
		const provider = new ThrowingProvider();
		const { service, root } = fixtureWithRoot(provider);
		const submitted = service.submitMaterial({
			sourceKey: "abandoned",
			title: "Abandoned",
			content: "# Recovery\n\nA worker may stop between durable stages.",
			idempotencyKey: "abandoned-1",
		});
		const jobPath = join(root, "jobs", `${submitted.jobId}.json`);
		const job = JSON.parse(readFileSync(jobPath, "utf-8"));
		writeFileSync(
			jobPath,
			JSON.stringify({
				...job,
				state: "RUNNING",
				worker: { hostname: hostname(), pid: 2_147_483_647 },
			}),
		);

		const processed = await service.runOnce();

		expect(processed.job).toEqual(
			expect.objectContaining({ state: "FAILED", attempts: 1, error: "worker provider failure" }),
		);
		expect(provider.calls).toBeGreaterThan(0);
	});

	it("requires an explicit retry transition after a failed attempt", async () => {
		const service = fixture(new ThrowingProvider());
		const submitted = service.submitMaterial({
			sourceKey: "retry",
			title: "Retry",
			content: "A failed job remains inspectable until explicitly retried.",
			idempotencyKey: "retry-1",
		});
		await service.runOnce();

		expect(service.retryFailedJob(submitted.jobId ?? "")).toEqual(
			expect.objectContaining({ state: "PENDING", attempts: 1, error: null }),
		);
		expect(() => service.retryFailedJob(submitted.jobId ?? "")).toThrow("Only FAILED");
	});
});

class ThrowingProvider implements LLMProvider {
	calls = 0;

	async chat(_options: ChatOptions): Promise<ChatResult> {
		this.calls += 1;
		throw new Error("worker provider failure");
	}

	async chatWithThinking(options: ChatOptions): Promise<ChatResult> {
		return this.chat(options);
	}
}

function fixture(provider: LLMProvider) {
	return fixtureWithRoot(provider).service;
}

function fixtureWithRoot(provider: LLMProvider) {
	const root = mkdtempSync(join(tmpdir(), "wge-jobs-"));
	roots.push(root);
	const config = loadConfig({ runtimeRoot: root, apiKey: "test" });
	initializeRuntime(config);
	return {
		root,
		service: new IngestJobApplicationService(config, { providerFactory: () => provider }),
	};
}
