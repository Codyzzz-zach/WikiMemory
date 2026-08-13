import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		// references/codegraph-main/ is read-only and not part of WikiMemory's test target.
		include: ["src/**/*.test.ts"],
	},
});
