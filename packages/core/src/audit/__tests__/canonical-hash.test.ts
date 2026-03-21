import { describe, it, expect } from "vitest";
import { sha256, computeAuditHash, computeAuditHashSync, verifyChain } from "../canonical-hash.js";
import type { AuditHashInput } from "../canonical-hash.js";

function makeAuditHashInput(overrides: Partial<AuditHashInput> = {}): AuditHashInput {
  return {
    chainHashVersion: 1,
    schemaVersion: 1,
    id: "audit-001",
    eventType: "tool.executed",
    timestamp: "2025-01-15T10:00:00.000Z",
    actorType: "agent",
    actorId: "agent-1",
    entityType: "campaign",
    entityId: "campaign-123",
    riskCategory: "medium",
    snapshot: { action: "adjust_budget", amount: 500 },
    evidencePointers: [],
    summary: "Budget adjusted",
    previousEntryHash: null,
    ...overrides,
  };
}

describe("sha256", () => {
  it("returns a 64-character hex string", () => {
    const result = sha256("hello");
    expect(result).toHaveLength(64);
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns a known hash for a known input", () => {
    // SHA-256 of "hello" is well-known
    const result = sha256("hello");
    expect(result).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  });

  it("returns different hashes for different inputs", () => {
    const hash1 = sha256("input1");
    const hash2 = sha256("input2");
    expect(hash1).not.toBe(hash2);
  });

  it("returns the same hash for the same input (deterministic)", () => {
    const hash1 = sha256("consistent input");
    const hash2 = sha256("consistent input");
    expect(hash1).toBe(hash2);
  });

  it("handles empty string input", () => {
    const result = sha256("");
    expect(result).toHaveLength(64);
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  it("handles unicode input", () => {
    const result = sha256("hello 世界 🌍");
    expect(result).toHaveLength(64);
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("computeAuditHash", () => {
  it("returns a hex hash string", () => {
    const input = makeAuditHashInput();
    const result = computeAuditHash(input);
    expect(result).toHaveLength(64);
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for the same input", () => {
    const input = makeAuditHashInput();
    const hash1 = computeAuditHash(input);
    const hash2 = computeAuditHash(input);
    expect(hash1).toBe(hash2);
  });

  it("changes when any field is modified", () => {
    const baseInput = makeAuditHashInput();
    const baseHash = computeAuditHash(baseInput);

    // Changing eventType
    const modified1 = makeAuditHashInput({ eventType: "tool.failed" });
    expect(computeAuditHash(modified1)).not.toBe(baseHash);

    // Changing actorId
    const modified2 = makeAuditHashInput({ actorId: "agent-2" });
    expect(computeAuditHash(modified2)).not.toBe(baseHash);

    // Changing snapshot
    const modified3 = makeAuditHashInput({ snapshot: { action: "pause_campaign" } });
    expect(computeAuditHash(modified3)).not.toBe(baseHash);

    // Changing summary
    const modified4 = makeAuditHashInput({ summary: "Different summary" });
    expect(computeAuditHash(modified4)).not.toBe(baseHash);

    // Changing previousEntryHash
    const modified5 = makeAuditHashInput({ previousEntryHash: "abc123" });
    expect(computeAuditHash(modified5)).not.toBe(baseHash);
  });

  it("is independent of object key order in input", () => {
    const input1 = makeAuditHashInput();
    // Construct an equivalent object with keys in different order
    const input2: AuditHashInput = {
      summary: input1.summary,
      previousEntryHash: input1.previousEntryHash,
      evidencePointers: input1.evidencePointers,
      snapshot: input1.snapshot,
      riskCategory: input1.riskCategory,
      entityId: input1.entityId,
      entityType: input1.entityType,
      actorId: input1.actorId,
      actorType: input1.actorType,
      timestamp: input1.timestamp,
      eventType: input1.eventType,
      id: input1.id,
      schemaVersion: input1.schemaVersion,
      chainHashVersion: input1.chainHashVersion,
    };
    expect(computeAuditHash(input1)).toBe(computeAuditHash(input2));
  });

  it("includes evidence pointers in hash computation", () => {
    const withoutEvidence = makeAuditHashInput({ evidencePointers: [] });
    const withEvidence = makeAuditHashInput({
      evidencePointers: [{ type: "inline", hash: "abc123", storageRef: null }],
    });
    expect(computeAuditHash(withoutEvidence)).not.toBe(computeAuditHash(withEvidence));
  });
});

describe("computeAuditHashSync", () => {
  it("returns the same result as computeAuditHash", () => {
    const input = makeAuditHashInput();
    expect(computeAuditHashSync(input)).toBe(computeAuditHash(input));
  });
});

describe("verifyChain", () => {
  function makeChainEntry(
    index: number,
    previousHash: string | null,
  ): AuditHashInput & { entryHash: string; previousEntryHash: string | null } {
    const hashInput = makeAuditHashInput({
      id: `audit-${index}`,
      timestamp: `2025-01-15T10:0${index}:00.000Z`,
      previousEntryHash: previousHash,
    });
    const entryHash = computeAuditHash(hashInput);
    return { ...hashInput, entryHash, previousEntryHash: previousHash };
  }

  it("validates an empty chain", () => {
    const result = verifyChain([]);
    expect(result.valid).toBe(true);
    expect(result.brokenAt).toBeNull();
  });

  it("validates a single-entry chain", () => {
    const entry = makeChainEntry(0, null);
    const result = verifyChain([entry]);
    expect(result.valid).toBe(true);
    expect(result.brokenAt).toBeNull();
  });

  it("validates a multi-entry chain with correct linkage", () => {
    const entry0 = makeChainEntry(0, null);
    const entry1 = makeChainEntry(1, entry0.entryHash);
    const entry2 = makeChainEntry(2, entry1.entryHash);

    const result = verifyChain([entry0, entry1, entry2]);
    expect(result.valid).toBe(true);
    expect(result.brokenAt).toBeNull();
  });

  it("detects tampered entry hash", () => {
    const entry0 = makeChainEntry(0, null);
    const entry1 = makeChainEntry(1, entry0.entryHash);

    // Tamper with the entry hash
    entry1.entryHash = "0000000000000000000000000000000000000000000000000000000000000000";

    const result = verifyChain([entry0, entry1]);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(1);
  });

  it("detects tampered data (snapshot modified after hashing)", () => {
    const entry0 = makeChainEntry(0, null);
    const entry1 = makeChainEntry(1, entry0.entryHash);

    // Tamper with the data without recomputing hash
    entry1.snapshot = { action: "tampered_action", amount: 9999 };

    const result = verifyChain([entry0, entry1]);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(1);
  });

  it("detects broken chain linkage (previousEntryHash mismatch)", () => {
    const entry0 = makeChainEntry(0, null);
    const entry1 = makeChainEntry(1, entry0.entryHash);

    // Create entry2 that points to entry0 instead of entry1 (broken chain)
    const hashInput2 = makeAuditHashInput({
      id: "audit-2",
      timestamp: "2025-01-15T10:02:00.000Z",
      previousEntryHash: entry0.entryHash, // should point to entry1
    });
    const entry2 = {
      ...hashInput2,
      entryHash: computeAuditHash(hashInput2),
      previousEntryHash: entry0.entryHash,
    };

    const result = verifyChain([entry0, entry1, entry2]);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(2);
  });

  it("detects tampering at the first entry", () => {
    const entry0 = makeChainEntry(0, null);
    // Tamper with first entry's summary
    entry0.summary = "tampered summary";

    const result = verifyChain([entry0]);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(0);
  });

  it("reports the first broken index in a long chain", () => {
    const entry0 = makeChainEntry(0, null);
    const entry1 = makeChainEntry(1, entry0.entryHash);
    const entry2 = makeChainEntry(2, entry1.entryHash);
    const entry3 = makeChainEntry(3, entry2.entryHash);

    // Tamper entry at index 2
    entry2.summary = "tampered";

    const result = verifyChain([entry0, entry1, entry2, entry3]);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(2);
  });
});
