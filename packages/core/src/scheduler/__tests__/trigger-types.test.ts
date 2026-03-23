import { describe, it, expect } from "vitest";
import type { ScheduledTrigger, TriggerStatus } from "@switchboard/schemas";
import {
  canTriggerTransition,
  validateTriggerTransition,
  TriggerTransitionError,
  isTerminalTriggerStatus,
  filterMatchingTriggers,
  VALID_TRIGGER_TRANSITIONS,
} from "../trigger-types.js";

describe("canTriggerTransition", () => {
  it.each([
    ["active", "fired"],
    ["active", "cancelled"],
    ["active", "expired"],
  ] as [TriggerStatus, TriggerStatus][])("allows %s -> %s", (from, to) => {
    expect(canTriggerTransition(from, to)).toBe(true);
  });

  it.each([
    ["fired", "active"],
    ["fired", "cancelled"],
    ["cancelled", "active"],
    ["cancelled", "fired"],
    ["expired", "active"],
    ["expired", "fired"],
    ["active", "active"],
  ] as [TriggerStatus, TriggerStatus][])("rejects %s -> %s", (from, to) => {
    expect(canTriggerTransition(from, to)).toBe(false);
  });
});

describe("validateTriggerTransition", () => {
  it("does not throw for valid transitions", () => {
    expect(() => validateTriggerTransition("active", "fired")).not.toThrow();
  });

  it("throws TriggerTransitionError for invalid transitions", () => {
    expect(() => validateTriggerTransition("fired", "active")).toThrow(TriggerTransitionError);
  });

  it("includes from/to in error", () => {
    try {
      validateTriggerTransition("cancelled", "active");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(TriggerTransitionError);
      const e = err as TriggerTransitionError;
      expect(e.from).toBe("cancelled");
      expect(e.to).toBe("active");
      expect(e.message).toBe("Invalid trigger transition: cancelled -> active");
      expect(e.name).toBe("TriggerTransitionError");
    }
  });
});

describe("isTerminalTriggerStatus", () => {
  it("returns false for active", () => {
    expect(isTerminalTriggerStatus("active")).toBe(false);
  });

  it.each(["fired", "cancelled", "expired"] as TriggerStatus[])("returns true for %s", (status) => {
    expect(isTerminalTriggerStatus(status)).toBe(true);
  });
});

describe("VALID_TRIGGER_TRANSITIONS", () => {
  it("has entries for all statuses", () => {
    const statuses: TriggerStatus[] = ["active", "fired", "cancelled", "expired"];
    for (const s of statuses) {
      expect(VALID_TRIGGER_TRANSITIONS).toHaveProperty(s);
    }
  });

  it("active can transition to fired, cancelled, expired", () => {
    expect(VALID_TRIGGER_TRANSITIONS.active).toEqual(["fired", "cancelled", "expired"]);
  });

  it("terminal states have empty transition arrays", () => {
    expect(VALID_TRIGGER_TRANSITIONS.fired).toEqual([]);
    expect(VALID_TRIGGER_TRANSITIONS.cancelled).toEqual([]);
    expect(VALID_TRIGGER_TRANSITIONS.expired).toEqual([]);
  });
});

describe("filterMatchingTriggers", () => {
  function makeTrigger(
    overrides: Partial<ScheduledTrigger> & { eventPattern: ScheduledTrigger["eventPattern"] },
  ): ScheduledTrigger {
    return {
      id: "trig-1",
      organizationId: "org-1",
      type: "event_match",
      status: "active",
      action: { type: "spawn_workflow", payload: {} },
      fireAt: null,
      cronExpression: null,
      sourceWorkflowId: null,
      createdAt: new Date(),
      expiresAt: null,
      ...overrides,
    };
  }

  it("returns triggers matching event type and filters", () => {
    const triggers = [
      makeTrigger({ eventPattern: { type: "lead.created", filters: { source: "web" } } }),
    ];
    const result = filterMatchingTriggers(triggers, "lead.created", { source: "web" });
    expect(result).toHaveLength(1);
  });

  it("excludes triggers with non-matching event type", () => {
    const triggers = [makeTrigger({ eventPattern: { type: "lead.created", filters: {} } })];
    const result = filterMatchingTriggers(triggers, "deal.closed", {});
    expect(result).toHaveLength(0);
  });

  it("excludes triggers with non-matching filter values", () => {
    const triggers = [
      makeTrigger({ eventPattern: { type: "lead.created", filters: { source: "web" } } }),
    ];
    const result = filterMatchingTriggers(triggers, "lead.created", { source: "api" });
    expect(result).toHaveLength(0);
  });

  it("excludes triggers with missing filter keys in event data", () => {
    const triggers = [
      makeTrigger({ eventPattern: { type: "lead.created", filters: { source: "web" } } }),
    ];
    const result = filterMatchingTriggers(triggers, "lead.created", {});
    expect(result).toHaveLength(0);
  });

  it("matches triggers with empty filters against any event data", () => {
    const triggers = [makeTrigger({ eventPattern: { type: "lead.created", filters: {} } })];
    const result = filterMatchingTriggers(triggers, "lead.created", { source: "web", foo: "bar" });
    expect(result).toHaveLength(1);
  });

  it("excludes triggers with null eventPattern", () => {
    const triggers = [makeTrigger({ eventPattern: null })];
    const result = filterMatchingTriggers(triggers, "lead.created", {});
    expect(result).toHaveLength(0);
  });

  it("filters correctly with multiple candidates", () => {
    const triggers = [
      makeTrigger({
        id: "t1",
        eventPattern: { type: "lead.created", filters: { source: "web" } },
      }),
      makeTrigger({
        id: "t2",
        eventPattern: { type: "lead.created", filters: { source: "api" } },
      }),
      makeTrigger({
        id: "t3",
        eventPattern: { type: "deal.closed", filters: {} },
      }),
    ];
    const result = filterMatchingTriggers(triggers, "lead.created", { source: "web" });
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("t1");
  });

  it("returns empty array for empty candidates", () => {
    expect(filterMatchingTriggers([], "lead.created", {})).toEqual([]);
  });

  it("matches multiple filter keys", () => {
    const triggers = [
      makeTrigger({
        eventPattern: { type: "ad.alert", filters: { platform: "meta", severity: "high" } },
      }),
    ];
    expect(
      filterMatchingTriggers(triggers, "ad.alert", { platform: "meta", severity: "high" }),
    ).toHaveLength(1);
    expect(
      filterMatchingTriggers(triggers, "ad.alert", { platform: "meta", severity: "low" }),
    ).toHaveLength(0);
  });
});
