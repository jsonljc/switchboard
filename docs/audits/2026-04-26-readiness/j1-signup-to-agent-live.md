# J1: Signup → First Agent Live — Readiness Audit

> **Audit date:** 2026-04-26
> **Auditor:** Claude
> **Spec:** docs/superpowers/specs/2026-04-26-self-serve-readiness-audit-design.md

## Findings

---

### [P2] J1.1 — Completeness

**Pricing tiers not passed to signup**

**Evidence:** `apps/dashboard/src/app/(public)/pricing/page.tsx:27,46,69` — all three tier CTAs link to `/signup` with no query parameter (e.g., `?plan=starter`). `apps/dashboard/src/app/(public)/signup/page.tsx` has no logic to read or persist a plan selection.

**Customer Impact:** Customer clicks "Get Started" on a specific pricing tier, but their plan choice is lost. They arrive at a generic signup form with no indication which plan they selected. Plan must be chosen again later (or never — no plan selection step exists in onboarding).

**Fix:** Add `?plan=` parameter to pricing CTAs and persist the selected plan through signup into the org config. (scope: hours)

---

### [P1] J1.2 — Reliability & State Integrity

**Non-atomic provisioning — password set after user creation**

**Evidence:** `apps/dashboard/src/app/api/auth/register/route.ts:48-56` — `provisionDashboardUser` runs in a transaction creating Org + Principal + IdentitySpec + DashboardUser, but the `passwordHash` is set in a separate `prisma.dashboardUser.update()` outside the transaction.

**Customer Impact:** If the password update fails after provisioning succeeds, the user has an account with no password and no way to log in. The P2002 duplicate check on line 61 catches re-registration, so the user is permanently stuck.

**Fix:** Move the `passwordHash` into the `provisionDashboardUser` transaction, or pass it as an input parameter. (scope: hours)

---

### [P1] J1.2 — Production Reality

**Email verification silently skipped when RESEND_API_KEY is unset**

**Evidence:** `apps/dashboard/src/lib/email.ts:33-36` — `getResendClient()` returns `null` when `RESEND_API_KEY` is not set, and `sendVerificationEmail` returns `{ sent: false }`. The registration endpoint returns `verificationEmailSent: false` but the client ignores this field entirely (`apps/dashboard/src/app/(public)/signup/page.tsx:42-55`).

**Customer Impact:** In any environment where `RESEND_API_KEY` is not configured, no verification email is sent. The user can never verify their email, which means the `email-verified` readiness check will permanently fail, blocking go-live (readiness check at `apps/api/src/routes/readiness.ts:270-283`). This is a silent, invisible blocker.

**Fix:** Either (a) make `RESEND_API_KEY` a hard startup requirement, or (b) auto-verify email when the email service is unavailable, or (c) show the user that verification is pending and provide a resend mechanism. (scope: hours)

---

### [P2] J1.2 — Security

**No CSRF protection on registration endpoint**

**Evidence:** `apps/dashboard/src/app/api/auth/register/route.ts` — the POST handler has no CSRF token validation. Rate limiting exists (`checkRegistrationRateLimit` at line 37) but it rate-limits by email address, not by IP or session, so an attacker can spam registrations for different email addresses.

**Customer Impact:** Low direct customer impact, but allows automated account creation abuse.

**Fix:** Add IP-based rate limiting or CSRF token validation. (scope: hours)

---

### [P2] J1.3 — Completeness

**Onboarding step 4 (Test Center) does not persist scenario count for readiness**

**Evidence:** `apps/dashboard/src/app/(auth)/onboarding/page.tsx:164-180` — test scenarios are managed in local React state (`responses`). The count is never written to `runtimeConfig.scenariosTestedCount`. The readiness check at `apps/api/src/routes/readiness.ts:188-189` reads `runtimeConfig.scenariosTestedCount` but it is never populated.

**Customer Impact:** The "test-scenarios-run" readiness check will always show 0 scenarios. This check is non-blocking (`blocking: false` at line 429), so it does not prevent go-live, but it shows as a failing check in the readiness report, degrading user confidence.

**Fix:** Persist scenario count to `runtimeConfig` when test prompts complete. (scope: hours)

---

### [P0] J1.4 — Completeness

**Webhook path mismatch — provisioned channels unreachable via managed webhook routes**

**Evidence:** `apps/api/src/routes/organizations.ts:213` generates webhook paths as `/webhooks/${ch.channel}/${uuid}` (e.g., `/webhooks/whatsapp/abc123`). However, the chat server's webhook handler at `apps/chat/src/routes/managed-webhook.ts:32,50` only serves `/webhook/managed/:webhookId`. The `RuntimeRegistry.loadAll()` method (line 77 of `runtime-registry.ts`) registers entries using `managedChannel.webhookPath`, so entries are registered at paths like `/webhooks/whatsapp/abc123` — but no HTTP route serves that path pattern.

The `loadGatewayConnections()` method uses `/webhook/managed/${conn.id}` which matches the HTTP routes, providing a parallel working path. But the ManagedChannel's `webhookPath` field (which is what the user sees and would configure in Meta's webhook settings) points to a dead path.

**Customer Impact:** When a user provisions WhatsApp via the channel management UI and configures the displayed webhook URL in Meta's developer dashboard, incoming messages will hit a 404 on the chat server. Messages are silently lost. The working path (`/webhook/managed/${deploymentConnectionId}`) is never surfaced to the user.

**Fix:** Either (a) change the provision route to generate `/webhook/managed/${id}` paths matching the HTTP handler, or (b) add a route handler for `/webhooks/:channel/:id`. (scope: hours)

---

### [P0] J1.4 — Self-Serve Integrity

**No self-serve webhook registration — user must manually configure Meta Developer Dashboard**

**Evidence:** The provision route at `apps/api/src/routes/organizations.ts:148-307` creates database records (Connection, ManagedChannel, AgentDeployment, DeploymentConnection) but never calls Meta's webhook subscription API to register the webhook URL. The `whatsappOnboardingRoutes` at `apps/api/src/routes/whatsapp-onboarding.ts:98-103` does subscribe to webhooks, but this route is **never registered** in the API server — it is absent from `apps/api/src/bootstrap/routes.ts`.

The manual channel management UI (`apps/dashboard/src/components/settings/channel-management.tsx`) collects raw API tokens and phone number IDs from the user, but provides no guidance on how to configure the webhook URL in Meta's dashboard. The user must independently navigate to Meta Business Suite, find the right app, and paste the webhook URL — a multi-step process requiring developer console access.

**Customer Impact:** After provisioning WhatsApp, the user has no working channel. They receive no messages. There is no error message explaining what to do. The user needs developer-level knowledge of Meta's webhook system to complete setup.

**Fix:** Register `whatsappOnboardingRoutes` in the route bootstrap, and integrate Embedded Signup as the primary WhatsApp setup flow. For manual setup, add clear instructions and a webhook URL copy button. (scope: days)

---

### [P0] J1.4 — Production Reality

**WhatsApp Embedded Signup backend route not registered**

**Evidence:** `apps/api/src/routes/whatsapp-onboarding.ts` defines the `/whatsapp/onboard` handler. `apps/dashboard/src/components/settings/whatsapp-embedded-signup.tsx:61` calls `/api/dashboard/connections/whatsapp-embedded` which proxies to `${API_BASE}/whatsapp/onboard` (line 10 of `apps/dashboard/src/app/api/dashboard/connections/whatsapp-embedded/route.ts`). However, `whatsappOnboardingRoutes` is not imported or registered in `apps/api/src/bootstrap/routes.ts`.

**Customer Impact:** Clicking "Connect WhatsApp" via Embedded Signup returns a 404 from the API server. The user sees "Could not complete setup. Please try again." with no actionable information. The one-click WhatsApp onboarding path is completely broken.

**Fix:** Add `import { whatsappOnboardingRoutes } from "../routes/whatsapp-onboarding.js"` and `await app.register(whatsappOnboardingRoutes)` to `apps/api/src/bootstrap/routes.ts`. Also requires environment variables (`META_SYSTEM_USER_TOKEN`, `META_SYSTEM_USER_ID`, `META_APP_SECRET`) to be set. (scope: hours)

---

### [P0] J1.4 — Self-Serve Integrity

**Provision-notify not called — chat server never learns about new channels**

**Evidence:** After the API server provisions a channel at `apps/api/src/routes/organizations.ts:148-307`, it returns success but never notifies the chat server via the `/internal/provision-notify` endpoint (`apps/chat/src/main.ts:256`). Grepping the entire `apps/api/` directory for "provision-notify" returns zero results.

The chat server loads existing channels at startup via `registry.loadAll()` (line 134 of `apps/chat/src/main.ts`), so channels provisioned before a restart will be loaded. But any channel provisioned while the chat server is running will not be registered in the in-memory `RuntimeRegistry` until the next restart.

**Customer Impact:** After connecting a channel, incoming messages are silently dropped until someone restarts the chat server. The user has no visibility into why their channel is not receiving messages. In production, this could mean hours or days of lost messages.

**Fix:** Add a provision-notify call from the API server's provision endpoint to the chat server, or implement a polling/watch mechanism. (scope: hours)

---

### [P1] J1.4 — Security

**WhatsApp adapter fails closed without appSecret — but appSecret is optional in channel setup**

**Evidence:** `apps/chat/src/adapters/whatsapp.ts:98-101` — `verifyRequest()` returns `false` when `appSecret` is not configured. The channel management UI (`apps/dashboard/src/components/settings/channel-management.tsx:335-342`) marks App Secret as "(optional)". The managed webhook route (`apps/chat/src/routes/managed-webhook.ts:65-72`) calls `verifyRequest()` and returns 401 on failure.

**Customer Impact:** If a user provisions WhatsApp without providing the App Secret (which the UI encourages by marking it optional), all incoming webhook messages will be rejected with 401. The channel appears connected but receives nothing. No error is surfaced to the user in the dashboard.

**Fix:** Either (a) make appSecret required for WhatsApp provisioning, or (b) skip webhook verification when appSecret is not configured (less secure but matches the UI promise), or (c) clearly warn users that appSecret is required for message delivery. (scope: hours)

---

### [P0] J1.5 — Self-Serve Integrity

**Readiness check "channel-connected" requires lastHealthCheck for WhatsApp, but no path sets it**

**Evidence:** `apps/api/src/routes/readiness.ts:297` — `if (mc.channel === "whatsapp" && conn.lastHealthCheck === null) return false`. The provision route at `apps/api/src/routes/organizations.ts:201` creates the Connection with no `lastHealthCheck` field (defaults to null in Prisma). The WhatsApp test route at `apps/api/src/routes/whatsapp-test.ts:85-113` only validates credentials against Meta's Graph API — it does NOT update the Connection's `lastHealthCheck` field. The only route that updates `lastHealthCheck` is `connections/:id/test` at line 301, but this uses the cartridge-based health check system, which requires a matching cartridge — none exists for WhatsApp.

**Customer Impact:** WhatsApp users can never pass the "channel-connected" readiness check, which is blocking (`blocking: true` at line 289). Go-live is permanently impossible for WhatsApp users through the normal flow.

**Fix:** Update the WhatsApp credential test flow to set `lastHealthCheck` on the Connection after a successful test, or remove the `lastHealthCheck` requirement from the readiness check for WhatsApp. (scope: hours)

---

### [P1] J1.5 — Completeness

**Readiness check "deployment-exists" requires skillSlug but provision bridge hardcodes it**

**Evidence:** `apps/api/src/routes/readiness.ts:160-168` checks `deployment.skillSlug: "alex"` specifically. The provision route at `apps/api/src/routes/organizations.ts:252` hardcodes `skillSlug: "alex"`. The readiness context builder at line 166 queries `where: { organizationId: orgId, skillSlug: "alex" }`.

**Customer Impact:** This works for the current Alex-only product, but the hardcoded "alex" slug means the system has zero support for other agents. Not a blocker today but architecturally brittle.

**Fix:** Accept skillSlug as a parameter or derive it from the listing. (scope: hours)

---

### [P1] J1.5 — Self-Serve Integrity

**Readiness check "deployment-connection" requires deploymentConnection with matching active channel type**

**Evidence:** `apps/api/src/routes/readiness.ts:331-358` — the check looks for a `deploymentConnection` with `status === "active"` whose `type` matches an active managed channel's type. The provision route at `apps/api/src/routes/organizations.ts:257-277` creates the DeploymentConnection via upsert. This should work if provision completes successfully.

However, the check cross-references managed channels with deployment connections. The managed channel stores a `connectionId` referencing the `Connection` table, while the deployment connection is a separate record linked to the `AgentDeployment`. The readiness check compares `deploymentConnection.type` (e.g., "whatsapp") against `managedChannel.channel` (also "whatsapp"), and requires the managed channel's `connection.credentials` to be non-null. This coupling means if either side is created without the other (partial provision failure), the check fails silently.

**Customer Impact:** If provision partially fails (e.g., DeploymentConnection upsert fails after ManagedChannel creation), the readiness check fails with a generic message. The user has no way to diagnose or fix the partial state.

**Fix:** Make the provision flow transactional (`$transaction`) so either all records are created or none are. (scope: hours)

---

### [P1] J1.5 — Completeness

**Seven blocking readiness checks — three require multi-step playbook completion with no progress indicator**

**Evidence:** Blocking checks (`apps/api/src/routes/readiness.ts`):

1. `email-verified` (line 270) — requires email verification (see finding above about RESEND_API_KEY)
2. `channel-connected` (line 286) — requires verified channel with lastHealthCheck (see finding above)
3. `deployment-exists` (line 313) — auto-created by provision, works
4. `deployment-connection` (line 331) — auto-created by provision, works
5. `business-identity` (line 362) — requires `playbook.businessIdentity.status === "ready"`
6. `services-defined` (line 381) — requires `playbook.services.status === "ready"` or non-empty items
7. `hours-set` (line 400) — requires `playbook.hours.status === "ready"`

Checks 5-7 require playbook sections to be marked as "ready". The onboarding wizard has steps for business identity (step 2 TrainingShell) and business facts (step 3), but the readiness check structure (`playbook.businessIdentity.status`, `playbook.services.status`, `playbook.hours.status`) requires specific nested objects with status fields. The onboarding wizard saves the playbook via `PATCH /api/playbook` which simply stores whatever the client sends.

**Customer Impact:** The mapping between what the onboarding wizard collects and what readiness checks expect is implicit and fragile. If the wizard does not set exactly the right nested structure, readiness checks fail with messages like "Business identity is incomplete" even after the user has completed onboarding.

**Fix:** Add a validation/mapping layer that translates wizard completion into readiness-compatible playbook structure, and show readiness status in the go-live step of onboarding. (scope: days)

---

### [P2] J1.5 — Ops Readiness

**Readiness endpoint returns structured data but go-live error is generic**

**Evidence:** `apps/api/src/routes/agents.ts:371-373` — when readiness fails, the response includes the full report, but the dashboard's go-live handler at `apps/dashboard/src/app/(auth)/onboarding/page.tsx:91` extracts only `data.error` (a string). The detailed `readiness.checks` array with per-check status and messages is discarded.

**Customer Impact:** User sees "Readiness checks failed" with no information about which checks failed or how to fix them. They have to guess what is missing.

**Fix:** Parse the readiness response in the GoLive component and display individual failing checks with actionable guidance. (scope: hours)

---

### [P2] J1.6 — Completeness

**Chat server uses HTTP adapter for platform ingress — adds network hop**

**Evidence:** `apps/chat/src/gateway/http-platform-ingress-adapter.ts:21` — the chat server submits work to the API server via `fetch()` to `${baseUrl}/api/ingress/submit`. This means every inbound message requires an HTTP round-trip from the chat server to the API server before the skill can execute and respond.

**Customer Impact:** Adds latency to every message response. Not a blocker, but increases P50/P99 response times by the round-trip time between services.

**Fix:** Consider in-process platform ingress for the chat server, or accept this as the intended architecture with service separation. (scope: N/A, architectural decision)

---

### [P2] J1.6 — Reliability

**Channel gateway swallows skill execution failures with a generic fallback**

**Evidence:** `packages/core/src/channel-gateway/channel-gateway.ts:113-114` — when `response.ok` is false, the gateway sends "I'm having trouble right now. Let me connect you with the team." This message promises human handoff but no escalation is created.

**Customer Impact:** When skill execution fails (LLM error, budget exceeded, etc.), the user is told someone will help them, but nobody is notified. The promise of human connection is false.

**Fix:** Create an escalation entry when skill execution fails, and notify the operator via the dashboard or push notification. (scope: hours)

---

### [P1] J1.2 — Security / Multi-tenancy

**New user gets "operator" role only — no admin or approver role for org owner**

**Evidence:** `apps/dashboard/src/lib/provision-dashboard-user.ts:41` — `roles: ["operator"]`. The comment says "admin/approver roles must be granted explicitly" but there is no self-serve mechanism to grant these roles. The org creator — who should be the admin — starts as a basic operator.

**Customer Impact:** If any admin-gated operation exists (and it will as the product matures), the org creator cannot perform it without manual role escalation by a developer. For now, this may not block the journey if no endpoints enforce admin roles, but it is a latent issue.

**Fix:** Grant `["operator", "admin", "approver"]` to the first user (org creator). (scope: hours)

---

### [P0] J1.4 — Self-Serve Integrity

**Alex listing seed data required — provision fails without it**

**Evidence:** `apps/api/src/routes/organizations.ts:229-237` — the provision route looks up `agentListing` with `slug: "alex-conversion"`. If this listing does not exist, it throws: `"Cannot provision ${ch.channel}: Alex listing (alex-conversion) not found. Run database seed first."` The error message literally tells the user to "Run database seed" — a developer action.

**Customer Impact:** On a fresh database without seed data, channel provisioning fails with a cryptic error about running a database seed. The user has no way to fix this. This is a deployment configuration requirement that must be guaranteed by the platform, not the user.

**Fix:** Either (a) auto-create the Alex listing on first provision if it does not exist, or (b) make the seed a required part of deployment/migration, enforced in CI/CD. (scope: hours)

---

## Summary

| Severity | Count | Key Blockers                                                                                                                          |
| -------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------- |
| P0       | 5     | Webhook path mismatch, no webhook registration, provision-notify missing, lastHealthCheck gap, seed data dependency                   |
| P1       | 6     | Non-atomic provisioning, silent email skip, appSecret fail-closed, operator-only role, readiness mapping, provision non-transactional |
| P2       | 5     | Pricing pass-through, CSRF, scenario count, generic errors, architecture                                                              |

**Verdict:** The J1 journey is **not self-serve completable**. A fresh user signing up today will:

1. Successfully register and enter onboarding (works)
2. Complete the onboarding wizard (works, modulo playbook/readiness mapping)
3. Attempt to connect WhatsApp and fail at go-live due to: (a) no webhook auto-registration, (b) webhook path mismatch, (c) lastHealthCheck never set, (d) provision-notify not called, (e) possible seed data absence
4. See "Readiness checks failed" with no actionable detail
5. Have no path forward without founder/developer intervention

**Status:** DONE
