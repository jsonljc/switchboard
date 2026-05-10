import { describe, it, expect } from "vitest";
import type { AuditEntry } from "@switchboard/schemas";
import { OPERATIONAL_AUDIT_EVENT_TYPES } from "@switchboard/schemas";
import { AuditLedger, InMemoryLedgerStorage } from "../ledger.js";
import { listAuditEntriesForBrowse, CursorDecodeError } from "../list-entries.js";

// ─── Test helper ──────────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  const base: AuditEntry = {
    id: `audit_${Math.random().toString(36).slice(2, 10)}`,
    eventType: "action.executed",
    timestamp: new Date("2026-05-10T12:00:00Z"),
    actorType: "agent",
    actorId: "agent_alex_001",
    entityType: "Action",
    entityId: "act_abc123",
    riskCategory: "low",
    visibilityLevel: "org",
    summary: "Test entry",
    snapshot: {},
    evidencePointers: [],
    redactionApplied: false,
    redactedFields: [],
    chainHashVersion: 1,
    schemaVersion: 1,
    entryHash: "hash_" + Math.random().toString(36).slice(2),
    previousEntryHash: null,
    envelopeId: null,
    organizationId: "org_test",
    traceId: null,
  };
  return { ...base, ...overrides };
}

async function seedEntries(storage: InMemoryLedgerStorage, entries: AuditEntry[]): Promise<void> {
  for (const e of entries) await storage.append(e);
}

function makeLedger(): { ledger: AuditLedger; storage: InMemoryLedgerStorage } {
  const storage = new InMemoryLedgerStorage();
  const ledger = new AuditLedger(storage);
  return { ledger, storage };
}

// ─── Sort + scope ──────────────────────────────────────────────────────────────

describe("sort + scope", () => {
  it("lists default scope=operational, returns rows in timestamp DESC order", async () => {
    const { ledger, storage } = makeLedger();
    const operationalType = OPERATIONAL_AUDIT_EVENT_TYPES[0]!;
    await seedEntries(storage, [
      makeEntry({
        eventType: operationalType,
        timestamp: new Date("2026-05-10T10:00:00Z"),
        id: "audit_a",
      }),
      makeEntry({
        eventType: operationalType,
        timestamp: new Date("2026-05-10T12:00:00Z"),
        id: "audit_b",
      }),
      makeEntry({
        eventType: operationalType,
        timestamp: new Date("2026-05-10T11:00:00Z"),
        id: "audit_c",
      }),
    ]);

    const result = await listAuditEntriesForBrowse(ledger, "org_test", {});
    expect(result.rows.length).toBe(3);
    // Timestamps should be in descending order
    expect(new Date(result.rows[0]!.timestamp).getTime()).toBeGreaterThan(
      new Date(result.rows[1]!.timestamp).getTime(),
    );
    expect(new Date(result.rows[1]!.timestamp).getTime()).toBeGreaterThan(
      new Date(result.rows[2]!.timestamp).getTime(),
    );
  });

  it("applies operational allowlist when scope=operational", async () => {
    const { ledger, storage } = makeLedger();
    const operationalType = OPERATIONAL_AUDIT_EVENT_TYPES[0]!;
    // One operational, one non-operational
    await seedEntries(storage, [
      makeEntry({ eventType: operationalType, id: "audit_op" }),
      makeEntry({ eventType: "action.proposed", id: "audit_non_op" }), // not in operational list
    ]);

    const result = await listAuditEntriesForBrowse(ledger, "org_test", { scope: "operational" });
    expect(
      result.rows.every((r) =>
        (OPERATIONAL_AUDIT_EVENT_TYPES as readonly string[]).includes(r.eventType),
      ),
    ).toBe(true);
    expect(result.rows.find((r) => r.id === "audit_non_op")).toBeUndefined();
    expect(result.rows.find((r) => r.id === "audit_op")).toBeDefined();
  });

  it("lifts allowlist when scope=all", async () => {
    const { ledger, storage } = makeLedger();
    const operationalType = OPERATIONAL_AUDIT_EVENT_TYPES[0]!;
    await seedEntries(storage, [
      makeEntry({ eventType: operationalType, id: "audit_op" }),
      makeEntry({ eventType: "action.proposed", id: "audit_non_op" }),
    ]);

    const result = await listAuditEntriesForBrowse(ledger, "org_test", { scope: "all" });
    expect(result.rows.find((r) => r.id === "audit_op")).toBeDefined();
    expect(result.rows.find((r) => r.id === "audit_non_op")).toBeDefined();
    expect(result.scope).toBe("all");
  });
});

// ─── URL-param overlay ─────────────────────────────────────────────────────────

describe("URL-param overlay", () => {
  it("URL-param eventType overrides scope filter (also yields scope=custom)", async () => {
    const { ledger, storage } = makeLedger();
    await seedEntries(storage, [
      makeEntry({ eventType: "action.proposed", id: "audit_proposed" }),
      makeEntry({ eventType: "action.executed", id: "audit_executed" }),
    ]);

    const result = await listAuditEntriesForBrowse(ledger, "org_test", {
      scope: "operational",
      eventType: "action.proposed",
    });
    expect(result.rows.length).toBe(1);
    expect(result.rows[0]!.id).toBe("audit_proposed");
    expect(result.scope).toBe("custom");
  });

  it("URL-param actorType narrows results", async () => {
    const { ledger, storage } = makeLedger();
    await seedEntries(storage, [
      makeEntry({ actorType: "agent", id: "audit_agent", eventType: "action.executed" }),
      makeEntry({ actorType: "user", id: "audit_user", eventType: "action.executed" }),
    ]);

    const result = await listAuditEntriesForBrowse(ledger, "org_test", { actorType: "user" });
    expect(result.rows.length).toBe(1);
    expect(result.rows[0]!.id).toBe("audit_user");
    expect(result.scope).toBe("custom");
  });

  it("URL-param after/before applies range", async () => {
    const { ledger, storage } = makeLedger();
    await seedEntries(storage, [
      makeEntry({
        timestamp: new Date("2026-05-09T00:00:00Z"),
        id: "audit_before",
        eventType: "action.executed",
      }),
      makeEntry({
        timestamp: new Date("2026-05-10T00:00:00Z"),
        id: "audit_in_range",
        eventType: "action.executed",
      }),
      makeEntry({
        timestamp: new Date("2026-05-11T00:00:00Z"),
        id: "audit_after",
        eventType: "action.executed",
      }),
    ]);

    const result = await listAuditEntriesForBrowse(ledger, "org_test", {
      scope: "all",
      after: "2026-05-09T12:00:00Z",
      before: "2026-05-10T12:00:00Z",
    });
    expect(result.rows.length).toBe(1);
    expect(result.rows[0]!.id).toBe("audit_in_range");
    expect(result.scope).toBe("custom");
  });

  it("URL-param entityType + entityId narrows to specific entity", async () => {
    const { ledger, storage } = makeLedger();
    await seedEntries(storage, [
      makeEntry({
        entityType: "Action",
        entityId: "act_001",
        id: "audit_match",
        eventType: "action.executed",
      }),
      makeEntry({
        entityType: "Action",
        entityId: "act_002",
        id: "audit_other_id",
        eventType: "action.executed",
      }),
      makeEntry({
        entityType: "Policy",
        entityId: "act_001",
        id: "audit_other_type",
        eventType: "action.executed",
      }),
    ]);

    const result = await listAuditEntriesForBrowse(ledger, "org_test", {
      scope: "all",
      entityType: "Action",
      entityId: "act_001",
    });
    expect(result.rows.length).toBe(1);
    expect(result.rows[0]!.id).toBe("audit_match");
    expect(result.scope).toBe("custom");
  });
});

// ─── Cursor pagination ─────────────────────────────────────────────────────────

describe("cursor pagination", () => {
  it("cursor encode/decode round-trip", async () => {
    const { ledger, storage } = makeLedger();
    const operationalType = OPERATIONAL_AUDIT_EVENT_TYPES[0]!;
    // Seed 3 entries so we get a nextCursor (limit=2)
    await seedEntries(storage, [
      makeEntry({
        eventType: operationalType,
        timestamp: new Date("2026-05-10T12:00:00Z"),
        id: "audit_1",
      }),
      makeEntry({
        eventType: operationalType,
        timestamp: new Date("2026-05-10T11:00:00Z"),
        id: "audit_2",
      }),
      makeEntry({
        eventType: operationalType,
        timestamp: new Date("2026-05-10T10:00:00Z"),
        id: "audit_3",
      }),
    ]);

    const page1 = await listAuditEntriesForBrowse(ledger, "org_test", { limit: 2, scope: "all" });
    expect(page1.nextCursor).not.toBeNull();

    // Decode round-trip: use cursor to get page 2
    const page2 = await listAuditEntriesForBrowse(ledger, "org_test", {
      scope: "all",
      limit: 2,
      cursor: page1.nextCursor!,
    });
    expect(page2.rows.length).toBe(1);
    expect(page2.rows[0]!.id).toBe("audit_3");
  });

  it("cursor pagination — fetches one extra, trims, computes nextCursor", async () => {
    const { ledger, storage } = makeLedger();
    const operationalType = OPERATIONAL_AUDIT_EVENT_TYPES[0]!;
    // Seed limit+1 entries
    for (let i = 0; i < 6; i++) {
      await storage.append(
        makeEntry({
          eventType: operationalType,
          timestamp: new Date(`2026-05-10T${String(12 - i).padStart(2, "0")}:00:00Z`),
          id: `audit_${i}`,
        }),
      );
    }

    const result = await listAuditEntriesForBrowse(ledger, "org_test", { scope: "all", limit: 5 });
    expect(result.rows.length).toBe(5); // trimmed to limit
    expect(result.nextCursor).not.toBeNull(); // hasMore = true
  });

  it("nextCursor null when fewer rows than limit", async () => {
    const { ledger, storage } = makeLedger();
    const operationalType = OPERATIONAL_AUDIT_EVENT_TYPES[0]!;
    await seedEntries(storage, [
      makeEntry({ eventType: operationalType, id: "audit_1" }),
      makeEntry({ eventType: operationalType, id: "audit_2" }),
    ]);

    const result = await listAuditEntriesForBrowse(ledger, "org_test", { scope: "all", limit: 10 });
    expect(result.rows.length).toBe(2);
    expect(result.nextCursor).toBeNull();
  });

  it("decodeCursor THROWS CursorDecodeError on malformed input", async () => {
    const { ledger } = makeLedger();
    await expect(
      listAuditEntriesForBrowse(ledger, "org_test", { cursor: "not-valid-cursor-garbage" }),
    ).rejects.toThrow(CursorDecodeError);
  });

  it("cursor pagination stable across (timestamp, id) ties", async () => {
    const { ledger, storage } = makeLedger();
    const operationalType = OPERATIONAL_AUDIT_EVENT_TYPES[0]!;
    const sharedTimestamp = new Date("2026-05-10T12:00:00Z");
    // Seed 5 entries with same timestamp — differentiated by id
    const ids = ["audit_e", "audit_d", "audit_c", "audit_b", "audit_a"];
    for (const id of ids) {
      await storage.append(
        makeEntry({ eventType: operationalType, timestamp: sharedTimestamp, id }),
      );
    }

    // With limit=3, we should get the first 3 (sorted by id DESC: e, d, c)
    const page1 = await listAuditEntriesForBrowse(ledger, "org_test", { scope: "all", limit: 3 });
    expect(page1.rows.length).toBe(3);
    expect(page1.nextCursor).not.toBeNull();
    // Rows should be in id DESC order (e, d, c)
    expect(page1.rows[0]!.id).toBe("audit_e");
    expect(page1.rows[1]!.id).toBe("audit_d");
    expect(page1.rows[2]!.id).toBe("audit_c");

    // Page 2 should have the remaining 2 (b, a)
    const page2 = await listAuditEntriesForBrowse(ledger, "org_test", {
      scope: "all",
      limit: 3,
      cursor: page1.nextCursor!,
    });
    expect(page2.rows.length).toBe(2);
    expect(page2.rows[0]!.id).toBe("audit_b");
    expect(page2.rows[1]!.id).toBe("audit_a");
    expect(page2.nextCursor).toBeNull();
  });
});

// ─── Projection ────────────────────────────────────────────────────────────────

describe("projection", () => {
  it("projection redacts non-allowlisted snapshot keys", async () => {
    const { ledger, storage } = makeLedger();
    await storage.append(
      makeEntry({
        eventType: "action.executed",
        snapshot: {
          actionType: "send_email", // allowlisted
          secretPayload: "do_not_expose", // NOT allowlisted
          internalTrace: "very_sensitive", // NOT allowlisted
        },
      }),
    );

    const result = await listAuditEntriesForBrowse(ledger, "org_test", { scope: "all" });
    expect(result.rows.length).toBe(1);
    const row = result.rows[0]!;
    expect(row.snapshotKeys).toContain("actionType");
    expect(row.snapshotKeys).not.toContain("secretPayload");
    expect(row.snapshotKeys).not.toContain("internalTrace");
  });

  it("projection sets redactedKeyCount correctly", async () => {
    const { ledger, storage } = makeLedger();
    await storage.append(
      makeEntry({
        eventType: "action.executed",
        snapshot: {
          // 1 allowlisted key
          actionType: "send_email",
          // 4 non-allowlisted keys
          secretKey1: "val1",
          secretKey2: "val2",
          secretKey3: "val3",
          secretKey4: "val4",
        },
      }),
    );

    const result = await listAuditEntriesForBrowse(ledger, "org_test", { scope: "all" });
    expect(result.rows[0]!.redactedKeyCount).toBe(4);
    expect(result.rows[0]!.snapshotKeys).toEqual(["actionType"]); // sorted, only allowlisted
  });

  it("projection emits both full hash and 16-char hashPrefix on evidencePointers", async () => {
    const fullHash = "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";
    const { ledger, storage } = makeLedger();
    await storage.append(
      makeEntry({
        eventType: "action.executed",
        evidencePointers: [{ type: "pointer", hash: fullHash, storageRef: "s3://bucket/key" }],
      }),
    );

    const result = await listAuditEntriesForBrowse(ledger, "org_test", { scope: "all" });
    const ep = result.rows[0]!.evidencePointers[0]!;
    expect(ep.hash).toBe(fullHash);
    expect(ep.hashPrefix).toBe(fullHash.slice(0, 16));
    expect(ep.hashPrefix.length).toBe(16);
  });

  it("projection NEVER emits evidencePointers[].storageRef", async () => {
    const { ledger, storage } = makeLedger();
    await storage.append(
      makeEntry({
        eventType: "action.executed",
        evidencePointers: [
          { type: "pointer", hash: "abc123def456789012345678", storageRef: "s3://__SENTINEL__" },
        ],
      }),
    );

    const result = await listAuditEntriesForBrowse(ledger, "org_test", { scope: "all" });
    expect(result.rows[0]!.evidencePointers[0]).not.toHaveProperty("storageRef");
  });

  it("projection drops admin-visibility entries", async () => {
    const { ledger, storage } = makeLedger();
    await seedEntries(storage, [
      makeEntry({ visibilityLevel: "public", id: "audit_public", eventType: "action.executed" }),
      makeEntry({ visibilityLevel: "org", id: "audit_org", eventType: "action.executed" }),
      makeEntry({ visibilityLevel: "admin", id: "audit_admin", eventType: "action.executed" }),
      makeEntry({ visibilityLevel: "system", id: "audit_system", eventType: "action.executed" }),
    ]);

    const result = await listAuditEntriesForBrowse(ledger, "org_test", { scope: "all" });
    const ids = result.rows.map((r) => r.id);
    expect(ids).toContain("audit_public");
    expect(ids).toContain("audit_org");
    expect(ids).not.toContain("audit_admin");
    expect(ids).not.toContain("audit_system");
  });
});

// ─── Limit ─────────────────────────────────────────────────────────────────────

describe("limit", () => {
  it("limit clamped to MAX_LIMIT (100)", async () => {
    const { ledger, storage } = makeLedger();
    // Seed 110 entries
    for (let i = 0; i < 110; i++) {
      await storage.append(
        makeEntry({
          eventType: "action.executed",
          id: `audit_${String(i).padStart(3, "0")}`,
          timestamp: new Date(Date.now() - i * 1000),
        }),
      );
    }

    // Schema max is 100; Math.min(100, 100) = 100 — result must be at most 100 rows
    const result = await listAuditEntriesForBrowse(ledger, "org_test", {
      scope: "all",
      limit: 100,
    });
    expect(result.rows.length).toBeLessThanOrEqual(100);
    expect(result.rows.length).toBe(100);
    expect(result.nextCursor).not.toBeNull(); // 110 total, 100 returned → hasMore
  });

  it("default limit is 50", async () => {
    const { ledger, storage } = makeLedger();
    // Seed 60 entries
    for (let i = 0; i < 60; i++) {
      await storage.append(
        makeEntry({
          eventType: "action.executed",
          id: `audit_${String(i).padStart(3, "0")}`,
          timestamp: new Date(Date.now() - i * 1000),
        }),
      );
    }

    const result = await listAuditEntriesForBrowse(ledger, "org_test", { scope: "all" });
    expect(result.rows.length).toBe(50);
    expect(result.nextCursor).not.toBeNull();
  });

  it("limit accepts string input ('50') via z.coerce", async () => {
    const { ledger, storage } = makeLedger();
    for (let i = 0; i < 10; i++) {
      await storage.append(
        makeEntry({
          eventType: "action.executed",
          id: `audit_${i}`,
          timestamp: new Date(Date.now() - i * 1000),
        }),
      );
    }

    // Simulate URL param as string — z.coerce.number() should parse it
    const result = await listAuditEntriesForBrowse(ledger, "org_test", {
      scope: "all",
      limit: "10" as unknown as number,
    });
    expect(result.rows.length).toBe(10);
  });
});

// ─── Empty result ──────────────────────────────────────────────────────────────

describe("empty result", () => {
  it("empty result returns rows: [], nextCursor: null", async () => {
    const { ledger } = makeLedger();

    const result = await listAuditEntriesForBrowse(ledger, "org_test", { scope: "all" });
    expect(result.rows).toEqual([]);
    expect(result.nextCursor).toBeNull();
  });
});

// ─── Custom scope semantics ────────────────────────────────────────────────────

describe("custom scope semantics", () => {
  it("scope === 'custom' when any narrowing URL param is present", async () => {
    const { ledger } = makeLedger();

    // each param triggers custom scope
    const tests = [
      { eventType: "action.executed" },
      { actorType: "user" },
      { entityType: "Action" },
      { entityId: "act_001" },
      { after: "2026-05-10T00:00:00Z" },
      { before: "2026-05-10T00:00:00Z" },
    ] as const;

    for (const params of tests) {
      const result = await listAuditEntriesForBrowse(ledger, "org_test", params);
      expect(result.scope).toBe("custom");
    }
  });

  it("scope === 'operational' when no params and chip default applies", async () => {
    const { ledger } = makeLedger();

    const result = await listAuditEntriesForBrowse(ledger, "org_test", {});
    expect(result.scope).toBe("operational");
  });

  it("scope === 'all' when ?scope=all and no narrowing params", async () => {
    const { ledger } = makeLedger();

    const result = await listAuditEntriesForBrowse(ledger, "org_test", { scope: "all" });
    expect(result.scope).toBe("all");
  });

  it("?scope=operational&eventType=work_trace.persisted yields scope='custom' and rows of that type", async () => {
    const { ledger, storage } = makeLedger();
    await seedEntries(storage, [
      makeEntry({ eventType: "work_trace.persisted", id: "audit_trace" }),
      makeEntry({ eventType: "action.executed", id: "audit_executed" }), // operational but not the filtered type
    ]);

    const result = await listAuditEntriesForBrowse(ledger, "org_test", {
      scope: "operational",
      eventType: "work_trace.persisted",
    });
    // scope must be custom because eventType param is present
    expect(result.scope).toBe("custom");
    // only the work_trace.persisted rows should appear
    expect(result.rows.length).toBe(1);
    expect(result.rows[0]!.id).toBe("audit_trace");
    expect(result.rows[0]!.eventType).toBe("work_trace.persisted");
  });

  it("snapshotKeys is sorted alphabetically (deterministic)", async () => {
    const { ledger, storage } = makeLedger();
    await storage.append(
      makeEntry({
        eventType: "action.executed",
        snapshot: {
          // Multiple allowlisted keys in non-alphabetical order
          traceId: "trace_1",
          actionType: "send_email",
          correlationId: "corr_1",
          agentKey: "alex",
        },
      }),
    );

    const result = await listAuditEntriesForBrowse(ledger, "org_test", { scope: "all" });
    const keys = result.rows[0]!.snapshotKeys;
    // Sorted: actionType, agentKey, correlationId, traceId
    expect(keys).toEqual([...keys].sort());
    expect(keys).toEqual(["actionType", "agentKey", "correlationId", "traceId"]);
  });
});
