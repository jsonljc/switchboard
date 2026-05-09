import { describe, expect, it, vi } from "vitest";
import { listContactsForBrowse, InvalidCursorError } from "../list.js";
import type { ContactStore, ContactBrowseResult } from "../../lifecycle/contact-store.js";
import type { Contact } from "@switchboard/schemas";

const TS_A = new Date("2026-05-09T10:00:00Z");
const TS_B = new Date("2026-05-09T09:00:00Z");

function mkContact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: "c-1",
    organizationId: "org-A",
    name: "Lisa K.",
    phone: "+6591234567",
    email: "lisa@example.com",
    primaryChannel: "whatsapp",
    firstTouchChannel: null,
    stage: "active",
    source: "instant_form",
    attribution: null,
    roles: ["lead"],
    messagingOptIn: true,
    messagingOptInAt: TS_B,
    messagingOptInSource: "ctwa",
    messagingOptOutAt: null,
    firstContactAt: TS_B,
    lastActivityAt: TS_A,
    createdAt: TS_B,
    updatedAt: TS_A,
    ...overrides,
  };
}

function mkStore(result: ContactBrowseResult): {
  store: Pick<ContactStore, "listForBrowse">;
  spy: ReturnType<typeof vi.fn>;
} {
  const spy = vi.fn().mockResolvedValue(result);
  return { store: { listForBrowse: spy }, spy };
}

const baseQuery = {
  limit: 50,
  sort: "lastActivityAt" as const,
  direction: "desc" as const,
};

describe("listContactsForBrowse", () => {
  it("threads orgId, stage, search, sort, direction, limit through to the store", async () => {
    const { store, spy } = mkStore({
      rows: [],
      opportunityCounts: new Map(),
      hasMore: false,
      nextKeyset: null,
    });
    await listContactsForBrowse(
      {
        orgId: "org-A",
        query: { ...baseQuery, stage: "customer", search: "lisa" },
      },
      { contactStore: store },
    );
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toMatchObject({
      orgId: "org-A",
      stage: "customer",
      search: "lisa",
      sort: "lastActivityAt",
      direction: "desc",
      limit: 50,
    });
  });

  it("decodes a base64 cursor before calling the store", async () => {
    const { store, spy } = mkStore({
      rows: [],
      opportunityCounts: new Map(),
      hasMore: false,
      nextKeyset: null,
    });
    const cursorJson = JSON.stringify({ ts: TS_A.toISOString(), id: "c-7" });
    const cursor = Buffer.from(cursorJson, "utf8").toString("base64");

    await listContactsForBrowse(
      { orgId: "org-A", query: { ...baseQuery, cursor } },
      { contactStore: store },
    );
    expect(spy.mock.calls[0]![0].cursor).toEqual({ ts: TS_A, id: "c-7" });
  });

  it("rejects malformed base64 cursor with InvalidCursorError", async () => {
    const { store } = mkStore({
      rows: [],
      opportunityCounts: new Map(),
      hasMore: false,
      nextKeyset: null,
    });
    await expect(
      listContactsForBrowse(
        { orgId: "org-A", query: { ...baseQuery, cursor: "not-base64-json" } },
        { contactStore: store },
      ),
    ).rejects.toBeInstanceOf(InvalidCursorError);
  });

  it("rejects cursor with missing fields", async () => {
    const { store } = mkStore({
      rows: [],
      opportunityCounts: new Map(),
      hasMore: false,
      nextKeyset: null,
    });
    const bad = Buffer.from(JSON.stringify({ ts: TS_A.toISOString() }), "utf8").toString("base64");
    await expect(
      listContactsForBrowse(
        { orgId: "org-A", query: { ...baseQuery, cursor: bad } },
        { contactStore: store },
      ),
    ).rejects.toBeInstanceOf(InvalidCursorError);
  });

  it("rejects cursor with unparsable date", async () => {
    const { store } = mkStore({
      rows: [],
      opportunityCounts: new Map(),
      hasMore: false,
      nextKeyset: null,
    });
    const bad = Buffer.from(JSON.stringify({ ts: "not-a-date", id: "c-1" }), "utf8").toString(
      "base64",
    );
    await expect(
      listContactsForBrowse(
        { orgId: "org-A", query: { ...baseQuery, cursor: bad } },
        { contactStore: store },
      ),
    ).rejects.toBeInstanceOf(InvalidCursorError);
  });

  it("encodes nextCursor from store's nextKeyset when hasMore", async () => {
    const { store } = mkStore({
      rows: [mkContact()],
      opportunityCounts: new Map(),
      hasMore: true,
      nextKeyset: { ts: TS_B, id: "c-99" },
    });
    const result = await listContactsForBrowse(
      { orgId: "org-A", query: baseQuery },
      { contactStore: store },
    );
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBeTypeOf("string");
    const decoded = JSON.parse(Buffer.from(result.nextCursor!, "base64").toString("utf8"));
    expect(decoded).toEqual({ ts: TS_B.toISOString(), id: "c-99" });
  });

  it("returns nextCursor=null when hasMore=false", async () => {
    const { store } = mkStore({
      rows: [mkContact()],
      opportunityCounts: new Map(),
      hasMore: false,
      nextKeyset: null,
    });
    const result = await listContactsForBrowse(
      { orgId: "org-A", query: baseQuery },
      { contactStore: store },
    );
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
  });

  it("computes displayName: name → phone → email → '—'", async () => {
    const { store } = mkStore({
      rows: [
        mkContact({ id: "c-1", name: "Alice" }),
        mkContact({ id: "c-2", name: null, phone: "+6580000000" }),
        mkContact({ id: "c-3", name: null, phone: null, email: "x@y.com" }),
        mkContact({ id: "c-4", name: null, phone: null, email: null }),
      ],
      opportunityCounts: new Map(),
      hasMore: false,
      nextKeyset: null,
    });
    const result = await listContactsForBrowse(
      { orgId: "org-A", query: baseQuery },
      { contactStore: store },
    );
    expect(result.rows.map((r) => r.displayName)).toEqual(["Alice", "+6580000000", "x@y.com", "—"]);
  });

  it("emits detailHref=/contacts/<id> for every row", async () => {
    const { store } = mkStore({
      rows: [mkContact({ id: "c-abc" }), mkContact({ id: "c-def" })],
      opportunityCounts: new Map(),
      hasMore: false,
      nextKeyset: null,
    });
    const result = await listContactsForBrowse(
      { orgId: "org-A", query: baseQuery },
      { contactStore: store },
    );
    expect(result.rows.map((r) => r.detailHref)).toEqual(["/contacts/c-abc", "/contacts/c-def"]);
  });

  it("clamps opportunityCount at 99 even if store returns more (defensive)", async () => {
    const counts = new Map<string, number>([["c-1", 250]]);
    const { store } = mkStore({
      rows: [mkContact({ id: "c-1" })],
      opportunityCounts: counts,
      hasMore: false,
      nextKeyset: null,
    });
    const result = await listContactsForBrowse(
      { orgId: "org-A", query: baseQuery },
      { contactStore: store },
    );
    expect(result.rows[0]!.opportunityCount).toBe(99);
  });

  it("defaults opportunityCount to 0 when the store omits a contact from the map", async () => {
    const { store } = mkStore({
      rows: [mkContact({ id: "c-1" })],
      opportunityCounts: new Map(),
      hasMore: false,
      nextKeyset: null,
    });
    const result = await listContactsForBrowse(
      { orgId: "org-A", query: baseQuery },
      { contactStore: store },
    );
    expect(result.rows[0]!.opportunityCount).toBe(0);
  });

  it("emits ISO strings for lastActivityAt and firstContactAt", async () => {
    const { store } = mkStore({
      rows: [mkContact({ lastActivityAt: TS_A, firstContactAt: TS_B })],
      opportunityCounts: new Map(),
      hasMore: false,
      nextKeyset: null,
    });
    const result = await listContactsForBrowse(
      { orgId: "org-A", query: baseQuery },
      { contactStore: store },
    );
    expect(result.rows[0]!.lastActivityAt).toBe(TS_A.toISOString());
    expect(result.rows[0]!.firstContactAt).toBe(TS_B.toISOString());
  });

  it("never invokes the store with a UI surface name (smoke check on inputs)", async () => {
    // The projection's opaque dependency contract is the surface-agnostic
    // guarantee. The store sees only domain types — orgId, stage, search,
    // cursor, sort, direction, limit. No UI string literals.
    const { store, spy } = mkStore({
      rows: [],
      opportunityCounts: new Map(),
      hasMore: false,
      nextKeyset: null,
    });
    await listContactsForBrowse({ orgId: "org-A", query: baseQuery }, { contactStore: store });
    const args = spy.mock.calls[0]![0];
    const stringValues = JSON.stringify(args);
    expect(stringValues).not.toContain("/contacts");
    expect(stringValues).not.toContain("dashboard");
  });
});
