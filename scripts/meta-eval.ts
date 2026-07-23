/**
 * meta-eval — 审计层校准脚本
 *
 * 用途（audit_reliability_research.md §4.4）：
 * 对 100 条人工/GPT 标注的用例跑当前审计系统，算 TPR/TNR/Cohen's kappa。
 * 没做 meta-eval 的 judge 不是测量，是 vibe。
 *
 * 用法：
 *   npx tsx scripts/meta-eval.ts <dataset.json>
 *
 * dataset.json 格式（GPT 生成，见 meta-eval-seed-spans.md 的 prompt）：
 *   [{
 *     "caseId": "CAL-001",
 *     "sourceSpanId": "span:...",
 *     "originalText": "...",
 *     "claim": "...",
 *     "groundTruth": "faithful" | "unfaithful",
 *     "unfaithfulReason": "..."
 *   }, ...]
 *
 * 输出：
 *   - 总体 TPR/TNR/accuracy/kappa
 *   - 按 unfaithfulReason 分桶的 TNR（知道审计哪类不忠实最弱）
 *   - 每条用例的判定明细（存 runs/meta-eval-<timestamp>.json）
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../src/config/index.js";
import { createLLMProvider } from "../src/core/llm-provider.js";
import { semanticCheck } from "../src/linter/index.js";
import type { Claim, SourceSpan } from "../src/types/index.js";

// ─── 类型 ──────────────────────────────────────────────────────────

interface EvalCase {
	caseId: string;
	sourceSpanId: string;
	originalText: string;
	claim: string;
	groundTruth: "faithful" | "unfaithful";
	unfaithfulReason?: string;
}

interface CaseResult {
	caseId: string;
	groundTruth: "faithful" | "unfaithful";
	/** 审计判定：有无 error severity 的 issue（=认为不忠实） */
	predicted: "faithful" | "unfaithful";
	failedDimensions: string[];
	issues: Array<{ code: string; severity: string; detail: string }>;
	unfaithfulReason?: string;
}

interface EvalReport {
	total: number;
	/** 真阳率：faithful 用例中被正确判为 faithful 的比例（越高=越少误杀） */
	TPR: number;
	/** 真阴率：unfaithful 用例中被正确判为 unfaithful 的比例（越高=越少漏检） */
	TNR: number;
	accuracy: number;
	/** Cohen's kappa（< 0.6 告警） */
	kappa: number;
	/** 按 unfaithfulReason 分桶的 TNR */
	byReason: Record<string, { total: number; detected: number; tnr: number }>;
	/** 误判明细（审计判错 的用例） */
	misclassifications: CaseResult[];
	model: string;
	timestamp: string;
}

// ─── 主流程 ────────────────────────────────────────────────────────

async function main() {
	const datasetPath = process.argv[2];
	if (!datasetPath) {
		console.error("用法: npx tsx scripts/meta-eval.ts <dataset.json>");
		process.exit(1);
	}

	const config = loadConfig();
	if (!config.apiKey) {
		console.error("❌ DEEPSEEK_API_KEY not set");
		process.exit(1);
	}

	const provider = createLLMProvider(config);
	const cases: EvalCase[] = JSON.parse(readFileSync(datasetPath, "utf-8"));

	if (cases.length < 50) {
		console.warn(`⚠️ 只有 ${cases.length} 条用例，建议 ≥100 条才有统计意义`);
	}

	console.error(`📊 meta-eval: ${cases.length} 条用例，model=${config.model}`);
	console.error("");

	const results: CaseResult[] = [];
	let processed = 0;

	for (const c of cases) {
		// 把用例包成 Claim + SourceSpan（复用真实审计路径）
		const span: SourceSpan = {
			id: c.sourceSpanId,
			sourceId: `meta-eval-${c.caseId}`,
			blockId: `meta-eval#${c.caseId}`,
			charStart: 0,
			charEnd: c.originalText.length,
			text: c.originalText,
		};
		const claim: Claim = {
			id: `claim:meta-eval-${c.caseId}`,
			statement: c.claim,
			evidenceSpanIds: [c.sourceSpanId],
			conditions: [],
			derivation: "EXTRACTED",
			validity: "SUPPORTED",
			lifecycle: "ACTIVE",
			publicationState: "CANDIDATE",
			validFrom: null,
			validTo: null,
			compilerVersion: "meta-eval",
			confidence: 0.75,
		};

		const issues = await semanticCheck(config, claim, [span], provider);
		const hasError = issues.some((i) => i.severity === "error");

		results.push({
			caseId: c.caseId,
			groundTruth: c.groundTruth,
			predicted: hasError ? "unfaithful" : "faithful",
			failedDimensions: issues.filter((i) => i.severity === "error").map((i) => i.code),
			issues: issues.map((i) => ({
				code: i.code,
				severity: i.severity,
				detail: i.detail,
			})),
			unfaithfulReason: c.unfaithfulReason,
		});

		processed++;
		if (processed % 10 === 0) {
			console.error(`  进度: ${processed}/${cases.length}`);
		}
	}

	const report = computeReport(results, config.model);
	printReport(report);

	// 存报告
	mkdirSync(config.runsDir, { recursive: true });
	const reportPath = join(
		config.runsDir,
		`meta-eval-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
	);
	writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8");
	console.error(`\n📁 报告已存: ${reportPath}`);

	// 门槛检查（research §4.4）
	if (report.TPR < 0.8 || report.TNR < 0.8) {
		console.error("\n❌ 门禁未达标：TPR/TNR 任一 < 0.8，审计 prompt 需迭代");
		process.exit(2);
	}
	if (report.kappa < 0.6) {
		console.error("\n⚠️ Cohen's kappa < 0.6，审计一致性偏低");
	}
}

// ─── 指标计算 ──────────────────────────────────────────────────────

function computeReport(results: CaseResult[], model: string): EvalReport {
	const faithful = results.filter((r) => r.groundTruth === "faithful");
	const unfaithful = results.filter((r) => r.groundTruth === "unfaithful");

	const TP = faithful.filter((r) => r.predicted === "faithful").length;
	const FN = faithful.filter((r) => r.predicted === "unfaithful").length;
	const TN = unfaithful.filter((r) => r.predicted === "unfaithful").length;
	const FP = unfaithful.filter((r) => r.predicted === "faithful").length;

	const TPR = faithful.length > 0 ? TP / faithful.length : 0;
	const TNR = unfaithful.length > 0 ? TN / unfaithful.length : 0;
	const accuracy = results.length > 0 ? (TP + TN) / results.length : 0;

	// Cohen's kappa
	const pObserved = accuracy;
	const pExpected =
		(((TP + FP) * (TP + FN)) / results.length + ((TN + FN) * (TN + FP)) / results.length) /
		results.length;
	const kappa = pExpected < 1 ? (pObserved - pExpected) / (1 - pExpected) : 1;

	// 按 unfaithfulReason 分桶
	const byReason: Record<string, { total: number; detected: number; tnr: number }> = {};
	for (const r of unfaithful) {
		const reason = r.unfaithfulReason ?? "unknown";
		let bucket = byReason[reason];
		if (!bucket) {
			bucket = { total: 0, detected: 0, tnr: 0 };
			byReason[reason] = bucket;
		}
		bucket.total++;
		if (r.predicted === "unfaithful") bucket.detected++;
	}
	for (const b of Object.values(byReason)) {
		b.tnr = b.total > 0 ? b.detected / b.total : 0;
	}

	const misclassifications = results.filter((r) => r.predicted !== r.groundTruth);

	return {
		total: results.length,
		TPR,
		TNR,
		accuracy,
		kappa,
		byReason,
		misclassifications,
		model,
		timestamp: new Date().toISOString(),
	};
}

function printReport(r: EvalReport) {
	console.error("════════════════════════════════════════════");
	console.error("  meta-eval 审计校准报告");
	console.error("════════════════════════════════════════════");
	console.error(`总用例: ${r.total}`);
	console.error(`model:  ${r.model}`);
	console.error("");
	console.error(`TPR (少误杀):     ${r.TPR.toFixed(3)}  ${r.TPR >= 0.8 ? "✅" : "❌ <0.8"}`);
	console.error(`TNR (少漏检):     ${r.TNR.toFixed(3)}  ${r.TNR >= 0.8 ? "✅" : "❌ <0.8"}`);
	console.error(`accuracy:         ${r.accuracy.toFixed(3)}`);
	console.error(`Cohen's kappa:    ${r.kappa.toFixed(3)}  ${r.kappa >= 0.6 ? "✅" : "⚠️ <0.6"}`);
	console.error("");
	console.error("按不忠实类型分桶 TNR:");
	for (const [reason, b] of Object.entries(r.byReason)) {
		console.error(`  ${reason.padEnd(20)} ${b.tnr.toFixed(3)}  (${b.detected}/${b.total})`);
	}
	console.error("");
	console.error(`误判数: ${r.misclassifications.length}`);
	if (r.misclassifications.length > 0 && r.misclassifications.length <= 20) {
		console.error("误判明细:");
		for (const m of r.misclassifications) {
			console.error(
				`  ${m.caseId}: truth=${m.groundTruth} pred=${m.predicted} dims=[${m.failedDimensions.join(",")}]`,
			);
		}
	}
	console.error("════════════════════════════════════════════");
}

main().catch((e) => {
	console.error("meta-eval 失败:", e);
	process.exit(1);
});
