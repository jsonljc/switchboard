# ai-infra-uplift S5 (strict tool schemas at the skill-tool boundary) loop — scratch, uncommitted

Durable record: ai-infra-uplift-backlog.md S5 + research f4 (finding #8).

## >>> RESUME POINT <<<

ORIENT done (below). Design LOCKED. Worktree: `.claude/worktrees/ai-strict-tool-schemas` branch `feat/ai-strict-tool-schemas`.
Disposition: SURFACE (booking/mutation tool boundary + UNVALIDATABLE against live API right now -> judgment stop). Mark [S].

Goal: adopt Anthropic `strict:true` at the skill-tool boundary "where safe", per f4 (schema-valid-by-construction -> fewer malformed-call retries before GovernanceGate). Keep range checks in Zod/validateToolInput (strict rejects min/max — feedback_anthropic_strict_tool_schema_no_minmax).
Task-size: standard (one bounded PR; one adapter file + tests).

## Ground truth (ORIENT, file:line)

- Tool-build boundary: `packages/core/src/skill-runtime/adapters/anthropic-tool-adapter.ts:154-168` maps LLMToolDefinition -> Anthropic.Tool; does NOT set `strict`. Add it here.
- Producer: `skill-executor.ts:669 buildToolDefinitions` -> LLMToolDefinition.input_schema = `SkillToolOperation.inputSchema` (types.ts:219), HAND-AUTHORED literal JSON Schema in `packages/core/src/skill-runtime/tools/*.ts`. NO zod->json-schema generation.
- Schema reality: NONE set `additionalProperties:false`. NONE use min/max/minLength/pattern/format (that axis safe everywhere). SOME are fully-required (calendar-book.slots.query [5], booking.create [4], crm-query.contact.get [empty]) -> strict-eligible after adding additionalProperties:false. SOME have OPTIONAL props (escalate.customerSentiment, follow-up.note, crm activity.list.limit, calendar reschedule.service, web-scanner paths/timeoutMs) -> NOT strict-eligible (strict requires ALL props required).
- `input-schema-validator.ts validateToolInput(schema,input)` runs POST-call on tool_use INPUT (skill-executor.ts:566); checks required+type+enum; does NOT check additionalProperties; lenient. The post-call safety net; complementary to strict (strict prevents malformed BY CONSTRUCTION). Range checks live here / in Zod, NOT in the strict schema.
- SDK 0.91.1: `strict?: boolean` on Anthropic.Tool (messages.d.ts:1075). `output_config.format json_schema` exists but is a RESPONSE-format path, not per-tool, and not tool-compatible -> NOT used here.
- Classifier (`anthropic-classifier.ts:34`) uses strict:true on the LIVE API today on a flat object {string+enum, bare number}, additionalProperties:false, all-required, no min/max. This is the EXISTENCE PROOF that the target shape works live.
- Tools execute INSIDE PlatformIngress.submit() (same call stack); the booking tools are the revenue-proof core -> high stakes -> SURFACE.

## VALIDATION CONSTRAINT (the load-bearing risk)

strict:true 400s on any schema outside the narrow subset, and feedback_anthropic_strict_tool_schema_no_minmax is emphatic this class is LATENT until exercised against the LIVE API (shipped twice unnoticed pre-#623). There is NO valid ANTHROPIC_API_KEY available now (local: none; CI secret: 401 invalid x-api-key — the alex-conversation eval that would validate is RED globally). So I CANNOT live-validate. Mitigation: (1) ultra-conservative detector (only classifier-proven shapes: flat object, all-required, scalar/enum props, no forbidden keywords, no nested objects/arrays); (2) the classifier is a live-proven instance of the same subset; (3) SURFACE with a LOUD "must live-validate before merge" caveat. Do NOT auto-merge.

## DESIGN (LOCKED)

In `anthropic-tool-adapter.ts`, add an exported pure helper (mirrors the `orderToolsForCache` pattern; tested in the adapter test):

```
export function strictenToolSchema(inputSchema): { inputSchema; strict: boolean }
  -> if isStrictEligible: return { inputSchema: {...inputSchema, additionalProperties:false}, strict:true }
  -> else: return { inputSchema, strict:false }   // unchanged, loose (today's behavior)
```

isStrictEligible (conservative):

- schema.type==="object" AND schema.properties is a present object.
- propNames.length === required.length AND every propName in required (ALL declared props required).
- every property: an object, type is one of string/number/integer/boolean (scalar), NO forbidden keyword (minimum/maximum/exclusiveMinimum/exclusiveMaximum/multipleOf/minLength/maxLength/pattern/format), enum allowed. REJECT nested object/array props.
- top-level schema has no forbidden keyword.
- empty properties ({}) with required [] is eligible (model calls with {}).
  Wire into the tool map: `const { inputSchema, strict } = strictenToolSchema(t.input_schema);` then `input_schema: inputSchema`, spread `...(strict ? { strict: true } : {})`. cache_control on last tool unchanged.

## TDD plan

- S5.1 strictenToolSchema unit tests (RED: not a function): eligible flat all-required scalar+enum -> strict:true + additionalProperties:false added (input NOT mutated); optional-prop -> strict:false unchanged; minimum/maximum -> strict:false; nested object prop -> strict:false; array prop -> strict:false; empty properties -> strict:true + additionalProperties:false.
- S5.2 adapter integration (RED: strict absent): chatWithTools with an eligible tool -> create.mock body tools[i] has strict:true + input_schema.additionalProperties===false; with an optional-prop tool -> no strict, no additionalProperties forced.
- Keep all existing adapter tests green (ordering/cache/sampling unaffected).

## VERIFY gates (delegate)

typecheck; `--filter @switchboard/core test`; lint; format:check; arch:check; `CI=1 npx tsx scripts/local-verify-fast.ts`; build. NO db/schema. Eval = CANNOT validate (no key); rely on conservative detector + classifier existence proof + SURFACE caveat. Independent fresh-context opus review (diff + criteria + feedback_anthropic_strict_tool_schema_no_minmax + feedback_safety_gate_needs_producer_population). Non-self-gradable.

## CONVERGE

SURFACE. PR with LOUD caveat: "strict:true on N eligible tools (list them); detector unit-tested + classifier-proven shape, but NOT live-API-validated (no valid key; eval RED on invalid CI key). MUST run alex-conversation eval (or one real strict tool call) before merge — strict-schema bugs are latent-until-live (see #623). Booking tools are on the path -> validate before merge." Mark backlog S5 [S]. Proceed to S6.

## Log

- 2026-06-20: ORIENT (Explore) done. Design locked. Next: EXECUTE in fresh worktree.
