import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CalendarProvider } from "@switchboard/schemas";
import { createCalendarProviderFactory } from "../calendar-provider-factory.js";
import { isNoopCalendarProvider } from "../noop-calendar-provider.js";
import { resolveOrgGoogleCalendarCreds } from "../deployment-calendar-creds.js";
import {
  createGoogleCalendarProvider,
  createGoogleCalendarProviderFromOAuth,
} from "../google-calendar-factory.js";

// Mock both siblings so the factory's per-deployment / global Google branches never build a real
// googleapis client (no network). The resolver mock supplies MOCKED decrypted creds.
vi.mock("../deployment-calendar-creds.js", () => ({
  resolveOrgGoogleCalendarCreds: vi.fn(),
}));
vi.mock("../google-calendar-factory.js", () => ({
  createGoogleCalendarProvider: vi.fn(),
  createGoogleCalendarProviderFromOAuth: vi.fn(),
}));

const silentLogger = { info: () => {}, error: () => {} };

function makePrisma(rowByOrg: Record<string, { businessHours: unknown } | null>) {
  return {
    organizationConfig: {
      findFirst: vi.fn(async ({ where }: { where: { id: string } }) => rowByOrg[where.id] ?? null),
    },
  };
}

const fakeGoogleProvider = {
  healthCheck: vi.fn(async () => ({ status: "connected" as const, latencyMs: 1 })),
} as unknown as CalendarProvider;

const CLIENT_ENV = {
  GOOGLE_CALENDAR_CLIENT_ID: "cid",
  GOOGLE_CALENDAR_CLIENT_SECRET: "sec",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("factory: per-deployment Google Calendar (P0.2a)", () => {
  it("builds the org's OWN Google provider when per-deployment creds + OAuth client env exist", async () => {
    vi.mocked(resolveOrgGoogleCalendarCreds).mockResolvedValue({
      refreshToken: "rt",
      calendarId: "clinic-cal",
    });
    vi.mocked(createGoogleCalendarProviderFromOAuth).mockResolvedValue(fakeGoogleProvider);

    const factory = createCalendarProviderFactory({
      prismaClient: makePrisma({
        "org-A": { businessHours: { mon: [{ start: "09:00", end: "17:00" }] } },
      }) as never,
      logger: silentLogger,
      env: { ...CLIENT_ENV },
    });

    const provider = await factory("org-A");

    expect(provider).toBe(fakeGoogleProvider);
    expect(createGoogleCalendarProviderFromOAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "cid",
        clientSecret: "sec",
        refreshToken: "rt",
        calendarId: "clinic-cal",
      }),
    );
  });

  it("does NOT build the per-deployment provider when OAuth client env is missing; falls back to Local", async () => {
    vi.mocked(resolveOrgGoogleCalendarCreds).mockResolvedValue({
      refreshToken: "rt",
      calendarId: "c",
    });

    const factory = createCalendarProviderFactory({
      prismaClient: makePrisma({
        "org-A": { businessHours: { mon: [{ start: "09:00", end: "17:00" }] } },
      }) as never,
      logger: silentLogger,
      env: {}, // no client id/secret
    });

    const provider = await factory("org-A");

    expect(createGoogleCalendarProviderFromOAuth).not.toHaveBeenCalled();
    expect(resolveOrgGoogleCalendarCreds).not.toHaveBeenCalled();
    expect(isNoopCalendarProvider(provider)).toBe(false); // Local (businessHours present)
  });

  it("falls back to Local when the org has no connected calendar", async () => {
    vi.mocked(resolveOrgGoogleCalendarCreds).mockResolvedValue(null);

    const factory = createCalendarProviderFactory({
      prismaClient: makePrisma({
        "org-A": { businessHours: { mon: [{ start: "09:00", end: "17:00" }] } },
      }) as never,
      logger: silentLogger,
      env: { ...CLIENT_ENV },
    });

    const provider = await factory("org-A");

    expect(resolveOrgGoogleCalendarCreds).toHaveBeenCalledWith(expect.anything(), "org-A");
    expect(createGoogleCalendarProviderFromOAuth).not.toHaveBeenCalled();
    expect(isNoopCalendarProvider(provider)).toBe(false);
  });

  it("prefers the per-deployment OAuth calendar over the global service-account env", async () => {
    vi.mocked(resolveOrgGoogleCalendarCreds).mockResolvedValue({
      refreshToken: "rt",
      calendarId: "c",
    });
    vi.mocked(createGoogleCalendarProviderFromOAuth).mockResolvedValue(fakeGoogleProvider);

    const factory = createCalendarProviderFactory({
      prismaClient: makePrisma({ "org-A": { businessHours: null } }) as never,
      logger: silentLogger,
      env: {
        ...CLIENT_ENV,
        GOOGLE_CALENDAR_CREDENTIALS: '{"client_email":"x","private_key":"y"}',
        GOOGLE_CALENDAR_ID: "global-cal",
      },
    });

    const provider = await factory("org-A");

    expect(provider).toBe(fakeGoogleProvider);
    expect(createGoogleCalendarProviderFromOAuth).toHaveBeenCalledTimes(1);
    expect(createGoogleCalendarProvider).not.toHaveBeenCalled(); // global JWT path NOT used
  });

  it("falls through to the global service account when the per-deployment OAuth build throws", async () => {
    vi.mocked(resolveOrgGoogleCalendarCreds).mockResolvedValue({
      refreshToken: "rt",
      calendarId: "c",
    });
    vi.mocked(createGoogleCalendarProviderFromOAuth).mockRejectedValue(new Error("oauth boom"));
    vi.mocked(createGoogleCalendarProvider).mockResolvedValue(fakeGoogleProvider);

    const factory = createCalendarProviderFactory({
      prismaClient: makePrisma({ "org-A": { businessHours: null } }) as never,
      logger: silentLogger,
      env: {
        ...CLIENT_ENV,
        GOOGLE_CALENDAR_CREDENTIALS: '{"client_email":"x","private_key":"y"}',
        GOOGLE_CALENDAR_ID: "global-cal",
      },
    });

    const provider = await factory("org-A");

    expect(createGoogleCalendarProviderFromOAuth).toHaveBeenCalledTimes(1);
    expect(createGoogleCalendarProvider).toHaveBeenCalledTimes(1); // fell through to global
    expect(provider).toBe(fakeGoogleProvider);
  });
});
