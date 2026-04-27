# SP3: Activation Fix + Minimum Safety Controls — Design Spec

> **Program:** Controlled Beta Remediation (7 SPs)
> **Predecessor:** SP2 (Integration Wiring) — merged to main
> **Successor:** SP4 (Full Operator Controls)

---

## 1. Scope & Pass Condition

**Goal:** A user who has signed up (SP1) and connected integrations (SP2) can
activate the funnel and have it actually process messages, with minimum safety
controls to stop or review agent behavior.

**Pass condition:** Go-live validates that the correct deployment records exist
and are routable, the owner has an emergency halt button, and a basic
escalation inbox is visible in the dashboard. Activation is
only considered successful if a real inbound message can be routed end-to-end to
the correct deployment after go-live.

### Explicit Deferrals

- Conversation override UI (SP4)
- Rich escalation threading with full transcript (SP4)
- Per-agent pause toggle (SP4 — emergency halt covers critical case)
- Onboarding flow reordering beyond adding business facts step
- Notification delivery for escalations (SP7 — email-based)
- Demo/sample data seeding (SP5)

---

## 2. Deployment Bridge Status (SP2 Overlap)

SP2 already shipped the deployment bridge in the provisioning route
(`apps/api/src/routes/organizations.ts:229-277`). When a channel is
provisioned, the bridge:

- Looks up `alex-conversion` AgentListing by slug
- Upserts `AgentDeployment` (status `active`, skillSlug `alex`)
- Upserts `DeploymentConnection` with `tokenHash` + encrypted credentials

**What SP3 does NOT redo:** The bridge is live. SP3's go-live fix is about
making the go-live endpoint _validate_ that these records exist and are
correct, not about creating them (provisioning already does).

**What SP3 adds:** The go-live endpoint must verify the deployment path is
intact before activating. If provisioning failed to create the bridge (e.g.,
no `alex-conversion` listing exists), go-live must block with a specific error
rather than silently activating a broken funnel.

---

## 3. Go-Live Readiness Validation

### Route Semantics: What `agentId` Means

The existing routes use `agentId` as a legacy parameter name, but in the
controlled beta there is exactly one agent (Alex) per org. In practice,
`agentId` resolves to the org's Alex `AgentDeployment` — the readiness and
go-live endpoints look up the org from the authenticated session and find the
Alex deployment by `skillSlug: "alex"`. The `agentId` path parameter is
retained for API compatibility but is effectively an alias for "the primary
Alex deployment for this org."

If future SPs introduce multi-agent support, these routes will need to resolve
`agentId` to a specific deployment. For SP3, the 1:1 mapping is explicit and
sufficient.

### Current State

The go-live endpoint (`PUT /api/agents/go-live/:agentId`,
`apps/api/src/routes/agents.ts:346-404`) only checks that at least one
`ManagedChannel` exists. The dashboard shows a hardcoded "Playbook complete"
checkmark that is always green regardless of actual state.

### What Ships

#### 3.1 Server-Side Readiness Endpoint

New endpoint: `GET /api/agents/:agentId/readiness`

Returns a structured readiness report:

```typescript
interface ReadinessCheck {
  id: string;
  label: string;
  status: "pass" | "fail";
  message: string; // human-readable: what's wrong + how to fix
  blocking: boolean; // true = must pass for go-live; false = advisory
}

interface ReadinessReport {
  ready: boolean; // true only if all checks where blocking=true have status="pass"
  checks: ReadinessCheck[];
}
```

The `blocking` field is part of the response so the dashboard can render
blocking and advisory checks in separate sections without hardcoding which
check IDs are blocking.

**Blocking checks (all must pass for go-live):**

| Check ID                | What it validates                                                                                                                                                                                                                                                                                                                             | Fail message                                                                                |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `channel-connected`     | At least one `ManagedChannel` with status `active` or `pending`, backed by a `Connection` with non-null credentials. For WhatsApp channels, the connection must have `lastTestedAt` set (proving SP2 test-connection passed). Channels that were saved without a successful test do not count.                                                | "No verified channel connected. Go to onboarding to connect and test WhatsApp or Telegram." |
| `deployment-exists`     | An `AgentDeployment` exists for the org with status `active` and a valid `skillSlug`                                                                                                                                                                                                                                                          | "Deployment not created. Re-provision your channel to create it."                           |
| `deployment-connection` | At least one `DeploymentConnection` exists for the deployment AND corresponds to an active connected channel for the org (i.e., the `DeploymentConnection.type` matches a `ManagedChannel.channelType` that is connected with valid credentials). A stale `DeploymentConnection` pointing to a deleted or disconnected channel does not pass. | "Channel not linked to deployment. Re-provision your channel."                              |
| `business-identity`     | `OrganizationConfig.onboardingPlaybook` has `businessIdentity.status === "ready"` (business name + category set)                                                                                                                                                                                                                              | "Business identity incomplete. Add your business name and category in the playbook."        |
| `services-defined`      | Playbook has at least one service with name and description                                                                                                                                                                                                                                                                                   | "No services defined. Add at least one service in the playbook."                            |
| `hours-set`             | Playbook has operating hours configured                                                                                                                                                                                                                                                                                                       | "Operating hours not set. Configure your business hours in the playbook."                   |

**Advisory checks (shown but don't block):**

| Check ID                 | What it validates                                     | Advisory message                                                          |
| ------------------------ | ----------------------------------------------------- | ------------------------------------------------------------------------- |
| `test-scenarios-run`     | At least 2 test conversations completed in TestCenter | "Consider testing Alex with sample conversations before going live."      |
| `approval-mode-reviewed` | Playbook `approvalMode.status === "ready"`            | "Review your approval settings to control what Alex can do autonomously." |

#### 3.2 Go-Live Endpoint Hardening

Modify `PUT /api/agents/go-live/:agentId` to:

1. Call the readiness logic before proceeding
2. If any blocking check fails, return `400` with the full readiness report
3. If all blocking checks pass, proceed with current activation logic
4. Create an `AuditEntry` with `eventType: "agent.activated"` on success

#### 3.3 Dashboard Go-Live UI Update

Replace the hardcoded checkmarks in `go-live.tsx` with a `useQuery` call to
`GET /api/dashboard/agents/:agentId/readiness`. Render each check with its
real status and message. Disable the "Launch Alex" button until
`report.ready === true`.

Show advisory checks in a separate "Recommended" section with amber styling.

---

## 4. Business Facts Collection

### Current State

Three overlapping business data stores exist:

- **Playbook** (active): stores business identity, services, hours in
  `OrganizationConfig.onboardingPlaybook`
- **BusinessConfig** (legacy): `PrismaBusinessFactsStore` reads/writes
  `BusinessConfig.config`, but the `BusinessFacts` type is deleted from schemas
- **OrganizationConfig.runtimeConfig** (wizard): stores structured business
  data from the wizard-complete endpoint

### Design Decision: Unify on Playbook

The playbook already captures business name, category, services, hours, and
booking rules. Rather than creating a fourth business data system, SP3 extends
the existing playbook with the additional fields the skill runtime needs.

**New playbook fields (added to `PlaybookSchema`):**

```typescript
businessFacts: z.object({
  serviceArea: z.string().optional(), // "Downtown Singapore, 5km radius"
  contactPreference: z.enum(["whatsapp", "email", "phone", "in-person"]).optional(),
  escalationContact: z.string().optional(), // who handles escalations manually
  uniqueSellingPoints: z.array(z.string()).optional(),
  targetCustomer: z.string().optional(), // "busy professionals aged 25-45"
}).optional();
```

These supplement the existing `businessIdentity`, `services`, and `hours`
sections. The playbook remains the single source of truth for business context.

### What Ships

#### 4.1 Business Facts Step in Onboarding

Add a new step between TrainingShell (step 2) and TestCenter (step 3) in the
onboarding flow. The new step order becomes:

1. OnboardingEntry (URL scan / category)
2. TrainingShell (playbook: services, hours, booking rules)
3. **BusinessFacts** (service area, contact preference, escalation contact, USPs)
4. TestCenter (simulation)
5. GoLive (channels + launch)

The step is a simple form that writes to the playbook's `businessFacts` field
via the existing `PUT /api/agents/wizard-complete` path (which saves to
`OrganizationConfig`).

#### 4.2 Pre-populate from Existing Data

If onboarding step 1 scanned a website and extracted business information,
pre-populate the business facts fields from the scan results. The user can
edit or confirm.

If `OrganizationConfig.runtimeConfig` already has `targetCustomer` or
`services` from a prior wizard completion, carry those forward.

#### 4.3 Readiness Integration

The `business-identity` readiness check (section 3.1) validates that minimum
business facts are present. The new `businessFacts` fields (service area,
contact preference, USPs, target customer) are strictly advisory, not
blocking — the existing playbook identity and services checks are sufficient
for go-live. Implementation must not drift into making these extra fields
mandatory. The blocking bar is: business name, category, at least one service,
and operating hours. Everything else is "nice to have."

---

## 5. Emergency Halt

### Current State

- `POST /api/governance/emergency-halt` exists — sets profile to `"locked"`
- No resume endpoint (manual profile PUT required)
- No dashboard UI
- `"locked"` profile does not actually stop message processing — the chat
  ingress path does not check governance profile
- `AgentDeployment.status` has `"paused"` as a valid value but nothing reads it

### Design Decision: Halt via Deployment Status

The emergency halt must actually stop Alex from responding. Two enforcement
points are needed:

1. **AgentDeployment.status → `"paused"`**: The deployment bridge in the chat
   gateway already resolves via `PrismaDeploymentResolver`. If the resolved
   deployment has `status !== "active"`, the gateway should reject the message
   with a held/paused response rather than routing to the skill runtime.

2. **GovernanceProfile → `"locked"`**: Kept as defense-in-depth. If a message
   somehow bypasses the deployment status check, the governance gate in the
   orchestrator should block tool execution when profile is `"locked"`.

### What Ships

#### 5.1 Chat Gateway Deployment Status Gate

In `ChannelGateway.handleIncoming()` or `PrismaDeploymentResolver`, after
resolving the deployment, check `deployment.status`. If not `"active"`:

- **Persist the inbound message** to `ConversationState` before blocking.
  The owner must be able to see what was missed while paused.
- Do not route to skill runtime
- Log the blocked message to audit trail
- Return a hardcoded auto-reply: "This service is temporarily paused.
  Please try again later."

**Auto-reply customization is out of scope for SP3.** The beta uses a default
string. Future SPs may allow per-org customization via `OrganizationConfig`,
but no templating or i18n work ships here.

#### 5.2 Emergency Halt Endpoint Enhancement

Modify `POST /api/governance/emergency-halt`:

1. Set `GovernanceProfile` to `"locked"` (existing)
2. Set all active `AgentDeployment` records for the org to `status: "paused"`
3. Create `AuditEntry` with `eventType: "agent.emergency-halted"`, including
   `reason` from request body
4. Return `{ halted: true, deploymentsPaused: number, profile: "locked" }`

#### 5.3 Resume Endpoint

New endpoint: `POST /api/governance/resume`

1. Re-run readiness checks for the org
2. If all blocking checks pass:
   - Set `GovernanceProfile` back to `"guarded"` (safe default, not `"observe"`)
   - Set the org's primary Alex deployment (the single `AgentDeployment`
     with `skillSlug: "alex"` used by the controlled-beta funnel) back to
     `status: "active"`
   - Create `AuditEntry` with `eventType: "agent.resumed"`
   - Return `{ resumed: true, profile: "guarded" }`
3. If readiness checks fail:
   - Do NOT resume
   - Return `{ resumed: false, readiness: ReadinessReport }` with the specific
     failures
   - Dashboard shows "Cannot resume — fix these issues first"

#### 5.4 Dashboard Emergency Halt Button

Add to the owner dashboard home (`owner-today.tsx` or equivalent):

- **Active state:** Red "Emergency Stop" button, prominently placed (not buried
  in settings). Confirmation dialog: "This will immediately pause Alex and stop
  all automated responses. Are you sure?"
- **Paused state:** Amber banner: "Alex is paused. No automated responses are
  being sent." Green "Resume" button. If readiness checks fail, show the
  failing checks inline with the resume button disabled.
- State is driven by the org's `AgentDeployment.status` — fetch via
  `GET /api/governance/:orgId/status` (extend response to include deployment
  status)

#### 5.5 Governance Status Endpoint Extension

Extend `GET /api/governance/:orgId/status` response to include:

```typescript
{
  profile: "guarded" | "locked" | ...,
  posture: "normal" | "elevated" | "critical",
  deploymentStatus: "active" | "paused" | "deactivated",
  haltedAt?: string,       // ISO timestamp of last halt
  haltReason?: string,     // reason from halt request
}
```

**`deploymentStatus` refers to the primary Alex deployment** — the single
`AgentDeployment` with `skillSlug: "alex"` used by the controlled-beta funnel.
If multi-deployment support is added later, this field must become an array or
the endpoint must accept a deployment ID parameter. For SP3, one org = one
Alex deployment = one status.

---

## 6. Basic Escalation Inbox

### Current State

- API routes exist: list, detail, reply (`apps/api/src/routes/escalations.ts`)
- Dashboard hooks exist: `useEscalations`, `useEscalationDetail`,
  `useReplyToEscalation` (`apps/dashboard/src/hooks/use-escalations.ts`)
- Dashboard proxy routes exist for all three endpoints
- API client methods exist (`governance.ts:130-145`)
- **No dashboard page exists** — the plumbing is there but no UI

### What Ships

#### 6.1 Escalation List Page

New page: `apps/dashboard/src/app/(auth)/escalations/page.tsx`

Layout:

- Page title: "Escalations"
- Filter tabs: "Pending" (default) | "Resolved"
- List of escalation cards, each showing:
  - Escalation reason (from `Handoff.reason`)
  - Conversation summary (from `Handoff.conversationSummary`)
  - Timestamp (relative: "2 hours ago")
  - Priority indicator (if available from `Handoff.leadSnapshot`)
  - SLA deadline (if `slaDeadlineAt` is set, show countdown or "Overdue")
- Click a card → expand inline detail + reply form (no separate page)

#### 6.2 Escalation Detail + Reply

Inline expansion shows:

- Full conversation summary
- Lead snapshot (name, channel, qualification data if available)
- Reply form: text input + "Send Reply" button
- Reply calls `POST /api/dashboard/escalations/:id/reply`
- On success: card moves to "Resolved" tab, optimistic UI update

**Reply delivery notice (mandatory for beta):** After a successful reply, the
UI must show a visible info banner:

> "Your reply has been saved. It will be included in the conversation when
> the customer sends their next message. Direct message delivery is coming
> in a future update."

This prevents the owner from thinking the reply was sent immediately to the
customer's WhatsApp/Telegram. The notice must be inline on the reply
confirmation, not buried in a tooltip or docs page.

#### 6.3 Navigation Badge

Add "Escalations" to owner navigation (`owner-tabs.tsx` or equivalent sidebar).
Show a badge with the count of pending escalations. Badge updates on page
navigation (no WebSocket for beta — simple refetch).

#### 6.4 Escalation Reply Delivery Gap

**Acknowledged limitation:** The existing reply endpoint
(`POST /api/escalations/:id/reply`) appends the owner's message to
`ConversationState.messages` and marks the handoff as `"released"`, but does
not deliver the reply to the customer's channel. For beta:

- The reply is stored in the conversation state
- When the customer sends their next message, the conversation resumes with
  the owner's reply visible in context (the skill runtime reads full message
  history)
- SP4 will add real-time reply delivery via the channel adapter

This is acceptable for beta because: (1) the owner's reply is not lost, (2)
the conversation resumes correctly, (3) adding outbound delivery from the
dashboard is a separate concern from having an inbox.

---

## 7. Files Touched

| Action | Path                                                                       | Responsibility                                        |
| ------ | -------------------------------------------------------------------------- | ----------------------------------------------------- |
| New    | `apps/api/src/routes/readiness.ts`                                         | Readiness check endpoint                              |
| Edit   | `apps/api/src/routes/agents.ts`                                            | Go-live calls readiness, audit entry                  |
| Edit   | `apps/api/src/routes/governance.ts`                                        | Halt sets deployment paused, add resume endpoint      |
| Edit   | `apps/api/src/bootstrap/routes.ts`                                         | Register readiness + resume routes                    |
| Edit   | `packages/schemas/src/playbook.ts`                                         | Add `businessFacts` to PlaybookSchema                 |
| Edit   | `packages/core/src/platform/governance/governance-gate.ts`                 | Enforce `locked` profile blocks tool execution        |
| New    | `apps/dashboard/src/components/onboarding/business-facts-step.tsx`         | Business facts form                                   |
| Edit   | `apps/dashboard/src/app/(auth)/onboarding/page.tsx`                        | Insert business facts as step 3, shift later steps    |
| Edit   | `apps/dashboard/src/components/onboarding/go-live.tsx`                     | Real readiness checks from API                        |
| New    | `apps/dashboard/src/app/(auth)/escalations/page.tsx`                       | Escalation inbox page                                 |
| New    | `apps/dashboard/src/components/escalations/escalation-list.tsx`            | Escalation list + detail + reply                      |
| New    | `apps/dashboard/src/components/dashboard/emergency-halt-button.tsx`        | Halt/resume button component                          |
| Edit   | `apps/dashboard/src/components/dashboard/owner-today.tsx`                  | Add emergency halt button                             |
| Edit   | `apps/dashboard/src/components/layout/owner-tabs.tsx`                      | Add escalations nav item + badge                      |
| New    | `apps/dashboard/src/app/api/dashboard/agents/[agentId]/readiness/route.ts` | Dashboard proxy for readiness                         |
| New    | `apps/dashboard/src/app/api/dashboard/governance/resume/route.ts`          | Dashboard proxy for resume                            |
| Edit   | `apps/dashboard/src/hooks/use-escalations.ts`                              | Add `useEscalationCount` hook for badge               |
| Edit   | `apps/dashboard/src/lib/api-client/governance.ts`                          | Add `emergencyHalt`, `resume`, `getReadiness` methods |

---

## 8. Tests

### Readiness Validation

- Readiness endpoint returns all checks with correct status
- `channel-connected` fails when no ManagedChannel exists
- `deployment-exists` fails when no AgentDeployment for org
- `deployment-connection` fails when DeploymentConnection missing
- `business-identity` fails when playbook identity incomplete
- `services-defined` fails when no services in playbook
- `hours-set` fails when no hours configured
- All checks pass → `ready: true`
- Go-live returns 400 with readiness report when checks fail
- Go-live creates audit entry on success

### Business Facts

- Business facts step renders and saves to playbook
- Pre-populates from existing scan/wizard data when available
- Business facts are optional — go-live not blocked by missing USPs

### Emergency Halt

- `POST /api/governance/emergency-halt` sets profile to `locked` AND
  deployment status to `paused`
- Halted deployment blocks message processing in gateway (integration test)
- Auto-reply sent when message hits paused deployment
- `POST /api/governance/resume` restores `guarded` + `active` when readiness
  passes
- Resume blocked when readiness checks fail — returns failing checks
- Audit entries created for both halt and resume
- Dashboard halt button triggers confirmation → halt → shows paused state
- Dashboard resume button shows readiness failures if resume is blocked

### Escalation Inbox

- Escalation list page renders pending escalations from API
- Filter tabs switch between pending and resolved
- Inline detail shows conversation summary and lead snapshot
- Reply form posts to backend and updates list state
- Navigation badge shows pending count
- Empty state shown when no escalations exist

### Integration

- Full flow: provision channel → go-live (readiness pass) → inbound message
  routed → halt → message blocked → resume → message routed again

---

## 9. What Doesn't Ship

- No conversation override UI (SP4)
- No rich escalation threading with full transcript context (SP4)
- No per-agent pause toggle (SP4)
- No real-time escalation reply delivery to customer channel (SP4)
- No escalation notifications (email/push) to owner (SP7)
- No demo/sample data seeding (SP5)
- No changes to public site or homepage
- No billing or payment

---

## 10. Audit Steps Addressed

- **Step 5 (Activation): Fail → Pass** — readiness validation + deployment
  verification ensures activation actually works
- **Step 6 (Autonomous Operation): business facts gap closed** — playbook
  extended with business context the skill runtime needs
- **Step 8 (Operator Intervention): Pass with friction** — emergency halt
  actually stops processing, basic escalation inbox visible

### Milestone Check

After SP3, controlled beta is safely activatable and routable. A user can sign
up (SP1), connect channels (SP2), validate readiness, activate a funnel that
actually processes inbound messages through the correct deployment path, halt
operation in an emergency, and review escalations through a basic inbox.
