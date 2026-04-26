# Self-Serve Readiness Audit — Synthesis

> **Audit date:** 2026-04-26
> **Spec:** docs/superpowers/specs/2026-04-26-self-serve-readiness-audit-design.md
> **Core question:** Can a real self-serve customer get from signup to revenue without hidden founder intervention, broken trust, or unsafe behavior?

---

## Go/No-Go Verdict

### NO-GO

Switchboard is not ready for self-serve launch. **16 P0 blockers** across all 5 journeys prevent a fresh customer from completing any revenue-generating path without founder intervention. The system has strong structural foundations (governance spine, health endpoints, rate limiting, conversation persistence, audit logging) but critical wiring gaps in the last mile: channel provisioning, skill execution, billing enforcement, and operator intervention delivery.

**However: CONDITIONAL GO is achievable within 1 month.** All 16 P0s are fixable — most are wiring/registration issues, not architectural gaps. The estimated fix effort is ~15-20 engineering days. With focused execution, the system can reach launch-ready state within the timeline.

---

## P0 Summary Table

| #   | Finding                                                                             | Journey | Fix Scope | Dependencies |
| --- | ----------------------------------------------------------------------------------- | ------- | --------- | ------------ |
| 1   | Webhook path mismatch — provisioned channels unreachable                            | J1      | hours     | None         |
| 2   | No webhook auto-registration with Meta                                              | J1      | days      | #3           |
| 3   | WhatsApp Embedded Signup routes not registered in API                               | J1      | hours     | None         |
| 4   | Provision-notify never called — chat server doesn't learn about new channels        | J1      | hours     | None         |
| 5   | lastHealthCheck never set for WhatsApp — go-live permanently blocked                | J1      | hours     | None         |
| 6   | Alex listing seed data required — provision fails without it                        | J1      | hours     | None         |
| 7   | Alex skill parameter builder never registered                                       | J2      | hours     | None         |
| 8   | No contact/opportunity auto-creation for new WhatsApp leads                         | J2      | hours     | #7           |
| 9   | NoopCalendarProvider returns fake bookings / LocalCalendarProvider sends no invites | J2      | days      | None         |
| 10  | MetaCAPIDispatcher not wired to ConversionBus                                       | J2      | hours     | None         |
| 11  | No feature gating by billing plan — billing is entirely cosmetic                    | J3      | days      | None         |
| 12  | Stripe webhook blocked by auth middleware                                           | J3      | minutes   | None         |
| 13  | Raw body not available for Stripe signature verification                            | J3      | minutes   | #12          |
| 14  | No Stripe state reconciliation — permanent divergence possible                      | J3      | 1 day     | #12, #13     |
| 15  | Escalation reply never delivered to customer's channel                              | J4      | days      | None         |
| 16  | No alerting pipeline + no Sentry on chat server                                     | J5      | days      | None         |

**Total estimated fix effort: ~15-20 engineering days**

---

## Critical Path

The P0s form three independent chains that can be worked in parallel:

### Chain A: Channel Provisioning (J1) — ~3 days

```
#1 Fix webhook path → #3 Register Embedded Signup routes → #2 Wire webhook auto-registration
#4 Wire provision-notify → #5 Set lastHealthCheck → #6 Auto-create seed data
```

### Chain B: Revenue Loop (J2) — ~4 days

```
#7 Register Alex builder → #8 Auto-create contact/opportunity
#9 Fix calendar provider (require Google Calendar or add email confirmations to Local)
#10 Wire CAPI dispatcher to ConversionBus
```

### Chain C: Billing + Ops (J3 + J5) — ~5 days

```
#12 Exempt webhook from auth → #13 Install raw-body → #14 Add reconciliation cron
#11 Build billing enforcement middleware
#16 Add Sentry to chat server + alerting pipeline
```

### Chain D: Operator Intervention (J4) — ~2 days

```
#15 Wire escalation reply delivery to channel adapters
```

**All four chains are independent — parallel execution cuts wall-clock time to ~5 days.**

---

## State Integrity Map

| State Layer A          | State Layer B                     | Can Disagree?                                                                         | Reconciliation?                                                  |
| ---------------------- | --------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Stripe subscription    | OrganizationConfig billing fields | **YES** — webhook is the only sync path, and it's currently broken (J3.2, J3.3)       | **NO** — no reconciliation cron (J3.4)                           |
| Booking (DB)           | Google Calendar event             | **YES** — LocalCalendarProvider creates DB records with fake calendar IDs             | **NO** — no reconciliation path exists                           |
| Booking (DB)           | Customer notification             | **YES** — booking can be confirmed in DB but reply can fail to deliver (J2.5)         | **NO** — failed outbound replies go to DLQ but are never retried |
| ConversionRecord       | WorkTrace                         | **NO** — they capture different layers (business outcome vs execution trace)          | N/A                                                              |
| ConversionRecord       | Meta CAPI                         | **YES** — conversion records exist locally but CAPI dispatcher is unwired (J2.7)      | **NO**                                                           |
| DeploymentConnection   | ManagedChannel                    | **Partial** — can exist without matching counterpart after partial provision failure  | **NO** — provision is not transactional (J1.5)                   |
| AgentDeployment status | Governance profile                | **LOW RISK** — halt/resume updates both, but resume always hardcodes "guarded" (J4.6) | **PARTIAL** — audit log captures transitions                     |
| Escalation reply (DB)  | Channel delivery                  | **YES** — reply stored in DB, never sent to channel (J4.3)                            | **NO**                                                           |

**Key insight:** The most dangerous state divergences are Stripe↔app (money), booking↔calendar (customer experience), and escalation↔channel (trust). All three lack reconciliation.

---

## Self-Serve Integrity Report

Every step that currently requires founder intervention:

| Journey.Step | What Requires Intervention                                                     | Type                      |
| ------------ | ------------------------------------------------------------------------------ | ------------------------- |
| J1.4         | WhatsApp webhook URL must be manually configured in Meta Developer Console     | Manual setup              |
| J1.4         | WhatsApp Embedded Signup backend routes not registered                         | Missing code registration |
| J1.4         | Chat server doesn't learn about new channels without restart                   | Missing notification      |
| J1.5         | Alex listing seed data must exist in DB — error says "Run database seed first" | DB seed required          |
| J1.5         | WhatsApp lastHealthCheck never set — go-live permanently blocked               | Unreachable code path     |
| J2.3         | Alex builder not registered — skill runs without business context              | Missing code registration |
| J2.4         | Google Calendar credentials require server env vars (service account)          | Env var / founder setup   |
| J3.9         | Stripe Price IDs require manual env var configuration                          | Env var / founder setup   |
| J4.X         | Escalation notification channels configured via global env vars, not per-org   | Env var / founder setup   |
| J4.X         | Escalation approvers are global — all orgs share the same recipients           | Env var / single-tenant   |
| J5.6         | Nginx TLS config has literal DOMAIN placeholder                                | Manual replacement        |

**Pattern:** The majority of self-serve failures are either (a) missing code registrations that should have been wired during development, or (b) server-level env vars that should be per-org dashboard settings.

---

## Production Reality Report

Every path that uses mock/simulate/noop execution:

| Path                | Mock/Noop Used                                                                                   | Intentional?                        | Impact                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------- | ----------------------------------------------------------- |
| Calendar booking    | `NoopCalendarProvider` returns fake bookings with `noop-*` IDs and `pending_confirmation` status | YES — intended fallback             | **HIGH** — default provider, produces phantom bookings      |
| Calendar booking    | `LocalCalendarProvider` creates `local-*` IDs with no calendar invite                            | PARTIAL — functional but incomplete | **HIGH** — booking exists in DB but customer gets no invite |
| Reconciliation cron | Stub returns `overallStatus: "healthy"` unconditionally                                          | YES — explicitly stubbed            | **MEDIUM** — hides data integrity issues                    |
| CRM provider        | Returns hardcoded zeros for funnel data                                                          | YES — explicitly stubbed            | **LOW** — ad optimizer audits produce empty results         |
| Insights provider   | Returns hardcoded defaults for campaign learning data                                            | YES — explicitly stubbed            | **LOW** — ad optimizer audits produce empty results         |
| Alex skill builder  | Not registered — template variables resolve to empty strings                                     | **NO — accidental**                 | **CRITICAL** — skill is "lobotomized"                       |
| CAPI dispatcher     | Implemented but never instantiated/subscribed                                                    | **NO — accidental**                 | **HIGH** — zero ad attribution                              |

**Key insight:** The most dangerous Production Reality failures are accidental (builder not registered, CAPI not wired) rather than intentional stubs. The intentional stubs (Noop calendar, stub CRM) are at least documented with comments.

---

## P1 Summary (27 findings — fix within first week)

### J1 (6 P1s)

- Non-atomic user provisioning (password set outside transaction)
- Email verification silently skipped when RESEND_API_KEY unset
- WhatsApp appSecret fail-closed but UI marks it "(optional)"
- Org creator gets "operator" role only, not admin
- Readiness check mapping fragile between wizard and readiness structure
- Provision flow not transactional (partial failure leaves inconsistent state)

### J2 (5 P1s)

- Calendar provider is global singleton — all orgs share one calendar
- Google Calendar requires founder-provisioned service account
- Booking confirmation has no delivery guarantee after DB commit
- WorkTrace persistence is fire-and-forget
- ConversionRecord lacks indexed booking linkage

### J3 (5 P1s)

- API response shape mismatches dashboard client type
- cancelAtPeriodEnd not persisted (no DB column)
- Cancellation has no side effects (agents/channels stay active)
- Webhook handler has no idempotency protection
- Stripe Price IDs require manual env var setup

### J4 (8 P1s)

- Race condition between override toggle and in-flight response
- No mechanism to send messages during override
- AgentNotifier permanently null (ProactiveSender is dead code)
- Email escalation silently swallows failures
- SLA Monitor never instantiated (SLA deadlines decorative)
- Governance endpoints use weaker auth pattern
- Escalation notification channels are global env vars, not per-org
- Escalation approvers are global, not per-org

### J5 (8 P1s)

- Meta token refresh has no operator notification on failure
- Inngest crons have no execution visibility/heartbeat
- Chat health endpoint creates new Redis connections per call
- Chat health endpoint has no timeout on checks
- No Pino log redaction for secrets
- Redis client has no error handler
- No zero-downtime deployment strategy
- Nginx TLS config has placeholder domain

---

## P2 Backlog (23 findings)

J1: pricing tier passthrough, CSRF, scenario count persistence, generic readiness errors, HTTP ingress latency
J2: media messages arrive blank, dedup optional, error fallback creates no escalation, ROI correctly scoped
J3: no billing logging/metrics, webhook auth overlap
J4: message type visibility, conversation search, tool call visibility, data freshness indicator, halt in-flight edge, resume hardcodes profile, campaign pause uses dead cartridge interface
J5: stubbed reconciliation, stubbed CRM/insights, local-only backups, no backup verification, auth rate limit in-memory

---

## Minimum Viable Launch Surface

If some P0s need descoping, the narrowest viable launch is:

1. **Fix Chain A** (channel provisioning) — without this, no channel works
2. **Fix #7 + #8** (Alex builder + auto-create contact) — without this, no conversations work
3. **Fix #12 + #13** (Stripe webhook) — without this, billing is broken
4. **Accept LocalCalendarProvider** as interim (no Google Calendar, DB-only bookings with manual follow-up)
5. **Defer #11** (feature gating) — launch as "everyone gets full access during beta"
6. **Defer #16** (alerting) — monitor manually via Sentry + health endpoints

This gives you: signup → channel connect → agent responds → booking (DB-only) → billing records state. Missing: real calendar invites, CAPI, feature gating, alerting. Enough for a controlled launch with 5-10 trusted early customers.

---

## Final Assessment

| Dimension                     | Rating | Summary                                                                                   |
| ----------------------------- | ------ | ----------------------------------------------------------------------------------------- |
| Code Completeness             | 6/10   | Core plumbing exists but critical wiring is missing (builder, CAPI, provision-notify)     |
| Production Reality            | 4/10   | Multiple fake/noop execution paths active by default                                      |
| Security / Multi-tenancy      | 7/10   | Org scoping is generally correct, but calendar is global and escalation is single-tenant  |
| Reliability & State Integrity | 5/10   | Multiple state layers can diverge with no reconciliation                                  |
| Ops Readiness                 | 6/10   | Health endpoints, logging, rate limiting exist; alerting and Sentry coverage incomplete   |
| Self-Serve Integrity          | 3/10   | Multiple steps require founder intervention, manual env vars, or developer console access |

**Bottom line:** Switchboard has strong architecture and solid governance foundations. The gap is not design — it's the last mile of wiring. The system was built as a founder-operated platform and needs targeted work to become truly self-serve. The 16 P0s are achievable within 1 month with focused execution.
