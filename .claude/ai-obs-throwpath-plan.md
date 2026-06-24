# Slice 2 plan — fire onWorkUnitComplete on the failed-execution throw path (TDD, [SURFACE])

#1236 documented a v1 limitation: the failed-execution rethrow path does NOT fire the
work-unit-complete hook, so failed work units never render a span. The 4 ok:true legs
(governance-error / deny / require_approval / success) already fire. This adds the 5th fire in the
catch, before the rethrow. ONE source line + the test harness. File:
`packages/core/src/platform/platform-ingress.ts` (+ its execution-error test).

SURFACE: touches PlatformIngress (the mutating entry + governance stop-glob) -> a human merges.

## VERIFY-FIRST (confirmed, platform-ingress.ts on c201ebda9)

The catch at :464 seals the trace (`finalizeTrace` :477 keyed / `persistTrace` :479 non-keyed) and
records the infra failure (:489-494), THEN `throw executionErr;` (:495). `workUnit` is in scope.
`fireWorkUnitComplete` (:527) already exists with a try/catch swallow. Firing here is safe: the trace is
sealed before the throw, and the throw path is mutually exclusive with the success fire (:518) -> no
double-fire.

## Acceptance criteria

- AC1 (the fix): a throwing dispatch fires `onWorkUnitComplete` exactly ONCE with {organizationId, workUnitId} == the work unit.
- AC2 (contract unchanged): submit STILL rejects with the ORIGINAL execution error (not the hook's, not a trace error).
- AC3 (throwing hook safe): a hook that itself throws is swallowed (logged) and the ORIGINAL execution error still surfaces.
- AC4 (no regression): the existing execution-error tests stay green; no double-fire.

## TDD step 2 (RED -> GREEN)

Extend `buildConfig` in `__tests__/platform-ingress-execution-error.test.ts` to pass through an optional
`onWorkUnitComplete`, then append the new describe block (verbatim below). Run
`pnpm --filter @switchboard/core test -- platform-ingress-execution-error`.
RED: "fires onWorkUnitComplete exactly once on the failed-execution throw path ..." FAILS with the spy
called 0 times (the catch path does not fire today). The `.rejects.toBe(boom)` assertions pass both
before AND after (the rethrow is unchanged) -> the RED is specifically the missing fire.
GREEN: apply the one-line impl insert; re-run -> all green; existing tests in the file stay green.

### buildConfig extension (add the passthrough; minimal harness change)

- In the `overrides` param object type, add a field:
  `onWorkUnitComplete?: (info: { organizationId: string; workUnitId: string }) => void;`
- In the returned config object, add: `onWorkUnitComplete: overrides.onWorkUnitComplete,`

### New tests (append to the end of the file)

```ts
describe("PlatformIngress onWorkUnitComplete on the failed-execution throw path", () => {
  it("fires onWorkUnitComplete exactly once on the failed-execution throw path AND still rethrows the original error", async () => {
    const boom = new Error("handler boom");
    const onWorkUnitComplete = vi.fn();
    const traceStore = makeTraceStore();
    const ingress = new PlatformIngress(
      buildConfig({ mode: makeThrowingMode(boom), traceStore, onWorkUnitComplete }),
    );

    await expect(ingress.submit(baseRequest)).rejects.toBe(boom); // contract unchanged: original error rethrows

    expect(onWorkUnitComplete).toHaveBeenCalledTimes(1); // RED before fix: 0 (catch path did not fire)
    expect(onWorkUnitComplete).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org_1", workUnitId: expect.any(String) }),
    );
  });

  it("a throwing onWorkUnitComplete on the failed-execution path is swallowed; the original execution error still surfaces", async () => {
    const boom = new Error("handler boom");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const onWorkUnitComplete = vi.fn(() => {
      throw new Error("hook boom");
    });
    const traceStore = makeTraceStore();
    const ingress = new PlatformIngress(
      buildConfig({ mode: makeThrowingMode(boom), traceStore, onWorkUnitComplete }),
    );

    // The hook throws, but fireWorkUnitComplete swallows it; the ORIGINAL boom (not "hook boom") rethrows.
    await expect(ingress.submit(baseRequest)).rejects.toBe(boom);
    expect(onWorkUnitComplete).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      "[PlatformIngress] onWorkUnitComplete hook threw",
      expect.anything(),
    );
    warnSpy.mockRestore();
  });
});
```

### Impl insert (platform-ingress.ts, in the catch, before `throw executionErr;`)

Replace:

```ts
await this.tracePersister.recordInfrastructureFailure({
  errorType: "execution_exception",
  error: executionErr,
  workUnit,
  retryable: false,
});
throw executionErr;
```

with:

```ts
await this.tracePersister.recordInfrastructureFailure({
  errorType: "execution_exception",
  error: executionErr,
  workUnit,
  retryable: false,
});
// E4c follow-up: fire the work-unit-complete hook on the failed-execution path too. The trace
// is already sealed above (finalizeTrace/persistTrace), so a downstream exporter reads a
// complete (failed) trace. Best-effort + swallowing (fireWorkUnitComplete try/catch); the
// original executionErr still rethrows below, so submit's error contract is unchanged.
this.fireWorkUnitComplete(workUnit);
throw executionErr;
```

This is the ONLY source change. Do not touch any other fire site, the helper, or the config field.

## VERIFY + SURFACE

Full gate suite: typecheck; `pnpm --filter @switchboard/core test`; lint; format:check; arch:check;
`CI=1 npx tsx scripts/local-verify-fast.ts`; `pnpm build`; security (`pnpm audit --audit-level=high`).
No schema, no eval. Then an INDEPENDENT fresh-context review (diff + ACs + lessons): must confirm the
fire-once on the throw path, the rethrow contract is byte-unchanged, a throwing hook cannot mask the
original error, no double-fire across legs, telemetry can't block/break submit, core stays db/otel-free.
Then SURFACE the PR with evidence (NO auto-merge — PlatformIngress stop-glob; a human makes the merge call).
