# WhatsApp ESU onboarding hardening — self-directed brainstorm

Date: 2026-06-15. Workstream: launch. Mode: SELF-DIRECTED (user pre-approved; approval gate is at MERGE).
Scratch only (not a committed spec). Rationale is carried durably in each PR body.

Grounded in:

- `docs/audits/2026-06-15-meta-tech-provider/B-whatsapp-business-platform.md` (section 2 step 4; section 10 blocker 4; finding #7).
- memory `project_whatsapp_tech_provider_roadmap.md` (D-b resolved = central `META_SYSTEM_USER_TOKEN` is the runtime credential; ESU end-to-end on main; backlog = phone `/register` 2-step PIN + credit-line sharing).
- Ground truth read at ORIENT against `origin/main @ 58457c9e1` (line numbers verified, audit is dated).

## 1. Problem (ground truth, refined from the audit)

`POST /api/whatsapp/whatsapp/onboard` registers the customer's phone for Cloud API at
`whatsapp-onboarding.ts:188-191`:

```ts
await graphCall(`/${phone.id}/register`, "POST", {
  messaging_product: "whatsapp",
  pin: "000000", // hardcoded
});
```

Two defects:

1. **Hardcoded PIN.** Meta's `/register` semantics: if the number has NO two-step
   verification (2SV), the supplied `pin` BECOMES the 2SV PIN and registration
   succeeds. If the number ALREADY has 2SV set (true for most established business
   numbers), you must supply the **matching** existing PIN. `"000000"` will mismatch,
   and Meta locks the number after repeated wrong attempts. So onboarding cannot
   succeed for any established 2SV number, and blindly retrying risks a lockout.

2. **The register result is swallowed.** The audit says a 2SV failure 502s. That is
   STALE. On `origin/main` the production `graphApiFetch` (bootstrap/routes.ts:195-198)
   is `const res = await fetch(url, init); return (await res.json())` with **no
   `res.ok` check**, and the route **discards the register return value** (line 188 is
   `await graphCall(...)` with no inspection). `fetch` resolves on HTTP 4xx (only
   network errors reject), so a register error returns `{ error: {...} }` and is
   silently ignored. The route proceeds to persist a Connection, subscribe the webhook,
   set the profile, and returns **200 `success: true`** — a phantom success where the
   phone was never registered. Inbound/outbound then silently fail later. This is worse
   than a 502; the fix surfaces it.

(The typed helpers in `lib/whatsapp-meta.ts` go through `helperFetch`, which hardcodes
`ok: true, status: 200`, so they also can't see HTTP status — they inspect the JSON
body. A register helper must do the same: classify on the `{ error: {...} }` body, not
on HTTP status.)

## 2. Design question

Where does the operator's existing 2SV PIN come from, and how does the flow react when
`/register` fails because 2SV is already on (or the supplied PIN is wrong)?

## 3. Options considered

**Option A — ESU component collects an optional PIN; route accepts optional `pin`; default preserved. (CHOSEN)**

- Component adds an optional, clearly-labelled "two-step verification PIN" field
  ("only if your number already has one"). Posts `pin` alongside `code`/`wabaId`/`phoneNumberId`.
- Route accepts optional `pin`, uses `pin ?? "000000"` (current behavior preserved for
  new numbers), and INSPECTS the register response: on a PIN/2SV error returns an
  actionable 422 with a machine-readable `code`; on any other register error returns a
  surfaced (non-generic) error instead of a phantom success.
- Pros: smallest doctrine-consistent change; one round-trip; backward-compatible (route
  change is additive, default unchanged); lets the operator supply the right PIN UP
  FRONT, avoiding a wrong attempt and lockout risk; the producer/consumer seam is a
  single optional field + a documented error shape.
- Cons: every operator sees a PIN field most new numbers don't need (mitigated by clear
  "only if..." labelling and optionality).

**Option B — reactive prompt: try `"000000"`, and only ask for a PIN if it fails.**

- Pros: cleaner default UX (no PIN field unless needed).
- Cons: REJECTED. Trying `"000000"` against a 2SV number burns a wrong-PIN attempt and
  risks Meta's lockout — actively harmful. Also needs a structured "pin_required"
  signal + a two-state component retry flow + a re-entrant route. More surface, worse
  safety, for marginal UX gain.

**Option C — server reads a configured PIN from env.**

- REJECTED. 2SV PINs are per-number operator secrets, not a server-wide config value.
  A single env PIN cannot serve multiple tenants and would be a credential smell.

**Option D — full number migration (`request_code` / `verify_code`).**

- REJECTED here (explicitly out of scope; surface as follow-up). Migration is for
  PORTING a number from another BSP/on-prem into this Cloud API account — a different,
  bigger flow. It is NOT needed for the 2SV-PIN case: an operator who already controls
  the number just supplies its existing PIN to `/register`. Recorded as a follow-up only.

## 4. Decision

**Option A.** Operator-provided optional PIN through the ESU flow; route uses it
(`pin ?? "000000"`), and turns a register failure into an actionable, surfaced error.
Number migration stays a surfaced follow-up, not built.

## 5. Producer/consumer seam (pinned — avoids the prior ESU cross-PR ordering hazard)

The route (producer) and the dashboard (consumer) ship as an **ordered pair**: server
PR first, dashboard PR second (mirrors the prior loop honoring "#1095 before #1096").

Seam contract (server PR defines; dashboard PR asserts against it with a contract test):

- **Request:** onboard body gains optional `pin?: string` (6 digits). Absent/empty ->
  route uses `"000000"` (unchanged behavior). Forwarded verbatim by the dashboard proxy
  and the api-client `onboardWhatsAppEmbedded` body type.
- **Error response (register failed, operator action needed):** HTTP **422** with
  `{ error: <human message>, code: "whatsapp_registration_pin_required" }`. Covers both
  "2SV on, no PIN supplied" and "supplied PIN wrong". The human message instructs the
  operator to enter the number's existing 6-digit PIN (and that it can be reset in
  WhatsApp Manager if unknown).
- **Error response (register failed, other):** non-2xx with the surfaced Meta error
  detail (prefer Meta's `error_user_msg`/`error_user_title` when present), NOT a phantom 200. (Likely 502 to match the existing outer-catch convention for upstream failures.)

The route change is additive and backward-compatible, so even if the dashboard PR lags,
nothing regresses; the dashboard PR is only MEANINGFUL once the server PR is merged.

## 6. PR decomposition (the bounded universe; one focused PR each; all SURFACE-before-merge)

1. **PR-1 (server, primary):** onboard route accepts optional `pin`, uses `pin ?? "000000"`,
   detects + surfaces register failure (422 + `whatsapp_registration_pin_required` for the
   PIN case; surfaced detail otherwise). Killing the phantom success is the core win.
   Touches `apps/api/.../whatsapp-onboarding.ts` (+ a `registerPhoneNumber` helper in
   `lib/whatsapp-meta.ts` for testability/consistency). api tests. Independently shippable.
2. **PR-2 (dashboard, consumer):** ESU component optional PIN field + actionable-error
   surfacing; proxy route + api-client body type forward `pin`. Contract test pins the seam.
   Ordered AFTER PR-1.
3. **PR-3 (assigned_users correctness):** `tasks=['MANAGE']` (single-quote literal, line 171)
   -> a properly URL-encoded JSON array `tasks=["MANAGE"]`. Audit finding #7; verify against
   Meta docs. Same file as PR-1 -> sequence after PR-1 (trivial rebase) or fold in; default
   own PR for a clean single-purpose review.
4. **PR-4 (notifier Graph version drift):** core `whatsapp-notifier.ts:17` + `proactive-sender.ts`
   `v18.0` -> `v21.0`. Confirm nothing depends on v18.0. Lower priority, tangential hygiene.
   Trips the external-send merge-stop glob -> SURFACE-before-merge.

Merge-stop: PR-1/2/3 are the credential/onboarding path; PR-4 is an external-send path.
ALL surface for the user's merge call; none auto-merge. Any independent-review finding

> = warn bars a merge -> surface (never self-dismiss to merge to main).

## 7. Self-review (placeholder / consistency / scope / ambiguity)

- No placeholders/TBD. Each PR has a concrete file set + done-condition.
- Consistent: the seam contract in §5 is exactly what PR-1 produces and PR-2 consumes.
- Scope: four focused PRs; the design proper (Option A) spans PR-1+PR-2; PR-3/PR-4 are
  mechanical (skip full brainstorming per the loop).
- Ambiguity resolved: error status = 422 for PIN-required, 502 for other register failures;
  default PIN preserved; migration explicitly NOT built.
