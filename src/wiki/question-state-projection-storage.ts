import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
	type QuestionStateProjection,
	serializeQuestionStateProjection,
} from "./question-state-projection.js";

export interface QuestionStateProjectionShadowStoreOptions {
	shadowRoot: string;
	canonicalRuntimeRoot: string;
}

export interface QuestionStateProjectionShadowReceipt {
	path: string;
	projectionHash: string;
	bytes: number;
}

export function writeQuestionStateProjectionShadow(
	options: QuestionStateProjectionShadowStoreOptions,
	projection: QuestionStateProjection,
): QuestionStateProjectionShadowReceipt {
	const shadowRoot = resolveExplicitRoot(options.shadowRoot, "shadowRoot");
	const canonicalRuntimeRoot = resolveExplicitRoot(
		options.canonicalRuntimeRoot,
		"canonicalRuntimeRoot",
	);
	if (pathsOverlap(shadowRoot, canonicalRuntimeRoot)) {
		throw new Error(
			`C1 shadow root must not overlap canonical runtime: ${shadowRoot} <-> ${canonicalRuntimeRoot}`,
		);
	}
	const directory = join(shadowRoot, "question-state-projections");
	const fileName = `${safeSegment(projection.questionRef, "question:")}__${safeSegment(
		projection.knowledgeVersion,
	)}__${projection.projectionHash.slice(0, 16)}.json`;
	const destination = join(directory, fileName);
	const serialized = serializeQuestionStateProjection(projection);
	mkdirSync(directory, { recursive: true });
	const temporary = join(directory, `.${fileName}.${process.pid}.tmp`);
	writeFileSync(temporary, serialized, "utf8");
	renameSync(temporary, destination);
	return {
		path: destination,
		projectionHash: projection.projectionHash,
		bytes: Buffer.byteLength(serialized),
	};
}

function resolveExplicitRoot(path: string, field: string): string {
	if (!path.trim()) throw new Error(`C1 shadow ${field} cannot be empty`);
	if (!isAbsolute(path)) throw new Error(`C1 shadow ${field} must be absolute: ${path}`);
	const resolved = resolve(path);
	if (resolved === sep || basename(resolved) === ".." || dirname(resolved) === resolved) {
		throw new Error(`C1 shadow ${field} is too broad: ${path}`);
	}
	return resolved;
}

function pathsOverlap(left: string, right: string): boolean {
	return isSameOrInside(left, right) || isSameOrInside(right, left);
}

function isSameOrInside(candidate: string, parent: string): boolean {
	const path = relative(parent, candidate);
	return path === "" || (!path.startsWith(`..${sep}`) && path !== "..");
}

function safeSegment(value: string, prefix = ""): string {
	const name = value.replace(prefix, "").replace(/[^a-zA-Z0-9._-]+/g, "-");
	if (!name || name === "." || name === "..") {
		throw new Error(`QuestionStateProjection has unsafe path segment: ${value}`);
	}
	return name;
}
