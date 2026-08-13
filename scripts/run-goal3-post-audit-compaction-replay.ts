import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { compactAuditedRelations } from "../src/relations/post-audit-compaction.js";
import type { Claim, Relation } from "../src/types/index.js";

const projectRoot = resolve(process.cwd());
const v9Root = join(
	projectRoot,
	"experiments/goal3/s200-runs/compile-v9-relation-lifecycle-12source/workspace",
);
const controlledRoot = join(
	projectRoot,
	"experiments/goal3/related-to-batch-runs/v9-batch-utility-controlled-v2",
);
const outputRoot = join(
	projectRoot,
	"experiments/goal3/post-audit-compaction-runs/v9-controlled-v1",
);
const sourceId = "source:s200-ai-llama-004-0c1360ce9e6039ce";

interface CandidateLedgerEntry {
	sourceId: string;
	relation: Relation;
}

interface ControlledDecision {
	relationId: string;
	finalState: "CANONICAL" | "QUARANTINED";
}

interface Publication {
	sourceId: string;
	claims: Claim[];
}

const candidateLedgerPath = join(v9Root, "runs/relation-candidate-ledger.jsonl");
const decisionsPath = join(controlledRoot, "relation-decisions.jsonl");
const controlledReportPath = join(controlledRoot, "report.json");
const publicationsDir = join(v9Root, "publications");

const ledger = readJsonl<CandidateLedgerEntry>(candidateLedgerPath);
const controlledDecisions = readJsonl<ControlledDecision>(decisionsPath);
const publications = readdirSync(publicationsDir)
	.filter((file) => file.endsWith(".json"))
	.map((file) => JSON.parse(readFileSync(join(publicationsDir, file), "utf8")) as Publication);
const targetPublication = publications.find((publication) => publication.sourceId === sourceId);
if (!targetPublication) throw new Error(`Missing target publication: ${sourceId}`);

const canonicalIds = new Set(
	controlledDecisions
		.filter((decision) => decision.finalState === "CANONICAL")
		.map((decision) => decision.relationId),
);
const candidateById = new Map(
	ledger
		.filter((entry) => entry.sourceId === sourceId)
		.map((entry) => [entry.relation.id, entry.relation]),
);
const auditedPassed = [...canonicalIds].map((id) => {
	const relation = candidateById.get(id);
	if (!relation) throw new Error(`Missing candidate Relation: ${id}`);
	return { ...relation, publicationState: "CANONICAL" as const };
});
const allClaims = publications.flatMap((publication) => publication.claims);
const statements = new Map(allClaims.map((claim) => [claim.id, claim.statement]));
const newSourceEndpointIds = new Set(targetPublication.claims.map((claim) => claim.id));
const result = compactAuditedRelations(auditedPassed, newSourceEndpointIds, statements, 16, 8);

const describe = (relation: Relation) => ({
	id: relation.id,
	type: relation.type,
	from: relation.from,
	to: relation.to,
	fromStatement: statements.get(relation.from as string) ?? null,
	toStatement: statements.get(relation.to as string) ?? null,
});
const controlledReport = JSON.parse(readFileSync(controlledReportPath, "utf8")) as {
	cost?: { utilityTokenReduction?: number };
};
const report = {
	schemaVersion: "wge-goal3-post-audit-compaction-replay/v1",
	createdAt: new Date().toISOString(),
	stageBRead: false,
	contract: "experiments/goal3/goal3-related-to-post-audit-compaction-contract-v1.json",
	inputs: {
		sourceId,
		auditedRelatedTo: auditedPassed.length,
		candidateLedger: relative(candidateLedgerPath),
		candidateLedgerSha256: sha256(candidateLedgerPath),
		controlledDecisions: relative(decisionsPath),
		controlledDecisionsSha256: sha256(decisionsPath),
		controlledReport: relative(controlledReportPath),
		controlledReportSha256: sha256(controlledReportPath),
	},
	policy: {
		sourcePublicationBudget: 16,
		maximumPerNewEndpoint: 8,
	},
	output: {
		canonicalCount: result.canonical.length,
		deferredByGraphDiversityCount: result.deferred.length,
		canonical: result.canonical.map(describe),
		deferred: result.deferred.map(describe),
		decisions: result.decisions.map((decision) => ({
			relationId: decision.relation.id,
			state: decision.state,
			reason: decision.reason,
			newSourceEndpointId: decision.newSourceEndpointId,
		})),
	},
	accounting: {
		auditedPassedEqualsCanonicalPlusDeferred:
			auditedPassed.length === result.canonical.length + result.deferred.length,
		deferredConsumerExposure: 0,
		canonicalPublicationWrites: 0,
	},
	upstreamBatchUtilityTokenReduction: controlledReport.cost?.utilityTokenReduction ?? null,
	status:
		auditedPassed.length === 17 &&
		result.canonical.length === 8 &&
		result.deferred.length === 9 &&
		(controlledReport.cost?.utilityTokenReduction ?? 0) >= 0.2
			? "MACHINE_GATE_PASS_PENDING_MANUAL_SET_REVIEW"
			: "FAIL",
};

mkdirSync(outputRoot, { recursive: true });
writeFileSync(join(outputRoot, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

function readJsonl<T>(path: string): T[] {
	return readFileSync(path, "utf8")
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line) as T);
}

function sha256(path: string): string {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function relative(path: string): string {
	return path.slice(projectRoot.length + 1) || basename(path);
}
