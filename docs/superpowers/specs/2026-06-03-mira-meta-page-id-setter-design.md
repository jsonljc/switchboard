# Mira P2 — PR C: operator Facebook Page-id setter (meta-ads Connection)

> Status: **approved design (self-validated)**, ready for implementation plan.
> Date: 2026-06-03. Branch base: `origin/main` @ `6b7785a1`.
> This is **PR C** — go-live blocker #2 of the governed `creative.job.publish` seam
> (PR B / #830). It ships the **producer** for the page-id the publish gate already reads.

## 1. Context (grounded against `origin/main`, not assumed)

The governed publish seam (PR B, #830, `7be3d5c7`) is merged and **fails loud** on every
missing prerequisite. PR A (durable asset storage, `4ad5b286`) cleared blocker #1
(`CREATIVE_ASSET_NOT_DURABLE`). The precondition chain in
`apps/api/src/services/creative-publish-preconditions.ts` is:

```
job exists + same org → complete + reviewDecision:"kept" → durableAssetUrl
  → meta-ads Connection (accessToken + accountId) → pageId → ok
```

The **page-id leg is read-only today** and self-documents this task:

```ts
// creative-publish-preconditions.ts:96-103 (verified first-hand)
// Page-id resolution (read-only; setter is PR C): connection credentials first.
const pageId = typeof creds["pageId"] === "string" ? creds["pageId"] : null;
if (!pageId) return fail("META_PAGE_NOT_CONFIGURED", "No Facebook Page is configured for ads on this connection.");
```

**No producer writes `credentials.pageId`** anywhere in the tree (grep-confirmed across
`apps/*`, `packages/*`, non-test). So every publish fails loud `META_PAGE_NOT_CONFIGURED`.
This PR is that producer: an operator-facing control-plane setter that stores a Page id on the
org's meta-ads `Connection`, flipping the gate from `META_PAGE_NOT_CONFIGURED` → resolvable.

### Correction to the PR-B spec's read-side note
PR-B's §6.4 listed a *conditional* fallback ("org/deployment Meta config `pageId` if such a
field already exists — confirmed in TDD"). First-hand read of the **shipped** gate confirms
**there is no fallback** — the only source is `decrypt(connection.credentials).pageId`. The
setter therefore writes exactly that key, and nothing else needs a producer.

### What grounding confirmed (the seam to write)
- **Target = the org-scoped `Connection`** (`packages/db` model `Connection`,
  `@@unique([serviceId, organizationId])`, `serviceId:"meta-ads"` hyphenated), encrypted
  `credentials` blob `{ accessToken, accountId, pageId? }`. **Not** `DeploymentConnection`
  (deployment/type — what the `facebook-oauth.ts` callback writes; a different table the gate
  never reads). **Not** `Connection.externalAccountId` (the gate reads `creds.pageId`, and
  `externalAccountId` is only an `accountId` fallback, never a `pageId` source). **Not**
  deployment `inputConfig` (that is the *pixelId* seam; pageId has no inputConfig reader).
- **Store seam** (`PrismaConnectionStore`): `getByService`/`getById` return a `ConnectionRecord`
  whose `credentials` is **already decrypted**; `save(...)` **re-encrypts** the whole blob.
  `encryptCredentials(obj)→base64 string` / `decryptCredentials(string)→obj` (asymmetric,
  `CREDENTIALS_ENCRYPTION_KEY`-gated). There is **no store method that merges a single
  credential field** — this PR adds one.
- **Existing control-plane route** `apps/api/src/routes/connections.ts` is already
  `// @route-class: control-plane` and already on the `route-allowlist.yaml` (credential CRUD,
  pre-ingress). Adding a sub-route here needs **no new file, no new class header, no new
  allowlist entry**.
- **Credentials are redacted to `"***"` on every GET** (`connections.ts:redactCredentials`) →
  a setter cannot read the current value back. The UI must be **write-only**.

## 2. Goal & non-goals

**Goal.** An operator can store a Facebook Page id on their organization's meta-ads
`Connection` through a governed **control-plane** surface (backend route + a dedicated
org-scoped store merge + input validation + a dashboard editor), flipping the publish gate
from `META_PAGE_NOT_CONFIGURED` to resolvable. The write is a **read-modify-write** that
preserves `accessToken`/`accountId`, never logs the decrypted token, and is org-scoped (404
cross-org). Mirrors the shipped #828 business-facts operator-editor pattern (control-plane
`store` write, **not** `PlatformIngress.submit`).

**Non-goals (this PR).**
- Live Meta Graph verification of the page id / a page-picker dropdown (deferred enhancement — §6.1).
- Auditing connection mutations (matches the existing connections.ts CRUD precedent — §6.2).
- Writing `DeploymentConnection`, or any change to the publish path / gate (read-only, untouched).
- The 3rd go-live blocker (async/dead-letter hardening of the Meta call chain — PR-B §11).
- Activation, deployment→campaign binding, or anything past "the gate now resolves."

## 3. Design

### 3.1 DB — `PrismaConnectionStore.mergeCredentialsById` (new, `packages/db`)

A dedicated, org-scoped read-modify-write of the encrypted credentials blob that decrypts
**only after** confirming the row belongs to the caller's org and is the expected service.
Returns a typed result the route maps to HTTP.

```ts
type MergeCredentialsResult = "updated" | "not_found" | "wrong_service";

async mergeCredentialsById(
  id: string,
  organizationId: string | null,
  expectedServiceId: string,
  patch: Record<string, unknown>,
): Promise<MergeCredentialsResult> {
  const row = await this.prisma.connection.findFirst({
    where: { id, organizationId },                         // org-scoped → cross-org returns null (no decrypt)
    select: { id: true, serviceId: true, credentials: true },
  });
  if (!row) return "not_found";
  if (row.serviceId !== expectedServiceId) return "wrong_service"; // no decrypt on mismatch
  const current =
    typeof row.credentials === "string"
      ? decryptCredentials(row.credentials)                // reuse @switchboard/db crypto
      : (row.credentials as Record<string, unknown>);      // legacy-unencrypted (mirror toConnectionRecord)
  const result = await this.prisma.connection.updateMany({
    where: { id: row.id, organizationId },                 // org-scoped (mirrors updateStatus / delete)
    data: { credentials: encryptCredentials({ ...current, ...patch }) },
  });
  if (result.count === 0) return "not_found";              // deleted between read and write
  return "updated";
}
```

**Why a dedicated method (decision):** the merge must (a) preserve the other credential keys
(`accessToken`/`accountId`/`pixelId`) — the generic `PUT /:id` is full-replace and credentials
are redacted on GET, so a single-field merge can't round-trip through the client; and (b) keep
the decrypt/merge/encrypt in the db layer where credential encryption already lives, leaving the
route thin. It is org-scoped on **both** legs and **checks `serviceId` before decrypting**, so a
cross-org or wrong-service request is rejected without ever touching another row's secret
material. Satisfies the check-routes store-mutation rule (`updateMany` + `organizationId` in the
`where`) and preserves the no-match abort via the `count` check (mirrors `updateStatus`/`delete`).

**No optimistic-concurrency guard (decision, post-review):** an earlier draft added an
`updatedAt` compare-and-set + retry to defend against a concurrent writer. Adversarial review
(both Codex and an independent Claude red-team) and first-hand verification proved that premise
**false**: `oauth/token-refresh.ts:refreshMetaOAuthToken` is **dead code** (zero callers; only
re-exported), and the *live* Meta token-refresh cron
(`apps/api/src/services/cron/meta-token-refresh.ts`, wired in `inngest.ts`) writes the
**`DeploymentConnection`** table, not the org-scoped `Connection` this setter and the publish
gate use. No background writer touches a meta-ads `Connection.credentials` blob; the only writers
are operator-initiated create/`save`. A `@updatedAt`-based guard would also be only
millisecond-resolution, not airtight, so it would have given a false sense of safety. The plain
org-scoped `updateMany` (house style — `updateStatus`/`delete`) is exactly as correct here and
honest about the threat model.

### 3.2 API — `PUT /api/connections/:id/meta-page-id` (new sub-route in `connections.ts`)

`// @route-class: control-plane` (file header already present). Reuses the file's existing
guards, then delegates the org-scoped merge to the store (the route does **not** call the
unscoped `getById`, so it never decrypts a row before tenancy/service are confirmed):

1. `503` if `!app.prisma` or `!hasEncryptionKey()` (reuse existing guards verbatim).
2. `403` if no `request.organizationIdFromAuth` (matches the file's existing convention).
3. Validate body with `SetMetaPageIdBodySchema` → `400` with actionable copy on failure.
4. `store.mergeCredentialsById(id, organizationId, "meta-ads", { pageId })`:
   - `"updated"` → `200 { connection: { id, updated: true } }` (shape matches existing PUT).
   - `"not_found"` → `404 { error:"Connection not found" }` (covers cross-org and a delete race; non-disclosive).
   - `"wrong_service"` → `400 { error:"Not a Meta Ads connection" }` (actionable; the id is a non-meta-ads connection in this org).
5. **Never** log or echo credentials. The response carries no credential material.

**Validation (`SetMetaPageIdBodySchema`, `apps/api/src/validation.ts`):**
`{ pageId: string }` — trimmed, **all digits**, length 5–32: `z.object({ pageId: z.string().trim()
.regex(/^\d{5,32}$/, "Facebook Page id must be the numeric Page ID (digits only).") })`.
Facebook ad `page_id` requires the numeric id (a vanity username will not work), so digits-only
is the correct, helpful constraint. The length floor (5) rejects trivial typos while staying
permissive — format is a sanity check; the human-gated publish is the ultimate validator (§6.1).

### 3.3 Dashboard — write-only setter on the meta-ads connection card

Operators already manage connections at `/settings/channels` via `connections-list.tsx`
(connection cards with Test/Delete). Add a **write-only "Set Facebook Page" action** to the
meta-ads card. The **plumbing** (thin proxy → api-client method → react-query hook → small
form) mirrors the shipped #828 business-facts editor and the pixel-id setter's single-field
shape; the **store-level encrypted-credentials merge is novel** (the pixel-id setter writes
deployment `inputConfig` via a generic deployments PATCH — not encrypted `Connection`
credentials — so only the plumbing analogy carries, not the storage one). Chain:

- **api-client** (`SwitchboardSettingsClient`, where connection CRUD lives):
  `setMetaPageId(connectionId, pageId) → PUT /api/connections/:id/meta-page-id`.
- **proxy** `apps/dashboard/src/app/api/dashboard/connections/[id]/meta-page-id/route.ts`:
  `requireSession()` → `getApiClient()` → `client.setMetaPageId(id, pageId)` → `NextResponse`,
  forwarding non-2xx status + body via the existing `proxyError` helper.
- **hook** `useSetMetaPageId(connectionId)` (mirror `useUpdateConnection`): invalidates
  `keys.connections.all()`; surfaces the 400/404 error message to a toast.
- **UI:** a small inline form/dialog on the meta-ads card — single numeric input + helpText
  ("Find your numeric Page ID in Meta Business Suite → your Page → About → Page transparency,
  or Page Settings. Required before Mira can stage paused ads."). Write-only (credentials are
  redacted, so no current value is shown); a success toast confirms the save. No "page is
  configured" badge in v1 (the publish flow is the source of truth; deferred — §6).

### 3.4 Data flow

```
operator → meta-ads card "Set Facebook Page" form
  → useSetMetaPageId → PUT /api/dashboard/connections/:id/meta-page-id (Next proxy, requireSession)
  → SwitchboardSettingsClient.setMetaPageId
  → PUT /api/connections/:id/meta-page-id (api, control-plane)
  → PrismaConnectionStore.mergeCredentialsById (org-scoped RMW; serviceId check → decrypt → {...creds, pageId} → re-encrypt → updateMany)
  → 200
later: publish → assertPublishable → decrypt(connection.credentials).pageId is a string → gate resolves (no longer META_PAGE_NOT_CONFIGURED)
```

### 3.5 Error contract

| status | when |
| ------ | ---- |
| `200`  | merged (`{ connection: { id, updated: true } }`) |
| `400`  | invalid `pageId` (non-numeric / wrong length), or `:id` is not a meta-ads connection (`wrong_service`) |
| `403`  | no organization context |
| `404`  | connection not found or cross-org (`not_found`) |
| `503`  | DB unavailable or `CREDENTIALS_ENCRYPTION_KEY` unset |

## 4. Test plan (TDD; loop-closing)

> **Crypto-mock discipline (critical):** the **loop-closing test (2)** must use the **real**
> `encryptCredentials`/`decryptCredentials` — a mocked decrypt makes it circular and worthless. The
> existing `prisma-connection-store.test.ts` mocks `../crypto/credentials.js` at file scope, so the
> loop test lives in a **new apps/api test file that does NOT mock crypto** and sets a test
> `CREDENTIALS_ENCRYPTION_KEY` (via `vi.stubEnv`), with a small **stateful** in-memory `connection`
> mock backing `findFirst`/`updateMany`. The **store unit tests (1)** stay in the existing
> crypto-mocked store test file: its `encrypt = JSON.stringify` / `decrypt = JSON.parse` mock is a
> faithful round-trip, so it proves merge-preservation, and being a spy it lets us assert decrypt is
> **not called** on the cross-org / wrong-service paths.

1. **Store unit** (`packages/db`, in the existing crypto-mocked `prisma-connection-store.test.ts`):
   `mergeCredentialsById` merges `pageId` while **preserving** `accessToken`/`accountId` (assert the
   `updateMany` `data.credentials` round-trips to `{ ...orig, pageId }`); org-scoping (`findFirst`
   and `updateMany` `where` both carry `organizationId`); `not_found` when `findFirst` returns null
   (covers cross-org); `wrong_service` when `serviceId !== "meta-ads"` **and assert
   `decryptCredentials` was NOT called** (no secret material touched); a delete race (`updateMany` →
   `{count:0}` after a successful read) → `not_found`.
2. **Loop-closing gate test** (the PR-A-style lock — the highest-value test; new apps/api file, real
   crypto): seed the stateful `connection` mock with **real-encrypted** `{ accessToken, accountId }`
   (no pageId) + a complete/kept/`durableAssetUrl` `creativeJob` mock → `assertPublishable` (injected
   with the **real** `decryptCredentials`) returns `META_PAGE_NOT_CONFIGURED`; run the setter
   (`mergeCredentialsById(id, org, "meta-ads", { pageId })`) against the same stateful store → re-run
   `assertPublishable` → `ok` with `pageId`. Proves what the **setter writes** flips the gate through
   the real crypto round-trip — not a mocked-decrypt re-assertion of already-tested behavior.
3. **API route** (`apps/api`, flat `__tests__`): happy path `200` + the stored blob now decrypts
   to the pageId (preserving token/account); `400` invalid pageId; `400` wrong-service; `404`
   cross-org; `503` no key. Assert the response body contains **no** credential material.
4. **Dashboard**: proxy + hook test (mirror business-facts / pixel-id proxy tests: forwards
   200, surfaces 400/404). A light component test of the card action per dashboard coverage
   (40/35/40/40).

## 5. Files touched

| layer | path | change |
| ----- | ---- | ------ |
| L4 db | `packages/db/src/storage/prisma-connection-store.ts` | `mergeCredentialsById` |
| L4 db | `packages/db/src/storage/__tests__/prisma-connection-store.test.ts` (existing, crypto-mocked) | `mergeCredentialsById` unit tests |
| L5 api | `apps/api/src/validation.ts` | `SetMetaPageIdBodySchema` |
| L5 api | `apps/api/src/routes/connections.ts` + `apps/api/src/__tests__/api-connections.test.ts` (existing) | `PUT /:id/meta-page-id` |
| L5 api | `apps/api/src/services/__tests__/creative-publish-page-id-loop.test.ts` (new, crypto **unmocked**) | loop-closing gate test (`assertPublishable` + setter) |
| L5 dashboard | `apps/dashboard/src/lib/api-client/settings.ts` | `setMetaPageId` |
| L5 dashboard | `apps/dashboard/src/app/api/dashboard/connections/[id]/meta-page-id/route.ts` | proxy |
| L5 dashboard | `apps/dashboard/src/hooks/use-connections.ts` (+ test) | `useSetMetaPageId` |
| L5 dashboard | `apps/dashboard/src/components/settings/connections-list.tsx` | card action + form |
| docs | this spec + the implementation plan | — |

No Prisma schema change / migration (the `credentials` column already exists). No new env var
(`CREDENTIALS_ENCRYPTION_KEY` is pre-existing). Layering respected (all new logic in L4 db +
L5 apps; no cross-layer import added).

## 6. Self-validated design decisions (pressure-test via adversarial review)

### 6.1 Validation depth — **format-only for v1** (recommended)
Validate the page id as a numeric string with actionable copy; the **publish flow is the
ultimate validator** (a wrong/unreachable page surfaces loud as `CREATIVE_PUBLISH_META_ERROR`
at the human-gated publish step). **Deferred** (documented, not built): a best-effort
`/me/accounts` reachability check and a page-picker dropdown.

*Rationale:* live verification couples a config write to Meta Graph availability + latency
(the `MetaAdsClient` self-throttles 60s/call; a fresh un-throttled `listPages` helper would be
needed), adds failure modes to a control-plane write, and can false-negative (a page the token
manages via `business_management` may not appear in `/me/accounts`). The go-live blocker is
"an operator *can* set a page id," not a gold-plated picker. "Don't over-build." *To be
pressure-tested by adversarial review; if review judges format-only too weak, add a bounded,
non-blocking best-effort verify (Graph errors must not block the save).*

### 6.2 Audit — **no `auditLedger.record()` in v1** (recommended, matches precedent)
The existing `connections.ts` control-plane CRUD (create/update/delete — which write the
actual `accessToken`) does **not** call `auditLedger`, and the `check-routes --mode=error` gate
does **not** require it for control-plane. Auditing a public Page id while the more-sensitive
token writes go un-audited would be inconsistent; auditing connection mutations is a separate
cross-cutting improvement, out of scope for this focused blocker fix. *To be pressure-tested;
if review wants an audit row, add `connection.updated` to `AuditEventTypeSchema` (+ the pinned
operational allowlist) and record it in-handler.*

### 6.3 Route shape — **id-keyed sub-route in `connections.ts`** (recommended)
Keyed by connection `:id` (the dashboard already lists connections with ids; the card has it),
in the file that already owns connection CRUD and is already control-plane + allowlisted.
Rejected: (a) extending generic `PUT /:id` — it is full-replace and credentials are redacted
on GET, so a single-field merge can't round-trip through it without wiping the token; (b) a new
service-keyed route/file — more surface (new header, possible allowlist entry) for no gain,
since `(serviceId, organizationId)` is unique so the id-keyed write hits the same row the gate
reads.

## 7. Conventions / gates

ESM `.js` import extensions; no `any`; no `console.log`; prettier (`pnpm format:check`);
co-located `*.test.ts`; Conventional Commits (lowercase subject first word); files < 600 lines
(connections.ts is ~311; the addition keeps it well under 400). Before done: `pnpm typecheck`,
`pnpm lint`, `pnpm format:check`, `pnpm --filter @switchboard/db test`,
`pnpm --filter @switchboard/api test`, `pnpm --filter @switchboard/dashboard test`,
`pnpm exec tsx .agent/tools/check-routes.ts --mode=error`, dependency-cruiser, env-completeness.
No `db:check-drift` needed (no schema change).

**Non-blocking note:** `check-routes` prints a control-plane org-guard `::warning::` for
`connections.ts` (the file imports none of `requireOrgForMutation` etc.; it uses inline
`organizationIdFromAuth`). This warning **already fires** for the file's existing handlers and is
**excluded from the `--mode=error` exit code**. The new handler matches the file's existing
inline-`organizationIdFromAuth` convention (consistency over silencing a pre-existing,
non-blocking warning). Tightening this whole file to a decorator is a separate concern.

## 8. Adversarial design review (self-validation; replaces the user spec-review gate)

This spec was pressure-tested before implementation by two independent reviewers — Codex
(GPT-5.4) and a Claude red-team that re-verified every claim against `origin/main`. Both
converged on one **blocker** and several refinements; all are resolved in the design above.

- **[BLOCKER — fixed] The optimistic-concurrency premise was false.** The earlier draft justified
  an `updatedAt` compare-and-set guard by citing `oauth/token-refresh.ts:refreshMetaOAuthToken` as
  a concurrent writer. First-hand verification confirmed it is **dead** (zero callers), and the
  *live* `meta-token-refresh` cron writes **`DeploymentConnection`**, not the org `Connection`. No
  background writer touches this blob. **Resolution:** dropped the guard/retry/`conflict` path;
  use the plain org-scoped `updateMany` merge (house style) — §3.1.
- **[should-fix — fixed] Cross-org decrypt before tenancy check.** Routing the preflight through
  the unscoped `getById` (as the existing handlers do) would decrypt another org's credentials
  before the 404. **Resolution:** the route no longer calls `getById`; the store method does an
  org-scoped `findFirst` and **checks `serviceId` before decrypting**, so cross-org/wrong-service
  requests never touch secret material — §3.1, §3.2.
- **[should-fix — fixed] Loop-closing test must use real crypto.** A mocked decrypt makes it
  circular. **Resolution:** the round-trip tests live in a crypto-unmocked file with a stateful
  Prisma mock — §4.
- **[should-fix — fixed] "Mirrors pixel-id" was inaccurate at the storage layer** (pixel-id writes
  deployment `inputConfig`). **Resolution:** clarified that only the dashboard plumbing mirrors it;
  the encrypted-credentials merge is novel — §3.3.
- **[nice-to-have — applied] Validation floor** raised from `\d{1,32}` to `\d{5,32}` — §3.2.
- **[confirmed sound by both reviewers]** the security model (no IDOR, no credential leak,
  write-only UI, correct loop closure at the data layer), `check-routes --mode=error` compliance,
  the **format-only validation** decision (§6.1 — both judged live `/me/accounts` verification a
  *worse* v1 choice: it couples a config write to throttled Graph latency and can false-negative
  for `business_management`-managed pages; publish remains the loud validator), and the
  **no-audit-in-v1** decision (§6.2 — auditing a public Page id while the more-sensitive
  `accessToken` writes in the same file go un-audited would be incoherent; "audit all connection
  mutations" is filed as a separate cross-cutting improvement).
