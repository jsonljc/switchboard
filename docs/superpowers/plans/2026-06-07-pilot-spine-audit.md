# Pilot-Spine Live Walkthrough Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute the audit specced in `docs/superpowers/specs/2026-06-07-pilot-spine-audit-design.md`: walk 7 pilot journeys live on a local stack at production-default config, assign PROVEN/BROKEN/DORMANT verdicts with artifacts, build the flag/producer inventory, commit seam-pin tests, and produce a ranked findings report.

**Architecture:** This is an audit, not feature work. Every journey step follows the same loop: exercise the real system → capture an artifact (HTTP response, DB row, WorkTrace entry, or screenshot) → assign a verdict → record the finding. No verdict without an artifact. Fixes are out of scope; each finding becomes its own PR later.

**Tech Stack:** Local stack (Postgres + Fastify API :3000 + chat :3001 + Next.js dashboard :3002), curl, psql, playwright-core + system Chrome for screenshots, vitest for seam-pin tests.

**Output locations:**

- Report: `docs/audits/2026-06-07-pilot-spine-audit/index.md`
- Findings: `docs/audits/2026-06-07-pilot-spine-audit/findings/F-NN-<slug>.md`
- Evidence: `docs/audits/2026-06-07-pilot-spine-audit/evidence/`
- Seam-pin tests: co-located in the relevant packages

**Verdict rules (from the spec, repeated here so executors never improvise):**

- PROVEN: evidence artifact captured. BROKEN: exercised and failed, failure artifact captured. DORMANT: flag/missing-producer/config prevents it running at production defaults.
- "The code looks correct" is never evidence.
- Any manual DB write to unblock a journey = documented deviation + automatic DORMANT finding for the missing producer.
- Verify every candidate finding at file:line against current main before recording (prior audits re-flagged already-fixed work).

**Finding file template (use for every finding):**

```markdown
# F-NN: <one-line title>

- **Severity:** blocks-pilot | embarrasses-pilot | cosmetic | decay
- **Journey/step:** J3-S4 (or "inventory" / "decay-pass")
- **Verdict:** BROKEN | DORMANT | ILLUSION
- **Location:** `path/to/file.ts:NN` (verified against main on 2026-06-07)
- **Evidence:** `evidence/<artifact-file>`

## What was exercised

<exact command or UI action>

## What happened vs expected

<observed behavior, expected behavior>

## Suggested fix scope

<1-3 sentences; which package, which seam>
```

---

### Task 0: Workspace, prerequisites, and scaffold

**Files:**

- Create: `docs/audits/2026-06-07-pilot-spine-audit/index.md` (skeleton)
- Create: `docs/audits/2026-06-07-pilot-spine-audit/evidence/.gitkeep`

- [ ] **Step 1: Create an audit worktree off main**

Per `superpowers:using-git-worktrees`. Branch name: `audit/pilot-spine`. After `git worktree add`, run `pnpm worktree:init` from the new worktree root (CLAUDE.md doctrine). If Postgres is down, start it first, then `pnpm local:setup`.

- [ ] **Step 2: Load the agent operating layer for this task type**

Read, in order: `.agent/RESOLVER.md` (this is an Architecture audit + Route-chain audit), then `docs/DOCTRINE.md`, `.agent/skills/route-chain-audit/SKILL.md`, `.agent/conventions/evidence-standard.md`, `.agent/conventions/architecture-invariants.md`. Do not load unrelated files.

- [ ] **Step 3: Verify prerequisites exist before anything else**

```bash
# Postgres reachable
pg_isready
# Required env present in root .env (values not printed)
grep -c "ANTHROPIC_API_KEY\|NEXTAUTH_SECRET\|CREDENTIALS_ENCRYPTION_KEY\|INTERNAL_API_SECRET\|DATABASE_URL" .env
```

Expected: `pg_isready` says accepting connections; grep count >= 5. Also confirm with the user that a Telegram bot token (from BotFather) is available for journeys 2/3/6. **If any prerequisite is missing, STOP and report to the user; do not improvise.**

- [ ] **Step 4: Scaffold the report directory**

```bash
mkdir -p docs/audits/2026-06-07-pilot-spine-audit/{findings,evidence}
touch docs/audits/2026-06-07-pilot-spine-audit/evidence/.gitkeep
```

Create `index.md` containing: title, date, spec link, an empty verdict-map table with one row per journey step (filled as the audit runs), an empty flag-inventory table, and an empty ranked-findings list.

- [ ] **Step 5: Commit scaffold**

```bash
git add docs/audits/2026-06-07-pilot-spine-audit/
git commit -m "docs(audit): scaffold pilot-spine audit report"
```

---

### Task 1: Phase 0 static seam-trace (before booting anything)

**Files:**

- Create: `docs/audits/2026-06-07-pilot-spine-audit/seam-list.md`

- [ ] **Step 1: Enumerate the last ~3 weeks of merges**

```bash
git log --oneline --merges --since="2026-05-17" origin/main | tee /tmp/merges.txt
git diff --stat $(git rev-list -1 --before="2026-05-17" origin/main) origin/main -- 'packages/**' 'apps/**' | tail -30
```

- [ ] **Step 2: Build the seam list**

For each high-churn area, identify producer→consumer boundaries of these shapes: webhook → handler (`apps/chat/src/routes/managed-webhook.ts` → gateway), store → hook → UI (e.g. approvals store → `apps/dashboard/src/hooks/use-decision-feed.ts`), cron → ingress (`apps/api/src/services/cron/*` → `PlatformIngress.submit()`), API route → Next proxy route → dashboard client. Record each seam in `seam-list.md` as: producer file:line → consumer file:line → payload type/schema name → suspected mismatch (yes/no + why).

- [ ] **Step 3: Shape-check each seam statically**

For each seam, read the producer's output construction and the consumer's parse/destructure. Flag any field dropped, renamed, or optionally-undefined-but-consumed. Record suspected issues in `seam-list.md` marked `SUSPECTED` (they require live confirmation before a BROKEN verdict, per spec).

- [ ] **Step 4: Commit the seam list**

```bash
git add docs/audits/2026-06-07-pilot-spine-audit/seam-list.md
git commit -m "docs(audit): phase 0 seam list"
```

---

### Task 2: Flag and producer inventory

**Files:**

- Modify: `docs/audits/2026-06-07-pilot-spine-audit/index.md` (inventory table)

- [ ] **Step 1: Harvest the flag universe**

```bash
cat .env.example
cat scripts/env-allowlist.local-readiness.json
grep -rn "NEXT_PUBLIC_" apps/dashboard/src --include="*.ts" --include="*.tsx" -l | head -30
```

- [ ] **Step 2: Fill the inventory table**

Columns: flag/field | writer (file:line) | reader (file:line) | production default | verdict (LIVE/DORMANT/ILLUSION). Start with the 8 pre-identified rows from the spec ("Flag and producer inventory" section): `OrganizationConfig.businessHours`, `NEXT_PUBLIC_REPORTS_LIVE`, `NEXT_PUBLIC_LAUNCH_MODE`, `SLACK_BOT_TOKEN`+`SLACK_APPROVAL_CHANNEL`, `CHAT_PUBLIC_URL`/`SWITCHBOARD_CHAT_URL`+`INTERNAL_API_SECRET`, `FOLLOWUP_ALLOW_MARKETING_TEMPLATE`, `NEXT_PUBLIC_CONTACTS_LIVE`, serviceId `"meta"` vs `"meta-ads"`. Then add every other spine-relevant flag found in Step 1. For each row, grep for the writer; "no writer found" must be confirmed by at least two search patterns (field name + Prisma update on the model) before recording DORMANT.

- [ ] **Step 3: Verdict the stored-control rows**

For approval thresholds, entitlements, trust levels, channel status: find who writes them for a _fresh org_ (signup path: `apps/dashboard/src/app/api/auth/register/route.ts` → `provisionDashboardUser` → `seedOrgDayOneAgents`). A control whose only writer is a dev seed script is DORMANT. A control with UI but no enforcing reader is ILLUSION.

- [ ] **Step 4: File findings for every DORMANT/ILLUSION row; commit**

One finding file per non-LIVE row using the template. Commit:

```bash
git add docs/audits/2026-06-07-pilot-spine-audit/
git commit -m "docs(audit): flag and producer inventory"
```

---

### Task 3: Stack bring-up at production-default config

**Files:** none created (operational task; evidence only)

- [ ] **Step 1: Establish the production-default env**

In the worktree, ensure: `DEV_BYPASS_AUTH` is NOT set (or false) in `apps/dashboard/.env.local`, `NEXT_PUBLIC_LAUNCH_MODE=public` (matches `.env.example`), `CHAT_PUBLIC_URL`/`SWITCHBOARD_CHAT_URL` point at `http://localhost:3001`, `INTERNAL_API_SECRET` set. Record the exact env diff vs `.env.example` in `evidence/env-config.md` (names only, never values). Known gotcha: worktree-init can mangle `apps/dashboard/.env.local` DATABASE_URL and comment out lines; inspect and fix before launching.

- [ ] **Step 2: Build, migrate, seed**

```bash
pnpm build
pnpm db:migrate
pnpm db:seed
```

Expected: all green. If typecheck/build complains about missing schema exports, run `pnpm reset` then `pnpm build` (full build, not reset alone).

- [ ] **Step 3: Launch all three servers detached**

Check each app's `package.json` start script first, then launch detached (tracked background tasks get reaped; the API has no dotenv loading so it needs `--env-file`):

```bash
(cd apps/api && nohup node --env-file=../../.env dist/index.js > /tmp/audit-api.log 2>&1 & disown)
(cd apps/chat && nohup node --env-file=../../.env dist/index.js > /tmp/audit-chat.log 2>&1 & disown)
(cd apps/dashboard && nohup pnpm start > /tmp/audit-dashboard.log 2>&1 & disown)
```

If `dist/index.js` is not the entry, adapt to the actual script; for the dashboard, `pnpm start` requires `next build` output (prefer it over `dev` so production-default behavior is honest).

- [ ] **Step 4: Health-check and capture boot evidence**

```bash
curl -s -o /tmp/api-health.json -w "%{http_code}" http://localhost:3000/health
curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/health || true
curl -s -o /dev/null -w "%{http_code}" http://localhost:3002/login
tail -5 /tmp/audit-api.log /tmp/audit-chat.log /tmp/audit-dashboard.log
```

Expected: 200s (chat health path may differ; check its routes). Save outputs to `evidence/boot-health.txt`. **If the API refuses to boot on a static-key/org-binding startup check, that is itself evidence; record it, fix env per the message, retry.**

---

### Task 4: Journey 1: Onboarding

**Steps are J1-S1..S4 in the verdict map.**

- [ ] **Step 1 (J1-S1): Self-serve signup**

```bash
curl -s -X POST http://localhost:3002/api/auth/register \
  -H "content-type: application/json" \
  -d '{"email":"audit-pilot@example.com","password":"Audit-2026-pilot!","name":"Audit Pilot"}' \
  | tee docs/audits/2026-06-07-pilot-spine-audit/evidence/j1-register-response.json
```

Adapt the body to the route's actual schema (read `apps/dashboard/src/app/api/auth/register/route.ts` first). Expected: 2xx; auto-verify should kick in because `RESEND_API_KEY` is unset. A 403 means the `NEXT_PUBLIC_LAUNCH_MODE` unset-fallback fired: that is a finding, fix env, retry.

- [ ] **Step 2 (J1-S2): Verify provisioned rows in the DB**

```bash
source .env 2>/dev/null || true
psql "$DATABASE_URL" -c "SELECT id,\"createdAt\" FROM \"OrganizationConfig\" ORDER BY \"createdAt\" DESC LIMIT 3;"
psql "$DATABASE_URL" -c "SELECT id,type FROM \"Principal\" ORDER BY \"createdAt\" DESC LIMIT 5;"
```

(Adjust table/column names to `packages/db/prisma/schema.prisma` if they differ.) Save output to `evidence/j1-db-rows.txt`. Also check `OrgAgentEnablement` rows and whether an `AgentDeployment` for Alex exists yet. Expected per pre-review: enablement rows yes, deployment NOT yet (deferred to channel connect). If so, record as a note (not automatically a finding) and verify journey 2 creates it.

- [ ] **Step 3 (J1-S3): Login with auth ON and screenshot**

Write `/tmp/audit-shot.mjs` using playwright-core + system Chrome (per the project's known headless pattern): navigate to `http://localhost:3002/login`, fill the credentials form with the audit user, submit, wait for the authed home, screenshot to `docs/audits/2026-06-07-pilot-spine-audit/evidence/j1-home-authed.png`. Read the PNG to confirm it shows the authed app, not the login page.

- [ ] **Step 4 (J1-S4): Verdict and record**

Fill J1 rows in the verdict map. File findings for anything BROKEN/DORMANT. Commit: `git add docs/audits/... && git commit -m "docs(audit): journey 1 onboarding verdicts"`.

---

### Task 5: Journey 2: Channel connect (Telegram stand-in)

**Steps J2-S1..S4.**

- [ ] **Step 1 (J2-S1): Connect Telegram via the dashboard**

Using the Playwright script (logged in as the audit user), navigate to the channel-connect surface, submit the BotFather token. Capture the HTTP response of the underlying API call from `/tmp/audit-dashboard.log` or by curling the API route directly with the session. Screenshot the resulting channel state.

- [ ] **Step 2 (J2-S2): Verify ManagedChannel status resolution**

```bash
psql "$DATABASE_URL" -c "SELECT id,type,status FROM \"ManagedChannel\" ORDER BY \"createdAt\" DESC LIMIT 3;"
```

Expected: `active`. If `config_error`/`pending_chat_register`, the chat-runtime env gate fired (`apps/api/src/lib/resolve-provision-status.ts`): record evidence, fix `CHAT_PUBLIC_URL`/`INTERNAL_API_SECRET`/chat server, re-resolve. If it cannot reach `active` even with env correct, that is BROKEN. Also verify the Alex `AgentDeployment` now exists (J1-S2 note).

- [ ] **Step 3 (J2-S3): Prove routing with a real inbound message**

Send a message to the bot from a real Telegram account ("hello"). Verify arrival:

```bash
tail -50 /tmp/audit-chat.log
psql "$DATABASE_URL" -c "SELECT id,\"createdAt\" FROM \"WorkTrace\" ORDER BY \"createdAt\" DESC LIMIT 5;"
```

Save to `evidence/j2-inbound.txt`. Expected: inbound processed, Alex reply received in Telegram (screenshot the Telegram thread or capture the send call from logs).

- [ ] **Step 4 (J2-S4): WhatsApp config-evidence verdict + record**

WhatsApp has no local sandbox. Verdict its steps from config evidence only: confirm connect hard-requires `token`+`phoneNumberId` and `active` requires a live Meta Graph probe (`apps/api/src/routes/organizations.ts`, `probeWhatsAppHealth`). Record WhatsApp rows as DORMANT-by-config with file:line evidence (expected; not pilot-blocking while Meta gates pend). Seam-pin: add a vitest test pinning the Telegram webhook payload → gateway consumer schema using the real captured payload (scrub PII). Commit verdicts + test.

---

### Task 6: Journey 3: The booking loop (the spine)

**Steps J3-S1..S6.**

- [ ] **Step 1 (J3-S1): Walk the business-facts producer**

Via Playwright as the audit user: settings → business facts; enter hours, 2 services, 1 FAQ. Screenshot. Verify persistence:

```bash
psql "$DATABASE_URL" -c "SELECT * FROM <business-facts table per schema.prisma> ORDER BY \"updatedAt\" DESC LIMIT 3;"
```

Then verify the consumer: confirm `packages/core/src/skill-runtime/builders/alex.ts` composes the entered facts (next step proves it live). Explicitly verdict the empty-facts fallback: before entering facts, send one Telegram message asking "what are your opening hours?" and capture Alex's answer with `BUSINESS_FACTS=""` (expected: confidently vague or wrong = embarrasses-pilot finding).

- [ ] **Step 2 (J3-S2): Check the businessHours producer gap**

```bash
psql "$DATABASE_URL" -c "SELECT id, \"businessHours\" FROM \"OrganizationConfig\" ORDER BY \"createdAt\" DESC LIMIT 3;"
grep -rn "businessHours" apps/ packages/ --include="*.ts" -l | grep -v test | grep -v seed
```

Expected per pre-review: NULL for the fresh org, and no product writer (only readers + marketplace seed). If confirmed: file the headline DORMANT finding (calendar resolves to Noop provider, bookings disabled for every real signup), then apply the **documented deviation**: inject businessHours via psql, record the exact SQL in the finding and in `evidence/deviations.md`.

- [ ] **Step 3 (J3-S3): Run the booking conversation**

From the real Telegram account: "I'd like to book a consultation tomorrow afternoon." Continue the conversation until Alex confirms a slot. Capture: the full Telegram thread (screenshot), chat log excerpt, and:

```bash
psql "$DATABASE_URL" -c "SELECT id,status,\"workTraceId\" FROM \"Booking\" ORDER BY \"createdAt\" DESC LIMIT 3;"
psql "$DATABASE_URL" -c "SELECT id,kind FROM <receipt table per schema.prisma> ORDER BY \"createdAt\" DESC LIMIT 3;"
```

Expected: Booking row with non-null `workTraceId`, receipt row minted, WorkTrace entry. Each is an artifact for a separate verdict-map row.

- [ ] **Step 4 (J3-S4): Verify dashboard render of the booking**

Playwright: screenshot the surface where the booking/receipt appears (Home/Inbox). The screenshot must show the actual booking from S3, not fixture data.

- [ ] **Step 5 (J3-S5): Park an approval-requiring action for Journey 4**

Trigger an action that crosses the approval threshold (read the governance seed to find one: an action whose policy is `require_approval` for this org). Likely candidates: a booking change/refund-like action or whatever financial intent the org's policy gates. Verify it parks:

```bash
psql "$DATABASE_URL" -c "SELECT id,status FROM <approval/parked-lifecycle table> ORDER BY \"createdAt\" DESC LIMIT 3;"
```

Expected: a pending approval with a real bindingHash. **Do not use seeded approvals; they cannot be approved by design.**

- [ ] **Step 6 (J3-S6): Seam pins + verdicts + commit**

Add seam-pin tests for: webhook payload → gateway schema (if not done in J2), booking-creation output → receipt-mint input, receipt/store output → dashboard hook schema. Use real captured payloads as fixtures, scrubbed. Run `pnpm --filter <package> test` for each touched package. Fill J3 verdict rows, file findings, commit.

---

### Task 7: Journey 4: Approval lifecycle

**Steps J4-S1..S3.**

- [ ] **Step 1 (J4-S1): Approve through the Inbox, prove dispatch**

Playwright: open Inbox, locate the parked approval from J3-S5, screenshot, click approve. Then prove dispatch-or-recovery:

```bash
tail -50 /tmp/audit-api.log
psql "$DATABASE_URL" -c "SELECT id,status FROM <approval table> WHERE id='<id>';"
psql "$DATABASE_URL" -c "SELECT id,\"createdAt\" FROM \"WorkTrace\" ORDER BY \"createdAt\" DESC LIMIT 5;"
```

Expected: approval consumed, action dispatched (observable effect: outbound message/booking mutation), WorkTrace records it. A 2xx that leaves the action un-dispatched is a phantom-success BROKEN finding (known historical failure class).

- [ ] **Step 2 (J4-S2): Reject path**

Park a second action (repeat J3-S5 pattern), reject it via Inbox. Expected: status rejected, no side effect executed, WorkTrace records the rejection. Capture the same three artifacts.

- [ ] **Step 3 (J4-S3): Slack notification row + verdicts + commit**

Confirm from config (not live) that approval Slack notification is dark without `SLACK_BOT_TOKEN`+`SLACK_APPROVAL_CHANNEL` (`apps/api/src/bootstrap/approval-notifier.ts`); record as DORMANT-by-config in the inventory if not already. Fill J4 rows, file findings, commit.

---

### Task 8: Journey 5: Results surfaces

**Steps J5-S1..S3.**

- [ ] **Step 1 (J5-S1): Home and Inbox render real data**

Playwright screenshots of Home and Inbox while logged in as the audit user. The artifacts must show data traceable to journeys 1-4 (the booking, the approval). Cross-check one displayed number against the DB.

- [ ] **Step 2 (J5-S2): Results page at production default**

Navigate to Results with `NEXT_PUBLIC_REPORTS_LIVE` at its `.env.example` default (`false`). Screenshot. Expected: non-live mode renders; that is a DORMANT-by-flag verdict for "Results shows real data" (legitimate finding, pre-identified). Also verify the serviceId `"meta"` vs `"meta-ads"` mismatch at its current file:line and verdict it.

- [ ] **Step 3 (J5-S3): Contacts surface + verdicts + commit**

Check `NEXT_PUBLIC_CONTACTS_LIVE` default and what Contacts renders for the audit org (real contact created from the Telegram lead?). Screenshot. Fill J5 rows, file findings, commit.

---

### Task 9: Journey 6: Escalation / handoff

**Steps J6-S1..S3.**

- [ ] **Step 1 (J6-S1): Trigger a handoff**

From the Telegram account, send something Alex must escalate (e.g., a medical-adjacent or out-of-scope request; read the escalation rules in `apps/chat/src/escalation/rules.ts` to pick a reliable trigger). Verify an escalation row exists and it appears in the dashboard Inbox (screenshot).

- [ ] **Step 2 (J6-S2): Human replies, thread recovers**

Via Inbox, send a reply as the operator. Expected: reply arrives in the Telegram thread (routing goes back over the same channel). Screenshot the Telegram side. Then resolve the escalation and send one more customer message to confirm Alex resumes handling.

- [ ] **Step 3 (J6-S3): Verdicts + commit**

Fill J6 rows. Capture the escalation-route seam (escalation reply → channel adapter) as a seam-pin test if a schema boundary exists. File findings, commit.

---

### Task 10: Journey 7: Unattended outbound crons

**Steps J7-S1..S4.**

- [ ] **Step 1 (J7-S1): Confirm registration and gating posture**

Read `apps/api/src/bootstrap/inngest.ts` and confirm at current file:line: `appointment-reminder-dispatch` (hourly) and `scheduled-follow-up-dispatch` (every 15 min) are registered unconditionally (no env-flag wrapper), `riskCategory: "high"`. Record the absence of a kill-switch as a finding (severity: blocks-pilot or embarrasses-pilot; judge by whether any global halt covers them; check the workspace/global halt path before deciding).

- [ ] **Step 2 (J7-S2): Exercise the reminder dispatch locally**

Determine how Inngest functions execute locally (look for an inngest dev-server script; `npx inngest-cli@latest dev` pattern). If runnable: create a confirmed booking 23-25h out (the J3 booking or a psql-adjusted copy; document any SQL as a deviation), trigger the reminder function, and capture: the ingress submission (`conversation.reminder.send` intent), the GovernanceGate decision, and the outbound Telegram message. If Inngest cannot run locally, verdict DORMANT-locally and verify the chain statically to the ingress boundary, marking the live leg as unproven; do NOT mark PROVEN.

- [ ] **Step 3 (J7-S3): Exercise the follow-up dispatch**

Same pattern for `scheduled-follow-up-dispatch`: confirm what creates a follow-up cadence for a fresh org (producer check: does anything schedule follow-ups for the audit org's conversation?), trigger, capture artifacts. Explicitly verdict `FOLLOWUP_ALLOW_MARKETING_TEMPLATE` empty-default behavior: does it block, allow, or throw?

- [ ] **Step 4 (J7-S4): Targeting proof + verdicts + commit**

Prove the crons fire _only_ for qualifying rows: check the SQL/query legs for the known take-before-filter starvation pattern and for tenant scoping. Add a seam-pin or targeting test if the cron query is testable in isolation. Fill J7 rows, file findings, commit.

---

### Task 11: Slim decay pass

- [ ] **Step 1: Run the deterministic tools**

```bash
.agent/tools/check-routes 2>&1 | tee docs/audits/2026-06-07-pilot-spine-audit/evidence/check-routes.txt
pnpm arch:check 2>&1 | tee docs/audits/2026-06-07-pilot-spine-audit/evidence/arch-check.txt
```

(If `check-routes` has a different invocation, read `.agent/tools/` first.)

- [ ] **Step 2: Bypass scan**

Search for mutating paths skipping ingress: grep `prisma.` mutations and store `create/update/delete` calls reachable from routes that do not pass through `PlatformIngress.submit()`; cross-check against `route-allowlist.yaml` (allowlisted bypasses are policy, not findings). Record genuinely unallowlisted bypasses as decay findings.

- [ ] **Step 3: Orphans and size**

Note files >600 raw lines (the arch job counts raw lines, separate from eslint) and modules imported by nothing. Decay severity only. Commit evidence + findings.

---

### Task 12: Report assembly and close-out

- [ ] **Step 1: Complete index.md**

Fill: the full verdict map (every J1-S1..J7-S4 row has exactly one verdict + artifact link), the completed flag inventory, the ranked findings list (blocks-pilot → embarrasses-pilot → cosmetic → decay), the deviations log, and a 10-line executive summary written for a non-developer (what is safe to pilot, what must be fixed first, what is dormant by design).

- [ ] **Step 2: Self-check against the spec's success criteria**

Walk the 6 success criteria in the spec; each must be checkable from index.md alone. Any journey step without an artifact link is unfinished work, not a PROVEN.

- [ ] **Step 3: Stop servers, final commit**

```bash
pkill -f "audit-api\|audit-chat" 2>/dev/null; lsof -ti:3000,3001,3002 | xargs kill 2>/dev/null
git add docs/audits/2026-06-07-pilot-spine-audit/
git commit -m "docs(audit): pilot-spine audit report + verdict map"
```

Run `pnpm test` and `pnpm typecheck` (seam-pin tests must be green). Then follow `superpowers:finishing-a-development-branch`: PR `audit/pilot-spine` → main (report + seam-pin tests together; fixes come later as separate per-finding PRs).
