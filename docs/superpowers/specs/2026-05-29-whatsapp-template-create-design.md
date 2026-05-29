# In-product WhatsApp template creation

**Date:** 2026-05-29
**Status:** Design (approved in brainstorming, pending spec review)
**Branch (impl):** `feat/whatsapp-template-create` (fresh worktree off `main`)

## Why

The Meta App Review screencast for the `whatsapp_business_management` permission
should show the permission used **inside the product**, not via Postman or the
terminal. Switchboard already has a real management page
(`/settings/channels/whatsapp`) that _reads_ the WABA, phone numbers, and
template list through `whatsapp_business_management` on Graph v21.0 — but
template **creation** currently links _out_ to Meta Business Suite
(`whatsapp-management.tsx` Templates card header). This work brings template
creation in-product so the review video demonstrates end-to-end template
management within Switchboard, and gives operators a real create flow.

This is modeled directly on the existing **send-test** slice
(`whatsapp-send-test.ts` route + `whatsapp-send-test.tsx` panel +
`whatsapp-test-send.ts` schema), which is the closest precedent: a mutating
POST that calls Graph with the system-user token.

## Scope

In:

- A `Dialog`-modal template builder supporting the **full** component set:
  TEXT header, body (with `{{n}}` variables + samples), footer, and buttons
  (QUICK_REPLY / URL / PHONE_NUMBER).
- A new mutating API route `POST /api/dashboard/whatsapp/templates`.
- A new Zod request schema mirroring Meta's create contract.
- Lighting up the page via a seeded `Connection` + `ManagedChannel` row
  (throwaway, **not committed**).

Out (explicit non-goals):

- **Media headers** (IMAGE / VIDEO / DOCUMENT). Those require Meta's resumable
  media-upload flow (upload session → `header_handle`), a separate Graph
  subsystem. HEADER is **TEXT-only**. Media headers are a possible follow-up.
- Editing or deleting existing templates.
- Polling for approval status — the created template appears as `PENDING` and
  the existing template-list refresh surfaces later status changes on reload.

## Architecture

Four layers, each isolated and independently testable, mirroring the send-test
slice.

### 1. Schema — `packages/schemas/src/whatsapp-template-create.ts`

`WhatsAppCreateTemplateRequestSchema` validates the form payload **before** any
Graph call, enforcing Meta's documented rules so most rejections never leave the
server. Co-located test `__tests__/whatsapp-template-create.test.ts`. Barrel
line added to `packages/schemas/src/index.ts` beside `whatsapp-test-send.js`.

Shape (the API derives the Graph `components` array from this):

```ts
{
  name: string,        // ^[a-z0-9_]{1,512}$  (lowercase, digits, underscore)
  language: string,    // /^[a-zA-Z_-]+$/, 2..16  (reuse send-test's rule)
  category: "MARKETING" | "UTILITY" | "AUTHENTICATION",
  header?: { text: string },                 // TEXT-only; 1..60; <=1 variable
  body: { text: string, examples?: string[] }, // required; 1..1024
  footer?: { text: string },                 // 1..60; NO variables
  buttons?: Array<
    | { type: "QUICK_REPLY"; text: string }            // text 1..25
    | { type: "URL"; text: string; url: string }       // valid http(s) URL
    | { type: "PHONE_NUMBER"; text: string; phoneNumber: string } // E.164
  >,
}
```

Validation rules enforced by the schema (Meta-derived):

- `name`: lowercase alphanumeric + underscore only.
- `header.text`: ≤60 chars, at most one `{{1}}` variable.
- `body.text`: required, ≤1024 chars. Variables must be sequential
  (`{{1}}`, `{{2}}`, …). **Every body variable requires a matching `examples`
  entry** — Meta rejects unsampled variables. The schema cross-checks
  `examples.length === <count of distinct {{n}}>` via `.superRefine`.
- `footer.text`: ≤60 chars, **no** variables.
- `buttons`: ≤10 total; ≤2 `URL`; ≤1 `PHONE_NUMBER`; `url` must parse as
  http(s); `phoneNumber` matches E.164.

### 2. API route — `apps/api/src/routes/whatsapp-template-create.ts`

A **new file** (not added to `whatsapp-management.ts`, which is annotated
`// @route-class: read-only`). Registered in
`apps/api/src/bootstrap/routes.ts` at the existing
`/api/dashboard/whatsapp` prefix as `POST /templates`.

Reuses `graphPost` and `isRetryable` exported from `whatsapp-send-test.ts`.

Handler flow (same skeleton as `POST /send-test`):

1. `organizationIdFromAuth` → 401 if absent.
2. `WhatsAppCreateTemplateRequestSchema.safeParse` → 400
   `WHATSAPP_BAD_REQUEST` with joined issue messages on failure.
3. Look up the `whatsapp` `Connection` for the org → 404
   `WHATSAPP_NOT_CONNECTED` if absent; 500 `WHATSAPP_WABA_MISSING` if it has no
   `externalAccountId`.
4. Read `META_SYSTEM_USER_TOKEN` from env → 500 `WHATSAPP_TOKEN_MISSING` if
   unset.
5. Map the request to Meta's `components` array (BODY always present; HEADER/
   FOOTER/BUTTONS appended when provided; body `examples` →
   `example.body_text: [[...]]`; header variable → `example.header_text`).
6. `graphPost(`${GRAPH_BASE}/${wabaId}/message_templates`, body, token, fetch)`.
7. On success, return `{ id, status, category }` from Graph (status is normally
   `PENDING`). On failure, return the standard
   `{ error: { code, message, retryable } }` envelope.

**Error-mapping addition:** Meta returns code `100` / HTTP 400 for invalid
template params (bad name, missing sample, etc.). `graphPost` currently maps
unknown codes to `WHATSAPP_UPSTREAM_ERROR` (502). The create route adds a thin
local mapping so a Graph **400 / code 100** surfaces as a **400**
`WHATSAPP_TEMPLATE_INVALID` carrying Meta's verbatim message — so the form can
show the user what to fix. (Kept local to the create route, matching the
existing comment in `whatsapp-send-test.ts` that warns against moving the shared
helper without coordinated updates.)

### 3. Dashboard form — `apps/dashboard/src/components/settings/whatsapp-template-create.tsx`

A `Dialog`-modal builder (uses existing `components/ui/dialog.tsx`). The
Templates card header button (`whatsapp-management.tsx`, currently an external
`<a>` to Meta Business Suite) is changed to open this dialog instead.

- Form sections: name + category + language; header (text, optional); body
  (textarea + dynamic sample inputs, one per detected `{{n}}`); footer
  (optional); buttons (add/remove rows, type picker).
- Client-side validation reuses the shared Zod schema for instant feedback;
  the server re-validates authoritatively.
- A new hook `useCreateWhatsAppTemplate` (beside `use-whatsapp-management.ts`)
  POSTs to the route and, on success, **invalidates/refetches the template
  list** so the new `PENDING` row appears without a manual reload — the key
  visual for the review video. Follows the existing
  `useWhatsAppTemplates` fetch path (including its Next.js proxy route under
  `apps/dashboard/src/app/api/dashboard/whatsapp/...` if the read hooks use
  one — confirm during planning and mirror it for the POST).
- Errors from the server render inline in the dialog (e.g. the verbatim Meta
  message for `WHATSAPP_TEMPLATE_INVALID`).

### 4. Seed (throwaway, not committed)

Extend the uncommitted `packages/db/demo-whatsapp-seed.mts` with a mode that
inserts, for `org_dev`:

- a `Connection` (`serviceId:"whatsapp"`, `externalAccountId:"103516422734968"`,
  credentials `{ primaryPhoneNumberId:"108124008934344" }`),
- a `whatsapp` `ManagedChannel` (`status:"active"`, `testRecipients` with the
  filming number),

so `/settings/channels/whatsapp` reports `connected` and live-lists the real
WABA/templates via the system token. **Never committed** (same rule as the rest
of that script + `.env`).

## Data flow

```
Dialog form ──(Zod client check)──> useCreateWhatsAppTemplate
   └─> POST /api/dashboard/whatsapp/templates
          └─> Zod server check ─> Connection(WABA) ─> env token
                 └─> graphPost {wabaId}/message_templates  [whatsapp_business_management, v21.0]
                        └─> { id, status:PENDING } ─> refetch template list ─> new row appears
```

## Error handling

| Condition                            | Code                               | HTTP |
| ------------------------------------ | ---------------------------------- | ---- |
| No auth                              | `AUTH_REQUIRED`                    | 401  |
| Schema invalid                       | `WHATSAPP_BAD_REQUEST`             | 400  |
| No whatsapp Connection               | `WHATSAPP_NOT_CONNECTED`           | 404  |
| Connection missing WABA              | `WHATSAPP_WABA_MISSING`            | 500  |
| Token unset                          | `WHATSAPP_TOKEN_MISSING`           | 500  |
| Meta rejects params (code 100 / 400) | `WHATSAPP_TEMPLATE_INVALID`        | 400  |
| Token invalid (190)                  | `WHATSAPP_TOKEN_INVALID`           | 502  |
| Permission denied (200/10/403)       | `WHATSAPP_GRAPH_PERMISSION_DENIED` | 403  |
| Rate limited (429/4/80007)           | `WHATSAPP_RATE_LIMITED`            | 429  |
| Other upstream                       | `WHATSAPP_UPSTREAM_ERROR`          | 502  |

`retryable` derived via the existing `isRetryable` (rate-limited / upstream /
network).

## Testing

- **Schema** (`packages/schemas`): happy path per component; name regex;
  body-variable/sample count mismatch; footer-with-variable rejection; button
  limits (>10, >2 URL, >1 PHONE_NUMBER); URL/E.164 format. Pure-function, no
  Postgres — matches the existing `whatsapp-test-send.test.ts` style.
- **API route** (`apps/api`): inject a stub `graphApiFetch` (the route exposes
  the same `graphApiFetch` test seam as send-test). Cover 401/400/404/500
  branches, the components-array mapping, the success passthrough, and the
  `WHATSAPP_TEMPLATE_INVALID` 400 mapping. Prisma is mocked (CI has no Postgres).
- **Dashboard** (`apps/dashboard`): the dialog renders, dynamic sample inputs
  appear per `{{n}}`, submit calls the hook, success refetches the list, server
  error renders inline. Vitest + the existing settings-component test patterns.

## Build / verify gates

`pnpm --filter @switchboard/schemas test`, `--filter @switchboard/api test`,
`--filter @switchboard/dashboard test`, plus `pnpm typecheck` and
`pnpm --filter @switchboard/dashboard build` (the build is the only thing that
catches dashboard import/`.js`/CSS issues — not in CI).

## Out of scope / follow-ups

- Media (IMAGE/VIDEO/DOCUMENT) headers via resumable upload.
- Template edit/delete.
- Approval-status polling / webhook surfacing of template status changes.
- Unifying `graphPost`'s error classifier across management + send-test +
  create (the existing in-code comment already tracks this).
