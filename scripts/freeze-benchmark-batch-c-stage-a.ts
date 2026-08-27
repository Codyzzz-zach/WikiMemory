import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dump, load } from "js-yaml";

type JsonRecord = Record<string, unknown>;

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const stageRoot = join(projectRoot, "batch-c-stage-a");
const experimentRoot = join(projectRoot, "experiments", "benchmark-batch-c");
const freezeRoot = join(experimentRoot, "stage-a-freeze");
const temporaryRoot = `${freezeRoot}.tmp`;
const producerManifest = readJson<JsonRecord>(join(stageRoot, "contract-manifest.json"));
const producerInventory = requireRecord(producerManifest, "fileInventory");

if (existsSync(freezeRoot)) {
	throw new Error(`Stage A freeze already exists and is immutable: ${freezeRoot}`);
}
rmSync(temporaryRoot, { recursive: true, force: true });
mkdirSync(join(temporaryRoot, "compilation-corpus"), { recursive: true });

const expectedStaticFiles = [
	"README.md",
	"contract-manifest.json",
	"manifests/source-manifest.jsonl",
	"questions/questions-public.jsonl",
	"reports/coverage-matrix.md",
	"reports/collection-log.md",
	"reports/overlap-check.md",
	"reports/unresolved-and-access-failures.md",
];
for (const path of expectedStaticFiles) {
	if (!existsSync(join(stageRoot, path))) throw new Error(`Missing Stage A file: ${path}`);
}

const sourcePaths = listFiles(join(stageRoot, "corpus")).filter((path) => path.endsWith(".md"));
if (sourcePaths.length !== 12) throw new Error(`Expected 12 sources, got ${sourcePaths.length}`);
const sourceManifestRows = readJsonl(join(stageRoot, "manifests", "source-manifest.jsonl"));
if (sourceManifestRows.length !== 12)
	throw new Error(`Expected 12 source manifest rows, got ${sourceManifestRows.length}`);
const sourceManifestById = new Map(
	sourceManifestRows.map((row) => [requireString(row, "sourceId"), row] as const),
);

const inventoryMismatches: JsonRecord[] = [];
const sourceAudit: JsonRecord[] = [];
const seenSourceIds = new Set<string>();
const canonicalUrls = new Set<string>();
for (const sourcePath of sourcePaths) {
	const content = normalizeNewlines(readFileSync(sourcePath, "utf8"));
	const metadata = parseFrontmatter(content);
	const sourceId = requireString(metadata, "sourceId");
	if (seenSourceIds.has(sourceId)) throw new Error(`Duplicate sourceId: ${sourceId}`);
	seenSourceIds.add(sourceId);
	const manifestRow = sourceManifestById.get(sourceId);
	if (!manifestRow) throw new Error(`Source missing from manifest: ${sourceId}`);
	const canonicalUrl = requireString(metadata, "canonicalUrl");
	canonicalUrls.add(canonicalUrl);
	for (const key of ["title", "domain", "sourceRole", "canonicalUrl", "publishedAt"]) {
		if (comparableScalar(metadata[key]) !== comparableScalar(manifestRow[key])) {
			throw new Error(`${sourceId} metadata mismatch for ${key}`);
		}
	}
	const snapshot = extractSnapshot(content);
	const artifactHash = sha256(content);
	const snapshotHash = sha256(snapshot);
	const declaredArtifactHash = stripHash(metadata.artifactHash);
	const declaredSnapshotHash = stripHash(metadata.snapshotHash);
	const relativePath = relative(stageRoot, sourcePath);
	const producerFileHash = stripHash(producerInventory[relativePath]);
	for (const [kind, declared, actual] of [
		["frontmatter-artifact", declaredArtifactHash, artifactHash],
		["frontmatter-snapshot", declaredSnapshotHash, snapshotHash],
		["contract-inventory", producerFileHash, artifactHash],
	] as const) {
		if (declared !== actual)
			inventoryMismatches.push({ path: relativePath, kind, declared, actual });
	}
	const compilationMetadata = {
		sourceId,
		title: requireString(metadata, "title"),
		domain: requireString(metadata, "domain"),
		sourceRole: requireString(metadata, "sourceRole"),
		platform: requireString(metadata, "platform"),
		author: requireString(metadata, "author"),
		canonicalUrl,
		publishedAt: String(metadata.publishedAt ?? "unknown"),
		capturedAt: String(metadata.capturedAt ?? "unknown"),
		versionRef: String(metadata.versionRef ?? "null"),
		mediaType: requireString(metadata, "mediaType"),
		language: requireString(metadata, "language"),
		usage: requireString(metadata, "usage"),
		accessStatus: requireString(metadata, "accessStatus"),
		evaluatorSnapshotHash: `sha256:${snapshotHash}`,
		evaluatorUpstreamArtifactHash: `sha256:${artifactHash}`,
	};
	const compilation = `---\n${dump(compilationMetadata, { lineWidth: 120 }).trim()}\n---\n\n# ${compilationMetadata.title}\n\n## Source Snapshot\n\n${snapshot}`;
	const compilationPath = join(
		temporaryRoot,
		"compilation-corpus",
		compilationMetadata.domain,
		`${sourceId}.md`,
	);
	mkdirSync(dirname(compilationPath), { recursive: true });
	writeFileSync(compilationPath, compilation, "utf8");
	sourceAudit.push({
		sourceId,
		domain: compilationMetadata.domain,
		sourceRole: compilationMetadata.sourceRole,
		canonicalUrl,
		accessStatus: compilationMetadata.accessStatus,
		inputPath: relativePath,
		inputArtifactHash: `sha256:${artifactHash}`,
		snapshotHash: `sha256:${snapshotHash}`,
		compilationPath: relative(experimentRoot, compilationPath).replace(
			"stage-a-freeze.tmp",
			"stage-a-freeze",
		),
		compilationHash: `sha256:${sha256(compilation)}`,
	});
}

const questionPath = join(stageRoot, "questions", "questions-public.jsonl");
const questions = readJsonl(questionPath);
if (questions.length !== 18) throw new Error(`Expected 18 questions, got ${questions.length}`);
const forbiddenKeys = new Set([
	"requiredPoints",
	"acceptableVariants",
	"forbiddenClaims",
	"requiredEvidence",
	"exactQuote",
	"expectedAnswer",
	"sourcePriorityRule",
	"hardFailureRules",
]);
const seenCaseIds = new Set<string>();
const distribution = new Map<string, number>();
for (const question of questions) {
	for (const key of Object.keys(question)) {
		if (forbiddenKeys.has(key)) throw new Error(`Gold field leaked into public question: ${key}`);
	}
	const caseId = requireString(question, "caseId");
	if (seenCaseIds.has(caseId)) throw new Error(`Duplicate caseId: ${caseId}`);
	seenCaseIds.add(caseId);
	const domains = question.domain;
	if (!Array.isArray(domains) || domains.length !== 1 || typeof domains[0] !== "string")
		throw new Error(`Invalid domain for ${caseId}`);
	const type = requireString(question, "questionType");
	const key = `${domains[0]}:${type}`;
	distribution.set(key, (distribution.get(key) ?? 0) + 1);
}
for (const domain of ["psychology-reproducibility", "climate-energy-policy", "law-public-policy"]) {
	for (const type of ["F", "C", "T", "X", "K", "A"]) {
		if (distribution.get(`${domain}:${type}`) !== 1)
			throw new Error(`Expected one ${type} question in ${domain}`);
	}
}

const previousUrls = collectPreviousCanonicalUrls(projectRoot);
const exactUrlOverlaps = [...canonicalUrls].filter((url) => previousUrls.has(url));
if (exactUrlOverlaps.length > 0)
	throw new Error(`Batch A/B canonical URL overlap: ${exactUrlOverlaps.join(", ")}`);

const evaluatorInventory = listFiles(stageRoot).map((path) => ({
	path: relative(stageRoot, path),
	sha256: sha256(normalizeNewlines(readFileSync(path, "utf8"))),
}));
const publicQuestionHash = sha256(normalizeNewlines(readFileSync(questionPath, "utf8")));
const config = {
	schemaVersion: "wge-pilot-config/v1",
	status: "LOCKED",
	corpus: sourceAudit.map(
		(row) => `../stage-a-freeze/${String(row.compilationPath).split("stage-a-freeze/")[1]}`,
	),
	compiler: { model: "deepseek-v4-flash", temperature: 0, thinkingDisabled: true },
	answer: {
		model: "deepseek-v4-flash",
		temperature: 0,
		thinkingDisabled: true,
		maxOutputTokens: 1200,
	},
	judge: {
		model: "deepseek-v4-flash",
		temperature: 0,
		thinkingDisabled: true,
		maxOutputTokens: 1200,
	},
	retrieval: {
		contextBudgetTokens: 12000,
		maxGraphDepth: 3,
		maxFolderChunks: 16,
		folderChunkChars: 1800,
	},
	execution: {
		groups: ["B", "P"],
		externalRetrievalNetwork: false,
		maxToolCalls: 1,
		timeoutMs: 120000,
	},
};
const selection = {
	schemaVersion: "wge-batch-c-public-selection/v1",
	status: "LOCKED_BLIND_STAGE_A",
	taskFile: "../../batch-c-stage-a/questions/questions-public.jsonl",
	taskFileSha256: publicQuestionHash,
	questionIds: questions.map((question) => requireString(question, "caseId")),
	groups: ["B", "P-seed", "P-graph"],
};
const audit = {
	schemaVersion: "wge-batch-c-stage-a-audit/v1",
	status: inventoryMismatches.length === 0 ? "ACCEPTED" : "CONDITIONALLY_ACCEPTED_HASH_RESEALED",
	goldLeakage: "NO_GOLD_FIELDS_IN_PUBLIC_QUESTION_OBJECTS",
	sourceCount: sourceAudit.length,
	questionCount: questions.length,
	exactCanonicalUrlOverlapCount: exactUrlOverlaps.length,
	producerHashMismatchCount: inventoryMismatches.length,
	producerHashMismatches: inventoryMismatches,
	limitations: [
		"Producer-declared hashes are not trusted; evaluator-computed hashes define the frozen Stage A input.",
		"Several snapshots aggregate excerpts from more than one upstream page; source-role atomicity must be audited after Gold reveal.",
		"Research Notes are excluded from compilation and cannot serve as evidence.",
		"No Stage B file was read or enumerated while producing this freeze.",
	],
	sources: sourceAudit,
	evaluatorInventory,
	publicQuestionHash: `sha256:${publicQuestionHash}`,
	producerManifestHash: `sha256:${sha256(normalizeNewlines(readFileSync(join(stageRoot, "contract-manifest.json"), "utf8")))}`,
	createdAt: new Date().toISOString(),
};
writeJson(join(temporaryRoot, "evaluator-audit.json"), audit);
writeJson(join(temporaryRoot, "config.json"), config);
writeJson(join(temporaryRoot, "selection.json"), selection);
writeFileSync(join(temporaryRoot, "questions-public.jsonl"), readFileSync(questionPath));
writeJson(join(temporaryRoot, "pre-freeze-git.json"), {
	headCommit: git(["rev-parse", "HEAD"]),
	trackedDiffHash: sha256(git(["diff", "--binary"])),
	statusHash: sha256(git(["status", "--porcelain=v1", "--untracked-files=all"])),
});
writeFileSync(join(temporaryRoot, "FREEZE_READY"), `${audit.status}\n`, "utf8");
mkdirSync(dirname(freezeRoot), { recursive: true });
// Same-filesystem rename makes the Stage A freeze appear atomically.
execFileSync("mv", [temporaryRoot, freezeRoot]);
console.log(
	JSON.stringify(
		{
			status: audit.status,
			sourceCount: 12,
			questionCount: 18,
			producerHashMismatchCount: inventoryMismatches.length,
			publicQuestionHash: audit.publicQuestionHash,
		},
		null,
		2,
	),
);

function collectPreviousCanonicalUrls(root: string): Set<string> {
	const urls = new Set<string>();
	for (const relativeRoot of ["workbuddy-batch-a", "workbuddy-batch-b"]) {
		const directory = join(root, relativeRoot);
		if (!existsSync(directory)) continue;
		for (const path of listFiles(directory)) {
			if (!path.endsWith(".md") && !path.endsWith(".jsonl")) continue;
			const content = readFileSync(path, "utf8");
			for (const match of content.matchAll(/canonicalUrl["']?\s*[:=]\s*["']([^"']+)["']/g)) {
				if (match[1]) urls.add(match[1]);
			}
		}
	}
	return urls;
}

function listFiles(root: string): string[] {
	return readdirSync(root, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map((entry) => join(entry.parentPath, entry.name))
		.sort();
}

function parseFrontmatter(content: string): JsonRecord {
	const match = content.match(/^---\n([\s\S]*?)\n---\n/);
	if (!match?.[1]) throw new Error("Missing YAML frontmatter");
	const parsed = load(match[1]);
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
		throw new Error("Invalid YAML frontmatter");
	return parsed as JsonRecord;
}

function extractSnapshot(content: string): string {
	const marker = "## Source Snapshot";
	const start = content.indexOf(marker);
	if (start < 0) throw new Error("Missing Source Snapshot heading");
	const bodyStart = content.indexOf("\n", start) + 1;
	const notesStart = content.indexOf("## Research Notes", bodyStart);
	if (notesStart < 0) throw new Error("Missing Research Notes boundary");
	return `${content.slice(bodyStart, notesStart).trim()}\n`;
}

function normalizeNewlines(value: string): string {
	return value.replaceAll("\r\n", "\n");
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function stripHash(value: unknown): string | null {
	return typeof value === "string" ? value.replace(/^sha256:/, "") : null;
}

function comparableScalar(value: unknown): string {
	return value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
}

function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, "utf8")) as T;
}

function readJsonl(path: string): JsonRecord[] {
	return readFileSync(path, "utf8")
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line) as JsonRecord);
}

function writeJson(path: string, value: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function requireRecord(record: JsonRecord, key: string): JsonRecord {
	const value = record[key];
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error(`Missing object ${key}`);
	return value as JsonRecord;
}

function requireString(record: JsonRecord, key: string): string {
	const value = record[key];
	if (typeof value !== "string" || value.length === 0) throw new Error(`Missing string ${key}`);
	return value;
}

function git(args: string[]): string {
	return execFileSync("git", args, { cwd: projectRoot, encoding: "utf8" });
}
