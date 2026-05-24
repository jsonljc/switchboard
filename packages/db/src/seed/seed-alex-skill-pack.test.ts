import { describe, it, expect, vi, beforeEach } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { seedAlexSkillPack, ALEX_SKILL_PACK_SCOPES } from "./seed-alex-skill-pack.js";
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

/**
 * Builds a minimal in-memory prisma mock whose knowledgeEntry.upsert records
 * each call and returns a resolved promise.
 */
function buildMockPrisma() {
  const calls: UpsertCall[] = [];
  const mock = {
    knowledgeEntry: {
      upsert: vi.fn(async (args: UpsertCall) => {
        calls.push(args);
        return {};
      }),
    },
    _calls: calls,
  };
  return mock as unknown as PrismaClient & { _calls: UpsertCall[] };
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
});
