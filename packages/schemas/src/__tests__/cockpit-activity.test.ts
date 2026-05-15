import { describe, expect, it } from "vitest";
import { ActivityRowSchema, ThreadMessageSchema, ActivityKindSchema } from "../cockpit-activity.js";

describe("ThreadMessageSchema", () => {
  it("accepts contact / alex / operator from values", () => {
    for (const from of ["contact", "alex", "operator"] as const) {
      expect(ThreadMessageSchema.parse({ from, text: "hi" })).toEqual({ from, text: "hi" });
    }
  });

  it("rejects unknown from values", () => {
    expect(() => ThreadMessageSchema.parse({ from: "system", text: "hi" })).toThrow();
  });

  it("rejects empty text", () => {
    expect(() => ThreadMessageSchema.parse({ from: "alex", text: "" })).toThrow();
  });
});

describe("ActivityKindSchema", () => {
  it("accepts canonical Alex kinds", () => {
    for (const k of [
      "booked",
      "qualified",
      "replied",
      "sent",
      "started",
      "connected",
      "waiting",
      "escalated",
      "passed",
    ] as const) {
      expect(ActivityKindSchema.parse(k)).toBe(k);
    }
  });
});

describe("ActivityRowSchema", () => {
  it("parses a populated row", () => {
    const row = ActivityRowSchema.parse({
      id: "a1",
      time: "11:58",
      kind: "booked",
      head: "Maya Lin confirmed Pilates Sat 2pm",
      body: "Calendar held.",
      who: "Maya Lin",
      contactId: "c-1",
      preview: [{ from: "contact", text: "hi" }],
      replyable: true,
      tag: "+3",
      timestampIso: "2026-05-15T11:58:00.000Z",
    });
    expect(row.preview).toHaveLength(1);
    expect(row.replyable).toBe(true);
  });

  it("parses a minimal row (time + kind + head only)", () => {
    const row = ActivityRowSchema.parse({
      time: "Fri",
      kind: "started",
      head: "Daily run begins",
    });
    expect(row.preview).toBeUndefined();
    expect(row.replyable).toBeUndefined();
    expect(row.timestampIso).toBeUndefined();
  });

  it("rejects empty head", () => {
    expect(() => ActivityRowSchema.parse({ time: "11:58", kind: "booked", head: "" })).toThrow();
  });

  it("accepts timestampIso as ISO-8601 datetime string", () => {
    const row = ActivityRowSchema.parse({
      time: "11:58",
      kind: "booked",
      head: "x",
      timestampIso: "2026-05-15T11:58:00Z",
    });
    expect(row.timestampIso).toBe("2026-05-15T11:58:00Z");
  });
});
