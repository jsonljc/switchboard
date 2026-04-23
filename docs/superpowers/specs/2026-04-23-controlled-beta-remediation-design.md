# Switchboard Controlled Beta Remediation Program

> A 7-sub-project remediation program to move Switchboard from "not ready for
> broad self-serve public launch" to "conditionally launchable as a controlled
> beta."
>
> Governing audit: `2026-04-23-public-launch-audit-results.md`
> Audit design: `2026-04-23-public-launch-audit-design.md`

---

## Program Structure

**What this is:** A 7-sub-project remediation program to move Switchboard from
"not ready for broad self-serve public launch" to "conditionally launchable as
a controlled beta." Each SP has its own spec → plan → implementation cycle. SPs
are ordered by the critical journey path and are independently shippable.

**What this is not:** This is not a path to broad self-serve public launch. The
controlled beta still requires founder-assisted integrations for some users and
does not include billing/payment infrastructure. Moving from controlled beta to
full public launch would require a separate audit cycle and additional SPs
(billing, fully guided WhatsApp WABA provisioning, etc.).

**Success criterion:**

After SP1–SP3, Switchboard should be viable for a controlled beta:
production-like deployment, signup, connection, activation, and minimum safe
intervention paths should rate Pass or Pass with friction, with no blocker on
the controlled-beta path.

After SP4–SP7, the controlled beta should become operationally trustworthy and
commercially credible, with visibility, intervention, proof-of-value, discovery
alignment, and degraded-calendar handling upgraded accordingly.

**Constraints:**

- All work stays within the existing architecture (no new packages, no new apps)
- Follow existing patterns (ESM, `.js` extensions in non-Next.js packages,
  Prisma stores, Zod schemas)
- Every SP must include tests and pass typecheck + lint + existing test suite
- No billing/payment system in this program — free-tier-only for controlled beta
- `LocalCalendarProvider` is acceptable only for controlled beta, only if the
  product clearly surfaces booking as degraded / non-production-grade, and only
  if no customer is misled into thinking Google Calendar is actually connected
- Each SP must produce a user-visible milestone that can be validated against
  the audit journey, not just subsystem progress

**Cross-cutting rule:** No new surface ships without showing truthful state.
This applies to: override state, escalation state, paused agent state,
sample/demo state, reconciliation freshness, calendar connected vs degraded,
pricing/beta state on the public site.

**Milestones:**

| SP  | Scope                                                          | Milestone                                          |
| --- | -------------------------------------------------------------- | -------------------------------------------------- |
| SP1 | Self-serve signup + account provisioning + `api-client.ts` fix | Users can enter                                    |
| SP2 | Integration wiring (Meta Ads OAuth + WhatsApp guided setup)    | Users can connect                                  |
| SP3 | Activation fix + minimum safety controls                       | Controlled beta is safely activatable and routable |
| SP4 | Full operator controls                                         | Beta becomes trustworthy and operable              |
| SP5 | Visibility + proof of value                                    | Users can see and trust outcomes                   |
| SP6 | Public site cleanup                                            | Discovery matches actual product                   |
| SP7 | Calendar + notifications                                       | Core promise fully delivered                       |

---

## SP1: Self-Serve Signup + Account Provisioning

**Goal:** A new user can create an account from the public site, enter the
authenticated dashboard, and reach onboarding without broken dashboard backend
routes.

**Pass condition:** A new user can go from homepage → signup → account creation
→ authenticated dashboard → onboarding entry without founder intervention, and
core dashboard server routes do not 500.

### What Ships

**1. Public registration page**

A `/signup` page accessible from the homepage CTA and login page's "Don't have
an account?" link. Collects email + password (minimum viable). On submit,
creates the full account stack using the existing `provisionDashboardUser`
function — which already handles org creation, principal, identity spec,
dashboard user, and API key in a transaction. This function exists and works
today for Google OAuth / magic link flows; we're just adding a credentials-based
entry point to it.

No email verification for controlled beta. Can be added later.

**2. Fix `api-client.ts`**

The file `apps/dashboard/src/lib/api-client.ts` is imported by
`get-api-client.ts` but doesn't exist.

Strategy:

- First determine whether `api-client.ts` was intentionally deleted or
  accidentally missing
- If missing accidentally, restore the intended implementation
- If obsolete, refactor callers to the current supported client path and remove
  the dead import cleanly

This unblocks every dashboard server-side proxy route.

**3. Login page fix**

Change "Don't have an account? Get started" link from `/` (homepage loop) to
`/signup`.

**4. Homepage CTA update**

Change primary CTA from `/get-started` (waitlist) to `/signup` (registration).
Keep the waitlist page alive but remove it from the primary navigation flow.

**5. Launch mode gate**

The existing `NEXT_PUBLIC_LAUNCH_MODE` env var gates behavior:

- `waitlist` (current default): CTAs go to waitlist, signup page redirects to
  waitlist. Waitlist mode must prevent open registration from both public CTA
  flow and direct `/signup` access.
- `beta`: CTAs go to signup, registration is open

### What Doesn't Ship

- No billing/payment (free tier only)
- No email verification
- No Google OAuth or magic link changes (already work when env vars configured)
- No invite system or access codes
- No onboarding content changes

### Files Touched (estimated)

- New: `apps/dashboard/src/app/(public)/signup/page.tsx`
- New: `apps/dashboard/src/app/api/auth/register/route.ts`
- Fix: `apps/dashboard/src/lib/api-client.ts` (restore or refactor)
- Edit: `apps/dashboard/src/app/login/page.tsx` (link fix)
- Edit: `apps/dashboard/src/app/(public)/page.tsx` (CTA target)
- Edit: `apps/dashboard/src/components/landing/homepage-hero.tsx` (CTA target)

### Tests

- Registration endpoint: creates user, org, principal in transaction
- Rejects duplicate email
- Rejects weak password
- Login with newly created credentials works
- Authenticated session is established after registration
- Dashboard route access works for the created user
- Unauthenticated access still redirects correctly
- Launch mode gate: signup redirects to waitlist when `LAUNCH_MODE=waitlist`
- Direct `/signup` access blocked in waitlist mode
- `api-client.ts` fix: dashboard proxy routes return 200 not 500

### Audit Steps Addressed

- Step 3 (Signup + Onboarding): Fail → Pass with friction
- Step 5 partial: `api-client.ts` fix removes the hard crash

---

## SP2: Integration Wiring

**Goal:** A user who has signed up (SP1) can connect their Meta Ads account and
WhatsApp Business channel from the dashboard without founder-provided env vars
or raw credential paste.

**Pass condition:** A user can complete Meta Ads OAuth and WhatsApp channel
setup from dashboard UI surfaces, with the resulting credentials stored and
usable by the chat runtime, without the founder configuring per-customer env
vars or pasting tokens on their behalf.

**Env var clarification:**

- `FACEBOOK_APP_ID` and `FACEBOOK_APP_SECRET` are deployment-level env vars
  (one Meta App for the platform, not per-customer). Standard for OAuth.
- `CREDENTIALS_ENCRYPTION_KEY` is deployment-level, handled by `deploy/setup.sh`.
- Per-customer credentials are stored encrypted in the connection store, not as
  env vars.

### What Ships

**1. Wire Meta Ads OAuth into dashboard setup wizard**

The backend OAuth flow is complete (`apps/api/src/routes/facebook-oauth.ts`).
The gap is purely that the dashboard wizard has a placeholder div instead of
triggering the authorize URL.

Work:

- Replace the placeholder in step 1 with a button redirecting to
  `/api/connections/facebook/authorize`
- Preserve wizard context/state across the OAuth redirect
- On callback success, return user to the correct wizard step with clear
  success/failure state
- In step 2, fetch real ad accounts from
  `/api/connections/facebook/ad-accounts`
- Allow explicit account selection (Option B — user chooses one account)
- Wire selection to persist the chosen ad account to the connection store

**2. WhatsApp guided setup**

For controlled beta: guided credential entry, not full WABA provisioning. The
user still needs a Meta Business account with Cloud API access.

Work:

- Replace bare "API key" field with labeled fields: "WhatsApp Cloud API Access
  Token" and "Phone Number ID"
- Add inline step-by-step guidance explaining:
  - What each credential is
  - Where to find it in Meta Business Suite (navigation path)
  - How to tell whether the account has Cloud API access
  - What common errors mean
- Add a "Test Connection" button that calls the WhatsApp Cloud API
  `GET /v21.0/{phone_number_id}` to verify credentials before saving
- Credentials are only persisted after successful Test Connection (no
  draft/disconnected state with bad credentials)

**3. Connection status visibility**

- Connected / disconnected state on the onboarding go-live checklist
- Connection health on the settings channels page
- Clear error messaging if credentials are invalid or expired

**4. Meta Ads token lifecycle management**

- Check token age/expiry metadata on each API call using stored credentials
- Attempt refresh where supported by the token type
- If refresh fails or is unsupported, surface "Meta Ads connection needs
  re-authorization" on the dashboard with a re-connect CTA
- Log token lifecycle events to the audit trail

### What Doesn't Ship

- No WhatsApp embedded signup or WABA provisioning
- No Meta Ads campaign creation or management from dashboard
- No CAPI (Conversions API) setup
- No multi-ad-account management (single account per org)

### Files Touched (estimated)

- Edit: `apps/dashboard/src/components/modules/improve-spend-setup.tsx`
- Edit: `apps/dashboard/src/components/onboarding/channel-connect-card.tsx`
- New: `apps/dashboard/src/components/onboarding/whatsapp-setup-guide.tsx`
- Edit: `apps/dashboard/src/components/onboarding/go-live.tsx`
- Edit: `apps/dashboard/src/components/settings/connections-list.tsx`
- New: `apps/api/src/services/meta-token-refresh.ts`
- Edit: `apps/api/src/routes/facebook-oauth.ts`

### Tests

- OAuth button redirects to Meta authorize URL with correct scopes
- OAuth callback stores credentials and redirects to correct wizard step
- Ad account fetch returns real data from stored credentials (mocked API)
- User can select a specific ad account and selection persists
- WhatsApp test-connection validates against Cloud API and reports
  success/failure
- Invalid WhatsApp credentials show clear error, do not save
- Token lifecycle check triggers within expiry window
- Expired/revoked credentials surface re-auth prompt on dashboard
- Integration setup not exposed in broken state to unauthenticated users

### Audit Steps Addressed

- Step 4 (Meta Ads + WhatsApp Connection): Fail → Pass with friction

---

## SP3: Activation Fix + Minimum Safety Controls

**Goal:** A user who has signed up (SP1) and connected integrations (SP2) can
activate the funnel and have it actually process messages, with minimum safety
controls to stop or review agent behavior.

**Pass condition:** Go-live creates the correct deployment records so incoming
messages are routable by the chat runtime. Readiness validation accurately
reflects whether the funnel can work. The owner has an emergency halt button and
a basic escalation inbox visible in the dashboard. Activation is only considered
successful if a real inbound message can be routed end-to-end to the correct
deployment after go-live.

### What Ships

**1. Fix go-live data model**

The core bug: go-live creates `ManagedChannel` records and sets
`OrgConfig.provisioningStatus = "active"`, but the chat gateway resolves via
`DeploymentConnection` → `AgentDeployment`.

Work:

- During go-live, create or ensure an `AgentDeployment` record exists (linked to
  Alex listing with `skillSlug: "alex"`, status `active`)
- Create a `DeploymentConnection` record linking the deployment to channel
  credentials (with hashed token the gateway can resolve)
- Bridge `ManagedChannel` records to the deployment path
- This is a data model fix, not an architectural change

**2. Readiness validation**

Replace hardcoded "Playbook complete" checkmark with real validation.

Blocking checks (go-live disabled until all pass):

- At least one channel connected with valid (tested) credentials
- Business facts populated for the org
- AgentListing exists with a valid `skillSlug`
- LLM provider configured for the active deployment environment

Each check shows pass/fail with a specific message explaining what's missing and
how to fix it.

**3. Business facts collection**

Add a business facts step to onboarding (between playbook training and go-live).

Minimum viable fields:

- Business name
- Service description
- Booking types / services offered
- Operating hours
- Location / service area
- Contact / handoff preference (how escalation or manual follow-up should happen)

Persist to the `BusinessFacts` store. Pre-populate from website scan data if
available from onboarding step 1.

**4. Emergency halt button**

Work:

- Add a prominent "Emergency Stop" button on the owner dashboard home
- Red/destructive styling, visible at all times, not buried in settings
- Confirmation dialog before executing
- Calls `POST /api/governance/emergency-halt`
- Halt state must be respected by message-processing entrypoints before any new
  outbound agent action occurs
- Dashboard updates to show "Agent paused" with a "Resume" button
- Resume: unlocks governance profile, restores prior active state only if
  readiness checks still pass, otherwise shows paused-with-action-needed

**5. Basic escalation inbox**

Work:

- Add an escalation list view accessible from owner navigation
- Show: escalation reason, conversation summary, timestamp, priority, SLA
  deadline
- Include a recommended next action label or obvious reply / resolve /
  mark-for-follow-up flow
- Allow owner to reply via existing `POST /api/escalations/:id/reply`
- Show badge/count of pending escalations on navigation item
- Minimal: list with expandable detail and reply form

### What Doesn't Ship

- No conversation override UI (SP4)
- No rich escalation threading (SP4)
- No per-agent pause toggle (SP4 — emergency halt covers critical case)
- No onboarding content changes beyond business facts
- No launch animation changes

### Files Touched (estimated)

- Edit: `apps/api/src/routes/agents.ts` (go-live deployment/connection records)
- Edit: `apps/dashboard/src/components/onboarding/go-live.tsx` (readiness checks)
- New: `apps/dashboard/src/components/onboarding/business-facts-step.tsx`
- Edit: `apps/dashboard/src/app/(auth)/onboarding/page.tsx` (add step)
- New: `apps/dashboard/src/components/dashboard/emergency-halt-button.tsx`
- Edit: `apps/dashboard/src/components/dashboard/owner-today.tsx`
- New or edit: `apps/api/src/routes/governance.ts` (resume endpoint)
- New: `apps/dashboard/src/app/(auth)/escalations/page.tsx`
- New: `apps/dashboard/src/components/escalations/escalation-list.tsx`
- New: `apps/dashboard/src/components/escalations/escalation-reply.tsx`
- Edit: `apps/dashboard/src/components/layout/owner-tabs.tsx`

### Tests

- Go-live creates `AgentDeployment` + `DeploymentConnection` records
- Chat gateway resolves channel token to correct deployment after go-live
- Go-live blocked when: no channel, no business facts, no listing/skill, no LLM
- Readiness checks show specific failure messages per missing prerequisite
- Business facts persist and are retrievable by `ContextResolver`
- Emergency halt locks governance and returns paused state
- Halt state is respected by message-processing entrypoints
- Resume unlocks only if readiness checks pass; otherwise shows action-needed
- Dashboard reflects paused/active state correctly
- Escalation list shows pending escalations with correct data
- Escalation reply posts to backend and updates list state
- Escalation badge count reflects pending count

### Audit Steps Addressed

- Step 5 (Activation): Fail → Pass
- Step 6 (Autonomous Operation): business facts gap closed
- Step 8 (Operator Intervention): emergency halt + basic escalation → Pass with
  friction

### Milestone Check

After SP3, controlled beta is safely activatable and routable. A user can sign
up, connect channels, activate a funnel that actually processes inbound messages
through the correct deployment path, and stop or review operation through
minimum safety controls.

---

## SP4: Full Operator Controls

**Goal:** The owner can intervene in agent operations with confidence, not just
minimally.

**Pass condition:** The owner can take over a conversation, browse escalation
history with context, and pause/resume individual agents — all from dashboard
surfaces. Intervention actions take effect reliably and are reflected in the UI
immediately.

### What Ships

**1. Conversation override UI**

A conversation browser accessible from navigation. Shows active/recent
conversations with transcript view (components already exist:
`use-conversations.ts`, `conversation-transcript.tsx`). "Take over" button
triggers `PATCH /api/conversations/:id/override`.

Override precedence: when the owner takes over, the agent must stop sending new
outbound actions on that conversation until the override is explicitly released.
If a conversation is both escalated and manually overridden, override state wins
for outbound actions until explicitly released.

**2. Rich escalation inbox**

Upgrade SP3's basic inbox with conversation context: show the conversation
transcript leading up to the escalation, the agent's last action, and the
specific trigger. Allow owner to reply with instructions or resolve with a note.
Show resolution history.

**3. Agent pause/disable toggle**

Per-agent toggle on the settings team page. Uses existing
`PUT /api/agents/roster/:id` with status field. Paused agent stops receiving new
tasks. Queued tasks are rerouted, held, or escalated (explicitly defined, not
silently dropped). Dashboard shows paused state on module cards and agent team
page.

### Audit Steps Addressed

- Step 8 (Operator Intervention): Pass with friction → Pass

---

## SP5: Visibility + Proof of Value

**Goal:** The owner can understand what the system did, why it made decisions,
and see business outcomes clearly enough to trust the product during the trial.

**Pass condition:** Agent decision reasoning is visible on approval and activity
surfaces. The owner can browse conversations. Trial start doesn't show an empty
dashboard. The ROI page health indicator reflects reality.

### What Ships

**1. Decision reasoning on approvals**

Extend approval action cards to include the agent's reasoning: what context it
had, what it decided, and why it's asking for approval. Keep it short and
owner-readable — a concise rationale, not internal chain-of-thought detail.

**2. Human-readable trace summaries**

Replace `JSON.stringify(trace, null, 2)` with structured summary: skill invoked,
tools called (with descriptions), decisions made, outcome. Keep raw JSON behind
an expandable "Developer view" toggle.

**3. Conversation browser page**

A `/conversations` page in owner navigation showing all conversations with
status, channel, timestamp, and expandable transcript. Builds on SP4's override
capability.

**4. Onboarding demo data**

On first activation, seed 2-3 sample conversion records, a sample booking, and
a sample conversation. Rules:

- Demo data must be visually unmistakable (distinct label, different styling)
- Demo data must never contaminate real metrics (excluded from ROI calculations)
- Auto-clear is deterministic and auditable when first real lead arrives
- Clearly labeled: "Sample data — will be replaced by real activity"

**5. Reconciliation scheduling**

Wire `ReconciliationRunner` to run every 6 hours. Remove permanent "stale"
warning. Show actual reconciliation results.

**6. Fix module traces stub**

Wire `/modules/[module]/traces/page.tsx` to real data.

### Audit Steps Addressed

- Step 7 (Visibility + Trust): Pass with friction → Pass
- Step 9 (Proof of Value): Pass with friction → Pass

---

## SP6: Public Site Cleanup

**Goal:** The public site accurately represents what the product does on day
one, without phantom features, contradictory pricing, or missing value prop
language.

**Pass condition:** The homepage explains the Meta Ads → WhatsApp lead handling
value prop. No non-existent agents or features are shown. Pricing is internally
consistent. Legal basics are present.

### What Ships

**1. Meta Ads value prop on homepage**

Add explicit mention of Meta Lead Ads integration to the hero section and How It
Works page. This is the stated day-one wedge and is currently absent.

**2. Remove phantom agents**

Remove "Sales Closer" and "Nurture Specialist" from How It Works. Replace with
capability descriptions of what Alex does (qualify, nurture, close, book).

**3. Pricing coherence**

For controlled beta: show the free tier clearly as the beta offering. Remove or
dim paid tiers with "Coming soon." Reconcile homepage single-card pricing with
standalone pricing page.

**4. Trust score language cleanup**

Replace insider terminology with SMB-friendly language on all public pages.

**5. Legal minimum**

Add privacy policy and terms of service links to footer. Simple documents are
acceptable for controlled beta, but they must exist.

**6. CTA consistency**

Align all CTAs to the same language for beta mode.

### Audit Steps Addressed

- Step 1 (Discovery): Pass with friction → Pass
- Step 2 (Pricing + Trial): Fail → Pass with friction. SP6 moves Step 2 from
  Fail to Pass with friction by making pricing/trial presentation honest and
  coherent, while billing remains intentionally out of scope.

---

## SP7: Calendar + Notifications

**Goal:** The core value promise — booked appointments that appear on a real
calendar — is fully delivered, and escalation notifications reach the owner
without requiring Telegram configuration.

**Pass condition:** An owner can connect their Google Calendar from the
dashboard. Bookings create real calendar events. Escalation notifications are
delivered via email by default, with Telegram as an optional upgrade.

### What Ships

**1. Google Calendar OAuth in dashboard**

Add a calendar connection step to the Convert Leads module setup wizard.
Standard Google OAuth: redirect to consent screen, callback stores refresh
token, calendar ID selected from user's calendars. `GoogleCalendarAdapter`
already exists — this is wiring.

**2. Calendar connection status**

Show calendar connection state on dashboard. When using
`LocalCalendarProvider`, show explicit message: "Bookings are saved but not
synced to a calendar. Connect Google Calendar to send invites automatically."

**3. Email-based escalation notifications**

Replace Telegram as the default notification channel. When an agent escalates,
send email to org owner with: escalation reason, conversation summary, link to
escalation inbox. Telegram remains as optional configured channel.

**4. LocalCalendarProvider honest messaging**

Update `healthCheck()` from silent `degraded` to structured response the
dashboard renders as clear, honest messaging about what's connected and what
isn't.

### Audit Steps Addressed

- Step 6 (Autonomous Operation — external dependency readiness): → Pass
- Step 9 (Proof of Value): fully addressed

---

## Program Summary: Audit Coverage

After all 7 SPs ship:

| Audit Step                | Before           | After SP1-3                 | After SP4-7        |
| ------------------------- | ---------------- | --------------------------- | ------------------ |
| 0. Production Environment | Pass w/ friction | Pass w/ friction            | Pass w/ friction\* |
| 1. Discovery              | Pass w/ friction | Pass w/ friction            | Pass               |
| 2. Pricing + Trial        | Fail             | Fail (billing out of scope) | Pass w/ friction   |
| 3. Signup + Onboarding    | Fail             | Pass w/ friction            | Pass w/ friction   |
| 4. Meta Ads + WhatsApp    | Fail             | Pass w/ friction            | Pass w/ friction   |
| 5. Activation             | Fail             | Pass                        | Pass               |
| 6. Autonomous Operation   | Pass w/ friction | Pass w/ friction            | Pass               |
| 7. Visibility + Trust     | Pass w/ friction | Pass w/ friction            | Pass               |
| 8. Operator Intervention  | Pass w/ friction | Pass w/ friction            | Pass               |
| 9. Proof of Value         | Pass w/ friction | Pass w/ friction            | Pass               |

**\*Step 0 note:** Production Environment remains Pass with friction because
production-like deployment is viable but still carries controlled-beta
operational roughness (manual bootstrap for first user, no automated backups)
rather than polished public-launch infrastructure. This is acceptable for
controlled beta and does not block any SP.

**Remaining gap after full program:** Step 2 (Pricing + Trial) stays at Pass
with friction because billing/payment is explicitly out of scope. This is
acceptable for controlled beta. Moving to full self-serve public launch requires
a separate billing SP and re-audit.

**Expected audit verdict after full program:** Conditionally Launchable —
viable for controlled beta with explicit conditions:

- Free tier only (no billing)
- WhatsApp requires existing Meta Business + Cloud API access
- Founder monitors the early cohort for product learning and support quality,
  not to perform hidden setup required for the nominal product flow
