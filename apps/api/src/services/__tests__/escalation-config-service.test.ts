import { describe, it, expect, vi } from "vitest";
import { getEscalationConfig } from "../escalation-config-service.js";

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
