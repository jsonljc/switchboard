import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryTriggerStore } from "./in-memory-trigger-store.js";
import { listTriggersForBrowse, InvalidCursorError } from "../list-triggers.js";
import type { ScheduledTrigger } from "@switchboard/schemas";

const ORG = "org-test";
const OTHER = "org-other";

function trigger(
  overrides: Partial<ScheduledTrigger> & { id: string; createdAt: Date },
): ScheduledTrigger {
  const defaults: ScheduledTrigger = {
    id: overrides.id,
    organizationId: ORG,
    type: "cron",
    fireAt: null,
    cronExpression: "0 7 * * *",
    eventPattern: null,
    action: { type: "spawn_workflow", payload: {} },
    sourceWorkflowId: null,
    status: "active",
    createdAt: overrides.createdAt,
    expiresAt: null,
  };
  return { ...defaults, ...overrides };
}

describe("listTriggersForBrowse", () => {
  let store: InMemoryTriggerStore;

  beforeEach(() => {
    store = new InMemoryTriggerStore();
  });

  it("default sort is createdAt DESC", async () => {
    await store.save(trigger({ id: "t1", createdAt: new Date("2026-05-01T00:00:00Z") }));
    await store.save(trigger({ id: "t2", createdAt: new Date("2026-05-03T00:00:00Z") }));
    await store.save(trigger({ id: "t3", createdAt: new Date("2026-05-02T00:00:00Z") }));

    const res = await listTriggersForBrowse(
      { orgId: ORG, query: { sort: "createdAt", direction: "desc", limit: 50 } },
      { triggerStore: store },
    );

    expect(res.rows.map((r) => r.id)).toEqual(["t2", "t3", "t1"]);
  });

  it("status filter applies before pagination", async () => {
    await store.save(trigger({ id: "a", status: "active", createdAt: new Date("2026-05-01") }));
    await store.save(trigger({ id: "f", status: "fired", createdAt: new Date("2026-05-02") }));
    await store.save(trigger({ id: "c", status: "cancelled", createdAt: new Date("2026-05-03") }));

    const res = await listTriggersForBrowse(
      {
        orgId: ORG,
        query: { status: "active", sort: "createdAt", direction: "desc", limit: 50 },
      },
      { triggerStore: store },
    );

    expect(res.rows.map((r) => r.id)).toEqual(["a"]);
  });

  it("cursor round-trip yields the next page", async () => {
    for (let i = 0; i < 5; i++) {
      await store.save(
        trigger({ id: `t${i}`, createdAt: new Date(`2026-05-${String(i + 1).padStart(2, "0")}`) }),
      );
    }

    const page1 = await listTriggersForBrowse(
      { orgId: ORG, query: { sort: "createdAt", direction: "desc", limit: 2 } },
      { triggerStore: store },
    );
    expect(page1.rows).toHaveLength(2);
    expect(page1.hasMore).toBe(true);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await listTriggersForBrowse(
      {
        orgId: ORG,
        query: {
          sort: "createdAt",
          direction: "desc",
          limit: 2,
          cursor: page1.nextCursor!,
        },
      },
      { triggerStore: store },
    );
    expect(page2.rows).toHaveLength(2);
    expect(page2.hasMore).toBe(true);

    const page3 = await listTriggersForBrowse(
      {
        orgId: ORG,
        query: {
          sort: "createdAt",
          direction: "desc",
          limit: 2,
          cursor: page2.nextCursor!,
        },
      },
      { triggerStore: store },
    );
    expect(page3.rows).toHaveLength(1);
    expect(page3.hasMore).toBe(false);
    expect(page3.nextCursor).toBeNull();
  });

  it("hasMore reflects fetch-count > limit", async () => {
    await store.save(trigger({ id: "t1", createdAt: new Date("2026-05-01") }));
    const res = await listTriggersForBrowse(
      { orgId: ORG, query: { sort: "createdAt", direction: "desc", limit: 1 } },
      { triggerStore: store },
    );
    expect(res.rows).toHaveLength(1);
    expect(res.hasMore).toBe(false);
    expect(res.nextCursor).toBeNull();
  });

  it("scheduleLabel uses cron expression for cron triggers", async () => {
    await store.save(
      trigger({
        id: "c",
        type: "cron",
        cronExpression: "*/15 * * * *",
        fireAt: null,
        createdAt: new Date("2026-05-01"),
      }),
    );
    const res = await listTriggersForBrowse(
      { orgId: ORG, query: { sort: "createdAt", direction: "desc", limit: 50 } },
      { triggerStore: store },
    );
    expect(res.rows[0]?.scheduleLabel).toBe("*/15 * * * *");
  });

  it("scheduleLabel uses ISO for timer triggers", async () => {
    await store.save(
      trigger({
        id: "t",
        type: "timer",
        fireAt: new Date("2026-05-12T18:00:00Z"),
        cronExpression: null,
        createdAt: new Date("2026-05-01"),
      }),
    );
    const res = await listTriggersForBrowse(
      { orgId: ORG, query: { sort: "createdAt", direction: "desc", limit: 50 } },
      { triggerStore: store },
    );
    expect(res.rows[0]?.scheduleLabel).toBe("2026-05-12T18:00:00.000Z");
  });

  it("scheduleLabel uses event:<type> for event_match triggers", async () => {
    await store.save(
      trigger({
        id: "e",
        type: "event_match",
        cronExpression: null,
        fireAt: null,
        eventPattern: { type: "lead.captured", filters: { source: "ad" } },
        createdAt: new Date("2026-05-01"),
      }),
    );
    const res = await listTriggersForBrowse(
      { orgId: ORG, query: { sort: "createdAt", direction: "desc", limit: 50 } },
      { triggerStore: store },
    );
    expect(res.rows[0]?.scheduleLabel).toBe("event:lead.captured");
  });

  it("scheduleLabel falls back gracefully on malformed legacy rows", async () => {
    await store.save(
      trigger({
        id: "bad-cron",
        type: "cron",
        cronExpression: null,
        fireAt: null,
        createdAt: new Date("2026-05-01"),
      }),
    );
    await store.save(
      trigger({
        id: "bad-timer",
        type: "timer",
        cronExpression: null,
        fireAt: null,
        createdAt: new Date("2026-05-02"),
      }),
    );
    await store.save(
      trigger({
        id: "bad-event",
        type: "event_match",
        cronExpression: null,
        fireAt: null,
        eventPattern: null,
        createdAt: new Date("2026-05-03"),
      }),
    );

    const res = await listTriggersForBrowse(
      { orgId: ORG, query: { sort: "createdAt", direction: "asc", limit: 50 } },
      { triggerStore: store },
    );
    const labels = Object.fromEntries(res.rows.map((r) => [r.id, r.scheduleLabel]));
    expect(labels["bad-cron"]).toBe("cron:unknown");
    expect(labels["bad-timer"]).toBe("timer:unknown");
    expect(labels["bad-event"]).toBe("event:unknown");
  });

  it("eventPatternSummary lists pattern type + filter key names", async () => {
    await store.save(
      trigger({
        id: "e",
        type: "event_match",
        cronExpression: null,
        fireAt: null,
        eventPattern: { type: "lead.captured", filters: { source: "ad", contactId: "x" } },
        createdAt: new Date("2026-05-01"),
      }),
    );
    const res = await listTriggersForBrowse(
      { orgId: ORG, query: { sort: "createdAt", direction: "desc", limit: 50 } },
      { triggerStore: store },
    );
    expect(res.rows[0]?.drawer.eventPatternSummary).toBe(
      "lead.captured (filters: source, contactId)",
    );
  });

  it("eventPatternSummary is null for non-event_match rows", async () => {
    await store.save(trigger({ id: "c", createdAt: new Date("2026-05-01") }));
    const res = await listTriggersForBrowse(
      { orgId: ORG, query: { sort: "createdAt", direction: "desc", limit: 50 } },
      { triggerStore: store },
    );
    expect(res.rows[0]?.drawer.eventPatternSummary).toBeNull();
  });

  it("VALUE redaction: payload values never appear in the projection", async () => {
    await store.save(
      trigger({
        id: "redact",
        action: {
          type: "spawn_workflow",
          payload: { sentinel: "REDACTION_PROBE_X9", workflowId: "wf-abc" },
        },
        createdAt: new Date("2026-05-01"),
      }),
    );
    const res = await listTriggersForBrowse(
      { orgId: ORG, query: { sort: "createdAt", direction: "desc", limit: 50 } },
      { triggerStore: store },
    );
    const json = JSON.stringify(res);
    expect(json).not.toContain("REDACTION_PROBE_X9");
    expect(json).not.toContain('"sentinel"');
    expect(json).toContain("workflowId");
  });

  it("KEY allowlist: non-allowlisted keys are counted, not exposed", async () => {
    await store.save(
      trigger({
        id: "allowlist",
        action: {
          type: "spawn_workflow",
          payload: {
            stripeCustomerId: "cus_x",
            contactId: "c-1",
            workflowId: "wf-y",
          },
        },
        createdAt: new Date("2026-05-01"),
      }),
    );
    const res = await listTriggersForBrowse(
      { orgId: ORG, query: { sort: "createdAt", direction: "desc", limit: 50 } },
      { triggerStore: store },
    );
    const drawer = res.rows[0]!.drawer;
    expect(drawer.visibleActionPayloadKeys.sort()).toEqual(["contactId", "workflowId"]);
    expect(drawer.redactedKeyCount).toBe(1);
  });

  it("statusCounts span the full org regardless of filter", async () => {
    await store.save(trigger({ id: "a1", status: "active", createdAt: new Date("2026-05-01") }));
    await store.save(trigger({ id: "a2", status: "active", createdAt: new Date("2026-05-02") }));
    await store.save(trigger({ id: "f1", status: "fired", createdAt: new Date("2026-05-03") }));
    await store.save(trigger({ id: "c1", status: "cancelled", createdAt: new Date("2026-05-04") }));
    await store.save(trigger({ id: "e1", status: "expired", createdAt: new Date("2026-05-05") }));

    const res = await listTriggersForBrowse(
      {
        orgId: ORG,
        query: { status: "active", sort: "createdAt", direction: "desc", limit: 50 },
      },
      { triggerStore: store },
    );
    expect(res.rows.map((r) => r.id).sort()).toEqual(["a1", "a2"]);
    expect(res.statusCounts).toEqual({ all: 5, active: 2, fired: 1, cancelled: 1, expired: 1 });
  });

  it("empty result returns zeroed counts and null cursor", async () => {
    const res = await listTriggersForBrowse(
      { orgId: ORG, query: { sort: "createdAt", direction: "desc", limit: 50 } },
      { triggerStore: store },
    );
    expect(res.rows).toEqual([]);
    expect(res.statusCounts).toEqual({ all: 0, active: 0, fired: 0, cancelled: 0, expired: 0 });
    expect(res.nextCursor).toBeNull();
    expect(res.hasMore).toBe(false);
  });

  it("org-scoping: rows in another org never appear and never count", async () => {
    await store.save(trigger({ id: "mine", createdAt: new Date("2026-05-01") }));
    await store.save(
      trigger({ id: "theirs", organizationId: OTHER, createdAt: new Date("2026-05-02") }),
    );
    const res = await listTriggersForBrowse(
      { orgId: ORG, query: { sort: "createdAt", direction: "desc", limit: 50 } },
      { triggerStore: store },
    );
    expect(res.rows.map((r) => r.id)).toEqual(["mine"]);
    expect(res.statusCounts.all).toBe(1);
  });

  it("invalid cursor throws InvalidCursorError", async () => {
    await expect(
      listTriggersForBrowse(
        {
          orgId: ORG,
          query: {
            sort: "createdAt",
            direction: "desc",
            limit: 50,
            cursor: "not-base64-json",
          },
        },
        { triggerStore: store },
      ),
    ).rejects.toBeInstanceOf(InvalidCursorError);
  });
});
