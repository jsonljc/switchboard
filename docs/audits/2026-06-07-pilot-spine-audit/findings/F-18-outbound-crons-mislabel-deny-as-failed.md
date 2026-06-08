# F-18: Outbound crons record a governance DENY (and a park) as `no_terminal_outcome` "failed" — S-14/S-16 confirmed by code trace, refined

- **Severity:** embarrasses-pilot (a fresh pilot org's reminder/follow-up rows get marked `failed` with reason `no_terminal_outcome` on every tick under the F-16 default-deny floor; `onFailure` is `alert:true`, so every blocked org produces operator failure alerts on a high-risk function. Not a crash, not a customer-visible send — but a misleading failure signal and a wasted retry budget. The follow-up cron additionally burns its 3-attempt budget retrying a deny that will never succeed.)
- **Journey/step:** J7-S2 (seams S-14, S-16)
- **Verdict:** CONFIRMED by definitive code trace (the live SEND leg was not triggered — no local Inngest dev server; see verdict map J7-S3). The seam-list hypothesis ("`approvalRequired` → no `result` → throws") is **refuted in its mechanism** (the `approvalRequired` response DOES carry a `result`, so no throw) but **confirmed in its consequence** (`result.outputs={}` → `no_terminal_outcome`), and the analysis is **extended** to the DENY response, which is the path actually reachable today.
- **Location (verified against `main`, worktree `audit/pilot-spine`, 2026-06-08):**
  - **Response shapes** — `packages/core/src/platform/platform-ingress.ts:87-97`: `SubmitWorkResponse` has THREE variants. Deny (`:282-286`) returns `{ ok: true, result: buildFailedResult(...), workUnit }`. require_approval (`:289-374`) returns `{ ok: true, result, workUnit, approvalRequired: true }` where `result.outputs = {}` (`:294`). `buildFailedResult` (`:483-494`) sets `outputs: {}`. So in BOTH the deny and the park cases: `response.ok === true` and `response.result.outputs.sent` is `undefined`.
  - **Reminder cron** — `apps/api/src/services/cron/appointment-reminder-dispatch.ts:96-114`: `if (!response.ok)` is FALSE for a deny/park (so the `markFailed(reminderId, response.error.type)` branch is NOT taken — there is no `response.error`); `outputs.sent === true` and `=== false` both FALSE (it is `undefined`); falls through to `:112` `markFailed(reminderId, "no_terminal_outcome")`, `failed++`. `"failed"` is in `TERMINAL` (`:42`), so the row is terminal — no retry.
  - **Follow-up cron** — `apps/api/src/services/cron/scheduled-follow-up-dispatch.ts:75-121`: identical fall-through to `:117-119` `markFailed(followUp.id, "no_terminal_outcome", computeNextRetry(...))`. Because `markFailed` gets a non-null `nextRetryAt` until `attempts+1 >= MAX_SEND_ATTEMPTS` (`:127-131`), a denied follow-up is **retried up to 3 times** before going terminal — re-submitting an action the gate will deny every time.
  - **No throw on park** — the `result` field is present on the `approvalRequired` variant (`:90-97`), so `response.result.outputs` does not throw. The seam-list S-14/S-16 "throws / crash" mechanism is wrong; the silent `no_terminal_outcome` mislabel is the real defect.
- **Evidence:** `evidence/j7-cron-outcome-handling.txt` (the three response shapes quoted from `platform-ingress.ts`, the two consumer fall-throughs, and the deny-vs-park reachability analysis).

## What was exercised

- Full code trace of the response contract from `platform-ingress.ts` through both dispatchers. The live exercise (trigger the Inngest function, seed a confirmed booking, observe the gate deny + `markFailed`) was NOT run because no Inngest dev server is running locally and the API's `/api/inngest` is the serve handler, not an invoke endpoint (documented in D-05 and verdict map J7-S3). The code trace is definitive: there is exactly one fall-through for an `outputs.sent === undefined` response, and both deny and park produce that.

## What happened vs expected

- **Expected:** a governance DENY should be recorded as a denial/skip (a distinct, non-alerting outcome), and a require_approval park should be recognized (and ideally deferred/parked), not logged as a generic failure.
- **Observed:** both collapse to `no_terminal_outcome` → `markFailed`. Under the F-16 default-deny floor every reminder/follow-up for a fresh pilot org becomes a `failed` row, and (follow-up) burns the retry budget. The `onFailure` handler is `alert:true` on a `riskCategory:"high"` function, so this also produces operator failure alerts for an org that is simply not yet policy-provisioned.
- **Relationship to F-16:** F-16 (default-deny) is the producer that makes the deny path live today. F-18 is how the crons MIS-CLASSIFY that deny. Both want fixing together: provisioning allow policies (F-16) removes the deny, but the crons should still classify a deny/park correctly for the cases where governance legitimately denies or parks a specific send.

## FOLLOWUP_ALLOW_MARKETING_TEMPLATE empty default (J7-S2 sub-check, cross-ref F-07)

- Confirmed: `contained-workflows.ts:299` `allowMarketingTemplate: process.env["FOLLOWUP_ALLOW_MARKETING_TEMPLATE"] === "true"` → empty default `false`. The reminder workflow hardcodes `false` (`:316`).
- Behavior at empty default, **only if the gate ALLOWS the submit** (i.e. NOT under F-16 default-deny): a marketing-category template selection returns `{eligible:false, reason:"marketing_blocked"}` (`proactive-eligibility.ts:83-84`); the follow-up workflow returns `{outcome:"completed", outputs:{sent:false, skipReason:"marketing_blocked"}}` (`conversation-followup-send-workflow.ts:71-76`); the cron calls `classifyCadenceSkip("marketing_blocked")` → `"durable"` (not in `ACTIVATION_SKIP_REASONS`, `scheduled-follow-up.ts:74-83`) → `markSkipped(id, "marketing_blocked")` (terminal, no retry). Utility-category templates pass and still send. No throw. This matches F-07 (DORMANT/decay) — recorded there; no new finding.

## classifyCadenceSkip skipReason coverage (J7-S2 sub-check)

- Verified no mismatch. The skipReasons the follow-up workflow can emit are: `unsupported_channel` (`conversation-followup-send-workflow.ts:47,93`), and the eligibility reasons `consent_revoked`/`consent_pending`/`no_optin`/`no_template`/`template_not_approved`/`marketing_blocked` (`proactive-eligibility.ts:56,65,70,78,81,84`). `classifyCadenceSkip` (`scheduled-follow-up.ts:74,81-83`) treats ONLY `template_not_approved` and `no_template` as `"activation"` (re-evaluable); EVERYTHING ELSE — including an unrecognized/`"unknown"` reason — falls to `"durable"` → `markSkipped` (terminal). This is fail-closed by design: an unrecognized reason terminates the cadence rather than looping. No crash, no silent infinite retry. The seam-list S-16 concern is REFUTED on this axis.

## Suggested fix scope

- In both dispatchers, branch on the response before the `outputs.sent` check: add `if ("approvalRequired" in response && response.approvalRequired)` → mark deferred/parked (not failed); and detect a governance deny (e.g. `response.result.outcome === "failed" && response.result.error?.code` present, or thread a denial signal) → `markSkipped(id, "governance_denied")` with NO alert and NO retry-budget burn. Reserve `no_terminal_outcome` "failed" for a genuinely malformed execution result.

## Validation / test

- Add a dispatcher test feeding a deny-shaped `{ok:true, result:{outcome:"failed", outputs:{}, error:{code}}}` and asserting `markSkipped("governance_denied")`, not `markFailed("no_terminal_outcome")`, and (follow-up) `nextRetryAt` not set.
- Add a test feeding the `approvalRequired:true` variant and asserting a deferred/parked outcome, not `markFailed`.
