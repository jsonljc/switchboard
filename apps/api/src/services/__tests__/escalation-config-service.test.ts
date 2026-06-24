import { describe, it, expect, vi } from "vitest";
import {
  getEscalationConfig,
  getStoredEscalationRecipients,
  resolveEscalationRecipients,
} from "../escalation-config-service.js";

describe("escalation-config-service", () => {
  it("returns per-org config when set", async () => {
    const mockPrisma = {
      organizationConfig: {
        findUnique: vi.fn().mockResolvedValue({
          escalationConfig: {
            emailRecipients: ["owner@acme.com"],
            slaMinutes: 30,
            notifyOnBreach: true,
          },
        }),
      },
    };

    const config = await getEscalationConfig(mockPrisma as never, "org-1");
    expect(config.emailRecipients).toEqual(["owner@acme.com"]);
    expect(config.slaMinutes).toBe(30);
  });

  it("falls back to env vars when per-org config is null", async () => {
    const mockPrisma = {
      organizationConfig: {
        findUnique: vi.fn().mockResolvedValue({ escalationConfig: null }),
      },
    };

    const original = process.env.ESCALATION_EMAIL_RECIPIENTS;
    process.env.ESCALATION_EMAIL_RECIPIENTS = "fallback@test.com,other@test.com";

    try {
      const config = await getEscalationConfig(mockPrisma as never, "org-1");
      expect(config.emailRecipients).toEqual(["fallback@test.com", "other@test.com"]);
    } finally {
      if (original !== undefined) {
        process.env.ESCALATION_EMAIL_RECIPIENTS = original;
      } else {
        delete process.env.ESCALATION_EMAIL_RECIPIENTS;
      }
    }
  });

  it("returns empty recipients when neither per-org nor env var is set", async () => {
    const mockPrisma = {
      organizationConfig: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };

    const original = process.env.ESCALATION_EMAIL_RECIPIENTS;
    delete process.env.ESCALATION_EMAIL_RECIPIENTS;

    try {
      const config = await getEscalationConfig(mockPrisma as never, "org-1");
      expect(config.emailRecipients).toEqual([]);
    } finally {
      if (original !== undefined) {
        process.env.ESCALATION_EMAIL_RECIPIENTS = original;
      }
    }
  });
});

describe("getStoredEscalationRecipients (owner-report-safe, no env fallback)", () => {
  // The leak this guards: the weekly owner-report recipient resolver must never
  // borrow the process-global ESCALATION_EMAIL_RECIPIENTS, or every config-less
  // org would email its private digest to one shared inbox (P1-3). This reader
  // returns ONLY the per-org stored list and is invariant to the env var.

  it("returns the per-org stored recipients", async () => {
    const mockPrisma = {
      organizationConfig: {
        findUnique: vi.fn().mockResolvedValue({
          escalationConfig: { emailRecipients: ["owner@acme.com", "ops@acme.com"] },
        }),
      },
    };

    const recipients = await getStoredEscalationRecipients(mockPrisma as never, "org-1");

    expect(recipients).toEqual(["owner@acme.com", "ops@acme.com"]);
    expect(mockPrisma.organizationConfig.findUnique).toHaveBeenCalledWith({
      where: { id: "org-1" },
      select: { escalationConfig: true },
    });
  });

  it("returns [] for a config-less org even when ESCALATION_EMAIL_RECIPIENTS is set (no env leak)", async () => {
    const mockPrisma = {
      organizationConfig: {
        findUnique: vi.fn().mockResolvedValue({ escalationConfig: null }),
      },
    };

    const original = process.env.ESCALATION_EMAIL_RECIPIENTS;
    process.env.ESCALATION_EMAIL_RECIPIENTS = "leaked@env.test,also-leaked@env.test";

    try {
      const recipients = await getStoredEscalationRecipients(mockPrisma as never, "org-b");
      expect(recipients).toEqual([]);
      expect(recipients).not.toContain("leaked@env.test");
    } finally {
      if (original !== undefined) {
        process.env.ESCALATION_EMAIL_RECIPIENTS = original;
      } else {
        delete process.env.ESCALATION_EMAIL_RECIPIENTS;
      }
    }
  });

  it("returns [] when the org config row is absent, even with env set", async () => {
    const mockPrisma = {
      organizationConfig: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };

    const original = process.env.ESCALATION_EMAIL_RECIPIENTS;
    process.env.ESCALATION_EMAIL_RECIPIENTS = "leaked@env.test";

    try {
      const recipients = await getStoredEscalationRecipients(mockPrisma as never, "org-c");
      expect(recipients).toEqual([]);
    } finally {
      if (original !== undefined) {
        process.env.ESCALATION_EMAIL_RECIPIENTS = original;
      } else {
        delete process.env.ESCALATION_EMAIL_RECIPIENTS;
      }
    }
  });

  it("returns [] when stored emailRecipients is not an array", async () => {
    const mockPrisma = {
      organizationConfig: {
        findUnique: vi.fn().mockResolvedValue({
          escalationConfig: { emailRecipients: "owner@acme.com" },
        }),
      },
    };

    const recipients = await getStoredEscalationRecipients(mockPrisma as never, "org-d");

    expect(recipients).toEqual([]);
  });
});

describe("resolveEscalationRecipients (per-org handoff routing, no env fallback)", () => {
  // Mirrors the A17 owner-report isolation: a handoff (carrying leadSnapshot PII)
  // must route to the escalating org's OWN recipients, never a shared global list.

  it("returns the org's stored escalation recipients when present", async () => {
    const recipients = await resolveEscalationRecipients(
      {
        getStoredRecipients: async () => ["ops@acme.com"],
        listVerifiedUserEmails: async () => ["should-not@be-used.com"],
      },
      "org-1",
    );
    expect(recipients).toEqual(["ops@acme.com"]);
  });

  it("falls back to the org's OWN verified dashboard users when no stored recipients", async () => {
    const recipients = await resolveEscalationRecipients(
      {
        getStoredRecipients: async () => [],
        listVerifiedUserEmails: async (orgId) => [`owner@${orgId}.test`],
      },
      "org-2",
    );
    expect(recipients).toEqual(["owner@org-2.test"]);
  });

  it("resolves both deps against the SAME orgId (no cross-tenant read)", async () => {
    const getStoredRecipients = vi.fn().mockResolvedValue([]);
    const listVerifiedUserEmails = vi.fn().mockResolvedValue([]);
    await resolveEscalationRecipients({ getStoredRecipients, listVerifiedUserEmails }, "org-3");
    expect(getStoredRecipients).toHaveBeenCalledWith("org-3");
    expect(listVerifiedUserEmails).toHaveBeenCalledWith("org-3");
  });
});
