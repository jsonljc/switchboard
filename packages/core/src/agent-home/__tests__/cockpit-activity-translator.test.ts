import { describe, expect, it, vi } from "vitest";
import {
  translateAuditToCockpitActivity,
  type AuditEntryForTranslator,
} from "../cockpit-activity-translator.js";
import type { ActivityPreviewReader, ThreadMessageRecord } from "../activity-preview-reader.js";

function reader(
  data: Record<string, Array<{ from: "contact" | "alex" | "operator"; text: string }>>,
): { reader: ActivityPreviewReader; calls: ReturnType<typeof vi.fn> } {
  const calls = vi.fn();
  return {
    calls,
    reader: {
      async readRecentBatch(args) {
        calls(args);
        const out: Record<string, readonly ThreadMessageRecord[]> = {};
        for (const id of args.contactIds) {
          out[id] = (data[id] ?? []).map((m) => ({
            ...m,
            createdAt: new Date(0).toISOString(),
          }));
        }
        return out;
      },
    },
  };
}

const NOW = new Date("2026-05-15T11:58:00Z");

describe("translateAuditToCockpitActivity", () => {
  it("translates booking.create with contact ref + preview", async () => {
    const audit: AuditEntryForTranslator[] = [
      {
        id: "a1",
        eventType: "booking.create",
        timestamp: NOW.toISOString(),
        actorType: "agent",
        actorId: "alex",
        snapshot: {
          booking: {
            contactId: "c1",
            contactDisplayName: "Maya Lin",
            service: "Pilates intro",
            when: "Sat 2pm",
            note: "Wants studio tour first",
          },
        },
      },
    ];
    const r = reader({ c1: [{ from: "contact", text: "Can I tour first?" }] });
    const rows = await translateAuditToCockpitActivity({
      entries: audit,
      previewReader: r.reader,
      orgId: "org-1",
      agentKey: "alex",
      limit: 50,
      expandPreview: true,
      now: NOW,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "a1",
      kind: "booked",
      who: "Maya Lin",
      contactId: "c1",
      replyable: true,
    });
    expect(rows[0]!.head).toContain("Maya Lin");
    expect(rows[0]!.head).toContain("Pilates intro");
    expect(rows[0]!.body).toContain("Wants studio tour first");
    expect(rows[0]!.preview).toHaveLength(1);
    expect(r.calls).toHaveBeenCalledTimes(1);
  });

  it("batches preview fetches: 1 call for N unique contacts", async () => {
    const audit: AuditEntryForTranslator[] = [
      {
        id: "a1",
        eventType: "booking.create",
        timestamp: NOW.toISOString(),
        actorType: "agent",
        actorId: "alex",
        snapshot: { booking: { contactId: "c1", contactDisplayName: "A" } },
      },
      {
        id: "a2",
        eventType: "lifecycle.qualified",
        timestamp: NOW.toISOString(),
        actorType: "agent",
        actorId: "alex",
        snapshot: { contactId: "c2", contactDisplayName: "B" },
      },
      {
        id: "a3",
        eventType: "message.sent",
        timestamp: NOW.toISOString(),
        actorType: "agent",
        actorId: "alex",
        snapshot: { message: { contactId: "c3", contactDisplayName: "C" } },
      },
    ];
    const r = reader({});
    await translateAuditToCockpitActivity({
      entries: audit,
      previewReader: r.reader,
      orgId: "org-1",
      agentKey: "alex",
      limit: 50,
      expandPreview: true,
      now: NOW,
    });
    expect(r.calls).toHaveBeenCalledTimes(1);
    expect(r.calls.mock.calls[0]![0].contactIds.sort()).toEqual(["c1", "c2", "c3"]);
  });

  it("skips preview fetch entirely when expandPreview=false", async () => {
    const audit: AuditEntryForTranslator[] = [
      {
        id: "a1",
        eventType: "booking.create",
        timestamp: NOW.toISOString(),
        actorType: "agent",
        actorId: "alex",
        snapshot: { booking: { contactId: "c1", contactDisplayName: "A" } },
      },
    ];
    const r = reader({});
    const rows = await translateAuditToCockpitActivity({
      entries: audit,
      previewReader: r.reader,
      orgId: "org-1",
      agentKey: "alex",
      limit: 50,
      expandPreview: false,
      now: NOW,
    });
    expect(r.calls).not.toHaveBeenCalled();
    expect(rows[0]!.preview).toBeUndefined();
    expect(rows[0]!.replyable).toBe(false);
  });

  it("emits contact-less row when extractor returns null", async () => {
    // Uses an agent-emitted system.daily_scan_started entry so the actor
    // filter admits it; the contact-snapshot-extractor returns null for
    // this event type, so the row surfaces without who/contactId/preview.
    const audit: AuditEntryForTranslator[] = [
      {
        id: "a1",
        eventType: "system.daily_scan_started",
        timestamp: NOW.toISOString(),
        actorType: "agent",
        actorId: "alex",
        snapshot: { quietHours: "21:00–07:00 PT" },
      },
    ];
    const r = reader({});
    const rows = await translateAuditToCockpitActivity({
      entries: audit,
      previewReader: r.reader,
      orgId: "org-1",
      agentKey: "alex",
      limit: 50,
      expandPreview: true,
      now: NOW,
    });
    expect(rows[0]?.kind).toBe("started");
    expect(rows[0]?.who).toBeUndefined();
    expect(rows[0]?.contactId).toBeUndefined();
    expect(rows[0]?.preview).toBeUndefined();
    expect(rows[0]?.replyable).toBe(false);
  });

  it("does not internally clamp by limit — API route owns the slice", async () => {
    // The translator consumes whatever the API route hands it (the route
    // owns the Prisma `take`). Passing 100 entries with limit=25 yields
    // 100 rows; the route would have only fetched 25 in real use.
    const audit: AuditEntryForTranslator[] = Array.from({ length: 100 }, (_, i) => ({
      id: `a${i}`,
      eventType: "booking.create",
      timestamp: NOW.toISOString(),
      actorType: "agent",
      actorId: "alex",
      snapshot: { booking: { contactId: `c${i}`, contactDisplayName: `Name ${i}` } },
    }));
    const r = reader({});
    const rows = await translateAuditToCockpitActivity({
      entries: audit,
      previewReader: r.reader,
      orgId: "org-1",
      agentKey: "alex",
      limit: 25,
      expandPreview: true,
      now: NOW,
    });
    expect(rows).toHaveLength(100);
  });

  it("includes entry with actorId === agentKey", async () => {
    const audit: AuditEntryForTranslator[] = [
      {
        id: "a1",
        eventType: "booking.create",
        timestamp: NOW.toISOString(),
        actorType: "agent",
        actorId: "alex",
        snapshot: { booking: { contactId: "c1", contactDisplayName: "A" } },
      },
    ];
    const r = reader({});
    const rows = await translateAuditToCockpitActivity({
      entries: audit,
      previewReader: r.reader,
      orgId: "o",
      agentKey: "alex",
      limit: 50,
      expandPreview: false,
      now: NOW,
    });
    expect(rows).toHaveLength(1);
  });

  it("includes entry with snapshot.agentRole === agentKey (actorId is UUID)", async () => {
    const audit: AuditEntryForTranslator[] = [
      {
        id: "a1",
        eventType: "booking.create",
        timestamp: NOW.toISOString(),
        actorType: "agent",
        actorId: "11111111-2222-3333-4444-555555555555",
        snapshot: {
          agentRole: "alex",
          booking: { contactId: "c1", contactDisplayName: "A" },
        },
      },
    ];
    const r = reader({});
    const rows = await translateAuditToCockpitActivity({
      entries: audit,
      previewReader: r.reader,
      orgId: "o",
      agentKey: "alex",
      limit: 50,
      expandPreview: false,
      now: NOW,
    });
    expect(rows).toHaveLength(1);
  });

  it("UUID actorId without agentRole falls back to alex (legacy convention)", async () => {
    const audit: AuditEntryForTranslator[] = [
      {
        id: "a1",
        eventType: "message.sent",
        timestamp: NOW.toISOString(),
        actorType: "agent",
        actorId: "11111111-2222-3333-4444-555555555555",
        snapshot: {},
      },
    ];
    const r = reader({});
    const rows = await translateAuditToCockpitActivity({
      entries: audit,
      previewReader: r.reader,
      orgId: "o",
      agentKey: "alex",
      limit: 50,
      expandPreview: false,
      now: NOW,
    });
    expect(rows).toHaveLength(1);
  });

  it("UUID actorId without agentRole does NOT match riley (no UUID-to-riley fallback)", async () => {
    const audit: AuditEntryForTranslator[] = [
      {
        id: "a1",
        eventType: "message.sent",
        timestamp: NOW.toISOString(),
        actorType: "agent",
        actorId: "11111111-2222-3333-4444-555555555555",
        snapshot: {},
      },
    ];
    const r = reader({});
    const rows = await translateAuditToCockpitActivity({
      entries: audit,
      previewReader: r.reader,
      orgId: "o",
      agentKey: "riley",
      limit: 50,
      expandPreview: false,
      now: NOW,
    });
    expect(rows).toHaveLength(0);
  });

  it("UUID actorId WITH explicit snapshot.agentRole does NOT fall back to alex", async () => {
    // Regression for cross-agent leak: a UUID actorId that has an explicit
    // snapshot.agentRole for a different agent must not also match alex via
    // the UUID fallback. The fallback only fires when there's no other
    // agent attribution at all.
    const audit: AuditEntryForTranslator[] = [
      {
        id: "a1",
        eventType: "message.sent",
        timestamp: NOW.toISOString(),
        actorType: "agent",
        actorId: "11111111-2222-3333-4444-555555555555",
        snapshot: { agentRole: "riley" },
      },
    ];
    const r = reader({});
    const rows = await translateAuditToCockpitActivity({
      entries: audit,
      previewReader: r.reader,
      orgId: "o",
      agentKey: "alex",
      limit: 50,
      expandPreview: false,
      now: NOW,
    });
    expect(rows).toHaveLength(0);
  });

  it("excludes non-agent actorType entries", async () => {
    const audit: AuditEntryForTranslator[] = [
      {
        id: "a1",
        eventType: "system.daily_scan_started",
        timestamp: NOW.toISOString(),
        actorType: "system",
        actorId: "cron",
        snapshot: {},
      },
    ];
    const r = reader({});
    const rows = await translateAuditToCockpitActivity({
      entries: audit,
      previewReader: r.reader,
      orgId: "o",
      agentKey: "alex",
      limit: 50,
      expandPreview: false,
      now: NOW,
    });
    expect(rows).toHaveLength(0);
  });

  it("populates timestampIso from entry.timestamp", async () => {
    const ts = "2026-05-15T11:58:00.000Z";
    const audit: AuditEntryForTranslator[] = [
      {
        id: "a1",
        eventType: "booking.create",
        timestamp: ts,
        actorType: "agent",
        actorId: "alex",
        snapshot: { booking: { contactId: "c1", contactDisplayName: "A" } },
      },
    ];
    const r = reader({});
    const rows = await translateAuditToCockpitActivity({
      entries: audit,
      previewReader: r.reader,
      orgId: "o",
      agentKey: "alex",
      limit: 50,
      expandPreview: false,
      now: NOW,
    });
    expect(rows[0]!.timestampIso).toBe(ts);
  });
});
