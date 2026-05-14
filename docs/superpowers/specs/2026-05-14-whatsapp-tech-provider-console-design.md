# WhatsApp Tech Provider Console — Design Spec

**Date:** 2026-05-14
**Status:** Approved — ready for implementation plan
**Owner:** Jason
**Branch hint:** sliced into 5 PRs (see Sequencing)

## Goal

Unblock Meta WhatsApp Tech Provider App Review for the `whatsapp_business_messaging` and `whatsapp_business_management` permissions, and turn `/settings/channels/whatsapp` into a surface that makes Alex demonstrably safer and more trustworthy to the operator.

This spec is the umbrella; each slice gets its own implementation plan.

## What Meta actually requires

Confirmed against [Meta's Tech Provider docs](https://developers.facebook.com/docs/whatsapp/solution-providers/get-started-for-tech-providers) and the [App Review sample submission](https://developers.facebook.com/docs/whatsapp/solution-providers/app-review/sample-submission):

**Hard gates:**

1. Business Verification on Meta Business Manager (2–5 business days).
2. 2FA enabled on Business Manager.
3. Meta App created with WhatsApp product, plus App Icon, Privacy Policy URL, Terms of Service URL, App Domain, Data Deletion URL/Instructions, Business Use, Category filled in App Dashboard.
4. App Review (Advanced Access) for `whatsapp_business_messaging` + `whatsapp_business_management`, with a **screencast of the business-facing interface** demonstrating the exact permission use.

**Not required by Meta** (but valuable trust signals): a public-facing page describing the WhatsApp offering; an in-app template creation form; conversation analytics.

## Existing state

- **PR #447** (`feat/whatsapp-management-page`, open) ships the management console at `apps/dashboard/src/app/(auth)/settings/channels/whatsapp/page.tsx` with: readiness banner, setup section, phone numbers table (quality dot, messaging limit tier), templates (read-only, deep-link to Meta for creation).
- Public routes today: `/`, `/privacy`, `/terms`. No `/whatsapp`.
- Platform-level consent primitives already exist on main: `packages/core/src/consent/{consent-service,consent-store,contact-consent-reader}.ts`, `packages/db/src/prisma-consent-store.ts`, `packages/db/src/prisma-contact-consent-reader.ts`. Landed via [PR #435](https://github.com/jasonljc/switchboard/pull/435) (Medspa 1c). **Not Medspa-coupled** — already a shared read model.
- Outbound consent gate: `packages/core/src/channel-gateway/consent-revocation-gate.ts` + `packages/core/src/skill-runtime/hooks/pdpa-consent-gate.ts`.

## Architecture

```
apps/dashboard/src/app/(public)/whatsapp/page.tsx              ← Slice 1
apps/dashboard/src/app/(auth)/settings/channels/whatsapp/      ← PR #447 + Slices 2-4
  └ page.tsx (route wrapper, unchanged)
apps/dashboard/src/components/settings/
  ├ whatsapp-management.tsx                                    ← PR #447 + extended
  ├ whatsapp-send-test.tsx                                     ← new (Slice 2)
  ├ whatsapp-webhook-health.tsx                                ← new (Slice 3)
  ├ whatsapp-window-stats.tsx                                  ← new (Slice 3)
  ├ whatsapp-template-alex-tag.tsx                             ← new (Slice 4)
  └ whatsapp-opt-out-audit.tsx                                 ← new (Slice 4)
apps/api/src/routes/
  ├ whatsapp-management.ts                                     ← PR #447 + extended
  ├ whatsapp-send-test.ts                                      ← new (Slice 2)
  ├ whatsapp-webhook-health.ts                                 ← new (Slice 3)
  └ whatsapp-opt-out-audit.ts                                  ← new (Slice 4)
```

No changes to `packages/schemas`, `packages/core/src/consent`, or `apps/chat` adapters. All slices are additive at the API + dashboard layer except Slice 3 which queries existing audit/conversation state.

## Slice 0 — Merge PR #447 as App Review foundation

**Change required:** PR description and (optionally) the final commit message must reframe scope as **"App Review foundation — covers `whatsapp_business_management` flows (WABA, phones, templates, connection state)."** No code change. Avoids the trap of treating the console as App-Review-complete when Slice 2 is the messaging proof.

**Exit criteria:**

- PR #447 merged to main.
- Description states which permission(s) this surface covers (`whatsapp_business_management`) and which still needs proof (`whatsapp_business_messaging`, via Slice 2).

## Slice 1 — Public `/whatsapp` page

**Surface:** new route `apps/dashboard/src/app/(public)/whatsapp/page.tsx`, in the editorial register matching `(public)/page.tsx`.

**Contents (above-the-fold first):**

1. Hero: "WhatsApp Business — managed by Alex." Subhead: positioning Switchboard as the WhatsApp BSP layer for revenue teams.
2. "How it works with Alex" section: inbound message → Alex reads context → Alex replies inside or outside session window → templates used for re-engagement → operator approves on risk.
3. Features grid: approved templates, multi-number, quality monitoring, opt-in/opt-out audit, 24h-window awareness, governance.
4. Trust block: link to `/privacy`, link to `/terms`, business address line, contact email.
5. CTA: waitlist link or "Talk to us" → existing form/route.

**Purpose:** soft trust signal during Business Verification (reviewers visit the business website URL) and embedded-signup conversion lift. Not a Meta requirement.

**Out of scope:** pricing, demo video, customer logos.

**Tests:** route renders without auth; structural test for headings + privacy/terms links present.

## Slice 2 — Messaging-permission proof (in-console send-test)

**The App Review-critical slice.** Adds proof that Switchboard uses `whatsapp_business_messaging` correctly.

### Backend

- `POST /api/whatsapp-management/send-test`, registered in `apps/api/src/bootstrap/routes.ts`.
- Request body: `{ phoneNumberId, templateName, language, toNumber }`.
- Validation:
  - `toNumber` must be on a tenant-scoped allowlist stored as a JSON column `testRecipients` on `ManagedChannel` (channel-scoped, no new table). No surprise broadcasts.
  - Template must be in `APPROVED` state per Meta.
- Calls Graph API `POST /{phoneNumberId}/messages` with template message body.
- Returns `{ messageId, status: "queued" | "sent" | "failed", graphError? }`.
- Errors mapped to `{ error: { code, message, retryable } }` matching the existing convention from PR #447.
- Persists test sends to `whatsapp_test_send` (new table) with `messageId, sentBy, sentAt, status, lastWebhookStatus, lastWebhookAt`.

### Webhook coupling (progressive enhancement, not a hard dependency)

- Existing inbound webhook handler in `apps/chat/src/routes/managed-webhook.ts` already receives `statuses` events. Extend it to update `whatsapp_test_send.lastWebhookStatus` and `lastWebhookAt` when a `messageId` matches a known test send.
- The console UI subscribes to `whatsapp_test_send` updates via React Query polling (no new socket layer needed).
- If webhook never arrives, the send-test still passes; the row shows `queued/sent` with last-known status.

### Frontend

- New `whatsapp-send-test.tsx` panel inside `whatsapp-management.tsx`, between Setup and Templates sections.
- Inputs: phone-number selector (active, primary by default), template selector (filtered to `APPROVED`), test-recipient selector (allowlist).
- Submit → optimistic `queued` row in the recent-tests table, then updates as Graph + webhook respond.
- Recent-tests table: last 10 sends with `messageId, template, to, sentAt, apiStatus, deliveryStatus`.

### App Review screencast story

The screencast proves `whatsapp_business_messaging` by sending an approved template from the console and displaying the returned WhatsApp message ID. Delivery/read webhook status is shown when available, but App Review does **not** depend on real-time receipt. Combined with PR #447 (management surface), this is a single continuous flow on a single surface — exactly what Meta wants.

**Success criterion (hard):** Graph API returns a `messageId`. **Progressive enhancement:** webhook delivery/read receipt updates the row.

### Tests

- Mock Graph API (existing pattern in `whatsapp-management.test.ts`): assert request shape, success path, all error paths (template not approved, recipient not allowlisted, Graph 403/429).
- Component test: form validation, optimistic row, status updates from polling.
- Webhook update test: an inbound `statuses` event with a known `messageId` updates the matching `whatsapp_test_send` row.

## Slice 3 — Webhook health + 24h-window aggregates

**Goal:** operator can tell at a glance whether inbound is alive and how many contacts are reachable without a template right now. Both prevent Alex from silently failing.

### Webhook health

- New `GET /api/whatsapp-management/webhook-health` → `{ lastInboundReceivedAt, errorCount24h, totalReceived24h }`. Reads from existing inbound-event persistence in `apps/chat`.
- Surface in Setup section: small row "Last inbound: 2 min ago · 0 errors last 24h" or degraded "No inbound in 7 days" empty state.
- No alerting in this slice — purely visibility. Alerting is a later concern.

### 24h-window aggregates

- Reads existing conversation state from `apps/chat/src/conversation/state.ts`.
- New `GET /api/whatsapp-management/window-stats?phoneNumberId=...` → `{ contactsInWindow, contactsOutOfWindow, lastEvaluatedAt }`.
- Surface as a row beneath each phone number in the Phones table.

**UI copy (per user refinement — aggregates per number, not phone-number state):**

- `"42 contacts currently inside 24h window"`
- `"18 outside 24h window — templates required to re-engage"`
- `"No open customer service windows"` (empty state)

**What this is not:** a per-phone-number session state. Sessions are per contact/conversation; the table shows the aggregate.

### Tests

- Mock webhook-event store: three states (healthy, degraded, silent).
- Mock conversation state: three states (mixed, all-in-window, none-open).

## Slice 4 — Alex coupling + opt-out audit

**Goal:** turn the console from "generic WhatsApp settings" into "operator-grade controls for an Alex-driven channel."

### "Used by Alex" template tag

- Lookup against installed skill manifests (`packages/sdk` exports). Templates referenced by any active skill get a small `Used by Alex` chip in the Templates table.
- New helper: `apps/dashboard/src/lib/template-skill-resolver.ts` reads from existing skill registry (no new schema).
- Pure UI annotation. No behavior change.

### Opt-out audit

- New `GET /api/whatsapp-management/opt-out-audit?cursor=...&limit=50` → paginated list `{ contactId, channel: "whatsapp", source, optedOutAt, lastObservedBy }`.
- Reads from existing `packages/db/src/prisma-contact-consent-reader.ts` — **no new state, no new tables**.
- Surface as a tab or expandable section inside `whatsapp-management.tsx`: contact identifier, when opted out, source (inbound STOP / operator / API).
- Read-only. Restoring consent is intentionally out of scope (regulated flow).

### Why this is platform-level, not Medspa-only

The consent module landed in `packages/core/src/consent/` and `packages/db/src/prisma-consent-store.ts` as a **shared read model** in PR #435, not as Medspa-specific code. Alex, Riley, send-test (Slice 2), future campaign sends, and operator manual sends all read from the same consent state. This slice just adds a _viewer_ over that state — it doesn't lift or rewrite anything.

If a future audit finds Medspa-specific assumptions inside `consent-service.ts`, that's a separate cleanup ticket; not blocking here.

### Tests

- Template-skill resolver: given a set of skill manifests with template references, returns the correct set of template names.
- Opt-out audit endpoint: pagination, filtering by channel, empty state.

## Data flow summary

```
Slice 2 send-test:
  Console → POST /whatsapp-management/send-test → Graph /messages
  → returns messageId (success criterion)
  → webhook statuses event → updates whatsapp_test_send row → UI polls and updates (progressive enhancement)

Slice 3 webhook-health:
  Existing inbound webhook persists event → GET /whatsapp-management/webhook-health aggregates → console renders

Slice 3 window-stats:
  Existing conversation state → GET /whatsapp-management/window-stats → console renders aggregate per number

Slice 4 opt-out audit:
  Existing prisma-contact-consent-reader → GET /whatsapp-management/opt-out-audit → console renders paginated list

Slice 4 Alex template tag:
  Skill manifests (packages/sdk) → template-skill-resolver → Templates table chip
```

## Error handling

- **Send-test:** rate-limit per phone-number; surface Graph's exact error (template not approved, recipient not allowlisted, 24h-window-only without template, Graph 403/429); allowlist enforcement for test recipients.
- **Webhook health:** degrade gracefully — "no inbound received in last 7d" is informational, not an error.
- **Window-stats:** if conversation state is empty (new tenant), render zero state, not error.
- **Opt-out audit:** empty list renders an empty-state, not an error.

## Testing strategy

Each slice ships with co-located tests following existing patterns:

- API tests: `apps/api/src/routes/__tests__/whatsapp-*.test.ts` using `buildTestServer` + mocked Prisma + mocked Graph fetch.
- Component tests: `apps/dashboard/src/components/settings/__tests__/` with React Testing Library + mocked hooks.
- Lint, typecheck, `pnpm test` clean before each merge.

## Sequencing

```
Slice 0 (merge #447) ──► Slice 1 (public page) ──► Slice 2 (send-test)
                                                            │
                                                            ▼
                                          ┌── Submit Meta App Review ──┐
                                          │                            │
                                          ▼                            ▼
                              Slice 3 (webhook + 24h)   Slice 4 (Alex + opt-out)
                                          (in parallel with Meta review window)
```

Slices 0–2 must land before App Review submission. Slices 3–4 ship in parallel with Meta's 24–72h (up to 5d) review.

## Exit criteria for the whole spec

- All 5 slices merged.
- Meta App Review submitted with screencasts covering both permissions on a single surface (`/settings/channels/whatsapp`).
- Public `/whatsapp` reachable, linked from landing nav, contains privacy/terms links.
- Operator can: see webhook health, see how many contacts are in/out of 24h window per phone number, see which templates Alex uses, view opt-out audit.

## Out of scope (deliberately, per "ship clean, don't defer")

- In-app template **creation** form (Meta dashboard deep-link is sufficient).
- Conversation analytics dashboard (sent/delivered/read counts, cost projection).
- Restoring opt-out (regulated flow; needs its own spec).
- Quality alerting / paging.
- Embedded Signup CTA from the WhatsApp page (lives on `/settings/channels`; fine for now).
- Lifting `packages/core/src/consent` if it has Medspa-specific assumptions — not blocking this spec.

These are valid future work; they don't unlock Tech Provider or Alex safety as directly as the 5 slices above.

## Open questions

None. All three user refinements resolved:

1. ✅ Slice 2 success criterion = Graph `messageId`; webhook receipt = progressive enhancement.
2. ✅ Slice 4 reuses existing platform-level consent state (already shared, not Medspa-coupled per PR #435 audit).
3. ✅ Slice 3 24h-window UI = aggregates per phone number, not phone-number session state.

## Sources

- [Meta — Become a Tech Provider](https://developers.facebook.com/docs/whatsapp/solution-providers/get-started-for-tech-providers)
- [Meta — App Review sample submission](https://developers.facebook.com/docs/whatsapp/solution-providers/app-review/sample-submission)
- [Twilio — Tech Provider integration guide](https://www.twilio.com/docs/whatsapp/isv/tech-provider-program/integration-guide)
- [Infobip — Tech Provider Program](https://www.infobip.com/docs/whatsapp/tech-provider-program)
