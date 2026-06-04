# Alex vs Meta Business Agent: Strategy v2

> Decision record from an adversarially reviewed strategy session, 2026-06-04.
> Review method: four independent reviews of a v1 recommendation (technical
> refutation against the codebase, codebase fact-check, strategy steelman of
> the opposite position, market research). Verdict: core thesis sustained,
> two planks amended, one factual error in the v1 audit corrected.
> Companion doc: `north-star.md` in this directory.

## Context (market facts, as researched 2026-06-04)

- Meta Business Agent (BizAI/Omnibot) went **globally available 2026-06-03**,
  free tier, explicitly covering "answer questions, recommend products, book
  appointments, qualify sales leads, reroute to a person."
- Meta **banned general-purpose third-party AI assistants** from the WhatsApp
  Business API (January 2026). Bounded task automation (qualify/book/handoff)
  remains permitted.
- There is **no public bring-your-own-agent (BYOA) API**. The EU-region
  "reopening" is a per-message fee framework the EU Commission has called
  equivalent to the prior ban. Meta's third-party platform offering builds
  agents on Meta's brain, the inverse of BYOA.
- Web-sourced claims above came from subagent research; spot-check before
  quoting externally.

## Decisions

### 1. Own the loop, permanently

Alex's brain (generation), governance (ingress, approval lifecycle), and audit
trail (WorkTrace) are non-negotiable Switchboard property. No architecture in
which Meta's model generates customer-facing text.

This is now overdetermined: (a) control-grade governance requires owning the
turn, (b) BizAI carries zero SG/MY regulatory logic, (c) Meta policy forbids
delegating an open-ended 3P generation layer anyway.

**Principled boundary (replaces v1's categorical rule):** the moat decomposes
into _inspection-grade_ compliance (claim scanning, consent checks, audit
logging: these could survive at an egress layer over someone else's generator)
and _control-grade_ governance (turn sequencing, deterministic escalation
timing, approval-as-lifecycle: these require owning the loop). Own the loop
wherever control-grade governance is legally load-bearing. For Alex in medspa,
that is everywhere.

### 2. No BYOA hedge; channel portability is the hedge

v1 hedged on Meta's BYOA Agent Integration API. That plank is deleted: the API
does not exist publicly and Meta is litigating to avoid offering it.

The real revocation insurance is channel plurality: Telegram and Slack are
live, web/SMS are candidates. WhatsApp is treated as a revocable channel owned
by a direct competitor that has shown ban → fee-wall → first-party-competitor
behavior within five months, not as neutral distribution.

**Re-open condition:** if a BYOA-shaped integration opens for Switchboard's
tier, adopt it as a channel adapter only if all three hold: (i) Switchboard
retains egress block authority, (ii) audit-log export is preserved, (iii) the
customer/billing relationship stays with Switchboard. Fail any one, no-go.

### 3. Sequencing: pilot first, moat second, engine last

Do not bridge Meta's engine gap for parity. Every engineering hour spent
making Alex more comparable to BizAI is spent on the losing axis; hours spent
on attribution depth and enforced compliance make Alex less comparable, which
is the winning axis.

Order of work:

1. Clear Meta's gates (Business Verification, App Review, template approval):
   externally paced, already critical path.
2. Flip compliance scanners observe → enforce per gate after the 14-day bake;
   calibrate claim boundaries to SG specifics (no before/after references, no
   branded-product naming, no superiority/outcome claims).
3. Pilot: one clinic, attributed booked revenue > 0, visible end to end.
4. Deepen attribution: `attended`/`paid` CAPI emission sites, then Google
   Offline Conversions (Stage 3 plan deliverables 4 and 5).
5. Engine work only when a pilot failure points at it.

Opportunistic at any point: wire the already-built ModelRouter (see appendix).

Explicitly deferred: resumable mid-loop approvals (quarter-scale rebuild of
the submission lifecycle), eval gating (blocked on baseline bake + CI secret),
retrieval infrastructure, scale/latency infrastructure, voice.

### 4. Positioning: license protection, not governance premium

The buyer is the clinic owner / medical director whose personal registration
is exposed under HCSA/MOH advertising rules and PDPA. Fear ordering: medical
board first, Meta last.

Pitch headline: **the SG/MY medical-advertising-safe agent that protects the
doctor's license.** Audit trail, approval workflows, and revenue attribution
are the proof points, not the headline. "Better agent than free BizAI" is not
the pitch and never will be; "BizAI cannot know SG medical advertising law,
and your license is the collateral" is.

### 5. Product-policy invariant: bounded task agent

Alex remains a bounded task-automation surface (qualify, book, handoff). It
must never present as, or drift toward, an open-ended general-purpose
chatbot. Two independent reasons:

- Meta's January 2026 policy permits task automation and bans general-purpose
  3P assistants; staying task-bounded is a channel-compliance requirement.
- Claim scanning stays tractable only over a bounded conversational surface.

**Tier note:** this is a product-policy invariant, deliberately _not_ added to
`docs/DOCTRINE.md`, which scopes itself to architecture and excludes product
decisions. If doctrine-tier enforcement is wanted later, the mechanism would
be a skill-lint over `skills/alex/SKILL.md` (scope assertions) plus the
existing escalation rule that out-of-scope queries hand off to a human.

## What would change these decisions

- BYOA opens for Switchboard's tier and passes the three-condition test in §2.
- Meta excludes medical services from BizAI in SG/MY (strengthens §4, relaxes
  urgency on nothing).
- Meta re-prices WhatsApp Business API such that pilot unit economics break
  (accelerates channel-portability work in §2).
- A pilot failure attributable to single-submission reasoning depth
  (re-prioritizes the resumable-loop rebuild in §3).

## Appendix: technical findings from the review (codebase facts)

Recorded here because the v1 analysis got them wrong and they affect costing:

- **Two disconnected constraint regimes.** Governance `ExecutionConstraints`
  (`packages/core/src/platform/governance/default-constraints.ts`,
  `maxLlmTurns: 1`) feed only the GovernanceGate decision and never reach the
  executor. The executor runs `DEFAULT_SKILL_RUNTIME_POLICY`
  (`packages/core/src/skill-runtime/types.ts`, `maxLlmTurns: 6`) and already
  implements a full reason/act/observe tool loop
  (`packages/core/src/skill-runtime/skill-executor.ts`). Alex is not
  single-turn today.
- **ModelRouter is built but unwired.** A complete Haiku/Sonnet/Opus tiering
  router exists (`packages/core/src/model-router.ts`), the executor resolves a
  tier per turn, and the Anthropic adapter honors per-call model. The
  bootstrap site (`apps/api/src/bootstrap/skill-mode.ts`) passes
  `router = undefined`, so production runs flat Sonnet. Wiring is days, not a
  project.
- **Mid-loop approval parking is unrepresentable.** `SkillMode.execute` has
  two terminal outcomes; a hook returning `pending_approval` mid-loop is
  re-injected as tool output and the loop continues. A ReAct loop that pauses
  for human approval and resumes requires a resumable-submission rebuild of
  the submission/WorkTrace lifecycle: roughly a quarter of work. This is the
  real engine gap, and it is deferred (§3).
- **The eval harness cannot catch routing or hook regressions.** The
  alex-conversation eval builds its executor with no router and no hooks and a
  pinned model; its CI job is non-blocking pending a 14-day baseline bake and
  a working `ANTHROPIC_API_KEY` Actions secret.
