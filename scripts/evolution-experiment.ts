#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { getCompileState } from "../src/compiler/run-state.js";
import { loadConfig } from "../src/config/index.js";
import {
	EVOLUTION_TIMELINES,
	type EvolutionApproval,
	type EvolutionCoverage,
	type EvolutionTimeline,
	assertTimelineTransition,
	summarizeEvolutionCoverage,
	summarizeRetrieval,
	validateEvolutionApproval,
} from "../src/evolution/experiment.js";
import { applyKnowledgeEvolution } from "../src/evolution/transaction.js";
import {
	createKnowledgeSnapshot,
	currentKnowledgeVersion,
	readKnowledgeSnapshot,
} from "../src/evolution/version-store.js";
import {
	readAllClaims,
	readAllConcepts,
	readAllRelations,
	readAllSources,
	readAllWikiModules,
	readSourcePublications,
} from "../src/linter/storage.js";
import { type PilotConfig, type PilotGroup, preparePilotContext } from "../src/pilot/index.js";
import { RELATION_AUDIT_VERSION } from "../src/prompts/index.js";

interface DatasetDocument {
	documentId: string;
	path: string;
	domain: string;
	timeline: EvolutionTimeline;
	changeKind: "BASELINE" | "ADDITION" | "SUPERSESSION" | "UNRESOLVED_CONFLICT";
	targetDocumentIds: string[];
}

interface DatasetManifest {
	schemaVersion: "wge-evolution-manifest/v1";
	datasetId: string;
	documents: DatasetDocument[];
}

interface TimelineGold {
	answerability: "ANSWERABLE" | "INSUFFICIENT" | "DISPUTED";
	expectedAnswer: string;
	requiredFacts: string[];
	requiredConditions: string[];
	forbiddenFacts: string[];
	sourceDocumentIds: string[];
}

interface DatasetQuestion {
	id: string;
	domain: string;
	category: string;
	question: string;
	goldByTimeline: Record<EvolutionTimeline, TimelineGold>;
}

interface QuestionFile {
	schemaVersion: "wge-evolution-questions/v1";
	datasetId: string;
	questions: DatasetQuestion[];
}

interface ExperimentDocumentState extends DatasetDocument {
	status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
	sourceId?: string;
	compileRunId?: string;
	error?: string;
}

interface ExperimentTimelineState {
	timeline: EvolutionTimeline;
	completedAt: string;
	knowledgeVersion: string;
	snapshotId: string;
	evolutionCandidateIds: string[];
	evolutionAppliedIds: string[];
	evolutionCoverage: EvolutionCoverage | null;
	missingEvolutionAccepted: boolean;
}

interface ExperimentState {
	schemaVersion: "wge-evolution-experiment/v1";
	runId: string;
	datasetId: string;
	datasetHash: string;
	configHash: string;
	createdAt: string;
	repoCommit: string;
	workspace: string;
	documents: ExperimentDocumentState[];
	timelines: ExperimentTimelineState[];
	parent?: {
		runId: string;
		timeline: EvolutionTimeline;
		snapshotId: string;
		repoCommit: string;
		knowledgeVersion: string;
	};
}

interface ExperimentConfig {
	schemaVersion: "wge-evolution-experiment-config/v1";
	status: "LOCKED";
	compiler: PilotConfig["compiler"];
	answer: PilotConfig["answer"];
	judge: PilotConfig["judge"];
	retrieval: PilotConfig["retrieval"];
	execution: PilotConfig["execution"];
}

interface IngestOutput {
	runId?: string;
	source?: string;
	compileState?: string;
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const defaultDatasetRoot = join(repositoryRoot, "experiments", "evolution", "dataset-v1");
const experimentConfigPath = join(repositoryRoot, "experiments", "evolution", "config.json");
const experimentRunsRoot = join(repositoryRoot, "experiments", "evolution", "runs");
const groups: PilotGroup[] = ["B", "P", "E-min"];

const program = new Command();
program
	.name("evolution-experiment")
	.description("Isolated T0→T1→T2→T3 evolution experiment runner")
	.option("--dataset <directory>", "Dataset root", defaultDatasetRoot);

program
	.command("init")
	.description("Create a clean isolated workspace and copy the frozen corpus")
	.option("--run-id <id>", "Stable run ID; generated when omitted")
	.action((options: { runId?: string }) => {
		assertCleanWorktree();
		const datasetRoot = selectedDatasetRoot();
		validateDataset(datasetRoot);
		const manifest = readJson<DatasetManifest>(join(datasetRoot, "manifest.json"));
		const questions = readJson<QuestionFile>(join(datasetRoot, "questions.json"));
		const experimentConfig = readExperimentConfig();
		if (manifest.datasetId !== questions.datasetId) throw new Error("datasetId 不一致");
		const runId = options.runId ?? `evolution-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`;
		const runDirectory = resolveRunDirectory(runId);
		if (existsSync(runDirectory)) throw new Error(`实验 run 已存在: ${runDirectory}`);
		const workspace = join(runDirectory, "workspace");
		for (const directory of [
			"corpus",
			"sources",
			"wiki",
			"quarantine",
			"indexes",
			"runs",
			"publications",
		]) {
			mkdirSync(join(workspace, directory), { recursive: true });
		}
		for (const document of manifest.documents) {
			const source = resolveDatasetFile(datasetRoot, document.path);
			const target = join(workspace, "corpus", document.path);
			mkdirSync(dirname(target), { recursive: true });
			copyFileSync(source, target);
		}
		const state: ExperimentState = {
			schemaVersion: "wge-evolution-experiment/v1",
			runId,
			datasetId: manifest.datasetId,
			datasetHash: hashDataset(datasetRoot, manifest, questions),
			configHash: hashJson("config", experimentConfig),
			createdAt: new Date().toISOString(),
			repoCommit: gitCommit(),
			workspace,
			documents: manifest.documents.map((document) => ({ ...document, status: "PENDING" })),
			timelines: [],
		};
		writeJsonAtomic(join(runDirectory, "state.json"), state);
		writeJsonAtomic(join(runDirectory, "dataset-manifest.json"), manifest);
		writeJsonAtomic(join(runDirectory, "questions.json"), questions);
		console.log(
			JSON.stringify(
				{
					runId,
					runDirectory,
					workspace,
					datasetHash: state.datasetHash,
					configHash: state.configHash,
				},
				null,
				2,
			),
		);
	});

program
	.command("fork")
	.description("Fork a new run from a completed parent timeline snapshot with explicit lineage")
	.requiredOption("--from-run <id>", "Completed parent run ID")
	.requiredOption("--timeline <timeline>", "Completed parent timeline to inherit")
	.requiredOption("--run-id <id>", "New run ID")
	.action((options: { fromRun: string; timeline: string; runId: string }) => {
		assertCleanWorktree();
		const timeline = parseTimeline(options.timeline);
		const parentDirectory = resolveRunDirectory(options.fromRun);
		const parentState = readJson<ExperimentState>(join(parentDirectory, "state.json"));
		assertStateWorkspace(parentDirectory, parentState);
		const parentTimeline = parentState.timelines.find((item) => item.timeline === timeline);
		if (!parentTimeline) throw new Error(`父 run 未完成 ${timeline}`);

		const datasetRoot = selectedDatasetRoot();
		validateDataset(datasetRoot);
		const manifest = readJson<DatasetManifest>(join(datasetRoot, "manifest.json"));
		const questions = readJson<QuestionFile>(join(datasetRoot, "questions.json"));
		const experimentConfig = readExperimentConfig();
		const datasetHash = hashDataset(datasetRoot, manifest, questions);
		const configHash = hashJson("config", experimentConfig);
		if (parentState.datasetHash !== datasetHash || parentState.configHash !== configHash) {
			throw new Error("父 run 的数据或实验配置与当前冻结输入不一致");
		}

		const runDirectory = resolveRunDirectory(options.runId);
		if (existsSync(runDirectory)) throw new Error(`实验 run 已存在: ${runDirectory}`);
		const workspace = join(runDirectory, "workspace");
		initializeWorkspace(workspace, datasetRoot, manifest);
		const parentConfig = isolatedConfig(parentState.workspace, experimentConfig);
		const inheritedSnapshot = readKnowledgeSnapshot(parentConfig, parentTimeline.snapshotId);
		for (const file of inheritedSnapshot.files) {
			writeInheritedFile(workspace, file.path, file.content);
		}

		const inheritedDocuments = parentState.documents.filter(
			(document) =>
				EVOLUTION_TIMELINES.indexOf(document.timeline) <= EVOLUTION_TIMELINES.indexOf(timeline),
		);
		const inheritedSourceIds = new Set(
			inheritedDocuments.map((document) => {
				if (document.status !== "COMPLETED" || !document.sourceId) {
					throw new Error(`父 run 文档 ${document.documentId} 未完整发布`);
				}
				return document.sourceId;
			}),
		);
		for (const document of inheritedDocuments) {
			const key = (document.sourceId as string).replace(/^source:/u, "");
			const source = readJson<Record<string, unknown>>(
				join(parentState.workspace, "sources", `${key}.json`),
			);
			source.uri = join(workspace, "corpus", document.path);
			writeJsonAtomic(join(workspace, "sources", `${key}.json`), source);
			copyFileSync(
				join(parentState.workspace, "sources", `${key}.spans.jsonl`),
				join(workspace, "sources", `${key}.spans.jsonl`),
			);
		}
		copyFilteredJsonl(
			join(parentState.workspace, "manifest.jsonl"),
			join(workspace, "manifest.jsonl"),
			(record) => inheritedSourceIds.has(record.sourceId as string),
			(record) => {
				const document = inheritedDocuments.find((item) => item.sourceId === record.sourceId);
				return { ...record, uri: document ? join(workspace, "corpus", document.path) : record.uri };
			},
		);
		copyFilteredJsonl(
			join(parentState.workspace, "runs", "compile-state.jsonl"),
			join(workspace, "runs", "compile-state.jsonl"),
			(record) => inheritedSourceIds.has(record.sourceId as string),
		);
		for (const inheritedTimeline of parentState.timelines) {
			if (
				EVOLUTION_TIMELINES.indexOf(inheritedTimeline.timeline) >
				EVOLUTION_TIMELINES.indexOf(timeline)
			) {
				continue;
			}
			mkdirSync(join(workspace, "versions"), { recursive: true });
			copyFileSync(
				join(parentState.workspace, "versions", `${inheritedTimeline.snapshotId}.json.gz`),
				join(workspace, "versions", `${inheritedTimeline.snapshotId}.json.gz`),
			);
		}

		const inheritedById = new Map(
			inheritedDocuments.map((document) => [document.documentId, document]),
		);
		const state: ExperimentState = {
			schemaVersion: "wge-evolution-experiment/v1",
			runId: options.runId,
			datasetId: manifest.datasetId,
			datasetHash,
			configHash,
			createdAt: new Date().toISOString(),
			repoCommit: gitCommit(),
			workspace,
			documents: manifest.documents.map((document) => {
				const inherited = inheritedById.get(document.documentId);
				return inherited ? { ...inherited } : { ...document, status: "PENDING" };
			}),
			timelines: parentState.timelines.filter(
				(item) =>
					EVOLUTION_TIMELINES.indexOf(item.timeline) <= EVOLUTION_TIMELINES.indexOf(timeline),
			),
			parent: {
				runId: parentState.runId,
				timeline,
				snapshotId: parentTimeline.snapshotId,
				repoCommit: parentState.repoCommit,
				knowledgeVersion: parentTimeline.knowledgeVersion,
			},
		};
		const childConfig = isolatedConfig(workspace, experimentConfig);
		if (currentKnowledgeVersion(childConfig) !== parentTimeline.knowledgeVersion) {
			throw new Error("fork 后知识版本与父快照不一致");
		}
		writeJsonAtomic(join(runDirectory, "state.json"), state);
		writeJsonAtomic(join(runDirectory, "dataset-manifest.json"), manifest);
		writeJsonAtomic(join(runDirectory, "questions.json"), questions);
		console.log(JSON.stringify({ runId: state.runId, parent: state.parent, workspace }, null, 2));
	});

program
	.command("ingest")
	.description("Compile one exact timeline into the isolated workspace")
	.requiredOption("--run-id <id>", "Experiment run ID")
	.requiredOption("--timeline <timeline>", "T0, T1, T2, or T3")
	.option("--apply-audited", "Apply only candidates approved in a complete approval artifact")
	.option("--approval-file <path>", "Per-relation approval artifact required by --apply-audited")
	.option(
		"--accept-missing-evolution",
		"Finalize T2/T3 even when no allowlisted evolution relation was produced; records a hard gap",
	)
	.action(
		(options: {
			runId: string;
			timeline: string;
			applyAudited?: boolean;
			approvalFile?: string;
			acceptMissingEvolution?: boolean;
		}) => {
			const timeline = parseTimeline(options.timeline);
			const runDirectory = resolveRunDirectory(options.runId);
			const statePath = join(runDirectory, "state.json");
			const state = readJson<ExperimentState>(statePath);
			assertFrozenCode(state);
			const experimentConfig = assertExperimentConfig(state);
			assertStateWorkspace(runDirectory, state);
			assertTimelineTransition(
				state.timelines.map((item) => item.timeline),
				timeline,
			);
			const timelineDocuments = state.documents.filter((item) => item.timeline === timeline);
			for (const document of timelineDocuments) {
				if (document.status === "COMPLETED") continue;
				document.status = "RUNNING";
				document.error = undefined;
				writeJsonAtomic(statePath, state);
				try {
					const output = ingestDocument(state.workspace, document.path, experimentConfig.compiler);
					document.status = "COMPLETED";
					document.sourceId = output.source;
					document.compileRunId = output.runId;
					writeJsonAtomic(statePath, state);
					console.error(`completed ${timeline} ${document.documentId}`);
				} catch (error) {
					document.status = "FAILED";
					document.error = error instanceof Error ? error.message : String(error);
					writeJsonAtomic(statePath, state);
					throw error;
				}
			}
			if (timelineDocuments.some((item) => item.status !== "COMPLETED")) {
				throw new Error(`${timeline} 尚有未完成文档`);
			}

			const config = isolatedConfig(state.workspace, experimentConfig);
			const candidates = findEvolutionCandidates(config, state, timeline);
			const evolutionCoverage =
				timeline === "T2" || timeline === "T3"
					? coverageForTimeline(state, timeline, candidates)
					: null;
			let appliedIds: string[] = [];
			let approval: EvolutionApproval | null = null;
			let missingEvolutionAccepted = false;
			if (timeline === "T2" || timeline === "T3") {
				if (
					(evolutionCoverage?.missingDocumentIds.length ?? 0) > 0 &&
					!options.acceptMissingEvolution
				) {
					writeJsonAtomic(join(runDirectory, "timelines", timeline, "evolution-candidates.json"), {
						timeline,
						candidates,
						evolutionCoverage,
						status: "INCOMPLETE_EVOLUTION_COVERAGE",
					});
					throw new Error(
						`${timeline} 演化覆盖不完整：缺少 ${evolutionCoverage?.missingDocumentIds.join(", ")}`,
					);
				}
				if (candidates.length > 0 && !options.applyAudited) {
					writeJsonAtomic(join(runDirectory, "timelines", timeline, "evolution-candidates.json"), {
						timeline,
						candidates,
						evolutionCoverage,
						status: "AWAITING_EXPLICIT_APPLY",
					});
					throw new Error(
						`${timeline} 有 ${candidates.length} 条候选；需 --apply-audited 明确应用`,
					);
				}
				if (candidates.length > 0) {
					if (!options.approvalFile) {
						throw new Error("--apply-audited 必须同时提供 --approval-file，禁止整批盲批");
					}
					approval = validateEvolutionApproval(
						readJson<EvolutionApproval>(resolve(options.approvalFile)),
						state.runId,
						timeline,
						candidates.map((item) => item.id),
					);
					const approved = candidates.filter((item) =>
						approval?.approvedRelationIds.includes(item.id),
					);
					const approvedCoverage = coverageForTimeline(state, timeline, approved);
					if (approvedCoverage.missingDocumentIds.length > 0) {
						throw new Error(
							`批准子集演化覆盖不完整：缺少 ${approvedCoverage.missingDocumentIds.join(", ")}`,
						);
					}
					const result = applyKnowledgeEvolution(
						config,
						approved.map((item) => item.id),
						currentKnowledgeVersion(config),
					);
					appliedIds = result.impact.triggerRelationIds;
				}
				missingEvolutionAccepted =
					(evolutionCoverage?.missingDocumentIds.length ?? 0) > 0 &&
					options.acceptMissingEvolution === true;
			}
			const snapshot = createKnowledgeSnapshot(config, `${state.runId} ${timeline} completed`);
			const timelineState: ExperimentTimelineState = {
				timeline,
				completedAt: new Date().toISOString(),
				knowledgeVersion: currentKnowledgeVersion(config),
				snapshotId: snapshot.id,
				evolutionCandidateIds: candidates.map((item) => item.id),
				evolutionAppliedIds: appliedIds,
				evolutionCoverage,
				missingEvolutionAccepted,
			};
			state.timelines.push(timelineState);
			writeJsonAtomic(statePath, state);
			writeJsonAtomic(join(runDirectory, "timelines", timeline, "evolution-candidates.json"), {
				timeline,
				candidates,
				appliedIds,
				evolutionCoverage,
				missingEvolutionAccepted,
				approval,
			});
			console.log(
				JSON.stringify({ ...timelineState, knowledge: knowledgeSummary(config) }, null, 2),
			);
		},
	);

program
	.command("prepare")
	.description(
		"Prepare B/P/E-min contexts and document-level retrieval metrics for the latest timeline",
	)
	.requiredOption("--run-id <id>", "Experiment run ID")
	.requiredOption("--timeline <timeline>", "Completed timeline to inspect")
	.action((options: { runId: string; timeline: string }) => {
		const timeline = parseTimeline(options.timeline);
		const runDirectory = resolveRunDirectory(options.runId);
		const state = readJson<ExperimentState>(join(runDirectory, "state.json"));
		assertFrozenCode(state);
		const experimentConfig = assertExperimentConfig(state);
		assertStateWorkspace(runDirectory, state);
		const latest = state.timelines.at(-1)?.timeline;
		if (latest !== timeline) {
			throw new Error(`只能为当前 workspace 最新 timeline=${latest ?? "<none>"} 生成上下文`);
		}
		const questions = readJson<QuestionFile>(join(runDirectory, "questions.json"));
		const activeDocuments = state.documents.filter(
			(item) => EVOLUTION_TIMELINES.indexOf(item.timeline) <= EVOLUTION_TIMELINES.indexOf(timeline),
		);
		const sourceToDocument = new Map(
			activeDocuments
				.filter((item) => item.sourceId)
				.map((item) => [item.sourceId as string, item.documentId]),
		);
		const pathToDocument = new Map(
			activeDocuments.map((item) => [`corpus/${item.path}`, item.documentId]),
		);
		const config = isolatedConfig(state.workspace, experimentConfig);
		const pilotConfig = experimentPilotConfig(
			activeDocuments.map((item) => `corpus/${item.path}`),
			experimentConfig,
		);
		const observations = [];
		for (const question of questions.questions) {
			for (const group of groups) {
				const prepared = preparePilotContext(
					config,
					pilotConfig,
					{ id: question.id, question: question.question },
					group,
				);
				const retrievedDocumentIds = [
					...new Set(
						prepared.retrievedSources
							.map((source) =>
								group === "B" ? pathToDocument.get(source) : sourceToDocument.get(source),
							)
							.filter((id): id is string => id !== undefined),
					),
				].sort();
				const gold = question.goldByTimeline[timeline];
				const record = {
					...prepared,
					timeline,
					category: question.category,
					expectedDocumentIds: gold.sourceDocumentIds,
					retrievedDocumentIds,
					answerability: gold.answerability,
					contextEmpty: prepared.context.trim().length === 0,
				};
				writeJsonAtomic(
					join(runDirectory, "timelines", timeline, "contexts", `${question.id}--${group}.json`),
					record,
				);
				observations.push({
					questionId: question.id,
					group,
					expectedDocumentIds: gold.sourceDocumentIds,
					retrievedDocumentIds,
					contextEmpty: record.contextEmpty,
				});
			}
		}
		const report = {
			runId: state.runId,
			timeline,
			knowledgeVersion: currentKnowledgeVersion(config),
			knowledge: knowledgeSummary(config),
			retrieval: summarizeRetrieval(observations),
			generatedAt: new Date().toISOString(),
		};
		writeJsonAtomic(join(runDirectory, "timelines", timeline, "retrieval-report.json"), report);
		console.log(JSON.stringify(report, null, 2));
	});

program.parseAsync(process.argv).catch((error: unknown) => {
	console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
	process.exitCode = 1;
});

function selectedDatasetRoot(): string {
	return resolve(program.opts<{ dataset: string }>().dataset);
}

function initializeWorkspace(
	workspace: string,
	datasetRoot: string,
	manifest: DatasetManifest,
): void {
	for (const directory of [
		"corpus",
		"sources",
		"wiki",
		"quarantine",
		"indexes",
		"runs",
		"publications",
	]) {
		mkdirSync(join(workspace, directory), { recursive: true });
	}
	for (const document of manifest.documents) {
		const source = resolveDatasetFile(datasetRoot, document.path);
		const target = join(workspace, "corpus", document.path);
		mkdirSync(dirname(target), { recursive: true });
		copyFileSync(source, target);
	}
}

function writeInheritedFile(workspace: string, relativePath: string, content: string): void {
	const absolute = resolve(workspace, relativePath);
	const prefix = `${resolve(workspace)}${sep}`;
	if (!absolute.startsWith(prefix)) throw new Error(`父快照路径越界: ${relativePath}`);
	mkdirSync(dirname(absolute), { recursive: true });
	writeFileSync(absolute, content, { encoding: "utf-8", flag: "wx" });
}

function copyFilteredJsonl(
	source: string,
	target: string,
	filter: (record: Record<string, unknown>) => boolean,
	map: (record: Record<string, unknown>) => Record<string, unknown> = (record) => record,
): void {
	const records = readFileSync(source, "utf-8")
		.split(/\r?\n/u)
		.filter((line) => line.trim().length > 0)
		.map((line) => JSON.parse(line) as Record<string, unknown>)
		.filter(filter)
		.map(map);
	mkdirSync(dirname(target), { recursive: true });
	writeFileSync(target, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`, {
		encoding: "utf-8",
		flag: "wx",
	});
}

function validateDataset(datasetRoot: string): void {
	const result = spawnSync(
		process.execPath,
		[
			"--import",
			"tsx",
			join(repositoryRoot, "scripts", "validate-evolution-dataset.ts"),
			datasetRoot,
		],
		{ cwd: repositoryRoot, encoding: "utf-8", maxBuffer: 16 * 1024 * 1024 },
	);
	if (result.status !== 0) {
		throw new Error(`数据集验证失败\n${result.stdout}\n${result.stderr}`);
	}
}

function ingestDocument(
	workspace: string,
	documentPath: string,
	compiler: ExperimentConfig["compiler"],
): IngestOutput {
	const absoluteDocument = join(workspace, "corpus", documentPath);
	const result = spawnSync(
		process.execPath,
		[
			"--import",
			"tsx",
			join(repositoryRoot, "src", "cli", "index.ts"),
			"--project-root",
			workspace,
			"ingest",
			absoluteDocument,
			"--json",
		],
		{
			cwd: repositoryRoot,
			encoding: "utf-8",
			env: {
				...process.env,
				WGE_MODEL: compiler.model,
				WGE_TEMPERATURE: String(compiler.temperature),
			},
			maxBuffer: 64 * 1024 * 1024,
			timeout: 45 * 60 * 1000,
		},
	);
	if (result.status !== 0) {
		throw new Error(`摄入失败: ${documentPath}\n${result.stderr}\n${result.stdout}`);
	}
	const output = JSON.parse(result.stdout.trim()) as IngestOutput;
	if (output.compileState !== "COMPLETED" || !output.source || !output.runId) {
		throw new Error(`摄入未完成: ${documentPath} -> ${result.stdout}`);
	}
	return output;
}

function findEvolutionCandidates(
	config: ReturnType<typeof isolatedConfig>,
	state: ExperimentState,
	timeline: EvolutionTimeline,
) {
	if (timeline === "T0" || timeline === "T1") return [];
	const publications = readSourcePublications(config);
	const claimOwner = new Map<string, string>();
	for (const publication of publications) {
		for (const claim of publication.claims) claimOwner.set(claim.id, publication.sourceId);
	}
	const documents = state.documents.filter((item) => item.timeline === timeline);
	const sourceIds = new Set(documents.map((item) => item.sourceId).filter(Boolean) as string[]);
	const targetSourceIds = new Set(
		documents
			.flatMap((item) => item.targetDocumentIds)
			.map((id) => state.documents.find((item) => item.documentId === id)?.sourceId)
			.filter(Boolean) as string[],
	);
	return readAllRelations(config)
		.filter(
			(relation) =>
				relation.publicationState === "CANONICAL" &&
				relation.lifecycle === "ACTIVE" &&
				relation.validity === "SUPPORTED" &&
				relation.conditionStatus !== "UNVERIFIED" &&
				relation.relationAuditVersion === RELATION_AUDIT_VERSION,
		)
		.filter((relation) => {
			const fromOwner = claimOwner.get(relation.from as string);
			const toOwner = claimOwner.get(relation.to as string);
			if (!fromOwner || !toOwner) return false;
			if (timeline === "T2") {
				return (
					relation.type === "SUPERSEDES" &&
					relation.supersessionEffect === "TOTAL_TO_CLAIM" &&
					sourceIds.has(fromOwner) &&
					targetSourceIds.has(toOwner)
				);
			}
			return relation.type === "CONTRADICTS" && sourceIds.has(fromOwner) && sourceIds.has(toOwner);
		})
		.map((relation) => ({
			id: relation.id,
			type: relation.type,
			from: relation.from,
			to: relation.to,
			conditions: relation.conditions,
			supersessionEffect: relation.supersessionEffect,
			evidenceSpanIds: relation.evidenceSpanIds,
			fromSourceId: claimOwner.get(relation.from as string) as string,
			toSourceId: claimOwner.get(relation.to as string) as string,
		}))
		.sort((left, right) => left.id.localeCompare(right.id));
}

function coverageForTimeline(
	state: ExperimentState,
	timeline: "T2" | "T3",
	candidates: Array<{ fromSourceId: string; toSourceId: string }>,
): EvolutionCoverage {
	const expected = state.documents
		.filter((document) => document.timeline === timeline)
		.map((document) => {
			if (!document.sourceId) throw new Error(`${document.documentId} 缺少 sourceId`);
			return {
				documentId: document.documentId,
				sourceId: document.sourceId,
				targetSourceIds: document.targetDocumentIds.map((targetDocumentId) => {
					const target = state.documents.find((item) => item.documentId === targetDocumentId);
					if (!target?.sourceId)
						throw new Error(`${document.documentId} 的目标 ${targetDocumentId} 缺少 sourceId`);
					return target.sourceId;
				}),
			};
		});
	return summarizeEvolutionCoverage(timeline, expected, candidates);
}

function experimentPilotConfig(corpus: string[], config: ExperimentConfig): PilotConfig {
	return {
		schemaVersion: "wge-pilot-config/v1",
		status: "LOCKED",
		corpus,
		compiler: config.compiler,
		answer: config.answer,
		judge: config.judge,
		retrieval: config.retrieval,
		execution: config.execution,
	};
}

function isolatedConfig(workspace: string, config: ExperimentConfig) {
	return loadConfig({
		projectRoot: workspace,
		model: config.compiler.model,
		temperature: config.compiler.temperature,
	});
}

function knowledgeSummary(config: ReturnType<typeof isolatedConfig>) {
	const sources = readAllSources(config);
	return {
		sources: sources.length,
		completedSources: sources.filter((source) => getCompileState(config, source.id) === "COMPLETED")
			.length,
		claims: readAllClaims(config).length,
		concepts: readAllConcepts(config).length,
		relations: readAllRelations(config).length,
		wikiModules: readAllWikiModules(config).length,
	};
}

function parseTimeline(value: string): EvolutionTimeline {
	if (!EVOLUTION_TIMELINES.includes(value as EvolutionTimeline)) {
		throw new Error(`非法 timeline: ${value}`);
	}
	return value as EvolutionTimeline;
}

function resolveRunDirectory(runId: string): string {
	if (!/^[a-zA-Z0-9._-]+$/.test(runId)) throw new Error(`非法 runId: ${runId}`);
	const path = resolve(experimentRunsRoot, runId);
	const prefix = `${resolve(experimentRunsRoot)}${sep}`;
	if (!path.startsWith(prefix)) throw new Error(`runId 路径越界: ${runId}`);
	return path;
}

function assertStateWorkspace(runDirectory: string, state: ExperimentState): void {
	const expected = resolve(runDirectory, "workspace");
	if (resolve(state.workspace) !== expected) throw new Error("实验 state workspace 路径不匹配");
	if (resolve(state.workspace) === repositoryRoot) throw new Error("拒绝在主知识库运行演化实验");
}

function resolveDatasetFile(datasetRoot: string, path: string): string {
	const absolute = resolve(datasetRoot, path);
	const prefix = `${resolve(datasetRoot)}${sep}`;
	if (!absolute.startsWith(prefix) || relative(datasetRoot, absolute).startsWith("..")) {
		throw new Error(`数据路径越界: ${path}`);
	}
	if (!existsSync(absolute)) throw new Error(`找不到数据文档: ${path}`);
	return absolute;
}

function hashDataset(
	datasetRoot: string,
	manifest: DatasetManifest,
	questions: QuestionFile,
): string {
	const hash = createHash("sha256");
	hash.update(JSON.stringify(manifest));
	hash.update(JSON.stringify(questions));
	for (const document of [...manifest.documents].sort((a, b) => a.path.localeCompare(b.path))) {
		hash.update(document.path);
		hash.update(readFileSync(resolveDatasetFile(datasetRoot, document.path)));
	}
	return `dataset:${hash.digest("hex").slice(0, 24)}`;
}

function readExperimentConfig(): ExperimentConfig {
	const config = readJson<ExperimentConfig>(experimentConfigPath);
	if (config.schemaVersion !== "wge-evolution-experiment-config/v1" || config.status !== "LOCKED") {
		throw new Error("演化实验配置必须是 LOCKED 的 wge-evolution-experiment-config/v1");
	}
	if (config.compiler.temperature !== 0)
		throw new Error("演化实验 compiler temperature 必须锁定为 0");
	if (config.execution.externalRetrievalNetwork !== false) {
		throw new Error("演化实验禁止外部检索网络");
	}
	if (JSON.stringify(config.execution.groups) !== JSON.stringify(groups)) {
		throw new Error("演化实验组必须严格为 B/P/E-min");
	}
	return config;
}

function assertExperimentConfig(state: ExperimentState): ExperimentConfig {
	const config = readExperimentConfig();
	const currentHash = hashJson("config", config);
	if (state.configHash !== currentHash) {
		throw new Error(`实验配置已漂移: state=${state.configHash}, current=${currentHash}`);
	}
	return config;
}

function hashJson(prefix: string, value: unknown): string {
	const digest = createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
	return `${prefix}:${digest}`;
}

function gitCommit(): string {
	const result = spawnSync("git", ["rev-parse", "HEAD"], {
		cwd: repositoryRoot,
		encoding: "utf-8",
	});
	if (result.status !== 0) throw new Error("无法读取 Git commit");
	return result.stdout.trim();
}

function assertCleanWorktree(): void {
	const result = spawnSync("git", ["status", "--porcelain"], {
		cwd: repositoryRoot,
		encoding: "utf-8",
	});
	if (result.status !== 0) throw new Error("无法检查 Git worktree");
	if (result.stdout.trim().length > 0) {
		throw new Error("初始化实验前必须提交或清理所有 Git 变更，以冻结可复现代码版本");
	}
}

function assertFrozenCode(state: ExperimentState): void {
	assertCleanWorktree();
	const current = gitCommit();
	if (state.repoCommit !== current) {
		throw new Error(`实验代码版本已漂移: state=${state.repoCommit}, current=${current}`);
	}
}

function readJson<T>(path: string): T {
	if (!existsSync(path)) throw new Error(`找不到文件: ${path}`);
	return JSON.parse(readFileSync(path, "utf-8")) as T;
}

function writeJsonAtomic(path: string, value: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
	writeFileSync(temporary, JSON.stringify(value, null, 2), { encoding: "utf-8", flag: "wx" });
	renameSync(temporary, path);
}
