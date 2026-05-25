import { existsSync, readFileSync } from "node:fs";
import { dirname, join, parse } from "node:path";
import { fileURLToPath } from "node:url";
import type { BusinessFacts, KnowledgeKind } from "@switchboard/schemas";

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

/** Structural shape of `BusinessFactsStoreForResolver` (not exported from core). */
export interface StubBusinessFactsStore {
  get(orgId: string): Promise<BusinessFacts | null>;
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
 * The three skill-pack scopes Alex seeds from real medspa markdown. Mirrors
 * `ALEX_SKILL_PACK_SCOPES` in seed-alex-skill-pack.ts (kind + scope + file).
 * `injectAs` mapping (per skills/alex/SKILL.md):
 *   playbook/objection-handling     -> PLAYBOOK_CONTEXT
 *   playbook/qualification-framework -> QUALIFICATION_CONTEXT
 *   policy/claim-boundaries          -> CLAIM_BOUNDARIES
 */
const SKILL_PACK_SCOPES: ReadonlyArray<{ kind: KnowledgeKind; scope: string; file: string }> = [
  { kind: "playbook", scope: "objection-handling", file: "objection-handling.md" },
  { kind: "playbook", scope: "qualification-framework", file: "qualification-framework.md" },
  { kind: "policy", scope: "claim-boundaries", file: "claim-boundaries.md" },
];

/**
 * Benign stub content for Alex's required-but-not-skill-pack knowledge scope.
 * `policy/messaging-rules` -> POLICY_CONTEXT is `required: true` in the skill,
 * so resolution would throw without a row. The content is deliberately minimal
 * and non-vertical-specific — it only needs to exist so resolution succeeds.
 *
 * (`business-facts/operator-approved` -> BUSINESS_FACTS is ALSO required but the
 * resolver routes `business-facts` kind through a BusinessFactsStore, not
 * findActive — see createStubBusinessFactsStore below.)
 */
const STUB_SCOPES: ReadonlyMap<string, string> = new Map([
  [
    "policy::messaging-rules",
    [
      "# Messaging rules (eval stub)",
      "",
      "- One outbound message per turn.",
      "- Respect opt-out immediately.",
      "- No medical claims beyond approved boundaries.",
    ].join("\n"),
  ],
]);

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
 * Builds a stub `KnowledgeEntryStoreForResolver`. Its `findActive` returns, for
 * each requested (kind, scope):
 *   - the REAL frontmatter-stripped medspa markdown for the three skill-pack
 *     scopes (so Alex runs with the same content production injects), and
 *   - a minimal benign row for `policy/messaging-rules` (required:true).
 * Unknown (kind, scope) pairs yield no row — the resolver treats a missing
 * required scope as a `ContextResolutionError`, surfacing config drift loudly.
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
        const content = packContent.get(key) ?? STUB_SCOPES.get(key);
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

/** A stub `BusinessFactsStoreForResolver` returning {@link createStubBusinessFacts}. */
export function createStubBusinessFactsStore(): StubBusinessFactsStore {
  const facts = createStubBusinessFacts();
  return { get: async (_orgId: string): Promise<BusinessFacts | null> => facts };
}
