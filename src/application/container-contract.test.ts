import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = process.cwd();

describe("container boundary contract", () => {
	it("builds from an allowlist and runs as a non-root user with durable state outside the image", () => {
		const dockerfile = readFileSync(join(repositoryRoot, "Dockerfile"), "utf-8");
		const runtimeStage = dockerfile.split("FROM node:22-bookworm-slim AS runtime")[1] ?? "";

		expect(dockerfile).not.toMatch(/^COPY\s+\.\s+\.$/m);
		expect(dockerfile).toContain("COPY src ./src");
		expect(runtimeStage).toContain("COPY --from=build --chown=node:node /app/dist ./dist");
		expect(runtimeStage).not.toContain("COPY src");
		expect(runtimeStage).toContain("WGE_RUNTIME_ROOT=/data");
		expect(runtimeStage).toContain("USER node");
		expect(runtimeStage).toContain('VOLUME ["/data"]');
	});

	it("excludes secrets, research assets and knowledge state from build context", () => {
		const dockerignore = new Set(
			readFileSync(join(repositoryRoot, ".dockerignore"), "utf-8")
				.split("\n")
				.map((line) => line.trim())
				.filter((line) => line.length > 0 && !line.startsWith("#")),
		);
		for (const required of [
			".env",
			"experiments",
			"runs",
			"benchmarks",
			"references",
			"sources",
			"publications",
			"quarantine",
			"versions",
			"wiki",
			"indexes",
			"claims",
			"concepts",
			"relations",
			"assertions",
			"jobs",
			"runtime-layout.json",
		]) {
			expect(dockerignore.has(required), `missing .dockerignore rule: ${required}`).toBe(true);
		}
	});

	it("mounts the explicit runtime root as a named volume", () => {
		const compose = readFileSync(join(repositoryRoot, "compose.yaml"), "utf-8");
		expect(compose).toContain("WGE_RUNTIME_ROOT: /data");
		expect(compose).toContain("wge-runtime:/data");
		expect(compose).toContain("dist/mcp.js");
		expect(compose).toContain("dist/worker.js");
		expect(compose).toContain("WGE_MCP_CAPABILITIES: ${WGE_MCP_CAPABILITIES:-read}");
		expect(compose).toContain("WGE_MCP_PRINCIPAL_ID: ${WGE_MCP_PRINCIPAL_ID:-}");
		expect(compose).toMatch(/volumes:\n\s+wge-runtime:/);
	});
});
