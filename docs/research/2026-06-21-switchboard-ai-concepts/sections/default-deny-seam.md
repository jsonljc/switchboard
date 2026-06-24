## Default-deny enforcement & the cross-cutting governance seam

This section teaches the governance "seam": the single point in Switchboard where every mutating action is judged before it can run. The unifying idea is **fail-closed enforcement**, when the system is uncertain, it denies or parks rather than executes. For an AI platform that can spend real ad budgets and message real customers, this is the difference between "an agent did something unexpected" and "an agent spent $20,000 unsupervised." We walk the pipeline in roughly the order an action flows through it: ingress, the auto-approve short-circuit and its financial guards, the policy engine and its floors, risk and approval routing, and the final decision that ingress consumes.

The whole evaluation lives behind one method, `GovernanceGate.evaluate()` in [`packages/core/src/platform/governance/governance-gate.ts:143`](../../../../packages/core/src/platform/governance/governance-gate.ts#L143), called from `PlatformIngress.submit()` at [`packages/core/src/platform/platform-ingress.ts:259`](../../../../packages/core/src/platform/platform-ingress.ts#L259). Everything below is wiring inside or around that call.

### GovernanceGate evaluation pipeline

**Concept.** A _policy enforcement point_ (PEP) is a single chokepoint that every request must pass through so authorization logic is not scattered across call sites. Centralizing it makes the system auditable and prevents "I forgot to check permissions on this new route" bugs.

**In Switchboard.** `GovernanceGate.evaluate(workUnit, registration)` is the PEP. It (1) resolves execution constraints from any deployment `trustLevelOverride`, (2) builds an `ActionProposal` once via `toActionProposal` so the financial guard and the policy engine share one instance, (3) checks the auto-approve short-circuit, then (4) loads identity, policies, cartridge, and governance profile _in parallel_ and calls the pure policy engine:

```ts
const [identityResult, policies, cartridge, govProfile] = await Promise.all([
  this.deps.loadIdentitySpec(workUnit.actor.id),
  this.deps.loadPolicies(workUnit.organizationId),
  cartridgeId ? this.deps.loadCartridge(cartridgeId) : Promise.resolve(null),
  this.deps.getGovernanceProfile(workUnit.organizationId),
]);
```

The gate is a thin orchestrator; the real ordered checks live in `evaluate()` in [`policy-engine.ts:468`](../../../../packages/core/src/engine/policy-engine.ts#L468). The gate is **stateless per request** and the engine is deterministic given inputs, same inputs, same decision, which is what makes the `WorkTrace` audit meaningful.

**Runtime path.** Inbound message or cron -> `PlatformIngress.submit()` normalizes a `WorkUnit` and looks up the `IntentRegistration` -> `governanceGate.evaluate()` -> `GovernanceDecision` -> ingress denies, parks, or dispatches execution.

**Gotchas.** The gate catches any thrown error and converts it to a hard `deny` with `reasonCode: "GOVERNANCE_ERROR"` ([`platform-ingress.ts:260-266`](../../../../packages/core/src/platform/platform-ingress.ts#L260)). That is fail-closed: an exception during evaluation never falls through to execute. Study next: how `toActionProposal` / `toEvaluationContext` project a `WorkUnit` into the engine's vocabulary, the engine never sees a `WorkUnit`.

### Default-deny policy baseline

**Concept.** _Default-deny_ (whitelisting) means the absence of an explicit permission is itself a denial. The opposite, default-allow, is how most accidental-exposure incidents happen.

**In Switchboard.** Inside the engine, `evaluatePolicyRules()` starts `policyDecision` as `null` and only an explicitly matched `allow`/`require_approval` policy sets it. In Step 10 the null is coalesced to deny:

```ts
// Step 10: Final decision, default deny if no policy matched
builder.finalDecision = policyResult.policyDecision ?? "deny";
```

[`policy-engine.ts:588-589`](../../../../packages/core/src/engine/policy-engine.ts#L588). So an action that matches no seeded policy and is not a trusted behavior is denied regardless of the actor's trust level. The _producer_ of that null-or-allow value is `evaluatePolicyRules()` ([`policy-engine.ts:264`](../../../../packages/core/src/engine/policy-engine.ts#L264)); the _enforcer_ is line 589; the _consumer_ is `toGovernanceDecision()`.

**Gotchas.** The default-deny only bites when control actually reaches Step 10. A _trusted behavior_ (next concept) returns `allow` before Step 10 ([`policy-engine.ts:582`](../../../../packages/core/src/engine/policy-engine.ts#L582)), and the `system_auto_approved` short-circuit returns `execute` before the engine runs at all. Default-deny is the floor for the policy path, not a universal backstop, that is why the short-circuit needs its own guards.

### Forbidden & trust behaviors

**Concept.** Coarse allow/deny lists that sit _above_ fine-grained policy rules. A categorical "never do X" (deny floor) and a "always-safe X" (fast allow) are cheaper and harder to misconfigure than a policy.

**In Switchboard.** `checkForbiddenBehavior()` ([`policy-engine.ts:66`](../../../../packages/core/src/engine/policy-engine.ts#L66)) checks `resolvedIdentity.effectiveForbiddenBehaviors`; a match sets `finalDecision = "deny"` and returns `true` to short-circuit the whole engine. `checkTrustBehavior()` ([`policy-engine.ts:98`](../../../../packages/core/src/engine/policy-engine.ts#L98)) records whether the action is trusted; if so, after approval is computed, the engine forces `allow` with `approvalRequired = "none"` ([`policy-engine.ts:582`](../../../../packages/core/src/engine/policy-engine.ts#L582)). These lists are _resolved_ values, merged from the base `IdentitySpec` plus active role overlays in `resolveIdentity()`.

**Gotchas.** Forbidden runs at Step 1, trust is honored at Step 9.5, so forbidden wins over trust. Note ordering: forbidden returns immediately, but trust does not bypass the spend-limit floor (Step 6 runs before the trust allow is applied), so a "trusted" action still cannot exceed a spend limit.

### Role overlays

**Concept.** _Contextual policy composition_: instead of cloning a whole identity per situation, you layer conditional adjustments (this cartridge, this risk category, this time window) onto a base.

**In Switchboard.** `resolveIdentity()` ([`identity/spec.ts:22`](../../../../packages/core/src/identity/spec.ts#L22)) filters overlays by `active` and `matchesOverlayConditions`, sorts by `priority`, and applies each in `restrict` or `extend` mode:

```ts
if (overlay.mode === "restrict") {
  effectiveSpendLimits = mergeSpendLimitsRestrictive(
    effectiveSpendLimits,
    overlay.overrides.spendLimits,
  );
} else {
  effectiveSpendLimits = mergeSpendLimitsPermissive(
    effectiveSpendLimits,
    overlay.overrides.spendLimits,
  );
}
```

Overlays can only _add_ forbidden behaviors and _remove_ trust behaviors ([`identity/spec.ts:91-103`](../../../../packages/core/src/identity/spec.ts#L91)), the asymmetry is deliberately tilted toward tightening.

**Gotchas.** The merge direction matters: `restrict` takes the _more restrictive_ of the two values, `extend` the more permissive. A misconfigured `extend` overlay is how you would accidentally widen autonomy, so overlays are the first place to look when an actor seems "too capable."

### Hard spend-limit floor

**Concept.** A _non-overridable ceiling_. Even an explicit allow must not be able to authorize spend above a hard cap; the cap is a platform invariant, not a policy outcome.

**In Switchboard.** `checkSpendLimits()` ([`engine/spend-limits.ts:37`](../../../../packages/core/src/engine/spend-limits.ts#L37)) reads the amount via `extractSpendAmount` and compares `Math.abs(spendAmount)` against `effectiveSpendLimits` per-action plus rolling daily/weekly/monthly totals. Any breach sets `finalDecision = "deny"` and returns `true`. It runs at **Step 6, before policy rules** ([`policy-engine.ts:511-515`](../../../../packages/core/src/engine/policy-engine.ts#L511)), so no allow policy can rescue an over-limit action.

**Gotchas.** Cumulative windows only fire when `engineContext.spendLookup` is populated (the orchestrator must supply executed-spend totals); absent that, only the per-action cap applies. The `Math.abs` means a negative budget delta is still measured by magnitude.

### Extract spend amount

**Concept.** A _single source of truth_ for "the dollar amount of this action," so independent gates can never disagree about it.

**In Switchboard.** `extractSpendAmount(proposal, keys = SPEND_KEYS)` ([`engine/spend-limits.ts:26`](../../../../packages/core/src/engine/spend-limits.ts#L26)) returns the first finite number under `["spendAmount", "amount", "budgetChange", "newBudget"]`:

```ts
for (const key of keys) {
  const value = proposal.parameters[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
}
return null;
```

The same extractor feeds the spend-limit floor, the spend-approval threshold (`extractSpendAmount(proposal)` at [`governance-gate.ts:267`](../../../../packages/core/src/platform/governance/governance-gate.ts#L267)), and the financial-intent guard (with a _subset_ of keys).

**Gotchas.** The `Number.isFinite` guard is load-bearing: a `NaN` must never read as an amount, because comparison gates like `amount > limit` are all-`false` on `NaN` and would silently pass (see the codebase's recurring NaN-blind-comparison lesson). The `keys` parameter is what lets the financial guard exclude the generic `"amount"` key.

### Spend-bearing intent registration property

**Concept.** A _static capability declaration_. Rather than inferring danger from runtime data, the intent author explicitly tags an intent as committing outbound money.

**In Switchboard.** `IntentRegistration.spendBearing?: boolean` ([`intent-registration.ts:66`](../../../../packages/core/src/platform/intent-registration.ts#L66)) defaults to false. Its doc comment draws three careful lines: outbound spend (spend-bearing) is _not_ the same as expensive compute (`budgetClass: "expensive"`), nor inbound revenue recording (carries an `amount` but is _not_ spend-bearing). It is checked at registration and again at the gate.

**Gotchas.** Because it is a static flag, `operator.record_revenue` legitimately carries `parameters.amount` yet stays auto-approved, the platform refuses to _infer_ outbound spend from a bare amount.

### F4 spend-bearing auto-approve guard

**Concept.** _Defense in depth_ for a configuration invariant: enforce the same rule at registration time (fail at startup) and at evaluation time (fail at runtime).

**In Switchboard.** `assertNotSpendBearingAutoApprove()` ([`intent-registration.ts:106`](../../../../packages/core/src/platform/intent-registration.ts#L106)) throws `SpendBearingAutoApproveError` if `spendBearing === true && approvalMode === "system_auto_approved"`. It is called by `IntentRegistry.register()` ([`intent-registry.ts:14`](../../../../packages/core/src/platform/intent-registry.ts#L14)) and again inside the gate immediately before the short-circuit ([`governance-gate.ts:171`](../../../../packages/core/src/platform/governance/governance-gate.ts#L171)).

**Gotchas.** This is a _programming_ invariant, so it throws loudly rather than silently downgrading to `require_approval`. The error message itself explains _why_ (auto-approve returns execute before the spend gate). The second call exists for a registration that somehow bypassed the registry.

### System auto-approved short-circuit

**Concept.** A _fast path_ for actions that genuinely need no governance, but a fast path is also a bypass, so it must be tightly fenced.

**In Switchboard.** When `registration.approvalMode === "system_auto_approved"`, the gate returns `execute` before running the engine:

```ts
if (registration.approvalMode === "system_auto_approved") {
  assertNotSpendBearingAutoApprove(registration); // F4
  if (!isFinancialIntent(registration, proposal)) {
    // D9-2
    return {
      outcome: "execute",
      riskScore: 0,
      budgetProfile: "cheap",
      constraints,
      matchedPolicies: [],
    };
  }
  // financial: fall through to full policy path
}
```

[`governance-gate.ts:165-193`](../../../../packages/core/src/platform/governance/governance-gate.ts#L165). Crucially, the short-circuit skips _only the policy lookup_, auth, idempotency, `WorkTrace` persistence, audit, and dispatch all still run downstream.

**Gotchas.** This mode is reserved for operator-direct ingress (e.g. an operator moving an opportunity stage). The two guards (F4 static, D9-2 runtime) are what keep it from becoming a money-moving bypass.

### D9-2 runtime financial-intent guard & the financial denylist

**Concept.** A _runtime backstop_ for the case where the static flag is wrong or missing: detect financial behavior from the actual parameters and refuse the fast path.

**In Switchboard.** `isFinancialIntent()` ([`governance-gate.ts:128`](../../../../packages/core/src/platform/governance/governance-gate.ts#L128)) returns true if the intent prefix is on `FINANCIAL_AUTO_APPROVE_DENYLIST` (`adoptimizer.campaign.reallocate`, `.scale`, `.shift_budget_to_source` at [`governance-gate.ts:103`](../../../../packages/core/src/platform/governance/governance-gate.ts#L103)) or, for non-read intents, `carriesOutboundSpend()` finds a finite non-zero amount under `OUTBOUND_SPEND_KEYS`. That key set is _derived_, not hand-copied:

```ts
const OUTBOUND_SPEND_KEYS = SPEND_KEYS.filter((key) => key !== "amount");
```

When `isFinancialIntent` is true, the gate does _not_ return; it falls through to the full policy path, where default-deny applies unless a seeded `require_approval` policy parks it.

**Gotchas.** The exclusion of `"amount"` is the whole subtlety: it keeps inbound money-recording auto-approved while forcing outbound deltas through policy. The denylist is the backstop for dollars hidden in fields the extractor cannot see, and the comment says keep it tiny and add new outbound intents explicitly.

### Policy rule evaluation & precedence

**Concept.** _Deny-wins composition._ When multiple rules match, a single deny should beat any number of allows, a fail-safe ordering property.

**In Switchboard.** `evaluatePolicyRules()` sorts active policies by `priority`, then iterates. A matched `deny` sets `policyDecision = "deny"` and `break`s; an `allow` sets allow but does _not_ break, so a later deny can still flip it:

```ts
if (policy.effect === "deny") {
  policyDecision = "deny";
  break;
}
if (policy.effect === "allow") {
  policyDecision = "allow";
}
```

[`policy-engine.ts:310-320`](../../../../packages/core/src/engine/policy-engine.ts#L310). Net invariant: among matched policies, deny wins regardless of order or priority.

**Gotchas.** `modify` effect is logged but _not implemented_, it allows the action without modifying parameters and emits a `console.warn`. Treat `modify` as "allow with a TODO," not as a transform.

### Require-approval policy effect

**Concept.** A third outcome between allow and deny: _allow, but with a human in the loop._

**In Switchboard.** A matched `require_approval` policy sets `policyApprovalOverride` and ensures `policyDecision` is at least `allow` ([`policy-engine.ts:327`](../../../../packages/core/src/engine/policy-engine.ts#L327)). That override flows into `determineApprovalRequirement()`. This is the structural mechanism behind "financial intents are require_approval, never system_auto_approved", the D9-2 fall-through lands here.

### Risk scoring & risk categories

**Concept.** _Adaptive authorization_: instead of a fixed allow/deny, compute a numeric risk and route higher risk to stricter handling.

**In Switchboard.** `computeRiskScore()` ([`engine/risk-scorer.ts:63`](../../../../packages/core/src/engine/risk-scorer.ts#L63)) sums weighted factors, base risk (0-80), dollars-at-risk (capped at 20), log2 blast radius, irreversibility/volatility/learning penalties, then `scoreToCategory()` maps the raw score to `none|low|medium|high|critical` ([`risk-scorer.ts:55`](../../../../packages/core/src/engine/risk-scorer.ts#L55)). `determineApprovalRequirement()` then maps category to an approval level via `effectiveRiskTolerance`, and a matched policy's `riskCategoryOverride` can bump it.

**Gotchas.** Risk input comes from the cartridge (`getRiskInput`); if the cartridge throws or is absent, the gate falls back to `DEFAULT_RISK_INPUT` (`baseRisk: "low"`, `reversibility: "full"`). So most actions score low _unless a cartridge enriches them_, risk scoring is only as good as cartridge population.

### Governance profile & system risk posture

**Concept.** An _org-wide policy dial_ that tightens approvals globally without seeding per-action policies.

**In Switchboard.** `getGovernanceProfile()` yields `observe|guarded|strict|locked`; `profileToPosture()` ([`governance/profile.ts:11`](../../../../packages/core/src/governance/profile.ts#L11)) maps these to `normal|elevated|critical`. In `determineApprovalRequirement()`, `critical` forces `mandatory` and `elevated` bumps `none|standard` up to `elevated` ([`policy-engine.ts:424-451`](../../../../packages/core/src/engine/policy-engine.ts#L424)). Absent config defaults to `guarded` -> `normal` (no escalation).

**Gotchas.** This only _tightens_ approval, never loosens it, and it cannot rescue a deny. A `locked` org turns every routine action into a mandatory-approval action.

### Spend-approval threshold (autonomy lever)

**Concept.** A bounded, opt-in _relaxation_ of human-in-the-loop: small reversible spends auto-execute, larger ones still ask.

**In Switchboard.** `applySpendApprovalThreshold()` ([`spend-approval-threshold.ts:42`](../../../../packages/core/src/platform/governance/spend-approval-threshold.ts#L42)) post-processes the decision. It is dormant unless `trustLevelOverride === "autonomous"` _and_ `spendAutonomyEnabled === true` _and_ a finite threshold exists. It never touches a `deny`. At/under threshold it flips a _reversible, standard_ `require_approval` to `execute`; over threshold it escalates an `execute` to `require_approval`.

**Gotchas.** Only `standard` approvals relax, `elevated`/`mandatory` stay parked. The reversibility brake reduces in production to `mutationClass !== "destructive"` because no cartridge populates `reversibility` (it defaults to `"full"`); the code comment warns that any future irreversible financial executor _must_ register as `destructive`. With no config seeded, behavior is byte-identical to baseline.

### Governance decision outcomes, approval routing, and the WorkTrace record

**Concept.** The PEP must hand a _closed set of outcomes_ to the policy enforcement _dispatch_, and every decision must be auditable.

**In Switchboard.** `toGovernanceDecision()` ([`decision-adapter.ts:4`](../../../../packages/core/src/platform/governance/decision-adapter.ts#L4)) turns the `DecisionTrace` into the discriminated `GovernanceDecision` union (`execute | require_approval | deny`, [`governance-types.ts:19`](../../../../packages/core/src/platform/governance-types.ts#L19)). `PlatformIngress.submit()` consumes it: deny -> failed `ExecutionResult` ([`platform-ingress.ts:291`](../../../../packages/core/src/platform/platform-ingress.ts#L291)); require_approval -> a `pending_approval` result plus `createGatedLifecycle()` and an approval notification ([`platform-ingress.ts:304-348`](../../../../packages/core/src/platform/platform-ingress.ts#L304)); execute -> dispatch. `routeApproval()` ([`approval/router.ts:37`](../../../../packages/core/src/approval/router.ts#L37)) resolves expiry per level (mandatory/elevated/standard) and approvers (`delegatedApprovers` over config defaults), with a deny-when-no-approvers safety. Every outcome is persisted by the trace persister with `governanceOutcome`, `riskScore`, and `matchedPolicies`.

**Gotchas.** `require_approval` is _not_ final, it queues for human review and can still expire to deny. And `matchedPolicies` in the decision is built from _all matched check codes_, not just policy rules ([`decision-adapter.ts:8`](../../../../packages/core/src/platform/governance/decision-adapter.ts#L8)), so the `SPEND_APPROVAL_THRESHOLD` marker and floor checks show up there for audit. Study next: how the gated lifecycle, on approval, re-enters dispatch rather than re-running the gate.
