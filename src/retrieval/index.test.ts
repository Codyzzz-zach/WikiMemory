import { describe, expect, it } from "vitest";
import type { Claim, SourceSpan } from "../types/index.js";
import { retrieveClaimSeeds } from "./index.js";

describe("domain-neutral Seed retrieval", () => {
	const corpus = [
		fixture("math", "一致收敛能够让极限函数保留逼近函数的连续性质"),
		fixture("software", "API 版本迁移必须先保持旧客户端的向后兼容，再移除废弃字段"),
		fixture(
			"research",
			"Contrastive learning trains representations by bringing positive pairs closer",
		),
		fixture("product", "项目发布前必须由产品负责人批准，测试通过本身不等于允许上线"),
	];
	const spans = corpus.map(
		(claim): SourceSpan => ({
			id: claim.evidenceSpanIds[0] ?? "",
			sourceId: `source:${claim.id}`,
			blockId: "b0",
			charStart: 0,
			charEnd: claim.statement.length,
			text: claim.statement,
		}),
	);

	it.each([
		["函数列一致收敛时，极限会继承什么性质？", "claim:math"],
		["升级接口版本时，什么时候才能删除废弃字段？", "claim:software"],
		["How are positive pairs handled in contrastive representation learning?", "claim:research"],
		["测试已经通过，是否可以不经负责人批准直接发布？", "claim:product"],
	])("retrieves the intended domain without domain-specific rules: %s", (query, expected) => {
		const result = retrieveClaimSeeds(corpus, spans, query);
		expect(result.candidates[0]?.claim.id).toBe(expected);
		expect(result.diagnostics.queryFeatureCount).toBeGreaterThan(0);
	});

	it("uses evidence text when the compiled statement is a shorter paraphrase", () => {
		const short = fixture("evidence", "升级应分阶段进行");
		const evidence: SourceSpan = {
			id: short.evidenceSpanIds[0] ?? "",
			sourceId: "source:evidence",
			blockId: "b0",
			charStart: 0,
			charEnd: 20,
			text: "迁移旧版接口时，必须先维持客户端兼容性。",
		};
		const result = retrieveClaimSeeds([short], [evidence], "旧版客户端兼容");
		expect(result.candidates[0]?.claim.id).toBe("claim:evidence");
	});

	it("returns no arbitrary Seed for an unrelated query", () => {
		const result = retrieveClaimSeeds(corpus, spans, "火星土壤里的高氯酸盐浓度");
		expect(result.candidates).toEqual([]);
	});

	it("does not ignore an uncovered named term in favor of generic phrase overlap", () => {
		const result = retrieveClaimSeeds(corpus, spans, "WebAssembly 与传统部署方式有什么不同？");
		expect(result.candidates).toEqual([]);
	});

	it("normalizes equivalent identifier exponent notation", () => {
		const symbolic = fixture("symbol", "L^2 空间中的函数平方可积，L^1 表示可积函数");
		const result = retrieveClaimSeeds([symbolic], [], "L² 是否属于 L¹");
		expect(result.candidates[0]?.claim.id).toBe("claim:symbol");
	});
});

function fixture(id: string, statement: string): Claim {
	const spanId = `span:${id}`;
	return {
		id: `claim:${id}`,
		statement,
		evidenceSpanIds: [spanId],
		conditions: [],
		derivation: "EXTRACTED",
		validity: "SUPPORTED",
		lifecycle: "ACTIVE",
		publicationState: "CANONICAL",
		validFrom: null,
		validTo: null,
		compilerVersion: "test",
		confidence: 1,
		claimKind: "FACT",
		scope: { type: "GLOBAL" },
		provenanceRefs: [{ type: "SourceSpan", spanId }],
		supportingEvidenceRefs: [{ type: "SourceSpan", spanId }],
		knowledgeVersion: "test",
		recordedAt: "2026-07-24T00:00:00.000Z",
	};
}
