# E4c Slice C — the LIVE TRIGGER (SURFACE) — design + TDD plan

Brainstormed (autonomous; loop-prompt intent fixed, pressure-tested against the real submit()). SURFACE: touches PlatformIngress (ingress merge-stop glob) -> human merges. Worktree `.claude/worktrees/ai-e4c-trigger` (branch `feat/ai-e4c-live-trigger`), built off origin/main 2e7b6da71 (A #1230 + B #1235 merged).

## Resolved design (both forks closed)

- **PLACEMENT = B (central callback).** Add `onWorkUnitComplete?: (info: { organizationId: string; workUnitId: string }) => void` to `PlatformIngressConfig` (after `approvalNotifier`, same best-effort doc posture). A private `fireWorkUnitComplete(workUnit)` mirrors the `approvalNotifier` double-safety (`try { cb() } catch {}`) and is called before each PROCESSED ok:true return. Wired ONCE in app.ts to the db-backed exporter (RecommendationEmitter-style; core stays db-free).
- **FLAG = reuse `OTEL_EXPORTER_OTLP_ENDPOINT`** (NO new env var, NO env-allowlist / .env.example change). Gate at app.ts boot via `isWorkUnitTracingEnabled()`; the callback is `undefined` when off -> `fireWorkUnitComplete` early-returns = full no-op (no DB read). The exporter also re-checks the gate (defense in depth). Cost (2 DB reads/work unit) is fire-and-forget off the response path; negligible at this system's volume. SURFACE is driven by the PlatformIngress touch, not an env var.
- **FIRE SITES (verified return map, platform-ingress.ts):** before :287 (governance-error->deny, persistTrace :280), :300 (deny, persistTrace :293), :384 + :394 (require_approval w/ + w/o lifecycle; persistTrace :314 precedes BOTH), :501 (success; finalize :488 / persist :490). 5 sites; each submit hits exactly ONE (fire-once-per-submit).
- **DO NOT FIRE:** idempotency replays (:178/:180 — already exported on first submit; double-export hazard), ok:false legs (no workUnit: :187/:202/:216/:233 pre-normalize, :412/:427 claim conflicts), the failed-execution THROW (:461 finalizes then `throw` :479). **V1 LIMITATION (documented):** failed-execution traces are sealed but not exported (no ok:true return); a follow-up may fire in the catch before the rethrow.

## Safety invariant -> mechanism (NON-NEGOTIABLE)

- void/not-awaited: callback returns void; app.ts hook does `void exportWorkUnitSpans(...).catch(...)`; submit never awaits -> response latency unchanged.
- error-SWALLOWING: `fireWorkUnitComplete` try/catch (sync throw) + the hook's `.catch` (async rejection). A throwing exporter/store/OTLP error can NEVER reach the submit caller. TESTED both layers.
- read-only: `exportWorkUnitSpans` only reads stores + emits to the OTel sink; no WorkTrace write; no 2nd source of truth (E4b property, unchanged).
- gated: callback undefined when OTLP off -> no-op.
- tenant-safe: passes `workUnit.organizationId`; exporter tenant-guards `wt.trace.organizationId === orgId` (E4b).
- fire-once-per-submit: 5 mutually-exclusive returns.

## Files (5)

- `packages/core/src/platform/platform-ingress.ts`: +config field, +`fireWorkUnitComplete` helper, +5 fire calls (~516 -> ~535 ln, <600).
- `packages/core/src/platform/__tests__/platform-ingress-work-unit-complete.test.ts` (NEW): mirror the approval-notify harness.
- `apps/api/src/telemetry/work-unit-span-export.ts`: +`buildWorkUnitSpanExportHook(deps): (info) => void`.
- `apps/api/src/telemetry/__tests__/work-unit-span-export.test.ts` (extend): hook + seam tests.
- `apps/api/src/app.ts`: wire `onWorkUnitComplete = isWorkUnitTracingEnabled() ? buildWorkUnitSpanExportHook({ executionTraceStore: new PrismaExecutionTraceStore(app.prisma), workTraceStore: app.workTraceStore ?? undefined }) : undefined`.

## TDD steps (RED proof per step)

1. **[core] field + success-leg fire.** RED: spy `onWorkUnitComplete`; submit a SUCCESS -> expect spy called ONCE with `{organizationId, workUnitId}` == workUnit (fails: no field/fire). GREEN: add config field + helper + the :501 fire.
2. **[core] all processed legs + exclusions.** RED: deny + require_approval (both lifecycle on/off) + governance-error each fire once; a replay (idempotencyKey hit) fires 0; an ok:false intent-not-found fires 0. GREEN: add :287/:300/:384/:394 fires.
3. **[core] throw-safety + gated.** RED: a THROWING `onWorkUnitComplete` -> submit STILL returns ok:true (result + timing unaffected), does not reject; and no callback configured -> submit works (0 fire). (Helper try/catch makes GREEN.)
4. **[apps] the hook.** RED: `buildWorkUnitSpanExportHook(deps)` returns a fn; firing it (with `OTEL_EXPORTER_OTLP_ENDPOINT` stubbed) calls the exporter path so `deps.executionTraceStore.findByWorkUnitId` is invoked with `(orgId, workUnitId)`; a THROWING/ rejecting exporter is swallowed (hook returns void, never throws, no unhandled rejection); gated-off (no env) -> no store read. GREEN: implement the hook. + a compile-time assertion that the hook's return type satisfies `PlatformIngressConfig["onWorkUnitComplete"]` (seam contract) and that real `PrismaExecutionTraceStore`/`PrismaWorkTraceStore` form a valid `WorkUnitSpanExportDeps`.
5. **[apps] app.ts wiring.** typecheck-covered; the gate + hook are unit-tested; the real-store assignability is pinned in step 4. Note in the SURFACE PR for human verification (producer-population).

## VERIFY + SURFACE

Full gates (incl. `pnpm build`, `--filter api test`, `--filter core test`, verify-fast, audit) + independent fresh-context review (0 sev>=warn; MUST check: telemetry can't block/break the request or read path, one-directionality, the seam holds vs the real stores, core stays db/otel-free, the wrapper actually swallows). Then SURFACE the PR with evidence (NO auto-merge — PlatformIngress stop-glob). Mark backlog + memory; declare E4 COMPLETE; STOP.
