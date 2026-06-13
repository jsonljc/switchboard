# F11: agent activityStatus time-decay

- Date: 2026-06-13
- Branch: `fix/activity-status-decay`
- Audit: `docs/audits/2026-06-10-alex-capability-audit` (F11, the last open backlog item)

## Problem

`deriveAgentStates` (`packages/db/src/storage/agent-state-deriver.ts`) pins each
role's `activityStatus` to its most recent audit event via
`state.activityStatus = STATUS_FROM_EVENT[entry.eventType] ?? "idle"`. The status
never decays. `action.proposed` maps to `"working"`; if no later event arrives for
that role, the agent shows "Working" for as long as that event stays inside the
route's lookback window. The consumer route (`apps/api/src/routes/agents.ts`)
fetches the last 24h of audit entries, so one proposal can render "Working" for up
to 24 hours after the agent actually stopped. The dashboard (`useAgentState`, polls
every 60s) and the Home/Team views (which count `working`/`analyzing` as "actively
working") therefore show a stale live indicator.

## Decision summary

1. Decay at read time, inside `deriveAgentStates`. No new column, no migration, no
   cron. Deterministic and unit-testable. Transparent to every consumer (output
   stays within the existing status union).
2. Inactivity threshold: 10 minutes (`ACTIVITY_STATUS_STALE_MS = 10 * 60_000`).
3. Decay only the transient "in progress" statuses, `"working"` and `"analyzing"`;
   they revert to `"idle"`.
4. `"waiting_approval"` and `"error"` do not decay. `"idle"` has nothing to decay.
5. Thread an injectable `now: Date = new Date()` so tests are deterministic, and
   guard the elapsed comparison with `Number.isFinite` so a missing or NaN
   timestamp decays to idle rather than silently reading as fresh.

## Rationale

**Where (read time).** The status is already derived on demand from audit rows;
decay is a pure function of `(status, lastActionAt, now)`. A stored or cron
approach would add a column, a migration, and a writer for zero benefit, since
nothing persists `DerivedAgentState` (the API computes it per request). Verified:
no schema change is required.

**Threshold (10 min).** `"working"` is produced only by `action.proposed`. In the
agent loop a proposal is normally followed within seconds to a couple of minutes
by execution, denial, an approval gate, or an error. A gap longer than 10 minutes
means the agent is no longer actively working on that proposal. 10 minutes is
generous enough that a genuine multi-step burst (propose, wait, execute) does not
flicker to idle, and far below the 24h lookback so staleness is bounded to minutes
rather than hours. The dashboard polls `/state` every 60s, well below 10 min, so
the indicator does not oscillate: status is monotonic toward idle absent a new
event, and any new event is a legitimate update.

**Decay target (`idle`, not a new state).** The audit asks only to stop the stale
"Working", not to add a state. `"idle"` is already in the union and rendered by
every consumer, so reverting to it needs zero consumer change. A new `"stale"`
state would touch six dashboard files plus the wire type for no product gain.

**Which statuses decay.** `"working"`/`"analyzing"` are transient claims that the
agent is doing something right now, so they go stale. `"waiting_approval"` reflects
a genuine outstanding approval that can legitimately sit for hours or days; decaying
it would hide a real pending action, so it must not decay. `"error"` is a sticky
diagnostic of the last action's failure, not a false in-progress claim; leaving it
avoids masking a real error and keeps the change tight. (`STATUS_FROM_EVENT` never
emits `"analyzing"` today; decaying it is forward-looking and harmless.)

**Clock and NaN guard.** Decay compares `lastActionAt` against `now`, so `now` is
injected (default `new Date()`) and also used to derive `todayStart`, making the
whole function deterministic under test. A transient status is kept only when
`Number.isFinite(elapsed) && elapsed <= threshold`; otherwise it decays to idle.
This follows the NaN-blind-gate lesson: a raw `elapsed > threshold` is false for a
NaN elapsed (missing or invalid timestamp), which would silently preserve the very
stale "Working" we are removing.

## Consumer impact

None require changes. `deriveAgentStates` keeps its return type; the only API change
is an added optional `now` parameter whose default preserves current behavior, so
the single caller `apps/api/src/routes/agents.ts:178` is unaffected. Dashboard
consumers (Team page, agent-card, home-page, team-band, agent-config-identity,
agent-status-visual) switch on the status string and are transparent to
`working` to `idle`. The Home/Team "actively working" count becomes more accurate.

## Test plan (TDD, mocked clock)

Add to `packages/db/src/storage/__tests__/agent-state-deriver.test.ts`, all with an
injected fixed `now`:

- a `"working"` (`action.proposed`) event older than the threshold decays to `"idle"`
- a recent `"working"` event (within threshold) stays `"working"`
- boundary: exactly at the threshold stays `"working"`; just past it decays
- `"waiting_approval"` older than the threshold does NOT decay
- `"error"` older than the threshold does NOT decay
- an invalid (NaN) timestamp on a `"working"` event decays to `"idle"` (NaN guard)
- existing tests still pass via the default-`now` path (one-arg call preserved)

## Scope and non-goals

F11 only: `activityStatus` decay in the deriver plus its tests. No migration. No
consumer changes. Not touching F8 (shipped) or other stores/routes. If a schema
change turned out to be required, the slice would be re-scoped; it is not.
