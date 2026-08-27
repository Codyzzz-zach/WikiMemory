import { createHash } from "node:crypto";
import type { CompileRunHandle } from "../compiler/run-state.js";
import { estimateTokens, observedChat, recordParseResult } from "../compiler/telemetry.js";
import type { AppConfig } from "../config/types.js";
import type { LLMProvider } from "../core/llm-provider.js";
import {
	SUPPORT_PREAUDIT_ROUTER_SYSTEM,
	SUPPORT_PREAUDIT_ROUTER_VERSION,
} from "../prompts/index.js";
import type { Claim, Relation } from "../types/index.js";
import { SupportRouterVerdictBatchSchema, parseLLMJson } from "../types/schemas.js";
import type { SupportRouterVerdict } from "../types/schemas.js";

const SUPPORT_ROUTER_BATCH_MAX_ITEMS = 8;
const SUPPORT_ROUTER_INPUT_TOKEN_BUDGET = 16_000;
const SUPPORT_ROUTER_MAX_ATTEMPTS = 2;

export interface SupportRouteInput {
	relation: Relation;
	fromClaim: Claim;
	toClaim: Claim;
}

export type SupportRouteDecisionSource = "MODEL" | "FAIL_OPEN";

export interface SupportRouteDecision {
	relation: Relation;
	decision: SupportRouterVerdict["decision"];
	failureModes: SupportRouterVerdict["failureModes"];
	decisionSource: SupportRouteDecisionSource;
	error?: string;
}

export interface SupportRoutingResult {
	fullAudit: Relation[];
	deferred: Relation[];
	decisions: SupportRouteDecision[];
}

/**
 * Route only cross-material SUPPORTS proposals before the authoritative semantic audit.
 * A router error fails open to the existing full audit; this optimization never publishes.
 */
export async function routeSupportCandidates(
	config: AppConfig,
	inputs: SupportRouteInput[],
	provider: LLMProvider,
	run: CompileRunHandle,
): Promise<SupportRoutingResult> {
	for (const input of inputs) {
		if (input.relation.type !== "SUPPORTS") {
			throw new Error(`SUPPORTS router cannot route ${input.relation.type}: ${input.relation.id}`);
		}
	}
	const groups = partitionInputs(inputs);
	const groupDecisions = await Promise.all(
		groups.map((group) => routeBatch(config, group, provider, run)),
	);
	const byId = new Map(groupDecisions.flat().map((decision) => [decision.relation.id, decision]));
	const decisions = inputs.map((input) => {
		const decision = byId.get(input.relation.id);
		if (!decision) throw new Error(`SUPPORTS router accounting mismatch: ${input.relation.id}`);
		return decision;
	});
	return {
		fullAudit: decisions
			.filter((decision) => decision.decision === "FULL_AUDIT")
			.map((decision) => decision.relation),
		deferred: decisions
			.filter((decision) => decision.decision === "DEFER_BY_TYPE_ROUTER")
			.map((decision) => ({ ...decision.relation, publicationState: "CANDIDATE" as const })),
		decisions,
	};
}

async function routeBatch(
	config: AppConfig,
	items: SupportRouteInput[],
	provider: LLMProvider,
	run: CompileRunHandle,
	attempt = 1,
): Promise<SupportRouteDecision[]> {
	const ids = items.map((item) => item.relation.id);
	const context = {
		runId: run.runId,
		sourceId: run.sourceId,
		stage: "CROSS_MATERIAL_RELATION_LINT" as const,
		batchId: `support-router-${ids.length}-${shortHash(ids.join("\n"))}`,
		attempt,
	};
	let callId: string | null = null;
	try {
		const observed = await observedChat(
			config,
			provider,
			{
				model: config.model,
				temperature: config.temperature,
				systemPrompt: SUPPORT_PREAUDIT_ROUTER_SYSTEM,
				messages: [
					{
						role: "user",
						content:
							attempt === 1
								? routerPrompt(items)
								: `${routerPrompt(items)}\n\n机器协议重试：items 数量和 objectId 必须与输入精确一致。`,
					},
				],
				responseFormat: "json_object",
				thinkingDisabled: true,
				maxTokens: Math.min(8192, Math.max(2048, items.length * 320)),
			},
			context,
		);
		callId = observed.callId;
		if (observed.result.finishReason === "length")
			throw new Error("SUPPORTS router output truncated");
		const parsed = parseLLMJson(observed.result.content, SupportRouterVerdictBatchSchema);
		validateObjectIds(
			ids,
			parsed.items.map((item) => item.objectId),
		);
		const verdictById = new Map(parsed.items.map((item) => [item.objectId, item.verdict]));
		const decisions = items.map((item) => {
			const verdict = verdictById.get(item.relation.id);
			if (!verdict) throw new Error(`Missing SUPPORTS router verdict: ${item.relation.id}`);
			validateVerdict(verdict);
			return {
				relation: item.relation,
				decision: verdict.decision,
				failureModes: verdict.failureModes,
				decisionSource: "MODEL" as const,
			};
		});
		recordParseResult(config, context, observed.callId, "VALID");
		return decisions;
	} catch (error) {
		if (callId) recordParseResult(config, context, callId, "INVALID", error);
		if (items.length > 1) {
			const middle = Math.ceil(items.length / 2);
			const [left, right] = await Promise.all([
				routeBatch(config, items.slice(0, middle), provider, run),
				routeBatch(config, items.slice(middle), provider, run),
			]);
			return [...left, ...right];
		}
		if (attempt < SUPPORT_ROUTER_MAX_ATTEMPTS) {
			return routeBatch(config, items, provider, run, attempt + 1);
		}
		const item = items[0];
		if (!item) return [];
		return [
			{
				relation: item.relation,
				decision: "FULL_AUDIT",
				failureModes: [],
				decisionSource: "FAIL_OPEN",
				error: error instanceof Error ? error.message : String(error),
			},
		];
	}
}

function partitionInputs(inputs: SupportRouteInput[]): SupportRouteInput[][] {
	const groups: SupportRouteInput[][] = [];
	let current: SupportRouteInput[] = [];
	for (const input of inputs) {
		const candidate = [...current, input];
		const exceedsCount = candidate.length > SUPPORT_ROUTER_BATCH_MAX_ITEMS;
		const exceedsTokens =
			estimateTokens(`${SUPPORT_PREAUDIT_ROUTER_SYSTEM}\n${routerPrompt(candidate)}`) >
			SUPPORT_ROUTER_INPUT_TOKEN_BUDGET;
		if (current.length > 0 && (exceedsCount || exceedsTokens)) {
			groups.push(current);
			current = [input];
		} else {
			current = candidate;
		}
	}
	if (current.length > 0) groups.push(current);
	return groups;
}

function routerPrompt(items: SupportRouteInput[]): string {
	return `调度以下 ${items.length} 条 From SUPPORTS To 候选。\n\n${items
		.map(
			(item) =>
				`## objectId=${item.relation.id}\nFrom: ${item.fromClaim.statement}\nFrom conditions: ${item.fromClaim.conditions.join("; ") || "无"}\nTo: ${item.toClaim.statement}\nTo conditions: ${item.toClaim.conditions.join("; ") || "无"}`,
		)
		.join(
			"\n\n---\n\n",
		)}\n\nrouterVersion=${SUPPORT_PREAUDIT_ROUTER_VERSION}\n只输出批处理 JSON envelope。`;
}

function validateObjectIds(expected: string[], actual: string[]): void {
	const expectedSorted = [...expected].sort();
	const actualSorted = [...actual].sort();
	if (
		expectedSorted.length !== actualSorted.length ||
		expectedSorted.some((id, index) => actualSorted[index] !== id)
	) {
		throw new Error("SUPPORTS router object IDs do not match input");
	}
}

function validateVerdict(verdict: SupportRouterVerdict): void {
	if (verdict.decision === "FULL_AUDIT" && verdict.failureModes.length > 0) {
		throw new Error("FULL_AUDIT cannot contain router failure modes");
	}
	if (verdict.decision === "DEFER_BY_TYPE_ROUTER" && verdict.failureModes.length === 0) {
		throw new Error("DEFER_BY_TYPE_ROUTER requires at least one failure mode");
	}
}

function shortHash(value: string): string {
	return createHash("sha256").update(value).digest("hex").slice(0, 12);
}
