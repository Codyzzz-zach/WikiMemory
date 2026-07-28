import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AppConfig } from "../config/types.js";
import { ingestFile } from "../ingestor/index.js";
import { DefaultLoaderRegistry, createDefaultLoaderRegistry } from "./registry.js";
import type { DocumentLoader } from "./types.js";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("loader registry", () => {
	it("fails explicitly for unsupported formats in the current Markdown-only milestone", () => {
		expect(() => createDefaultLoaderRegistry().resolve("book.pdf")).toThrow(
			"当前里程碑仅支持 Markdown",
		);
	});

	it("accepts a third-party mechanical loader without changing the ingestor", () => {
		const registry = new DefaultLoaderRegistry();
		const loader: DocumentLoader = {
			id: "fake-pdf",
			version: "fake-v1",
			canLoad: (filePath) => filePath.endsWith(".pdf"),
			load: (filePath) => ({
				uri: filePath,
				sourceType: "pdf",
				loaderVersion: "fake-v1",
				sourceKey: "book",
				title: "Book",
				metadata: { sourceRole: "primary", publisher: "Example Lab" },
				parsedText: "Alpha.",
				blocks: [
					{
						blockId: "book#block-0",
						charStart: 0,
						charEnd: 6,
						text: "Alpha.",
						kind: "paragraph",
					},
				],
			}),
		};
		registry.register(loader);
		const result = ingestFile(config(), "book.pdf", registry);
		expect(result.source.sourceType).toBe("pdf");
		expect(result.source.loaderVersion).toBe("fake-v1");
		expect(result.source.metadata).toEqual({
			sourceRole: "primary",
			publisher: "Example Lab",
		});
		expect(result.spans[0]?.text).toBe("Alpha.");
	});
});

function config(): AppConfig {
	const projectRoot = mkdtempSync(join(tmpdir(), "wge-loader-"));
	roots.push(projectRoot);
	return {
		projectRoot,
		sourcesDir: join(projectRoot, "sources"),
		wikiDir: join(projectRoot, "wiki"),
		quarantineDir: join(projectRoot, "quarantine"),
		indexesDir: join(projectRoot, "indexes"),
		runsDir: join(projectRoot, "runs"),
		apiKey: "test",
		baseUrl: "http://localhost",
		model: "test-model",
		temperature: 0,
	};
}
