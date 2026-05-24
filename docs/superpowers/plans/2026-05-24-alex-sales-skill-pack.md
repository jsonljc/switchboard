# Alex Sales Skill Pack (A1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Alex a real medspa selling playbook (objection-handling, qualification, system-owned claim boundaries) that actually reaches his prompt — by authoring canonical markdown and seeding it into per-org `KnowledgeEntry` rows.

**Architecture:** Markdown in `skills/alex/references/medspa/` is the canonical artifact. A seed/sync function materializes it into `KnowledgeEntry` rows at `version: 1` for the org(s) running Alex; the runtime resolver stays DB-only. A new `CLAIM_BOUNDARIES` context requirement (SKILL.md edit, no resolver-code change) carries system-owned safety boundaries. Operator edits (`version > 1`) are never touched by the seed. No schema change.

**Tech Stack:** TypeScript (ESM, `.js` import extensions), Prisma, Zod, Vitest. Spec: `docs/superpowers/specs/2026-05-24-alex-sales-skill-pack-and-eval-design.md`.

**Scope fence:** No new tools, no model routing, no proactive flow, no learning-loop. Operator-above-default layering is deferred (schema can't coexist rows in one `(kind,scope)`).

---

## File Structure

- Create: `skills/alex/references/medspa/objection-handling.md` — canonical objection playbook (kind=playbook, scope=objection-handling).
- Create: `skills/alex/references/medspa/qualification-framework.md` — canonical qualification playbook (kind=playbook, scope=qualification-framework).
- Create: `skills/alex/references/medspa/claim-boundaries.md` — canonical system-owned safety boundaries (kind=policy, scope=claim-boundaries).
- Modify: `skills/alex/SKILL.md` — add `CLAIM_BOUNDARIES` context requirement (frontmatter) + `{{CLAIM_BOUNDARIES}}` body slot.
- Create: `packages/db/src/seed/seed-alex-skill-pack.ts` — reusable `seedAlexSkillPack(prisma, orgId)` (reads md, upserts v1, operator-safe).
- Create: `packages/db/src/seed/seed-alex-skill-pack.test.ts` — unit tests (slot population, operator-safety, idempotency).
- Modify: `packages/db/prisma/seed.ts` — call `seedAlexSkillPack(prisma, "org_demo")` in `main()`.
- Modify: `apps/api/src/routes/organizations.ts` — call `seedAlexSkillPack(prisma, orgId)` on Alex-enabled org provisioning (mirroring `seedOrgDayOneAgents`).
- Create: `packages/core/src/skill-runtime/__tests__/alex-claim-boundaries-slot.test.ts` — characterize not-required-empty rendering + slot presence.

---

## Task 1: Author the canonical medspa reference markdown

**Files:**
- Create: `skills/alex/references/medspa/objection-handling.md`
- Create: `skills/alex/references/medspa/qualification-framework.md`
- Create: `skills/alex/references/medspa/claim-boundaries.md`

These are product copy (no test in this task — content is validated behaviorally by Plan A0). Each file is the row `content` that will be seeded. Acceptance: each file must cover every row of its corpus area from the spec, in concise markdown (claim-boundaries must stay well under 4000 chars).

- [ ] **Step 1: Write `objection-handling.md`**

Must cover (spec corpus): price ("too expensive" / "discount" / "I'll compare first"), safety/downtime, results skepticism, urgency/hesitation. Structure as a section per objection with the reframe approach. Example shape (author the full set in this style):

```markdown
# Objection handling — medspa

## Price: "too expensive" / "what's your cheapest option"
Acknowledge the concern, anchor on value and safety over price, never lead with a discount. Offer a consultation where the doctor sets realistic expectations and pricing. Never disparage cheaper competitors.

## Price: "I saw another clinic doing it cheaper"
Validate the comparison, differentiate on clinician credentials / device / aftercare without attacking the competitor. Do not claim superiority without evidence.

## Safety / downtime: "is it safe?" / "will my face look frozen?"
Reassure generally, explain that suitability is assessed in consultation, never assert "safe for you" or guarantee no side effects. Defer specifics to the doctor.

## Results skepticism: "will it work for me?" / "how long before results?"
Explain typical ranges generally, emphasize individual variation, route to consultation. Never guarantee results or timelines.

## Urgency / hesitation: "let me think" / "maybe later"
No pressure. Offer a concrete, low-commitment next step (a consultation hold, an info follow-up). Surface the lead's hesitation reason for follow-up.
```

- [ ] **Step 2: Write `qualification-framework.md`**

Must cover: treatment goal, timeline, prior experience, budget comfort — framed as natural discovery questions (not a checklist), plus how to read serviceable-market and buying-intent signals (these map to the qualification sidecar).

```markdown
# Qualification framework — medspa

Discover, conversationally (never as an interrogation):
- **Treatment goal / area** — what outcome the lead wants ("look fresher", a specific area/treatment).
- **Timeline** — how soon they want to act.
- **Prior experience** — have they had aesthetic treatments before.
- **Budget comfort** — gauge gently; never demand a number.
- **Serviceable market** — are they in SG/MY service area.

Read for buying intent (none / soft / strong) and emit the qualification sidecar every turn. Qualification is observation, not a gate.
```

- [ ] **Step 3: Write `claim-boundaries.md` (system-owned, keep short)**

```markdown
# Claim boundaries — non-negotiable

These rules override any selling instinct:
- Explain treatments **generally**; route specifics to a consultation with the doctor.
- **Never diagnose** a condition or recommend a treatment as medically necessary.
- **Never guarantee** results, outcomes, or timelines.
- **Never assert "safe for you"** or promise no side effects — suitability is a clinical judgment made in consultation.
- **Never promise before/after certainty** or use absolute efficacy claims.
- Do not make superiority claims without evidence.
```

- [ ] **Step 4: Commit**

```bash
git add skills/alex/references/medspa/
git commit -m "feat(alex): add canonical medspa sales skill-pack markdown"
```

---

## Task 2: Add the `CLAIM_BOUNDARIES` context requirement to SKILL.md

**Files:**
- Modify: `skills/alex/SKILL.md` (frontmatter `context:` list + body)
- Test: `packages/core/src/skill-runtime/__tests__/alex-skill-loads.test.ts` (or extend existing skill-loader test)

The loader normalizes YAML `inject_as` → `injectAs` and validates against `ContextRequirementSchema` (`kind` ∈ closed enum, `scope` kebab-case, `injectAs` SCREAMING_SNAKE, duplicate `injectAs` rejected). `required` defaults to `true`, so we set `required: false` explicitly.

- [ ] **Step 1: Write the failing test — Alex skill loads with a `claim-boundaries` requirement**

```ts
// packages/core/src/skill-runtime/__tests__/alex-skill-loads.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadSkillFromMarkdown } from "../skill-loader.js"; // confirm exact export name in skill-loader.ts

describe("alex skill", () => {
  it("declares a claim-boundaries context requirement injected as CLAIM_BOUNDARIES (not required)", () => {
    const md = readFileSync(
      join(__dirname, "../../../../../skills/alex/SKILL.md"),
      "utf-8",
    );
    const skill = loadSkillFromMarkdown(md);
    const req = skill.context.find((c) => c.injectAs === "CLAIM_BOUNDARIES");
    expect(req).toBeDefined();
    expect(req).toMatchObject({ kind: "policy", scope: "claim-boundaries", required: false });
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter @switchboard/core test alex-skill-loads`
Expected: FAIL (`req` is undefined). *(If `loadSkillFromMarkdown` is not the exported name, read `skill-loader.ts` and use the actual loader entry — the grounded loader validates `context` via `validateContext` at line ~232.)*

- [ ] **Step 3: Add the frontmatter requirement**

In `skills/alex/SKILL.md`, append to the `context:` list (after the `qualification-framework` entry):

```yaml
  - kind: policy
    scope: claim-boundaries
    inject_as: CLAIM_BOUNDARIES
    required: false
```

- [ ] **Step 4: Add the body slot**

In `skills/alex/SKILL.md`, add a new section near "## Operating Boundaries" (the existing Bucket A/B/C constraints, ~line 114):

```markdown
## Claim boundaries (non-negotiable)

{{CLAIM_BOUNDARIES}}
```

- [ ] **Step 5: Run the test — verify it passes**

Run: `pnpm --filter @switchboard/core test alex-skill-loads`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add skills/alex/SKILL.md packages/core/src/skill-runtime/__tests__/alex-skill-loads.test.ts
git commit -m "feat(alex): add system-owned CLAIM_BOUNDARIES context slot to skill"
```

---

## Task 3: Characterize not-required-empty slot rendering

**Files:**
- Create/Test: `packages/core/src/skill-runtime/__tests__/alex-claim-boundaries-slot.test.ts`

The resolver does NOT set the variable for a not-required requirement with no backing row. We must confirm the template engine renders an unset `{{CLAIM_BOUNDARIES}}` as empty (NOT a literal `{{CLAIM_BOUNDARIES}}`) so non-medspa/unseeded Alex deployments are clean. `{{POLICY_CONTEXT}}` is the existing precedent (not always seeded).

- [ ] **Step 1: Write the test — assembling Alex's prompt with no claim-boundaries row leaves no literal placeholder**

```ts
import { describe, it, expect } from "vitest";
import { ContextResolverImpl } from "../context-resolver.js";
import { interpolate } from "../template-engine.js"; // confirm exact export in template-engine.ts

// A stub store with NO claim-boundaries rows.
const emptyStore = { findActive: async () => [] };

describe("claim-boundaries slot rendering", () => {
  it("renders no literal {{CLAIM_BOUNDARIES}} when the row is absent (not-required)", async () => {
    const resolver = new ContextResolverImpl(emptyStore /*, ...other ctor deps per context-resolver.ts:106 */);
    const { variables } = await resolver.resolve("org_x", [
      { kind: "policy", scope: "claim-boundaries", injectAs: "CLAIM_BOUNDARIES", required: false },
    ]);
    const rendered = interpolate("before {{CLAIM_BOUNDARIES}} after", variables, []);
    expect(rendered).not.toContain("{{CLAIM_BOUNDARIES}}");
  });
});
```

- [ ] **Step 2: Run it**

Run: `pnpm --filter @switchboard/core test alex-claim-boundaries-slot`
Expected: PASS if the engine already drops unknown placeholders; FAIL (literal remains) if it doesn't.

- [ ] **Step 3: If it FAILS, make unset slots render empty**

Read `template-engine.ts` interpolation. If unknown `{{VAR}}` is left literal, the minimal fix is in the resolver: for a not-required requirement with zero rows, set `variables[req.injectAs] = ""` (instead of leaving it unset) at the `context-resolver.ts` not-required-empty branch (~line 241-243). Re-run until PASS. *(Prefer the resolver fix over changing the engine globally, to avoid affecting other skills.)*

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/skill-runtime/
git commit -m "test(alex): characterize empty CLAIM_BOUNDARIES slot rendering"
```

---

## Task 4: `seedAlexSkillPack(prisma, orgId)` — reusable, operator-safe seed/sync

**Files:**
- Create: `packages/db/src/seed/seed-alex-skill-pack.ts`
- Test: `packages/db/src/seed/seed-alex-skill-pack.test.ts`

Mirrors `seed-knowledge.ts`'s `prisma.knowledgeEntry.upsert` keyed on the compound unique `organizationId_kind_scope_version` at `version: 1`. Unlike `seedKnowledge` (which uses `update: {}`), this refreshes default content on the v1 row. It touches ONLY `version: 1`; operator `version > 1` rows are never read or written.

- [ ] **Step 1: Write the failing test (uses the existing PrismaKnowledgeEntryStore to assert resolution)**

```ts
// packages/db/src/seed/seed-alex-skill-pack.test.ts — mirror the mocked-prisma pattern used by other db store tests
import { describe, it, expect, vi, beforeEach } from "vitest";
import { seedAlexSkillPack, ALEX_SKILL_PACK_SCOPES } from "./seed-alex-skill-pack.js";

function mockPrisma() {
  const rows: any[] = [];
  return {
    rows,
    knowledgeEntry: {
      upsert: vi.fn(async ({ where, create, update }: any) => {
        const key = where.organizationId_kind_scope_version;
        const existing = rows.find(
          (r) => r.organizationId === key.organizationId && r.kind === key.kind &&
                 r.scope === key.scope && r.version === key.version,
        );
        if (existing) { Object.assign(existing, update); return existing; }
        const row = { ...create }; rows.push(row); return row;
      }),
    },
  } as any;
}

describe("seedAlexSkillPack", () => {
  it("seeds version-1 rows for objection-handling, qualification-framework, claim-boundaries", async () => {
    const prisma = mockPrisma();
    await seedAlexSkillPack(prisma, "org_demo");
    const scopes = prisma.rows.map((r: any) => `${r.kind}/${r.scope}`);
    expect(scopes).toEqual(
      expect.arrayContaining([
        "playbook/objection-handling",
        "playbook/qualification-framework",
        "policy/claim-boundaries",
      ]),
    );
    for (const r of prisma.rows) {
      expect(r.version).toBe(1);
      expect(r.active).toBe(true);
      expect(r.content.length).toBeGreaterThan(0);
    }
  });

  it("is idempotent and never touches version>1 (operator) rows", async () => {
    const prisma = mockPrisma();
    // Simulate an operator override: v1 deactivated, v2 active (the store.update() shape).
    prisma.rows.push({ organizationId: "org_demo", kind: "playbook", scope: "objection-handling", version: 1, active: false, content: "old default", title: "x", priority: 0 });
    prisma.rows.push({ organizationId: "org_demo", kind: "playbook", scope: "objection-handling", version: 2, active: true, content: "OPERATOR COPY", title: "x", priority: 0 });
    await seedAlexSkillPack(prisma, "org_demo");
    const v2 = prisma.rows.find((r: any) => r.scope === "objection-handling" && r.version === 2);
    expect(v2.active).toBe(true);
    expect(v2.content).toBe("OPERATOR COPY"); // untouched
    // upsert was only ever called with version:1 in the where-key
    for (const call of (prisma.knowledgeEntry.upsert as any).mock.calls) {
      expect(call[0].where.organizationId_kind_scope_version.version).toBe(1);
    }
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter @switchboard/db test seed-alex-skill-pack`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `seed-alex-skill-pack.ts`**

```ts
import type { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Resolve the canonical markdown. From packages/db/src/seed/ → repo root is 4 up.
// NOTE: verify this resolves in both `tsx prisma/seed.ts` and the built API context (Task 4 Step 5).
const REF_DIR = join(__dirname, "../../../../skills/alex/references/medspa");

export const ALEX_SKILL_PACK_SCOPES = [
  { kind: "playbook" as const, scope: "objection-handling", file: "objection-handling.md", title: "Medspa objection handling" },
  { kind: "playbook" as const, scope: "qualification-framework", file: "qualification-framework.md", title: "Medspa qualification framework" },
  { kind: "policy" as const, scope: "claim-boundaries", file: "claim-boundaries.md", title: "Medspa claim boundaries (system-owned)" },
];

export async function seedAlexSkillPack(prisma: PrismaClient, orgId: string): Promise<void> {
  for (const entry of ALEX_SKILL_PACK_SCOPES) {
    const content = readFileSync(join(REF_DIR, entry.file), "utf-8").trim();
    await prisma.knowledgeEntry.upsert({
      where: {
        organizationId_kind_scope_version: {
          organizationId: orgId,
          kind: entry.kind,
          scope: entry.scope,
          version: 1,
        },
      },
      // Refresh default content on the v1 row; do NOT touch `active` (an operator
      // override deactivated v1 and made v2 active — leave that alone).
      update: { title: entry.title, content },
      create: {
        organizationId: orgId,
        kind: entry.kind,
        scope: entry.scope,
        title: entry.title,
        content,
        priority: 0,
        version: 1,
        active: true,
      },
    });
  }
  console.warn(`Seeded Alex skill pack (${ALEX_SKILL_PACK_SCOPES.length} scopes) for ${orgId}`);
}
```

- [ ] **Step 4: Run the tests — verify they pass**

Run: `pnpm --filter @switchboard/db test seed-alex-skill-pack`
Expected: PASS.

- [ ] **Step 5: Verify the markdown path resolves at runtime**

Run: `node -e "const {readFileSync}=require('fs');const {join}=require('path');console.log(readFileSync(join('skills/alex/references/medspa/claim-boundaries.md'),'utf-8').length)"` from repo root.
Expected: prints a positive length. If the built-API path differs, adjust `REF_DIR` resolution (e.g., resolve from a stable repo-root anchor) — `skills/` is already shipped for the skill-loader, so the files exist in the deploy.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/seed/seed-alex-skill-pack.ts packages/db/src/seed/seed-alex-skill-pack.test.ts
git commit -m "feat(db): seedAlexSkillPack — operator-safe v1 seed of medspa skill pack"
```

---

## Task 5: Wire the seed into dev seed + prod signup

**Files:**
- Modify: `packages/db/prisma/seed.ts` (import + call in `main()`)
- Modify: `apps/api/src/routes/organizations.ts` (call on Alex-enabled provisioning)

- [ ] **Step 1: Wire dev seed (targets `org_demo`, where the Alex deployment lives)**

In `packages/db/prisma/seed.ts`, add the import alongside the others (line ~5-8):

```ts
import { seedAlexSkillPack } from "../src/seed/seed-alex-skill-pack.js";
```

And in `main()`, after the `seedKnowledge(prisma)` call (~line 602), add:

```ts
  // ── Alex skill pack (system-default playbook for the org running Alex) ──
  console.warn("\n--- Alex Skill Pack ---");
  await seedAlexSkillPack(prisma, "org_demo");
```

- [ ] **Step 2: Wire prod signup path**

In `apps/api/src/routes/organizations.ts`, locate the org provisioning/upsert path that calls `seedOrgDayOneAgents` (the day-one-agents wiring) and add, for orgs that enable Alex:

```ts
import { seedAlexSkillPack } from "@switchboard/db"; // confirm the export is surfaced from the db package barrel
// ...after the org + day-one agents are provisioned:
await seedAlexSkillPack(prisma, orgId);
```

If `seedAlexSkillPack` is not exported from `@switchboard/db`'s public entry, add it to that barrel (mirror how `seedOrgDayOneAgents` is exported/imported).

- [ ] **Step 3: Run the dev seed end-to-end (requires local Postgres)**

Run: `pnpm db:seed`
Expected: log line `Seeded Alex skill pack (3 scopes) for org_demo` and no errors.

- [ ] **Step 4: Typecheck both packages**

Run: `pnpm --filter @switchboard/db typecheck && pnpm --filter @switchboard/api typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/seed.ts apps/api/src/routes/organizations.ts packages/db/src/index.ts
git commit -m "feat: seed Alex skill pack on dev seed + org provisioning"
```

---

## Task 6: Slot-population regression + provisioning preflight

**Files:**
- Test: `packages/db/src/seed/seed-alex-skill-pack.test.ts` (extend)

This is the headline regression: prove the previously-empty slots populate for the Alex org, and that `CLAIM_BOUNDARIES` resolves from its own scope.

- [ ] **Step 1: Add the resolution test (mocked prisma → findActive shape)**

```ts
it("resolves non-empty PLAYBOOK/QUALIFICATION/CLAIM_BOUNDARIES after seeding", async () => {
  const prisma = mockPrisma();
  await seedAlexSkillPack(prisma, "org_demo");
  // findActive(orgId, [{kind,scope},...]) returns active rows for those (kind,scope)
  const findActive = (kind: string, scope: string) =>
    prisma.rows.filter((r: any) => r.organizationId === "org_demo" && r.active && r.kind === kind && r.scope === scope);
  expect(findActive("playbook", "objection-handling")[0]?.content.length).toBeGreaterThan(0);
  expect(findActive("playbook", "qualification-framework")[0]?.content.length).toBeGreaterThan(0);
  expect(findActive("policy", "claim-boundaries")[0]?.content.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run it — verify it passes**

Run: `pnpm --filter @switchboard/db test seed-alex-skill-pack`
Expected: PASS.

- [ ] **Step 3: Add a provisioning-preflight assertion (medspa requires CLAIM_BOUNDARIES)**

Add an exported guard the A0 preflight + provisioning can call:

```ts
// in seed-alex-skill-pack.ts
export async function assertAlexSkillPackSeeded(prisma: PrismaClient, orgId: string): Promise<void> {
  const needed = ALEX_SKILL_PACK_SCOPES.map((e) => ({ kind: e.kind, scope: e.scope }));
  for (const { kind, scope } of needed) {
    const row = await prisma.knowledgeEntry.findFirst({
      where: { organizationId: orgId, kind: kind as any, scope, active: true },
    });
    if (!row || row.content.trim().length === 0) {
      throw new Error(`Alex skill pack missing for ${orgId}: ${kind}/${scope}`);
    }
  }
}
```

Test it throws when claim-boundaries is absent and passes after seeding.

- [ ] **Step 4: Run all db tests + commit**

```bash
pnpm --filter @switchboard/db test
git add packages/db/src/seed/seed-alex-skill-pack.ts packages/db/src/seed/seed-alex-skill-pack.test.ts
git commit -m "test(db): Alex skill-pack slot-population + preflight regression"
```

---

## Self-review checklist (run before handoff)
- Spec coverage: §2.1 (md files → Task 1), §2.2/2.3 (CLAIM_BOUNDARIES requirement + slot → Task 2), not-required render (§2.3 → Task 3), §2.4 seed/operator-safety (→ Tasks 4-5), §2.6 tests (→ Tasks 3,4,6). ✓
- No `source` column / no migration introduced. ✓
- Operator-safety asserted (version>1 untouched). ✓
- Confirm exact exports while implementing: `loadSkillFromMarkdown` (skill-loader entry), `interpolate` (template-engine), `ContextResolverImpl` ctor args — read the file if the name differs; do not invent.
- `.js` import extensions on all relative imports (ESM). Prettier: double quotes, semis, 100 width.
