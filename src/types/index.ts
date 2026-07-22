/**
 * WGEMemory4LLM 知识模型类型定义
 *
 * 从 docs/knowledge-contract.md 语义合同编译而来。
 * Semantics first, Types second——语义合同先定义清楚，类型从合同编译。
 *
 * 严格对齐 Product Definition §05（最小一等对象）+ §04（设计哲学）。
 * 修正旧项目 lite-llmwiki 的所有类型坑（见 experience-index.md）。
 */

// ─── 四个正交状态轴 ────────────────────────────────────────────────

/** 结论怎么来的（与来源类型正交） */
export type Derivation = "EXTRACTED" | "INFERRED" | "HUMAN_ASSERTED";

/** 当前是否有争议（可独立于 derivation 变化） */
export type Validity = "SUPPORTED" | "DISPUTED" | "UNRESOLVED";

/** 是否仍然有效（时态） */
export type Lifecycle = "ACTIVE" | "SUPERSEDED";

/** 是否进入默认消费链 */
export type PublicationState = "CANDIDATE" | "CANONICAL" | "QUARANTINED";

// ─── Branded type 引用（修 GPT 问题 5.3）────────────────────────

/**
 * 品牌类型——编译期区分引用类型。
 * 防止把 ClaimRef 传给期望 ConceptRef 的地方。
 * 运行时是普通 string，编译期有类型标记。
 */
export type ClaimRef = string & { readonly __brand: "ClaimRef" };
export type ConceptRef = string & { readonly __brand: "ConceptRef" };
export type WikiRef = string & { readonly __brand: "WikiRef" };
export type NodeRef = ClaimRef | ConceptRef | WikiRef;

/** 创建 ClaimRef 的唯一安全方式 */
export function claimRef(id: string): ClaimRef {
	return id as ClaimRef;
}
export function conceptRef(id: string): ConceptRef {
	return id as ConceptRef;
}
export function wikiRef(id: string): WikiRef {
	return id as WikiRef;
}

// ─── 关系类型 ────────────────────────────────────────────────────

export type RelationType =
	| "REQUIRES"
	| "DERIVED_FROM"
	| "SUPPORTS"
	| "CONTRADICTS"
	| "SUPERSEDES"
	| "EQUIVALENT_UNDER"
	| "RELATED_TO";

/** 边的来源标识（字面量联合，修旧项目 source 无约束坑） */
export type EdgeSource =
	| "intra-material-compile"
	| "cross-material-detect"
	| "human-confirm"
	| "periodic-lint";

// ─── 一等对象（严格对齐 Product Definition §05）─────────────────

/** 不可变证据载体 */
export interface Source {
	id: string;
	hash: string;
	uri: string;
	parsedText: string;
	sourceType: "md" | "pdf" | "html";
	loaderVersion: string;
	createdAt: string;
}

/** 证据精确定位（修 GPT 问题 5.1：必须有 id） */
export interface SourceSpan {
	id: string;
	sourceId: string;
	blockId: string;
	charStart: number;
	charEnd: number;
	text: string;
}

/** 最小可判断结论（修 GPT 问题 5.2：去掉 propRefs，用 evidenceSpanIds） */
export interface Claim {
	id: string;
	statement: string;
	evidenceSpanIds: string[];
	conditions: string[];
	derivation: Derivation;
	validity: Validity;
	lifecycle: Lifecycle;
	publicationState: PublicationState;
	validFrom: string | null;
	validTo: string | null;
	compilerVersion: string;
	confidence: number;
}

/** 跨来源稳定概念身份 */
export interface Concept {
	id: string;
	name: string;
	aliases: string[];
	boundary: string;
	domain: string;
}

/**
 * 类型化关系（修 GPT 问题 5.3/5.4）
 * from/to 用 branded type；方向性由 type 语义定义，无 direction 字段。
 */
export interface Relation {
	id: string;
	from: NodeRef;
	to: NodeRef;
	type: RelationType;
	conditions: string[];
	evidenceSpanIds: string[];
	derivation: Derivation;
	validity: Validity;
	lifecycle: Lifecycle;
	publicationState: PublicationState;
	validFrom: string | null;
	validTo: string | null;
	compilerVersion: string;
	source: EdgeSource;
	confidence: number;
	consumedBy: string[];
}

/** 供 Agent 阅读的完整语义单元 */
export interface WikiModule {
	id: string;
	stableAddress: string;
	coreQuestion: string;
	currentUnderstanding: string;
	disputes: string[];
	claimRefs: ClaimRef[];
	conceptRefs: ConceptRef[];
	dependencies: string[];
	publicationState: PublicationState;
	updatedAt: string;
}

// ─── Context Pack（Agent 统一消费合同）──────────────────────────

/** 修 GPT 问题 5.5：去掉 suppress，改为 surface | surface_with_warning */
export type UncertaintyPolicy = "surface" | "surface_with_warning";

export interface ContextPackRequest {
	task: string;
	domain: string;
	asOf: "current" | string;
	contextBudgetTokens: number;
	maxGraphDepth: number;
	allowedRelationTypes: RelationType[];
	mustIncludeEvidence: boolean;
	uncertaintyPolicy: UncertaintyPolicy;
}

export interface SelectionLogEntry {
	selected: string;
	reason: string;
	dropped?: string;
	dropReason?: string;
}

export interface ContextPack {
	knowledgeVersion: string;
	taskMap: string;
	subgraph: Relation[];
	wikiModules: WikiModule[];
	evidenceSpans: SourceSpan[];
	conflictsAndConditions: string[];
	selectionLog: SelectionLogEntry[];
	knownGaps: string[];
}

// ─── Proposition（编译中间产物，不是一等对象，决策 4A）──────────

/**
 * 可重建的编译中间产物。不长期存储、不进 Git。
 * Compiler 内部使用后丢弃。
 */
export interface PropositionDraft {
	sourceId: string;
	blockId: string;
	text: string;
	exactQuote: string;
	relatesTo?: {
		fromPropIndex: number;
		type: RelationType;
	};
}
