# Alex SG/MY Medspa — Phase 1d: WhatsApp 24h Window Gate + Template Registry

**Status:** Design approved 2026-05-11. Implementation plan to follow.
**Parent spec:** [`2026-05-10-alex-medspa-sg-my-design.md`](./2026-05-10-alex-medspa-sg-my-design.md) §3.3, Phasing, Operability.
**Prior phases shipped:**

- 1a (#409) — Skill directory + governance types + BusinessFacts service-field
- 1b-1 (#429) — Deterministic safety gate (banned-phrase + escalation triggers)
- 1b-2 (#431) — Claim classifier + substantiation tiers
- 1c (#435) — PDPA consent state + outbound gate

**Feature flag:** `alexMedspaSgMyGovernanceV1.whatsappWindow` (default off)
**Surface:** `packages/core`, `packages/schemas`, `packages/db`, `apps/chat`, in-repo template authoring
**First hard outbound gate:** Yes. Unlike 1c (largely inert in 1c-only deployments), 1d is the first hard runtime block on the outbound path.

---

## 1. Problem

Meta Business API restricts WhatsApp business outbounds to two regimes:

- **Inside the 24h customer-service window** (last inbound from the user < 24h ago): free-form content allowed.
- **Outside the window**: only Meta-approved templates may be sent, and the contact must have channel-level messaging opt-in (`Contact.messagingOptIn`).

The Alex SG/MY skill currently emits free-form responses from `SkillExecutionResult.response` without checking either constraint. Existing helpers in `apps/chat/src/adapters/whatsapp.ts` (`isWithinWhatsAppWindow`, `canSendWhatsAppTemplate`) are scaffolding — they are not wired to any caller. There is also no Meta-approved template registry, no mechanism for the skill to declare what intent class an outbound serves, and no governed substitution path. Sending non-compliant content risks Meta phone-number quality downgrades and outright cutoffs.

### 1.1 Cost reality (paid-messaging path)

Outside-window template substitution is **not free**. Since 2025-07-01 Meta's WhatsApp Business Platform charges per delivered template message; rates vary by template category and the recipient phone number's country calling code. The free / paid distinction is **window-driven**, not market-driven:

| Template category | Inside 24h customer-service window | Outside the window          |
| ----------------- | ---------------------------------- | --------------------------- |
| Utility           | **Free**                           | Paid (volume-discount tier) |
| Authentication    | Paid (volume-discount tier)        | Paid (volume-discount tier) |
| Marketing         | **Paid**                           | Paid                        |

**Implication for 1d:** the gate substitutes only **outside** the window, so every `substitute` verdict represents a paid send regardless of template category. There is no free-fallback path through 1d. Inside-window emits pass through as free-form (also free, but they are not templates and never run the substitution branch).

1d's job is **compliance-first**, not cost control. The gate decides allow / substitute / handoff based on window, opt-in, intent class, and template fit — same as if every send were free. But every `substitute` verdict must carry enough metadata for a downstream Phase 2 billing layer to price the send retroactively. Concretely the substitute verdict includes `templateCategory`, `recipientMarket`, `metaTemplateName`, `costRisk: "paid_template_message"`, and `costEstimateStatus: "not_priced_in_1d"`. Budget caps, operator approval thresholds for marketing templates, daily/monthly cost dashboards, and per-tenant fee accounting are explicitly Phase 2 (see §3 Non-goals).

The re-engagement-offer intent class is the only family expected to be reliably **marketing**-category at submission time, which makes it both the most commercially sensitive and the most expensive. The spec calls this out so Phase 2 can target it for extra gating (operator approval, per-day caps) without re-litigating the data model.

## 2. Goal

Land a hard gate on the outbound path that, for WhatsApp emits:

1. Detects whether the conversation is inside the 24h customer-service window.
2. Outside the window, substitutes the free-form response with a Meta-approved template selected by the skill's declared `intentClass`, or escalates if no template fits.
3. Verifies channel-level messaging opt-in is granted before substituting.
4. Emits `GovernanceVerdict` audit rows in the same shape as 1b-1 / 1b-2 / 1c.
5. Ships behind a feature flag, default off, with no behavior change until the flag is flipped.

## 3. Non-goals

Explicitly **out of scope** for 1d:

- Operator UI for editing templates (Phase 2).
- Meta App Review / Business Verification workflow (external, see `project_launch_readiness_state.md`).
- Real-time A/B testing of template variants.
- Multi-language templates beyond SG / MY.
- IG DM template parity (different platform constraints).
- Outcome tagging on template sends (Phase 3).
- Recommendation surface for "your re-engagement-offer template performed best" (Phase 3).
- Proactive sender / scheduled re-engagement trigger. 1d wires the **reactive substitution path only**. Wiring `ProactiveSender` or new schedulers comes later.
- Multi-deployment jurisdiction reconciliation per contact (Phase 2 carry-over from 1c).
- `ConsentService` per-call refactor (Phase 2 carry-over from 1c followups).
- Replacing the existing `canSendWhatsAppTemplate` adapter helper. 1d's gate is the primary check; the adapter helper remains as a second wall.
- **Cost accounting, budget caps, and approval thresholds**. 1d annotates substitute verdicts with the metadata needed to price sends after the fact (§4.3) but does **not** estimate, sum, or enforce spend. Specifically Phase 2 owns: per-tenant daily/monthly template-send budget caps; operator approval workflow for marketing-category templates; actual Meta / BSP fee accounting and client billing pass-through; per-template-category send-rate controls; cost dashboards on operator surfaces.

## 4. Architecture

### 4.1 High-level flow

```
skill emits SkillExecutionResult { response, intentClass?, … }
  ↓
[1c PDPA consent gate]  ← already running, unchanged
  ↓
[1d whatsapp-window-gate]  ← NEW; afterSkill hook
  ├─ channelType !== "whatsapp"? → passthrough
  ├─ feature flag off?            → passthrough
  ├─ resolve config / posture     → fail-closed on error
  ├─ load thread.lastWhatsAppInboundAt + contact.messagingOptIn
  ├─ inside 24h window?           → allow (verdict: allowed)
  └─ outside window:
       ├─ messagingOptIn === false      → block + handoff (no opt-in)
       ├─ no intentClass on result      → block + handoff (no intent tag)
       ├─ selectTemplate(intentClass)   → null → block + handoff (no template fit)
       └─ template match                → substitute result.response (verdict: substitute)
  ↓
trace persistence → adapter dispatch
```

The hook follows the established 1b-1 / 1b-2 / 1c pattern: pure `afterSkill(ctx, result)` mutation of `result.response` for substitute, throw-or-mutate-and-flag for block, GovernanceVerdict emission for every decision (including allow when in `enforce` mode).

### 4.2 Components

#### 4.2.1 Template registry (in-repo)

**File:** `packages/core/src/skill-runtime/templates/whatsapp-registry.ts`

```ts
export type IntentClass =
  | "appointment-confirm"
  | "appointment-reminder"
  | "aftercare-checkin"
  | "re-engagement-offer"
  | "consult-followup";

export type Jurisdiction = "SG" | "MY";

/**
 * Meta-defined template category. Carried on every template entry because the gate
 * must propagate it into substitute verdicts (§4.3) for downstream Phase 2 pricing.
 *
 * - "utility"         — service / transactional (appointment-confirm, appointment-reminder, etc.).
 *                       Often free or low-cost; in some markets free when sent in response to a user inbound.
 * - "marketing"       — promotional / re-engagement (re-engagement-offer).
 *                       Always paid; commercially sensitive; targeted for extra gating in Phase 2.
 * - "authentication"  — OTP / 2FA. Not used by 1d v1 templates but reserved for future intent classes.
 */
export type TemplateCategory = "utility" | "marketing" | "authentication";

export interface WhatsAppTemplate {
  /** Internal name; also used in audit logs. */
  name: string;
  /** Meta-approved template name (must match what was submitted to Meta App Review). */
  metaTemplateName: string;
  intentClass: IntentClass;
  jurisdiction: Jurisdiction;
  /** Meta-defined category. Propagated into substitute verdicts for downstream pricing. */
  templateCategory: TemplateCategory;
  /** Rendered body used for substitution. Must pass 1b-1 banned-phrase scanner AND 1b-2 claim classifier. */
  body: string;
  /** Variable placeholders, in Meta order. */
  variables: ReadonlyArray<{ name: string; description: string }>;
}

export const WHATSAPP_TEMPLATES: ReadonlyArray<WhatsAppTemplate> = [
  /* SG + MY entries, one per intentClass, total 10 templates v1 */
];

export function selectTemplate(args: {
  intentClass: IntentClass;
  jurisdiction: Jurisdiction;
}): WhatsAppTemplate | null;
```

**Default category mapping per intent class (v1 authoring guidance):**

| Intent class           | Likely Meta category      | Notes                                                                                                                                |
| ---------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `appointment-confirm`  | `utility`                 | Service / transactional. Authored to read as confirmation of a user-initiated booking.                                               |
| `appointment-reminder` | `utility`                 | Service / transactional. Time-bound reminder for an existing booking.                                                                |
| `aftercare-checkin`    | `utility` (content-gated) | Authored as a service follow-up after a procedure. Avoid promotional copy — would re-categorize as marketing at Meta submission.     |
| `consult-followup`     | `utility` (content-gated) | Authored as a service-style continuation of a prior consult. Same authoring constraint as aftercare-checkin.                         |
| `re-engagement-offer`  | `marketing`               | Always paid; commercially sensitive. Phase 2 will gate this with operator approval and per-day caps; 1d does not differentiate cost. |

These hints encode the **expected** category at Meta-submission time; the actual category is whatever Meta approves the template as. The `templateCategory` field on each `WhatsAppTemplate` entry must reflect Meta's approval, not the hint. Templates whose approved category drifts from the hint are still valid; the hint is authoring guidance, not a runtime constraint.

**Rationale:** Templates are external-Meta-approved, slow to change (weeks per Meta App Review cycle). TypeScript const + PR review makes the claim-scanner regression test trivial (loop the array, run each body through the 1b-1 + 1b-2 scanners) and prevents tenants from accidentally shipping un-approved content. Tenant-editable templates are a Phase 2 concern, gated on operator UI.

The **re-engagement playbook** (parent spec §3.3 deliverable) is the set of templates tagged `intentClass: "re-engagement-offer"` plus the gate's selection logic. The decision logic for _when_ to send re-engagement (timing, triggering inbound state) is reactive in 1d — the skill must declare intent; 1d gate does not initiate.

#### 4.2.2 Window gate hook

**File:** `packages/core/src/skill-runtime/hooks/whatsapp-window-gate.ts`

```ts
export interface WhatsAppWindowGateDeps {
  verdictStore: GovernanceVerdictStore;
  governanceResolver: AgentDeploymentGovernanceResolver;
  postureCache: GovernancePostureCache;
  threadStore: ConversationThreadStore; // reads lastWhatsAppInboundAt
  contactStore: ContactStore; // reads messagingOptIn
  clock: () => Date;
  windowMs?: number; // default 24 * 60 * 60 * 1000
}

export class WhatsAppWindowGateHook implements SkillRuntimeHook {
  constructor(private deps: WhatsAppWindowGateDeps) {}
  async afterSkill(ctx: SkillHookContext, result: SkillExecutionResult): Promise<void>;
}
```

Construction parallels `PdpaConsentGateHook`. Posture cache is its own instance (not shared with 1c's cache); window-gate posture caches the resolved config (jurisdiction, mode, flag state) per deploymentId.

**Mode semantics** (matches prior hooks):

- `observe` — emit verdicts, do **not** mutate `result.response` or escalate.
- `enforce` — emit verdicts AND substitute / escalate.
- Mode is sourced from the deployment governance config under `alexMedspaSgMyGovernanceV1.whatsappWindow.mode`.

#### 4.2.3 SkillExecutionResult shape extension

**File:** `packages/schemas/src/skill-execution.ts` (or wherever `SkillExecutionResult` lives today)

```ts
export const IntentClassSchema = z.enum([
  "appointment-confirm",
  "appointment-reminder",
  "aftercare-checkin",
  "re-engagement-offer",
  "consult-followup",
]);
export type IntentClass = z.infer<typeof IntentClassSchema>;

export interface SkillExecutionResult {
  response: string;
  toolCalls: ToolCallRecord[];
  tokenUsage: { input: number; output: number };
  trace: SkillExecutionTraceData;
  /** OPTIONAL. Set by skills that emit outbound intended for the WhatsApp template-substitution path. */
  intentClass?: IntentClass;
}
```

The Alex skill's planner is updated in this phase to set `intentClass` when emitting. Existing skills are unaffected (field is optional).

#### 4.2.4 Handoff reason

**File:** `packages/core/src/handoff/types.ts`

```ts
export type HandoffReason =
  | "human_requested"
  | "max_turns_exceeded"
  | "complex_objection"
  | "negative_sentiment"
  | "compliance_concern"
  | "booking_failure"
  | "escalation_timeout"
  | "missing_knowledge"
  | "outside_whatsapp_window"; // NEW
```

All switch-statement consumers (operator queue UI, handoff metric counters, dashboard surfaces) are deliberately updated to handle the new variant. This aligns the operator-queue durable signal with the `GovernanceVerdict.reasonCode` already reserved in `packages/schemas` since 1a.

#### 4.2.5 Schema migration — `ConversationThread`

**File:** `packages/db/prisma/schema.prisma`

```prisma
model ConversationThread {
  // … existing fields …
  /// Last inbound WhatsApp message timestamp for the WhatsApp 24h customer-service window.
  /// Per Meta policy, the 24h window is per-channel. Only inbound WhatsApp messages update this
  /// column; other channels (Telegram, IG, email, web widget) MUST NOT write to it.
  lastWhatsAppInboundAt DateTime?

  // … existing fields …
  @@index([organizationId, lastWhatsAppInboundAt])
}
```

Migration created in the same commit as the schema change (CLAUDE.md invariant). `pnpm db:check-drift` run pre-commit when Postgres is reachable.

**Inbound write site:** `apps/chat` — wherever WhatsApp inbound messages are persisted today, add a sibling write to set `lastWhatsAppInboundAt = now()` on the contact's open `ConversationThread`. This is implementation-plan territory; the spec invariant is: **the field is WhatsApp-write-only**.

### 4.3 Data flow — verdict shapes

Every path emits exactly one `GovernanceVerdict`. The primary `reasonCode` is `outside_whatsapp_window` for every block / substitute case; `details` distinguishes sub-causes so audit logs are self-explanatory.

**Inside-window allow (enforce mode only):**

```ts
{
  sourceGuard: "whatsapp_window",
  action: "allow",
  reasonCode: "allowed",
  details: { windowStatus: "inside", lastWhatsAppInboundAt }
}
```

**Outside-window substitute (template fits, opt-in granted):**

```ts
{
  sourceGuard: "whatsapp_window",
  action: "substitute",
  reasonCode: "outside_whatsapp_window",
  originalText: <original skill response>,
  emittedText: <template body>,
  details: {
    windowStatus: "outside",
    optInStatus: "granted",
    templateMatch: "matched",
    intentClass,
    templateName: <template.name>,
    metaTemplateName: <template.metaTemplateName>,
    // Cost annotation (Phase 2 will consume these; 1d only writes them).
    templateCategory: <template.templateCategory>,  // "utility" | "marketing" | "authentication"
    recipientMarket: <jurisdiction>,                // "SG" | "MY" — proxy for Meta's recipient-market pricing key
    costRisk: "paid_template_message",
    costEstimateStatus: "not_priced_in_1d",
  }
}
```

**Why these fields:** Phase 2 will price each substitute retroactively. `templateCategory` + `recipientMarket` are the two inputs to Meta's per-message pricing table; `metaTemplateName` is the join key to Meta's billing exports; `costRisk: "paid_template_message"` is a coarse static tag so audit queries can `WHERE details->>'costRisk' = 'paid_template_message'` without inspecting Meta's rate card; `costEstimateStatus: "not_priced_in_1d"` is the explicit "this verdict has not been priced" signal so a Phase 2 backfill job can find unpriced rows. **1d never estimates a cost.**

**Outside-window block — opt-in missing:**

```ts
{
  sourceGuard: "whatsapp_window",
  action: "block",
  reasonCode: "outside_whatsapp_window",
  originalText: <original skill response>,
  details: {
    windowStatus: "outside",
    optInStatus: "missing_or_false",
    templateMatch: "not_attempted",
    intentClass: <or null if missing>,
  }
}
```

**Outside-window block — no intentClass tag on result:**

```ts
{
  sourceGuard: "whatsapp_window",
  action: "block",
  reasonCode: "outside_whatsapp_window",
  originalText: <original skill response>,
  details: {
    windowStatus: "outside",
    optInStatus: "granted",
    templateMatch: "skipped_no_intent",
    intentClass: null,
  }
}
```

**Outside-window block — intentClass tagged but no matching template:**

```ts
{
  sourceGuard: "whatsapp_window",
  action: "block",
  reasonCode: "outside_whatsapp_window",
  originalText: <original skill response>,
  details: {
    windowStatus: "outside",
    optInStatus: "granted",
    templateMatch: "no_fit",
    intentClass,
  }
}
```

**Resolver / posture failure (fail-closed):**

```ts
{
  sourceGuard: "whatsapp_window",
  action: "block",
  reasonCode: "governance_unavailable",
  details: { reason: "resolver_error" | "posture_cache_miss" }
}
```

### 4.4 Handoff package — block paths

All three block sub-causes (opt-in missing, no intent tag, no template fit) call `buildHandoffPackage` with:

```ts
{
  reason: "outside_whatsapp_window",
  conversationId: ctx.conversationId,
  originalText: result.response,
  metadata: {
    intentClass: result.intentClass ?? null,
    blockSubCause: "missing_opt_in" | "missing_intent_class" | "no_template_fit",
    jurisdiction,
  },
}
```

The handoff carries the same sub-cause that lives in the verdict `details`. Operator queue UI displays the sub-cause text; metric counters bucket by sub-cause.

### 4.5 Integration with 1c

1c's `evaluateConsentGate` runs **before** 1d's window gate (hook chain order). When 1c blocks (e.g. `consent_revoked`), 1d never runs — the response is already mutated/escalated. 1d only sees outbounds that 1c approved.

1d does **not** call `evaluateConsentGate` itself in this phase. The parent context says "the proactive sender call site calls `evaluateConsentGate({ messageClass: 'proactive' })`" — that call lives at the proactive-sender wiring site, which is **out of scope** for 1d (deferred to whichever phase wires the proactive trigger). The 1d hook runs on whatever the skill emits, regardless of message class; 1c's gate has already classified.

### 4.6 Wiring

Hook is registered in the same locations as 1c:

- `apps/chat/src/main.ts` — single-tenant bootstrap path (no DB), feature flag disabled by default.
- `apps/chat/src/gateway/gateway-bridge.ts` — managed multi-tenant path. Construction mirrors `createConsentService` / `PdpaConsentGateHook` wiring.

No `ChannelGateway` constructor changes are required (the explore report confirmed this).

## 5. Error handling

| Failure                                      | Behavior                                              | Verdict                                                              |
| -------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------- |
| Governance resolver throws                   | Try posture cache; if miss, block.                    | `governance_unavailable`, details.reason="resolver_error"            |
| Posture cache miss + resolver throws         | Block.                                                | `governance_unavailable`, details.reason="posture_cache_miss"        |
| Feature flag off                             | Passthrough, no verdict emitted.                      | n/a                                                                  |
| `observe` mode                               | Emit verdict, do not mutate response, do not handoff. | (any verdict shape from §4.3)                                        |
| Thread store / contact store throws          | Fail-closed: block.                                   | `governance_unavailable`, details.reason="storage_error"             |
| Inbound channel ≠ WhatsApp                   | Passthrough, no verdict emitted.                      | n/a                                                                  |
| `intentClass` missing on outside-window emit | Block + handoff (see §4.3).                           | `outside_whatsapp_window`, details.templateMatch="skipped_no_intent" |
| `selectTemplate` returns null                | Block + handoff.                                      | `outside_whatsapp_window`, details.templateMatch="no_fit"            |
| `messagingOptIn` false outside window        | Block + handoff.                                      | `outside_whatsapp_window`, details.optInStatus="missing_or_false"    |

## 6. Testing — fixture coverage

Required by parent spec §Operability:

1. **`whatsapp-window-gate.test.ts`** (packages/core)
   - Inside-window pass (5 min ago, 23h ago)
   - Outside-window with template fit and opt-in: substitute
   - Outside-window no opt-in: block + handoff
   - Outside-window opt-in but no intentClass on result: block + handoff
   - Outside-window opt-in + intentClass but no matching template: block + handoff
   - `observe` mode: verdict emitted, response unchanged, no handoff
   - Feature flag off: passthrough, no verdict
   - Fail-closed on resolver error
   - Fail-closed on posture cache miss + resolver throws
   - Non-WhatsApp channel: passthrough
2. **`templates/whatsapp-registry.test.ts`** (packages/core)
   - `selectTemplate` returns the correct entry for each `(intentClass, jurisdiction)` pair
   - `selectTemplate` returns null for unknown combinations
   - Every entry has a `templateCategory` populated (no nulls)
   - The `re-engagement-offer` entries are all `templateCategory: "marketing"` (sanity check on the most cost-sensitive class)
   - **Cross-phase regression**: every template body passes the 1b-1 banned-phrase scanner
   - **Cross-phase regression**: every template body passes the 1b-2 claim classifier (no claims that trip the substantiation tier)
3. **Window detection edge cases** (synthetic timelines)
   - `lastWhatsAppInboundAt` null → outside window
   - `lastWhatsAppInboundAt` 23:59:59 ago → inside
   - `lastWhatsAppInboundAt` 24:00:01 ago → outside
   - `lastWhatsAppInboundAt` 7d ago → outside
4. **Verdict shape contract** (matches 1b-1/1b-2/1c pattern)
   - `sourceGuard === "whatsapp_window"` (already reserved since 1a — first emitter is 1d)
   - `reasonCode === "outside_whatsapp_window"` (already reserved since 1a — first emitter is 1d)
   - `details.windowStatus`, `details.optInStatus`, `details.templateMatch` are present on every block/substitute verdict and uniquely identify the sub-cause
   - **Cost annotation contract** on `action: "substitute"` verdicts: `details.templateCategory`, `details.recipientMarket`, `details.metaTemplateName`, `details.costRisk === "paid_template_message"`, `details.costEstimateStatus === "not_priced_in_1d"` — all present and non-null. Phase 2's pricing backfill depends on this contract.
5. **Handoff package shape**
   - `HandoffReason === "outside_whatsapp_window"` for all three block sub-causes
   - `metadata.blockSubCause` distinguishes `missing_opt_in` / `missing_intent_class` / `no_template_fit`

DB tests use mocked Prisma (no Postgres in CI — see `feedback_api_test_mocked_prisma.md`). API tests, if any, use `buildTestServer`.

## 7. Operability

| Concern           | Approach                                                                                                                                                                                                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Feature flag      | `alexMedspaSgMyGovernanceV1.whatsappWindow` — boolean per deployment governance config. Default false everywhere.                                                                                                                                                                    |
| Mode              | `observe` / `enforce` — same gate machinery as 1b-1/1b-2/1c.                                                                                                                                                                                                                         |
| Audit trail       | `GovernanceVerdict` rows per emit (§4.3). Filterable by `sourceGuard = "whatsapp_window"`.                                                                                                                                                                                           |
| Operator surface  | Handoff queue entries via `HandoffReason = "outside_whatsapp_window"`. Dashboards that switch on handoff reasons get a new branch. Substitution success path (happy path) does **not** create handoffs — verdict-only, matches 1c's deferral on handoff annotation for substitution. |
| Schema migration  | `lastWhatsAppInboundAt` column + index. Same-commit migration; `pnpm db:check-drift` pre-commit when Postgres reachable.                                                                                                                                                             |
| Rollback          | Flag off → entire hook is passthrough. No data cleanup needed; verdicts already written remain in audit log.                                                                                                                                                                         |
| Cross-phase tests | Template registry must pass 1b-1 and 1b-2 scanners. Regression test catches drift if either scanner tightens.                                                                                                                                                                        |

## 8. Open questions resolved during brainstorming

| Question                                      | Decision                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Template storage                              | In-repo TS const (`packages/core/src/skill-runtime/templates/whatsapp-registry.ts`). Tenant-editable templates and operator UI = Phase 2.                                                                                                                                                                                                              |
| Window calculation source                     | New `ConversationThread.lastWhatsAppInboundAt` column, WhatsApp-write-only invariant.                                                                                                                                                                                                                                                                  |
| Template selection mechanism                  | Skill tags `SkillExecutionResult.intentClass` explicitly; gate consumes the tag.                                                                                                                                                                                                                                                                       |
| No-template-fits behavior                     | Hard escalate via `buildHandoffPackage` with new `HandoffReason: "outside_whatsapp_window"`.                                                                                                                                                                                                                                                           |
| Opt-in interaction                            | Gate checks **both** window AND `Contact.messagingOptIn`. Both must allow before substituting. Existing `canSendWhatsAppTemplate` adapter helper remains as a defense-in-depth second wall, not deleted.                                                                                                                                               |
| Proactive sender call site                    | **Out of scope for 1d.** 1d wires reactive substitution only — no new triggers, no `ProactiveSender` wiring, no scheduled job.                                                                                                                                                                                                                         |
| Handoff annotation on substitute (happy path) | None. Verdict-only, mirrors 1b-2's `unsupported_claim_rewritten` pattern. Substitution-count-based handoff is Phase 2.                                                                                                                                                                                                                                 |
| Verdict sub-cause distinguishability          | `details.windowStatus` + `details.optInStatus` + `details.templateMatch` uniquely identify every block/substitute sub-cause even though primary `reasonCode` is always `outside_whatsapp_window`.                                                                                                                                                      |
| Cost awareness on substitute path             | Substitute verdicts carry `templateCategory`, `recipientMarket`, `metaTemplateName`, `costRisk: "paid_template_message"`, `costEstimateStatus: "not_priced_in_1d"` so Phase 2 can price retroactively. 1d does not estimate, sum, or enforce cost. `re-engagement-offer` flagged as the marketing-category family for future operator-approval gating. |

## 9. Constraints (from CLAUDE.md)

- ESM only, `.js` extensions in relative imports (except Next.js).
- No `any`, no `console.log` (use `console.warn` / `console.error`).
- Schema change requires migration in the same commit; run `pnpm db:check-drift` pre-commit if Postgres is reachable.
- Co-located `*.test.ts` for every new module.
- Conventional Commits.
- File size: warn >400 lines, error >600.
- Coverage targets: global 55/50/52/55, core 65/65/70/65.
- `pnpm typecheck` + `pnpm lint` + `pnpm test` before commit. Dashboard `next build` if any Next code is touched (CI does not run it — see `feedback_dashboard_build_not_in_ci.md`).

## 10. PR cadence

Per CLAUDE.md branch doctrine:

1. **This spec** lands on `main` as a focused docs-only PR.
2. **Implementation plan** (`docs/superpowers/plans/2026-05-11-alex-medspa-1d.md`) lands as a separate small PR.
3. **Implementation** lands as a feature PR (`feat(alex): SG/MY medspa Phase 1d — whatsapp window gate + template registry`), behind feature flag, default off.

## 11. Prior art / gotchas

- `project_blocker3_deferred_template_wiring.md` — Blocker 3 (calendar-book template wiring) was deferred until Meta approves templates. 1d revives portions of that wiring conceptually (template dispatch path), but the implementation here is the gate, not the calendar-book skill itself.
- `project_launch_readiness_state.md` — critical-path gate is Meta-side (Business Verification + App Review = 2–4 weeks). 1d code ships behind feature flag before Meta approves templates; flip to enforce when Meta approves the in-repo template entries.
- `feedback_subagent_worktree_drift.md` — when subagents implement 1d, the prompt must include explicit `cd /Users/jasonli/switchboard/.worktrees/<branch>` and `test "$(git branch --show-current)" = "<branch>"` guards.
- **Cloud API direct access — no BSP / Tech Provider status required for 1d.** Each tenant's WABA connects to Meta's WhatsApp Business Platform Cloud API directly; Switchboard does not need to register as a Meta Tech Provider (the modern name for what used to be called a "BSP" / Solution Partner) for 1d to function. Meta deprecated the on-premise API on 2025-10-23, so Cloud API is in practice the only path for new integrations. Tech Provider / Solution Partner status would be relevant only for ergonomics layers Switchboard may want **later** — Embedded Signup (one-click tenant onboarding without each tenant creating their own Meta Business Manager), consolidated billing across tenants, listing in Meta's Partner Directory — none of which are 1d code blockers. The `metaTemplateName` field on `WhatsAppTemplate` assumes per-tenant template names are stable across the tenant fleet; if a tenant's Meta review renames a template, the in-repo entry's `metaTemplateName` must be updated (or 1d gains per-tenant name overrides — Phase 2).
