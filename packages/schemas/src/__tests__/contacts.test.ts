import { describe, expect, it } from "vitest";
import {
  ContactBrowseRowSchema,
  ContactsListQuerySchema,
  ContactsListResponseSchema,
} from "../contacts.js";

describe("ContactsListQuerySchema", () => {
  it("defaults limit=50, sort=lastActivityAt, direction=desc", () => {
    const q = ContactsListQuerySchema.parse({});
    expect(q.limit).toBe(50);
    expect(q.sort).toBe("lastActivityAt");
    expect(q.direction).toBe("desc");
  });

  it("rejects limit > 100", () => {
    expect(() => ContactsListQuerySchema.parse({ limit: 101 })).toThrow();
  });

  it("rejects limit < 1", () => {
    expect(() => ContactsListQuerySchema.parse({ limit: 0 })).toThrow();
  });

  it("rejects empty search after trim", () => {
    expect(() => ContactsListQuerySchema.parse({ search: "   " })).toThrow();
  });

  it("rejects invalid stage", () => {
    expect(() => ContactsListQuerySchema.parse({ stage: "banana" })).toThrow();
  });

  it("accepts every valid lifecycle stage", () => {
    for (const s of ["new", "active", "customer", "retained", "dormant"] as const) {
      expect(() => ContactsListQuerySchema.parse({ stage: s })).not.toThrow();
    }
  });

  it("coerces limit from string (URL-safe)", () => {
    const q = ContactsListQuerySchema.parse({ limit: "25" });
    expect(q.limit).toBe(25);
  });

  it("rejects invalid sort key", () => {
    expect(() => ContactsListQuerySchema.parse({ sort: "name" })).toThrow();
  });

  it("rejects invalid direction", () => {
    expect(() => ContactsListQuerySchema.parse({ direction: "sideways" })).toThrow();
  });

  it("trims whitespace from search", () => {
    const q = ContactsListQuerySchema.parse({ search: "  Lisa  " });
    expect(q.search).toBe("Lisa");
  });

  it("rejects search > 100 chars", () => {
    expect(() => ContactsListQuerySchema.parse({ search: "x".repeat(101) })).toThrow();
  });
});

describe("ContactBrowseRowSchema", () => {
  const valid = {
    id: "c-1",
    displayName: "Lisa",
    stage: "active",
    primaryChannel: "whatsapp",
    source: null,
    lastActivityAt: "2026-05-09T00:00:00Z",
    firstContactAt: "2026-05-01T00:00:00Z",
    opportunityCount: 0,
    detailHref: "/contacts/c-1",
  };

  it("parses a minimal valid row", () => {
    expect(() => ContactBrowseRowSchema.parse(valid)).not.toThrow();
  });

  it("clamps opportunityCount at 99 (boundary)", () => {
    const r = ContactBrowseRowSchema.parse({ ...valid, opportunityCount: 99 });
    expect(r.opportunityCount).toBe(99);
  });

  it("rejects opportunityCount > 99", () => {
    expect(() => ContactBrowseRowSchema.parse({ ...valid, opportunityCount: 100 })).toThrow();
  });

  it("rejects opportunityCount < 0", () => {
    expect(() => ContactBrowseRowSchema.parse({ ...valid, opportunityCount: -1 })).toThrow();
  });

  it("rejects unknown primaryChannel", () => {
    expect(() => ContactBrowseRowSchema.parse({ ...valid, primaryChannel: "sms" })).toThrow();
  });

  it("accepts source=null", () => {
    expect(() => ContactBrowseRowSchema.parse({ ...valid, source: null })).not.toThrow();
  });

  it("accepts source as string", () => {
    expect(() => ContactBrowseRowSchema.parse({ ...valid, source: "instant_form" })).not.toThrow();
  });
});

describe("ContactsListResponseSchema", () => {
  it("hasMore=false with null cursor", () => {
    const ok = ContactsListResponseSchema.parse({
      rows: [],
      nextCursor: null,
      hasMore: false,
    });
    expect(ok.hasMore).toBe(false);
    expect(ok.nextCursor).toBeNull();
  });

  it("accepts a string cursor", () => {
    const ok = ContactsListResponseSchema.parse({
      rows: [],
      nextCursor: "eyJ0cyI6IjIwMjYtMDUtMDlUMDA6MDA6MDBaIiwiaWQiOiJjLTEifQ==",
      hasMore: true,
    });
    expect(ok.nextCursor).toBeTypeOf("string");
  });
});
