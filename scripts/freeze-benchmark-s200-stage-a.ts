import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dump, load } from "js-yaml";
import { loadConfig } from "../src/config/index.js";

type JsonRecord = Record<string, unknown>;

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const stageRoot = resolve(
	process.argv[2] ?? join(projectRoot, "benchmark-s200-stage-a-v1.1-candidate"),
);
const freezeRoot = resolve(
	process.argv[3] ?? join(projectRoot, "experiments", "goal3", "s200-stage-a-freeze-v1"),
);
const temporaryRoot = `${freezeRoot}.tmp`;
const validationPath = join(
	projectRoot,
	"experiments",
	"goal3",
	"s200-stage-a-freeze-validation-v1.json",
);

if (existsSync(freezeRoot)) throw new Error(`S200 Stage A freeze is immutable: ${freezeRoot}`);
rmSync(temporaryRoot, { recursive: true, force: true });

execFileSync(
	process.execPath,
	[
		"--import",
		"tsx",
		join(projectRoot, "scripts", "validate-benchmark-s200-stage-a.ts"),
		stageRoot,
		validationPath,
	],
	{ cwd: projectRoot, stdio: "inherit" },
);
const validation = readJson(validationPath);
if (validation.status !== "ACCEPT" || validation.stageBRead !== false) {
	throw new Error(`Stage A validation is not freeze-safe: ${String(validation.status)}`);
}

const contract = readJson(join(stageRoot, "contract-manifest.json"));
const producerInventory = requireRecord(contract, "fileInventory");
const sourceRows = readJsonl(join(stageRoot, "manifests", "source-manifest.jsonl"));
const questionPath = join(stageRoot, "questions", "questions-public.jsonl");
const episodePath = join(stageRoot, "episodes", "episodes-public.jsonl");
const questions = readJsonl(questionPath);
const episodes = readJsonl(episodePath);
if (sourceRows.length !== 140 || questions.length !== 60 || episodes.length !== 20) {
	throw new Error(
		`S200 count drift: sources=${sourceRows.length}, questions=${questions.length}, episodes=${episodes.length}`,
	);
}

mkdirSync(join(temporaryRoot, "compilation-corpus"), { recursive: true });
const sourceAudit: JsonRecord[] = [];
const normalizationAudit: JsonRecord[] = [];
const seenSourceIds = new Set<string>();
for (const row of sourceRows) {
	const sourceId = requireString(row, "sourceId");
	if (seenSourceIds.has(sourceId))
		throw new Error(`Duplicate sourceId while freezing: ${sourceId}`);
	seenSourceIds.add(sourceId);
	const contentPath = requireString(row, "contentPath");
	const sourcePath = join(stageRoot, contentPath);
	const sourceBytes = readFileSync(sourcePath);
	const sourceText = normalizeNewlines(sourceBytes.toString("utf8"));
	const metadata = parseFrontmatter(sourceText);
	if (requireString(metadata, "sourceId") !== sourceId) {
		throw new Error(`${sourceId}: frontmatter identity drift`);
	}
	const artifactHash = sha256Bytes(sourceBytes);
	const declaredArtifactHash = stripHash(row.artifactHash);
	const inventoryHash = stripHash(producerInventory[contentPath]);
	if (artifactHash !== declaredArtifactHash || artifactHash !== inventoryHash) {
		throw new Error(`${sourceId}: producer artifact hash mismatch during freeze`);
	}
	const rawSnapshot = extractSnapshot(sourceText);
	const rawSnapshotHash = sha256(rawSnapshot);
	if (rawSnapshotHash !== stripHash(row.snapshotHash)) {
		throw new Error(`${sourceId}: producer snapshot hash mismatch during freeze`);
	}
	const normalized = normalizeEvaluatorSnapshot(sourceId, rawSnapshot);
	for (const change of normalized.changes) normalizationAudit.push(change);
	const compilationMetadata = {
		sourceId,
		title: requireString(row, "title"),
		domain: requireString(row, "domain"),
		clusterId: requireString(row, "clusterId"),
		sourceRole: requireString(row, "sourceRole"),
		platform: requireString(row, "platform"),
		author: requireString(row, "author"),
		canonicalUrl: requireString(row, "canonicalUrl"),
		publishedAt: String(row.publishedAt ?? "unknown"),
		capturedAt: String(row.capturedAt ?? "unknown"),
		versionRef: String(row.versionRef ?? "null"),
		mediaType: requireString(row, "mediaType"),
		language: requireString(row, "language"),
		usage: requireString(row, "usage"),
		accessStatus: requireString(row, "accessStatus"),
		evaluatorRawSnapshotHash: `sha256:${rawSnapshotHash}`,
		evaluatorNormalizedSnapshotHash: `sha256:${sha256(normalized.text)}`,
		evaluatorUpstreamArtifactHash: `sha256:${artifactHash}`,
	};
	const compilation = `---\n${dump(compilationMetadata, { lineWidth: 120 }).trim()}\n---\n\n# ${compilationMetadata.title}\n\n## Source Snapshot\n\n${normalized.text}`;
	const outputPath = join(
		temporaryRoot,
		"compilation-corpus",
		compilationMetadata.domain,
		`${sourceId}.md`,
	);
	mkdirSync(dirname(outputPath), { recursive: true });
	writeFileSync(outputPath, compilation, "utf8");
	sourceAudit.push({
		sourceId,
		domain: compilationMetadata.domain,
		clusterId: compilationMetadata.clusterId,
		sourceRole: compilationMetadata.sourceRole,
		canonicalUrl: compilationMetadata.canonicalUrl,
		inputPath: contentPath,
		inputArtifactHash: `sha256:${artifactHash}`,
		rawSnapshotHash: `sha256:${rawSnapshotHash}`,
		normalizedSnapshotHash: `sha256:${sha256(normalized.text)}`,
		compilationPath: relative(temporaryRoot, outputPath),
		compilationHash: `sha256:${sha256(compilation)}`,
		normalizationCount: normalized.changes.length,
	});
}

const runtime = loadConfig({ projectRoot });
const config = {
	schemaVersion: "wge-s200-g3c-config/v1",
	status: "LOCKED_STAGE_A_DEV_SCALE",
	interpretation:
		"S200 is a Stage-A-frozen Dev/scale gate, not a Blind result. Stage B remains unread until candidate outputs are sealed.",
	compiler: { model: runtime.model, temperature: 0, thinkingDisabled: true },
	answer: {
		model: runtime.model,
		temperature: 0,
		thinkingDisabled: true,
		maxOutputTokens: 1600,
	},
	retrieval: {
		contextBudgetTokens: 12000,
		maxGraphDepth: 3,
		maxFolderChunks: 16,
		folderChunkChars: 1800,
	},
	arms: ["B", "R0", "R1"],
	contextTransports: ["LEGACY", "COMPACT_V1"],
	externalRetrievalNetwork: false,
	maxToolCalls: 1,
	stageBRead: false,
};

writeJson(join(temporaryRoot, "config.json"), config);
writeFileSync(join(temporaryRoot, "questions-public.jsonl"), readFileSync(questionPath));
writeFileSync(join(temporaryRoot, "episodes-public.jsonl"), readFileSync(episodePath));
writeJson(join(temporaryRoot, "source-audit.json"), sourceAudit);
writeJson(join(temporaryRoot, "normalization-audit.json"), {
	schemaVersion: "wge-s200-evaluator-normalization-audit/v1",
	policy:
		"Only three predeclared curator annotations are normalized; factual body text, source identity and raw hashes remain frozen and auditable.",
	changes: normalizationAudit,
});
writeJson(join(temporaryRoot, "pre-freeze-git.json"), {
	headCommit: git(["rev-parse", "HEAD"]),
	trackedDiffHash: `sha256:${sha256(git(["diff", "--binary"]))}`,
	statusHash: `sha256:${sha256(git(["status", "--porcelain=v1", "--untracked-files=all"]))}`,
	implementation: implementationPointers(),
});
writeFileSync(join(temporaryRoot, "FREEZE_READY"), "ACCEPTED_STAGE_A_DEV_SCALE\n", "utf8");

const inventory = listFiles(temporaryRoot).map((path) => ({
	path: relative(temporaryRoot, path),
	sha256: `sha256:${sha256Bytes(readFileSync(path))}`,
}));
const treeHash = sha256(inventory.map((entry) => `${entry.path}\u0000${entry.sha256}\n`).join(""));
writeJson(join(temporaryRoot, "freeze-manifest.json"), {
	schemaVersion: "wge-s200-stage-a-freeze/v1",
	status: "ACCEPTED_STAGE_A_DEV_SCALE",
	stageBRead: false,
	sourceCount: sourceRows.length,
	questionCount: questions.length,
	episodeCount: episodes.length,
	questionFileSha256: `sha256:${sha256Bytes(readFileSync(questionPath))}`,
	episodeFileSha256: `sha256:${sha256Bytes(readFileSync(episodePath))}`,
	producerTreeHash: validation.treeHash,
	evaluatorTreeHashExcludingManifest: `sha256:${treeHash}`,
	normalizationCount: normalizationAudit.length,
	fileInventoryExcludingManifest: inventory,
	createdAt: new Date().toISOString(),
});

mkdirSync(dirname(freezeRoot), { recursive: true });
renameSync(temporaryRoot, freezeRoot);
console.log(
	JSON.stringify(
		{
			status: "ACCEPTED_STAGE_A_DEV_SCALE",
			freezeRoot,
			sourceCount: sourceRows.length,
			questionCount: questions.length,
			episodeCount: episodes.length,
			normalizationCount: normalizationAudit.length,
			evaluatorTreeHashExcludingManifest: `sha256:${treeHash}`,
			stageBRead: false,
		},
		null,
		2,
	),
);

function normalizeEvaluatorSnapshot(
	sourceId: string,
	value: string,
): { text: string; changes: JsonRecord[] } {
	const rules = [
		{
			id: "SWE_BENCH_CURATOR_BANNER_SUFFIX",
			from: "Check out the other projects that are part of the SWE-bench ecosystem! (SWE-agent, SWE-smith, SWE-rex, CodeClash, SWE-bench CLI, mini-swe — banners omitted)",
			to: "Check out the other projects that are part of the SWE-bench ecosystem!",
		},
		{
			id: "RELEASE_BODY_CURATOR_HEADING",
			from: "### Highlights (verbatim from release body)",
			to: "### Highlights",
		},
		{
			id: "RELEASE_ASSET_CURATOR_HEADING",
			from: "### Asset (verbatim from release assets)",
			to: "### Asset",
		},
	] as const;
	let text = value;
	const changes: JsonRecord[] = [];
	for (const rule of rules) {
		const occurrences = text.split(rule.from).length - 1;
		if (occurrences === 0) continue;
		text = text.replaceAll(rule.from, rule.to);
		changes.push({ sourceId, ruleId: rule.id, occurrences, from: rule.from, to: rule.to });
	}
	return { text, changes };
}

function implementationPointers(): JsonRecord[] {
	return [
		"src/retrieval/structured-pack-renderer.ts",
		"src/context-pack/compact-transport.ts",
		"src/context-pack/compact-transport.test.ts",
		"scripts/freeze-benchmark-s200-stage-a.ts",
	].map((path) => ({
		path,
		sha256: `sha256:${sha256Bytes(readFileSync(join(projectRoot, path)))}`,
	}));
}

function extractSnapshot(content: string): string {
	const match =
		/(?:^|\n)## Source Snapshot\s*\n([\s\S]*?)(?=\n## Research Notes\s*(?:\n|$)|$)/u.exec(content);
	if (!match?.[1]) throw new Error("Source artifact has no Source Snapshot section");
	return `${match[1].trim()}\n`;
}

function parseFrontmatter(content: string): JsonRecord {
	const match = /^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/u.exec(content);
	if (!match?.[1]) throw new Error("Source artifact has no YAML frontmatter");
	const parsed = load(match[1]);
	if (!isRecord(parsed)) throw new Error("Source frontmatter is not an object");
	return parsed;
}

function readJson(path: string): JsonRecord {
	const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
	if (!isRecord(parsed)) throw new Error(`Expected JSON object: ${path}`);
	return parsed;
}

function readJsonl(path: string): JsonRecord[] {
	return readFileSync(path, "utf8")
		.split("\n")
		.filter((line) => line.trim().length > 0)
		.map((line) => {
			const parsed: unknown = JSON.parse(line);
			if (!isRecord(parsed)) throw new Error(`Expected JSONL object in ${path}`);
			return parsed;
		});
}

function requireRecord(value: JsonRecord, key: string): JsonRecord {
	const candidate = value[key];
	if (!isRecord(candidate)) throw new Error(`Expected object: ${key}`);
	return candidate;
}

function requireString(value: JsonRecord, key: string): string {
	const candidate = value[key];
	if (typeof candidate !== "string" || candidate.length === 0)
		throw new Error(`Expected string: ${key}`);
	return candidate;
}

function stripHash(value: unknown): string {
	if (typeof value !== "string") throw new Error("Expected sha256 string");
	return value.replace(/^sha256:/u, "");
}

function isRecord(value: unknown): value is JsonRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeNewlines(value: string): string {
	return value.replaceAll("\r\n", "\n");
}

function listFiles(root: string): string[] {
	return readdirSync(root, { withFileTypes: true })
		.flatMap((entry) => {
			const path = join(root, entry.name);
			return entry.isDirectory() ? listFiles(path) : [path];
		})
		.sort();
}

function writeJson(path: string, value: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function sha256Bytes(value: Buffer): string {
	return createHash("sha256").update(value).digest("hex");
}

function git(args: string[]): string {
	return execFileSync("git", args, { cwd: projectRoot, encoding: "utf8" }).trim();
}
