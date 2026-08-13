import { describe, expect, it } from "vitest";
import type { Claim, Relation, SourceSpan } from "../types/index.js";
import { claimRef } from "../types/index.js";
import {
	inspectWikiModuleSupport,
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
