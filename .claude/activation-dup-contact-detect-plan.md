# duplicate_contact_risk write-side detection — implementation plan (ephemeral, .claude scratch)

**Goal:** kill the hardcoded `duplicateContactRisk: false` at issuance and wire real write-side detection so the exception fires and reaches the existing operator reconcile flow.

**Architecture:** detection runs ONCE at issuance inside the governed booking tx (issue-receipted-booking.ts), org-scoped exact-match on Contact.phoneE164 excluding self; the boolean threads through buildReceiptedBookingData -> evaluateExceptions, persists into the issuance row's exceptions array, is carried on the read path (assembleViewExceptions), and is durably resolvable. Read path stays `false` (read-side recompute would resurrect resolved dups + N+1).

## Global Constraints

- ESM, `.js` extensions in relative imports. No `any`. No `console.log`. Prettier 100-col, double quotes, semicolons, trailing commas. Lowercase conventional-commit subject. No em-dashes.
- Typed `vi.fn<...>` args on any spy whose `.mock.calls` is read (untyped breaks the BUILD via TS2493).
- Schema-free (NO @@unique, NO migration). NaN/null guarded.

---

### Task 1: thread the flag through the pure issuance builder (build-receipted-booking-data.ts)

**Files:**

- Modify: `packages/core/src/receipts/build-receipted-booking-data.ts` (interface + line 72)
- Test: `packages/core/src/receipts/build-receipted-booking-data.test.ts`

**Interfaces:**

- Produces: `BuildReceiptedBookingArgs.duplicateContactRisk?: boolean` (default false), consumed by Task 2.

- [ ] Step 1: add failing pin test (RED) to build-receipted-booking-data.test.ts

```ts
it("threads duplicateContactRisk into the exception set (NOT hardcoded false)", () => {
  const data = buildReceiptedBookingData({
    ...base,
    evidence: { sourceAdId: "ad-9" }, // attributed -> no missing_source
    consentGrantedAt: now,
    consentRevokedAt: null,
    estimatedValueCents: null,
    duplicateContactRisk: true,
  });
  expect(data.exceptions.map((e) => e.code)).toContain("duplicate_contact_risk");
});

it("omits duplicate_contact_risk when the flag is false or absent (default)", () => {
  const dataFalse = buildReceiptedBookingData({
    ...base,
    evidence: { sourceAdId: "ad-9" },
    consentGrantedAt: now,
    duplicateContactRisk: false,
  });
  const dataAbsent = buildReceiptedBookingData({
    ...base,
    evidence: { sourceAdId: "ad-9" },
    consentGrantedAt: now,
  });
  expect(dataFalse.exceptions.map((e) => e.code)).not.toContain("duplicate_contact_risk");
  expect(dataAbsent.exceptions.map((e) => e.code)).not.toContain("duplicate_contact_risk");
});
```

- [ ] Step 2: run -> the first test FAILS (`toContain` misses; arg ignored, hardcoded false). RED proof.
      Run: `pnpm --filter @switchboard/core test -- build-receipted-booking-data`
- [ ] Step 3: add `duplicateContactRisk?: boolean` to `BuildReceiptedBookingArgs` (with a doc comment), and change line 72 from `duplicateContactRisk: false,` to `duplicateContactRisk: args.duplicateContactRisk ?? false,`.

```ts
  /** True when another contact in the org shares this contact's non-null phoneE164 (computed by the
   * issuance caller; the read path keeps this false and sources the code from the persisted carry). */
  duplicateContactRisk?: boolean;
```

- [ ] Step 4: run -> GREEN. `pnpm --filter @switchboard/core test -- build-receipted-booking-data`

---

### Task 2: detect at issuance + thread the boolean (issue-receipted-booking.ts)

**Files:**

- Modify: `packages/core/src/skill-runtime/tools/issue-receipted-booking.ts` (interface return type + evidence select + probe + pass-through)
- Test: `packages/core/src/skill-runtime/tools/issue-receipted-booking.test.ts`

**Interfaces:**

- Consumes: `BuildReceiptedBookingArgs.duplicateContactRisk` (Task 1).
- Produces: a second org-scoped `tx.contact.findFirst` probe `{ where: { organizationId, phoneE164: <raw>, id: { not: contactId } }, select: { id: true } }`.

- [ ] Step 1: extend `makeTx` to branch findFirst on a phoneE164 where-clause, add `duplicateContact` opt + `phoneE164` on evidenceContact:

```ts
function makeTx(opts: {
  existingRow?: { id: string } | null;
  evidenceContact?: {
    leadgenId?: string | null;
    sourceType?: string | null;
    firstTouchChannel?: string | null;
    pdpaJurisdiction?: string | null;
    consentGrantedAt?: Date | null;
    consentRevokedAt?: Date | null;
    phoneE164?: string | null;
  } | null;
  duplicateContact?: { id: string } | null;
  createImpl?: () => Promise<unknown>;
}) {
  const create = vi.fn<(args: { data: Record<string, unknown> }) => Promise<unknown>>(
    opts.createImpl ?? (async () => ({ id: "rb_1" })),
  );
  // Branch the two reads: the dup probe is the only findFirst whose where carries phoneE164.
  const contactFindFirst = vi.fn<
    (a: { where: Record<string, unknown>; select?: Record<string, boolean> }) => Promise<unknown>
  >(async (a) => {
    if (a.where.phoneE164 !== undefined) return opts.duplicateContact ?? null;
    return opts.evidenceContact ?? null;
  });
  return {
    tx: {
      receiptedBooking: {
        findFirst: vi.fn().mockResolvedValue(opts.existingRow ?? null),
        create,
      },
      contact: { findFirst: contactFindFirst },
    },
    create,
  };
}
```

- [ ] Step 2: add failing tests (RED) — dup flags, no-dup clean, null/empty skips probe:

```ts
it("flags duplicate_contact_risk when another contact shares the non-null phoneE164", async () => {
  const { tx, create } = makeTx({
    evidenceContact: { leadgenId: "lead_1", phoneE164: "+6591234567" },
    duplicateContact: { id: "ct-2" },
  });
  await issueReceiptedBookingInTx(tx, baseArgs);
  expect(tx.contact.findFirst).toHaveBeenCalledWith({
    where: { organizationId: "org-1", phoneE164: "+6591234567", id: { not: "ct-1" } },
    select: { id: true },
  });
  const data = create.mock.calls[0]![0].data as { exceptions: Array<{ code: string }> };
  expect(data.exceptions.map((e) => e.code)).toContain("duplicate_contact_risk");
});

it("does NOT flag when no other contact shares the phoneE164", async () => {
  const { tx, create } = makeTx({
    evidenceContact: { leadgenId: "lead_1", phoneE164: "+6591234567" },
    duplicateContact: null,
  });
  await issueReceiptedBookingInTx(tx, baseArgs);
  const data = create.mock.calls[0]![0].data as { exceptions: Array<{ code: string }> };
  expect(data.exceptions.map((e) => e.code)).not.toContain("duplicate_contact_risk");
});

it("skips the probe and never flags when phoneE164 is null/empty/whitespace", async () => {
  for (const phoneE164 of [null, "", "   "]) {
    const { tx, create } = makeTx({
      evidenceContact: { leadgenId: "lead_1", phoneE164 },
      duplicateContact: { id: "ct-2" }, // present, but must stay unreachable (no probe)
    });
    await issueReceiptedBookingInTx(tx, baseArgs);
    const probed = tx.contact.findFirst.mock.calls.some(
      (c) => (c[0] as { where: Record<string, unknown> }).where.phoneE164 !== undefined,
    );
    expect(probed).toBe(false);
    const data = create.mock.calls[0]![0].data as { exceptions: Array<{ code: string }> };
    expect(data.exceptions.map((e) => e.code)).not.toContain("duplicate_contact_risk");
  }
});
```

- [ ] Step 3: run -> dup test FAILS (no probe call; no flag). RED proof.
      Run: `pnpm --filter @switchboard/core test -- issue-receipted-booking`
- [ ] Step 4: implement. (a) add `id?: string | null;` and `phoneE164?: string | null;` to the `contact.findFirst` return type in `ReceiptedBookingIssuanceTx`; (b) add `phoneE164: true` to the evidence select; (c) insert the probe between the evidence read and the build call; (d) pass `duplicateContactRisk` into `buildReceiptedBookingData`.

```ts
// Write-side duplicate-contact detection (issuance-time, once per booking). Persisted into the
// exceptions array, carried on the read path, durably resolvable via resolve_exception. Recomputing
// on the READ path would re-open an operator-resolved duplicate every read (a recomputable code wins
// and drops the persisted resolved entry), so detection MUST be write-side here, not in getView.
// Match key = the canonical phoneE164 column (exact equality), org-scoped, excluding self; a
// null/empty/whitespace key has no dedup identity, so the probe is skipped (risk stays false).
const rawPhoneE164 = evidenceContact?.phoneE164 ?? null;
let duplicateContactRisk = false;
if (rawPhoneE164 && rawPhoneE164.trim().length > 0) {
  const other = await tx.contact.findFirst({
    where: {
      organizationId: args.organizationId,
      phoneE164: rawPhoneE164,
      id: { not: args.contactId },
    },
    select: { id: true },
  });
  duplicateContactRisk = other !== null;
}
```

Then add `duplicateContactRisk,` to the `buildReceiptedBookingData({...})` argument object.

- [ ] Step 5: run -> GREEN. `pnpm --filter @switchboard/core test -- issue-receipted-booking`
      WATCH-POINT: confirm the widened `contact.findFirst` return type still lets calendar-book.ts pass its Prisma tx (typecheck). If it reds, narrow via a structural param, do NOT loosen to `any`.

---

### Task 3: sharpen the read-path rationale (prisma-receipted-booking-store.ts) — doc only

**Files:**

- Modify: `packages/db/src/stores/prisma-receipted-booking-store.ts:~178-190` (comment only; NO behavior change)

- [ ] Step 1: replace the imprecise "land the same code twice" rationale with the load-bearing one (resolve-durability + N+1), so a future agent does not enable read-side recompute and resurrect resolved dups. Keep `duplicateContactRisk: false` on line 190 unchanged.

```ts
// Keep duplicateContactRisk: false on the READ path. duplicate_contact_risk is array-sourced here
// (the persisted carry below, populated by write-side detection at issuance + operator flag_duplicate).
// Do NOT recompute it on read: assembleViewExceptions makes a recomputable code win and drop the
// persisted same-code entry, so a live re-detect would re-open an operator-RESOLVED duplicate on
// every read (resolve_exception would never stick) and add an N+1 probe across listForCohort.
```

- [ ] Step 2: run db store tests -> still GREEN (no behavior change).
      Run: `pnpm --filter @switchboard/db test -- prisma-receipted-booking-store`

---

## Self-review

- Spec coverage: kill hardcoded false (Task 1+2), real detection from producer data (Task 2 tests use a two-contact tx), reaches reconcile flow (array carry unchanged; resolve/flag already wired). ✓
- Placeholder scan: none. ✓
- Type consistency: `duplicateContactRisk` name identical across build-data interface, issuance computation, evaluateExceptions ctx. `phoneE164` raw value used in probe; trimmed only for the empty-guard. ✓
- RED proofs: Task1 step2 (toContain miss), Task2 step3 (no probe). Both go RED if the flag reverts to hardcoded false. ✓
