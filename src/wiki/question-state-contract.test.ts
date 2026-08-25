import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

interface ManifestAsset {
	role: string;
	path: string;
	sha256: string;
}

interface ContractManifest {
	status: string;
	scope: {
		questionIdentity: string;
		taskRelevanceIncluded: boolean;
		marginalCostIncluded: boolean;
		providerCallsAuthorizedBeforeDeterministicMicro: number;
	};
	assets: ManifestAsset[];
	microAcceptance: {
		requiredTransitions: string[];
		providerCalls: number;
		providerTokens: number;
	};
	nextStageBoundary: {
		stage: string;
		authorizedByThisManifest: boolean;
	};
}

interface FrozenFile {
	path: string;
	sha256: string;
}

interface InputReceipt {
	status: string;
	acceptedContract: FrozenFile & { acceptanceCommit: string };
	providerUsageAtFreeze: {
		calls: number;
		tokens: number;
		answerCalls: number;
		recompilationCalls: number;
	};
	identityBoundary: {
		questionFramesAreFrozenInputs: boolean;
		questionIdentityIsAnInputAssumption: boolean;
		forbiddenMutations: string[];
	};
	i3Sim: {
		manifest: FrozenFile;
		result: FrozenFile;
		episodes: Array<{ questionRefs: string[]; requiredTransitions: string[] }>;
	};
	evolutionMicro: {
		manifest: FrozenFile;
		documents: FrozenFile[];
	};
	i25Isolation: {
		acceptanceReport: FrozenFile;
		materials: FrozenFile[];
		stableQuestionRefs: string[];
	};
}

interface ReasonCodeEntry {
	code: string;
	dimension: string;
}

interface ReasonCatalog {
	dimensionReasonCodes: ReasonCodeEntry[];
	transitionCodes: string[];
	hardFailureCodes: string[];
}

interface ProjectionSchema {
	additionalProperties: boolean;
	properties: Record<string, unknown>;
	$defs: {
		dimensionReason: {
			properties: {
				reasonCodes: { items: { enum: string[] } };
			};
		};
		branchAssessment: {
			properties: {
				standing: { enum: string[] };
				qualifiers: { items: { enum: string[] } };
			};
		};
	};
}

interface MicroCatalogEntry {
	id: string;
}

interface MicroClaim extends MicroCatalogEntry {
	conditions: string[];
	applicability: string[];
	evidenceSpanIds: string[];
}

interface MicroRelation extends MicroCatalogEntry {
	from: string;
	to: string;
	evidenceSpanIds: string[];
}

interface MicroSourceDocument {
	documentId: string;
	path: string;
	sha256: string;
}

interface MicroEvidenceSpan extends MicroCatalogEntry {
	documentId: string;
	sourceSha256: string;
	locator: {
		heading?: string;
		paragraphContains?: string;
	};
}

interface ExpectedBranch {
	branchId: string;
	claimRefs: string[];
	standing: string;
	qualifiers: string[];
	applicability: string[];
	conditions: string[];
	requiredReasonCodes: string[];
}

interface ExpectedUnresolvedFactor {
	reasonCode: string;
	claimRefs: string[];
	relationIds: string[];
	evidenceSpanIds: string[];
}

interface MicroSnapshot {
	timeline: string;
	knowledgeVersion: string;
	claimRefs: string[];
	relationIds: string[];
	evidenceSpanIds: string[];
	inputClosureHash: string;
	expectedTransitionCodes: string[];
	expectedBranchAssessments: ExpectedBranch[];
	expectedUnresolvedFactors: ExpectedUnresolvedFactor[];
}

interface EvolutionMicro {
	questionRef: string;
	questionIdentityMode: string;
	sourceDocuments: MicroSourceDocument[];
	claims: MicroClaim[];
	relations: MicroRelation[];
	evidenceSpans: MicroEvidenceSpan[];
	snapshots: MicroSnapshot[];
}

interface I3FailureSamples {
	sourceReport: FrozenFile & { knowledgeUse: string };
	samples: Array<{
		questionRefs: string[];
		baselineFailureCodes: string[];
		requiredTransitions: string[];
	}>;
	historicalAnswers: {
		allowedUse: string;
		maySupportProjection: boolean;
		mayBeRescored: boolean;
	};
}

const root = resolve(import.meta.dirname, "../..");
const benchmarkRoot = "benchmarks/c1-weighted-question-state-v1";

describe("C1 weighted question state contract", () => {
	it("freezes accepted inputs with a zero-call boundary", () => {
		const manifest = readJson<ContractManifest>(`${benchmarkRoot}/manifest.json`);
		const receipt = readJson<InputReceipt>(`${benchmarkRoot}/input-receipt.json`);
		expect(manifest.status).toBe("C1_A_FROZEN_C1_B_VALIDATED");
		expect(receipt.status).toBe("FROZEN");
		expect(receipt.acceptedContract.acceptanceCommit).toBe(
			"b89c746b171afacca837205947381b5c234b2f48",
		);
		expect(readText(receipt.acceptedContract.path)).toContain("> 状态：ACCEPTED");
		expect(manifest.scope.questionIdentity).toBe("INPUT_ASSUMPTION");
		expect(receipt.identityBoundary.questionFramesAreFrozenInputs).toBe(true);
		expect(receipt.identityBoundary.questionIdentityIsAnInputAssumption).toBe(true);
		expect(receipt.identityBoundary.forbiddenMutations).toEqual(
			expect.arrayContaining(["QuestionFrame", "question-formation-v2", "question-lifecycle"]),
		);
		expect(receipt.providerUsageAtFreeze).toEqual({
			calls: 0,
			tokens: 0,
			answerCalls: 0,
			recompilationCalls: 0,
		});
		expect(manifest.microAcceptance.providerCalls).toBe(0);
		expect(manifest.microAcceptance.providerTokens).toBe(0);
		expect(manifest.scope.providerCallsAuthorizedBeforeDeterministicMicro).toBe(0);
		expect(manifest.nextStageBoundary).toMatchObject({
			stage: "C1-C",
			authorizedByThisManifest: true,
		});
	});

	it("pins every portable input and contract asset by SHA-256", () => {
		const manifest = readJson<ContractManifest>(`${benchmarkRoot}/manifest.json`);
		const receipt = readJson<InputReceipt>(`${benchmarkRoot}/input-receipt.json`);
		const portableInputs = [
			receipt.acceptedContract,
			receipt.i3Sim.manifest,
			receipt.i3Sim.result,
			receipt.evolutionMicro.manifest,
			...receipt.evolutionMicro.documents,
			receipt.i25Isolation.acceptanceReport,
			...receipt.i25Isolation.materials,
		];
		for (const input of portableInputs) {
			expect(sha256File(input.path), input.path).toBe(input.sha256);
		}
		for (const asset of manifest.assets) {
			expect(sha256File(asset.path), `${asset.role}: ${asset.path}`).toBe(asset.sha256);
		}
	});

	it("keeps the sidecar schema multi-dimensional and excludes C2 variables", () => {
		const manifest = readJson<ContractManifest>(`${benchmarkRoot}/manifest.json`);
		const reasons = readJson<ReasonCatalog>(`${benchmarkRoot}/reason-codes.json`);
		const schema = readJson<ProjectionSchema>(
			`${benchmarkRoot}/question-state-projection.schema.json`,
		);
		const schemaText = JSON.stringify(schema);
		expect(schema.additionalProperties).toBe(false);
		expect(manifest.scope.taskRelevanceIncluded).toBe(false);
		expect(manifest.scope.marginalCostIncluded).toBe(false);
		expect(schema.properties).not.toHaveProperty("task_relevance");
		expect(schema.properties).not.toHaveProperty("marginal_cost");
		expect(schemaText).not.toContain("task_relevance");
		expect(schemaText).not.toContain("marginal_cost");
		expect(schema.$defs.branchAssessment.properties.standing.enum).toEqual([
			"LEADING",
			"CO_LEADING",
			"ALTERNATIVE",
			"HISTORICAL",
			"UNRANKED",
		]);
		expect(schema.$defs.branchAssessment.properties.qualifiers.items.enum).toEqual([
			"CONDITIONAL",
			"CONTESTED",
			"UNRESOLVED",
		]);
		expect([...schema.$defs.dimensionReason.properties.reasonCodes.items.enum].sort()).toEqual(
			reasons.dimensionReasonCodes.map((entry) => entry.code).sort(),
		);
		expect(new Set(reasons.dimensionReasonCodes.map((entry) => entry.dimension))).toEqual(
			new Set([
				"grounding",
				"authority",
				"currentness",
				"applicability",
				"relational_support",
				"uncertainty",
			]),
		);
	});

	it("freezes deterministic Evolution input closures and grounded oracle refs", () => {
		const micro = readJson<EvolutionMicro>(`${benchmarkRoot}/fixtures/evolution-micro.json`);
		const reasons = readJson<ReasonCatalog>(`${benchmarkRoot}/reason-codes.json`);
		const reasonCodes = new Set(reasons.dimensionReasonCodes.map((entry) => entry.code));
		const transitionCodes = new Set(reasons.transitionCodes);
		const documents = new Map(
			micro.sourceDocuments.map((document) => [document.documentId, document]),
		);
		expect(micro.questionIdentityMode).toBe("FROZEN_INPUT_ASSUMPTION");
		expect(micro.questionRef).toBe("question:c1-micro:northstar-transport-security");
		expect(micro.snapshots.map((snapshot) => snapshot.timeline)).toEqual(["T0", "T2", "T3"]);
		for (const span of micro.evidenceSpans) {
			const document = documents.get(span.documentId);
			if (!document) throw new Error(`Missing frozen source document: ${span.documentId}`);
			expect(sha256File(document.path), document.path).toBe(document.sha256);
			expect(span.sourceSha256).toBe(document.sha256);
			const source = readText(document.path);
			const locator = span.locator.heading
				? `## ${span.locator.heading}`
				: span.locator.paragraphContains;
			if (!locator) throw new Error(`Missing evidence locator: ${span.id}`);
			expect(source, span.id).toContain(locator);
		}

		for (const snapshot of micro.snapshots) {
			const closure = {
				questionRef: micro.questionRef,
				knowledgeVersion: snapshot.knowledgeVersion,
				claims: selectByIds(micro.claims, snapshot.claimRefs),
				relations: selectByIds(micro.relations, snapshot.relationIds),
				evidenceSpans: selectByIds(micro.evidenceSpans, snapshot.evidenceSpanIds),
			};
			expect(sha256Canonical(closure), snapshot.timeline).toBe(snapshot.inputClosureHash);
			const claimRefs = new Set(snapshot.claimRefs);
			const relationIds = new Set(snapshot.relationIds);
			const evidenceSpanIds = new Set(snapshot.evidenceSpanIds);
			for (const branch of snapshot.expectedBranchAssessments) {
				expect(
					branch.claimRefs.every((ref) => claimRefs.has(ref)),
					branch.branchId,
				).toBe(true);
				expect(
					branch.requiredReasonCodes.every((code) => reasonCodes.has(code)),
					branch.branchId,
				).toBe(true);
				expect(
					branch.conditions.every((condition) => claimConditionExists(micro, branch, condition)),
				).toBe(true);
				expect(
					branch.applicability.every((scope) => claimApplicabilityExists(micro, branch, scope)),
				).toBe(true);
			}
			for (const factor of snapshot.expectedUnresolvedFactors) {
				expect(reasonCodes.has(factor.reasonCode)).toBe(true);
				expect(factor.claimRefs.every((ref) => claimRefs.has(ref))).toBe(true);
				expect(factor.relationIds.every((id) => relationIds.has(id))).toBe(true);
				expect(factor.evidenceSpanIds.every((id) => evidenceSpanIds.has(id))).toBe(true);
			}
			expect(snapshot.expectedTransitionCodes.every((code) => transitionCodes.has(code))).toBe(
				true,
			);
		}
	});

	it("pre-registers all four Evolution transitions without flattening history or dispute", () => {
		const manifest = readJson<ContractManifest>(`${benchmarkRoot}/manifest.json`);
		const micro = readJson<EvolutionMicro>(`${benchmarkRoot}/fixtures/evolution-micro.json`);
		const observedTransitions = new Set(
			micro.snapshots.flatMap((snapshot) => snapshot.expectedTransitionCodes),
		);
		expect(
			manifest.microAcceptance.requiredTransitions.every((code) => observedTransitions.has(code)),
		).toBe(true);
		const t2 = snapshotByTimeline(micro, "T2");
		expect(branchById(t2, "branch:c1-micro:t0-external-tls12").standing).toBe("HISTORICAL");
		expect(branchById(t2, "branch:c1-micro:t0-internal-http")).toMatchObject({
			standing: "HISTORICAL",
			qualifiers: ["CONDITIONAL"],
		});
		expect(branchById(t2, "branch:c1-micro:independent-controls").standing).toBe("LEADING");
		const t3 = snapshotByTimeline(micro, "T3");
		expect(branchById(t3, "branch:c1-micro:event-disable-mtls")).toMatchObject({
			standing: "UNRANKED",
			qualifiers: ["CONDITIONAL", "CONTESTED", "UNRESOLVED"],
		});
		expect(branchById(t3, "branch:c1-micro:event-maintain-mtls")).toMatchObject({
			standing: "UNRANKED",
			qualifiers: ["CONTESTED", "UNRESOLVED"],
		});
		expect(t3.expectedUnresolvedFactors.map((factor) => factor.reasonCode).sort()).toEqual([
			"NO_AUTHORIZED_DECISION",
			"PEER_CONFLICT_UNRESOLVED",
		]);
	});

	it("keeps I3 answers diagnostic-only and freezes all episode verdict slots", () => {
		const receipt = readJson<InputReceipt>(`${benchmarkRoot}/input-receipt.json`);
		const reasons = readJson<ReasonCatalog>(`${benchmarkRoot}/reason-codes.json`);
		const failures = readJson<I3FailureSamples>(
			`${benchmarkRoot}/fixtures/i3-failure-samples.json`,
		);
		const hardFailureCodes = new Set(reasons.hardFailureCodes);
		const transitionCodes = new Set(reasons.transitionCodes);
		expect(sha256File(failures.sourceReport.path)).toBe(failures.sourceReport.sha256);
		expect(failures.sourceReport.knowledgeUse).toBe("DIAGNOSTIC_ONLY");
		expect(failures.historicalAnswers).toEqual({
			allowedUse: "FAILURE_DIAGNOSIS_ONLY",
			maySupportProjection: false,
			mayBeRescored: false,
		});
		expect(failures.samples).toHaveLength(3);
		for (const sample of failures.samples) {
			expect(sample.questionRefs.every((ref) => ref.startsWith("question:"))).toBe(true);
			expect(sample.baselineFailureCodes.every((code) => hardFailureCodes.has(code))).toBe(true);
			expect(sample.requiredTransitions.every((code) => transitionCodes.has(code))).toBe(true);
		}
		expect(receipt.i3Sim.episodes.map((episode) => episode.requiredTransitions)).toEqual(
			failures.samples.map((sample) => sample.requiredTransitions),
		);
	});
});

function readJson<T>(path: string): T {
	return JSON.parse(readText(path)) as T;
}

function readText(path: string): string {
	return readFileSync(resolve(root, path), "utf8");
}

function sha256File(path: string): string {
	return createHash("sha256")
		.update(readFileSync(resolve(root, path)))
		.digest("hex");
}

function sha256Canonical(value: unknown): string {
	return createHash("sha256")
		.update(JSON.stringify(canonicalize(value)))
		.digest("hex");
}

function canonicalize(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonicalize);
	if (value !== null && typeof value === "object") {
		const record = value as Record<string, unknown>;
		return Object.fromEntries(
			Object.keys(record)
				.sort()
				.map((key) => [key, canonicalize(record[key])]),
		);
	}
	return value;
}

function selectByIds<T extends MicroCatalogEntry>(items: T[], ids: string[]): T[] {
	const byId = new Map(items.map((item) => [item.id, item]));
	return [...ids].sort().map((id) => {
		const item = byId.get(id);
		if (!item) throw new Error(`Missing frozen catalog entry: ${id}`);
		return item;
	});
}

function snapshotByTimeline(micro: EvolutionMicro, timeline: string): MicroSnapshot {
	const snapshot = micro.snapshots.find((item) => item.timeline === timeline);
	if (!snapshot) throw new Error(`Missing frozen snapshot: ${timeline}`);
	return snapshot;
}

function branchById(snapshot: MicroSnapshot, branchId: string): ExpectedBranch {
	const branch = snapshot.expectedBranchAssessments.find((item) => item.branchId === branchId);
	if (!branch) throw new Error(`Missing frozen branch: ${branchId}`);
	return branch;
}

function claimConditionExists(
	micro: EvolutionMicro,
	branch: ExpectedBranch,
	condition: string,
): boolean {
	return selectByIds(micro.claims, branch.claimRefs).some((claim) =>
		claim.conditions.includes(condition),
	);
}

function claimApplicabilityExists(
	micro: EvolutionMicro,
	branch: ExpectedBranch,
	applicability: string,
): boolean {
	return selectByIds(micro.claims, branch.claimRefs).some((claim) =>
		claim.applicability.includes(applicability),
	);
}
