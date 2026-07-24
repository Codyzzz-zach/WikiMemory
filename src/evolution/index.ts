import { createHash } from "node:crypto";
import { RELATION_AUDIT_VERSION } from "../prompts/index.js";
import type { Claim, Relation, WikiModule } from "../types/index.js";

export interface KnowledgeState {
	claims: Claim[];
	relations: Relation[];
	wikiModules: WikiModule[];
}

export interface EvolutionImpact {
	triggerRelationIds: string[];
	supersededClaimIds: string[];
	disputedClaimIds: string[];
	staleRelationIds: string[];
	affectedWikiModuleIds: string[];
	beforeVersion: string;
	afterVersion: string;
}

export interface EvolutionPlan {
	next: KnowledgeState;
	impact: EvolutionImpact;
}

/**
 * 把已经通过发布门禁的演化关系落实为知识状态变化。
 *
 * 这是确定性的生命周期层，不判断两条 Claim 在语义上是否真的冲突或取代；
 * 语义判断必须先由 Relation 审计完成。该函数只接受显式 trigger IDs，避免
 * 每次运行时反复应用全部历史边。
 */
export function planKnowledgeEvolution(
	current: KnowledgeState,
	triggerRelationIds: string[],
): EvolutionPlan {
	const triggerIds = new Set(triggerRelationIds);
	const claimById = new Map(current.claims.map((claim) => [claim.id, { ...claim }]));
	const relationById = new Map(
		current.relations.map((relation) => [
			relation.id,
			{ ...relation, conditions: [...relation.conditions] },
		]),
	);
	const superseded = new Set<string>();
	const disputed = new Set<string>();

	for (const relationId of triggerIds) {
		const relation = relationById.get(relationId);
		if (!relation) throw new Error(`找不到演化 Relation: ${relationId}`);
		if (
			relation.publicationState !== "CANONICAL" ||
			relation.lifecycle !== "ACTIVE" ||
			relation.validity !== "SUPPORTED" ||
			relation.conditionStatus === "UNVERIFIED" ||
			relation.relationAuditVersion !== RELATION_AUDIT_VERSION
		) {
			throw new Error(`演化 Relation 未通过消费门禁: ${relationId}`);
		}
		const from = claimById.get(relation.from as string);
		const to = claimById.get(relation.to as string);
		if (!from || !to) throw new Error(`演化 Relation 端点必须都是 Claim: ${relationId}`);

		if (relation.type === "SUPERSEDES") {
			if (relation.conditionStatus !== "EXPLICIT_NONE" || relation.conditions.length > 0) {
				throw new Error(`有条件 SUPERSEDES 不能全局淘汰旧 Claim: ${relationId}`);
			}
			claimById.set(to.id, { ...to, lifecycle: "SUPERSEDED" });
			superseded.add(to.id);
		} else if (relation.type === "CONTRADICTS") {
			claimById.set(from.id, { ...from, validity: "DISPUTED" });
			claimById.set(to.id, { ...to, validity: "DISPUTED" });
			disputed.add(from.id);
			disputed.add(to.id);
		} else {
			throw new Error(`Relation ${relationId} 的类型 ${relation.type} 不能驱动状态演化`);
		}
	}

	const staleRelations = new Set<string>();
	for (const [relationId, relation] of relationById) {
		if (triggerIds.has(relationId)) continue;
		if (superseded.has(relation.from as string) || superseded.has(relation.to as string)) {
			relationById.set(relationId, { ...relation, lifecycle: "SUPERSEDED" });
			staleRelations.add(relationId);
		}
	}
	const affectedClaimIds = new Set([...superseded, ...disputed]);
	const affectedWikiModuleIds = current.wikiModules
		.filter((module) => module.claimRefs.some((claimId) => affectedClaimIds.has(claimId as string)))
		.map((module) => module.id)
		.sort();
	const next: KnowledgeState = {
		claims: [...claimById.values()],
		relations: [...relationById.values()],
		wikiModules: current.wikiModules.map((module) => ({
			...module,
			claimRefs: [...module.claimRefs],
			conceptRefs: [...module.conceptRefs],
			disputes: [...module.disputes],
			dependencies: [...module.dependencies],
		})),
	};
	return {
		next,
		impact: {
			triggerRelationIds: [...triggerIds].sort(),
			supersededClaimIds: [...superseded].sort(),
			disputedClaimIds: [...disputed].sort(),
			staleRelationIds: [...staleRelations].sort(),
			affectedWikiModuleIds,
			beforeVersion: stateVersion(current),
			afterVersion: stateVersion(next),
		},
	};
}

/** 可序列化状态的内容版本，用于 T0/T1/T2 实验与回滚校验。 */
export function stateVersion(state: KnowledgeState): string {
	const canonical = {
		claims: [...state.claims].sort((left, right) => left.id.localeCompare(right.id)),
		relations: [...state.relations].sort((left, right) => left.id.localeCompare(right.id)),
		wikiModules: [...state.wikiModules].sort((left, right) => left.id.localeCompare(right.id)),
	};
	return `ev:${createHash("sha256").update(JSON.stringify(canonical)).digest("hex").slice(0, 24)}`;
}
