# Channel→Agent PII Minimization via Trusted Runtime Injection — Design

- **Date:** 2026-05-31
- **Status:** Draft (brainstormed + fan-out-verified; pending review)
- **Area:** `packages/core` skill-runtime + channel-gateway (Alex sales agent)
- **Naming note:** Previously tracked as "PII tokenization." Verified against `main` (post-#769), the chosen design is **PII minimization via trusted runtime injection**, not tokenization — there is no token vault; the model loses authority over `contactId` (it can no longer supply it) while tools retain server-side access, and the customer's first name is intentionally allowed through.

## 1. Problem & threat model (verified against `main`)

Alex (the live medspa SDR on WhatsApp) converses through an external LLM provider (Anthropic). The agent runtime today (a) exposes customer PII to that provider and (b) lets the model name the contact it acts on. Three surfaces, each verified at `file:line`:

1. **ACTIVE LEAK — tool output.** `crm-query.contact.get` returns the full contact record — name, **phone**, **email**, id, stage, source — verbatim to the model (`tools/crm-query.ts:20,31-35`). Tool results are reinjected to the model unredacted: `filterForReinjection` is **size/shape only** (`reinjection-filter.ts`) and is **tool-blind** — its `SkillToolOperation` argument carries no tool id (`types.ts:198-208`), so it cannot target a specific tool. `crm-query.activity.list` is a secondary, conditional surface: it replays free-text activity `description`s that a producer may have populated with PII (`crm-query.ts:50-59`).
2. **CROSS-CONTACT AUTHORIZATION GAP — tool input.** `contactId` is a **model-supplied required argument** of `crm-query.contact.get` (`crm-query.ts:29`) and `calendar-book.booking.create` (`calendar-book.ts:152`). Because the model emits the contact identifier, it can in principle be steered onto an identifier it should not act on. `orgId`/`deploymentId` are already injected from trusted context via the factory-with-context pattern (`skill-executor.ts:177-181`); `contactId` is the laggard.
3. **LATENT (defense-in-depth) — prompt.** Both `builders/alex.ts:89,123` and `builders/sales-pipeline.ts:21,27` place the raw contact record into `parameters.LEAD_PROFILE`. **This does not reach the model today** — no skill body references `{{LEAD_PROFILE}}`, and `template-engine.ts:80-86` substitutes only tokens that literally appear in the body. But it is a loaded gun: a future body edit (or the engine's recursive-YAML object render / `{{LEAD_PROFILE.phone}}` field access) would dump phone/email into the prompt.

Entry point: untrusted channel text + tool access + PII in context = the lethal-trifecta shape. The launch relevance is **data minimization to a sub-processor (PDPA)**: today the LLM provider receives a customer's phone/email on every contact lookup.

**Honest framing (do not overstate):** Leg 1 closes a real, _active_ leak. Leg 2 is a _structural authorization_ improvement, not an active exfil fix. Leg 3 keeps booking working after Leg 1. Leg 4 is defense-in-depth for a _latent_ surface.

## 2. Goals / non-goals

**Goals**

- The LLM provider never receives the customer's **phone**, **email**, or internal **contactId**.
- The model **cannot reference or act on any contact other than the current conversation's**.
- The customer's **name** remains available to the model for natural conversation ("Hi Jane").
- Calendar bookings retain full attendee details (name + email).
- No regression to booking, qualification, or greeting behavior; the A0 conversation eval still passes.

**Non-goals (explicit scope fence)**

- **S3 at-rest redaction.** `WorkTrace.parameters` persists raw contactId/phone (`work-trace-recorder.ts:87`). Deferred to its own slice — it entangles WorkTrace integrity hashing (`work-trace-hash.ts`).
- **Name tokenization / token vault / outbound resolver.** Rejected during brainstorm; the name is allowed through (multi-turn history re-feed would otherwise force a persistent vault for marginal benefit).
- **Multi-contact conversations.** v1 assumes one contact per conversation (the sender).
- **Dead-code dialogue surfaces** (`dialogue/system-prompt-builder.ts:88` injects a name; `sales-pipeline/prompt-assembler.ts:37` appends free text). Both are unwired (no live caller). Noted for deletion, not fixed here.

## 3. Design

**Principle:** the model sees the customer's **name + non-identifying status**; tools resolve trusted identifiers (`orgId`, `contactId`) and contact details (phone, email) **server-side**; the model never sees or supplies them.

### Leg 1 — Redact tool output at the tool boundary

- `crm-query.contact.get.execute` returns a projection `{ name, stage, source }` — drop `phone`, `email`, `id` (`crm-query.ts:31-35`).
- `crm-query.activity.list.execute` returns rows with the free-text `description` dropped from the model-facing projection (`crm-query.ts:50-59`).
- **Not** done in `filterForReinjection` — it is tool-blind and size-only. Redacting inside `execute()` is co-located, tool-targeted by construction, and survives even if the reinjection path changes. Redaction is **deny-by-default**: the projection lists allowed fields, so a new PII field on the contact record is dropped unless explicitly added.

### Leg 2 — Inject `contactId` from trusted context

- Add `contactId?: string` to `SkillRequestContext` (`types.ts:372-383`).
- Populate it in `composeSkillRequestContext` from the execution params' contactId (the work-unit param bag carries it; precedent: `apps/api/src/bootstrap/skill-mode.ts:568` already reads `workUnit.parameters.contactId`). Keep the function pure/sync. **Caveat:** the param-bag value is authoritative for the common path — and for WhatsApp, where the contact is created pre-submit — but is _stale/absent before `alexBuilder` mints a contact for a brand-new lead_. See new-lead reconciliation below.
- Refactor `crm-query` from `(deps) => SkillTool` into a ctx-factory `(deps) => (ctx) => SkillTool` (mirroring `createCalendarBookToolFactory`, `calendar-book.ts:109`), and register it in the **execution** `toolFactories` map, not only the schema-only `toolsMap` (`apps/api/src/bootstrap/skill-mode.ts:314-335`). Registering only in `toolsMap` would silently dispatch a `__schema_only__` ctx — a real footgun called out by the audit.
- `crm-query.contact.get` + `calendar-book.booking.create`: read `ctx.contactId` (and `ctx.orgId` for crm-query's ops); **drop `contactId` (and `orgId`) from `inputSchema`/`required`**. Read ctx **only** — no `params.contactId` fallback. (The input validator is _tolerant_ of extra fields — `input-schema-validator.ts:104-105` iterates declared properties, no `additionalProperties` enforcement — so a model that still sends `contactId` must have it _ignored_, not merged. Security comes from `execute` reading ctx exclusively.)
- Update `SKILL.md:221` (drop "contactId: contact ID from context" from the booking instruction — it is injected now) and the `INVALID_TOOL_INPUT` remediation text (`skill-executor.ts:400-401`) to list `contactId` among runtime-injected ids.
- **Fail-closed:** if `ctx.contactId` is absent at execution, `contact.get`/`booking.create` return a structured `fail(...)` (escalate) — never call the store with `undefined`.

**New-lead reconciliation + latent bug fix.** The authoritative contactId for a brand-new lead is minted _inside_ `alexBuilder` (`alex.ts:50-60`, `resolvedContactId`), which is currently used only to create the Opportunity and then discarded. Separately, `LEAD_PROFILE` is built from the _original_ contactId, not `resolvedContactId` (`alex.ts:89`) — a latent bug producing a null profile for new non-WhatsApp leads. Fix:

1. Hoist `resolvedContactId` to function scope in `alex.ts`; use it for the `LEAD_PROFILE` lookup (`alex.ts:89`).
2. Propagate it from `SkillMode` (after `resolveParameters`) into the execution params that feed `composeSkillRequestContext`, so the injected `ctx.contactId` is the authoritative (possibly just-minted) id rather than the stale inbound value. Whether that is a new `SkillExecutionParams.contactId` field or a write-back into the param bag is a plan decision — both reconcile the same gap.

- WhatsApp — Alex's live channel — already creates the contact pre-submit (`channel-gateway/resolve-contact-identity.ts:27-35`), so `identity.contactId` is authoritative for the live path. This fix covers other channels + the latent bug.

### Leg 3 — Server-side attendee details in `booking.create`

- `calendar-book.booking.create.execute` resolves `attendeeName` + `attendeeEmail` from the trusted `ctx.contactId` (server-side contact lookup), instead of accepting them as model arguments.
- Drop `attendeeName`/`attendeeEmail` from the model-facing `inputSchema` (`calendar-book.ts:149-150`) and update `SKILL.md:226-227`. Invites keep full attendee details; the model never sees the email.

### Leg 4 — Sanitize `LEAD_PROFILE` (defense-in-depth)

- Add a shared `sanitizeContactForPrompt(contact)` helper (new `skill-runtime/pii.ts`) returning `{ name, stage, source }` — one home for "which contact fields are prompt-safe."
- Use it in `alex.ts` and `sales-pipeline.ts` where `LEAD_PROFILE` is set. Update `sales-pipeline.test.ts:55` (an exact `toEqual` that currently asserts `{ id, name }`).
- Framed as future-proofing: prevents a later `{{LEAD_PROFILE}}` body edit from dumping PII via the template engine's object render.

## 4. Data flow (after)

```
inbound (channel-gateway; contact resolved/created pre-submit for WhatsApp)
  → CanonicalSubmitRequest.parameters { contactId, phone, ... }   (trusted; NOT model-facing)
  → PlatformIngress.submit → SkillMode
  → alexBuilder (mints/reconciles contactId; LEAD_PROFILE sanitized)
  → execution params (reconciled contactId) → composeSkillRequestContext → SkillRequestContext.contactId  (closed into every tool)
  → model prompt: name + status only  (NO phone/email/contactId)
  → model calls tools WITHOUT contactId
  → tools inject ctx.contactId; resolve attendee details / redact output server-side
  → model receives { name, stage, source }
  → reply (name OK) → customer
```

## 5. Error handling

- Fail-closed on missing `ctx.contactId` (structured `fail`, escalate to operator).
- Redaction is deny-by-default (allow-list projection), so a newly-added contact field cannot silently leak.

## 6. Testing (TDD)

- **Leg 1:** `contact.get` returns `{ name, stage, source }` — asserts no phone/email/id; `activity.list` omits `description`.
- **Leg 2:** `contactId` injected from ctx; schemas omit `contactId`/`orgId`; a model-supplied `contactId` is ignored (validator-tolerance regression); crm-query is a ctx-factory registered in `toolFactories`; new-lead `resolvedContactId` is threaded; `LEAD_PROFILE` built from `resolvedContactId`; fail-closed on missing `ctx.contactId`.
- **Leg 3:** `booking.create` resolves attendee name/email server-side; schema omits them; the persisted booking/invite carries them.
- **Leg 4:** `sanitizeContactForPrompt` drops phone/email/id; both builders use it; `sales-pipeline.test.ts` updated.
- **Regression:** Alex still books (injected contactId), still greets by name; A0 conversation eval still passes.

## 7. PR slicing (planning note)

This is one coherent capability; the plan decides one PR or two. The legs **cross-cut** the two tools and the ctx plumbing, so they do not split cleanly by leg:

- `crm-query.contact.get` is edited by Leg 1 (redact output) **and** Leg 2 (inject contactId); `calendar-book.booking.create` by Leg 2 **and** Leg 3; Leg 2's contactId plumbing spans both tools, and Leg 3 depends on it.

So **Legs 1–3 + new-lead reconciliation belong together** (the tool + ctx changes). **Leg 4** (builder `LEAD_PROFILE` sanitization) is the one cleanly-separable, independent piece — fold it in, or ship it as a small defense-in-depth follow-up. Final call in the plan.

## 8. Open items / risks

- `activity.list` redaction shape — drop `description` (default) vs. keep a redacted summary.
- New-lead reconciliation mechanism — back-write `resolvedContactId` (chosen) vs. promote pre-submit contact creation to **all** channels (cleaner long-term, larger blast radius). The chosen path is the minimum to ship safely; the promotion is a noted strategic follow-up.
- Dead-code surfaces (`system-prompt-builder.ts:88`, `prompt-assembler.ts:37`) — delete in a separate cleanup.

## 9. Verification provenance

Direction confirmed by a 4-agent parallel fan-out (mechanism / new-lead-timing risk / completeness sweep / adversarial critique) plus direct spot-checks against `main`:

- `>>> NO {{LEAD_PROFILE}} / phone / email token in any skill body <<<` (grep of `skills/`).
- `template-engine.ts:80-86` substitutes only referenced tokens.
- `SkillToolOperation` (`types.ts:198-208`) carries no tool id → `filterForReinjection` is tool-blind.
- `SKILL.md:226-227` sources `attendeeName`/`attendeeEmail` "from lead profile."
- `validateToolInput` (`input-schema-validator.ts:104-105`) is tolerant of extra fields.

The fan-out corrected three framing errors before this spec: (1) `LEAD_PROFILE` is latent, not the active surface; (2) redaction belongs at the tool boundary, not in `filterForReinjection`; (3) redacting email forces server-side attendee resolution to keep booking whole.
