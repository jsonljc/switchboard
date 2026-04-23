# Switchboard Public Launch Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute the approved public self-serve launch audit and produce a defensible verdict on whether Switchboard is ready for broad SMB launch without hidden founder intervention.

**Architecture:** This plan uses one durable audit artifact in `docs/audits/` and fills it in step-by-step. The work starts with baseline release and setup evidence, then audits the critical customer journey from public discovery through proof of value, and finally synthesizes the evidence into a verdict, launch mode recommendation, and blocker list.

**Tech Stack:** Markdown docs, pnpm workspaces, Turbo, Next.js 15, Fastify, Prisma, Vitest, TypeScript

---

## File Map

- Create: `docs/audits/2026-04-23-switchboard-public-launch-audit.md`
- Modify: `docs/audits/2026-04-23-switchboard-public-launch-audit.md`
- Reference: `docs/superpowers/specs/2026-04-23-switchboard-launch-audit-design.md`
- Reference: `README.md`
- Reference: `package.json`
- Reference: `.env.example`
- Reference: `docs/DEPLOYMENT-CHECKLIST.md`
- Reference: `docs/health/security-backlog.md`
- Reference: `docs/health/dashboard-launch-cleanup.md`
- Reference: `apps/dashboard/src/app/(public)/page.tsx`
- Reference: `apps/dashboard/src/app/(public)/agents/page.tsx`
- Reference: `apps/dashboard/src/app/(public)/agents/[slug]/page.tsx`
- Reference: `apps/dashboard/src/app/(public)/pricing/page.tsx`
- Reference: `apps/dashboard/src/app/(public)/get-started/page.tsx`
- Reference: `apps/dashboard/src/app/login/page.tsx`
- Reference: `apps/dashboard/src/app/(auth)/onboarding/page.tsx`
- Reference: `apps/dashboard/src/app/(auth)/dashboard/page.tsx`
- Reference: `apps/dashboard/src/app/(auth)/dashboard/roi/page.tsx`
- Reference: `apps/dashboard/src/app/(auth)/decide/page.tsx`
- Reference: `apps/dashboard/src/app/(auth)/my-agent/[id]/page.tsx`
- Reference: `apps/dashboard/src/app/(auth)/settings/channels/page.tsx`
- Reference: `apps/dashboard/src/app/(auth)/settings/knowledge/page.tsx`
- Reference: `apps/dashboard/src/components/onboarding/channel-connect-card.tsx`
- Reference: `apps/dashboard/src/components/onboarding/go-live.tsx`
- Reference: `apps/dashboard/src/components/onboarding/test-center.tsx`
- Reference: `apps/dashboard/src/components/settings/channel-management.tsx`
- Reference: `apps/dashboard/src/components/dashboard/owner-today.tsx`
- Reference: `apps/dashboard/src/components/agents/event-history.tsx`
- Reference: `apps/dashboard/src/components/agents/dlq-viewer.tsx`
- Reference: `apps/dashboard/src/app/api/dashboard/connections/route.ts`
- Reference: `apps/dashboard/src/app/api/dashboard/conversations/route.ts`
- Reference: `apps/dashboard/src/app/api/dashboard/overview/route.ts`
- Reference: `apps/dashboard/src/app/api/dashboard/roi/route.ts`
- Reference: `apps/dashboard/src/app/api/dashboard/website-scan/route.ts`
- Reference: `apps/api/src/routes/connections.ts`
- Reference: `apps/api/src/routes/facebook-oauth.ts`
- Reference: `apps/api/src/routes/marketplace.ts`
- Reference: `apps/api/src/routes/approvals.ts`
- Reference: `apps/api/src/routes/audit.ts`
- Reference: `apps/api/src/routes/health.ts`
- Reference: `apps/api/src/routes/webhooks.ts`
- Reference: `apps/api/src/services/workflows/meta-lead-greeting-workflow.ts`
- Reference: `apps/api/src/services/workflows/meta-lead-intake-workflow.ts`
- Reference: `apps/api/src/services/workflows/meta-lead-record-inquiry-workflow.ts`
- Reference: `apps/chat/src/adapters/whatsapp.ts`
- Reference: `apps/chat/src/routes/managed-webhook.ts`
- Reference: `apps/chat/src/gateway/http-platform-ingress-adapter.ts`
- Reference: `packages/ad-optimizer/src/meta-ads-client.ts`
- Reference: `packages/ad-optimizer/src/meta-leads-ingester.ts`
- Reference: `packages/core/src/platform/work-trace.ts`
- Reference: `packages/core/src/platform/work-trace-recorder.ts`
- Reference: `packages/core/src/approval/lifecycle-service.ts`
- Reference: `packages/core/src/audit/evidence.ts`
- Reference: `packages/core/src/skill-runtime/governance.ts`
- Reference: `packages/core/src/calendar/google-calendar-adapter.ts`
- Reference: `packages/core/src/attribution/reconciliation-runner.ts`
- Reference: `packages/db/src/stores/prisma-booking-store.ts`
- Reference: `packages/db/src/stores/prisma-work-trace-store.ts`

---

## Task 1: Create The Audit Artifact

**Files:**

- Create: `docs/audits/2026-04-23-switchboard-public-launch-audit.md`
- Modify: `docs/audits/2026-04-23-switchboard-public-launch-audit.md`
- Reference: `docs/superpowers/specs/2026-04-23-switchboard-launch-audit-design.md`

- [ ] **Step 1: Create the audit document with the final output structure**

```markdown
# Switchboard Public Launch Audit (2026-04-23)

## Executive Verdict

- Verdict: `not ready` | `conditionally launchable` | `ready`
- Recommended launch mode: `broad self-serve` | `controlled beta` | `founder-led cohort` | `not launchable`
- Strongest evidence:
  - Pending evidence from audit execution.
  - Pending evidence from audit execution.
  - Pending evidence from audit execution.

## Critical Journey Summary

| Journey Step | Rating | Key Risk | Manual Rescue | Manual Setup Debt |
| --- | --- | --- | --- | --- |
| Discovery | Pending | Pending evidence | Pending | Pending |
| Pricing + Trial | Pending | Pending evidence | Pending | Pending |
| Signup + Onboarding | Pending | Pending evidence | Pending | Pending |
| Meta Ads + WhatsApp Connection | Pending | Pending evidence | Pending | Pending |
| Activation | Pending | Pending evidence | Pending | Pending |
| Autonomous Operation: Behavior Quality | Pending | Pending evidence | Pending | Pending |
| Autonomous Operation: Control Boundary | Pending | Pending evidence | Pending | Pending |
| Visibility + Trust | Pending | Pending evidence | Pending | Pending |
| Operator Intervention | Pending | Pending evidence | Pending | Pending |
| Proof of Value | Pending | Pending evidence | Pending | Pending |

## Launch Blockers

## Major Gaps

## Polish

## Baseline Evidence

## Detailed Journey Audit

### Discovery

- Rating: Pending evidence.
- Can they complete it? Pending evidence.
- Can they understand it? Pending evidence.
- Can they trust it? Pending evidence.
- Can they recover without you? Pending evidence.
- Evidence:
  - Pending evidence.
- Findings:
  - Pending finding after evidence review.

### Pricing + Trial

- Rating: Pending evidence.
- Can they complete it? Pending evidence.
- Can they understand it? Pending evidence.
- Can they trust it? Pending evidence.
- Can they recover without you? Pending evidence.
- Evidence:
  - Pending evidence.
- Findings:
  - Pending finding after evidence review.

### Signup + Onboarding

- Rating: Pending evidence.
- Can they complete it? Pending evidence.
- Can they understand it? Pending evidence.
- Can they trust it? Pending evidence.
- Can they recover without you? Pending evidence.
- Evidence:
  - Pending evidence.
- Findings:
  - Pending finding after evidence review.

### Meta Ads + WhatsApp Connection

- Rating: Pending evidence.
- Can they complete it? Pending evidence.
- Can they understand it? Pending evidence.
- Can they trust it? Pending evidence.
- Can they recover without you? Pending evidence.
- Evidence:
  - Pending evidence.
- Findings:
  - Pending finding after evidence review.

### Activation

- Rating: Pending evidence.
- Can they complete it? Pending evidence.
- Can they understand it? Pending evidence.
- Can they trust it? Pending evidence.
- Can they recover without you? Pending evidence.
- Evidence:
  - Pending evidence.
- Findings:
  - Pending finding after evidence review.

### Autonomous Operation: Behavior Quality

- Rating: Pending evidence.
- Can they complete it? Pending evidence.
- Can they understand it? Pending evidence.
- Can they trust it? Pending evidence.
- Can they recover without you? Pending evidence.
- Evidence:
  - Pending evidence.
- Findings:
  - Pending finding after evidence review.

### Autonomous Operation: Control Boundary

- Rating: Pending evidence.
- Can they complete it? Pending evidence.
- Can they understand it? Pending evidence.
- Can they trust it? Pending evidence.
- Can they recover without you? Pending evidence.
- Evidence:
  - Pending evidence.
- Findings:
  - Pending finding after evidence review.

### Visibility + Trust

- Rating: Pending evidence.
- Can they complete it? Pending evidence.
- Can they understand it? Pending evidence.
- Can they trust it? Pending evidence.
- Can they recover without you? Pending evidence.
- Evidence:
  - Pending evidence.
- Findings:
  - Pending finding after evidence review.

### Operator Intervention

- Rating: Pending evidence.
- Can they complete it? Pending evidence.
- Can they understand it? Pending evidence.
- Can they trust it? Pending evidence.
- Can they recover without you? Pending evidence.
- Evidence:
  - Pending evidence.
- Findings:
  - Pending finding after evidence review.

### Proof of Value

- Rating: Pending evidence.
- Can they complete it? Pending evidence.
- Can they understand it? Pending evidence.
- Can they trust it? Pending evidence.
- Can they recover without you? Pending evidence.
- Evidence:
  - Pending evidence.
- Findings:
  - Pending finding after evidence review.
```

- [ ] **Step 2: Verify the scaffold exists and matches the design**

Run:

```bash
sed -n '1,240p' docs/audits/2026-04-23-switchboard-public-launch-audit.md
sed -n '1,220p' docs/superpowers/specs/2026-04-23-switchboard-launch-audit-design.md
```

Expected:

- The audit document contains the executive verdict, journey summary, blocker buckets, baseline evidence, and one section per critical journey step
- The step names match the approved audit design exactly

- [ ] **Step 3: Commit the scaffold**

```bash
git add docs/audits/2026-04-23-switchboard-public-launch-audit.md
git commit -m "docs: scaffold public launch audit"
```

---

## Task 2: Record Baseline Release Evidence And Manual Setup Debt

**Files:**

- Modify: `docs/audits/2026-04-23-switchboard-public-launch-audit.md`
- Reference: `README.md`
- Reference: `package.json`
- Reference: `.env.example`
- Reference: `docs/DEPLOYMENT-CHECKLIST.md`
- Reference: `docs/health/security-backlog.md`
- Reference: `docs/health/dashboard-launch-cleanup.md`

- [ ] **Step 1: Add a baseline evidence table to the audit doc**

```markdown
## Baseline Evidence

| Check | Command / Source | Result | Notes |
| --- | --- | --- | --- |
| Dashboard release gate | `pnpm dashboard:release-check` | Pending | Pending evidence |
| Workspace preflight | `pnpm preflight` | Pending | Pending evidence |
| API health test | `pnpm --filter @switchboard/api test -- src/__tests__/api-health.test.ts` | Pending | Pending evidence |
| Manual setup debt scan | `rg -n "env|secret|generate|configure|webhook|oauth|manual|internal|restart"` over launch docs | Pending | Pending evidence |
```

- [ ] **Step 2: Run the baseline verification commands and capture exact results**

Run:

```bash
pnpm dashboard:release-check
pnpm preflight
pnpm --filter @switchboard/api test -- src/__tests__/api-health.test.ts
```

Expected:

- Each command either exits `0` or returns concrete failures that can be pasted into the audit as evidence
- Do not fix failures in this pass; record them as launch evidence

- [ ] **Step 3: Scan the docs and env surface for manual setup debt**

Run:

```bash
rg -n "env|secret|generate|configure|webhook|oauth|manual|internal|restart" README.md .env.example docs/DEPLOYMENT-CHECKLIST.md docs/health/security-backlog.md docs/health/dashboard-launch-cleanup.md
```

Expected:

- The scan surfaces every place where launch success depends on hidden secrets, restart choreography, manual webhook registration, or internal setup
- Each finding is copied into `Baseline Evidence` and tagged as manual setup debt where appropriate

- [ ] **Step 4: Update the audit doc with blocker candidates from the baseline pass**

```markdown
## Launch Blockers

- [ ] Baseline blocker candidate:
  - Journey step: Copy the exact step name from the failing audit section.
  - Subsystem: Copy the concrete surface that failed, such as `Public website` or `API connections`.
  - Severity: `Launch blocker`
  - Manual rescue required: `yes/no`
  - Manual setup debt: `yes/no`
  - Evidence: Paste the specific command output, file observation, or journey failure.
```

- [ ] **Step 5: Commit the baseline evidence**

```bash
git add docs/audits/2026-04-23-switchboard-public-launch-audit.md
git commit -m "docs: record launch audit baseline evidence"
```

---

## Task 3: Audit Discovery, Pricing, Signup, And Onboarding

**Files:**

- Modify: `docs/audits/2026-04-23-switchboard-public-launch-audit.md`
- Reference: `apps/dashboard/src/app/(public)/page.tsx`
- Reference: `apps/dashboard/src/app/(public)/agents/page.tsx`
- Reference: `apps/dashboard/src/app/(public)/agents/[slug]/page.tsx`
- Reference: `apps/dashboard/src/app/(public)/pricing/page.tsx`
- Reference: `apps/dashboard/src/app/(public)/get-started/page.tsx`
- Reference: `apps/dashboard/src/app/login/page.tsx`
- Reference: `apps/dashboard/src/app/(auth)/onboarding/page.tsx`
- Reference: `apps/dashboard/src/app/__tests__/onboarding-page.test.tsx`
- Reference: `apps/dashboard/src/components/onboarding/onboarding-entry.tsx`
- Reference: `apps/dashboard/src/components/onboarding/go-live.tsx`
- Reference: `apps/dashboard/src/components/onboarding/test-center.tsx`
- Reference: `apps/dashboard/src/components/onboarding/__tests__/onboarding-entry.test.tsx`
- Reference: `apps/dashboard/src/components/onboarding/__tests__/go-live.test.tsx`
- Reference: `apps/dashboard/src/components/onboarding/__tests__/test-center.test.tsx`

- [ ] **Step 1: Inspect the public and onboarding surfaces against the approved questions**

Run:

```bash
sed -n '1,220p' apps/dashboard/src/app/\(public\)/page.tsx
sed -n '1,220p' apps/dashboard/src/app/\(public\)/pricing/page.tsx
sed -n '1,220p' apps/dashboard/src/app/\(public\)/get-started/page.tsx
sed -n '1,220p' apps/dashboard/src/app/login/page.tsx
sed -n '1,260p' apps/dashboard/src/app/\(auth\)/onboarding/page.tsx
```

Expected:

- You can answer whether the product promise, trial, and onboarding path are legible without founder narration
- Any dead ends, mismatched CTA flow, or missing trial explanation are captured as evidence

- [ ] **Step 2: Run the onboarding-focused dashboard tests**

Run:

```bash
pnpm --filter @switchboard/dashboard test -- src/app/__tests__/onboarding-page.test.tsx
pnpm --filter @switchboard/dashboard test -- src/components/onboarding/__tests__/onboarding-entry.test.tsx src/components/onboarding/__tests__/go-live.test.tsx src/components/onboarding/__tests__/test-center.test.tsx
```

Expected:

- Passing tests increase confidence in the rendered onboarding path
- Failing tests are copied into the relevant journey-step evidence instead of being silently ignored

- [ ] **Step 3: Fill in the Discovery, Pricing + Trial, and Signup + Onboarding sections**

```markdown
### Discovery

- Rating: `pass|pass with friction|fail`
- Can they complete it? Answer in one sentence.
- Can they understand it? Answer in one sentence.
- Can they trust it? Answer in one sentence.
- Can they recover without you? Answer in one sentence.
- Evidence:
  - Paste the strongest concrete evidence from this task.
- Findings:
  - Journey step: `Discovery`
  - Subsystem: `Public website`
  - Severity:
  - Manual rescue required:
  - Manual setup debt:
```

Repeat the same structure for `Pricing + Trial` and `Signup + Onboarding`.

- [ ] **Step 4: Commit the public journey findings**

```bash
git add docs/audits/2026-04-23-switchboard-public-launch-audit.md
git commit -m "docs: audit discovery and onboarding journey"
```

---

## Task 4: Audit Meta Ads + WhatsApp Connection And Activation

**Files:**

- Modify: `docs/audits/2026-04-23-switchboard-public-launch-audit.md`
- Reference: `apps/dashboard/src/app/(auth)/settings/channels/page.tsx`
- Reference: `apps/dashboard/src/components/settings/channel-management.tsx`
- Reference: `apps/dashboard/src/components/onboarding/channel-connect-card.tsx`
- Reference: `apps/dashboard/src/app/api/dashboard/connections/route.ts`
- Reference: `apps/api/src/routes/connections.ts`
- Reference: `apps/api/src/routes/facebook-oauth.ts`
- Reference: `apps/api/src/routes/marketplace.ts`
- Reference: `apps/api/src/routes/webhooks.ts`
- Reference: `apps/api/src/services/workflows/meta-lead-intake-workflow.ts`
- Reference: `apps/chat/src/adapters/whatsapp.ts`
- Reference: `apps/chat/src/routes/managed-webhook.ts`
- Reference: `apps/chat/src/cli/register-webhook.ts`
- Reference: `packages/ad-optimizer/src/meta-ads-client.ts`
- Reference: `packages/ad-optimizer/src/meta-leads-ingester.ts`
- Reference: `packages/db/src/stores/prisma-deployment-connection-store.ts`
- Reference: `packages/db/src/stores/prisma-deployment-store.ts`
- Reference: `apps/api/src/__tests__/api-connections.test.ts`
- Reference: `apps/api/src/__tests__/api-webhooks.test.ts`
- Reference: `apps/api/src/services/workflows/__tests__/meta-lead-intake-workflow.test.ts`
- Reference: `apps/chat/src/__tests__/whatsapp-wiring.test.ts`
- Reference: `apps/chat/src/__tests__/whatsapp.test.ts`
- Reference: `apps/chat/src/__tests__/whatsapp-compliance.test.ts`

- [ ] **Step 1: Inspect whether the integration path is truly self-serve**

Run:

```bash
sed -n '1,260p' apps/dashboard/src/app/\(auth\)/settings/channels/page.tsx
sed -n '1,260p' apps/dashboard/src/components/settings/channel-management.tsx
sed -n '1,260p' apps/dashboard/src/components/onboarding/channel-connect-card.tsx
sed -n '1,260p' apps/api/src/routes/connections.ts
sed -n '1,260p' apps/api/src/routes/facebook-oauth.ts
sed -n '1,320p' apps/api/src/routes/webhooks.ts
sed -n '1,260p' apps/chat/src/routes/managed-webhook.ts
```

Expected:

- You can trace the customer-visible connect flow from dashboard to API to chat runtime
- Any step that still expects internal secrets, manual webhook registration, or private operator action is marked as manual setup debt

- [ ] **Step 2: Run the integration and wiring tests**

Run:

```bash
pnpm --filter @switchboard/api test -- src/__tests__/api-connections.test.ts src/__tests__/api-webhooks.test.ts src/services/workflows/__tests__/meta-lead-intake-workflow.test.ts
pnpm --filter @switchboard/chat test -- src/__tests__/whatsapp-wiring.test.ts src/__tests__/whatsapp.test.ts src/__tests__/whatsapp-compliance.test.ts
```

Expected:

- Test output confirms whether Meta-lead intake and WhatsApp wiring are actually protected by the current contract
- Any failing suite becomes first-class evidence for `Meta Ads + WhatsApp Connection` or `Activation`

- [ ] **Step 3: Fill in the Meta Ads + WhatsApp Connection and Activation sections**

```markdown
### Meta Ads + WhatsApp Connection

- Rating: `pass|pass with friction|fail`
- Can they complete it? Answer in one sentence.
- Can they understand it? Answer in one sentence.
- Can they trust it? Answer in one sentence.
- Can they recover without you? Answer in one sentence.
- Evidence:
  - Paste the strongest concrete evidence from this task.
- Findings:
  - Journey step: `Meta Ads + WhatsApp Connection`
  - Subsystem: `Dashboard setup` | `API connections` | `Chat runtime`
  - Severity:
  - Manual rescue required:
  - Manual setup debt:

### Activation

- Rating: `pass|pass with friction|fail`
- Can they complete it? Answer in one sentence.
- Can they understand it? Answer in one sentence.
- Can they trust it? Answer in one sentence.
- Can they recover without you? Answer in one sentence.
- Evidence:
  - Paste the strongest concrete evidence from this task.
- Findings:
  - Journey step: `Activation`
  - Subsystem:
  - Severity:
  - Manual rescue required:
  - Manual setup debt:
```

- [ ] **Step 4: Commit the connection and activation findings**

```bash
git add docs/audits/2026-04-23-switchboard-public-launch-audit.md
git commit -m "docs: audit connection and activation path"
```

---

## Task 5: Audit Autonomous Operation, Visibility, And Intervention

**Files:**

- Modify: `docs/audits/2026-04-23-switchboard-public-launch-audit.md`
- Reference: `apps/dashboard/src/app/(auth)/dashboard/page.tsx`
- Reference: `apps/dashboard/src/app/(auth)/decide/page.tsx`
- Reference: `apps/dashboard/src/app/(auth)/my-agent/[id]/page.tsx`
- Reference: `apps/dashboard/src/components/dashboard/owner-today.tsx`
- Reference: `apps/dashboard/src/components/agents/event-history.tsx`
- Reference: `apps/dashboard/src/components/agents/dlq-viewer.tsx`
- Reference: `apps/dashboard/src/app/api/dashboard/conversations/route.ts`
- Reference: `apps/dashboard/src/app/api/dashboard/overview/route.ts`
- Reference: `apps/api/src/routes/approvals.ts`
- Reference: `apps/api/src/routes/audit.ts`
- Reference: `apps/api/src/routes/marketplace.ts`
- Reference: `apps/api/src/services/workflows/meta-lead-greeting-workflow.ts`
- Reference: `apps/api/src/services/workflows/meta-lead-record-inquiry-workflow.ts`
- Reference: `packages/core/src/approval/lifecycle-service.ts`
- Reference: `packages/core/src/audit/evidence.ts`
- Reference: `packages/core/src/platform/work-trace.ts`
- Reference: `packages/core/src/platform/work-trace-recorder.ts`
- Reference: `packages/core/src/skill-runtime/governance.ts`
- Reference: `packages/db/src/stores/prisma-work-trace-store.ts`
- Reference: `apps/api/src/__tests__/api-approvals.test.ts`
- Reference: `apps/api/src/__tests__/api-audit.test.ts`
- Reference: `packages/core/src/__tests__/approval.test.ts`
- Reference: `packages/core/src/__tests__/decision-trace.test.ts`
- Reference: `packages/core/src/__tests__/audit-remediation.test.ts`

- [ ] **Step 1: Inspect the owner-facing trust and intervention surfaces**

Run:

```bash
sed -n '1,260p' apps/dashboard/src/app/\(auth\)/dashboard/page.tsx
sed -n '1,260p' apps/dashboard/src/app/\(auth\)/decide/page.tsx
sed -n '1,260p' apps/dashboard/src/app/\(auth\)/my-agent/\[id\]/page.tsx
sed -n '1,260p' apps/dashboard/src/components/dashboard/owner-today.tsx
sed -n '1,260p' apps/dashboard/src/components/agents/event-history.tsx
sed -n '1,260p' apps/dashboard/src/components/agents/dlq-viewer.tsx
```

Expected:

- You can tell whether an owner can see what happened, why it happened, and what to do next without founder interpretation
- You can tell whether pause, review, override, and recovery exist as real product behaviors or just architectural claims

- [ ] **Step 2: Run the approvals and audit spine tests**

Run:

```bash
pnpm --filter @switchboard/api test -- src/__tests__/api-approvals.test.ts src/__tests__/api-audit.test.ts
pnpm --filter @switchboard/core test -- src/__tests__/approval.test.ts src/__tests__/decision-trace.test.ts src/__tests__/audit-remediation.test.ts
```

Expected:

- Passing tests provide evidence that the governance and audit spine still supports owner trust
- Failures are copied into `Autonomous Operation: Control Boundary`, `Visibility + Trust`, or `Operator Intervention`

- [ ] **Step 3: Fill in the Autonomous Operation, Visibility + Trust, and Operator Intervention sections**

```markdown
### Autonomous Operation: Behavior Quality

- Rating: `pass|pass with friction|fail`
- Can they complete it? Answer in one sentence.
- Can they understand it? Answer in one sentence.
- Can they trust it? Answer in one sentence.
- Can they recover without you? Answer in one sentence.
- Evidence:
  - Paste the strongest concrete evidence from this task.
- Findings:

### Autonomous Operation: Control Boundary

- Rating: `pass|pass with friction|fail`
- Can they complete it? Answer in one sentence.
- Can they understand it? Answer in one sentence.
- Can they trust it? Answer in one sentence.
- Can they recover without you? Answer in one sentence.
- Evidence:
  - Paste the strongest concrete evidence from this task.
- Findings:
  - Paste concrete findings with severity and manual-help flags.

### Visibility + Trust

- Rating: `pass|pass with friction|fail`
- Can they complete it? Answer in one sentence.
- Can they understand it? Answer in one sentence.
- Can they trust it? Answer in one sentence.
- Can they recover without you? Answer in one sentence.
- Evidence:
  - Paste the strongest concrete evidence from this task.
- Findings:
  - Paste concrete findings with severity and manual-help flags.

### Operator Intervention

- Rating: `pass|pass with friction|fail`
- Can they complete it? Answer in one sentence.
- Can they understand it? Answer in one sentence.
- Can they trust it? Answer in one sentence.
- Can they recover without you? Answer in one sentence.
- Evidence:
  - Paste the strongest concrete evidence from this task.
- Findings:
  - Paste concrete findings with severity and manual-help flags.
```

- [ ] **Step 4: Commit the trust and intervention findings**

```bash
git add docs/audits/2026-04-23-switchboard-public-launch-audit.md
git commit -m "docs: audit autonomy trust and intervention"
```

---

## Task 6: Audit Proof Of Value, Attribution, And Operational Readiness

**Files:**

- Modify: `docs/audits/2026-04-23-switchboard-public-launch-audit.md`
- Reference: `apps/dashboard/src/app/(auth)/dashboard/roi/page.tsx`
- Reference: `apps/dashboard/src/app/api/dashboard/roi/route.ts`
- Reference: `apps/dashboard/src/app/api/dashboard/overview/route.ts`
- Reference: `apps/dashboard/src/components/roi/breakdown-table.tsx`
- Reference: `apps/dashboard/src/components/roi/funnel-bars.tsx`
- Reference: `apps/dashboard/src/components/roi/metric-card.tsx`
- Reference: `packages/core/src/attribution/reconciliation-runner.ts`
- Reference: `packages/core/src/calendar/google-calendar-adapter.ts`
- Reference: `packages/db/src/stores/prisma-booking-store.ts`
- Reference: `apps/api/src/routes/health.ts`
- Reference: `docs/DEPLOYMENT-CHECKLIST.md`
- Reference: `docs/health/security-backlog.md`
- Reference: `apps/api/src/__tests__/api-health.test.ts`
- Reference: `packages/core/src/attribution/reconciliation-runner.test.ts`
- Reference: `packages/core/src/calendar/google-calendar-adapter.test.ts`

- [ ] **Step 1: Inspect whether value is visible and credible within the trial window**

Run:

```bash
sed -n '1,260p' apps/dashboard/src/app/\(auth\)/dashboard/roi/page.tsx
sed -n '1,260p' apps/dashboard/src/app/api/dashboard/roi/route.ts
sed -n '1,260p' apps/dashboard/src/app/api/dashboard/overview/route.ts
sed -n '1,260p' packages/core/src/attribution/reconciliation-runner.ts
sed -n '1,260p' packages/db/src/stores/prisma-booking-store.ts
```

Expected:

- You can determine whether booked appointments and funnel outcomes are surfaced clearly enough to feel attributable and credible
- Missing attribution, weak ROI surfacing, or hidden business logic are recorded as proof-of-value gaps

- [ ] **Step 2: Run the health, attribution, and booking-adjacent tests**

Run:

```bash
pnpm --filter @switchboard/api test -- src/__tests__/api-health.test.ts
pnpm --filter @switchboard/core test -- src/attribution/reconciliation-runner.test.ts src/calendar/google-calendar-adapter.test.ts
```

Expected:

- Test output either supports the platform's proof-of-value and operational claims or gives concrete counter-evidence
- Any failure is pasted into the relevant audit section instead of being paraphrased away

- [ ] **Step 3: Fill in the Proof of Value section and update blocker buckets**

```markdown
### Proof of Value

- Rating: `pass|pass with friction|fail`
- Can they complete it? Answer in one sentence.
- Can they understand it? Answer in one sentence.
- Can they trust it? Answer in one sentence.
- Can they recover without you? Answer in one sentence.
- Evidence:
  - Paste the strongest concrete evidence from this task.
- Findings:
  - Journey step: `Proof of Value`
  - Subsystem: `ROI dashboard` | `Attribution` | `Booking`
  - Severity:
  - Manual rescue required:
  - Manual setup debt:
```

- [ ] **Step 4: Commit the proof-of-value findings**

```bash
git add docs/audits/2026-04-23-switchboard-public-launch-audit.md
git commit -m "docs: audit proof of value and ops readiness"
```

---

## Task 7: Synthesize The Launch Verdict And Self-Review The Audit

**Files:**

- Modify: `docs/audits/2026-04-23-switchboard-public-launch-audit.md`
- Reference: `docs/superpowers/specs/2026-04-23-switchboard-launch-audit-design.md`

- [ ] **Step 1: Fill in the executive verdict and launch mode recommendation**

```markdown
## Executive Verdict

- Verdict: `not ready` | `conditionally launchable` | `ready`
- Recommended launch mode: `broad self-serve` | `controlled beta` | `founder-led cohort` | `not launchable`
- Strongest evidence:
  - Replace with the strongest blocker or major-gap evidence.
  - Replace with the strongest blocker or major-gap evidence.
  - Replace with the strongest blocker or major-gap evidence.
```

Use these rules:

- `not ready`: any critical journey step failed, any required self-serve setup still needs the team, or the path only works in demo/dev/founder-assisted conditions
- `conditionally launchable`: viable only for controlled beta or founder-led cohort, not broad public self-serve
- `ready`: the full trial-to-value path works without hidden operator help

- [ ] **Step 2: Update the summary table from the detailed findings**

Run:

```bash
rg -n "^### |^- Rating:|Manual rescue|required|Manual setup debt" docs/audits/2026-04-23-switchboard-public-launch-audit.md
```

Expected:

- Every critical journey step has a rating
- Every step has enough evidence to justify the summary row
- Manual rescue and manual setup debt are present where applicable

- [ ] **Step 3: Run the final audit self-review checks**

Run:

```bash
rg -n "TODO|TBD|FIXME|XXX|pass\\|pass with friction\\|fail|Journey step: $|Subsystem: $|Severity: $" docs/audits/2026-04-23-switchboard-public-launch-audit.md
```

Expected:

- No placeholders remain
- No empty finding fields remain in blocker, major-gap, or polish sections
- Any unresolved template markers are fixed before the audit is considered complete

- [ ] **Step 4: Commit the final audit artifact**

```bash
git add docs/audits/2026-04-23-switchboard-public-launch-audit.md
git commit -m "docs: finalize public launch audit"
```
