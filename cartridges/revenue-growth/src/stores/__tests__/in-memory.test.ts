// ---------------------------------------------------------------------------
// In-Memory Store Tests
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import {
  InMemoryInterventionStore,
  InMemoryDiagnosticCycleStore,
  InMemoryRevenueAccountStore,
  InMemoryWeeklyDigestStore,
} from "../in-memory.js";
import type { Intervention } from "@switchboard/schemas";
import type { DiagnosticCycleRecord, RevenueAccountRecord, WeeklyDigestRecord } from "../interfaces.js";

function makeIntervention(overrides: Partial<Intervention> = {}): Intervention {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    cycleId: "cycle_1",
    constraintType: "SIGNAL",
    actionType: "FIX_TRACKING",
    status: "PROPOSED",
    priority: 1,
    estimatedImpact: "HIGH",
    reasoning: "Test reason",
    artifacts: [],
    outcomeStatus: "PENDING",
    measurementWindowDays: 7,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeCycle(overrides: Partial<DiagnosticCycleRecord> = {}): DiagnosticCycleRecord {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    accountId: "acc_1",
    organizationId: "org_1",
    dataTier: "FULL",
    scorerOutputs: [],
    constraints: [],
    primaryConstraint: "SIGNAL",
    previousPrimaryConstraint: null,
    constraintTransition: false,
    interventions: [],
    startedAt: now,
    completedAt: now,
    ...overrides,
  };
}

function makeAccount(overrides: Partial<RevenueAccountRecord> = {}): RevenueAccountRecord {
  const now = new Date().toISOString();
  return {
    organizationId: "org_1",
    accountId: "acc_1",
    active: true,
    cadenceMinutes: 60,
    nextCycleAt: now,
    lastCycleId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeDigest(overrides: Partial<WeeklyDigestRecord> = {}): WeeklyDigestRecord {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    accountId: "acc_1",
    organizationId: "org_1",
    weekStartDate: "2026-03-09",
    headline: "Test headline",
    summary: "Test summary",
    constraintHistory: ["SIGNAL"],
    interventionOutcomes: [],
    createdAt: now,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// InMemoryInterventionStore
// ---------------------------------------------------------------------------

describe("InMemoryInterventionStore", () => {
  let store: InMemoryInterventionStore;

  beforeEach(() => {
    store = new InMemoryInterventionStore();
  });

  it("saves and retrieves by id", async () => {
    const intervention = makeIntervention();
    await store.save(intervention);
    const result = await store.getById(intervention.id);
    expect(result).not.toBeNull();
    expect(result!.id).toBe(intervention.id);
  });

  it("returns null for missing id", async () => {
    expect(await store.getById("nonexistent")).toBeNull();
  });

  it("lists by cycle", async () => {
    await store.save(makeIntervention({ cycleId: "c1" }));
    await store.save(makeIntervention({ cycleId: "c1" }));
    await store.save(makeIntervention({ cycleId: "c2" }));

    const results = await store.listByCycle("c1");
    expect(results).toHaveLength(2);
  });

  it("lists by account with status filter", async () => {
    await store.save(makeIntervention({ status: "PROPOSED" }));
    await store.save(makeIntervention({ status: "APPROVED" }));
    await store.save(makeIntervention({ status: "PROPOSED" }));

    const proposed = await store.listByAccount("acc_1", { status: "PROPOSED" });
    expect(proposed).toHaveLength(2);

    const approved = await store.listByAccount("acc_1", { status: "APPROVED" });
    expect(approved).toHaveLength(1);
  });

  it("lists by account with limit", async () => {
    await store.save(makeIntervention());
    await store.save(makeIntervention());
    await store.save(makeIntervention());

    const results = await store.listByAccount("acc_1", { limit: 2 });
    expect(results).toHaveLength(2);
  });

  it("lists pending outcomes", async () => {
    await store.save(
      makeIntervention({
        outcomeStatus: "PENDING",
        measurementStartedAt: new Date().toISOString(),
      }),
    );
    await store.save(makeIntervention({ outcomeStatus: "PENDING" })); // no measurementStartedAt
    await store.save(
      makeIntervention({
        outcomeStatus: "IMPROVED",
        measurementStartedAt: new Date().toISOString(),
      }),
    );

    const results = await store.listPendingOutcomes();
    expect(results).toHaveLength(1);
  });

  it("updates status", async () => {
    const intervention = makeIntervention();
    await store.save(intervention);
    await store.updateStatus(intervention.id, "APPROVED");
    const result = await store.getById(intervention.id);
    expect(result!.status).toBe("APPROVED");
  });

  it("updates outcome", async () => {
    const intervention = makeIntervention();
    await store.save(intervention);
    await store.updateOutcome(intervention.id, "IMPROVED");
    const result = await store.getById(intervention.id);
    expect(result!.outcomeStatus).toBe("IMPROVED");
  });
});

// ---------------------------------------------------------------------------
// InMemoryDiagnosticCycleStore
// ---------------------------------------------------------------------------

describe("InMemoryDiagnosticCycleStore", () => {
  let store: InMemoryDiagnosticCycleStore;

  beforeEach(() => {
    store = new InMemoryDiagnosticCycleStore();
  });

  it("saves and retrieves latest", async () => {
    const older = makeCycle({ completedAt: "2026-03-01T00:00:00.000Z" });
    const newer = makeCycle({ completedAt: "2026-03-05T00:00:00.000Z" });
    await store.save(older);
    await store.save(newer);

    const latest = await store.getLatest("acc_1");
    expect(latest).not.toBeNull();
    expect(latest!.id).toBe(newer.id);
  });

  it("returns null when no cycles exist", async () => {
    expect(await store.getLatest("nonexistent")).toBeNull();
  });

  it("lists by account with limit", async () => {
    await store.save(makeCycle({ completedAt: "2026-03-01T00:00:00.000Z" }));
    await store.save(makeCycle({ completedAt: "2026-03-02T00:00:00.000Z" }));
    await store.save(makeCycle({ completedAt: "2026-03-03T00:00:00.000Z" }));

    const results = await store.listByAccount("acc_1", 2);
    expect(results).toHaveLength(2);
    // Most recent first
    expect(results[0]!.completedAt! > results[1]!.completedAt!).toBe(true);
  });

  it("lists all by account without limit", async () => {
    await store.save(makeCycle());
    await store.save(makeCycle());
    const results = await store.listByAccount("acc_1");
    expect(results).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// InMemoryRevenueAccountStore
// ---------------------------------------------------------------------------

describe("InMemoryRevenueAccountStore", () => {
  let store: InMemoryRevenueAccountStore;

  beforeEach(() => {
    store = new InMemoryRevenueAccountStore();
  });

  it("upserts and retrieves", async () => {
    const account = makeAccount();
    await store.upsert(account);
    const result = await store.getByAccountId("org_1", "acc_1");
    expect(result).not.toBeNull();
    expect(result!.accountId).toBe("acc_1");
  });

  it("returns null for missing account", async () => {
    expect(await store.getByAccountId("org_x", "acc_x")).toBeNull();
  });

  it("lists due accounts", async () => {
    const pastDue = makeAccount({
      nextCycleAt: new Date(Date.now() - 1000).toISOString(),
      active: true,
    });
    const future = makeAccount({
      accountId: "acc_2",
      nextCycleAt: new Date(Date.now() + 100_000).toISOString(),
      active: true,
    });
    const inactive = makeAccount({
      accountId: "acc_3",
      nextCycleAt: new Date(Date.now() - 1000).toISOString(),
      active: false,
    });

    await store.upsert(pastDue);
    await store.upsert(future);
    await store.upsert(inactive);

    const due = await store.listDue();
    expect(due).toHaveLength(1);
    expect(due[0]!.accountId).toBe("acc_1");
  });

  it("upserts overwrites existing", async () => {
    await store.upsert(makeAccount({ cadenceMinutes: 60 }));
    await store.upsert(makeAccount({ cadenceMinutes: 120 }));

    const result = await store.getByAccountId("org_1", "acc_1");
    expect(result!.cadenceMinutes).toBe(120);
  });
});

// ---------------------------------------------------------------------------
// InMemoryWeeklyDigestStore
// ---------------------------------------------------------------------------

describe("InMemoryWeeklyDigestStore", () => {
  let store: InMemoryWeeklyDigestStore;

  beforeEach(() => {
    store = new InMemoryWeeklyDigestStore();
  });

  it("saves and retrieves latest", async () => {
    const older = makeDigest({ createdAt: "2026-03-01T00:00:00.000Z" });
    const newer = makeDigest({ createdAt: "2026-03-08T00:00:00.000Z" });
    await store.save(older);
    await store.save(newer);

    const latest = await store.getLatest("acc_1");
    expect(latest).not.toBeNull();
    expect(latest!.id).toBe(newer.id);
  });

  it("returns null when no digests exist", async () => {
    expect(await store.getLatest("nonexistent")).toBeNull();
  });

  it("lists by account with limit", async () => {
    await store.save(makeDigest({ createdAt: "2026-03-01T00:00:00.000Z" }));
    await store.save(makeDigest({ createdAt: "2026-03-02T00:00:00.000Z" }));
    await store.save(makeDigest({ createdAt: "2026-03-03T00:00:00.000Z" }));

    const results = await store.listByAccount("acc_1", 2);
    expect(results).toHaveLength(2);
  });

  it("lists all without limit", async () => {
    await store.save(makeDigest());
    await store.save(makeDigest());
    const results = await store.listByAccount("acc_1");
    expect(results).toHaveLength(2);
  });
});
