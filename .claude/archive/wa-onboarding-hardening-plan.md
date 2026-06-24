# WhatsApp ESU Onboarding Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (or executing-plans) task-by-task. Steps use checkbox (`- [ ]`) syntax. TDD: watch each test fail before GREEN.

**Goal:** Harden the WhatsApp Embedded Signup onboarding so it succeeds against live Meta for real businesses — primarily by handling the phone `/register` two-step-verification PIN instead of hardcoding `"000000"` and silently swallowing failures.

**Architecture:** Operator supplies an optional existing 2SV PIN through the ESU dashboard flow; the onboard route uses it (`pin || "000000"`, default preserved) and turns a register failure into an actionable, surfaced error (422 + machine code for the PIN case; surfaced detail otherwise) instead of a phantom 200. Producer (server) and consumer (dashboard) ship as an ordered pair. Two adjacent hygiene fixes (assigned_users JSON-array correctness; core notifier Graph version drift) ride as their own focused PRs.

**Tech Stack:** Fastify (apps/api), Next.js 14 (apps/dashboard), Vitest, Meta Graph API v21.0.

**Ground truth (verified at ORIENT vs `origin/main @ 58457c9e1`):**

- Route: `apps/api/src/routes/whatsapp-onboarding.ts` — register at L188-191 (`pin:"000000"`), assigned_users at L171 (`tasks=['MANAGE']`), `OnboardBody` at L11, `graphCall`/`helperFetch` at L56-88.
- Helpers: `apps/api/src/lib/whatsapp-meta.ts` (pattern: typed `{ok}|{ok:false,reason}` helpers via injectable `fetchImpl`).
- Prod `graphApiFetch` (bootstrap/routes.ts:195-198) does NOT check `res.ok`; register result is discarded -> a 2SV failure is swallowed into a phantom 200 (worse than the audit's stated 502).
- Existing tests: `apps/api/src/routes/__tests__/whatsapp-onboarding.test.ts` assert `mockGraphApi` is called exactly 6 times in order (debug_token, assigned_users, phone_numbers, register, subscribed_apps, profile). Any change MUST keep register routed through `graphApiFetch` (call count/order preserved) — the helper-via-helperFetch approach does.
- Dashboard: component `apps/dashboard/src/components/settings/whatsapp-embedded-signup.tsx`; proxy `apps/dashboard/src/app/api/dashboard/connections/whatsapp-embedded/route.ts`; api-client `apps/dashboard/src/lib/api-client/whatsapp.ts` (`onboardWhatsAppEmbedded`).
- PR-4: `packages/core/src/notifications/whatsapp-notifier.ts:17` (`?? "v18.0"` default), `proactive-sender.ts:147` (hardcoded `v18.0`); `__tests__/proactive-sender.test.ts` references v18.0 (check whether it asserts it).

**Seam contract (PR-1 produces, PR-2 consumes) — pin to avoid the prior ESU cross-PR ordering hazard:**

- Request body gains optional `pin?: string` (6 digits). Absent/empty -> route uses `"000000"`.
- Register-failed-PIN response: HTTP **422** `{ error, code: "whatsapp_registration_pin_required", detail }`.
- Register-failed-other response: HTTP **502** `{ error, detail }` (surfaced, not phantom 200).
- Order: PR-1 (server) merges before PR-2 (dashboard). Route change is additive/backward-compatible.

---

## PR-1 (server, PRIMARY): onboard route accepts an operator PIN and surfaces register failures

**Branch:** `launch/wa-onboard-register-pin` off fresh `origin/main`.
**Merge-stop:** credential/onboarding path -> SURFACE-before-merge.
**Files:**

- Modify: `apps/api/src/lib/whatsapp-meta.ts` (add `registerPhoneNumber` + `isPinError` + types)
- Test: `apps/api/src/lib/__tests__/whatsapp-meta.test.ts` (create if absent; else append) — helper unit tests
- Modify: `apps/api/src/routes/whatsapp-onboarding.ts` (`OnboardBody.pin`, use helper, branch on result)
- Test: `apps/api/src/routes/__tests__/whatsapp-onboarding.test.ts` (append a new describe block; do NOT edit existing assertions)

- [ ] **Step 1: RED — helper unit tests for `registerPhoneNumber`.** Create/append `whatsapp-meta.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { registerPhoneNumber } from "../whatsapp-meta.js";

// helperFetch (the route's seam) forces ok:true/status:200, so Graph errors
// arrive as a JSON body { error: {...} }. These tests drive that seam shape:
// fetchImpl returns a Response whose json() yields the given body.
function fetchReturning(body: unknown, ok = true, status = 200): typeof fetch {
  return (async () =>
    ({ ok, status, json: async () => body }) as unknown as Response) as typeof fetch;
}

describe("registerPhoneNumber", () => {
  it("returns ok for a success body", async () => {
    const r = await registerPhoneNumber({
      apiVersion: "v21.0",
      userToken: "T",
      phoneNumberId: "P",
      pin: "000000",
      fetchImpl: fetchReturning({ success: true }),
    });
    expect(r.ok).toBe(true);
  });

  it("flags a two-step-verification PIN error as pinRequired (by code)", async () => {
    const r = await registerPhoneNumber({
      apiVersion: "v21.0",
      userToken: "T",
      phoneNumberId: "P",
      pin: "000000",
      fetchImpl: fetchReturning({ error: { message: "Account locked", code: 133005 } }),
    });
    expect(r).toMatchObject({ ok: false, pinRequired: true });
  });

  it("flags a PIN error by message heuristic when the code is unknown", async () => {
    const r = await registerPhoneNumber({
      apiVersion: "v21.0",
      userToken: "T",
      phoneNumberId: "P",
      pin: "000000",
      fetchImpl: fetchReturning({
        error: { message: "Two-step verification PIN is incorrect", code: 999 },
      }),
    });
    expect(r).toMatchObject({ ok: false, pinRequired: true });
  });

  it("does NOT flag an unrelated register error as pinRequired", async () => {
    const r = await registerPhoneNumber({
      apiVersion: "v21.0",
      userToken: "T",
      phoneNumberId: "P",
      pin: "000000",
      fetchImpl: fetchReturning({ error: { message: "Some other failure", code: 100 } }),
    });
    expect(r).toMatchObject({ ok: false, pinRequired: false });
  });

  it("sends the pin and messaging_product in the POST body", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      } as unknown as Response;
    }) as unknown as typeof fetch;
    await registerPhoneNumber({
      apiVersion: "v21.0",
      userToken: "T",
      phoneNumberId: "PH",
      pin: "246810",
      fetchImpl,
    });
    expect(calls[0]!.url).toContain("/v21.0/PH/register");
    const body = JSON.parse(calls[0]!.init!.body as string);
    expect(body).toEqual({ messaging_product: "whatsapp", pin: "246810" });
  });
});
```

- [ ] **Step 2: Run to verify RED.** `pnpm --filter @switchboard/api test -- whatsapp-meta` -> FAIL (`registerPhoneNumber` not exported).

- [ ] **Step 3: GREEN — implement `registerPhoneNumber` in `whatsapp-meta.ts`.** Append:

```ts
export type RegisterPhoneResult =
  | { ok: true }
  | { ok: false; reason: string; pinRequired: boolean };

interface MetaRegisterErrorBody {
  error?: {
    message?: string;
    code?: number;
    error_subcode?: number;
    error_user_title?: string;
    error_user_msg?: string;
  };
}

// WhatsApp Cloud API two-step-verification error codes (133xxx family). Meta's
// reference is JS-rendered and unverifiable from this environment, so this set is
// best-effort; the message heuristic below is the backstop and the route ALWAYS
// surfaces a register failure regardless of classification. Either signal flags a
// PIN-actionable error.
const TWO_STEP_PIN_ERROR_CODES = new Set([133005, 133006, 133008, 133009, 133010]);

function isPinError(err: NonNullable<MetaRegisterErrorBody["error"]>): boolean {
  if (typeof err.code === "number" && TWO_STEP_PIN_ERROR_CODES.has(err.code)) return true;
  const text =
    `${err.message ?? ""} ${err.error_user_title ?? ""} ${err.error_user_msg ?? ""}`.toLowerCase();
  return text.includes("pin") || text.includes("two-step") || text.includes("two step");
}

/**
 * Register a customer phone number for Cloud API.
 *
 * POST /<apiVersion>/<phoneNumberId>/register with { messaging_product, pin }.
 * Meta semantics: with no two-step verification (2SV) the supplied `pin` BECOMES
 * the 2SV PIN; with 2SV already set, `pin` must MATCH the existing PIN. A
 * wrong/missing PIN -> a 2SV error. The route's helperFetch seam forces
 * ok:true/status:200, so Graph errors arrive as a JSON body { error: {...} } —
 * classify on the body, with an HTTP-status fallback for direct fetch callers.
 * `pinRequired` lets the route surface an actionable "enter your existing PIN"
 * message (422) distinct from other registration failures.
 */
export async function registerPhoneNumber(args: {
  apiVersion: string;
  userToken: string;
  phoneNumberId: string;
  pin: string;
  fetchImpl?: typeof fetch;
}): Promise<RegisterPhoneResult> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const url = `https://graph.facebook.com/${args.apiVersion}/${args.phoneNumberId}/register`;
  let res: Awaited<ReturnType<typeof fetch>>;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${args.userToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", pin: args.pin }),
    });
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "fetch error",
      pinRequired: false,
    };
  }
  let body: MetaRegisterErrorBody;
  try {
    body = (await res.json()) as MetaRegisterErrorBody;
  } catch {
    return res.ok ? { ok: true } : { ok: false, reason: `graph ${res.status}`, pinRequired: false };
  }
  if (body?.error) {
    const e = body.error;
    const reason = e.error_user_msg || e.message || `graph ${e.code ?? "error"}`;
    return { ok: false, reason, pinRequired: isPinError(e) };
  }
  if (!res.ok) return { ok: false, reason: `graph ${res.status}`, pinRequired: false };
  return { ok: true };
}
```

- [ ] **Step 4: Run to verify GREEN.** `pnpm --filter @switchboard/api test -- whatsapp-meta` -> PASS.

- [ ] **Step 5: RED — route tests (append a NEW describe block to `whatsapp-onboarding.test.ts`; do not touch existing ones).**

```ts
describe("WhatsApp onboarding phone registration (2-step PIN)", () => {
  function makeApp(graphApiFetch: ReturnType<typeof vi.fn>) {
    const app = Fastify({ logger: false });
    app.decorate("authDisabled", true);
    return app
      .register(whatsappOnboardingRoutes, {
        metaSystemUserToken: "SUAT",
        metaSystemUserId: "SYS",
        appSecret: "SEC",
        apiVersion: "v21.0",
        webhookBaseUrl: "https://chat.example.com",
        graphApiFetch,
        createConnection: vi.fn(async () => ({
          id: "conn_pin",
          webhookPath: "/webhook/managed/conn_pin",
        })),
      })
      .then(() => app);
  }
  // shared graph mock: ok through phone_numbers, register behavior is per-test
  function baseGraph(registerResponse: unknown) {
    return vi.fn(async (url: string) => {
      if (url.includes("/debug_token")) {
        return {
          data: {
            granular_scopes: [{ scope: "whatsapp_business_management", target_ids: ["WABA"] }],
          },
        };
      }
      if (url.includes("/phone_numbers")) {
        return { data: [{ id: "PH", verified_name: "Biz", display_phone_number: "+1555" }] };
      }
      if (url.includes("/register")) return registerResponse;
      return { success: true };
    });
  }

  it("returns 422 + whatsapp_registration_pin_required when register hits a 2SV PIN error (no phantom success)", async () => {
    const graph = baseGraph({
      error: { message: "Two-step verification PIN mismatch", code: 133005 },
    });
    const app = await makeApp(graph);
    const res = await app.inject({
      method: "POST",
      url: "/whatsapp/onboard",
      payload: { esToken: "T", organizationId: "org_test" },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("whatsapp_registration_pin_required");
    await app.close();
  });

  it("forwards an operator-provided pin to /register", async () => {
    const calls: string[] = [];
    const graph = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/register")) calls.push(init?.body as string);
      if (url.includes("/debug_token"))
        return {
          data: {
            granular_scopes: [{ scope: "whatsapp_business_management", target_ids: ["WABA"] }],
          },
        };
      if (url.includes("/phone_numbers")) return { data: [{ id: "PH" }] };
      return { success: true };
    });
    const app = await makeApp(graph);
    const res = await app.inject({
      method: "POST",
      url: "/whatsapp/onboard",
      payload: { esToken: "T", organizationId: "org_test", pin: "246810" },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(calls[0]!)).toMatchObject({ pin: "246810" });
    await app.close();
  });

  it("defaults the register pin to 000000 when none provided (regression guard)", async () => {
    const calls: string[] = [];
    const graph = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/register")) calls.push(init?.body as string);
      if (url.includes("/debug_token"))
        return {
          data: {
            granular_scopes: [{ scope: "whatsapp_business_management", target_ids: ["WABA"] }],
          },
        };
      if (url.includes("/phone_numbers")) return { data: [{ id: "PH" }] };
      return { success: true };
    });
    const app = await makeApp(graph);
    await app.inject({
      method: "POST",
      url: "/whatsapp/onboard",
      payload: { esToken: "T", organizationId: "org_test" },
    });
    expect(JSON.parse(calls[0]!)).toMatchObject({ pin: "000000" });
    await app.close();
  });
});
```

- [ ] **Step 6: Run to verify RED.** `pnpm --filter @switchboard/api test -- whatsapp-onboarding` -> the 422 test FAILs (current code swallows the error, returns 200) and the pin-forwarding test FAILs (hardcoded 000000). The default-pin test may already pass (it's a guard).

- [ ] **Step 7: GREEN — wire the helper into the route.** In `whatsapp-onboarding.ts`:
  1. Add to imports from `../lib/whatsapp-meta.js`: `registerPhoneNumber`.
  2. `type OnboardBody = { esToken?: string; code?: string; organizationId?: string; pin?: string };`
  3. `const { esToken, code, pin } = request.body ?? {};`
  4. Replace L187-191 register block with:

```ts
// 4. Register phone for Cloud API. Meta semantics: with no two-step
// verification (2SV) the supplied pin BECOMES the 2SV pin; with 2SV
// already set it must MATCH. Operators with an existing 2SV PIN pass it via
// the ESU flow; absent -> "000000" (unchanged for fresh numbers). A failure
// used to be swallowed (graphApiFetch ignores HTTP status, the result was
// discarded) -> phantom 200. Surface it instead, before persisting anything.
const registerResult = await registerPhoneNumber({
  apiVersion,
  userToken: metaSystemUserToken,
  phoneNumberId: phone.id,
  pin: pin || "000000",
  fetchImpl: helperFetch,
});
if (!registerResult.ok) {
  if (registerResult.pinRequired) {
    return reply.code(422).send({
      error:
        "This WhatsApp number has two-step verification enabled. Enter its existing 6-digit PIN and try again. If you don't know it, reset it in WhatsApp Manager.",
      code: "whatsapp_registration_pin_required",
      detail: registerResult.reason,
    });
  }
  return reply.code(502).send({
    error: "Phone registration failed — could not register the number with WhatsApp.",
    detail: registerResult.reason,
  });
}
```

- [ ] **Step 8: Run to verify GREEN + no regressions.** `pnpm --filter @switchboard/api test -- whatsapp-onboarding whatsapp-meta` -> PASS (incl. the existing 6-call-order tests).

- [ ] **Step 9: Commit.** `git add -A && git commit` subject: `fix(api): handle whatsapp /register two-step-verification pin (no phantom onboarding success)`

- [ ] **Step 10: Gate-run (delegated) + independent fresh-context review + SURFACE.** See "Per-PR gates" below.

---

## PR-2 (dashboard, CONSUMER): ESU component collects an optional PIN and surfaces the actionable error

**Branch:** `launch/wa-esu-pin-field` off fresh `origin/main` (open AFTER PR-1; route is backward-compatible so this is safe but only meaningful once PR-1 lands — note the dependency in the PR body).
**Merge-stop:** credential/onboarding path -> SURFACE-before-merge.
**Files:**

- Modify: `apps/dashboard/src/components/settings/whatsapp-embedded-signup.tsx`
- Test: `apps/dashboard/src/components/settings/__tests__/whatsapp-embedded-signup.test.tsx`
- Modify: `apps/dashboard/src/app/api/dashboard/connections/whatsapp-embedded/route.ts` (widen body type with `pin?: string`)
- Modify: `apps/dashboard/src/lib/api-client/whatsapp.ts` (`onboardWhatsAppEmbedded` body type gains `pin?: string`)
- Test: `apps/dashboard/src/app/api/dashboard/connections/whatsapp-embedded/__tests__/route.test.ts` (assert `pin` forwarded)

- [ ] **Step 1: RED — component test:** the component renders an optional PIN input; the POSTed body includes `pin`; a 422 `{ code: "whatsapp_registration_pin_required", error }` response sets the actionable error text and surfaces the PIN field. (Mock `window.FB.login` to invoke its callback with `authResponse.code`, mock `fetch`.) Watch fail.
- [ ] **Step 2: RED — proxy route test:** posting `{ code, pin }` forwards `pin` to `client.onboardWhatsAppEmbedded`. Watch fail.
- [ ] **Step 3: GREEN — component:** add `pin` state + a labelled optional `<input inputMode="numeric" maxLength={6}>` ("Two-step verification PIN — only if your number already has one"); include `pin` in the POST body; on 422 with the code, render the actionable message and keep/scroll-to the PIN field.
- [ ] **Step 4: GREEN — proxy + api-client:** add `pin?: string` to both body types; proxy already spreads `body`.
- [ ] **Step 5: Run component + route tests** -> PASS.
- [ ] **Step 6: Contract test (seam pin):** assert the request body the component sends matches the PR-1 contract field name (`pin`) and that a 422+code path renders the actionable copy. Keep this test alongside the component test.
- [ ] **Step 7: Commit** `feat(dashboard): collect an optional two-step-verification pin in whatsapp embedded signup`.
- [ ] **Step 8: Gate-run (delegated, incl. dashboard build + .tsx prettier) + independent review + SURFACE.**

---

## PR-3 (correctness): assigned_users tasks must be a JSON array, not a single-quote literal

**Branch:** `launch/wa-onboard-assigned-users-json` off fresh `origin/main` (same file as PR-1; sequence after PR-1, expect a trivial rebase).
**Merge-stop:** onboarding path -> SURFACE-before-merge.
**Files:** Modify `apps/api/src/routes/whatsapp-onboarding.ts` (L171); append a test to `whatsapp-onboarding.test.ts`.

- [ ] **Step 1: Verify the expectation** (quick Meta-docs/web confirm at execution): Graph `assigned_users` wants `tasks=["MANAGE"]` (JSON array, double quotes), URL-encoded. The current `tasks=['MANAGE']` (single-quote literal, unencoded) is invalid JSON and is rejected/misparsed by Graph.
- [ ] **Step 2: RED — test:** capture the assigned_users call URL; assert it contains the URL-encoded JSON array (`%5B%22MANAGE%22%5D`) and does NOT contain `['MANAGE']`. Watch fail.
- [ ] **Step 3: GREEN:** replace L170-173 with:

```ts
// 2. Add system user to WABA. tasks MUST be a URL-encoded JSON array
// (["MANAGE"]); a single-quote literal ['MANAGE'] is invalid JSON and Graph
// rejects/misparses it.
const assignedTasks = encodeURIComponent(JSON.stringify(["MANAGE"]));
await graphCall(
  `/${wabaId}/assigned_users?user=${metaSystemUserId}&tasks=${assignedTasks}`,
  "POST",
);
```

- [ ] **Step 4: Run** `pnpm --filter @switchboard/api test -- whatsapp-onboarding` -> PASS (existing `.toContain("assigned_users")` still holds).
- [ ] **Step 5: Commit** `fix(api): send whatsapp assigned_users tasks as a json array`.
- [ ] **Step 6: Gate-run + independent review + SURFACE.**

---

## PR-4 (hygiene): bump core notifier Graph API version v18.0 -> v21.0

**Branch:** `launch/wa-notifier-graph-v21` off fresh `origin/main` (independent package; no overlap with PR-1/2/3).
**Merge-stop:** external WhatsApp send path -> SURFACE-before-merge.
**Files:** Modify `packages/core/src/notifications/whatsapp-notifier.ts` (L17), `packages/core/src/notifications/proactive-sender.ts` (L147); update `packages/core/src/notifications/__tests__/proactive-sender.test.ts` if it asserts v18.0.

- [ ] **Step 1: Confirm scope** — `grep -rn "v18.0" packages/ apps/ --include=*.ts` (exclude dist). Confirm only these two source sites + any test assertion. Confirm no caller passes `apiVersion:"v18.0"` deliberately.
- [ ] **Step 2: RED — update/extend the test** to expect `v21.0` in the proactive-sender Graph URL (and notifier default). Run -> FAIL against current `v18.0` code.
- [ ] **Step 3: GREEN:** `whatsapp-notifier.ts:17` `?? "v18.0"` -> `?? "v21.0"`; `proactive-sender.ts:147` URL `v18.0` -> `v21.0`.
- [ ] **Step 4: Run** `pnpm --filter @switchboard/core test -- proactive-sender whatsapp-notifier` -> PASS.
- [ ] **Step 5: Commit** `chore(core): bump whatsapp notifier graph api version to v21.0`.
- [ ] **Step 6: Gate-run (incl. core build) + independent review + SURFACE.**

---

## Per-PR gates (delegated; the verifier returns per-gate booleans + only the failing excerpt)

`pnpm typecheck`; `pnpm test` AND `pnpm --filter <touched pkg/app> test`; `pnpm lint`; `pnpm format:check`; `pnpm arch:check`; `CI=1 npx tsx scripts/local-verify-fast.ts`; `pnpm build` if app/pkg code changed; for PR-2 add `--filter dashboard build` + a `.tsx` prettier pass; `pnpm audit --audit-level=high` (security). No new env var or mutating route is introduced (no allowlist edits expected) — verify-fast confirms. Independent fresh-context review per PR (diff + acceptance criteria + relevant `feedback_*` lessons only); any finding >= warn bars the merge -> SURFACE, never self-dismiss.

## Out of scope (surfaced follow-ups, NOT built here)

- Full number MIGRATION (`request_code`/`verify_code`) — only needed to PORT a number from another BSP/account; not needed for the 2SV-PIN case. Surface if a real porting need appears.
- Credit-line sharing (money path); whatsappFlows registration; D-a/D-c/D-d; per-tenant CAPI.

## Self-review (plan vs brainstorm)

- Coverage: PIN design (brainstorm Option A) -> PR-1 (server) + PR-2 (dashboard); finding #7 -> PR-3; notifier drift -> PR-4. All four bounded-universe items covered.
- No placeholders: every code step shows the code; every test step shows assertions.
- Type consistency: `RegisterPhoneResult`/`registerPhoneNumber`/`pinRequired`/`whatsapp_registration_pin_required`/`pin` used identically across helper, route, tests, dashboard, and the seam contract.
- Scope: four focused PRs, each independently testable; ordered pair pinned by the seam contract.
