/**
 * EV-14 / CHAN-1 — cross-tenant route sweep, data lane:
 * knowledge, knowledge-entries, token-usage, scheduled-reports, webhooks,
 * and the competence control-plane SURFACE note.
 *
 * Same contract as the core lane: auth-enabled Fastify, bearer->org preHandler,
 * faithful org-filtering fakes; assert BEHAVIOR (org A cannot read/mutate org B)
 * + MECHANISM (WHERE carried organizationId = authOrg). TEST-ONLY.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { knowledgeRoutes } from "../routes/knowledge.js";
import { knowledgeEntryRoutes } from "../routes/knowledge-entries.js";
import { tokenUsageRoutes } from "../routes/token-usage.js";
import { scheduledReportsRoutes } from "../routes/scheduled-reports.js";
import { webhooksRoutes } from "../routes/webhooks.js";
import { competenceRoutes } from "../routes/competence.js";
import {
  baseScopedApp,
  orgTable,
  ORG_A,
  ORG_B,
  HEADERS_A,
  HEADERS_B,
  HEADERS_UNSCOPED,
} from "./cross-tenant-sweep-harness.js";

const operatorIdentity = {
  getPrincipal: vi.fn(async (id: string) =>
    id ? { id, type: "user", name: id, organizationId: null, roles: ["operator"] } : null,
  ),
};

// ===========================================================================
// knowledge  (GET /documents, DELETE /documents/:documentId, POST /upload)
// ===========================================================================

describe("CHAN-1 cross-tenant: knowledge", () => {
  let app: FastifyInstance;
  let knowledgeChunk: ReturnType<typeof orgTable>;
  let executeRaw: ReturnType<typeof vi.fn>;

  const chunk = (orgId: string, documentId: string) => ({
    id: `chunk_${documentId}`,
    organizationId: orgId,
    agentId: "global",
    documentId,
    sourceType: "document",
    createdAt: new Date("2026-06-01T00:00:00Z"),
    metadata: { fileName: `${documentId}.txt` },
  });

  beforeEach(async () => {
    app = await baseScopedApp();
    knowledgeChunk = orgTable([chunk(ORG_A, "doc_A"), chunk(ORG_B, "doc_B")]);
    executeRaw = vi.fn(async () => 1);
    app.decorate("prisma", { knowledgeChunk, $executeRaw: executeRaw } as unknown as never);
    // ingestionPipeline intentionally absent -> upload uses the org-bound raw path.
    await app.register(knowledgeRoutes, { prefix: "/api/knowledge" });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("GET /documents lists only the authenticated org's documents", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/knowledge/documents",
      headers: HEADERS_A,
    });
    expect(res.statusCode).toBe(200);
    const docs = res.json().documents.map((d: { documentId: string }) => d.documentId);
    expect(docs).toEqual(["doc_A"]);
    expect(docs).not.toContain("doc_B");
    expect(knowledgeChunk.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: ORG_A }) }),
    );
  });

  it("DELETE /documents/:id cannot delete another org's chunks (deleted=0, rows survive)", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/api/knowledge/documents/doc_B",
      headers: HEADERS_A,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().deleted).toBe(0);
    // ORG_B's chunk must still exist (the deleteMany was org-scoped to ORG_A).
    expect(knowledgeChunk.rows().some((r) => r.documentId === "doc_B")).toBe(true);
    expect(knowledgeChunk.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ documentId: "doc_B", organizationId: ORG_A }),
      }),
    );
  });

  it("POST /upload binds new chunks to the authenticated org (not a body-supplied org)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/knowledge/upload",
      headers: HEADERS_A,
      payload: { content: "hello world", fileName: "f.txt", organizationId: ORG_B },
    });
    expect(res.statusCode).toBe(201);
    // Tagged-template args: [strings, chunkId, orgId, ...] -> orgId is index 2.
    expect(executeRaw).toHaveBeenCalled();
    const orgArgs = executeRaw.mock.calls.map((c) => c[2]);
    expect(orgArgs).toContain(ORG_A);
    expect(orgArgs).not.toContain(ORG_B);
  });

  it("GET /documents rejects an unscoped key with 403", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/knowledge/documents",
      headers: HEADERS_UNSCOPED,
    });
    expect(res.statusCode).toBe(403);
  });
});

// ===========================================================================
// knowledge-entries  (GET /, GET /:id, PATCH /:id, DELETE /:id)
// ===========================================================================

describe("CHAN-1 cross-tenant: knowledge-entries", () => {
  let app: FastifyInstance;
  let knowledgeEntry: ReturnType<typeof orgTable>;

  const entry = (orgId: string, id: string) => ({
    id,
    organizationId: orgId,
    kind: "fact",
    scope: "global",
    title: id,
    content: "c",
    priority: 1,
    version: 1,
    active: true,
    createdAt: new Date("2026-06-01T00:00:00Z"),
    updatedAt: new Date("2026-06-01T00:00:00Z"),
  });

  beforeEach(async () => {
    app = await baseScopedApp();
    knowledgeEntry = orgTable([entry(ORG_A, "ke_A"), entry(ORG_B, "ke_B")]);
    app.decorate("prisma", { knowledgeEntry } as unknown as never);
    await app.register(knowledgeEntryRoutes, { prefix: "/api/knowledge-entries" });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("GET / lists only the authenticated org's entries", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/knowledge-entries",
      headers: HEADERS_A,
    });
    expect(res.statusCode).toBe(200);
    const ids = res.json().entries.map((e: { id: string }) => e.id);
    expect(ids).toEqual(["ke_A"]);
    expect(knowledgeEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: ORG_A }) }),
    );
  });

  it("GET /:id returns 404 for another org's entry", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/knowledge-entries/ke_B",
      headers: HEADERS_A,
    });
    expect(res.statusCode).toBe(404);
  });

  it("PATCH /:id cannot update another org's entry (404)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/knowledge-entries/ke_B",
      headers: HEADERS_A,
      payload: { title: "hijacked" },
    });
    expect(res.statusCode).toBe(404);
    // ke_B's title must be untouched.
    expect(knowledgeEntry.rows().find((r) => r.id === "ke_B")?.title).toBe("ke_B");
  });

  it("DELETE /:id cannot deactivate another org's entry (404, row stays active)", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/api/knowledge-entries/ke_B",
      headers: HEADERS_A,
    });
    expect(res.statusCode).toBe(404);
    expect(knowledgeEntry.rows().find((r) => r.id === "ke_B")?.active).toBe(true);
    expect(knowledgeEntry.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "ke_B", organizationId: ORG_A }),
      }),
    );
  });
});

// ===========================================================================
// token-usage  (GET /)  — Redis keys are org-namespaced
// ===========================================================================

describe("CHAN-1 cross-tenant: token-usage", () => {
  let app: FastifyInstance;
  let requestedKeys: string[];

  beforeEach(async () => {
    app = await baseScopedApp();
    const today = new Date().toISOString().slice(0, 10);
    const data = new Map<string, Record<string, string> | string>([
      [`tokenusage:${ORG_A}:${today}`, { prompt: "100", completion: "50" }],
      [`tokencost:${ORG_A}:${today}`, "0"],
      [`tokenusage:${ORG_B}:${today}`, { prompt: "999", completion: "999" }],
      [`tokencost:${ORG_B}:${today}`, "0"],
    ]);
    requestedKeys = [];
    const redis = {
      pipeline() {
        const ops: string[] = [];
        const p = {
          hgetall(key: string) {
            requestedKeys.push(key);
            ops.push(key);
            return p;
          },
          get(key: string) {
            requestedKeys.push(key);
            ops.push(key);
            return p;
          },
          async exec() {
            return ops.map((key) => [null, data.get(key) ?? null] as [null, unknown]);
          },
        };
        return p;
      },
    };
    app.decorate("redis", redis as unknown as never);
    await app.register(tokenUsageRoutes, { prefix: "/api/token-usage" });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("GET / reads only the authenticated org's Redis keys", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/token-usage?period=daily",
      headers: HEADERS_A,
    });
    expect(res.statusCode).toBe(200);
    // ORG_A's numbers, never ORG_B's (999).
    expect(res.json().usage.promptTokens).toBe(100);
    expect(res.json().usage.completionTokens).toBe(50);
    // Every requested key is namespaced to ORG_A; none touch ORG_B.
    expect(requestedKeys.length).toBeGreaterThan(0);
    expect(requestedKeys.every((k) => k.includes(`:${ORG_A}:`))).toBe(true);
    expect(requestedKeys.some((k) => k.includes(`:${ORG_B}:`))).toBe(false);
  });

  it("GET / rejects an unscoped key with 403", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/token-usage",
      headers: HEADERS_UNSCOPED,
    });
    expect(res.statusCode).toBe(403);
  });
});

// ===========================================================================
// scheduled-reports  (GET /, PUT /:id, DELETE /:id, POST /:id/run)
// ===========================================================================

describe("CHAN-1 cross-tenant: scheduled-reports", () => {
  let app: FastifyInstance;
  let scheduledReport: ReturnType<typeof orgTable>;

  const report = (orgId: string, id: string) => ({
    id,
    organizationId: orgId,
    name: id,
    cronExpression: "0 0 * * *",
    timezone: "UTC",
    reportType: "funnel",
    vertical: "commerce",
    platform: "meta",
    deliveryChannels: [],
    deliveryTargets: [],
    enabled: true,
    createdAt: new Date("2026-06-01T00:00:00Z"),
  });

  beforeEach(async () => {
    app = await baseScopedApp();
    scheduledReport = orgTable([report(ORG_A, "sr_A"), report(ORG_B, "sr_B")]);
    // scheduled-reports captures app.prisma at register time — decorate first.
    app.decorate("prisma", { scheduledReport } as unknown as never);
    await app.register(scheduledReportsRoutes, { prefix: "/api/scheduled-reports" });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("GET / lists only the authenticated org's reports", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/scheduled-reports",
      headers: HEADERS_A,
    });
    expect(res.statusCode).toBe(200);
    const ids = res.json().reports.map((r: { id: string }) => r.id);
    expect(ids).toEqual(["sr_A"]);
    expect(scheduledReport.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: ORG_A }) }),
    );
  });

  it("PUT /:id cannot update another org's report (404, no write)", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/scheduled-reports/sr_B",
      headers: HEADERS_A,
      payload: { name: "hijacked" },
    });
    expect(res.statusCode).toBe(404);
    expect(scheduledReport.rows().find((r) => r.id === "sr_B")?.name).toBe("sr_B");
    expect(scheduledReport.update).not.toHaveBeenCalled();
  });

  it("DELETE /:id cannot delete another org's report (404, no write)", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/api/scheduled-reports/sr_B",
      headers: HEADERS_A,
    });
    expect(res.statusCode).toBe(404);
    expect(scheduledReport.rows().some((r) => r.id === "sr_B")).toBe(true);
    expect(scheduledReport.delete).not.toHaveBeenCalled();
  });

  it("POST /:id/run cannot trigger another org's report (404)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/scheduled-reports/sr_B/run",
      headers: HEADERS_A,
    });
    expect(res.statusCode).toBe(404);
  });

  it("GET / rejects an unscoped key with 403", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/scheduled-reports",
      headers: HEADERS_UNSCOPED,
    });
    expect(res.statusCode).toBe(403);
  });
});

// ===========================================================================
// webhooks  (GET /, DELETE /:id, POST /:id/test)
// ===========================================================================

describe("CHAN-1 cross-tenant: webhooks", () => {
  let app: FastifyInstance;
  let webhookRegistration: ReturnType<typeof orgTable>;

  const hook = (orgId: string, id: string) => ({
    id,
    organizationId: orgId,
    url: "https://example.com/hook",
    events: ["x"],
    secret: `secret_${id}`,
    active: true,
    createdAt: new Date("2026-06-01T00:00:00Z"),
    lastTriggeredAt: null,
  });

  beforeEach(async () => {
    app = await baseScopedApp();
    webhookRegistration = orgTable([hook(ORG_A, "wh_A"), hook(ORG_B, "wh_B")]);
    app.decorate("prisma", { webhookRegistration } as unknown as never);
    app.decorate("storageContext", { identity: operatorIdentity } as unknown as never);
    await app.register(webhooksRoutes, { prefix: "/api/webhooks" });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("GET / lists only the authenticated org's webhooks (and never the secret)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/webhooks", headers: HEADERS_A });
    expect(res.statusCode).toBe(200);
    const ids = res.json().webhooks.map((w: { id: string }) => w.id);
    expect(ids).toEqual(["wh_A"]);
    expect(res.json().webhooks[0].secret).toBeUndefined();
    expect(webhookRegistration.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: ORG_A }) }),
    );
  });

  it("DELETE /:id cannot deregister another org's webhook (403, stays active)", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/api/webhooks/wh_B",
      headers: HEADERS_A,
    });
    expect(res.statusCode).toBe(403);
    expect(webhookRegistration.rows().find((r) => r.id === "wh_B")?.active).toBe(true);
    expect(webhookRegistration.update).not.toHaveBeenCalled();
  });

  it("POST /:id/test cannot probe another org's webhook (403, no fetch)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const res = await app.inject({
      method: "POST",
      url: "/api/webhooks/wh_B/test",
      headers: HEADERS_A,
    });
    expect(res.statusCode).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("GET / rejects an unscoped key with 403", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/webhooks",
      headers: HEADERS_UNSCOPED,
    });
    expect(res.statusCode).toBe(403);
  });
});

// ===========================================================================
// competence — SURFACE: platform-global control-plane (NOT tenant-private)
// ===========================================================================

describe("CHAN-1 SURFACE: competence is platform-global (no org boundary)", () => {
  let app: FastifyInstance;
  let competencePolicy: ReturnType<typeof orgTable>;

  beforeEach(async () => {
    app = await baseScopedApp();
    // CompetencePolicy / CompetenceRecord have NO organizationId column in the
    // Prisma schema — they are platform-global. The route does no org scoping.
    competencePolicy = orgTable([
      { id: "cp1", name: "global-1", thresholds: {}, enabled: true },
      { id: "cp2", name: "global-2", thresholds: {}, enabled: true },
    ]);
    app.decorate("prisma", { competencePolicy } as unknown as never);
    await app.register(competenceRoutes, { prefix: "/api/competence" });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  // Documents the finding (flagged for human review): any org-scoped key reads
  // the SAME global competence-policy set. There is no per-org data to isolate;
  // making competence tenant-private would require a schema migration (org column)
  // + WHERE scoping — out of scope for this test-only sweep.
  it("SURFACE: both orgs read the identical global policy set (no org filter in WHERE)", async () => {
    const a = await app.inject({
      method: "GET",
      url: "/api/competence/policies",
      headers: HEADERS_A,
    });
    const b = await app.inject({
      method: "GET",
      url: "/api/competence/policies",
      headers: HEADERS_B,
    });
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    const idsA = a.json().policies.map((p: { id: string }) => p.id);
    const idsB = b.json().policies.map((p: { id: string }) => p.id);
    expect(idsA).toEqual(["cp1", "cp2"]);
    expect(idsB).toEqual(["cp1", "cp2"]);
    // No call carried an organizationId filter (the route has none to give).
    expect(competencePolicy.findMany).toHaveBeenCalledWith(
      expect.not.objectContaining({ where: expect.anything() }),
    );
  });

  it("SURFACE: any org-scoped key can delete a global policy by id (no org gate)", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/api/competence/policies/cp1",
      headers: HEADERS_A,
    });
    expect(res.statusCode).toBe(200);
    expect(competencePolicy.delete).toHaveBeenCalledWith({ where: { id: "cp1" } });
  });
});
