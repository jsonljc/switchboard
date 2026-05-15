import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import { cockpitActivityRoutes } from "../activity.js";
import type { CockpitActivityDeps } from "../../../lib/cockpit-activity-deps.js";
import type { ActivityPreviewReader, AuditEntryForTranslator } from "@switchboard/core";

function makePreviewReader(): ActivityPreviewReader {
  return {
    readRecentBatch: vi.fn(async () => ({})),
  };
}

function makeDeps(opts: {
  entries?: AuditEntryForTranslator[];
  previewReader?: ActivityPreviewReader;
  onFetch?: (args: { orgId: string; limit: number }) => void;
}): CockpitActivityDeps {
  return {
    previewReader: opts.previewReader ?? makePreviewReader(),
    fetchAuditEntries: vi.fn(async ({ orgId, limit }) => {
      opts.onFetch?.({ orgId, limit });
      return opts.entries ?? [];
    }),
  };
}

async function buildApp(deps: CockpitActivityDeps) {
  const app = Fastify({ logger: false });
  app.decorate("authDisabled", true);
  app.decorate("organizationIdFromAuth", undefined as string | undefined);
  app.decorate("principalIdFromAuth", undefined as string | undefined);
  app.addHook("onRequest", async (req) => {
    (req as unknown as { organizationIdFromAuth?: string }).organizationIdFromAuth = undefined;
    (req as unknown as { principalIdFromAuth?: string }).principalIdFromAuth = undefined;
  });
  await app.register(cockpitActivityRoutes(deps), { prefix: "/api/dashboard" });
  return app;
}

describe("cockpit /activity route", () => {
  it("returns 200 with empty rows when no audit entries exist", async () => {
    const deps = makeDeps({ entries: [] });
    const app = await buildApp(deps);
    const res = await app.inject({
      method: "GET",
      url: "/api/dashboard/agents/alex/activity",
      headers: { "x-org-id": "org-1" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ rows: [] });
  });

  it("clamps limit to MAX_LIMIT=200; deps fetched with limit=200", async () => {
    let fetched: { orgId: string; limit: number } | null = null;
    const deps = makeDeps({
      entries: [],
      onFetch: (args) => {
        fetched = args;
      },
    });
    const app = await buildApp(deps);
    const res = await app.inject({
      method: "GET",
      url: "/api/dashboard/agents/alex/activity?limit=999",
      headers: { "x-org-id": "org-1" },
    });
    expect(res.statusCode).toBe(200);
    expect(fetched).toEqual({ orgId: "org-1", limit: 200 });
  });

  it("returns 400 for unknown agentId", async () => {
    const deps = makeDeps({ entries: [] });
    const app = await buildApp(deps);
    const res = await app.inject({
      method: "GET",
      url: "/api/dashboard/agents/zzz/activity",
      headers: { "x-org-id": "org-1" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 404 for valid AgentKey outside agent-home (e.g., mira)", async () => {
    const deps = makeDeps({ entries: [] });
    const app = await buildApp(deps);
    const res = await app.inject({
      method: "GET",
      url: "/api/dashboard/agents/mira/activity",
      headers: { "x-org-id": "org-1" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("skips preview fetch when expandPreview=false", async () => {
    const reader = makePreviewReader();
    const deps = makeDeps({
      previewReader: reader,
      entries: [
        {
          id: "a1",
          eventType: "message.sent",
          timestamp: "2026-05-15T12:00:00.000Z",
          actorType: "agent",
          actorId: "alex",
          snapshot: { contactId: "c-1", contactName: "Sam" },
        },
      ],
    });
    const app = await buildApp(deps);
    const res = await app.inject({
      method: "GET",
      url: "/api/dashboard/agents/alex/activity?expandPreview=false",
      headers: { "x-org-id": "org-1" },
    });
    expect(res.statusCode).toBe(200);
    expect(reader.readRecentBatch).not.toHaveBeenCalled();
    const body = res.json() as { rows: Array<{ preview?: unknown }> };
    expect(body.rows.length).toBe(1);
    expect(body.rows[0]?.preview).toBeUndefined();
  });

  it("filters out entries belonging to a different agent", async () => {
    const deps = makeDeps({
      entries: [
        {
          id: "alex-1",
          eventType: "message.sent",
          timestamp: "2026-05-15T12:00:00.000Z",
          actorType: "agent",
          actorId: "alex",
          snapshot: {},
        },
        {
          id: "riley-1",
          eventType: "message.sent",
          timestamp: "2026-05-15T11:00:00.000Z",
          actorType: "agent",
          actorId: "riley",
          snapshot: {},
        },
      ],
    });
    const app = await buildApp(deps);
    const res = await app.inject({
      method: "GET",
      url: "/api/dashboard/agents/alex/activity?expandPreview=false",
      headers: { "x-org-id": "org-1" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { rows: Array<{ id: string }> };
    expect(body.rows.map((r) => r.id)).toEqual(["alex-1"]);
  });
});
