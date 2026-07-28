import { join } from "node:path";
import type { AppConfig } from "../config/types.js";
import { appendJsonl } from "../linter/storage.js";

export type RelationFunnelStage = "CANDIDATE_SELECTION" | "DETECTION" | "LINT" | "PUBLISH";

export interface RelationFunnelEvent {
	schemaVersion: "wge-relation-funnel/v1";
	eventType: "RELATION_FUNNEL";
	stage: RelationFunnelStage;
	runId: string;
	sourceId: string;
	timestamp: string;
	payload: Record<string, unknown>;
}

export function recordRelationFunnelEvent(
	config: AppConfig,
	event: Omit<RelationFunnelEvent, "schemaVersion" | "eventType" | "timestamp">,
): void {
	appendJsonl(join(config.runsDir, "relation-funnel.jsonl"), [
		{
			...event,
			schemaVersion: "wge-relation-funnel/v1",
			eventType: "RELATION_FUNNEL",
			timestamp: new Date().toISOString(),
		} satisfies RelationFunnelEvent,
	]);
}
