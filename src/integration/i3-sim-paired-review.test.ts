import { describe, expect, it } from "vitest";
import type { I3SimEpisode } from "../../scripts/integration-i3-sim-gate.js";
import {
	hasTraceableWikiUse,
	selectPairedReviewTasks,
} from "../../scripts/integration-i3-sim-paired-review.js";

describe("I3-Sim paired review", () => {
	it("selects at most two tasks per episode with deterministic endpoint coverage", () => {
		const episodes = [episode("ep-1", ["task-1", "task-2", "task-3"]), episode("ep-2", ["task-4"])];
		expect(selectPairedReviewTasks(episodes, 2).map((item) => item.task.taskId)).toEqual([
			"task-1",
			"task-3",
			"task-4",
		]);
	});

	it("requires a citation to candidate-only Wiki closure evidence", () => {
		expect(hasTraceableWikiUse(["claim:wiki-only"], ["claim:wiki-only"], [])).toBe(true);
		expect(
			hasTraceableWikiUse(["span:wiki-only#chars-0-5"], [], ["span:wiki-only#chars-0-5"]),
		).toBe(true);
		expect(hasTraceableWikiUse(["claim:shared"], ["claim:wiki-only"], [])).toBe(false);
	});
});

function episode(episodeId: string, taskIds: string[]): I3SimEpisode {
	return {
		episodeId,
		domain: "test",
		clusterId: `cluster:${episodeId}`,
		changeClassHint: "test",
		timepoints: [],
		tasks: taskIds.map((taskId) => ({ taskId, seedCaseId: taskId, prompt: taskId })),
		targetTransitions: [],
	};
}
