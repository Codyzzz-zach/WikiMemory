import { describe, expect, it } from "vitest";
import type { Claim, QuestionFrame, Relation, SourceSpan } from "../types/index.js";
import { claimRef, questionRef } from "../types/index.js";
import {
	inspectWikiModuleSupport,
	materializeQuestionWikiModule,
	materializeWikiModule,
	rebuildWikiModulesAfterEvolution,
	renderWikiAssertion,
} from "./materialization.js";

describe("evidence-grounded Wiki materialization", () => {
	it("renders Claim conditions and passes a fully mechanical support audit", () => {
		const current = claim("claim:current", "允许在批准环境处理数据", ["项目级审批"]);
		const spans = [span(current)];
		const module = materializeWikiModule(seed([current.id]), [current], spans, context(null));

		expect(module.currentUnderstanding).toBe("允许在批准环境处理数据（适用条件：项目级审批）");
		expect(module.materialization?.assertions[0]?.renderedText).toBe(renderWikiAssertion(current));
		expect(inspectWikiModuleSupport(module, [current], spans)).toEqual({
			consumable: true,
			reasons: [],
		});
	});

	it("fails closed when prose is edited independently from its Claim support", () => {
		const current = claim("claim:current", "退货期为十五天");
		const spans = [span(current)];
		const module = materializeWikiModule(seed([current.id]), [current], spans, context(null));
		const tampered = { ...module, currentUnderstanding: "退货期为七天" };

		const audit = inspectWikiModuleSupport(tampered, [current], spans);
		expect(audit.consumable).toBe(false);
		expect(audit.reasons).toEqual(
			expect.arrayContaining(["understanding-mismatch", "support-hash-mismatch"]),
		);
	});

	it("replaces a superseded slot while preserving Wiki identity", () => {
		const old = claim("claim:old", "退货期为七天");
		const replacement = claim("claim:new", "退货期为十五天");
		const oldModule = materializeWikiModule(seed([old.id]), [old], [span(old)], context(null));
		old.lifecycle = "SUPERSEDED";
		const trigger = relation("rel:replace", replacement.id, old.id, "SUPERSEDES");
		const rebuilt = rebuildWikiModulesAfterEvolution(
			[oldModule],
			[old, replacement],
			[trigger],
			[span(old), span(replacement)],
			context("snapshot:1"),
		)[0];

		expect(rebuilt?.id).toBe(oldModule.id);
		expect(rebuilt?.stableAddress).toBe(oldModule.stableAddress);
		expect(rebuilt?.claimRefs.map(String)).toEqual([replacement.id]);
		expect(rebuilt?.currentUnderstanding).toContain("十五天");
		expect(rebuilt?.materialization?.rebuiltFromSnapshotId).toBe("snapshot:1");
	});

	it("surfaces both endpoints of a contradiction as disputes instead of choosing a winner", () => {
		const first = claim("claim:first", "允许商业使用");
		const second = claim("claim:second", "禁止商业使用");
		const oldModule = materializeWikiModule(
			seed([first.id]),
			[first],
			[span(first)],
			context(null),
		);
		first.validity = "DISPUTED";
		second.validity = "DISPUTED";
		const trigger = relation("rel:conflict", first.id, second.id, "CONTRADICTS");
		const rebuilt = rebuildWikiModulesAfterEvolution(
			[oldModule],
			[first, second],
			[trigger],
			[span(first), span(second)],
			context("snapshot:2"),
		)[0];

		if (!rebuilt) throw new Error("expected rebuilt WikiModule");
		expect(rebuilt?.currentUnderstanding).toContain("没有通过争议门禁");
		expect(rebuilt?.disputes).toEqual(["允许商业使用", "禁止商业使用"]);
		expect(
			inspectWikiModuleSupport(rebuilt, [first, second], [span(first), span(second)]).consumable,
		).toBe(true);
	});

	it("materializes question-centered current, conditional, dispute and gap states separately", () => {
		const current = claim("claim:current", "默认至少投递一次");
		const conditional = claim("claim:conditional", "事务日志可实现恰好一次效果", ["单写者"]);
		const disputed = claim("claim:disputed", "网络分区时仍保证恰好一次");
		disputed.validity = "DISPUTED";
		const unresolved = claim("claim:unresolved", "跨区域故障下保证保持不变");
		unresolved.validity = "UNRESOLVED";
		const claims = [current, conditional, disputed, unresolved];
		const spans = claims.map(span);
		const frame = questionFrame(claims.map((item) => item.id));

		const module = materializeQuestionWikiModule(frame, claims, [], spans, context(null));
		expect(module.materialization?.schemaVersion).toBe("wge-wiki-materialization/v2");
		expect(module.materialization?.assertions.map((assertion) => assertion.role)).toEqual([
			"CONDITIONAL",
			"CURRENT",
			"DISPUTE",
			"UNRESOLVED",
		]);
		expect(module.conditionalBranches).toHaveLength(1);
		expect(module.disputes).toEqual(["网络分区时仍保证恰好一次"]);
		expect(module.knownGaps?.[0]?.kind).toBe("EVIDENCE");
		expect(
			inspectWikiModuleSupport(module, claims, spans, {
				relations: [],
				questionFrames: [frame],
				expectedKnowledgeVersion: "kv:test",
			}),
		).toEqual({ consumable: true, reasons: [] });
	});

	it("fails closed when a v2 module loses its QuestionFrame or changes a derived gap", () => {
		const unresolved = claim("claim:unresolved", "材料尚未覆盖跨区域故障");
		unresolved.validity = "UNRESOLVED";
		const frame = questionFrame([unresolved.id]);
		const module = materializeQuestionWikiModule(
			frame,
			[unresolved],
			[],
			[span(unresolved)],
			context(null),
		);
		const firstGap = module.knownGaps?.[0];
		if (!firstGap) throw new Error("expected materialized gap");
		const tampered = {
			...module,
			knownGaps: [{ ...firstGap, description: "已有答案" }],
		};
		const withoutFrame = inspectWikiModuleSupport(module, [unresolved], [span(unresolved)]);
		expect(withoutFrame.reasons).toContain(`missing-question-frame:${frame.id}`);
		const changed = inspectWikiModuleSupport(tampered, [unresolved], [span(unresolved)], {
			relations: [],
			questionFrames: [frame],
			expectedKnowledgeVersion: "kv:test",
		});
		expect(changed.consumable).toBe(false);
		expect(changed.reasons).toEqual(
			expect.arrayContaining(["known-gaps-mismatch", "support-hash-mismatch"]),
		);
	});

	it("refuses to materialize a Question Wiki larger than the atomic 24-Claim bound", () => {
		const claims = Array.from({ length: 25 }, (_, index) =>
			claim(`claim:${index}`, `statement ${index}`),
		);
		expect(() =>
			materializeQuestionWikiModule(
				questionFrame(claims.map((item) => item.id)),
				claims,
				[],
				claims.map(span),
				context(null),
			),
		).toThrow(/超过 WikiModule Claim 上限/);
	});
});

function seed(claimRefs: string[]) {
	return {
		id: "wiki:policy",
		stableAddress: "policy/current",
		coreQuestion: "当前规则是什么？",
		claimRefs,
	};
}

function context(rebuiltFromSnapshotId: string | null) {
	return {
		sourceKnowledgeVersion: "kv:test",
		rebuiltFromSnapshotId,
		updatedAt: "2026-08-12T00:00:00.000Z",
	};
}

function claim(id: string, statement: string, conditions: string[] = []): Claim {
	const spanId = `span:${id}`;
	return {
		id,
		statement,
		evidenceSpanIds: [spanId],
		conditions,
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
		knowledgeVersion: "kv:test",
		recordedAt: "2026-08-12T00:00:00.000Z",
	};
}

function span(value: Claim): SourceSpan {
	const spanId = value.evidenceSpanIds[0];
	if (!spanId) throw new Error(`missing fixture span: ${value.id}`);
	return {
		id: spanId,
		sourceId: `source:${value.id}`,
		blockId: "b0",
		charStart: 0,
		charEnd: value.statement.length,
		text: value.statement,
	};
}

function relation(
	id: string,
	from: string,
	to: string,
	type: "SUPERSEDES" | "CONTRADICTS",
): Relation {
	return {
		id,
		from: claimRef(from),
		to: claimRef(to),
		type,
		conditions: [],
		conditionStatus: "EXPLICIT_NONE",
		supersessionEffect: type === "SUPERSEDES" ? "TOTAL_TO_CLAIM" : null,
		relationAuditVersion: "test",
		evidenceSpanIds: [`span:${from}`, `span:${to}`],
		derivation: "INFERRED",
		validity: "SUPPORTED",
		lifecycle: "ACTIVE",
		publicationState: "CANONICAL",
		validFrom: null,
		validTo: null,
		compilerVersion: "test",
		source: "cross-material-detect",
		confidence: 1,
		consumedBy: [],
	};
}

function questionFrame(claimIds: string[]): QuestionFrame {
	return {
		id: questionRef("question:delivery-semantics"),
		stableAddress: "question/distributed-systems/delivery-semantics",
		canonicalQuestion: "消息系统能提供哪些投递语义？",
		aliases: ["投递保证"],
		domain: "distributed-systems",
		scope: { type: "GLOBAL" },
		boundaries: ["只讨论消息系统语义"],
		lifecycle: "ACTIVE",
		parentQuestionRefs: [],
		childQuestionRefs: [],
		mergedInto: null,
		formationSignals: [
			{
				type: "CLAIM_CLUSTER",
				sourceIds: ["source:test"],
				claimRefs: claimIds.map(claimRef),
				relationIds: [],
				conceptRefs: [],
				reason: "长期稳定问题",
			},
		],
		publicationState: "CANONICAL",
		createdAtKnowledgeVersion: "kv:test",
		updatedAtKnowledgeVersion: "kv:test",
		createdAt: "2026-08-12T00:00:00.000Z",
		updatedAt: "2026-08-12T00:00:00.000Z",
	};
}
