import { createHash } from "node:crypto";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config/index.js";
import { buildContextPackWithDiagnostics } from "../src/context-pack/index.js";
import { applyKnowledgeEvolution } from "../src/evolution/transaction.js";
import { currentKnowledgeVersion } from "../src/evolution/version-store.js";
import {
	readAllClaims,
	readAllSpans,
	readAllWikiModules,
	readWikiModuleQuarantine,
	upsertWikiModules,
} from "../src/linter/storage.js";
import type { SourcePublication } from "../src/linter/storage.js";
import { RELATION_AUDIT_VERSION } from "../src/prompts/index.js";
import type { WikiModule } from "../src/types/index.js";
import { inspectWikiModuleSupport, materializeWikiModule } from "../src/wiki/materialization.js";

const SOURCE_WORKSPACE = join(
	process.cwd(),
	"experiments/evolution/runs/controlled-v1-lineage-v15/workspace",
);

const EPISODES = [
	{
		domain: "commerce-operations",
		affectedQuestionId: "EV-COMM-001",
		affectedQuestion: "普通衣服没有质量问题，签收后最晚多久可以申请无理由退货？",
		unaffectedQuestionId: "EV-COMM-005",
		unaffectedQuestion: "黑卡会员通过 App 专属入口咨询时，十分钟 SLA 具体承诺什么？",
		oldClaimId: "claim:c37706bd82032a13-d5b02410a10adbfa",
		newClaimId: "claim:316dbc8cdd88019f-8541960500c8d50a",
		triggerRelationId: "rel:cross-48d36ccae6315835",
		unaffectedClaimIds: [
			"claim:87efe7de4bfc7b99-4e1c5d4b2cd2143b",
			"claim:87efe7de4bfc7b99-1de7c8ac676988f5",
		],
	},
	{
		domain: "platform-engineering",
		affectedQuestionId: "EV-PLAT-001",
		affectedQuestion: "一个非 P0 生产服务已经通过测试，现在还需要哪些批准，何时可以发布？",
		unaffectedQuestionId: "EV-PLAT-005",
		unaffectedQuestion: "对外开放的 API 下线前需要提前多久发布正式弃用公告？",
		oldClaimId: "claim:64fed77ca832e02c-0717e9642441daaf",
		newClaimId: "claim:674a8aeeebc511a6-008ebbacdbf23400",
		triggerRelationId: "rel:cross-3b73cf563a981df5",
		unaffectedClaimIds: ["claim:56ecc1cabeb423a1-8dd57004f3b9b521"],
	},
	{
		domain: "research-operations",
		affectedQuestionId: "EV-RES-001",
		affectedQuestion: "医疗敏感数据现在能否在获批的公有云机密计算环境中处理？",
		unaffectedQuestionId: "EV-RES-005",
		unaffectedQuestion: "声称有性能改进的新算法合入主干前，需要满足哪些复现门槛？",
		oldClaimId: "claim:7be8350189499981-d7fca5218b36ad40",
		newClaimId: "claim:1f9be41b63ec8bde-c9a7e1b5fd58d181",
		triggerRelationId: "rel:cross-a247bfe26d070a90",
		unaffectedClaimIds: [
			"claim:8f33cc0f406f07f3-1a47c17a72a9bfeb",
			"claim:8f33cc0f406f07f3-0ff9498318da211c",
			"claim:8f33cc0f406f07f3-f29fe8b56057f88f",
		],
	},
] as const;

const runId = argument("--run-id");
if (!runId) throw new Error("必须提供 --run-id，首轮 artifact 不得覆盖");
const outputRoot = join(process.cwd(), "experiments/m1-wiki-correction/runs", runId);
if (existsSync(outputRoot)) throw new Error(`run 已存在，拒绝覆盖: ${outputRoot}`);
if (!existsSync(SOURCE_WORKSPACE)) throw new Error(`找不到冻结演化工作区: ${SOURCE_WORKSPACE}`);
mkdirSync(outputRoot, { recursive: true });

const temporaryRoot = mkdtempSync(join(tmpdir(), "wge-m1-wiki-"));
const workspace = join(temporaryRoot, "workspace");
try {
	cpSync(SOURCE_WORKSPACE, workspace, { recursive: true });
	rmSync(join(workspace, "wiki"), { recursive: true, force: true });
	rmSync(join(workspace, "quarantine", "wiki"), { recursive: true, force: true });
	mkdirSync(join(workspace, "wiki"), { recursive: true });
	mkdirSync(join(workspace, "quarantine", "wiki"), { recursive: true });

	const manualAudit = preparePreEvolutionState(workspace);
	const config = loadConfig({ projectRoot: workspace, apiKey: "", temperature: 0 });
	const createdAt = new Date().toISOString();
	const initialModules = buildInitialModules(config, createdAt);
	upsertWikiModules(config, initialModules);

	const beforeModules = readAllWikiModules(config);
	const beforeVersion = currentKnowledgeVersion(config);
	const beforePacks = buildPacks(config, "MATERIALIZED");
	const transaction = applyKnowledgeEvolution(
		config,
		EPISODES.map((episode) => episode.triggerRelationId),
		beforeVersion,
	);
	const afterModules = readAllWikiModules(config);
	const afterPacks = buildPacks(config, "MATERIALIZED");
	const afterR0Packs = buildPacks(config, "DISABLED");
	const afterClaims = readAllClaims(config);
	const afterSpans = readAllSpans(config);
	const quarantine = readWikiModuleQuarantine(config);

	const rollbackProbe = runRollbackProbe(temporaryRoot);
	const checks = {
		affectedDiscovered: EPISODES.every((episode) =>
			transaction.impact.affectedWikiModuleIds.includes(`wiki:m1:${episode.domain}:affected`),
		),
		rebuiltAll: EPISODES.every((episode) =>
			transaction.rebuiltWikiModuleIds.includes(`wiki:m1:${episode.domain}:affected`),
		),
		stableAddressesPreserved: EPISODES.every((episode) => {
			const id = `wiki:m1:${episode.domain}:affected`;
			return byId(beforeModules, id)?.stableAddress === byId(afterModules, id)?.stableAddress;
		}),
		oldReferencesRemoved: EPISODES.every((episode) =>
			byId(afterModules, `wiki:m1:${episode.domain}:affected`)?.claimRefs.every(
				(ref) => String(ref) !== episode.oldClaimId,
			),
		),
		replacementReferencesPresent: EPISODES.every((episode) =>
			byId(afterModules, `wiki:m1:${episode.domain}:affected`)
				?.claimRefs.map(String)
				.includes(episode.newClaimId),
		),
		quarantineCopiesPresent: EPISODES.every((episode) =>
			quarantine.some((record) => record.module.id === `wiki:m1:${episode.domain}:affected`),
		),
		unaffectedByteStable: EPISODES.every((episode) => {
			const id = `wiki:m1:${episode.domain}:unaffected`;
			return stableJson(byId(beforeModules, id)) === stableJson(byId(afterModules, id));
		}),
		allCanonicalWikiSupported: afterModules.every(
			(module) => inspectWikiModuleSupport(module, afterClaims, afterSpans).consumable,
		),
		affectedPacksCarryRebuiltWiki: EPISODES.every((episode) =>
			afterPacks[episode.affectedQuestionId]?.pack.wikiModules.some(
				(module) => module.id === `wiki:m1:${episode.domain}:affected`,
			),
		),
		unaffectedPacksCarryStableWiki: EPISODES.every((episode) =>
			afterPacks[episode.unaffectedQuestionId]?.pack.wikiModules.some(
				(module) => module.id === `wiki:m1:${episode.domain}:unaffected`,
			),
		),
		faultInjectionRollback: rollbackProbe.pass,
	};
	const passed = Object.values(checks).every(Boolean);
	const report = {
		schemaVersion: "wge-m1-wiki-correction-micro/v1",
		runId,
		status: passed ? "PASS" : "FAIL",
		createdAt,
		sourceWorkspace: "experiments/evolution/runs/controlled-v1-lineage-v15/workspace",
		datasetClass: "SYNTHETIC_SILVER_DEVELOPMENT",
		manualAudit,
		config: { contextBudgetTokens: 6000, maxGraphDepth: 0, selectionMode: "R0" },
		beforeKnowledgeVersion: beforeVersion,
		afterKnowledgeVersion: transaction.afterKnowledgeVersion,
		transaction,
		rollbackProbe,
		checks,
		counts: {
			initialWikiModules: beforeModules.length,
			finalWikiModules: afterModules.length,
			quarantinedWikiCopies: quarantine.length,
		},
		packLedger: Object.fromEntries(
			Object.entries(afterPacks).map(([questionId, result]) => [
				questionId,
				{
					w: {
						claimIds: result.pack.subgraph.claims.map((claim) => claim.id),
						wikiModuleIds: result.pack.wikiModules.map((module) => module.id),
						estimatedTokens: result.diagnostics.budget.finalEstimatedTokens,
					},
					r0: {
						claimIds: afterR0Packs[questionId]?.pack.subgraph.claims.map((claim) => claim.id) ?? [],
						wikiModuleIds:
							afterR0Packs[questionId]?.pack.wikiModules.map((module) => module.id) ?? [],
						estimatedTokens:
							afterR0Packs[questionId]?.diagnostics.budget.finalEstimatedTokens ?? null,
					},
					wikiSupportGates: result.diagnostics.wiki.supportGates,
				},
			]),
		),
	};
	writeJson(join(outputRoot, "report.json"), report);
	writeJson(join(outputRoot, "before-packs.json"), beforePacks);
	writeJson(join(outputRoot, "after-packs.json"), afterPacks);
	writeJson(join(outputRoot, "after-r0-packs.json"), afterR0Packs);
	writeJson(join(outputRoot, "before-wiki.json"), beforeModules);
	writeJson(join(outputRoot, "after-wiki.json"), afterModules);
	writeJson(join(outputRoot, "wiki-quarantine.json"), quarantine);
	writeJson(join(outputRoot, "artifact-hashes.json"), hashArtifacts(outputRoot));
	console.log(JSON.stringify(report, null, 2));
	if (!passed) process.exitCode = 1;
} finally {
	rmSync(temporaryRoot, { recursive: true, force: true });
}

function preparePreEvolutionState(workspace: string) {
	const publicationDir = join(workspace, "publications");
	const oldIds = new Set<string>(EPISODES.map((episode) => episode.oldClaimId));
	const triggerIds = new Set<string>(EPISODES.map((episode) => episode.triggerRelationId));
	const foundOld = new Set<string>();
	const foundRelations = new Set<string>();
	for (const file of readdirSync(publicationDir)
		.filter((name) => name.endsWith(".json"))
		.sort()) {
		const path = join(publicationDir, file);
		const publication = JSON.parse(readFileSync(path, "utf-8")) as SourcePublication;
		let changed = false;
		publication.claims = publication.claims.map((claim) => {
			if (!oldIds.has(claim.id)) return claim;
			foundOld.add(claim.id);
			changed = true;
			return { ...claim, lifecycle: "ACTIVE" as const };
		});
		publication.relations = publication.relations.map((relation) => {
			if (!triggerIds.has(relation.id)) return relation;
			foundRelations.add(relation.id);
			changed = true;
			return {
				...relation,
				relationAuditVersion: RELATION_AUDIT_VERSION,
				conditionStatus: "EXPLICIT_NONE" as const,
				supersessionEffect: "TOTAL_TO_CLAIM" as const,
				validity: "SUPPORTED" as const,
				lifecycle: "ACTIVE" as const,
				publicationState: "CANONICAL" as const,
			};
		});
		if (changed) writeJson(path, publication);
	}
	if (foundOld.size !== oldIds.size || foundRelations.size !== triggerIds.size) {
		throw new Error(
			`无法构造 M1 前态: old=${foundOld.size}/${oldIds.size}, relations=${foundRelations.size}/${triggerIds.size}`,
		);
	}
	return {
		mode: "isolated-development-fixture",
		relationSemanticAuthority: "pre-registered synthetic gold + exact endpoint inspection",
		relationAuditVersionAppliedInTemporaryWorkspace: RELATION_AUDIT_VERSION,
		oldClaimIds: [...oldIds].sort(),
		triggerRelationIds: [...triggerIds].sort(),
	};
}

function buildInitialModules(
	config: ReturnType<typeof loadConfig>,
	updatedAt: string,
): WikiModule[] {
	const claims = readAllClaims(config);
	const spans = readAllSpans(config);
	const sourceKnowledgeVersion = currentKnowledgeVersion(config);
	return EPISODES.flatMap((episode) => [
		materializeWikiModule(
			{
				id: `wiki:m1:${episode.domain}:affected`,
				stableAddress: `m1/${episode.domain}/affected-policy`,
				coreQuestion: episode.affectedQuestion,
				claimRefs: [episode.oldClaimId],
			},
			claims,
			spans,
			{ sourceKnowledgeVersion, rebuiltFromSnapshotId: null, updatedAt },
		),
		materializeWikiModule(
			{
				id: `wiki:m1:${episode.domain}:unaffected`,
				stableAddress: `m1/${episode.domain}/unaffected-policy`,
				coreQuestion: episode.unaffectedQuestion,
				claimRefs: [...episode.unaffectedClaimIds],
			},
			claims,
			spans,
			{ sourceKnowledgeVersion, rebuiltFromSnapshotId: null, updatedAt },
		),
	]);
}

function runRollbackProbe(temporaryRoot: string) {
	const workspace = join(temporaryRoot, "rollback-workspace");
	cpSync(SOURCE_WORKSPACE, workspace, { recursive: true });
	rmSync(join(workspace, "wiki"), { recursive: true, force: true });
	rmSync(join(workspace, "quarantine", "wiki"), { recursive: true, force: true });
	mkdirSync(join(workspace, "wiki"), { recursive: true });
	mkdirSync(join(workspace, "quarantine", "wiki"), { recursive: true });
	preparePreEvolutionState(workspace);
	const config = loadConfig({ projectRoot: workspace, apiKey: "", temperature: 0 });
	upsertWikiModules(config, buildInitialModules(config, "2026-08-12T00:00:00.000Z"));
	const beforeVersion = currentKnowledgeVersion(config);
	const beforeWiki = stableJson(readAllWikiModules(config));
	const beforeQuarantine = stableJson(readWikiModuleQuarantine(config));
	let rejectedByInjectedFailure = false;
	try {
		applyKnowledgeEvolution(
			config,
			EPISODES.map((episode) => episode.triggerRelationId),
			beforeVersion,
			{ failAfterWikiRebuild: true },
		);
	} catch (error) {
		rejectedByInjectedFailure = error instanceof Error && error.message.includes("已自动回滚");
	}
	const checks = {
		rejectedByInjectedFailure,
		knowledgeVersionRestored: currentKnowledgeVersion(config) === beforeVersion,
		wikiRestored: stableJson(readAllWikiModules(config)) === beforeWiki,
		quarantineRestored: stableJson(readWikiModuleQuarantine(config)) === beforeQuarantine,
	};
	return { pass: Object.values(checks).every(Boolean), checks };
}

function buildPacks(config: ReturnType<typeof loadConfig>, wikiMode: "DISABLED" | "MATERIALIZED") {
	return Object.fromEntries(
		EPISODES.flatMap((episode) => [
			[
				episode.affectedQuestionId,
				buildContextPackWithDiagnostics(config, episode.affectedQuestion, 6000, 0, undefined, {
					selectionMode: "R0",
					wikiMode,
				}),
			],
			[
				episode.unaffectedQuestionId,
				buildContextPackWithDiagnostics(config, episode.unaffectedQuestion, 6000, 0, undefined, {
					selectionMode: "R0",
					wikiMode,
				}),
			],
		]),
	);
}

function byId(modules: WikiModule[], id: string): WikiModule | undefined {
	return modules.find((module) => module.id === id);
}

function stableJson(value: unknown): string {
	return JSON.stringify(value);
}

function writeJson(path: string, value: unknown): void {
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function hashArtifacts(root: string) {
	return readdirSync(root)
		.filter((name) => name.endsWith(".json") && name !== "artifact-hashes.json")
		.sort()
		.map((name) => ({
			path: name,
			sha256: createHash("sha256")
				.update(readFileSync(join(root, name)))
				.digest("hex"),
		}));
}

function argument(name: string): string | null {
	const index = process.argv.indexOf(name);
	return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}
