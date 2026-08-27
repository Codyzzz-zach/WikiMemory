import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	type I3SimContract,
	consumptionGapResolved,
	countSupportLeaks,
	cursorAfterAttempt,
	loadAndValidateGate,
	validateGateContract,
} from "../../scripts/integration-i3-sim-gate.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const manifestPath = join(projectRoot, "benchmarks", "i3-sim-gate-v1", "manifest.json");

describe("I3-Sim Gate", () => {
	it("freezes a three-domain, three-episode diagnostic slice without Stage B", () => {
		const validated = loadAndValidateGate(projectRoot, manifestPath);

		expect(validated.report).toMatchObject({
			status: "PASS",
			stageBRead: false,
			totals: { sources: 18, tasks: 7, episodes: 3, domains: 3 },
			nextStep: {
				episodeId: "S200-EV-016",
				timepoint: "T0",
				sourceId: "s200-psych-nudge-002",
			},
		});
		expect(validated.report.episodes.map((episode) => episode.changeClassHint).sort()).toEqual([
			"dispute",
			"new-evidence",
			"supersede",
		]);
	});

	it("fails closed when Stage B isolation is relaxed", () => {
		const contract = readContract();
		contract.authority.stageBRead = true;

		expect(() => validateGateContract(projectRoot, contract, manifestPath)).toThrow(
			"Authority must keep Stage B unread",
		);
	});

	it("rejects copying a public benchmark question as the natural task", () => {
		const contract = readContract();
		const publicQuestion = readFileSync(
			join(
				projectRoot,
				"benchmark-s200-stage-a-v1.1-candidate",
				"questions",
				"questions-public.jsonl",
			),
			"utf8",
		)
			.split(/\r?\n/)
			.filter(Boolean)
			.map((line) => JSON.parse(line) as { caseId: string; question: string })
			.find((row) => row.caseId === "S200-PSY-001");
		expect(publicQuestion).toBeDefined();
		contract.slice.episodes[0].tasks[0].prompt = publicQuestion?.question ?? "";

		expect(() => validateGateContract(projectRoot, contract, manifestPath)).toThrow(
			"Task copied public question",
		);
	});

	it("keeps the failed Source cursor and advances only after a completed compile", () => {
		const contract = readContract();
		const failedCursor = { episodeIndex: 0, timepointIndex: 1, sourceIndex: 0 };

		expect(cursorAfterAttempt(contract, failedCursor, ["COMPILE_FAILED"])).toEqual(failedCursor);
		expect(cursorAfterAttempt(contract, failedCursor, [])).toEqual({
			episodeIndex: 0,
			timepointIndex: 1,
			sourceIndex: 1,
		});
	});

	it("treats rejected stale modules as fail-closed unless they remain visible", () => {
		const gates = [
			{ moduleId: "wiki:active", accepted: true },
			{ moduleId: "wiki:stale", accepted: false },
		];

		expect(countSupportLeaks(gates, ["wiki:active"])).toBe(0);
		expect(countSupportLeaks(gates, ["wiki:active", "wiki:stale"])).toBe(1);
	});

	it("resumes a consumption gap only after deterministic consumption without support leaks", () => {
		expect(
			consumptionGapResolved([
				{ wikiModuleIds: ["wiki:dma"], supportLeakCount: 0 },
				{ wikiModuleIds: [], supportLeakCount: 0 },
			]),
		).toBe(true);
		expect(consumptionGapResolved([{ wikiModuleIds: [], supportLeakCount: 0 }])).toBe(false);
		expect(consumptionGapResolved([{ wikiModuleIds: ["wiki:dma"], supportLeakCount: 1 }])).toBe(
			false,
		);
	});
});

function readContract(): I3SimContract {
	return JSON.parse(readFileSync(manifestPath, "utf8")) as I3SimContract;
}
