/**
 * Goal 3-B2 breadth source-routing diagnostic (contract v1, freeze v1).
 *
 * Batch B cross-domain breadth runner: mechanically adapted from
 * scripts/run-goal3-source-routing.ts. Compares two frozen candidate arms —
 * pure top-40 persistent lexical Claim retrieval (L40_STRONG) and bounded
 * source routing (SR12_40: routing pool <=120, <=12 sources, <=40 final
 * candidates) — on revealed Batch B health / history / design questions
 * (32 questions, single tier S50, 64 unique rows).
 *
 * POST_HOC_DEV_REGRESSION, not blind product evidence and not a human Gold
 * benchmark: Batch B labels are model-generated and already available to the
 * project. modelCalls=0, network=false, answers are never generated, no
 * Relation traversal / Context Pack / canonical-state writes.
 *
 * Fail-closed at startup: the breadth freeze file must exist and pin the
 * runner's own hash; the contract, preparation manifest, questions, diagnostic
 * Gold (read as opaque bytes), the S50 index pointer and the three frozen
 * implementation files are all re-verified before any measurement. Gold
 * semantics are never JSON-parsed until every candidate set for all 32
 * questions (both arms) is constructed in memory, so no Gold value can
 * influence retrieval construction.
 *
 * Arms execute in ALTERNATE_BY_QUESTION_INDEX order (even question index
 * starts with L40_STRONG, odd with SR12_40) to reduce warm-cache order bias.
 * Latency remains descriptive-only: it is reported but never used as a
 * verdict advantage (contract fixed.latencyIsDecisionMetric=false). The only
 * BREADTH_FULL_PASS cost advantages are lower average evidence-closure tokens
 * or fewer average lexical candidate records loaded.
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
const DEFAULT_RUN_ID = "source-routing-breadth-v1";
const L40_ARM = "L40_STRONG" as const;
const SR_ARM = "SR12_40" as const;
const FIXED_TIER = "S50" as const;
const FIXED_QUESTION_COUNT = 32;
const FIXED_EXPECTED_ROW_COUNT = 64;
const FIXED_ROUTING_POOL_BUDGET = 120;
const FIXED_SOURCE_BUDGET = 12;
const FIXED_CANDIDATE_BUDGET = 40;
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

interface SourceRoutingBreadthContract {
	schemaVersion: string;
	status: string;
	frozenInputs: {
		gitHead: string;
		dirtyTrackedDiffExcludingLlmLogSha256: string;
		preparationManifest: FrozenFilePointer;
		questions: FrozenQuestionFile;
		diagnosticGold: FrozenQuestionFile;
		index: FrozenIndexPointer;
		implementation: {
			persistentIndex: FrozenFilePointer;
			sourceRouting: FrozenFilePointer;
			sourceRoutingTests: FrozenFilePointer;
		};
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
		tier: string;
		questionCount: number;
		expectedRowCount: number;
		primaryCandidateBudget: number;
		routingPoolBudget: number;
		sourceBudget: number;
		executionOrder: string;
		latencyIsDecisionMetric: boolean;
	};
}

interface SourceRoutingBreadthFreeze {
	schemaVersion: string;
	status: string;
	frozenAt: string;
	contract: FrozenFilePointer;
	implementation: {
		persistentIndex?: FrozenFilePointer;
		sourceRouting?: FrozenFilePointer;
		sourceRoutingTests?: FrozenFilePointer;
		/** 本 runner 完成后由 freeze 追加的自引用哈希；出现即参与 fail-closed 验证。 */
		sourceRoutingBreadthRunner?: FrozenFilePointer;
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
	questionId: string;
	questionType: unknown;
	allSpans: SourceSpan[];
	l40Retrieval: ArmRetrieval;
	srRetrieval: ArmRetrieval;
	/** 本 question 实际执行的 arm 顺序（ALTERNATE_BY_QUESTION_INDEX）。 */
	armExecutionOrder: ArmId[];
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const scriptPath = fileURLToPath(import.meta.url);
const contractPath = join(
	projectRoot,
	"experiments",
	"goal3",
	"goal3-source-routing-breadth-contract-v1.json",
);
const freezePath = join(
	projectRoot,
	"experiments",
	"goal3",
	"goal3-source-routing-breadth-freeze-v1.json",
);
const runId = process.env.WGE_GOAL3_SOURCE_ROUTING_BREADTH_RUN_ID ?? DEFAULT_RUN_ID;
const runRoot = join(projectRoot, "experiments", "goal3", "source-routing-breadth-runs", runId);
const firstRunDirectoryExisted = existsSync(runRoot);
if (firstRunDirectoryExisted) {
	throw new Error(`Refusing to overwrite source-routing-breadth run: ${runRoot}`);
}

// ─── Fail-closed frozen-hash verification ──────────────────────────────────

const contractText = readFileSync(contractPath, "utf8");
if (!existsSync(freezePath)) {
	throw new Error(
		`Fail-closed: breadth freeze v1 not found at ${freezePath}. Create experiments/goal3/goal3-source-routing-breadth-freeze-v1.json before the first official run so the runner itself is frozen, e.g. { "schemaVersion": "wge-goal3-source-routing-breadth-freeze/v1", "status": "FROZEN_BEFORE_FIRST_REPORT", "contract": { "path": "experiments/goal3/goal3-source-routing-breadth-contract-v1.json", "sha256": "${sha256(contractText)}" }, "implementation": { "sourceRoutingBreadthRunner": { "path": "scripts/run-goal3-source-routing-breadth.ts", "sha256": "${sha256(readFileSync(scriptPath, "utf8"))}" } } }`,
	);
}
const freezeText = readFileSync(freezePath, "utf8");
const contract = JSON.parse(contractText) as SourceRoutingBreadthContract;
const freeze = JSON.parse(freezeText) as SourceRoutingBreadthFreeze;

const frozenContractVerified = assertSha256(
	contractText,
	freeze.contract.sha256,
	"contract (vs freeze)",
);
if (resolve(projectRoot, freeze.contract.path) !== contractPath) {
	throw new Error(`Freeze contract path drift: ${freeze.contract.path}`);
}

// 三个冻结输入文件（preparation manifest、questions、diagnostic Gold）在
// 任何测量前按 opaque bytes 校验；Gold 的 JSON parse 被推迟到全部候选集构造完成。
const manifestPointer = contract.frozenInputs.preparationManifest;
const manifestPath = resolve(projectRoot, manifestPointer.path);
const manifestText = readFileSync(manifestPath, "utf8");
const frozenManifestVerified = assertSha256(
	manifestText,
	manifestPointer.sha256,
	`frozen preparation manifest ${manifestPointer.path}`,
);

const questionText = readFileSync(
	resolve(projectRoot, contract.frozenInputs.questions.path),
	"utf8",
);
const goldText = readFileSync(
	resolve(projectRoot, contract.frozenInputs.diagnosticGold.path),
	"utf8",
);
const frozenQuestionsVerified = assertSha256(
	questionText,
	contract.frozenInputs.questions.sha256,
	`frozen questions ${contract.frozenInputs.questions.path}`,
);
const frozenDiagnosticGoldVerified = assertSha256(
	goldText,
	contract.frozenInputs.diagnosticGold.sha256,
	`frozen diagnostic Gold ${contract.frozenInputs.diagnosticGold.path}`,
);

// 三个 implementation 文件 hash 以 contract 冻结输入为准；freeze 中出现的
// 同名条目必须与 contract 交叉一致（fail-closed 防漂移）。
const implementationHashes: JsonRecord = {};
let frozenImplementationVerified = true;
for (const [key, pointer] of Object.entries(contract.frozenInputs.implementation)) {
	if (
		!pointer ||
		typeof pointer.path !== "string" ||
		typeof pointer.sha256 !== "string" ||
		pointer.path.length === 0 ||
		pointer.sha256.length === 0
	) {
		throw new Error(`Contract implementation entry ${key} is not a valid frozen file pointer`);
	}
	const filePath = resolve(projectRoot, pointer.path);
	const fileText = readFileSync(filePath, "utf8");
	frozenImplementationVerified =
		assertSha256(fileText, pointer.sha256, `contract frozen implementation ${pointer.path}`) &&
		frozenImplementationVerified;
	implementationHashes[key] = pointer.sha256;
	const freezePointer =
		freeze.implementation[key as keyof SourceRoutingBreadthFreeze["implementation"]];
	if (freezePointer) {
		if (freezePointer.path !== pointer.path || freezePointer.sha256 !== pointer.sha256) {
			throw new Error(`Freeze implementation entry ${key} drifted from contract`);
		}
		const freezeFilePath = resolve(projectRoot, freezePointer.path);
		if (freezeFilePath !== filePath) {
			throw new Error(`Freeze implementation path drift: ${freezePointer.path}`);
		}
		assertSha256(
			readFileSync(freezeFilePath, "utf8"),
			freezePointer.sha256,
			`frozen implementation ${freezePointer.path}`,
		);
	}
}
const runnerPointer = freeze.implementation.sourceRoutingBreadthRunner;
if (runnerPointer) {
	const runnerPath = resolve(projectRoot, runnerPointer.path);
	if (runnerPath !== scriptPath) {
		throw new Error(`Freeze sourceRoutingBreadthRunner path drift: ${runnerPointer.path}`);
	}
	const runnerFrozenVerified = assertSha256(
		readFileSync(runnerPath, "utf8"),
		runnerPointer.sha256,
		"frozen sourceRoutingBreadthRunner",
	);
	if (!runnerFrozenVerified) {
		throw new Error("Frozen sourceRoutingBreadthRunner verification failed");
	}
} else {
	throw new Error(
		`Fail-closed: breadth freeze v1 does not yet pin sourceRoutingBreadthRunner; add { path: "scripts/run-goal3-source-routing-breadth.ts", sha256: "${sha256(readFileSync(scriptPath, "utf8"))}" } to freeze.implementation before the first official run so the runner itself is frozen.`,
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

// ─── Measurement (construction) ────────────────────────────────────────────
// 单 tier S50。arm 执行顺序按 question index 交替以减轻 warm-cache order
// bias；任何 Gold 语义值都不得进入构造阶段。

const constructedQuestions: ConstructedQuestion[] = [];
const indexPointerHashes: JsonRecord[] = [];
const determinismProbes: JsonRecord[] = [];
const questionExecutionOrder: JsonRecord[] = [];
const expectedCanonicalGenerationByTier = new Map<string, string>();

const tier = contract.frozenInputs.index;
const indexRoot = resolve(projectRoot, tier.path);
const pointerText = readFileSync(join(indexRoot, "current.json"), "utf8");
const frozenIndexPointersVerified = assertSha256(
	pointerText,
	tier.pointerSha256,
	`index pointer ${tier.tier}`,
);
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
	// ALTERNATE_BY_QUESTION_INDEX：偶数 index 先 L40_STRONG，奇数先 SR12_40。
	const armExecutionOrder: ArmId[] =
		questionIndex % 2 === 0 ? [L40_ARM, SR_ARM] : [SR_ARM, L40_ARM];
	const retrievalByArm = new Map<ArmId, ArmRetrieval>();
	for (const arm of armExecutionOrder) {
		retrievalByArm.set(
			arm,
			retrieveQuestionArm({ arm, indexRoot, query: questionValue, limit: primaryCandidateBudget }),
		);
	}
	const l40Retrieval = retrievalByArm.get(L40_ARM);
	const srRetrieval = retrievalByArm.get(SR_ARM);
	if (!l40Retrieval || !srRetrieval) {
		throw new Error(`Missing arm retrieval for ${questionId}`);
	}
	if (questionIndex === 0) {
		determinismProbes.push(determinismProbe(indexRoot, questionValue, srRetrieval));
	}
	constructedQuestions.push({
		questionId,
		questionType: question.questionType ?? null,
		allSpans,
		l40Retrieval,
		srRetrieval,
		armExecutionOrder,
	});
	questionExecutionOrder.push({ questionId, armExecutionOrder });
}

// ─── Evaluation ────────────────────────────────────────────────────────────
// Gold text was hash-verified above as opaque bytes. Semantic JSON parsing is
// deliberately delayed until every candidate set for all 32 questions (both
// arms) is frozen in memory, so no Gold value can influence retrieval
// construction.
const goldRows = readJsonlText(goldText);
if (goldRows.length !== contract.frozenInputs.diagnosticGold.count) {
	throw new Error(`Frozen diagnostic Gold count drifted: ${goldRows.length}`);
}
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
const uniqueRowCount = rows.length === FIXED_EXPECTED_ROW_COUNT && rowKeys.size === rows.length;
if (!uniqueRowCount) {
	throw new Error(`Unexpected row count/duplicates: ${rows.length} rows, ${rowKeys.size} unique`);
}
if (contract.fixed.expectedRowCount !== FIXED_EXPECTED_ROW_COUNT) {
	throw new Error(`Contract fixed.expectedRowCount drifted: ${contract.fixed.expectedRowCount}`);
}
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

// ─── Summaries / comparison / domain breakdown / verdict ───────────────────

const summaries = [L40_ARM, SR_ARM].map((arm) => summarize(rows, FIXED_TIER, arm));
const s50SourceRoutedVsL40 = compareArms(rows, FIXED_TIER, SR_ARM, L40_ARM, questionIds);
const domainBreakdown = computeDomainBreakdown(rows);
const verdict = computeVerdict({
	rows,
	summaries,
	comparison: s50SourceRoutedVsL40,
	budgetViolations,
	staleIndexAcceptance,
	scopeTimeLeakage,
	deterministic,
	firstRunUniqueness,
});

// ─── Report ────────────────────────────────────────────────────────────────

const report: JsonRecord = {
	schemaVersion: "wge-goal3-source-routing-breadth-report/v1",
	status: "POST_HOC_DEV_REGRESSION",
	blind: false,
	interpretation:
		"Batch B labels are model-generated and already available to the project: this is a " +
		"post-hoc cross-domain Dev/Regression diagnostic, not a blind product experiment and " +
		"not a human Gold benchmark. It tests whether the unchanged bounded lexical routing " +
		"pool (SR12_40) generalizes to Batch B health, history and design questions by " +
		"discovering required sources missed by top-40 Claim lexical retrieval (L40_STRONG), " +
		"and whether its exact-quote displacement risk replicates. Latency is reported " +
		"descriptive-only and never used as a verdict advantage.",
	runId,
	createdAt: new Date().toISOString(),
	verdict,
	provenance: {
		contractPath,
		contractSha256: sha256(contractText),
		freezePath,
		freezeSha256: sha256(freezeText),
		preparationManifestPath: manifestPointer.path,
		preparationManifestSha256: sha256(manifestText),
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
		frozenContractVerified,
		frozenManifestVerified,
		frozenQuestionsVerified,
		frozenDiagnosticGoldVerified,
		frozenImplementationVerified,
		frozenIndexPointersVerified,
		sourceRoutingBreadthRunnerFrozen: true,
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
			checked: determinismProbes.length === 1,
			deterministic,
			probes: determinismProbes,
		},
		firstRunUniqueness,
		executionOrder: {
			mode: contract.fixed.executionOrder,
			questionExecutionOrder,
		},
		latencyIsDecisionMetric: contract.fixed.latencyIsDecisionMetric,
		frozenVerification: freeze.verification ?? null,
	},
	summaries,
	s50Comparisons: {
		sourceRoutedVsL40: s50SourceRoutedVsL40,
	},
	domainBreakdown,
	rows,
	limitations: [
		"POST_HOC_DEV_REGRESSION: Batch B labels are model-generated and were already available to the project; this is not blind product evidence and not a human Gold benchmark.",
		"Answer generation was intentionally not run; the report only scores candidate closure against required evidence (modelCalls=0, network=false).",
		"Source-routed candidates are serialized into this report for mechanism diagnosis only; nothing was written into Context Pack.",
		"Execution alternates by question index to reduce warm-cache order bias, but query latency remains descriptive-only and is never a verdict metric (latencyIsDecisionMetric=false).",
		"SR12_40 hydrates evidence only for the bounded lexical routing pool; latency is measured on the persistent v7 index with per-query shard reads and is a mechanism baseline, not a production-scale architecture.",
		"Domain breakdown (HEALTH/HIST/DESIGN parsed from caseId, plus questionType) is a reporting dimension only and never participates in ranking or verdict computation.",
		"Exact-quote matching normalizes evidence text identically to the scale-retrieval, structural-ablation and source-routing runners; child spans are resolved through the same span semantics.",
	],
};
writeJsonExclusive(join(runRoot, "report.json"), report);
writeJsonExclusive(join(runRoot, "run-manifest.json"), {
	schemaVersion: "wge-goal3-source-routing-breadth-run-manifest/v1",
	runId,
	status: "POST_HOC_DEV_REGRESSION",
	modelCalls: 0,
	network: false,
	contractSha256: sha256(contractText),
	freezeSha256: sha256(freezeText),
	preparationManifestSha256: sha256(manifestText),
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

function confirmFixedContract(contract: SourceRoutingBreadthContract): JsonRecord {
	if (contract.fixed.network !== false) {
		throw new Error(`Contract fixed.network drifted: ${String(contract.fixed.network)}`);
	}
	if (contract.fixed.modelCalls !== 0) {
		throw new Error(`Contract fixed.modelCalls drifted: ${String(contract.fixed.modelCalls)}`);
	}
	if (contract.fixed.scope !== "GLOBAL_ONLY") {
		throw new Error(`Contract fixed.scope drifted: ${contract.fixed.scope}`);
	}
	if (contract.fixed.tier !== FIXED_TIER) {
		throw new Error(`Contract fixed.tier drifted: ${contract.fixed.tier}`);
	}
	if (contract.fixed.questionCount !== FIXED_QUESTION_COUNT) {
		throw new Error(`Contract fixed.questionCount drifted: ${contract.fixed.questionCount}`);
	}
	if (contract.fixed.expectedRowCount !== FIXED_EXPECTED_ROW_COUNT) {
		throw new Error(`Contract fixed.expectedRowCount drifted: ${contract.fixed.expectedRowCount}`);
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
	if (contract.fixed.executionOrder !== "ALTERNATE_BY_QUESTION_INDEX") {
		throw new Error(`Contract fixed.executionOrder drifted: ${contract.fixed.executionOrder}`);
	}
	if (contract.fixed.latencyIsDecisionMetric !== false) {
		throw new Error(
			`Contract fixed.latencyIsDecisionMetric drifted: ${String(contract.fixed.latencyIsDecisionMetric)}`,
		);
	}
	const armIds = contract.arms.map((arm) => arm.id).sort();
	assertFixedList(armIds, [L40_ARM, SR_ARM].sort());
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
	if (contract.frozenInputs.index.tier !== FIXED_TIER) {
		throw new Error(`Frozen index tier drifted: ${contract.frozenInputs.index.tier}`);
	}
	return {
		network: contract.fixed.network,
		modelCalls: contract.fixed.modelCalls,
		scope: contract.fixed.scope,
		tier: contract.fixed.tier,
		questionCount: contract.fixed.questionCount,
		expectedRowCount: contract.fixed.expectedRowCount,
		routingPoolBudget: contract.fixed.routingPoolBudget,
		sourceBudget: contract.fixed.sourceBudget,
		primaryCandidateBudget: contract.fixed.primaryCandidateBudget,
		executionOrder: contract.fixed.executionOrder,
		latencyIsDecisionMetric: contract.fixed.latencyIsDecisionMetric,
		arms: contract.arms.map((arm) => ({
			id: arm.id,
			routingPoolBudget: arm.routingPoolBudget,
			sourceBudget: arm.sourceBudget,
			candidateBudget: arm.candidateBudget,
		})),
	};
}

function assertFixedList(actual: string[], expected: string[]): void {
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
		tier: FIXED_TIER,
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

// ─── Summary / comparison / domain breakdown / verdict ─────────────────────

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
		// Latency is descriptive-only (contract fixed.latencyIsDecisionMetric=false):
		// reported for the record, never used as a verdict advantage.
		routedP95Milliseconds: round(routedP95),
		baselineP95Milliseconds: round(baselineP95),
		latencyCeilingMilliseconds: round(Math.max(baselineP95 * 2, baselineP95 + 50)),
		latencyPass: routedP95 <= Math.max(baselineP95 * 2, baselineP95 + 50),
		latencyDescriptiveOnly: true,
	};
}

function computeDomainBreakdown(rows: JsonRecord[]): JsonRecord {
	// 报告维度：caseId 中的 HEALTH / HIST / DESIGN 领域段与 questionType。
	// 仅报告，不参与排序或 verdict 计算。
	const groupDomain = (keyOf: (row: JsonRecord) => string): JsonRecord[] => {
		const groups = new Map<string, JsonRecord[]>();
		for (const row of rows) {
			const key = keyOf(row);
			groups.set(key, [...(groups.get(key) ?? []), row]);
		}
		return [...groups.entries()]
			.map(([domain, group]) => ({ domain, ...aggregateDomain(group) }))
			.sort((left, right) => String(left.domain).localeCompare(String(right.domain)));
	};
	return {
		byDomain: groupDomain((row) => domainFromQuestionId(requiredString(row, "questionId"))),
		byQuestionType: groupDomain((row) => String(row.questionType ?? "unknown")),
	};
}

function domainFromQuestionId(questionId: string): string {
	const parts = questionId.split("-");
	return parts.length >= 4 && parts[2] ? parts[2] : "UNKNOWN";
}

function aggregateDomain(group: JsonRecord[]): JsonRecord {
	const armRows = (arm: string): JsonRecord[] => group.filter((row) => row.arm === arm);
	const armStats = (armRows: JsonRecord[]): JsonRecord => {
		const requiredSources = sum(armRows.map((row) => Number(row.requiredSourceCount)));
		const matchedSources = sum(armRows.map((row) => Number(row.matchedSourceCount)));
		const requiredQuotes = sum(armRows.map((row) => Number(row.requiredQuoteCount)));
		const matchedQuotes = sum(armRows.map((row) => Number(row.matchedQuoteCount)));
		return {
			questions: armRows.length,
			requiredSourceCount: requiredSources,
			matchedSourceCount: matchedSources,
			candidateRequiredSourceRecall:
				requiredSources === 0 ? null : round(matchedSources / requiredSources),
			requiredQuoteCount: requiredQuotes,
			matchedQuoteCount: matchedQuotes,
			candidateRequiredEvidenceQuoteRecall:
				requiredQuotes === 0 ? null : round(matchedQuotes / requiredQuotes),
		};
	};
	const l40Rows = armRows(L40_ARM);
	const srRows = armRows(SR_ARM);
	const pairStats = pairRows(srRows, l40Rows);
	return {
		questions: group.length / 2,
		l40: armStats(l40Rows),
		sr12_40: armStats(srRows),
		perQuestionVsL40: {
			sourceWins: pairStats.sourceWins,
			sourceLosses: pairStats.sourceLosses,
			sourceTies: pairStats.sourceTies,
			quoteWins: pairStats.quoteWins,
			quoteLosses: pairStats.quoteLosses,
			quoteTies: pairStats.quoteTies,
		},
	};
}

function pairRows(routedRows: JsonRecord[], baselineRows: JsonRecord[]): JsonRecord {
	const baselineByQuestion = new Map(baselineRows.map((row) => [row.questionId, row] as const));
	let sourceWins = 0;
	let sourceLosses = 0;
	let sourceTies = 0;
	let quoteWins = 0;
	let quoteLosses = 0;
	let quoteTies = 0;
	for (const routed of routedRows) {
		const baseline = baselineByQuestion.get(requiredString(routed, "questionId"));
		if (!baseline) throw new Error(`Missing domain baseline row for ${routed.questionId}`);
		const routedSources = new Set(stringArray(routed.matchedSources));
		const baselineSources = new Set(stringArray(baseline.matchedSources));
		const routedQuotes = new Set(stringArray(routed.matchedQuotes));
		const baselineQuotes = new Set(stringArray(baseline.matchedQuotes));
		const lostSources = [...baselineSources].filter((item) => !routedSources.has(item));
		const gainedSources = [...routedSources].filter((item) => !baselineSources.has(item));
		const lostQuotes = [...baselineQuotes].filter((item) => !routedQuotes.has(item));
		const gainedQuotes = [...routedQuotes].filter((item) => !baselineQuotes.has(item));
		if (lostSources.length > 0) sourceLosses++;
		else if (gainedSources.length > 0) sourceWins++;
		else sourceTies++;
		if (lostQuotes.length > 0) quoteLosses++;
		else if (gainedQuotes.length > 0) quoteWins++;
		else quoteTies++;
	}
	return { sourceWins, sourceLosses, sourceTies, quoteWins, quoteLosses, quoteTies };
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
}): JsonRecord {
	const summaryAt = (arm: string): JsonRecord => {
		const row = params.summaries.find((item) => item.tier === FIXED_TIER && item.arm === arm);
		if (!row) throw new Error(`Missing summary ${FIXED_TIER}/${arm}`);
		return row;
	};
	const l40 = summaryAt(L40_ARM);
	const sr = summaryAt(SR_ARM);
	const comparison = params.comparison;
	const perQuestion = comparison.perQuestion as JsonRecord[];

	const sourceRecallAtLeast =
		Number(sr.candidateRequiredSourceRecall) >= Number(l40.candidateRequiredSourceRecall);
	const strictSourceWins = perQuestion.filter((row) => row.sourceOutcome === "win").length;
	const anySourceLoss = perQuestion.some((row) => row.sourceOutcome === "loss");
	const anyQuoteLoss = perQuestion.some((row) => row.quoteOutcome === "loss");
	const quoteRecallAtLeast =
		Number(sr.candidateRequiredEvidenceQuoteRecall) >=
		Number(l40.candidateRequiredEvidenceQuoteRecall);
	const tokenCeilingPass =
		Number(sr.averageEvidenceClosureTokens) <=
		Number(l40.averageEvidenceClosureTokens) * TOKEN_CEILING_RATIO;
	// FULL 的成本优势只能是更低 average evidence-closure tokens 或更少 average
	// lexical candidate records loaded；latency 禁止作为 verdict advantage。
	const tokenAdvantage =
		Number(sr.averageEvidenceClosureTokens) < Number(l40.averageEvidenceClosureTokens);
	const loadedRecordAdvantage =
		Number(sr.averageLexicalCandidateClaimsLoaded) <
		Number(l40.averageLexicalCandidateClaimsLoaded);
	const anyCostAdvantage = tokenAdvantage || loadedRecordAdvantage;
	const budgetPass = params.budgetViolations.length === 0;
	const latencyPass = comparison.latencyPass === true;

	const sourcePass = {
		condition: sourceRecallAtLeast && strictSourceWins >= 1 && !anySourceLoss && budgetPass,
		checks: {
			sourceRecallAtLeast,
			strictRequiredSourceWins: strictSourceWins,
			zeroSourceLosses: !anySourceLoss,
			budgetPass,
			sr50RequiredSourceRecall: sr.candidateRequiredSourceRecall,
			l40RequiredSourceRecall: l40.candidateRequiredSourceRecall,
		},
	};

	const fullPass = {
		condition:
			sourcePass.condition &&
			quoteRecallAtLeast &&
			!anyQuoteLoss &&
			tokenCeilingPass &&
			anyCostAdvantage,
		checks: {
			...sourcePass.checks,
			quoteRecallAtLeast,
			zeroQuoteLosses: !anyQuoteLoss,
			tokenCeilingPass,
			anyCostAdvantage,
			tokenAdvantage,
			loadedRecordAdvantage,
			sr50QuoteRecall: sr.candidateRequiredEvidenceQuoteRecall,
			l40QuoteRecall: l40.candidateRequiredEvidenceQuoteRecall,
			averageTokenRatio: comparison.averageTokenRatio,
			// descriptive-only：latency 不参与 anyCostAdvantage。
			latencyDescriptiveOnly: {
				pass: latencyPass,
				routedP95Milliseconds: comparison.routedP95Milliseconds,
				baselineP95Milliseconds: comparison.baselineP95Milliseconds,
				p95LatencyRatio: round(
					Number(comparison.routedP95Milliseconds) /
						Math.max(0.001, Number(comparison.baselineP95Milliseconds)),
				),
			},
		},
	};

	const quoteRiskReplicated = {
		condition: sourcePass.condition && anyQuoteLoss,
		checks: {
			sourcePassPasses: sourcePass.condition,
			anyPerQuestionExactQuoteLoss: anyQuoteLoss,
			quoteLossQuestionIds: perQuestion
				.filter((row) => row.quoteOutcome === "loss")
				.map((row) => row.questionId),
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

	// 优先级（合同 decisionRules）：REWORK > BREADTH_FULL_PASS >
	// QUOTE_RISK_REPLICATED > BREADTH_SOURCE_PASS > NO_SOURCE_BENEFIT。
	// source pass 且无 quote loss 但 full 未过（例如 cost advantage 缺失）时，
	// label 为 BREADTH_SOURCE_PASS。
	const label = rework.condition
		? "REWORK"
		: fullPass.condition
			? "BREADTH_FULL_PASS"
			: quoteRiskReplicated.condition
				? "QUOTE_RISK_REPLICATED"
				: sourcePass.condition
					? "BREADTH_SOURCE_PASS"
					: noSourceBenefit.condition
						? "NO_SOURCE_BENEFIT"
						: "REWORK";

	return {
		label,
		sourcePass,
		fullPass,
		quoteRiskReplicated,
		noSourceBenefit,
		rework,
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
 * Quote normalization MUST stay identical to run-goal3-scale-retrieval.ts,
 * run-goal3-structural-ablation.ts and run-goal3-source-routing.ts so
 * exact-quote matching is comparable.
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

function percentile(values: number[], quantile: number): number {
	if (values.length === 0) return 0;
	return values[Math.min(values.length - 1, Math.ceil(values.length * quantile) - 1)] ?? 0;
}

function round(value: number): number {
	return Math.round(value * 1000) / 1000;
}
