import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildTestServer, type TestContext } from "./test-server.js";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await buildTestServer();
});

afterEach(async () => {
  await ctx.app.close();
});

async function seedContact(orgId: string, overrides: Record<string, unknown> = {}) {
  const c = await ctx.app.contactStore!.create({
    organizationId: orgId,
    name: "Lisa K.",
    phone: "+6591234567",
    email: "lisa@example.com",
    primaryChannel: "whatsapp",
    ...overrides,
  });
  return c;
}

describe("GET /api/dashboard/contacts", () => {
  it("returns 200 + ContactsListResponse on happy path", async () => {
    await seedContact("org-test");
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/contacts",
      headers: { "x-org-id": "org-test" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.rows)).toBe(true);
    expect(typeof body.hasMore).toBe("boolean");
    expect(body.nextCursor === null || typeof body.nextCursor === "string").toBe(true);
    expect(body.rows[0]?.displayName).toBe("Lisa K.");
    expect(body.rows[0]?.detailHref).toBe(`/contacts/${body.rows[0]?.id}`);
  });

  it("returns 400 for invalid stage", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/contacts?stage=banana",
      headers: { "x-org-id": "org-test" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for limit > 100", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/contacts?limit=101",
      headers: { "x-org-id": "org-test" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for limit < 1", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/contacts?limit=0",
      headers: { "x-org-id": "org-test" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for malformed cursor", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/contacts?cursor=not-base64-json",
      headers: { "x-org-id": "org-test" },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe("INVALID_CURSOR");
  });

  it("does not return contacts from another org", async () => {
    await seedContact("org-A", { name: "Alice", phone: "+6510000000" });
    await seedContact("org-B", { name: "Bob", phone: "+6520000000" });

    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/contacts",
      headers: { "x-org-id": "org-A" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].displayName).toBe("Alice");
  });

  it("filters by stage when ?stage=active", async () => {
    const c = await seedContact("org-test", { name: "Active Lead" });
    await ctx.app.contactStore!.updateStage("org-test", c.id, "active");
    await seedContact("org-test", { name: "Dormant Lead", phone: "+6599999999" });
    // Default seeded stage is "new"; we leave the second untouched.

    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/contacts?stage=active",
      headers: { "x-org-id": "org-test" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].displayName).toBe("Active Lead");
  });

  it("substring-matches name|phone|email when ?search=", async () => {
    await seedContact("org-test", {
      name: "Lisa Park",
      phone: "+6510000001",
      email: "lisa.park@example.com",
    });
    await seedContact("org-test", {
      name: "Marcus Tan",
      phone: "+6510000002",
      email: "marcus.tan@example.com",
    });
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/contacts?search=Lisa",
      headers: { "x-org-id": "org-test" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].displayName).toBe("Lisa Park");
  });

  it("paginates via cursor — page 2 contains next slice and final page reports nextCursor=null", async () => {
    // Seed 3 contacts; limit=2 → page 1 has 2 rows + nextCursor; page 2 has 1 row + null cursor.
    for (let i = 0; i < 3; i++) {
      await seedContact("org-test", { name: `C${i}`, phone: `+650000000${i}` });
    }

    const page1 = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/contacts?limit=2",
      headers: { "x-org-id": "org-test" },
    });
    expect(page1.statusCode).toBe(200);
    const body1 = page1.json();
    expect(body1.rows).toHaveLength(2);
    expect(body1.hasMore).toBe(true);
    expect(typeof body1.nextCursor).toBe("string");

    const page2 = await ctx.app.inject({
      method: "GET",
      url: `/api/dashboard/contacts?limit=2&cursor=${encodeURIComponent(body1.nextCursor)}`,
      headers: { "x-org-id": "org-test" },
    });
    expect(page2.statusCode).toBe(200);
    const body2 = page2.json();
    expect(body2.rows).toHaveLength(1);
    expect(body2.hasMore).toBe(false);
    expect(body2.nextCursor).toBeNull();
  });

  it("returns empty result when org has no contacts", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/contacts",
      headers: { "x-org-id": "empty-org" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.rows).toEqual([]);
    expect(body.hasMore).toBe(false);
    expect(body.nextCursor).toBeNull();
  });
});
