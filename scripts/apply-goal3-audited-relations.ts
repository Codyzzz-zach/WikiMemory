import { createHash } from "node:crypto";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

type JsonRecord = Record<string, unknown>;

interface AuditResult {
	object: JsonRecord & { id: string };
	finalState: "CANONICAL" | "QUARANTINED";
	issues: unknown[];
}

const [sourceArg, auditArg, outputArg] = process.argv.slice(2);
if (!sourceArg || !auditArg || !outputArg) {
	throw new Error("usage: apply-goal3-audited-relations <source-workspace> <audit-run> <output>");
}
const sourceRoot = resolve(sourceArg);
const auditRoot = resolve(auditArg);
const outputRoot = resolve(outputArg);
if (existsSync(outputRoot))
	throw new Error(`Refusing to overwrite audited workspace: ${outputRoot}`);

const auditResultsPath = join(auditRoot, "audit-results.json");
const ledgerPath = join(auditRoot, "ledger.json");
const auditResultsText = readFileSync(auditResultsPath, "utf8");
const ledgerText = readFileSync(ledgerPath, "utf8");
const auditResults = JSON.parse(auditResultsText) as AuditResult[];
const ledger = JSON.parse(ledgerText) as JsonRecord;
if (ledger.closed !== true) throw new Error("Relation audit ledger is not closed");

const accepted = new Map(
	auditResults
		.filter((result) => result.finalState === "CANONICAL")
		.map((result) => [result.object.id, result.object] as const),
);
const rejected = auditResults.filter((result) => result.finalState === "QUARANTINED");
const accountedIds = new Set(auditResults.map((result) => result.object.id));

for (const directory of ["publications", "sources", "indexes", "wiki", "quarantine", "runs"]) {
	mkdirSync(join(outputRoot, directory), { recursive: true });
}
copyDirectoryFiles(join(sourceRoot, "sources"), join(outputRoot, "sources"));
copyDirectoryFiles(join(sourceRoot, "indexes"), join(outputRoot, "indexes"));

const publicationHashes: Array<{ file: string; sha256: string }> = [];
let originalRelations = 0;
let publishedRelations = 0;
for (const file of readdirSync(join(sourceRoot, "publications")).filter((name) =>
	name.endsWith(".json"),
)) {
	const publication = JSON.parse(
		readFileSync(join(sourceRoot, "publications", file), "utf8"),
	) as JsonRecord;
	const original = recordArray(publication.relations);
	originalRelations += original.length;
	const relations = original.flatMap((relation) => {
		const id = requiredString(relation, "id");
		if (!accountedIds.has(id)) throw new Error(`Audit result missing original Relation: ${id}`);
		const audited = accepted.get(id);
		return audited ? [audited] : [];
	});
	publishedRelations += relations.length;
	const text = `${JSON.stringify({ ...publication, relations }, null, 2)}\n`;
	writeFileSync(join(outputRoot, "publications", file), text, "utf8");
	publicationHashes.push({ file, sha256: sha256(text) });
}
if (originalRelations !== auditResults.length) {
	throw new Error(
		`Audit/publication ledger mismatch: ${originalRelations} != ${auditResults.length}`,
	);
}
writeFileSync(
	join(outputRoot, "quarantine", "relation-audit-rejected.jsonl"),
	`${rejected.map((result) => JSON.stringify(result)).join("\n")}\n`,
	"utf8",
);
const manifest = {
	schemaVersion: "wge-goal3-audited-workspace/v1",
	createdAt: new Date().toISOString(),
	status: "ISOLATED_DEV_PROXY_NOT_HUMAN_GOLD",
	provenance: {
		sourceRoot,
		auditRoot,
		auditResultsSha256: sha256(auditResultsText),
		ledgerSha256: sha256(ledgerText),
	},
	ledger: {
		input: originalRelations,
		canonical: publishedRelations,
		quarantined: rejected.length,
		closed: publishedRelations + rejected.length === originalRelations,
	},
	publicationHashes: publicationHashes.sort((left, right) => left.file.localeCompare(right.file)),
	limitations: [
		"Accepted Relations are DeepSeek audit outputs and have not been independently human-reviewed.",
		"This workspace is isolated experiment input and does not mutate the main knowledge publication.",
	],
};
writeFileSync(join(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ outputRoot, ledger: manifest.ledger }, null, 2));

function copyDirectoryFiles(source: string, target: string): void {
	if (!existsSync(source)) return;
	for (const file of readdirSync(source)) {
		const sourcePath = join(source, file);
		// Experiment workspaces use flat source/index directories; nested runtime state is excluded.
		if (statSync(sourcePath).isFile()) copyFileSync(sourcePath, join(target, file));
	}
}

function recordArray(value: unknown): JsonRecord[] {
	return Array.isArray(value)
		? value.filter(
				(item): item is JsonRecord =>
					Boolean(item) && typeof item === "object" && !Array.isArray(item),
			)
		: [];
}

function requiredString(record: JsonRecord, key: string): string {
	const value = record[key];
	if (typeof value !== "string" || value.length === 0) throw new Error(`Missing string ${key}`);
	return value;
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}
