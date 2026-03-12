import { describe, it, expect } from "vitest";

import {
  createApprovalState,
  transitionApproval,
  isExpired,
  computeBindingHash,
  validateBindingHash,
  hashObject,
  computeAuditHashSync,
  sha256,
  verifyChain,
  redactSnapshot,
  DEFAULT_REDACTION_CONFIG,
  storeEvidence,
  verifyEvidence,
  AuditLedger,
  InMemoryLedgerStorage,
} from "../index.js";

import type { AuditHashInput } from "../index.js";

// ===================================================================
// APPROVAL STATE MACHINE
// ===================================================================

describe("Approval State Machine", () => {
  it("creates a pending state", () => {
    const expiresAt = new Date(Date.now() + 3600_000);
    const state = createApprovalState(expiresAt);
    expect(state.status).toBe("pending");
    expect(state.respondedBy).toBeNull();
    expect(state.patchValue).toBeNull();
    expect(state.expiresAt).toBe(expiresAt);
  });

  it("transitions to approved", () => {
    const state = createApprovalState(new Date(Date.now() + 3600_000));
    const approved = transitionApproval(state, "approve", "admin-1");
    expect(approved.status).toBe("approved");
    expect(approved.respondedBy).toBe("admin-1");
    expect(approved.respondedAt).toBeInstanceOf(Date);
  });

  it("transitions to rejected", () => {
    const state = createApprovalState(new Date(Date.now() + 3600_000));
    const rejected = transitionApproval(state, "reject", "admin-1");
    expect(rejected.status).toBe("rejected");
    expect(rejected.respondedBy).toBe("admin-1");
  });

  it("transitions to patched with patch value", () => {
    const state = createApprovalState(new Date(Date.now() + 3600_000));
    const patched = transitionApproval(state, "patch", "admin-1", { amount: 100 });
    expect(patched.status).toBe("patched");
    expect(patched.patchValue).toEqual({ amount: 100 });
  });

  it("throws when approving a non-pending state", () => {
    const state = createApprovalState(new Date(Date.now() + 3600_000));
    const approved = transitionApproval(state, "approve", "admin-1");
    expect(() => transitionApproval(approved, "approve", "admin-2")).toThrow(
      "Cannot approve: current status is approved",
    );
  });

  it("throws when rejecting a non-pending state", () => {
    const state = createApprovalState(new Date(Date.now() + 3600_000));
    const rejected = transitionApproval(state, "reject", "admin-1");
    expect(() => transitionApproval(rejected, "reject", "admin-2")).toThrow(
      "Cannot reject: current status is rejected",
    );
  });

  it("expiry check: isExpired returns true when past expiresAt", () => {
    const pastExpiry = new Date(Date.now() - 1000);
    const state = createApprovalState(pastExpiry);
    expect(isExpired(state)).toBe(true);
  });

  it("expiry check: isExpired returns false when before expiresAt", () => {
    const futureExpiry = new Date(Date.now() + 3600_000);
    const state = createApprovalState(futureExpiry);
    expect(isExpired(state)).toBe(false);
  });
});

// ===================================================================
// BINDING HASH
// ===================================================================

describe("Binding Hash", () => {
  const bindingData = {
    envelopeId: "env-1",
    envelopeVersion: 1,
    actionId: "action-1",
    parameters: { amount: 500 },
    decisionTraceHash: "abc123",
    contextSnapshotHash: "def456",
  };

  it("computes binding hash deterministically", () => {
    const hash1 = computeBindingHash(bindingData);
    const hash2 = computeBindingHash(bindingData);
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // SHA-256 hex
  });

  it("validates matching hash", () => {
    const hash = computeBindingHash(bindingData);
    expect(validateBindingHash(hash, bindingData)).toBe(true);
  });

  it("rejects stale hash when version differs", () => {
    const hash = computeBindingHash(bindingData);
    const modifiedData = { ...bindingData, envelopeVersion: 2 };
    expect(validateBindingHash(hash, modifiedData)).toBe(false);
  });

  it("rejects hash when parameters change", () => {
    const hash = computeBindingHash(bindingData);
    const modifiedData = { ...bindingData, parameters: { amount: 999 } };
    expect(validateBindingHash(hash, modifiedData)).toBe(false);
  });
});

// ===================================================================
// AUDIT: CANONICAL HASH + CHAIN VERIFICATION
// ===================================================================

describe("Audit", () => {
  const baseHashInput: AuditHashInput = {
    chainHashVersion: 1,
    schemaVersion: 1,
    id: "audit-1",
    eventType: "action.evaluated",
    timestamp: "2025-01-15T10:00:00.000Z",
    actorType: "agent",
    actorId: "agent-1",
    entityType: "campaign",
    entityId: "campaign-123",
    riskCategory: "medium",
    snapshot: { budget: 500 },
    evidencePointers: [],
    summary: "Evaluated budget change",
    previousEntryHash: null,
  };

  it("canonical hash determinism: same input produces same hash", () => {
    const hash1 = computeAuditHashSync(baseHashInput);
    const hash2 = computeAuditHashSync(baseHashInput);
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);
  });

  it("canonical hash changes when input changes", () => {
    const hash1 = computeAuditHashSync(baseHashInput);
    const hash2 = computeAuditHashSync({ ...baseHashInput, summary: "Different summary" });
    expect(hash1).not.toBe(hash2);
  });

  it("hash chain verification: valid chain", () => {
    const hashInput1: AuditHashInput = {
      chainHashVersion: 1,
      schemaVersion: 1,
      id: "chain-1",
      eventType: "action.evaluated",
      timestamp: "2025-01-15T10:00:00.000Z",
      actorType: "agent",
      actorId: "agent-1",
      entityType: "campaign",
      entityId: "camp-1",
      riskCategory: "low",
      snapshot: { a: 1 },
      evidencePointers: [],
      summary: "Entry 1",
      previousEntryHash: null,
    };
    const hash1 = computeAuditHashSync(hashInput1);

    const hashInput2: AuditHashInput = {
      ...hashInput1,
      id: "chain-2",
      summary: "Entry 2",
      previousEntryHash: hash1,
    };
    const hash2 = computeAuditHashSync(hashInput2);

    const result = verifyChain([
      { ...hashInput1, entryHash: hash1 },
      { ...hashInput2, entryHash: hash2 },
    ]);
    expect(result.valid).toBe(true);
    expect(result.brokenAt).toBeNull();
  });

  it("hash chain break detection", () => {
    const hashInput1: AuditHashInput = {
      chainHashVersion: 1,
      schemaVersion: 1,
      id: "break-1",
      eventType: "action.evaluated",
      timestamp: "2025-01-15T10:00:00.000Z",
      actorType: "agent",
      actorId: "agent-1",
      entityType: "campaign",
      entityId: "camp-1",
      riskCategory: "low",
      snapshot: { a: 1 },
      evidencePointers: [],
      summary: "Entry 1",
      previousEntryHash: null,
    };
    const hash1 = computeAuditHashSync(hashInput1);

    const hashInput2: AuditHashInput = {
      ...hashInput1,
      id: "break-2",
      summary: "Entry 2",
      previousEntryHash: hash1,
    };
    const hash2 = computeAuditHashSync(hashInput2);

    // Entry 3 has previousEntryHash = "WRONG" instead of hash2
    const hashInput3: AuditHashInput = {
      ...hashInput1,
      id: "break-3",
      summary: "Entry 3",
      previousEntryHash: "WRONG",
    };
    const hash3 = computeAuditHashSync(hashInput3);

    const result = verifyChain([
      { ...hashInput1, entryHash: hash1 },
      { ...hashInput2, entryHash: hash2 },
      { ...hashInput3, entryHash: hash3 },
    ]);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(2);
  });

  it("verifyChain catches tampered entry data", () => {
    const hashInput1: AuditHashInput = {
      chainHashVersion: 1,
      schemaVersion: 1,
      id: "audit-tamper-1",
      eventType: "action.evaluated",
      timestamp: "2025-01-15T10:00:00.000Z",
      actorType: "agent",
      actorId: "agent-1",
      entityType: "campaign",
      entityId: "campaign-1",
      riskCategory: "low",
      snapshot: { budget: 500 },
      evidencePointers: [],
      summary: "Original entry",
      previousEntryHash: null,
    };
    const hash1 = computeAuditHashSync(hashInput1);

    const hashInput2: AuditHashInput = {
      ...hashInput1,
      id: "audit-tamper-2",
      summary: "Second entry",
      previousEntryHash: hash1,
    };
    const hash2 = computeAuditHashSync(hashInput2);

    const entry1 = { ...hashInput1, entryHash: hash1 };
    const entry2 = { ...hashInput2, entryHash: hash2 };

    // Valid chain should pass
    expect(verifyChain([entry1, entry2]).valid).toBe(true);

    // Tamper with entry1's snapshot data but keep its old hash
    const tampered1 = { ...entry1, snapshot: { budget: 999999 } };
    expect(verifyChain([tampered1, entry2]).valid).toBe(false);
    expect(verifyChain([tampered1, entry2]).brokenAt).toBe(0);
  });

  it("redaction of email patterns", () => {
    const snapshot = { email: "user@example.com", name: "John" };
    const result = redactSnapshot(snapshot);
    expect(result.redacted["email"]).toBe("[REDACTED]");
    expect(result.redacted["name"]).toBe("John");
    expect(result.redactionApplied).toBe(true);
    expect(result.redactedFields).toContain("email");
  });

  it("redaction of API tokens", () => {
    const snapshot = { config: "Bearer sk-abcdefghijklmnopqrstuv" };
    const result = redactSnapshot(snapshot);
    expect(result.redacted["config"]).toContain("[REDACTED]");
    expect(result.redactionApplied).toBe(true);
  });

  it("redaction of field paths (e.g., 'password', 'secret')", () => {
    const snapshot = { password: "super-secret", apiKey: "my-key", normal: "value" };
    const result = redactSnapshot(snapshot);
    expect(result.redacted["password"]).toBe("[REDACTED]");
    expect(result.redacted["apiKey"]).toBe("[REDACTED]");
    expect(result.redacted["normal"]).toBe("value");
  });

  it("no redaction when snapshot is clean", () => {
    const snapshot = { name: "Campaign Alpha", budget: 500 };
    const result = redactSnapshot(snapshot);
    expect(result.redactionApplied).toBe(false);
    expect(result.redactedFields).toHaveLength(0);
  });
});

// ===================================================================
// EVIDENCE STORAGE
// ===================================================================

describe("Evidence Storage", () => {
  it("stores small evidence inline", () => {
    const evidence = { key: "value" };
    const pointer = storeEvidence(evidence);
    expect(pointer.type).toBe("inline");
    expect(pointer.storageRef).toBeNull();
    expect(pointer.hash).toHaveLength(64);
  });

  it("stores large evidence as pointer", () => {
    // Create evidence larger than 10KB
    const largeData = { data: "x".repeat(11_000) };
    const pointer = storeEvidence(largeData, "s3://bucket");
    expect(pointer.type).toBe("pointer");
    expect(pointer.storageRef).toContain("s3://bucket");
    expect(pointer.hash).toHaveLength(64);
  });

  it("verifyEvidence returns true for matching content", () => {
    const evidence = { action: "budget_change", amount: 500 };
    const pointer = storeEvidence(evidence);
    expect(verifyEvidence(evidence, pointer.hash)).toBe(true);
  });

  it("verifyEvidence returns false for tampered content", () => {
    const evidence = { action: "budget_change", amount: 500 };
    const pointer = storeEvidence(evidence);
    const tampered = { action: "budget_change", amount: 999 };
    expect(verifyEvidence(tampered, pointer.hash)).toBe(false);
  });
});

// ===================================================================
// AUDIT LEDGER (integration-level)
// ===================================================================

describe("AuditLedger", () => {
  it("records entries and maintains hash chain", async () => {
    const storage = new InMemoryLedgerStorage();
    const ledger = new AuditLedger(storage);

    const entry1 = await ledger.record({
      eventType: "action.evaluated",
      actorType: "agent",
      actorId: "agent-1",
      entityType: "campaign",
      entityId: "camp-1",
      riskCategory: "low",
      summary: "First entry",
      snapshot: { budget: 100 },
    });

    const entry2 = await ledger.record({
      eventType: "action.executed",
      actorType: "agent",
      actorId: "agent-1",
      entityType: "campaign",
      entityId: "camp-1",
      riskCategory: "low",
      summary: "Second entry",
      snapshot: { budget: 200 },
    });

    expect(entry1.previousEntryHash).toBeNull();
    expect(entry2.previousEntryHash).toBe(entry1.entryHash);

    const chainResult = await ledger.verifyChain([entry1, entry2]);
    expect(chainResult.valid).toBe(true);
  });

  it("applies redaction by default when no config is passed", async () => {
    const storage = new InMemoryLedgerStorage();
    const ledger = new AuditLedger(storage);

    const entry = await ledger.record({
      eventType: "action.evaluated",
      actorType: "user",
      actorId: "user-1",
      entityType: "account",
      entityId: "acct-1",
      riskCategory: "medium",
      summary: "Default redaction test",
      snapshot: {
        email: "pii@example.com",
        password: "supersecret",
        normalField: "visible",
      },
    });

    expect(entry.snapshot["email"]).toBe("[REDACTED]");
    expect(entry.snapshot["password"]).toBe("[REDACTED]");
    expect(entry.snapshot["normalField"]).toBe("visible");
    expect(entry.redactionApplied).toBe(true);
  });

  it("applies redaction when configured", async () => {
    const storage = new InMemoryLedgerStorage();
    const ledger = new AuditLedger(storage, DEFAULT_REDACTION_CONFIG);

    const entry = await ledger.record({
      eventType: "action.evaluated",
      actorType: "user",
      actorId: "user-1",
      entityType: "account",
      entityId: "acct-1",
      riskCategory: "medium",
      summary: "Evaluated with PII",
      snapshot: {
        email: "user@example.com",
        password: "secret123",
        normalField: "hello",
      },
    });

    expect(entry.snapshot["email"]).toBe("[REDACTED]");
    expect(entry.snapshot["password"]).toBe("[REDACTED]");
    expect(entry.snapshot["normalField"]).toBe("hello");
    expect(entry.redactionApplied).toBe(true);
  });

  it("queries entries by filter", async () => {
    const storage = new InMemoryLedgerStorage();
    const ledger = new AuditLedger(storage);

    await ledger.record({
      eventType: "action.evaluated",
      actorType: "agent",
      actorId: "agent-1",
      entityType: "campaign",
      entityId: "camp-1",
      riskCategory: "low",
      summary: "Entry 1",
      snapshot: {},
      envelopeId: "env-1",
    });

    await ledger.record({
      eventType: "action.executed",
      actorType: "agent",
      actorId: "agent-1",
      entityType: "campaign",
      entityId: "camp-2",
      riskCategory: "medium",
      summary: "Entry 2",
      snapshot: {},
      envelopeId: "env-2",
    });

    const filtered = await ledger.query({ entityId: "camp-1" });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.entityId).toBe("camp-1");

    const byType = await ledger.query({ eventType: "action.executed" });
    expect(byType).toHaveLength(1);
    expect(byType[0]?.summary).toBe("Entry 2");
  });
});

// ===================================================================
// SHA256 utility
// ===================================================================

describe("sha256 utility", () => {
  it("produces consistent hex output", () => {
    const h1 = sha256("hello");
    const h2 = sha256("hello");
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64);
  });

  it("different inputs produce different hashes", () => {
    expect(sha256("a")).not.toBe(sha256("b"));
  });
});

// ===================================================================
// hashObject utility
// ===================================================================

describe("hashObject", () => {
  it("hashes objects deterministically", () => {
    const obj = { a: 1, b: "two" };
    expect(hashObject(obj)).toBe(hashObject(obj));
    expect(hashObject(obj)).toHaveLength(64);
  });
});
