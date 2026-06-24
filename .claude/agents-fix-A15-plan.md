# A15 — Per-org WhatsApp send + org-scoped 24h window gate on the reply path — Implementation Plan

> **Build-loop scratch plan (uncommitted).** Executes via TDD, one task at a time, RED -> GREEN -> REFACTOR. Steps use `- [ ]`. Not a committed `docs/` spec (branch doctrine: specs land on main via their own PR; impl branches consume them).

**Goal:** Make the two human-reply WhatsApp routes (operator send + escalation reply) send from the **replying org's** WABA number/token and gate the 24h customer-care window on the **replying org's** inbound row — closing the multi-tenant leak (P1-1 + P1-2).

**Architecture:** Thread per-org credentials and the auth `organizationId` through the **single** boot `ProactiveSender` (never reconstruct it — that resets the in-memory `dailyCounts` rate-limit map). The per-org resolution + per-field global-env fallback + org-scoped window query live in a new testable apps/api factory `buildAgentNotifier`, mirroring the A1 helper (`resolveOrgWhatsAppSendCreds`). The reply path keeps `ConversationState.lastInboundAt` as its window source, now org-scoped (decision recorded below).

**Tech Stack:** TypeScript (ESM, `.js` import extensions), Vitest, Fastify, Prisma (mocked in tests — CI has no Postgres), `@switchboard/core` `ProactiveSender`.

## Global Constraints (verbatim, apply to every task)

- ESM only, `.js` extensions in relative imports. No `any` (use `unknown`/proper types). No `console.log` (use `console.warn`/`console.error`). No em-dashes anywhere (copy, comments, commits).
- Prettier: semi, double quotes, 2-space, trailing commas, 100 width. Conventional Commits, **lowercase** subject.
- Per touched package, before EVERY commit: `pnpm --filter <pkg> exec tsc --noEmit` (pre-commit hook is eslint+prettier ONLY). Rebuild a lower package's `dist` after changing it so api tsc/tests see new types: `pnpm --filter <pkg> build`.
- Co-located tests for new modules (`*.test.ts` or `__tests__/`). File size error >600 lines.
- This slice is **SURFACE-before-merge** (external WhatsApp send path + multi-tenant isolation are merge-stop globs). No autonomous merge.
- NO new env var (reuse A1's existing `WHATSAPP_ACCESS_TOKEN`/`WHATSAPP_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID`). NO schema migration (org-scope is a WHERE filter; required indexes already exist). NO new metric (not required by the plan).

## Design decisions (settled at FRAME)

1. **Window source: keep `ConversationState.lastInboundAt` for the reply path, org-scoped.** Reject migrating to `ConversationThread.lastWhatsAppInboundAt`. The reply path is phone-keyed (`destinationPrincipalId`); `ConversationState.principalId` is phone-keyed, `ConversationThread` is `(contactId, org)`-keyed with no phone index, so migrating needs a fragile phone->contact->thread hop and risks a new fail-closed regression. Both columns are written from the same WA inbound; the bug is the missing org scope, not the column. `ConversationThread` stays canonical for the contact-keyed proactive path. Documented in code.
2. **Per-org creds via an injected resolver on the single sender** (symmetric with `isWithinWindow`); add optional `organizationId` to `sendProactive`. Reject per-request reconstruction (resets `dailyCounts`). Resolution + env fallback live in apps/api (surface-agnostic-backend honored).
3. **Fail-closed-on-null-org:** the window query filters `organizationId: <authOrg>` (concrete string => Prisma excludes null-org rows); the closure also returns `false` when orgId is falsy.

## File structure

- **Modify** `packages/core/src/notifications/proactive-sender.ts` — add `organizationId?` to `AgentNotifier.sendProactive` + `ProactiveSenderConfig` (`isWithinWindow` gains orgId; new `resolveWhatsAppCredentials`); `sendWhatsApp` resolves per-org creds + passes orgId to the window check.
- **Create** `packages/core/src/notifications/__tests__/proactive-sender-per-org.test.ts` — core unit tests for the new behavior.
- **Create** `apps/api/src/notifications/build-agent-notifier.ts` — the factory (global-creds gate + org-scoped window closure + per-org creds closure).
- **Create** `apps/api/src/notifications/__tests__/build-agent-notifier.test.ts` — the real-producer acceptance tests (two orgs, shared phone): creds + window.
- **Modify** `apps/api/src/app.ts:403-449` — replace inline notifier wiring with `buildAgentNotifier(...)`.
- **Modify** `apps/api/src/routes/conversations.ts:341` — pass `orgId` as the 4th arg.
- **Modify** `apps/api/src/routes/escalations.ts:367` — pass `orgId` as the 4th arg.
- **Modify** `apps/api/src/routes/__tests__/conversations-send.test.ts` — assert the org hand-off.
- **Modify** `apps/api/src/routes/__tests__/escalations-reply-delivery.test.ts` — assert the org hand-off.
- **Create** `apps/api/src/routes/__tests__/operator-send-per-org.test.ts` — route -> real notifier -> Graph end-to-end (org B).

---

### Task 1: Core — per-org creds + orgId on `ProactiveSender`

**Files:**

- Modify: `packages/core/src/notifications/proactive-sender.ts`
- Test (create): `packages/core/src/notifications/__tests__/proactive-sender-per-org.test.ts`

**Interfaces:**

- Produces:
  - `AgentNotifier.sendProactive(chatId: string, channelType: string, message: string, organizationId?: string): Promise<void>`
  - `ProactiveSenderConfig.isWithinWindow?: (chatId: string, organizationId?: string) => Promise<boolean>`
  - `ProactiveSenderConfig.resolveWhatsAppCredentials?: (organizationId?: string) => Promise<{ token: string; phoneNumberId: string } | null>`

- [ ] **Step 1: Write the failing test** — create `packages/core/src/notifications/__tests__/proactive-sender-per-org.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { ProactiveSender } from "../proactive-sender.js";

function jsonOk(): Response {
  return new Response(JSON.stringify({ messages: [{ id: "wamid.X" }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ProactiveSender per-org WhatsApp send", () => {
  it("uses resolveWhatsAppCredentials(orgId) over the construction (global) creds", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonOk());
    vi.stubGlobal("fetch", fetchMock);
    const sender = new ProactiveSender({
      credentials: { whatsapp: { token: "GLOBAL_T", phoneNumberId: "GLOBAL_P" } },
      isWithinWindow: async () => true,
      resolveWhatsAppCredentials: async (orgId) =>
        orgId === "orgB" ? { token: "TB", phoneNumberId: "PB" } : null,
    });

    await sender.sendProactive("+15550001111", "whatsapp", "hi", "orgB");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/PB/messages");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer TB");
  });

  it("falls back to the construction (global) creds when the org resolver returns null", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonOk());
    vi.stubGlobal("fetch", fetchMock);
    const sender = new ProactiveSender({
      credentials: { whatsapp: { token: "GLOBAL_T", phoneNumberId: "GLOBAL_P" } },
      isWithinWindow: async () => true,
      resolveWhatsAppCredentials: async () => null,
    });

    await sender.sendProactive("+15550001111", "whatsapp", "hi", "orgPilot");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/GLOBAL_P/messages");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer GLOBAL_T");
  });

  it("threads organizationId into the window check", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonOk());
    vi.stubGlobal("fetch", fetchMock);
    const windowSpy = vi.fn().mockResolvedValue(true);
    const sender = new ProactiveSender({
      credentials: { whatsapp: { token: "T", phoneNumberId: "P" } },
      isWithinWindow: windowSpy,
      resolveWhatsAppCredentials: async () => null,
    });

    await sender.sendProactive("+15550002222", "whatsapp", "hi", "orgX");

    expect(windowSpy).toHaveBeenCalledWith("+15550002222", "orgX");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core exec vitest run src/notifications/__tests__/proactive-sender-per-org.test.ts`
Expected: FAIL — `sendProactive` ignores the 4th arg so `resolveWhatsAppCredentials` is never consulted (url contains `/GLOBAL_P/` not `/PB/`); `windowSpy` called with one arg, not two. Capture the failing assertion as the RED proof.

- [ ] **Step 3: Implement** — in `packages/core/src/notifications/proactive-sender.ts`:

(a) `AgentNotifier` interface:

```ts
export interface AgentNotifier {
  sendProactive(
    chatId: string,
    channelType: string,
    message: string,
    organizationId?: string,
  ): Promise<void>;
}
```

(b) `ProactiveSenderConfig`:

```ts
export interface ProactiveSenderConfig {
  credentials: ChannelCredentials;
  /** Optional callback to check if a chatId is within the WhatsApp 24h window for the given org. */
  isWithinWindow?: (chatId: string, organizationId?: string) => Promise<boolean>;
  /**
   * Optional per-org WhatsApp send-credential resolver. Returns the org's own
   * {token, phoneNumberId} (with per-field global-env fallback already applied),
   * or null when neither an org Connection nor a global env value is available.
   * Resolving per send keeps multi-tenant creds from bleeding across orgs while
   * the single sender instance (and its daily-rate-limit map) is preserved.
   */
  resolveWhatsAppCredentials?: (
    organizationId?: string,
  ) => Promise<{ token: string; phoneNumberId: string } | null>;
}
```

(c) class fields + constructor — add alongside the existing `isWithinWindow` handling:

```ts
  private resolveWhatsAppCredentials:
    | ((organizationId?: string) => Promise<{ token: string; phoneNumberId: string } | null>)
    | null;

  constructor(credentialsOrConfig: ChannelCredentials | ProactiveSenderConfig) {
    if ("credentials" in credentialsOrConfig) {
      this.credentials = credentialsOrConfig.credentials;
      this.isWithinWindow = credentialsOrConfig.isWithinWindow ?? null;
      this.resolveWhatsAppCredentials = credentialsOrConfig.resolveWhatsAppCredentials ?? null;
    } else {
      this.credentials = credentialsOrConfig;
      this.isWithinWindow = null;
      this.resolveWhatsAppCredentials = null;
    }
  }
```

(d) `sendProactive` signature + the whatsapp branch:

```ts
  async sendProactive(
    chatId: string,
    channelType: string,
    message: string,
    organizationId?: string,
  ): Promise<void> {
    if (!this.checkRateLimit(chatId)) {
      const idForLog = channelType === "whatsapp" ? maskPhone(chatId) : chatId;
      console.warn(`[ProactiveSender] Rate limit reached for chat ${idForLog}. Message not sent.`);
      return;
    }

    switch (channelType) {
      case "telegram":
        await this.sendTelegram(chatId, message);
        break;
      case "slack":
        await this.sendSlack(chatId, message);
        break;
      case "whatsapp":
        await this.sendWhatsApp(chatId, message, organizationId);
        break;
      default:
        console.warn(`[ProactiveSender] Unknown channel type: ${channelType}`);
    }
  }
```

(e) `sendWhatsApp` — resolve per-org creds first, then org-scoped window, then send:

```ts
  private async sendWhatsApp(
    to: string,
    message: string,
    organizationId?: string,
  ): Promise<void> {
    // Per-org send creds (multi-tenant): use the resolved org creds when available,
    // else the construction-time global creds (single-tenant pilot / no-org callers).
    const creds =
      (organizationId && this.resolveWhatsAppCredentials
        ? await this.resolveWhatsAppCredentials(organizationId)
        : null) ?? this.credentials.whatsapp;
    if (!creds) {
      console.warn("[ProactiveSender] No WhatsApp credentials configured");
      return;
    }

    // 24h window gate, scoped to the sending org so a cross-org inbound never opens it.
    if (this.isWithinWindow) {
      const withinWindow = await this.isWithinWindow(to, organizationId);
      if (!withinWindow) {
        const masked = maskPhone(to);
        console.warn(
          `[ProactiveSender] WhatsApp 24h window expired for ${masked}: freeform message not delivered`,
        );
        throw new WhatsAppWindowClosedError(masked);
      }
    }

    const res = await fetch(`https://graph.facebook.com/v21.0/${creds.phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${creds.token}`,
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: message },
      }),
    });

    if (!res.ok) {
      throw new Error(`WhatsApp API error: ${res.status} ${res.statusText}`);
    }
  }
```

- [ ] **Step 4: Run the new test + the existing sender tests (back-compat)**

Run: `pnpm --filter @switchboard/core exec vitest run src/notifications`
Expected: PASS — new file green; `__tests__/proactive-sender.test.ts` + `proactive-sender.test.ts` still green (3-arg `sendProactive` calls and `isWithinWindow`-as-1-arg closures remain valid against the now-optional params).

- [ ] **Step 5: Build core dist (so apps/api tsc/tests see the new types) + commit**

```bash
pnpm --filter @switchboard/core exec tsc --noEmit
pnpm --filter @switchboard/core build
git add packages/core/src/notifications/proactive-sender.ts packages/core/src/notifications/__tests__/proactive-sender-per-org.test.ts
git commit -m "feat(core): thread per-org WhatsApp creds + orgId through ProactiveSender (A15)"
```

---

### Task 2: apps/api factory `buildAgentNotifier` + real-producer acceptance tests

**Files:**

- Create: `apps/api/src/notifications/build-agent-notifier.ts`
- Test (create): `apps/api/src/notifications/__tests__/build-agent-notifier.test.ts`

**Interfaces:**

- Consumes: `ProactiveSender`, `isWithinWhatsAppWindow` (from `@switchboard/core/notifications`); `resolveOrgWhatsAppSendCreds`, `ConnectionCredentialReader` (from `../lib/whatsapp-send-creds.js`); `resolveWhatsAppSendToken` (from `../lib/whatsapp-send-token.js`).
- Produces:
  - `buildAgentNotifier(deps: { prismaClient: PrismaClient | null; connectionStore: ConnectionCredentialReader | null }): ProactiveSender | null`

- [ ] **Step 1: Write the failing acceptance test** — create `apps/api/src/notifications/__tests__/build-agent-notifier.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WhatsAppWindowClosedError } from "@switchboard/core/notifications";
import { buildAgentNotifier } from "../build-agent-notifier.js";
import type { ConnectionCredentialReader } from "../../lib/whatsapp-send-creds.js";

const PHONE = "+15550001111";

/** ConnectionCredentialReader fake -> drives the REAL resolveOrgWhatsAppSendCreds. */
function makeReader(
  byOrg: Record<string, { credentials: Record<string, unknown> }>,
): ConnectionCredentialReader {
  return {
    getByService: vi.fn(async (serviceId: string, orgId?: string) =>
      serviceId === "whatsapp" && orgId && byOrg[orgId] ? byOrg[orgId] : null,
    ),
  };
}

type StateRow = {
  principalId: string;
  channel: string;
  organizationId: string | null;
  lastInboundAt: Date | null;
};

/** Mock Prisma whose conversationState.findFirst faithfully honors the WHERE org-scope + orderBy desc. */
function makePrisma(rows: StateRow[]) {
  return {
    conversationState: {
      findFirst: vi.fn(
        async (args: {
          where: { principalId: string; channel: string; organizationId: string };
          orderBy: { lastInboundAt: "desc" };
          select: { lastInboundAt: true };
        }) => {
          const { principalId, channel, organizationId } = args.where;
          const matches = rows.filter(
            (r) =>
              r.principalId === principalId &&
              r.channel === channel &&
              r.organizationId === organizationId, // null row !== concrete org => fail closed
          );
          matches.sort(
            (a, b) => (b.lastInboundAt?.getTime() ?? 0) - (a.lastInboundAt?.getTime() ?? 0),
          );
          const top = matches[0];
          return top ? { lastInboundAt: top.lastInboundAt } : null;
        },
      ),
    },
  } as unknown as import("@switchboard/db").PrismaClient;
}

function jsonOk(): Response {
  return new Response(JSON.stringify({ messages: [{ id: "wamid.X" }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
function hoursAgo(h: number): Date {
  return new Date(Date.now() - h * 60 * 60 * 1000);
}

describe("buildAgentNotifier — per-org send credentials", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "GLOBAL_T");
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "GLOBAL_P");
    fetchMock = vi.fn().mockResolvedValue(jsonOk());
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("sends org B's reply from org B's phoneNumberId/token, not the global pilot number", async () => {
    const connectionStore = makeReader({
      orgA: { credentials: { token: "TA", phoneNumberId: "PA" } },
      orgB: { credentials: { token: "TB", phoneNumberId: "PB" } },
    });
    const prisma = makePrisma([
      {
        principalId: PHONE,
        channel: "whatsapp",
        organizationId: "orgB",
        lastInboundAt: hoursAgo(1),
      },
    ]);
    const notifier = buildAgentNotifier({ prismaClient: prisma, connectionStore });
    expect(notifier).not.toBeNull();

    await notifier!.sendProactive(PHONE, "whatsapp", "reply", "orgB");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/PB/messages");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer TB");
  });

  it("falls back to the global env number for an org with no whatsapp Connection (pilot)", async () => {
    const connectionStore = makeReader({});
    const prisma = makePrisma([
      {
        principalId: PHONE,
        channel: "whatsapp",
        organizationId: "orgPilot",
        lastInboundAt: hoursAgo(1),
      },
    ]);
    const notifier = buildAgentNotifier({ prismaClient: prisma, connectionStore });

    await notifier!.sendProactive(PHONE, "whatsapp", "reply", "orgPilot");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/GLOBAL_P/messages");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer GLOBAL_T");
  });

  it("per-field fallback: org phoneNumberId + global token when the Connection omits the token", async () => {
    const connectionStore = makeReader({ orgB: { credentials: { phoneNumberId: "PB" } } });
    const prisma = makePrisma([
      {
        principalId: PHONE,
        channel: "whatsapp",
        organizationId: "orgB",
        lastInboundAt: hoursAgo(1),
      },
    ]);
    const notifier = buildAgentNotifier({ prismaClient: prisma, connectionStore });

    await notifier!.sendProactive(PHONE, "whatsapp", "reply", "orgB");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/PB/messages");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer GLOBAL_T");
  });

  it("returns null when no channel credentials are configured", () => {
    vi.unstubAllEnvs();
    const notifier = buildAgentNotifier({ prismaClient: null, connectionStore: null });
    expect(notifier).toBeNull();
  });
});

describe("buildAgentNotifier — org-scoped 24h window gate", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const connectionStore = makeReader({
    orgA: { credentials: { token: "TA", phoneNumberId: "PA" } },
    orgB: { credentials: { token: "TB", phoneNumberId: "PB" } },
  });
  beforeEach(() => {
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "GLOBAL_T");
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "GLOBAL_P");
    fetchMock = vi.fn().mockResolvedValue(jsonOk());
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("opens the window off the replying org's inbound row, not a fresher cross-org row", async () => {
    // Shared phone: org A inbound 25h ago (CLOSED for A), org B inbound 1h ago (OPEN for B).
    const prisma = makePrisma([
      {
        principalId: PHONE,
        channel: "whatsapp",
        organizationId: "orgA",
        lastInboundAt: hoursAgo(25),
      },
      {
        principalId: PHONE,
        channel: "whatsapp",
        organizationId: "orgB",
        lastInboundAt: hoursAgo(1),
      },
    ]);
    const notifier = buildAgentNotifier({ prismaClient: prisma, connectionStore });

    // org A must use its OWN 25h row -> window closed -> throws, no send.
    await expect(notifier!.sendProactive(PHONE, "whatsapp", "x", "orgA")).rejects.toBeInstanceOf(
      WhatsAppWindowClosedError,
    );
    expect(fetchMock).not.toHaveBeenCalled();

    // org B uses its OWN 1h row -> open -> sends from PB.
    await notifier!.sendProactive(PHONE, "whatsapp", "y", "orgB");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0] as string).toContain("/PB/messages");
  });

  it("treats a null-org inbound row as non-matching (fail closed)", async () => {
    const prisma = makePrisma([
      { principalId: PHONE, channel: "whatsapp", organizationId: null, lastInboundAt: hoursAgo(1) },
    ]);
    const notifier = buildAgentNotifier({ prismaClient: prisma, connectionStore });

    await expect(notifier!.sendProactive(PHONE, "whatsapp", "x", "orgA")).rejects.toBeInstanceOf(
      WhatsAppWindowClosedError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api exec vitest run src/notifications/__tests__/build-agent-notifier.test.ts`
Expected: FAIL — `buildAgentNotifier` does not exist (import/module error). RED proof = the missing-module/undefined-export failure.

- [ ] **Step 3: Implement** — create `apps/api/src/notifications/build-agent-notifier.ts`:

```ts
import { ProactiveSender, isWithinWhatsAppWindow } from "@switchboard/core/notifications";
import type { PrismaClient } from "@switchboard/db";
import {
  resolveOrgWhatsAppSendCreds,
  type ConnectionCredentialReader,
} from "../lib/whatsapp-send-creds.js";
import { resolveWhatsAppSendToken } from "../lib/whatsapp-send-token.js";

export interface BuildAgentNotifierDeps {
  prismaClient: PrismaClient | null;
  connectionStore: ConnectionCredentialReader | null;
}

/**
 * Build the single boot ProactiveSender used by the operator-send and
 * escalation-reply routes. Multi-tenant correct: WhatsApp sends resolve the
 * replying org's own {token, phoneNumberId} (per-field global-env fallback for
 * the single-tenant pilot), and the 24h window gate is scoped to the replying
 * org so a cross-org / null-org inbound row never opens it (fail closed).
 *
 * The sender is built ONCE at boot and decorated on the app; callers thread the
 * auth org via sendProactive's organizationId param. Never reconstruct it per
 * request -- that resets the in-memory daily-rate-limit map.
 *
 * Window source: ConversationState.lastInboundAt (phone-keyed), org-scoped. The
 * contact-keyed proactive workflows use ConversationThread.lastWhatsAppInboundAt;
 * the two sources are deliberately kept (different access patterns), both org-scoped.
 */
export function buildAgentNotifier(deps: BuildAgentNotifierDeps): ProactiveSender | null {
  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
  const whatsappToken = resolveWhatsAppSendToken();
  const whatsappPhoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const slackBotToken = process.env.SLACK_BOT_TOKEN;

  if (!telegramBotToken && !whatsappToken && !slackBotToken) return null;

  const { prismaClient, connectionStore } = deps;

  const isWithinWindow = async (recipient: string, organizationId?: string): Promise<boolean> => {
    // Fail closed: no DB or no org scope means no provable in-window inbound.
    if (!prismaClient || !organizationId) return false;
    const row = await prismaClient.conversationState.findFirst({
      where: { principalId: recipient, channel: "whatsapp", organizationId },
      orderBy: { lastInboundAt: "desc" },
      select: { lastInboundAt: true },
    });
    return isWithinWhatsAppWindow(row?.lastInboundAt ?? null);
  };

  const resolveWhatsAppCredentials = async (
    organizationId?: string,
  ): Promise<{ token: string; phoneNumberId: string } | null> => {
    const perOrg =
      organizationId && connectionStore
        ? await resolveOrgWhatsAppSendCreds(connectionStore, organizationId)
        : null;
    // Per-field fallback to the global env values (single-tenant pilot only).
    const token = perOrg?.token ?? resolveWhatsAppSendToken();
    const phoneNumberId = perOrg?.phoneNumberId ?? process.env.WHATSAPP_PHONE_NUMBER_ID;
    if (!token || !phoneNumberId) return null;
    return { token, phoneNumberId };
  };

  return new ProactiveSender({
    credentials: {
      telegram: telegramBotToken ? { botToken: telegramBotToken } : undefined,
      whatsapp:
        whatsappToken && whatsappPhoneNumberId
          ? { token: whatsappToken, phoneNumberId: whatsappPhoneNumberId }
          : undefined,
      slack: slackBotToken ? { botToken: slackBotToken } : undefined,
    },
    isWithinWindow,
    resolveWhatsAppCredentials,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter api exec vitest run src/notifications/__tests__/build-agent-notifier.test.ts`
Expected: PASS — all 6 tests green (creds A/D/E/F + window B/C).

- [ ] **Step 5: typecheck + commit**

```bash
pnpm --filter api exec tsc --noEmit
git add apps/api/src/notifications/build-agent-notifier.ts apps/api/src/notifications/__tests__/build-agent-notifier.test.ts
git commit -m "feat(api): buildAgentNotifier factory — per-org WA creds + org-scoped window (A15)"
```

---

### Task 3: Wire `app.ts` to `buildAgentNotifier`

**Files:**

- Modify: `apps/api/src/app.ts` (the `agentNotifier` wiring block, currently ~403-449)

**Interfaces:**

- Consumes: `buildAgentNotifier` (Task 2); `getConnectionStore` (from `./utils/connection-store.js`).

- [ ] **Step 1: Implement** — replace the ENTIRE inline block, spanning from the `let agentNotifier: AgentNotifier | null = null;` declaration (~line 403) THROUGH the `app.decorate("agentNotifier", agentNotifier);` line (~449) inclusive — so there is no leftover `let agentNotifier` (the new block re-declares it as `const`; a partial replace would duplicate the declaration). Replace with:

```ts
// ProactiveSender for the two human-reply routes. Built ONCE at boot (the
// in-memory daily-rate-limit map must persist); per-org send creds + the
// org-scoped 24h window are resolved per send inside the factory (A15).
const { buildAgentNotifier } = await import("./notifications/build-agent-notifier.js");
const whatsappConnectionStore = prismaClient ? await getConnectionStore(prismaClient) : null;
const agentNotifier: AgentNotifier | null = buildAgentNotifier({
  prismaClient: prismaClient ?? null,
  connectionStore: whatsappConnectionStore,
});
if (!agentNotifier) {
  app.log.warn(
    "No channel credentials found — agentNotifier disabled. " +
      "Set TELEGRAM_BOT_TOKEN, WHATSAPP_ACCESS_TOKEN+WHATSAPP_PHONE_NUMBER_ID, or SLACK_BOT_TOKEN.",
  );
}
app.decorate("agentNotifier", agentNotifier);
```

Add the import near the other `./utils` imports (verify exact symbol):

```ts
import { getConnectionStore } from "./utils/connection-store.js";
```

Remove now-dead locals if they are no longer referenced elsewhere in the file (`telegramBotToken`, `whatsappToken`, `whatsappPhoneNumberId`, `slackBotToken`, `hasAnyCreds`, the inline `isWithinWindow`, and the dynamic import of `ProactiveSender`/`isWithinWhatsAppWindow`). Grep first: `rg -n "whatsappToken|whatsappPhoneNumberId|hasAnyCreds|isWithinWhatsAppWindow" apps/api/src/app.ts` and delete only the lines that become unused. `resolveWhatsAppSendToken` import at app.ts:31 may become unused — drop it if so (the factory owns token resolution now).

- [ ] **Step 2: typecheck + build api**

Run: `pnpm --filter api exec tsc --noEmit && pnpm --filter api build`
Expected: PASS (no unused-var errors; `getConnectionStore` returns a store satisfying `ConnectionCredentialReader`).

- [ ] **Step 3: Run the api app/bootstrap test suite (no behavior regression)**

Run: `pnpm --filter api exec vitest run src/__tests__ src/notifications`
Expected: PASS. (RED proof N/A — behavior-preserving wiring refactor; the org-scoping behavior is proven by Task 2's factory tests and the end-to-end Task 5.)

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/app.ts
git commit -m "refactor(api): wire agentNotifier through buildAgentNotifier (A15)"
```

---

### Task 4: Routes pass the auth `organizationId` to `sendProactive`

**Files:**

- Modify: `apps/api/src/routes/conversations.ts:341`
- Modify: `apps/api/src/routes/escalations.ts:367`
- Test: `apps/api/src/routes/__tests__/conversations-send.test.ts`
- Test: `apps/api/src/routes/__tests__/escalations-reply-delivery.test.ts`

- [ ] **Step 1: Write the failing assertions** — in `conversations-send.test.ts` change line 77 from:

```ts
expect(sendProactive).toHaveBeenCalledWith("p1", "telegram", "hi");
```

to:

```ts
expect(sendProactive).toHaveBeenCalledWith("p1", "telegram", "hi", "org_1");
```

In `escalations-reply-delivery.test.ts` change the assertion at lines 129-133 from:

```ts
expect(sendProactive).toHaveBeenCalledWith(
  "user-phone-123",
  "whatsapp",
  "We can fit you in at 3pm tomorrow.",
);
```

to:

```ts
expect(sendProactive).toHaveBeenCalledWith(
  "user-phone-123",
  "whatsapp",
  "We can fit you in at 3pm tomorrow.",
  "org_1",
);
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter api exec vitest run src/routes/__tests__/conversations-send.test.ts src/routes/__tests__/escalations-reply-delivery.test.ts`
Expected: FAIL — routes currently call `sendProactive` with 3 args; the 4th (`"org_1"`) is `undefined`. Capture the mismatch as RED.

- [ ] **Step 3: Implement** — `conversations.ts` (the call at ~:341):

```ts
await app.agentNotifier.sendProactive(
  storeResult.destinationPrincipalId,
  storeResult.channel,
  message,
  orgId,
);
```

`escalations.ts` (the call at ~:367):

```ts
await app.agentNotifier.sendProactive(
  storeResult.destinationPrincipalId,
  storeResult.channel,
  message,
  orgId,
);
```

(`orgId` is already in scope: `conversations.ts:296` `request.organizationIdFromAuth`; `escalations.ts` `requireOrganizationScope(request, reply)` at the reply route top.)

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter api exec vitest run src/routes/__tests__/conversations-send.test.ts src/routes/__tests__/escalations-reply-delivery.test.ts`
Expected: PASS.

- [ ] **Step 5: typecheck + commit**

```bash
pnpm --filter api exec tsc --noEmit
git add apps/api/src/routes/conversations.ts apps/api/src/routes/escalations.ts apps/api/src/routes/__tests__/conversations-send.test.ts apps/api/src/routes/__tests__/escalations-reply-delivery.test.ts
git commit -m "fix(api): pass auth organizationId to the reply-path WhatsApp send (A15)"
```

---

### Task 5: End-to-end — reply route -> real notifier -> Graph (two orgs, shared phone)

**Files:**

- Test (create): `apps/api/src/routes/__tests__/operator-send-per-org.test.ts`

**Interfaces:**

- Consumes: `buildConversationTestApp` (`./build-conversation-test-app.js`); `buildAgentNotifier` (Task 2).

- [ ] **Step 1: Write the failing/then-passing end-to-end test** — create `apps/api/src/routes/__tests__/operator-send-per-org.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildConversationTestApp } from "./build-conversation-test-app.js";
import { buildAgentNotifier } from "../../notifications/build-agent-notifier.js";
import type { ConnectionCredentialReader } from "../../lib/whatsapp-send-creds.js";

const PHONE = "+15557654321";

function makeReader(
  byOrg: Record<string, { credentials: Record<string, unknown> }>,
): ConnectionCredentialReader {
  return {
    getByService: vi.fn(async (serviceId: string, orgId?: string) =>
      serviceId === "whatsapp" && orgId && byOrg[orgId] ? byOrg[orgId] : null,
    ),
  };
}
function makePrisma(
  rows: Array<{
    principalId: string;
    channel: string;
    organizationId: string | null;
    lastInboundAt: Date;
  }>,
) {
  return {
    conversationState: {
      findFirst: vi.fn(
        async (args: {
          where: { principalId: string; channel: string; organizationId: string };
        }) => {
          const { principalId, channel, organizationId } = args.where;
          const m = rows
            .filter(
              (r) =>
                r.principalId === principalId &&
                r.channel === channel &&
                r.organizationId === organizationId,
            )
            .sort((a, b) => b.lastInboundAt.getTime() - a.lastInboundAt.getTime())[0];
          return m ? { lastInboundAt: m.lastInboundAt } : null;
        },
      ),
    },
  } as unknown as import("@switchboard/db").PrismaClient;
}
function workTraceStore() {
  return {
    persist: vi.fn(),
    claim: vi.fn().mockResolvedValue({ claimed: true }),
    getByWorkUnitId: vi.fn().mockResolvedValue({
      trace: { workUnitId: "wt_1", parameters: { message: { text: "hi" } } },
      integrity: { status: "ok" as const },
    }),
    update: vi.fn().mockResolvedValue({ ok: true, trace: { workUnitId: "wt_1" } }),
    getByIdempotencyKey: vi.fn(),
  };
}

describe("operator send -> per-org WhatsApp (two orgs, shared phone)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "GLOBAL_T");
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "GLOBAL_P");
    fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ messages: [{ id: "wamid.Y" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("org B's operator reply ships from org B's WABA number using org B's own inbound window", async () => {
    const connectionStore = makeReader({
      orgA: { credentials: { token: "TA", phoneNumberId: "PA" } },
      orgB: { credentials: { token: "TB", phoneNumberId: "PB" } },
    });
    const prisma = makePrisma([
      {
        principalId: PHONE,
        channel: "whatsapp",
        organizationId: "orgA",
        lastInboundAt: new Date(Date.now() - 25 * 3600_000),
      },
      {
        principalId: PHONE,
        channel: "whatsapp",
        organizationId: "orgB",
        lastInboundAt: new Date(Date.now() - 1 * 3600_000),
      },
    ]);
    const notifier = buildAgentNotifier({ prismaClient: prisma, connectionStore });

    const app = await buildConversationTestApp({
      conversationStateStore: {
        sendOperatorMessage: vi.fn().mockResolvedValue({
          conversationId: "c",
          threadId: "t1",
          channel: "whatsapp",
          destinationPrincipalId: PHONE,
          workTraceId: "wt_1",
          appendedMessage: { role: "owner", text: "hi", timestamp: "2026-06-22T00:00:00.000Z" },
        }),
        setOverride: vi.fn(),
        releaseEscalationToAi: vi.fn(),
      },
      workTraceStore: workTraceStore(),
      agentNotifier: notifier,
      organizationId: "orgB",
      principalId: "op_1",
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/conversations/t1/send",
      payload: { message: "hi" },
    });

    expect(res.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/PB/messages"); // org B's number, NOT GLOBAL_P or PA
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer TB");
  });
});
```

- [ ] **Step 2: Run it**

Run: `pnpm --filter api exec vitest run src/routes/__tests__/operator-send-per-org.test.ts`
Expected: PASS once Tasks 1-4 are in (this test exercises the full chain: route -> auth org -> sendProactive(orgB) -> factory closures -> real resolver + real window -> Graph). If it reds, the failing leg IS the integration bug to fix; do not weaken the test.

- [ ] **Step 3: typecheck + commit**

```bash
pnpm --filter api exec tsc --noEmit
git add apps/api/src/routes/__tests__/operator-send-per-org.test.ts
git commit -m "test(api): end-to-end per-org operator WhatsApp send (A15)"
```

---

## Verification (VERIFY phase — delegate to a fresh-context verifier)

Gates (all must be green; store booleans + the single failing excerpt in the ledger):

- `pnpm --filter @switchboard/core exec tsc --noEmit`; `pnpm --filter api exec tsc --noEmit`
- `pnpm --filter @switchboard/core test`; `pnpm --filter api test`
- `pnpm lint`; `pnpm format:check`; `pnpm arch:check`
- `CI=1 npx tsx scripts/local-verify-fast.ts`
- `pnpm exec tsx .agent/tools/check-routes.ts --mode=error` (route call-shape changed; the `architecture` CI job runs this and local `arch:check`/`local-verify-fast` MISS it)
- `pnpm build` (app packages changed)
- `pnpm audit --audit-level=high` (the required `security` gate; a fresh transitive GHSA is code-independent -> separate chore-deps PR, never auto-suppress)
- NO eval (launch workstream, send-path change, not a decision engine)
- NO `db:check-drift` (no schema change)

Acceptance criteria mapped to proof:

- (a) org B's reply sent from org B's phoneNumberId/token -> Task 2 test 1 + Task 5.
- (b) 24h window uses the replying org's inbound timestamp, not the freshest cross-org row -> Task 2 window test 1 (+ null-org fail-closed test).
- Single sender / dailyCounts preserved -> built once in app.ts (Task 3); existing core rate-limit tests still green (Task 1 step 4).
- Per-field env fallback (pilot) -> Task 2 tests 2 + 3.

Independent fresh-context review (not self-gradable): hand the reviewer ONLY the three-dot diff + acceptance criteria + the relevant feedback lessons. The grade/review must specifically confirm: per-org creds RESOLVE for a real multi-tenant org (not silent global fallback); the rate-limit map is preserved (single sender, not per-request); the window is org-SCOPED and fails closed on null/cross-org; the canonical window-source decision is real + documented; the two-org-shared-phone test drives REAL producers (real resolver + real window query), not hand-built creds.

## Merge protocol

SURFACE-before-merge. After all gates green + independent review at zero severity>=warn: open the PR with the evidence summary, state the stop reason ("external WhatsApp send path + multi-tenant isolation -> human merge call"), and STOP. Do not merge.
