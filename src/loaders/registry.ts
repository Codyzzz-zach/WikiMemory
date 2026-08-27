import { MarkdownLoader } from "./markdown.js";
import type { DocumentLoader, LoaderRegistry } from "./types.js";

export class DefaultLoaderRegistry implements LoaderRegistry {
	private readonly loaders: DocumentLoader[] = [];

	register(loader: DocumentLoader): void {
		if (this.loaders.some((current) => current.id === loader.id)) {
			throw new Error(`Loader 已注册: ${loader.id}`);
		}
		this.loaders.push(loader);
	}

	resolve(filePath: string): DocumentLoader {
		const matches = this.loaders.filter((loader) => loader.canLoad(filePath));
		if (matches.length === 0) {
			throw new Error(`当前没有可处理该文件的 Loader: ${filePath}（当前里程碑仅支持 Markdown）`);
		}
		if (matches.length > 1) {
			throw new Error(
				`多个 Loader 同时匹配 ${filePath}: ${matches.map((loader) => loader.id).join(", ")}`,
			);
		}
		return matches[0] as DocumentLoader;
	}
}

export function createDefaultLoaderRegistry(): LoaderRegistry {
	const registry = new DefaultLoaderRegistry();
	registry.register(new MarkdownLoader());
	return registry;
}
