import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

type JsonRecord = Record<string, unknown>;

const projectRoot = process.cwd();
const stageARoot = join(projectRoot, "batch-c-stage-a");
const stageBRoot = join(projectRoot, "batch-c-stage-b-sealed");
const outputRoot = join(projectRoot, "experiments", "benchmark-batch-c", "stage-b-evaluator");

const manifest = readJson(join(stageBRoot, "seal-manifest.json"));
const questions = readJsonl(join(stageARoot, "questions", "questions-public.jsonl"));
const tasks = readJsonl(join(stageBRoot, "gold", "tasks-gold.jsonl"));
const facts = readJsonl(join(stageBRoot, "gold", "facts-gold.jsonl"));
const relations = readJsonl(join(stageBRoot, "gold", "relations-gold.jsonl"));
const episodes = readJsonl(join(stageBRoot, "gold", "evolution-episodes-gold.jsonl"));
const reviews = readJsonl(join(stageBRoot, "audit", "independent-review.jsonl"));

const manifestFiles = requireArray(manifest, "files").map((value) =>
	asRecord(value, "manifest file"),
);
const fileChecks = manifestFiles.map((entry) => {
	const relativePath = requireString(entry, "relativePath");
	const absolutePath = join(stageBRoot, relativePath);
	const bytes = readFileSync(absolutePath);
	const actualHash = sha256(bytes);
	return {
		relativePath,
		declaredBytes: requireNumber(entry, "byteLength"),
		actualBytes: bytes.byteLength,
		declaredSha256: requireString(entry, "sha256"),
		actualSha256: actualHash,
		pass:
			bytes.byteLength === requireNumber(entry, "byteLength") &&
			actualHash === requireString(entry, "sha256"),
	};
});
const treeInput = [...fileChecks]
	.sort((left, right) =>
		left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0,
	)
	.map((entry) => `${entry.actualSha256}  ${entry.relativePath}\n`)
	.join("");
const actualPayloadTreeHash = sha256(treeInput);

const sourceSnapshots = loadSourceSnapshots(join(stageARoot, "corpus"));
const quotes = collectQuotes({ tasks, facts, relations, episodes });
const quoteChecks = quotes.map((quote) => {
	const snapshot = sourceSnapshots.get(quote.sourceId);
	return {
		...quote,
		sourceExists: snapshot !== undefined,
		exactMatch: snapshot?.snapshot.includes(quote.exactQuote) ?? false,
		upstreamDiffersFromCanonical:
			quote.upstreamUrl !== null &&
			snapshot !== undefined &&
			quote.upstreamUrl !== snapshot.canonicalUrl,
	};
});

const questionById = new Map(questions.map((row) => [requireString(row, "caseId"), row]));
const taskById = new Map(tasks.map((row) => [requireString(row, "caseId"), row]));
const questionIds = [...questionById.keys()].sort();
const taskIds = [...taskById.keys()].sort();
const factIds = facts.map((row) => requireString(row, "factId"));
const factIdSet = new Set(factIds);
const relationEndpointFailures = relations.flatMap((row) => {
	const relationId = requireString(row, "relationId");
	const from = requireString(row, "fromFactId");
	const to = requireString(row, "toFactId");
	return [
		...(factIdSet.has(from) ? [] : [{ relationId, endpoint: "from", factId: from }]),
		...(factIdSet.has(to) ? [] : [{ relationId, endpoint: "to", factId: to }]),
	];
});

const answerabilityMismatches = questionIds.flatMap((caseId) => {
	const question = questionById.get(caseId);
	const task = taskById.get(caseId);
	if (!question || !task) return [];
	const stageA = requireString(question, "answerability");
	const stageB = requireString(task, "answerability");
	return stageA === stageB ? [] : [{ caseId, stageA, stageB }];
});

const expectedReviewIds = [
	...tasks.map((row) => `task:${requireString(row, "caseId")}`),
	...facts.map((row) => `fact:${requireString(row, "factId")}`),
	...relations.map((row) => `relation:${requireString(row, "relationId")}`),
	...episodes.map((row) => `evolution:${requireString(row, "episodeId")}`),
];
const reviewIds = reviews.map(
	(row) => `${requireString(row, "itemType")}:${requireString(row, "itemId")}`,
);
const reviewIdSet = new Set(reviewIds);
const reviewModels = [...new Set(reviews.map((row) => requireString(row, "reviewerModel")))];

const questionPath = join(stageARoot, "questions", "questions-public.jsonl");
const actualQuestionHash = sha256(readFileSync(questionPath));
const report = {
	schemaVersion: "wge-batch-c-stage-b-structural-audit/v1",
	status: "PROVISIONAL_REQUIRES_INDEPENDENT_SEMANTIC_REVIEW",
	rawStageBMutated: false,
	seal: {
		files: fileChecks.length,
		fileFailures: fileChecks.filter((entry) => !entry.pass),
		declaredPayloadTreeHash: requireString(manifest, "payloadTreeHash"),
		actualPayloadTreeHash,
		payloadTreePass: actualPayloadTreeHash === requireString(manifest, "payloadTreeHash"),
		goldStatus: requireString(manifest, "goldStatus"),
		reviewerModel: requireString(manifest, "reviewerModel"),
	},
	questions: {
		stageAQuestionHash: actualQuestionHash,
		declaredStageAQuestionHash: requireString(manifest, "stageAQuestionHash"),
		hashPass: actualQuestionHash === requireString(manifest, "stageAQuestionHash"),
		stageACount: questions.length,
		stageBCount: tasks.length,
		missingTaskIds: questionIds.filter((id) => !taskById.has(id)),
		extraTaskIds: taskIds.filter((id) => !questionById.has(id)),
		answerabilityMismatches,
	},
	gold: {
		facts: facts.length,
		relations: relations.length,
		tasks: tasks.length,
		episodes: episodes.length,
		duplicateFactIds: duplicates(factIds),
		relationEndpointFailures,
	},
	quotes: {
		total: quoteChecks.length,
		exactMatches: quoteChecks.filter((entry) => entry.exactMatch).length,
		failures: quoteChecks.filter((entry) => !entry.exactMatch),
		upstreamDiffersFromCanonical: quoteChecks.filter((entry) => entry.upstreamDiffersFromCanonical),
	},
	review: {
		entries: reviews.length,
		expectedEntries: expectedReviewIds.length,
		missingReviewIds: expectedReviewIds.filter((id) => !reviewIdSet.has(id)),
		duplicateReviewIds: duplicates(reviewIds),
		reviewerModels: reviewModels,
		independent: !reviewModels.every((model) => /self-review|workbuddy/i.test(model)),
		verdictCounts: countBy(reviews, (row) => requireString(row, "verdict")),
	},
	limitations: [
		"The Gold was created after the blind answers and is diagnostic provisional Gold, not precommitted Gold.",
		"The supplied review was performed by the generator itself and is not independent.",
		"Exact string presence does not prove that a quote supports the full Gold claim or relation semantics.",
	],
};

mkdirSync(outputRoot, { recursive: true });
writeJson(join(outputRoot, "structural-audit.json"), report);
console.log(JSON.stringify(report, null, 2));

function collectQuotes(input: {
	tasks: JsonRecord[];
	facts: JsonRecord[];
	relations: JsonRecord[];
	episodes: JsonRecord[];
}): Array<{
	itemType: string;
	itemId: string;
	sourceId: string;
	exactQuote: string;
	upstreamUrl: string | null;
}> {
	const result: Array<{
		itemType: string;
		itemId: string;
		sourceId: string;
		exactQuote: string;
		upstreamUrl: string | null;
	}> = [];
	for (const task of input.tasks) {
		for (const evidence of recordArray(task, "requiredEvidence")) {
			result.push(quoteRecord("task", requireString(task, "caseId"), evidence));
		}
	}
	for (const fact of input.facts) {
		for (const evidence of recordArray(fact, "evidence")) {
			result.push(quoteRecord("fact", requireString(fact, "factId"), evidence));
		}
	}
	for (const relation of input.relations) {
		const endpoints = asRecord(relation.endpointEvidence, "endpointEvidence");
		for (const side of ["from", "to"]) {
			for (const evidence of recordArray(endpoints, side)) {
				result.push(quoteRecord("relation", requireString(relation, "relationId"), evidence));
			}
		}
	}
	for (const episode of input.episodes) {
		for (const evidence of recordArray(episode, "evidence")) {
			result.push(quoteRecord("evolution", requireString(episode, "episodeId"), evidence));
		}
	}
	return result;
}

function quoteRecord(itemType: string, itemId: string, evidence: JsonRecord) {
	return {
		itemType,
		itemId,
		sourceId: requireString(evidence, "sourceId"),
		exactQuote: requireString(evidence, "exactQuote"),
		upstreamUrl: typeof evidence.upstreamUrl === "string" ? evidence.upstreamUrl : null,
	};
}

function loadSourceSnapshots(corpusRoot: string) {
	const result = new Map<string, { snapshot: string; canonicalUrl: string }>();
	for (const domain of readdirSync(corpusRoot, { withFileTypes: true })) {
		if (!domain.isDirectory()) continue;
		const domainRoot = join(corpusRoot, domain.name);
		for (const entry of readdirSync(domainRoot, { withFileTypes: true })) {
			if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
			const path = join(domainRoot, entry.name);
			const text = readFileSync(path, "utf8");
			const sourceId = frontmatterValue(text, "sourceId");
			const canonicalUrl = frontmatterValue(text, "canonicalUrl");
			const start = text.indexOf("## Source Snapshot");
			const end = text.indexOf("## Research Notes", start);
			if (start < 0 || end < 0)
				throw new Error(`Missing snapshot boundary: ${relative(projectRoot, path)}`);
			result.set(sourceId, { snapshot: text.slice(start, end), canonicalUrl });
		}
	}
	return result;
}

function frontmatterValue(text: string, key: string) {
	const match = text.match(new RegExp(`^${key}:\\s*["']?([^"'\\n]+)["']?\\s*$`, "m"));
	if (!match?.[1]) throw new Error(`Missing frontmatter ${key}`);
	return match[1].trim();
}

function readJson(path: string): JsonRecord {
	return asRecord(JSON.parse(readFileSync(path, "utf8")), path);
}

function readJsonl(path: string): JsonRecord[] {
	return readFileSync(path, "utf8")
		.split(/\r?\n/u)
		.filter((line) => line.trim().length > 0)
		.map((line, index) => asRecord(JSON.parse(line), `${path}:${index + 1}`));
}

function writeJson(path: string, value: unknown) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sha256(value: string | Buffer) {
	return createHash("sha256").update(value).digest("hex");
}

function asRecord(value: unknown, label: string): JsonRecord {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${label} must be an object`);
	}
	return value as JsonRecord;
}

function requireArray(record: JsonRecord, key: string): unknown[] {
	const value = record[key];
	if (!Array.isArray(value)) throw new Error(`${key} must be an array`);
	return value;
}

function recordArray(record: JsonRecord, key: string): JsonRecord[] {
	return requireArray(record, key).map((value) => asRecord(value, key));
}

function requireString(record: JsonRecord, key: string): string {
	const value = record[key];
	if (typeof value !== "string" || value.length === 0) throw new Error(`${key} must be a string`);
	return value;
}

function requireNumber(record: JsonRecord, key: string): number {
	const value = record[key];
	if (typeof value !== "number" || !Number.isFinite(value))
		throw new Error(`${key} must be a number`);
	return value;
}

function duplicates(values: string[]) {
	const counts = new Map<string, number>();
	for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
	return [...counts.entries()].filter(([, count]) => count > 1).map(([value]) => value);
}

function countBy(rows: JsonRecord[], key: (row: JsonRecord) => string) {
	const result: Record<string, number> = {};
	for (const row of rows) {
		const value = key(row);
		result[value] = (result[value] ?? 0) + 1;
	}
	return result;
}
