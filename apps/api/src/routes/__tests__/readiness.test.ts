import { describe, it, expect } from "vitest";
import { checkReadiness, type ReadinessContext } from "../readiness.js";

/**
 * Returns a fully-passing ReadinessContext. Override individual fields to test
 * specific check failures.
 */
function makeContext(overrides: Partial<ReadinessContext> = {}): ReadinessContext {
  return {
    managedChannels: [
      {
        id: "mc-1",
        channel: "whatsapp",
        status: "active",
        connectionId: "conn-1",
      },
    ],
    connections: [
      {
        id: "conn-1",
        serviceId: "whatsapp",
        credentials: "encrypted-creds",

        status: "connected",
        lastHealthCheck: new Date("2026-04-20T12:00:00Z"),
      },
    ],
    deployment: {
      id: "dep-1",
      status: "active",
      skillSlug: "alex",
      organizationId: "org-1",
      listingId: "listing-1",
    },
    deploymentConnections: [
      {
        id: "dc-1",
        deploymentId: "dep-1",
        type: "whatsapp",
        status: "active",
      },
    ],
    playbook: {
      businessIdentity: { status: "ready" },
      services: { status: "ready", items: [{ name: "Haircut" }] },
      hours: { status: "ready" },
      approvalMode: { status: "ready" },
    },
    scenariosTestedCount: 3,
    metaAdsConnection: {
      exists: true,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
    },
    emailVerified: true,
    calendar: {
      hasGoogleCredentials: false,
      hasGoogleCalendarId: false,
      businessHours: { mon: [{ start: "09:00", end: "17:00" }] },
    },
    ...overrides,
  };
}

describe("checkReadiness", () => {
  it("returns ready: true when all checks pass", () => {
    const report = checkReadiness(makeContext());
    expect(report.ready).toBe(true);
    expect(report.checks.every((c) => c.status === "pass")).toBe(true);
    expect(report.checks).toHaveLength(11);
  });

  // ── email-verified ──────────────────────────────────────────────────────

  it("email-verified fails when email not verified", () => {
    const report = checkReadiness(makeContext({ emailVerified: false }));
    const check = report.checks.find((c) => c.id === "email-verified")!;
    expect(check.status).toBe("fail");
    expect(check.blocking).toBe(true);
    expect(report.ready).toBe(false);
  });

  // ── channel-connected ───────────────────────────────────────────────────

  it("channel-connected fails when no managed channels", () => {
    const report = checkReadiness(makeContext({ managedChannels: [] }));
    const check = report.checks.find((c) => c.id === "channel-connected")!;
    expect(check.status).toBe("fail");
    expect(check.blocking).toBe(true);
    expect(report.ready).toBe(false);
  });

  it("channel-connected fails when connection has no credentials", () => {
    const report = checkReadiness(
      makeContext({
        connections: [
          {
            id: "conn-1",
            serviceId: "whatsapp",
            credentials: null,

            status: "connected",
            lastHealthCheck: new Date(),
          },
        ],
      }),
    );
    const check = report.checks.find((c) => c.id === "channel-connected")!;
    expect(check.status).toBe("fail");
    expect(report.ready).toBe(false);
  });

  it("channel-connected fails when WhatsApp connection never tested (lastHealthCheck null)", () => {
    const report = checkReadiness(
      makeContext({
        connections: [
          {
            id: "conn-1",
            serviceId: "whatsapp",
            credentials: "encrypted-creds",

            status: "connected",
            lastHealthCheck: null,
          },
        ],
      }),
    );
    const check = report.checks.find((c) => c.id === "channel-connected")!;
    expect(check.status).toBe("fail");
    expect(report.ready).toBe(false);
  });

  // ── deployment-exists ─────────────────────────────────────────────────

  it("deployment-exists fails when no deployment (null)", () => {
    const report = checkReadiness(makeContext({ deployment: null }));
    const check = report.checks.find((c) => c.id === "deployment-exists")!;
    expect(check.status).toBe("fail");
    expect(check.blocking).toBe(true);
    expect(report.ready).toBe(false);
  });

  it("deployment-exists fails when deployment has no skillSlug", () => {
    const report = checkReadiness(
      makeContext({
        deployment: {
          id: "dep-1",
          status: "active",
          skillSlug: null,
          organizationId: "org-1",
          listingId: "listing-1",
        },
      }),
    );
    const check = report.checks.find((c) => c.id === "deployment-exists")!;
    expect(check.status).toBe("fail");
  });

  // ── deployment-connection ─────────────────────────────────────────────

  it("deployment-connection fails when connection type doesn't match any active channel", () => {
    const report = checkReadiness(
      makeContext({
        deploymentConnections: [
          {
            id: "dc-1",
            deploymentId: "dep-1",
            type: "telegram",
            status: "active",
          },
        ],
      }),
    );
    const check = report.checks.find((c) => c.id === "deployment-connection")!;
    expect(check.status).toBe("fail");
    expect(check.blocking).toBe(true);
    expect(report.ready).toBe(false);
  });

  it("deployment-connection fails when no deployment connections exist", () => {
    const report = checkReadiness(makeContext({ deploymentConnections: [] }));
    const check = report.checks.find((c) => c.id === "deployment-connection")!;
    expect(check.status).toBe("fail");
  });

  // ── business-identity ─────────────────────────────────────────────────

  it("business-identity fails when playbook identity missing", () => {
    const report = checkReadiness(
      makeContext({
        playbook: {
          services: { status: "ready" },
          hours: { status: "ready" },
          approvalMode: { status: "ready" },
        },
      }),
    );
    const check = report.checks.find((c) => c.id === "business-identity")!;
    expect(check.status).toBe("fail");
    expect(check.blocking).toBe(true);
    expect(report.ready).toBe(false);
  });

  // ── services-defined ──────────────────────────────────────────────────

  it("services-defined fails when no services", () => {
    const report = checkReadiness(
      makeContext({
        playbook: {
          businessIdentity: { status: "ready" },
          hours: { status: "ready" },
          approvalMode: { status: "ready" },
        },
      }),
    );
    const check = report.checks.find((c) => c.id === "services-defined")!;
    expect(check.status).toBe("fail");
    expect(check.blocking).toBe(true);
    expect(report.ready).toBe(false);
  });

  it("services-defined passes when items array has entries even without ready status", () => {
    const report = checkReadiness(
      makeContext({
        playbook: {
          businessIdentity: { status: "ready" },
          services: { status: "draft", items: [{ name: "Haircut" }] },
          hours: { status: "ready" },
          approvalMode: { status: "ready" },
        },
      }),
    );
    const check = report.checks.find((c) => c.id === "services-defined")!;
    expect(check.status).toBe("pass");
  });

  // ── hours-set ─────────────────────────────────────────────────────────

  it("hours-set fails when hours missing", () => {
    const report = checkReadiness(
      makeContext({
        playbook: {
          businessIdentity: { status: "ready" },
          services: { status: "ready" },
          approvalMode: { status: "ready" },
        },
      }),
    );
    const check = report.checks.find((c) => c.id === "hours-set")!;
    expect(check.status).toBe("fail");
    expect(check.blocking).toBe(true);
    expect(report.ready).toBe(false);
  });

  // ── Advisory checks ───────────────────────────────────────────────────

  it("advisory checks do not block readiness", () => {
    const report = checkReadiness(
      makeContext({
        scenariosTestedCount: 0,
        playbook: {
          businessIdentity: { status: "ready" },
          services: { status: "ready" },
          hours: { status: "ready" },
          // approvalMode missing — advisory fail
        },
      }),
    );

    const testScenarios = report.checks.find((c) => c.id === "test-scenarios-run")!;
    const approvalMode = report.checks.find((c) => c.id === "approval-mode-reviewed")!;

    expect(testScenarios.status).toBe("fail");
    expect(testScenarios.blocking).toBe(false);
    expect(approvalMode.status).toBe("fail");
    expect(approvalMode.blocking).toBe(false);

    // All blocking checks pass, so ready should still be true
    expect(report.ready).toBe(true);
  });

  // ── Structure validation ──────────────────────────────────────────────

  it("all checks have correct structure (id, label, status, message, blocking)", () => {
    const report = checkReadiness(makeContext());
    for (const check of report.checks) {
      expect(check).toHaveProperty("id");
      expect(check).toHaveProperty("label");
      expect(check).toHaveProperty("status");
      expect(check).toHaveProperty("message");
      expect(check).toHaveProperty("blocking");
      expect(typeof check.id).toBe("string");
      expect(typeof check.label).toBe("string");
      expect(["pass", "fail"]).toContain(check.status);
      expect(typeof check.message).toBe("string");
      expect(typeof check.blocking).toBe("boolean");
    }

    const ids = report.checks.map((c) => c.id);
    expect(ids).toEqual([
      "email-verified",
      "channel-connected",
      "deployment-exists",
      "deployment-connection",
      "business-identity",
      "services-defined",
      "hours-set",
      "test-scenarios-run",
      "approval-mode-reviewed",
      "meta-ads-token",
      "calendar",
    ]);
  });

  // ── meta-ads-token ─────────────────────────────────────────────────────

  it("meta-ads-token fails (advisory) when not connected", () => {
    const report = checkReadiness(
      makeContext({ metaAdsConnection: { exists: false, expiresAt: null } }),
    );
    const check = report.checks.find((c) => c.id === "meta-ads-token")!;
    expect(check.status).toBe("fail");
    expect(check.blocking).toBe(false);
    expect(check.message).toBe("Meta Ads not connected");
    // Advisory — does not block readiness
    expect(report.ready).toBe(true);
  });

  it("meta-ads-token fails (advisory) when token expired", () => {
    const report = checkReadiness(
      makeContext({
        metaAdsConnection: {
          exists: true,
          expiresAt: new Date(Date.now() - 1000),
        },
      }),
    );
    const check = report.checks.find((c) => c.id === "meta-ads-token")!;
    expect(check.status).toBe("fail");
    expect(check.message).toContain("expired");
    // Advisory — does not block readiness
    expect(report.ready).toBe(true);
  });

  it("meta-ads-token passes with advisory when expiring within 7 days", () => {
    const report = checkReadiness(
      makeContext({
        metaAdsConnection: {
          exists: true,
          expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // 3 days
        },
      }),
    );
    const check = report.checks.find((c) => c.id === "meta-ads-token")!;
    expect(check.status).toBe("pass");
    expect(check.blocking).toBe(false);
    expect(check.message).toContain("expires in");
  });

  it("meta-ads-token passes when token valid", () => {
    const report = checkReadiness(makeContext());
    const check = report.checks.find((c) => c.id === "meta-ads-token")!;
    expect(check.status).toBe("pass");
    expect(check.message).toBe("Meta Ads token is valid");
  });

  // ── calendar (advisory) ─────────────────────────────────────────────────

  it("calendar passes (google) when both Google env vars are present in context", () => {
    const report = checkReadiness(
      makeContext({
        calendar: { hasGoogleCredentials: true, hasGoogleCalendarId: true, businessHours: null },
      }),
    );
    const check = report.checks.find((c) => c.id === "calendar")!;
    expect(check.status).toBe("pass");
    expect(check.blocking).toBe(false);
    expect(check.message).toBe(
      "Google Calendar configuration detected. Bookings should create real calendar events.",
    );
    expect(report.ready).toBe(true);
  });

  it("calendar passes (local) when no Google env and businessHours is an object", () => {
    const report = checkReadiness(
      makeContext({
        calendar: {
          hasGoogleCredentials: false,
          hasGoogleCalendarId: false,
          businessHours: { mon: [{ start: "09:00", end: "17:00" }] },
        },
      }),
    );
    const check = report.checks.find((c) => c.id === "calendar")!;
    expect(check.status).toBe("pass");
    expect(check.blocking).toBe(false);
    expect(check.message).toBe(
      "Local business hours detected. Bookings may not create external calendar events.",
    );
    expect(report.ready).toBe(true);
  });

  it("calendar fails (unconfigured) when no Google env and no businessHours", () => {
    const report = checkReadiness(
      makeContext({
        calendar: {
          hasGoogleCredentials: false,
          hasGoogleCalendarId: false,
          businessHours: null,
        },
      }),
    );
    const check = report.checks.find((c) => c.id === "calendar")!;
    expect(check.status).toBe("fail");
    expect(check.blocking).toBe(false);
    expect(check.message).toBe(
      "Calendar not configured. Booking flows may fall back to stub behavior.",
    );
    // Calendar fail is non-blocking — ready stays true (regression pin).
    expect(report.ready).toBe(true);
  });
});
