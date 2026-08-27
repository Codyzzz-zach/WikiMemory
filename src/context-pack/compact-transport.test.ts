import { describe, expect, it } from "vitest";
import type { Claim, ContextPack } from "../types/index.js";
import {
	agentContextPackProjectionHash,
	buildAgentContextPackProjection,
	decodeCompactContextPack,
	encodeCompactContextPack,
} from "./compact-transport.js";

function claim(index: number): Claim {
	return {
		id: `claim:${index}`,
		statement: `Claim statement ${index}`,
		retrievalAliases: [`别名 ${index}`],
		evidenceSpanIds: [`span:${index}`],
		conditions: ["when the recorded condition holds"],
		derivation: "EXTRACTED",
		validity: "SUPPORTED",
		lifecycle: "ACTIVE",
		publicationState: "CANONICAL",
		validFrom: null,
		validTo: null,
		compilerVersion: "compiler-internal-only",
		confidence: 0.9,
		claimKind: "FACT",
		scope: { type: "GLOBAL" },
		provenanceRefs: [{ type: "SourceSpan", spanId: `span:${index}` }],
		supportingEvidenceRefs: [{ type: "SourceSpan", spanId: `span:${index}` }],
		knowledgeVersion: "knowledge:v1",
		recordedAt: "2026-08-11T00:00:00.000Z",
	};
}

function pack(): ContextPack {
	const claims = [claim(1), claim(2)];
	return {
		knowledgeVersion: "knowledge:v1",
		taskMap: "主题: compact transport",
		subgraph: { claims, relations: [] },
		wikiModules: [],
		evidenceSpans: claims.map((item, index) => ({
			id: item.evidenceSpanIds[0] ?? "",
			sourceId: "source:1",
			blockId: `block:${index + 1}`,
			charStart: index * 20,
			charEnd: index * 20 + 10,
			text: `Evidence ${index + 1}`,
		})),
		conflictsAndConditions: [],
		selectionLog: [],
		knownGaps: [],
	};
}

describe("compact Context Pack transport", () => {
	it("round-trips every Agent-visible named field", () => {
		const input = pack();
		const expected = buildAgentContextPackProjection(input);
		const decoded = decodeCompactContextPack(encodeCompactContextPack(input));
		expect(decoded).toEqual(expected);
		expect(agentContextPackProjectionHash(decoded)).toBe(agentContextPackProjectionHash(expected));
	});

	it("does not present Canonical-only Claim runtime fields as transport fields", () => {
		const decoded = decodeCompactContextPack(encodeCompactContextPack(pack()));
		expect(decoded.claims[0]).not.toHaveProperty("compilerVersion");
		expect(decoded.semantics[0]).not.toHaveProperty("confidence");
	});

	it("fails closed on schema, column order, row types and payload drift", () => {
		const encoded = encodeCompactContextPack(pack());
		expect(() => decodeCompactContextPack({ ...encoded, schemaVersion: "future" })).toThrow(
			"Unsupported compact Context Pack",
		);
		expect(() => decodeCompactContextPack({ ...encoded, extra: true })).toThrow(
			"top-level fields drifted",
		);
		expect(() =>
			decodeCompactContextPack({
				...encoded,
				claimTable: { ...encoded.claimTable, columns: [...encoded.claimTable.columns].reverse() },
			}),
		).toThrow("columns drifted");
		const invalidRows = encoded.claimTable.rows.map((row) => [...row]);
		if (invalidRows[0]) invalidRows[0][0] = "first";
		expect(() =>
			decodeCompactContextPack({
				...encoded,
				claimTable: { ...encoded.claimTable, rows: invalidRows },
			}),
		).toThrow("invalid rank");
		expect(() =>
			decodeCompactContextPack({
				...encoded,
				payload: { ...encoded.payload, unexpected: true },
			}),
		).toThrow("payload fields drifted");
	});
});
