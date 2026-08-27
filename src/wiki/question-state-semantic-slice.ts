export type SemanticSliceStatus =
	| "READY_FOR_AMBIGUITY_REVIEW"
	| "STOP_UPSTREAM_QUESTION_ASSOCIATION";

export interface SemanticSliceFormationSignal {
	sourceIds: string[];
	claimRefs: string[];
	relationIds: string[];
}

export interface SemanticSliceQuestionFrame {
	id: string;
	formationSignals: SemanticSliceFormationSignal[];
}

export interface SemanticSliceSourceIdentity {
	ref: string;
	sourceId: string;
}

export interface SemanticSliceTimepoint {
	timepoint: string;
	sourceIds: string[];
}

export interface SemanticSliceEpisode {
	episodeId: string;
	questionRefs: string[];
	timepoints: SemanticSliceTimepoint[];
	targetTransitions: string[];
}

export interface SemanticSliceBlocker {
	code:
		| "FROZEN_QUESTION_FRAME_MISSING"
		| "CANONICAL_SOURCE_IDENTITY_MISSING"
		| "SOURCE_NOT_ASSOCIATED_WITH_FROZEN_QUESTION";
	episodeId: string;
	timepoint?: string;
	questionRefs: string[];
	sourceIds: string[];
	description: string;
}

export interface SemanticSliceTimepointCoverage {
	timepoint: string;
	expectedSourceIds: string[];
	associatedSourceIds: string[];
	missingSourceIds: string[];
	coverageRatio: number;
}

export interface SemanticSliceEpisodeAudit {
	episodeId: string;
	status: SemanticSliceStatus;
	questionRefs: string[];
	targetTransitions: string[];
	expectedSourceIds: string[];
	associatedSourceIds: string[];
	coveredSourceIds: string[];
	missingSourceIds: string[];
	claimRefs: string[];
	relationIds: string[];
	timepoints: SemanticSliceTimepointCoverage[];
	blockers: SemanticSliceBlocker[];
}

export interface SemanticSliceAudit {
	status: SemanticSliceStatus;
	episodes: SemanticSliceEpisodeAudit[];
	summary: {
		episodeCount: number;
		questionCount: number;
		expectedSourceCount: number;
		coveredSourceCount: number;
		missingSourceCount: number;
		claimCount: number;
		relationCount: number;
		blockerCount: number;
	};
}

export interface SemanticSliceAuditInput {
	episodes: SemanticSliceEpisode[];
	frames: SemanticSliceQuestionFrame[];
	sourceIdentities: SemanticSliceSourceIdentity[];
}

/**
 * Audits whether every source frozen into an Episode is already associated with at least one of
 * that Episode's frozen QuestionFrames. It intentionally does not perform semantic matching: a
 * missing association is an upstream dependency, not ambiguity-call input for C1.
 */
export function auditQuestionStateSemanticSlice(
	input: SemanticSliceAuditInput,
): SemanticSliceAudit {
	const frameById = uniqueIndex(input.frames, "QuestionFrame");
	const sourceIdentityByRef = uniqueIndex(
		input.sourceIdentities,
		"Source identity",
		(item) => item.ref,
	);
	const episodeAudits = input.episodes
		.map((episode) => auditEpisode(episode, frameById, sourceIdentityByRef))
		.sort((left, right) => left.episodeId.localeCompare(right.episodeId));
	const expectedSourceIds = uniqueSorted(
		episodeAudits.flatMap((episode) => episode.expectedSourceIds),
	);
	const coveredSourceIds = uniqueSorted(
		episodeAudits.flatMap((episode) => episode.coveredSourceIds),
	);
	const missingSourceIds = uniqueSorted(
		episodeAudits.flatMap((episode) => episode.missingSourceIds),
	);
	const questionRefs = uniqueSorted(episodeAudits.flatMap((episode) => episode.questionRefs));
	const claimRefs = uniqueSorted(episodeAudits.flatMap((episode) => episode.claimRefs));
	const relationIds = uniqueSorted(episodeAudits.flatMap((episode) => episode.relationIds));
	const blockerCount = episodeAudits.reduce((total, episode) => total + episode.blockers.length, 0);
	return {
		status: episodeAudits.every((episode) => episode.status === "READY_FOR_AMBIGUITY_REVIEW")
			? "READY_FOR_AMBIGUITY_REVIEW"
			: "STOP_UPSTREAM_QUESTION_ASSOCIATION",
		episodes: episodeAudits,
		summary: {
			episodeCount: episodeAudits.length,
			questionCount: questionRefs.length,
			expectedSourceCount: expectedSourceIds.length,
			coveredSourceCount: coveredSourceIds.length,
			missingSourceCount: missingSourceIds.length,
			claimCount: claimRefs.length,
			relationCount: relationIds.length,
			blockerCount,
		},
	};
}

function auditEpisode(
	episode: SemanticSliceEpisode,
	frameById: Map<string, SemanticSliceQuestionFrame>,
	sourceIdentityByRef: Map<string, SemanticSliceSourceIdentity>,
): SemanticSliceEpisodeAudit {
	assertNonEmptyUnique(episode.questionRefs, `${episode.episodeId}.questionRefs`);
	assertNonEmptyUnique(
		episode.timepoints,
		`${episode.episodeId}.timepoints`,
		(item) => item.timepoint,
	);
	const blockers: SemanticSliceBlocker[] = [];
	const frames = episode.questionRefs.flatMap((questionRef) => {
		const frame = frameById.get(questionRef);
		if (frame) return [frame];
		blockers.push({
			code: "FROZEN_QUESTION_FRAME_MISSING",
			episodeId: episode.episodeId,
			questionRefs: [questionRef],
			sourceIds: [],
			description: "The pre-registered QuestionFrame is absent from the frozen question state.",
		});
		return [];
	});
	const signals = frames.flatMap((frame) => frame.formationSignals);
	const claimRefs = uniqueSorted(signals.flatMap((signal) => signal.claimRefs));
	const relationIds = uniqueSorted(signals.flatMap((signal) => signal.relationIds));
	const associatedSourceIds = uniqueSorted(
		signals.flatMap((signal) =>
			signal.sourceIds.flatMap((sourceRef) => {
				const identity = sourceIdentityByRef.get(sourceRef);
				if (identity) return [identity.sourceId];
				blockers.push({
					code: "CANONICAL_SOURCE_IDENTITY_MISSING",
					episodeId: episode.episodeId,
					questionRefs: episode.questionRefs,
					sourceIds: [sourceRef],
					description:
						"A QuestionFrame formation signal references a Source absent from the frozen runtime identity map.",
				});
				return [];
			}),
		),
	);
	const associatedSet = new Set(associatedSourceIds);
	const timepoints = episode.timepoints.map((timepoint) => {
		assertNonEmptyUnique(
			timepoint.sourceIds,
			`${episode.episodeId}.${timepoint.timepoint}.sourceIds`,
		);
		const expectedSourceIds = uniqueSorted(timepoint.sourceIds);
		const covered = expectedSourceIds.filter((sourceId) => associatedSet.has(sourceId));
		const missing = expectedSourceIds.filter((sourceId) => !associatedSet.has(sourceId));
		if (missing.length > 0) {
			blockers.push({
				code: "SOURCE_NOT_ASSOCIATED_WITH_FROZEN_QUESTION",
				episodeId: episode.episodeId,
				timepoint: timepoint.timepoint,
				questionRefs: episode.questionRefs,
				sourceIds: missing,
				description:
					"The Episode source has no Canonical Claim association to any pre-registered QuestionFrame; using it would require semantic matching outside C1.",
			});
		}
		return {
			timepoint: timepoint.timepoint,
			expectedSourceIds,
			associatedSourceIds: covered,
			missingSourceIds: missing,
			coverageRatio: ratio(covered.length, expectedSourceIds.length),
		};
	});
	const expectedSourceIds = uniqueSorted(
		episode.timepoints.flatMap((timepoint) => timepoint.sourceIds),
	);
	const expectedSet = new Set(expectedSourceIds);
	const coveredSourceIds = associatedSourceIds.filter((sourceId) => expectedSet.has(sourceId));
	const missingSourceIds = expectedSourceIds.filter((sourceId) => !associatedSet.has(sourceId));
	return {
		episodeId: episode.episodeId,
		status:
			blockers.length === 0 ? "READY_FOR_AMBIGUITY_REVIEW" : "STOP_UPSTREAM_QUESTION_ASSOCIATION",
		questionRefs: [...episode.questionRefs].sort(),
		targetTransitions: [...episode.targetTransitions].sort(),
		expectedSourceIds,
		associatedSourceIds,
		coveredSourceIds,
		missingSourceIds,
		claimRefs,
		relationIds,
		timepoints,
		blockers: blockers.sort(compareBlockers),
	};
}

function compareBlockers(left: SemanticSliceBlocker, right: SemanticSliceBlocker): number {
	return (
		left.code.localeCompare(right.code) ||
		(left.timepoint ?? "").localeCompare(right.timepoint ?? "") ||
		left.sourceIds.join("|").localeCompare(right.sourceIds.join("|"))
	);
}

function ratio(numerator: number, denominator: number): number {
	if (denominator === 0) return 0;
	return Number((numerator / denominator).toFixed(6));
}

function uniqueIndex<T>(
	items: T[],
	label: string,
	key: (item: T) => string = (item) => (item as { id: string }).id,
): Map<string, T> {
	const index = new Map<string, T>();
	for (const item of items) {
		const id = key(item);
		if (!id.trim()) throw new Error(`${label} key cannot be empty`);
		if (index.has(id)) throw new Error(`Duplicate ${label}: ${id}`);
		index.set(id, item);
	}
	return index;
}

function assertNonEmptyUnique<T>(
	items: T[],
	label: string,
	key: (item: T) => string = (item) => String(item),
): void {
	if (items.length === 0) throw new Error(`${label} cannot be empty`);
	const keys = items.map(key);
	if (keys.some((value) => !value.trim())) throw new Error(`${label} contains an empty value`);
	if (new Set(keys).size !== keys.length) throw new Error(`${label} contains duplicates`);
}

function uniqueSorted(values: string[]): string[] {
	return [...new Set(values)].sort();
}
