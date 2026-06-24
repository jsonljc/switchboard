import { describe, it, expect, vi } from "vitest";
import { resolveOwnerReportRecipients } from "./weekly-report-recipients.js";
import { getStoredEscalationRecipients } from "../escalation-config-service.js";

describe("resolveOwnerReportRecipients", () => {
  it("returns the stored escalation recipients when present (stored wins)", async () => {
    const getStoredRecipients = vi.fn<(orgId: string) => Promise<string[]>>(() =>
      Promise.resolve(["owner@clinic.test", "ops@clinic.test"]),
    );
    const listVerifiedUserEmails = vi.fn<(orgId: string) => Promise<string[]>>(() =>
      Promise.resolve(["should-not-be-used@clinic.test"]),
    );

    const recipients = await resolveOwnerReportRecipients(
      { getStoredRecipients, listVerifiedUserEmails },
      "org_1",
    );

    expect(recipients).toEqual(["owner@clinic.test", "ops@clinic.test"]);
    expect(getStoredRecipients).toHaveBeenCalledWith("org_1");
    // The verified-user fallback is never consulted when a stored list exists.
    expect(listVerifiedUserEmails).not.toHaveBeenCalled();
  });

  it("falls back to verified dashboard-user emails when no stored recipients", async () => {
    const getStoredRecipients = vi.fn<(orgId: string) => Promise<string[]>>(() =>
      Promise.resolve([]),
    );
    const listVerifiedUserEmails = vi.fn<(orgId: string) => Promise<string[]>>(() =>
      Promise.resolve(["verified@clinic.test"]),
    );

    const recipients = await resolveOwnerReportRecipients(
      { getStoredRecipients, listVerifiedUserEmails },
      "org_2",
    );

    expect(recipients).toEqual(["verified@clinic.test"]);
    expect(listVerifiedUserEmails).toHaveBeenCalledWith("org_2");
  });

  it("returns an empty array when neither stored recipients nor verified users exist", async () => {
    const getStoredRecipients = vi.fn<(orgId: string) => Promise<string[]>>(() =>
      Promise.resolve([]),
    );
    const listVerifiedUserEmails = vi.fn<(orgId: string) => Promise<string[]>>(() =>
      Promise.resolve([]),
    );

    const recipients = await resolveOwnerReportRecipients(
      { getStoredRecipients, listVerifiedUserEmails },
      "org_3",
    );

    expect(recipients).toEqual([]);
  });
});

// Real-producer wiring: drive the SAME getStoredEscalationRecipients reader that
// app.ts wires (over a mocked Prisma, since CI has no Postgres) with the global
// ESCALATION_EMAIL_RECIPIENTS deliberately set. This is the regression guard for
// P1-3: a config-less org must NEVER inherit the shared env inbox. Under the old
// resolver (which sourced recipients from getEscalationConfig's env fallback) a
// config-less org surfaced the env list; if getStoredEscalationRecipients ever
// re-added an env fallback, these assertions would fail.
describe("resolveOwnerReportRecipients + real getStoredEscalationRecipients (env-leak isolation)", () => {
  const ENV_SENTINEL = "leaked@env.test";

  function withEnvRecipients<T>(value: string, fn: () => Promise<T>): Promise<T> {
    const original = process.env.ESCALATION_EMAIL_RECIPIENTS;
    process.env.ESCALATION_EMAIL_RECIPIENTS = value;
    return fn().finally(() => {
      if (original !== undefined) {
        process.env.ESCALATION_EMAIL_RECIPIENTS = original;
      } else {
        delete process.env.ESCALATION_EMAIL_RECIPIENTS;
      }
    });
  }

  it("routes a config-less org to ITS verified users, never the env list", async () => {
    // No stored escalationConfig for this org.
    const prisma = {
      organizationConfig: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    const listVerifiedUserEmails = vi.fn<(orgId: string) => Promise<string[]>>(() =>
      Promise.resolve(["owner-b@org-b.test"]),
    );

    const recipients = await withEnvRecipients(ENV_SENTINEL, () =>
      resolveOwnerReportRecipients(
        {
          getStoredRecipients: (id) => getStoredEscalationRecipients(prisma as never, id),
          listVerifiedUserEmails,
        },
        "org_b",
      ),
    );

    expect(recipients).toEqual(["owner-b@org-b.test"]);
    expect(recipients).not.toContain(ENV_SENTINEL);
    expect(listVerifiedUserEmails).toHaveBeenCalledWith("org_b");
  });

  it("returns [] (-> no_recipients) for a config-less org with no verified users, even with env set", async () => {
    const prisma = {
      organizationConfig: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    const listVerifiedUserEmails = vi.fn<(orgId: string) => Promise<string[]>>(() =>
      Promise.resolve([]),
    );

    const recipients = await withEnvRecipients(ENV_SENTINEL, () =>
      resolveOwnerReportRecipients(
        {
          getStoredRecipients: (id) => getStoredEscalationRecipients(prisma as never, id),
          listVerifiedUserEmails,
        },
        "org_b",
      ),
    );

    expect(recipients).toEqual([]);
    expect(recipients).not.toContain(ENV_SENTINEL);
  });
});
