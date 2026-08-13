/**
 * Source 自身的管理元数据不是领域 Claim 之间的语义关系材料。
 * 它们可以保留为可检索 Claim，但不参与跨 Source 的 Claim 图推理；
 * 文档版本与出处关系应在 Source/provenance 层表达。
 */
export type SourceMetadataKind =
	| "TITLE"
	| "AUTHOR_OR_ACTOR"
	| "DOCUMENT_IDENTIFIER"
	| "LOCATION_IDENTIFIER"
	| "PUBLICATION_TIMING"
	| "PUBLISHER"
	| "REPOSITORY_RELEASE_METADATA";

const SOURCE_METADATA_PREDICATES: Array<{ kind: SourceMetadataKind; pattern: RegExp }> = [
	{
		kind: "TITLE",
		pattern:
			/(?:该|此|这)?(?:文章|帖子|页面|网页|论文|文档|报告|仓库|条目|评论)的?(?:标题|题名)(?:是|为|叫|名为)|\b(?:article|post|page|paper|document|report|repository|entry|comment) title\b/iu,
	},
	{
		kind: "AUTHOR_OR_ACTOR",
		pattern:
			/(?:该|此|这)?(?:文章|帖子|论文|文档|报告|评论)的?(?:作者|撰写者|提交者)|(?:用户|账号)\s*\S+\s*(?:发表|发布|提交|评论)|\b(?:authored|written|submitted|posted|commented) by\b|\b(?:author|submitter|commenter|username)s?\b/iu,
	},
	{
		kind: "DOCUMENT_IDENTIFIER",
		pattern:
			/(?:文件|文档|规范|政策|报告|标准|帖子|页面|条目|评论|议题|合并请求)的?(?:编号|ID|id)|\b(?:document|file|report|policy|standard|post|page|item|comment|issue|pull request|pr) (?:id|number)\b/iu,
	},
	{
		kind: "LOCATION_IDENTIFIER",
		pattern:
			/(?:该|此|这)?(?:文章|帖子|页面|网页|论文|文档|报告|仓库|条目)的?(?:URL|网址|链接|DOI)|\b(?:url|doi|permalink|canonical link)\b/iu,
	},
	{
		kind: "PUBLICATION_TIMING",
		pattern:
			/发布日期|生效日期|(?:创建|提交|发布|最后修订|最后更新)(?:时间|日期)?(?:是|为|于)|\bpublication date\b|\beffective date\b|\b(?:created|submitted|published|last revised|last updated) (?:at|on)\b/iu,
	},
	{
		kind: "PUBLISHER",
		pattern: /发布机构|\bpublished (?:by|on)\b|\bpublisher\b/iu,
	},
	{
		kind: "REPOSITORY_RELEASE_METADATA",
		pattern:
			/(?:标签名|目标提交分支|草稿状态|预发布状态|release 元数据|发布元数据)|\b(?:tag name|target commitish|target branch|draft status|prerelease status|release metadata)\b/iu,
	},
];

export function classifySourceMetadataClaim(statement: string): SourceMetadataKind | null {
	return SOURCE_METADATA_PREDICATES.find(({ pattern }) => pattern.test(statement))?.kind ?? null;
}

export function isSourceMetadataClaim(statement: string): boolean {
	return classifySourceMetadataClaim(statement) !== null;
}
