/**
 * D5-2b: DELETE /api/policies/:id must refuse (409) to delete a require_approval
 * policy when a matching `allow` policy for the same actionType would survive,
 * because "allow alone EXECUTES" (riley-pause-gate.test.ts pins the decomposition).
 * Driven through the REAL route + REAL in-memory policy store via buildTestServer.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestServer, type TestContext } from "./test-server.js";

const PAUSE_RULE = {
  conditions: [
    { field: "actionType", operator: "matches", value: "^adoptimizer\\.campaign\\.pause$" },
  ],
};

async function createPolicy(
  app: FastifyInstance,
  over: { name: string; effect: string; rule?: unknown; approvalRequirement?: string },
): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/policies",
    payload: {
      name: over.name,
      description: over.name,
      organizationId: null,
      cartridgeId: null,
      priority: 50,
      active: true,
      rule: over.rule ?? PAUSE_RULE,
      effect: over.effect,
      ...(over.approvalRequirement ? { approvalRequirement: over.approvalRequirement } : {}),
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json().policy.id as string;
}

describe("DELETE /api/policies/:id orphan guard (D5-2b)", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    const ctx: TestContext = await buildTestServer();
    app = ctx.app;
  });

  afterEach(async () => {
    await app.close();
  });

  it("409s when deleting a require_approval policy would orphan a matching allow policy", async () => {
    await createPolicy(app, { name: "pause allow", effect: "allow" });
    const approvalId = await createPolicy(app, {
      name: "pause approval",
      effect: "require_approval",
      approvalRequirement: "mandatory",
    });

    const res = await app.inject({ method: "DELETE", url: `/api/policies/${approvalId}` });
    expect(res.statusCode).toBe(409);

    // Refused, not deleted: the approval row still gates the pause.
    const get = await app.inject({ method: "GET", url: `/api/policies/${approvalId}` });
    expect(get.statusCode).toBe(200);
  });

  it("allows deleting the require_approval policy when no matching allow exists", async () => {
    const approvalId = await createPolicy(app, {
      name: "lone approval",
      effect: "require_approval",
      approvalRequirement: "mandatory",
    });
    const res = await app.inject({ method: "DELETE", url: `/api/policies/${approvalId}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().deleted).toBe(true);
  });

  it("allows deleting an allow policy even while a require_approval sibling survives (approval-alone is safe)", async () => {
    const allowId = await createPolicy(app, { name: "pause allow", effect: "allow" });
    await createPolicy(app, {
      name: "pause approval",
      effect: "require_approval",
      approvalRequirement: "mandatory",
    });
    const res = await app.inject({ method: "DELETE", url: `/api/policies/${allowId}` });
    expect(res.statusCode).toBe(200);
  });

  it("allows deleting a require_approval policy whose allow sibling targets a DIFFERENT actionType", async () => {
    await createPolicy(app, {
      name: "unrelated allow",
      effect: "allow",
      rule: {
        conditions: [{ field: "actionType", operator: "matches", value: "^other\\.action$" }],
      },
    });
    const approvalId = await createPolicy(app, {
      name: "pause approval",
      effect: "require_approval",
      approvalRequirement: "mandatory",
    });
    const res = await app.inject({ method: "DELETE", url: `/api/policies/${approvalId}` });
    expect(res.statusCode).toBe(200);
  });
});
