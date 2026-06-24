## Auditability: hash-chained, content-addressed audit records & tenant-boundary scoped reads

This section teaches the data-integrity and tenant-isolation machinery behind Switchboard's audit trail. The platform takes mutating revenue actions on behalf of customers (approving a budget change, executing an ad spend, halting an agent), so "what happened, who decided it, and has the record been tampered with?" is not a nice-to-have. It is the trust anchor for compliance (PDPA/GDPR) and for blocking execution of tampered work. We walk from the cryptographic primitives (canonical JSON, SHA-256) up through the append-only ledger, redaction, tenant-scoped browse, the WorkTrace integrity weld, and the credential-isolation boundary that keeps one tenant's secrets from leaking into another's.

Throughout, "ledger" means the append-only audit log (`AuditLedger`), "WorkTrace" means the canonical persistence record of one platform execution, and "anchor" means an audit entry that witnesses a specific version of a WorkTrace.

### Canonical JSON serialization (the foundation for content addressing)

**Concept.** A _content address_ is an identifier derived from the bytes of the content itself (here, a SHA-256 hash). For that to be stable, serialization must be _deterministic_: the same logical object must always produce the same byte string, regardless of key insertion order or whitespace. This is the problem RFC 8785 (JSON Canonicalization Scheme) solves. Without it, `{"a":1,"b":2}` and `{"b":2,"a":1}` would hash differently even though they are the same value, and your hash chain would falsely report tampering.

**In Switchboard.** [`packages/core/src/audit/canonical-json.ts:6-23`](../../../packages/core/src/audit/canonical-json.ts) implements a dependency-free synchronous subset of RFC 8785:

```ts
if (typeof value === "object") {
  const keys = Object.keys(value as Record<string, unknown>)
    .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
    .sort();
  const entries = keys.map(
    (k) => JSON.stringify(k) + ":" + canonicalizeSync((value as Record<string, unknown>)[k]),
  );
  return "{" + entries.join(",") + "}";
}
```

Two subtleties to internalize: keys are recursively `sort()`ed (so nesting order never matters), and `undefined`-valued keys are _dropped_ (`filter(...)`). That second rule is load-bearing for schema migration, as we will see in WorkTrace hashing: a column added later with a default of `undefined` does not change the hash of older rows.

### Hash-chained audit ledger with integrity verification

**Concept.** A _hash chain_ (the core idea behind blockchains, Git, and Certificate Transparency) makes a log _append-only and tamper-evident_. Each entry stores a hash of its own content plus the previous entry's hash. Mutating any historical entry changes its hash, which breaks the `previousEntryHash` link of the next entry, which breaks the next, and so on. You cannot quietly edit the middle of the log without rewriting everything after it, and you cannot delete an entry without leaving a gap.

**In Switchboard.** The hash input is an explicit, versioned struct (`AuditHashInput`) hashed via canonical JSON in [`packages/core/src/audit/canonical-hash.ts:25-28`](../../../packages/core/src/audit/canonical-hash.ts):

```ts
export function computeAuditHash(input: AuditHashInput): string {
  const canonical = canonicalizeSync(input);
  return sha256(canonical);
}
```

`AuditLedger.buildEntry()` ([`ledger.ts:160-182`](../../../packages/core/src/audit/ledger.ts)) assembles that input including `previousEntryHash`, hashes it into `entryHash`, and stamps `chainHashVersion: 1`. Verification recomputes every hash and re-checks every link. `verifyChain` ([`canonical-hash.ts:34-70`](../../../packages/core/src/audit/canonical-hash.ts)) returns the first `brokenAt` index on a tamper:

```ts
const recomputed = computeAuditHashSync(hashInput);
if (recomputed !== entry.entryHash) return { valid: false, brokenAt: i };
if (i > 0 && entry.previousEntryHash !== entries[i - 1]!.entryHash)
  return { valid: false, brokenAt: i };
```

`AuditLedger.deepVerify()` ([`ledger.ts:280-348`](../../../packages/core/src/audit/ledger.ts)) does the same but distinguishes a content-hash mismatch (a row's bytes changed) from a chain-link break (a row inserted/deleted), reporting both `hashMismatches[]` and `chainBrokenAt`.

**Data flow.** _Producer_: any governance event calls `AuditLedger.record()`. _Enforcer_: `buildEntry` computes the hash; the Prisma storage persists it. _Consumer_: an auditor or CI job calls `verifyChain`/`deepVerify` over a fetched range.

**Gotchas.** `traceId` is deliberately _excluded_ from the hash input ([`ledger.ts:109`](../../../packages/core/src/audit/ledger.ts), comment "not part of chain hash") because it is a request-correlation tag, not committed content. `chainHashVersion` is hashed _into_ the entry, so a future algorithm change can be introduced without invalidating old entries (you verify each entry against its own declared version).

### Atomic append with PostgreSQL advisory locks

**Concept.** A naive `read latest tail, then append` is a classic read-modify-write race. Two app instances (Kubernetes pods, autoscaled workers) could both read entry N as the tail and both write entries pointing back to N, _forking_ the chain into a branch. The fix is to serialize the read+write under a lock. PostgreSQL _advisory locks_ are application-defined locks keyed by an integer, held for the transaction's lifetime.

**In Switchboard.** [`packages/db/src/storage/prisma-ledger-storage.ts:46-106`](../../../packages/db/src/storage/prisma-ledger-storage.ts) acquires lock key `900_001` first, then reads the tail and appends inside the same transaction:

```ts
await tx.$queryRaw`SELECT pg_advisory_xact_lock(${AUDIT_CHAIN_LOCK_KEY})`;
const latest = await tx.auditEntry.findFirst({ orderBy: { timestamp: "desc" } });
const previousEntryHash = latest?.entryHash ?? null;
const entry = await buildEntry(previousEntryHash);
await tx.auditEntry.create({
  data: {
    /* ...entry... */
  },
});
```

`AuditLedger.record()` ([`ledger.ts:114-119`](../../../packages/core/src/audit/ledger.ts)) prefers `appendAtomic` when the storage implements it, falling back to a non-atomic `getLatest()` + `append()` only for single-instance use. Critically, when an `externalTx` is passed, the lock and append run on the _caller's_ transaction ([`prisma-ledger-storage.ts:95-104`](../../../packages/db/src/storage/prisma-ledger-storage.ts)), so a WorkTrace row and its audit anchor commit or roll back together. `pg_advisory_xact_lock` is per-transaction, so the lock is still held until the parent transaction commits.

**Gotcha.** The advisory-lock test is a known flake source under concurrency (see project memory on `pg_advisory_xact_lock` flakes). The lock is correct; the test harness occasionally races. Study `prisma-ledger-storage.test.ts:187-262` to see how concurrent writers are simulated.

### AuditEntry schema with full provenance

**Concept.** A good audit record answers _who_ (actor), _what_ (event type), _on what_ (entity), _when_ (timestamp), _how risky_, _who may see it_ (visibility), and _what was the data_ (snapshot) plus integrity metadata. Capturing all of this in one immutable record makes it the single source of truth for investigations.

**In Switchboard.** The Zod schema ([`packages/schemas/src/audit.ts:67-107`](../../../packages/schemas/src/audit.ts)) defines actor (`actorType`/`actorId`), entity (`entityType`/`entityId`), `riskCategory`, `visibilityLevel`, `summary`, `snapshot`, `evidencePointers`, redaction metadata (`redactionApplied`/`redactedFields`), and the chain fields (`chainHashVersion`, `schemaVersion`, `entryHash`, `previousEntryHash`). The Prisma model mirrors it ([`schema.prisma:150-183`](../../../packages/db/prisma/schema.prisma)) with JSONB `snapshot`/`evidencePointers` and a compound index built precisely for org-scoped pagination:

```prisma
@@index([organizationId, timestamp(sort: Desc), id(sort: Desc)])
```

That index exactly matches the browse query's `ORDER BY timestamp DESC, id DESC` and its `(timestamp, id)` cursor comparison, so pagination stays index-only.

### Snapshot redaction (field-path + pattern based)

**Concept.** Audit snapshots can incidentally capture PII (a customer email in a message body) or secrets (an API token in a payload). _Redaction_ scrubs these before the record is sealed. Two complementary strategies: redact by _field name_ (anything called `password`) and by _value pattern_ (anything that looks like an email/phone/token via regex).

**In Switchboard.** `DEFAULT_REDACTION_CONFIG` ([`packages/core/src/audit/redaction.ts:7-16`](../../../packages/core/src/audit/redaction.ts)) lists `fieldPaths` (`credentials`, `password`, `secret`, `apiKey`, `accessToken`, `refreshToken`) and `patterns` (email, phone, `(sk|pk|api|key|token|secret)[-_]...`, credit card). `redactSnapshot` recursively walks the object, replacing matches with `[REDACTED]` and recording the path in `redactedFields`. The crucial sequencing is in `AuditLedger.buildEntry()` ([`ledger.ts:147-150`](../../../packages/core/src/audit/ledger.ts)): redaction runs _before_ hashing, so the redacted form is what gets committed to the chain:

```ts
const redactionResult = this.redactionConfig
  ? redactSnapshot(params.snapshot, this.redactionConfig)
  : { redacted: params.snapshot, redactedFields: [], redactionApplied: false };
// ...later, hashInput.snapshot = redactionResult.redacted
```

**Gotcha.** Redaction status is itself persisted (`redactionApplied`, `redactedFields`), so an auditor can see _that_ fields were hidden without seeing their values. But the regexes are conservative; if a producer puts a secret under a non-standard key with no recognizable pattern, it survives. Redaction is defense-in-depth, not a substitute for not putting secrets in snapshots.

### Email and phone masking for logs and display

**Concept.** Redaction (above) protects the stored snapshot. _Masking_ protects the much larger surface of log lines and UI text, where you still want enough of the value to debug. The rule is "never emit the raw value; emit a stable, low-entropy fragment."

**In Switchboard.** `maskEmail` ([`mask-email.ts:23-29`](../../../packages/core/src/audit/mask-email.ts)) keeps the first local-part char plus the full domain (`jason@live.com` becomes `j…@live.com`), so you can tell an approver is company-internal without learning who. `maskPhone` ([`mask-phone.ts:20-24`](../../../packages/core/src/audit/mask-phone.ts)) strips non-digits and returns the last 4 (`+65 9123 4567` becomes `…4567`). Both return a `…` fallback on malformed input and _never_ return the raw value:

```ts
export function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 4) return PHONE_MASK_FALLBACK;
  return `…${digits.slice(-4)}`;
}
```

These are pure and surface-agnostic (usable in core, db, and apps), tagged to "PDPA audit F10."

### Organization-scoped browse with cursor pagination

**Concept.** In a multi-tenant system, every read of a shared table must be _scoped to the caller's tenant_ in the WHERE clause, never filtered in application code after the fact. Combine that with _keyset (cursor) pagination_: instead of OFFSET (which drifts as rows are inserted and scans skipped rows), you carry forward the last row's sort key and ask for rows strictly after it.

**In Switchboard.** `listAuditEntriesForBrowse` ([`list-entries.ts:112-165`](../../../packages/core/src/audit/list-entries.ts)) takes `organizationId` as a required argument and builds a filter; the storage applies it as a hard WHERE clause alongside a visibility gate ([`prisma-ledger-storage.ts:148-185`](../../../packages/db/src/storage/prisma-ledger-storage.ts)):

```ts
const where: Prisma.AuditEntryWhereInput = {
  organizationId: filter.organizationId,
  visibilityLevel: { in: ["public", "org"] },
};
if (filter.cursor !== null) {
  where.AND = [
    {
      OR: [
        { timestamp: { lt: cursorDate } },
        { timestamp: cursorDate, id: { lt: filter.cursor.id } },
      ],
    },
  ];
}
```

The cursor's `OR` is wrapped in `AND` deliberately: the comment ([`prisma-ledger-storage.ts:166`](../../../packages/db/src/storage/prisma-ledger-storage.ts)) calls the parens "LOAD-BEARING, without them the OR escapes the org/visibility scope." This is the single most important line for tenant safety: a bare `WHERE org AND vis OR (cursor)` would let the cursor clause match rows from _other tenants_. The cursor itself is base64url-encoded `{timestamp, id}` ([`list-entries.ts:44-65`](../../../packages/core/src/audit/list-entries.ts)), decoded with a typed guard that throws `CursorDecodeError` (mapped to HTTP 400) on tampering. Limit is clamped to `MAX_LIMIT = 100` and one extra row is fetched to compute `nextCursor`.

**Runtime path.** Dashboard `/activity` feed -> route handler reads the session's `organizationId` -> `listAuditEntriesForBrowse(ledger, organizationId, query)` -> tenant-scoped Prisma query -> `project()` -> rows. Scope toggles between `operational` (filtered to `OPERATIONAL_AUDIT_EVENT_TYPES`) and `all`; any narrowing URL param promotes the response scope to `custom` ([`list-entries.ts:101-130`](../../../packages/core/src/audit/list-entries.ts)).

### Snapshot key allowlist with redactedKeyCount projection

**Concept.** Even within a tenant, the browse API should expose _correlation_ (which action, which trace) without leaking _payloads_ (the action's internal state). An allowlist projection is stricter than a denylist: anything not explicitly named safe is hidden by default, and the count of hidden keys is surfaced for transparency.

**In Switchboard.** `SNAPSHOT_KEY_ALLOWLIST` ([`list-entries.ts:13-27`](../../../packages/core/src/audit/list-entries.ts)) is a hardcoded `Set` of safe keys (`actionType`, `decisionId`, `traceId`, `correlationId`, etc.). `project()` iterates the stored snapshot's keys, pushing allowlisted ones into `snapshotKeys` (sorted for deterministic cache keys) and counting the rest:

```ts
for (const key of Object.keys(entry.snapshot)) {
  if (SNAPSHOT_KEY_ALLOWLIST.has(key)) snapshotKeys.push(key);
  else redactedKeyCount++;
}
```

The full snapshot remains immutable in the DB; projection only strips on serialization to `AuditEntryBrowseRow`. Note `storageRef` is _deliberately omitted_ from the row's evidence pointers ([`list-entries.ts:88-93`](../../../packages/core/src/audit/list-entries.ts)) while the full `hash` is kept (it is an integrity anchor, not sensitive).

### Evidence pointers with content-hash and dual storage

**Concept.** Some audit evidence is large (an API response, a crash dump). Inlining it bloats every record; externalizing everything adds a round-trip for tiny payloads. The pragmatic answer is a _size threshold_: small content goes inline, large content is stored once and referenced by its content hash.

**In Switchboard.** `storeEvidence` ([`evidence.ts:81-100`](../../../packages/core/src/audit/evidence.ts)) canonicalizes, hashes, and branches on a 10 KB `INLINE_THRESHOLD`:

```ts
if (serialized.length <= INLINE_THRESHOLD) {
  return { type: "inline", hash, storageRef: null };
}
const storageRef = storagePrefix ? `${storagePrefix}/${hash}` : `evidence/${hash}`;
```

The pointer always carries the `hash`; only the external case carries a `storageRef`. The store is pluggable (`InMemoryEvidenceStore` for tests, `FileSystemEvidenceStore` with path-traversal guards for local, cloud for prod). `verifyEvidence(content, expectedHash)` re-hashes to detect tampering.

**Gotcha.** External storage is _fire-and-forget_ with a swallowed error ([`evidence.ts:92-97`](../../../packages/core/src/audit/evidence.ts)): "Storage failure is non-fatal, the hash is still recorded in the audit trail." That is a deliberate trade-off (the integrity claim survives even if the blob write fails), but it means a pointer can reference content that was never durably stored. The hash still proves _what it was_, but you may not be able to _retrieve_ it.

### WorkTrace content hash with versioned hash-input schema

**Concept.** The same content-addressing idea applies to the execution record (`WorkTrace`), but with a twist: the schema _evolves_. If you add a column later, naively hashing the whole row would invalidate every pre-existing hash. The solution is a _versioned hash input_: each row records which version of the hash-input rules it was created under, and you exclude or include fields per version.

**In Switchboard.** [`work-trace-hash.ts:74-98`](../../../packages/core/src/platform/work-trace-hash.ts) builds the input by version. `EXCLUDED_BASE` always omits derived/mutable fields (`contentHash`, `traceVersion`, `lockedAt`, `injectedPatternIds`, `contactId`, `conversationThreadId`); v1 additionally excludes `ingressPath` and `hashInputVersion` so older rows verify byte-identically, while v2 includes `ingressPath`:

```ts
const hashInputVersion = trace.hashInputVersion ?? WORK_TRACE_HASH_VERSION_LATEST;
const excluded = excludedFor(hashInputVersion);
const out: Record<string, unknown> = {
  hashVersion: hashInputVersion,
  traceVersionForHash: traceVersion,
};
for (const [key, value] of Object.entries(trace)) {
  if (excluded.has(key)) continue;
  out[key] = value;
}
```

The algorithm version (`hashVersion`) and row version (`traceVersionForHash`) are bound _into_ the hash. `traceVersionForHash` uses a distinct name specifically so it cannot collide with the excluded `WorkTrace.traceVersion` field.

**Gotcha.** New nullable columns (`contactId`, `conversationThreadId`) were added to `EXCLUDED_BASE` _without_ a version bump, precisely because the canonical serializer drops `undefined` and these are downstream-derivable, never operator input. The decision of "exclude vs. bump the version" hinges on whether a field is part of the _executed input_ the operator controls. Study this file as the canonical example of evolving a content hash without breaking history.

### WorkTrace integrity verification with audit anchors

**Concept.** A content hash on a row only catches tampering if you _recompute and compare_. But a hash stored on the same row an attacker can edit is weak: change the data and the hash together. The defense is a _second witness_ in a different, append-only store (the audit chain). An _anchor_ is an audit entry whose snapshot records the row's `contentHash` and `traceVersion`. Tampering now requires forging both the row _and_ a hash-chained audit entry, which the advisory-locked chain makes evident.

**In Switchboard.** `verifyWorkTraceIntegrity` ([`work-trace-integrity.ts:47-78`](../../../packages/core/src/platform/work-trace-integrity.ts)) is a layered verdict:

```ts
if (rowContentHash === null) {
  if (rowRequestedAt < cutoffAt) return { status: "skipped", reason: "pre_migration" };
  return { status: "missing_anchor", expectedAtVersion: rowTraceVersion };
}
if (rowTraceVersion <= 0) return { status: "missing_anchor", expectedAtVersion: rowTraceVersion };
const recomputed = computeWorkTraceContentHash(trace, rowTraceVersion);
if (recomputed !== rowContentHash)
  return { status: "mismatch", expected: rowContentHash, actual: recomputed };
if (!anchor) return { status: "missing_anchor", expectedAtVersion: rowTraceVersion };
```

It then checks the anchor's snapshot `contentHash`/`traceVersion` match the row. The anchor is located via `AuditLedger.findAnchor` -> `findBySnapshotField` ([`ledger.ts:209-236`](../../../packages/core/src/audit/ledger.ts), [`prisma-ledger-storage.ts:187-211`](../../../packages/db/src/storage/prisma-ledger-storage.ts)), a JSONB-path equality query that must _not_ impose an arbitrary result limit. `assertExecutionAdmissible` ([`work-trace-integrity.ts:87-118`](../../../packages/core/src/platform/work-trace-integrity.ts)) throws on a non-`ok` verdict unless an explicit `override` is supplied, and the override is itself recorded as a `work_trace.integrity_override` event at `riskCategory: "high"`, `visibilityLevel: "admin"`. The override cannot run silently: without an `auditLedger` it throws.

**Runtime path.** On execution, the platform recomputes the WorkTrace hash, fetches its anchor, and calls `assertExecutionAdmissible`. A `mismatch` (someone patched the `outcome` column offline) blocks execution; an admin can override only by writing an admin-visibility, high-risk audit entry.

### Visibility levels and risk categories

**Concept.** Not every audit event should be visible to every user. A four-tier _visibility_ classification (`public`, `org`, `admin`, `system`) implements least-privilege reads; an orthogonal _risk_ classification (`none`/`low`/`medium`/`high`/`critical`, [`packages/schemas/src/risk.ts`](../../../packages/schemas/src/risk.ts)) drives filtering and alert routing.

**In Switchboard.** `VisibilityLevelSchema` ([`audit.ts:4-5`](../../../packages/schemas/src/audit.ts)) defines the enum; the browse storage hard-filters to `{ in: ["public", "org"] }` ([`prisma-ledger-storage.ts:151`](../../../packages/db/src/storage/prisma-ledger-storage.ts)), so `admin` and `system` entries (e.g. the integrity override above) never surface through the operator API. New entries default to `public` ([`ledger.ts:193`](../../../packages/core/src/audit/ledger.ts), `schema.prisma:159`). Visibility plus `organizationId` together form the tenant-isolation boundary for reads.

### Trace ID correlation

**Concept.** A single user request fans out into many governance decisions, approvals, and side effects, each its own audit entry. A shared _correlation ID_ lets you reconstruct the whole story with one query, and lets you join the audit trail to HTTP request logs.

**In Switchboard.** `traceId` is nullable on `AuditEntry` ([`audit.ts:104-105`](../../../packages/schemas/src/audit.ts)), explicitly _not part of the chain hash_. `CartridgeReadAdapter.query` mints `trace_${randomUUID()}` when none is supplied ([`read-adapter.ts:42`](../../../packages/core/src/read-adapter.ts)), and it is indexed (`@@index([traceId])`) for "show me everything for this transaction" queries.

### Infrastructure failure audit recording

**Concept.** Infrastructure failures (retry exhaustion, persistence errors) must not be silent. Recording them in the same audit store as governance decisions gives post-mortems a single timeline, while alerting ensures a human is paged.

**In Switchboard.** `buildInfrastructureFailureAuditParams` ([`infrastructure-failure.ts:70-127`](../../../packages/core/src/observability/infrastructure-failure.ts)) emits one audit-entry param set plus one alert payload. **Correction to the mapping evidence:** the produced event is `eventType: "action.failed"` with `riskCategory: "high"` (not `infrastructure.job.retry_exhausted`/`critical`; that event type exists in the enum and `OPERATIONAL_AUDIT_EVENT_TYPES`, but this builder uses `action.failed`). `errorStack` and `errorName` are persisted only to the audit snapshot, kept out of the (small) alert payload. `IngressTracePersister.recordInfrastructureFailure` ([`ingress-trace-persister.ts:197-237`](../../../packages/core/src/platform/ingress-trace-persister.ts)) records the entry and fires the alert, with a hard invariant against recursive failure logging: if the audit write itself throws, it `console.error`s and moves on rather than recording a failure-of-the-failure.

### Organization-scoped credential resolution + AES-256-GCM at rest

**Concept (isolation).** The flip side of tenant-scoped _reads_ is tenant-scoped _secrets_. Each org's third-party credentials must resolve to that org's connection, and any "global" fallback must be _explicit_ (a connection with `organizationId = null`), never an accidental match against another tenant's row.

**In Switchboard.** `PrismaCredentialResolver.resolve` ([`prisma-credential-resolver.ts:38-80`](../../../packages/db/src/storage/prisma-credential-resolver.ts)) maps a cartridge to its services, tries org-scoped `getByService(serviceId, organizationId)` first, then _only_ `getByServiceGlobal(serviceId)` (which queries `organizationId = null`). A decrypt failure (missing key) is logged and skipped so the cartridge falls back to boot-time creds rather than crashing or, worse, borrowing another org's secret.

**Concept (encryption).** Stored secrets should be useless without a separate master key, tamper-evident, and resistant to rainbow tables. AES-256-GCM gives authenticated encryption (the auth tag detects modification); a per-credential random salt feeding scrypt key derivation defeats precomputation.

**In Switchboard.** `encryptCredentials` ([`credentials.ts:23-47`](../../../packages/db/src/crypto/credentials.ts)) generates a 32-byte salt and 16-byte IV, derives the key with `scryptSync(secret, salt, 32)`, encrypts with `aes-256-gcm`, and packs `salt + iv + authTag + ciphertext` to base64. `decryptCredentials` reverses it and `setAuthTag` makes a tampered ciphertext throw. The master `CREDENTIALS_ENCRYPTION_KEY` lives in env/secrets manager, so a database breach yields ciphertext only.

**Gotcha.** This key is shared identically across api/chat/dashboard/provisioning (see project memory). Rotating it is a coordinated operation: every service must agree, and existing ciphertext (salted per-credential, but derived from the same master secret) would need re-encryption. Per-credential salt protects against rainbow tables, but it does not make the master key rotatable in isolation.

### What to study next

1. **The load-bearing parenthesis** in `prisma-ledger-storage.ts:166-176`. Re-derive on paper why a flattened `AND/OR` cursor clause would leak cross-tenant rows. This is the difference between a correct and a broken multi-tenant keyset paginator.
2. **Why `traceVersionForHash` exists** in `work-trace-hash.ts`. The naming collision avoidance and the `undefined`-drop interaction with `canonicalizeSync` together are the mental model for evolving any content hash without invalidating history. Then read `work-trace-integrity.test.ts` to see the two-layer (recompute + anchor) check exercised end to end.
