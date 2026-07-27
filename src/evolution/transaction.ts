import type { AppConfig } from "../config/types.js";
import {
	publishSourceResult,
	quarantineWikiModules,
	readAllClaims,
	readAllRelations,
	readAllSpans,
	readAllWikiModules,
	readQuarantinePublications,
	readSourcePublications,
	readWikiModuleQuarantine,
	resolveSpanById,
} from "../linter/storage.js";
import type { Claim, Relation } from "../types/index.js";
import { type EvolutionImpact, planKnowledgeEvolution } from "./index.js";
import {
	createKnowledgeSnapshot,
	currentKnowledgeVersion,
	restoreKnowledgeSnapshot,
} from "./version-store.js";

export interface EvolutionTransactionResult {
	snapshotId: string;
	beforeKnowledgeVersion: string;
	afterKnowledgeVersion: string;
	changedSourceIds: string[];
	rejectedRelationIds: string[];
	impact: EvolutionImpact;
}

export interface EvolutionTransactionOptions {
	/** Test-only deterministic fault injection; production callers must omit it. */
	failAfterPublicationWrites?: number;
	/** Reviewed false positives to remove from canonical consumption while retaining audit evidence. */
	rejectedRelations?: Array<{ relationId: string; reason: string }>;
}

/**
 * Apply audited SUPERSEDES/CONTRADICTS edges as a snapshot-protected write transaction.
 *
 * Claim text and evidence are never rewritten here. The transaction only changes lifecycle or
 * validity, retires stale edges, and removes stale WikiModules from the canonical consumer view.
 */
export function applyKnowledgeEvolution(
	config: AppConfig,
	triggerRelationIds: string[],
	expectedCurrentVersion: string,
	options: EvolutionTransactionOptions = {},
): EvolutionTransactionResult {
	const beforeKnowledgeVersion = currentKnowledgeVersion(config);
	if (beforeKnowledgeVersion !== expectedCurrentVersion) {
		throw new Error(
			`知识状态已变化，拒绝演化: expected=${expectedCurrentVersion}, actual=${beforeKnowledgeVersion}`,
		);
	}
	const rejectedRelations = options.rejectedRelations ?? [];
	const rejectedIds = new Set(rejectedRelations.map((item) => item.relationId));
	if (triggerRelationIds.length === 0 && rejectedRelations.length === 0) {
		throw new Error("演化批准或拒绝 Relation 不能为空");
	}
	if (rejectedIds.size !== rejectedRelations.length) throw new Error("拒绝 Relation IDs 不能重复");
	if (rejectedRelations.some((item) => item.reason.trim().length === 0)) {
		throw new Error("每条拒绝 Relation 必须说明理由");
	}
	if (triggerRelationIds.some((id) => rejectedIds.has(id))) {
		throw new Error("同一 Relation 不能同时批准演化和拒绝消费");
	}

	const publications = readSourcePublications(config);
	const quarantines = readQuarantinePublications(config);
	const current = {
		claims: readAllClaims(config),
		relations: readAllRelations(config),
		wikiModules: readAllWikiModules(config),
	};
	const currentRelationIds = new Set(current.relations.map((relation) => relation.id));
	for (const id of rejectedIds) {
		if (!currentRelationIds.has(id)) throw new Error(`找不到待拒绝 canonical Relation: ${id}`);
	}
	const plan = planKnowledgeEvolution(current, triggerRelationIds);
	if (plan.impact.beforeVersion === plan.impact.afterVersion && rejectedIds.size === 0) {
		throw new Error("演化计划没有产生状态变化，拒绝重复应用");
	}

	const changedClaimIds = new Set([
		...plan.impact.supersededClaimIds,
		...plan.impact.disputedClaimIds,
	]);
	// Trigger edges are unchanged semantically, but their owning publication participates so the
	// transaction is traceable from both the correction Source and every invalidated Source.
	const changedRelationIds = new Set([
		...plan.impact.staleRelationIds,
		...plan.impact.triggerRelationIds,
		...rejectedIds,
	]);
	const sourceIds = resolveUniqueOwners(publications, changedClaimIds, changedRelationIds);
	const nextClaimById = new Map(plan.next.claims.map((claim) => [claim.id, claim]));
	const nextRelationById = new Map(plan.next.relations.map((relation) => [relation.id, relation]));
	const snapshot = createKnowledgeSnapshot(
		config,
		`before evolution: approved=${[...new Set(triggerRelationIds)].sort().join(", ")}; rejected=${[
			...rejectedIds,
		]
			.sort()
			.join(", ")}`,
	);
	const evolvedAt = new Date().toISOString();
	let publicationWrites = 0;

	try {
		for (const sourceId of sourceIds) {
			const publication = publications.find((item) => item.sourceId === sourceId);
			if (!publication) throw new Error(`找不到演化对象所属 Source: ${sourceId}`);
			const quarantine = quarantines.find((item) => item.sourceId === sourceId) ?? {
				schemaVersion: "v1" as const,
				sourceId,
				runId: publication.runId,
				publishedAt: publication.publishedAt,
				claims: [],
				relations: [],
			};
			const rejectedFromPublication = publication.relations.filter((relation) =>
				rejectedIds.has(relation.id),
			);
			publishSourceResult(
				config,
				{
					...publication,
					claims: publication.claims.map((claim) => nextClaimById.get(claim.id) ?? claim),
					relations: publication.relations
						.filter((relation) => !rejectedIds.has(relation.id))
						.map((relation) => nextRelationById.get(relation.id) ?? relation),
					evolutionSnapshotId: snapshot.id,
					evolvedAt,
				},
				{
					...quarantine,
					relations: [
						...quarantine.relations.filter((item) => !rejectedIds.has(item.relation.id)),
						...rejectedFromPublication.map((relation) => ({
							relation: {
								...relation,
								validity: "UNRESOLVED" as const,
								publicationState: "QUARANTINED" as const,
							},
							issues: [
								{
									code: "HUMAN_REVIEW_REJECTED",
									severity: "error",
									affectedObject: relation.id,
									detail:
										rejectedRelations.find((item) => item.relationId === relation.id)?.reason ??
										"Rejected by human review",
									recommendedState: "QUARANTINE",
								},
							],
						})),
					],
				},
			);
			publicationWrites += 1;
			if (options.failAfterPublicationWrites === publicationWrites) {
				throw new Error(`故障注入: publication write ${publicationWrites}`);
			}
		}

		quarantineWikiModules(
			config,
			plan.impact.affectedWikiModuleIds,
			`Claim 生命周期演化要求重建 WikiModule；triggers=${plan.impact.triggerRelationIds.join(",")}`,
			snapshot.id,
		);
		verifyEvolutionResult(config, plan.impact, snapshot.id, [...rejectedIds]);
		const afterKnowledgeVersion = currentKnowledgeVersion(config);
		if (afterKnowledgeVersion === beforeKnowledgeVersion) {
			throw new Error("演化事务完成后 knowledgeVersion 未变化");
		}
		return {
			snapshotId: snapshot.id,
			beforeKnowledgeVersion,
			afterKnowledgeVersion,
			changedSourceIds: sourceIds,
			rejectedRelationIds: [...rejectedIds].sort(),
			impact: plan.impact,
		};
	} catch (error) {
		try {
			restoreKnowledgeSnapshot(config, snapshot.id, currentKnowledgeVersion(config));
		} catch (rollbackError) {
			throw new AggregateError(
				[error, rollbackError],
				`演化失败且自动回滚失败；snapshot=${snapshot.id}`,
			);
		}
		throw new Error(`演化事务失败，已自动回滚到 ${snapshot.id}`, { cause: error });
	}
}

function resolveUniqueOwners(
	publications: ReturnType<typeof readSourcePublications>,
	claimIds: Set<string>,
	relationIds: Set<string>,
): string[] {
	const owners = new Set<string>();
	for (const id of claimIds) {
		const matches = publications.filter((item) => item.claims.some((claim) => claim.id === id));
		if (matches.length !== 1)
			throw new Error(`Claim 必须有且仅有一个 Source publication 归属: ${id}`);
		owners.add(matches[0].sourceId);
	}
	for (const id of relationIds) {
		const matches = publications.filter((item) =>
			item.relations.some((relation) => relation.id === id),
		);
		if (matches.length !== 1) {
			throw new Error(`Relation 必须有且仅有一个 Source publication 归属: ${id}`);
		}
		owners.add(matches[0].sourceId);
	}
	return [...owners].sort();
}

function verifyEvolutionResult(
	config: AppConfig,
	impact: EvolutionImpact,
	snapshotId: string,
	rejectedRelationIds: string[],
): void {
	const claimById = new Map(readAllClaims(config).map((claim) => [claim.id, claim]));
	const relationById = new Map(readAllRelations(config).map((relation) => [relation.id, relation]));
	assertClaims(claimById, impact.supersededClaimIds, "lifecycle", "SUPERSEDED");
	assertClaims(claimById, impact.disputedClaimIds, "validity", "DISPUTED");
	for (const id of impact.staleRelationIds) {
		if (relationById.get(id)?.lifecycle !== "SUPERSEDED") {
			throw new Error(`演化后 Relation 未淘汰: ${id}`);
		}
	}
	const quarantinedRelationIds = new Set(
		readQuarantinePublications(config).flatMap((publication) =>
			publication.relations.map((item) => item.relation.id),
		),
	);
	for (const id of rejectedRelationIds) {
		if (relationById.has(id) || !quarantinedRelationIds.has(id)) {
			throw new Error(`人工拒绝 Relation 未正确隔离: ${id}`);
		}
	}
	const spans = readAllSpans(config);
	const evidenceObjects = [
		...impact.supersededClaimIds.map((id) => claimById.get(id)),
		...impact.disputedClaimIds.map((id) => claimById.get(id)),
		...impact.triggerRelationIds.map((id) => relationById.get(id)),
		...impact.staleRelationIds.map((id) => relationById.get(id)),
	].filter((item): item is Claim | Relation => item !== undefined);
	for (const object of evidenceObjects) {
		for (const spanId of object.evidenceSpanIds) {
			if (!resolveSpanById(spans, spanId)) {
				throw new Error(`演化对象证据不可解析: ${object.id} -> ${spanId}`);
			}
		}
	}
	const canonicalWikiIds = new Set(readAllWikiModules(config).map((module) => module.id));
	const quarantinedWiki = new Set(
		readWikiModuleQuarantine(config)
			.filter((record) => record.evolutionSnapshotId === snapshotId)
			.map((record) => record.module.id),
	);
	for (const id of impact.affectedWikiModuleIds) {
		if (canonicalWikiIds.has(id) || !quarantinedWiki.has(id)) {
			throw new Error(`受影响 WikiModule 未正确隔离: ${id}`);
		}
	}
}

function assertClaims<K extends "lifecycle" | "validity">(
	claimById: Map<string, Claim>,
	ids: string[],
	field: K,
	expected: Claim[K],
): void {
	for (const id of ids) {
		if (claimById.get(id)?.[field] !== expected) {
			throw new Error(`演化后 Claim 状态错误: ${id}.${field}`);
		}
	}
}
