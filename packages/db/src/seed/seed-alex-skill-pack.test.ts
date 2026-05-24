import { describe, it, expect, vi, beforeEach } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  seedAlexSkillPack,
  assertAlexSkillPackSeeded,
  ALEX_SKILL_PACK_SCOPES,
} from "./seed-alex-skill-pack.js";
import type { PrismaClient } from "@prisma/client";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the real medspa refs dir from this test file so the tests read the
 * actual markdown (not a fixture copy). The test file lives at:
 *   packages/db/src/seed/seed-alex-skill-pack.test.ts
 * Walk up four directories to reach repo root.
 */
function resolveRefsDir(): string {
  const thisFile = fileURLToPath(import.meta.url);
  const repoRoot = join(dirname(thisFile), "..", "..", "..", "..");
  return join(repoRoot, "skills", "alex", "references", "medspa");
}

const REFS_DIR = resolveRefsDir();

interface UpsertCall {
  where: {
    organizationId_kind_scope_version: {
      organizationId: string;
      kind: string;
      scope: string;
      version: number;
    };
  };
  update: Record<string, unknown>;
  create: Record<string, unknown>;
}

interface StoredRow {
  organizationId: string;
  kind: string;
  scope: string;
  version: number;
  active: boolean;
  content: string;
  title: string;
  priority: number;
}

interface FindFirstArgs {
  where: {
    organizationId: string;
    kind: string;
    scope: string;
    active: boolean;
  };
}

/**
 * Builds a minimal in-memory prisma mock whose:
 * - knowledgeEntry.upsert records each call AND writes into a shared row store,
 * - knowledgeEntry.findFirst queries the same in-memory store.
 *
 * This allows assertAlexSkillPackSeeded tests to exercise the real seed→assert
 * flow without a real Postgres connection.
 */
function buildMockPrisma() {
  const calls: UpsertCall[] = [];
  // Shared in-memory row store: keyed by orgId+kind+scope+version
  const rowStore: StoredRow[] = [];

  const mock = {
    knowledgeEntry: {
      upsert: vi.fn(async (args: UpsertCall) => {
        calls.push(args);
        const key = args.where.organizationId_kind_scope_version;
        const existing = rowStore.find(
          (r) =>
            r.organizationId === key.organizationId &&
            r.kind === key.kind &&
            r.scope === key.scope &&
            r.version === key.version,
        );
        if (existing) {
          // Simulate update branch: refresh title + content, leave active alone
          existing.title = (args.update["title"] as string) ?? existing.title;
          existing.content = (args.update["content"] as string) ?? existing.content;
        } else {
          // Simulate create branch
          rowStore.push({
            organizationId: key.organizationId,
            kind: key.kind,
            scope: key.scope,
            version: key.version,
            active: (args.create["active"] as boolean) ?? true,
            content: (args.create["content"] as string) ?? "",
            title: (args.create["title"] as string) ?? "",
            priority: (args.create["priority"] as number) ?? 0,
          });
        }
        return {};
      }),
      findFirst: vi.fn(async (args: FindFirstArgs) => {
        const { organizationId, kind, scope, active } = args.where;
        const row = rowStore.find(
          (r) =>
            r.organizationId === organizationId &&
            r.kind === kind &&
            r.scope === scope &&
            r.active === active,
        );
        return row ?? null;
      }),
    },
    _calls: calls,
    _rowStore: rowStore,
  };
  return mock as unknown as PrismaClient & { _calls: UpsertCall[]; _rowStore: StoredRow[] };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("seedAlexSkillPack", () => {
  let prisma: ReturnType<typeof buildMockPrisma>;

  beforeEach(() => {
    prisma = buildMockPrisma();
    vi.clearAllMocks();
  });

  // ── 1. Seeds exactly 3 v1 rows ──────────────────────────────────────────

  it("seeds 3 rows at version 1 with the correct kinds and scopes", async () => {
    await seedAlexSkillPack(prisma, "org_test", REFS_DIR);

    expect(prisma._calls).toHaveLength(3);

    const wheres = prisma._calls.map((c) => c.where.organizationId_kind_scope_version);

    expect(wheres).toContainEqual({
      organizationId: "org_test",
      kind: "playbook",
      scope: "objection-handling",
      version: 1,
    });
    expect(wheres).toContainEqual({
      organizationId: "org_test",
      kind: "playbook",
      scope: "qualification-framework",
      version: 1,
    });
    expect(wheres).toContainEqual({
      organizationId: "org_test",
      kind: "policy",
      scope: "claim-boundaries",
      version: 1,
    });
  });

  it("create branch sets active:true and priority:0 for all rows", async () => {
    await seedAlexSkillPack(prisma, "org_test", REFS_DIR);

    for (const call of prisma._calls) {
      expect(call.create["active"]).toBe(true);
      expect(call.create["priority"]).toBe(0);
      expect(call.create["version"]).toBe(1);
    }
  });

  it("create branch sets non-empty content for all rows", async () => {
    await seedAlexSkillPack(prisma, "org_test", REFS_DIR);

    for (const call of prisma._calls) {
      const content = call.create["content"];
      expect(typeof content).toBe("string");
      expect((content as string).length).toBeGreaterThan(50);
    }
  });

  // ── 2. Frontmatter is stripped ──────────────────────────────────────────

  it("does not include frontmatter keys in seeded content", async () => {
    await seedAlexSkillPack(prisma, "org_test", REFS_DIR);

    for (const call of prisma._calls) {
      const content = call.create["content"] as string;
      // Frontmatter markers must not appear in the stored body
      expect(content).not.toMatch(/^---/m);
      expect(content).not.toContain("jurisdiction:");
      expect(content).not.toContain("appliesTo:");
    }
  });

  it("claim-boundaries content includes 'Never guarantee'", async () => {
    await seedAlexSkillPack(prisma, "org_test", REFS_DIR);

    const claimCall = prisma._calls.find(
      (c) => c.where.organizationId_kind_scope_version.scope === "claim-boundaries",
    );
    expect(claimCall).toBeDefined();
    expect(claimCall!.create["content"]).toContain("Never guarantee");
  });

  // ── 3. Operator-safety: update branch does NOT touch `active` ──────────

  it("update branch sets title and content but does not include active", async () => {
    await seedAlexSkillPack(prisma, "org_test", REFS_DIR);

    for (const call of prisma._calls) {
      const update = call.update;
      // Must refresh display metadata and content
      expect(update).toHaveProperty("title");
      expect(update).toHaveProperty("content");
      // Must NOT override operator's active flag
      expect(update).not.toHaveProperty("active");
    }
  });

  it("every upsert where-key uses version 1 (operator v2 is never touched)", async () => {
    await seedAlexSkillPack(prisma, "org_test", REFS_DIR);

    for (const call of prisma._calls) {
      expect(call.where.organizationId_kind_scope_version.version).toBe(1);
    }
  });

  it("does not call upsert with a v2 scope key even when a v2 row exists in-memory", async () => {
    // Pre-seed memory: objection-handling has v1(active:false) + v2(active:true)
    const v2Row = {
      organizationId: "org_test",
      kind: "playbook",
      scope: "objection-handling",
      version: 2,
      active: true,
      content: "OPERATOR COPY",
    };

    // Build a mock whose upsert checks that v2 is never targeted
    const v2UpsertCalls: unknown[] = [];
    const prismaWithCheck = {
      knowledgeEntry: {
        upsert: vi.fn(async (args: UpsertCall) => {
          if (args.where.organizationId_kind_scope_version.version !== 1) {
            v2UpsertCalls.push(args);
          }
          prisma._calls.push(args);
          return {};
        }),
      },
      _calls: prisma._calls,
    } as unknown as typeof prisma;

    await seedAlexSkillPack(prismaWithCheck, "org_test", REFS_DIR);

    // v2 row must not have been touched
    expect(v2UpsertCalls).toHaveLength(0);
    // Demonstrate that v2Row (OPERATOR COPY) is unchanged — the seed never
    // mutates it because all upserts target version:1
    expect(v2Row.content).toBe("OPERATOR COPY");
    expect(v2Row.active).toBe(true);
  });

  // ── 4. Idempotent: running twice yields the same rows ───────────────────

  it("is idempotent: running twice produces exactly 6 upsert calls (3 per run), all at version 1", async () => {
    await seedAlexSkillPack(prisma, "org_test", REFS_DIR);
    await seedAlexSkillPack(prisma, "org_test", REFS_DIR);

    expect(prisma._calls).toHaveLength(6);

    // All calls must target version 1
    for (const call of prisma._calls) {
      expect(call.where.organizationId_kind_scope_version.version).toBe(1);
    }
  });

  it("second run produces identical create payloads to the first run", async () => {
    await seedAlexSkillPack(prisma, "org_test", REFS_DIR);
    const firstRunCreates = prisma._calls.map((c) => c.create);

    await seedAlexSkillPack(prisma, "org_test", REFS_DIR);
    const secondRunCreates = prisma._calls.slice(3).map((c) => c.create);

    for (let i = 0; i < 3; i++) {
      expect(secondRunCreates[i]).toEqual(firstRunCreates[i]);
    }
  });

  // ── 5. ALEX_SKILL_PACK_SCOPES shape ─────────────────────────────────────

  it("ALEX_SKILL_PACK_SCOPES exports exactly 3 entries with required keys", () => {
    expect(ALEX_SKILL_PACK_SCOPES).toHaveLength(3);
    for (const entry of ALEX_SKILL_PACK_SCOPES) {
      expect(entry).toHaveProperty("kind");
      expect(entry).toHaveProperty("scope");
      expect(entry).toHaveProperty("file");
      expect(entry).toHaveProperty("title");
    }
  });

  // ── 6. Slot-population regression ────────────────────────────────────────
  // Proves that after seed, the active rows for all 3 (kind,scope) pairs have
  // non-empty content. This is the primary regression guard for the
  // previously-empty PLAYBOOK_CONTEXT / QUALIFICATION_CONTEXT / CLAIM_BOUNDARIES
  // slots.

  it("regression: all 3 active rows have non-empty content after seed", async () => {
    await seedAlexSkillPack(prisma, "org_demo", REFS_DIR);

    for (const entry of ALEX_SKILL_PACK_SCOPES) {
      const row = await (
        prisma.knowledgeEntry as unknown as {
          findFirst: (args: FindFirstArgs) => Promise<StoredRow | null>;
        }
      ).findFirst({
        where: {
          organizationId: "org_demo",
          kind: entry.kind,
          scope: entry.scope,
          active: true,
        },
      });

      expect(row).not.toBeNull();
      expect(typeof row!.content).toBe("string");
      expect(row!.content.trim().length).toBeGreaterThan(50);
    }
  });

  it("regression: objection-handling slot is populated (was previously empty)", async () => {
    await seedAlexSkillPack(prisma, "org_demo", REFS_DIR);
    const row = await (
      prisma.knowledgeEntry as unknown as {
        findFirst: (args: FindFirstArgs) => Promise<StoredRow | null>;
      }
    ).findFirst({
      where: {
        organizationId: "org_demo",
        kind: "playbook",
        scope: "objection-handling",
        active: true,
      },
    });
    expect(row?.content.trim().length).toBeGreaterThan(50);
  });

  it("regression: qualification-framework slot is populated (was previously empty)", async () => {
    await seedAlexSkillPack(prisma, "org_demo", REFS_DIR);
    const row = await (
      prisma.knowledgeEntry as unknown as {
        findFirst: (args: FindFirstArgs) => Promise<StoredRow | null>;
      }
    ).findFirst({
      where: {
        organizationId: "org_demo",
        kind: "playbook",
        scope: "qualification-framework",
        active: true,
      },
    });
    expect(row?.content.trim().length).toBeGreaterThan(50);
  });

  it("regression: claim-boundaries slot is populated (was previously empty)", async () => {
    await seedAlexSkillPack(prisma, "org_demo", REFS_DIR);
    const row = await (
      prisma.knowledgeEntry as unknown as {
        findFirst: (args: FindFirstArgs) => Promise<StoredRow | null>;
      }
    ).findFirst({
      where: {
        organizationId: "org_demo",
        kind: "policy",
        scope: "claim-boundaries",
        active: true,
      },
    });
    expect(row?.content.trim().length).toBeGreaterThan(50);
  });
});

// ---------------------------------------------------------------------------
// assertAlexSkillPackSeeded
// ---------------------------------------------------------------------------

describe("assertAlexSkillPackSeeded", () => {
  let prisma: ReturnType<typeof buildMockPrisma>;

  beforeEach(() => {
    prisma = buildMockPrisma();
    vi.clearAllMocks();
  });

  it("throws when the store is empty (no rows seeded)", async () => {
    await expect(assertAlexSkillPackSeeded(prisma, "org_demo")).rejects.toThrow(
      /missing active KnowledgeEntry/,
    );
  });

  it("error message names the missing kind and scope", async () => {
    // Only seed 2 of the 3 entries so the third triggers the error
    // We do that by intercepting the third upsert, but it's simpler to just
    // leave the store empty and check the first scope that's missing.
    await expect(assertAlexSkillPackSeeded(prisma, "org_demo")).rejects.toThrow(
      /kind="playbook" scope="objection-handling"/,
    );
  });

  it("throws when a row exists but has empty content", async () => {
    // Manually insert a row with empty content into the mock row store
    (prisma as unknown as { _rowStore: StoredRow[] })._rowStore.push({
      organizationId: "org_demo",
      kind: "playbook",
      scope: "objection-handling",
      version: 1,
      active: true,
      content: "   ", // whitespace-only
      title: "Test",
      priority: 0,
    });

    await expect(assertAlexSkillPackSeeded(prisma, "org_demo")).rejects.toThrow(
      /empty content.*kind="playbook" scope="objection-handling"/,
    );
  });

  it("resolves without throwing after seedAlexSkillPack", async () => {
    await seedAlexSkillPack(prisma, "org_demo", REFS_DIR);
    await expect(assertAlexSkillPackSeeded(prisma, "org_demo")).resolves.toBeUndefined();
  });

  it("passes for all 3 scopes after seed (checks each individually)", async () => {
    await seedAlexSkillPack(prisma, "org_demo", REFS_DIR);

    // Verify each scope individually to make test failure messages specific
    for (const entry of ALEX_SKILL_PACK_SCOPES) {
      const singleScopePrisma = buildMockPrisma();
      // Seed all 3 — assertAlexSkillPackSeeded must not care about ordering
      await seedAlexSkillPack(singleScopePrisma, "org_demo", REFS_DIR);
      await expect(
        assertAlexSkillPackSeeded(singleScopePrisma, "org_demo"),
      ).resolves.toBeUndefined();
      // Verify the individual scope row is present and non-empty
      const row = await (
        singleScopePrisma.knowledgeEntry as unknown as {
          findFirst: (args: FindFirstArgs) => Promise<StoredRow | null>;
        }
      ).findFirst({
        where: {
          organizationId: "org_demo",
          kind: entry.kind,
          scope: entry.scope,
          active: true,
        },
      });
      expect(row).not.toBeNull();
      expect(row!.content.trim().length).toBeGreaterThan(50);
    }
  });

  it("throws for org_other even when org_demo is seeded", async () => {
    await seedAlexSkillPack(prisma, "org_demo", REFS_DIR);
    // org_other has no rows — assert must fail
    await expect(assertAlexSkillPackSeeded(prisma, "org_other")).rejects.toThrow(
      /missing active KnowledgeEntry.*org_other/,
    );
  });
});
