# Per-deployment Google Calendar creds — Implementation Plan (scratch, uncommitted)

**Goal:** The calendar-provider factory builds a Google provider from each clinic's OWN per-deployment OAuth creds (the `DeploymentConnection` google_calendar row the OAuth callback writes) when present; global env service-account, then Local, then Noop remain as fallbacks.

**Architecture:** Resolve the org's OAuth creds inside apps/api (new `deployment-calendar-creds.ts`, org-scoped relation query + decrypt), build a provider via a new OAuth sibling in `google-calendar-factory.ts` (`google.auth.OAuth2` + refresh token, distinct from the global JWT path), and insert a new precedence-0 branch in `calendar-provider-factory.ts` gated on the OAuth client env so existing callers (no client env) are untouched.

**Tech Stack:** TypeScript ESM, Fastify api, Prisma, googleapis, vitest. `@switchboard/db` encrypt/decrypt, `@switchboard/core/calendar` GoogleCalendarAdapter.

## Global Constraints

- ESM `.js` extensions on relative imports. No `console.log`. No `any`. No em-dashes. Prettier (double quotes, semi, 100w). Lowercase commit subject.
- NEVER log decrypted creds/tokens. NEVER call the real Google API in tests (mock googleapis / mock the sibling modules; use encrypt->decrypt round-trip for the resolver).
- New deps on the factory must be optional/defaulted (callers pass only {prismaClient, logger}).
- Verified ground truth: DeploymentConnection.credentials = String; updatedAt @updatedAt exists; deployment relation has organizationId; GOOGLE_CALENDAR_CLIENT_ID/SECRET already in env-allowlist.local-readiness.json.

---

### Task 1: OAuth provider builder (`createGoogleCalendarProviderFromOAuth`)

**Files:**

- Modify: `apps/api/src/bootstrap/google-calendar-factory.ts`
- Test: `apps/api/src/bootstrap/__tests__/google-calendar-factory.test.ts`

**Interfaces:**

- Produces: `createGoogleCalendarProviderFromOAuth(opts: { clientId: string; clientSecret: string; refreshToken: string; calendarId: string; businessHours?: BusinessHoursConfig | null }): Promise<CalendarProvider>`

- [ ] Step 1: Extend the existing `vi.mock("googleapis", ...)` in the test to add `auth.OAuth2` (capture setCredentials via `vi.hoisted`), import `createGoogleCalendarProviderFromOAuth` + `GoogleCalendarAdapter`, add failing tests:
  - returns a `GoogleCalendarAdapter`
  - constructs `google.auth.OAuth2` with `(clientId, clientSecret)` and calls `setCredentials({ refresh_token })`
- [ ] Step 2: Run `pnpm --filter @switchboard/api test -- google-calendar-factory` -> FAIL (export missing).
- [ ] Step 3: Implement the sibling in google-calendar-factory.ts:

```ts
export async function createGoogleCalendarProviderFromOAuth(opts: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  calendarId: string;
  businessHours?: BusinessHoursConfig | null;
}): Promise<CalendarProvider> {
  const { google } = await import("googleapis");
  const oauth2Client = new google.auth.OAuth2(opts.clientId, opts.clientSecret);
  oauth2Client.setCredentials({ refresh_token: opts.refreshToken });
  const calendar = google.calendar({ version: "v3", auth: oauth2Client });
  return new GoogleCalendarAdapter({
    calendarClient: calendar as never,
    calendarId: opts.calendarId,
    businessHours: opts.businessHours ?? DEFAULT_BUSINESS_HOURS,
  });
}
```

- [ ] Step 4: Run the test -> PASS.

---

### Task 2: Org creds resolver (`resolveOrgGoogleCalendarCreds`)

**Files:**

- Create: `apps/api/src/bootstrap/deployment-calendar-creds.ts`
- Test: `apps/api/src/bootstrap/__tests__/deployment-calendar-creds.test.ts`

**Interfaces:**

- Produces: `resolveOrgGoogleCalendarCreds(prismaClient: PrismaClient, orgId: string, decrypt?: (blob: string) => Record<string, unknown>): Promise<{ refreshToken: string; calendarId: string } | null>`

- [ ] Step 1: Write failing tests (mock prisma `deploymentConnection.findFirst`; inject `decrypt = (b) => decryptCredentials(b, KEY)`; seed rows via `encryptCredentials(obj, KEY)`):
  - happy: returns `{ refreshToken, calendarId }` from a round-tripped blob
  - org-scoped where: `findFirst` called with `where: { type: "google_calendar", deployment: { organizationId: "org-A" } }`
  - no row -> null
  - row without refreshToken -> null
  - row without calendarId -> calendarId defaults to `"primary"`
- [ ] Step 2: Run `pnpm --filter @switchboard/api test -- deployment-calendar-creds` -> FAIL (module missing).
- [ ] Step 3: Implement:

```ts
import { decryptCredentials, type PrismaClient } from "@switchboard/db";

export interface DeploymentCalendarCreds {
  refreshToken: string;
  calendarId: string;
}

export async function resolveOrgGoogleCalendarCreds(
  prismaClient: PrismaClient,
  orgId: string,
  decrypt: (blob: string) => Record<string, unknown> = decryptCredentials,
): Promise<DeploymentCalendarCreds | null> {
  const connection = await prismaClient.deploymentConnection.findFirst({
    where: { type: "google_calendar", deployment: { organizationId: orgId } },
    orderBy: { updatedAt: "desc" },
    select: { credentials: true },
  });
  if (!connection) return null;
  const creds = decrypt(connection.credentials);
  const refreshToken =
    typeof creds["refreshToken"] === "string" ? (creds["refreshToken"] as string) : "";
  if (!refreshToken) return null;
  const calendarId =
    typeof creds["calendarId"] === "string" && creds["calendarId"]
      ? (creds["calendarId"] as string)
      : "primary";
  return { refreshToken, calendarId };
}
```

(Add a header comment: org-scoped tenant safety; pilot 1:1; never log tokens; decrypt injectable for tests.)

- [ ] Step 4: Run the test -> PASS.

---

### Task 3: Factory precedence branch + env

**Files:**

- Modify: `apps/api/src/bootstrap/calendar-provider-factory.ts`
- Test: `apps/api/src/bootstrap/__tests__/calendar-provider-factory.google.test.ts` (new)

**Interfaces:**

- Consumes: Task 1 `createGoogleCalendarProviderFromOAuth`, Task 2 `resolveOrgGoogleCalendarCreds`.

- [ ] Step 1: Write failing tests in the new file. `vi.mock("../deployment-calendar-creds.js")` + `vi.mock("../google-calendar-factory.js")` (both siblings -> no Google client built). `makePrisma` stubs `organizationConfig.findFirst`. Assertions:
  - per-deployment creds + CLIENT_ID/SECRET present -> returns the mocked OAuth provider; `createGoogleCalendarProviderFromOAuth` called with `{ clientId, clientSecret, refreshToken, calendarId, businessHours }`
  - CLIENT_ID/SECRET absent -> OAuth builder NOT called; falls to Local (businessHours present)
  - resolver returns null -> OAuth builder NOT called; falls to Local
  - per-deployment beats global: with creds + CLIENT env + GOOGLE_CALENDAR_CREDENTIALS/ID set -> OAuth builder used, `createGoogleCalendarProvider` (JWT) NOT called
  - OAuth build throws -> falls through to global `createGoogleCalendarProvider`
- [ ] Step 2: Run `pnpm --filter @switchboard/api test -- calendar-provider-factory.google` -> FAIL.
- [ ] Step 3: Implement in calendar-provider-factory.ts:
  - Add to `CalendarProviderFactoryDeps.env`: `GOOGLE_CALENDAR_CLIENT_ID?: string; GOOGLE_CALENDAR_CLIENT_SECRET?: string;`
  - Add import: `import { resolveOrgGoogleCalendarCreds } from "./deployment-calendar-creds.js";`
  - Add the two vars to the `process.env` fallback in `resolveForOrg`.
  - Insert new Option 1 right after `businessHours` is computed, before the existing global-env Google branch (renumber comments 1->2->3->4):

```ts
// Option 1: the clinic's OWN Google Calendar (per-deployment OAuth creds written by the
// google-calendar-oauth callback). Preferred over the shared global service account so each
// org's bookings land on its own calendar. Needs the OAuth client creds to refresh tokens.
if (env.GOOGLE_CALENDAR_CLIENT_ID && env.GOOGLE_CALENDAR_CLIENT_SECRET) {
  const oauthCreds = await resolveOrgGoogleCalendarCreds(deps.prismaClient, orgId);
  if (oauthCreds) {
    try {
      const { createGoogleCalendarProviderFromOAuth } =
        await import("./google-calendar-factory.js");
      const provider = await createGoogleCalendarProviderFromOAuth({
        clientId: env.GOOGLE_CALENDAR_CLIENT_ID,
        clientSecret: env.GOOGLE_CALENDAR_CLIENT_SECRET,
        refreshToken: oauthCreds.refreshToken,
        calendarId: oauthCreds.calendarId,
        businessHours,
      });
      const health = await provider.healthCheck();
      deps.logger.info(
        `Calendar[${orgId}]: connected org-owned Google Calendar via OAuth (${health.status}, ${health.latencyMs}ms)`,
      );
      return provider;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      deps.logger.error(
        `Calendar[${orgId}]: failed to initialize org-owned Google Calendar: ${msg}`,
      );
      // Fall through to the global service account / Local.
    }
  }
}
```

- Extend the cache comment (:23-25) to note OAuth creds can appear/rotate at runtime (same restart caveat).
- [ ] Step 4: Run the new test -> PASS. Then run the WHOLE existing factory test file to prove no regression: `pnpm --filter @switchboard/api test -- calendar-provider-factory`.

---

## Self-review

- Spec coverage: per-deployment creds (T2) + OAuth build (T1) + precedence/fallback/env (T3). Cache caveat = comment. getBooking OUT.
- Types consistent: `{refreshToken, calendarId}` shape used identically in T2 produce + T3 consume.
- No placeholders. No new env var. No signature change. No layer/cycle change (apps/api only).
- Regression guard: Option 1 gated on CLIENT_ID+SECRET -> existing tests (env without them) never enter it.
