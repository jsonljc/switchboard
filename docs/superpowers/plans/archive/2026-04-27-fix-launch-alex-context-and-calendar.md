# Fix: Alex Builder Context + LocalCalendarProvider — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four runtime bugs in the chat-message → skill-execution → booking path per `docs/superpowers/specs/2026-04-27-fix-launch-alex-context-and-calendar-design.md`. Audit's #7 and #10 are already shipped — verified during Task 1; this branch covers the residual #8 (chat-gateway WhatsApp contact identity + skill-mode config forwarding) and #9 (LocalCalendarProvider emailSender + listAvailableSlots org-scope leak) bugs only.

**Architecture:** Resolve WhatsApp contact identity at the channel-gateway boundary using a narrow `GatewayContactStore` interface in `packages/core`, with `apps/chat` wiring the concrete Prisma store. Forward phone+channel through skill-mode's alexBuilder config. Wire Resend-based booking confirmation emails into `LocalCalendarProvider` (gated on env-var verification). Bake orgId into the `LocalBookingStore.findOverlapping` closure to eliminate cross-tenant slot-availability leakage.

**Tech Stack:** TypeScript, Fastify (apps/api), Prisma, Vitest, ESM workspace imports.

---

## Preconditions

- Branch: `fix/launch-alex-context-and-calendar` (rebase onto `origin/main`; predecessor PR #279 has merged)
- Spec at `docs/superpowers/specs/2026-04-27-fix-launch-alex-context-and-calendar-design.md` reviewed and approved by the user
- This plan must be executed task-by-task; Task 1 is **read-only** and gates Sections 1–4

---

### Task 1: Read-only verification (hard stops before any code)

This is a **read-only** diagnostic task. No source files are modified. Findings are written to a scratch note and may pause specific later tasks.

**Files:**

- Create (scratch, not committed in production code paths): `.audit/11-fix-prep-notes-alex-context.md`

- [ ] **Step 1: Confirm `ChannelGatewayConfig` shape and package boundary**

Run:

```bash
sed -n '1,80p' packages/core/src/channel-gateway/types.ts
```

Expected: `ChannelGatewayConfig` exists with `conversationStore`, `deploymentResolver`, `platformIngress`, optional `onMessageRecorded`. Confirm file path is `packages/core/src/channel-gateway/types.ts`.

If the file path or interface name differs from the spec, document the actual shape in the scratch note and adjust Tasks 2–4 file paths accordingly before continuing.

- [ ] **Step 2: Confirm `PrismaContactStore` API compatibility**

Run:

```bash
grep -n "findByPhone\|^  async create\|export class PrismaContactStore" packages/db/src/stores/prisma-contact-store.ts
grep -rn "PrismaContactStore" packages/db/src/index.ts packages/db/src/stores/index.ts 2>/dev/null
```

Expected:

- `findByPhone(orgId: string, phone: string): Promise<Contact | null>` exists at `prisma-contact-store.ts:83`
- `create(input: CreateContactInput): Promise<Contact>` exists at `prisma-contact-store.ts:44`
- `PrismaContactStore` is exported from `@switchboard/db`

If any check fails, **stop** before coding Section 1 and revise the design.

- [ ] **Step 3: Confirm WhatsApp `sessionId` is the sender phone (E.164)**

Run:

```bash
grep -n "sessionId\|fromPhoneNumber\|from\.phone\|wa_id" apps/chat/src/adapters/whatsapp.ts apps/chat/src/managed/managed-whatsapp-adapter.ts 2>/dev/null
```

Read the relevant adapter file(s) and trace where `IncomingChannelMessage.sessionId` is set. Confirm it equals the inbound sender's E.164 phone number (the WhatsApp `from` / `wa_id` field), not a hashed value or a Meta-internal id.

If the adapter sets `sessionId` to anything other than the sender's phone, **stop** before coding Section 1 and surface the finding for revision (Section 1's WhatsApp branch needs a different identity source).

Document the exact line that sets `sessionId` in the scratch note.

- [ ] **Step 4: Confirm `resolved.organizationId` available before `ingress.submit`**

Read `packages/core/src/channel-gateway/channel-gateway.ts` lines 13–34 (the `deploymentResolver.resolveByChannelToken` call). Confirm:

- `resolved.organizationId` is set after the resolver call (lines 14–16) and is truthy on the happy path
- It is already used at line 75 (`organizationId: resolved.organizationId`) in the request submission

Expected: yes on both. Document in the scratch note. If not, **stop** before coding Section 1.

- [ ] **Step 5: Audit `LocalBookingStore.findOverlapping` consumers**

Run:

```bash
grep -rn "findOverlapping\|LocalBookingStore" packages apps --include="*.ts" --include="*.tsx" 2>/dev/null | grep -v ".worktrees" | grep -v node_modules
```

Expected consumers:

- `packages/core/src/calendar/local-calendar-provider.ts` (interface declaration + use site)
- `apps/api/src/bootstrap/skill-mode.ts` (wrapper closure, ~line 320)
- Test files (`packages/core/src/calendar/local-calendar-provider.test.ts`, possibly others)

If a **third real consumer** exists outside these files, **stop** before coding Section 4 — likely capture orgId in that consumer's closure too rather than re-adding the parameter. Document any unexpected consumers in the scratch note.

- [ ] **Step 6: Resend sender-address env var situation (Section 3 hard stop)**

Run:

```bash
grep -rn "RESEND_API_KEY\|resend\.com\|from:.*@\|EmailSender\b" apps/api/src packages/core/src --include="*.ts" 2>/dev/null | grep -v __tests__ | grep -v ".test." | grep -v ".worktrees" | head -40
```

Read every match. Determine:

- Does an existing env var hold a sender address (e.g. `RESEND_FROM_EMAIL`, `ESCALATION_FROM_EMAIL`, similar)? Note the exact name.
- Where is the existing escalation Resend POST call located? Note the file + lines.

Decide one of three branches and write it to the scratch note as a single labeled decision (`SECTION_3_DECISION: <REUSE | OPTION_A | OPTION_B>`):

- **REUSE** — An existing sender-address env var is found. Section 3 reuses it; no new env var. Proceed to Tasks 7–8 as written, substituting the discovered env var name everywhere `BOOKING_FROM_EMAIL` appears in this plan.
- **OPTION_A** — No sender env var exists, **and** the user has explicitly approved adding `BOOKING_FROM_EMAIL`. Proceed to Tasks 7–8 as written; ensure `.env.example` is updated and bootstrap tests cover set/unset.
- **OPTION_B** — No sender env var exists, and we split production email delivery into a follow-up. In this branch:
  - Wire the `emailSender` _seam_ into `LocalCalendarProvider` only (Task 8 still passes a sender in via constructor when an env-var-derived callback is present).
  - In Task 7, build the Resend-calling helper but **do not** wire it into bootstrap. Production code path remains "no emailSender, log a one-line warning at boot."
  - Do not call Resend from any production runtime code in this branch.

If the decision is ambiguous after reading the code, **stop** and present the choice to the user before proceeding to Task 7.

- [ ] **Step 7: Confirm `alexBuilder` config type accepts `phone` and `channel`**

Run:

```bash
grep -n "config\.phone\|config\.channel\|ParameterBuilder" packages/core/src/skill-runtime/builders/alex.ts packages/core/src/skill-runtime/parameter-builder.ts
```

Expected:

- `alex.ts:19` reads `config.phone`
- `alex.ts:20` reads `config.channel`
- The `ParameterBuilder` type's `config` parameter is `Record<string, unknown>` or a union that already permits these fields without TypeScript widening

If the `ParameterBuilder` config type is strict (e.g., `{ deploymentId, orgId, contactId }`), document the needed widening as a pre-step for Task 6. If it is already permissive, no extra widening is needed.

- [ ] **Step 8: Write the scratch note with findings**

Create `.audit/11-fix-prep-notes-alex-context.md` summarizing each step's result, with explicit `STATUS: PASS | STOP | NEEDS-DECISION` per step. Include the `SECTION_3_DECISION` label.

Do **not** commit this file in the same commit as code changes; it is a scratch note for the human reviewer. Add it to `.gitignore`-equivalent local-only via simply not committing it, or commit it in its own `chore: prep notes` commit at the end of the branch if helpful.

- [ ] **Step 9: Hard-stop gate**

Per the spec's "Hard stops" section:

- If steps 1, 2, 3, 4, or 7 reported `STOP`: stop here. Surface to the user and revise the spec.
- If step 5 reported `STOP`: skip Task 9 and surface to the user.
- If step 6 is `NEEDS-DECISION`: skip Tasks 7–8 until the user approves option A or B.

Otherwise: proceed to Task 2.

- [ ] **Step 10: Commit prep notes (optional, only if useful)**

```bash
git add .audit/11-fix-prep-notes-alex-context.md
git commit -m "chore(audit): prep notes for fix/launch-alex-context-and-calendar"
```

---

### Task 2: Add `GatewayContactStore` interface and `contactStore` to `ChannelGatewayConfig`

**Files:**

- Modify: `packages/core/src/channel-gateway/types.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/channel-gateway/__tests__/types.test.ts` (or add to an existing types test file if one exists — check first with `ls packages/core/src/channel-gateway/__tests__/`):

```typescript
import { describe, it, expectTypeOf } from "vitest";
import type { ChannelGatewayConfig, GatewayContactStore } from "../types.js";

describe("GatewayContactStore", () => {
  it("requires findByPhone returning {id} or null", () => {
    expectTypeOf<GatewayContactStore["findByPhone"]>().toEqualTypeOf<
      (orgId: string, phone: string) => Promise<{ id: string } | null>
    >();
  });

  it("requires create returning {id}", () => {
    expectTypeOf<GatewayContactStore["create"]>().toMatchTypeOf<
      (input: {
        organizationId: string;
        phone: string;
        primaryChannel: "whatsapp";
        source: string;
      }) => Promise<{ id: string }>
    >();
  });

  it("ChannelGatewayConfig accepts an optional contactStore", () => {
    expectTypeOf<ChannelGatewayConfig["contactStore"]>().toEqualTypeOf<
      GatewayContactStore | undefined
    >();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
pnpm --filter @switchboard/core test -- packages/core/src/channel-gateway/__tests__/types.test.ts
```

Expected: FAIL with "Module has no exported member 'GatewayContactStore'" (or equivalent type errors).

- [ ] **Step 3: Add `GatewayContactStore` and `contactStore` field**

Modify `packages/core/src/channel-gateway/types.ts`. Add this above the existing `ChannelGatewayConfig` interface:

```typescript
export interface GatewayContactStore {
  findByPhone(orgId: string, phone: string): Promise<{ id: string } | null>;
  create(input: {
    organizationId: string;
    phone: string;
    primaryChannel: "whatsapp";
    source: string;
  }): Promise<{ id: string }>;
}
```

Then inside `ChannelGatewayConfig`, add (preserve existing fields):

```typescript
  /** Optional contact-identity store. When set, the gateway resolves Contact identity for WhatsApp inbound before ingress.submit. */
  contactStore?: GatewayContactStore;
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @switchboard/core test -- packages/core/src/channel-gateway/__tests__/types.test.ts
```

Expected: PASS.

- [ ] **Step 5: Verify the rest of the core package still type-checks**

```bash
pnpm --filter @switchboard/core typecheck
```

Expected: PASS (no new errors).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/channel-gateway/types.ts packages/core/src/channel-gateway/__tests__/types.test.ts
git commit -m "feat(core): add GatewayContactStore interface and contactStore field on ChannelGatewayConfig"
```

---

### Task 3: Implement `resolveContactIdentity` helper

**Files:**

- Create: `packages/core/src/channel-gateway/resolve-contact-identity.ts`
- Create: `packages/core/src/channel-gateway/__tests__/resolve-contact-identity.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/channel-gateway/__tests__/resolve-contact-identity.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { resolveContactIdentity } from "../resolve-contact-identity.js";
import type { GatewayContactStore } from "../types.js";

function makeStore(overrides: Partial<GatewayContactStore> = {}): GatewayContactStore {
  return {
    findByPhone: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: "new-contact-id" }),
    ...overrides,
  };
}

describe("resolveContactIdentity", () => {
  it("WhatsApp + new phone: creates Contact once and returns its id", async () => {
    const store = makeStore();
    const result = await resolveContactIdentity({
      channel: "whatsapp",
      sessionId: "+6599999999",
      organizationId: "org-1",
      contactStore: store,
    });

    expect(store.findByPhone).toHaveBeenCalledWith("org-1", "+6599999999");
    expect(store.create).toHaveBeenCalledWith({
      organizationId: "org-1",
      phone: "+6599999999",
      primaryChannel: "whatsapp",
      source: "whatsapp_inbound",
    });
    expect(result).toEqual({
      contactId: "new-contact-id",
      phone: "+6599999999",
      channel: "whatsapp",
    });
  });

  it("WhatsApp + existing phone: returns existing id without creating", async () => {
    const store = makeStore({
      findByPhone: vi.fn().mockResolvedValue({ id: "existing-contact-id" }),
    });
    const result = await resolveContactIdentity({
      channel: "whatsapp",
      sessionId: "+6599999999",
      organizationId: "org-1",
      contactStore: store,
    });

    expect(store.create).not.toHaveBeenCalled();
    expect(result).toEqual({
      contactId: "existing-contact-id",
      phone: "+6599999999",
      channel: "whatsapp",
    });
  });

  it("telegram: returns null identity without touching the store", async () => {
    const store = makeStore();
    const result = await resolveContactIdentity({
      channel: "telegram",
      sessionId: "tg-12345",
      organizationId: "org-1",
      contactStore: store,
    });

    expect(store.findByPhone).not.toHaveBeenCalled();
    expect(store.create).not.toHaveBeenCalled();
    expect(result).toEqual({ contactId: null, phone: null, channel: "telegram" });
  });

  it("dashboard: returns null identity without touching the store", async () => {
    const store = makeStore();
    const result = await resolveContactIdentity({
      channel: "dashboard",
      sessionId: "session-abc",
      organizationId: "org-1",
      contactStore: store,
    });

    expect(store.findByPhone).not.toHaveBeenCalled();
    expect(store.create).not.toHaveBeenCalled();
    expect(result).toEqual({ contactId: null, phone: null, channel: "dashboard" });
  });

  it("widget: returns null identity without touching the store", async () => {
    const store = makeStore();
    const result = await resolveContactIdentity({
      channel: "widget",
      sessionId: "widget-xyz",
      organizationId: "org-1",
      contactStore: store,
    });

    expect(store.findByPhone).not.toHaveBeenCalled();
    expect(store.create).not.toHaveBeenCalled();
    expect(result).toEqual({ contactId: null, phone: null, channel: "widget" });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @switchboard/core test -- packages/core/src/channel-gateway/__tests__/resolve-contact-identity.test.ts
```

Expected: FAIL with "Cannot find module '../resolve-contact-identity.js'".

- [ ] **Step 3: Create the helper**

Create `packages/core/src/channel-gateway/resolve-contact-identity.ts`:

```typescript
import type { GatewayContactStore } from "./types.js";

export interface ResolvedContactIdentity {
  contactId: string | null;
  phone: string | null;
  channel: string;
}

export async function resolveContactIdentity(args: {
  channel: string;
  sessionId: string;
  organizationId: string;
  contactStore: GatewayContactStore;
}): Promise<ResolvedContactIdentity> {
  const { channel, sessionId, organizationId, contactStore } = args;

  if (channel !== "whatsapp") {
    return { contactId: null, phone: null, channel };
  }

  const phone = sessionId;
  const existing = await contactStore.findByPhone(organizationId, phone);
  if (existing) {
    return { contactId: existing.id, phone, channel };
  }

  const created = await contactStore.create({
    organizationId,
    phone,
    primaryChannel: "whatsapp",
    source: "whatsapp_inbound",
  });
  return { contactId: created.id, phone, channel };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @switchboard/core test -- packages/core/src/channel-gateway/__tests__/resolve-contact-identity.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 5: Export from the package barrel (if applicable)**

Run:

```bash
grep -n "channel-gateway" packages/core/src/index.ts packages/core/src/channel-gateway/index.ts 2>/dev/null
```

If `packages/core/src/channel-gateway/index.ts` exists and re-exports from this directory, add to it:

```typescript
export { resolveContactIdentity } from "./resolve-contact-identity.js";
export type { ResolvedContactIdentity } from "./resolve-contact-identity.js";
```

If only `types.ts` is exported via the package barrel, also add `GatewayContactStore` to the exports (it was added in Task 2 but may not be in the barrel yet — verify and update if needed).

- [ ] **Step 6: Run typecheck across core**

```bash
pnpm --filter @switchboard/core typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/channel-gateway/resolve-contact-identity.ts packages/core/src/channel-gateway/__tests__/resolve-contact-identity.test.ts packages/core/src/channel-gateway/index.ts
git commit -m "feat(core): add resolveContactIdentity helper for WhatsApp inbound"
```

(Adjust the `git add` list if `index.ts` was not modified.)

---

### Task 4: Wire identity resolution into `ChannelGateway.handleIncoming`

**Files:**

- Modify: `packages/core/src/channel-gateway/channel-gateway.ts`
- Modify or create: `packages/core/src/channel-gateway/__tests__/channel-gateway.test.ts`

- [ ] **Step 1: Confirm test file location**

Run:

```bash
ls packages/core/src/channel-gateway/__tests__/ 2>/dev/null
grep -rln "ChannelGateway" packages/core/src/channel-gateway/__tests__ 2>/dev/null
```

Expected: locate the existing channel-gateway test file (likely `channel-gateway.test.ts`). If none exists, create one.

- [ ] **Step 2: Add failing tests for identity injection**

Append to (or create) `packages/core/src/channel-gateway/__tests__/channel-gateway.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { ChannelGateway } from "../channel-gateway.js";
import type {
  ChannelGatewayConfig,
  GatewayContactStore,
  IncomingChannelMessage,
  ReplySink,
} from "../types.js";

function makeConfig(overrides: Partial<ChannelGatewayConfig> = {}): ChannelGatewayConfig {
  const submit = vi.fn().mockResolvedValue({
    ok: true,
    result: { outputs: { response: "ok" }, summary: "ok" },
  });
  return {
    deploymentResolver: {
      resolveByChannelToken: vi.fn().mockResolvedValue({
        organizationId: "org-1",
        deploymentId: "dep-1",
        listingId: "list-1",
        skillSlug: "alex",
        persona: { businessName: "Acme", tone: "friendly" },
      }),
    },
    platformIngress: { submit },
    conversationStore: {
      getOrCreateBySession: vi.fn().mockResolvedValue({ conversationId: "conv-1", messages: [] }),
      addMessage: vi.fn().mockResolvedValue(undefined),
    },
    ...overrides,
  };
}

function makeContactStore(): GatewayContactStore {
  return {
    findByPhone: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: "contact-new" }),
  };
}

const replySink: ReplySink = {
  send: vi.fn().mockResolvedValue(undefined),
};

describe("ChannelGateway identity resolution", () => {
  it("WhatsApp: same sessionId across two messages creates Contact exactly once", async () => {
    const contactStore = makeContactStore();
    let createdId: string | null = null;
    contactStore.findByPhone = vi.fn(async (_org, _phone) =>
      createdId ? { id: createdId } : null,
    );
    contactStore.create = vi.fn(async (input) => {
      createdId = "contact-1";
      return { id: createdId };
    });

    const config = makeConfig({ contactStore });
    const gateway = new ChannelGateway(config);

    const msg: IncomingChannelMessage = {
      channel: "whatsapp",
      token: "tok",
      sessionId: "+6599999999",
      text: "hi",
    };

    await gateway.handleIncoming(msg, replySink);
    await gateway.handleIncoming({ ...msg, text: "hi again" }, replySink);

    expect(contactStore.create).toHaveBeenCalledTimes(1);
    expect(config.platformIngress.submit).toHaveBeenCalledTimes(2);
  });

  it("WhatsApp: parameters include contactId, phone, channel, _agentContext", async () => {
    const contactStore = makeContactStore();
    const config = makeConfig({ contactStore });
    const gateway = new ChannelGateway(config);

    await gateway.handleIncoming(
      {
        channel: "whatsapp",
        token: "tok",
        sessionId: "+6599999999",
        text: "hi",
      },
      replySink,
    );

    const submitCall = (config.platformIngress.submit as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(submitCall.parameters.contactId).toBe("contact-new");
    expect(submitCall.parameters.phone).toBe("+6599999999");
    expect(submitCall.parameters.channel).toBe("whatsapp");
    expect(submitCall.parameters._agentContext).toEqual({
      persona: { businessName: "Acme", tone: "friendly" },
    });
  });

  it("Telegram: parameters omit contactId and phone, channel still set", async () => {
    const contactStore = makeContactStore();
    const config = makeConfig({ contactStore });
    const gateway = new ChannelGateway(config);

    await gateway.handleIncoming(
      { channel: "telegram", token: "tok", sessionId: "tg-1", text: "hi" },
      replySink,
    );

    expect(contactStore.findByPhone).not.toHaveBeenCalled();
    expect(contactStore.create).not.toHaveBeenCalled();

    const submitCall = (config.platformIngress.submit as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(submitCall.parameters.contactId).toBeUndefined();
    expect(submitCall.parameters.phone).toBeUndefined();
    expect(submitCall.parameters.channel).toBe("telegram");
  });

  it("no contactStore configured: identity step is skipped, parameters stay channel+_agentContext", async () => {
    const config = makeConfig(); // contactStore is undefined
    const gateway = new ChannelGateway(config);

    await gateway.handleIncoming(
      { channel: "whatsapp", token: "tok", sessionId: "+6599999999", text: "hi" },
      replySink,
    );

    const submitCall = (config.platformIngress.submit as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(submitCall.parameters.contactId).toBeUndefined();
    expect(submitCall.parameters.phone).toBeUndefined();
    expect(submitCall.parameters.channel).toBe("whatsapp");
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
pnpm --filter @switchboard/core test -- packages/core/src/channel-gateway/__tests__/channel-gateway.test.ts
```

Expected: FAIL — `parameters.contactId` etc. are not set.

- [ ] **Step 4: Modify `channel-gateway.ts` to resolve identity and inject into parameters**

Open `packages/core/src/channel-gateway/channel-gateway.ts`. Add the import at the top:

```typescript
import { resolveContactIdentity } from "./resolve-contact-identity.js";
```

Inside `handleIncoming`, between step 3b (override check) and step 5 (build messages — currently around line 65, just before `// 4. Signal typing`), add:

```typescript
// 3c. Resolve contact identity (no-op when contactStore not wired or non-WhatsApp channel)
const identity = this.config.contactStore
  ? await resolveContactIdentity({
      channel: message.channel,
      sessionId: message.sessionId,
      organizationId: resolved.organizationId,
      contactStore: this.config.contactStore,
    })
  : { contactId: null, phone: null, channel: message.channel };
```

Replace the existing `parameters` block in step 6 (currently lines 78–82) with:

```typescript
      parameters: {
        message: message.text,
        conversation: { messages, sessionId: message.sessionId },
        persona: resolved.persona,
        ...(identity.contactId ? { contactId: identity.contactId } : {}),
        ...(identity.phone ? { phone: identity.phone } : {}),
        channel: identity.channel,
        _agentContext: { persona: resolved.persona },
      },
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
pnpm --filter @switchboard/core test -- packages/core/src/channel-gateway/__tests__/channel-gateway.test.ts
```

Expected: PASS (4 new tests + any existing channel-gateway tests).

- [ ] **Step 6: Run the full core test suite**

```bash
pnpm --filter @switchboard/core test
pnpm --filter @switchboard/core typecheck
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/channel-gateway/channel-gateway.ts packages/core/src/channel-gateway/__tests__/channel-gateway.test.ts
git commit -m "feat(core): resolve WhatsApp contact identity in ChannelGateway before ingress submit"
```

---

### Task 5: Wire `PrismaContactStore` into the chat gateway bridge

**Files:**

- Modify: `apps/chat/src/gateway/gateway-bridge.ts`
- Modify or create: `apps/chat/src/gateway/__tests__/gateway-bridge.test.ts`

- [ ] **Step 1: Confirm `PrismaContactStore` is exported from `@switchboard/db`**

Run:

```bash
grep -n "PrismaContactStore" packages/db/src/index.ts packages/db/src/stores/index.ts 2>/dev/null
```

Expected: at least one match. If none, add the export to `packages/db/src/index.ts`:

```typescript
export { PrismaContactStore } from "./stores/prisma-contact-store.js";
```

(Do this in its own commit if needed.)

- [ ] **Step 2: Add a failing smoke test**

Modify or create `apps/chat/src/gateway/__tests__/gateway-bridge.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { createGatewayBridge } from "../gateway-bridge.js";

describe("createGatewayBridge", () => {
  it("constructs a ChannelGateway with a contactStore wired in", async () => {
    const fakePrisma = {} as never;
    const fakeIngress = {
      submit: vi.fn(),
    };

    const gateway = createGatewayBridge(fakePrisma, {
      platformIngress: fakeIngress,
    });

    // ChannelGateway exposes its config indirectly; verify by introspecting
    // the constructed instance's private config or by exporting a getter.
    // Simplest pin: assert the gateway is constructed without throwing.
    expect(gateway).toBeDefined();
    // Use a known property the gateway owns. (See note below.)
    expect(
      (gateway as unknown as { config: { contactStore: unknown } }).config.contactStore,
    ).toBeDefined();
  });
});
```

If `ChannelGateway` does not expose `config` publicly, replace the last assertion with one that exercises behavior end-to-end (e.g., construct a fake message and assert that `findByPhone` is called on a spy contactStore). Choose the simpler of the two during implementation.

- [ ] **Step 3: Run the test to verify it fails**

```bash
pnpm --filter switchboard-chat test -- apps/chat/src/gateway/__tests__/gateway-bridge.test.ts
```

(Adjust filter name to match this app's package name; check `apps/chat/package.json` if unsure.)

Expected: FAIL — `contactStore` is undefined on the constructed gateway.

- [ ] **Step 4: Wire `PrismaContactStore` into `createGatewayBridge`**

Open `apps/chat/src/gateway/gateway-bridge.ts`. Add to the existing import from `@switchboard/db`:

```typescript
import {
  PrismaAgentTaskStore,
  PrismaInteractionSummaryStore,
  PrismaDeploymentMemoryStore,
  PrismaContactStore,
} from "@switchboard/db";
```

In the `return new ChannelGateway({ ... })` block (currently lines 94–110), add:

```typescript
    contactStore: new PrismaContactStore(prisma),
```

Place it next to `conversationStore:` for symmetry.

- [ ] **Step 5: Run the test to verify it passes**

```bash
pnpm --filter switchboard-chat test -- apps/chat/src/gateway/__tests__/gateway-bridge.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run full chat suite**

```bash
pnpm --filter switchboard-chat test
pnpm --filter switchboard-chat typecheck
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/chat/src/gateway/gateway-bridge.ts apps/chat/src/gateway/__tests__/gateway-bridge.test.ts packages/db/src/index.ts
git commit -m "feat(chat): wire PrismaContactStore into ChannelGateway via gateway-bridge"
```

(Drop `packages/db/src/index.ts` from `git add` if no export change was needed.)

---

### Task 6: Forward `phone` and `channel` through `skill-mode` builder config

**Files:**

- Modify: `apps/api/src/bootstrap/skill-mode.ts`
- Modify: `apps/api/src/bootstrap/__tests__/skill-mode-builder-registration.test.ts`

- [ ] **Step 1: Update the existing test to assert phone+channel forwarding**

Open `apps/api/src/bootstrap/__tests__/skill-mode-builder-registration.test.ts`. Replace the body of the first `it("registers alexBuilder under the 'alex' slug", ...)` block with a stronger assertion:

```typescript
it("registers alexBuilder and forwards phone+channel from workUnit parameters", async () => {
  const registry = new BuilderRegistry();
  const { alexBuilder } = await import("@switchboard/core/skill-runtime");

  expect(alexBuilder).toBeDefined();
  expect(typeof alexBuilder).toBe("function");
  expect(registry.get("alex")).toBeUndefined();

  let receivedConfig: Record<string, unknown> | undefined;
  registry.register("alex", async (ctx) => {
    const agentContext = ctx.workUnit.parameters._agentContext as Parameters<typeof alexBuilder>[0];
    const config = {
      deploymentId: ctx.deployment.deploymentId,
      orgId: ctx.workUnit.organizationId,
      contactId: ctx.workUnit.parameters.contactId as string | undefined,
      phone: ctx.workUnit.parameters.phone as string | undefined,
      channel: ctx.workUnit.parameters.channel as string | undefined,
    };
    receivedConfig = config as Record<string, unknown>;
    return { CAPTURED: true } as never;
  });

  const builder = registry.get("alex");
  expect(builder).toBeDefined();

  // Invoke the registered wrapper with a synthetic ctx
  await builder!({
    deployment: { deploymentId: "dep-1" },
    workUnit: {
      organizationId: "org-1",
      parameters: {
        contactId: "contact-1",
        phone: "+6599999999",
        channel: "whatsapp",
        _agentContext: { persona: { businessName: "Acme" } },
      },
    },
    stores: {} as never,
  } as never);

  expect(receivedConfig).toEqual({
    deploymentId: "dep-1",
    orgId: "org-1",
    contactId: "contact-1",
    phone: "+6599999999",
    channel: "whatsapp",
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @switchboard/api test -- apps/api/src/bootstrap/__tests__/skill-mode-builder-registration.test.ts
```

(Adjust filter to match the api package's name from `apps/api/package.json`.)

Expected: FAIL — production code at `skill-mode.ts:216–220` does not forward phone+channel.

- [ ] **Step 3: Update `skill-mode.ts` to forward phone+channel**

Open `apps/api/src/bootstrap/skill-mode.ts`. Replace lines 214–222 with:

```typescript
builderRegistry.register("alex", async (ctx) => {
  const agentContext = ctx.workUnit.parameters._agentContext as Parameters<typeof alexBuilder>[0];
  const config = {
    deploymentId: ctx.deployment.deploymentId,
    orgId: ctx.workUnit.organizationId,
    contactId: ctx.workUnit.parameters.contactId as string | undefined,
    phone: ctx.workUnit.parameters.phone as string | undefined,
    channel: ctx.workUnit.parameters.channel as string | undefined,
  };
  return alexBuilder(agentContext, config, ctx.stores);
});
```

(Diff: `contactId` widened to `string | undefined`; `phone` and `channel` added.)

If Task 1 step 7 reported that `ParameterBuilder`'s config type is strict, also update `packages/core/src/skill-runtime/parameter-builder.ts` to accept `phone?: string | null` and `channel?: string` on the config type. The exact location:

```bash
grep -n "interface .*Config\|type .*Config\|ParameterBuilder" packages/core/src/skill-runtime/parameter-builder.ts
```

If no widening is needed (Task 1 step 7 was PASS), skip this sub-step.

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @switchboard/api test -- apps/api/src/bootstrap/__tests__/skill-mode-builder-registration.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run typecheck and adjacent tests**

```bash
pnpm --filter @switchboard/api typecheck
pnpm --filter @switchboard/core typecheck
pnpm --filter @switchboard/core test -- packages/core/src/skill-runtime/builders/alex.test.ts
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/bootstrap/skill-mode.ts apps/api/src/bootstrap/__tests__/skill-mode-builder-registration.test.ts
git commit -m "fix(api): forward phone and channel through alexBuilder config"
```

(If `parameter-builder.ts` was widened, include that file too.)

---

### Task 7: Build `booking-confirmation-email` helper (gated on Task 1 step 6)

**Skip this task entirely if Task 1 step 6 selected OPTION_B and the user did not approve a Resend POST in production.** In OPTION_B, the helper is still built (for tests), but the bootstrap wiring in Task 8 uses only a test-double-injectable seam.

**Files:**

- Create: `apps/api/src/lib/booking-confirmation-email.ts`
- Create: `apps/api/src/lib/__tests__/booking-confirmation-email.test.ts`

- [ ] **Step 1: Confirm the existing escalation Resend integration's shape**

Re-read findings from Task 1 step 6. Note the existing code's approach:

- HTTP method, URL, headers
- Payload field names (`from`, `to`, `subject`, `html` / `text`)
- Error handling (status code check, body parse)

The new helper mirrors this. Identical patterns reduce review surface area.

- [ ] **Step 2: Write the failing tests**

Create `apps/api/src/lib/__tests__/booking-confirmation-email.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { sendBookingConfirmationEmail } from "../booking-confirmation-email.js";

describe("sendBookingConfirmationEmail", () => {
  it("posts to Resend with correct payload and returns void on 200", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "{}",
    });

    await sendBookingConfirmationEmail({
      apiKey: "re_test",
      fromAddress: "bookings@example.com",
      to: "lead@example.com",
      attendeeName: "Jane",
      service: "Consultation",
      startsAt: "2026-05-01T10:00:00Z",
      endsAt: "2026-05-01T11:00:00Z",
      bookingId: "bk-1",
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect(init.headers["Authorization"]).toBe("Bearer re_test");
    expect(init.headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(init.body as string);
    expect(body.from).toBe("bookings@example.com");
    expect(body.to).toBe("lead@example.com");
    expect(body.subject).toContain("Consultation");
    expect(body.html).toContain("2026-05-01");
    expect(body.html).toContain("Jane");
    expect(body.html).toContain("bk-1");
  });

  it("throws on non-2xx response with status in message", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "internal",
    });

    await expect(
      sendBookingConfirmationEmail({
        apiKey: "re_test",
        fromAddress: "bookings@example.com",
        to: "lead@example.com",
        attendeeName: null,
        service: "Consultation",
        startsAt: "2026-05-01T10:00:00Z",
        endsAt: "2026-05-01T11:00:00Z",
        bookingId: "bk-1",
        fetchImpl,
      }),
    ).rejects.toThrow(/Resend.*500/);
  });

  it("handles null attendeeName gracefully", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "{}",
    });

    await sendBookingConfirmationEmail({
      apiKey: "re_test",
      fromAddress: "bookings@example.com",
      to: "lead@example.com",
      attendeeName: null,
      service: "Consultation",
      startsAt: "2026-05-01T10:00:00Z",
      endsAt: "2026-05-01T11:00:00Z",
      bookingId: "bk-1",
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
pnpm --filter @switchboard/api test -- apps/api/src/lib/__tests__/booking-confirmation-email.test.ts
```

Expected: FAIL with module-not-found.

- [ ] **Step 4: Implement the helper**

Create `apps/api/src/lib/booking-confirmation-email.ts`:

```typescript
export interface BookingConfirmationEmailArgs {
  apiKey: string;
  fromAddress: string;
  to: string;
  attendeeName: string | null;
  service: string;
  startsAt: string;
  endsAt: string;
  bookingId: string;
  fetchImpl?: typeof fetch;
}

export async function sendBookingConfirmationEmail(
  args: BookingConfirmationEmailArgs,
): Promise<void> {
  const fetchFn = args.fetchImpl ?? fetch;
  const greeting = args.attendeeName ? `Hi ${args.attendeeName},` : "Hi,";
  const html = [
    `<p>${greeting}</p>`,
    `<p>Your booking for <strong>${args.service}</strong> is confirmed.</p>`,
    `<p><strong>When:</strong> ${args.startsAt} – ${args.endsAt}</p>`,
    `<p>Booking reference: <code>${args.bookingId}</code></p>`,
    `<p>Reply to this email to reschedule.</p>`,
  ].join("\n");

  const res = await fetchFn("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: args.fromAddress,
      to: args.to,
      subject: `Booking confirmation — ${args.service}`,
      html,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend confirmation send failed: ${res.status} ${body}`);
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
pnpm --filter @switchboard/api test -- apps/api/src/lib/__tests__/booking-confirmation-email.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/booking-confirmation-email.ts apps/api/src/lib/__tests__/booking-confirmation-email.test.ts
git commit -m "feat(api): add booking-confirmation-email Resend helper"
```

---

### Task 8: Wire `emailSender` into `LocalCalendarProvider` in `skill-mode`

**Skip Step 4 (production wiring) if Task 1 step 6 selected OPTION_B; in OPTION_B, only Steps 1–3 (LocalCalendarProvider unit-test pin) and Step 5 (boot warning) apply.**

**Files:**

- Modify: `packages/core/src/calendar/local-calendar-provider.test.ts`
- Modify: `apps/api/src/bootstrap/skill-mode.ts`
- Modify: `apps/api/src/bootstrap/__tests__/skill-mode.test.ts` (or appropriate adjacent test)
- Modify: `.env.example` (only if OPTION_A added a new env var)

- [ ] **Step 1: Confirm `LocalCalendarProvider` test file exists and read structure**

```bash
ls packages/core/src/calendar/local-calendar-provider.test.ts
sed -n '1,50p' packages/core/src/calendar/local-calendar-provider.test.ts
```

If the file does not exist, create it in this task with at minimum the new tests below.

- [ ] **Step 2: Add failing test — emailSender is called once on createBooking with email**

Append to `packages/core/src/calendar/local-calendar-provider.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { LocalCalendarProvider } from "./local-calendar-provider.js";
import type { LocalBookingStore, EmailSender } from "./local-calendar-provider.js";

function makeStore(): LocalBookingStore {
  return {
    findOverlapping: vi.fn().mockResolvedValue([]),
    createInTransaction: vi.fn().mockResolvedValue({ id: "bk-1" }),
    findById: vi.fn().mockResolvedValue(null),
    cancel: vi.fn().mockResolvedValue(undefined),
    reschedule: vi.fn().mockResolvedValue({ id: "bk-1" }),
  };
}

const businessHours = {
  timezone: "Asia/Singapore",
  weekly: [{ dayOfWeek: 1, start: "09:00", end: "17:00" }],
} as never;

describe("LocalCalendarProvider emailSender wiring", () => {
  it("invokes emailSender exactly once when attendeeEmail set", async () => {
    const emailSender: EmailSender = vi.fn().mockResolvedValue(undefined);
    const provider = new LocalCalendarProvider({
      businessHours,
      bookingStore: makeStore(),
      emailSender,
    });

    await provider.createBooking({
      organizationId: "org-1",
      contactId: "contact-1",
      service: "Consultation",
      slot: { start: "2026-05-01T10:00:00Z", end: "2026-05-01T11:00:00Z" },
      attendeeEmail: "lead@example.com",
      attendeeName: "Jane",
    } as never);

    expect(emailSender).toHaveBeenCalledTimes(1);
    expect(emailSender).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "lead@example.com",
        attendeeName: "Jane",
        service: "Consultation",
        bookingId: "bk-1",
      }),
    );
  });

  it("calls onSendFailure when emailSender throws but still returns confirmed booking", async () => {
    const emailSender: EmailSender = vi.fn().mockRejectedValue(new Error("boom"));
    const onSendFailure = vi.fn();
    const provider = new LocalCalendarProvider({
      businessHours,
      bookingStore: makeStore(),
      emailSender,
      onSendFailure,
    });

    const result = await provider.createBooking({
      organizationId: "org-1",
      contactId: "contact-1",
      service: "Consultation",
      slot: { start: "2026-05-01T10:00:00Z", end: "2026-05-01T11:00:00Z" },
      attendeeEmail: "lead@example.com",
      attendeeName: "Jane",
    } as never);

    expect(result.status).toBe("confirmed");
    expect(onSendFailure).toHaveBeenCalledWith({
      bookingId: "bk-1",
      error: "boom",
    });
  });
});
```

- [ ] **Step 3: Run the LocalCalendarProvider tests**

```bash
pnpm --filter @switchboard/core test -- packages/core/src/calendar/local-calendar-provider.test.ts
```

Expected: PASS for these tests if the provider already supports the seam (it does, per `local-calendar-provider.ts:54, 112–129`). If they fail, the provider needs a small fix — diagnose by reading the relevant lines and align tests to actual behavior.

- [ ] **Step 4: Wire `emailSender` in `skill-mode.ts` (skip in OPTION_B)**

In `apps/api/src/bootstrap/skill-mode.ts`, find the `LocalCalendarProvider` instantiation (currently lines 429–432). Replace with:

```typescript
const resendKey = process.env["RESEND_API_KEY"];
const fromAddress = process.env["BOOKING_FROM_EMAIL"]; // OPTION_A; rename if REUSE
let emailSender: import("@switchboard/core/calendar").EmailSender | undefined;
if (resendKey && fromAddress) {
  const { sendBookingConfirmationEmail } = await import("../lib/booking-confirmation-email.js");
  emailSender = async (email) => {
    await sendBookingConfirmationEmail({
      apiKey: resendKey,
      fromAddress,
      to: email.to,
      attendeeName: email.attendeeName,
      service: email.service,
      startsAt: email.startsAt,
      endsAt: email.endsAt,
      bookingId: email.bookingId,
    });
  };
} else {
  logger.info(
    "Calendar: booking confirmation emails disabled (RESEND_API_KEY or BOOKING_FROM_EMAIL not set)",
  );
}

const provider = new LocalCalendarProvider({
  businessHours,
  bookingStore: localStore,
  ...(emailSender ? { emailSender } : {}),
  onSendFailure: ({ bookingId, error }) =>
    logger.error(`Calendar: booking confirmation email failed for ${bookingId}: ${error}`),
});
```

If Task 1 step 6 found `REUSE` (existing env var name like `RESEND_FROM_EMAIL`), substitute that name everywhere `BOOKING_FROM_EMAIL` appears.

- [ ] **Step 5: Add `BOOKING_FROM_EMAIL` to `.env.example` (OPTION_A only)**

Open `.env.example`. Add (next to existing Resend entries):

```
# Sender address for booking confirmation emails (Resend). If unset, booking emails are disabled.
BOOKING_FROM_EMAIL=bookings@example.com
```

Skip this step in REUSE or OPTION_B.

- [ ] **Step 6: Add a bootstrap test for the env-var gate**

In `apps/api/src/bootstrap/__tests__/skill-mode.test.ts` (or the closest existing skill-mode test), add a test that exercises `resolveCalendarProvider`-or-equivalent with both env vars set vs. unset and asserts the provider receives a non-undefined `emailSender` only when both are set.

If the function is private and not directly testable, instead add an integration assertion in the existing `skill-mode-builder-registration.test.ts` or create a new co-located test that imports `resolveCalendarProvider` (export it for testing if needed) and checks the resulting provider's behavior via a controlled `createBooking` call with a mock store.

Concrete scaffolding (adjust import paths to actual exports):

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("skill-mode resolveCalendarProvider emailSender wiring", () => {
  const orig = { ...process.env };
  beforeEach(() => {
    process.env = { ...orig };
  });
  afterEach(() => {
    process.env = orig;
  });

  it("passes emailSender when RESEND_API_KEY and BOOKING_FROM_EMAIL set", async () => {
    process.env["RESEND_API_KEY"] = "re_test";
    process.env["BOOKING_FROM_EMAIL"] = "bookings@example.com";
    // ...invoke resolveCalendarProvider with a stubbed prisma + orgConfig and
    // assert the constructed provider has emailSender set. If introspection
    // is hard, drive a fake booking through it and verify the Resend fetch
    // is called.
  });

  it("logs warning and omits emailSender when env vars missing", async () => {
    delete process.env["RESEND_API_KEY"];
    delete process.env["BOOKING_FROM_EMAIL"];
    const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };
    // ...invoke and assert logger.info called with "Calendar: booking confirmation emails disabled..."
  });
});
```

If `resolveCalendarProvider` is not exported, add an `export` for it (test-visibility export is acceptable here; alternative is to refactor into its own file, which is out of scope).

- [ ] **Step 7: Run all relevant test suites and typecheck**

```bash
pnpm --filter @switchboard/core test -- packages/core/src/calendar/
pnpm --filter @switchboard/api test -- apps/api/src/bootstrap/
pnpm --filter @switchboard/api typecheck
```

Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/calendar/local-calendar-provider.test.ts apps/api/src/bootstrap/skill-mode.ts apps/api/src/bootstrap/__tests__/skill-mode.test.ts .env.example
git commit -m "feat(api): wire booking confirmation emailSender into LocalCalendarProvider"
```

---

### Task 9: Fix `LocalBookingStore.findOverlapping` org-scope leak

**Skip if Task 1 step 5 reported a third real consumer** — surface to the user and revise.

**Files:**

- Modify: `packages/core/src/calendar/local-calendar-provider.ts`
- Modify: `packages/core/src/calendar/local-calendar-provider.test.ts`
- Modify: `apps/api/src/bootstrap/skill-mode.ts`

- [ ] **Step 1: Add a failing regression test — orgB's bookings do not block orgA's slots**

Append to `packages/core/src/calendar/local-calendar-provider.test.ts`:

```typescript
describe("LocalCalendarProvider listAvailableSlots org scoping", () => {
  it("does not call findOverlapping with an orgId argument", async () => {
    const findOverlapping = vi.fn().mockResolvedValue([]);
    const store: LocalBookingStore = {
      findOverlapping,
      createInTransaction: vi.fn(),
      findById: vi.fn(),
      cancel: vi.fn(),
      reschedule: vi.fn(),
    };
    const provider = new LocalCalendarProvider({
      businessHours,
      bookingStore: store,
    });

    await provider.listAvailableSlots({
      dateFrom: "2026-05-01T00:00:00Z",
      dateTo: "2026-05-02T00:00:00Z",
      durationMinutes: 30,
      bufferMinutes: 0,
    } as never);

    expect(findOverlapping).toHaveBeenCalledTimes(1);
    const args = findOverlapping.mock.calls[0];
    // Two arguments only: startsAt, endsAt
    expect(args).toHaveLength(2);
    expect(args[0]).toBeInstanceOf(Date);
    expect(args[1]).toBeInstanceOf(Date);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @switchboard/core test -- packages/core/src/calendar/local-calendar-provider.test.ts
```

Expected: FAIL — `findOverlapping` is currently called with three arguments (`""`, startsAt, endsAt).

- [ ] **Step 3: Update the `LocalBookingStore` interface and `listAvailableSlots` call**

Open `packages/core/src/calendar/local-calendar-provider.ts`.

Replace the `findOverlapping` declaration (currently lines 25–29):

```typescript
  findOverlapping(
    startsAt: Date,
    endsAt: Date,
  ): Promise<Array<{ startsAt: Date; endsAt: Date }>>;
```

Replace `listAvailableSlots`'s `findOverlapping` call (currently lines 72–76):

```typescript
const existingBookings = await this.store.findOverlapping(
  new Date(query.dateFrom),
  new Date(query.dateTo),
);
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @switchboard/core test -- packages/core/src/calendar/local-calendar-provider.test.ts
```

Expected: PASS.

- [ ] **Step 5: Update the `skill-mode.ts` wrapper to bake orgId into the closure**

Open `apps/api/src/bootstrap/skill-mode.ts`. Just before the `const localStore = { ... }` block (~line 319), assert `orgId` is truthy:

```typescript
if (!orgId) {
  throw new Error("resolveCalendarProvider: orgId required for LocalCalendarProvider path");
}
```

Replace the `findOverlapping` closure (currently lines 320–331):

```typescript
      findOverlapping: async (startsAt: Date, endsAt: Date) => {
        const rows = await prismaClient.booking.findMany({
          where: {
            organizationId: orgId,
            startsAt: { lt: endsAt },
            endsAt: { gt: startsAt },
            status: { notIn: ["cancelled", "failed"] },
          },
          select: { startsAt: true, endsAt: true },
        });
        return rows;
      },
```

- [ ] **Step 6: Run typecheck and full provider tests**

```bash
pnpm --filter @switchboard/core typecheck
pnpm --filter @switchboard/api typecheck
pnpm --filter @switchboard/core test -- packages/core/src/calendar/
pnpm --filter @switchboard/api test -- apps/api/src/bootstrap/
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/calendar/local-calendar-provider.ts packages/core/src/calendar/local-calendar-provider.test.ts apps/api/src/bootstrap/skill-mode.ts
git commit -m "fix(core): bake orgId into LocalBookingStore.findOverlapping closure"
```

---

### Task 10: Final cross-cutting verification

Read-only — runs the full suite and confirms acceptance criteria from the spec.

- [ ] **Step 1: Full repo typecheck**

```bash
pnpm typecheck
```

Expected: PASS across all workspaces.

- [ ] **Step 2: Full repo test suite**

```bash
pnpm test
```

Expected: PASS, no new failures, coverage thresholds preserved (global 55/50/52/55, core 65/65/70/65).

- [ ] **Step 3: Lint**

```bash
pnpm lint
```

Expected: PASS.

- [ ] **Step 4: Manually verify acceptance criteria against the spec**

Cross-check each acceptance bullet from the spec's "Acceptance summary":

1. **#8a**: A test in Task 4 covers the "create-once across N messages" property. Confirm the test passes and reflects this.
2. **#8b**: Task 6's test asserts phone+channel forwarded. Confirm.
3. **#9a**: Tasks 7–8 cover Resend POST exactly once and the warn-on-missing-env path. Confirm.
4. **#9b**: Task 9's test pins the two-argument signature; the wrapper closure binds orgId. Confirm.
5. **#7 / #10 already-shipped**: No changes were made to those code paths in this branch. Confirm via:

```bash
git diff origin/main -- apps/api/src/bootstrap/conversion-bus-bootstrap.ts apps/api/src/bootstrap/__tests__/conversion-bus-bootstrap.test.ts
```

Expected: empty diff.

- [ ] **Step 5: Push branch and open PR**

```bash
git push -u origin fix/launch-alex-context-and-calendar
gh pr create --title "fix: alex builder context + LocalCalendarProvider runtime bugs" --body "$(cat <<'EOF'
## Summary

- Resolves WhatsApp contact identity at the `ChannelGateway` boundary; orphan-Contact-per-message bug ends.
- Forwards phone + channel through skill-mode's `alexBuilder` config so auto-created Contacts persist phone.
- Wires `emailSender` (Resend) into `LocalCalendarProvider` for booking confirmations.
- Fixes the `findOverlapping("", ...)` cross-tenant slot-availability leak by baking orgId into the wrapper closure.
- Audit blockers #7 (alex builder registration) and #10 (MetaCAPIDispatcher → ConversionBus) were verified already shipped during Task 1; no code changes there.
- Follow-up branch `fix/launch-calendar-readiness-visibility` will surface the Noop-fallback case in readiness/UI.

Spec: `docs/superpowers/specs/2026-04-27-fix-launch-alex-context-and-calendar-design.md`
Plan: `docs/superpowers/plans/2026-04-27-fix-launch-alex-context-and-calendar.md`

## Test plan

- [ ] WhatsApp inbound: same sender across N messages creates exactly one Contact.
- [ ] Telegram/dashboard inbound: no Contact created (regression-pinned).
- [ ] alexBuilder receives phone + channel + `_agentContext` for WhatsApp.
- [ ] LocalCalendarProvider: createBooking with attendeeEmail triggers exactly one Resend POST when env vars set.
- [ ] LocalCalendarProvider: createBooking with attendeeEmail and missing env vars still succeeds; one warning logged at boot.
- [ ] listAvailableSlots: orgB's bookings do not affect orgA's slot availability.
- [ ] Full `pnpm typecheck` and `pnpm test` pass; coverage preserved.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

(Wait for the user's approval before pushing if any uncertainty remains.)

- [ ] **Step 6: Enable auto-merge on green CI**

```bash
gh pr merge --auto --squash
```

---

## Self-review notes

Spec coverage: every section (1, 2, 3, 4) has a corresponding task. Section 5 of the spec is "already-shipped notes" — Task 10 step 4.5 verifies no diff in those files. Out-of-scope item #9c stays out.

Hard stops are explicitly modeled in Task 1 step 9 and gate Tasks 7–9. No placeholders in the code blocks. Type signatures (`GatewayContactStore`, `ResolvedContactIdentity`, `EmailSender`, `LocalBookingStore.findOverlapping`) are consistent across tasks.
