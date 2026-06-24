# E4c Slice 2 — LIVE TRIGGER wiring (SURFACE; needs a human decision before build)

> Handoff scratch (uncommitted). Slice 1 (the timeline/quality fix) is the prerequisite and is being merged separately (PR #1220). Slice 2 makes the projection actually FIRE in production. It is SURFACE because it touches the ingress submit path and/or the env-allowlist — both merge-stop globs.

## What Slice 2 must do

Call the existing, merged, read-only `exportWorkUnitSpans(deps, orgId, workUnitId)` (`apps/api/src/telemetry/work-unit-span-export.ts`) AFTER a work unit completes, as a best-effort, non-blocking, error-swallowing side effect. The projection then reads the trajectory + emits the (now honestly-timed, post-Slice-1) OTel span tree to the configured OTLP collector.

## Ground truth (verified at E4c ORIENT, current main)

- `PlatformIngress.submit` (`packages/core/src/platform/platform-ingress.ts:93-502`) is SYNCHRONOUS; returns `{ ok: true, result, workUnit }`; `workUnit.id` + `workUnit.organizationId` are in scope at every return (incl. the deny/require_approval/governance-error early returns). Finalize happens INSIDE submit (`tracePersister.finalizeTrace`, ~:488) — that seam is CORE (Layer 3) and CANNOT call the apps exporter (layer violation; the exporter needs `@switchboard/db` stores).
- Stores: `app.prisma` (decorated, app.ts:399) + `app.workTraceStore` (decorated, app.ts:508). NO `executionTraceStore` decoration — construct on the fly: `new PrismaExecutionTraceStore(app.prisma)` (precedent: `routes/marketplace.ts:758`).
- The exporter's deps shape is provably assignable to the real Prisma stores (E4b reviewer compiled the probe): `{ executionTraceStore: { findByWorkUnitId }, workTraceStore?: { getByWorkUnitId } }`.
- Gating today: `isWorkUnitTracingEnabled()` = `Boolean(process.env.OTEL_EXPORTER_OTLP_ENDPOINT)` — the SAME switch the OTel SDK init uses. Only `OTEL_EXPORTER_OTLP_ENDPOINT` + `OTEL_SERVICE_NAME` are env-allowlisted.
- The projection chain is currently UN-TRIGGERED in prod (callers = tests only).

## DECISION 1 — trigger placement (the user's call; touches the ingress invariant)

- **(A) route-side-effect:** append `void exportWorkUnitSpans({ executionTraceStore: new PrismaExecutionTraceStore(app.prisma), workTraceStore: app.workTraceStore }, workUnit.organizationId, workUnit.id).catch((e) => app.log.warn(...))` after the `submit()` await in apps routes (`actions.ts:96`, `execute.ts:127`, ...). Minimal blast radius per-site; PARTIAL coverage (misses the cron/contained-workflow submit paths in `bootstrap/`); touches the ingress submit path -> SURFACE. ~20+ call sites if you want full coverage this way (don't — that's the case for B).
- **(B) [RECOMMENDED] central `onWorkUnitComplete?` callback on `PlatformIngressConfig`:** add an optional `onWorkUnitComplete?: (info: { organizationId: string; workUnitId: string }) => void` to `PlatformIngressConfig` (platform-ingress.ts:44-64, alongside the existing fire-and-forget `approvalNotifier`); invoke it once post-finalize at every return (wrap in try/catch, never await). Wire it ONCE in `app.ts` to the db-backed exporter (RecommendationEmitter-style callback injection — core stays db-free, apps provides the effect). FULL coverage (all submit paths, incl. crons). Touches core PlatformIngress (stop-glob) -> SURFACE. Cleaner + complete; slightly bigger core diff.
- (C) cron-sweep over recently-completed work units: REJECTED (new cron -> route/cron-allowlist; a 2nd source of "what completed"; added latency).

## DECISION 2 — the enable flag (the user's call; a new var = env-allowlist stop)

- **(i) reuse `OTEL_EXPORTER_OTLP_ENDPOINT`:** no new env var; the projection fires whenever OTLP is configured. Simplest. BUT couples "OTLP on for HTTP/infra spans" to "run the per-work-unit projection," which does 2 DB reads (`findByWorkUnitId` + `getByWorkUnitId`) per work unit.
- **(ii) dedicated `OTEL_WORK_UNIT_SPANS_ENABLED` (or similar):** decouples the per-work-unit DB-read projection from general OTLP; safer for prod cost/load control. A NEW env var -> add to `scripts/env-allowlist.local-readiness.json` (required_in_env_example) + `.env.example` (same commit) -> env-allowlist merge-stop -> SURFACE.

## Safety invariants (NON-NEGOTIABLE — telemetry must never block/break a request or read path)

1. `void`-ed / NOT awaited on the request path — the request returns regardless of the export.
2. Error-SWALLOWING — wrap in `.catch(e => log.warn(...))` (or try/catch in the callback); a thrown exporter/store/OTLP error can NEVER propagate to the caller. ADD A TEST: a throwing exporter does not reject the submit caller.
3. Read-only — `exportWorkUnitSpans` only reads stores + writes to the OTel sink; no WorkTrace write; never a 2nd source of truth (already true from E4b; keep it).
4. Gated — no-op (no DB read) unless configured (`isWorkUnitTracingEnabled()` early-returns).
5. Tenant-safe — the exporter already tenant-guards WorkTrace enrichment on `wt.trace.organizationId === orgId` (E4b). Keep.

## Suggested slice shape (once the user picks A/B + i/ii)

- If **B + ii** (recommended): (1) add `onWorkUnitComplete?` to PlatformIngressConfig + invoke post-finalize with a try/catch [core; ingress stop-glob -> SURFACE]; (2) add the dedicated flag + allowlist + `.env.example` [env-allowlist stop-glob -> SURFACE]; (3) wire the callback in app.ts to `exportWorkUnitSpans` with the db-backed deps; (4) tests: callback fires once per submit (incl. deny/approval paths); a throwing exporter never breaks submit; gated-off = no-op. TDD throughout. Then optionally a real end-to-end OTLP smoke against a local collector (OPTIONAL; must not make any unit test depend on a running collector).
- Real OTLP validation of the TIMELINE (the waterfall actually renders with Slice 1's timing) belongs here — stand up a local Jaeger/Tempo + OTLP collector, set the endpoint, run one real work unit, eyeball the waterfall. OPTIONAL but it's the payoff that proves Slice 1 + Slice 1.1 + Slice 2 together.

## Deferred E4c follow-ups to fold into Slice 2 (planned, not yet done)

These came out of the Slice 1 + Slice 1.1 post-merge reviews; they land naturally with Slice 2's real-collector work:

1. **Real-SDK `InMemorySpanExporter` test** pinning the adapter->SDK leg. Today every timing test asserts the in-memory `RecordingTracer` (the adapter contract), not a real `@opentelemetry/sdk-trace-base` export. Add a test (apps layer, which legitimately depends on OTel) that wires `createOTelTracer` to a `BasicTracerProvider` + `InMemorySpanExporter`, projects a small tree, and asserts the FINISHED spans carry the right start/end/kind/parenting. Needs `@opentelemetry/sdk-trace-base` as a (dev)dependency — do it here, alongside the live OTLP export. This would have caught the Slice-1.1 inversion bug at the unit level.
2. **`gen_ai.system` vs `gen_ai.provider.name` semconv coherence.** E4b set `gen_ai.system="switchboard"`; Slice 1 added `gen_ai.provider.name="anthropic"`. In OTel GenAI semconv these denote the SAME concept (the model provider), so a span declaring both is incoherent. Fix: put the real model provider on `gen_ai.provider.name="anthropic"` (drop/migrate `gen_ai.system`), and express "Switchboard orchestrated this" via the existing `switchboard.*` vendor namespace. Do this BEFORE dashboards/queries are built on the ambiguous pair (i.e. before or with the live trigger). Touches `work-unit-spans.ts` (an E4b-set attribute), telemetry-only.
3. **(low) `emitToolSpan` cyclomatic complexity = 17 (max 15, warn-only).** Extract the tool attribute-emission into a small pure helper if touching the file again. Non-blocking; no CI gate.
