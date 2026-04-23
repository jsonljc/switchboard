# Switchboard Public Self-Serve Launch Audit Design

> Audit design for deciding whether Switchboard is ready for a broad self-serve public launch.
> Launch target: solo operators and SMB owners on a 30-day free trial.
> Core promise under test: Meta Ads to WhatsApp lead handling that runs mostly autonomously from first outreach through nurture, close, and appointment booking, with human review as an exception path.

---

## Scope Fence

This audit is not a generic code quality review and not a founder-led deployment checklist.

It is specifically designed to answer one question:

**Can an SMB owner discover, understand, start, connect, activate, monitor, and get value from Switchboard without the team stepping in behind the scenes?**

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

---

## Launch Readiness Definition

Switchboard is ready for full public launch only if an SMB owner can:

1. Understand the product and trial offer from the public site
2. Sign up and begin onboarding without confusion or hidden prerequisites
3. Self-serve the required Meta Ads and WhatsApp setup
4. Activate the funnel without internal config or manual back-office work
5. Let Switchboard manage the lead flow autonomously inside safe control boundaries
6. See what happened, why it happened, and what to do next
7. Recover from errors or edge cases without the team touching internals
8. See proof of value in booked appointments and funnel outcomes

If the critical path only works in a demo environment, with hidden environment variables, internal credentials, manual database edits, or one-off founder intervention, the product is **not ready** for full public self-serve launch.

---

## Audit Approach

The audit uses a three-layer structure.

### 1. Journey Audit

Follow the product exactly as a real SMB owner would, from public discovery to trial value.

Purpose:

- Reveal broken handoffs between surfaces
- Expose unclear setup expectations
- Catch hidden founder assumptions
- Judge time-to-value from a customer point of view

### 2. Subsystem Audit

Inspect the product surfaces and supporting systems that power each journey step.

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

- `Launch blocker`: broad self-serve public launch should not proceed with this present
- `Major gap`: launch may be viable only as controlled beta or founder-led cohort, not broad public self-serve
- `Polish`: should be cleaned up, but does not invalidate the launch promise by itself

---

## Critical Journey Map

These are the critical path steps for this launch. If any of these fail, the default outcome is `not ready for full public launch`.

### 1. Discovery

Question:
Can an SMB owner understand the product value and day-one use case quickly enough to continue?

Pass condition:
The site clearly explains the WhatsApp + Meta Ads outcome, who it is for, and why a user should start the trial now.

### 2. Pricing + Trial

Question:
Can the user understand what the 30-day trial includes, what setup is required, and what happens next?

Pass condition:
Pricing and trial expectations are legible, credible, and not dependent on direct founder explanation.

### 3. Signup + Onboarding

Question:
Can the user create an account and start setup without dead ends, hidden assumptions, or insider terminology?

Pass condition:
A new user can register, enter onboarding, and proceed through the setup path with clear state and no manual rescue.

### 4. Meta Ads + WhatsApp Connection

Question:
Can the user complete all required integration setup without internal help?

Pass condition:
The full required integration path is self-serve, documented in-product, and does not require internal credentials, manual env edits, or team-operated setup.

### 5. Activation

Question:
Can the user actually turn on the funnel without hidden configuration or ops involvement?

Pass condition:
The funnel can be activated from product surfaces alone, with accurate readiness state and no founder-only switches.

### 6. Autonomous Operation

This step has two subchecks.

#### Behavior quality

Question:
Does Switchboard say and do the right things well enough to represent the core product promise?

Pass condition:
Lead outreach, nurture, support, close, and booking behavior are coherent enough that an SMB owner could trust the system to run the funnel.

#### Control boundary

Question:
Does Switchboard escalate, pause, or constrain itself appropriately instead of bluffing or overreaching?

Pass condition:
Unsafe or uncertain situations route to human review or visibly bounded behavior rather than silent guessing.

### 7. Visibility + Trust

This step is judged through three concrete checks.

- Can the owner see what happened?
- Can the owner see why it happened?
- Can the owner see what to do next?

Pass condition:
The product provides clear setup state, action history, decision visibility, failure reasons, and next-step guidance without requiring internal interpretation.

### 8. Operator Intervention

Question:
Can the owner pause, override, edit, or recover safely without the team touching internals?

Pass condition:
The user has working intervention and recovery paths that do not rely on database edits, environment variable changes, or private admin tooling.

### 9. Proof of Value

Question:
Can the owner clearly see business outcomes, not just activity?

Pass condition:
The trial experience exposes booked appointments and meaningful funnel performance signals that demonstrate value inside the trial window.

---

## Audit Rubric

Every critical journey step is scored against the same four questions:

- `Can they complete it?`
- `Can they understand it?`
- `Can they trust it?`
- `Can they recover without you?`

Each step also gets one overall rating:

- `Pass`
- `Pass with friction`
- `Fail`

`Time-to-value` is a cross-cutting criterion. A flow that technically works but requires too much patience, guesswork, or manual repetition may still be treated as a launch blocker for SMB self-serve.

---

## Finding Tags

Every finding must be tagged with:

- `Journey step`
- `Subsystem`
- `Severity`
- `Manual rescue required: yes/no`
- `Manual setup debt: yes/no`

Definitions:

- `Manual rescue required`: the user can reach a failure state that your team must fix for them
- `Manual setup debt`: the user succeeds only because the team preconfigured hidden prerequisites or backstage setup that the product does not truly self-serve

These two flags must stay separate. A product can fail launch readiness because of hidden setup debt even if no visible failure occurs during the audit.

---

## Evidence Standard

Each step in the final audit should include:

- `Step rating`
- `Evidence`
- `Findings`
- `Manual rescue required`
- `Manual setup debt`

Acceptable evidence sources:

- Product behavior observed in the live or local experience
- Code inspection for unreachable, stubbed, demo-only, or unsafe paths
- Configuration and environment assumptions
- Existing docs and checklists
- Test and build expectations where available
- Explicit gaps in onboarding, recovery, observability, or trust surfaces

Insufficient evidence:

- Demo success that depends on founder knowledge
- Happy paths that ignore setup debt
- Internal docs that promise flows the product does not yet expose
- Local-only success that cannot be reproduced in a true self-serve environment

---

## Decision Rule

### Not Ready For Full Public Launch

Any of the following is enough to fail launch readiness:

- Any critical journey step is rated `fail`
- Any required self-serve setup depends on team intervention
- Any required integration depends on internal credentials, hidden env setup, database edits, or founder-run back-office actions
- Any critical path only works in demo, dev, or internally staged conditions
- The autonomous funnel cannot operate safely enough within clear control boundaries
- Users cannot understand system state well enough to trust and recover on their own

### Conditionally Launchable

Use only if:

- No fatal critical-path blockers remain
- The product may be viable for a controlled beta, founder-led onboarding, or limited cohort
- It is not yet credible for broad public self-serve launch

This category must not be used as a euphemism for "ship it anyway."

### Ready

Use only if:

- The core trial-to-value path works self-serve end to end
- No critical step depends on hidden operator help
- Trust, visibility, and recovery are strong enough for SMB owners to use the product without internal intervention

---

## Output Shape

The final audit should produce:

1. An executive launch verdict: `not ready`, `conditionally launchable`, or `ready`
2. A table or grouped summary of each critical journey step with its rating
3. A blocker list ordered by launch impact
4. A major-gap list that would keep launch in beta/cohort mode
5. A polish list for post-launch cleanup
6. A short statement of the strongest evidence behind the final verdict

The final artifact should make it impossible to confuse subsystem progress with customer success.

---

## Non-Goals

This audit does not attempt to:

- Produce implementation work in the same document
- Redesign the full product strategy
- Expand launch scope beyond WhatsApp + Meta Ads for day one
- Certify enterprise security, legal, or compliance readiness beyond what is required to judge self-serve public launch risk

Implementation planning happens only after this audit design is accepted and the resulting audit is completed.
