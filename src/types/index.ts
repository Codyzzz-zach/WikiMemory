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

// ─── Claim 语义元数据（v1.1：非状态轴，不参与"是否消费"判断）─────

/** Claim 的内容类型——决定用户能否成为该 Claim 的权威 */
export type ClaimKind = "FACT" | "DECISION" | "PREFERENCE";

/** Claim 的作用域——决定 Claim 在哪里生效、能否被选入 Context Pack */
export interface Scope {
	type: "GLOBAL" | "PERSONAL" | "PROJECT";
	/** 项目/作用域标识（PROJECT 时必填） */
	id?: string;
}

// ─── 证据引用（v1.1：provenance vs supporting evidence 拆分）─────

/**
 * 知识引用——统一引用类型，覆盖三种证据来源。
 * provenanceRefs 证明"谁说的"；supportingEvidenceRefs 证明"命题为真"。
 */
export type KnowledgeRef = SourceSpanRef | AssertedRecordRef | ExperimentRecordRef;

export interface SourceSpanRef {
	type: "SourceSpan";
	spanId: string;
}

export interface AssertedRecordRef {
	type: "AssertedRecord";
	assertionId: string;
}

export interface ExperimentRecordRef {
	type: "ExperimentRecord";
	experimentId: string;
}

// ─── AssertedRecord（用户断言记录，DECISION/PREFERENCE 的依据）────

export interface AssertedRecord {
	assertionId: string;
	claimId: string;
	assertedBy: string;
	assertedAt: string;
	scope: Scope;
	authorityBasis: string;
	assertionText: string;
	/** 推荐但非硬门槛——缺失标记"理由未记录" */
	rationale?: string;
	/** 可选：连接实验、会议纪要或分析材料 */
	supportingSourceIds?: string[];
}

// ─── 执行上下文（Context Pack 作用域选择用）─────────────────────

/**
 * ScopeContext——Context Pack 请求的执行上下文。
 * 缺少时按 Global-only 处理，不能"默认全选"。
 */
export interface ScopeContext {
	principalId: string;
	projectId?: string;
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

/** Relation 条件是否经过显式确认，避免 [] 同时表示“无条件”和“未提取”。 */
export type RelationConditionStatus = "EXPLICIT_NONE" | "PRESERVED" | "UNVERIFIED";

/** SUPERSEDES 对 To Claim 生命周期的覆盖效果；与 conditions 是否被保真正交。 */
export type SupersessionEffect = "TOTAL_TO_CLAIM" | "CONDITIONAL_TO_CLAIM";

/**
 * Source 的编译状态——与不可变 Source 及 Source manifest 分离。
 * 状态事件记录在 runs/compile-state.jsonl，按 sourceId 取最后一条为准。
 */
export type CompileState =
	| "SOURCE_INGESTED" // Source/Span 已写入，未开始编译
	| "COMPILE_RUNNING" // 编译进行中
	| "COMPILE_FAILED" // 编译失败（可重试）
	| "COMPILE_PARTIAL" // 部分阶段完成但未发布
	| "RELATION_SCAN_PENDING" // 单材料已发布，跨材料扫描待完成/重试
	| "COMPLETED" // 单材料与跨材料两个阶段都已完成
	| "COMPILED"; // v1.1 遗留状态：缺少当前 Relation 审计证明，必须完整重编

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
	/** @deprecated v1.1：迁移到 supportingEvidenceRefs，但保留向后兼容 */
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
	// ── v1.1 新增字段 ──
	/** 内容类型（FACT/DECISION/PREFERENCE）——决定用户能否成为权威 */
	claimKind: ClaimKind;
	/** 作用域——决定在哪里生效、能否被选入 Context Pack */
	scope: Scope;
	/** 证明"谁在何时提出了这个说法"——不证明它对不对 */
	provenanceRefs: KnowledgeRef[];
	/** 证明"命题本身为真"——原文片段、实验记录、或授权的 AssertedRecord */
	supportingEvidenceRefs: KnowledgeRef[];
	/** 知识状态版本标识（MVP 只支持 knowledge time） */
	knowledgeVersion: string;
	/** 系统记录这条知识的时间 */
	recordedAt: string;
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
	conditionStatus: RelationConditionStatus;
	/** 只有通过边级审计的 SUPERSEDES 才能非空；事务仅允许 TOTAL_TO_CLAIM 全局置旧。 */
	supersessionEffect: SupersessionEffect | null;
	/** 通过哪一版边级语义门禁；null 表示未审核，不得进入图消费。 */
	relationAuditVersion: string | null;
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
	/** v1.1：执行上下文。缺少时按 Global-only 处理 */
	scopeContext?: ScopeContext;
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
	subgraph: {
		claims: Claim[];
		relations: Relation[];
	};
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
