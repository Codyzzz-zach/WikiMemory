import type { AppConfig } from "../config/types.js";
import { currentKnowledgeVersion } from "../evolution/version-store.js";
import type {
	GetIngestOperationalStatusRequest,
	GetIngestOperationalStatusResponse,
} from "./contracts.js";
import { IngestJobApplicationService } from "./ingest-job-service.js";
import { KnowledgeApplicationService } from "./knowledge-service.js";

/** Joins durable queue state with compiler state without leaking storage files to transports. */
export class IngestCoordinatorApplicationService {
	private readonly jobs: IngestJobApplicationService;
	private readonly knowledge: KnowledgeApplicationService;

	constructor(private readonly config: AppConfig) {
		this.jobs = new IngestJobApplicationService(config);
		this.knowledge = new KnowledgeApplicationService(config);
	}

	getStatus(request: GetIngestOperationalStatusRequest = {}): GetIngestOperationalStatusResponse {
		if (request.sourceId !== undefined && request.sourceId.trim().length === 0) {
			throw new Error("sourceId must not be empty");
		}
		if (request.jobId !== undefined && request.jobId.trim().length === 0) {
			throw new Error("jobId must not be empty");
		}
		return {
			sources: this.knowledge.getIngestStatus({ sourceId: request.sourceId }).sources,
			jobs: this.jobs
				.readJobs()
				.filter((job) => request.jobId === undefined || job.jobId === request.jobId)
				.filter((job) => request.sourceId === undefined || job.sourceId === request.sourceId)
				.map((job) => ({
					jobId: job.jobId,
					sourceId: job.sourceId,
					state: job.state,
					createdAt: job.createdAt,
					updatedAt: job.updatedAt,
					attempts: job.attempts,
					resultState: job.result?.compileState ?? null,
					error: job.error,
					retryable: job.state === "FAILED",
				})),
			lastHealthyVersion: currentKnowledgeVersion(this.config),
		};
	}
}
