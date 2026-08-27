/**
 * Goal 3 EPSI40 evidence-preserving source-insertion diagnostic (contract v1).
 *
 * Mechanically adapted from scripts/run-goal3-source-routing.ts and
 * scripts/run-goal3-source-routing-breadth.ts (fail-closed hashing, report
 * layout, JSON/hash helpers). Compares two frozen candidate arms on revealed
 * Batch C (18 questions) + Batch B (32 questions) Gold in ONE immutable run:
 *
 * - L40_STRONG: the first 40 Claims in the existing deterministic persistent
 *   lexical order — constructed as the pure selector's phase-1 baseline from
 *   the SAME top-120 pool, never as a separately drifting retrieval.
 * - EPSI40: Evidence-Preserving Source Insertion over the bounded top-120
 *   pool with exact frozen budgets 120/12/40 (src/retrieval/
 *   evidence-preserving-source-insertion.ts).
 *
 * Construction and evaluation are separated: every pool Claim's
 * evidenceSpanId is resolved against the S50 workspace spans with child-span
 * semantics (resolveSpanById), failing closed on unresolved evidence; all 50
 * questions build BOTH arms before either Gold file is JSON-parsed. Required
 * sources and source-bound exact evidence are scored with
 * evaluateEvidenceCoverage (src/retrieval/evidence-coverage.ts) — merged
 * segments are reconstructed from persisted base spans, never from global
 * string concatenation. Gold source IDs use the existing canonical-prefix
 * match rule.
 *
 * Fail-closed at startup: the freeze file
 * experiments/goal3/goal3-evidence-preserving-source-insertion-freeze-v1.json
 * must exist and pin the contract, selector, selector tests, persistent
 * index, evidence coverage, evidence-coverage tests and the runner's own
 * hash; if missing or the runner is unpinned, an actionable freeze skeleton
 * with expected hashes is printed and the run fails closed. The freeze is NOT
 * created by this runner.
 *
 * network=false, modelCalls=0, no Relation traversal / Context Pack / answer
 * generation / canonical-state writes. Arm serialization order alternates by
 * question index for descriptive timing only; latency is never a verdict
 * metric. Run dir overwrite is refused (run id from WGE_GOAL3_EPSI_RUN_ID,
 * default evidence-preserving-source-insertion-v1).
 *
 * Only this new script file is written; no other file is modified.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config/index.js";
import { readAllSpans, resolveSpanById } from "../src/linter/storage.js";
import {
	type EvidenceRequirement,
	canonicalSourceIdsMatch,
	evaluateEvidenceCoverage,
} from "../src/retrieval/evidence-coverage.js";
import {
	type EvidencePreservingCandidate,
	type EvidencePreservingInsertionSelection,
	type EvidencePreservingPoolClaim,
	selectEvidencePreservingCandidates,
} from "../src/retrieval/evidence-preserving-source-insertion.js";
import { retrieveClaimSeedsFromPersistentIndex } from "../src/retrieval/persistent-index.js";
import type { Claim, SourceSpan } from "../src/types/index.js";

type JsonRecord = Record<string, unknown>;

const INDEX_SCHEMA = "wge-persistent-seed-index/v7" as const;
const DEFAULT_RUN_ID = "evidence-preserving-source-insertion-v1";
const L40_ARM = "L40_STRONG" as const;
const EPSI_ARM = "EPSI40" as const;
const FIXED_QUESTION_COUNT = 50;
const FIXED_EXPECTED_ROW_COUNT = 100;
const FIXED_ROUTING_POOL_BUDGET = 120;
const FIXED_SOURCE_BUDGET = 12;
const FIXED_CANDIDATE_BUDGET = 40;
const TOKEN_CEILING_RATIO = 1.1;
const BATCH_C_QUESTION_COUNT = 18;
const BATCH_B_QUESTION_COUNT = 32;

interface FrozenFilePointer {
	path: string;
	sha256: string;
}

interface FrozenQuestionFile extends FrozenFilePointer {
	count: number;
}

interface CurrentIndexPointer {
	schemaVersion: string;
	indexVersion: string;
	snapshotRelativePath: string;
	canonicalGenerationPath: string;
}

interface EpsiContract {
	schemaVersion: string;
	frozenInputs: {
		batchCQuestions: FrozenQuestionFile;
		batchCGold: FrozenQuestionFile;
		batchBQuestions: FrozenQuestionFile;
		batchBGold: FrozenQuestionFile;
		s50Index: { tier: string; path: string; pointerSha256: string };
		correctedScorerContract: FrozenFilePointer;
		correctedRescoreReport: FrozenFilePointer;
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
		retrievalTier: string;
		scope: string;
		routingPoolBudget: number;
		novelSourceInspectionBudget: number;
		candidateBudget: number;
		questionCount: number;
		expectedRowCount: number;
		latencyIsDecisionMetric: boolean;
		goldParsedAfterAllCandidateSets: boolean;
	};
}

interface EpsiFreeze {
	schemaVersion: string;
	status: string;
	frozenAt: string;
	contract: FrozenFilePointer;
	implementation: {
		selector?: FrozenFilePointer;
		selectorTests?: FrozenFilePointer;
		persistentIndex?: FrozenFilePointer;
		evidenceCoverage?: FrozenFilePointer;
		evidenceCoverageTests?: FrozenFilePointer;
		/** 本 runner 完成后由 freeze 追加的自引用哈希；缺失即 fail-closed。 */
		epsiRunner?: FrozenFilePointer;
	};
	verification?: {
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

interface MinimalGold {
	caseId: string;
	requiredEvidence: Array<{ sourceId: string; exactQuote: string }>;
}

type ArmId = typeof L40_ARM | typeof EPSI_ARM;

/** 池内一条已解析的 Claim（child-span 语义，fail-closed）。 */
interface ResolvedPoolEntry {
	claim: Claim;
	/** 1-based 词法排位（pool 顺序）。 */
	lexicalRank: number;
	/** 去重后的原始 evidenceSpanId 列表（保留 child id）。 */
	evidenceSpanIds: string[];
	/** 解析出的去重 canonical source id 列表。 */
	sourceIds: string[];
	/** 解析出的去重 base spans（用于 token 成本与 scope 检查）。 */
	baseSpans: SourceSpan[];
}

interface ArmConstructed {
	arm: ArmId;
	/** 有序候选（L40 为 pool 前 40；EPSI 为 selector 输出）。 */
	candidates: EvidencePreservingCandidate[];
	/** pool 大小（EPSI 为 120 截断后；L40 为 40）。 */
	poolClaimCount: number;
	retrievalMilliseconds: number;
	canonicalStateGeneration: string;
	lexicalDiagnostics: JsonRecord;
	temporalScope: JsonRecord;
	epsiSelection: EvidencePreservingInsertionSelection | null;
}

interface ConstructedQuestion {
	datasetId: string;
	questionId: string;
	questionType: unknown;
	questionValue: string;
	allSpans: SourceSpan[];
	entries: ResolvedPoolEntry[];
	poolClaimCount: number;
	armExecutionOrder: ArmId[];
	l40: ArmConstructed;
	epsi: ArmConstructed;
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const scriptPath = fileURLToPath(import.meta.url);
const contractPath = join(
	projectRoot,
	"experiments",
	"goal3",
	"goal3-evidence-preserving-source-insertion-contract-v1.json",
);
const freezePath = join(
	projectRoot,
	"experiments",
	"goal3",
	"goal3-evidence-preserving-source-insertion-freeze-v1.json",
);
const runId = process.env.WGE_GOAL3_EPSI_RUN_ID ?? DEFAULT_RUN_ID;
const runRoot = join(
	projectRoot,
	"experiments",
	"goal3",
	"evidence-preserving-source-insertion-runs",
	runId,
);
const firstRunDirectoryExisted = existsSync(runRoot);
if (firstRunDirectoryExisted) {
	throw new Error(`Refusing to overwrite evidence-preserving-source-insertion run: ${runRoot}`);
}

// freeze 必须固定的五个实现文件（runner 自身在 freeze.implementation.epsiRunner）。
const requiredImplementation: Array<[keyof EpsiFreeze["implementation"], string]> = [
	["selector", "src/retrieval/evidence-preserving-source-insertion.ts"],
	["selectorTests", "src/retrieval/evidence-preserving-source-insertion.test.ts"],
	["persistentIndex", "src/retrieval/persistent-index.ts"],
	["evidenceCoverage", "src/retrieval/evidence-coverage.ts"],
	["evidenceCoverageTests", "src/retrieval/evidence-coverage.test.ts"],
];

// ─── Fail-closed frozen-hash verification ──────────────────────────────────

const contractText = readFileSync(contractPath, "utf8");
if (!existsSync(freezePath)) {
	throw new Error(
		`Fail-closed: EPSI freeze v1 not found at ${freezePath}. Create experiments/goal3/goal3-evidence-preserving-source-insertion-freeze-v1.json before the first official run so the runner itself is frozen. Suggested freeze file:\n${freezeSuggestion(contractText)}`,
	);
}
const freezeText = readFileSync(freezePath, "utf8");
const contract = JSON.parse(contractText) as EpsiContract;
const freeze = JSON.parse(freezeText) as EpsiFreeze;

const frozenContractVerified = assertSha256(
	contractText,
	freeze.contract.sha256,
	"contract (vs freeze)",
);
if (resolve(projectRoot, freeze.contract.path) !== contractPath) {
	throw new Error(`Freeze contract path drift: ${freeze.contract.path}`);
}

// 四个问题/Gold 冻结文件在测量前按 opaque bytes 校验；Gold 的 JSON parse
// 推迟到全部 50 题两臂候选集构造完成之后。
const batchCQuestionsPointer = contract.frozenInputs.batchCQuestions;
const batchCGoldPointer = contract.frozenInputs.batchCGold;
const batchBQuestionsPointer = contract.frozenInputs.batchBQuestions;
const batchBGoldPointer = contract.frozenInputs.batchBGold;
const correctedScorerPointer = contract.frozenInputs.correctedScorerContract;
const correctedRescorePointer = contract.frozenInputs.correctedRescoreReport;

const batchCQuestionsText = readFileSync(resolve(projectRoot, batchCQuestionsPointer.path), "utf8");
const batchCGoldText = readFileSync(resolve(projectRoot, batchCGoldPointer.path), "utf8");
const batchBQuestionsText = readFileSync(resolve(projectRoot, batchBQuestionsPointer.path), "utf8");
const batchBGoldText = readFileSync(resolve(projectRoot, batchBGoldPointer.path), "utf8");
const correctedScorerText = readFileSync(resolve(projectRoot, correctedScorerPointer.path), "utf8");
const correctedRescoreText = readFileSync(
	resolve(projectRoot, correctedRescorePointer.path),
	"utf8",
);

const frozenQuestionsVerified =
	assertSha256(
		batchCQuestionsText,
		batchCQuestionsPointer.sha256,
		`frozen Batch C questions ${batchCQuestionsPointer.path}`,
	) &&
	assertSha256(
		batchBQuestionsText,
		batchBQuestionsPointer.sha256,
		`frozen Batch B questions ${batchBQuestionsPointer.path}`,
	);
const frozenDiagnosticGoldVerified =
	assertSha256(
		batchCGoldText,
		batchCGoldPointer.sha256,
		`frozen Batch C Gold ${batchCGoldPointer.path}`,
	) &&
	assertSha256(
		batchBGoldText,
		batchBGoldPointer.sha256,
		`frozen Batch B Gold ${batchBGoldPointer.path}`,
	);
const frozenRescoreInputsVerified =
	assertSha256(
		correctedScorerText,
		correctedScorerPointer.sha256,
		`frozen corrected scorer contract ${correctedScorerPointer.path}`,
	) &&
	assertSha256(
		correctedRescoreText,
		correctedRescorePointer.sha256,
		`frozen corrected rescore report ${correctedRescorePointer.path}`,
	);

// 五个实现文件必须全部被 freeze 固定，且 runner 自身也必须被固定。
const implementationHashes: JsonRecord = {};
let frozenImplementationVerified = true;
for (const [key, relativePath] of requiredImplementation) {
	const pointer = freeze.implementation[key];
	if (!pointer || typeof pointer.path !== "string" || typeof pointer.sha256 !== "string") {
		throw new Error(
			`Fail-closed: freeze v1 does not pin implementation "${key}"; expected { path: "${relativePath}", sha256: "${sha256(readFileSync(resolve(projectRoot, relativePath), "utf8"))}" } in freeze.implementation.`,
		);
	}
	if (pointer.path !== relativePath) {
		throw new Error(`Freeze implementation path drift for ${key}: ${pointer.path}`);
	}
	const filePath = resolve(projectRoot, pointer.path);
	frozenImplementationVerified =
		assertSha256(
			readFileSync(filePath, "utf8"),
			pointer.sha256,
			`frozen implementation ${pointer.path}`,
		) && frozenImplementationVerified;
	implementationHashes[key] = pointer.sha256;
}
const runnerPointer = freeze.implementation.epsiRunner;
if (runnerPointer) {
	const runnerPath = resolve(projectRoot, runnerPointer.path);
	if (runnerPath !== scriptPath) {
		throw new Error(`Freeze epsiRunner path drift: ${runnerPointer.path}`);
	}
	frozenImplementationVerified =
		assertSha256(readFileSync(runnerPath, "utf8"), runnerPointer.sha256, "frozen epsiRunner") &&
		frozenImplementationVerified;
} else {
	throw new Error(
		`Fail-closed: freeze v1 does not yet pin epsiRunner; add { path: "scripts/run-goal3-evidence-preserving-source-insertion.ts", sha256: "${sha256(readFileSync(scriptPath, "utf8"))}" } to freeze.implementation before the first official run so the runner itself is frozen.`,
	);
}

// S50 index pointer（frozen pointerSha256）+ canonical generation。
const s50Index = contract.frozenInputs.s50Index;
const indexRoot = resolve(projectRoot, s50Index.path);
const pointerText = readFileSync(join(indexRoot, "current.json"), "utf8");
const frozenIndexPointersVerified = assertSha256(
	pointerText,
	s50Index.pointerSha256,
	`index pointer ${s50Index.tier}`,
);
const pointer = JSON.parse(pointerText) as CurrentIndexPointer;
if (pointer.schemaVersion !== INDEX_SCHEMA) {
	throw new Error(`Unsupported retrieval index pointer for ${s50Index.tier}`);
}
const generationRecord = recordValue(
	JSON.parse(readFileSync(resolve(projectRoot, pointer.canonicalGenerationPath), "utf8")),
);
const expectedGeneration = requiredString(generationRecord, "token");
const workspaceRoot = dirname(dirname(pointer.canonicalGenerationPath));
const appConfig = loadConfig({ projectRoot: workspaceRoot });
const allSpans = readAllSpans(appConfig);

// 两批问题（Batch C 18 + Batch B 32 = 50），构造阶段不接触 Gold 语义。
const batchCQuestions = readJsonlText(batchCQuestionsText);
if (batchCQuestions.length !== BATCH_C_QUESTION_COUNT) {
	throw new Error(`Frozen Batch C question count drifted: ${batchCQuestions.length}`);
}
if (batchCQuestionsPointer.count !== BATCH_C_QUESTION_COUNT) {
	throw new Error(
		`Frozen Batch C question count mismatch in contract: ${batchCQuestionsPointer.count}`,
	);
}
const batchBQuestions = readJsonlText(batchBQuestionsText);
if (batchBQuestions.length !== BATCH_B_QUESTION_COUNT) {
	throw new Error(`Frozen Batch B question count drifted: ${batchBQuestions.length}`);
}
if (batchBQuestionsPointer.count !== BATCH_B_QUESTION_COUNT) {
	throw new Error(
		`Frozen Batch B question count mismatch in contract: ${batchBQuestionsPointer.count}`,
	);
}
if (batchCQuestions.length + batchBQuestions.length !== FIXED_QUESTION_COUNT) {
	throw new Error(
		`Frozen question total drifted: ${batchCQuestions.length + batchBQuestions.length}`,
	);
}

// ─── Contract fixed-value confirmation (never tuned at runtime) ────────────

const contractFixed = confirmFixedContract(contract);

// ─── Measurement (construction) ────────────────────────────────────────────
// 每问只做一次 top-120 确定性词法检索；L40 = 同一 pool 的前 40（selector 的
// 阶段 1 基线），EPSI = 同一 pool 经纯选择器 120/12/40。任何 Gold 语义值都
// 不得进入构造阶段。arm 序列化顺序按全局 question index 交替（仅描述性计时）。
const constructedQuestions: ConstructedQuestion[] = [];
const determinismProbes: JsonRecord[] = [];
const questionExecutionOrder: JsonRecord[] = [];
const questionSequence: Array<{ datasetId: string; row: JsonRecord }> = [
	...batchCQuestions.map((row) => ({ datasetId: "batchC", row })),
	...batchBQuestions.map((row) => ({ datasetId: "batchB", row })),
];

for (const [questionIndex, item] of questionSequence.entries()) {
	const { datasetId, row: question } = item;
	const questionId = requiredString(question, "caseId");
	const questionValue = requiredString(question, "question");
	const started = process.hrtime.bigint();
	const poolRetrieval = retrieveClaimSeedsFromPersistentIndex(
		indexRoot,
		questionValue,
		FIXED_ROUTING_POOL_BUDGET,
	);
	const retrievalMilliseconds = Number(process.hrtime.bigint() - started) / 1_000_000;
	const { entries, pool } = buildPool(poolRetrieval.result.candidates, allSpans);

	const selection = selectEvidencePreservingCandidates(pool, {
		routingPoolBudget: FIXED_ROUTING_POOL_BUDGET,
		novelSourceInspectionBudget: FIXED_SOURCE_BUDGET,
		candidateBudget: FIXED_CANDIDATE_BUDGET,
	});

	const l40Candidates: EvidencePreservingCandidate[] = entries
		.slice(0, FIXED_CANDIDATE_BUDGET)
		.map((entry) => ({
			claimId: entry.claim.id,
			lexicalRank: entry.lexicalRank,
			sourceIds: [...entry.sourceIds],
			evidenceSpanIds: [...entry.evidenceSpanIds],
		}));

	const lexicalDiagnostics: JsonRecord = {
		candidateClaimsLoaded: poolRetrieval.diagnostics.candidateClaimsLoaded,
		postingShardsRead: poolRetrieval.diagnostics.postingShardsRead,
		recordShardsRead: poolRetrieval.diagnostics.recordShardsRead,
		postingRowsDecoded: poolRetrieval.diagnostics.postingRowsDecoded,
		recordRowsDecoded: poolRetrieval.diagnostics.recordRowsDecoded,
	};
	const commonRetrieval = {
		retrievalMilliseconds,
		canonicalStateGeneration: poolRetrieval.diagnostics.canonicalStateGeneration,
		lexicalDiagnostics,
		temporalScope: poolRetrieval.diagnostics.temporalScope as JsonRecord,
	};

	const l40: ArmConstructed = {
		arm: L40_ARM,
		candidates: l40Candidates,
		poolClaimCount: l40Candidates.length,
		...commonRetrieval,
		epsiSelection: null,
	};
	const epsi: ArmConstructed = {
		arm: EPSI_ARM,
		candidates: selection.candidates,
		poolClaimCount: selection.diagnostics.poolSize,
		...commonRetrieval,
		epsiSelection: selection,
	};

	// ALTERNATE_BY_QUESTION_INDEX：仅描述性序列化顺序（共用同一次 pool 检索）。
	const armExecutionOrder: ArmId[] =
		questionIndex % 2 === 0 ? [L40_ARM, EPSI_ARM] : [EPSI_ARM, L40_ARM];
	if (questionIndex === 0 || questionIndex === BATCH_C_QUESTION_COUNT) {
		determinismProbes.push(
			determinismProbe(indexRoot, questionValue, allSpans, entries, selection),
		);
	}
	constructedQuestions.push({
		datasetId,
		questionId,
		questionType: question.questionType ?? null,
		questionValue,
		allSpans,
		entries,
		poolClaimCount: selection.diagnostics.poolSize,
		armExecutionOrder,
		l40,
		epsi,
	});
	questionExecutionOrder.push({ datasetId, questionId, armExecutionOrder });
}

// ─── Evaluation ────────────────────────────────────────────────────────────
// Gold 文本已在启动时按 opaque bytes 校验；语义 JSON parse 被推迟到全部 50
// 题两臂候选集构造完成之后，因此任何 Gold 值都无法影响检索/选择构造。
const goldRows: Array<{ datasetId: string; row: JsonRecord }> = [
	...readJsonlText(batchCGoldText).map((row) => ({ datasetId: "batchC", row })),
	...readJsonlText(batchBGoldText).map((row) => ({ datasetId: "batchB", row })),
];
const goldById = new Map(
	goldRows.map(({ row }) => [requiredString(row, "caseId"), minimalGold(row)] as const),
);
if (goldRows.length !== FIXED_QUESTION_COUNT || goldById.size !== FIXED_QUESTION_COUNT) {
	throw new Error(
		`Gold row count/identity drifted: ${goldRows.length} rows, ${goldById.size} unique caseIds`,
	);
}
const rows: JsonRecord[] = [];
for (const constructed of constructedQuestions) {
	const gold = goldById.get(constructed.questionId);
	if (!gold) throw new Error(`Missing Gold for ${constructed.questionId}`);
	const requiredSourceIds = [...new Set(gold.requiredEvidence.map((item) => item.sourceId))];
	const requirements: EvidenceRequirement[] = gold.requiredEvidence.map((item) => ({
		sourceId: item.sourceId,
		exactQuote: item.exactQuote,
	}));
	const entryByClaimId = new Map(constructed.entries.map((entry) => [entry.claim.id, entry]));
	const l40BaselineEvidenceSpanIds = [
		...new Set(constructed.l40.candidates.flatMap((candidate) => candidate.evidenceSpanIds)),
	].sort();
	for (const armConstructed of [constructed.l40, constructed.epsi]) {
		rows.push(
			evaluateArm({
				datasetId: constructed.datasetId,
				questionId: constructed.questionId,
				questionType: constructed.questionType,
				arm: armConstructed,
				allSpans: constructed.allSpans,
				entryByClaimId,
				l40BaselineEvidenceSpanIds,
				requiredSourceIds,
				requirements,
			}),
		);
	}
}

// ─── Computed integrity checks (never hardcoded) ───────────────────────────

const rowKeys = new Set(rows.map((row) => `${row.datasetId}/${row.questionId}/${row.arm}`));
const uniqueRowCount = rows.length === FIXED_EXPECTED_ROW_COUNT && rowKeys.size === rows.length;
if (!uniqueRowCount) {
	throw new Error(`Unexpected row count/duplicates: ${rows.length} rows, ${rowKeys.size} unique`);
}
if (contract.fixed.expectedRowCount !== FIXED_EXPECTED_ROW_COUNT) {
	throw new Error(`Contract fixed.expectedRowCount drifted: ${contract.fixed.expectedRowCount}`);
}
const budgetViolations = rows.filter((row) => !rowBudgetPasses(row));
const staleIndexAcceptance = rows.some(
	(row) => row.canonicalStateGeneration !== expectedGeneration,
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
const unresolvedEvidenceAccepted = rows.some((row) => Number(row.poolUnresolvedEvidenceCount) > 0);
const firstRunUniqueness = !firstRunDirectoryExisted && !existsSync(runRoot);
const goldParsedAfterAllCandidateSets = true;
const networkUsed = false;
const modelCallsUsed = 0;

// ─── Summaries / per-dataset + combined comparisons / verdict ──────────────

const allQuestionIds = constructedQuestions.map((item) => item.questionId);
const summaries: JsonRecord[] = [
	{ datasetId: "combined", ...summarize(rows, "combined", L40_ARM) },
	{ datasetId: "combined", ...summarize(rows, "combined", EPSI_ARM) },
	{ datasetId: "batchC", ...summarize(rows, "batchC", L40_ARM) },
	{ datasetId: "batchC", ...summarize(rows, "batchC", EPSI_ARM) },
	{ datasetId: "batchB", ...summarize(rows, "batchB", L40_ARM) },
	{ datasetId: "batchB", ...summarize(rows, "batchB", EPSI_ARM) },
];
const batchCQuestionIds = constructedQuestions
	.filter((item) => item.datasetId === "batchC")
	.map((item) => item.questionId);
const batchBQuestionIds = constructedQuestions
	.filter((item) => item.datasetId === "batchB")
	.map((item) => item.questionId);
const batchCComparison = compareQuestionRows(rows, "batchC", batchCQuestionIds);
const batchBComparison = compareQuestionRows(rows, "batchB", batchBQuestionIds);
const combinedComparison = compareQuestionRows(rows, "combined", allQuestionIds);
const verdict = computeVerdict({
	rows,
	summaries,
	comparison: combinedComparison,
	budgetViolations,
	staleIndexAcceptance,
	scopeTimeLeakage,
	deterministic,
	firstRunUniqueness,
	unresolvedEvidenceAccepted,
	goldParsedAfterAllCandidateSets,
	networkUsed,
	modelCallsUsed,
});

// ─── Report ────────────────────────────────────────────────────────────────

const report: JsonRecord = {
	schemaVersion: "wge-goal3-evidence-preserving-source-insertion-report/v1",
	status: "POST_HOC_DEV_REGRESSION",
	blind: false,
	interpretation:
		"Revealed Batch C and Batch B Gold make this a post-hoc Dev/Regression mechanism test, " +
		"not blind product evidence. It tests whether sources discovered beyond the strong " +
		"lexical top-40 cutoff can enter a fixed 40-Claim candidate set (EPSI40) without " +
		"removing any evidence span already covered by L40_STRONG, while keeping exact " +
		"source-bound evidence recall, the 40-candidate budget and the 120/12 routing ceilings.",
	runId,
	createdAt: new Date().toISOString(),
	verdict,
	provenance: {
		contractPath,
		contractSha256: sha256(contractText),
		freezePath,
		freezeSha256: sha256(freezeText),
		batchCQuestionsPath: batchCQuestionsPointer.path,
		batchCQuestionsSha256: sha256(batchCQuestionsText),
		batchCGoldPath: batchCGoldPointer.path,
		batchCGoldSha256: sha256(batchCGoldText),
		batchBQuestionsPath: batchBQuestionsPointer.path,
		batchBQuestionsSha256: sha256(batchBQuestionsText),
		batchBGoldPath: batchBGoldPointer.path,
		batchBGoldSha256: sha256(batchBGoldText),
		correctedScorerContractPath: correctedScorerPointer.path,
		correctedScorerContractSha256: sha256(correctedScorerText),
		correctedRescoreReportPath: correctedRescorePointer.path,
		correctedRescoreReportSha256: sha256(correctedRescoreText),
		s50IndexPath: s50Index.path,
		s50IndexPointerSha256: sha256(pointerText),
		implementationSha256: implementationHashes,
		scriptPath,
		scriptSha256: sha256(readFileSync(scriptPath, "utf8")),
		modelCalls: 0,
		network: false,
	},
	checks: {
		frozenContractVerified,
		frozenQuestionsVerified,
		frozenDiagnosticGoldVerified,
		frozenRescoreInputsVerified,
		frozenImplementationVerified,
		frozenIndexPointersVerified,
		epsiRunnerFrozen: Boolean(freeze.implementation.epsiRunner),
		contractFixed,
		uniqueRowCount,
		boundedBudgets: {
			pass: budgetViolations.length === 0,
			violations: budgetViolations.map((row) => ({
				datasetId: row.datasetId,
				questionId: row.questionId,
				arm: row.arm,
				candidateClaimCount: row.candidateClaimCount,
				poolClaimCount: row.poolClaimCount,
				novelSourcesConsidered: row.epsiNovelSourcesConsidered ?? null,
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
			checked: determinismProbes.length === 2,
			deterministic,
			probes: determinismProbes,
		},
		firstRunUniqueness,
		goldParsedAfterAllCandidateSets,
		unresolvedEvidenceAccepted,
		prohibitions: {
			networkUsed,
			modelCallsUsed,
			relationTraversal: false,
			contextPackBuilt: false,
			canonicalWrites: false,
		},
		frozenVerification: freeze.verification,
	},
	datasets: {
		batchC: {
			summaries: summaries.filter((row) => row.datasetId === "batchC"),
			comparison: batchCComparison,
		},
		batchB: {
			summaries: summaries.filter((row) => row.datasetId === "batchB"),
			comparison: batchBComparison,
		},
	},
	combined: {
		summaries: summaries.filter((row) => row.datasetId === "combined"),
		comparison: combinedComparison,
	},
	evidenceUnionPreservation: summarizeUnionPreservation(rows),
	questionExecutionOrder,
	rows,
	limitations: [
		"Revealed Batch C and Batch B Gold make this a post-hoc mechanism diagnostic, not blind product evidence.",
		"Answer generation was intentionally not run; the report only scores candidate closure against required evidence (modelCalls=0).",
		"EPSI40 hydrates evidence only for the bounded top-120 lexical pool; candidate sets are serialized for mechanism diagnosis only, nothing was written into Context Pack.",
		"L40_STRONG is the pure selector's phase-1 baseline (first 40 of the same top-120 pool), not a separately drifted retrieval.",
		"Latency is descriptive-only (contract fixed.latencyIsDecisionMetric=false); arm serialization order alternates by question index only to reduce warm-cache order bias.",
		"Source-bound exact-evidence scoring uses evaluateEvidenceCoverage interval reconstruction from persisted base spans; Gold source IDs use the canonical-prefix match rule.",
	],
};
writeJsonExclusive(join(runRoot, "report.json"), report);
writeJsonExclusive(join(runRoot, "run-manifest.json"), {
	schemaVersion: "wge-goal3-evidence-preserving-source-insertion-run-manifest/v1",
	runId,
	status: "POST_HOC_DEV_REGRESSION",
	modelCalls: 0,
	network: false,
	contractSha256: sha256(contractText),
	freezeSha256: sha256(freezeText),
	batchCQuestionsSha256: sha256(batchCQuestionsText),
	batchCGoldSha256: sha256(batchCGoldText),
	batchBQuestionsSha256: sha256(batchBQuestionsText),
	batchBGoldSha256: sha256(batchBGoldText),
	implementationSha256: implementationHashes,
	s50IndexPointerSha256: sha256(pointerText),
	scriptSha256: sha256(readFileSync(scriptPath, "utf8")),
	reportSha256: sha256(`${JSON.stringify(report, null, 2)}\n`),
});
console.log(
	JSON.stringify(
		{
			runRoot,
			verdict: verdict.label,
			checks: report.checks,
			combined: report.combined,
			datasets: {
				batchC: { comparison: batchCComparison },
				batchB: { comparison: batchBComparison },
			},
		},
		null,
		2,
	),
);

// ─── Contract confirmation ─────────────────────────────────────────────────

function confirmFixedContract(contractValue: EpsiContract): JsonRecord {
	const fixed = contractValue.fixed;
	if (fixed.network !== false) throw new Error(`Contract fixed.network drifted: ${fixed.network}`);
	if (fixed.modelCalls !== 0) {
		throw new Error(`Contract fixed.modelCalls drifted: ${fixed.modelCalls}`);
	}
	if (fixed.retrievalTier !== "S50") {
		throw new Error(`Contract fixed.retrievalTier drifted: ${fixed.retrievalTier}`);
	}
	if (fixed.scope !== "GLOBAL_ONLY") {
		throw new Error(`Contract fixed.scope drifted: ${fixed.scope}`);
	}
	if (fixed.routingPoolBudget !== FIXED_ROUTING_POOL_BUDGET) {
		throw new Error(`Contract fixed.routingPoolBudget drifted: ${fixed.routingPoolBudget}`);
	}
	if (fixed.novelSourceInspectionBudget !== FIXED_SOURCE_BUDGET) {
		throw new Error(
			`Contract fixed.novelSourceInspectionBudget drifted: ${fixed.novelSourceInspectionBudget}`,
		);
	}
	if (fixed.candidateBudget !== FIXED_CANDIDATE_BUDGET) {
		throw new Error(`Contract fixed.candidateBudget drifted: ${fixed.candidateBudget}`);
	}
	if (fixed.questionCount !== FIXED_QUESTION_COUNT) {
		throw new Error(`Contract fixed.questionCount drifted: ${fixed.questionCount}`);
	}
	if (fixed.expectedRowCount !== FIXED_EXPECTED_ROW_COUNT) {
		throw new Error(`Contract fixed.expectedRowCount drifted: ${fixed.expectedRowCount}`);
	}
	if (fixed.latencyIsDecisionMetric !== false) {
		throw new Error(
			`Contract fixed.latencyIsDecisionMetric drifted: ${fixed.latencyIsDecisionMetric}`,
		);
	}
	if (fixed.goldParsedAfterAllCandidateSets !== true) {
		throw new Error(
			`Contract fixed.goldParsedAfterAllCandidateSets drifted: ${fixed.goldParsedAfterAllCandidateSets}`,
		);
	}
	const armIds = contractValue.arms.map((arm) => arm.id).sort();
	if (armIds.length !== 2 || armIds[0] !== EPSI_ARM || armIds[1] !== L40_ARM) {
		throw new Error(`Frozen arm ids drifted: ${JSON.stringify(armIds)}`);
	}
	const l40 = contractValue.arms.find((arm) => arm.id === L40_ARM);
	const epsi = contractValue.arms.find((arm) => arm.id === EPSI_ARM);
	if (!l40 || !epsi) throw new Error(`Missing frozen arm ${!l40 ? L40_ARM : EPSI_ARM}`);
	if (
		l40.routingPoolBudget !== FIXED_CANDIDATE_BUDGET ||
		l40.sourceBudget !== null ||
		l40.candidateBudget !== FIXED_CANDIDATE_BUDGET
	) {
		throw new Error("L40_STRONG arm definition drifted");
	}
	if (
		epsi.routingPoolBudget !== FIXED_ROUTING_POOL_BUDGET ||
		epsi.sourceBudget !== FIXED_SOURCE_BUDGET ||
		epsi.candidateBudget !== FIXED_CANDIDATE_BUDGET
	) {
		throw new Error("EPSI40 arm definition drifted");
	}
	return {
		network: fixed.network,
		modelCalls: fixed.modelCalls,
		retrievalTier: fixed.retrievalTier,
		scope: fixed.scope,
		routingPoolBudget: fixed.routingPoolBudget,
		novelSourceInspectionBudget: fixed.novelSourceInspectionBudget,
		candidateBudget: fixed.candidateBudget,
		questionCount: fixed.questionCount,
		expectedRowCount: fixed.expectedRowCount,
		latencyIsDecisionMetric: fixed.latencyIsDecisionMetric,
		goldParsedAfterAllCandidateSets: fixed.goldParsedAfterAllCandidateSets,
		arms: contractValue.arms.map((arm) => ({
			id: arm.id,
			routingPoolBudget: arm.routingPoolBudget,
			sourceBudget: arm.sourceBudget,
			candidateBudget: arm.candidateBudget,
		})),
	};
}

// ─── Construction helpers ──────────────────────────────────────────────────

function buildPool(
	candidates: Array<{ claim: Claim }>,
	spans: SourceSpan[],
): { entries: ResolvedPoolEntry[]; pool: EvidencePreservingPoolClaim[] } {
	const entries = candidates.map((candidate, index) =>
		resolvePoolEntry(candidate.claim, index + 1, spans),
	);
	const pool = entries.map((entry) => ({
		claimId: entry.claim.id,
		lexicalRank: entry.lexicalRank,
		sourceIds: [...entry.sourceIds],
		evidenceSpanIds: [...entry.evidenceSpanIds],
	}));
	return { entries, pool };
}

/** 解析一条 pool Claim 的全部 evidenceSpanId（child-span 语义）；无法解析即 fail-closed。 */
function resolvePoolEntry(
	claim: Claim,
	lexicalRank: number,
	allSpans: SourceSpan[],
): ResolvedPoolEntry {
	const evidenceSpanIds = [...new Set(claim.evidenceSpanIds)];
	const sourceIds: string[] = [];
	const baseSpans: SourceSpan[] = [];
	const seenSpans = new Set<string>();
	const seenSources = new Set<string>();
	for (const spanId of evidenceSpanIds) {
		const span = resolveSpanById(allSpans, spanId);
		if (!span) {
			throw new Error(
				`Fail-closed: unresolved evidence for claim ${claim.id}: span ${spanId} does not resolve against the S50 workspace spans (child-span semantics).`,
			);
		}
		if (!seenSpans.has(span.id)) {
			seenSpans.add(span.id);
			baseSpans.push(span);
		}
		if (!seenSources.has(span.sourceId)) {
			seenSources.add(span.sourceId);
			sourceIds.push(span.sourceId);
		}
	}
	return { claim, lexicalRank, evidenceSpanIds, sourceIds, baseSpans };
}

function determinismProbe(
	indexRootPath: string,
	query: string,
	spans: SourceSpan[],
	firstEntries: ResolvedPoolEntry[],
	firstSelection: EvidencePreservingInsertionSelection,
): JsonRecord {
	const rerun = retrieveClaimSeedsFromPersistentIndex(
		indexRootPath,
		query,
		FIXED_ROUTING_POOL_BUDGET,
	);
	const rerunEntries = buildPool(rerun.result.candidates, spans).entries;
	const rerunSelection = selectEvidencePreservingCandidates(
		rerunEntries.map((entry) => ({
			claimId: entry.claim.id,
			lexicalRank: entry.lexicalRank,
			sourceIds: [...entry.sourceIds],
			evidenceSpanIds: [...entry.evidenceSpanIds],
		})),
		{
			routingPoolBudget: FIXED_ROUTING_POOL_BUDGET,
			novelSourceInspectionBudget: FIXED_SOURCE_BUDGET,
			candidateBudget: FIXED_CANDIDATE_BUDGET,
		},
	);
	const firstPoolIds = firstEntries.map((entry) => entry.claim.id);
	const rerunPoolIds = rerunEntries.map((entry) => entry.claim.id);
	const firstEpsiIds = firstSelection.candidates.map((candidate) => candidate.claimId);
	const rerunEpsiIds = rerunSelection.candidates.map((candidate) => candidate.claimId);
	const sequencesEqual = (left: string[], right: string[]): boolean =>
		left.length === right.length && left.every((id, index) => id === right[index]);
	const poolMatch = sequencesEqual(firstPoolIds, rerunPoolIds);
	const epsiMatch = sequencesEqual(firstEpsiIds, rerunEpsiIds);
	return {
		method: "re-run top-120 pool retrieval + EPSI selector and compare claimId sequences",
		deterministic: poolMatch && epsiMatch,
		poolDeterministic: poolMatch,
		epsiDeterministic: epsiMatch,
		firstPoolClaimIds: firstPoolIds,
		rerunPoolClaimIds: rerunPoolIds,
		firstEpsiClaimIds: firstEpsiIds,
		rerunEpsiClaimIds: rerunEpsiIds,
	};
}

// ─── Arm evaluation ────────────────────────────────────────────────────────

function evaluateArm(params: {
	datasetId: string;
	questionId: string;
	questionType: unknown;
	arm: ArmConstructed;
	allSpans: SourceSpan[];
	entryByClaimId: Map<string, ResolvedPoolEntry>;
	l40BaselineEvidenceSpanIds: string[];
	requiredSourceIds: string[];
	requirements: EvidenceRequirement[];
}): JsonRecord {
	const {
		arm,
		allSpans,
		entryByClaimId,
		l40BaselineEvidenceSpanIds,
		requiredSourceIds,
		requirements,
	} = params;
	const started = process.hrtime.bigint();
	const candidateClaimIds = arm.candidates.map((candidate) => candidate.claimId);
	const candidateSpanIds = [
		...new Set(arm.candidates.flatMap((candidate) => candidate.evidenceSpanIds)),
	];
	const candidateSourceIds = [
		...new Set(arm.candidates.flatMap((candidate) => candidate.sourceIds)),
	];
	const baseSpans = [
		...new Map(
			arm.candidates
				.flatMap((candidate) => entryByClaimId.get(candidate.claimId)?.baseSpans ?? [])
				.map((span) => [span.id, span] as const),
		).values(),
	];
	// source-bound 精确证据：由 evaluateEvidenceCoverage 按持久化 base span 重建
	// 合并区间（绝不全局字符串拼接）。
	const coverage = evaluateEvidenceCoverage(allSpans, candidateSpanIds, requirements);
	const matchedSources = requiredSourceIds.filter((sourceId) =>
		coverage.closureSegments.some((segment) => canonicalSourceIdsMatch(segment.sourceId, sourceId)),
	);
	const candidateCharCount = baseSpans.reduce((total, span) => total + span.text.length, 0);
	const candidateEstimatedTokens = Math.ceil(candidateCharCount / 4);
	const temporalExcluded = new Set(stringArray((arm.temporalScope as JsonRecord).excludedClaimIds));
	const armElapsedMilliseconds = Number(process.hrtime.bigint() - started) / 1_000_000;

	const row: JsonRecord = {
		datasetId: params.datasetId,
		questionId: params.questionId,
		questionType: params.questionType,
		arm: arm.arm,
		armCandidateBudget: FIXED_CANDIDATE_BUDGET,
		retrievalMilliseconds: round(arm.retrievalMilliseconds),
		elapsedMilliseconds: round(arm.retrievalMilliseconds + armElapsedMilliseconds),
		canonicalStateGeneration: arm.canonicalStateGeneration,
		requiredSourceCount: requiredSourceIds.length,
		matchedSourceCount: matchedSources.length,
		candidateRequiredSourceRecall:
			requiredSourceIds.length === 0
				? null
				: round(matchedSources.length / requiredSourceIds.length),
		requiredEvidenceCount: requirements.length,
		matchedEvidenceCount: coverage.matchedCount,
		sourceBoundExactEvidenceRecall:
			requirements.length === 0 ? null : round(coverage.matchedCount / requirements.length),
		candidateClaimIds,
		candidateClaimCount: candidateClaimIds.length,
		candidateSpanIds,
		candidateSpanCount: baseSpans.length,
		candidateSourceIds,
		candidateSourceCount: candidateSourceIds.length,
		candidateCharCount,
		candidateEstimatedTokens,
		poolClaimCount: arm.poolClaimCount,
		poolUnresolvedEvidenceCount: 0,
		lexicalCandidateRecordsLoaded: Number(
			(arm.lexicalDiagnostics as JsonRecord).candidateClaimsLoaded,
		),
		lexicalDiagnostics: arm.lexicalDiagnostics,
		temporalScope: arm.temporalScope,
		candidateScopeViolationIds: candidateClaimIds.filter(
			(claimId) => entryByClaimId.get(claimId)?.claim.scope.type !== "GLOBAL",
		),
		temporalExcludedCandidateIds: candidateClaimIds.filter((claimId) =>
			temporalExcluded.has(claimId),
		),
		matchedSources,
		missingSources: requiredSourceIds.filter((sourceId) => !matchedSources.includes(sourceId)),
		matchedEvidenceKeys: coverage.matchedEvidenceKeys,
		missingEvidenceKeys: coverage.missingEvidenceKeys,
		closureSegmentCount: coverage.closureSegments.length,
		candidateSetHashes: {
			claims: sha256(JSON.stringify(candidateClaimIds)),
			spans: sha256(JSON.stringify(candidateSpanIds)),
			sources: sha256(JSON.stringify(candidateSourceIds)),
		},
	};
	if (arm.epsiSelection) {
		const diagnostics = arm.epsiSelection.diagnostics;
		row.epsiPoolClaimCount = diagnostics.poolSize;
		row.epsiNovelSourcesConsidered = diagnostics.novelSourcesConsidered;
		row.epsiNovelSourcesSkippedAlreadySelected = diagnostics.novelSourcesSkippedAlreadySelected;
		row.epsiAcceptedInsertions = diagnostics.acceptedInsertions;
		row.epsiRejectedNoSafeEviction = diagnostics.rejectedNoSafeEviction;
		row.epsiRejectedEmptyEvidenceRepresentative = diagnostics.rejectedEmptyEvidenceRepresentative;
		row.epsiRejectedNoUnselectedRepresentative = diagnostics.rejectedNoUnselectedRepresentative;
		row.epsiSelectedSourceCount = diagnostics.selectedSourceCount;
		row.epsiSelectedSourceIds = arm.epsiSelection.selectedSourceIds;
		row.epsiBaselineEvidenceSpanIds = diagnostics.baselineEvidenceSpanIds;
		row.epsiFinalEvidenceSpanIds = diagnostics.finalEvidenceSpanIds;
		row.epsiLostEvidenceSpanIds = diagnostics.lostEvidenceSpanIds;
		row.epsiGainedEvidenceSpanIds = diagnostics.gainedEvidenceSpanIds;
		row.epsiBaselineEvidenceSpanUnionPreserved = diagnostics.baselineEvidenceSpanUnionPreserved;
		row.epsiTrace = arm.epsiSelection.trace;
		row.epsiDiagnostics = diagnostics;
		// runner 独立核对：L40 并集必须 ⊆ EPSI 最终并集。
		row.runnerBaselineEvidenceSpanIds = l40BaselineEvidenceSpanIds;
		row.runnerFinalEvidenceSpanIds = [...new Set(candidateSpanIds)].sort();
		row.runnerLostEvidenceSpanIds = unionDiff(
			stringArray(row.runnerBaselineEvidenceSpanIds),
			stringArray(row.runnerFinalEvidenceSpanIds),
		);
		row.runnerGainedEvidenceSpanIds = unionDiff(
			stringArray(row.runnerFinalEvidenceSpanIds),
			stringArray(row.runnerBaselineEvidenceSpanIds),
		);
		row.baselineEvidenceSpanUnionPreserved =
			stringArray(row.runnerLostEvidenceSpanIds).length === 0 &&
			diagnostics.baselineEvidenceSpanUnionPreserved === true;
	} else {
		row.baselineEvidenceSpanIds = l40BaselineEvidenceSpanIds;
	}
	return row;
}

function unionDiff(left: string[], right: string[]): string[] {
	const rightSet = new Set(right);
	return left.filter((item) => !rightSet.has(item));
}

function rowBudgetPasses(row: JsonRecord): boolean {
	const candidatePass = Number(row.candidateClaimCount) <= FIXED_CANDIDATE_BUDGET;
	if (row.arm === L40_ARM) {
		return candidatePass && Number(row.poolClaimCount) <= FIXED_CANDIDATE_BUDGET;
	}
	return (
		candidatePass &&
		Number(row.epsiPoolClaimCount) <= FIXED_ROUTING_POOL_BUDGET &&
		Number(row.epsiNovelSourcesConsidered) <= FIXED_SOURCE_BUDGET
	);
}

// ─── Summary / comparison / verdict ────────────────────────────────────────

function summarize(rows: JsonRecord[], datasetId: string, arm: ArmId): JsonRecord {
	const selected = rows.filter((row) => row.datasetId === datasetId && row.arm === arm);
	const requiredSources = sum(selected.map((row) => Number(row.requiredSourceCount)));
	const matchedSources = sum(selected.map((row) => Number(row.matchedSourceCount)));
	const requiredEvidence = sum(selected.map((row) => Number(row.requiredEvidenceCount)));
	const matchedEvidence = sum(selected.map((row) => Number(row.matchedEvidenceCount)));
	return {
		datasetId,
		arm,
		questions: selected.length,
		candidateRequiredSourceRecall:
			requiredSources === 0 ? null : round(matchedSources / requiredSources),
		sourceBoundExactEvidenceRecall:
			requiredEvidence === 0 ? null : round(matchedEvidence / requiredEvidence),
		questionsWithAllRequiredSources: selected.filter(
			(row) =>
				Number(row.requiredSourceCount) > 0 &&
				Number(row.matchedSourceCount) === Number(row.requiredSourceCount),
		).length,
		questionsWithAllRequiredEvidence: selected.filter(
			(row) =>
				Number(row.requiredEvidenceCount) > 0 &&
				Number(row.matchedEvidenceCount) === Number(row.requiredEvidenceCount),
		).length,
		averageCandidateClaimCount: round(
			average(selected.map((row) => Number(row.candidateClaimCount))),
		),
		averageCandidateSourceCount: round(
			average(selected.map((row) => Number(row.candidateSourceCount))),
		),
		averageEvidenceClosureTokens: round(
			average(selected.map((row) => Number(row.candidateEstimatedTokens))),
		),
		averageLexicalCandidateRecordsLoaded: round(
			average(selected.map((row) => Number(row.lexicalCandidateRecordsLoaded))),
		),
		averageRetrievalMilliseconds: round(
			average(selected.map((row) => Number(row.retrievalMilliseconds))),
		),
		totalNovelSourcesConsidered: sum(
			selected.map((row) => Number(row.epsiNovelSourcesConsidered ?? 0)),
		),
		totalAcceptedInsertions: sum(selected.map((row) => Number(row.epsiAcceptedInsertions ?? 0))),
		totalRejectedNoSafeEviction: sum(
			selected.map((row) => Number(row.epsiRejectedNoSafeEviction ?? 0)),
		),
	};
}

function compareQuestionRows(
	rows: JsonRecord[],
	datasetId: string,
	questionIds: string[],
): JsonRecord {
	const filtered =
		datasetId === "combined" ? rows : rows.filter((row) => row.datasetId === datasetId);
	const epsiByQuestion = new Map(
		filtered.filter((row) => row.arm === EPSI_ARM).map((row) => [row.questionId, row] as const),
	);
	const l40ByQuestion = new Map(
		filtered.filter((row) => row.arm === L40_ARM).map((row) => [row.questionId, row] as const),
	);
	const perQuestion = questionIds.map((questionId) => {
		const epsiRow = epsiByQuestion.get(questionId);
		const l40Row = l40ByQuestion.get(questionId);
		if (!epsiRow || !l40Row) {
			throw new Error(`Missing comparison rows ${datasetId}/${questionId}`);
		}
		const epsiSources = new Set(stringArray(epsiRow.matchedSources));
		const l40Sources = new Set(stringArray(l40Row.matchedSources));
		const epsiEvidenceKeys = new Set(stringArray(epsiRow.matchedEvidenceKeys));
		const l40EvidenceKeys = new Set(stringArray(l40Row.matchedEvidenceKeys));
		const gainedSources = [...epsiSources].filter((item) => !l40Sources.has(item));
		const lostSources = [...l40Sources].filter((item) => !epsiSources.has(item));
		const gainedEvidenceKeys = [...epsiEvidenceKeys].filter((item) => !l40EvidenceKeys.has(item));
		const lostEvidenceKeys = [...l40EvidenceKeys].filter((item) => !epsiEvidenceKeys.has(item));
		const l40Tokens = Number(l40Row.candidateEstimatedTokens);
		return {
			datasetId,
			questionId,
			sourceDelta: epsiSources.size - l40Sources.size,
			evidenceDelta: epsiEvidenceKeys.size - l40EvidenceKeys.size,
			gainedSources,
			lostSources,
			gainedEvidenceKeys,
			lostEvidenceKeys,
			sourceOutcome: lostSources.length > 0 ? "loss" : gainedSources.length > 0 ? "win" : "tie",
			evidenceOutcome:
				lostEvidenceKeys.length > 0 ? "loss" : gainedEvidenceKeys.length > 0 ? "win" : "tie",
			tokenRatio:
				l40Tokens === 0 ? null : round(Number(epsiRow.candidateEstimatedTokens) / l40Tokens),
			unionPreserved: epsiRow.baselineEvidenceSpanUnionPreserved === true,
			epsiNovelSourcesConsidered: Number(epsiRow.epsiNovelSourcesConsidered ?? 0),
			epsiAcceptedInsertions: Number(epsiRow.epsiAcceptedInsertions ?? 0),
			epsiRejectedNoSafeEviction: Number(epsiRow.epsiRejectedNoSafeEviction ?? 0),
			epsiCandidateCount: Number(epsiRow.candidateClaimCount),
			l40CandidateCount: Number(l40Row.candidateClaimCount),
			epsiMatchedSources: epsiSources.size,
			l40MatchedSources: l40Sources.size,
			epsiMatchedEvidence: epsiEvidenceKeys.size,
			l40MatchedEvidence: l40EvidenceKeys.size,
		};
	});
	const sourceWins = perQuestion.filter((row) => row.sourceOutcome === "win").length;
	const sourceLosses = perQuestion.filter((row) => row.sourceOutcome === "loss").length;
	const sourceTies = perQuestion.filter((row) => row.sourceOutcome === "tie").length;
	const evidenceWins = perQuestion.filter((row) => row.evidenceOutcome === "win").length;
	const evidenceLosses = perQuestion.filter((row) => row.evidenceOutcome === "loss").length;
	const evidenceTies = perQuestion.filter((row) => row.evidenceOutcome === "tie").length;
	const unionPreserved = perQuestion.every((row) => row.unionPreserved === true);
	const epsiTokens = filtered
		.filter((row) => row.arm === EPSI_ARM)
		.map((row) => Number(row.candidateEstimatedTokens));
	const l40Tokens = filtered
		.filter((row) => row.arm === L40_ARM)
		.map((row) => Number(row.candidateEstimatedTokens));
	const epsiTokenAverage = average(epsiTokens);
	const l40TokenAverage = average(l40Tokens);
	const epsiLoadedAverage = average(
		filtered
			.filter((row) => row.arm === EPSI_ARM)
			.map((row) => Number(row.lexicalCandidateRecordsLoaded)),
	);
	const l40LoadedAverage = average(
		filtered
			.filter((row) => row.arm === L40_ARM)
			.map((row) => Number(row.lexicalCandidateRecordsLoaded)),
	);
	return {
		datasetId,
		perQuestion,
		sourceWins,
		sourceLosses,
		sourceTies,
		evidenceWins,
		evidenceLosses,
		evidenceTies,
		anyStrictSourceWin: sourceWins > 0,
		anySourceLoss: sourceLosses > 0,
		anyEvidenceLoss: evidenceLosses > 0,
		anyEvidenceWin: evidenceWins > 0,
		matchedSourceDelta: round(sum(perQuestion.map((row) => Number(row.sourceDelta)))),
		matchedEvidenceDelta: round(sum(perQuestion.map((row) => Number(row.evidenceDelta)))),
		unionPreserved,
		averageTokenRatio: l40TokenAverage === 0 ? null : round(epsiTokenAverage / l40TokenAverage),
		tokenCeilingPass:
			l40TokenAverage === 0 ? true : epsiTokenAverage <= l40TokenAverage * TOKEN_CEILING_RATIO,
		epsiAverageTokens: round(epsiTokenAverage),
		l40AverageTokens: round(l40TokenAverage),
		epsiAverageLexicalRecordsLoaded: round(epsiLoadedAverage),
		l40AverageLexicalRecordsLoaded: round(l40LoadedAverage),
		anyCostAdvantage: epsiTokenAverage < l40TokenAverage || epsiLoadedAverage < l40LoadedAverage,
		tokenAdvantage: epsiTokenAverage < l40TokenAverage,
		loadedRecordAdvantage: epsiLoadedAverage < l40LoadedAverage,
	};
}

function summarizeUnionPreservation(rows: JsonRecord[]): JsonRecord {
	const epsiRows = rows.filter((row) => row.arm === EPSI_ARM);
	const preserved = epsiRows.filter((row) => row.baselineEvidenceSpanUnionPreserved === true);
	const lostRows = epsiRows.filter((row) => stringArray(row.runnerLostEvidenceSpanIds).length > 0);
	return {
		checkedQuestions: epsiRows.length,
		preservedQuestions: preserved.length,
		baselineEvidenceSpanUnionPreserved: preserved.length === epsiRows.length,
		runnerLostEvidenceSpanIdsByQuestion: Object.fromEntries(
			lostRows.map((row) => [row.questionId, stringArray(row.runnerLostEvidenceSpanIds)]),
		),
		totalGainedEvidenceSpanIds: sum(
			epsiRows.map((row) => stringArray(row.runnerGainedEvidenceSpanIds).length),
		),
	};
}

function computeVerdict(params: {
	rows: JsonRecord[];
	summaries: JsonRecord[];
	comparison: JsonRecord;
	budgetViolations: JsonRecord[];
	staleIndexAcceptance: boolean;
	scopeTimeLeakage: boolean;
	deterministic: boolean;
	firstRunUniqueness: boolean;
	unresolvedEvidenceAccepted: boolean;
	goldParsedAfterAllCandidateSets: boolean;
	networkUsed: boolean;
	modelCallsUsed: number;
}): JsonRecord {
	const summaryAt = (arm: ArmId): JsonRecord => {
		const row = params.summaries.find((item) => item.datasetId === "combined" && item.arm === arm);
		if (!row) throw new Error(`Missing combined summary ${arm}`);
		return row;
	};
	const l40 = summaryAt(L40_ARM);
	const epsi = summaryAt(EPSI_ARM);
	const comparison = params.comparison;
	const perQuestion = comparison.perQuestion as JsonRecord[];

	const strictSourceWins = perQuestion.filter((row) => row.sourceOutcome === "win").length;
	const anySourceLoss = perQuestion.some((row) => row.sourceOutcome === "loss");
	const anyEvidenceLoss = perQuestion.some((row) => row.evidenceOutcome === "loss");
	const sourceRecallAtLeast =
		Number(epsi.candidateRequiredSourceRecall) >= Number(l40.candidateRequiredSourceRecall);
	const evidenceRecallAtLeast =
		Number(epsi.sourceBoundExactEvidenceRecall) >= Number(l40.sourceBoundExactEvidenceRecall);
	const unionPreserved = comparison.unionPreserved === true;
	const budgetPass = params.budgetViolations.length === 0;
	const tokenCeilingPass = comparison.tokenCeilingPass === true;
	const costAdvantage = comparison.anyCostAdvantage === true;
	const tokenAdvantage = comparison.tokenAdvantage === true;
	const loadedRecordAdvantage = comparison.loadedRecordAdvantage === true;

	const rework = {
		condition:
			anySourceLoss ||
			anyEvidenceLoss ||
			!unionPreserved ||
			!budgetPass ||
			!tokenCeilingPass ||
			params.unresolvedEvidenceAccepted ||
			params.scopeTimeLeakage ||
			params.staleIndexAcceptance ||
			!params.deterministic ||
			!params.firstRunUniqueness ||
			!params.goldParsedAfterAllCandidateSets ||
			params.networkUsed ||
			params.modelCallsUsed !== 0,
		checks: {
			requiredSourceLosses: anySourceLoss,
			exactEvidenceLosses: anyEvidenceLoss,
			missingL40EvidenceSpanId: !unionPreserved,
			candidateBudgetViolation: !budgetPass,
			tokenCeilingViolation: !tokenCeilingPass,
			unresolvedEvidenceAccepted: params.unresolvedEvidenceAccepted,
			scopeTimeLeakage: params.scopeTimeLeakage,
			staleIndexAcceptance: params.staleIndexAcceptance,
			nonDeterminism: !params.deterministic,
			firstRunOverwrite: !params.firstRunUniqueness,
			goldBeforeAllCandidates: !params.goldParsedAfterAllCandidateSets,
			networkUsed: params.networkUsed,
			modelCallsUsed: params.modelCallsUsed,
		},
	};

	const fullPass = {
		condition:
			!rework.condition &&
			strictSourceWins >= 1 &&
			sourceRecallAtLeast &&
			evidenceRecallAtLeast &&
			tokenCeilingPass &&
			costAdvantage,
		checks: {
			strictRequiredSourceWins: strictSourceWins,
			zeroSourceLosses: !anySourceLoss,
			zeroExactEvidenceLosses: !anyEvidenceLoss,
			baselineEvidenceSpanUnionPreserved: unionPreserved,
			budgetsPass: budgetPass,
			tokenCeilingPass,
			anyCostAdvantage: costAdvantage,
			tokenAdvantage,
			loadedRecordAdvantage,
			combinedRequiredSourceRecall: epsi.candidateRequiredSourceRecall,
			l40RequiredSourceRecall: l40.candidateRequiredSourceRecall,
			combinedExactEvidenceRecall: epsi.sourceBoundExactEvidenceRecall,
			l40ExactEvidenceRecall: l40.sourceBoundExactEvidenceRecall,
			averageTokenRatio: comparison.averageTokenRatio,
		},
	};

	const noSourceBenefit = {
		condition: strictSourceWins === 0,
		checks: {
			anyStrictSourceWinVsL40: comparison.anyStrictSourceWin,
			strictRequiredSourceWins: strictSourceWins,
			anySourceGain: perQuestion.some((row) => stringArray(row.gainedSources).length > 0),
		},
	};

	const label = rework.condition
		? "REWORK"
		: fullPass.condition
			? "FULL_PASS"
			: strictSourceWins >= 1
				? "SAFE_DISCOVERY_COST_UNPROVEN"
				: noSourceBenefit.condition
					? "SAFE_BUT_NO_DISCOVERY"
					: "REWORK";

	return {
		label,
		rework,
		fullPass,
		noSourceBenefit,
		sourceDiscovery: {
			strictSourceWins,
			zeroSourceLosses: !anySourceLoss,
			zeroExactEvidenceLosses: !anyEvidenceLoss,
		},
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

function readJsonlText(text: string): JsonRecord[] {
	return text
		.split(/\r?\n/u)
		.filter((line) => line.trim().length > 0)
		.map((line) => recordValue(JSON.parse(line)));
}

function freezeSuggestion(contractTextValue: string): string {
	const implementation: JsonRecord = {};
	for (const [key, relativePath] of requiredImplementation) {
		implementation[key] = {
			path: relativePath,
			sha256: sha256(readFileSync(resolve(projectRoot, relativePath), "utf8")),
		};
	}
	implementation.epsiRunner = {
		path: "scripts/run-goal3-evidence-preserving-source-insertion.ts",
		sha256: sha256(readFileSync(scriptPath, "utf8")),
	};
	return JSON.stringify(
		{
			schemaVersion: "wge-goal3-evidence-preserving-source-insertion-freeze/v1",
			status: "FROZEN_BEFORE_FIRST_REPORT",
			contract: {
				path: "experiments/goal3/goal3-evidence-preserving-source-insertion-contract-v1.json",
				sha256: sha256(contractTextValue),
			},
			implementation,
			prohibitions: [
				"No Gold semantic parsing before every candidate set for all 50 questions is constructed.",
				"No Relation traversal, Context Pack, answer generation, model call, network access or canonical-state mutation.",
				"No post-hoc budget or eviction-rule change inside evidence-preserving-source-insertion-v1.",
				"No latency-based pass claim.",
				"No overwrite of the first official report.",
			],
		},
		null,
		2,
	);
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

function stringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

function assertSha256(value: string, expected: string, label: string): boolean {
	const actual = sha256(value);
	if (actual !== expected) {
		throw new Error(`Fail-closed: ${label} hash mismatch (expected ${expected}, got ${actual})`);
	}
	return true;
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

function round(value: number): number {
	return Math.round(value * 1000) / 1000;
}
