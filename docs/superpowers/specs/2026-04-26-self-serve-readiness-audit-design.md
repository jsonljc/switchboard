# Self-Serve Readiness Audit — Design Spec

> **Date:** 2026-04-26
> **Status:** Approved
> **Timeline:** 1 month to launch-ready
> **Target:** 10-50 self-serve orgs
> **Deployment:** Managed container platform (Railway/Fly.io) primary, Docker Compose fallback

---

## Core Question

> Can a real self-serve customer get from signup to revenue without hidden founder intervention, broken trust, or unsafe behavior?

Every finding, every classification, every verdict traces back to this question.

---

## Method

**Journey-led, track-validated.**

Five customer journeys form the audit spine. Every step in every journey is evaluated through five lenses plus one global constraint. Findings are classified P0/P1/P2 with exact code evidence, traced execution paths, and customer impact.

**Quality over speed.** One journey per session, depth over coverage. No flat grep lists. No speculative findings — every finding must be backed by either (a) an executed code path or (b) proof that a code path is unreachable or broken.

---

## The Five Journeys

### J1: Signup → First Agent Live

|                             |                                                                                                                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Entry**                   | Landing page                                                                                                                                                                                     |
| **Exit**                    | Agent responds to first real inbound message                                                                                                                                                     |
| **Success**                 | Customer completes setup alone. Agent handles first inbound message on a real external channel (WhatsApp or Telegram) with verified delivery, response trace, and persisted conversation record. |
| **Production Reality rule** | If this journey uses mock/simulated execution at any step → **automatic P0**, even if a fallback exists. A fake agent response = no product.                                                     |

**Steps to trace:**

1. Load landing page → pricing → signup CTA
2. Register (email + password, no SMTP required)
3. Complete onboarding wizard (business basics → agent selection → tone → knowledge → channel → review)
4. Connect WhatsApp or Telegram channel
5. Agent deployment activates
6. Send inbound test message on real channel
7. Agent processes message, responds, conversation persisted

### J2: Lead → Response → Booking

|                             |                                                                                                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Entry**                   | Inbound WhatsApp message from a lead                                                                                                                                            |
| **Exit**                    | Booked appointment with attribution visible in dashboard                                                                                                                        |
| **Success**                 | Lead converts to a real booked appointment on a real calendar, with confirmed calendar event, attribution tracked through WorkTrace, and booking visible in operator dashboard. |
| **Production Reality rule** | If this journey uses mock/simulated execution at any step → **automatic P0**, even if a fallback exists. A fake booking = no revenue.                                           |

**Steps to trace:**

1. WhatsApp webhook receives inbound message
2. Message routed to correct org's agent deployment
3. Agent converses (multi-turn lead qualification)
4. Agent proposes booking → calendar availability checked
5. Booking created on real calendar provider
6. Confirmation sent back to lead on WhatsApp
7. WorkTrace records full journey (lead → conversation → booking)
8. Attribution visible in dashboard ROI view
9. CAPI event fired to Meta with real data

### J3: Trial → Paid → Enforcement

|             |                                                                                                                                                                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Entry**   | Free signup                                                                                                                                                                                                                                |
| **Exit**    | Billing state always consistent with app state                                                                                                                                                                                             |
| **Success** | Stripe checkout completes, plan state reflects in app immediately, usage is tracked, limits enforce on downgrade/cancel, no free rides, no phantom charges. App state and Stripe state cannot disagree without reconciliation catching it. |

**Steps to trace:**

1. Free signup → what can the user access? What's gated?
2. Upgrade CTA → Stripe checkout session created
3. Payment succeeds → webhook received → app state updated
4. Plan reflected in dashboard (features unlocked)
5. Usage metering (if applicable)
6. Downgrade/cancel → Stripe webhook → features gated
7. Failed payment → grace period → suspension
8. Stripe state vs app state reconciliation

### J4: Operator Monitors → Intervenes

|             |                                                                                                                                                                  |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Entry**   | Owner logs into dashboard                                                                                                                                        |
| **Exit**    | Owner has accurate, actionable visibility and can control agent behavior                                                                                         |
| **Success** | Conversations are real and current. Override stops agent immediately. Escalation notifications arrive. Performance metrics reflect truth, not cached/stale data. |

**Steps to trace:**

1. Dashboard loads → conversation list shows real conversations
2. Click into conversation → full message history with timestamps
3. Agent is producing bad response → owner uses override
4. Override takes effect immediately (next message uses owner's response)
5. Escalation triggers → notification reaches owner (email/Telegram)
6. Performance/ROI page → data matches actual WorkTrace records
7. Emergency halt → agent stops processing, status reflected in UI

### J5: Day-2 Ops

|             |                                                                                                                                                                                    |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Entry**   | System running in production with active customers                                                                                                                                 |
| **Exit**    | System self-heals, alerts on failure, recovers without data loss                                                                                                                   |
| **Success** | Token refresh runs automatically. Failures produce actionable alerts. Backups are restorable. Deploy updates apply without downtime. Health endpoints reflect actual system state. |

**Steps to trace:**

1. Meta token approaching expiry → refresh cron fires → token updated
2. Token refresh fails → alert generated → operator notified
3. Database backup → restore → data integrity verified
4. Deploy new version → zero-downtime (or minimal) → health checks pass
5. Health endpoints (`/health`, `/api/health/deep`) reflect real component status
6. Sentry captures errors with enough context to diagnose
7. Log output is structured, filterable, and doesn't leak secrets
8. Redis failure → graceful degradation (rate limiting, idempotency)

---

## The Five Lenses

Applied at every step of every journey.

### 1. Completeness

|              |                                                                                                                                               |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **Question** | Is this real code or a stub/TODO/noop?                                                                                                        |
| **Fail**     | `NoopCalendarProvider` in production path, hardcoded return values, unimplemented routes, TODO comments in critical paths, empty catch blocks |

### 2. Production Reality

|                   |                                                                                                                                                                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Question**      | Does this execute against real external systems with confirmed side effects?                                                                                                                                                    |
| **Fail**          | Mock providers active in production path, `simulate` flags, fake success returns without external confirmation, test-mode APIs not isolated from prod, "success" returned without verifying the external system acknowledged it |
| **Elevated rule** | For J1 and J2, any Production Reality failure is **automatic P0** regardless of fallback existence.                                                                                                                             |

### 3. Security / Multi-tenancy

|              |                                                                                                                                                                                                          |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Question** | Can org A see or affect org B?                                                                                                                                                                           |
| **Fail**     | Missing `orgId` filters on database queries, shared in-memory state across tenants, leaked credentials in logs or responses, unbounded queries without tenant scoping, API endpoints missing auth checks |

### 4. Reliability & State Integrity

|                   |                                                                                                                                                                                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Question**      | Are outcomes consistent across all system states? What happens on failure, retry, or duplicate?                                                                                                                                                                    |
| **Sub-questions** | Are writes atomic? Is there a single source of truth? Can two systems disagree? Is reconciliation possible?                                                                                                                                                        |
| **Fail**          | Partial writes across services (booking created but CRM not updated), Stripe says active but app thinks free tier, no idempotency guards, duplicate webhook processing, WorkTrace says completed but execution failed, no reconciliation path for state divergence |

### 5. Ops Readiness

|              |                                                                                                                                                               |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Question** | Can you monitor, recover, and explain this step?                                                                                                              |
| **Fail**     | No health check covers this component, no log entry for this path, no runbook entry, no alert for this failure mode, no way to diagnose issues after the fact |

---

## Global Constraint: Self-Serve Integrity

> Every journey step must be completable by a fresh user with zero internal access.

Any step requiring manual setup, hidden env flags, developer console access, DB seeds not exposed through UI, or founder action is **automatically P0** regardless of which lens catches it.

**Automatic P0 examples:**

- Webhook URL must be manually configured in Meta Developer Console
- Requires running a seed script to create initial data
- Works only when a specific env var is set that isn't part of standard setup flow
- Admin endpoint needed to unblock a user flow
- Requires SSH/DB access to fix a stuck state
- Documentation says "contact support" for a step that should be self-serve

---

## Finding Classification

| Level  | Meaning                                                                                                                         | Action                                   |
| ------ | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| **P0** | Blocks launch. Customer hits a wall, data leaks between tenants, money is wrong, or outcome is simulated but presented as real. | Must fix before any self-serve customer. |
| **P1** | Degrades trust. Works but feels broken, unreliable, inconsistent, or opaque.                                                    | Fix within first week of launch.         |
| **P2** | Polish. Improvement that doesn't block the journey.                                                                             | Backlog.                                 |

### Finding Format

```
[P0/P1/P2] J#.Step — Lens
Title: one-line description
Evidence: file:line, code snippet, or execution trace
Customer Impact: what the customer experiences (or doesn't notice but should)
Fix: what needs to change (scope: hours/days)
```

---

## Output Structure

### Per-Journey Report

Each journey produces a section with findings in step order. Every finding has traced evidence — no speculation.

### Aggregate Outputs

1. **P0 Summary Table** — all P0s across all journeys, with fix scope estimates and dependency ordering
2. **State Integrity Map** — which state layers (WorkTrace, CRM, Stripe billing, deployment config, calendar) can disagree, where reconciliation exists, and where it's missing
3. **Self-Serve Integrity Report** — every step across all journeys that currently requires founder intervention, with the specific intervention described
4. **Production Reality Report** — every path that uses mock/simulate/noop execution, with whether it's intentional degradation or accidental
5. **Go/No-Go Verdict** — can all P0s be resolved within the 1-month window? What's the critical path? What's the minimum viable launch surface if some P0s require descoping?

---

## Execution Plan

| Session | Scope                                  | Why this order                                           |
| ------- | -------------------------------------- | -------------------------------------------------------- |
| 1       | **J1: Signup → First Agent Live**      | If signup doesn't work, nothing else matters             |
| 2       | **J2: Lead → Response → Booking**      | If the revenue loop is broken, there's no product        |
| 3       | **J3: Trial → Paid → Enforcement**     | If billing is wrong, you lose money or trust             |
| 4       | **J4: Operator Monitors → Intervenes** | If the owner can't see or control, they churn            |
| 5       | **J5: Day-2 Ops**                      | If the system can't sustain itself, launch is temporary  |
| 6       | **Synthesis**                          | Aggregate outputs, state integrity map, go/no-go verdict |

**Audit Principle: No Founder Assist**

During audit execution, do not fix, patch, or manually unblock any step. If a step requires intervention to proceed, stop and log it as a P0. The audit observes the system as a customer would encounter it — not as a founder who can work around it.

**P0 Integrity Rule**

P0 cannot be negotiated down. If a finding violates self-serve integrity, production reality (J1/J2), or state integrity (money/booking/attribution), it stays P0 until the system itself fixes it. Not a founder. Not a script. Not a workaround. Downgrading a P0 requires proving the violation no longer exists in code.

**Execution rules:**

- Trace actual code paths, not documentation claims
- All findings must be backed by either (a) executed code path or (b) unreachable/broken code path proof
- Verify external integration points against real API contracts (Meta, Stripe, Google Calendar)
- Cross-reference state mutations to confirm consistency across layers
- No speculative findings, no "this might be broken" noise
