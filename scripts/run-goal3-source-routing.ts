/**
 * Goal 3-B2 source-routing diagnostic (contract v1, freeze v1).
 *
 * Offline mechanism diagnostic: compares two frozen candidate arms — pure
 * top-40 persistent lexical Claim retrieval (L40_STRONG) and bounded source
 * routing (SR12_40: routing pool <=120, <=12 sources, <=40 final candidates)
 * — on revealed Batch C evaluator Gold.
 *
 * NOT a blind product run: modelCalls=0, network=false, answers are never
 * generated, no Relation traversal / Context Pack / canonical-state writes.
 * The report is a POST_HOC_MECHANISM_DIAGNOSTIC.
 *
 * Fail-closed at startup: every frozen hash in the contract and freeze files
 * (contract, questions, diagnostic Gold, implementation code, index pointers)
 * is re-verified before any measurement, and the contract's fixed values
 * (network=false, modelCalls=0, 18 questions, tiers S12/S29/S50, budgets
 * 120/12/40, exactly arms L40_STRONG + SR12_40) are confirmed. The freeze is
 * expected to gain a sourceRoutingRunner self-hash after this runner is
 * written; the interface requires it and verifies it when present, and fails
 * closed when absent. Construction (retrieval) and evaluation are separated:
 * Gold is never read until after candidate retrieval for a question, so no
 * Gold value can enter retrieval.
 *
 * The three tiers use the pack-v5 persistent indexes; each workspace root is
 * derived from the tier's current.json canonicalGenerationPath (the directory
 * above `indexes`). Evidence-closure scoring (spans, child spans, source id
 * matching, quote normalization) is identical to the structural ablation
 * runner.
 *
 * Only this new script file is written; no other file is modified.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config/index.js";
import { findSpansByIds, readAllSpans } from "../src/linter/storage.js";
import {
	retrieveClaimSeedsFromPersistentIndex,
	retrieveSourceRoutedSeedsFromPersistentIndex,
} from "../src/retrieval/persistent-index.js";
import type { PersistentSourceRoutingResult } from "../src/retrieval/persistent-index.js";
import type { Claim, SourceSpan } from "../src/types/index.js";

type JsonRecord = Record<string, unknown>;

const INDEX_SCHEMA = "wge-persistent-seed-index/v7" as const;
const DEFAULT_RUN_ID = "source-routing-v1";
const L40_ARM = "L40_STRONG" as const;
const SR_ARM = "SR12_40" as const;
const FIXED_TIERS = ["S12", "S29", "S50"] as const;
const FIXED_QUESTION_COUNT = 18;
const FIXED_ROUTING_POOL_BUDGET = 120;
const FIXED_SOURCE_BUDGET = 12;
const FIXED_CANDIDATE_BUDGET = 40;
const STABILITY_MAX_DROP = 0.05;
const TOKEN_CEILING_RATIO = 1.1;

interface FrozenFilePointer {
	path: string;
	sha256: string;
}

interface FrozenQuestionFile extends FrozenFilePointer {
	count: number;
}

interface FrozenIndexPointer {
	tier: string;
	path: string;
	pointerSha256: string;
}

interface SourceRoutingContract {
	schemaVersion: string;
	frozenInputs: {
		questions: FrozenQuestionFile;
		diagnosticGold: FrozenFilePointer;
		indexes: FrozenIndexPointer[];
	};
	arms: Array<{
		id: string;
		routingPoolBudget: number;
		sourceBudget: number | null;
		candidateBudget: number;
		definition: string;
	}>;
	fixed: {
		network: boolean;
		modelCalls: number;
		scope: string;
		tiers: string[];
		questionCount: number;
		primaryCandidateBudget: number;
		routingPoolBudget: number;
		sourceBudget: number;
	};
}

interface SourceRoutingFreeze {
	schemaVersion: string;
	status: string;
	frozenAt: string;
	contract: FrozenFilePointer;
	implementation: {
		persistentIndex: FrozenFilePointer;
		sourceRouting: FrozenFilePointer;
		sourceRoutingTests: FrozenFilePointer;
		/** 本 runner 完成后由 freeze 追加的自引用哈希；出现即参与 fail-closed 验证。 */
		sourceRoutingRunner?: FrozenFilePointer;
	};
	verification: {
		lint: string;
		typecheck: string;
		testFiles: number;
		testsPassed: number;
		testsFailed: number;
		retrievalTestFiles: number;
		retrievalTestsPassed: number;
	};
	prohibitions: string[];
}

interface CurrentIndexPointer {
	schemaVersion: string;
	indexVersion: string;
	snapshotRelativePath: string;
	canonicalGenerationPath: string;
}

interface MinimalGold {
	caseId: string;
	requiredEvidence: Array<{ sourceId: string; exactQuote: string }>;
}

type ArmId = typeof L40_ARM | typeof SR_ARM;

interface ArmRetrieval {
	claims: Claim[];
	retrievalMilliseconds: number;
	canonicalStateGeneration: string;
	lexicalDiagnostics: JsonRecord;
	temporalScope: {
		applied: boolean;
		startMonth: string | null;
		endMonth: string | null;
		excludedClaimIds: string[];
	};
	/** SR 专属检索细节；L40 为 null。 */
	sourceRouting: PersistentSourceRoutingResult | null;
}

interface ConstructedQuestion {
	tier: string;
	questionId: string;
	questionType: unknown;
	allSpans: SourceSpan[];
	l40Retrieval: ArmRetrieval;
	srRetrieval: ArmRetrieval;
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const scriptPath = fileURLToPath(import.meta.url);
const contractPath = join(
	projectRoot,
	"experiments",
	"goal3",
	"goal3-source-routing-contract-v1.json",
);
const freezePath = join(projectRoot, "experiments", "goal3", "goal3-source-routing-freeze-v1.json");
const runId = process.env.WGE_GOAL3_SOURCE_ROUTING_RUN_ID ?? DEFAULT_RUN_ID;
const runRoot = join(projectRoot, "experiments", "goal3", "source-routing-runs", runId);
const firstRunDirectoryExisted = existsSync(runRoot);
if (firstRunDirectoryExisted) {
	throw new Error(`Refusing to overwrite source-routing run: ${runRoot}`);
}

// ─── Fail-closed frozen-hash verification ──────────────────────────────────

const contractText = readFileSync(contractPath, "utf8");
const freezeText = readFileSync(freezePath, "utf8");
const contract = JSON.parse(contractText) as SourceRoutingContract;
const freeze = JSON.parse(freezeText) as SourceRoutingFreeze;

assertSha256(contractText, freeze.contract.sha256, "contract (vs freeze)");
if (resolve(projectRoot, freeze.contract.path) !== contractPath) {
	throw new Error(`Freeze contract path drift: ${freeze.contract.path}`);
}

const questionText = readFileSync(
	resolve(projectRoot, contract.frozenInputs.questions.path),
	"utf8",
);
const goldText = readFileSync(
	resolve(projectRoot, contract.frozenInputs.diagnosticGold.path),
	"utf8",
);
assertSha256(
	questionText,
	contract.frozenInputs.questions.sha256,
	`frozen questions ${contract.frozenInputs.questions.path}`,
);
assertSha256(
	goldText,
	contract.frozenInputs.diagnosticGold.sha256,
	`frozen diagnostic Gold ${contract.frozenInputs.diagnosticGold.path}`,
);

const implementationHashes: JsonRecord = {};
for (const [key, pointer] of Object.entries(freeze.implementation)) {
	if (
		!pointer ||
		typeof pointer.path !== "string" ||
		typeof pointer.sha256 !== "string" ||
		pointer.path.length === 0 ||
		pointer.sha256.length === 0
	) {
		throw new Error(`Freeze implementation entry ${key} is not a valid frozen file pointer`);
	}
	const filePath = resolve(projectRoot, pointer.path);
	const fileText = readFileSync(filePath, "utf8");
	assertSha256(fileText, pointer.sha256, `frozen implementation ${pointer.path}`);
	implementationHashes[key] = pointer.sha256;
}
const runnerPointer = freeze.implementation.sourceRoutingRunner;
if (runnerPointer) {
	const runnerPath = resolve(projectRoot, runnerPointer.path);
	if (runnerPath !== scriptPath) {
		throw new Error(`Freeze sourceRoutingRunner path drift: ${runnerPointer.path}`);
	}
	assertSha256(
		readFileSync(runnerPath, "utf8"),
		runnerPointer.sha256,
		"frozen sourceRoutingRunner",
	);
} else {
	throw new Error(
		`Fail-closed: freeze v1 does not yet pin sourceRoutingRunner; add { path: "scripts/run-goal3-source-routing.ts", sha256: "${sha256(readFileSync(scriptPath, "utf8"))}" } to freeze.implementation before the first official run so the runner itself is frozen.`,
	);
}

const questions = readJsonlText(questionText);
if (questions.length !== contract.fixed.questionCount) {
	throw new Error(`Frozen question count drifted: ${questions.length}`);
}
if (contract.frozenInputs.questions.count !== contract.fixed.questionCount) {
	throw new Error(
		`Frozen question count mismatch in contract: ${contract.frozenInputs.questions.count}`,
	);
}
const questionIds = questions.map((question) => requiredString(question, "caseId"));

// ─── Contract fixed-value confirmation (never tuned at runtime) ────────────

const contractFixed = confirmFixedContract(contract);
const primaryCandidateBudget = contract.fixed.primaryCandidateBudget;
const srBudgets = {
	routingPoolBudget: contract.fixed.routingPoolBudget,
	sourceBudget: contract.fixed.sourceBudget,
	candidateBudget: contract.fixed.primaryCandidateBudget,
};

// ─── Measurement ───────────────────────────────────────────────────────────

const constructedQuestions: ConstructedQuestion[] = [];
const indexPointerHashes: JsonRecord[] = [];
const determinismProbes: JsonRecord[] = [];
const expectedCanonicalGenerationByTier = new Map<string, string>();
for (const tier of contract.frozenInputs.indexes) {
	const indexRoot = resolve(projectRoot, tier.path);
	const pointerText = readFileSync(join(indexRoot, "current.json"), "utf8");
	assertSha256(pointerText, tier.pointerSha256, `index pointer ${tier.tier}`);
	const pointer = JSON.parse(pointerText) as CurrentIndexPointer;
	if (pointer.schemaVersion !== INDEX_SCHEMA) {
		throw new Error(`Unsupported retrieval index pointer for ${tier.tier}`);
	}
	const generationRecord = recordValue(
		JSON.parse(readFileSync(resolve(projectRoot, pointer.canonicalGenerationPath), "utf8")),
	);
	const expectedGeneration = requiredString(generationRecord, "token");
	expectedCanonicalGenerationByTier.set(tier.tier, expectedGeneration);
	const workspaceRoot = dirname(dirname(pointer.canonicalGenerationPath));
	const appConfig = loadConfig({ projectRoot: workspaceRoot });
	const allSpans = readAllSpans(appConfig);
	indexPointerHashes.push({ tier: tier.tier, path: tier.path, sha256: sha256(pointerText) });

	for (const [questionIndex, question] of questions.entries()) {
		const questionId = requiredString(question, "caseId");
		const questionValue = requiredString(question, "question");
		// ── 构造阶段（retrieval）：任何 Gold 值都不得进入。 ──
		const l40Retrieval = retrieveQuestionArm({
			arm: L40_ARM,
			indexRoot,
			query: questionValue,
			limit: primaryCandidateBudget,
		});
		const srRetrieval = retrieveQuestionArm({
			arm: SR_ARM,
			indexRoot,
			query: questionValue,
			limit: primaryCandidateBudget,
		});
		if (questionIndex === 0) {
			determinismProbes.push(determinismProbe(indexRoot, questionValue, srRetrieval));
		}
		constructedQuestions.push({
			tier: tier.tier,
			questionId,
			questionType: question.questionType ?? null,
			allSpans,
			l40Retrieval,
			srRetrieval,
		});
	}
}

// ─── Evaluation ────────────────────────────────────────────────────────────
// Gold text was hash-verified above as opaque bytes. Semantic JSON parsing is
// deliberately delayed until every candidate set for every tier is frozen in
// memory, so no Gold value can influence retrieval construction.
const goldRows = readJsonlText(goldText);
const goldById = new Map(
	goldRows.map((row) => [requiredString(row, "caseId"), minimalGold(row)] as const),
);
const rows: JsonRecord[] = [];
for (const constructed of constructedQuestions) {
	const gold = goldById.get(constructed.questionId);
	if (!gold) throw new Error(`Missing diagnostic Gold for ${constructed.questionId}`);
	const requiredSourceIds = [...new Set(gold.requiredEvidence.map((item) => item.sourceId))];
	const requiredQuotes = gold.requiredEvidence.map((item) => item.exactQuote);
	for (const [arm, retrieval] of [
		[L40_ARM, constructed.l40Retrieval],
		[SR_ARM, constructed.srRetrieval],
	] as const) {
		rows.push(
			evaluateArm({
				arm,
				tier: constructed.tier,
				questionId: constructed.questionId,
				questionType: constructed.questionType,
				retrieval,
				allSpans: constructed.allSpans,
				requiredSourceIds,
				requiredQuotes,
			}),
		);
	}
}

// ─── Computed integrity checks (never hardcoded) ───────────────────────────

const rowKeys = new Set(rows.map((row) => `${row.tier}/${row.questionId}/${row.arm}`));
const uniqueRowCount =
	rows.length === FIXED_TIERS.length * FIXED_QUESTION_COUNT * 2 && rowKeys.size === rows.length;
const budgetViolations = rows.filter((row) => !rowBudgetPasses(row));
const staleIndexAcceptance = rows.some(
	(row) =>
		typeof row.tier !== "string" ||
		row.canonicalStateGeneration !== expectedCanonicalGenerationByTier.get(row.tier),
);
const temporalFilterApplied = rows.some(
	(row) => (row.temporalScope as JsonRecord | null)?.applied === true,
);
const scopeViolationClaimIds = [
	...new Set(rows.flatMap((row) => stringArray(row.candidateScopeViolationIds))),
];
const temporalLeakageClaimIds = [
	...new Set(rows.flatMap((row) => stringArray(row.temporalExcludedCandidateIds))),
];
const scopeTimeLeakage = scopeViolationClaimIds.length > 0 || temporalLeakageClaimIds.length > 0;
const deterministic = determinismProbes.every((probe) => probe.deterministic === true);
const firstRunUniqueness = !firstRunDirectoryExisted && !existsSync(runRoot);

// ─── Summaries ─────────────────────────────────────────────────────────────

const summaries = contract.fixed.tiers.flatMap((tier) =>
	[L40_ARM, SR_ARM].map((arm) => summarize(rows, tier, arm)),
);
const largestTier = contract.fixed.tiers.at(-1);
const smallestTier = contract.fixed.tiers[0];
if (!largestTier || !smallestTier) throw new Error("Source-routing contract has no tiers");

const s50SourceRoutedVsL40 = compareArms(rows, largestTier, SR_ARM, L40_ARM, questionIds);
const stability = computeSourceRecallStability(rows, smallestTier, largestTier, SR_ARM);
const verdict = computeVerdict({
	rows,
	summaries,
	smallestTier,
	largestTier,
	s50Comparison: s50SourceRoutedVsL40,
	stability,
	budgetViolations,
	staleIndexAcceptance,
	scopeTimeLeakage,
	deterministic,
	firstRunUniqueness,
});

// ─── Report ────────────────────────────────────────────────────────────────

const report: JsonRecord = {
	schemaVersion: "wge-goal3-source-routing-report/v1",
	status: "POST_HOC_MECHANISM_DIAGNOSTIC",
	blind: false,
	interpretation:
		"Revealed Batch C evaluator Gold makes this a post-hoc mechanism diagnostic, not blind product evidence. " +
		"It tests whether a bounded lexical routing pool (SR12_40) discovers required sources missed by top-40 " +
		"Claim lexical retrieval (L40_STRONG), before any within-source structural completion.",
	runId,
	createdAt: new Date().toISOString(),
	verdict,
	provenance: {
		contractPath,
		contractSha256: sha256(contractText),
		freezePath,
		freezeSha256: sha256(freezeText),
		questionsPath: contract.frozenInputs.questions.path,
		questionsSha256: sha256(questionText),
		diagnosticGoldPath: contract.frozenInputs.diagnosticGold.path,
		diagnosticGoldSha256: sha256(goldText),
		implementationSha256: implementationHashes,
		indexPointerSha256: indexPointerHashes,
		scriptPath,
		scriptSha256: sha256(readFileSync(scriptPath, "utf8")),
		modelCalls: 0,
		network: false,
	},
	checks: {
		frozenContractVerified: true,
		frozenQuestionsVerified: true,
		frozenDiagnosticGoldVerified: true,
		frozenImplementationVerified: true,
		frozenIndexPointersVerified: true,
		sourceRoutingRunnerFrozen: true,
		contractFixed,
		uniqueRowCount,
		boundedBudgets: {
			pass: budgetViolations.length === 0,
			violations: budgetViolations.map((row) => ({
				tier: row.tier,
				questionId: row.questionId,
				arm: row.arm,
				candidateClaimCount: row.candidateClaimCount,
				routingPoolClaimCount: row.routingPoolClaimCount,
				selectedSourceCount: row.routingSelectedSourceCount,
			})),
		},
		staleIndexAcceptance,
		scopeTimeLeakage: {
			leak: scopeTimeLeakage,
			temporalFilterApplied,
			scopeViolationClaimIds,
			temporalLeakageClaimIds,
		},
		determinism: {
			checked: determinismProbes.length === FIXED_TIERS.length,
			deterministic,
			probes: determinismProbes,
		},
		firstRunUniqueness,
		frozenVerification: freeze.verification,
	},
	summaries,
	s50Comparisons: {
		sourceRoutedVsL40: s50SourceRoutedVsL40,
	},
	sourceRecallStability: stability,
	rows,
	limitations: [
		"Revealed Batch C evaluator Gold makes this a post-hoc mechanism diagnostic, not blind product evidence.",
		"Answer generation was intentionally not run; the report only scores candidate closure against required evidence (modelCalls=0).",
		"Source-routed candidates are serialized into this report for mechanism diagnosis only; nothing was written into Context Pack.",
		"SR12_40 hydrates evidence only for the bounded lexical routing pool; latency is measured on the persistent v7 index with per-query shard reads and is a mechanism baseline, not a production-scale architecture.",
		"Source-recall stability compares SR12_40 required-source recall between S12 and S50; S29 is reported but not used in the frozen decision rules.",
		"Exact-quote matching normalizes evidence text identically to the scale-retrieval and structural-ablation runners; child spans are resolved through the same span semantics.",
	],
};
writeJsonExclusive(join(runRoot, "report.json"), report);
writeJsonExclusive(join(runRoot, "run-manifest.json"), {
	schemaVersion: "wge-goal3-source-routing-run-manifest/v1",
	runId,
	status: "POST_HOC_MECHANISM_DIAGNOSTIC",
	modelCalls: 0,
	network: false,
	contractSha256: sha256(contractText),
	freezeSha256: sha256(freezeText),
	questionsSha256: sha256(questionText),
	diagnosticGoldSha256: sha256(goldText),
	implementationSha256: implementationHashes,
	indexPointerSha256: indexPointerHashes,
	scriptSha256: sha256(readFileSync(scriptPath, "utf8")),
	reportSha256: sha256(`${JSON.stringify(report, null, 2)}\n`),
});
console.log(
	JSON.stringify({ runRoot, verdict: verdict.label, checks: report.checks, summaries }, null, 2),
);

// ─── Contract confirmation ─────────────────────────────────────────────────

function confirmFixedContract(contract: SourceRoutingContract): JsonRecord {
	if (contract.fixed.network !== false) {
		throw new Error(`Contract fixed.network drifted: ${String(contract.fixed.network)}`);
	}
	if (contract.fixed.modelCalls !== 0) {
		throw new Error(`Contract fixed.modelCalls drifted: ${String(contract.fixed.modelCalls)}`);
	}
	if (contract.fixed.scope !== "GLOBAL_ONLY") {
		throw new Error(`Contract fixed.scope drifted: ${contract.fixed.scope}`);
	}
	assertFixedTiers(contract.fixed.tiers, [...FIXED_TIERS]);
	if (contract.fixed.questionCount !== FIXED_QUESTION_COUNT) {
		throw new Error(`Contract fixed.questionCount drifted: ${contract.fixed.questionCount}`);
	}
	if (contract.fixed.routingPoolBudget !== FIXED_ROUTING_POOL_BUDGET) {
		throw new Error(
			`Contract fixed.routingPoolBudget drifted: ${contract.fixed.routingPoolBudget}`,
		);
	}
	if (contract.fixed.sourceBudget !== FIXED_SOURCE_BUDGET) {
		throw new Error(`Contract fixed.sourceBudget drifted: ${contract.fixed.sourceBudget}`);
	}
	if (contract.fixed.primaryCandidateBudget !== FIXED_CANDIDATE_BUDGET) {
		throw new Error(
			`Contract fixed.primaryCandidateBudget drifted: ${contract.fixed.primaryCandidateBudget}`,
		);
	}
	const armIds = contract.arms.map((arm) => arm.id).sort();
	assertFixedTiers(armIds, [L40_ARM, SR_ARM].sort());
	const l40 = contract.arms.find((arm) => arm.id === L40_ARM);
	const sr = contract.arms.find((arm) => arm.id === SR_ARM);
	if (!l40 || !sr) throw new Error(`Missing frozen arm ${!l40 ? L40_ARM : SR_ARM}`);
	if (
		l40.routingPoolBudget !== FIXED_CANDIDATE_BUDGET ||
		l40.candidateBudget !== FIXED_CANDIDATE_BUDGET ||
		l40.sourceBudget !== null
	) {
		throw new Error("L40_STRONG arm definition drifted");
	}
	if (
		sr.routingPoolBudget !== FIXED_ROUTING_POOL_BUDGET ||
		sr.sourceBudget !== FIXED_SOURCE_BUDGET ||
		sr.candidateBudget !== FIXED_CANDIDATE_BUDGET
	) {
		throw new Error("SR12_40 arm definition drifted");
	}
	const indexTiers = contract.frozenInputs.indexes.map((index) => index.tier);
	assertFixedTiers(indexTiers, contract.fixed.tiers);
	if (contract.frozenInputs.indexes.length !== contract.fixed.tiers.length) {
		throw new Error(`Frozen index count drifted: ${contract.frozenInputs.indexes.length}`);
	}
	return {
		network: contract.fixed.network,
		modelCalls: contract.fixed.modelCalls,
		scope: contract.fixed.scope,
		tiers: contract.fixed.tiers,
		questionCount: contract.fixed.questionCount,
		routingPoolBudget: contract.fixed.routingPoolBudget,
		sourceBudget: contract.fixed.sourceBudget,
		primaryCandidateBudget: contract.fixed.primaryCandidateBudget,
		arms: contract.arms.map((arm) => ({
			id: arm.id,
			routingPoolBudget: arm.routingPoolBudget,
			sourceBudget: arm.sourceBudget,
			candidateBudget: arm.candidateBudget,
		})),
	};
}

function assertFixedTiers(actual: string[], expected: string[]): void {
	if (
		actual.length !== expected.length ||
		actual.some((value, index) => value !== expected[index])
	) {
		throw new Error(`Frozen fixed list drifted: ${JSON.stringify(actual)}`);
	}
}

// ─── Retrieval (construction) ──────────────────────────────────────────────

function retrieveQuestionArm(params: {
	arm: ArmId;
	indexRoot: string;
	query: string;
	limit: number;
}): ArmRetrieval {
	const started = process.hrtime.bigint();
	if (params.arm === L40_ARM) {
		const result = retrieveClaimSeedsFromPersistentIndex(
			params.indexRoot,
			params.query,
			params.limit,
		);
		const retrievalMilliseconds = Number(process.hrtime.bigint() - started) / 1_000_000;
		return {
			claims: result.result.candidates.slice(0, params.limit).map((candidate) => candidate.claim),
			retrievalMilliseconds,
			canonicalStateGeneration: result.diagnostics.canonicalStateGeneration,
			lexicalDiagnostics: {
				candidateClaimsLoaded: result.diagnostics.candidateClaimsLoaded,
				postingShardsRead: result.diagnostics.postingShardsRead,
				recordShardsRead: result.diagnostics.recordShardsRead,
				postingRowsDecoded: result.diagnostics.postingRowsDecoded,
				recordRowsDecoded: result.diagnostics.recordRowsDecoded,
			},
			temporalScope: result.diagnostics.temporalScope,
			sourceRouting: null,
		};
	}
	const result = retrieveSourceRoutedSeedsFromPersistentIndex(
		params.indexRoot,
		params.query,
		srBudgets,
	);
	const retrievalMilliseconds = Number(process.hrtime.bigint() - started) / 1_000_000;
	return {
		claims: result.candidates.map((candidate) => candidate.claim),
		retrievalMilliseconds,
		canonicalStateGeneration: result.diagnostics.canonicalStateGeneration,
		lexicalDiagnostics: { ...result.diagnostics.lexical },
		temporalScope: result.diagnostics.temporalScope,
		sourceRouting: result,
	};
}

function determinismProbe(indexRoot: string, query: string, first: ArmRetrieval): JsonRecord {
	const rerun = retrieveSourceRoutedSeedsFromPersistentIndex(indexRoot, query, srBudgets);
	const firstIds = first.claims.map((claim) => claim.id);
	const rerunIds = rerun.candidates.map((candidate) => candidate.claim.id);
	const candidateMatch =
		firstIds.length === rerunIds.length &&
		firstIds.every((claimId, index) => claimId === rerunIds[index]);
	return {
		method: "re-run SR12_40 retrieval and compare candidate claimId sequence",
		deterministic: candidateMatch,
		firstCandidateClaimIds: firstIds,
		rerunCandidateClaimIds: rerunIds,
	};
}

// ─── Arm evaluation ────────────────────────────────────────────────────────

function evaluateArm(params: {
	arm: ArmId;
	tier: string;
	questionId: string;
	questionType: unknown;
	retrieval: ArmRetrieval;
	allSpans: SourceSpan[];
	requiredSourceIds: string[];
	requiredQuotes: string[];
}): JsonRecord {
	const started = process.hrtime.bigint();
	const candidateClaims = params.retrieval.claims;
	// Budget enforcement is computed per row via rowBudgetPasses() below and
	// re-checked in the report's boundedBudgets check; retrieval already clamps
	// internally (routing pool <=120, sources <=12, candidates <=40).
	const candidateSpanIds = [...new Set(candidateClaims.flatMap((claim) => claim.evidenceSpanIds))];
	const candidateSpans = findSpansByIds(params.allSpans, candidateSpanIds);
	const candidateSourceIds = [...new Set(candidateSpans.map((span) => span.sourceId))];
	const candidateCharCount = candidateSpans.reduce((total, span) => total + span.text.length, 0);
	const candidateEstimatedTokens = Math.ceil(candidateCharCount / 4);
	const candidateEvidenceText = normalize(candidateSpans.map((span) => span.text).join("\n"));
	const matchedSources = params.requiredSourceIds.filter((sourceId) =>
		candidateSourceIds.some((candidateId) => sourceIdMatches(candidateId, sourceId)),
	);
	const matchedQuotes = params.requiredQuotes.filter((quote) =>
		candidateEvidenceText.includes(normalize(quote)),
	);
	const armElapsedMilliseconds = Number(process.hrtime.bigint() - started) / 1_000_000;
	const candidateScopeViolationIds = candidateClaims
		.filter((claim) => claim.scope.type !== "GLOBAL")
		.map((claim) => claim.id);
	const temporalExcluded = new Set(params.retrieval.temporalScope.excludedClaimIds);
	const temporalExcludedCandidateIds = candidateClaims
		.map((claim) => claim.id)
		.filter((claimId) => temporalExcluded.has(claimId));

	const sourceRouting = params.retrieval.sourceRouting;
	const row: JsonRecord = {
		tier: params.tier,
		questionId: params.questionId,
		questionType: params.questionType,
		arm: params.arm,
		armCandidateBudget: FIXED_CANDIDATE_BUDGET,
		retrievalMilliseconds: round(params.retrieval.retrievalMilliseconds),
		elapsedMilliseconds: round(params.retrieval.retrievalMilliseconds + armElapsedMilliseconds),
		canonicalStateGeneration: params.retrieval.canonicalStateGeneration,
		requiredSourceCount: params.requiredSourceIds.length,
		matchedSourceCount: matchedSources.length,
		requiredQuoteCount: params.requiredQuotes.length,
		matchedQuoteCount: matchedQuotes.length,
		candidateRequiredSourceRecall:
			params.requiredSourceIds.length === 0
				? null
				: round(matchedSources.length / params.requiredSourceIds.length),
		candidateRequiredEvidenceQuoteRecall:
			params.requiredQuotes.length === 0
				? null
				: round(matchedQuotes.length / params.requiredQuotes.length),
		candidateClaimIds: candidateClaims.map((claim) => claim.id),
		candidateClaimCount: candidateClaims.length,
		candidateSourceIds,
		candidateSourceCount: candidateSourceIds.length,
		candidateSpanIds,
		candidateSpanCount: candidateSpans.length,
		candidateCharCount,
		candidateEstimatedTokens,
		candidateScopeViolationIds,
		temporalExcludedCandidateIds,
		lexicalDiagnostics: params.retrieval.lexicalDiagnostics,
		temporalScope: params.retrieval.temporalScope,
		matchedSources,
		missingSources: params.requiredSourceIds.filter(
			(sourceId) => !matchedSources.includes(sourceId),
		),
		matchedQuotes,
		missingQuotes: params.requiredQuotes.filter((quote) => !matchedQuotes.includes(quote)),
	};
	if (sourceRouting) {
		row.routingPoolClaimCount = sourceRouting.diagnostics.routingPoolClaimCount;
		row.routingDiscoveredSourceCount = sourceRouting.diagnostics.discoveredSourceCount;
		row.routingSelectedSourceCount = sourceRouting.diagnostics.selectedSourceCount;
		row.routingCandidateSourceCount = sourceRouting.diagnostics.candidateSourceCount;
		row.routingSelectedSourceIds = sourceRouting.sources.map((source) => source.id);
		row.spanShardsReadForRouting = sourceRouting.diagnostics.spanShardsReadForRouting;
		row.unresolvedEvidenceCount = sourceRouting.diagnostics.unresolvedEvidenceCount;
		row.unresolvedEvidenceRefCount = sourceRouting.diagnostics.unresolvedEvidenceRefCount;
		row.guaranteedClaimIds = sourceRouting.candidates
			.filter((candidate) => candidate.guaranteed)
			.map((candidate) => candidate.claim.id);
		row.guaranteedClaimCount = sourceRouting.candidates.filter(
			(candidate) => candidate.guaranteed,
		).length;
		row.routingTraces = sourceRouting.traces.map((trace) => ({
			sourceId: trace.sourceId,
			firstLexicalRank: trace.firstLexicalRank,
			claimIds: trace.claimIds,
			selected: trace.selected,
		}));
		row.routingLexicalDiagnostics = { ...sourceRouting.diagnostics.lexical };
	}
	return row;
}

function rowBudgetPasses(row: JsonRecord): boolean {
	const candidatePass = Number(row.candidateClaimCount) <= FIXED_CANDIDATE_BUDGET;
	if (row.arm === L40_ARM) return candidatePass;
	return (
		candidatePass &&
		Number(row.routingPoolClaimCount) <= FIXED_ROUTING_POOL_BUDGET &&
		Number(row.routingSelectedSourceCount) <= FIXED_SOURCE_BUDGET
	);
}

// ─── Summary / comparison / stability / verdict ────────────────────────────

function summarize(rows: JsonRecord[], tier: string, arm: string): JsonRecord {
	const selected = rows.filter((row) => row.tier === tier && row.arm === arm);
	const requiredSources = sum(selected.map((row) => Number(row.requiredSourceCount)));
	const matchedSources = sum(selected.map((row) => Number(row.matchedSourceCount)));
	const requiredQuotes = sum(selected.map((row) => Number(row.requiredQuoteCount)));
	const matchedQuotes = sum(selected.map((row) => Number(row.matchedQuoteCount)));
	const latencies = selected
		.map((row) => Number(row.elapsedMilliseconds))
		.sort((left, right) => left - right);
	const routingPoolSizes = nonNullNumbers(selected.map((row) => row.routingPoolClaimCount));
	const discoveredSources = nonNullNumbers(selected.map((row) => row.routingDiscoveredSourceCount));
	const selectedSources = nonNullNumbers(selected.map((row) => row.routingSelectedSourceCount));
	const spanShards = nonNullNumbers(selected.map((row) => row.spanShardsReadForRouting));
	const unresolved = nonNullNumbers(selected.map((row) => row.unresolvedEvidenceCount));
	const unresolvedRefs = nonNullNumbers(selected.map((row) => row.unresolvedEvidenceRefCount));
	const guaranteed = nonNullNumbers(selected.map((row) => row.guaranteedClaimCount));
	const candidateClaimsLoaded = selected.map((row) =>
		Number((row.lexicalDiagnostics as JsonRecord).candidateClaimsLoaded),
	);
	const recordRowsDecoded = selected.map((row) =>
		Number((row.lexicalDiagnostics as JsonRecord).recordRowsDecoded),
	);
	const summary: JsonRecord = {
		tier,
		arm,
		questions: selected.length,
		candidateRequiredSourceRecall:
			requiredSources === 0 ? null : round(matchedSources / requiredSources),
		candidateRequiredEvidenceQuoteRecall:
			requiredQuotes === 0 ? null : round(matchedQuotes / requiredQuotes),
		questionsWithAllRequiredSources: selected.filter(
			(row) => Number(row.matchedSourceCount) === Number(row.requiredSourceCount),
		).length,
		questionsWithAllRequiredQuotes: selected.filter(
			(row) => Number(row.matchedQuoteCount) === Number(row.requiredQuoteCount),
		).length,
		averageCandidateClaimCount: round(
			average(selected.map((row) => Number(row.candidateClaimCount))),
		),
		averageCandidateSourceCount: round(
			average(selected.map((row) => Number(row.candidateSourceCount))),
		),
		averageCandidateSpanCount: round(
			average(selected.map((row) => Number(row.candidateSpanCount))),
		),
		averageCandidateCharCount: round(
			average(selected.map((row) => Number(row.candidateCharCount))),
		),
		averageEvidenceClosureTokens: round(
			average(selected.map((row) => Number(row.candidateEstimatedTokens))),
		),
		averageLexicalCandidateClaimsLoaded: round(average(candidateClaimsLoaded)),
		averageLexicalRecordRowsDecoded: round(average(recordRowsDecoded)),
		averageQueryMilliseconds: round(average(latencies)),
		p95QueryMilliseconds: round(percentile(latencies, 0.95)),
	};
	if (arm === SR_ARM) {
		summary.averageRoutingPoolClaimCount =
			routingPoolSizes.length === 0 ? null : round(average(routingPoolSizes));
		summary.averageRoutingDiscoveredSourceCount =
			discoveredSources.length === 0 ? null : round(average(discoveredSources));
		summary.averageRoutingSelectedSourceCount =
			selectedSources.length === 0 ? null : round(average(selectedSources));
		summary.averageSpanShardsReadForRouting =
			spanShards.length === 0 ? null : round(average(spanShards));
		summary.averageUnresolvedEvidenceCount =
			unresolved.length === 0 ? null : round(average(unresolved));
		summary.averageUnresolvedEvidenceRefCount =
			unresolvedRefs.length === 0 ? null : round(average(unresolvedRefs));
		summary.averageGuaranteedCandidateCount =
			guaranteed.length === 0 ? null : round(average(guaranteed));
	}
	return summary;
}

function compareArms(
	rows: JsonRecord[],
	tier: string,
	routedArm: string,
	baselineArm: string,
	questionIds: string[],
): JsonRecord {
	const routed = rows.filter((row) => row.tier === tier && row.arm === routedArm);
	const baseline = rows.filter((row) => row.tier === tier && row.arm === baselineArm);
	const routedByQuestion = new Map(routed.map((row) => [row.questionId, row] as const));
	const baselineByQuestion = new Map(baseline.map((row) => [row.questionId, row] as const));
	const perQuestion = questionIds.map((questionId) => {
		const routedRow = routedByQuestion.get(questionId);
		const baselineRow = baselineByQuestion.get(questionId);
		if (!routedRow || !baselineRow) {
			throw new Error(`Missing comparison rows ${tier}/${routedArm}/${baselineArm}/${questionId}`);
		}
		const sourceDelta =
			Number(routedRow.matchedSourceCount) - Number(baselineRow.matchedSourceCount);
		const quoteDelta = Number(routedRow.matchedQuoteCount) - Number(baselineRow.matchedQuoteCount);
		const routedSources = new Set(stringArray(routedRow.matchedSources));
		const baselineSources = new Set(stringArray(baselineRow.matchedSources));
		const routedQuotes = new Set(stringArray(routedRow.matchedQuotes));
		const baselineQuotes = new Set(stringArray(baselineRow.matchedQuotes));
		const gainedSources = [...routedSources].filter((item) => !baselineSources.has(item));
		const lostSources = [...baselineSources].filter((item) => !routedSources.has(item));
		const gainedQuotes = [...routedQuotes].filter((item) => !baselineQuotes.has(item));
		const lostQuotes = [...baselineQuotes].filter((item) => !routedQuotes.has(item));
		const baselineTokens = Number(baselineRow.candidateEstimatedTokens);
		return {
			questionId,
			sourceDelta,
			quoteDelta,
			gainedSources,
			lostSources,
			gainedQuotes,
			lostQuotes,
			sourceOutcome: lostSources.length > 0 ? "loss" : gainedSources.length > 0 ? "win" : "tie",
			quoteOutcome: lostQuotes.length > 0 ? "loss" : gainedQuotes.length > 0 ? "win" : "tie",
			tokenRatio:
				baselineTokens === 0
					? null
					: round(Number(routedRow.candidateEstimatedTokens) / baselineTokens),
			routedMatchedSources: Number(routedRow.matchedSourceCount),
			baselineMatchedSources: Number(baselineRow.matchedSourceCount),
			routedMatchedQuotes: Number(routedRow.matchedQuoteCount),
			baselineMatchedQuotes: Number(baselineRow.matchedQuoteCount),
		};
	});
	const sourceWins = perQuestion.filter((row) => row.sourceOutcome === "win").length;
	const sourceLosses = perQuestion.filter((row) => row.sourceOutcome === "loss").length;
	const sourceTies = perQuestion.filter((row) => row.sourceOutcome === "tie").length;
	const quoteWins = perQuestion.filter((row) => row.quoteOutcome === "win").length;
	const quoteLosses = perQuestion.filter((row) => row.quoteOutcome === "loss").length;
	const quoteTies = perQuestion.filter((row) => row.quoteOutcome === "tie").length;
	const routedTokenAverage = average(routed.map((row) => Number(row.candidateEstimatedTokens)));
	const baselineTokenAverage = average(baseline.map((row) => Number(row.candidateEstimatedTokens)));
	const routedP95 = percentile(
		routed.map((row) => Number(row.elapsedMilliseconds)).sort((a, b) => a - b),
		0.95,
	);
	const baselineP95 = percentile(
		baseline.map((row) => Number(row.elapsedMilliseconds)).sort((a, b) => a - b),
		0.95,
	);
	return {
		tier,
		routedArm,
		baselineArm,
		perQuestion,
		sourceWins,
		sourceLosses,
		sourceTies,
		quoteWins,
		quoteLosses,
		quoteTies,
		anyStrictSourceWin: sourceWins > 0,
		anyItemGain: perQuestion.some(
			(row) => row.gainedSources.length > 0 || row.gainedQuotes.length > 0,
		),
		anySourceLoss: sourceLosses > 0,
		anyQuoteLoss: quoteLosses > 0,
		matchedSourceDelta: round(sum(perQuestion.map((row) => Number(row.sourceDelta)))),
		matchedQuoteDelta: round(sum(perQuestion.map((row) => Number(row.quoteDelta)))),
		routedAverageTokens: round(routedTokenAverage),
		baselineAverageTokens: round(baselineTokenAverage),
		averageTokenRatio:
			baselineTokenAverage === 0 ? null : round(routedTokenAverage / baselineTokenAverage),
		tokenCeilingPass:
			baselineTokenAverage === 0
				? true
				: routedTokenAverage <= baselineTokenAverage * TOKEN_CEILING_RATIO,
		routedP95Milliseconds: round(routedP95),
		baselineP95Milliseconds: round(baselineP95),
		latencyCeilingMilliseconds: round(Math.max(baselineP95 * 2, baselineP95 + 50)),
		latencyPass: routedP95 <= Math.max(baselineP95 * 2, baselineP95 + 50),
	};
}

function computeSourceRecallStability(
	rows: JsonRecord[],
	smallestTier: string,
	largestTier: string,
	arm: string,
): JsonRecord {
	const summaryAt = (tier: string): JsonRecord => {
		const row = rows.filter((item) => item.tier === tier && item.arm === arm);
		if (row.length === 0) throw new Error(`Missing stability rows ${tier}/${arm}`);
		return summarize(row, tier, arm);
	};
	const s12 = summaryAt(smallestTier);
	const s50 = summaryAt(largestTier);
	const s12Recall = Number(s12.candidateRequiredSourceRecall);
	const s50Recall = Number(s50.candidateRequiredSourceRecall);
	if (!Number.isFinite(s12Recall) || !Number.isFinite(s50Recall)) {
		throw new Error(`Required-source recall not computable for ${arm} stability`);
	}
	const delta = s50Recall - s12Recall;
	return {
		arm,
		smallestTier,
		largestTier,
		s12RequiredSourceRecall: round(s12Recall),
		s50RequiredSourceRecall: round(s50Recall),
		delta: round(delta),
		stable: delta >= -STABILITY_MAX_DROP,
	};
}

function computeVerdict(params: {
	rows: JsonRecord[];
	summaries: JsonRecord[];
	smallestTier: string;
	largestTier: string;
	s50Comparison: JsonRecord;
	stability: JsonRecord;
	budgetViolations: JsonRecord[];
	staleIndexAcceptance: boolean;
	scopeTimeLeakage: boolean;
	deterministic: boolean;
	firstRunUniqueness: boolean;
}): JsonRecord {
	const summaryAt = (tier: string, arm: string): JsonRecord => {
		const row = params.summaries.find((item) => item.tier === tier && item.arm === arm);
		if (!row) throw new Error(`Missing summary ${tier}/${arm}`);
		return row;
	};
	const l40 = summaryAt(params.largestTier, L40_ARM);
	const sr50 = summaryAt(params.largestTier, SR_ARM);
	const comparison = params.s50Comparison;
	const perQuestion = comparison.perQuestion as JsonRecord[];

	const sourceRecallAtLeast =
		Number(sr50.candidateRequiredSourceRecall) >= Number(l40.candidateRequiredSourceRecall);
	const strictSourceWins = perQuestion.filter((row) => row.sourceOutcome === "win").length;
	const anySourceLoss = perQuestion.some((row) => row.sourceOutcome === "loss");
	const anyQuoteLoss = perQuestion.some((row) => row.quoteOutcome === "loss");
	const quoteRecallAtLeast =
		Number(sr50.candidateRequiredEvidenceQuoteRecall) >=
		Number(l40.candidateRequiredEvidenceQuoteRecall);
	const tokenCeilingPass =
		Number(sr50.averageEvidenceClosureTokens) <=
		Number(l40.averageEvidenceClosureTokens) * TOKEN_CEILING_RATIO;
	const latencyPass = comparison.latencyPass === true;
	const tokenAdvantage =
		Number(sr50.averageEvidenceClosureTokens) < Number(l40.averageEvidenceClosureTokens);
	const loadedRecordAdvantage =
		Number(sr50.averageLexicalCandidateClaimsLoaded) <
		Number(l40.averageLexicalCandidateClaimsLoaded);
	const latencyAdvantage =
		Number(comparison.routedP95Milliseconds) < Number(comparison.baselineP95Milliseconds);
	const anyCostAdvantage = tokenAdvantage || loadedRecordAdvantage || latencyAdvantage;
	const budgetPass = params.budgetViolations.length === 0;
	const stabilityPass = params.stability.stable === true;

	const sourceDiscoveryPass = {
		condition:
			sourceRecallAtLeast && strictSourceWins >= 1 && !anySourceLoss && budgetPass && stabilityPass,
		checks: {
			sourceRecallAtLeast,
			strictRequiredSourceWins: strictSourceWins,
			zeroSourceLosses: !anySourceLoss,
			budgetPass,
			stabilityPass,
			sr50RequiredSourceRecall: sr50.candidateRequiredSourceRecall,
			l40RequiredSourceRecall: l40.candidateRequiredSourceRecall,
		},
	};

	const fullCandidatePass = {
		condition:
			sourceDiscoveryPass.condition &&
			quoteRecallAtLeast &&
			!anyQuoteLoss &&
			tokenCeilingPass &&
			latencyPass &&
			anyCostAdvantage,
		checks: {
			...sourceDiscoveryPass.checks,
			quoteRecallAtLeast,
			zeroQuoteLosses: !anyQuoteLoss,
			tokenCeilingPass,
			latencyPass,
			anyCostAdvantage,
			tokenAdvantage,
			loadedRecordAdvantage,
			latencyAdvantage,
			sr50QuoteRecall: sr50.candidateRequiredEvidenceQuoteRecall,
			l40QuoteRecall: l40.candidateRequiredEvidenceQuoteRecall,
			averageTokenRatio: comparison.averageTokenRatio,
			p95LatencyRatio: round(
				Number(comparison.routedP95Milliseconds) /
					Math.max(0.001, Number(comparison.baselineP95Milliseconds)),
			),
		},
	};

	const noSourceBenefit = {
		condition: strictSourceWins === 0,
		checks: {
			anyStrictSourceWinVsL40: comparison.anyStrictSourceWin,
			strictRequiredSourceWins: strictSourceWins,
			anyItemGain: comparison.anyItemGain,
		},
	};

	const rework = {
		condition:
			anySourceLoss ||
			!budgetPass ||
			params.scopeTimeLeakage ||
			params.staleIndexAcceptance ||
			!params.deterministic ||
			!params.firstRunUniqueness,
		checks: {
			requiredSourceLosses: anySourceLoss,
			budgetViolation: !budgetPass,
			scopeTimeLeakage: params.scopeTimeLeakage,
			staleIndexAcceptance: params.staleIndexAcceptance,
			nonDeterminism: !params.deterministic,
			firstRunOverwrite: !params.firstRunUniqueness,
		},
	};

	const label = rework.condition
		? "REWORK"
		: fullCandidatePass.condition
			? "FULL_CANDIDATE_PASS"
			: sourceDiscoveryPass.condition
				? "SOURCE_ONLY_SIGNAL"
				: noSourceBenefit.condition
					? "NO_SOURCE_BENEFIT"
					: "REWORK";

	return {
		label,
		sourceDiscoveryPass,
		fullCandidatePass,
		noSourceBenefit,
		rework,
		sourceRecallStability: params.stability,
		scaleStabilityPass: stabilityPass,
	};
}

// ─── Helpers (JSON / hash / normalize semantics shared with prior runners) ─

function minimalGold(row: JsonRecord): MinimalGold {
	return {
		caseId: requiredString(row, "caseId"),
		// Only scoring-relevant Gold is retained: answers and forbidden claims are not copied.
		requiredEvidence: recordArray(row.requiredEvidence).map((item) => ({
			sourceId: requiredString(item, "sourceId"),
			exactQuote: requiredString(item, "exactQuote"),
		})),
	};
}

function sourceIdMatches(canonicalId: string, benchmarkId: string): boolean {
	return canonicalId === benchmarkId || canonicalId.startsWith(`source:${benchmarkId}-`);
}

function nonNullNumbers(values: unknown[]): number[] {
	return values
		.map((value) => (value === null || value === undefined ? Number.NaN : Number(value)))
		.filter((value) => Number.isFinite(value));
}

function stringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

function readJsonlText(text: string): JsonRecord[] {
	return text
		.split(/\r?\n/u)
		.filter((line) => line.trim().length > 0)
		.map((line) => recordValue(JSON.parse(line)));
}

/**
 * Quote normalization MUST stay identical to run-goal3-scale-retrieval.ts and
 * run-goal3-structural-ablation.ts so exact-quote matching is comparable.
 */
function normalize(value: string): string {
	return value
		.normalize("NFKC")
		.replace(/(^|\s)[>*#-]+\s+/gu, "$1")
		.replace(/[*_`]+/gu, "")
		.replace(/\s+/gu, " ")
		.trim();
}

function recordValue(value: unknown): JsonRecord {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	return value as JsonRecord;
}

function recordArray(value: unknown): JsonRecord[] {
	return Array.isArray(value) ? value.map(recordValue) : [];
}

function requiredString(record: JsonRecord, key: string): string {
	const value = record[key];
	if (typeof value !== "string" || value.length === 0) throw new Error(`Missing string ${key}`);
	return value;
}

function assertSha256(value: string, expected: string, label: string): void {
	const actual = sha256(value);
	if (actual !== expected) {
		throw new Error(`Fail-closed: ${label} hash mismatch (expected ${expected}, got ${actual})`);
	}
}

function writeJsonExclusive(path: string, value: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, {
		encoding: "utf8",
		flag: "wx",
	});
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function sum(values: number[]): number {
	return values.reduce((total, value) => total + value, 0);
}

function average(values: number[]): number {
	return values.length === 0 ? 0 : sum(values) / values.length;
}

function percentile(values: number[], quantile: number): number {
	if (values.length === 0) return 0;
	return values[Math.min(values.length - 1, Math.ceil(values.length * quantile) - 1)] ?? 0;
}

function round(value: number): number {
	return Math.round(value * 1000) / 1000;
}
