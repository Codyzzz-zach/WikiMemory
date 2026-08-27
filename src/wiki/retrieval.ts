import { lexicalFeatures } from "../retrieval/index.js";
import type { WikiModule } from "../types/index.js";

export interface WikiRetrievalCandidate {
	module: WikiModule;
	score: number;
	matchedSeedClaimIds: string[];
	matchedClusterIds: string[];
	matchedCoreFeatures: string[];
	matchedAssertionFeatures: string[];
}

export interface WikiRetrievalOptions {
	/** Reliable Claim seeds that may activate structural navigation. */
	anchorClaimIds?: Iterable<string>;
	/** Dominant human-curated material clusters reached by reliable Claim seeds. */
	anchorClusterIds?: Iterable<string>;
	/** Resolve each Wiki supporting Claim to its human-curated material clusters. */
	clusterIdsByClaimId?: ReadonlyMap<string, ReadonlySet<string>>;
	/** Allow a dominant material cluster to bridge terminology or language mismatch. */
	allowClusterFallback?: boolean;
	/** Fail closed instead of using Wiki as an independent content retriever. */
	requireAnchor?: boolean;
}

/**
 * Retrieve audited materialized views by their stable question and supported assertions.
 * This is navigation only: downstream must still carry every supporting Claim and evidence span.
 */
export function retrieveWikiModuleSeeds(
	modules: WikiModule[],
	task: string,
	limit = 3,
	options: WikiRetrievalOptions = {},
): WikiRetrievalCandidate[] {
	const queryFeatures = lexicalFeatures(task);
	if (queryFeatures.size === 0 || limit <= 0) return [];
	const anchorClaimIds = new Set(options.anchorClaimIds ?? []);
	const anchorClusterIds = new Set(options.anchorClusterIds ?? []);
	const ranked = modules
		.flatMap((module) => {
			const matchedSeedClaimIds = module.claimRefs
				.map(String)
				.filter((claimId) => anchorClaimIds.has(claimId))
				.sort();
			const moduleClusterIds = new Set(
				module.claimRefs.flatMap((claimId) => [
					...(options.clusterIdsByClaimId?.get(String(claimId)) ?? []),
				]),
			);
			const matchedClusterIds = intersection(anchorClusterIds, moduleClusterIds);
			const clusterFallback =
				options.allowClusterFallback === true &&
				matchedSeedClaimIds.length === 0 &&
				matchedClusterIds.length > 0;
			if (options.requireAnchor && matchedSeedClaimIds.length === 0 && !clusterFallback) return [];
			const coreFeatures = lexicalFeatures(`${module.coreQuestion}\n${module.stableAddress}`);
			const assertionFeatures = lexicalFeatures(
				module.materialization?.assertions.map((assertion) => assertion.renderedText).join("\n") ??
					"",
			);
			const matchedCoreFeatures = intersection(queryFeatures, coreFeatures);
			const matchedAssertionFeatures = intersection(queryFeatures, assertionFeatures);
			const lexicalScore = matchedCoreFeatures.length * 3 + matchedAssertionFeatures.length;
			// clusterId is supplied by the human-selected material set. It is a bounded
			// topic bridge when the task and Wiki were compiled in different languages,
			// never an independent semantic guess across unrelated materials.
			const score = Math.max(lexicalScore, clusterFallback ? matchedClusterIds.length * 6 : 0);
			if (score <= 0) return [];
			return [
				{
					module,
					score,
					matchedSeedClaimIds,
					matchedClusterIds,
					matchedCoreFeatures,
					matchedAssertionFeatures,
				},
			];
		})
		.sort(
			(left, right) =>
				right.matchedSeedClaimIds.length - left.matchedSeedClaimIds.length ||
				right.matchedClusterIds.length - left.matchedClusterIds.length ||
				right.score - left.score ||
				left.module.stableAddress.localeCompare(right.module.stableAddress),
		);
	const strongest = ranked[0];
	if (!strongest) return [];
	// A lone generic bigram ("可以"/"需要") must not activate unrelated Wiki views.
	// Keep only candidates that are both non-trivial and competitive with the best semantic match.
	const scoreFloor = Math.max(6, strongest.score * 0.2);
	return ranked.filter((candidate) => candidate.score >= scoreFloor).slice(0, limit);
}

function intersection(left: ReadonlySet<string>, right: ReadonlySet<string>): string[] {
	return [...left].filter((feature) => right.has(feature)).sort();
}
