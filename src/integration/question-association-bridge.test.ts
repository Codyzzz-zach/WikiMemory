import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
	type QuestionAssociationDecision,
	type QuestionAssociationFixtureCase,
	type QuestionAssociationOracleCase,
	type QuestionAssociationVariant,
	auditQuestionAssociationDecisions,
	buildQuestionAssociationPayload,
	buildQuestionIdentityCard,
	serializeQuestionAssociationPayload,
} from "../wiki/question-association-shadow.js";

interface FrozenInput {
	schemaVersion: string;
	status: string;
	knowledgeBoundary: string;
	cases: QuestionAssociationFixtureCase[];
}

interface FrozenOracle {
	schemaVersion: string;
	status: string;
	cases: QuestionAssociationOracleCase[];
}

interface FrozenManifest {
	status: string;
	authority: {
		oracleProviderVisible: boolean;
		canonicalMutationAllowed: boolean;
		providerCallsMade: number;
	};
	files: {
		oracle: { path: string; sha256: string; providerVisible: boolean };
		input: { path: string; sha256: string; providerVisible: boolean };
		providerPayloads: Array<{ path: string; sha256: string; estimatedTokens: number }>;
	};
	providerEnvelope: { payloadCount: number; estimatedTokensBeforeResponses: number };
	budget: { maxProviderTokens: number };
}

const projectRoot = resolve(import.meta.dirname, "../..");
const benchmarkRoot = join(projectRoot, "benchmarks", "question-association-bridge-v1");

describe("C1.5-A Question Association Bridge zero-call Gate", () => {
	it("freezes 18 opaque, temporally valid pairs without provider-visible Gold", () => {
		const input = readJson<FrozenInput>(join(benchmarkRoot, "input.json"));
		const oracle = readJson<FrozenOracle>(join(benchmarkRoot, "oracle.json"));
		const manifest = readJson<FrozenManifest>(join(benchmarkRoot, "manifest.json"));

		expect(input.status).toBe("FROZEN_ZERO_CALL_INPUT");
		expect(input.knowledgeBoundary).toBe("HUMAN_SELECTED_CANONICAL_KNOWLEDGE_ONLY");
		expect(input.cases).toHaveLength(18);
		expect(oracle.cases).toHaveLength(18);
		expect(oracle.cases.reduce(countVerdicts, {} as Record<string, number>)).toEqual({
			ATTACH: 7,
			REJECT: 8,
			UNCERTAIN: 3,
		});
		expect(input.cases.every((item) => /^QAB-(PSY|TEC|LAW)-\d{2}$/.test(item.caseId))).toBe(true);
		for (const item of input.cases) {
			expect(item.question.stateHash).toBe(item.beforeQuestionStateHash);
			expect(item.priorClaims.length).toBeGreaterThan(0);
			expect(item.priorClaims.some((claim) => claim.sourceId === item.sourceId)).toBe(false);
			expect(item.priorClaims.some((claim) => claim.ref === item.claim.ref)).toBe(false);
			expect(item.claim.evidenceRefs.every((evidence) => evidence.baseSpanRef.length > 0)).toBe(
				true,
			);
		}
		expect(manifest.status).toBe("READY_FOR_ZERO_CALL_GATE");
		expect(manifest.authority).toMatchObject({
			oracleProviderVisible: false,
			canonicalMutationAllowed: false,
			providerCallsMade: 0,
		});
		expect(manifest.files.oracle.providerVisible).toBe(false);
		expect(manifest.files.input.providerVisible).toBe(false);
	});

	it("rebuilds all six provider payloads byte-for-byte and within the accepted budget", () => {
		const input = readJson<FrozenInput>(join(benchmarkRoot, "input.json"));
		const manifest = readJson<FrozenManifest>(join(benchmarkRoot, "manifest.json"));
		const domains = [...new Set(input.cases.map((item) => item.domain))].sort();
		const variants: QuestionAssociationVariant[] = ["A0_NAME_CARD", "A1_EVIDENCE_IDENTITY_CARD"];
		const rebuilt = new Map<string, string>();
		for (const domain of domains) {
			const domainCases = input.cases.filter((item) => item.domain === domain);
			for (const variant of variants) {
				const payload = buildQuestionAssociationPayload(domainCases, variant);
				const replay = buildQuestionAssociationPayload([...domainCases].reverse(), variant);
				const serialized = serializeQuestionAssociationPayload(payload);
				expect(serialized).toBe(serializeQuestionAssociationPayload(replay));
				expect(serialized).not.toContain("expectedVerdict");
				expect(serialized).not.toContain("FROZEN_BEFORE_PROVIDER_CALLS");
				rebuilt.set(sha256Text(serialized), serialized);
			}
		}

		expect(rebuilt.size).toBe(6);
		expect(manifest.files.providerPayloads).toHaveLength(6);
		for (const file of manifest.files.providerPayloads) {
			const content = readFileSync(join(projectRoot, file.path), "utf8");
			expect(sha256Text(content)).toBe(file.sha256);
			expect(rebuilt.has(file.sha256)).toBe(true);
		}
		expect(manifest.providerEnvelope.payloadCount).toBe(6);
		expect(manifest.providerEnvelope.estimatedTokensBeforeResponses).toBeLessThan(
			manifest.budget.maxProviderTokens,
		);
	});

	it("passes the deterministic Gate for the frozen oracle and fails no Canonical mutation check", () => {
		const input = readJson<FrozenInput>(join(benchmarkRoot, "input.json"));
		const oracle = readJson<FrozenOracle>(join(benchmarkRoot, "oracle.json"));
		const oracleById = new Map(oracle.cases.map((item) => [item.caseId, item]));
		for (const variant of ["A0_NAME_CARD", "A1_EVIDENCE_IDENTITY_CARD"] as const) {
			for (const domain of [...new Set(input.cases.map((item) => item.domain))]) {
				const cases = input.cases.filter((item) => item.domain === domain);
				const decisions = cases.map((item) =>
					oracleDecision(
						item,
						oracleById.get(item.caseId) as QuestionAssociationOracleCase,
						variant,
					),
				);
				const result = auditQuestionAssociationDecisions({
					variant,
					cases,
					oracle: cases.map((item) => oracleById.get(item.caseId) as QuestionAssociationOracleCase),
					decisions: { decisions },
					canonicalStateHashBefore: "frozen-canonical-state",
					canonicalStateHashAfter: "frozen-canonical-state",
				});
				expect(result.status).toBe("PASS");
				expect(result.blockers).toEqual([]);
				expect(result.summary.canonicalMutationCount).toBe(0);
			}
		}
	});

	it("binds the manifest to the frozen oracle and input hashes", () => {
		const manifest = readJson<FrozenManifest>(join(benchmarkRoot, "manifest.json"));
		for (const file of [manifest.files.oracle, manifest.files.input]) {
			expect(sha256File(join(projectRoot, file.path))).toBe(file.sha256);
		}
	});
});

function oracleDecision(
	input: QuestionAssociationFixtureCase,
	oracle: QuestionAssociationOracleCase,
	variant: QuestionAssociationVariant,
): QuestionAssociationDecision {
	const card = buildQuestionIdentityCard(input, variant);
	const representative = card.representativeClaims[0];
	return {
		caseId: input.caseId,
		claimRef: input.claim.ref,
		questionRef: input.question.ref,
		verdict: oracle.expectedVerdict,
		reasonCodes: oracle.reasonCodes,
		groundedClaimRefs: [input.claim.ref, ...(representative ? [representative.claimRef] : [])],
		groundedEvidenceRefs: [input.claim.evidenceRefs[0]?.ref as string],
		groundedQuestionClaimRefs: representative ? [representative.claimRef] : [],
		boundaryNotes: [input.question.boundaries[0] as string],
		competingQuestionRefs: [],
	};
}

function countVerdicts(
	counts: Record<string, number>,
	item: QuestionAssociationOracleCase,
): Record<string, number> {
	counts[item.expectedVerdict] = (counts[item.expectedVerdict] ?? 0) + 1;
	return counts;
}

function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, "utf8")) as T;
}

function sha256File(path: string): string {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function sha256Text(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}
