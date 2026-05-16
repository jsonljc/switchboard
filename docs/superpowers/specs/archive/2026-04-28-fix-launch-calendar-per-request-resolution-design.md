# Fix: Calendar per-request provider resolution

**Date:** 2026-04-28
**Author:** brainstorming session, post PR #281
**Branch slug:** `fix/launch-calendar-per-request-resolution`
**Predecessor:** PR #281 (`fix/launch-calendar-readiness-visibility`) — merged 2026-04-28. PR 1 of the calendar split out of PR #280. This branch rebases onto `main` post-#281.

---

## Background

PR #280 closed launch-blockers #8 (WhatsApp contact identity) and #9a/#9b (`LocalCalendarProvider` `emailSender` wiring + `findOverlapping` org-scope leak) and explicitly deferred two pieces, both named in #280's "Out of scope (carry-forward)" section:

1. **Readiness visibility** for the Noop fallback. **Shipped** in PR #281.
2. **Per-request `CalendarProvider` resolution.** Today `apps/api/src/bootstrap/skill-mode.ts:65` calls `resolveCalendarProvider(prismaClient, logger)` once at boot with no `orgId`. The resulting singleton is injected into `createCalendarBookTool({ calendarProvider, ... })` at `skill-mode.ts:155`, where it lives in `toolsMap` shared across **all** orgs. The org-scoped `findOverlapping` closure that PR #280 added cannot do its job for orgs whose `businessHours` were not the boot-time pick.

This spec covers piece 2 — per-request resolution — and only that.

### Already-shipped (do not re-touch)

- `LocalCalendarProvider.findOverlapping` org-scope closure (PR #280 §4).
- `LocalCalendarProvider` `emailSender` wiring + `BOOKING_FROM_EMAIL` env var (PR #280 §3).
- WhatsApp contact identity resolution at the chat-gateway boundary (PR #280 §1, §2).
- `describeCalendarReadiness` helper + `/readiness` calendar check (PR #281).

---

## Architecture findings (from brainstorming)

- The `escalate` tool already has the right per-request shape (`createEscalateToolFactory(deps) → (ctx: SkillRequestContext) → SkillTool`), but it is wired with `__schema_only__` placeholders at `skill-mode.ts:197–202`. **There is no code anywhere that re-resolves tools per request.** `SkillExecutor` holds a single `Map<string, SkillTool>` and calls `op.execute(toolUse.input)` directly. So escalate today executes with `orgId: "__schema_only__"` — a latent bug, but **out of scope for this PR**.
- The `calendar-book` tool's `slots.query` and `booking.create` operations already pass `orgId` as part of the LLM-supplied tool input (`booking.create` requires it; `slots.query` does not declare it today). Resolving the provider from `params.orgId` is therefore mechanically possible without changing the executor contract.
- `params.orgId` being LLM-controlled is a **trust-boundary limitation**, not the desired end-state. The desired end-state moves org identity into a trusted `SkillRequestContext` threaded through `op.execute(...)`. That is a separate executor-contract PR.

This spec chooses the narrow option (**A+**): inject a `CalendarProviderFactory` into `calendar-book`, resolve per operation using `params.orgId`, do not change the executor contract, do not touch escalate, and explicitly mark the LLM-orgId path as technical debt.

---

## Constraints carried forward

- Controlled beta, ~10 orgs, free pilot, founder-assisted acceptable.
- No `apps/api` ↔ `apps/chat` cross-imports.
- Capability building, not architecture pass.
- File-size limits: error 600 lines, warn 400 lines.
- Co-located tests for every new module.
- Conventional Commits.
- No silent fake-success.

---

## Section 1 — Scope and non-goals

### Scope

- Replace the boot-time singleton `calendarProvider` in `apps/api/src/bootstrap/skill-mode.ts` with a per-org `CalendarProviderFactory`.
- Inject the factory into `createCalendarBookTool` instead of a `CalendarProvider` instance.
- `calendar-book` resolves the provider per operation using `params.orgId`. **This is explicitly a current runtime limitation, not the desired trust model;** org identity must move to trusted `SkillRequestContext` in a follow-up executor-contract PR.
- `calendar-book` rejects an unconfigured provider (today's `NoopCalendarProvider`) with a visible failure for both `slots.query` and `booking.create`.
- Factory memoizes per `orgId` using Promise caching with rejection cleanup; no eviction in this PR.
- Export `isNoopCalendarProvider` from the noop provider module in `apps/api`. Pass an app-level capability adapter (`isCalendarProviderConfigured`) into `calendar-book` so core stays decoupled from app-level provider concepts.
- Add unit tests at the provider-factory layer and the `calendar-book` tool layer.

### Non-goals

- No `SkillExecutor` contract changes.
- No threading of `SkillRequestContext` into `op.execute`.
- No fix to `escalate`'s `__schema_only__` placeholder wiring.
- No move of org identity from LLM-controlled tool input into trusted request context. Marked as technical debt with a TODO referencing the follow-up PR.
- No cache eviction or TTL. Comment notes production may need this if calendar config can rotate at runtime.
- No end-to-end `SkillMode.execute` cross-org integration test.
- No changes to `describeCalendarReadiness` or the readiness route. The prior readiness helper remains the source of visibility truth; this PR preserves existing runtime provider-resolution semantics and only changes when/how per-org resolution happens.
- No changes to `LocalCalendarProvider` or `findOverlapping` semantics shipped in PR #280.

---

## Section 2 — Provider factory in `apps/api/src/bootstrap`

### Files

- `apps/api/src/bootstrap/calendar-provider-factory.ts` (new).
- `apps/api/src/bootstrap/__tests__/calendar-provider-factory.test.ts` (new).
- `apps/api/src/bootstrap/skill-mode.ts` (modified — only wires the factory; `resolveCalendarProvider` is removed and its body moves into the factory module).

### Public type

```ts
import type { CalendarProvider } from "@switchboard/schemas";

export type CalendarProviderFactory = (orgId: string) => Promise<CalendarProvider>;
```

### Factory construction

```ts
export interface CalendarProviderFactoryDeps {
  prismaClient: PrismaClient;
  logger: Pick<typeof someLogger, "info" | "error" | "warn">; // confirm exact logger type in read-only Task 1
  env?: { GOOGLE_CALENDAR_CREDENTIALS?: string; GOOGLE_CALENDAR_ID?: string };
}

export function createCalendarProviderFactory(
  deps: CalendarProviderFactoryDeps,
): CalendarProviderFactory;
```

`env` is an optional injection point so tests do not need to mutate `process.env`. When omitted, the factory reads `process.env`.

### Memoization (rejection cleanup pattern)

```ts
const cache = new Map<string, Promise<CalendarProvider>>();

const factory: CalendarProviderFactory = (orgId: string) => {
  if (!orgId || typeof orgId !== "string" || orgId.trim() === "") {
    return Promise.reject(new Error("ORG_ID_REQUIRED"));
  }

  const existing = cache.get(orgId);
  if (existing) return existing;

  const promise = resolveForOrg(orgId).catch((error) => {
    cache.delete(orgId);
    throw error;
  });

  cache.set(orgId, promise);
  return promise;
};
```

Comment on the cache declaration:

```ts
// No eviction in beta (~10 orgs, process-lifetime cache mirrors today's
// singleton lifetime per orgId). Production should add TTL or explicit
// invalidation if calendar credentials/business hours can rotate at runtime.
```

### Inner resolver (`resolveForOrg`)

Preserves existing runtime precedence: Google env → Local `businessHours` → Noop.

1. `prismaClient.organizationConfig.findFirst({ where: <runtime-shape>, select: { businessHours: true } })` — **mirror exact shape from current `resolveCalendarProvider` (today: `where: { id: orgId }`)**. Confirm in read-only Task 1; do not "fix" the field name in this PR.
2. If `env.GOOGLE_CALENDAR_CREDENTIALS` and `env.GOOGLE_CALENDAR_ID` are set → build Google provider; on success log + return; on construction error log + fall through to Local. **This preserves today's global Google env behavior. It does not yet provide per-org Google credentials/calendar IDs; that remains future configuration work if needed.**
3. Else if `businessHours` is a non-array object → build `LocalCalendarProvider` with the existing `localStore` closure (cloned verbatim from current code, including the org-scoped `findOverlapping` from PR #280). The `filterOrgId` argument is now bound to the resolving org's id by closure.
4. Else → return `NoopCalendarProvider`.

### Bootstrap wiring change in `skill-mode.ts`

```ts
// Before:
const calendarProvider = await resolveCalendarProvider(prismaClient, logger);
// ...
createCalendarBookTool({ calendarProvider, ... })

// After:
const calendarProviderFactory = createCalendarProviderFactory({ prismaClient, logger });
// ...
createCalendarBookTool({
  calendarProviderFactory,
  isCalendarProviderConfigured: (provider) => !isNoopCalendarProvider(provider),
  ...
})
```

The old `resolveCalendarProvider` function and the `// per-request resolution is the deeper fix` comment are removed at the same time. The comment is replaced with a more precise TODO: this PR moves calendar provider resolution from boot-time singleton to per-org factory resolution, but the deeper trust fix is still moving org identity from `params.orgId` into trusted `SkillRequestContext`.

### Tests (`calendar-provider-factory.test.ts`)

1. **Same orgId reuses promise** — two `factory("org-A")` calls return the same `Promise` reference; `prismaClient.organizationConfig.findFirst` is invoked exactly once.
2. **Different orgIds resolve independently** — `factory("org-A")` and `factory("org-B")` produce providers reflecting their own `OrganizationConfig` rows; verified behaviorally where possible (different `businessHours` produce different available slots).
3. **Rejected construction is cleared from cache** — first call rejects (Prisma throws); after the underlying issue is fixed, a second call for the same orgId succeeds.
4. **Concurrent first calls share construction** — two simultaneous `factory("org-A")` calls (no `await` between them) result in exactly one `findFirst` invocation.
5. **Noop fallback** — org with no `businessHours` and no Google env returns a provider for which `isNoopCalendarProvider(provider) === true`.
6. **Google provider path** — Google env vars set + a successful provider construction returns a non-Noop provider. Google client construction is mocked; we assert the factory wires through.
7. **Local provider path** — no Google env, `businessHours: { mon: [{ start: "09:00", end: "17:00" }] }` returns a non-Noop provider that can answer `listAvailableSlots` consistent with the configured hours. `isNoopCalendarProvider(provider) === false`.
8. **Missing/empty orgId** — `factory("")` rejects with `ORG_ID_REQUIRED` and does not create a cache entry under the empty key.

---

## Section 3 — `calendar-book` tool changes

### Files

- `packages/core/src/skill-runtime/tools/calendar-book.ts` (modified).
- `packages/core/src/skill-runtime/tools/calendar-book.test.ts` (extended; created if absent — confirm in read-only Task 1).

### Deps shape change

```ts
// Type lives locally in core; structurally identical to the apps/api mirror.
// core cannot import from apps. If drift becomes a problem, hoist into @switchboard/schemas.
export type CalendarProviderFactory = (orgId: string) => Promise<CalendarProvider>;

interface CalendarBookToolDeps {
  calendarProviderFactory: CalendarProviderFactory;
  isCalendarProviderConfigured: (provider: CalendarProvider) => boolean;
  bookingStore: BookingStoreSubset;
  opportunityStore: OpportunityStoreSubset;
  runTransaction: TransactionFn;
  failureHandler: BookingFailureHandler;
}
```

The capability-based `isCalendarProviderConfigured` replaces a Noop-specific check inside core. App/bootstrap implements it as `(provider) => !isNoopCalendarProvider(provider)`. This keeps `calendar-book` ignorant of any specific provider implementation.

### Per-operation flow (both `slots.query` and `booking.create`)

1. Read `orgId` from operation params.
2. **Guard:** if `!orgId || typeof orgId !== "string" || orgId.trim() === ""` → `fail("ORG_ID_REQUIRED", "Calendar booking requires an orgId.")` (using the existing `fail(...)` envelope; do not invent new shape). Factory is **not** called.
3. Resolve provider: `try { provider = await deps.calendarProviderFactory(orgId); } catch { return fail("CALENDAR_PROVIDER_ERROR", "Calendar provider could not be initialized.", { data: { calendarProviderResolved: false } }); }` — `orgId` goes to logs/trace, not the model-facing `data` payload.
4. **Capability check:** if `!deps.isCalendarProviderConfigured(provider)` → `fail("CALENDAR_NOT_CONFIGURED", "Calendar booking is not configured for this organization.", { modelRemediation: "Do not tell the customer there are no available slots. Escalate to the operator because calendar booking is not configured." })`. Identical for both operations. `slots.query` does **not** soft-fall to empty slots.
5. Continue with existing logic, using the resolved `provider` in place of `deps.calendarProvider`.

### `slots.query` schema change

Add `orgId` to the input schema and `required` list:

```ts
inputSchema: {
  type: "object",
  properties: {
    // Temporary: orgId currently comes from model/tool input. Move to trusted
    // SkillRequestContext in the executor-contract follow-up PR.
    orgId: { type: "string" },
    dateFrom: { type: "string" },
    dateTo: { type: "string" },
    durationMinutes: { type: "number" },
    service: { type: "string" },
    timezone: { type: "string" },
  },
  required: ["orgId", "dateFrom", "dateTo", "durationMinutes", "service", "timezone"],
}
```

A second TODO is placed at the resolution block in the operation body, mirroring the schema comment.

### Existing tests update

Existing `booking.create` tests change `calendarProvider: mockProvider` → `calendarProviderFactory: async () => mockProvider, isCalendarProviderConfigured: () => true`. No assertions on success-path return shape change.

### New tests

For both `slots.query` and `booking.create`:

1. **Successful path** — factory returns a real (non-Noop) provider; tool calls factory exactly once with `params.orgId`; downstream provider methods invoked with expected args; existing return-shape assertions preserved.
2. **Missing/empty orgId** — `params.orgId` is `undefined` / `""` / whitespace-only → `fail("ORG_ID_REQUIRED", ...)`. Factory is not called.
3. **Unconfigured provider** — `isCalendarProviderConfigured` returns false → `fail("CALENDAR_NOT_CONFIGURED", ...)` with the locked `modelRemediation` string. For `slots.query`: assert no slots leak into the result data.
4. **Provider construction failure** — factory rejects → `fail("CALENDAR_PROVIDER_ERROR", ...)`. Provider methods are never called.

Total ~8 new test cases (4 × 2 operations).

### File size

`calendar-book.ts` grows by ~40 lines. Currently 273 lines → ~315 lines. Under the 400-line warn threshold.

---

## Section 4 — Read-only Task 1 (BEFORE any code changes)

If any check fails, stop and revise the spec.

1. **Confirm `CalendarProvider` interface shape and where it's exported from `@switchboard/schemas`.** Verify methods (`listAvailableSlots`, `createBooking`, `healthCheck`, etc.) and whether the interface has any existing discriminator field that could obviate a separate `isCalendarProviderConfigured` dep. **Hard stop:** if `CalendarProvider` already carries a status/kind discriminator, prefer that over the dep injection.

2. **Confirm `NoopCalendarProvider`'s module path and current exports.** Spec assumes `apps/api/src/bootstrap/noop-calendar-provider.ts`. Confirm whether `isNoopCalendarProvider` would be a new export or whether an equivalent already exists. If new, add it co-located with the class. **Hard stop:** if the noop provider lives in `packages/core` (cross-layer), revise Section 3's dep-injection rationale.

3. **Confirm `OrganizationConfig.findFirst` query shape used today.** Read `skill-mode.ts:280–287` exactly and reuse the same `where` clause verbatim in `resolveForOrg`. Today's shape is `where: { id: orgId }`; confirm and do not "fix" it in this PR. **Hard stop:** if a different field is in use, mirror that.

4. **Confirm calendar-book's existing test file and its mock pattern.** Locate `packages/core/src/skill-runtime/tools/calendar-book.test.ts` (or equivalent). Verify mock provider construction style. **Hard stop:** if no test file exists today, create one in this PR.

5. **Confirm calendar-book's existing fail/result helper shape.** Verify `fail(code, message, opts)` signature in `tool-result.ts` and what fields `data` / `modelRemediation` / `retryable` populate. New failure paths must use the existing shape, not invent a new envelope.

6. **Confirm logger interface used at the bootstrap call site.** Section 2's logger type must match what `bootstrapSkillMode` actually receives. **Hard stop:** if the project logger uses structured args (e.g., `logger.info({ orgId }, "msg")`), widen the factory's logger type accordingly — do not force a downstream refactor.

7. **Confirm there are no other consumers of `resolveCalendarProvider`.** Grep across `apps/`, `packages/`, excluding `.worktrees/` and `node_modules/`. **Hard stop:** if a second consumer exists, surface it before deletion.

8. **Confirm `createCalendarBookTool`'s existing call sites.** Grep for `createCalendarBookTool(` to find every place that constructs the tool with the old `calendarProvider` dep. Each must be updated. **Hard stop:** if a non-test consumer is found outside `bootstrap/skill-mode.ts`, surface it before changing the tool's deps shape.

9. **Confirm `slots.query` callers are LLM-only.** Grep for direct programmatic use of the `slots.query` operation outside the skill-runtime/Anthropic tool-calling path. Adding `required: ["orgId", ...]` must not break a non-LLM caller. **Hard stop:** if a programmatic caller exists, decide between (a) updating that caller and (b) leaving `orgId` optional in the schema with a runtime `ORG_ID_REQUIRED` failure regardless.

10. **Confirm coverage thresholds and file-size guardrails.** Per-package: `core 65/65/70/65`, global `55/50/52/55`. Confirm `calendar-book.ts` is under 400 lines after additions; confirm `calendar-provider-factory.ts` is under 400 lines.

11. **Confirm current Google Calendar provider configuration is global-env based, not org-config based.** Verify exactly where `GOOGLE_CALENDAR_CREDENTIALS` and `GOOGLE_CALENDAR_ID` are read today. **Hard stop:** if current runtime already supports org-specific Google calendar config, preserve that and revise the factory design to resolve per-org credentials instead of global env.

12. **Confirm `packages/core` has no import path to `apps/api` and must not gain one.** Any app-specific provider detection must be passed into core as a dependency or represented by a `@switchboard/schemas`-level type.

13. **Confirm whether skill tool schemas are snapshotted, generated, or validated elsewhere.** Adding required `orgId` to `slots.query` may require updating snapshots, prompt/tool descriptions, or parameter-builder expectations.

14. **After implementation, run targeted tests and coverage.** Before implementation, only confirm the planned tests are additive and do not remove existing coverage.

### Implementation does not start until checks 1–13 pass.

---

## Section 5 — Acceptance summary

1. `apps/api/src/bootstrap/skill-mode.ts` no longer holds a single bootstrap-resolved `CalendarProvider`. The boot path constructs a `CalendarProviderFactory` instead.
2. The factory resolves a provider per `orgId`, preserving today's runtime precedence: Google env → Local `businessHours` → Noop.
3. The factory memoizes `Map<orgId, Promise<CalendarProvider>>` with rejection cleanup; no eviction in this PR.
4. `createCalendarBookTool` accepts `calendarProviderFactory` and `isCalendarProviderConfigured` instead of a `CalendarProvider` instance. No core/app layering violation.
5. Both `slots.query` and `booking.create`:
   - Fail visibly with `ORG_ID_REQUIRED` when `params.orgId` is missing/empty (factory not called).
   - Fail visibly with `CALENDAR_PROVIDER_ERROR` when factory rejects.
   - Fail visibly with `CALENDAR_NOT_CONFIGURED` when `isCalendarProviderConfigured(provider)` returns false. `slots.query` does **not** soft-fall to empty slots.
   - Use the existing `fail(...)` envelope; no new failure shape.
6. Cross-org isolation is covered at the provider-factory boundary, not the executor boundary, in this PR.
7. Runtime behavior for non-calendar tools is unchanged.
8. Existing `calendar-book` tests pass after deps update.
9. New tests pin: factory same-org/different-org/concurrent/rejection-cleanup/missing-orgId/Noop/Google/Local; tool success/missing-orgId/unconfigured/construction-failure for both operations.
10. Today's global Google env behavior is preserved. This PR does not introduce per-org Google credentials.
11. File-size limits respected: `calendar-provider-factory.ts` and `calendar-book.ts` both stay under the 400-line warn threshold.
12. TODOs are placed at the resolution block and `slots.query` schema marking `params.orgId` as a temporary trust-boundary limitation.
13. **No silent fake-success: an unconfigured calendar must never be represented to the model or user as "no available slots" or a successful booking fallback.**

---

## Out of scope (carry-forward to follow-up PRs)

- **Per-request trust boundary (executor-contract PR).** Move `orgId` out of LLM-controlled tool input into trusted `SkillRequestContext`. Thread request context into `op.execute(...)`. This eventually removes or deprecates the schema-level `orgId` field on `slots.query` / `booking.create` and replaces tool-input `params.orgId` with `ctx.orgId`. The same change should address `escalate`'s `__schema_only__` placeholder wiring.
- **Cache eviction / TTL.** Acceptable for ~10-org beta to run a process-lifetime cache; revisit when calendar credentials/business hours can rotate at runtime, or when org count grows.
- **Per-org Google Calendar configuration.** Today Google credentials and calendar ID are global env vars, so all orgs that fall into the Google branch share the same calendar. Adopting per-org Google config is its own change.
- **End-to-end `SkillMode.execute` cross-org integration test.** Deferred until the executor-contract PR provides a clean test seam.
- **Adopting `describeCalendarReadiness` inside the factory.** Out of scope. This PR preserves existing runtime provider-resolution semantics and keeps readiness visibility unchanged. Any future consolidation must verify runtime/readiness parity before replacing duplicated logic.
- **Tightening `businessHours` validation.** Replace the "non-array object" check with `BusinessHoursConfigSchema.safeParse`. Must update runtime + readiness together.

---

## Process

1. Brainstorm → spec (this doc) → user review.
2. Writing-plans skill produces ordered task list with read-only Task 1 first.
3. Subagent-driven TDD task-by-task. Frequent commits.
4. Code review → squash-merge with auto-merge on green CI.
5. Use a worktree from `origin/main` (post-#281).
