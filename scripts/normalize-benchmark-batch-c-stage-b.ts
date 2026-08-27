import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

type JsonRecord = Record<string, unknown>;

const projectRoot = process.cwd();
const stageARoot = join(projectRoot, "batch-c-stage-a");
const stageBRoot = join(projectRoot, "batch-c-stage-b-sealed");
const outputRoot = join(projectRoot, "experiments", "benchmark-batch-c", "stage-b-evaluator");
const normalizedRoot = join(outputRoot, "normalized-gold");

const questions = readJsonl(join(stageARoot, "questions", "questions-public.jsonl"));
const tasks = readJsonl(join(stageBRoot, "gold", "tasks-gold.jsonl"));
const facts = readJsonl(join(stageBRoot, "gold", "facts-gold.jsonl"));
const relations = readJsonl(join(stageBRoot, "gold", "relations-gold.jsonl"));
const episodes = readJsonl(join(stageBRoot, "gold", "evolution-episodes-gold.jsonl"));
const questionById = new Map(questions.map((row) => [requireString(row, "caseId"), row]));

const taskEvidenceReplacements: Record<string, JsonRecord[]> = {
	"C-F-CLIMATE-001": [
		evidence(
			"c-climate-001",
			"Human activities, principally through emissions of greenhouse gases, have unequivocally caused global warming, with global surface temperature reaching 1.1°C above 1850–1900 in 2011–2020. Global greenhouse gas emissions have continued to increase, with unequal historical and ongoing contributions arising from unsustainable energy use, land use and land-use change, lifestyles and patterns of consumption and production across regions, between and within countries, and among individuals (high confidence).",
			"Headline Statement A.1",
		),
	],
	"C-C-CLIMATE-001": [
		evidence(
			"c-climate-002",
			"In order to ensure that sufficient mitigation efforts are deployed up to 2030, for the purpose of this Regulation and without prejudice to the review of Union legislation referred to in paragraph 2, the contribution of net removals to the Union 2030 climate target shall be limited to 225 million tonnes of CO2 equivalent.",
			"Article 4(1)",
		),
	],
	"C-F-LAW-001": [
		evidence(
			"c-law-001",
			"1. **Unacceptable Risk** — Prohibited practices include: subliminal techniques causing harm; exploiting vulnerabilities due to age, disability, or social/economic situation; social scoring; predictive policing based on profiling; untargeted scraping of facial images; emotion inference in workplace/education; biometric categorization of sensitive characteristics; real-time remote biometric identification for law enforcement (with narrow exceptions).",
			"Risk-Based Approach",
		),
		evidence(
			"c-law-001",
			"For infringements on prohibited practices: up to €35 million or 7% of total worldwide annual turnover (whichever is higher). For other infringements: up to €15 million or 3%.",
			"Penalties",
		),
	],
	"C-C-LAW-001": [
		evidence(
			"c-law-001",
			"- 2 February 2025: Prohibitions on unacceptable risk practices take effect",
			"Phased Application",
		),
		evidence(
			"c-law-001",
			"- 2 August 2026: Rules for high-risk AI systems (Annex III) take effect",
			"Phased Application",
		),
		evidence(
			"c-law-001",
			"- 2 August 2027: Rules for product-linked high-risk AI systems (Annex I) take effect",
			"Phased Application",
		),
	],
	"C-T-LAW-001": [
		evidence(
			"c-law-002",
			"1. Administrative fine: **€1.2 billion** — the largest GDPR fine ever imposed.",
			"Corrective Powers Exercised",
		),
	],
};

const normalizedTasks = tasks.map((task) => {
	const caseId = requireString(task, "caseId");
	const question = questionById.get(caseId);
	if (!question) throw new Error(`Missing Stage A question ${caseId}`);
	const normalized = structuredClone(task);
	normalized.answerability = requireString(question, "answerability");
	normalized.goldStatus = "evaluator-reviewed-provisional-gold";
	normalized.scoreEligibility = "primary";
	normalized.evaluatorChanges = [];
	const changes = normalized.evaluatorChanges as string[];
	if (task.answerability !== normalized.answerability) {
		changes.push(
			`answerability restored from Stage A: ${String(task.answerability)} -> ${String(normalized.answerability)}`,
		);
	}
	if (taskEvidenceReplacements[caseId]) {
		normalized.requiredEvidence = taskEvidenceReplacements[caseId];
		changes.push("non-exact requiredEvidence replaced with exact Source Snapshot text");
	}
	if (caseId === "C-T-CLIMATE-001") {
		normalized.answerability = "partial";
		normalized.scoreEligibility = "diagnostic-only";
		normalized.answerabilityReason =
			"The frozen evidence supports the 2021 obligation and the later proposal/political dispute, but does not contain the 2026 amending regulation or final target text.";
		normalized.requiredPoints = [
			asRecords(task.requiredPoints, "requiredPoints")[0] ?? {},
			{
				pointId: "p2-evaluator",
				statement:
					"The frozen Source Snapshots do not contain the 2026 amending legal text, so the final 2026 target cannot be verified from this evidence set.",
				conditions: ["assessment is limited to frozen Source Snapshots"],
				timeScope: "as-of:2026-04-07",
				weight: 1,
			},
			asRecords(task.requiredPoints, "requiredPoints")[2] ?? {},
		];
		changes.push("unsupported final-2026 target point replaced by an evidence-gap requirement");
		changes.push(
			"excluded from primary comparison because the public question presupposes absent evidence",
		);
	}
	if (caseId === "C-K-CLIMATE-001") {
		normalized.scoreEligibility = "diagnostic-only";
		changes.push(
			"excluded from primary comparison because the as-of 2025-02-01 scope predates the cited Carbon Brief proposal page",
		);
	}
	return normalized;
});

const factEvidenceReplacements: Record<string, JsonRecord[]> = {
	"C-FACT-LAW-001": [
		evidence(
			"c-law-001",
			"The AI Act adopts a four-tier risk classification:",
			"Risk-Based Approach",
		),
	],
	"C-FACT-LAW-002": taskEvidenceReplacements["C-F-LAW-001"].slice(0, 1),
	"C-FACT-LAW-003": taskEvidenceReplacements["C-F-LAW-001"].slice(1, 2),
	"C-FACT-LAW-004": taskEvidenceReplacements["C-C-LAW-001"],
	"C-FACT-LAW-005": taskEvidenceReplacements["C-T-LAW-001"],
	"C-FACT-LAW-006": [
		evidence(
			"c-law-002",
			"While Meta Ireland effected those transfers on the basis of the updated Standard Contractual Clauses ('SCCs') that were adopted by the European Commission in 2021 in conjunction with additional supplementary measures that were implemented by Meta Ireland, the DPC found that these arrangements did not address the risks to the fundamental rights and freedoms of data subjects that were identified by the CJEU in its judgment.",
			"Finding of Infringement",
		),
	],
	"C-FACT-LAW-007": [
		evidence(
			"c-law-002",
			"2. Suspension order (Article 58(2)(j) GDPR): Meta Ireland must suspend any future transfer of personal data to the US within **five months** from notification.",
			"Corrective Powers Exercised",
		),
	],
};

const normalizedFacts = facts.map((fact) => {
	const factId = requireString(fact, "factId");
	const normalized = structuredClone(fact);
	normalized.goldStatus = "evaluator-reviewed-provisional-gold";
	normalized.evaluatorChanges = [];
	if (factEvidenceReplacements[factId]) {
		normalized.evidence = factEvidenceReplacements[factId];
		(normalized.evaluatorChanges as string[]).push(
			"non-exact or non-supporting evidence replaced with exact Source Snapshot text",
		);
	}
	if (factId === "C-FACT-CLIMATE-008") {
		normalized.validFrom = null;
		normalized.uncertainty =
			"Stage A does not establish a reliable publication date and the proposal evidence cannot support an as-of 2025-02-01 claim.";
		(normalized.evaluatorChanges as string[]).push("invalid/unsupported validFrom removed");
	}
	return normalized;
});

const rejectedRelations = relations.map((relation) => ({
	...relation,
	evaluatorVerdict: "reject",
	evaluatorReason: relationRejectionReason(requireString(relation, "relationId")),
}));

const normalizedEpisodes: JsonRecord[] = [];
const rejectedEpisodes: JsonRecord[] = [];
for (const episode of episodes) {
	const episodeId = requireString(episode, "episodeId");
	if (episodeId === "C-EV-CLIMATE-001") {
		rejectedEpisodes.push({
			...episode,
			evaluatorVerdict: "reject",
			evaluatorReason:
				"The frozen evidence contains a proposal and dispute, not the 2026 amending regulation; the supplied episode also mislabels addition/amendment as supersession.",
		});
		continue;
	}
	const normalized = structuredClone(episode);
	normalized.goldStatus = "evaluator-reviewed-provisional-gold";
	normalized.evaluatorChanges = [];
	if (episodeId === "C-EV-PSYCH-001") {
		normalized.t1State =
			"Gilbert et al. argued that statistical errors and replication fidelity limit pessimistic interpretations of OSC 2015. The frozen evidence attributes the claimed concession through Gilbert/Harvard coverage rather than a directly captured OSC response.";
		(normalized.evaluatorChanges as string[]).push(
			"direct OSC concession softened to attributed secondary-source characterization",
		);
	}
	if (episodeId === "C-EV-LAW-001") {
		normalized.changeType = "add-conditional-basis";
		(normalized.evaluatorChanges as string[]).push(
			"change type revised: a new adequacy basis does not narrow or erase the pre-framework enforcement finding",
		);
	}
	normalizedEpisodes.push(normalized);
}

const report = {
	schemaVersion: "wge-batch-c-evaluator-normalization/v1",
	status: "EVALUATOR_NORMALIZED_PROVISIONAL_GOLD",
	rawStageBMutated: false,
	inputPayloadTreeHash: "e61902fba067b53e9033f58eaa0a25b76aaceb4b814fa3ff387c8fa3ecef57c3",
	primaryTaskCount: normalizedTasks.filter((task) => task.scoreEligibility === "primary").length,
	diagnosticOnlyTaskIds: normalizedTasks
		.filter((task) => task.scoreEligibility !== "primary")
		.map((task) => task.caseId),
	relationGold: {
		accepted: 0,
		rejected: rejectedRelations.length,
		consequence:
			"Relation precision/recall is not scoreable from the supplied Gold. P-graph remains comparable only at task-answer level.",
	},
	episodes: { accepted: normalizedEpisodes.length, rejected: rejectedEpisodes.length },
	normalizedHashes: {},
};

writeJsonl(join(normalizedRoot, "tasks.jsonl"), normalizedTasks);
writeJsonl(join(normalizedRoot, "facts.jsonl"), normalizedFacts);
writeJsonl(join(normalizedRoot, "relations.jsonl"), []);
writeJsonl(join(normalizedRoot, "relations-rejected.jsonl"), rejectedRelations);
writeJsonl(join(normalizedRoot, "evolution-episodes.jsonl"), normalizedEpisodes);
writeJsonl(join(normalizedRoot, "evolution-episodes-rejected.jsonl"), rejectedEpisodes);
const normalizedFiles = [
	"tasks.jsonl",
	"facts.jsonl",
	"relations.jsonl",
	"relations-rejected.jsonl",
	"evolution-episodes.jsonl",
	"evolution-episodes-rejected.jsonl",
];
report.normalizedHashes = Object.fromEntries(
	normalizedFiles.map((file) => [file, sha256(readFileSync(join(normalizedRoot, file)))]),
);
writeJson(join(outputRoot, "normalization-report.json"), report);
console.log(JSON.stringify(report, null, 2));

function evidence(sourceId: string, exactQuote: string, locator: string): JsonRecord {
	return {
		sourceId,
		exactQuote,
		locator,
		role: "supports",
		quoteVerification: "evaluator-exact-match-in-source-snapshot",
	};
}

function relationRejectionReason(relationId: string) {
	const reasons: Record<string, string> = {
		"C-REL-PSYCH-001":
			"Different effects, sampling frames, and designs can yield 36% and 77% simultaneously; this is not a contradiction relation.",
		"C-REL-PSYCH-002":
			"The critique narrows an interpretation of OSC, but the target endpoint fact only states that the study was conducted; the endpoint claim is not narrowed.",
		"C-REL-PSYCH-003":
			"A community-perception survey does not REPORT_EXPERIENCE of the OSC study fact; the edge is thematic and causally unsupported.",
		"C-REL-CLIMATE-001":
			"Scientific evidence may motivate policy, but the endpoint quotes do not establish a SUPPORTS relation between the warming fact and the specific 55% legal target.",
		"C-REL-CLIMATE-002":
			"The advisory objection and Commission flexibility are policy positions that coexist; disagreement over preference is not logical contradiction.",
		"C-REL-CLIMATE-003":
			"A projection that implementation is off track does not narrow the legal claim that a 55% target exists.",
		"C-REL-LAW-001":
			"The enforcement decision does not implement a later GDPRhub analysis; the proposed direction and endpoint semantics are reversed.",
		"C-REL-LAW-002":
			"Regulatory disagreement about whether to fine does not narrow the fact that the final fine was imposed.",
	};
	return reasons[relationId] ?? "Relation semantics not independently established.";
}

function readJsonl(path: string): JsonRecord[] {
	return readFileSync(path, "utf8")
		.split(/\r?\n/u)
		.filter((line) => line.trim().length > 0)
		.map((line) => JSON.parse(line) as JsonRecord);
}

function writeJsonl(path: string, rows: JsonRecord[]) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(
		path,
		rows.length === 0 ? "" : `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`,
		"utf8",
	);
}

function writeJson(path: string, value: unknown) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function asRecords(value: unknown, label: string): JsonRecord[] {
	if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
	return value.map((item) => {
		if (!item || typeof item !== "object" || Array.isArray(item)) {
			throw new Error(`${label} items must be objects`);
		}
		return item as JsonRecord;
	});
}

function requireString(record: JsonRecord, key: string): string {
	const value = record[key];
	if (typeof value !== "string" || value.length === 0) throw new Error(`${key} must be a string`);
	return value;
}

function sha256(value: string | Buffer) {
	return createHash("sha256").update(value).digest("hex");
}
