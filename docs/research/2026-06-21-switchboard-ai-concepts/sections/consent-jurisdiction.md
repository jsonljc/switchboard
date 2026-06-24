## Consent boundaries, PDPA & jurisdiction gating

This pillar is about a regulated truth: an AI that messages real people in Singapore (SG) and Malaysia (MY) is processing personal data under each country's **PDPA** (Personal Data Protection Act). For an AI revenue-actions platform, "send a follow-up", "book an appointment", and "show the AI disclosure" are not free actions; they are governed by a per-contact consent lifecycle that must be auditable. Switchboard models that lifecycle as a small set of immutable-once-set fields on `Contact`, a service that mutates them under invariants, and a layered set of gates that read them at the exact moments an action would touch a customer. A recurring design idea you should extract: **stored data is not enforced data**, and **enforcement is staged behind a three-mode switch** so PDPA can be turned on without surprise blocking in production.

Throughout, "jurisdiction" means the regulatory regime (SG or MY); "consent" means a data subject's grant/revocation tracked against that regime; and "disclosure" means the transparency text telling the customer they are talking to an AI.

### Jurisdiction-scoped, immutable PDPA consent state

**Concept.** When the same logical entity (a contact) can fall under multiple legal regimes, you must bind its consent record to exactly one regime and refuse to silently move it. Otherwise a grant captured under one law gets reused under another, which is both a compliance defect and an audit nightmare. The transferable pattern is **write-once immutability enforced at two layers** (application invariant + database WHERE clause).

**In Switchboard.** The state lives as nullable columns on `Contact` in [`packages/db/prisma/schema.prisma:1817`](packages/db/prisma/schema.prisma#L1817). The schema comment itself encodes the invariant:

```prisma
// pdpaJurisdiction is immutable after first non-null write in v1, only
// ConsentService mutates these; service throws ConsentJurisdictionMismatch
pdpaJurisdiction         String?
consentGrantedAt         DateTime?
consentRevokedAt         DateTime?
aiDisclosureVersionShown String?
```

The application invariant lives in `ConsentService.ensureJurisdictionStamped` at [`packages/core/src/consent/consent-service.ts:108`](packages/core/src/consent/consent-service.ts#L108): it reads the current jurisdiction, no-ops if it already matches, and throws `ConsentJurisdictionMismatch` if a _different_ jurisdiction is already stamped. The database layer is the second line: `setJurisdictionIfNull` ([`packages/db/src/prisma-consent-store.ts:60`](packages/db/src/prisma-consent-store.ts#L60)) uses a conditional `updateMany`:

```ts
await prisma.contact.updateMany({
  where: { id: contactId, organizationId, pdpaJurisdiction: null },
  data: { pdpaJurisdiction: jurisdiction },
});
```

A row whose `pdpaJurisdiction` is already set matches zero rows, so the stamp is a no-op at the SQL level even if the service check were bypassed.

**How it's used at runtime.** During an inbound turn, `PdpaConsentGateHook.afterSkill` calls `attachToGovernedInteraction(contactId, config.jurisdiction, orgId)` ([`pdpa-consent-gate.ts:89`](packages/core/src/skill-runtime/hooks/pdpa-consent-gate.ts#L89)). The deployment's configured jurisdiction is the source of truth; the first governed interaction stamps it, and every later interaction confirms it matches.

**Gotchas / what to study next.** The producer (service check) and the database constraint protect _different_ failure modes: the service catches an operator passing the wrong jurisdiction; the WHERE clause catches a TOCTOU race or a path that skips the service. Note also that re-granting after revocation is deliberately impossible (`recordGrant` throws `ConsentRevokedCannotRegrant`); a fresh cycle requires an explicit `clearConsent`, which a human (not a `system:` actor) must perform.

### Three-mode enforcement: off / observe / enforce

**Concept.** Shipping enforcement logic and _activating_ it are separate risks. The safe rollout pattern is a per-tenant mode switch with three states: `off` (zero-overhead pass-through), `observe` (run the full logic, emit telemetry, change nothing customer-visible), and `enforce` (actually block). `observe` gives you production parity data ("what _would_ enforce have blocked?") before flipping the live behavior.

**In Switchboard.** `ConsentStateConfigSchema` and its resolver live in [`packages/schemas/src/governance-config.ts:76`](packages/schemas/src/governance-config.ts#L76). The mode lives under `governanceConfig.consentState.mode`, defaulting to `off`. Crucially, the resolver **fail-safes corrupt config to `off`** and logs only the Zod issue path/code (never the raw value, to avoid echoing stored input):

```ts
const parsed = ConsentStateConfigSchema.safeParse(raw ?? {});
if (!parsed.success) {
  console.error(
    "[governance-config] corrupt consentState sub-block; failing open to mode=off ...",
    { issues: parsed.error.issues.map((i) => ({ path: i.path, code: i.code })) },
  );
  return { mode: "off" };
}
```

Every gate consumes this resolver and short-circuits on `off` before any read: see [`pdpa-consent-gate.ts:75`](packages/core/src/skill-runtime/hooks/pdpa-consent-gate.ts#L75), [`consent-enforcement-gate.ts:67`](packages/core/src/channel-gateway/consent-enforcement-gate.ts#L67), and [`calendar-book-consent.ts:99`](packages/core/src/skill-runtime/tools/calendar-book-consent.ts#L99). `buildObserveGovernanceConfig` ([`governance-config.ts:238`](packages/schemas/src/governance-config.ts#L238)) is the canonical "all gates observe" posture that seeds and parity tests share so they cannot drift.

**How it's used at runtime.** An org flips `consentState.mode` from `off` to `observe`; gates begin reading consent and persisting verdicts but never block. After the observe bake looks clean, ops flips to `enforce` and the _same_ code path now suppresses sends/bookings. No code change ships the activation.

**Gotchas.** Note the asymmetry in corrupt-config handling: consent fails _open_ to `off` (a missed block is recoverable), but `resolveRecoveryConfig` for Robin's mass-outbound cron fails _closed_ to `off` (an erroneous mass send is not). "Fail open vs fail closed" is a per-capability judgment, not a global rule.

### Derived consent status and the operational/proactive matrix

**Concept.** Rather than store a status enum that can drift from the timestamps, derive it. And gate different _classes_ of message differently: a transactional message (booking confirmation) tolerates a looser bar than an unsolicited marketing message.

**In Switchboard.** `deriveConsentStatus` ([`packages/schemas/src/pdpa-consent.ts:57`](packages/schemas/src/pdpa-consent.ts#L57)) computes `not_applicable | pending | granted | revoked` from three fields, with revocation taking precedence over grant by construction:

```ts
if (!c.pdpaJurisdiction) return "not_applicable";
if (c.consentRevokedAt) return "revoked";
if (c.consentGrantedAt) return "granted";
return "pending";
```

`evaluateConsentGate` ([`pdpa-consent.ts:86`](packages/schemas/src/pdpa-consent.ts#L86)) applies the policy matrix: `operational` allows `not_applicable/pending/granted` and blocks only `revoked`; `proactive` additionally blocks `pending`. A contact with no jurisdiction (`not_applicable`) is never an obstacle, which is why `evaluateExceptions` ([`packages/core/src/receipts/evaluate-exceptions.ts:38`](packages/core/src/receipts/evaluate-exceptions.ts#L38)) only raises `missing_consent` when `pdpaJurisdiction` is set and consent is absent/revoked.

**How it's used at runtime.** The skill-runtime hook always evaluates with `messageClass: "operational"` (an inbound reply is transactional). The booking precondition reuses `proactive` because a booking is an outbound commitment. The receipts/completeness report uses the same derivation to flag non-bookable opportunities for operator follow-up.

**Gotchas.** The matrix lives in one pure function imported by every call site, so SG-vs-MY substantive difference is expressed by _when grant is requested_, not by branching the gate. Study how `messageClass` is the only knob that changes strictness, and how `not_applicable` deliberately means "outside PDPA scope", not "unknown".

### Inbound revocation: language-specific keyword scanning + acknowledgment

**Concept.** Customers revoke in their own words, not always with a literal `STOP`. You need locale-aware detection that is _conservative_ (a false revoke silently kills a real lead) and contextual (avoid matching benign phrases).

**In Switchboard.** Keyword tables are per-jurisdiction. SG ([`revocation-keywords/sg.ts`](packages/core/src/consent/revocation-keywords/sg.ts)) includes colloquial Malay like `jangan hubungi` ("don't contact"). MY ([`revocation-keywords/my.ts`](packages/core/src/consent/revocation-keywords/my.ts)) deliberately contextualizes stop-verbs with messaging nouns to dodge medical false positives:

```ts
// Excludes 'berhenti makan ubat' (stop taking medicine)
patterns: [/\bberhenti\b.*\b(hantar|pesanan|mesej|whatsapp|sms|hubung)/i, /\bberhenti hantar\b/i],
```

`scanForRevocationKeywords` ([`scanner/revocation-keyword-scanner.ts:17`](packages/core/src/consent/scanner/revocation-keyword-scanner.ts#L17)) is a pure function returning all matches. The `runConsentRevocationGate` ([`channel-gateway/consent-revocation-gate.ts:23`](packages/core/src/channel-gateway/consent-revocation-gate.ts#L23)) runs **pre-input, before the escalation gate**: in `enforce` mode it calls `recordRevocation(source: "inbound_keyword_revocation", ...)`, sends a deterministic locale-specific ack from `REVOCATION_ACK` ([`revocation-ack.ts`](packages/core/src/consent/revocation-ack.ts)), and returns `"revoked"` so the caller skips submission entirely.

**How it's used at runtime.** Inbound message arrives at the channel gateway, revocation gate scans it, a match in enforce mode writes `consentRevokedAt`, flips the conversation to `human_override`, builds a handoff package, sends "Got it, we won't message you further", and stops. In `observe` mode it only persists a `warning` verdict and proceeds.

**Gotchas.** The MY comment captures real wisdom: "false-positive revoke is worse than missed revoke" because the escalation gate catches nuanced complaints as a fallback. Also note the ack text is hardcoded, not model-generated, so a compliance team can review the exact words and gateway internals never leak.

### Send-time enforcement gate (the egress backstop)

**Concept.** Even after you set `consentRevokedAt`, a message generated _before_ that write committed may still be in flight. You need a final gate at the egress boundary to catch the race.

**In Switchboard.** `runConsentEnforcementGate` ([`consent-enforcement-gate.ts:33`](packages/core/src/channel-gateway/consent-enforcement-gate.ts#L33)) runs immediately before `replySink.send(...)`. It reads `consentRevokedAt`; under `enforce` with a revocation present it returns `"blocked"` (caller suppresses both `send` and `addMessage`) and emits a `critical` verdict. Under `observe` it emits a `warning` and returns `"allowed"`. Resolver errors with a cached enforce posture **fail open with audit** (`reasonCode: "governance_unavailable"`, still `"allowed"`).

**How it's used at runtime.** This is the primary enforcement for operational responses; the `afterSkill` hook is backup defense for scheduled messages. Together they form defense-in-depth against the revocation-race.

**Gotchas.** Notice the deliberate fail-open on resolver error here, paired with a critical audit row, so a config-fetch outage never blocks all replies but is never invisible either. Contrast this with the booking precondition below, which fails _closed_.

### Flag-gated booking precondition (fail-closed, inside the tool)

**Concept.** Some actions are irreversible commitments and must be validated _before_ persistence, fail-closed. Putting this check inside the tool (not as a governance constraint) matters because constraints never reach the executor.

**In Switchboard.** `enforceConsentPrecondition` ([`calendar-book-consent.ts:93`](packages/core/src/skill-runtime/tools/calendar-book-consent.ts#L93)) is injected into the booking tool. `off` returns `null` without reading; `observe` reads but never blocks; `enforce` evaluates with `messageClass: "proactive"` (allowing only `granted`/`not_applicable`) and returns a non-retryable `CONSENT_REQUIRED` `ToolResult` before any write. A read error under enforce blocks:

```ts
if (mode === "enforce") {
  console.error("[calendar-book] consent read failed under enforce; blocking booking", err);
  return consentRequiredFailure(ids.orgId, "read_error");
}
```

**Gotchas.** This reuses the `proactive` matrix rather than inventing a fourth message class. The fail-closed direction is the opposite of the egress gate, because a wrongly-created booking is a real-world commitment, while a wrongly-suppressed reply is recoverable.

### Versioned AI disclosure + observe-only detection

**Concept.** Transparency obligations change over time; you need to know _which version_ of the disclosure each contact saw, for change-management audits.

**In Switchboard.** `DISCLOSURE_COPY` ([`consent/disclosure-copy.ts:18`](packages/core/src/consent/disclosure-copy.ts#L18)) holds version-stamped text per jurisdiction (`sg-disclosure@1.0.0`, `my-disclosure@1.0.0`); MY's copy includes an explicit consent prompt because MY PDPA requires consent before processing. The `afterSkill` hook ([`pdpa-consent-gate.ts:180`](packages/core/src/skill-runtime/hooks/pdpa-consent-gate.ts#L180)) does a **deterministic substring match** of the expected text against `result.response`. First-time detection or a version mismatch calls `recordDisclosureShown` (stamping `aiDisclosureVersionShown`); a miss emits an observe-level `disclosure_not_shown` or `disclosure_version_outdated` warning _without blocking_.

**Gotchas.** The substring match is intentionally fragile: the code comments admit "punctuation, whitespace, and markdown drift will break detection", deferred until copy stabilizes. Versioning is a regulatory artifact changed via PR review, not per-tenant config.

### Tenant isolation, the read seam, and verdict persistence

**Concept.** Consent data is PHI-adjacent, so cross-tenant reads/writes must be impossible by construction, governance logic must stay Prisma-free for testability, and every mutation must leave an audit trail without letting audit failures abort the mutation.

**In Switchboard.** Every `ConsentStateStore` mutation requires `organizationId` and scopes its WHERE by it ([`consent-store.ts:16`](packages/core/src/consent/consent-store.ts#L16)); a cross-tenant target matches zero rows and `assertScoped(count, contactId)` raises `ContactNotFound` ([`prisma-consent-store.ts:32`](packages/db/src/prisma-consent-store.ts#L32)). Reads go through the `ContactConsentReader` interface ([`contact-consent-reader.ts:8`](packages/core/src/consent/contact-consent-reader.ts#L8)) so core never imports Prisma (the Layer-3 rule). Every consent mutation calls `persistVerdict` ([`consent-service.ts:126`](packages/core/src/consent/consent-service.ts#L126)), and persistence failures are logged but never abort the mutation:

```ts
} catch (err) {
  // Emission integrity > persistence completeness, mirror 1b-1/1b-2.
  console.error("[consent-service] verdict persistence failure", err);
}
```

**Gotchas.** `readOrNull` takes `organizationId` _optionally_: the service always passes it; only single-deployment infra paths (the egress gate) may omit it. Verdict audit levels are graded (`info` for grant, `critical` for revoke), which is how a PDPA auditor reconstructs a contact's lifecycle by reason code.

### WhatsApp 24-hour window + opt-in (orthogonal to PDPA)

**Concept.** Platform policy and data-protection law are _different_ gates. Meta's Business Messaging Policy lets you message freely within 24h of a customer's inbound but requires an approved template plus opt-in outside it. This is independent of PDPA consent.

**In Switchboard.** The window gate ([`whatsapp-window-gate.ts:150`](packages/core/src/skill-runtime/hooks/whatsapp-window-gate.ts#L150)) checks freshness first; inside the window it allows without opt-in. Outside, it requires `messagingOptIn`, then an `approved` template, and gates marketing-template substitution behind `allowMarketingTemplateSubstitution` (default false). The fields are distinct from PDPA on `Contact` ([`schema.prisma:1803`](packages/db/prisma/schema.prisma#L1803)): `messagingOptIn`, `messagingOptInSource` (`"ctwa" | "organic_inbound" | "web_form" | "manual"`).

**Gotchas.** Keep the two straight: PDPA consent blocks _all_ outbound (operational and marketing); the WhatsApp window gate only governs _template substitution_ outside the 24h window. A contact can be PDPA-granted yet still blocked by a missing approved template, and vice versa.
