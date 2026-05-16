# Pre-Launch Security Audit — Design

**Date:** 2026-04-29
**Status:** Design (pending implementation plan)
**Owner:** Jason
**Predecessor audits:** `.audit/08-launch-blocker-sequence.md`, `docs/audits/2026-04-14-idempotency-coverage.md`, `docs/superpowers/specs/2026-04-26-self-serve-readiness-audit-design.md`
**Successor:** `.audit/12-pre-launch-security-audit.md` (the report this design produces)

---

## Problem

Switchboard is approaching its first paying-customer cohort (~10 self-serve orgs) with a launch-blocker audit that focused on customer-journey readiness, not security posture. The launch-blocker audit explicitly sized multi-tenant isolation as "RISK at 10 orgs, BLOCKER at 50+" — i.e., a known unaudited surface. Multiple security-adjacent capabilities have shipped recently (WorkTrace cryptographic integrity, approval `bindingHash` verification at chat ingress, governance error visibility) but no end-to-end security pass has been performed.

Pre-launch is the right moment because:

- The architecture has stabilized (DOCTRINE invariants enforced, ingress-boundary tests in place).
- No real customer credentials or PII have landed in production yet.
- Pre-paying-customer is the cheapest moment to fix tenant-isolation, credential-handling, and auth-surface defects.
- A single cross-tenant data leak at 10 customers ends the company; the defensibility memo's distribution + accumulated-approval-history thesis dies the day one customer's data shows up in another's inbox.

A formal pentest, full STRIDE threat model, or compliance certification is **not** the goal. This is a focused, evidence-based audit producing a triaged findings report with launch-blocking criteria.

## Goal

Surface and triage security findings across six priority areas. Produce `.audit/12-pre-launch-security-audit.md` — a single findings report with severity ratings, file:line evidence, recommended fixes, and per-finding decisions (fix-now / fix-soon / accept-risk / defer-post-launch). HIGH/CRITICAL-severity findings block the first paying customer; report completion blocks launch.

## Non-goals

- Formal external pentest (defer to ~50+ customers or pre-SOC2).
- Full STRIDE threat-model documentation.
- Performance / DoS / load hardening (needs real traffic profiles).
- SOC2 / ISO27001 / HIPAA certification work.
- Privacy / data-handling audit (separate workstream — recommended deferred).
- Operations-readiness audit (separate workstream — recommended deferred).

## Architecture & method

### Output format

Single audit document at `.audit/12-pre-launch-security-audit.md`, mirroring the structure of `.audit/08-launch-blocker-sequence.md`:

- Section per audit area.
- Findings table per section: id, severity, evidence (file:line), recommended fix, status decision.
- Verification ledger at the end, updated as fix-now items ship.
- Triage decisions made jointly after the report drafts (option C from brainstorm).

### Severity rubric

| Severity     | Definition                                                                                                                                | Disposition                                                  |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| **CRITICAL** | Actively exploitable now with no auth required; cross-tenant data access, full takeover, or governance bypass.                            | Launch-blocking. Fix-now spec required before first customer.|
| **HIGH**     | Exploitable with low effort; data/credential exposure, privilege escalation, prompt-injection-driven side effects.                        | Launch-blocking. Fix-now spec required before first customer.|
| **MEDIUM**   | Defense-in-depth gap; requires non-trivial chain or has limited blast radius.                                                             | Fix-soon (within 30 days post-launch).                       |
| **LOW**      | Best-practice gap; theoretical or low-impact.                                                                                             | Defer-post-launch unless cheap.                              |
| **INFO**     | Hardening recommendation; no exploitable defect.                                                                                          | Track only.                                                  |

### Per-section method

Each section follows:

1. **Scope** — what is in/out of this section's surface.
2. **Method** — exact files / queries / probes used. Reproducible.
3. **Items checked** — explicit checklist with pass/finding marker per item.
4. **Findings table** — one row per finding with severity + evidence + recommended fix + status decision.
5. **Coverage gaps** — what this section did *not* cover and why.

Evidence is mandatory: every finding cites file:line plus either a concrete reproduction step, a verified attack path, or the specific test that would have caught it.

## Audit sections

### 1. Tenant Isolation *(largest section — primary risk area)*

**Why largest:** schema is 1,873 lines / 50+ Prisma models with only 18 explicit `orgId` references; most models inherit isolation through FK chains, not explicit scoping. One missed `where` clause on any query path = cross-tenant leak.

**Scope:** every persistence path that reads or writes tenant-owned data.

**Method:**

- Enumerate every Prisma model in `packages/db/prisma/schema.prisma`. For each: classify as tenant-scoped (direct `orgId` or via FK chain) or shared.
- For each tenant-scoped model: locate every `findMany` / `findFirst` / `findUnique` / `update` / `updateMany` / `delete` / `deleteMany` / raw query call across `packages/db/src/stores/`, `packages/core/src/`, `apps/api/src/`, `apps/chat/src/`, `apps/dashboard/src/`. Verify orgId scoping is present and derives from auth context, not request body.
- Verify every Store method takes/enforces orgId.
- Audit cache keys (Redis, in-memory caches, policy-cache) for orgId namespacing.
- Audit Sentry `setUser` / `setTags` and structured logs for cross-tenant data inclusion.
- Cross-tenant probe: with two orgs A, B, attempt to read/write each entity type via every API/chat/MCP route using A's session and B's entity IDs.
- Audit dashboard server actions and Next.js API routes for orgId-from-context vs orgId-from-body.

**Items checked (representative, not exhaustive):**

- [ ] Every Prisma model classified.
- [ ] Every read query for tenant-scoped models has orgId scoping.
- [ ] Every write query for tenant-scoped models has orgId scoping.
- [ ] No `updateMany`/`deleteMany` operates without orgId.
- [ ] Store methods uniformly require orgId.
- [ ] Cache keys are orgId-namespaced.
- [ ] No raw query string interpolation for tenant data.
- [ ] Cross-tenant probes for each entity type.
- [ ] Sentry/logs do not leak cross-tenant data in error responses.
- [ ] WorkTrace, Approval, ConversationState, AgentDeployment, Credential, DeploymentMemory, KnowledgeChunk, ContactLifecycle confirmed scoped end-to-end.

### 2. Auth Surface

**Scope:** every authentication and session-handling path; every webhook signature verifier.

**Method:**

- Inventory auth systems: NextAuth (`apps/dashboard`), session-token (`apps/api/src/auth/session-token.ts`), session-guard (`apps/mcp-server/src/session-guard.ts`).
- For each: verify cookie flags (Secure, HttpOnly, SameSite), JWT settings (algorithm, expiry, rotation), session invalidation on logout/password-change.
- API key lifecycle: creation, storage (hashed?), validation hot path, revocation, scoping.
- Webhook signature verification: Meta, Stripe, WhatsApp, Telegram, managed-webhook, alert-webhook. Verify timing-safe comparison, replay protection (timestamp tolerance window), raw-body availability, signing-secret storage.
- Login / signup / password-reset rate limiting and brute-force protection.
- Admin/internal route exposure: any route in `apps/api` that should not be customer-reachable.
- Cross-app auth boundaries: can an API key from one app be used against another?

**Items checked:**

- [ ] NextAuth config audited (cookies, JWT, session lifetime, callbacks).
- [ ] session-token implementation audited (signing, expiry, rotation).
- [ ] session-guard (mcp-server) audited (token verification, scope enforcement).
- [ ] API keys stored hashed, not plaintext.
- [ ] API key revocation invalidates active sessions.
- [ ] Every webhook handler verifies signature with timing-safe compare.
- [ ] Every webhook handler enforces a replay-protection window.
- [ ] Webhook raw-body capture is correct (no JSON re-stringification breaking signatures).
- [ ] Login/reset endpoints rate-limited per IP and per account.
- [ ] No internal admin routes exposed without auth.
- [ ] Password hashing uses a modern algorithm with adequate cost.

### 3. AI / Skill-Runtime Security

**Why this section exists:** Switchboard is LLM-driven. Skills receive untrusted user messages, call tools, and mutate tenant state. Prompt injection is a real attack surface that generic OWASP sweeps will not catch. Even with governance gating, a crafted message can attempt to leak system prompts, exfiltrate intra-tenant data, escalate tool privileges, or chain tool calls beyond user intent.

**Scope:** the skill runtime and tool-calling boundary in `packages/core/src/skill-runtime/`, `packages/core/src/tool-registry/`, `packages/core/src/agent-runtime/`, including every tool handler.

**Method:**

- Catalog every tool exposed to skill execution: declared schema, side-effect class, governance binding, idempotency property.
- For each tool: confirm it goes through `PlatformIngress.submit()` for any mutating action; confirm bindingHash / approval where required.
- Prompt-injection probes:
  - "Ignore previous instructions and …" patterns against every chat ingress.
  - System-prompt extraction attempts (request the system prompt, ask for reasoning context).
  - Tool-call escalation: try to get an unprivileged conversational message to trigger a higher-trust tool (e.g., approval-required action without approval).
  - Output-as-input contamination: inject content into a tool result that the LLM might re-interpret as instructions.
  - Memory poisoning: seed `DeploymentMemory` / `ConversationState` with adversarial content; verify it cannot escalate trust on subsequent turns.
- Cross-tenant skill confusion: confirm skill execution context is bound to a single deployment and cannot reach another tenant's tools/state.
- Tool input/output redaction: verify secrets and credentials never appear in LLM prompts.
- Trust-level enforcement: untrusted user input cannot raise its own trust score.

**Items checked:**

- [ ] Every tool catalogued and classified (mutating vs read-only, idempotent vs non-idempotent, approval-required vs auto).
- [ ] Every mutating tool routes through PlatformIngress.
- [ ] System prompts cannot be extracted via crafted input.
- [ ] No tool can be invoked outside the approval policy via prompt injection.
- [ ] Tool outputs are sanitized before re-entering LLM context.
- [ ] DeploymentMemory / ConversationState writes from skill execution cannot escalate trust on later turns.
- [ ] Skill execution cannot reach cross-tenant data.
- [ ] No credentials or secrets are placed in LLM prompts.

### 4. Credential Storage

**Scope:** the (concentrated) credential surface — `packages/db/src/crypto/credentials.ts`, `packages/core/src/credentials/resolver.ts`, `packages/db/src/oauth/token-refresh.ts`, plus ingress points where credentials enter.

**Method:**

- Audit encryption-at-rest: algorithm, key derivation, IV handling, key rotation strategy, key storage (env vs KMS).
- Plaintext lifetime: how long do decrypted credentials live in memory? Are they zeroed?
- Log/Sentry/error-response scrubbing: confirm no credential plaintext can leak into observability paths.
- Seed and test-fixture review: confirm no real credentials ship in build artifacts or fixtures.
- Credential write paths: verify all writes go through the encryption boundary; no direct Prisma writes to credential fields.
- OAuth token refresh: verify refresh flows preserve encryption invariants and handle concurrency safely.
- `.env` handling: verify production environment variables are not committed; verify `.env.example` is current and lacks real values.

**Items checked:**

- [ ] Encryption algorithm, key length, mode confirmed appropriate.
- [ ] Key derivation reviewed.
- [ ] Encryption key not in source control.
- [ ] All credential writes go through the encryption helper.
- [ ] All credential reads go through the decryption helper.
- [ ] Decrypted plaintexts not logged.
- [ ] Decrypted plaintexts not included in Sentry breadcrumbs.
- [ ] Error responses do not include credential plaintext or partial values.
- [ ] OAuth refresh flow maintains encryption invariants under concurrency.
- [ ] No real credentials in fixtures, seeds, or test files.

### 5. Mutation Bypass — Verification Pass

**Why verification only:** DOCTRINE §1 establishes `PlatformIngress.submit()` as the single mutation entry path; ingress-boundary test enforces this; recent shipped work covers chat bindingHash (#305), WorkTrace integrity (#308), terminal locking (#293), and governance error visibility (#290). This section confirms the existing controls are intact rather than discovering new ones.

**Scope:** every code path that writes data on behalf of a user.

**Method:**

- Confirm `apps/api/src/__tests__/ingress-boundary.test.ts` covers the current API surface.
- Grep for `prisma.*.update`, `prisma.*.create`, `prisma.*.upsert`, `prisma.*.delete`, `updateMany`, `deleteMany` in all packages and apps. For each call site outside the platform layer: verify it's either an explicitly allowed legacy path or a non-tenant-scoped operation.
- Confirm `bindingHash` verification on every approval-respond endpoint (api, chat, mcp-server). REFACTOR-PLAN P2 flagged the chat asymmetry, which #305 closed — verify no new asymmetry has appeared.
- Confirm idempotency keys cannot be replayed cross-tenant (key namespacing includes orgId).
- Confirm approval state transitions match WorkTrace lifecycle — no orphaned approvals, no premature execution, no double-execute.
- AgentDeployment governance bypass via updateMany was REFACTOR-PLAN P1 — confirm status.

**Items checked:**

- [ ] Ingress-boundary test still covers the full API surface.
- [ ] No new direct-Prisma mutating writes outside platform layer.
- [ ] Every approval-respond endpoint verifies bindingHash.
- [ ] Idempotency keys are orgId-namespaced.
- [ ] AgentDeployment governance bypass closed or tracked.
- [ ] Approval lifecycle / WorkTrace lifecycle stay aligned (no parallel persistence — REFACTOR-PLAN P1).

### 6. OWASP Lightweight Sweep

**Scope:** `apps/api`, `apps/chat`, `apps/dashboard`, `apps/mcp-server` request handling.

**Method:** one-pass review per OWASP-relevant surface. Not exhaustive; intent is to catch the "obvious miss" failure mode the four targeted sections above don't cover.

**Items checked:**

- [ ] **Input validation** — every route uses Zod or equivalent; body size limits in place.
- [ ] **SSRF** — every outbound `fetch` / HTTP client validates URLs against an allowlist or scheme/host check (the WhatsApp-test fix in #285 set the pattern; sweep the rest).
- [ ] **Injection** — Prisma is parameterized by default; identify any raw queries or `$queryRaw` use and verify safety.
- [ ] **CORS** — origin allowlist explicit; no `*` on credentialed routes.
- [ ] **CSP** — dashboard CSP reviewed (memory: dev-vs-prod branching required); other apps have appropriate headers.
- [ ] **Cookie flags** — Secure, HttpOnly, SameSite set appropriately on all auth cookies.
- [ ] **Open redirect** — redirect parameters validated against allowlist.
- [ ] **Rate limiting** — per-endpoint limits where appropriate; REFACTOR-PLAN P2 flagged that approval/execute share with reads.
- [ ] **Error leakage** — no stack traces, internal paths, or schema details in production error responses.
- [ ] **File upload paths** — content-type validation, size limits, sandbox storage (if any exist).
- [ ] **Dependency vulnerabilities** — `pnpm audit` snapshot; high/critical CVEs triaged.

## Process

1. **Audit pass** (~5 days): execute each section's method; populate findings doc with evidence.
2. **Self-review of report**: scan for missing evidence, ambiguous severity, untriaged items.
3. **Triage call**: review findings together; classify each as fix-now / fix-soon / accept-risk / defer.
4. **Fix-now items**: each spun out as its own launch-blocker spec under `docs/superpowers/specs/` matching the existing `.audit/08` pattern.
5. **Fix-soon and defer items**: tracked in the audit doc's verification ledger; not launch-blocking.
6. **Audit doc verification ledger**: updated as fix-now items ship; same shape as `.audit/08` ledger.

## Acceptance criteria

- All 6 sections completed with method, items-checked, findings table, coverage gaps.
- Every finding has severity, evidence (file:line), recommended fix, status decision.
- Triage call held; every finding has a status decision recorded.
- Either: CRITICAL/HIGH count = 0, **or** every CRITICAL/HIGH finding has a corresponding launch-blocker spec in flight before first paying customer.
- Audit doc committed at `.audit/12-pre-launch-security-audit.md`.

## Risks and tradeoffs

- **Length risk**: the tenant-isolation section may surface 10+ findings given the model count. Triage discipline (option C from brainstorm) protects against scope creep.
- **False-positive risk**: a verification-only section (Mutation Bypass) might overlook something the existing tests miss. Mitigation: the OWASP sweep section provides defense-in-depth coverage of mutation paths via input-validation review.
- **AI-section novelty risk**: prompt-injection probing is less standardized than OWASP. Severity calls require judgment. Mitigation: when in doubt, classify as HIGH and let triage downgrade.
- **Time risk**: 5 days is the audit-pass estimate. Triage and fix-now spec authoring scale with finding count and are not bounded by this estimate.

## Out of scope (explicit)

- Performance, DoS, scale hardening.
- Privacy / GDPR / data-handling audit.
- Operations / runbook / on-call audit.
- Compliance certifications.
- Formal external pentest.
- Threat-model documentation (STRIDE / attack trees).
- Reliability / data-loss audit (covered by the launch-blocker stream).

## Successor work

- Implementation plan (`docs/superpowers/plans/2026-04-29-pre-launch-security-audit-plan.md`) sequencing the six sections.
- The audit report itself (`.audit/12-pre-launch-security-audit.md`).
- Per fix-now finding: a focused launch-blocker spec.
- Post-launch: schedule re-audit at ~50 customers or before SOC2 push.
