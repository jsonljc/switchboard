## Identity disambiguation: idempotency keys & duplicate-contact risk

This section teaches one family of data-systems problems: how a revenue-actions platform avoids doing the same thing twice, and how it spots when two database rows are secretly the same real-world person. Both problems are about _identity_. An idempotency key answers "is this the same request I already handled?" A duplicate-contact probe answers "is this contact the same human as another one?" Get either wrong and an AI agent will double-charge, double-message, or attribute revenue to a ghost.

The transferable mental model: **at every write boundary, name the unit of identity, store it as a unique constraint or a deterministic key, and make the collision case a no-op (or a flagged signal) rather than an error.** Switchboard applies this consistently, and reading the variations side by side is the fastest way to internalize the pattern.

### The P2002 "claim-first" idempotency primitive

**Concept.** A _unique constraint_ in a relational database is the cheapest possible distributed lock. If you make the database reject duplicate keys, you can let two concurrent writers race: one wins the `INSERT`, the other gets a constraint-violation error. Postgres surfaces this through Prisma as error code `P2002`. The idiom is "claim-first": try to insert; if you get `P2002`, you _lost_ the race, and you decide what that means (skip silently, or go read the existing row).

**In Switchboard.** The same duck-typed classifier appears in multiple stores, deliberately never importing a Prisma value so the check works in pure unit tests. See [`packages/core/src/skill-runtime/tools/issue-receipted-booking.ts:5`](packages/core/src/skill-runtime/tools/issue-receipted-booking.ts):

```ts
export function isPrismaUniqueConstraintError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "P2002"
  );
}
```

What the caller _does_ on `P2002` is the interesting part, and it varies by intent:

- **WorkTrace.claim()** reports the collision up as a value, not an exception. [`packages/db/src/stores/prisma-work-trace-store.ts:147-158`](packages/db/src/stores/prisma-work-trace-store.ts):

  ```ts
  } catch (err: unknown) {
    if (this.isUniqueConstraintError(err) && trace.idempotencyKey) {
      return { claimed: false };
    }
    throw err;
  }
  ```

  `{ claimed: false }` is the concurrency lock that `PlatformIngress` reads before executing domain logic: if you did not win the claim, someone else is already running this work unit, so you stop. Non-`P2002` errors propagate so the caller can retry.

- **Recommendation.insert()** swallows the throw and _reads back_ the existing row, returning an `idempotent: true` marker so the caller can tell fresh from replayed. [`packages/db/src/recommendation-store.ts:148-157`](packages/db/src/recommendation-store.ts):

  ```ts
  if (err && typeof err === "object" && (err as { code?: string }).code === "P2002") {
    const existing = await this.prisma.pendingActionRecord.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) return { row: rowToRecommendation(existing), idempotent: true };
  }
  ```

- **ReceiptedBooking issuance** swallows it to a pure no-op (`if (!isPrismaUniqueConstraintError(err)) throw err;` at [`issue-receipted-booking.ts:139`](packages/core/src/skill-runtime/tools/issue-receipted-booking.ts)), because the row is a derived read-model and the existing row already satisfies intent.

**How it's used at runtime.** Inbound mutating action -> `PlatformIngress.submit()` -> `WorkTraceStore.claim(trace)` inserts a `running` trace keyed by `(organizationId, idempotencyKey)` in the same `$transaction` as the audit-ledger record. If the claim returns `claimed: false`, ingress short-circuits; otherwise it proceeds to governance and domain execution.

**Gotchas.** (1) `claim()` does _not_ inspect `err.meta.target` to confirm _which_ unique constraint fired. The comment at [`prisma-work-trace-store.ts:148-153`](packages/db/src/stores/prisma-work-trace-store.ts) argues this is safe-by-construction: `workUnitId` is a fresh per-submit cuid, so a primary-key collision is unreachable, and failing closed on the unlikely case never causes a double-apply. (2) Under Postgres a thrown statement aborts the _whole_ transaction, so a swallow-and-continue inside a `$transaction` cannot truly isolate one failing write. That is why ReceiptedBooking is made "infallible by construction" instead (see below) rather than relying on the swallow.

### WorkTrace idempotency is org-scoped

**Concept.** An idempotency key only means something within a _namespace_. If your key space is global, tenant A's request can collide with tenant B's and silently drop a legitimate write. Scoping the unique constraint to `(organizationId, key)` makes replay protection per-tenant.

**In Switchboard.** The `WorkTrace` unique constraint is `(organizationId, idempotencyKey)`, and `claim()` (above) is the producer. This is the canonical "D1 idempotency" primitive in the doctrine: claim-first insert _before_ the domain mutation, with the audit-ledger row written in the same transaction so the proof-of-work and the work cannot diverge. The key data-flow insight is that the WorkTrace is written _first_ and acts as the lock, not as an after-the-fact log.

**How it's used at runtime.** Same path as above. The org-scoping prevents cross-tenant replay; the in-transaction audit record means an aborted claim leaves no orphan ledger entry.

### Orchestrator-level idempotency fingerprinting

**Concept.** Database unique constraints protect _writes_. But you may want to dedup _before_ you even spend compute, for example to avoid re-running an expensive LLM governance evaluation for an identical request. The classic tool is a content fingerprint: hash the meaningful inputs into a deterministic key, cache the response under it with a TTL.

**In Switchboard.** `IdempotencyGuard` operates at the `propose()` layer, explicitly separate from the HTTP-level middleware. [`packages/core/src/idempotency/guard.ts:60-70`](packages/core/src/idempotency/guard.ts):

```ts
static generateKey(principalId, actionType, parameters) {
  const hash = createHash("sha256");
  hash.update(principalId);
  hash.update(actionType);
  hash.update(JSON.stringify(parameters, Object.keys(parameters).sort()));
  return hash.digest("hex");
}
```

The `Object.keys(parameters).sort()` is load-bearing: `JSON.stringify`'s second argument is a key _allowlist_, and passing the sorted keys forces deterministic field ordering so `{a,b}` and `{b,a}` hash identically. The store is pluggable (in-memory `Map` or Prisma-backed) with a default 5-minute TTL.

**How it's used at runtime.** Before governance evaluation, `checkDuplicate()` probes the store; on a hit it returns the cached response and skips re-evaluation. `recordResponse()` caches after the fact.

**Gotchas.** This is _distinct_ from WorkTrace idempotency. WorkTrace's unique constraint is durable and org-scoped; the guard's hash is ephemeral (TTL-windowed) and protects governance compute, not domain writes. Conflating them leads to thinking replay protection is weaker than it is.

### Day-bucketed dedupe keys for scheduled sends

**Concept.** Cron jobs retry. If a follow-up cron fires twice in a day, you must not send two messages. But you also do not want a key so strict that a legitimately-rescheduled touch is suppressed forever. The answer is a _bucketed_ deterministic key: coarse enough to absorb retries, granular enough to allow the next real touch.

**In Switchboard.** [`packages/schemas/src/scheduled-follow-up.ts:64-72`](packages/schemas/src/scheduled-follow-up.ts):

```ts
export function buildFollowUpDedupeKey(organizationId, contactId, dueAt, touchNumber): string {
  const dayBucket = dueAt.toISOString().slice(0, 10); // YYYY-MM-DD
  return `followup:${organizationId}:${contactId}:${dayBucket}:t${touchNumber}`;
}
```

The `:t${touchNumber}` suffix keeps two touches landing on the same calendar day collision-proof; the day bucket absorbs intra-day cron retries. `ScheduledFollowUpStore`, `ScheduledReminderStore`, and `RobinRecoverySendStore` each enforce `dedupeKey` unique, and the executor swallows `P2002` to skip. The cadence builder is send-relative: [`packages/core/src/scheduled-follow-up/cadence.ts:28`](packages/core/src/scheduled-follow-up/cadence.ts) anchors the next touch on `now` so a delayed send _stretches_ the cadence rather than compressing it.

**Gotchas.** The bucket granularity _is_ the policy. A one-day bucket means at most one send per contact per touch per day. Study `ACTIVATION_SKIP_REASONS` in the same file: a skipped touch (for example `template_not_approved`) is retried on an activation interval rather than terminated, so "idempotent skip" and "permanent terminate" are different outcomes you must not collapse.

### phoneE164 as the canonical identity disambiguator

**Concept.** To detect that two records are the same person you need a _stable, normalized_ identity column. Raw phone strings ("(415) 555-1234" vs "+14155551234") will never match by equality. E.164 is the international normalized form; normalizing on write makes exact-equality matching reliable.

**In Switchboard.** `PrismaContactStore.create()` normalizes on every insert at [`packages/db/src/stores/prisma-contact-store.ts:90`](packages/db/src/stores/prisma-contact-store.ts): `const phoneE164 = normalizeToE164(input.phone ?? null);`. The same normalization happens in the lead-intake upsert, so `phoneE164` is single-source-of-truth for phone identity regardless of input format (US +1, SG +65, etc.).

**How it's used at runtime.** Contact upsert (intake or manual) -> `normalizeToE164` -> persisted `phoneE164`. Booking issuance later reads this column to probe for duplicates (next concept).

### duplicate_contact_risk detection at issuance

**Concept.** Identity ambiguity should be detected _once_, at the moment a fact is committed, and then carried as durable state. Re-deriving it on every read is both an N+1 performance trap and, worse, it would silently re-open an issue a human already resolved. This is the difference between an _event_ (detected once) and a _recomputed projection_ (re-derived each read).

**In Switchboard.** Inside the booking transaction, after reading the evidence contact, [`issue-receipted-booking.ts:102-114`](packages/core/src/skill-runtime/tools/issue-receipted-booking.ts):

```ts
const rawPhoneE164 = evidenceContact?.phoneE164 ?? null;
let duplicateContactRisk = false;
if (rawPhoneE164 && rawPhoneE164.trim().length > 0) {
  const otherWithSamePhone = await tx.contact.findFirst({
    where: {
      organizationId: args.organizationId,
      phoneE164: rawPhoneE164,
      id: { not: args.contactId },
    },
    select: { id: true },
  });
  duplicateContactRisk = otherWithSamePhone !== null;
}
```

The probe is org-scoped exact equality, excludes self (`id: { not }`), and skips entirely when the key is null/empty/whitespace (an empty phone carries no dedup identity). The boolean flows into `buildReceiptedBookingData`, and the pure `evaluateExceptions` turns it into a persisted exception entry at [`packages/core/src/receipts/evaluate-exceptions.ts:44-46`](packages/core/src/receipts/evaluate-exceptions.ts):

```ts
if (ctx.duplicateContactRisk) {
  entries.push({ code: "duplicate_contact_risk", raisedAt: ctx.now });
}
```

The doctrine comment at lines 95-101 is the lesson: detecting at issuance (not in `getView`) avoids re-opening operator-resolved duplicates and avoids an N+1 probe across `listForCohort`.

**Gotchas.** ReceiptedBooking is a _derived read-model_ (Doctrine #3), so it must never fail the canonical booking. The mitigation is "infallible by construction" ([`issue-receipted-booking.ts:56-64`](packages/core/src/skill-runtime/tools/issue-receipted-booking.ts)): the payload is fully JSON-serializable (no `Date` in the exceptions Json), every column is set, and the `unique(bookingId)` collision is unreachable because the booking id is freshly minted and `findFirst`-guarded.

### Append-only exception merge semantics

**Concept.** When you re-evaluate a derived state, you must reconcile the _freshly computed desired set_ against _persisted history_ without destroying resolutions a human made. The pattern is an append-only merge scoped to the codes this write actually owns.

**In Switchboard.** `mergeExceptions(prior, desired, now, governedCodes)` at [`packages/core/src/receipts/merge-exceptions.ts:20-62`](packages/core/src/receipts/merge-exceptions.ts) implements three rules: governed-and-desired-open with a prior open entry keeps the prior untouched (preserving `raisedAt`); governed-desired-open with no prior appends fresh; governed prior-open no-longer-desired gets `resolvedAt` stamped. Non-governed codes and resolved history pass through verbatim, guaranteeing at most one open entry per code. It is JSON-native (ISO strings, never `Date`) so the Prisma `Json` write cannot fail. The consumer scopes the governed set tightly at [`packages/db/src/stores/prisma-receipted-booking-store.ts:413-417`](packages/db/src/stores/prisma-receipted-booking-store.ts) to `new Set(["duplicate_contact_risk"])`, and `RESOLVABLE_CODES` (line 36) gates which codes a `resolve_exception` may stamp.

**Gotchas.** The `governedCodes` scope is the safety boundary: a `flag_duplicate` write must not accidentally resolve an unrelated open `missing_consent`. Study why only `duplicate_contact_risk` is resolvable in v1, and how `unsupported_code` is returned for anything else.

### Two-stage outcome-pattern dedup (DeploymentMemory)

**Concept.** When an LLM extracts labels, the same idea recurs with different wording and sometimes different categories. You want to merge near-duplicates _within_ a category and _detect_ (not silently merge) collisions _across_ categories, because a cross-category collision is a signal that your enum or your prompt is wrong.

**In Switchboard.** `trackPattern()` at [`packages/core/src/memory/compounding-service.ts:449-510`](packages/core/src/memory/compounding-service.ts) runs stage 1 within the same `canonicalKey` bucket, merging when cosine similarity clears `OUTCOME_PATTERN_MERGE_THRESHOLD` (incrementing confidence instead of creating). On a stage-1 miss it scans the broad category and, on a `>= 0.92` match with a _different_ canonicalKey, increments `outcomePatternsCrossKeyCollision` without merging:

```ts
if (similarity >= SIMILARITY_THRESHOLD /* legacy 0.92 */) {
  metrics.outcomePatternsCrossKeyCollision.inc({
    deploymentId,
    currentKey: canonicalKey,
    collidingKey: entryCanonicalKey,
  });
  break;
}
```

Identity is enforced underneath by the `DeploymentMemory` unique constraint on `(org, deployment, category, content)`, so a final `create()` that races resolves via `P2002`.

**Gotchas.** The cross-key collision is a _quality metric_, not an auto-merge. It tells operators the LLM is conflating distinct operational categories. Counting it separately from `outcomePatternsMerged` is what makes that signal legible.

### canonicalKey validation and enumeration scoping

**Concept.** LLM-produced category slugs must be validated on two axes before they become durable identity: _syntactic_ (well-formed slug) and _semantic_ (a known category). Separating these gives you actionable metrics: a malformed slug is a prompt bug; a well-formed-but-unknown slug is an enum-coverage gap.

**In Switchboard.** `processOutcomePatterns` at [`compounding-service.ts:268-284`](packages/core/src/memory/compounding-service.ts) checks structure first via `CANONICAL_KEY_PATTERN` ([`packages/schemas/src/canonical-keys.ts:11`](packages/schemas/src/canonical-keys.ts): `/^[a-z_]+:[a-z0-9_]+$/`, the `namespace:key` form), incrementing `invalid_canonical_key`; then `isKnownCanonicalKey(key, enumeration)` against the deployment enum, incrementing `unknown_canonical_key`. v1 uses the medspa enumeration; vertical config is deferred. A bare `unknown` slug fails the pattern because it has no colon, so degenerate LLM output is rejected without blocking the compounding flow.

**Gotchas.** Order matters: structural rejection comes first so the two failure metrics never overlap. This is graceful degradation, an unexpected category is dropped, not thrown, so one bad extraction never poisons a conversation's whole pattern set.
