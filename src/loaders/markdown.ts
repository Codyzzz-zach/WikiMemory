import { parseMarkdownFile } from "../parser/markdown.js";
import type { DocumentLoader, LoadedDocument } from "./types.js";

export class MarkdownLoader implements DocumentLoader {
	readonly id = "markdown";
	readonly version = "markdown-v1.0";

	canLoad(filePath: string): boolean {
		return /\.md$/i.test(filePath);
	}

	load(filePath: string): LoadedDocument {
		const parsed = parseMarkdownFile(filePath);
		return {
			uri: filePath,
			sourceType: "md",
			loaderVersion: this.version,
			sourceKey: parsed.fileStem,
			title: parsed.frontmatter.title ?? parsed.fileStem,
			parsedText: parsed.body,
			blocks: parsed.blocks,
		};
	}
}
