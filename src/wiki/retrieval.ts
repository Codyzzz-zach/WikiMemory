import { lexicalFeatures } from "../retrieval/index.js";
import type { WikiModule } from "../types/index.js";

export interface WikiRetrievalCandidate {
	module: WikiModule;
	score: number;
	matchedSeedClaimIds: string[];
	matchedCoreFeatures: string[];
	matchedAssertionFeatures: string[];
}

export interface WikiRetrievalOptions {
	/** Reliable Claim seeds that may activate structural navigation. */
	anchorClaimIds?: Iterable<string>;
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
	const ranked = modules
		.flatMap((module) => {
			const matchedSeedClaimIds = module.claimRefs
				.map(String)
				.filter((claimId) => anchorClaimIds.has(claimId))
				.sort();
			if (options.requireAnchor && matchedSeedClaimIds.length === 0) return [];
			const coreFeatures = lexicalFeatures(`${module.coreQuestion}\n${module.stableAddress}`);
			const assertionFeatures = lexicalFeatures(
				module.materialization?.assertions.map((assertion) => assertion.renderedText).join("\n") ??
					"",
			);
			const matchedCoreFeatures = intersection(queryFeatures, coreFeatures);
			const matchedAssertionFeatures = intersection(queryFeatures, assertionFeatures);
			const score = matchedCoreFeatures.length * 3 + matchedAssertionFeatures.length;
			if (score <= 0) return [];
			return [
				{ module, score, matchedSeedClaimIds, matchedCoreFeatures, matchedAssertionFeatures },
			];
		})
		.sort(
			(left, right) =>
				right.matchedSeedClaimIds.length - left.matchedSeedClaimIds.length ||
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
