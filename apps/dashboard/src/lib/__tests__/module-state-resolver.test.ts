import { describe, it, expect } from "vitest";
import { resolveModuleStatuses } from "../module-state-resolver";
import type { ResolverInput } from "../module-state-resolver";

function makeInput(overrides: Partial<ResolverInput> = {}): ResolverInput {
  return {
    deployments: [],
    connections: [],
    orgConfig: { businessHours: null },
    creativeJobCount: 0,
    auditCount: 0,
    platformConfig: { hasAnthropicKey: true },
    ...overrides,
  };
}

describe("resolveModuleStatuses", () => {
  it("returns not_setup for all modules when no deployments exist", () => {
    const result = resolveModuleStatuses(makeInput());
    expect(result).toHaveLength(3);
    expect(result[0].id).toBe("lead-to-booking");
    expect(result[0].state).toBe("not_setup");
    expect(result[0].cta.label).toBe("Enable");
    expect(result[1].id).toBe("creative");
    expect(result[1].state).toBe("not_setup");
    expect(result[2].id).toBe("ad-optimizer");
    expect(result[2].state).toBe("not_setup");
  });

  it("returns live for lead-to-booking when calendar + business hours + active", () => {
    const result = resolveModuleStatuses(
      makeInput({
        deployments: [
          { id: "d1", moduleType: "lead-to-booking", status: "active", inputConfig: {} },
        ],
        connections: [{ deploymentId: "d1", type: "google_calendar", status: "active" }],
        orgConfig: {
          businessHours: {
            timezone: "Asia/Singapore",
            days: [{ day: 1, open: "09:00", close: "17:00" }],
          },
        },
      }),
    );
    expect(result[0].state).toBe("live");
    expect(result[0].metric).toBeDefined();
  });

  it("returns connection_broken when calendar connection is expired", () => {
    const result = resolveModuleStatuses(
      makeInput({
        deployments: [
          { id: "d1", moduleType: "lead-to-booking", status: "active", inputConfig: {} },
        ],
        connections: [{ deploymentId: "d1", type: "google_calendar", status: "expired" }],
        orgConfig: {
          businessHours: {
            timezone: "Asia/Singapore",
            days: [{ day: 1, open: "09:00", close: "17:00" }],
          },
        },
      }),
    );
    expect(result[0].state).toBe("connection_broken");
    expect(result[0].cta.label).toBe("Fix");
  });

  it("returns needs_connection for creative when platform key missing", () => {
    const result = resolveModuleStatuses(
      makeInput({
        deployments: [{ id: "d2", moduleType: "creative", status: "active", inputConfig: {} }],
        platformConfig: { hasAnthropicKey: false },
      }),
    );
    expect(result[1].state).toBe("needs_connection");
    expect(result[1].isPlatformBlocking).toBe(true);
  });

  it("returns partial_setup for creative when no jobs submitted", () => {
    const result = resolveModuleStatuses(
      makeInput({
        deployments: [{ id: "d2", moduleType: "creative", status: "active", inputConfig: {} }],
        creativeJobCount: 0,
      }),
    );
    expect(result[1].state).toBe("partial_setup");
  });

  it("returns live for creative when deployment active and jobs exist", () => {
    const result = resolveModuleStatuses(
      makeInput({
        deployments: [{ id: "d2", moduleType: "creative", status: "active", inputConfig: {} }],
        creativeJobCount: 3,
      }),
    );
    expect(result[1].state).toBe("live");
  });

  it("returns needs_connection for ad-optimizer when no credentials", () => {
    const result = resolveModuleStatuses(
      makeInput({
        deployments: [{ id: "d3", moduleType: "ad-optimizer", status: "active", inputConfig: {} }],
        connections: [],
      }),
    );
    expect(result[2].state).toBe("needs_connection");
  });

  it("returns partial_setup for ad-optimizer when token exists but no accountId", () => {
    const result = resolveModuleStatuses(
      makeInput({
        deployments: [{ id: "d3", moduleType: "ad-optimizer", status: "active", inputConfig: {} }],
        connections: [{ deploymentId: "d3", type: "meta_ads", status: "active" }],
      }),
    );
    expect(result[2].state).toBe("partial_setup");
  });

  it("returns connection_broken for ad-optimizer when token expired", () => {
    const result = resolveModuleStatuses(
      makeInput({
        deployments: [
          {
            id: "d3",
            moduleType: "ad-optimizer",
            status: "active",
            inputConfig: { accountId: "act_123", targetCPA: 100 },
          },
        ],
        connections: [{ deploymentId: "d3", type: "meta_ads", status: "expired" }],
        auditCount: 1,
      }),
    );
    expect(result[2].state).toBe("connection_broken");
  });

  it("connection_broken overrides live state", () => {
    const result = resolveModuleStatuses(
      makeInput({
        deployments: [
          {
            id: "d3",
            moduleType: "ad-optimizer",
            status: "active",
            inputConfig: { accountId: "act_123", targetCPA: 100, targetROAS: 3 },
          },
        ],
        connections: [{ deploymentId: "d3", type: "meta_ads", status: "revoked" }],
        auditCount: 5,
      }),
    );
    expect(result[2].state).toBe("connection_broken");
  });

  it("returns live for lead-to-booking in local scheduling mode without calendar", () => {
    const result = resolveModuleStatuses(
      makeInput({
        deployments: [
          {
            id: "d1",
            moduleType: "lead-to-booking",
            status: "active",
            inputConfig: { schedulingMode: "local" },
          },
        ],
        orgConfig: {
          businessHours: {
            timezone: "Asia/Singapore",
            days: [{ day: 1, open: "09:00", close: "17:00" }],
          },
        },
      }),
    );
    expect(result[0].state).toBe("live");
    expect(result[0].subtext).toBe("Not connected — bookings saved locally");
  });

  it("returns needs_connection for lead-to-booking in google mode without calendar", () => {
    const result = resolveModuleStatuses(
      makeInput({
        deployments: [
          {
            id: "d1",
            moduleType: "lead-to-booking",
            status: "active",
            inputConfig: { schedulingMode: "google" },
          },
        ],
      }),
    );
    expect(result[0].state).toBe("needs_connection");
  });

  it("returns partial_setup for ad-optimizer when config complete but no audits", () => {
    const result = resolveModuleStatuses(
      makeInput({
        deployments: [
          {
            id: "d3",
            moduleType: "ad-optimizer",
            status: "active",
            inputConfig: { accountId: "act_123", targetCPA: 100, targetROAS: 3 },
          },
        ],
        connections: [{ deploymentId: "d3", type: "meta_ads", status: "active" }],
        auditCount: 0,
      }),
    );
    expect(result[2].state).toBe("partial_setup");
    expect(result[2].subtext).toContain("audit");
  });

  it("includes step param in CTA href for needs_connection state", () => {
    const result = resolveModuleStatuses(
      makeInput({
        deployments: [{ id: "d3", moduleType: "ad-optimizer", status: "active", inputConfig: {} }],
      }),
    );
    expect(result[2].cta.href).toContain("?step=connect-meta");
  });

  it("metric is only populated when state is live", () => {
    const result = resolveModuleStatuses(makeInput());
    for (const mod of result) {
      if (mod.state !== "live") {
        expect(mod.metric).toBeUndefined();
      }
    }
  });
});
