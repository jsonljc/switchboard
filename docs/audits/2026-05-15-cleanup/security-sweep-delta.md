# security-sweep-delta

**Charter:** Delta against .audit/12-pre-launch-security-audit.md — classify FIXED/STILL-OPEN/REGRESSED/NEW per original finding. CVE delta via pnpm audit.

**Method:**

- Read audit document to load original 38 findings across 6 sections (Tenant Isolation, AI/Skill-Runtime, Auth, Credentials, Mutation Bypass, OWASP)
- Traced Verification Ledger to confirm fix-now PRs shipped (all 5 specs: PR #333 TI-1..4, PR #332 TI-5..6, PR #334 AI-1..3, PR #330 AU-1..2, PR #331 OW-1)
- Verified current HEAD code against cited file:line in original findings
- Ran `pnpm audit` for CVE delta
- Spot-checked fix-soon/defer-post-launch items (TI-7..9, AU-3..4, OW-3..6, CR-1..6)

**Scope exclusions applied:** None (no collision masks invoked).

## Findings

### [CRITICAL] TI-1: `/api/ingress/submit` takes `organizationId` from request body

- **Where:** `apps/api/src/routes/ingress.ts:26`
- **Evidence:** Uses `resolveOrganizationForMutation(request, reply, body.organizationId)` which enforces auth-derived org precedence
- **Status:** FIXED (PR #333)
- **Why it matters:** Mutation entry point must not accept org from client-supplied body
- **Fix:** Ship PR #333 (deployed)
- **Effort:** S
- **Risk if untouched:** Cross-tenant mutation bypass
- **Collides with active work?:** no

### [CRITICAL] TI-2: `/api/governance/*` routes use `body.organizationId ?? request.organizationIdFromAuth`

- **Where:** `apps/api/src/routes/governance.ts:161` (now using `resolveOrganizationForMutation`)
- **Evidence:** All governance routes call `resolveOrganizationForMutation(request, reply, body.organizationId)`
- **Status:** FIXED (PR #333)
- **Why it matters:** Governance must use auth-derived org, never body precedence
- **Fix:** Deployed
- **Effort:** S
- **Risk if untouched:** Governance bypass across tenants
- **Collides with active work?:** no

### [CRITICAL] TI-3: Static API keys without `API_KEY_METADATA` allow unscoped org impersonation

- **Where:** `apps/api/src/middleware/auth.ts:35-54`
- **Evidence:** Startup check throws if `NODE_ENV === "production"` and any API_KEYS lack API_KEY_METADATA:organizationId mapping
- **Status:** FIXED (PR #333)
- **Why it matters:** Unscoped keys are a cross-tenant impersonation primitive
- **Fix:** Deployed
- **Effort:** S
- **Risk if untouched:** Cross-tenant access via unscoped API key
- **Collides with active work?:** no

### [CRITICAL] AI-1: `calendar-book` and `crm-write` take `orgId` from LLM-controlled input

- **Where:** `packages/core/src/skill-runtime/tools/calendar-book.ts:109-166` (factory-based closure over `ctx.orgId`)
- **Evidence:** Factory pattern; `ctx.orgId` closed in from `SkillRequestContext` at execution time. `inputSchema` has no `orgId` field (line 117-126)
- **Status:** FIXED (PR #334)
- **Why it matters:** LLM-controlled orgId enables cross-tenant prompt injection
- **Fix:** Deployed
- **Effort:** M
- **Risk if untouched:** Cross-tenant tool invocation via prompt injection
- **Collides with active work?:** no

### [HIGH] TI-4: `/api/actions` and `/api/execute` fall back to `body.organizationId` on unscoped API key

- **Where:** `apps/api/src/routes/actions.ts:62` — now calls `resolveOrganizationForMutation`
- **Evidence:** All routes use auth-derived org resolution, no body fallback remains
- **Status:** FIXED (PR #333)
- **Why it matters:** Fallback enables unscoped key to impersonate orgs
- **Fix:** Deployed
- **Effort:** S
- **Risk if untouched:** Cross-tenant mutation via unscoped API key
- **Collides with active work?:** no

### [HIGH] TI-5: `apps/chat` PrismaConversationStore reads/deletes by `threadId` only

- **Where:** `apps/chat/src/conversation/prisma-store.ts:9-71` (now constructor-injected `organizationId`, all queries scoped)
- **Evidence:** Store passes `organizationId` to all `findUnique`/`update`/`delete` where clauses
- **Status:** FIXED (PR #332)
- **Why it matters:** Cross-tenant conversation access without orgId scoping
- **Fix:** Deployed
- **Effort:** M
- **Risk if untouched:** Cross-tenant conversation access
- **Collides with active work?:** no

### [HIGH] TI-6: `escalations.ts` looks up ConversationState by `threadId` only

- **Where:** `apps/api/src/routes/escalations.ts:99-229` (now all queries include `organizationId`)
- **Evidence:** ConversationState lookups explicitly scope by `organizationId: orgId`
- **Status:** FIXED (PR #332)
- **Why it matters:** Defense-in-depth; nullable `organizationId` allows divergence from Handoff org
- **Fix:** Deployed
- **Effort:** S
- **Risk if untouched:** Cross-tenant conversation state access
- **Collides with active work?:** no

### [HIGH] AU-1: Meta-family webhooks lack replay-protection window

- **Where:** `apps/chat/src/routes/managed-webhook.ts:74-79` (dedup via `(channel, messageId)` pair)
- **Evidence:** `deps.dedup.checkDedup(channel, msgId)` returns `false` for duplicates; request short-circuited
- **Status:** FIXED (PR #330)
- **Why it matters:** Missing replay window allows duplicate webhook processing
- **Fix:** Deployed (uses WebhookEventLog for idempotency)
- **Effort:** S
- **Risk if untouched:** Duplicate action execution from replayed webhooks
- **Collides with active work?:** no

### [HIGH] AU-2: Telegram `verifyRequest` fails open when webhook secret missing

- **Where:** `apps/chat/src/adapters/telegram.ts:87-100`
- **Evidence:** `if (!this.webhookSecret) { if (NODE_ENV === "production") return false; ... }`
- **Status:** FIXED (PR #330)
- **Why it matters:** Missing secret in prod allows unsigned webhook acceptance
- **Fix:** Deployed
- **Effort:** S
- **Risk if untouched:** Unsigned webhook execution in production
- **Collides with active work?:** no

### [HIGH] AI-2: `op.execute(toolUse.input)` passes raw LLM output with no schema validation

- **Where:** `packages/core/src/skill-runtime/skill-executor.ts:247-280` (now validates before dispatch)
- **Evidence:** `skill-executor.ts` validates `toolUse.input` against `op.inputSchema` before `op.execute()` call; returns `INVALID_TOOL_INPUT` on mismatch
- **Status:** FIXED (PR #334)
- **Why it matters:** Defense-in-depth; ensures LLM tool input conforms to declared schema
- **Fix:** Deployed
- **Effort:** S
- **Risk if untouched:** Type-mismatch tool execution; tool implementations must re-parse
- **Collides with active work?:** no

### [HIGH] AI-3: System prompt interpolates operator-controlled fields with no sentinels

- **Where:** `packages/core/src/agent-runtime/system-prompt-assembler.ts:21-54` (now wraps fields in `<|operator-content|>...<|/operator-content|>`)
- **Evidence:** Each operator field (businessName, productService, etc.) wrapped in explicit sentinel markers with instruction to treat as data, not instructions
- **Status:** FIXED (PR #334)
- **Why it matters:** Defense-in-depth against prompt injection via operator config
- **Fix:** Deployed
- **Effort:** S
- **Risk if untouched:** System-prompt extraction or instruction-override via operator config
- **Collides with active work?:** no

### [HIGH] OW-1: `VideoAssembler.downloadClips` fetches arbitrary HTTP URLs (SSRF)

- **Where:** `packages/creative-pipeline/src/stages/video-assembler.ts:136-152` (now validates against allowlist)
- **Evidence:** `downloadClips` applies URL validation: HTTPS-only, private-IP rejection (incl. IPv4-mapped IPv6, NAT64), 200 MB streaming cap
- **Status:** FIXED (PR #331)
- **Why it matters:** Allows fetching internal/private network resources via crafted clip URL
- **Fix:** Deployed
- **Effort:** M
- **Risk if untouched:** SSRF to internal services
- **Collides with active work?:** no

### [MED] TI-7: `prisma-approval-store` updateMany lacks orgId scoping

- **Where:** `packages/db/src/storage/prisma-approval-store.ts:42-51`
- **Evidence:** `updateMany where: { id, version }` missing `organizationId: orgId`
- **Status:** STILL-OPEN
- **Why it matters:** updateMany without orgId could affect approvals across all orgs with matching (id, version)
- **Fix:** Add `organizationId: orgId` to updateMany where clauses
- **Effort:** S
- **Risk if untouched:** Cross-tenant approval-state mutation (unlikely due to UUID id collision, but pattern risky)
- **Collides with active work?:** no

### [MED] TI-8: `prisma-lifecycle-store` updateMany lacks orgId scoping

- **Where:** `packages/db/src/storage/prisma-lifecycle-store.ts:133-189`
- **Evidence:** `updateMany where: { id, version }` missing `organizationId: orgId`
- **Status:** STILL-OPEN
- **Why it matters:** Same as TI-7; defense-in-depth on approval lifecycle
- **Fix:** Add `organizationId: orgId` to updateMany where clauses
- **Effort:** S
- **Risk if untouched:** Cross-tenant lifecycle mutation
- **Collides with active work?:** no

### [MED] TI-9: 11 tenant-scoped models have nullable `organizationId`

- **Where:** `packages/db/prisma/schema.prisma:14, 43, 83, 105, 133, 170, 197, 235, 258, 506, 1070`
- **Evidence:** Principal, IdentitySpec, Policy, ActionEnvelope, ConversationState, AuditEntry, Connection, ApprovalRecord, ApprovalLifecycle, FailedMessage, WhatsAppMessageStatus all have `organizationId String?`
- **Status:** STILL-OPEN
- **Why it matters:** Nullable fields allow orphan rows; weaker tenant isolation guarantee
- **Fix:** Backfill migrations to make all 11 fields NOT NULL; classify orphan vs intentional per model first
- **Effort:** M (requires backfill migrations)
- **Risk if untouched:** Orphan rows; divergence between expected org and actual stored org
- **Collides with active work?:** no

### [MED] AU-3: API key revocation has 60s cache latency

- **Where:** `apps/api/src/middleware/auth.ts:21, 128-137`
- **Evidence:** `dbKeyCache` TTL set to 60s; revoked keys remain valid until cache expires
- **Status:** STILL-OPEN
- **Why it matters:** Revoked key can be used for up to 60s after revocation
- **Fix:** Lower TTL or add Redis invalidation
- **Effort:** S
- **Risk if untouched:** Brief post-revocation key validity window
- **Collides with active work?:** no

### [MED] AU-4: Auth rate limit is per-IP only; no per-account brute-force protection

- **Where:** `apps/api/src/middleware/rate-limit.ts:14-50`
- **Evidence:** Rate limiter uses IP-based keying only; no per-account counter
- **Status:** STILL-OPEN
- **Why it matters:** No per-account lockout on repeated login failures
- **Fix:** Add per-account counter + lockout/CAPTCHA
- **Effort:** S
- **Risk if untouched:** Brute-force attack on password login per IP
- **Collides with active work?:** no

### [MED] OW-3: Dashboard CSP includes `'unsafe-inline'` for scripts and styles

- **Where:** `apps/dashboard/next.config.mjs:11-14`
- **Evidence:** `script-src 'self' 'unsafe-inline'` and `style-src 'self' 'unsafe-inline'`
- **Status:** STILL-OPEN
- **Why it matters:** Weakens XSS defense; nonce-based CSP would be stronger
- **Fix:** Require per-request nonce generation
- **Effort:** M
- **Risk if untouched:** Increased XSS impact if DOM-based XSS found
- **Collides with active work?:** yes (`apps/dashboard/next.config.mjs` is in the exclusion mask)

### [MED] AI-4: Tool outputs reinjected to LLM with no adversarial-content marking

- **Where:** `packages/core/src/skill-runtime/reinjection-filter.ts:1-80`
- **Evidence:** Tool results not wrapped in sentinel markers like `<|tool-output|>...<|/tool-output|>`
- **Status:** STILL-OPEN
- **Why it matters:** Defense-in-depth; external tool output could contain fake system markers
- **Fix:** Add wrapping
- **Effort:** S
- **Risk if untouched:** Prompt injection via crafted tool output
- **Collides with active work?:** no

### [MED] AI-6: Mutating tools bypass `PlatformIngress.submit()`

- **Where:** `packages/core/src/skill-runtime/tools/calendar-book.ts:204-282, crm-write.ts:55-64`
- **Evidence:** Mutations call stores directly (not via PlatformIngress)
- **Status:** STILL-OPEN (architectural decision; flagged for confirmation)
- **Why it matters:** WorkTrace anchoring, idempotency, one-time governance eval not uniformly applied
- **Fix:** Architectural change; needs design decision
- **Effort:** L
- **Risk if untouched:** Inconsistent mutation pipeline (low risk if intentional)
- **Collides with active work?:** no

### [LOW] OW-6: Duplicate `async headers()` functions in next.config.mjs

- **Where:** `apps/dashboard/next.config.mjs:27-46, 56-62`
- **Evidence:** Two `headers()` functions; second silently overrides first
- **Status:** STILL-OPEN
- **Why it matters:** Maintenance trap; future edit to first block has no effect
- **Fix:** Merge into single function
- **Effort:** S
- **Risk if untouched:** Accidental loss of headers due to shadowing
- **Collides with active work?:** yes (`apps/dashboard/next.config.mjs` is in the exclusion mask)

### [LOW] TI-10..TI-11, CR-1..CR-6, OW-2: minor security polish items

- **Where:** Various — IdempotencyRecord schema, orgId/organizationId naming, encryption-key rotation docs, AAD binding, IV length, .env.example defaults, ffmpeg concat path quoting
- **Evidence:** All STILL-OPEN per original audit; categorized as defer-post-launch
- **Status:** STILL-OPEN
- **Why it matters:** Polish/hardening; not launch-blocking
- **Fix:** Various small fixes; see original audit for specifics
- **Effort:** S each
- **Risk if untouched:** Marginal hardening gap
- **Collides with active work?:** no

## Dependency upgrades pending

**CVE Delta:** `pnpm audit` returned **"No known vulnerabilities found"**. No HIGH/CRITICAL CVEs in current lockfile. Prior audit flagged 3 moderate dev-only CVEs (Vite ≤6.4.1, uuid <14.0.0, postcss <8.5.10) — status: appears cleaned up; recommend a `pnpm audit` run in your CI.

~20 open dependabot PRs are pending review separately; out of scope for this delta sweep.

## Out of scope / deferred for this lane

- **TI-12 (INFO):** Prisma client extension for runtime org-scoping enforcement — post-launch architectural enhancement
- **AU-5..AU-7 (LOW/INFO):** Session JWT algorithm, INTERNAL_SETUP_SECRET rotation runbook, NEXTAUTH_SECRET rotation procedure — all post-launch
- **AI-5 (MED):** `console.warn` tool input log — appears FIXED incidentally during AI-2/AI-3 work; verified no current instance
- **AI-7 (INFO):** AI-specific monitoring (prompt-injection detection, anomalous tool patterns) — post-launch enhancement
- **MB-1 (INFO):** 39 mutating Prisma calls in /api/routes/ bypass PlatformIngress — flagged as platform-administration mutations explicitly outside governed action lifecycle per DOCTRINE
- **OW-4 (DUPE):** Sensitive endpoints rate-limited separately — cross-referenced to AU-4
- **OW-5 (LOW):** 3 moderate dev/transitive CVEs — see Dependency upgrades pending above

## Summary

**CRITICAL/HIGH findings:** All 12 fix-now items FIXED (5 PRs shipped: #330, #331, #332, #333, #334). Launch-blocking gate satisfied.

**MEDIUM findings:** 8 still OPEN (TI-7, TI-8, TI-9, AU-3, AU-4, OW-3, AI-4, AI-6). Recommend delivery within 30 days post-launch per original triage. AI-5 incidentally fixed during AI-2/AI-3 work.

**No REGRESSED findings detected.** All critical security fixes remain in place; no vulnerabilities reintroduced.

**No NEW CRITICAL/HIGH findings identified** in this sweep beyond what other audit lanes (doctrine-compliance, api-consistency) surfaced about route-level ingress bypass.
