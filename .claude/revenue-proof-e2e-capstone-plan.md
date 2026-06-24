# revenue-proof e2e capstone (B-direct) — ephemeral plan (uncommitted scratch)

Slice: smallest Form B-direct. Prove the conversation->booking ENTRY through the REAL skill executor.
Test-only. File: `apps/api/src/__tests__/revenue-proof-booking-entry-e2e.test.ts`.
Authority: autonomous-with-guardrails (test-only -> auto-merge eligible IF gates green + indep review 0>=warn).

## Seam under test (what is NEW vs merged slices)

Slices 1-3 invoke `tool.operations["booking.create"].execute(input)` DIRECTLY (bypassing the executor).
skill-executor.test.ts tests dispatch with a MOCK `test-tool.do` (no governanceOverride, trivial schema).
NEITHER covers: REAL `SkillExecutorImpl` -> name-resolution (`calendar-book.booking.create` split) ->
`validateToolInput(op.inputSchema)` -> REAL `GovernanceHook` decision on booking.create's override ->
REAL calendar-book op write. This test is the only tripwire for that composition (the P0.1/F2 class).

## Harness (all reuse; no production-code change)

- Substrate: `InMemoryRevenueDb` + `buildCalendarBookTool(db, ctx, opts)` (revenue-loop-substrate.ts) ->
  the REAL calendar-book SkillTool over in-memory Prisma, ctx (incl contactId) baked in EXACTLY as slice 1.
- Pass that built tool as the executor's `tools` map (base map); `toolFactories` empty -> executor
  dispatches to the pre-built real op (contactId problem avoided; producer identical to slices).
- Inline structural stub adapter (~15 lines) implementing `chatWithTools(params) => LLMResponse`:
  scripted array + callIndex. Turn 1 = tool_use; turn 2 = end_turn text. (TestToolAdapter precedent exists
  but is NOT index-exported -> inline to stay test-only.) EXACT field names: `stopReason`, content block
  `{type:"tool_use", id, name:"calendar-book.booking.create", input}`, usage `{inputTokens, outputTokens}`.
- `new GovernanceHook(toolsMap)` in the hooks array (REAL governance, not bypassed).
- `new SkillExecutorImpl(stub, toolsMap, undefined /*router*/, [hook])`.
- `executor.execute({ skill: minimalSkill, parameters:{}, messages:[{role:"user", content:"Book a Botox consult ..."}],
deploymentId, orgId, trustScore: 50, trustLevel: "supervised" })`.
- minimalSkill: `{ slug, name, version, description, author, body, parameters:[], tools:["calendar-book"], context:[] }`.

## Why trustLevel="supervised" (load-bearing governance)

booking.create = external_mutation + override {supervised:auto-approve, guided:auto-approve}.
At supervised the POLICY TABLE alone = require-approval; ONLY the override auto-approves. So this test reds
if the override is removed (-> pending_approval -> NO booking write -> count=0). That removal IS the P0.1/F2
prod-inertness regression. (autonomous would auto-approve via the policy table even without the override, so
it would NOT be load-bearing on the override; supervised is the correct conservative choice.)

## Steps (TDD; one test file)

1. **Harness + stub adapter compiles & runs.** Write inline stub adapter + substrate seed (mirror slice 1:
   lead+opportunity+contact, frozen time) + executor construction. Done: `executor.execute(...)` returns
   without throwing; `result.toolCalls.length === 1`. RED proof: a wrong field name / wrong tool name in the
   stub makes dispatch fail (toolCalls empty or error) — captured as the negative test in step 3.
2. **Positive: executor-driven booking threads to the owner number.** Assert:
   (a) `result.toolCalls[0]` = {toolId:"calendar-book", operation:"booking.create",
   governanceDecision:"auto-approved", result.status:"success"};
   (b) read back through the SAME projection->rollup->owner-tile path slice 1 uses (PrismaReceiptedBookingStore + PrismaReceiptStore -> createPeriodRollup -> owner tile): count=1, revenueCents=<slice-1 expected>,
   confidence.deterministic, 0 exceptions, bookingsNeedingAttention=0.
   Done: GREEN. RED proof (load-bearing, deferred to VERIFY throwaway worktree): delete the `supervised`
   override key in calendar-book.ts -> status becomes pending_approval, count=0 -> test reds. Document the
   exact mutation in the ledger for the independent reviewer to confirm.
3. **Load-bearing negative: name resolution is real (not a rubber stamp).** Second test case: stub emits a
   WRONG op name (e.g. `calendar-book.booking.created`); assert the executor does NOT execute a booking
   (toolCalls[0].result.status is error/not-found, governanceDecision not "auto-approved") AND the substrate
   has ZERO bookings/receipts. Done: GREEN. This guards the op-key-rename silent-inertness scenario directly.

## Out of scope (do NOT add)

Form A (chain 1->2->3), Form B-ingress (PlatformIngress.submit), the payment leg (slice 2), the digest
(slice 3), any production-code change, exporting TestToolAdapter. ONE focused test file only.

## Verify gates (delegate the run; compact verdicts only)

typecheck; `pnpm --filter @switchboard/api test` (the touched pkg) + `pnpm test`; lint; format:check;
arch:check; `CI=1 npx tsx scripts/local-verify-fast.ts`; build (apps changed? no prod code -> test-only,
but apps/api test imports need dist -> build already done). eval=n/a (no decision-engine change).
security=`pnpm audit --audit-level=high`. Independent fresh-context review (diff + criteria + lessons only),
including a throwaway-worktree mutation check of the step-2 governance RED proof. DONE = all green + indep 0>=warn.
