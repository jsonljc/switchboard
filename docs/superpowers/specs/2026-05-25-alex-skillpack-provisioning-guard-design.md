# Alex Skill-Pack Provisioning Guard — Design

**Date:** 2026-05-25
**Branch (this spec):** `worktree-alex-skillpack-provisioning-guard` (based on `origin/main`)
**Author:** Claude Opus 4.7 (1M context), at user request
**Status:** Implementation design (spec). Awaiting user review → then writing-plans → code-only implementation PR.
**Parent:** Deferred slice of `docs/superpowers/specs/2026-05-25-alex-live-integration-fixes-design.md` (§"Deferred", line ~189: *"`assertAlexSkillPackSeeded` → prod provisioning … whether a seed failure should set a provisioning status rather than `console.warn` silently"*). The keystone (PR #686) and multi-turn adapter (PR #681) fixes are MERGED.

**Locked summary (the one-paragraph contract):**

> Alex's medspa skill pack remains best-effort seeded during config bootstrap and fail-open at live runtime, but becomes a hard precondition at activation. The readiness layer calls the existing `assertAlexSkillPackSeeded` against live DB state and emits a blocking `alex-skill-pack-seeded` check. Activation already blocks on readiness, so enforcement requires no route-level change.

---

## 0. Operating context (read first)

- **Base:** authored against `origin/main` (`405348da` at write time). The worktree was created from `09b72a8f`; the two intervening commits (#688 dashboard P1-A home, #689 core async-failure refactor) touch **no** in-scope file, so every file:line reference below is accurate against current `origin/main`. The implementation branch must be cut from up-to-date `origin/main`.
- **Doctrine:** this spec lands on `main` via a focused docs PR; the implementation is a separate, code-only PR consuming the merged spec. Mutations still flow through `PlatformIngress`; `WorkTrace` stays canonical; no `Agent*` types added to core; no new ingress/tool/runtime-state surface. `apps/api` (layer 5) may import `@switchboard/db` (layer 4); core does **not** import db (and is untouched here).

---

## 1. Goal & non-goals

**Goal.** Close the only remaining loud-surface gap from the fail-open redesign: a silent `seedAlexSkillPack` failure must make the org **unable to go live** (blocked at the activation gate) and must leave an operator-readable log line — without making the hot config read or live lead traffic brittle.

**Non-goals (scope fence).**
- No change to `SkillMode` (stays fail-open), the Anthropic adapter, or the claim classifier.
- No new `provisioningStatus` value (e.g. no `"degraded"`); a blocked org simply stays `"pending"`.
- No change to `apps/api/src/routes/organizations.ts` — the GET `/config` best-effort seed + try/catch is **deliberately kept**.
- No audit-ledger write in this PR (see §6).
- No schema migration, no new env var, no new tool/ingress/route.
- No broadening to unrelated provisioning logic.

---

## 2. The gap (verified on `origin/main`)

- `assertAlexSkillPackSeeded` (`packages/db/src/seed/seed-alex-skill-pack.ts:93`) is exported (`packages/db/src/index.ts:141`) and fully unit-tested (`seed-alex-skill-pack.test.ts:391-473`) but has **zero production callers**.
- The only live caller of `seedAlexSkillPack` is the lazy seed inside **GET `/:orgId/config`** (`organizations.ts:89-93`), wrapped in a best-effort `try/catch` that only `console.warn`s. A silent seed failure therefore surfaces **nowhere** with enforcement.
- Live `SkillMode` is deliberately fail-open + quiet on a missing/empty pack (PR #686 §2.5): the claim classifier is the runtime hard gate, and *presence* was to be enforced loudly at provisioning + eval-preflight instead of on live traffic.
- The eval-preflight half shipped (`evals/alex-conversation/eval-preflight.ts:34` `assertSkillPackContentPresent`). **This spec is the provisioning half.**

**Provisioning lifecycle (why the activation gate is the right home):**
- **GET `/config`** (`organizations.ts:43-97`) — lazy-creates `OrganizationConfig(provisioningStatus:"pending")`, seeds listing/deployment/day-one-agents + the skill pack (best-effort). A general-purpose read that auto-creates defaults so the UI always renders.
- **POST `/provision`** (`organizations.ts:191-543`) — creates Connection + ManagedChannel rows; does **not** seed the skill pack.
- **POST agent activate** (`agents.ts:357-419`) — the authoritative go-live gate: `buildReadinessContext` → `checkReadiness`; returns a structured **400** `{ error: "Readiness checks failed", readiness: report }` when `!report.ready` (`agents.ts:371-375`); otherwise flips channels to `active`, sets `OrganizationConfig.provisioningStatus:"active"` + `onboardingComplete:true` (`agents.ts:383-395`), and writes an `agent.activated` audit entry.
- `provisioningStatus:"active"` is consumed downstream (reconciliation cron `bootstrap/inngest.ts:389`).

---

## 3. Decisions (locked with user)

1. **Enforce at the activation gate, as a blocking readiness check** — not at the seed site, not on live traffic. The fail-open live path means the guard must be loud only where it is safe to fail loud (a deliberate operator action).
2. **Reuse the existing throwing guard.** `buildReadinessContext` calls `assertAlexSkillPackSeeded` inside `try/catch` and converts a throw into a `pass`/`fail` context field. This gives the guard its **first production caller** (closing the original "zero callers" finding) and reuses `ALEX_SKILL_PACK_SCOPES` transitively (no hardcoded count).
3. **No new status value; no `agents.ts` change.** The activate handler already returns a structured 400 on `!report.ready`, so a new blocking check is enforced automatically; a blocked org stays `"pending"`.
4. **Message split.** The customer-facing readiness `message` is friendly; the precise missing `(kind, scope)` (the guard's thrown message) goes to a `console.warn` log line and to an internal `alexSkillPackDiagnostic` context field — the pack is system-owned and not customer-fixable. The check's public `message` never includes the diagnostic; `alexSkillPackDiagnostic` lives on `ReadinessContext` only (not on `ReadinessCheck` / `ReadinessReport`), so it is never serialized to clients — GET `/readiness` and the activate 400 return only the report's `checks`.
5. **No audit-ledger write here** (§6).

**Check shape (locked):**
```ts
id:       "alex-skill-pack-seeded",
label:    "Alex knowledge pack ready",
blocking: true,
// message uses ONLY the friendly strings below — never alexSkillPackDiagnostic
// pass:  "Alex's medspa knowledge pack is seeded"
// fail:  "Alex's knowledge pack is still finalizing. Please try again shortly or contact support if this persists."
```

---

## 4. The change

### (a) `packages/db/src/seed/seed-alex-skill-pack.ts` — narrow the guard's parameter

Replace the `PrismaClient` parameter of `assertAlexSkillPackSeeded` with a narrow **structural reader** interface, exported alongside the function (and re-exported from `packages/db/src/index.ts`):

```ts
export interface KnowledgeEntryReader {
  knowledgeEntry: {
    findFirst(args: {
      where: { organizationId: string; kind: KnowledgeKind; scope: string; active: boolean };
    }): Promise<{ content: string | null } | null>;
  };
}

export async function assertAlexSkillPackSeeded(
  prisma: KnowledgeEntryReader,
  orgId: string,
): Promise<void> { /* body unchanged */ }
```

- Backward-compatible: a full `PrismaClient` and the existing test mock (`seed-alex-skill-pack.test.ts:70-122`, cast to `PrismaClient`) both structurally satisfy `KnowledgeEntryReader`. `KnowledgeEntry.content` is `String @db.Text` (non-null), so the real return is assignable to `{ content: string | null } | null`. Function body, behavior, and thrown messages are **unchanged** — existing guard tests stay green.
- Rationale: lets the readiness module pass its narrow prisma type to the guard without dragging a full `PrismaClient` shape (or a cast) into `readiness.ts`. Mirrors the existing narrow-store pattern already used by `PrismaLike` in `readiness.ts` and `KnowledgeEntryStoreForResolver` in core.

### (b) `apps/api/src/routes/readiness.ts` — context field + builder + pure check

1. **`PrismaLike`** (`readiness.ts:71-145`): add a `knowledgeEntry` member equal to `KnowledgeEntryReader["knowledgeEntry"]` (import `type { KnowledgeEntryReader }` from `@switchboard/db`). `app.prisma` (full `PrismaClient`) continues to satisfy `PrismaLike`.
2. **`ReadinessContext`** (`readiness.ts:30-67`): add
   ```ts
   alexSkillPackSeeded: boolean;
   alexSkillPackDiagnostic: string | null;
   ```
   `alexSkillPackDiagnostic` is internal-only (consumed by the `console.warn` and the IO test); it is never copied into a `ReadinessCheck` / `ReadinessReport`, so it cannot leak into a serialized API response.
3. **`buildReadinessContext`** (`readiness.ts:149-242`): after the existing `Promise.all`, reuse the guard:
   ```ts
   let alexSkillPackSeeded = true;
   let alexSkillPackDiagnostic: string | null = null;
   try {
     await assertAlexSkillPackSeeded(prisma, orgId);
   } catch (err) {
     alexSkillPackSeeded = false;
     alexSkillPackDiagnostic = err instanceof Error ? err.message : String(err);
     console.warn(`[readiness] alex-skill-pack-seeded failed org=${orgId}: ${alexSkillPackDiagnostic}`);
   }
   ```
   and include `alexSkillPackSeeded` + `alexSkillPackDiagnostic` in the returned object. (Kept out of the `Promise.all` because it produces two derived values via `try/catch`; the guard issues ≤3 sequential `findFirst` reads — negligible for a rare go-live action.)
4. **`checkReadiness`** (`readiness.ts:246-285`): push a new pure `checkAlexSkillPackSeeded(ctx)` (the locked shape in §3). With `makeContext` defaulting to seeded, `ready` stays `true` for already-passing fixtures.

### (c) `apps/api/src/routes/agents.ts` — **no change**

The activate handler already returns 400 when `!report.ready` and only then flips `provisioningStatus:"active"`. The new blocking check is enforced through that existing path. The same check also appears in the read-only GET `/:agentId/readiness` report (`readiness.ts:530-553`) so operators see it pre-launch.

---

## 5. Failure contract, lifecycle & idempotency (answers to the open questions)

- **Status vs warn:** neither a 500 nor a new status value. A broken/empty pack keeps `provisioningStatus:"pending"` and yields the **existing** structured 400 from the activate route, with the failing `alex-skill-pack-seeded` check named in the report. A `console.warn` (operator log) carries the precise missing scope.
- **Where / contract:** the readiness layer (`buildReadinessContext` + `checkReadiness`), enforced at activation and surfaced in GET `/readiness`. Failure contract = a failed *blocking* readiness check → activate 400; no exception escapes `buildReadinessContext` (the guard's throw is caught and converted).
- **Idempotency / re-provisioning:** `seedAlexSkillPack` stays idempotent + best-effort at GET `/config` (self-heals on the next config access); the readiness check re-reads live DB state on every call, so once the seed heals, re-running activate passes. No retry/dedup logic needed.
- **Interaction with the existing best-effort catch:** unchanged. We do **not** hard-fail the hot config read; the compensating control lives entirely at the readiness/activation layer.
- **Polling caveat:** because the assertion runs inside `buildReadinessContext`, the `console.warn` may repeat while the org remains unseeded (GET `/readiness` can be polled). Acceptable for this small guard PR; if readiness polling becomes noisy, move diagnostics to the activation path only or add rate-limited logging.

---

## 6. Audit-ledger (explicitly deferred)

This PR ships `console.warn` + the blocking readiness check only. An audit/event emission is an **optional** follow-up, and only if an established low-friction helper exists with no new schema or thought-tax. If ever added it must be **non-blocking** and **dedup-friendly** (readiness can be called repeatedly) — keeping it out here avoids new failure questions (what if the audit write fails? block? retry? duplicate?). Enforcement matters more than observability polish.

---

## 7. Blast radius

- **Files:** `seed-alex-skill-pack.ts` (signature narrow + export), `packages/db/src/index.ts` (export the interface), `readiness.ts` (context + builder + check), and tests. `agents.ts`, `organizations.ts`, `SkillMode`, the adapter, and the classifier are untouched.
- **Behavioral:** the only runtime behavior change is at the go-live gate and the GET `/readiness` report (one additional check, additive to the `checks[]` array — existing consumers iterate the array). Already-ready orgs (seeded pack) are unaffected.
- **Test insulation:** `api-governance.test.ts:12` and `cross-tenant-isolation.test.ts:29` **`vi.mock`** the readiness module, so they are unaffected. No existing test calls the real `buildReadinessContext`.

---

## 8. Tests (CI has no Postgres → mocked Prisma / pure context)

- **`readiness.test.ts` (pure `checkReadiness`):**
  - extend `makeContext()` (`:8`) with `alexSkillPackSeeded: true, alexSkillPackDiagnostic: null`;
  - bump the headline `expect(report.checks).toHaveLength(11)` (`:69`) → `12`;
  - **add the failure case** (the gating regression): `checkReadiness(makeContext({ alexSkillPackSeeded: false, alexSkillPackDiagnostic: "missing …" }))` → the `alex-skill-pack-seeded` check is `status:"fail"`, `blocking:true`, and `report.ready === false`.
- **New `buildReadinessContext` IO test (the full-chain proof, the whole point):** with a hand-built `PrismaLike` mock (mirror the mocked-Prisma pattern in `api-organizations.test.ts`):
  - **happy:** `knowledgeEntry.findFirst` returns non-empty rows → `ctx.alexSkillPackSeeded === true`, `ctx.alexSkillPackDiagnostic === null`;
  - **failure:** `knowledgeEntry.findFirst` returns `null` → assert the entire chain:
    - `ctx.alexSkillPackSeeded === false`
    - `ctx.alexSkillPackDiagnostic` is set (non-null)
    - `checkReadiness(ctx).ready === false`
    - the failing check has `id === "alex-skill-pack-seeded"` and `blocking === true`.
- **`seed-alex-skill-pack.test.ts`:** existing guard suite stays green under the narrowed signature; **add** one test that a *minimal* structural reader (only `knowledgeEntry.findFirst`) is accepted, proving the narrowing.
- Run `pnpm test`, `pnpm typecheck`, `pnpm format:check` before the PR. (`pnpm reset` first if lower-layer `@switchboard/db` exports look stale.)

---

## 9. Open implementation details (resolve in the plan)

- Confirm `PrismaClient` satisfies the narrowed `KnowledgeEntryReader` and that `PrismaLike` (with the new `knowledgeEntry` member) still accepts `app.prisma`, via `pnpm typecheck`. If Prisma's generic `findFirst` resists structural assignment, fall back to the established `PrismaLike` style (explicit method signature) rather than a cast — no `any`.
- Decide exact import surface in `readiness.ts`: `assertAlexSkillPackSeeded` + `type { KnowledgeEntryReader }` from `@switchboard/db`. `ALEX_SKILL_PACK_SCOPES` is **not** needed in `readiness.ts` (the guard owns the loop).
- `.js` extensions on all relative ESM imports; Prettier (double quotes, semis, 100 width); co-located `*.test.ts`.

---

## 10. PR shape & sequencing

- **This (docs) PR:** the spec, plus the implementation plan produced by writing-plans → `main`.
- **Implementation PR (code-only):** cut a fresh worktree from up-to-date `origin/main`, execute via subagent-driven-development, open a code-only PR. Two disjoint commits map cleanly to (a) the db guard narrow + (b) the readiness wiring + tests.

---

## 11. Verification summary

Gap and lifecycle confirmed with file:line evidence against `origin/main`: the guard has zero production callers; the only live `seedAlexSkillPack` caller is the best-effort GET `/config` block; the activate route already gates on `report.ready` and is the sole writer of `provisioningStatus:"active"` in app code; `checkReadiness` is pure and `buildReadinessContext` owns the IO; the two readiness-touching tests mock the module; `KnowledgeEntry.content` is non-null. The design adds one blocking readiness check, reuses the tested guard verbatim, and changes no live-traffic or hot-read behavior.
