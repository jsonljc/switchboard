import { describe, it, expect, vi } from "vitest";
import { encryptCredentials, decryptCredentials } from "@switchboard/db";
import { resolveOrgGoogleCalendarCreds } from "../deployment-calendar-creds.js";

// Real crypto round-trip with an explicit test key (no env, no DB, no network). Proves the
// production decrypt path end to end while keeping the test hermetic.
const KEY = "test-encryption-key-at-least-32-characters!!";
const decrypt = (blob: string) => decryptCredentials(blob, KEY);

function makePrisma(row: { credentials: string } | null) {
  return {
    deploymentConnection: {
      findFirst: vi.fn(async (_args: unknown) => row),
    },
  };
}

describe("resolveOrgGoogleCalendarCreds", () => {
  it("decrypts and returns refreshToken + calendarId for an org with a connected calendar", async () => {
    const blob = encryptCredentials(
      { refreshToken: "rt-abc", accessToken: "at", calendarId: "clinic@group.calendar.google.com" },
      KEY,
    );
    const prisma = makePrisma({ credentials: blob });

    const creds = await resolveOrgGoogleCalendarCreds(prisma as never, "org-A", decrypt);

    expect(creds).toEqual({
      refreshToken: "rt-abc",
      calendarId: "clinic@group.calendar.google.com",
    });
  });

  it("scopes the lookup to the org's deployment and the google_calendar type", async () => {
    const blob = encryptCredentials({ refreshToken: "rt", calendarId: "primary" }, KEY);
    const prisma = makePrisma({ credentials: blob });

    await resolveOrgGoogleCalendarCreds(prisma as never, "org-A", decrypt);

    expect(prisma.deploymentConnection.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { type: "google_calendar", deployment: { organizationId: "org-A" } },
      }),
    );
  });

  it("returns null when the org has no connected calendar", async () => {
    const prisma = makePrisma(null);

    const creds = await resolveOrgGoogleCalendarCreds(prisma as never, "org-A", decrypt);

    expect(creds).toBeNull();
  });

  it("returns null when the stored creds have no refresh token", async () => {
    const blob = encryptCredentials({ accessToken: "at", calendarId: "primary" }, KEY);
    const prisma = makePrisma({ credentials: blob });

    const creds = await resolveOrgGoogleCalendarCreds(prisma as never, "org-A", decrypt);

    expect(creds).toBeNull();
  });

  it("defaults calendarId to 'primary' when the stored creds omit it", async () => {
    const blob = encryptCredentials({ refreshToken: "rt-only" }, KEY);
    const prisma = makePrisma({ credentials: blob });

    const creds = await resolveOrgGoogleCalendarCreds(prisma as never, "org-A", decrypt);

    expect(creds).toEqual({ refreshToken: "rt-only", calendarId: "primary" });
  });
});
