import { defineConfig } from "tsup";

export default defineConfig({
	entry: {
		index: "src/cli/index.ts",
		mcp: "src/transport/mcp/stdio.ts",
		worker: "src/workers/ingest-worker.ts",
	},
	format: ["esm"],
	target: "es2022",
	clean: true,
	dts: true,
	sourcemap: true,
});
