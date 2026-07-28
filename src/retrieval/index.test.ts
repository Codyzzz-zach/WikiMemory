import { describe, expect, it } from "vitest";
import type { Claim, SourceSpan } from "../types/index.js";
import { filterClaimsByExplicitTemporalScope, retrieveClaimSeeds } from "./index.js";

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

	it("uses source metadata for explicit source-role questions", () => {
		const reportClaim = fixture("report", "获奖团队训练算法并揭示了一篇哲学作品");
		const result = retrieveClaimSeeds(
			[reportClaim],
			spansFor([reportClaim], "source:nature-report"),
			"Nature 报道能回答哪一层问题？",
			10,
			new Map([["source:nature-report", "history/nature-scroll-report.md"]]),
		);
		expect(result.candidates[0]?.claim.id).toBe("claim:report");
		expect(result.candidates[0]?.channels).toContain("source");
		expect(result.diagnostics.usedSourceMetadata).toBe(true);
	});

	it("resolves deterministic char-range evidence before indexing text and source metadata", () => {
		const claim = fixture("fragment", "简短摘要");
		claim.evidenceSpanIds = ["span:fragment#chars-4-16"];
		const span: SourceSpan = {
			id: "span:fragment",
			sourceId: "source:research-paper",
			blockId: "b0",
			charStart: 0,
			charEnd: 20,
			text: "前言略。完整软件管道经过实验验证。结尾",
		};
		const result = retrieveClaimSeeds(
			[claim],
			[span],
			"软件管道验证",
			10,
			new Map([["source:research-paper", "research/paper.md"]]),
		);
		expect(result.candidates[0]?.claim.id).toBe("claim:fragment");
		expect(result.diagnostics.resolvedEvidenceRefCount).toBe(1);
		expect(result.diagnostics.unresolvedEvidenceRefCount).toBe(0);
	});

	it("filters only precise months outside an explicit closed query interval", () => {
		const march = fixture("march", "2019年3月的规范仅适用于旧版客户端");
		const july = fixture("july", "2019年7月的规范扩展到新版客户端");
		const october = fixture("october", "2019年10月又发布了后续规范");
		const undated = fixture("undated", "该规范讨论客户端兼容性");
		const result = filterClaimsByExplicitTemporalScope(
			[march, july, october, undated],
			[],
			"从 2019-03 到 2019-07，规范发生了什么变化？",
		);
		expect(result.claims.map((claim) => claim.id)).toEqual([
			"claim:march",
			"claim:july",
			"claim:undated",
		]);
		expect(result.diagnostics).toMatchObject({
			applied: true,
			startMonth: "2019-03",
			endMonth: "2019-07",
			excludedClaimIds: ["claim:october"],
		});
	});

	it("does not infer a temporal filter from a single month", () => {
		const older = fixture("older", "2019年3月的历史版本");
		const result = filterClaimsByExplicitTemporalScope([older], [], "2019年7月发布了什么？");
		expect(result.claims).toEqual([older]);
		expect(result.diagnostics.applied).toBe(false);
	});

	it("recognizes English month names and ignores three-digit source ordinals", () => {
		const inRange = fixture("english-in", "The policy changed on 20 July 2019.");
		const outOfRange = fixture("english-out", "The policy changed on 20 October 2019.");
		const ordinalOnly = fixture("ordinal", "The source identifier is report-2024-003.");
		const result = filterClaimsByExplicitTemporalScope(
			[inRange, outOfRange, ordinalOnly],
			[],
			"Compare 2019-03 through 2019-07.",
		);
		expect(result.claims.map((claim) => claim.id)).toEqual(["claim:english-in", "claim:ordinal"]);
	});

	it("returns no arbitrary Seed for an unrelated query", () => {
		const result = retrieveClaimSeeds(corpus, spans, "火星土壤里的高氯酸盐浓度");
		expect(result.candidates).toEqual([]);
	});

	it("does not ignore an uncovered named term in favor of generic phrase overlap", () => {
		const result = retrieveClaimSeeds(corpus, spans, "WebAssembly 与传统部署方式有什么不同？");
		expect(result.candidates).toEqual([]);
	});

	it("does not let a date token veto a strong Han-script semantic match", () => {
		const relevant = fixture("relevant", "短距离气溶胶传播在特定室内场所不能排除");
		const datedDistractor = fixture("dated", "2020-07 发布了另一个不相关版本");
		const result = retrieveClaimSeeds(
			[relevant, datedDistractor],
			[],
			"2020-07 简报在什么条件下说短距离气溶胶传播不能被排除？",
		);
		expect(result.candidates[0]?.claim.id).toBe("claim:relevant");
	});

	it("normalizes equivalent identifier exponent notation", () => {
		const symbolic = fixture("symbol", "L^2 空间中的函数平方可积，L^1 表示可积函数");
		const result = retrieveClaimSeeds([symbolic], [], "L² 是否属于 L¹");
		expect(result.candidates[0]?.claim.id).toBe("claim:symbol");
	});

	it("preserves dotted structured identifiers used by standards and versioned documents", () => {
		const criterion = fixture(
			"criterion",
			"Success Criterion 2.5.7 exempts cases where dragging is essential or functionality is determined by the user agent.",
		);
		const result = retrieveClaimSeeds([criterion], [], "2.5.7 的例外条件是什么？");
		expect(result.candidates[0]?.claim.id).toBe("claim:criterion");
		expect(result.candidates[0]?.matchedFeatures).toContain("id:2.5.7");
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

function spansFor(claims: Claim[], sourceId: string): SourceSpan[] {
	return claims.map((claim) => ({
		id: claim.evidenceSpanIds[0] ?? "",
		sourceId,
		blockId: "b0",
		charStart: 0,
		charEnd: claim.statement.length,
		text: claim.statement,
	}));
}
