export const EVOLUTION_TIMELINES = ["T0", "T1", "T2", "T3"] as const;
export type EvolutionTimeline = (typeof EVOLUTION_TIMELINES)[number];

export interface RetrievalObservation {
	questionId: string;
	group: string;
	expectedDocumentIds: string[];
	retrievedDocumentIds: string[];
	contextEmpty: boolean;
}

export interface RetrievalSummary {
	questions: number;
	requiredDocuments: number;
	hits: number;
	retrievedDocuments: number;
	recall: number | null;
	precision: number | null;
	emptyContexts: number;
}

export interface ExpectedEvolutionTransition {
	documentId: string;
	sourceId: string;
	targetSourceIds: string[];
}

export interface EvolutionCandidateEndpoints {
	fromSourceId: string;
	toSourceId: string;
}

export interface EvolutionCoverage {
	expectedDocumentIds: string[];
	coveredDocumentIds: string[];
	missingDocumentIds: string[];
}

export interface EvolutionApproval {
	schemaVersion: "wge-evolution-approval/v1";
	runId: string;
	timeline: "T2" | "T3";
	reviewer: string;
	reviewedAt: string;
	approvedRelationIds: string[];
	rejectedRelations: Array<{ relationId: string; reason: string }>;
}

export function validateEvolutionApproval(
	approval: EvolutionApproval,
	runId: string,
	timeline: "T2" | "T3",
	candidateIds: string[],
): EvolutionApproval {
	if (
		approval.schemaVersion !== "wge-evolution-approval/v1" ||
		approval.runId !== runId ||
		approval.timeline !== timeline ||
		approval.reviewer.trim().length === 0 ||
		Number.isNaN(Date.parse(approval.reviewedAt))
	) {
		throw new Error("演化 approval 元数据无效或与当前 run/timeline 不匹配");
	}
	const candidates = new Set(candidateIds);
	const approved = new Set(approval.approvedRelationIds);
	const rejected = new Set(approval.rejectedRelations.map((item) => item.relationId));
	if (
		approved.size !== approval.approvedRelationIds.length ||
		rejected.size !== approval.rejectedRelations.length
	) {
		throw new Error("演化 approval 含重复 Relation ID");
	}
	if (approval.rejectedRelations.some((item) => item.reason.trim().length === 0)) {
		throw new Error("演化 approval 的每条拒绝记录必须说明理由");
	}
	for (const id of approved) {
		if (!candidates.has(id) || rejected.has(id)) throw new Error(`演化 approval 非法批准: ${id}`);
	}
	for (const id of rejected) {
		if (!candidates.has(id)) throw new Error(`演化 approval 拒绝了非候选 Relation: ${id}`);
	}
	const reviewed = new Set([...approved, ...rejected]);
	const missing = [...candidates].filter((id) => !reviewed.has(id));
	if (missing.length > 0) throw new Error(`演化 approval 未逐条审查: ${missing.join(", ")}`);
	if (approved.size === 0) throw new Error("演化 approval 未批准任何 Relation");
	return approval;
}

export function summarizeEvolutionCoverage(
	timeline: "T2" | "T3",
	expected: ExpectedEvolutionTransition[],
	candidates: EvolutionCandidateEndpoints[],
): EvolutionCoverage {
	const covered = expected
		.filter((transition) =>
			candidates.some((candidate) =>
				timeline === "T2"
					? candidate.fromSourceId === transition.sourceId &&
						transition.targetSourceIds.includes(candidate.toSourceId)
					: candidate.fromSourceId === transition.sourceId &&
						candidate.toSourceId === transition.sourceId,
			),
		)
		.map((transition) => transition.documentId)
		.sort();
	const expectedDocumentIds = expected.map((item) => item.documentId).sort();
	const coveredSet = new Set(covered);
	return {
		expectedDocumentIds,
		coveredDocumentIds: covered,
		missingDocumentIds: expectedDocumentIds.filter((id) => !coveredSet.has(id)),
	};
}

/** Enforce a single forward-only T0→T1→T2→T3 experiment timeline. */
export function assertTimelineTransition(
	completedTimelines: EvolutionTimeline[],
	requested: EvolutionTimeline,
): void {
	const uniqueCompleted = [...new Set(completedTimelines)];
	if (uniqueCompleted.length !== completedTimelines.length) {
		throw new Error("实验状态包含重复 timeline");
	}
	for (let index = 0; index < uniqueCompleted.length; index++) {
		if (uniqueCompleted[index] !== EVOLUTION_TIMELINES[index]) {
			throw new Error("实验状态不是连续的 T0→T1→T2→T3");
		}
	}
	const expected = EVOLUTION_TIMELINES[uniqueCompleted.length];
	if (expected !== requested) {
		throw new Error(`下一个允许的 timeline 是 ${expected ?? "<none>"}，不能运行 ${requested}`);
	}
}

/** Aggregate document-level retrieval independently of answer-model quality. */
export function summarizeRetrieval(
	observations: RetrievalObservation[],
): Record<string, RetrievalSummary> {
	const groups = [...new Set(observations.map((item) => item.group))].sort();
	return Object.fromEntries(
		groups.map((group) => {
			const selected = observations.filter((item) => item.group === group);
			let requiredDocuments = 0;
			let hits = 0;
			let retrievedDocuments = 0;
			for (const item of selected) {
				const expected = new Set(item.expectedDocumentIds);
				const retrieved = new Set(item.retrievedDocumentIds);
				requiredDocuments += expected.size;
				retrievedDocuments += retrieved.size;
				for (const id of retrieved) if (expected.has(id)) hits += 1;
			}
			return [
				group,
				{
					questions: selected.length,
					requiredDocuments,
					hits,
					retrievedDocuments,
					recall: requiredDocuments === 0 ? null : hits / requiredDocuments,
					precision: retrievedDocuments === 0 ? null : hits / retrievedDocuments,
					emptyContexts: selected.filter((item) => item.contextEmpty).length,
				},
			];
		}),
	);
}
