# Pilot-Spine Live Walkthrough Audit

**Date:** 2026-06-07
**Status:** Approved design, pending implementation plan
**Type:** Audit (produces a findings report + seam-pin tests, not feature code)

## Problem

The codebase has merged a large volume of AI-authored work in the last weeks (receipted bookings Spec-1A, approval lifecycle, channel work, dashboard surfaces). Past audits reviewed slices against their own contracts, but history shows the dangerous failures live _between_ slices and _behind_ configuration: features that demo fine but are silently unwired, flags whose producers never populate data, controls that are stored but never enforced. The founder (non-developer) needs justified confidence that the pilot-critical path is sound before real customers touch it.

## Goal

Walk every pilot-critical journey end-to-end on a real running stack and assign each step an evidence-backed verdict. Leave permanent regression tests at every cross-package seam crossed. Produce a ranked findings report that feeds the established per-fix PR workflow.

## Non-goals

- Fixing findings (each blocks-pilot finding becomes its own focused PR in a later session)
- Auditing Mira and Riley paths behind OFF flags
- Auditing the marketing site
- Stripe (not built yet; the audit only confirms nothing on the spine pretends payments work)
- Security review (separate exercise; a 2026-06-07 adversarial review confirmed auth, tenancy scoping, and webhook verification are already hardened and previously audited)
- Governance-bypass audit of `system_auto_approved` and observe-mode auto-approve: these are real bypasses but live only on flag-OFF Riley/Mira paths today. **Follow-on:** that audit must run before those flags flip, not before this pilot.

## Scope: the seven journeys

Each journey is exercised as a customer or operator would experience it, at production-default configuration:

1. **Onboarding.** Org signup, Alex deployment created, entitlements seeded. A fresh org must reach a working state with zero founder intervention.
2. **Channel connect.** WhatsApp managed channel, with Telegram as the working stand-in while Meta gates are pending. Connect must produce an `active` ManagedChannel that actually routes messages (valid statuses: provisioning, active, error, disabled).
3. **The booking loop.** Starts with the operator _entering_ business facts and operating hours through the settings surface (walk the producer; do not assume the data pre-exists). Then: inbound customer message, Alex responds, booking captured, receipt recorded, entry lands in WorkTrace and renders in the dashboard. This is the Spec-1A spine. Explicitly verdict the empty-business-facts fallback (Alex composes with `BUSINESS_FACTS=""` silently) and the calendar-provider resolution for a fresh org (no `businessHours` writer is known to exist; expect Noop provider, a likely headline DORMANT finding).
4. **Approval lifecycle.** An action requiring approval shows in Inbox, operator approves, the action actually dispatches (approve must end in dispatch-or-recovery). The reject path is exercised too.
5. **Results surfaces.** Home, Inbox, and Results render real data produced by journeys 1 through 4, not fixtures. Includes known pre-live items: serviceId `"meta"` vs `"meta-ads"`, contacts fixture flag.
6. **Escalation / handoff.** Agent hands off to a human, the human can respond, the thread recovers. (Handoff replies route back over the same channel as the conversation; Slack approval notification is a separate, flag-dark path covered in the flag inventory.)
7. **Unattended outbound.** The appointment-reminder cron (`appointment-reminder-dispatch`, hourly) and scheduled-follow-up cron (`scheduled-follow-up-dispatch`, every 15 min) message real customers on timers, are registered unconditionally (no feature flag), and have no kill-switch. Verify: they fire for the right bookings/cadences and only those, they submit through `PlatformIngress.submit()` with a governable intent, they respect any template/marketing gates, and there is a way to stop them. Among the thinnest-tested code on the spine.

## Verdicts

Every step in every journey gets exactly one verdict:

- **PROVEN**: evidence artifact captured.
- **BROKEN**: exercised and failed; failure artifact captured.
- **DORMANT**: code exists but a flag, missing producer, or config means it cannot run in production as configured.

DORMANT is first-class, not a footnote. It is the verdict that catches "demos fine but is not wired."

## Method

### Phase 0: static seam-trace first pass

Before standing up the running stack, run a static seam-trace of the last ~3 weeks of merges: enumerate every producer-to-consumer boundary the merges introduced or touched (webhook to handler, store to hook to UI, cron to ingress) and check the shapes line up. This banks the cheap catches even if stack alignment eats time, and produces the seam list that the live walkthrough then pins with tests. Static findings from this pass still require live confirmation before a BROKEN verdict; unconfirmed ones are recorded as suspected.

### Evidence standard

No verdict without an artifact. Acceptable artifacts:

- A real HTTP response from the running API (status + body)
- A real database row queried after the action
- A real WorkTrace entry recording the action
- A screenshot of the dashboard actually rendering the data (headless Playwright per the existing visual-verification setup)

"The code handles this correctly" is never acceptable evidence. The audit reuses existing machinery: `.agent/skills/route-chain-audit/SKILL.md`, `.agent/conventions/evidence-standard.md`, and the deterministic `check-routes` tool run up front per `.agent/RESOLVER.md`.

### Production-default check

Each step is evaluated at real production configuration, not dev convenience settings. A step that only works because `DEV_BYPASS_AUTH=true`, demo mode, or a dev-only fixture is active gets DORMANT, not PROVEN.

### Seam pins

When a step crosses a producer-to-consumer boundary (webhook to handler, store to hook to UI, cron to ingress), the auditor writes a small permanent test asserting `ConsumerSchema.safeParse(producerOutput)` succeeds against the real producer's output shape. These tests are committed to the relevant packages so the audit leaves tripwires behind, not just a report.

### Prior-art guard

Every candidate finding is verified at file:line against current `main` before it is written down. Past audits flagged issues that had already shipped; this audit must not re-flag fixed work.

## Flag and producer inventory

Before the walkthroughs, build one table covering every switch that controls spine behavior:

- **Env vars and feature flags**: sourced from `.env.example`, `scripts/env-allowlist.local-readiness.json`, and Vercel-relevant `NEXT_PUBLIC_*` vars. For each: production value, behavior when unset, and whether anything pilot-critical silently defaults to demo or fixture mode.
- **Producer population**: for every gate or control that reads stored data (approval thresholds, entitlements, trust levels, channel status), confirm a real producer writes that data for a fresh pilot org.

Each row records: flag or field, who writes it, who reads it, production default, and a verdict:

- **LIVE**: producer writes, consumer enforces.
- **DORMANT**: consumer exists, producer never populates (or flag off).
- **ILLUSION**: UI suggests a control exists but nothing enforces it.

The 2026-06-07 pre-audit review already identified rows the inventory must include (verify against current main, then verdict):

- `OrganizationConfig.businessHours`: no product writer found; gates calendar provider selection (Noop fallback = bookings disabled)
- `NEXT_PUBLIC_REPORTS_LIVE`: ships `false` in `.env.example`; Results page renders non-live at production default
- `NEXT_PUBLIC_LAUNCH_MODE`: default `public` in `.env.example`, but code fallback when _unset_ is `waitlist` (403 on signup)
- `SLACK_BOT_TOKEN` + `SLACK_APPROVAL_CHANNEL`: approval notifications wired into ingress but dark until set
- `CHAT_PUBLIC_URL` / `SWITCHBOARD_CHAT_URL` + `INTERNAL_API_SECRET`: required for a channel to resolve `active` rather than `config_error`
- `FOLLOWUP_ALLOW_MARKETING_TEMPLATE`: empty default; gates journey 7 sends, behavior unverified
- `NEXT_PUBLIC_CONTACTS_LIVE`: contacts fixture flag
- serviceId `"meta"` vs `"meta-ads"` mismatch on Results

## Slim decay pass (closing phase)

After the walkthroughs:

- Run existing deterministic tools: `check-routes`, `pnpm arch:check`, dependency-layer check.
- Scan for any mutating path that bypasses `PlatformIngress.submit()`.
- Note orphan modules and oversized files.

Decay findings join the same ranked list but are labeled decay, not pilot-blocking.

## Output

Everything lands in `docs/audits/2026-06-07-pilot-spine-audit/`:

- `index.md`: journey-by-journey verdict map, the flag inventory table, and all findings ranked by pilot impact: blocks-pilot, embarrasses-pilot, cosmetic, decay note.
- `findings/`: one file per finding with verified file:line, the evidence artifact (or a pointer to it), and a suggested fix scope.
- Committed seam-pin tests in the relevant packages.

Fixes are out of scope. The report feeds the established workflow: each blocks-pilot finding becomes its own focused fix PR, verified at file:line in a fresh session.

## Execution notes

- **Prerequisites (gather before starting):** a real `ANTHROPIC_API_KEY` (Alex's responses need a live model; budget for the cost), a Telegram bot token from BotFather (journeys 2, 3, 6), chat-runtime env (`CHAT_PUBLIC_URL`/`SWITCHBOARD_CHAT_URL`, `INTERNAL_API_SECRET`), `NEXTAUTH_SECRET`, and `CREDENTIALS_ENCRYPTION_KEY` aligned with the seed. WhatsApp has no local sandbox; Telegram is the stand-in and WhatsApp-specific steps verdict from config evidence.
- **Hand-injection rule:** any manual DB write needed to unblock a journey (e.g., injecting `businessHours` to get past the Noop calendar provider) is allowed only as a documented deviation, and automatically files a DORMANT finding for the missing producer. Undocumented hand-injection would convert a DORMANT into a fake PROVEN, which defeats the audit.
- **Known dependency chain:** approve-to-dispatch (journey 4) needs a real parked action with a real bindingHash; seeded approvals cannot be approved by design. That real action comes from journey 3, so journey 3's walkthrough must park one approval-requiring action for journey 4 to consume.
- Runs in the existing local stack: API on :3000, dashboard on :3002, servers launched detached (`nohup` + `disown`), API loads root `.env` via `node --env-file=.env`.
- Requires Postgres up and DB seeded; seed encryption must be aligned ("Unable to load dashboard data" means stack misalignment, not a finding).
- Dashboard-to-API calls go through Next proxy routes; a missing proxy route is itself a legitimate BROKEN finding, only discoverable by real browser or curl.
- Known infra flakes (pg_advisory_xact_lock tests, api bootstrap-smoke npm warning) are not findings.

## Success criteria

1. Every step of all seven journeys carries a PROVEN, BROKEN, or DORMANT verdict with an artifact.
2. The flag inventory covers every env var and stored control on the spine (including all pre-identified rows above) with a LIVE, DORMANT, or ILLUSION verdict.
3. Every cross-package seam crossed by the walkthroughs has a committed safeParse pin test, seeded from the Phase 0 seam list.
4. Findings are ranked by pilot impact and individually verified at file:line against current main.
5. The deterministic decay tools have been run and their results recorded.
6. Any manual DB intervention is documented as a deviation with a paired DORMANT finding.
