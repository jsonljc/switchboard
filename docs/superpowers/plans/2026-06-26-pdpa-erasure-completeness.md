# PDPA erasure completeness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:test-driven-development per task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A right-to-erasure request leaves no contact PII behind and reports its true outcome.

**Architecture:** Three independent changes, one surfaced PR, three commits. (A) complete + phone-shape-robust cascade in `packages/db`; (B) match Meta deletion by canonical `phoneE164` in `apps/api`; (C) honest `partial`/`failed` erasure outcome in `apps/api`.

**Tech Stack:** TypeScript ESM, Prisma (mocked in tests), Fastify, Vitest.

## Global Constraints

- ESM only, `.js` extensions in relative imports. No `any`, no `console.log`. Prettier: semi, double quotes, 2-space, trailing commas, 100 width. No em-dashes in code/comments/commits.
- **No schema migration** (every delete uses existing columns; `"partial"` is a new value of the existing free-`String` `DataDeletionRequest.status`). Postgres-down-safe; all tests mock Prisma.
- Per-touched-package typecheck before each commit: `pnpm --filter <pkg> exec tsc --noEmit`. Lowercase conventional-commit subject. Co-located tests.
- Store mutations: org-scoped `where` (`organizationId`) satisfies the route-governance gate without the `store-mutation-global` annotation; new contactId deletes follow the `workTrace` precedent (org-scoped, no annotation).
- Compliance surface → SURFACE the PR; do NOT self-merge; gate on real `gh pr checks`.

---

## Task 1 (commit 1, `packages/db`) — complete + shape-robust erasure cascade

**Files:**
- Modify: `packages/db/src/stores/prisma-contact-store.ts` (`delete()` ~168-257; add `buildPhoneMatchCandidates` near `digitsOnly` ~480)
- Test: `packages/db/src/stores/__tests__/prisma-contact-store-erasure.test.ts`
- Test (mock update only): `apps/api/src/__tests__/api-meta-deletion.test.ts` (real `PrismaContactStore` → its `MockPrisma` must carry the newly-deleted tables)

**Interfaces:**
- Produces: `buildPhoneMatchCandidates(phone, phoneE164) => string[]` (exported); `delete()` signature unchanged (`Promise<void>`).

- [ ] **Step 1: failing tests** — in `prisma-contact-store-erasure.test.ts`, extend `mockPrismaWithCascade` with `conversationLifecycleSnapshot`, `conversationLifecycleTransition`, `scheduledFollowUp`, `scheduledReminder`, `robinRecoverySend`, `whatsAppTestSend` (each `{ deleteMany: vi.fn().mockResolvedValue({ count: 0 }) }`). Add:

```ts
it("purges all contactId-keyed lifecycle/follow-up/recovery tables, org-scoped", async () => {
  const px = mockPrismaWithCascade();
  await new PrismaContactStore(px as never).delete("org-1", "contact-1");
  for (const t of [
    px.conversationLifecycleSnapshot, px.conversationLifecycleTransition,
    px.scheduledFollowUp, px.scheduledReminder, px.robinRecoverySend,
  ]) {
    expect(t.deleteMany).toHaveBeenCalledWith({
      where: { contactId: "contact-1", organizationId: "org-1" },
    });
  }
});

it("matches phone-keyed children across +E.164 and digits-only shapes (recipientId/principalId/toNumber)", async () => {
  const px = mockPrismaWithCascade();
  px.contact.findFirst.mockResolvedValue(makeContact({ phone: "+6591234567", phoneE164: "+6591234567" }));
  await new PrismaContactStore(px as never).delete("org-1", "contact-1");
  const expectIn = (fn: { mock: { calls: unknown[][] } }, field: string) => {
    const arg = fn.mock.calls[0]![0] as { where: Record<string, { in: string[] }> };
    expect(arg.where[field]!.in.sort()).toEqual(["+6591234567", "6591234567"]);
    expect((arg.where as { organizationId: string }).organizationId).toBe("org-1");
  };
  expectIn(px.whatsAppMessageStatus.deleteMany, "recipientId");
  expectIn(px.conversationState.deleteMany, "principalId");
  expectIn(px.whatsAppTestSend.deleteMany, "toNumber");
});

it("purges phone-keyed rows for a phoneE164-only contact (raw phone null)", async () => {
  const px = mockPrismaWithCascade();
  px.contact.findFirst.mockResolvedValue(makeContact({ phone: null, phoneE164: "+6591234567" }));
  px.failedMessage.findMany.mockResolvedValue([{ id: "fm", rawPayload: { from: "6591234567" } }]);
  await new PrismaContactStore(px as never).delete("org-1", "contact-1");
  expect(px.whatsAppMessageStatus.deleteMany).toHaveBeenCalled();
  expect(px.failedMessage.deleteMany).toHaveBeenCalledWith({
    where: { id: { in: ["fm"] }, organizationId: "org-1" },
  });
});
```

Also add `buildPhoneMatchCandidates` unit assertions:
```ts
import { PrismaContactStore, payloadMentionsPhone, buildPhoneMatchCandidates } from "../prisma-contact-store.js";
describe("buildPhoneMatchCandidates", () => {
  it("yields raw + digits forms, deduped", () => {
    expect(buildPhoneMatchCandidates("+6591234567", "+6591234567").sort()).toEqual(["+6591234567", "6591234567"]);
  });
  it("includes a digits-only contact phone as-is", () => {
    expect(buildPhoneMatchCandidates("6591234567", null)).toContain("6591234567");
  });
  it("drops junk-short digit forms but keeps the raw value", () => {
    expect(buildPhoneMatchCandidates("123", null)).toEqual(["123"]);
  });
  it("returns [] for no phone", () => {
    expect(buildPhoneMatchCandidates(null, null)).toEqual([]);
  });
});
```

- [ ] **Step 2: run, verify red** — `pnpm --filter @switchboard/db test -- prisma-contact-store-erasure` → new tests fail (`buildPhoneMatchCandidates` undefined; new deleteMany not called).

- [ ] **Step 3: implement** in `prisma-contact-store.ts`. In `delete()` read both phones:
```ts
const phone = existing.phone;
const phoneE164 = existing.phoneE164;
```
Add the 5 contactId deletes after the existing `workTrace.deleteMany` (org-scoped, mirroring it):
```ts
// PDPA erasure completeness (2026-06-26): contactId-keyed tables the original F5
// cascade omitted. Org-scoped like workTrace (every table carries organizationId).
await tx.conversationLifecycleSnapshot.deleteMany({ where: { contactId: id, organizationId: orgId } });
await tx.conversationLifecycleTransition.deleteMany({ where: { contactId: id, organizationId: orgId } });
await tx.scheduledFollowUp.deleteMany({ where: { contactId: id, organizationId: orgId } });
await tx.scheduledReminder.deleteMany({ where: { contactId: id, organizationId: orgId } });
await tx.robinRecoverySend.deleteMany({ where: { contactId: id, organizationId: orgId } });
```
Replace the phone-keyed branch:
```ts
// phone-keyed children. Identity is canonical on phoneE164, but channel tables
// store whatever shape the channel delivered: WhatsApp recipient_id/wa_id is
// digits-only (no +) while principalId/toNumber may carry +E.164. Match every
// stored shape (exact `in`, org-scoped) so none escape.
const phoneCandidates = buildPhoneMatchCandidates(phone, phoneE164);
if (phoneCandidates.length > 0) {
  await tx.whatsAppMessageStatus.deleteMany({
    where: { recipientId: { in: phoneCandidates }, organizationId: orgId },
  });
  await tx.conversationState.deleteMany({
    where: { principalId: { in: phoneCandidates }, organizationId: orgId },
  });
  await tx.whatsAppTestSend.deleteMany({
    where: { toNumber: { in: phoneCandidates }, organizationId: orgId },
  });

  // DLQ: phone lives inside rawPayload; payloadMentionsPhone digit-normalizes both
  // sides, so any candidate's digits suffice. Use whichever phone shape exists.
  const scanPhone = phone ?? phoneE164;
  if (scanPhone) {
    const dlqCandidates = await tx.failedMessage.findMany({
      where: { organizationId: orgId },
      select: { id: true, rawPayload: true },
    });
    const dlqMatchedIds = dlqCandidates
      .filter((row) => payloadMentionsPhone(row.rawPayload, scanPhone))
      .map((row) => row.id);
    if (dlqMatchedIds.length > 0) {
      await tx.failedMessage.deleteMany({
        where: { id: { in: dlqMatchedIds }, organizationId: orgId },
      });
    }
  }
}
```
Add the helper near `digitsOnly`:
```ts
/**
 * Distinct non-empty phone shapes a contact's number may be stored under in channel
 * tables, for exact-match (`in`) erasure deletes. Identity is canonical on phoneE164,
 * but WhatsApp recipient_id/wa_id is digits-only (no +) while other rows carry +E.164,
 * so match raw phone, phoneE164, AND the digits-only form. Digit forms shorter than
 * MIN_PHONE_DIGITS are dropped (junk-collision guard); the raw value is always kept.
 */
export function buildPhoneMatchCandidates(
  phone: string | null | undefined,
  phoneE164: string | null | undefined,
): string[] {
  const out = new Set<string>();
  for (const value of [phone, phoneE164]) {
    if (value && value.length > 0) {
      out.add(value);
      const digits = digitsOnly(value);
      if (digits.length >= MIN_PHONE_DIGITS) out.add(digits);
    }
  }
  return [...out];
}
```

- [ ] **Step 4: fix the api mock** — in `api-meta-deletion.test.ts` add the 6 new tables to the `MockPrisma` interface and `makePrisma()` (each `{ deleteMany: vi.fn().mockResolvedValue({ count: 0 }) }`), so the real cascade does not hit `undefined.deleteMany`.

- [ ] **Step 5: run, verify green** — `pnpm --filter @switchboard/db test -- prisma-contact-store` and `pnpm --filter @switchboard/api test -- api-meta-deletion` both pass.

- [ ] **Step 6: typecheck + commit** — `pnpm --filter @switchboard/db exec tsc --noEmit`, then:
```
fix(db): complete + phone-shape-robust pdpa erasure cascade
```

---

## Task 2 (commit 2, `apps/api`) — match Meta deletion by canonical phoneE164

**Files:**
- Modify: `apps/api/src/routes/meta-deletion.ts` (~116-135 + imports)
- Test: `apps/api/src/__tests__/api-meta-deletion.test.ts`

- [ ] **Step 1: flip the failing assertion** — update the existing "matches contacts by phone with both with-+ and without-+ shapes" test to:
```ts
it("matches contacts by canonical phoneE164 OR raw phone shapes", async () => {
  const sr = makeSignedRequest({ user_id: "6591234567" });
  await app.inject({ method: "POST", url: "/api/meta/deletion",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    payload: `signed_request=${encodeURIComponent(sr)}` });
  expect(prisma.contact.findMany).toHaveBeenCalledWith({
    where: { OR: [{ phoneE164: "+6591234567" }, { phone: { in: ["6591234567", "+6591234567"] } }] },
    select: { id: true, organizationId: true },
  });
  await app.close();
});
```

- [ ] **Step 2: run, verify red** — `pnpm --filter @switchboard/api test -- api-meta-deletion` → fails (current `where: { phone: { in: [...] } }`).

- [ ] **Step 3: implement** — in `meta-deletion.ts` add `import { normalizeToE164 } from "@switchboard/schemas";`, then replace the find clause:
```ts
const normalizedE164 = normalizeToE164(userId);
const matchWhere = normalizedE164
  ? { OR: [{ phoneE164: normalizedE164 }, { phone: { in: candidateValues } }] }
  : { phone: { in: candidateValues } };
```
and `app.prisma.contact.findMany({ where: matchWhere, select: { id: true, organizationId: true } })`.

- [ ] **Step 4: run, verify green** — same command passes.

- [ ] **Step 5: typecheck + commit** — `pnpm --filter @switchboard/api exec tsc --noEmit`, then:
```
fix(api): match meta data-deletion by canonical phoneE164
```

---

## Task 3 (commit 3, `apps/api`) — honest partial/failed erasure outcome

**Files:**
- Modify: `apps/api/src/lib/erase-contact.ts` (return `EraseContactResult`)
- Modify: `apps/api/src/routes/meta-deletion.ts` (map result → `completed`/`partial`/`failed`)
- Modify: `apps/api/src/bootstrap/operator-intents/erase-contact.ts` (`EraseRequestStatus` + `erase` return + handler)
- Modify: `apps/api/src/app.ts` (adapter `erase` returns `{ calendarFullyErased }`; `recordRequest` populates for `partial`)
- Tests: `apps/api/src/__tests__/erase-contact.test.ts`, `api-meta-deletion.test.ts`, `routes/__tests__/operator-contact-erasure.test.ts`

**Interfaces:**
- Produces: `eraseContactFully(...) => Promise<EraseContactResult>` where `EraseContactResult = { contactErased: true; calendar: "completed"|"partial"|"failed"|"skipped"; calendarEventsFound: number; calendarEventsCancelled: number }`.
- Produces: `OperatorContactEraser.erase(orgId, contactId) => Promise<{ calendarFullyErased: boolean }>`; `EraseRequestStatus = "completed"|"partial"|"failed"`.

- [ ] **Step 1: failing tests (erase-contact)** — rewrite the four cases to assert the returned outcome while STILL asserting the contact is deleted:
```ts
it("returns completed + deletes when all events cancel", async () => { /* 2 events ok + 1 null */
  // expect result.calendar === "completed", calendarEventsFound === 2, calendarEventsCancelled === 2 });
it("returns partial when some cancels fail", async () => { /* 2 events, 1 throws */
  // expect result.calendar === "partial", contactStore.delete called });
it("returns failed when events exist but provider is unresolved", async () => { /* throws */
  // expect result.calendar === "failed", logger.error + contactStore.delete called });
it("returns skipped when there are no booked events", async () => {
  // expect result.calendar === "skipped", provider never resolved, delete called });
```

- [ ] **Step 2: run, verify red** — `pnpm --filter @switchboard/api test -- erase-contact` fails (returns undefined).

- [ ] **Step 3: implement erase-contact.ts** — add the result type and:
```ts
let calendar: CalendarErasureOutcome;
let cancelled = 0;
const found = calendarEventIds.length;
if (found === 0) {
  calendar = "skipped";
} else {
  const provider = await resolveProvider(deps, orgId, contactId);
  if (!provider) {
    calendar = "failed"; // events exist, none can be cancelled
  } else {
    for (const calendarEventId of calendarEventIds) {
      try { await provider.cancelBooking(calendarEventId, ERASURE_REASON); cancelled += 1; }
      catch (err) { deps.logger?.warn({ err, orgId, contactId, calendarEventId },
        "erase-contact: calendar event cancel failed; event may linger until reconciled"); }
    }
    calendar = cancelled === found ? "completed" : cancelled === 0 ? "failed" : "partial";
  }
}
await deps.contactStore.delete(orgId, contactId); // never blocked by calendar outcome
return { contactErased: true, calendar, calendarEventsFound: found, calendarEventsCancelled: cancelled };
```

- [ ] **Step 4: failing tests (meta-deletion + operator)** — meta: add a test where the injected `calendarProviderFactory` returns a provider whose `cancelBooking` throws, with a booked event → assert `dataDeletionRequest.create` called with `status: "partial"`. operator: set `makeEraser`'s `erase` to return `{ calendarFullyErased: true }` by default; add a test where it returns `{ calendarFullyErased: false }` → `recordRequest` called with `status: "partial"`, HTTP 200.

- [ ] **Step 5: run, verify red.**

- [ ] **Step 6: implement consumers** —
  - `meta-deletion.ts`: track `let calendarIncomplete = false;`, in the loop `const result = await eraseContactFully(...); if (result.calendar !== "completed" && result.calendar !== "skipped") calendarIncomplete = true;`. After the try/catch:
```ts
let status: string;
if (failureReason !== null) { status = "failed"; }
else if (calendarIncomplete) { status = "partial";
  failureReason = "external calendar cancellation incomplete (event(s) may linger; reconcile from logs)"; }
else { status = "completed"; }
const completedAt = status === "failed" ? null : new Date();
```
  - `operator-intents/erase-contact.ts`: `EraseRequestStatus = "completed" | "partial" | "failed"`; `erase(...) => Promise<{ calendarFullyErased: boolean }>`; handler:
```ts
let eraseResult: { calendarFullyErased: boolean };
try { eraseResult = await eraser.erase(orgId, params.contactId); }
catch (err) { await eraser.recordRequest({ orgId, contactId: params.contactId, actorId,
  status: "failed", failureReason: err instanceof Error ? err.message : "unknown_error" }); throw err; }
const status: EraseRequestStatus = eraseResult.calendarFullyErased ? "completed" : "partial";
await eraser.recordRequest({ orgId, contactId: params.contactId, actorId, status,
  ...(status === "partial"
    ? { failureReason: "external calendar cancellation incomplete (event(s) may linger; reconcile from logs)" }
    : {}) });
return { outcome: "completed" as const,
  summary: status === "partial"
    ? `Erased contact ${params.contactId} from Switchboard (PDPA); external calendar event may linger, reconcile manually`
    : `Erased contact ${params.contactId} (PDPA operator request)`,
  outputs: { contactId: params.contactId, status: "erased", calendarErasure: status } };
```
  - `app.ts` adapter: `erase: async (orgId, contactId) => { const r = await eraseContactFully({...}, orgId, contactId); return { calendarFullyErased: r.calendar === "completed" || r.calendar === "skipped" }; }`; in `recordRequest`, `deletedContactIds: status !== "failed" ? [contactId] : []` and `completedAt: status !== "failed" ? new Date() : null`.

- [ ] **Step 7: run, verify green** — `pnpm --filter @switchboard/api test -- erase-contact api-meta-deletion operator-contact-erasure` all pass.

- [ ] **Step 8: typecheck + commit** — `pnpm --filter @switchboard/api exec tsc --noEmit`, then:
```
fix(api): report partial/failed pdpa erasure when external calendar lingers
```

---

## Final verification (before pushing)

- [ ] `pnpm --filter @switchboard/db --filter @switchboard/api test` (full suites for touched packages) green.
- [ ] `pnpm --filter @switchboard/db exec tsc --noEmit` and `pnpm --filter @switchboard/api exec tsc --noEmit` green.
- [ ] `pnpm --filter @switchboard/db exec eslint . && pnpm --filter @switchboard/api exec eslint .` (or rely on pre-commit) clean.
- [ ] Spec + plan committed (commit 0, docs-only) before the code commits.
- [ ] Push branch, open PR, SURFACE for human review, gate on `gh pr checks`. Do NOT self-merge.

## Self-review (plan vs spec)

- Gap 1 (phoneE164 find) → Task 2. Gap 2 (cascade tables + phone shape) → Task 1. Gap 3 (honest outcome, both entrypoints) → Task 3. All covered.
- No placeholders; all code blocks concrete. Type names consistent: `EraseContactResult.calendar`, `CalendarErasureOutcome`, `buildPhoneMatchCandidates`, `calendarFullyErased`, `EraseRequestStatus`.
