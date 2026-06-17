// apps/api/src/routes/__tests__/operator-contact-erasure.test.ts
// Integration tests for POST /api/:orgId/contacts/:contactId/erase, the operator-initiated
// PDPA right-to-erasure path. Mirrors receipted-booking-reconcile.test.ts: the mutation enters
// through PlatformIngress.submit (no bypass), a WorkTrace is persisted, Idempotency-Key is
// required, the authenticated org is authoritative (cross-tenant denied fail-closed), and a
// repeat with the same key does not double-run the erase. A fake OperatorContactEraser
// (findContactForOrg / erase / recordRequest vi.fns) is injected via buildTestServer (no Postgres).
import { describe, it, expect, vi } from "vitest";
import type { OperatorContactEraser } from "../../bootstrap/operator-intents/erase-contact.js";
import { buildTestServer } from "../../__tests__/test-server.js";
import { ERASE_CONTACT_INTENT } from "../../bootstrap/operator-intents.js";

/**
 * Build a fake eraser. `existsForOrg` controls whether findContactForOrg reports the
 * contact present under the queried org (the org-scope / cross-tenant gate); erase + recordRequest
 * are spies the tests assert on.
 */
function makeEraser(existsForOrg = true): {
  findContactForOrg: ReturnType<typeof vi.fn>;
  erase: ReturnType<typeof vi.fn>;
  recordRequest: ReturnType<typeof vi.fn>;
} & OperatorContactEraser {
  return {
    findContactForOrg: vi
      .fn<OperatorContactEraser["findContactForOrg"]>()
      .mockResolvedValue(existsForOrg),
    erase: vi.fn<OperatorContactEraser["erase"]>().mockResolvedValue(undefined),
    recordRequest: vi.fn<OperatorContactEraser["recordRequest"]>().mockResolvedValue(undefined),
  };
}

const hdr = {
  "Idempotency-Key": "erase-1",
  "x-org-id": "org_a",
  "x-principal-id": "operator_1",
};

describe("POST /api/:orgId/contacts/:contactId/erase - operator PDPA erasure via ingress", () => {
  it("200 + erases the contact through ingress, writes an audit row, persists a WorkTrace", async () => {
    const eraseContactWriter = makeEraser();
    const { app } = await buildTestServer({ eraseContactWriter });
    const prevCount = app.ingressTraceCount ?? 0;

    const res = await app.inject({
      method: "POST",
      url: "/api/org_a/contacts/contact_1/erase",
      headers: hdr,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "erased", contactId: "contact_1" });

    // Org-scope gate consulted, then the full cascade invoked, both scoped to the auth org.
    expect(eraseContactWriter.findContactForOrg).toHaveBeenCalledWith("org_a", "contact_1");
    expect(eraseContactWriter.erase).toHaveBeenCalledTimes(1);
    expect(eraseContactWriter.erase).toHaveBeenCalledWith("org_a", "contact_1");

    // Audit row written: attributed to the authenticated operator, completed.
    expect(eraseContactWriter.recordRequest).toHaveBeenCalledTimes(1);
    expect(eraseContactWriter.recordRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org_a",
        contactId: "contact_1",
        actorId: "operator_1",
        status: "completed",
      }),
    );

    // Exactly one WorkTrace, attributed to the operator_mutation mode + auth org.
    expect(app.ingressTraceCount).toBe(prevCount + 1);
    expect(app.lastIngressTrace!.intent).toBe(ERASE_CONTACT_INTENT);
    expect(app.lastIngressTrace!.mode).toBe("operator_mutation");
    expect(app.lastIngressTrace!.outcome).toBe("completed");
    expect(app.lastIngressTrace!.organizationId).toBe("org_a");

    await app.close();
  });

  it("auth org wins over a mismatched path :orgId — cross-tenant erase is denied (404), cascade never runs", async () => {
    // The contact does NOT exist under the AUTHENTICATED org (org_a); the path param org_b is
    // informational. Fail-closed: 404, and erase is never invoked.
    const eraseContactWriter = makeEraser(false);
    const { app } = await buildTestServer({ eraseContactWriter });

    const res = await app.inject({
      method: "POST",
      url: "/api/org_b/contacts/contact_1/erase",
      headers: hdr,
    });

    expect(res.statusCode).toBe(404);
    // Scope check ran against the AUTH org, not the path param.
    expect(eraseContactWriter.findContactForOrg).toHaveBeenCalledWith("org_a", "contact_1");
    expect(eraseContactWriter.erase).not.toHaveBeenCalled();
    await app.close();
  });

  it("404 when the contact is not found for the org", async () => {
    const eraseContactWriter = makeEraser(false);
    const { app } = await buildTestServer({ eraseContactWriter });

    const res = await app.inject({
      method: "POST",
      url: "/api/org_a/contacts/missing/erase",
      headers: hdr,
    });

    expect(res.statusCode).toBe(404);
    expect(eraseContactWriter.erase).not.toHaveBeenCalled();
    await app.close();
  });

  it("400 when the Idempotency-Key header is missing; erase not called", async () => {
    const eraseContactWriter = makeEraser();
    const { app } = await buildTestServer({ eraseContactWriter });

    const res = await app.inject({
      method: "POST",
      url: "/api/org_a/contacts/contact_1/erase",
      headers: { "x-org-id": "org_a", "x-principal-id": "operator_1" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "missing_idempotency_key" });
    expect(eraseContactWriter.erase).not.toHaveBeenCalled();
    await app.close();
  });

  it("ingress dedup: a same-key replay does not double-run the erase (cascade once, one WorkTrace)", async () => {
    // HTTP idempotency cache disabled, so the ONLY thing that can dedup the second call is
    // PlatformIngress step-0 (traceStore.getByIdempotencyKey). If that dedup were removed, the
    // erase cascade would run twice. Both assertions are load-bearing for the ingress path.
    const eraseContactWriter = makeEraser();
    const { app } = await buildTestServer({ eraseContactWriter, disableHttpIdempotency: true });
    const prevCount = app.ingressTraceCount ?? 0;

    const first = await app.inject({
      method: "POST",
      url: "/api/org_a/contacts/contact_1/erase",
      headers: hdr,
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: "POST",
      url: "/api/org_a/contacts/contact_1/erase",
      headers: hdr,
    });
    expect(second.statusCode).toBe(200);

    // The ingress short-circuited the second submit at step-0: erase ran exactly once and exactly
    // one WorkTrace was persisted (the replay returns the prior trace's outputs without re-running).
    expect(eraseContactWriter.erase).toHaveBeenCalledTimes(1);
    expect(app.ingressTraceCount).toBe(prevCount + 1);

    await app.close();
  });
});
