import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "js-yaml";

type JsonRecord = Record<string, unknown>;
type Finding = {
	code: string;
	message: string;
	refs?: string[];
};

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const stageRoot = resolve(process.argv[2] ?? join(projectRoot, "benchmark-s200-stage-a"));
const reportPath = resolve(
	process.argv[3] ??
		join(projectRoot, "experiments", "goal3", "s200-stage-a-intake-validation-v1.json"),
);
const errors: Finding[] = [];
const warnings: Finding[] = [];
const forbiddenKeys = new Set([
	"requiredPoints",
	"acceptableVariants",
	"forbiddenClaims",
	"requiredEvidence",
	"exactQuote",
	"expectedPath",
	"relationTypes",
	"sourcePriorityRule",
	"expectedAffected",
	"expectedUnaffected",
	"oldClaimsThatMustChange",
	"claimsThatMustRemain",
	"forbiddenAfterUpdate",
	"chronologyEvidence",
	"reviewStatus",
]);
const forbiddenKeyPattern = new RegExp([...forbiddenKeys].join("|"), "iu");

const requiredPaths = [
	"README.md",
	"contract-manifest.json",
	"manifests/source-manifest.jsonl",
	"questions/questions-public.jsonl",
	"episodes/episodes-public.jsonl",
	"reports/source-clusters.jsonl",
];
for (const item of requiredPaths) {
	if (!existsSync(join(stageRoot, item))) addError("MISSING_FILE", `Missing Stage A file: ${item}`);
}
if (errors.length > 0) {
	const report = {
		schemaVersion: "wge-s200-stage-a-intake-validation/v1",
		stageRoot,
		status: "REJECT_MISSING_FILES",
		stageBRead: false,
		errors,
		warnings,
		createdAt: new Date().toISOString(),
	};
	mkdirSync(dirname(reportPath), { recursive: true });
	writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
	console.log(JSON.stringify(report, null, 2));
	process.exit(1);
}

const contract = readJson(join(stageRoot, "contract-manifest.json"));
const inventory = requireRecord(contract, "fileInventory");
const sources = readJsonl(join(stageRoot, "manifests", "source-manifest.jsonl"));
const questions = readJsonl(join(stageRoot, "questions", "questions-public.jsonl"));
const episodes = readJsonl(join(stageRoot, "episodes", "episodes-public.jsonl"));
const clusters = readJsonl(join(stageRoot, "reports", "source-clusters.jsonl"));
const corpusPaths = listFiles(join(stageRoot, "corpus")).filter((item) => item.endsWith(".md"));

const sourceById = uniqueMap(sources, "sourceId", "DUPLICATE_SOURCE_ID");
const questionById = uniqueMap(questions, "caseId", "DUPLICATE_CASE_ID");
const clusterById = uniqueMap(clusters, "clusterId", "DUPLICATE_CLUSTER_ID");
uniqueMap(episodes, "episodeId", "DUPLICATE_EPISODE_ID");

checkCount("SOURCE_COUNT", sources.length, 140, 160);
checkCount("QUESTION_COUNT", questions.length, 48, 64);
checkCount("EPISODE_COUNT", episodes.length, 12, 20);
checkCount("CLUSTER_COUNT", clusters.length, 20, 30);
if (corpusPaths.length !== sources.length) {
	addError(
		"CORPUS_MANIFEST_COUNT_MISMATCH",
		`Corpus files ${corpusPaths.length} != manifest rows ${sources.length}`,
	);
}
if (Number(contract.sourceCount) !== sources.length) {
	addError(
		"CONTRACT_SOURCE_COUNT_MISMATCH",
		`contract-manifest sourceCount ${String(contract.sourceCount)} != ${sources.length}`,
	);
}

const seenContentPaths = new Set<string>();
let curatorBannerCount = 0;
let shortFullCount = 0;
for (const source of sources) {
	const sourceId = requireString(source, "sourceId");
	const contentPath = requireString(source, "contentPath");
	if (seenContentPaths.has(contentPath)) {
		addError("DUPLICATE_CONTENT_PATH", `Multiple manifest rows use ${contentPath}`, [sourceId]);
	}
	seenContentPaths.add(contentPath);
	const absolutePath = join(stageRoot, contentPath);
	if (!existsSync(absolutePath)) {
		addError("MISSING_SOURCE_ARTIFACT", `Missing artifact ${contentPath}`, [sourceId]);
		continue;
	}
	const bytes = readFileSync(absolutePath);
	const content = normalizeNewlines(bytes.toString("utf8"));
	const metadata = parseFrontmatter(content);
	for (const key of [
		"sourceId",
		"title",
		"domain",
		"clusterId",
		"sourceRole",
		"canonicalUrl",
		"publishedAt",
		"accessStatus",
		"snapshotHash",
	]) {
		if (comparable(metadata[key]) !== comparable(source[key])) {
			addError(
				"FRONTMATTER_MANIFEST_MISMATCH",
				`${sourceId}: ${key} differs between artifact and manifest`,
				[sourceId, key],
			);
		}
	}
	const snapshot = extractSnapshot(content);
	const snapshotHash = sha256(snapshot);
	const artifactHash = sha256Bytes(bytes);
	if (stripHash(source.snapshotHash) !== snapshotHash) {
		addError("SNAPSHOT_HASH_MISMATCH", `${sourceId}: snapshotHash mismatch`, [sourceId]);
	}
	if (stripHash(source.artifactHash) !== artifactHash) {
		addError("ARTIFACT_HASH_MISMATCH", `${sourceId}: artifactHash mismatch`, [sourceId]);
	}
	const firstLine = snapshot.split("\n").find((lineValue) => lineValue.trim().length > 0) ?? "";
	if (
		/^\*(?:Verbatim|Excerpt|Excerpts|Metadata|Official|Source|Captured|Extracted)/i.test(firstLine)
	) {
		curatorBannerCount += 1;
	}
	if (source.accessStatus === "full" && snapshot.length < 1_000) shortFullCount += 1;
}

if (curatorBannerCount > 0) {
	addWarning(
		"CURATOR_TEXT_INSIDE_SNAPSHOT",
		`${curatorBannerCount}/${sources.length} snapshots start with curator provenance text; evaluator compilation must strip it`,
	);
}
if (shortFullCount > 0) {
	addWarning(
		"SHORT_FULL_SNAPSHOT",
		`${shortFullCount} accessStatus=full snapshots contain fewer than 1,000 characters`,
	);
}

const normalizedUrls = new Map<string, string[]>();
const identities = new Map<string, string[]>();
for (const source of sources) {
	const sourceId = requireString(source, "sourceId");
	pushMap(normalizedUrls, normalizeUrl(requireString(source, "canonicalUrl")), sourceId);
	for (const identity of extractStableIdentities(source)) pushMap(identities, identity, sourceId);
}
for (const [url, ids] of normalizedUrls) {
	if (ids.length > 1) addError("DUPLICATE_CANONICAL_URL", `Duplicate canonical URL: ${url}`, ids);
}
for (const [identity, ids] of identities) {
	if (ids.length > 1)
		addError("DUPLICATE_STABLE_IDENTITY", `Duplicate source identity: ${identity}`, ids);
}

for (const cluster of clusters) {
	const clusterId = requireString(cluster, "clusterId");
	const members = sources.filter((source) => source.clusterId === clusterId);
	if (members.length < 4 || members.length > 8) {
		addError("CLUSTER_SIZE", `${clusterId} has ${members.length} sources; expected 4..8`, [
			clusterId,
		]);
	}
	if (new Set(members.map((source) => source.sourceRole)).size < 2) {
		addError("CLUSTER_ROLE_DIVERSITY", `${clusterId} has fewer than two source roles`, [clusterId]);
	}
	if (Number(cluster.sourceCount) !== members.length) {
		addError("CLUSTER_DECLARED_COUNT", `${clusterId} declared count does not match manifest`, [
			clusterId,
		]);
	}
	const declared = new Set(requireStringArray(cluster, "sourceIds"));
	const actual = new Set(members.map((source) => requireString(source, "sourceId")));
	if (!sameSet(declared, actual)) {
		addError("CLUSTER_MEMBERSHIP", `${clusterId} membership does not match manifest`, [clusterId]);
	}
}

for (const question of questions) {
	const caseId = requireString(question, "caseId");
	for (const clusterId of requireStringArray(question, "clusterIds")) {
		if (!clusterById.has(clusterId)) {
			addError("QUESTION_UNKNOWN_CLUSTER", `${caseId} references ${clusterId}`, [
				caseId,
				clusterId,
			]);
		}
	}
	checkForbiddenObjectKeys(question, caseId);
}
for (const episode of episodes) {
	const episodeId = requireString(episode, "episodeId");
	const timeline = episode.timeline;
	if (!Array.isArray(timeline)) {
		addError("INVALID_EPISODE_TIMELINE", `${episodeId} has no timeline`, [episodeId]);
		continue;
	}
	for (const timepoint of timeline) {
		if (!isRecord(timepoint)) continue;
		for (const sourceId of requireStringArray(timepoint, "sourceIds")) {
			if (!sourceById.has(sourceId)) {
				addError("EPISODE_UNKNOWN_SOURCE", `${episodeId} references missing source ${sourceId}`, [
					episodeId,
					sourceId,
				]);
			}
		}
	}
	for (const caseId of requireStringArray(episode, "publicQuestions")) {
		if (!questionById.has(caseId)) {
			addError("EPISODE_UNKNOWN_QUESTION", `${episodeId} references missing question ${caseId}`, [
				episodeId,
				caseId,
			]);
		}
	}
	checkForbiddenObjectKeys(episode, episodeId);
}

const accessCounts = countBy(sources, "accessStatus");
const domainCounts = countBy(sources, "domain");
const roleCounts = countBy(sources, "sourceRole");
const languageCounts = countBy(sources, "language");
const questionTypeCounts = countBy(questions, "questionType");
const languageSliceCounts = countBy(questions, "languageSlice");
const fullRatio = (accessCounts.full ?? 0) / Math.max(1, sources.length);
if (fullRatio < 0.6) addError("FULL_SOURCE_RATIO", `full ratio ${fullRatio} is below 0.60`);
if ((roleCounts["U-experience"] ?? 0) < 20)
	addError("COMMUNITY_SOURCE_COUNT", "Fewer than 20 community sources");
const fixedVersionCount = sources.filter(
	(source) => typeof source.versionRef === "string" && source.versionRef !== "null",
).length;
if (fixedVersionCount < 20) addError("FIXED_VERSION_COUNT", "Fewer than 20 fixed-version sources");
if (Object.keys(domainCounts).length < 8 || Object.keys(domainCounts).length > 10) {
	addError("DOMAIN_COUNT", `Domain count is ${Object.keys(domainCounts).length}; expected 8..10`);
}
for (const [domain, count] of Object.entries(domainCounts)) {
	if (count / sources.length > 0.25) addError("DOMAIN_SHARE", `${domain} exceeds 25%`);
	if (count < 14 || count > 22) {
		addWarning(
			"DOMAIN_PRINCIPLE_RANGE",
			`${domain} has ${count} sources; principle range is 14..22`,
		);
	}
}
const nonChineseCount = sources.filter((source) => source.language !== "zh-CN").length;
if (nonChineseCount / Math.max(1, sources.length) < 0.4) {
	addError("NON_CHINESE_RATIO", "Non-Chinese material ratio is below 40%");
}
const chineseQuestions = questions.filter((question) =>
	/[\u3400-\u9fff]/u.test(String(question.question)),
).length;
if (chineseQuestions / Math.max(1, questions.length) < 0.6) {
	addError("CHINESE_QUESTION_RATIO", "Chinese public question ratio is below 60%");
}
if ((languageSliceCounts["zh-question-en-evidence"] ?? 0) < 20) {
	addError(
		"CROSS_LANGUAGE_QUESTION_COUNT",
		"Fewer than 20 Chinese-question/English-evidence cases",
	);
}
const graphNative = ["T", "X", "K", "E"].reduce(
	(sum, key) => sum + (questionTypeCounts[key] ?? 0),
	0,
);
const controls = ["F", "C", "A", "U"].reduce((sum, key) => sum + (questionTypeCounts[key] ?? 0), 0);
if (graphNative < 24) addError("GRAPH_NATIVE_COUNT", `Only ${graphNative} graph-native questions`);
if (controls < 20) addError("CONTROL_COUNT", `Only ${controls} control questions`);

const inventoryMismatches: Finding[] = [];
const inventoryPaths = new Set(Object.keys(inventory));
for (const [item, declaredHash] of Object.entries(inventory)) {
	const absolutePath = join(stageRoot, item);
	if (!existsSync(absolutePath)) {
		inventoryMismatches.push({ code: "INVENTORY_MISSING_FILE", message: item });
		continue;
	}
	const actual = `sha256:${sha256Bytes(readFileSync(absolutePath))}`;
	if (actual !== declaredHash) {
		inventoryMismatches.push({ code: "INVENTORY_HASH_MISMATCH", message: item });
	}
}
for (const item of listFiles(stageRoot).map((pathValue) => relative(stageRoot, pathValue))) {
	if (item !== "contract-manifest.json" && !inventoryPaths.has(item)) {
		inventoryMismatches.push({ code: "INVENTORY_UNLISTED_FILE", message: item });
	}
}
errors.push(...inventoryMismatches);

const historicalSources = readHistoricalSources();
const historicalUrls = new Map(
	historicalSources.map((source) => [normalizeUrl(requireString(source, "canonicalUrl")), source]),
);
const historicalHashes = new Map(
	historicalSources.flatMap((source) =>
		[source.snapshotHash, source.artifactHash]
			.filter((value): value is string => typeof value === "string")
			.map((value) => [value, source] as const),
	),
);
for (const source of sources) {
	const sourceId = requireString(source, "sourceId");
	const urlMatch = historicalUrls.get(normalizeUrl(requireString(source, "canonicalUrl")));
	if (urlMatch) {
		addError("HISTORICAL_URL_OVERLAP", `${sourceId} overlaps ${String(urlMatch.sourceId)}`, [
			sourceId,
		]);
	}
	for (const hashValue of [source.snapshotHash, source.artifactHash]) {
		if (typeof hashValue !== "string") continue;
		const hashMatch = historicalHashes.get(hashValue);
		if (hashMatch) {
			addError("HISTORICAL_HASH_OVERLAP", `${sourceId} overlaps ${String(hashMatch.sourceId)}`, [
				sourceId,
			]);
		}
	}
}
if (
	sources.every(
		(source) =>
			Array.isArray(source.historicalOverlapEvidence) &&
			source.historicalOverlapEvidence.length === 0,
	)
) {
	addWarning(
		"SEMANTIC_OVERLAP_UNEVIDENCED",
		"All historicalOverlapEvidence arrays are empty; event/topic overlap still requires evaluator review",
	);
}

const readme = readFileSync(join(stageRoot, "README.md"), "utf8");
if (sources.length !== 150 && /150 份新源|150 份快照|150 份新源全部/u.test(readme)) {
	addWarning("STALE_README_COUNT", "README still contains final-delivery claims for 150 sources");
}
const leakageReport = join(stageRoot, "reports", "stage-a-leakage-scan.md");
if (existsSync(leakageReport) && forbiddenKeyPattern.test(readFileSync(leakageReport, "utf8"))) {
	addWarning(
		"LEAKAGE_REPORT_SELF_MATCH",
		"The leakage report itself enumerates forbidden Stage B field names; payload objects are clean",
	);
}

finish();

function finish(): never {
	const allFilesExceptContract = listFiles(stageRoot)
		.map((pathValue) => relative(stageRoot, pathValue))
		.filter((pathValue) => pathValue !== "contract-manifest.json")
		.sort();
	const treeHashInput = allFilesExceptContract
		.map((pathValue) => `${pathValue}\0${sha256Bytes(readFileSync(join(stageRoot, pathValue)))}`)
		.join("\n");
	const report = {
		schemaVersion: "wge-s200-stage-a-intake-validation/v1",
		stageRoot,
		status: errors.length === 0 ? "ACCEPT" : "ACCEPT_WITH_REPAIRS_BLOCK_FREEZE",
		stageBRead: false,
		counts: {
			sources: sources?.length ?? null,
			questions: questions?.length ?? null,
			episodes: episodes?.length ?? null,
			clusters: clusters?.length ?? null,
		},
		distributions:
			typeof accessCounts === "undefined"
				? null
				: {
						accessStatus: accessCounts,
						domains: domainCounts,
						roles: roleCounts,
						languages: languageCounts,
						questionTypes: questionTypeCounts,
						languageSlices: languageSliceCounts,
					},
		treeHash: `sha256:${sha256(treeHashInput)}`,
		errors,
		warnings,
		createdAt: new Date().toISOString(),
	};
	mkdirSync(dirname(reportPath), { recursive: true });
	writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
	console.log(JSON.stringify(report, null, 2));
	process.exit(errors.length === 0 ? 0 : 1);
}

function addError(code: string, message: string, refs?: string[]): void {
	errors.push({ code, message, ...(refs ? { refs } : {}) });
}

function addWarning(code: string, message: string, refs?: string[]): void {
	warnings.push({ code, message, ...(refs ? { refs } : {}) });
}

function checkCount(code: string, value: number, minimum: number, maximum: number): void {
	if (value < minimum || value > maximum) {
		addError(code, `${value} is outside ${minimum}..${maximum}`);
	}
}

function readJson(pathValue: string): JsonRecord {
	return JSON.parse(readFileSync(pathValue, "utf8")) as JsonRecord;
}

function readJsonl(pathValue: string): JsonRecord[] {
	return readFileSync(pathValue, "utf8")
		.split("\n")
		.filter((lineValue) => lineValue.trim().length > 0)
		.map((lineValue, index) => {
			try {
				return JSON.parse(lineValue) as JsonRecord;
			} catch (error) {
				throw new Error(`${pathValue}:${index + 1}: ${String(error)}`);
			}
		});
}

function readHistoricalSources(): JsonRecord[] {
	return [
		"workbuddy-batch-a/refined/source-manifest.jsonl",
		"workbuddy-batch-b/generated/source-manifest.jsonl",
		"batch-c-stage-a/manifests/source-manifest.jsonl",
	].flatMap((pathValue) => readJsonl(join(projectRoot, pathValue)));
}

function listFiles(root: string): string[] {
	return readdirSync(root, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map((entry) => join(entry.parentPath, entry.name))
		.sort();
}

function parseFrontmatter(content: string): JsonRecord {
	const match = content.match(/^---\n([\s\S]*?)\n---\n/u);
	if (!match?.[1]) throw new Error("Missing YAML frontmatter");
	const value = load(match[1]);
	if (!isRecord(value)) throw new Error("Invalid YAML frontmatter");
	return value;
}

function extractSnapshot(content: string): string {
	const startMarker = "## Source Snapshot";
	const endMarker = "## Research Notes";
	const start = content.indexOf(startMarker);
	const end = content.indexOf(endMarker, start + startMarker.length);
	if (start < 0 || end < 0) throw new Error("Invalid Source Snapshot boundaries");
	return `${content.slice(start + startMarker.length, end).trim()}\n`;
}

function uniqueMap(
	rows: JsonRecord[],
	key: string,
	duplicateCode: string,
): Map<string, JsonRecord> {
	const result = new Map<string, JsonRecord>();
	for (const row of rows) {
		const value = requireString(row, key);
		if (result.has(value)) addError(duplicateCode, `Duplicate ${key}: ${value}`, [value]);
		result.set(value, row);
	}
	return result;
}

function requireRecord(record: JsonRecord, key: string): JsonRecord {
	const value = record[key];
	if (!isRecord(value)) throw new Error(`Missing object field: ${key}`);
	return value;
}

function requireString(record: JsonRecord, key: string): string {
	const value = record[key];
	if (typeof value !== "string" || value.length === 0)
		throw new Error(`Missing string field: ${key}`);
	return value;
}

function requireStringArray(record: JsonRecord, key: string): string[] {
	const value = record[key];
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
		throw new Error(`Invalid string array: ${key}`);
	}
	return value as string[];
}

function isRecord(value: unknown): value is JsonRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function comparable(value: unknown): string {
	return value === null ? "null" : String(value);
}

function normalizeNewlines(value: string): string {
	return value.replace(/\r\n?/gu, "\n");
}

function stripHash(value: unknown): string {
	return String(value).replace(/^sha256:/u, "");
}

function sha256(value: string): string {
	return createHash("sha256").update(value, "utf8").digest("hex");
}

function sha256Bytes(value: Buffer): string {
	return createHash("sha256").update(value).digest("hex");
}

function normalizeUrl(value: string): string {
	try {
		const url = new URL(value);
		url.hash = "";
		url.hostname = url.hostname.toLowerCase().replace(/^www\./u, "");
		url.pathname = url.pathname.replace(/\/+$/u, "");
		return `${url.hostname}${url.pathname}${url.search}`;
	} catch {
		return value
			.toLowerCase()
			.replace(/^https?:\/\/(?:www\.)?/u, "")
			.replace(/\/+$/u, "");
	}
}

function extractStableIdentities(source: JsonRecord): string[] {
	const canonicalUrl = String(source.canonicalUrl ?? "");
	const text = [canonicalUrl, source.versionRef, source.title].join(" ");
	const result = new Set<string>();
	const arxivUrl = canonicalUrl.match(
		/(?:arxiv\.org\/(?:abs|html)\/|ar5iv\.labs\.arxiv\.org\/html\/)(\d{4}\.\d{4,5})(v\d+)?/iu,
	);
	if (arxivUrl?.[1]) {
		result.add(`arxiv:${arxivUrl[1]}:${arxivUrl[2]?.toLowerCase() ?? "unversioned"}`);
	}
	const doiUrl = canonicalUrl.match(/doi\.org\/(10\.\d{4,9}\/[A-Za-z0-9._;()/:+-]+)/iu);
	const declaredDoi = String(source.versionRef ?? "").match(
		/(?:^|\b)doi[:\s]+(10\.\d{4,9}\/[A-Za-z0-9._;()/:+-]+)/iu,
	);
	const doi = doiUrl?.[1] ?? declaredDoi?.[1];
	if (doi) result.add(`doi:${doi.toLowerCase().replace(/[.,;)]+$/u, "")}`);
	for (const match of text.matchAll(/CELEX[:\s]*(\d{5}[A-Z]\d{4})/giu)) {
		if (match[1]) result.add(`celex:${match[1].toUpperCase()}`);
	}
	return [...result];
}

function pushMap(map: Map<string, string[]>, key: string, value: string): void {
	map.set(key, [...(map.get(key) ?? []), value]);
}

function sameSet(left: Set<string>, right: Set<string>): boolean {
	return left.size === right.size && [...left].every((value) => right.has(value));
}

function countBy(rows: JsonRecord[], key: string): Record<string, number> {
	const result: Record<string, number> = {};
	for (const row of rows) {
		const value = String(row[key]);
		result[value] = (result[value] ?? 0) + 1;
	}
	return result;
}

function checkForbiddenObjectKeys(value: unknown, rootId: string, pathValue = ""): void {
	if (Array.isArray(value)) {
		for (const [index, item] of value.entries()) {
			checkForbiddenObjectKeys(item, rootId, `${pathValue}[${index}]`);
		}
		return;
	}
	if (!isRecord(value)) return;
	for (const [key, child] of Object.entries(value)) {
		const childPath = pathValue ? `${pathValue}.${key}` : key;
		if (forbiddenKeys.has(key)) {
			addError("STAGE_A_GOLD_FIELD", `${rootId} leaks ${childPath}`, [rootId, childPath]);
		}
		checkForbiddenObjectKeys(child, rootId, childPath);
	}
}
