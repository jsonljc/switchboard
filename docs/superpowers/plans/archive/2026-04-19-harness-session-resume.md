# Harness Architecture — Session Resume Prompt

> Paste this into a new Claude session to resume where we left off.

---

## Resume Prompt

```
I'm working on the Switchboard Harness Architecture implementation. Here's where we are:

## What exists

1. **Architecture spec** (complete, committed): `docs/superpowers/specs/2026-04-19-harness-architecture-design.md`
   - 8 sections covering: Progressive Disclosure, Tool/ACI Surface, Context Pollution Control, Persistent Workflow State, Org-State as System of Record, Mechanical Enforcement, Tight Feedback Loops, Clean Handoff/Clean State
   - 3 appendices: Cross-Section Invariants, Canonical Types, Definition of Done
   - Section 9: Implementation Order with 4 phases and 16 gaps ranked by impact

2. **Phase 1 implementation plan** (complete, committed): `docs/superpowers/plans/2026-04-19-harness-phase1-correctness.md`

3. **Phase 1 implementation** (COMPLETE — all 3 items done, all committed on branch `fix/dashboard-build`):
   - EffectCategory enum: 7-value closed enum replacing 4-value GovernanceTier. Field renamed across 28 files. Commits: ff420e05, e95f5c74, db5a73c4
   - ToolResult envelope: Structured result type for all tool operations. 15 operations across 7 tool factories wrapped. Commits: 6352d4a1, 0c0756fb, 67a63359
   - Idempotency enforcement: idempotencyKey on WorkTrace (Prisma migration), getByIdempotencyKey on store, dedup check at PlatformIngress.submit(). Commits: b8882b8e, b185dd9d, 3f5eded7

4. **Typecheck**: clean (18/18 packages)
5. **Tests**: 1874 passed, 1 pre-existing failure in propose-helpers-trust.test.ts (unrelated)
6. **Branch**: fix/dashboard-build (not yet pushed or PR'd)

## What's next

Phase 2: Context Quality (from spec Section 9):
4. Tool output reinjection filter — prevents context pollution. Depends on ToolResult envelope (done).
5. Knowledge entry prioritization — improves context assembly. Independent.
6. Error taxonomy + structured remediation — makes the system learnable. Depends on ToolResult envelope (done).

Read the spec at docs/superpowers/specs/2026-04-19-harness-architecture-design.md for full context on each item.

## Key decisions made during the session

- EffectCategory has 7 values: read, propose, simulate, write, external_send, external_mutation, irreversible. New categories require doctrine amendment.
- calendar-book booking.create uses external_mutation (not external_send) — creating a calendar event is a state mutation, not a message send.
- ToolResult has split remediation: modelRemediation (what the agent should try) + operatorRemediation (what a human should know).
- Idempotency is enforced at PlatformIngress.submit() as step 0, before intent lookup. Returns existing result without creating a new WorkUnit.
- GovernanceTier kept as deprecated alias pointing to EffectCategory for backward compatibility.

## To continue

Option A: Write Phase 2 implementation plan and execute it
Option B: Push Phase 1 and create a PR first
Option C: Update docs/DOCTRINE.md with the new invariants from the spec (step 2 of the spec's "after approval" plan)

What would you like to do?
```

---

## Key file paths for reference

| File                                                               | Purpose                                                  |
| ------------------------------------------------------------------ | -------------------------------------------------------- |
| `docs/superpowers/specs/2026-04-19-harness-architecture-design.md` | Full architecture spec (1677 lines)                      |
| `docs/superpowers/plans/2026-04-19-harness-phase1-correctness.md`  | Phase 1 implementation plan                              |
| `docs/superpowers/plans/2026-04-19-harness-session-resume.md`      | This file                                                |
| `packages/core/src/skill-runtime/governance.ts`                    | EffectCategory definition + policy matrix                |
| `packages/core/src/skill-runtime/tool-result.ts`                   | ToolResult type + ok/fail/denied/pendingApproval helpers |
| `packages/core/src/platform/platform-ingress.ts`                   | Idempotency check at submit()                            |
| `packages/core/src/platform/work-trace.ts`                         | WorkTrace interface with idempotencyKey                  |
| `packages/core/src/platform/work-trace-recorder.ts`                | WorkTraceStore with getByIdempotencyKey                  |
| `packages/db/src/stores/prisma-work-trace-store.ts`                | Prisma implementation of getByIdempotencyKey             |
| `docs/DOCTRINE.md`                                                 | Existing doctrine (to be updated with new invariants)    |
