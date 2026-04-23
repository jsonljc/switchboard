# Switchboard Public Self-Serve Launch Audit Design

> Audit design for deciding whether Switchboard is ready for a broad self-serve
> public launch. Launch target: solo operators and SMB owners on a 30-day free
> trial. Core promise under test: Meta Ads to WhatsApp lead handling that runs
> mostly autonomously from first outreach through nurture, close, and appointment
> booking, with human review as an exception path.

---

## Scope Fence

This audit is not a generic code quality review and not a founder-led deployment
checklist.

It is specifically designed to answer one question:

**Can an SMB owner discover, understand, start, connect, activate, monitor, and
get value from Switchboard without the team stepping in behind the scenes?**

The audit is for:

- Broad self-serve public launch readiness
- Solo operators and SMB owners
- WhatsApp-only inbound for day one
- 30-day free trial onboarding and activation
- Mostly autonomous funnel behavior with human review as exception only

The audit is not for:

- Enterprise readiness
- Founder-led or concierge onboarding
- Non-WhatsApp launch channels
- Internal demos or manually staged success cases
- Multi-tenant or multi-org deployment scenarios
- Performance at scale, including load testing and rate-limit adequacy

These last two are important operational-readiness concerns, but they are out of
scope for this self-serve public launch audit unless they clearly invalidate the
day-one SMB launch path.

---

## Launch Readiness Definition

Switchboard is ready for full public launch only if an SMB owner can:

**Precondition:**

0. Deploy and run in a production-like environment without manual server setup,
   local-only dependencies, or founder-operated infrastructure

**Journey criteria:**

1. Understand the product and trial offer from the public site
2. Sign up and begin onboarding without confusion or hidden prerequisites
3. Self-serve the required Meta Ads and WhatsApp setup
4. Activate the funnel without internal config or manual back-office work
5. Let Switchboard manage the lead flow autonomously inside safe control
   boundaries
6. See what happened, why it happened, and what to do next
7. Recover from errors or edge cases without the team touching internals
8. See proof of value in booked appointments and funnel outcomes

If the critical path only works in a demo environment, with hidden environment
variables, internal credentials, manual database edits, or one-off founder
intervention, the product is not ready for full public self-serve launch.

If the product requires env vars, secrets, or infrastructure that only the
founding team can provision, the setup debt must be documented even if individual
features appear functional. This counts against self-serve launch readiness even
when the user-facing flow appears to work.

---

## Audit Approach

The audit uses a three-layer structure.

### 1. Journey Audit

Follow the product exactly as a real SMB owner would, from public discovery to
trial value.

Purpose:

- Reveal broken handoffs between surfaces
- Expose unclear setup expectations
- Catch hidden founder assumptions
- Judge time-to-value from a customer point of view

### 2. Subsystem Audit

Inspect the product surfaces and supporting systems that power each journey
step.

Primary subsystems:

- Public website and pricing/trial surfaces
- Authentication and onboarding
- Dashboard operator experience
- API platform and governance layer
- Chat runtime and WhatsApp path
- Meta Ads and WhatsApp integration setup
- Visibility, reporting, and proof-of-value surfaces
- Support, recovery, and operational tooling
- Security, reliability, and production readiness

Purpose:

- Find root causes behind journey failures
- Distinguish UX friction from missing platform capability
- Identify launch blockers hidden behind partially working flows

### 3. Launch-Risk Audit

Classify issues by launch impact.

Severity buckets:

- **Launch blocker:** broad self-serve public launch should not proceed with
  this present
- **Major gap:** launch may be viable only as controlled beta or founder-led
  cohort, not broad public self-serve
- **Polish:** should be cleaned up, but does not invalidate the launch promise
  by itself

---

## Critical Journey Map

These are the critical path steps for this launch. If any of these fail, the
default outcome is **not ready for full public launch**.

### Step 0: Production Environment

**Question:** Can the product be deployed and operated in a production-like
environment without founder-operated infrastructure?

**Pass condition:** Documented deployment path exists. Database migrations run
cleanly. Required secrets and env vars are documented and obtainable by an
operator (not founder-only). The product boots and serves traffic without
local-only dependencies.

If Step 0 fails, the audit may short-circuit the journey verdict, but obvious
downstream launch blockers should still be noted where visible.

### Step 1: Discovery

**Question:** Can an SMB owner understand the product value and day-one use case
quickly enough to continue?

**Pass condition:** The site clearly explains the WhatsApp + Meta Ads outcome,
who it is for, and why a user should start the trial now.

### Step 2: Pricing + Trial

**Question:** Can the user understand what the 30-day trial includes, what setup
is required, and what happens next?

**Pass condition:** Pricing and trial expectations are legible, credible, and
not dependent on direct founder explanation.

### Step 3: Signup + Onboarding

**Question:** Can the user create an account and start setup without dead ends,
hidden assumptions, or insider terminology?

**Pass condition:** A new user can register, enter onboarding, and proceed
through the setup path with clear state and no manual rescue.

### Step 4: Meta Ads + WhatsApp Connection

**Question:** Can the user complete all required integration setup without
internal help?

**Pass condition:** The full required integration path is self-serve and guided
in-product. Specifically:

- WhatsApp Business API connection does not require pasting raw credentials
  obtained outside the product
- Meta Ads account connection uses a working OAuth flow accessible from the
  dashboard (not just backend routes)
- No integration depends on env vars that only the founding team can set

### Step 5: Activation

**Question:** Can the user actually turn on the funnel without hidden
configuration or ops involvement?

**Pass condition:** The funnel can be activated from product surfaces alone, with
accurate readiness state and no founder-only switches.

### Step 6: Autonomous Operation

This step has three subchecks.

**Behavior quality**

**Question:** Does Switchboard say and do the right things well enough to
represent the core product promise?

**Pass condition:** Lead outreach, nurture, support, close, and booking behavior
are coherent enough that an SMB owner could trust the system to run the funnel.

**Control boundary**

**Question:** Does Switchboard escalate, pause, or constrain itself
appropriately instead of bluffing or overreaching?

**Pass condition:** Unsafe or uncertain situations route to human review or
visibly bounded behavior rather than silent guessing.

**External dependency readiness**

**Question:** Do all external service integrations required for autonomous
operation actually have working implementations?

**Pass condition:** No critical-path external dependency required for the
day-one promise is interface-only, stubbed, or manually substituted behind the
scenes.

### Step 7: Visibility + Trust

This step is judged through three concrete checks:

- Can the owner see what happened?
- Can the owner see why it happened?
- Can the owner see what to do next?

**Pass condition:** The product provides clear setup state, action history,
decision visibility, failure reasons, and next-step guidance without requiring
internal or founder interpretation.

### Step 8: Operator Intervention

**Question:** Can the owner pause, override, edit, or recover safely without the
team touching internals?

**Pass condition:** The user has working intervention and recovery paths that do
not rely on database edits, environment variable changes, or private admin
tooling.

### Step 9: Proof of Value

**Question:** Can the owner clearly see business outcomes, not just activity?

**Pass condition:** The trial experience exposes booked appointments and
meaningful funnel performance signals that demonstrate value inside the trial
window and are attributable enough to feel credible to the owner.

---

## Audit Rubric

Every critical journey step is scored against five questions:

1. Can they complete it?
2. Can they understand it?
3. Can they trust it?
4. Can they recover without you?
5. Can they reach this step without hidden setup, founder intervention, or
   team-only infrastructure?

Each step also gets one overall rating:

- **Pass**
- **Pass with friction**
- **Fail**

Time-to-value is a cross-cutting criterion. A flow that technically works but
requires too much patience, guesswork, or manual repetition may still be treated
as a launch blocker for SMB self-serve.

---

## Finding Tags

Every finding must be tagged with:

- **Journey step**
- **Subsystem**
- **Severity**
- **Manual rescue required:** yes/no
- **Manual setup debt:** yes/no

Definitions:

- **Manual rescue required:** the user can reach a failure state that your team
  must fix for them
- **Manual setup debt:** the user succeeds only because the team preconfigured
  hidden prerequisites or backstage setup that the product does not truly
  self-serve

These two flags must stay separate. A product can fail launch readiness because
of hidden setup debt even if no visible failure occurs during the audit.

---

## Evidence Standard

Each step in the final audit should include:

- Step rating
- Evidence
- Findings
- Manual rescue required
- Manual setup debt

Acceptable evidence sources:

- Product behavior observed in the live or local experience
- Code inspection for unreachable, stubbed, demo-only, or unsafe paths
- Configuration and environment assumptions
- Existing docs and checklists
- Test and build expectations where available
- Explicit gaps in onboarding, recovery, observability, or trust surfaces
- Code paths that are gated behind env vars, feature flags, or hardcoded
  conditions that only the founding team can satisfy
- Import/dependency analysis showing whether a feature's critical path reaches
  a real implementation or terminates at an interface/stub

Insufficient evidence:

- Demo success that depends on founder knowledge
- Happy paths that ignore setup debt
- Internal docs that promise flows the product does not yet expose
- Local-only success that cannot be reproduced in a true self-serve environment

---

## Decision Rule

### Not Ready For Full Public Launch

Any of the following is enough to fail launch readiness:

- Any critical journey step is rated **fail**
- Any required self-serve setup depends on team intervention
- Any required integration depends on internal credentials, hidden env setup,
  database edits, or founder-run back-office actions
- Any critical path only works in demo, dev, or internally staged conditions
- The autonomous funnel cannot operate safely enough within clear control
  boundaries
- Users cannot understand system state well enough to trust and recover on
  their own

### Conditionally Launchable

Use only if:

- No fatal critical-path blockers remain
- The product may be viable for a controlled beta, founder-led onboarding, or
  limited cohort
- It is not yet credible for broad public self-serve launch

This category must not be used as a euphemism for "ship it anyway."

If "Conditionally Launchable" is the verdict, the audit must specify:

- The exact conditions required (e.g., "founder creates accounts manually,"
  "team pre-configures WhatsApp credentials")
- Which journey steps those conditions bypass or artificially enable
- What the user experience looks like under those conditions versus true
  self-serve
- Whether those conditions are sustainable as a controlled launch motion or
  merely founder-dependent stopgaps

### Ready

Use only if:

- The core trial-to-value path works self-serve end to end
- No critical step depends on hidden operator help
- Trust, visibility, and recovery are strong enough for SMB owners to use the
  product without internal intervention

---

## Output Shape

The final audit should produce:

1. **Executive launch verdict:** not ready, conditionally launchable, or ready
2. **Journey step summary:** a table or grouped summary of each critical journey
   step with its rating
3. **Blocker list:** ordered by launch impact
4. **Major-gap list:** issues that would keep launch in beta/cohort mode
5. **Polish list:** for post-launch cleanup
6. **Recommended launch mode:** broad self-serve, controlled beta, founder-led
   cohort, or not launchable
7. **Strongest evidence statement:** a short statement of the strongest evidence
   behind the final verdict
8. **Manual debt map:** a table showing every point in the critical path where
   founder intervention, hidden env setup, or team-operated infrastructure is
   currently required, with columns:
   - Critical path point
   - Current manual dependency
   - What it substitutes for
   - User-visible impact
   - Journey step affected
   - Self-serve replacement needed
   - Severity
9. **Time-to-value estimate:** structured as:
   - Best-case time-to-value
   - Realistic current time-to-value
   - Where the clock stalls
   - Which stalls are caused by blockers vs. manual dependencies
   - Whether the current time-to-value is acceptable for a self-serve SMB trial

The final artifact should make it impossible to confuse subsystem progress with
customer success.

---

## Non-Goals

This audit does not attempt to:

- Produce implementation work in the same document
- Redesign the full product strategy
- Expand launch scope beyond WhatsApp + Meta Ads for day one
- Certify enterprise security, legal, or compliance readiness beyond what is
  required to judge self-serve public launch risk
- Audit the quality or effectiveness of the AI agent's conversational strategy
  beyond launch-readiness needs, including prompt tuning, tone optimization,
  persuasion quality, objection-handling sharpness, or close-rate optimization.
  The audit checks whether autonomous operation is coherent enough to represent
  the product promise and safely bounded enough not to overreach. It does not
  attempt to judge whether the agent is commercially optimized. The audit should
  still verify that the agent is coherent, on-policy, non-confusing,
  non-hallucinatory, and safe within its control boundary — it should not drift
  into grading commercial excellence.

Implementation planning happens only after this audit design is accepted and the
resulting audit is completed.
