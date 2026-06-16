import { describe, it, expect, vi } from "vitest";
import { resolveOwnerReportRecipients } from "./weekly-report-recipients.js";

describe("resolveOwnerReportRecipients", () => {
  it("returns the configured escalation recipients when present (config wins)", async () => {
    const getConfig = vi.fn<(orgId: string) => Promise<{ emailRecipients: string[] }>>(() =>
      Promise.resolve({ emailRecipients: ["owner@clinic.test", "ops@clinic.test"] }),
    );
    const listVerifiedUserEmails = vi.fn<(orgId: string) => Promise<string[]>>(() =>
      Promise.resolve(["should-not-be-used@clinic.test"]),
    );

    const recipients = await resolveOwnerReportRecipients(
      { getConfig, listVerifiedUserEmails },
      "org_1",
    );

    expect(recipients).toEqual(["owner@clinic.test", "ops@clinic.test"]);
    expect(getConfig).toHaveBeenCalledWith("org_1");
    // The verified-user fallback is never consulted when config has recipients.
    expect(listVerifiedUserEmails).not.toHaveBeenCalled();
  });

  it("falls back to verified dashboard-user emails when config has none", async () => {
    const getConfig = vi.fn<(orgId: string) => Promise<{ emailRecipients: string[] }>>(() =>
      Promise.resolve({ emailRecipients: [] }),
    );
    const listVerifiedUserEmails = vi.fn<(orgId: string) => Promise<string[]>>(() =>
      Promise.resolve(["verified@clinic.test"]),
    );

    const recipients = await resolveOwnerReportRecipients(
      { getConfig, listVerifiedUserEmails },
      "org_2",
    );

    expect(recipients).toEqual(["verified@clinic.test"]);
    expect(listVerifiedUserEmails).toHaveBeenCalledWith("org_2");
  });

  it("returns an empty array when neither config nor verified users exist", async () => {
    const getConfig = vi.fn<(orgId: string) => Promise<{ emailRecipients: string[] }>>(() =>
      Promise.resolve({ emailRecipients: [] }),
    );
    const listVerifiedUserEmails = vi.fn<(orgId: string) => Promise<string[]>>(() =>
      Promise.resolve([]),
    );

    const recipients = await resolveOwnerReportRecipients(
      { getConfig, listVerifiedUserEmails },
      "org_3",
    );

    expect(recipients).toEqual([]);
  });
});
