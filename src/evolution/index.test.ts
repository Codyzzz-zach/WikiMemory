import { describe, expect, it } from "vitest";
import { buildGraph } from "../graph/index.js";
import { RELATION_AUDIT_VERSION } from "../prompts/index.js";
import { retrieveClaimSeeds } from "../retrieval/index.js";
import type { Claim, Relation, WikiModule } from "../types/index.js";
import { claimRef } from "../types/index.js";
import { type KnowledgeState, planKnowledgeEvolution, stateVersion } from "./index.js";

describe("cross-domain knowledge evolution", () => {
	it("applies an audited correction, invalidates dependants, and supports exact rollback", () => {
		const oldPolicy = claim("claim:deploy-old", "通过自动化测试后，服务可以直接发布到生产环境");
		const dependent = claim("claim:deploy-guide", "发布指南依赖自动化测试结论");
		const correction = claim("claim:deploy-new", "即使通过自动化测试，生产发布仍需要负责人批准");
		const oldDependency = relation("rel:guide-old", dependent.id, oldPolicy.id, "REQUIRES");
		const supersedes = relation("rel:deploy-correction", correction.id, oldPolicy.id, "SUPERSEDES");
		const wiki = moduleFixture("wiki:deploy", [oldPolicy.id, dependent.id]);
		const t1: KnowledgeState = {
			claims: [oldPolicy, dependent, correction],
			relations: [oldDependency, supersedes],
			wikiModules: [wiki],
		};
		const frozenT1 = structuredClone(t1);

		const transition = planKnowledgeEvolution(t1, [supersedes.id]);

		expect(transition.impact.supersededClaimIds).toEqual([oldPolicy.id]);
		expect(transition.impact.staleRelationIds).toEqual([oldDependency.id]);
		expect(transition.impact.affectedWikiModuleIds).toEqual([wiki.id]);
		expect(transition.impact.afterVersion).not.toBe(transition.impact.beforeVersion);
		expect(t1).toEqual(frozenT1);

		const graph = buildGraph(transition.next.claims, [], transition.next.relations);
		expect(
			retrieveClaimSeeds(graph.claims, [], "是否可以直接发布到生产环境").candidates.map(
				(item) => item.claim.id,
			),
		).not.toContain(oldPolicy.id);
		expect(retrieveClaimSeeds(graph.claims, [], "负责人批准").candidates[0]?.claim.id).toBe(
			correction.id,
		);

		const rolledBack = structuredClone(frozenT1);
		expect(stateVersion(rolledBack)).toBe(transition.impact.beforeVersion);
		expect(rolledBack.claims.find((item) => item.id === oldPolicy.id)?.lifecycle).toBe("ACTIVE");
	});

	it("marks both sides disputed for an audited contradiction instead of choosing a winner", () => {
		const first = claim("claim:model-a", "该模型允许把训练数据用于商业再训练");
		const second = claim("claim:model-b", "该模型禁止把训练数据用于商业再训练");
		const contradiction = relation("rel:model-conflict", first.id, second.id, "CONTRADICTS");
		const transition = planKnowledgeEvolution(
			{ claims: [first, second], relations: [contradiction], wikiModules: [] },
			[contradiction.id],
		);
		expect(transition.impact.disputedClaimIds).toEqual([first.id, second.id]);
		expect(transition.next.claims.every((item) => item.validity === "DISPUTED")).toBe(true);
	});

	it("rejects unaudited or merely related edges as evolution authority", () => {
		const first = claim("claim:product-a", "项目采用季度发布节奏");
		const second = claim("claim:product-b", "项目采用月度发布节奏");
		const weak = {
			...relation("rel:weak", first.id, second.id, "RELATED_TO"),
			relationAuditVersion: null,
		};
		expect(() =>
			planKnowledgeEvolution({ claims: [first, second], relations: [weak], wikiModules: [] }, [
				weak.id,
			]),
		).toThrow("未通过消费门禁");
	});

	it("does not turn a conditional replacement into global supersession", () => {
		const oldPolicy = claim("claim:conditional-old", "默认保留七天日志");
		const newPolicy = claim("claim:conditional-new", "高风险项目保留三十天日志");
		const conditional = {
			...relation("rel:conditional", newPolicy.id, oldPolicy.id, "SUPERSEDES"),
			conditions: ["仅适用于高风险项目"],
			conditionStatus: "PRESERVED" as const,
			supersessionEffect: "CONDITIONAL_TO_CLAIM" as const,
		};
		expect(() =>
			planKnowledgeEvolution(
				{ claims: [oldPolicy, newPolicy], relations: [conditional], wikiModules: [] },
				[conditional.id],
			),
		).toThrow("不能全局淘汰");
	});

	it("retires the whole old Claim when audited scope is total while preserving boundaries", () => {
		const oldPolicy = claim("claim:total-old", "外部 API 必须使用 TLS 1.2");
		const newPolicy = claim("claim:total-new", "外部 API 必须使用 TLS 1.3");
		const total = {
			...relation("rel:total", newPolicy.id, oldPolicy.id, "SUPERSEDES"),
			conditions: ["自 2026-07-10 起", "只替代外部接口章节"],
			conditionStatus: "PRESERVED" as const,
			supersessionEffect: "TOTAL_TO_CLAIM" as const,
		};
		const transition = planKnowledgeEvolution(
			{ claims: [oldPolicy, newPolicy], relations: [total], wikiModules: [] },
			[total.id],
		);
		expect(transition.impact.supersededClaimIds).toEqual([oldPolicy.id]);
		expect(transition.next.relations[0]?.conditions).toEqual(total.conditions);
	});
});

function claim(id: string, statement: string): Claim {
	return {
		id,
		statement,
		evidenceSpanIds: [`span:${id}`],
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
		provenanceRefs: [{ type: "SourceSpan", spanId: `span:${id}` }],
		supportingEvidenceRefs: [{ type: "SourceSpan", spanId: `span:${id}` }],
		knowledgeVersion: "test",
		recordedAt: "2026-07-24T00:00:00.000Z",
	};
}

function relation(id: string, from: string, to: string, type: Relation["type"]): Relation {
	return {
		id,
		from: claimRef(from),
		to: claimRef(to),
		type,
		conditions: [],
		conditionStatus: "EXPLICIT_NONE",
		supersessionEffect: type === "SUPERSEDES" ? "TOTAL_TO_CLAIM" : null,
		relationAuditVersion: RELATION_AUDIT_VERSION,
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

function moduleFixture(id: string, claimIds: string[]): WikiModule {
	return {
		id,
		stableAddress: "project/deployment",
		coreQuestion: "如何安全发布？",
		currentUnderstanding: "旧理解待更新",
		disputes: [],
		claimRefs: claimIds.map(claimRef),
		conceptRefs: [],
		dependencies: [],
		publicationState: "CANONICAL",
		updatedAt: "2026-07-24T00:00:00.000Z",
	};
}
