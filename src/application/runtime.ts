import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AppConfig } from "../config/types.js";

export const RUNTIME_LAYOUT_VERSION = "wge-runtime-layout/v2";
const LEGACY_RUNTIME_LAYOUT_VERSION = "wge-runtime-layout/v1";

export interface RuntimeLayoutManifest {
	schemaVersion: typeof RUNTIME_LAYOUT_VERSION;
	createdAt: string;
	directories: string[];
}

const LEGACY_RUNTIME_DIRECTORIES = [
	"sources",
	"publications",
	"quarantine/publications",
	"quarantine/wiki",
	"wiki",
	"claims",
	"concepts",
	"relations",
	"assertions",
	"versions",
	"indexes",
	"runs",
] as const;

const RUNTIME_DIRECTORIES = [...LEGACY_RUNTIME_DIRECTORIES, "jobs"] as const;

/** Explicit operation: loading config never creates state directories. */
export function initializeRuntime(config: AppConfig): RuntimeLayoutManifest {
	const root = runtimeRoot(config);
	mkdirSync(root, { recursive: true });
	const manifestPath = join(root, "runtime-layout.json");
	if (existsSync(manifestPath)) {
		const parsed = readRuntimeManifestCandidate(manifestPath);
		if (parsed.schemaVersion === LEGACY_RUNTIME_LAYOUT_VERSION) {
			assertDirectoryContract(parsed, LEGACY_RUNTIME_DIRECTORIES, manifestPath);
			for (const directory of RUNTIME_DIRECTORIES)
				mkdirSync(join(root, directory), { recursive: true });
			const migrated: RuntimeLayoutManifest = {
				schemaVersion: RUNTIME_LAYOUT_VERSION,
				createdAt: parsed.createdAt,
				directories: [...RUNTIME_DIRECTORIES],
			};
			writeManifestAtomic(manifestPath, migrated);
			return migrated;
		}
		const existing = readRuntimeManifest(manifestPath);
		for (const directory of RUNTIME_DIRECTORIES)
			mkdirSync(join(root, directory), { recursive: true });
		return existing;
	}

	for (const directory of RUNTIME_DIRECTORIES) {
		mkdirSync(join(root, directory), { recursive: true });
	}

	const manifest: RuntimeLayoutManifest = {
		schemaVersion: RUNTIME_LAYOUT_VERSION,
		createdAt: new Date().toISOString(),
		directories: [...RUNTIME_DIRECTORIES],
	};
	writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
	return manifest;
}

export function assertRuntimeReady(config: AppConfig): RuntimeLayoutManifest {
	const manifestPath = join(runtimeRoot(config), "runtime-layout.json");
	if (!existsSync(manifestPath)) {
		throw new Error(`Runtime is not initialized: ${manifestPath}`);
	}
	const manifest = readRuntimeManifest(manifestPath);
	for (const directory of RUNTIME_DIRECTORIES) {
		if (!existsSync(join(runtimeRoot(config), directory))) {
			throw new Error(`Runtime directory is missing: ${directory}`);
		}
	}
	return manifest;
}

function runtimeRoot(config: AppConfig): string {
	const root = resolve(config.runtimeRoot ?? config.projectRoot);
	if (root === resolve("/")) throw new Error("Runtime root must not be the filesystem root");
	return root;
}

function readRuntimeManifest(manifestPath: string): RuntimeLayoutManifest {
	const parsed = readRuntimeManifestCandidate(manifestPath);
	if (parsed.schemaVersion !== RUNTIME_LAYOUT_VERSION) {
		throw new Error(
			`Unsupported runtime layout: ${String(parsed.schemaVersion)}; expected ${RUNTIME_LAYOUT_VERSION}`,
		);
	}
	assertDirectoryContract(parsed, RUNTIME_DIRECTORIES, manifestPath);
	return parsed as unknown as RuntimeLayoutManifest;
}

function readRuntimeManifestCandidate(manifestPath: string): Record<string, unknown> & {
	schemaVersion: unknown;
	createdAt: string;
	directories: unknown[];
} {
	const parsed: unknown = JSON.parse(readFileSync(manifestPath, "utf-8"));
	if (
		!isRecord(parsed) ||
		typeof parsed.createdAt !== "string" ||
		!Array.isArray(parsed.directories)
	) {
		throw new Error(`Invalid runtime layout manifest: ${manifestPath}`);
	}
	return parsed as Record<string, unknown> & {
		schemaVersion: unknown;
		createdAt: string;
		directories: unknown[];
	};
}

function assertDirectoryContract(
	manifest: { directories: unknown[] },
	expected: readonly string[],
	manifestPath: string,
): void {
	if (
		manifest.directories.length !== expected.length ||
		manifest.directories.some((directory, index) => directory !== expected[index])
	) {
		throw new Error(`Runtime layout directory contract mismatch: ${manifestPath}`);
	}
}

function writeManifestAtomic(manifestPath: string, manifest: RuntimeLayoutManifest): void {
	const temporaryPath = `${manifestPath}.${randomUUID()}.tmp`;
	writeFileSync(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
	renameSync(temporaryPath, manifestPath);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
