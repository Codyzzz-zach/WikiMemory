#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import { loadConfig } from "../src/config/index.js";
import {
	computeKnowledgeVersion,
	readAllClaims,
	readAllConcepts,
	readAllRelations,
	readAllSpans,
	resolveSpanById,
} from "../src/linter/storage.js";
import { writeJsonAtomic } from "../src/linter/storage.js";
import type { WikiModule } from "../src/types/index.js";
import { formWikiModuleSeeds } from "../src/wiki/formation.js";
import { inspectWikiModuleSupport, materializeWikiModule } from "../src/wiki/materialization.js";

const program = new Command();
program
	.name("run-h1a-wiki-formation")
	.requiredOption("--workspace <path>")
	.requiredOption("--run-id <id>")
	.option("--min-claims <n>", "minimum claims per module", "2")
	.option("--max-claims <n>", "maximum claims per module", "8")
	.option("--max-evidence-chars <n>", "maximum evidence chars per module", "4000")
	.action(({ workspace, runId, minClaims, maxClaims, maxEvidenceChars }) => {
		const root = join(process.cwd(), "experiments/h1-wiki-formation/runs", runId);
		const reportPath = join(root, "report.json");
		if (existsSync(reportPath)) throw new Error(`H1-A 首轮工件已存在，拒绝覆盖: ${reportPath}`);
		mkdirSync(root, { recursive: true });
		const config = loadConfig({ projectRoot: workspace });
		const claims = readAllClaims(config);
		const concepts = readAllConcepts(config);
		const relations = readAllRelations(config);
		const spans = readAllSpans(config);
		const options = {
			minClaimsPerModule: parsePositiveInt(minClaims, "min-claims"),
			maxClaimsPerModule: parsePositiveInt(maxClaims, "max-claims"),
			maxEvidenceCharsPerModule: parsePositiveInt(maxEvidenceChars, "max-evidence-chars"),
		};
		const input = { claims, relations, spans };
		const first = formWikiModuleSeeds(input, options);
		const reversed = formWikiModuleSeeds(
			{
				claims: [...claims].reverse(),
				relations: [...relations].reverse(),
				spans: [...spans].reverse(),
			},
			options,
		);
		const knowledgeVersion = computeKnowledgeVersion(claims, concepts, relations);
		const modules = first.seeds.map((seed) =>
			materializeWikiModule(seed, claims, spans, {
				sourceKnowledgeVersion: knowledgeVersion,
				rebuiltFromSnapshotId: null,
				updatedAt: "1970-01-01T00:00:00.000Z",
			}),
		);
		const inspections = modules.map((module) => ({
			moduleId: module.id,
			...inspectWikiModuleSupport(module, claims, spans),
		}));
		const claimsById = new Map(claims.map((claim) => [claim.id, claim]));
		const moduleEvidenceChars = (module: WikiModule): number => {
			const evidenceIds = new Set(
				module.claimRefs.flatMap((ref) => claimsById.get(String(ref))?.evidenceSpanIds ?? []),
			);
			return [...evidenceIds].reduce(
				(total, id) => total + (resolveSpanById(spans, id)?.text.length ?? 0),
				0,
			);
		};
		const determinism = sha256(first.seeds) === sha256(reversed.seeds);
		const perturbationSourceId = first.decisions.flatMap((decision) => {
			if (!decision.accepted) return [];
			const claim = claimsById.get(decision.claimId);
			const span = claim ? resolveSpanById(spans, claim.evidenceSpanIds[0] ?? "") : null;
			return span ? [span.sourceId] : [];
		})[0];
		const perturbationClaimIds = new Set(
			perturbationSourceId
				? claims.flatMap((claim) => {
						const span = resolveSpanById(spans, claim.evidenceSpanIds[0] ?? "");
						return span?.sourceId === perturbationSourceId ? [claim.id] : [];
					})
				: [],
		);
		const withoutOneSource = perturbationSourceId
			? formWikiModuleSeeds(
					{
						claims: claims.filter((claim) => !perturbationClaimIds.has(claim.id)),
						relations,
						spans,
					},
					options,
				)
			: first;
		const unaffectedSeeds = first.seeds.filter((seed) =>
			seed.claimRefs.every((ref) => !perturbationClaimIds.has(String(ref))),
		);
		const stableUnderUnrelatedSourceRemoval =
			sha256(unaffectedSeeds) === sha256(withoutOneSource.seeds);
		const allConsumable = inspections.every((inspection) => inspection.consumable);
		const noQuestionInputs = !process.argv.some((argument) =>
			/question|gold|requiredFact/iu.test(argument),
		);
		const bounded = modules.every(
			(seed) =>
				seed.claimRefs.length >= options.minClaimsPerModule &&
				seed.claimRefs.length <= options.maxClaimsPerModule &&
				moduleEvidenceChars(seed) <= options.maxEvidenceCharsPerModule,
		);
		const formationSource = readFileSync(join(process.cwd(), "src/wiki/formation.ts"), "utf8");
		const importedPaths = [...formationSource.matchAll(/from\s+["']([^"']+)["']/gu)].map(
			(match) => match[1] ?? "",
		);
		const noForbiddenFormationImports = importedPaths.every(
			(path) => !/(?:benchmark|question|gold|selection|answer)/iu.test(path),
		);
		const checks = {
			noQuestionInputs,
			noForbiddenFormationImports,
			deterministicUnderInputReversal: determinism,
			stableUnderUnrelatedSourceRemoval,
			allModulesConsumable: allConsumable,
			bounded,
		};
		writeJsonAtomic(join(root, "formation.json"), first);
		writeJsonAtomic(join(root, "modules.json"), modules);
		writeJsonAtomic(join(root, "support-inspections.json"), inspections);
		writeJsonAtomic(reportPath, {
			schemaVersion: "wge-h1a-wiki-formation-run/v1",
			runId,
			status: Object.values(checks).every(Boolean) ? "PASS" : "FAIL",
			datasetClass: "REVEALED_DEVELOPMENT",
			authority: "FORMATION_ENGINEERING_ONLY",
			workspace,
			contractPath: "experiments/h1-wiki-formation/contract-v1.json",
			inputHashes: {
				claims: sha256(claims),
				concepts: sha256(concepts),
				relations: sha256(relations),
				spans: sha256(spans),
				contract: createHash("sha256")
					.update(
						readFileSync(join(process.cwd(), "experiments/h1-wiki-formation/contract-v1.json")),
					)
					.digest("hex"),
			},
			options,
			checks,
			stats: first.stats,
			moduleSizes: modules.map((module) => ({
				moduleId: module.id,
				stableAddress: module.stableAddress,
				assertions: module.materialization?.assertions.length ?? 0,
				evidenceChars: moduleEvidenceChars(module),
			})),
			formationImports: importedPaths,
			incrementalPerturbation: {
				removedSourceId: perturbationSourceId ?? null,
				removedClaimCount: perturbationClaimIds.size,
				unaffectedModuleCount: unaffectedSeeds.length,
			},
			formedArtifactsHash: sha256({ seeds: first.seeds, modules }),
		});
		console.log(
			JSON.stringify(
				{
					status: Object.values(checks).every(Boolean) ? "PASS" : "FAIL",
					checks,
					stats: first.stats,
				},
				null,
				2,
			),
		);
	});

program.parseAsync().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});

function parsePositiveInt(value: string, label: string): number {
	const parsed = Number.parseInt(value, 10);
	if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${label} 必须是正整数`);
	return parsed;
}

function sha256(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
