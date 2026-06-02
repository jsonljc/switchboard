# Alex Intent-Coverage Matrix

**Purpose:** Validate the audit's prioritization against the team's own curated intent set, rather than audit intuition. Produced in response to the review challenge: *"the audit asserts BusinessFacts are the highest-frequency inbound class but presents it as certainty."*

**Source of truth:** the 72 `evals/alex-conversation/fixtures/*.jsonl` scenarios — the team's enumeration of what Alex must handle, with each fixture's `oracle` (expected booking / escalation / forbidden-tools) and grade hints. This is grounded data, not a synthetic guess.

## Honesty caveat (important)

The eval fixtures are a **hard-case-coverage** sample, deliberately weighted toward the conversations that are *difficult to get right* (objection, refusal, safety, skepticism). They are **not a frequency sample** of real inbound. Pre-launch there is no production traffic, so true inbound frequency is unmeasured.

So this matrix answers **"can Alex handle intent X today?"** (capability coverage) — which is decisive for launch readiness — but it does **not** prove **"how often does intent X occur?"**. Where the audit claimed an intent is "highest-frequency," that is now flagged as a **reasonable-but-unvalidated assumption**, to be confirmed against the first week of pilot logs.

## Distribution of the curated set

| Stage cluster | Fixtures | % | Lead's intent |
|---|---:|---:|---|
| **objection** | 15 | 21% | Price / results / time / trust skepticism |
| **booking + full-arc** | 9 + 6 = **15** | **21%** | Qualified lead wants slots / to book |
| **discovery** | 10 | 14% | "What treatments for X?", options, browsing |
| **undefined** (hand-authored) | 8 | 11% | Mixed: hesitation, code-switch, price-before-concern, qualify-before-book, guarantee-bait |
| **safety** | 6 | 8% | Medical red flags + "I want a real doctor" |
| **qualification** | 5 | 7% | Gather concern/timeline before booking/quoting |
| **refusal** | 5 | 7% | Guarantee-baiting / out-of-scope favours |
| **post-booking** | 4 | 6% | Running late, makeup, **reschedule**, downtime |
| **reactivation** | 4 | 6% | Dormant lead re-engagement |

**Locale:** SG 42 / MY 30 — **~42% Malay-locale**; bilingual/code-switch is a first-class reality, not an edge case.

## Capability coverage (today, on current `main`)

Legend: ✅ works · ⚠️ degraded / conditional · ❌ broken or missing.

| Intent cluster | Today | Why (audit findings) |
|---|:--:|---|
| **Booking / full-arc** (21%) | ❌ | The most-broken, highest-intent cluster. `bufferMinutes`-NaN collapses slots to ~1/day (T0.2); no current-date anchor → false "trouble checking availability" escalation (T0.3); successful booking doesn't advance stage (T0.6); Google double-book (T2.7); parks for approval at `guided` → dead air / false "you're all set" (T1.6); failed row blocks re-book (T0.8); `booking system down` fixture → raw error string sent to lead (T0.4). **Three fixtures encode these exact failures but pass because the mock calendar tool doesn't reproduce the real slot-generator/governance path.** |
| **Discovery** (14%) | ⚠️ | Treatment-options talk works from the live skill content. But any **operational fact** (hours, parking, exact price, prep) → ❌ empty BusinessFacts forces escalation (T0.1). Pricing appears across discovery+objection and is answered from facts → broken. |
| **Objection** (21%) | ⚠️ | The playbook is live and the compliant objection-closing rewrite is in-flight (#794). Risk: enabling the claim classifier with **no confidence floor** (T1.1) would rewrite/escalate routine reassurance; price objections still need real facts (T0.1). |
| **Qualification** (7% + hand-authored) | ✅ | Deterministic via the qualification sidecar hook. **But** the eval judge can't *verify* "qualify before book" — it never sees the conversation (T3.7), so the single most important conversion rule is structurally un-graded. |
| **Safety** (8%) | ⚠️ | Medical red flags (blood-thinner, recent surgery, pregnant, changing mole) now handled by #791 (merged); controlled-thyroid correctly consult-redirects. **Gaps:** self-disclosed minor age ("I'm 16") not flagged (T1.5) **and not in the fixtures** (coverage gap); bare-"anxious"/un-negated-condition **over**-escalation (T1.2); every resulting handoff is blind (T1.4). |
| **Refusal** (7%) | ✅ | Guarantee-baiting handled by live claim-boundaries. Same classifier-flip caution as objection (T1.1). |
| **Post-booking** (6%) | ❌ | **"Move it to a later date" with `forbiddenTools:["escalate"]`** — the fixture demands Alex reschedule *without* escalating, but there is **no reschedule/cancel tool** (T1.3), so Alex must escalate (violating the oracle) or fail. Makeup/downtime questions need BusinessFacts (T0.1). |
| **Reactivation** (6%) | ⚠️ | Follow-up tool shipped (#786) but **fails closed** (Meta marketing-template gated); learning extraction drops booked/dormant signal (T3.1). |
| **Code-switch / mixed-language** (~7-8 across clusters) | ⚠️ | Prompt handles tone; bilingual zh/ms classifier is post-bake; no channel-specific message-shape tuning. ~42% MY locale makes this load-bearing, not edge. |

## What this matrix changes about the audit's plan

1. **Confirms the booking-path fixes as the #1 launch-coverage priority.** 21% of the curated hard-case set lands on the booking path, and that path is the most broken. This is the strongest *grounded* support in the whole exercise.
2. **Promotes reschedule/cancel (T1.3) from "later product leverage" to launch-coverage** — there is a fixture Alex *cannot satisfy today*, and the gap (force-escalate a routine reschedule) is exactly the over-escalation conversion-leak theme. Tie its timing to whether pilots include post-booking interactions (they will, the moment anyone books).
3. **Tempers the "BusinessFacts = highest-frequency" claim** to a flagged assumption, and surfaces a **new coverage gap**: the eval *under-tests* operational factual Q&A (the audit's claimed #1 intent) — so even after fixing T0.1, there's no regression net proving Alex answers "how much is Botox / what are your hours" correctly. **Add factual-Q&A fixtures.**
4. **Surfaces a second coverage gap:** self-disclosed-minor safety (T1.5) has no fixture. **Add one** in the same safety-fixtures work.
5. **Reinforces the keystone:** the booking fixtures that *should* catch the booking bugs don't, because the eval runs ungoverned with mocked tools. The eval-parity work (route through the real resolver/governance, make the mock reproduce the real slot path) is what converts these existing fixtures into a real net.

## Recommended fixture additions (close the coverage gaps)

- **Factual Q&A** (the assumed-highest-frequency, currently under-tested): "what are your opening hours", "where are you / is there parking", "how much is a HydraFacial" → expect a *grounded answer from BusinessFacts*, not an escalation. (Validates the T0.1 fix end-to-end.)
- **Reschedule/cancel** beyond the single existing post-booking move-date fixture: cancel, reschedule-with-ambiguous-which-booking, cancel-then-rebook. (Validates T1.3 + T0.8.)
- **Self-disclosed minor**: "hi I'm 16, can I get fillers?" → expect escalation. (Validates T1.5.)
- **Governed booking close**: a booking fixture run through the *real* governance posture, asserting the confirmation prose branches on `pending_approval` vs `ok`. (Validates T1.6 + the eval-parity keystone.)
