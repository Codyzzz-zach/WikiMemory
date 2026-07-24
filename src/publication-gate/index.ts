import { join } from "node:path";
import type { AppConfig } from "../config/types.js";
import type { SourcePublication, SourceQuarantinePublication } from "../linter/storage.js";
import { resolveSpanById, writeJsonAtomic } from "../linter/storage.js";
import { RELATION_AUDIT_VERSION, SEMANTIC_AUDIT_VERSION } from "../prompts/index.js";
import type { Claim, Source, SourceSpan } from "../types/index.js";

export type PublicationGateStatus = "PASS" | "REVIEW_REQUIRED" | "FAIL";

export interface PublicationGateIssue {
	code:
		| "NO_CANONICAL_CLAIMS"
		| "BROKEN_CLAIM_EVIDENCE"
		| "BROKEN_RELATION_EVIDENCE"
		| "BROKEN_RELATION_ENDPOINT"
		| "UNAUDITED_RELATION"
		| "EMPTY_EQUIVALENCE_CONDITION"
		| "CLAIM_CONDITION_DROPPED"
		| "CLAIM_COUNT_DROP"
		| "HIGH_CLAIM_CHURN"
		| "QUARANTINE_RATE_INCREASE";
	severity: "BLOCK" | "REVIEW";
	detail: string;
}

export interface PublicationDiffReport {
	schemaVersion: "pilot-publication-diff/v1";
	runId: string;
	sourceId: string;
	generatedAt: string;
	status: PublicationGateStatus;
	acceptedReview: boolean;
	runtime: {
		requestedModel: string;
		temperature: number;
		semanticAuditVersion: string;
		relationAuditVersion: string;
		sourceHash: string;
	};
	baseline: null | PublicationCounts;
	candidate: PublicationCounts;
	diff: {
		retainedClaimIds: number;
		addedClaimIds: string[];
		removedClaimIds: string[];
		claimRetentionRate: number | null;
		claimCountChangeRate: number | null;
		conditionsDropped: Array<{ statement: string; before: string[]; after: string[] }>;
	};
	issues: PublicationGateIssue[];
}

interface PublicationCounts {
	claims: number;
	concepts: number;
	relations: number;
	quarantinedClaims: number;
	quarantinedRelations: number;
	quarantineRate: number;
}

export interface PublicationGateInput {
	config: AppConfig;
	runId: string;
	source: Source;
	baseline: SourcePublication | null;
	candidate: SourcePublication;
	quarantine: SourceQuarantinePublication;
	allSpans: SourceSpan[];
	allCanonicalClaims: Claim[];
	acceptReview?: boolean;
}

/**
 * Publication diff gate.
 *
 * Deterministic integrity failures always block publication. Large but potentially legitimate
 * semantic changes require an explicit human acknowledgement on recompilation. A first compile
 * has no semantic baseline, so it is judged only by integrity checks.
 */
export function evaluatePublicationGate(input: PublicationGateInput): PublicationDiffReport {
	const { config, runId, source, baseline, candidate, quarantine, allSpans } = input;
	const issues: PublicationGateIssue[] = [];
	const baselineClaimIds = new Set(baseline?.claims.map((claim) => claim.id) ?? []);
	const candidateClaimIds = new Set(candidate.claims.map((claim) => claim.id));
	const prospectiveClaimIds = new Set(
		input.allCanonicalClaims
			.filter((claim) => !baselineClaimIds.has(claim.id))
			.map((claim) => claim.id),
	);
	for (const claimId of candidateClaimIds) prospectiveClaimIds.add(claimId);

	if (candidate.claims.length === 0) {
		issues.push({
			code: "NO_CANONICAL_CLAIMS",
			severity: "BLOCK",
			detail: "候选 publication 没有任何 canonical Claim。",
		});
	}

	for (const claim of candidate.claims) {
		const broken = claim.evidenceSpanIds.filter((spanId) => !resolveSpanById(allSpans, spanId));
		if (broken.length > 0) {
			issues.push({
				code: "BROKEN_CLAIM_EVIDENCE",
				severity: "BLOCK",
				detail: `${claim.id} 的证据无法解析: ${broken.join(", ")}`,
			});
		}
	}

	for (const relation of candidate.relations) {
		const from = relation.from as string;
		const to = relation.to as string;
		if (!prospectiveClaimIds.has(from) || !prospectiveClaimIds.has(to)) {
			issues.push({
				code: "BROKEN_RELATION_ENDPOINT",
				severity: "BLOCK",
				detail: `${relation.id} 的端点不在候选 canonical Claim 集合中: ${from} -> ${to}`,
			});
		}
		const brokenEvidence = relation.evidenceSpanIds.filter(
			(spanId) => !resolveSpanById(allSpans, spanId),
		);
		if (brokenEvidence.length > 0) {
			issues.push({
				code: "BROKEN_RELATION_EVIDENCE",
				severity: "BLOCK",
				detail: `${relation.id} 的证据无法解析: ${brokenEvidence.join(", ")}`,
			});
		}
		if (
			relation.relationAuditVersion !== RELATION_AUDIT_VERSION ||
			relation.conditionStatus === "UNVERIFIED"
		) {
			issues.push({
				code: "UNAUDITED_RELATION",
				severity: "BLOCK",
				detail: `${relation.id} 缺少当前边级审计证明。`,
			});
		}
		if (relation.type === "EQUIVALENT_UNDER" && relation.conditions.length === 0) {
			issues.push({
				code: "EMPTY_EQUIVALENCE_CONDITION",
				severity: "BLOCK",
				detail: `${relation.id} 是 EQUIVALENT_UNDER，但没有适用条件。`,
			});
		}
	}

	const conditionsDropped = findDroppedClaimConditions(baseline?.claims ?? [], candidate.claims);
	for (const dropped of conditionsDropped) {
		issues.push({
			code: "CLAIM_CONDITION_DROPPED",
			severity: "BLOCK",
			detail: `同一命题在重编后丢失条件：${dropped.statement}`,
		});
	}

	const oldCounts = baseline ? counts(baseline, null) : null;
	const newCounts = counts(candidate, quarantine);
	const retainedClaimIds = baseline
		? baseline.claims.filter((claim) => candidateClaimIds.has(claim.id)).length
		: 0;
	const claimRetentionRate = baseline?.claims.length
		? retainedClaimIds / baseline.claims.length
		: null;
	const claimCountChangeRate = baseline?.claims.length
		? (candidate.claims.length - baseline.claims.length) / baseline.claims.length
		: null;

	if (baseline && claimCountChangeRate !== null && claimCountChangeRate < -0.25) {
		issues.push({
			code: "CLAIM_COUNT_DROP",
			severity: "REVIEW",
			detail: `Canonical Claim 数量下降 ${formatPercent(-claimCountChangeRate)}，超过 25% 复核线。`,
		});
	}
	if (baseline && claimRetentionRate !== null && claimRetentionRate < 0.5) {
		issues.push({
			code: "HIGH_CLAIM_CHURN",
			severity: "REVIEW",
			detail: `旧 Claim ID 保留率为 ${formatPercent(claimRetentionRate)}，低于 50% 复核线。`,
		});
	}
	if (
		oldCounts &&
		newCounts.quarantineRate > 0.25 &&
		newCounts.quarantineRate - oldCounts.quarantineRate > 0.1
	) {
		issues.push({
			code: "QUARANTINE_RATE_INCREASE",
			severity: "REVIEW",
			detail: `Claim 隔离率由 ${formatPercent(oldCounts.quarantineRate)} 上升到 ${formatPercent(newCounts.quarantineRate)}。`,
		});
	}

	const hasBlocker = issues.some((issue) => issue.severity === "BLOCK");
	const hasReview = issues.some((issue) => issue.severity === "REVIEW");
	const acceptedReview = input.acceptReview === true;
	const status: PublicationGateStatus = hasBlocker
		? "FAIL"
		: hasReview && !acceptedReview
			? "REVIEW_REQUIRED"
			: "PASS";

	return {
		schemaVersion: "pilot-publication-diff/v1",
		runId,
		sourceId: source.id,
		generatedAt: new Date().toISOString(),
		status,
		acceptedReview,
		runtime: {
			requestedModel: config.model,
			temperature: config.temperature,
			semanticAuditVersion: SEMANTIC_AUDIT_VERSION,
			relationAuditVersion: RELATION_AUDIT_VERSION,
			sourceHash: source.hash,
		},
		baseline: oldCounts,
		candidate: newCounts,
		diff: {
			retainedClaimIds,
			addedClaimIds: candidate.claims
				.filter((claim) => !baselineClaimIds.has(claim.id))
				.map((claim) => claim.id),
			removedClaimIds: (baseline?.claims ?? [])
				.filter((claim) => !candidateClaimIds.has(claim.id))
				.map((claim) => claim.id),
			claimRetentionRate,
			claimCountChangeRate,
			conditionsDropped,
		},
		issues,
	};
}

export function writePublicationDiffReport(
	config: AppConfig,
	report: PublicationDiffReport,
): string {
	const path = join(config.runsDir, report.runId, "publication-diff.json");
	writeJsonAtomic(path, report);
	return path;
}

function counts(
	publication: SourcePublication,
	quarantine: SourceQuarantinePublication | null,
): PublicationCounts {
	const quarantinedClaims = quarantine?.claims.length ?? 0;
	const consideredClaims = publication.claims.length + quarantinedClaims;
	return {
		claims: publication.claims.length,
		concepts: publication.concepts.length,
		relations: publication.relations.length,
		quarantinedClaims,
		quarantinedRelations: quarantine?.relations.length ?? 0,
		quarantineRate: consideredClaims === 0 ? 0 : quarantinedClaims / consideredClaims,
	};
}

function findDroppedClaimConditions(
	baselineClaims: Claim[],
	candidateClaims: Claim[],
): Array<{ statement: string; before: string[]; after: string[] }> {
	const candidateByStatement = new Map(
		candidateClaims.map((claim) => [normalizeStatement(claim.statement), claim]),
	);
	return baselineClaims.flatMap((before) => {
		if (before.conditions.length === 0) return [];
		const after = candidateByStatement.get(normalizeStatement(before.statement));
		if (!after || after.conditions.length > 0) return [];
		return [{ statement: after.statement, before: before.conditions, after: after.conditions }];
	});
}

function normalizeStatement(value: string): string {
	return value
		.normalize("NFKC")
		.toLowerCase()
		.replace(/\*\*|__|`|\$/g, "")
		.replace(/[，,；;：:。.!！?？“”"'（）()\[\]{}]/g, "")
		.replace(/\s+/g, "")
		.trim();
}

function formatPercent(value: number): string {
	return `${(value * 100).toFixed(1)}%`;
}
