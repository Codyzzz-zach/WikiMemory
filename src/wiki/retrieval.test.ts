import { describe, expect, it } from "vitest";
import type { WikiModule } from "../types/index.js";
import { claimRef } from "../types/index.js";
import { retrieveWikiModuleSeeds } from "./retrieval.js";

describe("Wiki materialized-view retrieval", () => {
	it("selects by the stable core question across Chinese task wording", () => {
		const result = retrieveWikiModuleSeeds(
			[
				module("wiki:returns", "普通商品当前允许几天内申请无理由退货？", "十五个自然日"),
				module("wiki:release", "非 P0 服务当前怎样发布？", "自动化门禁"),
			],
			"普通衣服签收以后最晚多久能够申请无理由退货？",
		);
		expect(result[0]?.module.id).toBe("wiki:returns");
		expect(result[0]?.matchedCoreFeatures.length).toBeGreaterThan(0);
	});

	it("returns no candidate when the task shares no sparse feature", () => {
		expect(
			retrieveWikiModuleSeeds(
				[module("wiki:returns", "普通商品当前允许几天内申请无理由退货？", "十五个自然日")],
				"量子纠缠实验如何设置？",
			),
		).toEqual([]);
	});

	it("requires and prioritizes reliable Claim anchors when used for online navigation", () => {
		const oldModule = module("wiki:old", "当前发布规则是什么？", "P0 服务保留人工审批");
		const currentModule = module(
			"wiki:current",
			"自动化门禁当前如何工作？",
			"非 P0 服务通过自动化门禁发布",
		);
		const currentClaimId = String(currentModule.claimRefs[0]);
		const result = retrieveWikiModuleSeeds(
			[oldModule, currentModule],
			"非 P0 服务现在如何发布？",
			2,
			{ anchorClaimIds: [currentClaimId], requireAnchor: true },
		);
		expect(result.map((candidate) => candidate.module.id)).toEqual(["wiki:current"]);
		expect(result[0]?.matchedSeedClaimIds).toEqual([currentClaimId]);
	});

	it("uses an explicit human-curated cluster only as an opted-in cross-language fallback", () => {
		const lawModule = module(
			"wiki:dma",
			"What criteria designate an undertaking as a gatekeeper?",
			"The undertaking may rebut the quantitative presumption.",
		);
		const claimId = String(lawModule.claimRefs[0]);
		const clusterIdsByClaimId = new Map([[claimId, new Set(["cluster-law-dma-01"])]]);
		const task = "欧盟 DMA 的守门人认定条件是什么？";

		expect(
			retrieveWikiModuleSeeds([lawModule], task, 2, {
				anchorClusterIds: ["cluster-law-dma-01"],
				clusterIdsByClaimId,
				requireAnchor: true,
			}),
		).toEqual([]);

		const result = retrieveWikiModuleSeeds([lawModule], task, 2, {
			anchorClusterIds: ["cluster-law-dma-01"],
			clusterIdsByClaimId,
			allowClusterFallback: true,
			requireAnchor: true,
		});
		expect(result.map((candidate) => candidate.module.id)).toEqual(["wiki:dma"]);
		expect(result[0]?.matchedClusterIds).toEqual(["cluster-law-dma-01"]);
		expect(result[0]?.matchedSeedClaimIds).toEqual([]);
	});
});

function module(id: string, coreQuestion: string, renderedText: string): WikiModule {
	return {
		id,
		stableAddress: id,
		coreQuestion,
		currentUnderstanding: renderedText,
		disputes: [],
		claimRefs: [claimRef(`claim:${id}`)],
		conceptRefs: [],
		dependencies: [],
		publicationState: "CANONICAL",
		updatedAt: "2026-08-12T00:00:00.000Z",
		materialization: {
			schemaVersion: "wge-wiki-materialization/v1",
			supportContractVersion: "wge-wiki-support/v1",
			sourceKnowledgeVersion: "kv:test",
			supportHash: "test",
			rebuiltFromSnapshotId: null,
			assertions: [
				{
					id: `assertion:${id}`,
					role: "CURRENT",
					claimRef: claimRef(`claim:${id}`),
					renderedText,
				},
			],
		},
	};
}
