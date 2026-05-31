# PII Minimization via Trusted Runtime Injection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the customer's `phone`, `email`, and internal `contactId` out of the LLM provider (the model keeps the `name`), and make the model structurally unable to name a contact — by redacting tool output and injecting `contactId` from trusted runtime context.

**Architecture:** Three coupled changes across two tools plus a context field. (1) `crm-query`/`calendar-book` read `contactId`/`orgId` from the trusted `SkillRequestContext` (never model input) and return PII-redacted output; (2) `calendar-book` resolves attendee name/email server-side from the trusted contactId; (3) `alexBuilder` surfaces the authoritative (possibly just-minted) `resolvedContactId` so the injected context is correct for new leads. Leg 4 (a tiny `sanitizeContactForPrompt` helper) is folded in.

**Tech Stack:** TypeScript (ESM, `.js` import suffixes), Vitest, pnpm workspace `@switchboard/core` + `@switchboard/api`.

**Spec:** `docs/superpowers/specs/2026-05-31-pii-minimization-design.md`. Read it first.

**Scope fence:** S3 at-rest WorkTrace redaction, token vaults, name tokenization, and multi-contact conversations are OUT (see spec §2).

---

## The TDD spine — ctx-propagation correctness

The biggest risk is `ctx.contactId` propagation. These six assertions are the backbone; every one must have a passing test before this PR merges:

1. **Model-supplied `contactId` is ignored** even if present in tool input (Task 3, Task 5).
2. **Tool execution fails closed** when `ctx.contactId` is absent (Task 3, Task 5).
3. **WhatsApp existing-contact path** injects the pre-submit contactId (Task 6 + Task 2 seam).
4. **New-lead path** injects the builder-minted `resolvedContactId` (Task 6 + Task 2 seam).
5. **Booking still creates the invite** with real attendee name/email (Task 5).
6. **Model-visible tool output never contains** `phone`, `email`, or `id` (Task 3, Task 5).

**Guardrail (do not violate):** the security guarantee comes from `execute()` reading `ctx.contactId`/`ctx.orgId` **exclusively** — NEVER from `params`. Schema omission alone is insufficient: `validateToolInput` tolerates extra fields (`input-schema-validator.ts:104-105`), so a model that still sends `contactId` must have it *ignored*, never merged. No `params.contactId ?? ctx.contactId` fallbacks.

---

## File Structure

**Modified:**
- `packages/core/src/skill-runtime/types.ts` — add `contactId?` to `SkillRequestContext`.
- `packages/core/src/skill-runtime/skill-request-context.ts` — read `contactId` from `params.parameters.contactId`.
- `packages/core/src/skill-runtime/tools/crm-query.ts` — convert to ctx-factory; redact output; read ctx ids.
- `packages/core/src/skill-runtime/tools/calendar-book.ts` — read `ctx.contactId`; resolve attendee server-side; add `contactStore` dep.
- `packages/core/src/skill-runtime/builders/alex.ts` — hoist/surface `resolvedContactId`; fix LEAD_PROFILE lookup; sanitize.
- `packages/core/src/skill-runtime/builders/sales-pipeline.ts` — sanitize LEAD_PROFILE.
- `packages/core/src/skill-runtime/skill-executor.ts` — remediation text mentions `contactId`.
- `apps/api/src/bootstrap/skill-mode.ts` — register `crm-query` ctx-factory; pass `contactStore` to calendar-book.
- `skills/alex/SKILL.md` — drop injected ids from the booking instruction.
- Test files co-located alongside each modified source.

**Created:**
- `packages/core/src/skill-runtime/pii.ts` — `sanitizeContactForPrompt()` (the one home for "prompt-safe contact fields").
- `packages/core/src/skill-runtime/pii.test.ts`.

---

## Task 1: Thread `contactId` into `SkillRequestContext`

**Files:**
- Modify: `packages/core/src/skill-runtime/types.ts` (SkillRequestContext, ~L372-383)
- Modify: `packages/core/src/skill-runtime/skill-request-context.ts`
- Test: `packages/core/src/skill-runtime/skill-request-context.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `skill-request-context.test.ts`:

```ts
it("reads contactId from params.parameters.contactId (trusted bag), never top-level/LLM", () => {
  const ctx = composeSkillRequestContext({
    skill: { body: "", parameters: [] } as never,
    parameters: { contactId: "ct_authoritative", message: "hi" },
    messages: [],
    deploymentId: "dep_1",
    orgId: "org_1",
    trustScore: 0,
    trustLevel: "supervised",
    sessionId: "sess_1",
  });
  expect(ctx.contactId).toBe("ct_authoritative");
});

it("contactId is undefined when the param bag omits it (tools fail closed downstream)", () => {
  const ctx = composeSkillRequestContext({
    skill: { body: "", parameters: [] } as never,
    parameters: {},
    messages: [],
    deploymentId: "dep_1",
    orgId: "org_1",
    trustScore: 0,
    trustLevel: "supervised",
  });
  expect(ctx.contactId).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test -- skill-request-context`
Expected: FAIL — `ctx.contactId` is `undefined` (first test) because the field isn't read yet.

- [ ] **Step 3: Add the field to the interface**

In `types.ts`, inside `SkillRequestContext` (after `deploymentId`):

```ts
export interface SkillRequestContext {
  sessionId: string;
  orgId: string;
  deploymentId: string;
  /** Authoritative contact for this conversation. Sourced ONLY from trusted
   * server params (the work-unit/builder param bag), never from LLM tool input.
   * Tools read this instead of accepting contactId as a model argument. */
  contactId?: string;
  actorId?: string;
  // ...rest unchanged
}
```

- [ ] **Step 4: Read it in `composeSkillRequestContext`**

In `skill-request-context.ts`, add one line to the returned object:

```ts
export function composeSkillRequestContext(params: SkillExecutionParams): SkillRequestContext {
  return {
    sessionId: params.sessionId ?? `${params.deploymentId}-${Date.now()}`,
    orgId: params.orgId,
    deploymentId: params.deploymentId,
    contactId:
      typeof params.parameters.contactId === "string" ? params.parameters.contactId : undefined,
    workUnitId: params.workUnitId,
    delegationDepth: params.delegationDepth,
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @switchboard/core test -- skill-request-context`
Expected: PASS (both new tests + existing).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/skill-runtime/types.ts packages/core/src/skill-runtime/skill-request-context.ts packages/core/src/skill-runtime/skill-request-context.test.ts
git commit -m "feat(core): thread trusted contactId into SkillRequestContext"
```

---

## Task 2: `sanitizeContactForPrompt` helper (Leg 4 foundation + redaction reuse)

**Files:**
- Create: `packages/core/src/skill-runtime/pii.ts`
- Test: `packages/core/src/skill-runtime/pii.test.ts`

- [ ] **Step 1: Write the failing test**

Create `pii.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sanitizeContactForPrompt } from "./pii.js";

describe("sanitizeContactForPrompt", () => {
  it("keeps name/stage/source, drops phone/email/id (deny-by-default)", () => {
    const out = sanitizeContactForPrompt({
      id: "ct_1",
      name: "Jane Tan",
      phone: "+6591234567",
      email: "jane@example.com",
      stage: "qualified",
      source: "whatsapp",
      secretFutureField: "leak",
    });
    expect(out).toEqual({ name: "Jane Tan", stage: "qualified", source: "whatsapp" });
  });

  it("returns null for a null contact", () => {
    expect(sanitizeContactForPrompt(null)).toBeNull();
  });

  it("coerces non-string field values to null (no objects/numbers pass through)", () => {
    const out = sanitizeContactForPrompt({ name: { nested: "x" }, stage: 123, source: ["a"] });
    expect(out).toEqual({ name: null, stage: null, source: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test -- pii`
Expected: FAIL — module `./pii.js` not found.

- [ ] **Step 3: Implement the helper**

Create `pii.ts`:

```ts
/** Prompt-safe projection of a contact. Allow-list ONLY: any field not named
 * here (phone, email, id, …) is dropped, so a new PII column can never silently
 * reach the model. The customer's name is intentionally retained for natural
 * conversation; phone/email/contactId are never prompt- or model-visible. */
export interface PromptSafeContact {
  name?: string | null;
  stage?: string | null;
  source?: string | null;
}

const asStringOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);

export function sanitizeContactForPrompt(contact: unknown): PromptSafeContact | null {
  if (contact === null || typeof contact !== "object") return null;
  const c = contact as Record<string, unknown>;
  // Type-safe allow-list: only string values survive; anything else (object,
  // number, undefined) coerces to null so an unexpected shape can't pass through
  // as name/stage/source.
  return {
    name: asStringOrNull(c["name"]),
    stage: asStringOrNull(c["stage"]),
    source: asStringOrNull(c["source"]),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/core test -- pii`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/skill-runtime/pii.ts packages/core/src/skill-runtime/pii.test.ts
git commit -m "feat(core): add sanitizeContactForPrompt PII allow-list helper"
```

---

## Task 3: `crm-query` → ctx-factory, redact output, inject ids

**Files:**
- Modify: `packages/core/src/skill-runtime/tools/crm-query.ts`
- Test: `packages/core/src/skill-runtime/tools/crm-query.test.ts`

This converts `createCrmQueryTool(deps)` → `createCrmQueryToolFactory(deps) => (ctx) => SkillTool`, reads `ctx.contactId`/`ctx.orgId`, drops both from the schemas, redacts `contact.get` output via `sanitizeContactForPrompt`, and drops `description` from `activity.list` output.

- [ ] **Step 1: Rewrite the test file**

Replace `crm-query.test.ts` with:

```ts
import { describe, it, expect, vi } from "vitest";
import { createCrmQueryToolFactory } from "./crm-query.js";
import type { SkillRequestContext } from "../types.js";

const CTX: SkillRequestContext = {
  sessionId: "s1",
  orgId: "org1",
  deploymentId: "d1",
  contactId: "c1",
};

function makeStores() {
  return {
    contactStore: {
      findById: vi.fn().mockResolvedValue({
        id: "c1",
        name: "Alice",
        phone: "+1234",
        email: "alice@example.com",
        stage: "new",
        source: "whatsapp",
      }),
    },
    activityStore: {
      listByDeployment: vi
        .fn()
        .mockResolvedValue([{ id: "a1", eventType: "message", description: "called +1234" }]),
    },
  };
}

describe("crm-query ctx-factory", () => {
  it("contact.get uses ctx.contactId/ctx.orgId, not model input", async () => {
    const stores = makeStores();
    const tool = createCrmQueryToolFactory(stores.contactStore, stores.activityStore)(CTX);
    // Model tries to supply a DIFFERENT contactId — it must be ignored.
    await tool.operations["contact.get"]!.execute({ contactId: "ATTACKER", orgId: "ATTACKER_ORG" });
    expect(stores.contactStore.findById).toHaveBeenCalledWith("org1", "c1");
  });

  it("contact.get output is redacted to {name, stage, source} — no phone/email/id", async () => {
    const stores = makeStores();
    const tool = createCrmQueryToolFactory(stores.contactStore, stores.activityStore)(CTX);
    const result = await tool.operations["contact.get"]!.execute({});
    expect(result.status).toBe("success");
    expect(result.data).toEqual({ name: "Alice", stage: "new", source: "whatsapp" });
    expect(JSON.stringify(result.data)).not.toContain("+1234");
    expect(JSON.stringify(result.data)).not.toContain("alice@example.com");
    expect(JSON.stringify(result.data)).not.toContain("c1");
  });

  it("contact.get fails closed when ctx.contactId is absent", async () => {
    const stores = makeStores();
    const tool = createCrmQueryToolFactory(stores.contactStore, stores.activityStore)({
      ...CTX,
      contactId: undefined,
    });
    const result = await tool.operations["contact.get"]!.execute({});
    expect(result.status).not.toBe("success");
    expect(stores.contactStore.findById).not.toHaveBeenCalled();
  });

  it("contact.get inputSchema omits contactId and orgId", () => {
    const stores = makeStores();
    const tool = createCrmQueryToolFactory(stores.contactStore, stores.activityStore)(CTX);
    const schema = tool.operations["contact.get"]!.inputSchema as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(schema.properties).not.toHaveProperty("contactId");
    expect(schema.properties).not.toHaveProperty("orgId");
    expect(schema.required).toHaveLength(0);
  });

  it("activity.list uses ctx.orgId and drops the free-text description", async () => {
    const stores = makeStores();
    const tool = createCrmQueryToolFactory(stores.contactStore, stores.activityStore)(CTX);
    const result = await tool.operations["activity.list"]!.execute({ deploymentId: "d1", limit: 5 });
    expect(stores.activityStore.listByDeployment).toHaveBeenCalledWith("org1", "d1", { limit: 5 });
    const activities = (result.data as { activities: Array<Record<string, unknown>> }).activities;
    expect(activities[0]).not.toHaveProperty("description");
    expect(JSON.stringify(result.data)).not.toContain("+1234");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test -- crm-query`
Expected: FAIL — `createCrmQueryToolFactory` is not exported.

- [ ] **Step 3: Rewrite `crm-query.ts`**

```ts
import type { SkillTool, SkillRequestContext } from "../types.js";
import { ok, fail } from "../tool-result.js";
import { sanitizeContactForPrompt } from "../pii.js";

interface ContactStoreSubset {
  findById(orgId: string, contactId: string): Promise<unknown>;
}

interface ActivityStoreSubset {
  listByDeployment(orgId: string, deploymentId: string, opts: { limit: number }): Promise<unknown>;
}

/** Factory-with-context: trust-bound ids (orgId, contactId) are closed in from
 * the SkillRequestContext, never accepted from LLM tool input. */
export function createCrmQueryToolFactory(
  contactStore: ContactStoreSubset,
  activityStore: ActivityStoreSubset,
): (ctx: SkillRequestContext) => SkillTool {
  return (ctx) => ({
    id: "crm-query",
    operations: {
      "contact.get": {
        description: "Get the current contact. Returns name, stage, source.",
        effectCategory: "read" as const,
        idempotent: true,
        inputSchema: { type: "object", properties: {}, required: [] },
        execute: async (_params: unknown) => {
          if (!ctx.contactId) {
            return fail(
              "execution",
              "MISSING_CONTACT",
              "No contact is associated with this conversation.",
              {
                modelRemediation:
                  "Do not call contact.get. Continue without contact details or escalate to the operator.",
                retryable: false,
              },
            );
          }
          const contact = await contactStore.findById(ctx.orgId, ctx.contactId);
          return ok(sanitizeContactForPrompt(contact) as unknown as Record<string, unknown>);
        },
      },
      "activity.list": {
        description: "List recent activity for this deployment.",
        effectCategory: "read" as const,
        idempotent: true,
        inputSchema: {
          type: "object",
          properties: {
            deploymentId: { type: "string" },
            limit: { type: "number", description: "Max results (default 20)" },
          },
          required: ["deploymentId"],
        },
        execute: async (params: unknown) => {
          const { deploymentId, limit } = params as { deploymentId: string; limit?: number };
          const rows = (await activityStore.listByDeployment(ctx.orgId, deploymentId, {
            limit: limit ?? 20,
          })) as Array<Record<string, unknown>>;
          // Drop the free-text `description` (may carry PII a producer logged).
          const activities = rows.map(({ description: _description, ...rest }) => rest);
          return ok({ activities } as Record<string, unknown>);
        },
      },
    },
  });
}
```

> `fail` is overloaded (`tool-result.ts:45-51`): use the category form `fail(category, code, message, opts)` where `category` ∈ `ERROR_CATEGORIES` — `"execution"` is valid (see `skill-executor.ts:395`). `opts` is `{ modelRemediation?, retryable?, ... }`. (The legacy 3-arg `fail(code, message, opts)` is what `calendar-book` uses for booking errors — don't confuse the two.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/core test -- crm-query`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/skill-runtime/tools/crm-query.ts packages/core/src/skill-runtime/tools/crm-query.test.ts
git commit -m "feat(core): crm-query ctx-factory + PII-redacted output (Legs 1+2)"
```

---

## Task 4: Register `crm-query` factory in the executor path

**Files:**
- Modify: `apps/api/src/bootstrap/skill-mode.ts` (~L309-335)

Without this, the executor dispatches the schema-only `__schema_only__` ctx (orgId/contactId = `"__schema_only__"`) — a silent breakage. `crm-query` must be in `toolFactories`, and its `toolsMap` entry must use the factory with `SCHEMA_ONLY_CTX`.

- [ ] **Step 1: Update the imports + factory construction**

Change the import of `createCrmQueryTool` → `createCrmQueryToolFactory`, then near the other factories (~L309):

```ts
const crmQueryFactory = createCrmQueryToolFactory(contactStore, activityStore);
```

- [ ] **Step 2: Add to the execution map**

In the `toolFactories` map (~L314-318), add the entry:

```ts
const toolFactories = new Map<string, SkillToolFactory>([
  ["crm-query", crmQueryFactory],
  ["calendar-book", calendarBookFactory],
  ["crm-write", crmWriteFactory],
  ["escalate", escalateFactory],
]);
```

- [ ] **Step 3: Update the schema-only map**

In `toolsMap` (~L329-335), replace the plain construction with the factory + synthetic ctx:

```ts
const toolsMap = new Map([
  ["crm-query", crmQueryFactory(SCHEMA_ONLY_CTX)],
  ["crm-write", crmWriteFactory(SCHEMA_ONLY_CTX)],
  ["calendar-book", calendarBookFactory(SCHEMA_ONLY_CTX)],
  ["escalate", escalateFactory(SCHEMA_ONLY_CTX)],
]);
```

- [ ] **Step 4: Verify no other callers of the old export**

Run: `grep -rn "createCrmQueryTool\b" packages apps --include="*.ts"`
Expected: only the new factory name remains (crm-query.ts def, its test, this bootstrap). Update any stragglers.

- [ ] **Step 5: Typecheck the api package**

Run: `pnpm --filter @switchboard/api typecheck`
Expected: PASS (no missing-export or arity errors).

- [ ] **Step 5b: Add a wiring test only if a harness already exists**

Check: `ls apps/api/src/bootstrap/*.test.ts apps/api/src/bootstrap/__tests__/* 2>/dev/null | grep -i skill-mode`. If a bootstrap test harness exists, add a test asserting `crm-query` resolves from `toolFactories` and materializes with a REAL ctx (its `contact.get` reflects a non-`__schema_only__` orgId — i.e. it is NOT the schema-only entry). If no cheap harness exists, do NOT build one — record in the PR summary that crm-query registration is covered by typecheck + the crm-query unit tests only.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/bootstrap/skill-mode.ts
git commit -m "feat(api): register crm-query as a trust-bound ctx-factory"
```

---

## Task 5: `calendar-book` — inject contactId + resolve attendee server-side (Legs 2+3)

**Files:**
- Modify: `packages/core/src/skill-runtime/tools/calendar-book.ts` (deps interface; `booking.create`)
- Modify: `apps/api/src/bootstrap/skill-mode.ts` (pass `contactStore` to `calendarBookFactory`)
- Test: `packages/core/src/skill-runtime/tools/calendar-book.test.ts`

`booking.create` must (a) read `ctx.contactId` (drop from schema, fail-closed), and (b) resolve `attendeeName`/`attendeeEmail` from the contact server-side (drop both from the model schema).

- [ ] **Step 1: Write the failing tests**

Add to `calendar-book.test.ts`. First extend the harness — add a contact store and put `contactId` on the ctx:

```ts
function makeContactStore() {
  return {
    findById: vi.fn().mockResolvedValue({
      id: "ct_1",
      name: "Jane Tan",
      email: "jane@example.com",
      phone: "+6591234567",
    }),
  };
}
// In beforeEach: const contactStore = makeContactStore(); pass `contactStore` into the deps object,
// and set: tool = factory({ ...TRUSTED_CTX, contactId: "ct_1" });
```

Then the assertions:

```ts
it("booking.create inputSchema omits contactId, attendeeName, attendeeEmail", () => {
  const schema = tool.operations["booking.create"]!.inputSchema as {
    properties: Record<string, unknown>;
    required: string[];
  };
  expect(schema.properties).not.toHaveProperty("contactId");
  expect(schema.properties).not.toHaveProperty("attendeeName");
  expect(schema.properties).not.toHaveProperty("attendeeEmail");
  expect(schema.required).not.toContain("contactId");
});

it("booking.create uses ctx.contactId (ignores model-supplied) and resolves attendee server-side", async () => {
  bookingStore.create.mockResolvedValue({ id: "bk_1" });
  opportunityStore.findActiveByContact.mockResolvedValue({ id: "opp_1" });
  calendarProvider.createBooking.mockResolvedValue({ calendarEventId: "gcal_1" });
  await tool.operations["booking.create"]!.execute({
    contactId: "ATTACKER", // must be ignored
    service: "botox",
    slotStart: "2026-06-01T10:00:00Z",
    slotEnd: "2026-06-01T10:30:00Z",
    calendarId: "primary",
  });
  // contact resolved from ctx, not model input
  expect(bookingStore.create).toHaveBeenCalledWith(
    expect.objectContaining({
      contactId: "ct_1",
      attendeeName: "Jane Tan",
      attendeeEmail: "jane@example.com",
    }),
  );
});

it("booking.create fails closed when ctx.contactId is absent", async () => {
  tool = factory({ ...TRUSTED_CTX, contactId: undefined });
  const result = await tool.operations["booking.create"]!.execute({
    service: "botox",
    slotStart: "2026-06-01T10:00:00Z",
    slotEnd: "2026-06-01T10:30:00Z",
    calendarId: "primary",
  });
  expect(result.status).not.toBe("success");
  expect(bookingStore.create).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @switchboard/core test -- calendar-book`
Expected: FAIL — schema still has contactId; no contactStore dep.

- [ ] **Step 3: Add `contactStore` to deps + resolve attendee in `booking.create`**

In `calendar-book.ts`, add to `CalendarBookToolDeps`:

```ts
interface CalendarBookToolDeps {
  // ...existing deps
  contactStore: { findById(orgId: string, contactId: string): Promise<unknown> };
}
```

Update `booking.create`'s `inputSchema` to drop `contactId`, `attendeeName`, `attendeeEmail`:

```ts
inputSchema: {
  type: "object",
  properties: {
    service: { type: "string" },
    slotStart: { type: "string", description: "ISO 8601" },
    slotEnd: { type: "string", description: "ISO 8601" },
    calendarId: { type: "string" },
  },
  required: ["service", "slotStart", "slotEnd", "calendarId"],
},
```

At the top of `booking.create.execute`, replace the model-supplied `input.contactId`/attendee usage:

```ts
execute: async (params: unknown): Promise<ToolResult> => {
  const input = params as {
    service: string;
    slotStart: string;
    slotEnd: string;
    calendarId: string;
  };
  const orgId = ctx.orgId;
  const contactId = ctx.contactId;
  if (!contactId) {
    return fail("execution", "MISSING_CONTACT", "No contact is associated with this conversation.", {
      modelRemediation:
        "Do not call booking.create without an active contact. Escalate to the operator.",
      retryable: false,
    });
  }
  const contactRecord = (await deps.contactStore.findById(orgId, contactId)) as {
    name?: string | null;
    email?: string | null;
  } | null;
  const attendeeName = contactRecord?.name ?? null;
  const attendeeEmail = contactRecord?.email ?? null;
  // ...then replace EVERY `input.contactId` below with `contactId`,
  // every `input.attendeeName` with `attendeeName`, every `input.attendeeEmail` with `attendeeEmail`.
  // (sites: opportunity lookup/create, bookingStore.create, provider.createBooking, failureHandler, outbox payload)
```

> There are ~8 `input.contactId` references in `booking.create` (lines ~172-292) and 2 attendee references (`:194-195`, `:234-235`). Replace all. Do NOT leave a `params.contactId` read anywhere.

- [ ] **Step 4: Pass `contactStore` to the factory in bootstrap**

In `apps/api/src/bootstrap/skill-mode.ts`, where `calendarBookFactory = createCalendarBookToolFactory({ ... })` is constructed, add `contactStore,` to the deps object (the same `contactStore` already used for crm-query).

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @switchboard/core test -- calendar-book`
Expected: PASS (new + existing — existing booking tests that passed `contactId`/`attendeeName` in input still pass because those fields are now ignored; verify none asserted the schema *contains* contactId).

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @switchboard/core typecheck && pnpm --filter @switchboard/api typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/skill-runtime/tools/calendar-book.ts packages/core/src/skill-runtime/tools/calendar-book.test.ts apps/api/src/bootstrap/skill-mode.ts
git commit -m "feat(core): booking.create injects contactId + resolves attendee server-side (Legs 2+3)"
```

---

## Task 6: `alexBuilder` — surface authoritative contactId + fix LEAD_PROFILE + sanitize

**Files:**
- Modify: `packages/core/src/skill-runtime/builders/alex.ts`
- Test: `packages/core/src/skill-runtime/builders/alex.test.ts`

This closes spine cases 3 & 4: hoist `resolvedContactId` (init from `config.contactId`, update on mint), use it for the `LEAD_PROFILE` lookup (fixing the latent bug at `alex.ts:89`), surface it in the returned `parameters.contactId` (so `composeSkillRequestContext` injects the authoritative id), and sanitize `LEAD_PROFILE`.

- [ ] **Step 1: Write the failing tests**

Add to `alex.test.ts`:

```ts
it("surfaces resolvedContactId as parameters.contactId for an EXISTING contact", async () => {
  // existing contact + active opportunity → no mint; contactId passes through
  const result = await alexBuilder(ctx, { ...config, contactId: "ct_existing" }, stores, services);
  expect(result.parameters.contactId).toBe("ct_existing");
});

it("surfaces the MINTED contactId for a brand-new lead", async () => {
  stores.opportunityStore.findActiveByContact.mockResolvedValue([]);
  stores.contactStore.findById.mockResolvedValue(null); // no existing contact
  stores.contactStore.create.mockResolvedValue({ id: "ct_minted" });
  stores.opportunityStore.create.mockResolvedValue({ id: "opp_new", stage: "new", createdAt: new Date() });
  const result = await alexBuilder(ctx, { ...config, contactId: "ct_stale" }, stores, services);
  expect(result.parameters.contactId).toBe("ct_minted");
});

it("LEAD_PROFILE is sanitized — no phone/email/id", async () => {
  stores.contactStore.findById.mockResolvedValue({
    id: "ct_1", name: "Jane", phone: "+65...", email: "j@x.com", stage: "new", source: "whatsapp",
  });
  const result = await alexBuilder(ctx, config, stores, services);
  expect(result.parameters.LEAD_PROFILE).toEqual({ name: "Jane", stage: "new", source: "whatsapp" });
});

it("never calls findById with an undefined id; LEAD_PROFILE is null when no contact resolves", async () => {
  // existing opportunity → skip minting; contactId undefined → resolvedContactId stays undefined
  stores.opportunityStore.findActiveByContact.mockResolvedValue([
    { id: "opp", stage: "new", createdAt: new Date() },
  ]);
  stores.contactStore.findById.mockClear();
  const result = await alexBuilder(ctx, { ...config, contactId: undefined as never }, stores, services);
  expect(result.parameters.LEAD_PROFILE).toBeNull();
  for (const call of stores.contactStore.findById.mock.calls) {
    expect(call[1]).not.toBeUndefined();
  }
});
```

> Match the existing `alex.test.ts` harness for `ctx`/`config`/`stores`/`services` construction — reuse its `beforeEach`. Some of these tests are API-key-gated; if the suite skips under no key, run the builder unit directly.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @switchboard/core test -- builders/alex`
Expected: FAIL — `parameters.contactId` undefined; `LEAD_PROFILE` still raw.

- [ ] **Step 3: Edit `alex.ts`**

Hoist `resolvedContactId` to function scope and seed it from `config.contactId`:

```ts
const contactId = config.contactId;
const orgId = config.orgId;
let resolvedContactId = contactId; // authoritative id, updated if we mint a new contact
```

Inside the `if (opportunities.length === 0)` block, the existing assignments to `resolvedContactId` now target the function-scope binding (remove the inner `let resolvedContactId = contactId;` shadow). Then fix the LEAD_PROFILE lookup to use the resolved id:

```ts
// Guard: NEVER call findById with an undefined id. If no contact resolved
// (config.contactId absent AND no mint), LEAD_PROFILE is null; the existing
// no-opportunity ParameterResolutionError (alex.ts:76-82) still escalates.
const leadProfile = resolvedContactId
  ? await stores.contactStore.findById(orgId, resolvedContactId)
  : null;
```

Sanitize it and surface contactId in the returned parameters:

```ts
import { sanitizeContactForPrompt } from "../pii.js";
// ...
const parameters = {
  BUSINESS_NAME: ctx.persona.businessName,
  OPPORTUNITY_ID: opportunity.id,
  LEAD_PROFILE: sanitizeContactForPrompt(leadProfile),
  // contactId is a TRUSTED runtime value (read by composeSkillRequestContext),
  // not a prompt token — no SKILL.md body interpolates it.
  contactId: resolvedContactId,
  BUSINESS_FACTS,
  OUTCOME_PATTERNS,
  PERSONA_CONFIG: { /* unchanged */ },
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @switchboard/core test -- builders/alex`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/skill-runtime/builders/alex.ts packages/core/src/skill-runtime/builders/alex.test.ts
git commit -m "fix(core): alex surfaces authoritative contactId + sanitizes LEAD_PROFILE"
```

---

## Task 7: `sales-pipeline` builder — sanitize LEAD_PROFILE (second consumer)

**Files:**
- Modify: `packages/core/src/skill-runtime/builders/sales-pipeline.ts` (~L21-27)
- Test: `packages/core/src/skill-runtime/builders/sales-pipeline.test.ts` (~L55)

- [ ] **Step 1: Update the failing test**

`sales-pipeline.test.ts:55` currently asserts `expect(result.LEAD_PROFILE).toEqual({ id: "c1", name: "Alice" })`. Change it to the sanitized shape:

```ts
expect(result.LEAD_PROFILE).toEqual({ name: "Alice", stage: null, source: null });
```

(Adjust `stage`/`source` to whatever the test's mock contact provides; if the mock is `{ id, name }` only, the helper yields `{ name, stage: null, source: null }`.)

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @switchboard/core test -- sales-pipeline`
Expected: FAIL — current builder returns the raw record `{ id, name }`.

- [ ] **Step 3: Apply the helper**

In `sales-pipeline.ts`, import `sanitizeContactForPrompt` and wrap the assignment:

```ts
import { sanitizeContactForPrompt } from "../pii.js";
// ...
LEAD_PROFILE: sanitizeContactForPrompt(leadProfile),
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @switchboard/core test -- sales-pipeline`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/skill-runtime/builders/sales-pipeline.ts packages/core/src/skill-runtime/builders/sales-pipeline.test.ts
git commit -m "fix(core): sanitize LEAD_PROFILE in sales-pipeline builder"
```

---

## Task 8: Prompt + remediation text alignment

**Files:**
- Modify: `skills/alex/SKILL.md` (~L219-227)
- Modify: `packages/core/src/skill-runtime/skill-executor.ts` (~L400-401)

The model must no longer be told to supply `contactId`/`attendeeName`/`attendeeEmail` (all injected now).

- [ ] **Step 1: Edit the booking instruction in `SKILL.md`**

In the `calendar-book.booking.create` instruction block, remove these lines (they're runtime-injected now):
- `- contactId: contact ID from context` (`:221`)
- `- attendeeName: from lead profile if known` (`:226`)
- `- attendeeEmail: from lead profile if known` (`:227`)

Leave `service`, `slotStart`, `slotEnd`, `calendarId: "primary"`.

- [ ] **Step 2: Update the validator remediation text**

In `skill-executor.ts:400-401`, change the `modelRemediation` to list `contactId`:

```ts
modelRemediation:
  "Re-issue the tool call with input matching the declared inputSchema. Do not include trust-bound identifiers (orgId, deploymentId, contactId) — those are injected by the runtime.",
```

- [ ] **Step 3: Verify build + full core suite**

Run: `pnpm --filter @switchboard/core test && pnpm --filter @switchboard/core typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add skills/alex/SKILL.md packages/core/src/skill-runtime/skill-executor.ts
git commit -m "docs(core): stop instructing the model to supply injected identifiers"
```

---

## Task 9: Whole-suite verification

- [ ] **Step 1: Full build, typecheck, tests**

Run: `pnpm build && pnpm typecheck && pnpm test`
Expected: PASS. (If `pnpm typecheck` reports stale missing exports from lower layers, run `pnpm reset` first — see CLAUDE.md.)

- [ ] **Step 2: Confirm the six spine assertions each have a passing test**

Cross off against the test files: (1) ignore model contactId — Task 3 + Task 5; (2) fail-closed — Task 3 + Task 5; (3) existing-contact passthrough — Task 6 (`ct_existing`) + Task 1; (4) new-lead minted id — Task 6 (`ct_minted`) + Task 1; (5) invite keeps attendee — Task 5; (6) output has no phone/email/id — Task 3 + Task 6.

- [ ] **Step 3: Format check (CI runs prettier; local lint does not)**

Run: `pnpm format:check`
Expected: PASS (or `pnpm format` then re-stage).

- [ ] **Step 4: Stop before merge**

Do NOT merge. Push the branch and open a PR titled `feat: PII minimization via trusted runtime injection (Legs 1–3 + reconciliation)`. Per the user's instruction: **stop before merge.**

PR summary must include:
- The six-case spine + the guardrail (`execute` reads `ctx` only; schema omission is NOT protection — the validator tolerates extra fields).
- **`activity.list` model-facing `description` is intentionally removed** — producer-entered descriptions may contain PII. If any consumer expected that text, this is a deliberate v1 trade-off (a redacted summarization layer can come later).
- **`crm-query` factory registration** (Task 4): covered by typecheck + crm-query unit tests (+ a bootstrap wiring test if one was cheap). Call out the `__schema_only__` footgun so reviewers verify crm-query is in `toolFactories`, not just `toolsMap`.

---

## Notes for the implementer
- **ESM:** every relative import ends in `.js` (e.g. `../pii.js`).
- **No `params.contactId` fallbacks anywhere** — the guarantee is execute-reads-ctx-only.
- **Non-negotiable tests:** the "ignores model-supplied contactId" assertions (Task 3 `contact.get`, Task 5 `booking.create`) MUST inspect the **downstream call args** — `findById`/`bookingStore.create` invoked with the *ctx* id, never the attacker-supplied id. Schema omission is not protection (validator tolerates extras), so keep these even if they look redundant.
- **`fail(...)` is overloaded** (`tool-result.ts:45-51`): the fail-closed branches use the category form `fail("execution", "MISSING_CONTACT", message, { modelRemediation, retryable: false })`; the legacy 3-arg form is what `calendar-book` uses for booking errors.
- **API-key-gated tests:** some `alex.test.ts` cases skip without `ANTHROPIC_API_KEY`; the builder-unit assertions in Task 6 should run regardless — if they're gated, factor the builder assertions into a non-gated `describe`.
- **Leg 4 is folded in (Tasks 2/6/7)** because it stayed tiny (one helper + two call-site changes), per the approved scope.
