import { describe, it, expect, vi } from "vitest";
import { PrismaLeadIntakeStore } from "../lead-intake-store.js";

// Unit test (mocked Prisma; CI has no Postgres) for the Gate-0 recency read.
// The real-Postgres integration coverage lives in the sibling lead-intake-store.test.ts.
describe("PrismaLeadIntakeStore.hasRecentLead", () => {
  function storeWithCount(count: number) {
    const contact = { count: vi.fn().mockResolvedValue(count) };
    const prisma = { contact } as unknown as ConstructorParameters<typeof PrismaLeadIntakeStore>[0];
    return { store: new PrismaLeadIntakeStore(prisma), contact };
  }

  it("returns true when a recent lead exists for the org + sourceType", async () => {
    const { store, contact } = storeWithCount(2);
    const result = await store.hasRecentLead("org_1", "ctwa", 7);
    expect(result).toBe(true);
    const where = contact.count.mock.calls[0]![0].where;
    expect(where.organizationId).toBe("org_1");
    expect(where.sourceType).toBe("ctwa");
    expect(where.createdAt.gte).toBeInstanceOf(Date);
  });

  it("returns false when there are no recent leads (count 0)", async () => {
    const { store } = storeWithCount(0);
    expect(await store.hasRecentLead("org_1", "instant_form", 7)).toBe(false);
  });

  it("scopes the recency window to the requested number of days", async () => {
    const { store, contact } = storeWithCount(0);
    const before = Date.now() - 7 * 24 * 60 * 60 * 1000;
    await store.hasRecentLead("org_1", "ctwa", 7);
    const after = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const gte = contact.count.mock.calls[0]![0].where.createdAt.gte as Date;
    expect(gte.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(gte.getTime()).toBeLessThanOrEqual(after + 1000);
  });
});
