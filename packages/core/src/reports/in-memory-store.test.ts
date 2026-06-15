import { describe, expect, it } from "vitest";
import {
  createInMemoryReportCacheStore,
  createInMemoryPdfCacheStore,
  createInMemoryBaselineStore,
} from "./in-memory-store.js";
import type { ReportCacheRow } from "./interfaces.js";
import type { ReportDataV1 } from "@switchboard/schemas";

const samplePayload: ReportDataV1 = {
  label: "THIS MONTH",
  period: "APR 1 — APR 30",
  dateFolio: "APR 1 — APR 30",
  pullquote: { pre: "", value: "$0", mid: "", cost: "$0", post: "" },
  attribution: {
    total: 0,
    delta: { kind: "flat", text: "" },
    riley: { value: 0, caption: "" },
    alex: { value: 0, caption: "" },
  },
  funnel: [],
  funnelNarrative: { marker: "", text: "" },
  campaigns: [],
  cost: { paid: 0, alt: 0, saving: 0 },
  costNarrative: "",
  managedComparison: null,
  heldRate: { attended: 0, matured: 0, rate: null },
  consentCompleteness: { validConsent: 0, bookable: 0, rate: null },
  receiptedBookings: { count: 0 },
  receiptedBookingQuality: {
    cohortSize: 0,
    confidence: { deterministic: 0, high: 0, medium: 0, low: 0, unattributed: 0 },
    exceptions: {
      missing_source: 0,
      missing_consent: 0,
      manual_override: 0,
      duplicate_contact_risk: 0,
    },
    bookingsNeedingAttention: 0,
    worklist: [],
  },
  receiptedBookingRevenue: { revenueCents: 0, currency: null, bookingsWithValue: 0, cohortSize: 0 },
};

describe("createInMemoryReportCacheStore", () => {
  it("findByKey returns null for an unknown key", async () => {
    const store = createInMemoryReportCacheStore();
    expect(await store.findByKey("org-x", "THIS WEEK")).toBeNull();
  });

  it("upsert + findByKey round-trips a row", async () => {
    const store = createInMemoryReportCacheStore();
    const now = new Date("2026-04-15T10:00:00Z");
    const row: ReportCacheRow = {
      organizationId: "org-a",
      window: "THIS MONTH",
      payload: samplePayload,
      computedAt: now,
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
    };
    await store.upsert(row);
    const found = await store.findByKey("org-a", "THIS MONTH");
    expect(found).toEqual(row);
  });

  it("upsert replaces an existing row for the same key", async () => {
    const store = createInMemoryReportCacheStore();
    const t1 = new Date("2026-04-15T10:00:00Z");
    const t2 = new Date("2026-04-15T11:00:00Z");
    await store.upsert({
      organizationId: "org-a",
      window: "THIS MONTH",
      payload: samplePayload,
      computedAt: t1,
      expiresAt: new Date(t1.getTime() + 1000),
    });
    await store.upsert({
      organizationId: "org-a",
      window: "THIS MONTH",
      payload: { ...samplePayload, period: "MAY 1 — MAY 31" },
      computedAt: t2,
      expiresAt: new Date(t2.getTime() + 1000),
    });
    const found = await store.findByKey("org-a", "THIS MONTH");
    expect(found?.payload.period).toBe("MAY 1 — MAY 31");
    expect(found?.computedAt).toEqual(t2);
  });

  it("invalidate removes the row; calling on a missing key is a no-op", async () => {
    const store = createInMemoryReportCacheStore();
    await store.invalidate("org-a", "THIS WEEK");
    await store.upsert({
      organizationId: "org-a",
      window: "THIS WEEK",
      payload: samplePayload,
      computedAt: new Date(),
      expiresAt: new Date(),
    });
    await store.invalidate("org-a", "THIS WEEK");
    expect(await store.findByKey("org-a", "THIS WEEK")).toBeNull();
  });

  it("scopes rows by organizationId", async () => {
    const store = createInMemoryReportCacheStore();
    const row = {
      organizationId: "org-a",
      window: "THIS MONTH",
      payload: samplePayload,
      computedAt: new Date(),
      expiresAt: new Date(),
    };
    await store.upsert(row);
    expect(await store.findByKey("org-b", "THIS MONTH")).toBeNull();
  });
});

describe("createInMemoryPdfCacheStore", () => {
  it("upsert + findByKey round-trips a PDF row", async () => {
    const store = createInMemoryPdfCacheStore();
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    const now = new Date();
    await store.upsert({
      organizationId: "org-a",
      window: "THIS MONTH",
      pdfBytes: bytes,
      computedAt: now,
      expiresAt: new Date(now.getTime() + 1000),
    });
    const found = await store.findByKey("org-a", "THIS MONTH");
    expect(found?.pdfBytes).toEqual(bytes);
  });
});

describe("createInMemoryBaselineStore", () => {
  it("listByDimension returns an empty array when no rows captured", async () => {
    const store = createInMemoryBaselineStore();
    expect(await store.listByDimension("org-a", "ads")).toEqual([]);
  });

  it("insertMany + listByDimension round-trip", async () => {
    const store = createInMemoryBaselineStore();
    const rows = [
      {
        organizationId: "org-a",
        dimension: "ads" as const,
        metric: "spend",
        value: 100,
        periodStart: new Date("2026-01-01T00:00:00Z"),
        periodEnd: new Date("2026-04-01T00:00:00Z"),
        capturedAt: new Date("2026-04-15T00:00:00Z"),
      },
      {
        organizationId: "org-a",
        dimension: "ads" as const,
        metric: "leads",
        value: 50,
        periodStart: new Date("2026-01-01T00:00:00Z"),
        periodEnd: new Date("2026-04-01T00:00:00Z"),
        capturedAt: new Date("2026-04-15T00:00:00Z"),
      },
    ];
    await store.insertMany(rows);
    const found = await store.listByDimension("org-a", "ads");
    expect(found).toHaveLength(2);
    expect(found.map((r) => r.metric).sort()).toEqual(["leads", "spend"]);
  });

  it("insertMany is idempotent for matching rows", async () => {
    const store = createInMemoryBaselineStore();
    const row = {
      organizationId: "org-a",
      dimension: "ads" as const,
      metric: "spend",
      value: 100,
      periodStart: new Date("2026-01-01T00:00:00Z"),
      periodEnd: new Date("2026-04-01T00:00:00Z"),
      capturedAt: new Date("2026-04-15T00:00:00Z"),
    };
    await store.insertMany([row]);
    await store.insertMany([{ ...row, value: 200, capturedAt: new Date("2026-04-16T00:00:00Z") }]);
    const found = await store.listByDimension("org-a", "ads");
    expect(found).toHaveLength(1);
    expect(found[0]?.value).toBe(200);
  });
});
