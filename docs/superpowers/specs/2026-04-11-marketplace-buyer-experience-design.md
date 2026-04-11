# Marketplace Buyer Experience — Design Spec

**Date:** 2026-04-11
**Status:** Draft
**Goal:** Enable a real SMB to deploy an AI agent from the marketplace and have it handle real inbound conversations end-to-end.

---

## 1. Problem Statement

Switchboard has a fully built governance spine, marketplace data layer, agent families (Sales Pipeline, Creative Director), a deploy wizard, trust scoring, and a dashboard — but no real business can actually use it yet. The missing pieces are auth, automated agent provisioning, business knowledge extraction, and live channel delivery.

The competitive gap: generic AI agents (Meta Business AI, etc.) fail because they don't deeply understand each unique business. Switchboard's advantage is depth of customization via website scanning, per-agent setup schemas, and trust-based learning from buyer feedback.

---

## 2. Buyer Journey

```
Marketplace (public, no auth)
  │  Browse agents, see trust scores, compare
  │
  │  [ Deploy This Agent ]
  ▼
Auth gate (only if not signed in)
  │  "Sign in to deploy" → Google OAuth
  │  Creates user + org if first time
  │  Redirects back to deploy flow
  ▼
Website scan
  │  "Paste your website URL"
  │  System crawls key pages (about, pricing, FAQ, services)
  │  Extracts: products, pricing, hours, location, FAQs, brand language
  │  Buyer reviews + corrects extracted info
  ▼
Agent setup (per-agent questions)
  │  Questions defined by the listing's setupSchema
  │  Speed-to-Lead: tone, booking link, special instructions
  │  Creative Director: brand voice, visual style, platforms
  │  Pre-filled from website scan where possible
  ▼
"Your agent is live!"
  │  ├── Agent storefront (shareable link) — live immediately
  │  ├── Website widget + platform-specific install instructions
  │  └── Telegram/WhatsApp — optional add-on
  ▼
Dashboard: conversations, task review, trust score
```

---

## 3. Architecture

### 3.1 What Already Exists (unchanged)

| Component           | Location                                                                                | What It Does                                                        |
| ------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| ChannelGateway      | `packages/core/src/channel-gateway/`                                                    | Routes inbound messages → deployment → LLM → reply                  |
| DeploymentLookup    | `apps/chat/src/gateway/deployment-lookup.ts`                                            | Maps channel tokens to deployments, builds persona from inputConfig |
| Widget endpoints    | `apps/chat/src/endpoints/widget-*.ts`                                                   | SSE + message POST for web widget                                   |
| RuntimeRegistry     | `apps/chat/src/managed/runtime-registry.ts`                                             | Loads gateway connections from DB on boot                           |
| Marketplace CRUD    | `apps/api/src/routes/marketplace.ts`                                                    | Listing, deployment, task, trust score routes                       |
| Deploy wizard UI    | `apps/dashboard/src/components/marketplace/`                                            | Persona form, connection step, test chat                            |
| Trust scoring       | `packages/core/src/marketplace/trust-score-engine.ts`                                   | Approval +3 (streak bonus), rejection -10, autonomy/pricing tiers   |
| Conversation engine | `packages/core/src/channel-gateway/` (orchestrator) + `apps/chat/` (transport adapters) | LLM-powered conversation with persona injection                     |

### 3.2 What's New

#### A. Auth (apps/dashboard)

NextAuth.js with Google OAuth. Extends the existing `DashboardUser` model with a `googleId` field. Inline with marketplace flow — triggered by "Deploy" button, redirects back after sign-in. Uses JWT sessions (stateless, no session table needed).

**New Prisma models:**

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

**NextAuth session callback** extends the JWT/session with `orgId` and `userId`:

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

- First-time sign-in → auto-creates DashboardUser + OrganizationConfig (org ID generated via `cuid()`)
- Session includes `orgId` — all API calls scoped to it
- No team/invite system yet (one user per org)
- No role-based access yet (user is admin)
- Marketplace browse is public (no auth required)
- Existing DashboardUser records with password auth continue to work; googleId is nullable

#### B. Website Scanner (packages/core)

New module: `packages/core/src/website-scanner/`

**Input:** URL
**Output:** Structured business profile (Zod-validated)

The `ScannedBusinessProfile` schema lives in `packages/schemas/src/marketplace.ts`:

```typescript
export const ScannedBusinessProfileSchema = z.object({
  businessName: z.string(),
  description: z.string(),
  products: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      price: z.string().optional(),
    }),
  ),
  services: z.array(z.string()),
  location: z
    .object({
      address: z.string(),
      city: z.string(),
      state: z.string(),
    })
    .optional(),
  hours: z.record(z.string()).optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  faqs: z.array(
    z.object({
      question: z.string(),
      answer: z.string(),
    }),
  ),
  brandLanguage: z.array(z.string()),
  platformDetected: z.enum(["shopify", "wordpress", "wix", "squarespace", "custom"]).optional(),
});
```

**Implementation:**

- Fetch homepage, /about, /pricing, /faq, /contact (common paths)
- Extract text content (strip HTML)
- Send to Claude with a structured extraction prompt
- Detect platform from HTML meta tags / generator tags
- Validate LLM output against `ScannedBusinessProfileSchema`
- Return structured profile for buyer review

**Error handling:**

- Per-page fetch timeout: 10 seconds
- Total scan timeout: 30 seconds
- Sites that block bots (403/captcha): skip blocked pages, scan what's available
- Empty/useless results: fall back to manual entry form with helpful prompts
- Large pages: truncate to first 8K characters per page before LLM extraction
- Rate limiting: max 3 scans per session per hour (tracked by IP before auth, by userId after auth). Prevents abuse during the unauthenticated scan step.

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

**Cost:** One LLM call per scan (~2K input tokens, ~1K output). Negligible.

#### C. Per-Agent Setup Schema

Each `AgentListing` defines its complete onboarding flow in `metadata.setupSchema`. This includes which onboarding steps to show AND agent-specific setup questions. The schema is validated via Zod:

```typescript
// In packages/schemas/src/marketplace.ts

export const OnboardingConfigSchema = z.object({
  websiteScan: z.boolean().default(true),
  publicChannels: z.boolean().default(false),
  privateChannel: z.boolean().default(false),
  integrations: z.array(z.string()).default([]),
});
```

**Default behavior note:** The Zod schema defaults (`publicChannels: false`, etc.) apply when a listing HAS a `setupSchema` but omits specific `onboarding` flags. The fallback for listings WITHOUT any `setupSchema` is handled at the application level: the deploy flow treats them as customer-facing with `{ websiteScan: true, publicChannels: true, privateChannel: false, integrations: [] }`.

```typescript
export const SetupFieldSchema = z.object({
  key: z.string(),
  type: z.enum(["text", "textarea", "select", "url", "toggle"]),
  label: z.string(),
  required: z.boolean(),
  options: z.array(z.string()).optional(),
  default: z.string().optional(),
  prefillFrom: z.string().optional(),
});

export const SetupStepSchema = z.object({
  id: z.string(),
  title: z.string(),
  fields: z.array(SetupFieldSchema),
});

export const SetupSchema = z.object({
  onboarding: OnboardingConfigSchema,
  steps: z.array(SetupStepSchema),
});
```

**`onboarding` controls which steps appear in the deploy flow:**

| Flag             | What It Enables                                                                                          | Example Agents              |
| ---------------- | -------------------------------------------------------------------------------------------------------- | --------------------------- |
| `websiteScan`    | "Paste your website URL" step — scans site for business knowledge + brand context                        | Sales, Support, Creative    |
| `publicChannels` | Creates widget + storefront — for agents that talk to the buyer's customers                              | Sales, Support              |
| `privateChannel` | Sets up a direct channel to the buyer (Telegram/WhatsApp) — for agents that talk to the buyer themselves | Personal Assistant          |
| `integrations`   | Shows integration connection step for the listed services (e.g. `["xero", "google_calendar"]`)           | Finance, Personal Assistant |

**How different agent types configure this:**

```typescript
// Speed-to-Lead (customer-facing conversational)
onboarding: { websiteScan: true, publicChannels: true, privateChannel: false, integrations: [] }

// Performance Creative Director (internal, deliverable-producing)
onboarding: { websiteScan: true, publicChannels: false, privateChannel: false, integrations: [] }

// Bookkeeper (internal, system-connected)
onboarding: { websiteScan: false, publicChannels: false, privateChannel: false, integrations: ["xero", "quickbooks", "freshbooks"] }

// Personal Assistant (buyer-facing, mixed)
onboarding: { websiteScan: true, publicChannels: false, privateChannel: true, integrations: ["google_calendar", "gmail"] }

// Customer Support (customer-facing + system-connected)
onboarding: { websiteScan: true, publicChannels: true, privateChannel: false, integrations: ["zendesk"] }
```

**The conditional onboarding flow:**

```
Auth
  ▼
[Website scan]              ← if onboarding.websiteScan
  ▼
Agent-specific setup        ← always (from setupSchema.steps)
  ▼
[Public channel creation]   ← if onboarding.publicChannels
  (widget + storefront)       (auto-created, no user input needed)
  ▼
[Private channel setup]     ← if onboarding.privateChannel
  (connect your Telegram)     (guided wizard)
  ▼
[Integration connections]   ← if onboarding.integrations.length > 0
  (connect Xero, etc.)       (OAuth flows per integration)
  ▼
"Your agent is live!"
```

- Dashboard reads `setupSchema` and renders the appropriate flow dynamically
- Fields with `prefillFrom` are auto-populated from the website scan
- Submitted values become the deployment's `inputConfig`
- Listings without `setupSchema`: apply application-level defaults (`websiteScan: true`, `publicChannels: true`), show a minimal default form (business name + description only)
- `setupSchema` is validated when listings are created/updated via the API

#### D. Onboarding Endpoint (apps/api)

New route: `POST /api/marketplace/onboard`

Single API call that orchestrates provisioning. Steps are **conditional based on the listing's `setupSchema.onboarding`**:

1. Creates `AgentDeployment` with `inputConfig` from setup form + scanned profile
2. Generates deployment slug from business name (collision handling: append `-2`, `-3`, etc.)
3. **If `publicChannels`:** Creates `DeploymentConnection` for web widget with auto-generated token + **hashed token column** for indexed lookup (see Section 3.3)
4. **If `privateChannel`:** Creates `DeploymentConnection` for the buyer's chosen messaging app + calls `provision-notify`
5. **If `integrations`:** Creates `DeploymentConnection` entries for each connected integration (OAuth tokens stored encrypted)
6. Stores scanned business profile in `inputConfig.scannedProfile` (for MVP; separate knowledge model in future)
7. Returns response shaped by agent type:
   - Customer-facing: deployment ID, storefront URL, widget embed code, install instructions
   - Internal/personal: deployment ID, dashboard link
   - Mixed: all of the above

**No `provision-notify` call needed for widgets.** Widget connections are resolved at request time by `PrismaDeploymentLookup` with a 60-second cache. For Telegram/WhatsApp connections (whether public bot or private channel to buyer), `provision-notify` IS called since these require webhook registration on the chat server.

#### E. Agent Storefront (apps/dashboard) — Customer-Facing Agents Only

New Next.js page: `/agent/[slug]` (public, no auth required)

**Only created when `setupSchema.onboarding.publicChannels` is true.** Internal and personal agents skip this entirely — they operate through the dashboard or private channels.

Serves a server-rendered micro-landing page with:

- Business name, description, services (from scanned profile in deployment's `inputConfig`)
- Location, hours, contact info
- Embedded chat widget (cross-origin to chat server's widget endpoints)
- "Powered by Switchboard" branding

**Auto-populated from website scan.** The buyer reviews during setup but the page is 90% built for them.

The storefront slug lives on `AgentDeployment` (new field):

```prisma
// Addition to AgentDeployment
slug String? @unique  // e.g. "austin-bakery", "austin-bakery-2" on collision
```

**Note:** `AgentListing` already has a `slug` field (e.g., `speed-to-lead`) for the marketplace catalog URL. The `AgentDeployment.slug` is different — it identifies the buyer's specific instance (e.g., `austin-bakery`) for the storefront URL. Both are needed: listing slug → `/marketplace/speed-to-lead`, deployment slug → `/agent/austin-bakery`.

**Abuse protection:** Widget message endpoint rate-limited to 20 messages per minute per IP+session (matches existing implementation in widget-messages.ts). Future: bot detection via behavioral signals (timing, mouse movement) if abuse becomes a problem. MVP relies on rate limiting.

#### F. Task Recording (apps/chat)

After each conversation (on session timeout or explicit end), the gateway creates an `AgentTask` entry:

- Links to deployment and listing
- Stores conversation transcript in `output`
- Category: derived from the listing's `taskCategories[0]` (default: `"general-inquiry"`)
- Status: `awaiting_review` (for supervised agents) or `completed` (for autonomous)

Hook point: `ChannelGateway.handleIncoming()` callback, after persisting the assistant message.

**Session lifecycle for task recording:**

- **Session identity:** Each widget conversation is identified by the `sessionId` sent by the client (generated client-side, persisted in `sessionStorage`).
- **Session timeout:** 15 minutes of inactivity (no messages sent). Tracked by the ChannelGateway per sessionId.
- **Explicit end:** Client sends a "close" event or the SSE connection drops (browser tab closed).
- **On session end:** The gateway aggregates all messages in the session into a single `AgentTask.output` transcript and creates the task record.
- **Re-engagement:** If a visitor returns with the same sessionId within the timeout window, messages append to the existing session. After timeout, a new session/task is created.
- **Minimum threshold:** Sessions with fewer than 2 assistant messages are not recorded as tasks (filters out bounces and test pings).

**Trust score clarification:** Trust scores are **per-listing** (global marketplace reputation), not per-deployment. When Buyer A approves a conversation with the Speed-to-Lead agent, it improves the global trust score for ALL deployments of that agent. This is by design — it's the agent's marketplace reputation, like app store ratings. The dashboard should frame it as "Agent Trust Score" not "Your Agent's Score" to set correct expectations.

#### G. "My Agent" Dashboard Page (apps/dashboard)

New page: `/my-agent` (or `/dashboard/agent/[deploymentId]`)

The page adapts to the agent type based on `setupSchema.onboarding`:

**All agents show:**

- Agent status (active/paused)
- Agent trust score (framed as marketplace reputation)
- Recent tasks/activity
- "Teach your agent" (future: knowledge chat)

**Customer-facing agents (`publicChannels: true`) additionally show:**

- Storefront link (copyable)
- Widget embed code + platform-specific install instructions
- "Add Telegram bot" button (guided setup)
- Recent conversations with the buyer's customers

**Personal agents (`privateChannel: true`) additionally show:**

- Connected channels (your Telegram, your WhatsApp)
- "Add another channel" button
- Recent conversations with you (the buyer)

**Integration-connected agents additionally show:**

- Connected systems (Xero, Google Calendar, etc.) with status
- "Reconnect" / "Add integration" buttons
- Recent deliverables or reports

### 3.3 Widget Token Lookup Optimization

**Problem:** The current `PrismaDeploymentLookup.findByChannelToken()` loads ALL active web_widget connections and decrypts each sequentially to find a match. This is O(N) and will not scale.

**Fix:** Add a `tokenHash` column to `DeploymentConnection`:

```prisma
model DeploymentConnection {
  // ... existing fields ...
  tokenHash String?  @unique  // SHA-256 hash of the token, for indexed lookup
}
```

On connection creation, compute `tokenHash = SHA-256(token)`. On lookup, compute `SHA-256(incomingToken)` and query by `tokenHash` directly. This is O(1) with an index. The encrypted `credentials` column still stores the full token for decryption when needed.

---

## 4. Channel Strategy

Channels are **agent-type-dependent**, controlled by `setupSchema.onboarding`. The same underlying infrastructure (ChannelGateway, DeploymentConnection, widget endpoints, Telegram adapter) serves all agent types — only the configuration and UX framing differ.

### Customer-Facing Agents (publicChannels: true)

**Primary: Website Widget** — where 80% of real leads come from. Platform-detected install instructions:

| Platform       | Install Method                         |
| -------------- | -------------------------------------- |
| Shopify        | App install or paste into theme.liquid |
| WordPress      | Plugin or paste into theme header      |
| Wix            | Settings → Custom Code → paste         |
| Squarespace    | Settings → Code Injection → paste      |
| Custom/Unknown | Copy-paste `<script>` tag              |

**Secondary: Agent Storefront** — the micro-landing page for link-in-bio, email signatures, Google My Business.

**Tertiary: Public Telegram/WhatsApp bot** — optional add-on for markets where messaging is primary.

### Personal/Buyer-Facing Agents (privateChannel: true)

**Primary: Direct messaging** — the agent communicates with the buyer through their preferred channel. Same Telegram/WhatsApp infrastructure, different framing:

- Customer-facing: "Create a Telegram bot for your customers"
- Personal: "Connect your Telegram so your assistant can message you"

**Secondary: In-dashboard chat** — always available as fallback, no setup needed.

### Internal Agents (neither publicChannels nor privateChannel)

**Dashboard-only** — the agent operates through the dashboard UI. The buyer submits briefs, reviews deliverables, and manages the agent entirely within the dashboard. No external channels needed.

Examples: Creative Director (submit brief → receive creative assets), Bookkeeper (connect Xero → receive reports).

### Integration Channels (integrations: [...])

Separate from chat channels. These are system connections the agent uses to do its work:

- Accounting: Xero, QuickBooks, FreshBooks (OAuth)
- Calendar/Email: Google Calendar, Gmail (OAuth)
- CRM: HubSpot, Salesforce (OAuth)
- Commerce: Shopify Admin API (OAuth)

Connected during onboarding if the listing requires them. Managed on the "My Agent" dashboard page.

---

## 5. Business Knowledge Depth (Competitive Differentiator)

### Layer 1: Website Scan (zero effort, at signup)

Extracts products, pricing, FAQs, hours, location, brand language. Injected into agent context. Auto-populates the storefront page. This is the "wow" moment — the buyer sees their agent already knows their business.

### Layer 2: Trust-Based Learning (zero effort, automatic)

When buyers review agent conversations (approve/reject), the trust score engine tracks what works. Over time:

- Approved response patterns reinforce
- Rejected patterns are avoided
- Autonomy increases as trust grows
- Pricing tier increases as autonomy grows

Note: Trust scores are per-listing (global marketplace reputation). Individual buyer feedback contributes to the agent's overall marketplace score, similar to app store ratings.

This is already built via TrustScoreEngine + AgentTask review flow.

### Layer 3: Knowledge Chat (low effort, future)

Post-launch feature. Buyer can chat with their agent in "training mode" to teach it edge cases, policies, and preferences. Stored as knowledge entries, injected into conversation context.

---

## 6. What We Don't Build Yet

- **Email/password auth** — Google OAuth only for now
- **Team/invite system** — one user per org
- **Role-based access** — user is admin
- **Billing/payments** — manual/invoice for first customers; Stripe integration is a future sub-project
- **Knowledge chat (Layer 3)** — fast follow after launch
- **WhatsApp Business API** — requires Meta business verification, complex setup; Telegram first for messaging
- **Agent analytics** — response time, conversion rate, etc.; future feature
- **Custom domains** — storefront on buyer's domain; future feature
- **Multi-deployment of same listing** — one deployment per listing per org (existing `@@unique([organizationId, listingId])` constraint); revisit if multi-location businesses need it
- **Separate knowledge model** — scanned profile stored in `inputConfig` for MVP; separate `KnowledgeEntry` table when Layer 3 (knowledge chat) is built

---

## 7. New Files Summary

| Location                                                                | What                                                                                                                        |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `packages/schemas/src/marketplace.ts`                                   | Add `ScannedBusinessProfileSchema`, `SetupSchema`, `SetupFieldSchema`                                                       |
| `packages/core/src/website-scanner/scanner.ts`                          | Website fetcher + LLM extraction                                                                                            |
| `packages/core/src/website-scanner/__tests__/scanner.test.ts`           | Scanner tests                                                                                                               |
| `packages/core/src/website-scanner/types.ts`                            | Re-export types from schemas                                                                                                |
| `packages/core/src/website-scanner/platform-detector.ts`                | Detect Shopify/WordPress/Wix from HTML                                                                                      |
| `packages/core/src/website-scanner/__tests__/platform-detector.test.ts` | Platform detector tests                                                                                                     |
| `apps/api/src/routes/onboard.ts`                                        | POST /api/marketplace/onboard                                                                                               |
| `apps/api/src/routes/__tests__/onboard.test.ts`                         | Onboard endpoint tests                                                                                                      |
| `apps/chat/src/gateway/task-recorder.ts`                                | Conversation → AgentTask recording                                                                                          |
| `apps/chat/src/gateway/__tests__/task-recorder.test.ts`                 | Task recorder tests                                                                                                         |
| `apps/dashboard/src/app/api/auth/[...nextauth]/route.ts`                | NextAuth config                                                                                                             |
| `apps/dashboard/src/app/(public)/agent/[slug]/page.tsx`                 | Agent storefront page (public)                                                                                              |
| `apps/dashboard/src/app/(public)/marketplace/page.tsx`                  | Public marketplace browse (no auth)                                                                                         |
| `apps/dashboard/src/app/(auth)/my-agent/page.tsx`                       | Buyer's agent management page                                                                                               |
| `apps/dashboard/src/components/marketplace/dynamic-setup-form.tsx`      | Renders form from setupSchema                                                                                               |
| `apps/dashboard/src/components/marketplace/website-scan-review.tsx`     | Review/edit scanned profile                                                                                                 |
| `apps/dashboard/src/components/marketplace/install-instructions.tsx`    | Platform-specific widget install guide                                                                                      |
| Prisma migration                                                        | DashboardUser.googleId, OrganizationConfig.users relation, AgentDeployment.slug (new), DeploymentConnection.tokenHash (new) |

---

## 8. Sub-Project Decomposition

This is too large for a single implementation cycle. Recommended breakdown:

| Sub-Project                          | What                                                                                                 | Depends On      |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------- | --------------- |
| **SP1: Auth + Public Marketplace**   | NextAuth, DashboardUser.googleId migration, public browse, inline auth gate on "Deploy"              | Nothing         |
| **SP2: Website Scanner**             | Core scanner module, LLM extraction, platform detection, Zod schemas                                 | Nothing         |
| **SP3: Onboarding Flow**             | Dynamic setup form, website scan review, onboard endpoint, auto-provisioning, tokenHash optimization | SP1 + SP2       |
| **SP4: Agent Storefront**            | Public storefront page in dashboard, widget embed, slug generation                                   | SP3             |
| **SP5: Task Recording + Trust Loop** | Conversation → AgentTask, trust score from real conversations, default category handling             | SP3             |
| **SP6: My Agent Dashboard**          | Buyer management page, install instructions, conversation viewer                                     | SP3 + SP4 + SP5 |

SP1 and SP2 can be built in parallel. SP3 depends on both. SP4 and SP5 can parallelize after SP3. SP6 ties it all together.
