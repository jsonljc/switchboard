# Buyer Experience Spec Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all factual errors, design gaps, and inconsistencies in the marketplace buyer experience design spec before implementation begins.

**Architecture:** Pure documentation fix — all changes are to `docs/superpowers/specs/2026-04-11-marketplace-buyer-experience-design.md`. No code changes.

**Tech Stack:** Markdown

---

### Task 1: Fix User Model — Use DashboardUser Instead of New User Model (Factual Error)

> **Note on autonomy tiers:** The MEMORY.md project notes list 4 autonomy tiers including "autonomous+", but the spec itself does NOT contain this error. The actual code has 3 tiers (`supervised / guided / autonomous`) and the spec correctly avoids specifying tier boundaries. No fix needed in the spec — but update MEMORY.md (see Task 7).

**Files:**

- Modify: `docs/superpowers/specs/2026-04-11-marketplace-buyer-experience-design.md`

**Context:** The spec proposes creating a brand new `User` Prisma model, but `DashboardUser` already exists at `packages/db/prisma/schema.prisma:290` with fields: `id`, `email`, `name`, `emailVerified`, `organizationId`, `principalId`, `apiKeyEncrypted`, `passwordHash`, `apiKeyHash`, `createdAt`, `updatedAt`, and a relation to `DashboardSession`.

Creating a second `User` model would cause confusion. Instead, extend `DashboardUser` with a `googleId` field for OAuth.

- [ ] **Step 1: Replace the User model Prisma block in Section 3.2A**

Replace the proposed `User` model with an extension of the existing `DashboardUser`:

```prisma
// Existing model — add googleId for OAuth
model DashboardUser {
  // ... existing fields (id, email, name, emailVerified, organizationId,
  //   principalId, apiKeyEncrypted, passwordHash, apiKeyHash, createdAt, updatedAt) ...
  googleId  String?  @unique  // NEW — for Google OAuth sign-in
  sessions  DashboardSession[]
}

// Addition to existing OrganizationConfig:
model OrganizationConfig {
  // ... existing fields ...
  users     DashboardUser[]
}
```

- [ ] **Step 2: Update the explanation text in Section 3.2A**

Replace:

- "NextAuth.js with Google OAuth. Inline with marketplace flow..." paragraph — keep the flow description but change:
  - Any reference to "User" model → "DashboardUser"
  - "Creates user + org if first time" → "Creates DashboardUser + OrganizationConfig if first time"
  - Note: `DashboardUser` already has `organizationId` — the migration adds `googleId` and makes existing password-based fields optional for OAuth users
  - Note: existing `DashboardSession` table can be reused or replaced by NextAuth's JWT strategy (stateless, no session table needed as the spec says)

- [ ] **Step 3: Update Section 3.2A bullet list**

The bullets should read:

- "First-time sign-in → auto-creates DashboardUser + OrganizationConfig"
- "Session includes `orgId` — all API calls scoped to it"
- Add: "Existing DashboardUser records with password auth continue to work; googleId is nullable"

- [ ] **Step 4: Update Section 7 (New Files Summary)**

In the Prisma migration row, change:

- `"User model, AgentDeployment.slug, DeploymentConnection.tokenHash"` → `"DashboardUser.googleId, OrganizationConfig.users relation, AgentDeployment.slug (new), DeploymentConnection.tokenHash (new)"`

- [ ] **Step 5: Update Section 8 (Sub-Project Decomposition)**

In the SP1 row, change:

- `"NextAuth, User model, public browse, inline auth gate on 'Deploy'"` → `"NextAuth, DashboardUser.googleId migration, public browse, inline auth gate on 'Deploy'"`

- [ ] **Step 6: Update NextAuth callback code sample**

The JWT callback references `user.orgId` and `user.id`. Update to reflect `DashboardUser` field names:

```typescript
callbacks: {
  async jwt({ token, user }) {
    if (user) { token.orgId = user.organizationId; token.userId = user.id; }
    return token;
  },
  async session({ session, token }) {
    session.orgId = token.orgId;
    session.userId = token.userId;
    return session;
  },
}
```

Note: the field is `organizationId` on `DashboardUser`, not `orgId`.

- [ ] **Step 7: Commit**

```bash
git commit -m "docs: use existing DashboardUser model instead of new User model in spec"
```

---

### Task 2: Add SSRF Mitigation to Website Scanner (Security Gap)

**Files:**

- Modify: `docs/superpowers/specs/2026-04-11-marketplace-buyer-experience-design.md`

**Context:** Section 3.2B (Website Scanner) accepts an arbitrary URL from the user and fetches it server-side. This is a classic SSRF vector. The spec needs URL validation before any fetch.

- [ ] **Step 1: Add a security subsection to Section 3.2B after "Error handling"**

Insert this after the existing "Error handling" bullets and before the "Cost" line:

```markdown
**Security (SSRF prevention):**

- Validate URL scheme: only `http://` and `https://` allowed (reject `file://`, `ftp://`, `data://`, etc.)
- Resolve DNS and reject private/internal IPs before connecting:
  - Block: `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `::1`, `fc00::/7`
- Reject URLs with IP addresses as hostnames (require DNS names)
- Follow redirects with the same validation (re-check resolved IP at each hop, max 3 redirects)
- Set a restrictive `User-Agent` header (e.g., `SwitchboardScanner/1.0`)
- Strip any auth credentials from the URL before fetching

**Prompt injection mitigation:**

- Scanned HTML content is sent to the LLM for extraction. Malicious sites could embed adversarial instructions in page content.
- Mitigation: the extraction prompt uses a structured output schema (Zod-validated), so free-form LLM output is rejected. The LLM is instructed to extract factual business information only.
- The scanned profile is reviewed by the buyer before use — they can correct or remove any injected content.
```

- [ ] **Step 2: Commit**

```bash
git commit -m "docs: add SSRF and prompt injection mitigations to website scanner spec"
```

---

### Task 3: Fix Rate Limiting Inconsistency (Factual Error)

**Files:**

- Modify: `docs/superpowers/specs/2026-04-11-marketplace-buyer-experience-design.md`

**Context:** Two inconsistencies:

1. **Widget rate limit:** The spec says "10 messages per minute per session/IP" in Section 3.2E (abuse protection), but the actual code in `apps/chat/src/endpoints/widget-messages.ts:34` uses `maxRequests: 20` per 60-second window. The code is already deployed and working.

2. **Scanner rate limit:** The spec says "max 3 scans per user per hour" but the scan happens during onboarding before the user account may be fully created. Need to clarify the tracking mechanism.

- [ ] **Step 1: Fix widget rate limit to match existing code**

In Section 3.2E, change:

- `"Widget message endpoint rate-limited to 10 messages per minute per session/IP"` → `"Widget message endpoint rate-limited to 20 messages per minute per IP+session (matches existing implementation in widget-messages.ts)"`

- [ ] **Step 2: Clarify scanner rate limit tracking**

In Section 3.2B "Error handling" bullets, update the rate limiting bullet:

- `"Rate limiting: max 3 scans per user per hour"` → `"Rate limiting: max 3 scans per session per hour (tracked by IP before auth, by userId after auth). Prevents abuse during the unauthenticated scan step."`

- [ ] **Step 3: Commit**

```bash
git commit -m "docs: fix rate limiting inconsistencies in buyer experience spec"
```

---

### Task 4: Fix OnboardingConfig Default Contradiction (Design Inconsistency)

**Files:**

- Modify: `docs/superpowers/specs/2026-04-11-marketplace-buyer-experience-design.md`

**Context:** The `OnboardingConfigSchema` in Section 3.2C defaults `publicChannels` to `false`. But Section 3.2C also says: "Listings without `setupSchema`: show a minimal default form (business name + description only) with `publicChannels: true` as default." These contradict — if the schema defaults to `false` but the fallback behavior defaults to `true`, which wins?

The intent is clear: listings that don't specify a `setupSchema` are assumed to be customer-facing (public channels). The Zod schema default is for when `onboarding` is partially specified. These are two different defaults at two different levels.

- [ ] **Step 1: Clarify the two-level default in Section 3.2C**

After the `OnboardingConfigSchema` code block, add this note:

```markdown
**Default behavior note:** The Zod schema defaults (`publicChannels: false`, etc.) apply when a listing HAS a `setupSchema` but omits specific `onboarding` flags. The fallback for listings WITHOUT any `setupSchema` is handled at the application level: the deploy flow treats them as customer-facing with `{ websiteScan: true, publicChannels: true, privateChannel: false, integrations: [] }`.
```

Also update the existing bullet:

- `"Listings without setupSchema: show a minimal default form..."` → `"Listings without setupSchema: apply application-level defaults (websiteScan: true, publicChannels: true), show a minimal default form (business name + description only)"`

- [ ] **Step 2: Commit**

```bash
git commit -m "docs: clarify two-level onboarding defaults in buyer experience spec"
```

---

### Task 5: Add Session Lifecycle for Task Recording (Design Gap)

**Files:**

- Modify: `docs/superpowers/specs/2026-04-11-marketplace-buyer-experience-design.md`

**Context:** Section 3.2F says tasks are created "on session timeout or explicit end" but doesn't define what the timeout is or how session boundaries work. The widget SSE manager (`widget-sse-manager.ts`) has 30-second heartbeats but no session timeout concept.

- [ ] **Step 1: Add session lifecycle details to Section 3.2F**

Replace the vague "on session timeout or explicit end" with concrete details. After the "Hook point" line, add:

```markdown
**Session lifecycle for task recording:**

- **Session identity:** Each widget conversation is identified by the `sessionId` sent by the client (generated client-side, persisted in `sessionStorage`).
- **Session timeout:** 15 minutes of inactivity (no messages sent). Tracked by the ChannelGateway per sessionId.
- **Explicit end:** Client sends a "close" event or the SSE connection drops (browser tab closed).
- **On session end:** The gateway aggregates all messages in the session into a single `AgentTask.output` transcript and creates the task record.
- **Re-engagement:** If a visitor returns with the same sessionId within the timeout window, messages append to the existing session. After timeout, a new session/task is created.
- **Minimum threshold:** Sessions with fewer than 2 assistant messages are not recorded as tasks (filters out bounces and test pings).
```

- [ ] **Step 2: Commit**

```bash
git commit -m "docs: add session lifecycle details for task recording in spec"
```

---

### Task 6: Clarify Deployment Slug vs Listing Slug (Design Gap)

**Files:**

- Modify: `docs/superpowers/specs/2026-04-11-marketplace-buyer-experience-design.md`

**Context:** `AgentListing` already has a `slug` field at `packages/db/prisma/schema.prisma:693`. The spec proposes adding a _second_ `slug` on `AgentDeployment` (Section 3.2E). This needs justification — why not reuse the listing slug?

The answer: storefront URLs are per-deployment (per-business), not per-listing. Two bakeries deploying the same "Speed-to-Lead" agent need different storefronts (`/agent/austin-bakery` vs `/agent/nyc-bakery`). The listing slug (`speed-to-lead`) identifies the agent type; the deployment slug identifies the business's instance. Both are needed.

- [ ] **Step 1: Add clarification to the slug field in Section 3.2E**

After the Prisma block showing `slug String? @unique`, add:

```markdown
**Note:** `AgentListing` already has a `slug` field (e.g., `speed-to-lead`) for the marketplace catalog URL. The `AgentDeployment.slug` is different — it identifies the buyer's specific instance (e.g., `austin-bakery`) for the storefront URL. Both are needed: listing slug → `/marketplace/speed-to-lead`, deployment slug → `/agent/austin-bakery`.
```

- [ ] **Step 2: Commit**

```bash
git commit -m "docs: clarify deployment slug vs listing slug in buyer experience spec"
```

---

### Task 7: Tighten Miscellaneous Loose Ends (Minor Nits)

**Files:**

- Modify: `docs/superpowers/specs/2026-04-11-marketplace-buyer-experience-design.md`

- [ ] **Step 1: Fix conversation engine location in Section 3.1 table**

Change the `Conversation engine` row's Location column:

- `"packages/core/src/channel-gateway/ + apps/chat/"` → `"packages/core/src/channel-gateway/ (orchestrator) + apps/chat/ (transport adapters)"`

- [ ] **Step 2: Remove honeypot claim from Section 3.2E**

The "Basic bot detection via honeypot field in the widget form" is trivially bypassed and shouldn't be presented as a security measure. Replace with:

`"Future: bot detection via behavioral signals (timing, mouse movement) if abuse becomes a problem. MVP relies on rate limiting."`

- [ ] **Step 3: Fix autonomy tiers in MEMORY.md**

The project memory at `/Users/jasonljc/.claude/projects/-Users-jasonljc-switchboard/memory/MEMORY.md` lists incorrect autonomy tiers under "Trust Score Mechanics":

- `"Autonomy: 0-29 supervised, 30-54 guided, 55-79 autonomous, 80-100 autonomous+"` → `"Autonomy: 0-29 supervised, 30-54 guided, 55+ autonomous (3 tiers)"`

This is where the phantom "autonomous+" error originated. The spec is fine; the memory is stale.

- [ ] **Step 4: Commit**

```bash
git commit -m "docs: fix minor nits in buyer experience spec + correct MEMORY.md autonomy tiers"
```

---

## Summary of All Fixes

| #   | Issue                                                    | Type          | Fix                                                                |
| --- | -------------------------------------------------------- | ------------- | ------------------------------------------------------------------ |
| 1   | New `User` model vs existing `DashboardUser`             | Factual error | Extend `DashboardUser` with `googleId`; update Sections 3.2A, 7, 8 |
| 2   | Website scanner SSRF risk                                | Security gap  | Add URL validation + IP blocking rules                             |
| 3   | Widget rate limit 10 vs 20                               | Factual error | Match existing code (20/min)                                       |
| 4   | `OnboardingConfig` default contradiction                 | Inconsistency | Clarify two-level default behavior                                 |
| 5   | Task recording session lifecycle undefined               | Design gap    | Define 15-min timeout, session boundaries                          |
| 6   | `AgentDeployment.slug` vs `AgentListing.slug`            | Design gap    | Add clarification distinguishing the two slugs                     |
| 7   | Misc nits (location, honeypot, MEMORY.md autonomy tiers) | Polish        | Tighten descriptions, fix stale memory                             |
