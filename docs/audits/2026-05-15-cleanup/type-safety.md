# type-safety

**Charter:** any/as/@ts-ignore audit + types-belong-in-schemas check.
**Method:** Fresh counts via rg across `apps/` and `packages/` (regex: `@ts-ignore`, `@ts-expect-error`, ` as any`, ` as unknown`, `: any`) + examination of non-test production files for security-critical casts.
**Scope exclusions applied:**

- Pre-existing `any` in API routes + `auth.ts` per CLAUDE.md exemptions (memory noted)
- Test files for `as unknown` count (test scaffolding, low risk)

## Headline counts (measured fresh)

- `@ts-ignore` / `@ts-expect-error`: **7 total**
  - 3 in test files (proposed-disqualifications-panel.test.tsx)
  - 1 in whitebox test (prisma-work-trace-store.test.ts)
  - 1 in schema validation test (pipeline-board.test.ts) — intentional export lock
  - 1 in route (waitlist/route.ts)
  - 1 in schema test comment
- `as any` / `as unknown`: **~270+ across codebase**
  - 618+ `as unknown` (mostly test mocks — LOW priority)
  - **~40+ `as any` in production files** (needs investigation)
- `: any` declarations: **40+ instances**
  - Mostly error parameters, callback signatures, Graph API payloads
  - **2 critical in route handlers** (principal + orgId extraction)

## Findings

### [CRITICAL] Security-critical `as any` casts on auth values

- **Where:** `apps/api/src/bootstrap/routes.ts:215, 227`
- **Evidence:**
  ```typescript
  const principal = (req as any).principalIdFromAuth as string | undefined;
  const orgId = (req as any).organizationIdFromAuth as string | undefined;
  ```
- **Why it matters:** These are the primary authentication extraction points. A single typo in the middleware property name (`principalIdFromAuth` vs `principalFromAuth`) would silently return `undefined` instead of failing loudly. An attacker who can influence the `req` object shape could inject a fake principal.
- **Fix:** Define a proper FastifyRequest extension interface; TypeScript will enforce the property name at compile time:
  ```typescript
  declare module "fastify" {
    interface FastifyRequest {
      principalIdFromAuth?: string;
      organizationIdFromAuth?: string;
    }
  }
  ```
- **Effort:** S
- **Risk if untouched:** Authorization bypass if middleware property name drifts or is mistyped in future refactors.
- **Collides with active work?:** No

### [HIGH] Verdict store invocations via `as any` function cast

- **Where:** `packages/core/src/channel-gateway/consent-revocation-gate.ts:36, 78`; `packages/core/src/consent/consent-service.ts` (similar pattern); `packages/core/src/skill-runtime/hooks/claim-classifier.ts` (×3 calls)
- **Evidence:**
  ```typescript
  await (cfg.verdictStore.save as any)({
    deploymentId, sourceGuard, action, ...
  });
  ```
- **Why it matters:** Casting verdictStore.save to `any` bypasses type checking on the payload. If a required field like `jurisdictionCode` is misspelled or omitted, the type checker won't catch it — only the runtime will fail, potentially dropping governance verdicts silently.
- **Fix:** Define the exact payload type and pass without the cast. If the store signature is too strict, expand it.
- **Effort:** M
- **Risk if untouched:** Governance verdicts silently fail to persist if payload structure drifts.
- **Collides with active work?:** No

### [HIGH] Untyped Graph API response fields in WhatsApp management

- **Where:** `apps/api/src/routes/whatsapp-management.ts:368, 373, 379`
- **Evidence:**
  ```typescript
  const primaryPhone = phoneNumbers.find((p: any) => p.id === primaryPhoneNumberId);
  const phoneStatus = (primaryPhone as any).status;
  const quality = (primaryPhone as any).quality_rating;
  ```
- **Why it matters:** Fields extracted from external Graph API responses without type safety. A field rename or removal by Meta will not be caught until production.
- **Fix:** Define typed `GraphAPIPhoneNumber` interface based on Meta's documented schema and cast the raw response once at parse time.
- **Effort:** M
- **Risk if untouched:** Silent failures if Meta's API contract changes.
- **Collides with active work?:** No

### [HIGH] Missing null guard on `agentContext` in re-engagement reader

- **Where:** `packages/db/src/prisma-re-engagement-verdict-reader.ts:19, 37`
- **Evidence:**
  ```typescript
  const ctx = thread.agentContext as any;
  const conversationId: string =
    typeof ctx?.sessionId === "string" && ctx.sessionId.length > 0 ? ctx.sessionId : threadId;
  ```
- **Why it matters:** Casts are necessary because the Prisma schema for these fields is untyped JSON. Optional chaining suggests the reader acknowledges `ctx` can be malformed, but cast to `any` hides this from static analysis.
- **Fix:** Define a formal shape (Zod schema) and parse: `const ctx = AgentContextSchema.parse(thread.agentContext);`
- **Effort:** M
- **Risk if untouched:** Crashes if malformed JSON is stored; no validation prevents garbage in the DB.
- **Collides with active work?:** No

### [MED] Untyped Prisma transaction client casts

- **Where:** `packages/db/src/prisma-conversation-lifecycle-snapshot-store.ts:40, 60` (and similar in `prisma-conversation-lifecycle-transition-store.ts:176`)
- **Evidence:** `const txClient = tx as any;`
- **Why it matters:** Within a transaction context, the client type changes but TypeScript cannot infer it statically. The cast to `any` is a workaround for Prisma's transaction typing limitations.
- **Fix:** Prisma 5.x+ supports proper transaction type inference; check if upgrading Prisma solves this. Otherwise explicitly type the transaction parameter using `Prisma.TransactionClient` and conditional types to narrow.
- **Effort:** L (low priority, known library limitation)
- **Risk if untouched:** Methods can be called incorrectly on a transaction client; type checking is weak but runtime usually succeeds.
- **Collides with active work?:** No

### [MED] Schema stub in operator-config route

- **Where:** `apps/api/src/routes/operator-config.ts:25-32`
- **Evidence:**
  ```typescript
  const AdsOperatorConfigSchema = {
    omit: () => ({ ... }),
  } as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  ```
- **Why it matters:** Documented stub for a future feature (see line 8 TODO). Once the real schema is imported, this stub must be removed; otherwise code paths will silently use the stub.
- **Fix:** Create a ticket or convert to `@ts-expect-error` with deadline comment.
- **Effort:** S
- **Risk if untouched:** Dead stub code can mask real issues if the feature is half-implemented.
- **Collides with active work?:** No

### [MED] Unexamined route handler `: any` casts

- **Where:** `apps/api/src/routes/scheduled-reports.ts` and `apps/api/src/routes/whatsapp-management.ts` (multiple `: any` declarations in callbacks)
- **Evidence:** `} catch (err: any) { ... }`; `const templateData = templateResult.data as { data?: any[] };`; `const templates = (templateData.data ?? []).map((t: any) => { ... });`
- **Why it matters:** Error handlers and loop variable typing bypass strict inference. The error parameter is often safe, but inline `any` in map callbacks hides external API response shapes.
- **Fix:** Import or define the API response schema and use it.
- **Effort:** M
- **Risk if untouched:** Silent failures if Meta API response shape changes.
- **Collides with active work?:** No

### [LOW] Test-scoped `as unknown` mocks (~618 instances)

- **Where:** Distributed across `__tests__/`, `.test.ts`, `.test.tsx` files
- **Evidence:** `const store = createPrismaStore(prisma as unknown);`, etc.
- **Why it matters:** Test scaffolding for mocking dependencies. `as unknown` is safe because it's immediately narrowed in test context.
- **Fix:** None required. Intentional test patterns.
- **Collides with active work?:** No

### [LOW] Justified `@ts-expect-error` in schema tests

- **Where:** `packages/schemas/src/pipeline-board.test.ts:6` (intentional export lock)
- **Evidence:** Compile-time lock to ensure a private schema is not accidentally exported.
- **Why it matters:** Defensive architecture; documented.
- **Fix:** Keep as-is.
- **Collides with active work?:** No

## Out of scope / deferred for this lane

- **`apps/api` pre-existing `any` exemption** per CLAUDE.md memory: documented exceptions for error handling and third-party API wrappers. Not reflagged unless they represent new security leaks.
- **`as unknown` in tests (618 instances):** test infrastructure; no production impact.
- **`:any` error parameters in Fastify handlers:** idiomatic; low risk.
- **Types-belong-in-schemas check deferred:** secondary pass needed to enumerate client-side UI types in `apps/dashboard` that should move to `packages/schemas` (e.g., `ApprovalRow`, `DecisionKind`). Cross-domain impact analysis required — MED priority for follow-up audit lane.
