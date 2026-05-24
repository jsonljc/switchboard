import { describe, expect, it } from "vitest";
import { writeFileSync, mkdirSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { runErrorMode } from "../check-routes.js";

function fixtureRepo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "error-mode-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

const SCHEMAS_INDEX = "export interface Foo { id: string }\n";

describe("runErrorMode — header presence", () => {
  it("exits 1 when an api route that registers a route is missing a header", async () => {
    const root = fixtureRepo({
      "packages/schemas/src/index.ts": SCHEMAS_INDEX,
      "apps/api/src/routes/widgets.ts": [
        "import type { FastifyPluginAsync } from 'fastify';",
        "export const widgets: FastifyPluginAsync = async (app) => {",
        "  app.post('/x', async () => ({ ok: true }));",
        "};",
      ].join("\n"),
    });

    const r = await runErrorMode({ repoRoot: root });

    expect(r.missingHeaders).toContain("apps/api/src/routes/widgets.ts");
    expect(r.exitCode).toBe(1);
  });

  it("does NOT flag a routes/ helper that registers no route", async () => {
    const root = fixtureRepo({
      "packages/schemas/src/index.ts": SCHEMAS_INDEX,
      "apps/api/src/routes/helper.ts": [
        "export function resolveThing(cartridgeId: string) {",
        "  const cartridges = new Map<string, string>();",
        "  return cartridges.get(cartridgeId);",
        "}",
      ].join("\n"),
    });

    const r = await runErrorMode({ repoRoot: root });

    expect(r.missingHeaders).not.toContain("apps/api/src/routes/helper.ts");
    expect(r.missingHeaders).toEqual([]);
    expect(r.exitCode).toBe(0);
  });

  it("exits 0 when a dashboard /dashboard/ proxy route has no header (convention covers it)", async () => {
    const root = fixtureRepo({
      "packages/schemas/src/index.ts": SCHEMAS_INDEX,
      "apps/dashboard/src/app/api/dashboard/x/route.ts": "export async function GET() {}\n",
    });

    const r = await runErrorMode({ repoRoot: root });

    expect(r.missingHeaders).toEqual([]);
    expect(r.exitCode).toBe(0);
  });

  it("exits 1 when a dashboard NON-/dashboard/ route has no header", async () => {
    const root = fixtureRepo({
      "packages/schemas/src/index.ts": SCHEMAS_INDEX,
      "apps/dashboard/src/app/api/waitlist/route.ts": "export async function POST() {}\n",
    });

    const r = await runErrorMode({ repoRoot: root });

    expect(r.missingHeaders).toContain("apps/dashboard/src/app/api/waitlist/route.ts");
    expect(r.exitCode).toBe(1);
  });
});

describe("runErrorMode — store mutations", () => {
  it("exits 1 on an un-scoped store mutation", async () => {
    const root = fixtureRepo({
      "packages/schemas/src/index.ts": SCHEMAS_INDEX,
      "packages/db/src/stores/x.ts": [
        "export class XStore {",
        "  async markDone(id: string) {",
        "    await this.prisma.contact.update({ where: { id }, data: {} });",
        "  }",
        "}",
      ].join("\n"),
    });

    const r = await runErrorMode({ repoRoot: root });

    expect(r.violations.length).toBeGreaterThanOrEqual(1);
    expect(r.exitCode).toBe(1);
  });
});

describe("runErrorMode — schema enum guard", () => {
  it("exits 1 (hard-fail) when the schemas index is empty/missing", async () => {
    const root = fixtureRepo({
      "packages/schemas/src/index.ts": "",
      "apps/api/src/routes/widgets.ts": [
        "// @route-class: operator-direct",
        "import type { FastifyPluginAsync } from 'fastify';",
        "import { requireIdempotencyKey } from './x.js';",
        "import { requireOrgForMutation } from './y.js';",
        "export const widgets: FastifyPluginAsync = async (app) => {",
        "  app.post('/x', { preHandler: [requireOrgForMutation] }, async () => {",
        "    requireIdempotencyKey();",
        "    return { ok: true };",
        "  });",
        "};",
      ].join("\n"),
    });

    const r = await runErrorMode({ repoRoot: root });

    expect(r.schemaEnumEmpty).toBe(true);
    expect(r.exitCode).toBe(1);
  });
});

describe("runErrorMode — clean tree", () => {
  it("exits 0 on a fully clean tree", async () => {
    const root = fixtureRepo({
      "packages/schemas/src/index.ts": SCHEMAS_INDEX,
      "apps/api/src/routes/widgets.ts": [
        "// @route-class: operator-direct",
        "import type { FastifyPluginAsync } from 'fastify';",
        "import { requireIdempotencyKey } from './x.js';",
        "import { requireOrgForMutation } from './y.js';",
        "export const widgets: FastifyPluginAsync = async (app) => {",
        "  app.post('/x', { preHandler: [requireOrgForMutation] }, async () => {",
        "    requireIdempotencyKey();",
        "    return { ok: true };",
        "  });",
        "};",
      ].join("\n"),
      "packages/db/src/stores/x.ts": [
        "export class XStore {",
        "  async markDone(organizationId: string, id: string) {",
        "    await this.prisma.contact.update({ where: { id, organizationId }, data: {} });",
        "  }",
        "}",
      ].join("\n"),
    });

    const r = await runErrorMode({ repoRoot: root });

    expect(r.violations).toEqual([]);
    expect(r.missingHeaders).toEqual([]);
    expect(r.schemaEnumEmpty).toBe(false);
    expect(r.exitCode).toBe(0);
  });
});
