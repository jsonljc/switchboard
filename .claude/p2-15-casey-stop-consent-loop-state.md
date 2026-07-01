# p2-15 casey STOP-consent durable-revoke loop — externalized state (scratch, not committed)

Durable record lives in memory note project_second_wave_gap_eval_2026_06_22 (2nd-wave SCOREBOARD).

STATUS: MERGED to main @ 0a98d94fa (squash of PR #1361), 2026-06-27. Worktree removed + branch deleted.

Goal: a WhatsApp STOP must fail CLOSED on its durable PDPA revocation write so a swallowed
`consentRevokedAt` failure can never confirm an opt-out that does not suppress future proactive sends.
Authority: SURFACE-ONLY by default; user (human merge authority for the consent merge-stop) explicitly
authorized the merge after review completed. Task-size: standard
Base: origin/main @ 6ef469106 -> merged onto 78f6494f9 (only #1360 docs/.claude landed between, disjoint).
merge_safety: stop-glob touched=YES (`**/*consent*` + channel-gateway) -> SURFACE-before-merge mandatory.
independent_review=<pending>

## Ground truth (tool-backed, base 6ef469106)

- STOP-keyword terminal branch `packages/core/src/channel-gateway/channel-gateway.ts:264-302`:
  `recordMessagingOptOut` (line 270, un-wrapped -> propagates) then, if `consentRevocationGate`
  wired, `recordRevocation` (282-298, in a try/catch that SWALLOWS the failure: console.error +
  "best-effort" comment), then `replySink.send(OPT_OUT_CONFIRMATION)` UNCONDITIONALLY (line 300).
- Suppression of future proactive sends: `proactive-eligibility.ts evaluateProactiveSendEligibility`
  step 1 blocks on `consentRevokedAt` (revocation always blocks); step 2 `canSendWhatsAppTemplate`
  (`whatsapp-window.ts:25`) returns allowed whenever inside the 24h window REGARDLESS of
  `messagingOptIn`. A STOP is itself inbound -> window freshly open -> within-window
  `messagingOptIn=false` is inert -> `consentRevokedAt` is the SOLE within-window suppressor.
- BUG: a swallowed `recordRevocation` failure leaves `consentRevokedAt` null yet still sends the
  "you're unsubscribed" confirmation. A proactive cron within 24h is NOT suppressed = PDPA leak +
  false confirmation.
- `recordRevocation` (`consent-service.ts:245-308`) is idempotent (`setRevocationIfNotRevoked` ->
  `wasNewlyRevoked` early-return) and its durable write is the first side-effect -> safe to
  propagate + retry/replay.
- Sibling precedent: `runConsentRevocationGate` enforce path (`consent-revocation-gate.ts:100-112`)
  already does it right: `await recordRevocation(...)` NO swallow, then ack only after success.
- Callers: `managed-webhook.ts:230-257` (WhatsApp) and `main.ts:356-389` (telegram, never hits the
  WA branch) both wrap `handleIncoming` in try/catch -> failed-message DLQ -> 200. So a propagated
  throw = no false confirmation + DLQ capture (durable/observable), no Meta retry storm, no
  unhandled rejection. `widget-messages.ts` is web_widget (not whatsapp).
- Existing test `channel-gateway-opt-out.test.ts:245-266` ENCODES the buggy intent ("best-effort",
  confirmation still sent on failure) -> must be INVERTED.

## Design decision (brainstorm, autonomous)

Approach A — fail-closed propagate (mirror the sibling). Remove the swallowing try/catch around
`recordRevocation`; `OPT_OUT_CONFIRMATION` is reached only if the durable revoke resolved. Keep
`recordMessagingOptOut` FIRST (its success is the safer partial-failure state for the outside-window
case). Rejected: B in-handler retry (extra surface, slows ack, sibling doesn't retry, DLQ already
replays); C cross-store transaction (two store interfaces in core, no shared Prisma tx at this
layer — layering violation, out of scope). No new SwitchboardMetrics counter — failure is already
non-silent (error log + DLQ), unlike the silent P1-6 fail-open.

## Plan (TDD)

| step | done-condition (test/cmd)                                                                                        | RED proof | status | evidence |
| ---- | ---------------------------------------------------------------------------------------------------------------- | --------- | ------ | -------- |
| 1    | RED: invert opt-out test to assert fail-closed + add happy-path ordering assert; run -> fails on current swallow | yes       | todo   |          |
| 2    | GREEN: remove the try/catch in the STOP branch; confirmation only after durable revoke                           | n/a       | todo   |          |
| 3    | run opt-out test file -> green; `tsc --noEmit` core                                                              | n/a       | todo   |          |
| 4    | commit (lowercase subject, no em-dash, trailer)                                                                  | n/a       | todo   |          |
| 5    | VERIFY gates + 2 Explore reviewers (correctness + adversarial) on three-dot diff; fix >=warn                     | n/a       | todo   |          |
| 6    | rebase onto latest origin/main; gh pr checks all green; open PR; SURFACE                                         | n/a       | todo   |          |

### Task 1 — RED: fail-closed contract test

File: `packages/core/src/channel-gateway/__tests__/channel-gateway-opt-out.test.ts`

- REPLACE the test "does not block opt-out confirmation when PDPA mirror fails" (lines 245-266) with
  a fail-closed assertion: when `recordRevocation` rejects, `handleIncoming` REJECTS, the
  OPT_OUT_CONFIRMATION is NOT sent (`send` not called), skill dispatch (`submit`) not called, and
  `recordMessagingOptOut` WAS called (ran before the revoke).
- STRENGTHEN the happy-path test (lines 208-243) to assert ordering: `recordRevocation`'s
  invocationCallOrder < `send`'s (ack only after the durable revoke).
- RED expected: the inverted test fails on current code (handleIncoming resolves, send called once).

### Task 2 — GREEN: fail closed in the STOP branch

File: `packages/core/src/channel-gateway/channel-gateway.ts` (the `if (this.config.consentRevocationGate)`
block inside the opt-out branch). Remove the surrounding `try { ... } catch (err) { console.error(...) }`
so a `recordRevocation` rejection propagates; replace the "best-effort" comment with a fail-closed
rationale. `await replySink.send(OPT_OUT_CONFIRMATION)` stays after the block, now gated on success.

### Task 3 — verify package

`pnpm --filter @switchboard/core test -- channel-gateway-opt-out` green; `pnpm --filter @switchboard/core exec tsc --noEmit` clean.

### Task 4 — commit

`fix(core): fail closed on the whatsapp stop pdpa revocation write (p2-15)`

gate_results: typecheck=PASS test=PASS(core; full-test had 4 unrelated flaky chat timeouts, green in isolation) lint=PASS format=PASS arch=PASS verify-fast=PASS security=PASS build=n/a(no app pkg) eval=n/a(no engine change; CI Governance Decision green) review=correctness CLEAN / adversarial LEAK-FOUND(out-of-scope residual: DLQ not auto-drained)
merge_safety: stop-glob touched=YES consent -> SURFACE-ONLY. PR #1361 opened. independent_review: correctness CLEAN; adversarial surfaced residual (no DLQ auto-replay) -> documented in PR human-verify note, scope = separate larger follow-up.
carry_forward: P2-15 SURFACED as PR #1361 (commit b746070dd). Two-file core-only fail-closed fix: removed the swallow on the STOP-keyword recordRevocation so a failure propagates (no false opt-out confirmation) + lands in the failed-message DLQ; ack only after durable revoke. Disjoint from #1337 (read-side) + #1357 (other test files). RESIDUAL (surfaced, NOT in this PR): the failed-message DLQ has no auto-drain/replay and the manual /retry only bumps a counter, so a persistent recordRevocation outage leaves consentRevokedAt null until acted on -> auto-replay / consent outbox is a separate backlog item. CONVERGE = human merge call.

## Log

- 2026-06-27: ORIENT+BRAINSTORM+PLAN done. Worktree .claude/worktrees/stop-consent-failclosed off origin/main@6ef469106. Gap confirmed real. Approach A selected.
- 2026-06-27: EXECUTE (TDD RED->GREEN) + VERIFY (gates green; 2 reviewers) + SURFACE. PR #1361. Adversarial residual (DLQ no auto-replay) documented as out-of-scope follow-up. Awaiting CI + human merge.
