# WGEMemory4LLM 知识语义合同 v1.3

> **文档定位**：这是知识模型的语义定义，TypeScript types 和 Zod schema 从本文档编译而来。
> Semantics first, Types second——先把语义想清楚，再写类型约束。
> 当前对齐日期：2026-08-12。产品不变量以 Product Definition v1.5 为最高约束，目标模块边界以 Architecture 1.0 为准，当前运行事实以 `docs/status/implementation-status.md` 与 `src/types/` 为准；本文定义知识对象语义，不得自行扩大 Loader、时间、权限或在线 Graph 能力。

---

## 一、四个正交状态轴

Product Definition §05 原文定义了两个轴（epistemicStatus + publicationState），但 GPT 审查指出 epistemicStatus 混合了三种不同问题。本合同将其拆成三个正交轴，加 publicationState 共四个，每个轴独立变化。

### 轴 1 · derivation（结论怎么来的）

```
EXTRACTED       — 直接从原文提取的事实陈述
INFERRED        — LLM 综合多个证据推导出的结论
HUMAN_ASSERTED  — 用户断言（高优先级 Feedback）
```

**语义**：描述结论的来源方式，不描述它是否可信。一个 EXTRACTED 结论可能是错的（原文本身有错），一个 INFERRED 结论可能是对的。

### 轴 2 · validity（当前是否有争议）

```
SUPPORTED   — 当前有证据支持，无已知冲突
DISPUTED    — 存在与之冲突的证据或来源
UNRESOLVED  — 尚无足够证据判断
```

**语义**：描述当前知识状态的争议性，独立于 derivation。一个 Claim 可以同时是 INFERRED + DISPUTED——LLM 推导出来的，且受到另一来源挑战。

### 轴 3 · lifecycle（是否仍然有效）

```
ACTIVE      — 当前有效，可被消费
SUPERSEDED  — 被新证据取代，不再有效（但不删除）
```

**语义**：描述时态。SUPERSEDED 的 Claim 保留在系统中（可追溯历史），但不进入默认消费链。

### 轴 4 · publicationState（是否进入默认消费链）

```
CANDIDATE   — 刚生成，尚未通过 Lint
CANONICAL   — 通过 Lint，进入默认消费链
QUARANTINED — 结构/证据失败，物理隔离
```

**语义**：描述发布状态。只有 CANONICAL 进入 Graph、检索、Context Pack。QUARANTINED 物理隔离到 quarantine/ 目录。

### 四轴组合示例

| 场景 | derivation | validity | lifecycle | publicationState |
|---|---|---|---|---|
| LLM 从原文提取的事实 | EXTRACTED | SUPPORTED | ACTIVE | CANONICAL |
| LLM 推导但被另一来源挑战 | INFERRED | DISPUTED | ACTIVE | CANONICAL |
| 用户在项目内确立一项决策，并有同 scope 的 AssertedRecord | HUMAN_ASSERTED | SUPPORTED | ACTIVE | CANONICAL |
| 被新证据取代的旧结论 | EXTRACTED | SUPPORTED | SUPERSEDED | CANONICAL |
| LLM 编译但证据不足 | INFERRED | UNRESOLVED | ACTIVE | QUARANTINED |

**关键**：SUPERSEDED 的旧结论 publicationState 仍可是 CANONICAL（保留在 wiki/，用于历史追溯），但消费时 lifecycle=ACTIVE 优先。Graph/检索同时过滤 publicationState=CANONICAL + lifecycle=ACTIVE。

---

## 二、一等对象（严格对齐 Product Definition §05）

Product Definition 定义了 6 个最小一等对象。Proposition **不是**一等对象（决策 4A：先作为可重建中间产物）。

### 2.1 Source（不可变证据载体）

```typescript
interface Source {
  id: string;              // source:xxx
  hash: string;            // 内容哈希（去重 + 不可变）
  uri: string;             // 原始路径
  parsedText: string;      // 机械提取的纯文本
  sourceType: "md" | "pdf" | "html";
  loaderVersion: string;
  metadata?: Record<string, string>;
  createdAt: string;       // ISO 8601
}
```

**语义**：用户投递的原始材料的不可变副本。hash 用于去重（相同内容不重复摄入）。parsedText 是 loader 机械提取的纯文本（LLM 不参与）。类型合同预留 `pdf/html`，但当前生产 registry 只注册 Markdown；预留枚举不等于格式已经可摄入。

### 2.2 SourceSpan（证据精确定位）

```typescript
interface SourceSpan {
  id: string;              // span:xxx（必须有 id——修 GPT 问题 5.1）
  sourceId: string;        // 引用 Source.id
  blockId: string;         // parser 机械生成的稳定块 ID（修 GPT 问题 7）
  charStart: number;       // parser 机械生成（不让 LLM 返回）
  charEnd: number;
  text: string;            // 原文片段（不可改写）
}
```

**语义**：原文中一个可精确定位的片段。blockId 由 parser 机械生成（如 `01-number-systems#block-3`），charStart/charEnd 也由 parser 算（不信任 LLM 返回数字）。LLM 只返回 blockId + exactQuote，程序用 exactQuote 在 block 内做字符串匹配映射成 SourceSpan。

### 2.3 KnowledgeRef、ClaimKind 与 Scope

```typescript
type KnowledgeRef =
  | { type: "SourceSpan"; spanId: string }
  | { type: "AssertedRecord"; assertionId: string }
  | { type: "ExperimentRecord"; experimentId: string };

type ClaimKind = "FACT" | "DECISION" | "PREFERENCE";

interface Scope {
  type: "GLOBAL" | "PERSONAL" | "PROJECT";
  id?: string;
}

interface AssertedRecord {
  assertionId: string;
  claimId: string;
  assertedBy: string;
  assertedAt: string;
  scope: Scope;
  authorityBasis: string;
  assertionText: string;
  rationale?: string;
  supportingSourceIds?: string[];
}
```

`FACT` 不能因为用户断言就自动获得事实支持；`DECISION` / `PREFERENCE` 可在主体和 scope 匹配、AssertedRecord 字段完整时由用户成为权威。用户纠正事实足以让旧结论停止被无条件相信，但新事实仍需来源或实验支持。

### 2.4 Claim（最小可判断结论）

```typescript
interface Claim {
  id: string;              // claim:xxx
  statement: string;       // 结论陈述
  retrievalAliases?: string[]; // 仅用于跨语检索，不是证据
  evidenceSpanIds: string[];  // 引用 SourceSpan.id（修 GPT 问题 5.2：去掉 propRefs）
  conditions: string[];    // 适用条件（哲学 05：带条件）
  derivation: Derivation;
  validity: Validity;
  lifecycle: Lifecycle;
  publicationState: PublicationState;
  validFrom: string | null;
  validTo: string | null;
  compilerVersion: string;
  confidence: number;
  claimKind: "FACT" | "DECISION" | "PREFERENCE";
  scope: { type: "GLOBAL" | "PERSONAL" | "PROJECT"; id?: string };
  provenanceRefs: KnowledgeRef[];
  supportingEvidenceRefs: KnowledgeRef[];
  knowledgeVersion: string;
  recordedAt: string;
}
```

**语义**：一个自包含的、可判断真伪的结论。`provenanceRefs` 证明“谁在何时说过”，`supportingEvidenceRefs` 证明“这条命题为何可被支持”，二者不得混用。`evidenceSpanIds` 是兼容字段，Canonical 消费仍必须能解析到 SourceSpan。`retrievalAliases` 只帮助中文问题检索英文 Claim，不能进入回答或审计证据。`scope` 管适用范围与权限，`domain` 只属于主题组织，不是权限边界。

MVP 完整支持 knowledge time（`knowledgeVersion` / `recordedAt` / `knowledgeAsOf`）和由明确来源版本、受审计 `SUPERSEDES` 支持的当前/历史选择；`validFrom` / `validTo` 可保存原文时间条件，但不代表已经支持任意现实世界 `validAt` 区间推理。

**去掉 propRefs 的理由**（GPT 问题 5.2）：旧项目用 `propRefs: number[]` 但无法区分 "12" 属于哪篇文章。新项目用 evidenceSpanIds 直接引用 SourceSpan.id，每个 SourceSpan 自带 sourceId，天然解决跨来源归属。

### 2.5 Concept（跨来源稳定身份）

```typescript
interface Concept {
  id: string;              // concept:xxx
  name: string;
  aliases: string[];       // 别名（跨来源对齐）
  boundary: string;        // 边界描述（防同名异义误合并）
  domain: string;          // 所属领域
}
```

**语义**：跨来源的稳定概念身份。不同文章可能用不同词指同一概念（aliases），也可能用相同词指不同概念（boundary 消歧）。

### 2.6 Relation（类型化关系）

```typescript
type RelationType =
  | "REQUIRES"         // A 需要 B 作为前提
  | "DERIVED_FROM"     // A 从 B 推导而来
  | "SUPPORTS"         // A 的证据支持 B
  | "CONTRADICTS"      // A 与 B 事实矛盾
  | "SUPERSEDES"       // A 取代 B（B 被 A 更正或扩展）
  | "EQUIVALENT_UNDER" // A 在某条件下等价于 B
  | "RELATED_TO";      // 弱关联（只能导航，不能支撑结论——哲学 05）

type EdgeSource =
  | "intra-material-compile"    // compile 自动产（同材料内部）
  | "cross-material-detect"     // 独立检测产（跨材料）
  | "human-confirm"             // 人类确认
  | "periodic-lint";            // 周期 Lint 自动修复

interface Relation {
  id: string;              // rel:xxx
  from: NodeRef;           // 强类型引用（修 GPT 问题 5.3）
  to: NodeRef;
  type: RelationType;      // 方向性由 type 语义定义（修 GPT 问题 5.4：去掉 direction）
  conditions: string[];
  conditionStatus: "EXPLICIT_NONE" | "PRESERVED" | "UNVERIFIED";
  supersessionEffect: "TOTAL_TO_CLAIM" | "CONDITIONAL_TO_CLAIM" | null;
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
  consumedBy: string[];    // wiki:xxx（依赖追踪，用于影响分析）
}
```

**消费硬门槛**：Relation 只有在双端点存在、Evidence 可解析、`conditionStatus !== UNVERIFIED`、`relationAuditVersion` 等于当前版本、且状态允许时才进入 Graph。`SUPERSEDES` 只有经边级审计后才能设置覆盖效果；全局生命周期更新只接受 `TOTAL_TO_CLAIM`。

**NodeRef 是 branded type**（修 GPT 问题 5.3）：

```typescript
// 品牌类型——编译期区分引用类型，防止把 ClaimRef 传给期望 ConceptRef 的地方
type ClaimRef = string & { readonly __brand: "ClaimRef" };
type ConceptRef = string & { readonly __brand: "ConceptRef" };
type WikiRef = string & { readonly __brand: "WikiRef" };
type NodeRef = ClaimRef | ConceptRef | WikiRef;
```

不同 RelationType 限制允许连接的节点类型：
- REQUIRES/DERIVED_FROM/SUPPORTS/CONTRADICTS/SUPERSEDES：from/to 通常是 ClaimRef
- EQUIVALENT_UNDER：from/to 通常是 ConceptRef
- RELATED_TO：任意 NodeRef

### 2.7 WikiModule（供 Agent 阅读的完整语义单元）

```typescript
interface WikiModule {
  id: string;              // wiki:xxx
  stableAddress: string;   // 稳定地址（如 wiki:fourier-transform）
  coreQuestion: string;    // 核心问题（模块围绕此组织）
  currentUnderstanding: string;  // 当前认识
  disputes: string[];      // 争议
  claimRefs: ClaimRef[];   // 引用的 Claim
  conceptRefs: ConceptRef[];  // 引用的 Concept
  dependencies: string[];  // 依赖的其他模块
  publicationState: PublicationState;
  updatedAt: string;
}
```

**语义**：围绕稳定主题组织的语义单元。不按输入文件一一生成——新材料优先更新既有模块。模块数量由主题决定，不固定（修 GPT 问题 8）。

### 2.8 ContextPack（Agent 统一消费合同）

```typescript
interface ContextPackRequest {
  task: string;
  domain: string;
  asOf: "current" | string;  // 知识版本快照
  contextBudgetTokens: number;
  maxGraphDepth: number;
  allowedRelationTypes: RelationType[];
  mustIncludeEvidence: boolean;
  uncertaintyPolicy: "surface" | "surface_with_warning";  // 修 GPT 问题 5.5：去掉 suppress
  scopeContext?: { principalId: string; projectId?: string };
}

interface ContextPack {
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

interface SelectionLogEntry {
  selected: string;
  reason: string;
  dropped?: string;
  dropReason?: string;
}
```

**在线职责**：`maxGraphDepth` 和 `allowedRelationTypes` 是触发后导航的上限，不表示每次请求都遍历 Graph。目标在线链路必须 Graph-capable，但只在跨来源关系、冲突/替代/依赖、影响任务或可观测 Seed 覆盖缺口成立时进入有界候选 Graph；最终可见内容仍按同一 Context 预算和证据闭包门禁选择。缺少 `scopeContext` 时按 Global-only，不能默认全选 PERSONAL/PROJECT。

---

## 三、Proposition（编译中间产物，不是一等对象）

**决策 4A**：Proposition 先作为可重建的编译中间产物。验证有效后再升级为长期资产。

```typescript
// 不长期存储、不进 Git——Compiler 内部使用后丢弃
interface PropositionDraft {
  sourceId: string;
  blockId: string;         // 引用 parser 生成的块
  text: string;            // LLM 提取的原子命题文本
  exactQuote: string;      // LLM 返回的原文引用（程序映射成 SourceSpan）
  relatesTo?: {
    fromPropIndex: number;  // 引用同次切分的第 N 条命题
    type: RelationType;
  };
}
```

**为什么是中间产物**：Product Definition 的一等对象是 Evidence/Claim/Concept/Relation/WikiModule，不包含 Proposition。旧项目把 Proposition 当一等对象导致了一堆复杂度（propRefs string[]、marker 内嵌、chase 单文件）。新项目先比较「原文块→Claim」vs「原文块→Prop→Claim」，如果后者明显提高证据对齐质量，再升级。

---

## 四、Graph 构建（修 GPT 问题 10）

Graph 从 **Canonical Claim + Concept + Relation** 构建（不从 Wiki 文本反向抽取）：

```
Evidence → Compiler → Claim + Concept + Relation
                      ↓                    ↓
                      ↓                    → Graph（类型化关系索引）
                      → Wiki（连贯语义模块）
```

buildGraph 只读 publicationState=CANONICAL + lifecycle=ACTIVE 的 Claim/Concept/Relation，并对 Relation 再执行当前审计版本、条件状态、Evidence 与端点闭合门禁。QUARANTINED 不进 Graph。治理 Graph 始终存在；在线候选 Graph 按任务条件触发；候选子图不等于可见 Context 子图。

---

## 五、LLM 输出校验（修 GPT 问题 5.6）

所有 LLM 输出用 Zod schema 运行时校验。TypeScript 类型在运行时不存在，不能校验 LLM 输出。

每个 LLM 调用定义一个 Zod schema：
- 命题切分输出 schema
- Claim 编译输出 schema
- Relation 检测输出 schema
- 语义审计输出 schema

校验失败抛错（带原文片段），不静默吞掉（修旧项目坑 3.3）。
