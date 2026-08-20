import { createHash } from "node:crypto";
import type { CompileRunHandle } from "../compiler/run-state.js";
import { observedChat, recordParseResult } from "../compiler/telemetry.js";
import type { AppConfig } from "../config/types.js";
import type { LLMProvider } from "../core/llm-provider.js";
import { QUESTION_PROPOSAL_SYSTEM, QUESTION_PROPOSAL_VERSION } from "../prompts/index.js";
import type { Claim, Concept, QuestionFrame, Relation, Source } from "../types/index.js";
import { questionRef } from "../types/index.js";
import { QuestionProposalResponseSchema, parseLLMJson } from "../types/schemas.js";
import type { QuestionCandidateProposal } from "./question-formation-v2.js";
import type { QuestionLifecycleProposal } from "./question-lifecycle.js";

export interface QuestionProposalInput {
	run: CompileRunHandle;
	source: Source;
	declaredDomain: string;
	newClaims: Claim[];
	relevantRelations: Relation[];
	concepts: Concept[];
	existingFrames: QuestionFrame[];
}

export interface QuestionProposalResult {
	schemaVersion: "wge-question-proposal/v1";
	promptVersion: typeof QUESTION_PROPOSAL_VERSION;
	proposals: QuestionCandidateProposal[];
	lifecycleProposals: QuestionLifecycleProposal[];
}

export async function proposeQuestionCandidates(
	config: AppConfig,
	provider: LLMProvider,
	input: QuestionProposalInput,
): Promise<QuestionProposalResult> {
	if (!input.declaredDomain.trim()) throw new Error("Question proposal declaredDomain 不能为空");
	const prepared = prepareQuestionProposal(input);
	const options = {
		model: config.model,
		systemPrompt: QUESTION_PROPOSAL_SYSTEM,
		messages: [{ role: "user" as const, content: JSON.stringify(prepared.payload) }],
		responseFormat: "json_object" as const,
		maxTokens: 4096,
		temperature: config.temperature,
		thinkingDisabled: true,
	};
	const context = {
		runId: input.run.runId,
		sourceId: input.source.id,
		stage: "QUESTION_PROPOSAL" as const,
		batchId: "question-proposal",
		attempt: 0,
	};
	const observed = await observedChat(config, provider, options, context);
	if (observed.result.finishReason === "length") {
		recordParseResult(config, context, observed.callId, "INVALID", "finishReason=length");
		throw new Error("Question proposal 输出被 maxTokens 截断");
	}
	try {
		const parsed = parseLLMJson(observed.result.content, QuestionProposalResponseSchema);
		recordParseResult(config, context, observed.callId, "VALID");
		const proposals = parsed.questions.map((draft) => {
			const stableDraft = {
				...draft,
				domain: input.declaredDomain.trim(),
				matchQuestionIndex: draft.matchQuestionIndex ?? null,
				aliases: [...new Set(draft.aliases)].sort(),
				boundaries: [...new Set(draft.boundaries)].sort(),
				claimIndexes: uniqueSortedIndexes(draft.claimIndexes),
				relationIndexes: uniqueSortedIndexes(draft.relationIndexes),
				conceptIndexes: uniqueSortedIndexes(draft.conceptIndexes),
			};
			const proposalId = `question-proposal:${createHash("sha256")
				.update(JSON.stringify(stableDraft))
				.digest("hex")
				.slice(0, 24)}`;
			return {
				proposalId,
				matchQuestionRef:
					stableDraft.matchQuestionIndex === null
						? null
						: questionRef(
								String(
									resolveIndex(
										prepared.existingFrames,
										stableDraft.matchQuestionIndex,
										"matchQuestionIndex",
									).id,
								),
							),
				canonicalQuestion: stableDraft.canonicalQuestion,
				aliases: stableDraft.aliases,
				domain: stableDraft.domain,
				scope: stableDraft.scope,
				boundaries: stableDraft.boundaries,
				claimIds: stableDraft.claimIndexes.map(
					(index) => resolveIndex(prepared.claims, index, "claimIndex").id,
				),
				relationIds: stableDraft.relationIndexes.map(
					(index) => resolveIndex(prepared.relations, index, "relationIndex").id,
				),
				conceptIds: stableDraft.conceptIndexes.map(
					(index) => resolveIndex(prepared.concepts, index, "conceptIndex").id,
				),
				recommendedLifecycle: stableDraft.recommendedLifecycle,
				rationale: stableDraft.rationale,
			} satisfies QuestionCandidateProposal;
		});
		const lifecycleProposals = parsed.lifecycleProposals.map((draft) => {
			const stableDraft = {
				...draft,
				questionIndexes: uniqueSortedIndexes(draft.questionIndexes),
				claimIndexes: uniqueSortedIndexes(draft.claimIndexes),
				relationIndexes: uniqueSortedIndexes(draft.relationIndexes),
				reasonCodes: [...new Set(draft.reasonCodes)].sort(),
				targets: draft.targets.map((target) => ({
					...target,
					aliases: [...new Set(target.aliases)].sort(),
					boundaries: [...new Set(target.boundaries)].sort(),
				})),
			};
			return {
				proposalId: `question-lifecycle-proposal:${createHash("sha256")
					.update(JSON.stringify(stableDraft))
					.digest("hex")
					.slice(0, 24)}`,
				action: stableDraft.action,
				questionRefs: stableDraft.questionIndexes.map((index) =>
					questionRef(String(resolveIndex(prepared.existingFrames, index, "questionIndex").id)),
				),
				targets: stableDraft.targets,
				claimIds: stableDraft.claimIndexes.map(
					(index) => resolveIndex(prepared.claims, index, "claimIndex").id,
				),
				relationIds: stableDraft.relationIndexes.map(
					(index) => resolveIndex(prepared.relations, index, "relationIndex").id,
				),
				reasonCodes: stableDraft.reasonCodes,
				rationale: stableDraft.rationale,
			} satisfies QuestionLifecycleProposal;
		});
		return {
			schemaVersion: "wge-question-proposal/v1",
			promptVersion: QUESTION_PROPOSAL_VERSION,
			proposals,
			lifecycleProposals,
		};
	} catch (error) {
		recordParseResult(config, context, observed.callId, "INVALID", error);
		throw error;
	}
}

function prepareQuestionProposal(input: QuestionProposalInput) {
	const newClaimIds = new Set(input.newClaims.map((claim) => claim.id));
	const claimIndex = new Map(input.newClaims.map((claim, index) => [claim.id, index]));
	const relations = input.relevantRelations.filter(
		(relation) => newClaimIds.has(String(relation.from)) || newClaimIds.has(String(relation.to)),
	);
	const relevantFrames = input.existingFrames
		.filter(
			(frame) =>
				frame.domain === input.declaredDomain && !["MERGED", "SPLIT"].includes(frame.lifecycle),
		)
		.slice(0, 40);
	const payload = {
		schemaVersion: "wge-question-proposal-input/v2",
		declaredDomain: input.declaredDomain,
		source: {
			id: input.source.id,
			title: input.source.metadata?.title ?? null,
		},
		claims: input.newClaims.map((claim, index) => ({
			index,
			statement: claim.statement,
			conditions: claim.conditions,
			validity: claim.validity,
			claimKind: claim.claimKind,
			scope: claim.scope,
		})),
		relations: relations.map((relation, index) => ({
			index,
			fromClaimIndex: claimIndex.get(String(relation.from)) ?? null,
			toClaimIndex: claimIndex.get(String(relation.to)) ?? null,
			type: relation.type,
			conditions: relation.conditions,
		})),
		concepts: input.concepts.map((concept, index) => ({
			index,
			name: concept.name,
			aliases: concept.aliases,
			boundary: concept.boundary,
			domain: concept.domain,
		})),
		existingQuestions: relevantFrames.map((frame, index) => ({
			index,
			canonicalQuestion: frame.canonicalQuestion,
			aliases: frame.aliases,
			boundaries: frame.boundaries,
			domain: frame.domain,
			scope: frame.scope,
			lifecycle: frame.lifecycle,
		})),
	};
	return {
		payload,
		claims: input.newClaims,
		relations,
		concepts: input.concepts,
		existingFrames: relevantFrames,
	};
}

function uniqueSortedIndexes(values: number[]): number[] {
	return [...new Set(values)].sort((left, right) => left - right);
}

function resolveIndex<T>(items: T[], index: number, label: string): T {
	const value = items[index];
	if (value === undefined) throw new Error(`${label} 越界: ${index}/${items.length}`);
	return value;
}
