import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { hostname } from "node:os";
import { join, resolve } from "node:path";
import type { AppConfig } from "../config/types.js";

const DEFAULT_STALE_AFTER_MS = 5 * 60 * 1000;
const activeLeaseContext = new AsyncLocalStorage<ReadonlySet<string>>();

interface RuntimeWriteLeaseOwner {
	schemaVersion: "wge-runtime-write-lease/v1";
	token: string;
	operation: string;
	hostname: string;
	pid: number;
	acquiredAt: string;
}

interface RuntimeWriteLease {
	lockPath: string;
	owner: RuntimeWriteLeaseOwner;
}

export interface RuntimeWriteLeaseOptions {
	staleAfterMs?: number;
	now?: () => number;
}

export class RuntimeWriteConflictError extends Error {
	readonly code = "RUNTIME_WRITE_CONFLICT";

	constructor(message: string) {
		super(message);
		this.name = "RuntimeWriteConflictError";
	}
}

/**
 * Serialize complete runtime mutation windows while allowing nested calls in the same use case.
 * LLM compilation and read-only work must stay outside this lease; only short commit windows use it.
 */
export function withRuntimeWriteLease<T>(
	config: AppConfig,
	operation: string,
	work: () => T,
	options: RuntimeWriteLeaseOptions = {},
): T {
	const lockPath = runtimeLockPath(config);
	const inherited = activeLeaseContext.getStore();
	if (inherited?.has(lockPath)) return work();

	const lease = acquireRuntimeWriteLease(config, operation, options);
	const context = new Set(inherited ?? []);
	context.add(lockPath);
	return activeLeaseContext.run(context, () => {
		try {
			const result = work();
			if (isPromiseLike(result)) {
				return result.finally(() => releaseRuntimeWriteLease(lease)) as T;
			}
			releaseRuntimeWriteLease(lease);
			return result;
		} catch (error) {
			releaseRuntimeWriteLease(lease);
			throw error;
		}
	});
}

function acquireRuntimeWriteLease(
	config: AppConfig,
	operation: string,
	options: RuntimeWriteLeaseOptions,
): RuntimeWriteLease {
	if (operation.trim().length === 0) throw new Error("Runtime write operation must not be empty");
	const now = options.now ?? Date.now;
	const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
	if (!Number.isFinite(staleAfterMs) || staleAfterMs <= 0) {
		throw new Error(`staleAfterMs must be positive, received: ${staleAfterMs}`);
	}
	const lockPath = runtimeLockPath(config);
	mkdirSync(join(lockPath, ".."), { recursive: true });

	for (let attempt = 0; attempt < 2; attempt += 1) {
		try {
			mkdirSync(lockPath);
			const owner: RuntimeWriteLeaseOwner = {
				schemaVersion: "wge-runtime-write-lease/v1",
				token: randomUUID(),
				operation: operation.trim(),
				hostname: hostname(),
				pid: process.pid,
				acquiredAt: new Date(now()).toISOString(),
			};
			try {
				writeFileSync(join(lockPath, "owner.json"), `${JSON.stringify(owner, null, 2)}\n`, {
					flag: "wx",
				});
			} catch (error) {
				rmSync(lockPath, { recursive: true, force: true });
				throw error;
			}
			return { lockPath, owner };
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			assertLockIsDirectory(lockPath);
			if (attempt === 0 && isRecoverableStaleLock(lockPath, staleAfterMs, now())) {
				archiveStaleLock(lockPath);
				continue;
			}
			throw conflictFor(lockPath);
		}
	}
	throw conflictFor(lockPath);
}

function releaseRuntimeWriteLease(lease: RuntimeWriteLease): void {
	if (!existsSync(lease.lockPath)) return;
	const owner = readOwner(lease.lockPath);
	if (owner?.token !== lease.owner.token) return;
	rmSync(lease.lockPath, { recursive: true, force: true });
}

function runtimeLockPath(config: AppConfig): string {
	return join(resolve(config.runtimeRoot ?? config.projectRoot), ".locks", "canonical-writer");
}

function isRecoverableStaleLock(lockPath: string, staleAfterMs: number, now: number): boolean {
	const owner = readOwner(lockPath);
	if (owner) {
		if (owner.hostname === hostname()) return !isProcessAlive(owner.pid);
		const acquiredAt = Date.parse(owner.acquiredAt);
		return Number.isFinite(acquiredAt) && now - acquiredAt > staleAfterMs;
	}
	return now - statSync(lockPath).mtimeMs > staleAfterMs;
}

function archiveStaleLock(lockPath: string): void {
	const stalePath = `${lockPath}.stale-${randomUUID()}`;
	try {
		renameSync(lockPath, stalePath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
		throw error;
	}
	rmSync(stalePath, { recursive: true, force: true });
}

function conflictFor(lockPath: string): RuntimeWriteConflictError {
	const owner = readOwner(lockPath);
	const detail = owner
		? `${owner.operation} on ${owner.hostname} pid=${owner.pid} since ${owner.acquiredAt}`
		: "owner metadata is not yet available";
	return new RuntimeWriteConflictError(`Canonical writer is busy: ${detail}`);
}

function readOwner(lockPath: string): RuntimeWriteLeaseOwner | null {
	try {
		const parsed = JSON.parse(
			readFileSync(join(lockPath, "owner.json"), "utf-8"),
		) as Partial<RuntimeWriteLeaseOwner>;
		if (
			parsed.schemaVersion !== "wge-runtime-write-lease/v1" ||
			typeof parsed.token !== "string" ||
			typeof parsed.operation !== "string" ||
			typeof parsed.hostname !== "string" ||
			typeof parsed.pid !== "number" ||
			typeof parsed.acquiredAt !== "string"
		) {
			return null;
		}
		return parsed as RuntimeWriteLeaseOwner;
	} catch {
		return null;
	}
}

function assertLockIsDirectory(lockPath: string): void {
	const stats = lstatSync(lockPath);
	if (!stats.isDirectory() || stats.isSymbolicLink()) {
		throw new Error(`Runtime write lock path is not a safe directory: ${lockPath}`);
	}
}

function isProcessAlive(pid: number): boolean {
	if (!Number.isSafeInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

function isPromiseLike<T>(value: T): value is T & Promise<Awaited<T>> {
	return (
		typeof value === "object" &&
		value !== null &&
		"then" in value &&
		typeof value.then === "function"
	);
}
