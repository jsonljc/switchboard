# Stripe deposit-loop readiness check - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or
> superpowers:subagent-driven-development) to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Strict TDD: write the failing test, watch it
> fail, implement the minimum, watch it pass, commit. No em-dashes anywhere (code,
> comments, commit messages). Conventional Commits, lowercase subject.

**Goal:** Give operators a pre-flip, read-only way to report per org whether live Stripe
deposit issuance will resolve to the real `StripeConnectPaymentAdapter` or fail closed to
Noop, and exactly why, by extracting the factory's real decision into one shared predicate
that both the factory and a CLI call.

**Architecture:** A pure predicate `classifyStripeReadiness` (plus small report/precondition
helpers) lives in `apps/api/src/payments/stripe-readiness.ts`, next to the #999 credential
contract it reuses. `payment-port-factory.ts` is refactored to delegate its live-vs-Noop
decision to the predicate while keeping its exact query and adapter construction (behavior
preserving, pinned by existing tests). A thin CLI `apps/api/scripts/check-stripe-readiness.mts`
reads the DB, decrypts in-process, and prints per-org verdicts plus global deployment
preconditions, never printing the secret.

**Tech Stack:** TypeScript (ESM, `.js` import extensions), Vitest, Prisma, `@switchboard/db`
(`PrismaClient`, `decryptCredentials`), tsx for the script.

**Context:** Worktree `feat/stripe-deposit-readiness` off `origin/main` @ 4aba0760. Build
the touched packages with `pnpm exec turbo run build --filter=...@switchboard/api --force`
if a stale-export typecheck error appears; `pnpm reset` if it persists.

---

## File structure

- Create: `apps/api/src/payments/stripe-readiness.ts` - the predicate, types, the live-status
  constant, and pure report/precondition/assembler helpers. One cohesive "readiness" module.
- Create: `apps/api/src/payments/__tests__/stripe-readiness.test.ts` - unit tests for the
  above.
- Create: `apps/api/scripts/check-stripe-readiness.mts` - thin CLI shell (argv -> Prisma ->
  fetch -> assemble -> print). All logic lives in the tested module.
- Modify: `apps/api/src/bootstrap/payment-port-factory.ts` - delegate the decision to the
  predicate; keep the query (including `status: "connected"`) and adapter construction.
- Modify: `apps/api/src/bootstrap/__tests__/payment-port-factory.test.ts` - add a faithful
  `status: "connected"` to the shared fixture helper; add an agreement test.
- Modify: `apps/api/src/payments/stripe-provisioning-seam.test.ts` - add `status: "connected"`
  to the consumer mock row (faithful; the writer sets it).
- Modify: `package.json` (repo root) - add a `stripe:readiness` script alias for
  discoverability.

---

## Task 1: The readiness predicate

**Files:**

- Create: `apps/api/src/payments/stripe-readiness.ts`
- Test: `apps/api/src/payments/__tests__/stripe-readiness.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/payments/__tests__/stripe-readiness.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { classifyStripeReadiness, STRIPE_LIVE_CONNECTION_STATUS } from "../stripe-readiness.js";

const matchingCreds = { connectedAccountId: "acct_1", secretKey: "sk_live_x" };

describe("classifyStripeReadiness", () => {
  it("no_connection when the connection is null", () => {
    const v = classifyStripeReadiness(null, null);
    expect(v).toMatchObject({ live: false, reason: "no_connection", status: null });
  });

  it("status_not_connected when the connection status is not 'connected'", () => {
    const v = classifyStripeReadiness(
      { status: "disconnected", externalAccountId: "acct_1" },
      matchingCreds,
    );
    expect(v).toMatchObject({
      live: false,
      reason: "status_not_connected",
      status: "disconnected",
    });
  });

  it("credentials_incomplete when parsed credentials are null", () => {
    const v = classifyStripeReadiness(
      { status: STRIPE_LIVE_CONNECTION_STATUS, externalAccountId: "acct_1" },
      null,
    );
    expect(v).toMatchObject({ live: false, reason: "credentials_incomplete" });
  });

  it("account_mismatch when connectedAccountId differs from externalAccountId", () => {
    const v = classifyStripeReadiness(
      { status: STRIPE_LIVE_CONNECTION_STATUS, externalAccountId: "acct_2" },
      matchingCreds,
    );
    expect(v).toMatchObject({
      live: false,
      reason: "account_mismatch",
      connectedAccountId: "acct_1",
      externalAccountId: "acct_2",
    });
  });

  it("account_mismatch when externalAccountId is null even with full creds", () => {
    const v = classifyStripeReadiness(
      { status: STRIPE_LIVE_CONNECTION_STATUS, externalAccountId: null },
      matchingCreds,
    );
    expect(v).toMatchObject({ live: false, reason: "account_mismatch", externalAccountId: null });
  });

  it("ready (live) when connected, complete, and accounts match", () => {
    const v = classifyStripeReadiness(
      { status: STRIPE_LIVE_CONNECTION_STATUS, externalAccountId: "acct_1" },
      matchingCreds,
    );
    expect(v).toMatchObject({ live: true, reason: "ready", connectedAccountId: "acct_1" });
  });

  it("never returns the secret key in the verdict", () => {
    const v = classifyStripeReadiness(
      { status: STRIPE_LIVE_CONNECTION_STATUS, externalAccountId: "acct_1" },
      { connectedAccountId: "acct_1", secretKey: "sk_live_SENTINEL" },
    );
    expect(JSON.stringify(v)).not.toContain("sk_live_SENTINEL");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/api exec vitest run src/payments/__tests__/stripe-readiness.test.ts`
Expected: FAIL - cannot resolve `../stripe-readiness.js` (module does not exist).

- [ ] **Step 3: Write minimal implementation**

Create `apps/api/src/payments/stripe-readiness.ts`:

```ts
// Single source of truth for whether an org's `stripe` Connection resolves to the live
// StripeConnectPaymentAdapter or fails closed to Noop, and why. Both
// payment-port-factory.ts (resolveForOrg) and the readiness CLI call classifyStripeReadiness
// so the diagnostic can never drift from the factory's real decision. Pure: no I/O, never
// reads or returns the Stripe secret key.
import {
  parseStripeConnectCredentials,
  type StripeConnectCredentials,
} from "./stripe-connect-credentials.js";

/**
 * The Connection.status value a live Stripe deposit Connection must have. The factory query
 * filters on this and the predicate gates on it, so the value is defined exactly once.
 */
export const STRIPE_LIVE_CONNECTION_STATUS = "connected";

export type StripeReadinessReason =
  | "ready"
  | "no_connection"
  | "status_not_connected"
  | "credentials_incomplete"
  | "account_mismatch";

export interface StripeReadinessConnectionView {
  status: string;
  externalAccountId: string | null;
}

export interface StripeReadinessVerdict {
  live: boolean;
  reason: StripeReadinessReason;
  // acct_... identifiers only, for display; the secret key is never carried here.
  connectedAccountId: string | null;
  externalAccountId: string | null;
  status: string | null;
}

/**
 * Classify an org's stripe Connection. `credentials` is the parsed #999 result
 * (parseStripeConnectCredentials), so the completeness contract stays single-sourced and the
 * secret never enters the decision. Gate order mirrors the factory's real precedence.
 */
export function classifyStripeReadiness(
  connection: StripeReadinessConnectionView | null,
  credentials: StripeConnectCredentials | null,
): StripeReadinessVerdict {
  const connectedAccountId = credentials?.connectedAccountId ?? null;
  const externalAccountId = connection?.externalAccountId ?? null;
  const status = connection?.status ?? null;
  const base = { connectedAccountId, externalAccountId, status };

  if (!connection) {
    return { live: false, reason: "no_connection", ...base };
  }
  if (connection.status !== STRIPE_LIVE_CONNECTION_STATUS) {
    return { live: false, reason: "status_not_connected", ...base };
  }
  if (!credentials) {
    return { live: false, reason: "credentials_incomplete", ...base };
  }
  if (credentials.connectedAccountId !== connection.externalAccountId) {
    return { live: false, reason: "account_mismatch", ...base };
  }
  return { live: true, reason: "ready", ...base };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/api exec vitest run src/payments/__tests__/stripe-readiness.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

Verify branch first: `git branch --show-current` must print `feat/stripe-deposit-readiness`.

```bash
git add apps/api/src/payments/stripe-readiness.ts apps/api/src/payments/__tests__/stripe-readiness.test.ts
git commit -m "feat(api): add classifyStripeReadiness predicate for deposit readiness"
```

---

## Task 2: Report, precondition, and assembler helpers

**Files:**

- Modify: `apps/api/src/payments/stripe-readiness.ts`
- Test: `apps/api/src/payments/__tests__/stripe-readiness.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/src/payments/__tests__/stripe-readiness.test.ts`:

```ts
import {
  describeReadiness,
  resolveRedirectPrecondition,
  resolveWebhookPrecondition,
  assembleOrgReadiness,
} from "../stripe-readiness.js";

describe("describeReadiness", () => {
  it("formats each reason and never includes the secret", () => {
    const ready = describeReadiness({
      live: true,
      reason: "ready",
      connectedAccountId: "acct_1",
      externalAccountId: "acct_1",
      status: "connected",
    });
    expect(ready).toContain("LIVE");
    expect(ready).toContain("acct_1");

    const mismatch = describeReadiness({
      live: false,
      reason: "account_mismatch",
      connectedAccountId: "acct_1",
      externalAccountId: "acct_2",
      status: "connected",
    });
    expect(mismatch).toContain("NOOP");
    expect(mismatch).toContain("acct_1");
    expect(mismatch).toContain("acct_2");

    const unreadable = describeReadiness({
      live: false,
      reason: "credentials_unreadable",
      connectedAccountId: null,
      externalAccountId: "acct_1",
      status: "connected",
    });
    expect(unreadable).toContain("NOOP");
    expect(unreadable.toLowerCase()).toContain("decrypt");
  });
});

describe("resolveRedirectPrecondition", () => {
  it("uses PAYMENT_PUBLIC_URL when set", () => {
    const r = resolveRedirectPrecondition({ PAYMENT_PUBLIC_URL: "https://app.example.com/" });
    expect(r).toMatchObject({
      ok: true,
      source: "PAYMENT_PUBLIC_URL",
      effectiveBaseUrl: "https://app.example.com",
    });
  });

  it("falls back to DASHBOARD_URL when PAYMENT_PUBLIC_URL is blank", () => {
    const r = resolveRedirectPrecondition({
      PAYMENT_PUBLIC_URL: "   ",
      DASHBOARD_URL: "https://dash.example.com",
    });
    expect(r).toMatchObject({ ok: true, source: "DASHBOARD_URL" });
  });

  it("warns (not ok) when neither is set", () => {
    const r = resolveRedirectPrecondition({});
    expect(r).toMatchObject({ ok: false, source: "fallback", effectiveBaseUrl: null });
  });
});

describe("resolveWebhookPrecondition", () => {
  it("ok only when both secrets are present, and never returns the values", () => {
    const ok = resolveWebhookPrecondition({
      STRIPE_SECRET_KEY: "sk_x",
      STRIPE_CONNECT_WEBHOOK_SECRET: "whsec_x",
    });
    expect(ok).toEqual({ ok: true, stripeSecretKeySet: true, connectWebhookSecretSet: true });

    const missing = resolveWebhookPrecondition({ STRIPE_SECRET_KEY: "sk_x" });
    expect(missing).toEqual({
      ok: false,
      stripeSecretKeySet: true,
      connectWebhookSecretSet: false,
    });
    expect(JSON.stringify(missing)).not.toContain("sk_x");
  });
});

describe("assembleOrgReadiness", () => {
  const decryptMatching = () => ({ connectedAccountId: "acct_1", secretKey: "sk_live_x" });

  it("no_connection for a null row without decrypting", () => {
    let called = false;
    const r = assembleOrgReadiness(null, () => {
      called = true;
      return {};
    });
    expect(r.reason).toBe("no_connection");
    expect(called).toBe(false);
  });

  it("status_not_connected without decrypting a non-connected row", () => {
    let called = false;
    const r = assembleOrgReadiness(
      { credentials: "enc", externalAccountId: "acct_1", status: "disconnected" },
      () => {
        called = true;
        return decryptMatching();
      },
    );
    expect(r.reason).toBe("status_not_connected");
    expect(called).toBe(false);
  });

  it("credentials_unreadable when decrypt throws", () => {
    const r = assembleOrgReadiness(
      { credentials: "enc", externalAccountId: "acct_1", status: "connected" },
      () => {
        throw new Error("bad auth tag");
      },
    );
    expect(r).toMatchObject({ live: false, reason: "credentials_unreadable" });
  });

  it("ready for a connected, matching, decryptable row, and never carries the secret", () => {
    const r = assembleOrgReadiness(
      { credentials: "enc", externalAccountId: "acct_1", status: "connected" },
      () => ({ connectedAccountId: "acct_1", secretKey: "sk_live_SENTINEL" }),
    );
    expect(r).toMatchObject({ live: true, reason: "ready", connectedAccountId: "acct_1" });
    expect(JSON.stringify(r)).not.toContain("sk_live_SENTINEL");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @switchboard/api exec vitest run src/payments/__tests__/stripe-readiness.test.ts`
Expected: FAIL - `describeReadiness`, `resolveRedirectPrecondition`, `resolveWebhookPrecondition`, `assembleOrgReadiness` are not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `apps/api/src/payments/stripe-readiness.ts`:

```ts
// The CLI distinguishes a decrypt failure (wrong CREDENTIALS_ENCRYPTION_KEY / corrupt blob)
// from the five predicate reasons. credentials_unreadable is produced by the assembler
// before the predicate runs; it is not a predicate reason.
export type OrgReadinessReason = StripeReadinessReason | "credentials_unreadable";

export interface OrgReadinessResult extends Omit<StripeReadinessVerdict, "reason"> {
  reason: OrgReadinessReason;
}

export interface RawStripeConnectionRow {
  credentials: unknown;
  externalAccountId: string | null;
  status: string;
}

/** Human-readable, actionable one-liner. Never contains the secret. */
export function describeReadiness(result: OrgReadinessResult): string {
  switch (result.reason) {
    case "ready":
      return `LIVE - resolves to StripeConnectPaymentAdapter on ${result.connectedAccountId}`;
    case "no_connection":
      return "NOOP - no 'stripe' Connection for this org; run scripts/provision-stripe-for-org.mts";
    case "status_not_connected":
      return `NOOP - Connection.status is '${result.status}', not '${STRIPE_LIVE_CONNECTION_STATUS}'; re-provision or restore status`;
    case "credentials_incomplete":
      return "NOOP - stripe Connection credentials incomplete (need connectedAccountId and secretKey); re-provision";
    case "account_mismatch":
      return `NOOP - connectedAccountId ${result.connectedAccountId} does not equal externalAccountId ${result.externalAccountId}; settlement could not resolve this org; re-provision so they match`;
    case "credentials_unreadable":
      return "NOOP - stripe Connection credentials could not be decrypted (wrong CREDENTIALS_ENCRYPTION_KEY or corrupt blob); run with the API's encryption key";
  }
}

export interface RedirectPrecondition {
  ok: boolean;
  source: "PAYMENT_PUBLIC_URL" | "DASHBOARD_URL" | "fallback";
  // The configured origin (trailing slashes stripped), or null when it falls back to the
  // localhost dev default.
  effectiveBaseUrl: string | null;
}

/**
 * Mirror app.ts (PAYMENT_PUBLIC_URL || DASHBOARD_URL || localhost dev default) plus the
 * factory's trim-empty-guard: a blank/whitespace value falls through to the next source. A
 * fallback to localhost means a live org would issue Checkout links pointing at localhost.
 */
export function resolveRedirectPrecondition(env: {
  PAYMENT_PUBLIC_URL?: string;
  DASHBOARD_URL?: string;
}): RedirectPrecondition {
  const paymentPublic = env.PAYMENT_PUBLIC_URL?.trim();
  if (paymentPublic) {
    return {
      ok: true,
      source: "PAYMENT_PUBLIC_URL",
      effectiveBaseUrl: paymentPublic.replace(/\/+$/, ""),
    };
  }
  const dashboard = env.DASHBOARD_URL?.trim();
  if (dashboard) {
    return { ok: true, source: "DASHBOARD_URL", effectiveBaseUrl: dashboard.replace(/\/+$/, "") };
  }
  return { ok: false, source: "fallback", effectiveBaseUrl: null };
}

export interface WebhookPrecondition {
  ok: boolean;
  stripeSecretKeySet: boolean;
  connectWebhookSecretSet: boolean;
}

/**
 * The settlement webhook verifier needs both STRIPE_SECRET_KEY and
 * STRIPE_CONNECT_WEBHOOK_SECRET (app.ts); absent either, the payments webhook 503s and no
 * deposit settles. Reports presence booleans only, never the values.
 */
export function resolveWebhookPrecondition(env: {
  STRIPE_SECRET_KEY?: string;
  STRIPE_CONNECT_WEBHOOK_SECRET?: string;
}): WebhookPrecondition {
  const stripeSecretKeySet = Boolean(env.STRIPE_SECRET_KEY);
  const connectWebhookSecretSet = Boolean(env.STRIPE_CONNECT_WEBHOOK_SECRET);
  return {
    ok: stripeSecretKeySet && connectWebhookSecretSet,
    stripeSecretKeySet,
    connectWebhookSecretSet,
  };
}

/**
 * Assemble the readiness result for one org from its raw stripe Connection row (or null).
 * Decryption is injected so this stays pure and testable. Mirrors the factory's precedence:
 * a non-connected row is never decrypted. A decrypt failure is reported as
 * credentials_unreadable rather than crashing. Never returns the secret.
 */
export function assembleOrgReadiness(
  row: RawStripeConnectionRow | null,
  decrypt: (encrypted: unknown) => Record<string, unknown>,
): OrgReadinessResult {
  if (!row) {
    return classifyStripeReadiness(null, null);
  }
  const view: StripeReadinessConnectionView = {
    status: row.status,
    externalAccountId: row.externalAccountId,
  };
  if (row.status !== STRIPE_LIVE_CONNECTION_STATUS) {
    // Never decrypt a non-connected row (mirrors the factory's status-filtered query).
    return classifyStripeReadiness(view, null);
  }
  let decrypted: Record<string, unknown>;
  try {
    decrypted = decrypt(row.credentials);
  } catch {
    return {
      live: false,
      reason: "credentials_unreadable",
      connectedAccountId: null,
      externalAccountId: row.externalAccountId,
      status: row.status,
    };
  }
  return classifyStripeReadiness(view, parseStripeConnectCredentials(decrypted));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @switchboard/api exec vitest run src/payments/__tests__/stripe-readiness.test.ts`
Expected: PASS (all suites).

- [ ] **Step 5: Commit**

Verify branch: `git branch --show-current` -> `feat/stripe-deposit-readiness`.

```bash
git add apps/api/src/payments/stripe-readiness.ts apps/api/src/payments/__tests__/stripe-readiness.test.ts
git commit -m "feat(api): add readiness report, precondition, and assembler helpers"
```

---

## Task 3: Delegate the factory's decision to the predicate (behavior preserving)

**Files:**

- Modify: `apps/api/src/bootstrap/payment-port-factory.ts:76-147` (`resolveForOrg`) and the
  import block (`:14`).
- Modify: `apps/api/src/bootstrap/__tests__/payment-port-factory.test.ts` (fixture helper +
  agreement test).
- Modify: `apps/api/src/payments/stripe-provisioning-seam.test.ts` (consumer mock row).

- [ ] **Step 1: Update the existing tests first (fixtures + agreement test)**

In `apps/api/src/bootstrap/__tests__/payment-port-factory.test.ts`, change the
`makePrismaWithConnection` helper so connected fixtures carry a faithful `status`
(the provisioning writer always sets `"connected"`). Replace the helper with:

```ts
function makePrismaWithConnection(
  connectionByOrg: Record<
    string,
    { id: string; credentials: unknown; externalAccountId: string | null; status?: string } | null
  >,
) {
  return {
    connection: {
      findFirst: vi.fn(
        async ({ where }: { where: { organizationId: string; serviceId: string } }) => {
          const row = connectionByOrg[where.organizationId];
          if (!row) return null;
          // Default to the live status the writer sets, so existing connected fixtures keep
          // resolving to the live adapter once the factory delegates to the predicate.
          return { status: "connected", ...row };
        },
      ),
    },
  };
}
```

Then append an agreement test that pins the factory's adapter choice to the predicate:

```ts
import { classifyStripeReadiness } from "../../payments/stripe-readiness.js";
import { parseStripeConnectCredentials } from "../../payments/stripe-connect-credentials.js";

describe("createPaymentPortFactory: factory agrees with classifyStripeReadiness", () => {
  const cases = [
    {
      name: "match -> live",
      externalAccountId: "acct_1",
      creds: { connectedAccountId: "acct_1", secretKey: "sk_x" },
    },
    {
      name: "mismatch -> noop",
      externalAccountId: "acct_1",
      creds: { connectedAccountId: "acct_2", secretKey: "sk_x" },
    },
    {
      name: "incomplete -> noop",
      externalAccountId: "acct_1",
      creds: { connectedAccountId: "acct_1" },
    },
    {
      name: "null external -> noop",
      externalAccountId: null,
      creds: { connectedAccountId: "acct_1", secretKey: "sk_x" },
    },
  ];

  for (const c of cases) {
    it(`${c.name}: isNoop(factory) === !predicate.live`, async () => {
      const prisma = makePrismaWithConnection({
        org: {
          id: "conn",
          credentials: "enc",
          externalAccountId: c.externalAccountId,
          status: "connected",
        },
      });
      const factory = createPaymentPortFactory({
        prismaClient: prisma as never,
        logger: silentLogger,
        decryptCredentials: vi.fn(() => c.creds),
        stripeClientFactory: (() => fakeStripeClient()) as never,
      });
      const port = await factory("org");
      const predicate = classifyStripeReadiness(
        { status: "connected", externalAccountId: c.externalAccountId },
        parseStripeConnectCredentials(c.creds),
      );
      expect(isNoopPaymentAdapter(port)).toBe(!predicate.live);
    });
  }
});
```

In `apps/api/src/payments/stripe-provisioning-seam.test.ts`, add `status: "connected"` to the
consumer mock's returned row (the writer set it; the predicate now reads it). Change the
returned object inside `factoryPrisma.connection.findFirst` from:

```ts
            ? {
                id: "conn_seam",
                credentials: captured!.credentials,
                externalAccountId: captured!.externalAccountId,
              }
```

to:

```ts
            ? {
                id: "conn_seam",
                credentials: captured!.credentials,
                externalAccountId: captured!.externalAccountId,
                status: "connected",
              }
```

- [ ] **Step 2: Run the factory + seam tests to verify they FAIL**

Run: `pnpm --filter @switchboard/api exec vitest run src/bootstrap/__tests__/payment-port-factory.test.ts src/payments/stripe-provisioning-seam.test.ts`
Expected: FAIL - the agreement test imports `classifyStripeReadiness` usage that the factory
does not yet route through (the agreement test passes already because the predicate is
correct, but it documents intent); the failing signal here is primarily a typecheck/behavior
mismatch once Step 3 lands. If all pass at this step, that is acceptable: proceed to Step 3,
since the agreement test and fixtures are the pins, and Step 4 must keep them green.

- [ ] **Step 3: Refactor `resolveForOrg` to delegate to the predicate**

In `apps/api/src/bootstrap/payment-port-factory.ts`, update the import at line 14 to add the
predicate import (keep the existing `parseStripeConnectCredentials` import):

```ts
import { parseStripeConnectCredentials } from "../payments/stripe-connect-credentials.js";
import {
  classifyStripeReadiness,
  STRIPE_LIVE_CONNECTION_STATUS,
} from "../payments/stripe-readiness.js";
```

Replace the body of `resolveForOrg` (the `if (deps.prismaClient) { ... }` block through the
final Noop return, lines ~89-146) with:

```ts
if (deps.prismaClient) {
  const connection = await deps.prismaClient.connection.findFirst({
    where: { organizationId: orgId, serviceId: "stripe", status: STRIPE_LIVE_CONNECTION_STATUS },
    select: { id: true, credentials: true, externalAccountId: true, status: true },
  });

  if (connection) {
    const creds = parseStripeConnectCredentials(decrypt(connection.credentials));
    // The readiness predicate is the single source of truth for live-vs-Noop; the readiness
    // CLI calls the same function, so the diagnostic cannot drift from this decision. The
    // query already constrains status to STRIPE_LIVE_CONNECTION_STATUS, so the predicate's
    // status gate is a confirmed no-op here; it is the live gate for the CLI's broader query.
    const readiness = classifyStripeReadiness(
      { status: connection.status, externalAccountId: connection.externalAccountId },
      creds,
    );

    if (readiness.live && creds) {
      // Trim + empty-guard so a blank or whitespace base cannot produce a relative redirect
      // URL that Stripe Checkout rejects; fall back to the dev default, then strip trailing
      // slashes. (Unchanged #1015 redirect wiring.)
      const configuredBaseUrl = (
        deps.paymentRedirectBaseUrl ?? DEFAULT_PAYMENT_REDIRECT_BASE_URL
      ).trim();
      const baseUrl = (configuredBaseUrl || DEFAULT_PAYMENT_REDIRECT_BASE_URL).replace(/\/+$/, "");
      deps.logger.info(`Payment[${orgId}]: using StripeConnectPaymentAdapter (connected account)`);
      return new StripeConnectPaymentAdapter({
        client: buildStripeClient(creds.secretKey),
        connectedAccountId: creds.connectedAccountId,
        successUrl: `${baseUrl}${PAYMENT_SUCCESS_PATH}`,
        cancelUrl: `${baseUrl}${PAYMENT_CANCEL_PATH}`,
      });
    }

    if (readiness.reason === "account_mismatch") {
      deps.logger.error(
        `Payment[${orgId}]: 'stripe' Connection externalAccountId does not match credentials.connectedAccountId - using Noop (fail-closed; settlement would not resolve)`,
      );
    } else {
      deps.logger.info(
        `Payment[${orgId}]: 'stripe' Connection present but not live-ready (${readiness.reason}) - using Noop (fail-closed)`,
      );
    }
  }
}

// Fall through to Noop - every org that lacks a connected Stripe Connection gets a
// DEGRADED (T3) noop payment posture that is never a production-countable paid visit.
deps.logger.info(`Payment[${orgId}]: using NoopPaymentAdapter (Stripe Connect not configured)`);
return new NoopPaymentAdapter();
```

Note: the query keeps `serviceId: "stripe"` and `status` constrained to
`STRIPE_LIVE_CONNECTION_STATUS` (value `"connected"`), so `stripe-provisioning-seam.test.ts`'s
`where.status === "connected"` check still holds, and the factory still decrypts only
connected rows. The em-dash characters in the original log strings are replaced with `-`.

- [ ] **Step 4: Run the factory + seam tests to verify they PASS**

Run: `pnpm --filter @switchboard/api exec vitest run src/bootstrap/__tests__/payment-port-factory.test.ts src/payments/stripe-provisioning-seam.test.ts`
Expected: PASS (all existing tests + the agreement test).

- [ ] **Step 5: Commit**

Verify branch: `git branch --show-current` -> `feat/stripe-deposit-readiness`.

```bash
git add apps/api/src/bootstrap/payment-port-factory.ts apps/api/src/bootstrap/__tests__/payment-port-factory.test.ts apps/api/src/payments/stripe-provisioning-seam.test.ts
git commit -m "refactor(api): delegate payment-port factory decision to classifyStripeReadiness"
```

---

## Task 4: The read-only CLI and root alias

**Files:**

- Create: `apps/api/scripts/check-stripe-readiness.mts`
- Modify: `package.json` (repo root)

- [ ] **Step 1: Write the CLI shell**

Create `apps/api/scripts/check-stripe-readiness.mts`:

```ts
// Read-only pre-flip diagnostic: report, per org, whether live Stripe deposit issuance will
// resolve to the real StripeConnectPaymentAdapter or fail closed to Noop, and exactly why. It
// reuses the factory's real decision via classifyStripeReadiness (assembleOrgReadiness), so it
// cannot drift. Never prints the decrypted secret. Read-only: no writes, no HTTP route.
//
// Usage (needs DATABASE_URL + CREDENTIALS_ENCRYPTION_KEY, and the same PAYMENT_PUBLIC_URL /
// DASHBOARD_URL / STRIPE_* env the API runs with for the global preconditions to be meaningful):
//
//   npx tsx apps/api/scripts/check-stripe-readiness.mts <orgId>   # one org; exit 1 if not live
//   npx tsx apps/api/scripts/check-stripe-readiness.mts           # every org with a stripe Connection
//
// .mts: @switchboard/db is ESM-only (see scripts/provision-stripe-for-org.mts).
import { PrismaClient, decryptCredentials } from "@switchboard/db";
import {
  assembleOrgReadiness,
  describeReadiness,
  resolveRedirectPrecondition,
  resolveWebhookPrecondition,
  type RawStripeConnectionRow,
} from "../src/payments/stripe-readiness.js";

const decrypt = (encrypted: unknown): Record<string, unknown> =>
  decryptCredentials(encrypted as string);

function printPreconditions(): void {
  const redirect = resolveRedirectPrecondition(process.env);
  const webhook = resolveWebhookPrecondition(process.env);
  console.warn("deployment preconditions (global, affect every live org):");
  if (redirect.ok) {
    console.warn(`  redirect base: ${redirect.effectiveBaseUrl} (from ${redirect.source}) [OK]`);
  } else {
    console.warn(
      "  redirect base: PAYMENT_PUBLIC_URL and DASHBOARD_URL unset -> localhost dev default; " +
        "live Checkout links would point to localhost [WARN]",
    );
  }
  if (webhook.ok) {
    console.warn(
      "  webhook verification: STRIPE_SECRET_KEY set, STRIPE_CONNECT_WEBHOOK_SECRET set [OK]",
    );
  } else {
    console.warn(
      `  webhook verification: STRIPE_SECRET_KEY ${webhook.stripeSecretKeySet ? "set" : "MISSING"}, ` +
        `STRIPE_CONNECT_WEBHOOK_SECRET ${webhook.connectWebhookSecretSet ? "set" : "MISSING"}; ` +
        "absent either, the payments webhook 503s and deposits never settle [WARN]",
    );
  }
}

async function fetchOne(
  prisma: PrismaClient,
  orgId: string,
): Promise<RawStripeConnectionRow | null> {
  // No status filter: the diagnostic must see a non-connected Connection to report it.
  return prisma.connection.findFirst({
    where: { serviceId: "stripe", organizationId: orgId },
    select: { credentials: true, externalAccountId: true, status: true },
  });
}

async function fetchAll(
  prisma: PrismaClient,
): Promise<Array<{ organizationId: string | null; row: RawStripeConnectionRow }>> {
  const rows = await prisma.connection.findMany({
    where: { serviceId: "stripe" },
    select: { organizationId: true, credentials: true, externalAccountId: true, status: true },
    orderBy: { organizationId: "asc" },
  });
  return rows.map(({ organizationId, ...row }) => ({ organizationId, row }));
}

async function main(): Promise<void> {
  const orgId = process.argv[2];
  const prisma = new PrismaClient();
  try {
    printPreconditions();
    if (orgId) {
      const row = await fetchOne(prisma, orgId);
      const result = assembleOrgReadiness(row, decrypt);
      console.warn(`org ${orgId}: ${describeReadiness(result)}`);
      if (!result.live) process.exitCode = 1;
    } else {
      const entries = await fetchAll(prisma);
      if (entries.length === 0) {
        console.warn("no 'stripe' Connections found; nothing provisioned yet");
      }
      for (const { organizationId, row } of entries) {
        const result = assembleOrgReadiness(row, decrypt);
        console.warn(`org ${organizationId ?? "(global)"}: ${describeReadiness(result)}`);
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  // Message only: this path handles encrypted credentials; do not serialize error internals.
  console.error("[check-stripe-readiness] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
```

- [ ] **Step 2: Verify the script typechecks against the module**

Run: `pnpm --filter @switchboard/api exec tsc --noEmit -p tsconfig.json` (the module under
`src` is typechecked; the script imports it). Then sanity-run the script's help path WITHOUT a
DB by confirming it imports cleanly:

Run: `node --experimental-strip-types apps/api/scripts/check-stripe-readiness.mts --help 2>&1 | head -5 || npx tsx apps/api/scripts/check-stripe-readiness.mts 2>&1 | head -5`
Expected: it prints the "deployment preconditions" block, then fails to reach the DB (no
DATABASE_URL) with a message-only error and exit 1. That proves wiring without a live DB.
(If Postgres is unreachable this is the expected outcome; do not treat the DB error as a
plan failure.)

- [ ] **Step 3: Add the root script alias**

In the repo-root `package.json`, add to `"scripts"` (keep alphabetical neighbors sensible):

```json
    "stripe:readiness": "tsx apps/api/scripts/check-stripe-readiness.mts",
```

- [ ] **Step 4: Commit**

Verify branch: `git branch --show-current` -> `feat/stripe-deposit-readiness`.

```bash
git add apps/api/scripts/check-stripe-readiness.mts package.json
git commit -m "feat(api): add read-only check-stripe-readiness preflight cli"
```

---

## Final verification (run all; all must be green before review)

- [ ] `pnpm --filter @switchboard/api test`
- [ ] `pnpm --filter @switchboard/core test` (touched indirectly via shared types; confirm green)
- [ ] `pnpm --filter @switchboard/db test`
- [ ] `pnpm typecheck`
- [ ] `pnpm arch:check`
- [ ] `pnpm format:check` (run `pnpm format` / prettier write if it flags formatting)
- [ ] `pnpm lint`
- [ ] `CI=1 npx tsx scripts/local-verify-fast.ts` (no new env var or route is added, but this
      confirms the new script does not trip the route/env scanners)

If `pnpm typecheck` reports missing exports from `@switchboard/schemas`/`@switchboard/db`/
`@switchboard/core`, run `pnpm reset` then re-run.

---

## Self-review checklist (already applied; recorded for the executor)

- Spec coverage: predicate (Fork 1) = Task 1+3; CLI surface (Fork 2) = Task 4; scope incl.
  global preconditions (Fork 3) = Task 2+4; output contract (Fork 4) = Task 2 (describeReadiness)
  - Task 4. Behavior preservation = Task 3 (fixtures + agreement test + unchanged query/decrypt).
    Security (no secret) = Task 1+2 secret-absence assertions.
- Placeholder scan: none; every step has complete code.
- Type consistency: `StripeReadinessVerdict` (5-reason) is assignable to `OrgReadinessResult`
  (6-reason superset); `assembleOrgReadiness` returns `OrgReadinessResult`; `describeReadiness`
  accepts `OrgReadinessResult`; `classifyStripeReadiness` returns `StripeReadinessVerdict`.
  `RawStripeConnectionRow` fields match the Prisma `select` in the CLI.
