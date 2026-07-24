import { describe, expect, it } from "vitest";
import { buildDeepSeekRequest } from "./client.js";
import type { ChatOptions } from "./types.js";

describe("DeepSeek request body", () => {
	it("places the thinking toggle in the HTTP request body", () => {
		const options: ChatOptions = {
			model: "deepseek-v4-flash",
			systemPrompt: "system",
			messages: [{ role: "user", content: "hello" }],
			thinkingDisabled: true,
			responseFormat: "json_object",
			maxTokens: 100,
			temperature: 0,
		};
		const request = buildDeepSeekRequest(
			options,
			[
				{ role: "system", content: "system" },
				{ role: "user", content: "hello" },
			],
			false,
		);

		expect(request.thinking).toEqual({ type: "disabled" });
		expect(request.temperature).toBe(0);
		expect(request.stream).toBe(false);
		expect("extra_body" in request).toBe(false);
	});

	it("omits the toggle when the caller requests the provider default", () => {
		const options: ChatOptions = {
			model: "deepseek-v4-flash",
			systemPrompt: "system",
			messages: [{ role: "user", content: "hello" }],
		};
		const request = buildDeepSeekRequest(
			options,
			[
				{ role: "system", content: "system" },
				{ role: "user", content: "hello" },
			],
			true,
		);

		expect(request.thinking).toBeUndefined();
		expect(request.stream).toBe(true);
	});
});
