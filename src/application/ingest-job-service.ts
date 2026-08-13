import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { getCompileState } from "../compiler/run-state.js";
import type { AppConfig } from "../config/types.js";
import { withRuntimeWriteLease } from "../infrastructure/runtime-write-lock.js";
import { ingestLoadedDocument } from "../ingestor/index.js";
import { writeJsonAtomic } from "../linter/storage.js";
import { parseMarkdownContent } from "../parser/markdown.js";
import type {
	IngestJob,
	RunWorkerOnceResponse,
	SubmitMaterialRequest,
	SubmitMaterialResponse,
} from "./contracts.js";
import { type IngestApplicationOptions, IngestApplicationService } from "./ingest-service.js";

const JOB_SCHEMA_VERSION = "wge-ingest-job/v1" as const;
const REMOTE_JOB_STALE_AFTER_MS = 2 * 60 * 60 * 1000;

export interface IngestJobServiceOptions extends IngestApplicationOptions {
	now?: () => Date;
}

/** Durable submission/worker boundary used by asynchronous transports such as MCP. */
export class IngestJobApplicationService {
	private readonly now: () => Date;

	constructor(
		private readonly config: AppConfig,
		private readonly options: IngestJobServiceOptions = {},
	) {
		this.now = options.now ?? (() => new Date());
	}

	submitMaterial(request: SubmitMaterialRequest): SubmitMaterialResponse {
		const normalized = normalizeSubmission(request);
		const parsed = parseMarkdownContent(normalized.content, normalized.sourceKey, normalized.uri);
		const requestHash = hashSubmission(normalized);
		return withRuntimeWriteLease(
			this.config,
			`submit-ingest-job:${normalized.idempotencyKey}`,
			() => {
				const jobs = this.readJobs();
				const sameKey = jobs.find((job) => job.idempotencyKey === normalized.idempotencyKey);
				if (sameKey) {
					if (sameKey.requestHash !== requestHash) {
						throw new Error("idempotencyKey was already used for a different ingest request");
					}
					return responseFor(sameKey, true);
				}
				const ingested = ingestLoadedDocument(this.config, {
					uri: normalized.uri,
					sourceType: "md",
					loaderVersion: "mcp-markdown-v1",
					sourceKey: normalized.sourceKey,
					title: normalized.title,
					metadata: normalized.metadata,
					parsedText: parsed.body,
					blocks: parsed.blocks,
				});
				const active = jobs.find(
					(job) =>
						job.sourceId === ingested.source.id && ["PENDING", "RUNNING"].includes(job.state),
				);
				if (active) return responseFor(active, true);

				const sourceState = sourceCompileState(this.config, ingested.source.id);
				if (sourceState === "COMPLETED" && !normalized.recompile) {
					return {
						sourceId: ingested.source.id,
						jobId: null,
						duplicate: true,
						state: "ALREADY_COMPLETED",
					};
				}
				const timestamp = this.now().toISOString();
				const job: IngestJob = {
					schemaVersion: JOB_SCHEMA_VERSION,
					jobId: randomUUID(),
					idempotencyKey: normalized.idempotencyKey,
					requestHash,
					sourceId: ingested.source.id,
					state: "PENDING",
					semantic: normalized.semantic,
					recompile: normalized.recompile,
					acceptPublicationDiff: normalized.acceptPublicationDiff,
					createdAt: timestamp,
					updatedAt: timestamp,
					attempts: 0,
					worker: null,
					result: null,
					error: null,
				};
				this.writeJob(job);
				return responseFor(job, ingested.isDuplicate);
			},
		);
	}

	readJobs(): IngestJob[] {
		const root = jobsRoot(this.config);
		if (!existsSync(root)) return [];
		return readdirSync(root)
			.filter((file) => file.endsWith(".json"))
			.sort()
			.map((file) => parseJob(readFileSync(join(root, file), "utf-8"), file))
			.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
	}

	getJob(jobId: string): IngestJob | null {
		const normalized = jobId.trim();
		if (!normalized) throw new Error("jobId must not be empty");
		return this.readJobs().find((job) => job.jobId === normalized) ?? null;
	}

	async runOnce(): Promise<RunWorkerOnceResponse> {
		const job = this.claimNextJob();
		if (!job) return { processed: false, job: null };
		const service = new IngestApplicationService(this.config, {
			providerFactory: this.options.providerFactory,
			onProgress: (event) => {
				this.touchRunningJob(job.jobId);
				this.options.onProgress?.(event);
			},
		});
		try {
			const result = await service.compileIngestedSource({
				sourceId: job.sourceId,
				semantic: job.semantic,
				recompile: job.recompile,
				acceptPublicationDiff: job.acceptPublicationDiff,
			});
			return { processed: true, job: this.finishJob(job.jobId, "COMPLETED", result, null) };
		} catch (error) {
			const failed = this.finishJob(
				job.jobId,
				"FAILED",
				null,
				error instanceof Error ? error.message : String(error),
			);
			return { processed: true, job: failed };
		}
	}

	retryFailedJob(jobId: string): IngestJob {
		const normalized = jobId.trim();
		if (!normalized) throw new Error("jobId must not be empty");
		return withRuntimeWriteLease(this.config, `retry-ingest-job:${normalized}`, () => {
			const job = this.getJob(normalized);
			if (!job) throw new Error(`Ingest job not found: ${normalized}`);
			if (job.state !== "FAILED") {
				throw new Error(`Only FAILED ingest jobs can be retried: ${normalized} is ${job.state}`);
			}
			const retried: IngestJob = {
				...job,
				state: "PENDING",
				updatedAt: this.now().toISOString(),
				worker: null,
				result: null,
				error: null,
			};
			this.writeJob(retried);
			return retried;
		});
	}

	private claimNextJob(): IngestJob | null {
		return withRuntimeWriteLease(this.config, "claim-ingest-job", () => {
			this.recoverStaleJobs();
			const pending = this.readJobs().find((job) => job.state === "PENDING");
			if (!pending) return null;
			const claimed: IngestJob = {
				...pending,
				state: "RUNNING",
				updatedAt: this.now().toISOString(),
				attempts: pending.attempts + 1,
				worker: { hostname: hostname(), pid: process.pid },
				error: null,
			};
			this.writeJob(claimed);
			return claimed;
		});
	}

	private recoverStaleJobs(): void {
		for (const job of this.readJobs()) {
			if (job.state !== "RUNNING" || !isStale(job, this.now().getTime())) continue;
			this.writeJob({
				...job,
				state: "PENDING",
				updatedAt: this.now().toISOString(),
				worker: null,
				error: "Recovered an abandoned worker lease",
			});
		}
	}

	private touchRunningJob(jobId: string): void {
		withRuntimeWriteLease(this.config, `heartbeat-ingest-job:${jobId}`, () => {
			const job = this.getJob(jobId);
			if (!job || job.state !== "RUNNING" || job.worker?.pid !== process.pid) return;
			this.writeJob({ ...job, updatedAt: this.now().toISOString() });
		});
	}

	private finishJob(
		jobId: string,
		state: "COMPLETED" | "FAILED",
		result: IngestJob["result"],
		error: string | null,
	): IngestJob {
		return withRuntimeWriteLease(this.config, `finish-ingest-job:${jobId}`, () => {
			const job = this.getJob(jobId);
			if (!job || job.state !== "RUNNING") throw new Error(`Ingest job is not running: ${jobId}`);
			const finished: IngestJob = {
				...job,
				state,
				updatedAt: this.now().toISOString(),
				worker: null,
				result,
				error,
			};
			this.writeJob(finished);
			return finished;
		});
	}

	private writeJob(job: IngestJob): void {
		writeJsonAtomic(join(jobsRoot(this.config), `${job.jobId}.json`), job);
	}
}

function normalizeSubmission(request: SubmitMaterialRequest) {
	const sourceKey = request.sourceKey.trim();
	const title = request.title.trim();
	const content = request.content;
	const idempotencyKey = request.idempotencyKey.trim();
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(sourceKey)) {
		throw new Error("sourceKey must be 1-128 safe filename characters");
	}
	if (!title) throw new Error("title must not be empty");
	if (!content.trim()) throw new Error("content must not be empty");
	if (!idempotencyKey || idempotencyKey.length > 200) {
		throw new Error("idempotencyKey must be 1-200 characters");
	}
	return {
		sourceKey,
		title,
		content,
		uri: request.uri?.trim() || `memory://${sourceKey}`,
		metadata: request.metadata ?? {},
		idempotencyKey,
		semantic: request.semantic ?? true,
		recompile: request.recompile ?? false,
		acceptPublicationDiff: request.acceptPublicationDiff ?? false,
	};
}

function hashSubmission(request: ReturnType<typeof normalizeSubmission>): string {
	return createHash("sha256")
		.update(
			JSON.stringify({
				sourceKey: request.sourceKey,
				title: request.title,
				content: request.content,
				uri: request.uri,
				metadata: Object.fromEntries(Object.entries(request.metadata).sort()),
				semantic: request.semantic,
				recompile: request.recompile,
				acceptPublicationDiff: request.acceptPublicationDiff,
			}),
		)
		.digest("hex");
}

function parseJob(raw: string, file: string): IngestJob {
	const parsed: unknown = JSON.parse(raw);
	if (
		!isRecord(parsed) ||
		parsed.schemaVersion !== JOB_SCHEMA_VERSION ||
		typeof parsed.jobId !== "string"
	) {
		throw new Error(`Invalid ingest job: ${file}`);
	}
	return parsed as unknown as IngestJob;
}

function jobsRoot(config: AppConfig): string {
	return join(config.runtimeRoot ?? config.projectRoot, "jobs");
}

function responseFor(job: IngestJob, duplicate: boolean): SubmitMaterialResponse {
	return { sourceId: job.sourceId, jobId: job.jobId, duplicate, state: job.state };
}

function isStale(job: IngestJob, now: number): boolean {
	if (!job.worker) return true;
	if (job.worker.hostname === hostname()) return !isProcessAlive(job.worker.pid);
	const updatedAt = Date.parse(job.updatedAt);
	return Number.isFinite(updatedAt) && now - updatedAt > REMOTE_JOB_STALE_AFTER_MS;
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function sourceCompileState(config: AppConfig, sourceId: string) {
	return getCompileState(config, sourceId);
}
