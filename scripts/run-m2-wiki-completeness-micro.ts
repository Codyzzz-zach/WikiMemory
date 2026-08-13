#!/usr/bin/env node

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
import type { WikiAssertion, WikiModule } from "../src/types/index.js";
import { inspectWikiModuleSupport, materializeWikiModule } from "../src/wiki/materialization.js";

interface SelectionEpisode {
	domain: string;
	affectedQuestionId: string;
	affectedQuestion: string;
	moduleId: string;
	stableAddress: string;
	oldClaimId: string;
	newClaimId: string;
	triggerRelationId: string;
	claimIds: string[];
	requiredClaimIds: string[];
	unaffectedQuestionId: string;
	unaffectedQuestion: string;
	unaffectedModuleId: string;
	unaffectedClaimIds: string[];
}

interface Selection {
	schemaVersion: string;
	datasetClass: string;
	formationAuthority: string;
	episodes: SelectionEpisode[];
}

const ROOT = process.cwd();
const SOURCE_WORKSPACE = join(
	ROOT,
	"experiments/evolution/runs/controlled-v1-lineage-v15/workspace",
);
const SELECTION_PATH = join(ROOT, "experiments/m2-wiki-completeness/selection-v1.json");
const CONTRACT_PATH = join(ROOT, "experiments/m2-wiki-completeness/contract-v1.json");
const RUNS_ROOT = join(ROOT, "experiments/m2-wiki-completeness/runs");
const CONTEXT_BUDGET = 6000;

const runId = argument("--run-id");
if (!runId) throw new Error("必须提供 --run-id");
if (!/^[a-z0-9][a-z0-9._-]*$/u.test(runId)) throw new Error(`非法 run id: ${runId}`);
const outputRoot = join(RUNS_ROOT, runId);
if (existsSync(outputRoot)) throw new Error(`run 已存在，拒绝覆盖: ${outputRoot}`);
if (!existsSync(SOURCE_WORKSPACE)) throw new Error(`缺少冻结演化工作区: ${SOURCE_WORKSPACE}`);
const selection = readJson<Selection>(SELECTION_PATH);
if (selection.episodes.length !== 3) throw new Error("M2 必须覆盖三个领域");
mkdirSync(outputRoot, { recursive: true });

const temporaryRoot = mkdtempSync(join(tmpdir(), "wge-m2-wiki-"));
const workspace = join(temporaryRoot, "workspace");
try {
	cpSync(SOURCE_WORKSPACE, workspace, { recursive: true });
	rmSync(join(workspace, "wiki"), { recursive: true, force: true });
	rmSync(join(workspace, "quarantine", "wiki"), { recursive: true, force: true });
	mkdirSync(join(workspace, "wiki"), { recursive: true });
	mkdirSync(join(workspace, "quarantine", "wiki"), { recursive: true });

	const fixtureAudit = preparePreEvolutionState(workspace, selection.episodes);
	const config = loadConfig({ projectRoot: workspace, apiKey: "", temperature: 0 });
	const createdAt = new Date().toISOString();
	upsertWikiModules(config, buildInitialModules(config, selection.episodes, createdAt));
	const beforeModules = readAllWikiModules(config);
	const beforeVersion = currentKnowledgeVersion(config);
	const transaction = applyKnowledgeEvolution(
		config,
		selection.episodes.map((episode) => episode.triggerRelationId),
		beforeVersion,
	);
	const afterModules = readAllWikiModules(config);
	const claims = readAllClaims(config);
	const spans = readAllSpans(config);
	const quarantine = readWikiModuleQuarantine(config);
	const w2Packs = buildPacks(config, selection.episodes, "MATERIALIZED");
	const r0Packs = buildPacks(config, selection.episodes, "DISABLED");
	const coverage = selection.episodes.map((episode) => {
		const w2 = w2Packs[episode.affectedQuestionId];
		const r0 = r0Packs[episode.affectedQuestionId];
		const w2Ids = new Set(w2.pack.subgraph.claims.map((claim) => claim.id));
		const r0Ids = new Set(r0.pack.subgraph.claims.map((claim) => claim.id));
		return {
			questionId: episode.affectedQuestionId,
			requiredClaimIds: episode.requiredClaimIds,
			w2Present: episode.requiredClaimIds.filter((id) => w2Ids.has(id)),
			r0Present: episode.requiredClaimIds.filter((id) => r0Ids.has(id)),
			w2Missing: episode.requiredClaimIds.filter((id) => !w2Ids.has(id)),
			r0Missing: episode.requiredClaimIds.filter((id) => !r0Ids.has(id)),
			w2EstimatedTokens: w2.diagnostics.budget.finalEstimatedTokens,
			r0EstimatedTokens: r0.diagnostics.budget.finalEstimatedTokens,
			w2WikiModuleIds: w2.pack.wikiModules.map((module) => module.id),
			r0WikiModuleIds: r0.pack.wikiModules.map((module) => module.id),
		};
	});

	const checks = {
		moduleCountSix: afterModules.length === 6,
		allModulesConsumable: afterModules.every(
			(module) => inspectWikiModuleSupport(module, claims, spans).consumable,
		),
		affectedModulesHaveMultipleAssertions: selection.episodes.every(
			(episode) =>
				(byId(afterModules, episode.moduleId)?.materialization?.assertions.length ?? 0) >= 3,
		),
		affectedModulesDiscoveredAndRebuilt: selection.episodes.every(
			(episode) =>
				transaction.impact.affectedWikiModuleIds.includes(episode.moduleId) &&
				transaction.rebuiltWikiModuleIds.includes(episode.moduleId),
		),
		stableAddressesPreserved: selection.episodes.every(
			(episode) =>
				byId(beforeModules, episode.moduleId)?.stableAddress ===
				byId(afterModules, episode.moduleId)?.stableAddress,
		),
		replacementIsLocal: selection.episodes.every((episode) =>
			unaffectedAssertionsRemainStable(
				byId(beforeModules, episode.moduleId),
				byId(afterModules, episode.moduleId),
				episode.oldClaimId,
				episode.newClaimId,
			),
		),
		unaffectedModulesByteStable: selection.episodes.every(
			(episode) =>
				stableJson(byId(beforeModules, episode.unaffectedModuleId)) ===
				stableJson(byId(afterModules, episode.unaffectedModuleId)),
		),
		quarantineCopiesPresent: selection.episodes.every((episode) =>
			quarantine.some((record) => record.module.id === episode.moduleId),
		),
		w2RequiredCoverageComplete: coverage.every((row) => row.w2Missing.length === 0),
		w2AffectedModulesVisible: coverage.every((row) => row.w2WikiModuleIds.length === 1),
		w2NeverWorseThanR0: coverage.every((row) => row.w2Present.length >= row.r0Present.length),
		w2StrictlyImprovesAtLeastOne: coverage.some(
			(row) => row.w2Present.length > row.r0Present.length,
		),
		allPacksWithinBudget: [...Object.values(w2Packs), ...Object.values(r0Packs)].every(
			(pack) => pack.diagnostics.budget.finalEstimatedTokens <= CONTEXT_BUDGET,
		),
	};
	const status = Object.values(checks).every(Boolean) ? "PASS" : "FAIL";
	const report = {
		schemaVersion: "wge-m2-wiki-completeness-micro/v1",
		runId,
		status,
		createdAt,
		datasetClass: selection.datasetClass,
		formationAuthority: selection.formationAuthority,
		interpretation:
			"Development mechanism evidence only; automatic Wiki formation is out of scope.",
		frozenInputs: {
			selectionSha256: sha256(readFileSync(SELECTION_PATH)),
			contractSha256: sha256(readFileSync(CONTRACT_PATH)),
			sourceWorkspace: "experiments/evolution/runs/controlled-v1-lineage-v15/workspace",
			beforeKnowledgeVersion: beforeVersion,
		},
		fixtureAudit,
		transaction,
		checks,
		coverage,
		counts: {
			beforeModules: beforeModules.length,
			afterModules: afterModules.length,
			quarantineCopies: quarantine.length,
		},
	};
	writeJson(join(outputRoot, "report.json"), report);
	writeJson(join(outputRoot, "before-wiki.json"), beforeModules);
	writeJson(join(outputRoot, "after-wiki.json"), afterModules);
	writeJson(join(outputRoot, "wiki-quarantine.json"), quarantine);
	writeJson(join(outputRoot, "w2-packs.json"), w2Packs);
	writeJson(join(outputRoot, "r0-packs.json"), r0Packs);
	writeJson(join(outputRoot, "artifact-hashes.json"), hashArtifacts(outputRoot));
	console.log(JSON.stringify(report, null, 2));
	if (status !== "PASS") process.exitCode = 1;
} finally {
	rmSync(temporaryRoot, { recursive: true, force: true });
}

function preparePreEvolutionState(workspace: string, episodes: SelectionEpisode[]) {
	const publicationDir = join(workspace, "publications");
	const oldIds = new Set(episodes.map((episode) => episode.oldClaimId));
	const triggerIds = new Set(episodes.map((episode) => episode.triggerRelationId));
	const foundOld = new Set<string>();
	const foundTriggers = new Set<string>();
	for (const file of readdirSync(publicationDir)
		.filter((name) => name.endsWith(".json"))
		.sort()) {
		const path = join(publicationDir, file);
		const publication = readJson<SourcePublication>(path);
		let changed = false;
		publication.claims = publication.claims.map((claim) => {
			if (!oldIds.has(claim.id)) return claim;
			foundOld.add(claim.id);
			changed = true;
			return { ...claim, lifecycle: "ACTIVE" as const };
		});
		publication.relations = publication.relations.map((relation) => {
			if (!triggerIds.has(relation.id)) return relation;
			foundTriggers.add(relation.id);
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
	if (foundOld.size !== oldIds.size || foundTriggers.size !== triggerIds.size) {
		throw new Error(
			`无法构造 M2 前态: old=${foundOld.size}/${oldIds.size}, trigger=${foundTriggers.size}/${triggerIds.size}`,
		);
	}
	return {
		mode: "isolated-development-fixture",
		relationSemanticAuthority: "M1 preregistered synthetic relation endpoints",
		relationAuditVersionAppliedInTemporaryWorkspace: RELATION_AUDIT_VERSION,
	};
}

function buildInitialModules(
	config: ReturnType<typeof loadConfig>,
	episodes: SelectionEpisode[],
	updatedAt: string,
): WikiModule[] {
	const claims = readAllClaims(config);
	const spans = readAllSpans(config);
	const sourceKnowledgeVersion = currentKnowledgeVersion(config);
	return episodes.flatMap((episode) => {
		const preEvolutionIds = episode.claimIds.map((id) =>
			id === episode.newClaimId ? episode.oldClaimId : id,
		);
		return [
			materializeWikiModule(
				{
					id: episode.moduleId,
					stableAddress: episode.stableAddress,
					coreQuestion: episode.affectedQuestion,
					claimRefs: preEvolutionIds,
				},
				claims,
				spans,
				{ sourceKnowledgeVersion, rebuiltFromSnapshotId: null, updatedAt },
			),
			materializeWikiModule(
				{
					id: episode.unaffectedModuleId,
					stableAddress: `m2/${episode.domain}/unaffected-control`,
					coreQuestion: episode.unaffectedQuestion,
					claimRefs: episode.unaffectedClaimIds,
				},
				claims,
				spans,
				{ sourceKnowledgeVersion, rebuiltFromSnapshotId: null, updatedAt },
			),
		];
	});
}

function buildPacks(
	config: ReturnType<typeof loadConfig>,
	episodes: SelectionEpisode[],
	wikiMode: "DISABLED" | "MATERIALIZED",
) {
	return Object.fromEntries(
		episodes.flatMap((episode) => [
			[
				episode.affectedQuestionId,
				buildContextPackWithDiagnostics(
					config,
					episode.affectedQuestion,
					CONTEXT_BUDGET,
					0,
					undefined,
					{ selectionMode: "R0", wikiMode },
				),
			],
			[
				episode.unaffectedQuestionId,
				buildContextPackWithDiagnostics(
					config,
					episode.unaffectedQuestion,
					CONTEXT_BUDGET,
					0,
					undefined,
					{ selectionMode: "R0", wikiMode },
				),
			],
		]),
	);
}

function unaffectedAssertionsRemainStable(
	before: WikiModule | undefined,
	after: WikiModule | undefined,
	oldClaimId: string,
	newClaimId: string,
): boolean {
	if (!before?.materialization || !after?.materialization) return false;
	const beforeAssertions = new Map(
		before.materialization.assertions.map((assertion) => [String(assertion.claimRef), assertion]),
	);
	const afterAssertions = new Map(
		after.materialization.assertions.map((assertion) => [String(assertion.claimRef), assertion]),
	);
	if (beforeAssertions.has(newClaimId) || afterAssertions.has(oldClaimId)) return false;
	if (!beforeAssertions.has(oldClaimId) || !afterAssertions.has(newClaimId)) return false;
	for (const [claimId, assertion] of beforeAssertions) {
		if (claimId === oldClaimId) continue;
		if (stableAssertion(assertion) !== stableAssertion(afterAssertions.get(claimId))) return false;
	}
	return true;
}

function stableAssertion(assertion: WikiAssertion | undefined): string {
	if (!assertion) return "missing";
	return stableJson(assertion);
}

function byId(modules: WikiModule[], id: string): WikiModule | undefined {
	return modules.find((module) => module.id === id);
}

function hashArtifacts(root: string): Record<string, string> {
	return Object.fromEntries(
		readdirSync(root)
			.filter((name) => name.endsWith(".json") && name !== "artifact-hashes.json")
			.sort()
			.map((name) => [name, sha256(readFileSync(join(root, name)))]),
	);
}

function argument(name: string): string | undefined {
	const index = process.argv.indexOf(name);
	return index >= 0 ? process.argv[index + 1] : undefined;
}

function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, "utf-8")) as T;
}

function writeJson(path: string, value: unknown): void {
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function stableJson(value: unknown): string {
	return JSON.stringify(value);
}

function sha256(value: string | Buffer): string {
	return createHash("sha256").update(value).digest("hex");
}
