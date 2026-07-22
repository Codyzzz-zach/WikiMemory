#!/usr/bin/env node

import { Command } from "commander";
import { loadConfig } from "../config/index.js";
import { ingestMarkdownFile } from "../ingestor/index.js";
import { compileSource } from "../compiler/index.js";
import {
	lintCompileResult,
	type CompileLintResult,
} from "../linter/index.js";
import {
	appendClaims,
	appendConcepts,
	appendRelations,
} from "../linter/storage.js";
import { buildContextPack } from "../context-pack/index.js";
import { createLLMProvider } from "../core/llm-provider.js";
import { readAllClaims, readAllSpans } from "../linter/storage.js";

const program = new Command();

program
	.name("wge")
	.description("WGEMemory4LLM — Agent-native knowledge compilation")
	.version("0.1.0");

// ─── ingest 命令 ─────────────────────────────────────────────────

program
	.command("ingest")
	.description("Ingest a Markdown file: parse → compile → lint → canonical/quarantine")
	.argument("<file>", "Path to .md file")
	.option("--no-semantic", "Skip semantic lint (structure only)")
	.option("--json", "Output JSON result")
	.action(async (file: string, options: { noSemantic?: boolean; json?: boolean }) => {
		const config = loadConfig();

		if (!config.apiKey) {
			console.error("❌ DEEPSEEK_API_KEY not set. Copy .env.example to .env.");
			process.exit(1);
		}

		const provider = createLLMProvider(config);

		// Step 1: Ingest（机械解析）
		if (!options.json) console.error(`📥 Ingesting: ${file}`);
		const ingestResult = ingestMarkdownFile(config, file);
		if (!options.json) {
			console.error(`   Source: ${ingestResult.source.id}`);
			console.error(`   Blocks: ${ingestResult.spans.length}`);
			console.error(`   Duplicate: ${ingestResult.isDuplicate}`);
		}

		if (ingestResult.isDuplicate) {
			if (!options.json) console.error("✅ Already ingested. Skipping compile.");
			if (options.json) console.log(JSON.stringify({ skipped: true, source: ingestResult.source.id }));
			return;
		}

		// Step 2: Compile（三步编译）
		if (!options.json) console.error("🔧 Compiling...");
		const compileResult = await compileSource(
			config,
			ingestResult.source,
			ingestResult.spans,
			provider,
		);
		if (!options.json) {
			console.error(`   Claims: ${compileResult.claims.length}`);
			console.error(`   Concepts: ${compileResult.concepts.length}`);
			console.error(`   Relations: ${compileResult.relations.length}`);
		}

		// Step 3: 原子 Lint（修断点 1+6：Claim + Relation 一起 Lint）
		if (!options.json) console.error("🔍 Linting (atomic: claims + relations)...");
		const allSpans = readAllSpans(config);
		const lintProvider = options.noSemantic ? null : provider;
		const lintResult: CompileLintResult = await lintCompileResult(
			config,
			compileResult.claims,
			compileResult.relations,
			compileResult.concepts,
			allSpans,
			lintProvider,
			{ skipSemantic: options.noSemantic },
		);
		if (!options.json) {
			console.error(`   Canonical claims: ${lintResult.canonicalClaims.length}`);
			console.error(`   Canonical relations: ${lintResult.canonicalRelations.length}`);
			console.error(`   Quarantined claims: ${lintResult.quarantinedClaims.length}`);
			console.error(`   Quarantined relations: ${lintResult.quarantinedRelations.length}`);
		}

		// Step 4: 原子发布（修断点 6：整体写入，不分别追加）
		// 先收集所有要写入的对象，再一次写入——中途失败不会产生半成品状态
		const claimsToStore = [
			...lintResult.canonicalClaims,
			...lintResult.quarantinedClaims.map((q) => q.claim),
		];
		const relationsToStore = [
			...lintResult.canonicalRelations,
			...lintResult.quarantinedRelations.map((q) => q.relation),
		];

		appendClaims(config, claimsToStore);
		appendConcepts(config, compileResult.concepts);
		appendRelations(config, relationsToStore);

		if (!options.json) {
			console.error(`✅ Ingest complete: ${lintResult.canonicalClaims.length} canonical claims, ${lintResult.canonicalRelations.length} canonical relations`);
		} else {
			console.log(
				JSON.stringify({
					source: ingestResult.source.id,
					blocks: ingestResult.spans.length,
					propositions: compileResult.propositions.length,
					claims: compileResult.claims.length,
					concepts: compileResult.concepts.length,
					relations: compileResult.relations.length,
					canonicalClaims: lintResult.canonicalClaims.length,
					canonicalRelations: lintResult.canonicalRelations.length,
					quarantinedClaims: lintResult.quarantinedClaims.length,
					quarantinedRelations: lintResult.quarantinedRelations.length,
				}, null, 2),
			);
		}
	});

// ─── query 命令 ──────────────────────────────────────────────────

program
	.command("query")
	.description("Query knowledge state and build a Context Pack")
	.argument("<task>", "Task description")
	.option("--budget <tokens>", "Context budget in tokens", "12000")
	.option("--depth <n>", "Max graph depth", "3")
	.option("--json", "Output JSON Context Pack")
	.action((task: string, options: { budget: string; depth: string; json?: boolean }) => {
		const config = loadConfig();
		const pack = buildContextPack(
			config,
			task,
			Number.parseInt(options.budget, 10),
			Number.parseInt(options.depth, 10),
		);

		if (options.json) {
			console.log(JSON.stringify(pack, null, 2));
		} else {
			console.log("📋 Context Pack");
			console.log(pack.taskMap);
			console.log("");

			if (pack.subgraph.length > 0) {
				console.log(`🔗 Relations (${pack.subgraph.length}):`);
				for (const rel of pack.subgraph.slice(0, 10)) {
					console.log(`   ${rel.from} --[${rel.type}]--> ${rel.to}`);
				}
			}

			if (pack.evidenceSpans.length > 0) {
				console.log(`\n📄 Evidence (${pack.evidenceSpans.length}):`);
				for (const span of pack.evidenceSpans.slice(0, 5)) {
					console.log(`   [${span.blockId}] ${span.text.slice(0, 100)}...`);
				}
			}

			if (pack.conflictsAndConditions.length > 0) {
				console.log(`\n⚠️ Conflicts & Conditions:`);
				for (const c of pack.conflictsAndConditions) {
					console.log(`   ${c}`);
				}
			}

			if (pack.knownGaps.length > 0) {
				console.log(`\n❓ Known Gaps:`);
				for (const g of pack.knownGaps) {
					console.log(`   ${g}`);
				}
			}
		}
	});

// ─── status 命令 ─────────────────────────────────────────────────

program
	.command("status")
	.description("Show knowledge state summary")
	.action(() => {
		const config = loadConfig();
		const claims = readAllClaims(config);
		const spans = readAllSpans(config);

		const canonical = claims.filter(
			(c) => c.publicationState === "CANONICAL" && c.lifecycle === "ACTIVE",
		);
		const quarantined = claims.filter((c) => c.publicationState === "QUARANTINED");
		const disputed = claims.filter((c) => c.validity === "DISPUTED");
		const unresolved = claims.filter((c) => c.validity === "UNRESOLVED");

		console.log("📊 WGEMemory4LLM Status");
		console.log(`   Sources spans: ${spans.length}`);
		console.log(`   Total claims: ${claims.length}`);
		console.log(`   Canonical (active): ${canonical.length}`);
		console.log(`   Quarantined: ${quarantined.length}`);
		console.log(`   Disputed: ${disputed.length}`);
		console.log(`   Unresolved: ${unresolved.length}`);
	});

program.parse(process.argv);
