import { describe, expect, it } from "vitest";
import type { Claim } from "../types/index.js";
import { measureTextCost, stableStringify } from "./pack-cost-ledger.js";
import {
	buildLegacyClaimSections,
	buildStructuredClaimTable,
	claimSectionsHash,
	decodeStructuredClaimTable,
} from "./structured-pack-renderer.js";

function claim(index: number): Claim {
	return {
		id: `claim:${index}`,
		statement: `Claim statement ${index}`,
		retrievalAliases: [`别名 ${index}`],
		evidenceSpanIds: [`span:${index}`],
		conditions: ["only when the documented condition holds"],
		derivation: "EXTRACTED",
		validity: "SUPPORTED",
		lifecycle: "ACTIVE",
		publicationState: "CANONICAL",
		validFrom: null,
		validTo: null,
		compilerVersion: "test",
		confidence: 1,
		claimKind: "FACT",
		scope: { type: "GLOBAL" },
		provenanceRefs: [{ type: "SourceSpan", spanId: `span:${index}` }],
		supportingEvidenceRefs: [{ type: "SourceSpan", spanId: `span:${index}` }],
		knowledgeVersion: "frozen-version",
		recordedAt: "2026-08-10T00:00:00.000Z",
	};
}

describe("structured pack renderer", () => {
	it("round-trips every frozen Claim communication and semantic field", () => {
		const claims = [claim(1), claim(2)];
		const legacy = buildLegacyClaimSections(claims);
		const decoded = decodeStructuredClaimTable(buildStructuredClaimTable(claims));

		expect(decoded).toEqual(legacy);
		expect(claimSectionsHash(decoded)).toBe(claimSectionsHash(legacy));
	});

	it("is deterministic for the same ranked Claim sequence", () => {
		const claims = [claim(1), claim(2), claim(3)];
		expect(stableStringify(buildStructuredClaimTable(claims))).toBe(
			stableStringify(buildStructuredClaimTable(claims)),
		);
	});

	it("fails closed when columns drift", () => {
		const table = buildStructuredClaimTable([claim(1)]);
		const drifted = {
			...table,
			columns: [...table.columns].reverse(),
		} as unknown as typeof table;
		expect(() => decodeStructuredClaimTable(drifted)).toThrow("columns drifted");
	});

	it("removes repeated object labels on a representative multi-Claim payload", () => {
		const claims = Array.from({ length: 20 }, (_, index) => claim(index + 1));
		const legacyTokens = measureTextCost(
			stableStringify(buildLegacyClaimSections(claims)),
		).estimatedTokens;
		const structuredTokens = measureTextCost(
			stableStringify(buildStructuredClaimTable(claims)),
		).estimatedTokens;

		expect(structuredTokens).toBeLessThan(legacyTokens * 0.9);
	});
});
