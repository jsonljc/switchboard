# A4 Contact Identity Matcher — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans, task-by-task. Steps use checkbox (`- [ ]`) syntax. This plan is `.claude/`
> orchestration scratch (uncommitted) per build-loop doctrine; the durable spec is D1 + slice A4 on main.

**Goal:** Dedup-by-reuse + flag-on-ambiguity at lead intake so a same-person CTWA + Instant-Form pair
collapses to ONE Contact, a same-phone-different-name pair is flagged (not merged), and intake becomes a
live producer of `duplicate_contact_risk` feeding `evaluateExceptions`.

**Architecture:** Pure decision fn in core (`match-contact-identity.ts`) + store I/O
(`findByPhoneOrEmail`) + handler orchestration. The intake flag persists on a new
`Contact.duplicateContactRisk` column; `issue-receipted-booking.ts` ORs it into #1212's live phone-probe
before `evaluateExceptions` (boolean OR → no double-flag; `mergeExceptions` de-dups by code). Reuse
preserves the existing contact untouched (intake carries only opt-in/neutral signals → most-restrictive
consolidation = preserve existing).

**Tech Stack:** TypeScript ESM monorepo (pnpm/Turbo), Prisma/Postgres, Zod, Vitest. db tests mock Prisma.

## Global Constraints (verbatim)

- D1 LOCKED — do NOT re-litigate: flag-only + dedup-by-reuse; reuse only on EXACT single match
  corroborated by name; flag on ambiguity/conflict; NEVER auto-merge two persisted records; most-restrictive
  consent on reuse (never widen); NO DB `@@unique` on phone/email (pseudo-unique).
- ESM only, `.js` extensions in relative imports. No `any` (use `unknown`). No `console.log`. No em-dashes
  in copy/comments. Prettier: semi, double quotes, 2-space, trailing commas, 100 char width.
- Every new module co-located `*.test.ts`. File error at 600 lines, warn at 400. Conventional Commits,
  lowercase subject. Schema change requires a migration in the SAME commit; `pnpm db:check-drift` before
  committing schema changes (needs PG).
- Layers: schemas → sdk → core → db → apps. db MAY import core. No cycles.
- Authority: SURFACE-before-merge (touches prisma + consent + receipts/issuance → human merge call).
- Migration via `prisma migrate diff --script` (no TTY, per feedback_prisma_migrate_dev_tty); Prisma index
  naming (63-char cap, feedback_prisma_index_name_63_char_limit). Verify typecheck with package-level
  `tsc --noEmit` per touched package (turbo can false-green via cross-worktree cache).

## Plan revision R1 (post fan-out grade — MANDATORY; 3/3 graders REVISE, convergent)

The design held under all lenses; the miss was the mechanical interface-break fan-out. `ContactSchema.duplicateContactRisk`
uses `z.boolean().default(false)`, so the field is REQUIRED on the inferred `Contact` OUTPUT type (exactly like the
sibling `messagingOptIn`). Every hand-built `const contact: Contact = {...}` literal breaks (TS2741) until it sets the
field; and `findByPhoneOrEmail` becoming a required `LeadIntakeStore` method breaks every typed mock.

- **R1-A (Task 1):** add `duplicateContactRisk: false` to EVERY hand-built Contact literal. Confirmed sites:
  `packages/core/src/lifecycle/__tests__/lifecycle-service.test.ts:35`,
  `packages/core/src/lifecycle/__tests__/fallback-handler.test.ts:53` (createContact factory defaults),
  `apps/api/src/__tests__/test-stores.ts:186` (apps/api — the core-green/app-red trap). PLUS grep ALL remaining:
  `grep -rn ": Contact = {\|: Contact =>\|): Contact" packages apps --include=*.ts` and fix each.
- **R1-B (Task 1):** `mapRowToContact` (prisma-contact-store.ts ~424-445) has a CLOSED inline `row` param type. Add
  `duplicateContactRisk?: boolean | null;` to that param type AND return `duplicateContactRisk: row.duplicateContactRisk ?? false`.
  All call sites read full rows (no `select`), so no select edits are needed.
- **R1-C (Task 1):** ContactSchema test goes in `packages/schemas/src/__tests__/lifecycle.test.ts` (EXISTS; append) — NOT
  `src/lifecycle.test.ts`. `db:check-drift` is MANDATORY (PG is up), not conditional.
- **R1-D (Task 3):** adding required `findByPhoneOrEmail` breaks the typed mock `makeStore()` in
  `packages/core/src/intents/lead-intake-workflow.test.ts:23` (typed `LeadIntakeStore & {...}`). Add
  `findByPhoneOrEmail: vi.fn().mockResolvedValue([])` to `makeStore()` + its return type, in the Task 3 commit.
  `lead-intake-store.test.ts` does NOT exist -> CREATE; add `import type { PrismaDbClient } from "../prisma-db.js";`.
- **R1-E (Task 4):** `lead-intake-handler.test.ts` EXISTS with passing tests (CTWA/instant_form/non-whatsapp opt-in,
  idempotency, org-scope) + a `makeIntake` helper (lines ~5-17). PRESERVE all existing tests; ADD the new matcher tests;
  extend the shared store mock (beforeEach) with `findByPhoneOrEmail`; reuse `makeIntake`. Do NOT drop the
  "non-whatsapp lead gets no messagingOptIn" case.
- **R1-F (Task 5):** extend the existing `ContactRead` type (~8-17) and `makeTx`'s `evidenceContact` param (~21-29) with
  `duplicateContactRisk?: boolean | null`, and write the new test THROUGH
  `makeTx({ evidenceContact: { duplicateContactRisk: true, phoneE164: null }, duplicateContact: null })` — not a fresh
  `as never` tx literal. Mirrors the existing four #1212 probe tests and keeps the harness single-sourced.
- **R1-G (VERIFY/DoD):** add `pnpm --filter @switchboard/api test` AND apps/api typecheck (apps/api consumes the handler
  at contained-workflows.ts:225 + inngest.ts:587, and has a breaking literal). `eval:governance` is NOT required
  (grader-confirmed it does not consume `duplicate_contact_risk`; the OR is covered by evaluate-exceptions.test.ts +
  build-receipted-booking-data.test.ts) — run it only as a non-blocking sanity if cheap.
- **R1-H (DoD note — accepted behavior):** `Contact.duplicateContactRisk` is MONOTONIC (never cleared post-intake). Every
  future booking for a flagged contact re-raises `duplicate_contact_risk` afresh, per-booking resolvable (consistent with
  the #1212 phone-probe, which already re-detects per booking). This is NOT a re-open bug: the read path carries only OPEN
  persisted entries (assemble-view-exceptions), issuance is `if (existing) return`-guarded, so a resolved entry never
  resurrects. Clearing the Contact flag on operator-resolve is deliberately out of scope (a future slice).

## File map

- `packages/db/prisma/schema.prisma` (Contact model ~1784-1841) — add column + index. MODIFY.
- `packages/db/prisma/migrations/<ts>_add_contact_duplicate_risk_and_email_index/migration.sql` — CREATE.
- `packages/schemas/src/lifecycle.ts` (ContactSchema ~102) — add field. MODIFY. (+ existing lifecycle.test.ts)
- `packages/core/src/intents/match-contact-identity.ts` — pure matcher. CREATE + co-located test.
- `packages/core/src/intents/lead-intake-handler.ts` — extend LeadIntakeStore iface + orchestration. MODIFY.
- `packages/core/src/intents/lead-intake-handler.test.ts` — handler tests. MODIFY/CREATE.
- `packages/db/src/stores/lead-intake-store.ts` (PrismaLeadIntakeStore ~51) — findByPhoneOrEmail + upsert. MODIFY.
- `packages/db/src/stores/lead-intake-store.test.ts` — store tests (mock prisma). MODIFY/CREATE.
- `packages/db/src/stores/prisma-contact-store.ts` (mapRowToContact) — map new column. MODIFY.
- `packages/core/src/skill-runtime/tools/issue-receipted-booking.ts` (~82-114) — OR persisted flag. MODIFY.
- `packages/core/src/skill-runtime/tools/issue-receipted-booking.test.ts` — extend ContactRead/makeTx + OR test. MODIFY.
- `packages/schemas/src/__tests__/lifecycle.test.ts` — ContactSchema default test (append). MODIFY. (R1-C)
- `packages/core/src/intents/lead-intake-workflow.test.ts` — makeStore() needs findByPhoneOrEmail. MODIFY. (R1-D)
- `packages/core/src/lifecycle/__tests__/lifecycle-service.test.ts:35` — Contact literal +duplicateContactRisk. MODIFY. (R1-A)
- `packages/core/src/lifecycle/__tests__/fallback-handler.test.ts:53` — createContact factory +field. MODIFY. (R1-A)
- `apps/api/src/__tests__/test-stores.ts:186` — Contact literal +duplicateContactRisk (apps/api). MODIFY. (R1-A)
- (grep-sweep all remaining `: Contact = {` / `: Contact =>` literals across packages+apps.)

---

### Task 1: Contact schema — `duplicateContactRisk` column + email index + type

**Files:**

- Modify: `packages/db/prisma/schema.prisma` (Contact model, ~1784-1841)
- Create: `packages/db/prisma/migrations/<ts>_add_contact_duplicate_risk_and_email_index/migration.sql`
- Modify: `packages/schemas/src/lifecycle.ts:102-125` (ContactSchema)
- Modify: `packages/db/src/stores/prisma-contact-store.ts` (mapRowToContact + any explicit Contact selects)
- Test: `packages/schemas/src/lifecycle.test.ts` (or co-located ContactSchema test)

**Interfaces:**

- Produces: `Contact.duplicateContactRisk` (Boolean, default false) DB column + `ContactSchema.duplicateContactRisk:
boolean` (default false). `@@index([organizationId, email])` named `Contact_organizationId_email_idx`.

- [ ] **Step 1: Write the failing test** in `packages/schemas/src/lifecycle.test.ts`:

```ts
it("defaults duplicateContactRisk to false and accepts true", () => {
  const base = {
    id: "c1",
    organizationId: "org1",
    primaryChannel: "whatsapp" as const,
    firstContactAt: new Date(),
    lastActivityAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  expect(ContactSchema.parse(base).duplicateContactRisk).toBe(false);
  expect(ContactSchema.parse({ ...base, duplicateContactRisk: true }).duplicateContactRisk).toBe(
    true,
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/schemas test -- lifecycle`
Expected: FAIL — `duplicateContactRisk` is `undefined` (field not in schema).

- [ ] **Step 3: Add the field to `ContactSchema`** (lifecycle.ts, after `messagingOptOutAt` line 120):

```ts
  /** Set at lead intake when this contact matched an existing one but could not be corroborated as the
   * same person (ambiguous/conflicting). Read at booking issuance and ORed into duplicate_contact_risk. */
  duplicateContactRisk: z.boolean().default(false),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/schemas test -- lifecycle` → Expected: PASS.

- [ ] **Step 5: Add the column + index to `schema.prisma`** Contact model. After the messaging-consent
      fields add `duplicateContactRisk Boolean @default(false)`; in the `@@index(...)` block add
      `@@index([organizationId, email])`.

- [ ] **Step 6: Map the column in `mapRowToContact`** (prisma-contact-store.ts) — add
      `duplicateContactRisk: row.duplicateContactRisk` to the returned object. If the store uses explicit
      `select`s that build a Contact, add `duplicateContactRisk: true` there too. (Grep `mapRowToContact` +
      its selects; if it uses `findMany`/`findFirst` without `select`, no select change needed.)

- [ ] **Step 7: Generate the migration (no TTY)** from repo root:

```bash
TS=$(date +%Y%m%d%H%M%S)
DIR="packages/db/prisma/migrations/${TS}_add_contact_duplicate_risk_and_email_index"
mkdir -p "$DIR"
npx prisma migrate diff \
  --from-migrations packages/db/prisma/migrations \
  --to-schema-datamodel packages/db/prisma/schema.prisma \
  --script > "$DIR/migration.sql"
cat "$DIR/migration.sql"
```

Expected SQL: `ALTER TABLE "Contact" ADD COLUMN "duplicateContactRisk" BOOLEAN NOT NULL DEFAULT false;`
and `CREATE INDEX "Contact_organizationId_email_idx" ON "Contact"("organizationId", "email");`. If the diff
emits anything else (drift from an unrelated pending change), STOP and reconcile — the migration must
contain ONLY these two statements.

- [ ] **Step 8: Regenerate the Prisma client + typecheck**

```bash
pnpm db:generate
pnpm --filter @switchboard/schemas exec tsc --noEmit
pnpm --filter @switchboard/db exec tsc --noEmit
```

Expected: clean. (If Postgres is reachable, also `pnpm db:check-drift` → no drift. If PG down, the
migration is CI-validated; note it in the ledger.)

- [ ] **Step 9: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations packages/schemas/src/lifecycle.ts \
  packages/schemas/src/lifecycle.test.ts packages/db/src/stores/prisma-contact-store.ts
git commit -m "feat(db): add Contact.duplicateContactRisk column + email index"
```

---

### Task 2: Pure contact-match decision function

**Files:**

- Create: `packages/core/src/intents/match-contact-identity.ts`
- Test: `packages/core/src/intents/match-contact-identity.test.ts`

**Interfaces:**

- Consumes: `normalizeEmail` from `../identity/normalize.js`.
- Produces:
  - `MatchIdentity = { phoneE164: string | null; email: string | null; name: string | null }`
  - `MatchCandidate = { id: string; phoneE164: string | null; email: string | null; name: string | null }`
  - `MatchDecision = { kind: "create" } | { kind: "reuse"; contactId: string } | { kind: "create_flagged" }`
  - `decideContactMatch(incoming: MatchIdentity, candidates: MatchCandidate[]): MatchDecision`
  - `normalizeName(name: string | null | undefined): string | null`

- [ ] **Step 1: Write the failing tests** (`match-contact-identity.test.ts`):

```ts
import { describe, it, expect } from "vitest";
import {
  decideContactMatch,
  normalizeName,
  type MatchCandidate,
} from "./match-contact-identity.js";

const cand = (o: Partial<MatchCandidate> & { id: string }): MatchCandidate => ({
  phoneE164: null,
  email: null,
  name: null,
  ...o,
});

describe("normalizeName", () => {
  it("trims, collapses whitespace, lowercases; empty -> null", () => {
    expect(normalizeName("  Jane   Tan ")).toBe("jane tan");
    expect(normalizeName("JANE TAN")).toBe("jane tan");
    expect(normalizeName("   ")).toBeNull();
    expect(normalizeName(null)).toBeNull();
  });
});

describe("decideContactMatch", () => {
  it("no candidates -> create", () => {
    expect(decideContactMatch({ phoneE164: "+6591234567", email: null, name: "Jane" }, [])).toEqual(
      { kind: "create" },
    );
  });
  it("1 candidate, name corroborated, no conflict -> reuse", () => {
    const c = [cand({ id: "x", phoneE164: "+6591234567", name: "Jane Tan" })];
    expect(
      decideContactMatch({ phoneE164: "+6591234567", email: null, name: "jane  tan" }, c),
    ).toEqual({ kind: "reuse", contactId: "x" });
  });
  it("email-only match, name corroborated -> reuse (null phone is not a conflict)", () => {
    const c = [cand({ id: "x", email: "jane@x.com", name: "Jane" })];
    expect(decideContactMatch({ phoneE164: null, email: "jane@x.com", name: "Jane" }, c)).toEqual({
      kind: "reuse",
      contactId: "x",
    });
  });
  it("candidate email mixed-case (old row) surfaced via phone -> normalized, not a conflict", () => {
    const c = [cand({ id: "x", phoneE164: "+6591234567", email: "Jane@X.com", name: "Jane" })];
    expect(
      decideContactMatch({ phoneE164: "+6591234567", email: "jane@x.com", name: "Jane" }, c),
    ).toEqual({ kind: "reuse", contactId: "x" });
  });
  it("same phone, different name -> create_flagged (not merged)", () => {
    const c = [cand({ id: "x", phoneE164: "+6591234567", name: "Bob" })];
    expect(decideContactMatch({ phoneE164: "+6591234567", email: null, name: "Jane" }, c)).toEqual({
      kind: "create_flagged",
    });
  });
  it("phone match + name match but conflicting email -> create_flagged (conflicting field)", () => {
    const c = [cand({ id: "x", phoneE164: "+6591234567", email: "a@x.com", name: "Jane" })];
    expect(
      decideContactMatch({ phoneE164: "+6591234567", email: "b@x.com", name: "Jane" }, c),
    ).toEqual({ kind: "create_flagged" });
  });
  it("missing name on incoming -> not corroborated -> create_flagged", () => {
    const c = [cand({ id: "x", phoneE164: "+6591234567", name: "Jane" })];
    expect(decideContactMatch({ phoneE164: "+6591234567", email: null, name: null }, c)).toEqual({
      kind: "create_flagged",
    });
  });
  it("missing name on candidate (old row) -> not corroborated -> create_flagged", () => {
    const c = [cand({ id: "x", phoneE164: "+6591234567", name: null })];
    expect(decideContactMatch({ phoneE164: "+6591234567", email: null, name: "Jane" }, c)).toEqual({
      kind: "create_flagged",
    });
  });
  it(">1 candidate -> create_flagged (ambiguous, never pick one)", () => {
    const c = [
      cand({ id: "x", phoneE164: "+6591234567", name: "Jane" }),
      cand({ id: "y", email: "jane@x.com", name: "Jane" }),
    ];
    expect(
      decideContactMatch({ phoneE164: "+6591234567", email: "jane@x.com", name: "Jane" }, c),
    ).toEqual({ kind: "create_flagged" });
  });
});
```

- [ ] **Step 2: Run to verify fail** — `pnpm --filter @switchboard/core test -- match-contact-identity`
      Expected: FAIL — module not found.

- [ ] **Step 3: Implement** `match-contact-identity.ts`:

```ts
import { normalizeEmail } from "../identity/normalize.js";

export interface MatchIdentity {
  phoneE164: string | null;
  /** Caller passes the lowercased/trimmed email (normalizeEmail), or null. */
  email: string | null;
  name: string | null;
}

export interface MatchCandidate {
  id: string;
  phoneE164: string | null;
  /** May be a raw (pre-normalization) email on legacy rows; normalized here at comparison. */
  email: string | null;
  name: string | null;
}

export type MatchDecision =
  | { kind: "create" }
  | { kind: "reuse"; contactId: string }
  | { kind: "create_flagged" };

/** Corroboration key: trim, collapse internal whitespace, lowercase. Empty/whitespace -> null. */
export function normalizeName(name: string | null | undefined): string | null {
  if (name == null) return null;
  const n = name.trim().replace(/\s+/g, " ").toLowerCase();
  return n.length > 0 ? n : null;
}

function emailKey(email: string | null): string | null {
  if (email == null) return null;
  const e = normalizeEmail(email);
  return e.length > 0 ? e : null;
}

/** Both sides have a non-empty name and they match after normalization. */
function namesCorroborate(a: MatchIdentity, c: MatchCandidate): boolean {
  const an = normalizeName(a.name);
  const cn = normalizeName(c.name);
  return an !== null && cn !== null && an === cn;
}

/** A field conflicts only when BOTH sides are non-null and differ (after normalization). Null != conflict. */
function fieldConflict(a: MatchIdentity, c: MatchCandidate): boolean {
  const aEmail = emailKey(a.email);
  const cEmail = emailKey(c.email);
  const emailConflict = aEmail !== null && cEmail !== null && aEmail !== cEmail;
  const phoneConflict = a.phoneE164 !== null && c.phoneE164 !== null && a.phoneE164 !== c.phoneE164;
  return emailConflict || phoneConflict;
}

/**
 * D1 decision: reuse ONLY on an exact single match corroborated by name with no conflicting field;
 * flag (create a separate record, never merge) on ambiguity (>1) or any conflict/uncorroborated match.
 */
export function decideContactMatch(
  incoming: MatchIdentity,
  candidates: MatchCandidate[],
): MatchDecision {
  if (candidates.length === 0) return { kind: "create" };
  if (candidates.length > 1) return { kind: "create_flagged" };
  const c = candidates[0];
  if (namesCorroborate(incoming, c) && !fieldConflict(incoming, c)) {
    return { kind: "reuse", contactId: c.id };
  }
  return { kind: "create_flagged" };
}
```

- [ ] **Step 4: Run to verify pass** — `pnpm --filter @switchboard/core test -- match-contact-identity` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/intents/match-contact-identity.ts packages/core/src/intents/match-contact-identity.test.ts
git commit -m "feat(core): pure contact-match decision (reuse/flag/create) for lead intake"
```

---

### Task 3: Store — `findByPhoneOrEmail` + `upsertContact` name/flag

**Files:**

- Modify: `packages/core/src/intents/lead-intake-handler.ts` (LeadIntakeStore interface only)
- Modify: `packages/db/src/stores/lead-intake-store.ts` (PrismaLeadIntakeStore)
- Test: `packages/db/src/stores/lead-intake-store.test.ts`

**Interfaces:**

- Produces on `LeadIntakeStore`:
  - `findByPhoneOrEmail(input: { organizationId: string; phoneE164: string | null; email: string | null }):
Promise<Array<{ id: string; name: string | null; phoneE164: string | null; email: string | null }>>`
  - `upsertContact` input gains `name?: string | null` and `duplicateContactRisk?: boolean`.

- [ ] **Step 1: Extend the `LeadIntakeStore` interface** in lead-intake-handler.ts. Add to `upsertContact`
      input: `name?: string | null;` and `duplicateContactRisk?: boolean;`. Add the method:

```ts
  /**
   * Candidate lookup for the intake identity matcher. Org-scoped; matches contacts whose normalized
   * phoneE164 equals `phoneE164` OR whose email equals `email`. Caller passes normalized values
   * (E.164 phone, lowercased email); a null branch is skipped; both null -> []. Returns up to 2 rows
   * (the matcher only branches on 0 / exactly-1 / >1, so >1 is sufficient to flag ambiguity).
   */
  findByPhoneOrEmail(input: {
    organizationId: string;
    phoneE164: string | null;
    email: string | null;
  }): Promise<Array<{ id: string; name: string | null; phoneE164: string | null; email: string | null }>>;
```

- [ ] **Step 2: Write the failing tests** in lead-intake-store.test.ts (mirror existing mocked-prisma
      patterns in this file). Mock `prisma.contact.findMany` + `prisma.contact.upsert`:

```ts
it("findByPhoneOrEmail builds an org-scoped OR over phoneE164 + email, take 2", async () => {
  const findMany = vi
    .fn()
    .mockResolvedValue([{ id: "x", name: "Jane", phoneE164: "+6591234567", email: "jane@x.com" }]);
  const store = new PrismaLeadIntakeStore({ contact: { findMany } } as unknown as PrismaDbClient);
  const rows = await store.findByPhoneOrEmail({
    organizationId: "org1",
    phoneE164: "+6591234567",
    email: "jane@x.com",
  });
  expect(findMany).toHaveBeenCalledWith({
    where: { organizationId: "org1", OR: [{ phoneE164: "+6591234567" }, { email: "jane@x.com" }] },
    select: { id: true, name: true, phoneE164: true, email: true },
    take: 2,
  });
  expect(rows).toEqual([{ id: "x", name: "Jane", phoneE164: "+6591234567", email: "jane@x.com" }]);
});

it("findByPhoneOrEmail returns [] when both identifiers are null (no query)", async () => {
  const findMany = vi.fn();
  const store = new PrismaLeadIntakeStore({ contact: { findMany } } as unknown as PrismaDbClient);
  expect(
    await store.findByPhoneOrEmail({ organizationId: "org1", phoneE164: null, email: null }),
  ).toEqual([]);
  expect(findMany).not.toHaveBeenCalled();
});

it("upsertContact persists name + duplicateContactRisk on create", async () => {
  const upsert = vi.fn().mockResolvedValue({ id: "new" });
  const store = new PrismaLeadIntakeStore({ contact: { upsert } } as unknown as PrismaDbClient);
  await store.upsertContact({
    organizationId: "org1",
    deploymentId: "d1",
    phone: "91234567",
    email: "Jane@X.com",
    name: "Jane Tan",
    sourceType: "ctwa",
    attribution: {},
    idempotencyKey: "k1",
    duplicateContactRisk: true,
  });
  const arg = upsert.mock.calls[0][0];
  expect(arg.create.name).toBe("Jane Tan");
  expect(arg.create.duplicateContactRisk).toBe(true);
});
```

- [ ] **Step 3: Run to verify fail** — `pnpm --filter @switchboard/db test -- lead-intake-store`
      Expected: FAIL — `findByPhoneOrEmail` not a function / `create.name` undefined.

- [ ] **Step 4: Implement** in lead-intake-store.ts. Add to `UpsertContactInput`: `name?: string | null;`
      and `duplicateContactRisk?: boolean;`. In `upsertContact`'s `create` block add `name: input.name ?? null,`
      and `duplicateContactRisk: input.duplicateContactRisk ?? false,`. (Leave `email: input.email ?? null` —
      the handler passes the already-normalized email.) Add the method:

```ts
  async findByPhoneOrEmail(input: {
    organizationId: string;
    phoneE164: string | null;
    email: string | null;
  }): Promise<Array<{ id: string; name: string | null; phoneE164: string | null; email: string | null }>> {
    const or: Array<Record<string, unknown>> = [];
    if (input.phoneE164) or.push({ phoneE164: input.phoneE164 });
    if (input.email) or.push({ email: input.email });
    if (or.length === 0) return [];
    const rows = await this.prisma.contact.findMany({
      where: { organizationId: input.organizationId, OR: or },
      select: { id: true, name: true, phoneE164: true, email: true },
      take: 2,
    });
    return rows.map((r) => ({
      id: r.id, name: r.name ?? null, phoneE164: r.phoneE164 ?? null, email: r.email ?? null,
    }));
  }
```

- [ ] **Step 5: Run to verify pass** — `pnpm --filter @switchboard/db test -- lead-intake-store` → PASS.

- [ ] **Step 6: Typecheck both packages** (turbo can false-green):

```bash
pnpm --filter @switchboard/core exec tsc --noEmit
pnpm --filter @switchboard/db exec tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/intents/lead-intake-handler.ts packages/db/src/stores/lead-intake-store.ts \
  packages/db/src/stores/lead-intake-store.test.ts
git commit -m "feat(db): findByPhoneOrEmail + name/duplicateContactRisk on the lead-intake store"
```

---

### Task 4: Handler orchestration (matcher → reuse/flag/create)

**Files:**

- Modify: `packages/core/src/intents/lead-intake-handler.ts`
- Test: `packages/core/src/intents/lead-intake-handler.test.ts`

**Interfaces:**

- Consumes: `decideContactMatch` (Task 2), `LeadIntakeStore.findByPhoneOrEmail` (Task 3),
  `normalizeToE164` (@switchboard/schemas), `normalizeEmail` (../identity/normalize.js).

- [ ] **Step 1: Write failing tests** (lead-intake-handler.test.ts) with a mocked `LeadIntakeStore`:

```ts
// reuse: corroborated single match -> returns existing id, NO upsertContact, activity logged
it("reuses an existing contact on a corroborated match and does not create a new one", async () => {
  const store = mockStore({
    findByPhoneOrEmail: vi
      .fn()
      .mockResolvedValue([
        { id: "existing", name: "Jane Tan", phoneE164: "+6591234567", email: null },
      ]),
  });
  const res = await new LeadIntakeHandler({ store }).handle(
    intake({ phone: "91234567", name: "jane tan" }),
  );
  expect(res).toEqual({ contactId: "existing", duplicate: false });
  expect(store.upsertContact).not.toHaveBeenCalled();
  expect(store.createActivity).toHaveBeenCalledWith(
    expect.objectContaining({ contactId: "existing" }),
  );
});

// consent non-widening (D1): reuse performs NO write to the existing contact, so an opted-out/revoked
// existing contact cannot be re-widened by an opt-in-bearing intake lead.
it("does not widen consent on reuse (no write to the matched contact)", async () => {
  const store = mockStore({
    findByPhoneOrEmail: vi
      .fn()
      .mockResolvedValue([{ id: "existing", name: "Jane", phoneE164: "+6591234567", email: null }]),
  });
  await new LeadIntakeHandler({ store }).handle(
    intake({ phone: "91234567", name: "Jane", channel: "whatsapp", source: "ctwa" }), // carries messagingOptIn
  );
  expect(store.upsertContact).not.toHaveBeenCalled(); // existing consent untouched by construction
});

// flag: same phone different name -> create_flagged with duplicateContactRisk true (separate record)
it("flags a same-phone-different-name lead and creates a separate contact", async () => {
  const store = mockStore({
    findByPhoneOrEmail: vi
      .fn()
      .mockResolvedValue([{ id: "other", name: "Bob", phoneE164: "+6591234567", email: null }]),
    upsertContact: vi.fn().mockResolvedValue({ id: "new" }),
  });
  const res = await new LeadIntakeHandler({ store }).handle(
    intake({ phone: "91234567", name: "Jane" }),
  );
  expect(res.contactId).toBe("new");
  expect(store.upsertContact).toHaveBeenCalledWith(
    expect.objectContaining({ duplicateContactRisk: true }),
  );
});

// create: no match -> upsert with flag false + name threaded
it("creates a new contact with name threaded and flag false when nothing matches", async () => {
  const store = mockStore({
    findByPhoneOrEmail: vi.fn().mockResolvedValue([]),
    upsertContact: vi.fn().mockResolvedValue({ id: "new" }),
  });
  await new LeadIntakeHandler({ store }).handle(intake({ phone: "91234567", name: "Jane Tan" }));
  expect(store.upsertContact).toHaveBeenCalledWith(
    expect.objectContaining({ duplicateContactRisk: false, name: "Jane Tan" }),
  );
});

// null-phone email-only: matched + corroborated -> reuse
it("reuses on an email-only corroborated match (null phone)", async () => {
  const store = mockStore({
    findByPhoneOrEmail: vi
      .fn()
      .mockResolvedValue([{ id: "existing", name: "Jane", phoneE164: null, email: "jane@x.com" }]),
  });
  const res = await new LeadIntakeHandler({ store }).handle(
    intake({ phone: undefined, email: "Jane@X.com", name: "Jane" }),
  );
  expect(res.contactId).toBe("existing");
  // email passed to findByPhoneOrEmail is normalized (lowercased)
  expect(store.findByPhoneOrEmail).toHaveBeenCalledWith(
    expect.objectContaining({ email: "jane@x.com" }),
  );
});

// exact idempotency replay still short-circuits before the matcher
it("short-circuits on an exact idempotency match (no matcher, no activity)", async () => {
  const store = mockStore({ findContactByIdempotency: vi.fn().mockResolvedValue({ id: "dup" }) });
  const res = await new LeadIntakeHandler({ store }).handle(intake({ phone: "91234567" }));
  expect(res).toEqual({ contactId: "dup", duplicate: true });
  expect(store.findByPhoneOrEmail).not.toHaveBeenCalled();
  expect(store.createActivity).not.toHaveBeenCalled();
});
```

(Define `mockStore(overrides)` returning a full `LeadIntakeStore` of `vi.fn()`s with sensible defaults, and
`intake(contactOverrides)` building a valid `LeadIntake`. Mirror existing test helpers in this file if present.)

- [ ] **Step 2: Run to verify fail** — `pnpm --filter @switchboard/core test -- lead-intake-handler`
      Expected: FAIL (handler still always upserts; findByPhoneOrEmail not called).

- [ ] **Step 3: Implement** the new `handle` body (replace lines ~47-89). Add imports:
      `import { normalizeToE164 } from "@switchboard/schemas";` `import { normalizeEmail } from "../identity/normalize.js";`
      `import { decideContactMatch } from "./match-contact-identity.js";`

```ts
  async handle(intake: LeadIntake): Promise<LeadIntakeResult> {
    const existing = await this.deps.store.findContactByIdempotency(
      intake.organizationId,
      intake.idempotencyKey,
    );
    if (existing) {
      return { contactId: existing.id, duplicate: true };
    }

    const phoneE164 = normalizeToE164(intake.contact.phone ?? null);
    const email = intake.contact.email ? normalizeEmail(intake.contact.email) : null;

    const candidates =
      phoneE164 || email
        ? await this.deps.store.findByPhoneOrEmail({
            organizationId: intake.organizationId,
            phoneE164,
            email,
          })
        : [];
    const decision = decideContactMatch(
      { phoneE164, email, name: intake.contact.name ?? null },
      candidates,
    );

    let contactId: string;
    if (decision.kind === "reuse") {
      // D1: reuse preserves the existing contact untouched. Lead intake only ever carries an opt-in or
      // neutral signal (never a restriction), so the most-restrictive consolidation of {existing, incoming}
      // is always the existing state. Writing nothing here is what guarantees consent is never widened.
      contactId = decision.contactId;
    } else {
      const isWhatsAppLead = intake.contact.channel === "whatsapp";
      const optInSource = isWhatsAppLead
        ? intake.source === "ctwa"
          ? "ctwa"
          : intake.source === "instant_form"
            ? "web_form"
            : null
        : null;
      const contact = await this.deps.store.upsertContact({
        organizationId: intake.organizationId,
        deploymentId: intake.deploymentId,
        phone: intake.contact.phone,
        email, // normalized (lowercased) at write so the email index lookup is canonical
        name: intake.contact.name ?? null,
        channel: intake.contact.channel,
        sourceType: intake.source,
        sourceAdId: intake.attribution.sourceAdId,
        sourceCampaignId: intake.attribution.sourceCampaignId,
        sourceAdsetId: intake.attribution.sourceAdsetId,
        attribution: intake.attribution,
        idempotencyKey: intake.idempotencyKey,
        duplicateContactRisk: decision.kind === "create_flagged",
        ...(optInSource ? { messagingOptIn: true, messagingOptInSource: optInSource } : {}),
      });
      contactId = contact.id;
    }

    await this.deps.store.createActivity({
      contactId,
      organizationId: intake.organizationId,
      deploymentId: intake.deploymentId,
      kind: "lead_received",
      sourceType: intake.source,
      metadata: { attribution: intake.attribution },
    });
    return { contactId, duplicate: false };
  }
```

- [ ] **Step 4: Run to verify pass** — `pnpm --filter @switchboard/core test -- lead-intake-handler` → PASS.

- [ ] **Step 5: Typecheck core** — `pnpm --filter @switchboard/core exec tsc --noEmit` → clean.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/intents/lead-intake-handler.ts packages/core/src/intents/lead-intake-handler.test.ts
git commit -m "feat(core): dedup-by-reuse + flag-on-ambiguity in the lead-intake handler"
```

---

### Task 5: Issuance ORs the persisted intake flag into `evaluateExceptions`

**Files:**

- Modify: `packages/core/src/skill-runtime/tools/issue-receipted-booking.ts` (~24-33 tx type, ~82-114)
- Test: `packages/core/src/skill-runtime/tools/issue-receipted-booking.test.ts`

**Interfaces:**

- Consumes: `Contact.duplicateContactRisk` column (Task 1).

- [ ] **Step 1: Write the failing test** (mirror the existing #1212 phone-probe test in this file). With a
      fake tx whose `contact.findFirst` returns `{ duplicateContactRisk: true, phoneE164: null, ... }` and the
      self-exclusion probe returns null, assert the created ReceiptedBooking's `exceptions` includes a
      `duplicate_contact_risk` entry. Also assert: persisted false + no other-phone -> NO entry.

```ts
it("raises duplicate_contact_risk from the persisted intake flag even when no other contact shares the phone", async () => {
  const created: Array<{ data: Record<string, unknown> }> = [];
  const tx = {
    receiptedBooking: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn(async (a) => {
        created.push(a);
      }),
    },
    contact: {
      findFirst: vi
        .fn()
        // first call: evidence read (flag persisted true, no phone)
        .mockResolvedValueOnce({
          leadgenId: null,
          sourceType: null,
          firstTouchChannel: null,
          pdpaJurisdiction: null,
          consentGrantedAt: null,
          consentRevokedAt: null,
          phoneE164: null,
          duplicateContactRisk: true,
        }),
    },
  };
  await issueReceiptedBookingInTx(tx as never, baseArgs);
  const exceptions = created[0].data.exceptions as Array<{ code: string }>;
  expect(exceptions.some((e) => e.code === "duplicate_contact_risk")).toBe(true);
});
```

- [ ] **Step 2: Run to verify fail** — `pnpm --filter @switchboard/core test -- issue-receipted-booking`
      Expected: FAIL — flag stays false (persisted field neither selected nor ORed).

- [ ] **Step 3: Implement.** In `ReceiptedBookingIssuanceTx.contact.findFirst` return type (~24-33) add
      `duplicateContactRisk?: boolean | null;`. In the evidence `select` (~84-92) add `duplicateContactRisk: true,`.
      Replace the probe block (~102-114):

```ts
const rawPhoneE164 = evidenceContact?.phoneE164 ?? null;
// Intake-time producer (A4): a contact flagged at lead intake (ambiguous/conflicting identity) carries a
// persisted duplicateContactRisk; OR it with the issuance-time phone probe so the intake producer feeds
// evaluateExceptions. Boolean OR -> at most one duplicate_contact_risk entry; mergeExceptions de-dups by code.
let duplicateContactRisk = evidenceContact?.duplicateContactRisk === true;
if (!duplicateContactRisk && rawPhoneE164 && rawPhoneE164.trim().length > 0) {
  const otherWithSamePhone = await tx.contact.findFirst({
    where: {
      organizationId: args.organizationId,
      phoneE164: rawPhoneE164,
      id: { not: args.contactId },
    },
    select: { id: true },
  });
  duplicateContactRisk = otherWithSamePhone !== null;
}
```

- [ ] **Step 4: Run to verify pass** — `pnpm --filter @switchboard/core test -- issue-receipted-booking` → PASS.
      Confirm the pre-existing #1212 phone-probe tests still pass (no regression).

- [ ] **Step 5: Typecheck core** — `pnpm --filter @switchboard/core exec tsc --noEmit` → clean.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/skill-runtime/tools/issue-receipted-booking.ts \
  packages/core/src/skill-runtime/tools/issue-receipted-booking.test.ts
git commit -m "feat(core): OR the intake duplicate-contact flag into issuance exceptions"
```

---

## Definition of Done (acceptance → evidence)

- CTWA + Instant-Form same-person pair collapses to ONE Contact on corroboration → Task 4 reuse test.
- Same-phone-different-name flagged, NOT merged → Task 2 + Task 4 flag tests (separate contact + flag true).
- `duplicate_contact_risk` has a live intake-time producer feeding `evaluateExceptions` → Task 1 column +
  Task 4 sets it + Task 5 ORs it at issuance into evaluateExceptions.
- Consent consolidated to most-restrictive on reuse, never widened → Task 4 "does not widen consent" test
  (reuse performs no write to the matched contact).
- null-phone email-only + email-only-no-name handled → Task 2 email-only reuse + missing-name flag tests;
  Task 4 email-only reuse test.
- Migration db:check-drift green (if PG up; else CI-validated) → Task 1 Step 8.
- VERIFY (separate phase): `pnpm typecheck`, `pnpm test`, `pnpm --filter @switchboard/db test`,
  `pnpm --filter @switchboard/core test`, `pnpm lint`, `pnpm format:check`, `pnpm arch:check`,
  `CI=1 npx tsx scripts/local-verify-fast.ts`, `pnpm audit --audit-level=high`, `pnpm eval:governance`
  (decision-engine-adjacent? — evaluateExceptions is touched only by an OR; run it to be safe), then an
  independent fresh-context review at zero severity>=warn. SURFACE the PR (no auto-merge: prisma + consent + receipts).
