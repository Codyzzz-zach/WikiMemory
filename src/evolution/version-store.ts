import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import type { AppConfig } from "../config/types.js";
import {
	computeKnowledgeVersion,
	readAllAssertedRecords,
	readAllClaims,
	readAllConcepts,
	readAllRelations,
	readAllWikiModules,
} from "../linter/storage.js";

export interface SnapshotFile {
	path: string;
	sha256: string;
	content: string;
}

export interface KnowledgeSnapshot {
	schemaVersion: "wge-knowledge-snapshot/v1";
	id: string;
	label: string;
	createdAt: string;
	knowledgeVersion: string;
	filesHash: string;
	files: SnapshotFile[];
}

const MANAGED_LOCATIONS: Array<{
	directory: string;
	names?: readonly string[];
	extensions?: readonly string[];
}> = [
	{ directory: "publications", extensions: [".json"] },
	{ directory: "quarantine/publications", extensions: [".json"] },
	{ directory: "claims", names: ["claims.jsonl"] },
	{ directory: "concepts", names: ["concepts.jsonl"] },
	{ directory: "relations", names: ["edges.jsonl"] },
	{ directory: "quarantine", names: ["claims.jsonl", "relations.jsonl"] },
	{ directory: "wiki", extensions: [".json", ".jsonl"] },
	{ directory: "assertions", names: ["asserted-records.jsonl"] },
];

/**
 * 冻结全部可变派生知识；Source/Span 是不可变证据，不重复复制。
 */
export function createKnowledgeSnapshot(config: AppConfig, label: string): KnowledgeSnapshot {
	if (!label.trim()) throw new Error("知识快照 label 不能为空");
	const files = readManagedFiles(config.projectRoot);
	const filesHash = hashFiles(files);
	const createdAt = new Date().toISOString();
	const id = `ks-${createdAt.replaceAll(/[:.]/g, "-")}-${filesHash.slice(0, 12)}`;
	const snapshot: KnowledgeSnapshot = {
		schemaVersion: "wge-knowledge-snapshot/v1",
		id,
		label: label.trim(),
		createdAt,
		knowledgeVersion: currentKnowledgeVersion(config),
		filesHash,
		files,
	};
	writeBufferAtomic(
		snapshotPath(config.projectRoot, id),
		gzipSync(Buffer.from(`${JSON.stringify(snapshot)}\n`, "utf-8")),
	);
	return snapshot;
}

export function readKnowledgeSnapshot(config: AppConfig, snapshotId: string): KnowledgeSnapshot {
	const path = snapshotPath(config.projectRoot, snapshotId);
	if (!existsSync(path)) throw new Error(`找不到知识快照: ${snapshotId}`);
	const snapshot = JSON.parse(
		gunzipSync(readFileSync(path)).toString("utf-8"),
	) as KnowledgeSnapshot;
	if (
		snapshot.schemaVersion !== "wge-knowledge-snapshot/v1" ||
		snapshot.id !== snapshotId ||
		hashFiles(snapshot.files) !== snapshot.filesHash
	) {
		throw new Error(`知识快照完整性失败: ${snapshotId}`);
	}
	for (const file of snapshot.files) {
		if (sha256(file.content) !== file.sha256) {
			throw new Error(`知识快照文件哈希失败: ${file.path}`);
		}
		resolveManagedPath(config.projectRoot, file.path);
	}
	return snapshot;
}

/**
 * 恢复快照前必须提供调用方观察到的当前 knowledgeVersion，防止并发状态被覆盖。
 * 恢复后重新计算内容版本，任何不一致都会显式失败。
 */
export function restoreKnowledgeSnapshot(
	config: AppConfig,
	snapshotId: string,
	expectedCurrentVersion: string,
): KnowledgeSnapshot {
	const actualCurrentVersion = currentKnowledgeVersion(config);
	if (actualCurrentVersion !== expectedCurrentVersion) {
		throw new Error(
			`知识状态已变化，拒绝回滚: expected=${expectedCurrentVersion}, actual=${actualCurrentVersion}`,
		);
	}
	const snapshot = readKnowledgeSnapshot(config, snapshotId);
	createKnowledgeSnapshot(config, `automatic pre-rollback backup for ${snapshotId}`);
	const snapshotPaths = new Set(snapshot.files.map((file) => file.path));
	for (const current of readManagedFiles(config.projectRoot)) {
		if (!snapshotPaths.has(current.path)) {
			unlinkSync(resolveManagedPath(config.projectRoot, current.path));
		}
	}
	for (const file of snapshot.files) {
		writeTextAtomic(resolveManagedPath(config.projectRoot, file.path), file.content);
	}
	const restoredVersion = currentKnowledgeVersion(config);
	if (restoredVersion !== snapshot.knowledgeVersion) {
		throw new Error(
			`回滚后知识版本不一致: expected=${snapshot.knowledgeVersion}, actual=${restoredVersion}`,
		);
	}
	return snapshot;
}

export function currentKnowledgeVersion(config: AppConfig): string {
	return computeKnowledgeVersion(
		readAllClaims(config),
		readAllConcepts(config),
		readAllRelations(config),
		readAllWikiModules(config),
		readAllAssertedRecords(config),
	);
}

function readManagedFiles(projectRoot: string): SnapshotFile[] {
	const files: SnapshotFile[] = [];
	for (const location of MANAGED_LOCATIONS) {
		const directory = join(projectRoot, location.directory);
		if (!existsSync(directory)) continue;
		for (const name of readdirSync(directory).sort()) {
			const allowedByName = location.names?.includes(name) ?? false;
			const allowedByExtension =
				location.extensions?.some((extension) => name.endsWith(extension)) ?? false;
			if (!allowedByName && !allowedByExtension) continue;
			const absolutePath = join(directory, name);
			const content = readFileSync(absolutePath, "utf-8");
			files.push({
				path: relative(projectRoot, absolutePath).split(sep).join("/"),
				sha256: sha256(content),
				content,
			});
		}
	}
	return files.sort((left, right) => left.path.localeCompare(right.path));
}

function hashFiles(files: SnapshotFile[]): string {
	return sha256(JSON.stringify(files.map((file) => ({ path: file.path, sha256: file.sha256 }))));
}

function snapshotPath(projectRoot: string, snapshotId: string): string {
	if (!/^ks-[a-zA-Z0-9-]+$/.test(snapshotId) || basename(snapshotId) !== snapshotId) {
		throw new Error(`非法知识快照 ID: ${snapshotId}`);
	}
	return join(projectRoot, "versions", `${snapshotId}.json.gz`);
}

function resolveManagedPath(projectRoot: string, relativePath: string): string {
	const normalized = relativePath.split("/").join(sep);
	const absolute = resolve(projectRoot, normalized);
	const root = `${resolve(projectRoot)}${sep}`;
	if (!absolute.startsWith(root)) throw new Error(`知识快照路径越界: ${relativePath}`);
	const allowed = MANAGED_LOCATIONS.some((location) => {
		if (dirname(absolute) !== resolve(projectRoot, location.directory)) return false;
		const name = basename(absolute);
		return (
			(location.names?.includes(name) ?? false) ||
			(location.extensions?.some((extension) => name.endsWith(extension)) ?? false)
		);
	});
	if (!allowed) throw new Error(`知识快照包含非托管路径: ${relativePath}`);
	return absolute;
}

function writeTextAtomic(path: string, content: string): void {
	writeBufferAtomic(path, Buffer.from(content, "utf-8"));
}

function writeBufferAtomic(path: string, content: Buffer): void {
	mkdirSync(join(path, ".."), { recursive: true });
	const temporaryPath = `${path}.tmp-${process.pid}-${Date.now()}`;
	writeFileSync(temporaryPath, content, { flag: "wx" });
	renameSync(temporaryPath, path);
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}
