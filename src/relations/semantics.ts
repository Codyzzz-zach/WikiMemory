/**
 * Source 自身的管理元数据不是领域 Claim 之间的语义关系材料。
 * 它们可以保留为可检索 Claim，但不参与跨 Source 的 Claim 图推理；
 * 文档版本与出处关系应在 Source/provenance 层表达。
 */
const SOURCE_METADATA_PREDICATES = [
	/发布日期/u,
	/发布机构/u,
	/(?:文件|文档|规范|政策|报告|标准)编号/u,
	/\bpublication date\b/iu,
	/\bpublished (?:by|on)\b/iu,
	/\bpublisher\b/iu,
	/\b(?:document|file|report|policy|standard) (?:id|number)\b/iu,
];

export function isSourceMetadataClaim(statement: string): boolean {
	return SOURCE_METADATA_PREDICATES.some((pattern) => pattern.test(statement));
}
