# Dashboard core — Human-walk script

> Written 2026-05-01 against SHA `02fcaa4c`. Drives the human-only steps of Surface 01 (Dimensions D, E, F, G plus open repros from A/B/C/H/I-light). Run end-to-end at session closeout, capture artifacts, then return for calibration ritual + final commit.

## 0. Setup

Two terminals, one browser.

```bash
# Terminal 1 — API
cd /Users/jasonli/switchboard/.worktrees/audit-01-dashboard-core
pnpm --filter @switchboard/api dev

# Terminal 2 — dashboard (dev mode for D/E/F manual walks)
pnpm --filter @switchboard/dashboard dev
# → http://localhost:3002
```

For G (Lighthouse) you'll switch the dashboard to a production build via the runner — see §G.

Browser: Chrome (axe + Lighthouse profiles assume Chromium).

Sign in to a tenant with: ≥1 pending approval, ≥1 escalation, some activity. If your seed tenant doesn't have those, mention it — D's empty-state pass actually wants the *opposite* tenant.

---

## A. Screenshots (closeout — confirms A code-read findings)

At 1440px width, capture the following PNGs into `docs/audits/2026-05-01-pre-launch-surface/artifacts/01-dashboard-core/screenshots/desktop/` (already created).

| Shot | Page | Frames |
|------|------|--------|
| 01-console-full | `/console` | full page |
| 02-console-cold-load | `/console` | cold reload at "Slow 3G" the moment fonts swap (DC-15) |
| 03-decide-list | `/decide` | full page |
| 04-decide-detail | `/decide/[id]` | full page (any pending id) — side by side w/ 03 confirms DC-19 |
| 05-escalations | `/escalations` | full page |
| 06-escalations-overdue-chip | `/escalations` | tight crop on overdue SLA chip + bottom-tab badge (DC-21) |
| 07-conversations | `/conversations` | full page (status pills + human-override card; DC-16) |
| 08-console-vs-decide | side-by-side | `/console` left, `/decide` right (confirms DC-14 design-system divergence) |
| 09-chat-widget | any auth route except /console | tight crop on floating blue chat button + bottom-tab nav (DC-22) |

For the responsive pass (E), *separately* capture into `screenshots/responsive/` at 375 / 768 / 1024 widths — see §E.

---

## B. Walk the named tasks (confirms B findings, especially DC-39 / DC-40 / DC-41)

### Task 1 — Resolve a pending approval

1. Sign in to a tenant with a pending approval. You'll likely land on `/console`.
2. Locate the approval-gate card in the Queue zone. Click **"Review →"**.
   - **Expected:** open `/decide/${id}` or a modal.
   - **Today (DC-39):** nothing happens. Confirm.
3. Try to navigate from `/console` to `/decide` using only on-page elements.
   - **Expected:** a link or tab.
   - **Today (DC-40):** no in-page nav; bottom-tab nav is hidden on /console. Confirm.
4. Manually navigate to `/decide` via the URL bar. On the list, click **"Approve"** on a card → confirm in dialog → expect toast + card disappears. Confirm this path *does* work.
5. From `/decide/[id]` (click into a card detail): approve → confirm.
   - **Expected:** toast + auto-return.
   - **Today (DC-45):** no toast, no auto-return. Confirm.
6. Confirm DC-25: the negative button on `/decide` list says **"Not now"** but executes a permanent reject.

### Task 2 — Drill into an escalation and reply

1. From `/console`, locate an escalation card in the Queue zone. Click **"Reply"** or **"Reply inline ▾"**.
   - **Expected:** inline reply form opens, or navigate to `/escalations`.
   - **Today (DC-39):** nothing happens. Confirm.
2. Manually navigate to `/escalations`. Click an escalation card header — it expands; reply form is inline. Type a reply, hit **Send**.
   - **Expected:** confirmation, then continuation cue (next pending, auto-collapse).
   - **Today (DC-44, DC-23):** blue info banner appears with the false claim "It will be included in the conversation when the customer sends their next message. Direct message delivery is coming in a future update." There is no auto-advance. Confirm both.
3. **DC-23 verification:** in production, does `agentNotifier.sendProactive` actually deliver to Telegram/WhatsApp/Slack for *this* tenant? Two ways to verify:
   - Check whether the customer received the reply on their channel (the most direct test).
   - Inspect the API response in DevTools Network → `/api/escalations/.../respond`. Per `apps/api/src/routes/escalations.ts:266-275`, only a successful proactive delivery returns 200; a 502 means delivery failed and the banner copy is even more wrong. If you get 200 + customer never receives → the banner copy is factually false; that confirms DC-23 as Launch-blocker.
4. From the same escalation, attempt to "open the conversation in `/conversations`".
   - **Today (DC-46):** no cross-link; user must search /conversations manually. Confirm.
5. From `/conversations`, find a thread with `awaiting_approval` pill.
   - **Today (DC-46):** no jump-to-approval link. Confirm.

### Task 3 — Fresh-operator orientation

1. As a hypothetical fresh operator, navigate to `/console`. Read top-to-bottom: op-strip → numbers → queue → agents → Nova panel → activity. Form a mental model.
2. Try to click each affordance you noticed (queue card primary, Halt button, "view conversations" labels, activity row arrows). Note every inert one.
3. Try to navigate elsewhere. Confirm there's no on-page nav.
4. Subjective: are zone labels ("Queue", "Agents", "Activity") intelligible without prior context? **Code can't answer this — your read is the data.**

---

## C. Verify factual claims (closeout — confirms / upgrades C findings)

### DC-23: agentNotifier production wiring

Covered in B Task 2 step 3. If channel delivery actually works in your tenant, DC-23 stays Launch-blocker (banner is still factually false because the message wasn't queued — it was sent or failed). If channel delivery is broken in production, DC-23 is even more Launch-blocker (banner says success when nothing happened).

### DC-34: operator-chat example commands

Open the floating operator-chat widget. Type each of the literal placeholder/hint commands the widget suggests:

- `show pipeline`
- `pause low-performing ads`
- (any other literal example surfaced as a hint)

For each command, confirm whether the system handles it (real response) or returns the generic error fallback. If the system can't handle the literal command it suggests, DC-34 stays open; the user calibrates severity.

---

## D. Interaction state — the human-runs-this dimension

### D.1 Loading

DevTools → Network tab → throttle dropdown → **Slow 3G**. Hard reload `/console`.

- Do loading skeletons render?
- Does any zone flash empty before content arrives?
- Does the "Couldn't load live data. Showing the last known shape." banner appear *during* loading (it shouldn't — only on error)?

Capture screenshots into `artifacts/01-dashboard-core/screenshots/states/loading-*.png`.

Repeat for `/decide`, `/escalations`, `/conversations`. Note any zone that shows the Aurora Dental fixture during loading (compounds DC-04).

### D.2 Empty

Sign in (or impersonate) a tenant with **zero** of: pending approvals, escalations, audit activity. If your dev seed doesn't have such a tenant, document that and skip.

For each route, observe whether each zone has a sensible empty state. Open issues to file as new DC-NN findings:
- Zone renders nothing (blank panel) → Medium / High depending on prominence.
- Zone renders fixture data instead of empty state → Launch-blocker candidate (related to DC-04).
- Zone says "No data" with no help text → Low/Medium.

### D.3 Error

Stop the API server (`Ctrl-C` Terminal 1). Hard reload `/console`.

- Confirm the error banner from `1431bfa6` ("Couldn't load live data. Showing the last known shape.") renders above /console.
- Confirm DC-04: the page shows the *full Aurora Dental demo fixture* (revenue $1,240, "Sarah" booking, Whitening ad set, etc.) — the banner copy says "last known shape" but it's a hardcoded demo. **Capture screenshot evidence into `screenshots/states/error-console-fixture.png`** — this is the screenshot evidence DC-04 needs to upgrade if you want it at High.
- Repeat for `/decide`, `/escalations`, `/conversations`. Note any zone that goes blank rather than gracefully degrading.

Restart the API.

### D.4 Partial data

Pick one hook (e.g. `useAudit`). In `apps/dashboard/src/hooks/use-audit.ts`, force it to throw via `git stash`-wrapped temporary edit:

```bash
cd /Users/jasonli/switchboard/.worktrees/audit-01-dashboard-core
git stash push -u -m "audit-stub-temp"
# Edit apps/dashboard/src/hooks/use-audit.ts: in the queryFn, throw new Error("audit stub")
# Restart dashboard dev (it auto-reloads).
# Reload /console.
# Observe: does the activity zone gracefully degrade? Or does the whole page swap to fixture (per DC-04)?
git stash pop  # restore unconditionally
# If pop fails:
# git checkout -- apps/dashboard/src/hooks/
```

Document the partial-data behavior in a new finding if you find one (e.g. "Single hook failure replaces whole console with fixture" — though that's the architectural surprise the H subagent already noted; only file if it's distinct from DC-04).

---

## E. Responsive — the human-resizes dimension

DevTools → toggle device toolbar (Cmd+Shift+M).

For each width, walk the named tasks (B Task 1 Step 1–2 is enough — you're not re-walking the full task) and capture screenshots into `artifacts/01-dashboard-core/screenshots/responsive/`.

| Width | Profile | Captures |
|-------|---------|----------|
| 375 | iPhone SE | `375-console.png`, `375-decide.png`, `375-escalations.png`, `375-conversations.png` |
| 768 | iPad portrait | `768-console.png`, `768-decide.png`, `768-escalations.png`, `768-conversations.png` |
| 1024 | iPad landscape / small desktop | `1024-console.png`, `1024-decide.png`, `1024-escalations.png`, `1024-conversations.png` |
| 1440 | desktop | already captured in §A |

For each width per route, note:
- Layout breaks (overlapping content, content cut off).
- Tap targets too small (< 44px square).
- Bottom-tab nav badge visibility on `/escalations` (confirms DC-21).
- Floating chat button overlap with bottom-tab nav at 375px (confirms DC-22).
- Headings/copy readable at 375px without horizontal scroll.

File each new flow-breaking issue as a new `DC-NN` finding (Dimension: E).

---

## F. A11y — axe + keyboard walk + VoiceOver

### F.1 axe runs (auto)

```bash
cd /Users/jasonli/switchboard/.worktrees/audit-01-dashboard-core
pnpm audit:axe /console      docs/audits/2026-05-01-pre-launch-surface/artifacts/01-dashboard-core
pnpm audit:axe /decide       docs/audits/2026-05-01-pre-launch-surface/artifacts/01-dashboard-core
pnpm audit:axe /decide/<any-pending-approval-id>  docs/audits/2026-05-01-pre-launch-surface/artifacts/01-dashboard-core
pnpm audit:axe /escalations  docs/audits/2026-05-01-pre-launch-surface/artifacts/01-dashboard-core
pnpm audit:axe /conversations docs/audits/2026-05-01-pre-launch-surface/artifacts/01-dashboard-core
```

The runner needs the production build (it builds + starts on port 3002). Conflict warning: kill the dev server on Terminal 2 before running, or run on a different port (`PORT=3003 pnpm audit:axe ...`).

Outputs: `axe.json` (and `axe-meta.txt`) in the artifacts dir. After it runs, confirm the JSON exists and post-fact rename if you ran multiple routes (the runner writes `axe.json` each time — copy/move between runs).

Cross-reference axe rules against static findings:
- `button-name` violations on `/escalations` Send button → confirms DC-48.
- `label` / `form-field-multiple-labels` for operator-chat input + escalation textarea → DC-49, DC-50.
- `color-contrast` for muted/placeholder cells, blue reply banner, monospace conversation channel → DC-53.
- `region` / `landmark-no-duplicate-main` on /console → DC-55.
- `page-has-heading-one` on /console → DC-47.
- `aria-allowed-role` on `/conversations` filter pills → DC-57.

### F.2 Keyboard walk (Tab only — no mouse, no shortcuts)

Walk each route Tab-only. For each, note:
- **/console:** can you reach every queue-card primary/secondary/dismiss/stop button, every agent toggle, the Halt button? Is the focus ring visible (DC-51) against the warm-clay background? If a primary CTA is keyboard-unreachable → upgrade DC-51 from Medium to High; if multiple critical CTAs are unreachable → propose Launch-blocker.
- **/escalations:** Tab to first card header → Enter/Space to expand → confirm focus enters the body → Tab to reply input → Tab to Send. Send announces a name? (DC-48 — should fail today.)
- **/decide:** Tab through tab strip (Pending / Tasks / History) → confirm active tab is announced. Tab through ApprovalCard buttons.
- **/decide/[id]:** Tab to "Go back" icon button → through Approve/Reject.
- **/conversations:** Tab through filter pills (DC-57 — selection state announced?), then conversation toggles.
- **Floating operator-chat:** Tab to Chat button → Enter to open → focus enters input? (DC-49 — should fail today.)

### F.3 VoiceOver spot-check (Cmd+F5 to enable)

- **/console:** VO+CMD+H repeatedly. First heading should be H1; today expected H3 — confirms DC-47.
- **/escalations:** VO to Send button. Announcement: "Send reply, button" (after fix) or just "button" (today) → confirms DC-48.
- **/escalations:** VO through SlaIndicator. Does the Clock icon add noise ("graphic" before "Overdue")? → confirms DC-54.
- **/decide:** approve a card → confirm VO announces the toast.
- **/console:** trigger a hook error (block /api/dashboard/overview in DevTools Network). Does VO announce the error banner appearing? Expected silent → confirms DC-52.
- **operator-chat:** open the panel → VO into the input. Should announce "edit text" with no label today → confirms DC-49.
- **/conversations:** VO through filter pills. Active pill announced as selected? Today no → confirms DC-57.

### F.4 a11y calibration

For any High finding (DC-47, DC-48, DC-49) the keyboard walk confirms makes a critical path keyboard-unreachable, propose Launch-blocker upgrade at calibration. Spec §5 row F: axe-only evidence cannot upgrade past High; keyboard-walk evidence can.

---

## G. Performance — Lighthouse

Run the Lighthouse runner per route. The runner does its own production build + start, so kill the dev server on Terminal 2 first.

```bash
cd /Users/jasonli/switchboard/.worktrees/audit-01-dashboard-core
pnpm audit:lighthouse /console      docs/audits/2026-05-01-pre-launch-surface/artifacts/01-dashboard-core
pnpm audit:lighthouse /decide       docs/audits/2026-05-01-pre-launch-surface/artifacts/01-dashboard-core
pnpm audit:lighthouse /escalations  docs/audits/2026-05-01-pre-launch-surface/artifacts/01-dashboard-core
pnpm audit:lighthouse /conversations docs/audits/2026-05-01-pre-launch-surface/artifacts/01-dashboard-core
```

Outputs: `lighthouse-desktop.json`, `lighthouse-mobile.json`, `meta.txt`. Same overwrite-per-run caveat as axe — rename or move per route.

When all four are done, return to me with the artifact file list. I'll read the JSON and file findings against the spec §G thresholds:
- Performance score < 70
- LCP > 2.5s desktop / > 4s mobile
- TBT > 300ms
- CLS > 0.1
- Accessibility score < 90 (overlap with F is fine)
- Unique unused-bytes savings > 100 KB

---

## H. Two-tenant browser repro (confirms / upgrades I-light DC-11 + checks DC-13)

Per spec, suspected cross-tenant cache leaks must be confirmed in-browser before escalating to Launch-blocker. **If any of these reproduce, DC-11 becomes Launch-blocker (data leak — hard-prohibited from ship-with).**

### Pre-condition

Two test tenants, A and B, each with at least 1 pending approval and 1 escalation. Note the distinguishing data points (lead names, conversation IDs).

### Repro 1 — Sign-out and Back

1. Sign in as Tenant A in Browser 1 (regular window).
2. Navigate to `/console`. Note the visible data points (pending approval count, escalation lead names).
3. Sign out (top-right menu → Sign out).
4. Browser Back button.
5. **Expected:** redirect to `/login`, no Tenant A data visible.
6. **Failure mode:** Tenant A's `/console` re-renders briefly from cache before redirect → confirms DC-13 + escalates DC-11.

### Repro 2 — Sign in as different tenant in same browser

1. Sign in as Tenant A in Browser 1. Visit `/console` and note data.
2. Sign out.
3. Sign in as Tenant B in the same browser, same tab.
4. Watch `/console` carefully on first paint.
5. **Failure mode:** Tenant A data flashes before Tenant B data loads → confirms cross-tenant cache leak → upgrade DC-11 to Launch-blocker.

### Repro 3 — Two-tab cross-tenant

1. Tab 1: Tenant A signed in, on `/console`.
2. Tab 2: same browser, sign in as Tenant B.
3. Switch back to Tab 1 *without* hard reload.
4. **Expected:** Tab 1 still shows Tenant A data.
5. **Failure mode:** Tab 1's React Query cache pulls Tenant B data on next refetch → upgrade DC-11.

If any of the three repros reproduce, file a one-line note on DC-11 in the findings doc with the route + reproduced step, and propose Launch-blocker at calibration.

---

## I. After the walk — bring back to me

Return with:

1. **Screenshots committed under `artifacts/01-dashboard-core/screenshots/`.**
2. **State + responsive notes** — anything unexpected, including any new findings to file.
3. **axe JSON files** in `artifacts/01-dashboard-core/`.
4. **Lighthouse JSON files** in `artifacts/01-dashboard-core/`.
5. **Two-tenant repro result** — did any of the three reproduce?
6. **DC-23, DC-34 verification** — production agentNotifier behavior + operator-chat example commands.
7. **Subjective walk impressions** — anything about flow, IA, or copy that didn't show up in code-read.

Then we run the calibration ritual (every Launch-blocker / High proposed gets confirm/upgrade/downgrade), validate, set `session_closed`, delete this walk doc + the progress doc, commit, and PR.
