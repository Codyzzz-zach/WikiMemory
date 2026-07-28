import type { TextBlock } from "../parser/markdown.js";
import type { Source } from "../types/index.js";

/** Loader 的唯一职责是把外部格式机械转换成统一文档；不得生成 Claim。 */
export interface LoadedDocument {
	uri: string;
	sourceType: Source["sourceType"];
	loaderVersion: string;
	sourceKey: string;
	title: string;
	/** Loader mechanically preserves source-level metadata; semantic interpretation stays downstream. */
	metadata?: Record<string, string>;
	parsedText: string;
	blocks: TextBlock[];
}

export interface DocumentLoader {
	id: string;
	version: string;
	canLoad(filePath: string): boolean;
	load(filePath: string): LoadedDocument;
}

export interface LoaderRegistry {
	register(loader: DocumentLoader): void;
	resolve(filePath: string): DocumentLoader;
}
