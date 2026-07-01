# Second-wave gap-eval — THIN DISPATCHER ledger

Workstream: `docs/audits/2026-06-22-second-wave-gap-eval/README.md`.
Dispatcher = thin; subagents implement in isolated worktrees. Alex-tool cluster (P2-2/3/4/5/6/7/8/9 + P2-18) DONE — never re-touch.
Each line: `gap | agentId | branch | outcome | PR | notes`. Append-only; update outcome on completion.

## Disjointness / ownership rules (so parallel waves don't collide)

- Only ONE in-flight slice may edit the SwitchboardMetrics registry files (packages/core + apps/api + apps/chat). Currently: **FREE** (B merged #1340; D/H/I were all told no-metrics, so a future slice may own it).
- Robin gaps D (P2-13) & F (P2-14) share Robin send/retry files -> never same wave.
- Quinn gaps C (P2-16) & G (P2-17) share packages/core/src/approval/_ -> never same wave. C is SURFACED/UNMERGED (#1341 awaiting human), so G off main lacks C's approval/_ changes -> dispatch G only AFTER C merges (or stack G on C) to avoid a conflict.
- Next dispatchable when a slot frees (F waits on D's robin files, G waits on C-merge): H (P2-19 flywheel) or I (P2-20 reconciliation) -- both independent of D/E and of pending C.

## Priority list (A..M) status

- A website-scan SSRF redirect ......... MERGED #1338 (squash c7423bc); worktree torn down. OOS follow-up: pre-existing TOCTOU/DNS-rebind in page-fetcher.ts (platform-wide, NOT dispatched)
- B instant-form {ok:false} swallow ..... MERGED #1340 (squash e3207ef, after rebase-nudge cleared a mergeable=UNKNOWN stall); worktree torn down; instantFormLeadIntakeFailed in all 3 registries; remote branch auto-deleted
- C P2-16 quinn approved-strand ......... SURFACED #1341 (CI green, reviews clean; adversarial 2 CRIT verified pre-existing/OOS, noted in PR); worktree torn down; AWAITING HUMAN MERGE (governance spine)
- D P2-13 robin crash-orphaned claim .... MERGED #1347 (squash 3d8e980); worktree torn down; double-send-safe guarded-CAS reaper, adversarial cleared re-grant race. LESSON: store-mutation orgId gate = check-routes.ts --mode=error, NOT in local arch:check/local-verify-fast -> add to VERIFY for updateMany/deleteMany slices (refines feedback_store_mutation_org_scope_gate)
- E P2-11 mira revenue_proven cap ....... MERGED #1348 (squash 2682603); worktree torn down. Residuals telemetered/warned (>1000 orgs alpha-tail, >500 pending/org), beyond pilot scale
- H P2-19 flywheel ROI breakdown empty .. SURFACED #1349 (correctness clean; adversarial CRITICAL = RedisStreamConversionBus.emit drops agentDeploymentId, fix in OPEN sibling #1342 redis-drainer -> deferred to avoid collision); InMemory funnelByAgent WORKS, Redis needs 1-line serialization via #1342/follow-up; worktree torn down; AWAITING HUMAN MERGE
- F P2-14 robin getSendContext throw .... ALREADY-DONE (verified drop): closed by #1271 (2026-06-25, POST-dates audit). robin-recovery-executor.ts:246-265 try/catch->warn->claimAndRequeueContextFailure->markFailed(nextRetryAt); double-send-safe (pre-send); 3 tests present; executor byte-identical to #1271. Audit README P2-14 STALE. No code change, worktree auto-cleaned
- G P2-17 quinn lifecycle expiry caller . pending (waits on C)
- H P2-19 flywheel ROI breakdown empty .. pending
- I P2-20 reconciliation alltime-vs-7d .. SURFACED #1350 (18/18 CI green; added countConfirmedInWindow + reused countCurrentlyAtStageUpdatedInWindow -> like-for-like 7d windows; also fixed a zero-expected drift-math blind spot adversarial caught; 1 standing minor warn = documented half-open updatedAt vs closed occurredAt boundary, immaterial vs 1%/5% floors); worktree torn down; AWAITING HUMAN MERGE
- J P3-7 proof-chain paidVisits first-win MERGED #1351 (squash 5fb61b69; dispatcher completed the merge server-side after the agent crashed post-PR -- both reviews clean + CI green per PR body: receipt-gate prefers T1 over Noop + stable campaign ORDER BY)
- K P3-8 ledger digest DASHBOARD_URL .... MERGED #1352 (squash ad2c0264, inline redo): resolveReportLink() + both-renderer omit guards (apps/api weekly-report-delivery.ts + core weekly-digest.ts text line); core 11/11 + api 12/12 GREEN, typecheck clean, all CI green
- L/P3-3 alex resched/cancel approval ... ALREADY-DONE (verified drop): closed by #1264 (2026-06-25, post-audit) -- overrides broadened {guided}->{supervised,guided} to match booking.create. Real defect was a supervised-trust DEAD-END (no in-skill parking), NOT over-broad auto-approve; my "require-approval" framing was BACKWARDS (would regress #1264) -> subagent correctly refused. README P3-3 STALE. Residual: deferred F2 operator-park (separate workstream)
- L/P3-4 alex CTWA referral unsupported . MERGED #1353 (squash 83257aaa, inline redo): extractReferralData added to parseUnsupportedMessage (whatsapp-parsers.ts), RED-proven reaction+referral test; chat 79/79 GREEN, typecheck clean, all CI green
- M (expect SURFACE) P2-15 casey STOP; P3-6 mira concept.draft; P2-12 mira DALL-E; P2-21 lifecycle-sweep .. pending

## Wave 1 (dispatched 2026-06-26)

- A | ab1c532c9d9bae0c1 | fix/website-scan-ssrf-redirect | DISPATCHED | - | NOT-spine -> auto-merge if clean; no metrics
- B | a9eb66c7af66be8d4 | fix/instant-form-submit-observability | DISPATCHED | - | leaf adapter -> auto-merge if clean; OWNS metrics counter
- C | abdf9d44080165db5 | fix/quinn-approved-strand-recovery | DISPATCHED | - | spine (approval) -> SURFACE-only
