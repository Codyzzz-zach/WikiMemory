import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { writeQuestionStateProjectionShadow } from "../src/wiki/question-state-projection-storage.js";
import {
	type ProjectionClaimInput,
	type ProjectionEvidenceSpanInput,
	type ProjectionRelationInput,
	type QuestionStateProjection,
	type QuestionStateProjectionInput,
	projectQuestionState,
	questionStateInputClosureHash,
	serializeQuestionStateProjection,
} from "../src/wiki/question-state-projection.js";

interface ExpectedBranch {
	claimRefs: string[];
	standing: string;
	qualifiers: string[];
	applicability: string[];
	conditions: string[];
	requiredReasonCodes: string[];
}

interface ExpectedUnresolvedFactor {
	reasonCode: string;
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
	claims: ProjectionClaimInput[];
	relations: ProjectionRelationInput[];
	evidenceSpans: ProjectionEvidenceSpanInput[];
	snapshots: MicroSnapshot[];
}

const projectRoot = resolve(import.meta.dirname, "..");
const shadowRoot = requiredAbsoluteArgument("--shadow-root");
const canonicalRuntimeRoot = requiredAbsoluteArgument("--canonical-runtime-root");
const fixture = readJson<EvolutionMicro>(
	join(projectRoot, "benchmarks/c1-weighted-question-state-v1/fixtures/evolution-micro.json"),
);
const canonicalBefore = canonicalAggregate(canonicalRuntimeRoot);
const questionStateBefore = sha256File(join(canonicalRuntimeRoot, "questions/state.json"));
const outputs: Array<{
	timeline: string;
	inputClosureHash: string;
	projectionHash: string;
	path: string;
	bytes: number;
	replayByteIdentical: boolean;
	semanticChecks: number;
	groundedReasons: number;
}> = [];

for (const snapshot of fixture.snapshots) {
	const input = inputFor(snapshot);
	const first = projectQuestionState(input);
	const second = projectQuestionState(input);
	const firstBytes = serializeQuestionStateProjection(first);
	const secondBytes = serializeQuestionStateProjection(second);
	if (firstBytes !== secondBytes) throw new Error(`C1 replay mismatch: ${snapshot.timeline}`);
	const semanticChecks = verifyOracle(snapshot, first);
	const groundedReasons = verifyGrounding(input, first);
	const receipt = writeQuestionStateProjectionShadow({ shadowRoot, canonicalRuntimeRoot }, first);
	outputs.push({
		timeline: snapshot.timeline,
		inputClosureHash: input.inputClosureHash,
		projectionHash: first.projectionHash,
		path: relative(shadowRoot, receipt.path),
		bytes: receipt.bytes,
		replayByteIdentical: true,
		semanticChecks,
		groundedReasons,
	});
}

const sentinelInput = rehash({
	...inputFor(requiredSnapshot("T0")),
	questionRef: "question:c1-micro:unrelated-sentinel",
});
const sentinelBefore = projectQuestionState(sentinelInput);
writeQuestionStateProjectionShadow({ shadowRoot, canonicalRuntimeRoot }, sentinelBefore);
const sentinelAfter = projectQuestionState(sentinelInput);
if (
	serializeQuestionStateProjection(sentinelBefore) !==
	serializeQuestionStateProjection(sentinelAfter)
) {
	throw new Error("C1 unrelated sentinel changed during local recomputation");
}

const canonicalAfter = canonicalAggregate(canonicalRuntimeRoot);
const questionStateAfter = sha256File(join(canonicalRuntimeRoot, "questions/state.json"));
if (
	canonicalBefore.sha256 !== canonicalAfter.sha256 ||
	questionStateBefore !== questionStateAfter
) {
	throw new Error("C1 shadow mutated canonical runtime");
}

const report = {
	schemaVersion: "wge-c1-pure-shadow-report/v1",
	stage: "C1-C",
	result: "PASS_PURE_SHADOW",
	generatedOn: "2026-08-25",
	contractAcceptanceCommit: "b89c746b171afacca837205947381b5c234b2f48",
	implementationBaseCommit: "a864b9134a490cb7ab3a7232a2c317438deeed9d",
	providerUsage: { calls: 0, tokens: 0, answerCalls: 0, recompilationCalls: 0 },
	canonicalRuntime: {
		path: canonicalRuntimeRoot,
		aggregateBefore: canonicalBefore,
		aggregateAfter: canonicalAfter,
		questionStateFileBefore: questionStateBefore,
		questionStateFileAfter: questionStateAfter,
		mutationCount: 0,
	},
	projections: outputs,
	unrelatedSentinel: {
		questionRef: sentinelInput.questionRef,
		projectionHashBefore: sentinelBefore.projectionHash,
		projectionHashAfter: sentinelAfter.projectionHash,
		byteIdentical: true,
	},
	acceptance: {
		frozenSnapshots: outputs.length,
		semanticChecks: outputs.reduce((total, output) => total + output.semanticChecks, 0),
		groundedReasons: outputs.reduce((total, output) => total + output.groundedReasons, 0),
		replayFailures: 0,
		groundingFailures: 0,
		hardSemanticFailures: 0,
		questionMutations: 0,
		canonicalMutations: 0,
	},
};
mkdirSync(shadowRoot, { recursive: true });
const reportPath = join(shadowRoot, "report.json");
writeFileSync(reportPath, `${stableStringify(report)}\n`, "utf8");
process.stdout.write(
	`${JSON.stringify({ reportPath, result: report.result, outputs }, null, 2)}\n`,
);

function inputFor(snapshot: MicroSnapshot): QuestionStateProjectionInput {
	return {
		questionRef: fixture.questionRef,
		knowledgeVersion: snapshot.knowledgeVersion,
		inputClosureHash: snapshot.inputClosureHash,
		claims: selectByIds(fixture.claims, snapshot.claimRefs),
		relations: selectByIds(fixture.relations, snapshot.relationIds),
		evidenceSpans: selectByIds(fixture.evidenceSpans, snapshot.evidenceSpanIds),
	};
}

function rehash(
	input: Omit<QuestionStateProjectionInput, "inputClosureHash"> & { inputClosureHash?: string },
): QuestionStateProjectionInput {
	const { inputClosureHash: _ignored, ...withoutHash } = input;
	return { ...withoutHash, inputClosureHash: questionStateInputClosureHash(withoutHash) };
}

function verifyOracle(snapshot: MicroSnapshot, projection: QuestionStateProjection): number {
	let checks = 0;
	for (const expected of snapshot.expectedBranchAssessments) {
		const actual = branchByClaims(projection, expected.claimRefs);
		assertEqual(actual.standing, expected.standing, `${snapshot.timeline}:standing`);
		assertEqual(actual.qualifiers, expected.qualifiers, `${snapshot.timeline}:qualifiers`);
		assertEqual(
			actual.scope.applicability,
			expected.applicability,
			`${snapshot.timeline}:applicability`,
		);
		assertEqual(actual.conditions, expected.conditions, `${snapshot.timeline}:conditions`);
		const reasonCodes = new Set<string>(
			actual.dimensionReasons.flatMap((reason) => reason.reasonCodes),
		);
		if (!expected.requiredReasonCodes.every((code) => reasonCodes.has(code))) {
			throw new Error(
				`C1 oracle reason mismatch: ${snapshot.timeline}:${expected.claimRefs.join("|")}`,
			);
		}
		checks += 5;
	}
	const unresolvedCodes = new Set<string>(
		projection.unresolvedFactors.map((factor) => factor.reasonCode),
	);
	if (
		!snapshot.expectedUnresolvedFactors.every((factor) => unresolvedCodes.has(factor.reasonCode))
	) {
		throw new Error(`C1 oracle unresolved-factor mismatch: ${snapshot.timeline}`);
	}
	return checks + 1;
}

function verifyGrounding(
	input: QuestionStateProjectionInput,
	projection: QuestionStateProjection,
): number {
	const claimRefs = new Set(input.claims.map((claim) => claim.id));
	const relationIds = new Set(input.relations.map((relation) => relation.id));
	const spanIds = new Set(input.evidenceSpans.map((span) => span.id));
	const grounded = [
		...projection.branchAssessments.flatMap((branch) => branch.dimensionReasons),
		...projection.unresolvedFactors,
	];
	for (const item of grounded) {
		if (
			item.claimRefs.length === 0 ||
			item.evidenceSpanIds.length === 0 ||
			!item.claimRefs.every((ref) => claimRefs.has(ref)) ||
			!item.relationIds.every((id) => relationIds.has(id)) ||
			!item.evidenceSpanIds.every((id) => spanIds.has(id))
		) {
			throw new Error(`C1 grounding failure: ${JSON.stringify(item)}`);
		}
	}
	return grounded.length;
}

function branchByClaims(projection: QuestionStateProjection, claimRefs: string[]) {
	const key = [...claimRefs].sort().join("|");
	const branch = projection.branchAssessments.find(
		(candidate) => [...candidate.claimRefs].sort().join("|") === key,
	);
	if (!branch) throw new Error(`C1 oracle branch missing: ${key}`);
	return branch;
}

function requiredSnapshot(timeline: string): MicroSnapshot {
	const snapshot = fixture.snapshots.find((candidate) => candidate.timeline === timeline);
	if (!snapshot) throw new Error(`C1 snapshot missing: ${timeline}`);
	return snapshot;
}

function selectByIds<T extends { id: string }>(items: T[], ids: string[]): T[] {
	const byId = new Map(items.map((item) => [item.id, item]));
	return [...ids].sort().map((id) => {
		const item = byId.get(id);
		if (!item) throw new Error(`C1 input missing: ${id}`);
		return item;
	});
}

function canonicalAggregate(runtimeRoot: string): { fileCount: number; sha256: string } {
	const directories = [
		"claims",
		"relations",
		"sources",
		"assertions",
		"concepts",
		"questions",
		"wiki",
		"publications",
	];
	const files = directories
		.flatMap((directory) => walk(join(runtimeRoot, directory)))
		.sort((left, right) => left.localeCompare(right));
	const lines = files
		.map((path) => `${sha256File(path)}  ${relative(runtimeRoot, path)}\n`)
		.join("");
	return { fileCount: files.length, sha256: sha256(lines) };
}

function walk(path: string): string[] {
	return readdirSync(path).flatMap((entry) => {
		const child = join(path, entry);
		return statSync(child).isDirectory() ? walk(child) : [child];
	});
}

function requiredAbsoluteArgument(name: string): string {
	const index = process.argv.indexOf(name);
	const value = index >= 0 ? process.argv[index + 1] : undefined;
	if (!value) throw new Error(`Missing required argument: ${name}`);
	if (!isAbsolute(value)) throw new Error(`${name} must be absolute: ${value}`);
	return resolve(value);
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
	if (stableStringify(actual) !== stableStringify(expected)) {
		throw new Error(`${label} mismatch: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
	}
}

function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, "utf8")) as T;
}

function sha256File(path: string): string {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function stableStringify(value: unknown): string {
	return JSON.stringify(sortObjectKeys(value));
}

function sortObjectKeys(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortObjectKeys);
	if (value !== null && typeof value === "object") {
		const record = value as Record<string, unknown>;
		return Object.fromEntries(
			Object.keys(record)
				.sort()
				.map((key) => [key, sortObjectKeys(record[key])]),
		);
	}
	return value;
}
