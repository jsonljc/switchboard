/**
 * EV-14 / CHAN-2 — data-layer org isolation for `store-mutation-deferred` stores.
 *
 * The `store-mutation-check.ts` advisory flags Prisma mutations whose WHERE lacks
 * an org key; a `// route-governance: store-mutation-deferred` directive suppresses
 * it. This file pins the org-scoped tenant boundary that DOES exist on those stores
 * and SURFACES the residuals.
 *
 * Scope (non-duplicative — the rest is already covered by each store's own test):
 *  - PIN the genuinely-uncovered org-scoped reads: trigger `listForBrowse`
 *    (findMany + groupBy) and thread `threadCountsByAgent` (groupBy).
 *  - SURFACE the consent-record store-layer gap: `getById` + `revoke` are id-only
 *    despite an `orgId` column — the store enforces NO tenant isolation.
 *
 * Already covered elsewhere (verified): activity-log `listByDeployment` +
 * `cleanup`; thread `getByContact` / `listByContactIds`; scheduled-follow-up
 * `findPendingForContact`; robin-recovery `reapOrphanedClaim` (its updateMany WHERE
 * already re-asserts `organizationId`).
 *
 * Deferred / by-design (flagged for #643, NOT testable as isolation here):
 *  - Global cron scans read across orgs by design and carry `organizationId` per row
 *    for per-org dispatch: scheduled-follow-up `findDue`, robin-recovery
 *    `findOrphanedClaims`, event-store `pollPending` + its batch update/deleteMany,
 *    activity-log `cleanup`, trigger `expireOverdue`.
 *  - No-org-column models need a schema migration before they can be org-scoped:
 *    creator-identity, action-request, asset-record, deployment-state, and the
 *    lifecycle DispatchRecord.
 *
 * The db tests MOCK Prisma. TEST-ONLY: pins existing isolation, changes no code.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaConversationThreadStore } from "../prisma-thread-store.js";
import { PrismaTriggerStore } from "../prisma-trigger-store.js";
import { PrismaConsentRecordStore } from "../prisma-consent-record-store.js";

const ORG_A = "org_A";

// ===========================================================================
// PIN — trigger-store listForBrowse is org-scoped (findMany + groupBy)
// ===========================================================================

describe("CHAN-2 PIN: trigger-store listForBrowse org scope", () => {
  it("scopes BOTH the row query and the status counts to the caller's org", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const groupBy = vi.fn().mockResolvedValue([]);
    const prisma = { scheduledTriggerRecord: { findMany, groupBy } };
    const store = new PrismaTriggerStore(prisma as never);

    await store.listForBrowse({ orgId: ORG_A, sort: "createdAt", direction: "desc", limit: 10 });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: ORG_A }) }),
    );
    expect(groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: ORG_A }) }),
    );
  });
});

// ===========================================================================
// PIN — thread-store threadCountsByAgent groupBy is org-scoped
// ===========================================================================

describe("CHAN-2 PIN: thread-store threadCountsByAgent org scope", () => {
  it("scopes the per-agent thread counts to the caller's org", async () => {
    const groupBy = vi.fn().mockResolvedValue([]);
    const prisma = { conversationThread: { groupBy } };
    const store = new PrismaConversationThreadStore(prisma as never);

    await store.threadCountsByAgent({
      orgId: ORG_A,
      from: new Date("2026-06-01T00:00:00Z"),
      to: new Date("2026-06-30T00:00:00Z"),
    });

    expect(groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: ORG_A }) }),
    );
  });
});

// ===========================================================================
// SURFACE — consent-record store has NO org isolation at the data layer
// ===========================================================================

describe("CHAN-2 SURFACE: consent-record store is id-only (no org in WHERE)", () => {
  let findUnique: ReturnType<typeof vi.fn>;
  let update: ReturnType<typeof vi.fn>;
  let store: PrismaConsentRecordStore;

  beforeEach(() => {
    findUnique = vi.fn().mockResolvedValue(null);
    update = vi.fn().mockResolvedValue({ id: "consent_1", revoked: true });
    store = new PrismaConsentRecordStore({ consentRecord: { findUnique, update } } as never);
  });

  // ConsentRecord HAS an `orgId` column, but neither the read nor the revoke
  // scopes by it — both key on `{ id }` alone. The store layer therefore provides
  // NO tenant isolation: a caller that passes another org's consent-record id reads
  // or revokes it. Isolation depends entirely on the caller pre-scoping the id.
  // Pinned so a future org-scoping (#643) is a deliberate, test-visible change.
  it("getById reads by id alone — no organizationId in the WHERE", async () => {
    await store.getById("consent_other_org");
    expect(findUnique).toHaveBeenCalledWith({ where: { id: "consent_other_org" } });
    const where = findUnique.mock.calls[0]![0].where;
    expect(where).not.toHaveProperty("orgId");
    expect(where).not.toHaveProperty("organizationId");
  });

  it("revoke (deferred mutation) writes by id alone — no organizationId in the WHERE", async () => {
    await store.revoke("consent_other_org");
    const where = update.mock.calls[0]![0].where;
    expect(where).toEqual({ id: "consent_other_org" });
    expect(where).not.toHaveProperty("orgId");
    expect(where).not.toHaveProperty("organizationId");
  });
});
