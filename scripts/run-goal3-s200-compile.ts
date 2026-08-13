import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type JsonRecord = Record<string, unknown>;

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const freezeRoot = join(projectRoot, "experiments", "goal3", "s200-stage-a-freeze-v1");
const freezeManifestPath = join(freezeRoot, "freeze-manifest.json");
const freezeConfigPath = join(freezeRoot, "config.json");
const runName = parseRunName(process.env.WGE_S200_COMPILE_RUN_NAME);
const runRoot = join(projectRoot, "experiments", "goal3", "s200-runs", runName);
const workspaceRoot = join(runRoot, "workspace");
const logRoot = join(runRoot, "logs");
const progressPath = join(runRoot, "progress.jsonl");
const completionPath = join(runRoot, "completion.json");
const limit = parseLimit(process.env.WGE_S200_COMPILE_LIMIT);

const freezeManifest = readJson(freezeManifestPath);
const freezeConfig = readJson(freezeConfigPath);
if (freezeManifest.status !== "ACCEPTED_STAGE_A_DEV_SCALE" || freezeManifest.stageBRead !== false) {
	throw new Error("S200 Stage A freeze is not accepted or Stage B isolation drifted");
}
const compiler = requireRecord(freezeConfig, "compiler");
const model = requireString(compiler, "model");
if (compiler.temperature !== 0 || compiler.thinkingDisabled !== true) {
	throw new Error("S200 compiler configuration must be temperature=0 and thinkingDisabled=true");
}
const expectedInventory = requireArray(freezeManifest, "fileInventoryExcludingManifest");
for (const itemValue of expectedInventory) {
	const item = asRecord(itemValue, "freeze inventory item");
	const path = requireString(item, "path");
	const expectedHash = requireString(item, "sha256");
	const actualHash = `sha256:${sha256Bytes(readFileSync(join(freezeRoot, path)))}`;
	if (actualHash !== expectedHash) throw new Error(`Immutable S200 freeze drift: ${path}`);
}

for (const directory of ["sources", "wiki", "quarantine", "indexes", "runs", "publications"]) {
	mkdirSync(join(workspaceRoot, directory), { recursive: true });
}
mkdirSync(logRoot, { recursive: true });

const corpusFiles = listFiles(join(freezeRoot, "compilation-corpus")).filter((path) =>
	path.endsWith(".md"),
);
if (corpusFiles.length !== 140)
	throw new Error(`Frozen compilation corpus drift: ${corpusFiles.length}`);
const existingAttempts = readExistingProgress(progressPath);
const selected = limit === null ? corpusFiles : corpusFiles.slice(0, limit);
let succeeded = 0;
let failed = 0;
let skipped = 0;

for (const [index, sourcePath] of selected.entries()) {
	const sourceKey = basename(sourcePath, ".md");
	const attempt = (existingAttempts.get(sourceKey) ?? 0) + 1;
	const startedAt = new Date().toISOString();
	const started = process.hrtime.bigint();
	console.error(`[${index + 1}/${selected.length}] compiling ${sourceKey} attempt=${attempt}`);
	const result = spawnSync(
		process.execPath,
		[
			"--import",
			"tsx",
			join(projectRoot, "src", "cli", "index.ts"),
			"--project-root",
			workspaceRoot,
			"ingest",
			sourcePath,
			"--json",
		],
		{
			cwd: projectRoot,
			env: {
				...process.env,
				WGE_MODEL: model,
				WGE_TEMPERATURE: "0",
			},
			encoding: "utf8",
			timeout: 20 * 60 * 1000,
			maxBuffer: 32 * 1024 * 1024,
		},
	);
	const elapsedMilliseconds = Number(process.hrtime.bigint() - started) / 1_000_000;
	const stdoutPath = join(logRoot, `${sourceKey}.attempt-${attempt}.stdout.txt`);
	const stderrPath = join(logRoot, `${sourceKey}.attempt-${attempt}.stderr.txt`);
	writeFileSync(stdoutPath, result.stdout ?? "", { encoding: "utf8", flag: "wx" });
	writeFileSync(stderrPath, result.stderr ?? "", { encoding: "utf8", flag: "wx" });
	const status = result.status === 0 ? classifySuccess(result.stdout ?? "") : "FAILED";
	if (status === "FAILED") failed += 1;
	else if (status === "SKIPPED") skipped += 1;
	else succeeded += 1;
	appendFileSync(
		progressPath,
		`${JSON.stringify({
			schemaVersion: "wge-s200-compile-progress/v1",
			sourceKey,
			sourcePath: relative(freezeRoot, sourcePath),
			attempt,
			startedAt,
			finishedAt: new Date().toISOString(),
			elapsedMilliseconds: Math.round(elapsedMilliseconds),
			status,
			exitCode: result.status,
			signal: result.signal,
			stdoutPath: relative(runRoot, stdoutPath),
			stderrPath: relative(runRoot, stderrPath),
		})}\n`,
		"utf8",
	);
	existingAttempts.set(sourceKey, attempt);
	if (status === "FAILED") {
		throw new Error(
			`S200 compile failed for ${sourceKey}; inspect ${relative(projectRoot, stderrPath)}`,
		);
	}
}

const summary = {
	schemaVersion: "wge-s200-compile-run/v1",
	status: selected.length === corpusFiles.length ? "FULL_PASS" : "CANARY_PASS",
	stageBRead: false,
	model,
	temperature: 0,
	freezeManifestSha256: `sha256:${sha256Bytes(readFileSync(freezeManifestPath))}`,
	selectedSourceCount: selected.length,
	totalFrozenSourceCount: corpusFiles.length,
	succeeded,
	skipped,
	failed,
	workspaceRoot,
	progressPath,
	createdAt: new Date().toISOString(),
};
if (existsSync(completionPath)) {
	const suffix = new Date().toISOString().replaceAll(/[:.]/g, "-");
	writeFileSync(
		join(runRoot, `completion-${suffix}.json`),
		`${JSON.stringify(summary, null, 2)}\n`,
		{
			encoding: "utf8",
			flag: "wx",
		},
	);
} else {
	writeFileSync(completionPath, `${JSON.stringify(summary, null, 2)}\n`, {
		encoding: "utf8",
		flag: "wx",
	});
}
console.log(JSON.stringify(summary, null, 2));

function classifySuccess(stdout: string): "COMPLETED" | "SKIPPED" {
	try {
		const parsed: unknown = JSON.parse(stdout);
		if (isRecord(parsed) && parsed.skipped === true) return "SKIPPED";
	} catch {
		// Successful CLI output can contain a normal result object; parsing is diagnostic only.
	}
	return "COMPLETED";
}

function readExistingProgress(path: string): Map<string, number> {
	const attempts = new Map<string, number>();
	if (!existsSync(path)) return attempts;
	for (const row of readFileSync(path, "utf8").split("\n")) {
		if (row.trim().length === 0) continue;
		const parsed = asRecord(JSON.parse(row) as unknown, "progress row");
		const key = requireString(parsed, "sourceKey");
		const attempt = Number(parsed.attempt);
		if (Number.isSafeInteger(attempt)) attempts.set(key, Math.max(attempts.get(key) ?? 0, attempt));
	}
	return attempts;
}

function parseLimit(value: string | undefined): number | null {
	if (value === undefined || value.trim() === "") return null;
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed <= 0)
		throw new Error(`Invalid compile limit: ${value}`);
	return parsed;
}

function parseRunName(value: string | undefined): string {
	const candidate = value?.trim() || "compile-v1";
	if (!/^[a-zA-Z0-9._-]+$/.test(candidate))
		throw new Error(`Invalid compile run name: ${candidate}`);
	return candidate;
}

function readJson(path: string): JsonRecord {
	return asRecord(JSON.parse(readFileSync(path, "utf8")) as unknown, path);
}

function requireRecord(value: JsonRecord, key: string): JsonRecord {
	return asRecord(value[key], key);
}

function requireArray(value: JsonRecord, key: string): unknown[] {
	const candidate = value[key];
	if (!Array.isArray(candidate)) throw new Error(`Expected array: ${key}`);
	return candidate;
}

function requireString(value: JsonRecord, key: string): string {
	const candidate = value[key];
	if (typeof candidate !== "string" || candidate.length === 0)
		throw new Error(`Expected string: ${key}`);
	return candidate;
}

function asRecord(value: unknown, label: string): JsonRecord {
	if (!isRecord(value)) throw new Error(`Expected object: ${label}`);
	return value;
}

function isRecord(value: unknown): value is JsonRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function listFiles(root: string): string[] {
	return readdirSync(root, { withFileTypes: true })
		.flatMap((entry) => {
			const path = join(root, entry.name);
			return entry.isDirectory() ? listFiles(path) : [path];
		})
		.sort();
}

function sha256Bytes(value: Buffer): string {
	return createHash("sha256").update(value).digest("hex");
}
