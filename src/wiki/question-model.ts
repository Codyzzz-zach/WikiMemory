import { createHash } from "node:crypto";
import type {
	QuestionEvolutionDecision,
	QuestionFormationSignal,
	QuestionFrame,
	QuestionRef,
	Scope,
} from "../types/index.js";

export const QUESTION_FORMATION_VERSION = "wge-question-formation/v1" as const;
/** Formation, materialization, and Context Pack atomic injection share one hard bound. */
export const QUESTION_WIKI_CLAIM_LIMIT = 24;
export const QUESTION_STATE_SCHEMA_VERSION = "wge-question-state/v1" as const;

export function normalizeQuestionFrame(frame: QuestionFrame): QuestionFrame {
	return {
		...frame,
		stableAddress: frame.stableAddress.trim(),
		canonicalQuestion: frame.canonicalQuestion.trim(),
		aliases: uniqueSorted(frame.aliases.map((value) => value.trim()).filter(Boolean)),
		domain: frame.domain.trim(),
		boundaries: uniqueSorted(frame.boundaries.map((value) => value.trim()).filter(Boolean)),
		parentQuestionRefs: uniqueQuestionRefs(frame.parentQuestionRefs),
		childQuestionRefs: uniqueQuestionRefs(frame.childQuestionRefs),
		formationSignals: normalizeFormationSignals(frame.formationSignals),
	};
}

export function validateQuestionFrame(input: QuestionFrame): QuestionFrame {
	const frame = normalizeQuestionFrame(input);
	if (!String(frame.id).startsWith("question:")) {
		throw new Error(`QuestionFrame id 必须以 question: 开头: ${frame.id}`);
	}
	if (!frame.stableAddress.startsWith("question/")) {
		throw new Error(`QuestionFrame stableAddress 必须以 question/ 开头: ${frame.stableAddress}`);
	}
	if (/(^|[/#])source[:/]|#block(?:-|\/)/i.test(frame.stableAddress)) {
		throw new Error(
			`QuestionFrame stableAddress 不得由 Source/Block 身份构成: ${frame.stableAddress}`,
		);
	}
	if (!frame.canonicalQuestion)
		throw new Error(`QuestionFrame canonicalQuestion 不能为空: ${frame.id}`);
	if (!frame.domain) throw new Error(`QuestionFrame domain 不能为空: ${frame.id}`);
	if (frame.boundaries.length === 0)
		throw new Error(`QuestionFrame 至少需要一个语义边界: ${frame.id}`);
	validateScope(frame.scope, frame.id);
	assertNoSelfReference(frame.id, frame.parentQuestionRefs, "parentQuestionRefs");
	assertNoSelfReference(frame.id, frame.childQuestionRefs, "childQuestionRefs");
	if (frame.lifecycle === "MERGED" && !frame.mergedInto) {
		throw new Error(`MERGED QuestionFrame 必须指定 mergedInto: ${frame.id}`);
	}
	if (frame.lifecycle !== "MERGED" && frame.mergedInto) {
		throw new Error(`只有 MERGED QuestionFrame 可以指定 mergedInto: ${frame.id}`);
	}
	if (frame.mergedInto === frame.id)
		throw new Error(`QuestionFrame 不得 merge 到自身: ${frame.id}`);
	if (frame.lifecycle === "CANDIDATE" && frame.publicationState !== "CANDIDATE") {
		throw new Error(`CANDIDATE QuestionFrame 必须保持 CANDIDATE publicationState: ${frame.id}`);
	}
	if (frame.lifecycle !== "CANDIDATE" && frame.publicationState !== "CANONICAL") {
		throw new Error(`非候选 QuestionFrame 必须为 CANONICAL publicationState: ${frame.id}`);
	}
	if (frame.publicationState === "QUARANTINED") {
		throw new Error(`QuestionFrame quarantine 必须物理隔离，不能进入当前状态: ${frame.id}`);
	}
	if (frame.formationSignals.length === 0) {
		throw new Error(`QuestionFrame 必须保留至少一个 formation signal: ${frame.id}`);
	}
	if (!frame.createdAtKnowledgeVersion || !frame.updatedAtKnowledgeVersion) {
		throw new Error(`QuestionFrame 必须绑定知识版本: ${frame.id}`);
	}
	assertIsoDate(frame.createdAt, `${frame.id}.createdAt`);
	assertIsoDate(frame.updatedAt, `${frame.id}.updatedAt`);
	return frame;
}

export function validateQuestionEvolutionDecision(
	decision: QuestionEvolutionDecision,
): QuestionEvolutionDecision {
	if (!decision.id.startsWith("question-decision:")) {
		throw new Error(`QuestionEvolutionDecision id 非法: ${decision.id}`);
	}
	if (!decision.knowledgeVersion || !decision.sourceId || !decision.formationVersion) {
		throw new Error(`QuestionEvolutionDecision 缺少版本或来源: ${decision.id}`);
	}
	if (decision.questionRefs.length === 0) {
		throw new Error(`QuestionEvolutionDecision 至少引用一个问题: ${decision.id}`);
	}
	if (decision.reasonCodes.length === 0) {
		throw new Error(`QuestionEvolutionDecision 至少需要一个 reason code: ${decision.id}`);
	}
	assertIsoDate(decision.createdAt, `${decision.id}.createdAt`);
	return {
		...decision,
		questionRefs: uniqueQuestionRefs(decision.questionRefs),
		affectedClaimRefs: [...new Set(decision.affectedClaimRefs)].sort(),
		affectedRelationIds: uniqueSorted(decision.affectedRelationIds),
		reasonCodes: uniqueSorted(decision.reasonCodes),
	};
}

export function isQuestionFrameConsumable(frame: QuestionFrame): boolean {
	return frame.lifecycle === "ACTIVE" && frame.publicationState === "CANONICAL";
}

export function questionFrameHash(frame: QuestionFrame): string {
	const normalized = normalizeQuestionFrame(frame);
	return hashStable({
		...normalized,
		createdAt: undefined,
		updatedAt: undefined,
	});
}

export function questionStateHash(frames: QuestionFrame[]): string {
	return hashStable(
		frames
			.map((frame) => normalizeQuestionFrame(frame))
			.sort((left, right) => String(left.id).localeCompare(String(right.id))),
	);
}

function normalizeFormationSignals(signals: QuestionFormationSignal[]): QuestionFormationSignal[] {
	return signals
		.map((signal) => ({
			...signal,
			sourceIds: uniqueSorted(signal.sourceIds),
			claimRefs: [...new Set(signal.claimRefs)].sort(),
			relationIds: uniqueSorted(signal.relationIds),
			conceptRefs: [...new Set(signal.conceptRefs)].sort(),
			reason: signal.reason.trim(),
		}))
		.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

function validateScope(scope: Scope, ownerId: string): void {
	if (scope.type === "PROJECT" && !scope.id?.trim()) {
		throw new Error(`PROJECT QuestionFrame 必须指定 scope.id: ${ownerId}`);
	}
}

function assertNoSelfReference(id: QuestionRef, references: QuestionRef[], field: string): void {
	if (references.includes(id)) throw new Error(`QuestionFrame ${field} 不得引用自身: ${id}`);
}

function uniqueQuestionRefs(values: QuestionRef[]): QuestionRef[] {
	return [...new Set(values)].sort((left, right) => String(left).localeCompare(String(right)));
}

function uniqueSorted(values: string[]): string[] {
	return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function assertIsoDate(value: string, field: string): void {
	if (!value || !Number.isFinite(Date.parse(value))) throw new Error(`${field} 必须是 ISO 日期`);
}

function hashStable(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
