import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../config/index.js";
import { RuntimeWriteConflictError, withRuntimeWriteLease } from "./runtime-write-lock.js";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("runtime canonical writer lease", () => {
	it("allows nested mutations in one use case and releases after success", () => {
		const config = fixtureConfig();
		const value = withRuntimeWriteLease(config, "outer", () =>
			withRuntimeWriteLease(config, "inner", () => "committed"),
		);
		expect(value).toBe("committed");
		expect(withRuntimeWriteLease(config, "next", () => "next")).toBe("next");
	});

	it("rejects a concurrent live owner and exposes a retryable error code", () => {
		const config = fixtureConfig();
		const lockPath = join(config.projectRoot, ".locks", "canonical-writer");
		mkdirSync(lockPath, { recursive: true });
		writeFileSync(
			join(lockPath, "owner.json"),
			JSON.stringify({
				schemaVersion: "wge-runtime-write-lease/v1",
				token: "active",
				operation: "existing publication",
				hostname: hostname(),
				pid: process.pid,
				acquiredAt: new Date().toISOString(),
			}),
		);

		try {
			withRuntimeWriteLease(config, "contender", () => undefined);
			throw new Error("expected conflict");
		} catch (error) {
			expect(error).toBeInstanceOf(RuntimeWriteConflictError);
			expect((error as RuntimeWriteConflictError).code).toBe("RUNTIME_WRITE_CONFLICT");
		}
	});

	it("releases the lease after failure", () => {
		const config = fixtureConfig();
		expect(() =>
			withRuntimeWriteLease(config, "failing", () => {
				throw new Error("injected failure");
			}),
		).toThrow("injected failure");
		expect(withRuntimeWriteLease(config, "recovery", () => "healthy")).toBe("healthy");
	});
});

function fixtureConfig() {
	const root = mkdtempSync(join(tmpdir(), "wge-write-lock-"));
	roots.push(root);
	return loadConfig({ runtimeRoot: root, apiKey: "" });
}
