import { existsSync, readFileSync } from "node:fs";
import { dirname, join, parse } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaBusinessFactsStore, PrismaPlaybookReader } from "@switchboard/db";
import type { BusinessFacts, KnowledgeKind, Playbook } from "@switchboard/schemas";

/**
 * A single active knowledge row, matching the shape `ContextResolverImpl`
 * expects back from its `KnowledgeEntryStoreForResolver.findActive`. We type
 * this structurally because `KnowledgeEntryStoreForResolver` /
 * `KnowledgeEntryRow` are not re-exported from `@switchboard/core/skill-runtime`.
 */
export interface StubKnowledgeRow {
  kind: KnowledgeKind;
  scope: string;
  content: string;
  priority: number;
  updatedAt: Date;
}

/** Structural shape of `KnowledgeEntryStoreForResolver` (not exported from core). */
export interface StubKnowledgeStore {
  findActive(
    orgId: string,
    filters: Array<{ kind: KnowledgeKind; scope: string }>,
  ): Promise<StubKnowledgeRow[]>;
}

/**
 * Strips a leading YAML frontmatter block (--- ... ---) and returns the trimmed
 * body. Mirrors `stripFrontmatter` in
 * `packages/db/src/seed/seed-alex-skill-pack.ts` so the stub returns byte-for-byte
 * the same content production seeds into KnowledgeEntry rows.
 */
function stripFrontmatter(raw: string): string {
  const match = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/);
  if (match) {
    return match[1]!.trim();
  }
  return raw.trim();
}

/**
 * KEEP IN SYNC with ALEX_SKILL_PACK_SCOPES in @switchboard/db (packages/db/src/seed/
 * seed-alex-skill-pack.ts). Deliberately duplicated (not imported) to keep this eval
 * DB-free; if you add/rename a scope there, mirror it here or the preflight won't cover it.
 *
 * The three skill-pack scopes Alex seeds from real medspa markdown.
 * `injectAs` mapping (per skills/alex/SKILL.md):
 *   playbook/objection-handling     -> PLAYBOOK_CONTEXT
 *   playbook/qualification-framework -> QUALIFICATION_CONTEXT
 *   policy/claim-boundaries          -> CLAIM_BOUNDARIES
 */
export const SKILL_PACK_SCOPES: ReadonlyArray<{
  kind: KnowledgeKind;
  scope: string;
  file: string;
}> = [
  { kind: "playbook", scope: "objection-handling", file: "objection-handling.md" },
  { kind: "playbook", scope: "qualification-framework", file: "qualification-framework.md" },
  { kind: "policy", scope: "claim-boundaries", file: "claim-boundaries.md" },
];

function findRepoRoot(start: string): string {
  let dir = start;
  while (dir !== parse(dir).root) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error(
    `stub-context-store: could not locate repo root (pnpm-workspace.yaml) from ${start}`,
  );
}

function defaultRefsDir(): string {
  const repoRoot = findRepoRoot(dirname(fileURLToPath(import.meta.url)));
  return join(repoRoot, "skills", "alex", "references", "medspa");
}

/**
 * Builds a stub `KnowledgeEntryStoreForResolver`. Its `findActive` returns the
 * REAL frontmatter-stripped medspa markdown for the three skill-pack scopes (so
 * Alex runs with the same content production injects). Unknown (kind, scope)
 * pairs yield no row: the resolver treats a missing required scope as a
 * `ContextResolutionError`, surfacing config drift loudly.
 *
 * @param refsDir Override the medspa references directory (tests pass a fixture dir).
 */
export function createStubContextStore(refsDir?: string): StubKnowledgeStore {
  const dir = refsDir ?? defaultRefsDir();
  const now = new Date("2026-05-24T00:00:00.000Z");

  // Pre-read skill-pack content once so repeated findActive calls are cheap and
  // a missing source file fails fast at construction time.
  const packContent = new Map<string, string>();
  for (const entry of SKILL_PACK_SCOPES) {
    const raw = readFileSync(join(dir, entry.file), "utf-8");
    packContent.set(`${entry.kind}::${entry.scope}`, stripFrontmatter(raw));
  }

  return {
    findActive: async (
      _orgId: string,
      filters: Array<{ kind: KnowledgeKind; scope: string }>,
    ): Promise<StubKnowledgeRow[]> => {
      const rows: StubKnowledgeRow[] = [];
      for (const f of filters) {
        const key = `${f.kind}::${f.scope}`;
        const content = packContent.get(key);
        if (content !== undefined) {
          rows.push({ kind: f.kind, scope: f.scope, content, priority: 0, updatedAt: now });
        }
      }
      return rows;
    },
  };
}

/**
 * A minimal valid `BusinessFacts` used to satisfy the skill's required
 * `business-facts/operator-approved` -> BUSINESS_FACTS context requirement. The
 * resolver routes `business-facts` kind to a BusinessFactsStore (NOT findActive),
 * and `required:true` makes a null return throw — so we return a small but
 * schema-valid object. `renderBusinessFacts` turns this into the BUSINESS_FACTS
 * block. The same store also backs the alexBuilder's `stores.businessFactsStore`.
 */
export function createStubBusinessFacts(): BusinessFacts {
  return {
    businessName: "Acme Medspa",
    timezone: "Asia/Singapore",
    locations: [{ name: "Acme Medspa — Orchard", address: "1 Orchard Rd, Singapore" }],
    openingHours: {
      monday: { open: "10:00", close: "19:00", closed: false },
      tuesday: { open: "10:00", close: "19:00", closed: false },
    },
    services: [
      {
        name: "Consultation",
        description: "Initial in-person consultation with a licensed practitioner.",
        currency: "SGD",
      },
    ],
    escalationContact: { name: "Front desk", channel: "whatsapp", address: "+6580000000" },
    additionalFaqs: [],
  };
}

/**
 * Build the REAL PrismaBusinessFactsStore over a hand-built mock Prisma — no DB,
 * no Postgres. This exercises the production read + `classifyBusinessFacts` +
 * `BusinessFactsSchema.safeParse` + malformed-degrade path, exactly the seam the
 * live Alex turn uses (apps/api/src/bootstrap/skill-mode.ts:133). Mirrors
 * apps/api/src/__tests__/alex-business-facts-live-path.test.ts.
 *
 * @param config The BusinessConfig.config blob, or `null` for "no row" (absent).
 *   `null` and `{}` classify as missing → `.get()` returns null → BUSINESS_FACTS="".
 */
export function createBusinessFactsStore(config: unknown | null): PrismaBusinessFactsStore {
  const prisma = {
    businessConfig: {
      findUnique: async (_args: { where: { organizationId: string } }) =>
        // `config` is the BusinessConfig column name PrismaBusinessFactsStore.get
        // reads (row?.config). The key is load-bearing and NOT checked by `as never`.
        config === null ? null : { organizationId: "eval-org", config },
    },
  };
  return new PrismaBusinessFactsStore(prisma as never);
}

/**
 * D3-1: a minimal PlaybookSchema-valid onboarding playbook with PRICED canonical
 * services, used to drive Alex's BOOKABLE_SERVICES in a booking eval. The names are
 * the org's canonical bookable vocabulary (the same store the booked-value resolver
 * keys on); a fixture's lead may phrase a request loosely ("anti-wrinkle jabs") and
 * Alex must map it to one of these exact names.
 */
export function createStubPlaybook(): Playbook {
  const base = { status: "ready" as const, source: "manual" as const };
  return {
    businessIdentity: {
      name: "Acme Medspa",
      category: "medspa",
      tagline: "",
      location: "",
      ...base,
    },
    services: [
      { id: "botox", name: "Botox", price: 300, bookingBehavior: "ask_first", ...base },
      { id: "filler", name: "Dermal Filler", price: 600, bookingBehavior: "ask_first", ...base },
      {
        id: "hydrafacial",
        name: "HydraFacial",
        price: 250,
        bookingBehavior: "book_directly",
        ...base,
      },
    ],
    hours: { timezone: "Asia/Singapore", schedule: {}, afterHoursBehavior: "", ...base },
    bookingRules: { leadVsBooking: "", ...base },
    approvalMode: { ...base },
    escalation: { triggers: [], toneBoundaries: "", ...base },
    channels: { configured: [], ...base },
  };
}

/**
 * Build the REAL `PrismaPlaybookReader` over a hand-built mock Prisma (no DB) so the
 * eval exercises the production read + `PlaybookSchema.safeParse` path, exactly the
 * seam the live Alex turn uses (apps/api/src/bootstrap/skill-mode.ts:169 + :862).
 * Mirrors `createBusinessFactsStore`.
 *
 * @param onboardingPlaybook The OrganizationConfig.onboardingPlaybook blob, or `null`
 *   for "no playbook" → readForOrganization returns null → BOOKABLE_SERVICES = "".
 */
export function createPlaybookReader(onboardingPlaybook: unknown | null): PrismaPlaybookReader {
  const prisma = {
    organizationConfig: {
      // PrismaPlaybookReader.readForOrganization selects `onboardingPlaybook` by org id.
      findUnique: async (_args: { where: { id: string }; select: { onboardingPlaybook: true } }) =>
        onboardingPlaybook === null ? null : { onboardingPlaybook },
    },
  };
  return new PrismaPlaybookReader(prisma as never);
}
