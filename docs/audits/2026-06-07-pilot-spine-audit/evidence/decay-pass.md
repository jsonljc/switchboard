# Decay pass — Steps 2-3 (Task 11)

Date: 2026-06-08 · Branch: `audit/pilot-spine` · Tooling: `.agent/tools/check-routes.ts`, `scripts/arch-check.ts`

Analysis only. No product code modified. Servers on :3000-:3002 left running.

## Step 1 evidence reconciliation

- `evidence/check-routes.txt` (Step 1) captured only `102 findings suppressed by allowlist.` — re-ran and confirmed exit 0, **0 kept (unsuppressed)** findings. The "🟡 apps/chat: 1 occurrences" referenced in the task prompt is from **arch-check.txt** (`as any` usage section), not check-routes. The single chat `as any` is `apps/chat/src/dlq/failed-message-store.ts:36` (`rawPayload: input.rawPayload as any`) — a DLQ persistence cast, **not a route bypass**.
- `evidence/arch-check.txt` (Step 1): 55 non-error issues, no error-level, exit 0, CI passes. File counts informational. All flagged >400-line modules are pre-existing legacy debt carrying `eslint-disable max-lines`.

## Step 2 — Bypass scan (mutating paths skipping PlatformIngress.submit)

**Result: CLEAN. No genuine unallowlisted mutating bypass.**

Method: `check-routes` default mode (2-hop import scan for mutating route handlers that do not reach `PlatformIngress.submit`, partitioned against `route-allowlist.yaml`) + `--mode=error` (repo-wide route-class headers + store-mutation org-scope) + manual review of the 1-unsuppressed-occurrence claim and every route added since 2026-05-17.

### apps/chat routes (the path-filtered-arch-job gotcha)

- `apps/chat/src/routes/` contains: `health.ts`, `managed-webhook.ts`, `slack-form-parser.ts`.
- `managed-webhook.ts` — `@route-class: ingress-receiver`; POST `/webhook/managed/:webhookId` hands off via `gateway.handleIncoming` → PlatformIngress lead.intake (file references PlatformIngress at line 132). **Allowlisted** (route-allowlist.yaml: "Managed inbound chat webhook … handoff to gateway.handleIncoming which routes through ingress").
- `slack-form-parser.ts` — `@route-class: read-only`; registers 0 mutating routes (it is a parser util living under routes/). Not a bypass.
- `health.ts` — GET only. Not a bypass.
- The single apps/chat `as any` (failed-message-store.ts:36) is in `dlq/`, not `routes/`. Not a route bypass.

### Routes added since 2026-05-17 (`git log --diff-filter=A`)

All cross-checked for ingress posture / allowlist coverage:

| New route                                                 | route-class      | mutating regs | posture                                                                                                                   |
| --------------------------------------------------------- | ---------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/routes/payments-webhook.ts`                 | ingress-receiver | yes           | calls `platformIngress.submit(payment.record_verified)`; **allowlisted** (2-hop scan misses dynamic core resolution)      |
| `apps/api/src/routes/action-lifecycle.ts`                 | lifecycle        | yes           | `/:id/execute` + `/:id/undo` via PlatformLifecycle on already-approved units; **allowlisted** (lifecycle, not new action) |
| `apps/api/src/routes/internal-chat-approvals.ts`          | lifecycle        | yes           | chat approval bridge → unified respond engine; **allowlisted** (approval lifecycle)                                       |
| `apps/api/src/routes/marketplace-operational-state.ts`    | control-plane    | 1             | reaches ingress; not allowlisted because it does not need to be (0 kept findings)                                         |
| `apps/api/src/routes/agent-home/mira-brief.ts`            | lifecycle        | 1             | reaches PlatformIngress                                                                                                   |
| `apps/api/src/routes/agent-home/mira-decision.ts`         | (allowlisted)    | yes           | draft-only reviewDecision write; **allowlisted** (reversible draft, no cross-agent write)                                 |
| `apps/api/src/routes/agent-home/creatives.ts`             | read-only        | 0             | read-only                                                                                                                 |
| `apps/api/src/routes/operator-intents-schemas-payment.ts` | —                | 0             | schema/intent definitions, no mutating registration                                                                       |
| `apps/chat/src/routes/slack-form-parser.ts`               | read-only        | 0             | read-only parser                                                                                                          |

Every new mutating route either reaches ingress or sits on an allowlist entry with a written reason. **No finding.**

### Non-blocking control-plane org-guard advisories (8)

`setup.ts, playbook.ts, onboard.ts, marketplace.ts, marketplace-persona.ts, marketplace-operational-state.ts, connections.ts, competence.ts` import none of the recognized org-scoping guards. **Warn-only by design** (Route Governance §12, tracked #654; excluded from exitCode). These are control-plane config mutators, all allowlisted from the ingress requirement. Pre-existing tracked debt — not a new audit finding.

## Step 3 — Size & orphans

### .ts files >600 raw lines (excl tests/node_modules/dist)

17 files. Cross-checked against arch-check CI behavior (`scripts/arch-check.ts`: errors at >600 **only when the file lacks `eslint-disable max-lines`**; walks `<pkg>/src` only).

Files under a package `src/` tree (scanned by arch-check) — **all carry `eslint-disable max-lines`** → reported 🟡 legacy-debt, exit 0:

- `apps/api/src/bootstrap/inngest.ts` (1280), `apps/api/src/app.ts` (969), `packages/core/src/orchestrator/propose-pipeline.ts` (822), `apps/api/src/bootstrap/skill-mode.ts` (820), `apps/api/src/routes/marketplace.ts` (787), `packages/ad-optimizer/src/audit-runner.ts` (731), `packages/core/src/skill-runtime/skill-executor.ts` (684), `packages/core/src/platform/platform-ingress.ts` (675), `packages/db/src/stores/prisma-work-trace-store.ts` (656), `apps/api/src/routes/readiness.ts` (655), `packages/core/src/platform/platform-lifecycle.ts` (654), `packages/core/src/engine/policy-engine.ts` (632), `apps/dashboard/src/components/cockpit/sprite/alex-variants.ts` (639), `apps/api/src/__tests__/test-stores.ts` (610, test harness).

Files NOT scanned by arch-check (outside any `<pkg>/src`) — invisible to the CI size gate **by design**:

- `apps/dashboard/.next/types/validator.ts` (1429) — Next generated artifact.
- `packages/db/prisma/seed-marketplace.ts` (1068) — under `prisma/`, not `src/`.
- `packages/db/prisma/seed.ts` (653) — under `prisma/`, not `src/`.

This is a (mild) **arch-check blind spot**: the two hand-maintained seed files exceed the 600 error threshold but are never measured because arch-check only walks `src/`. Low impact (seeds are dev/test scaffolding, not pilot runtime), filed as F-10 (decay).

### .tsx files >600 lines (informational, not covered by the CI .ts job)

**None.** (The cockpit sprite variants are `.ts`, already counted above.)

### Orphan check

- `packages/cartridge-sdk` (memory: "legacy, pending removal") is **still wired**, not a clean orphan: `apps/api/src/__tests__/test-server.ts` uses `TestCartridge`/`createTestManifest`; declared as a dep in `core`, `api`, `chat` package.json; `packages/core/src/orchestrator/__tests__/helpers.ts` imports it. The lone dashboard match (`results-page.tsx:59`) is a code comment. Removal is non-trivial (test-harness coupling) — known tracked decay, no new finding.
- Modules orphaned by last-3-weeks deletions: the Mercury `(mercury)/approvals/**` route tree and most of `components/cockpit/*-page.tsx` were deleted (CUX overhaul / Mercury retirement). **No dangling imports survive** — grep for refs to the deleted `approvals-page`, `cockpit-page`, `activity-stream`, `command-palette`, `mira-cockpit-page`, `riley-cockpit-page` returns nothing. Surviving cockpit files (`sprite/*`, `identity.tsx`, `tokens.ts`, `status-pill.tsx`) remain imported (e.g. `alex-variants.ts` via `build-sprite.ts`, `alex-config.ts`, `agent-avatar/`). Build/typecheck integrity intact (no "build type-checks dead files" hazard).

## Net

- Bypass scan: **clean** — 0 unallowlisted mutating bypasses; route gate passes in both modes.
- Size: 17 oversized `.ts`, all either eslint-disable'd legacy debt (CI-visible 🟡) or outside arch-check scope. One real blind spot: `prisma/seed*.ts` (F-10).
- Orphans: cartridge-sdk still load-bearing (tracked); recent deletions clean.
