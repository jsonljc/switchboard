# WhatsApp / Meta Tech Provider — autonomous slice loop

Follow `.claude/build-loop.md` autonomously to work the **WhatsApp / Meta Tech Provider** workstream
(WORKSTREAM = launch) residual _code_ backlog, ONE PR-sized slice per iteration, highest-leverage
first. Use your own judgment end to end via the superpowers process: **brainstorming -> writing-plans
-> executing-plans -> requesting/receiving-code-review**. Do NOT check in with me between slices.
Skip brainstorming only for trivial mechanical slices (the build-loop task-size gate decides).

## Source of truth (verify before building)

- Memory `project_whatsapp_tech_provider_roadmap` (esp. the 2026-06-16 VIDEO-readiness + residual-code blocks).
- Audit `docs/audits/2026-06-15-meta-tech-provider/` (A ads/CAPI, B whatsapp, C connect surface, D external, E config).
- Ground truth beats the dated audit: grep producer AND consumer + `pnpm typecheck` and confirm "is this
  already done?" against origin/main FIRST. Many audit items already shipped ([[feedback_audit_blockers_already_done]]).

## Backlog (work in this order; re-confirm each, pivot to the next if it is already done or blocked on META-side config, not code)

1. **WhatsApp credit-line sharing** — **DESCOPED 2026-06-16 (user decision: onboarded clients SELF-PAY;
   see memory `project_whatsapp_tech_provider_roadmap` billing-model block). DO NOT BUILD.** It only applies
   under consolidated/agency billing on a Meta-granted shareable extended credit line we do not have, is not a
   Tech-Provider App Review blocker, and is un-activatable today (zero credit-line code or provisioning path).
   Skip to item 2. Revisit only if the billing model flips to consolidated.
2. **Instagram adapter Graph version** `v17.0` -> `v21.0` (`apps/chat/src/adapters/instagram.ts:84`) to match
   the rest of the stack. Mechanical/trivial (skip brainstorm). No stop-glob -> eligible for autonomous merge.
3. **Dedicated WhatsApp webhook verify-token** (vs reusing the shared token). Confirm it is a real gap first;
   security hygiene. `META_WEBHOOK_VERIFY_TOKEN` is already env-allowlisted.
4. **WhatsApp Flows registration**. `apps/chat/src/__tests__/whatsapp-flows.test.ts` exists (inbound handling
   present) -> confirm whether outbound flow _registration_ with Meta is the actual missing piece before scoping.
5. **Number migration** (request_code/verify_code cross-account porting). Only if 1-4 are done and you judge it
   worth a slice; it is niche/complex and was surfaced-but-not-built earlier.

## Authority & quality bar (non-negotiable; "cover ground WITHOUT losing quality")

Follow the build-loop authority model exactly. **Auto-merge a slice ONLY when ALL hold**: touches no merge-stop
glob (prisma/auth/billing/payment/consent/credential/governance/external-send/allowlist), all local gates green,
CI green, a FRESH-CONTEXT independent review returns ZERO findings at severity >= warn, and you are high-confidence.
Any credential / onboarding / money / auth / schema slice -> **SURFACE the PR for my merge call** (open with the
evidence summary, do not merge). If the independent review finds something you cannot cleanly resolve, gates stay
red after the capped attempts, or confidence is low -> SURFACE and move on. Never lower the bar to keep moving.
No em-dashes; lowercase Conventional-Commit subjects; TDD RED proof per step.

## Mechanics

- One fresh worktree per slice under `.claude/worktrees/<slug>` off fresh origin/main; run `pnpm worktree:init`.
  Tear it down (`git worktree remove` + prune) the moment the slice merges or is abandoned.
- Per-slice ledger `.claude/<slug>-loop-state.md` (uncommitted scratch). On landing, update the memory note and
  write any durable lesson to a `feedback_*.md` + a `MEMORY.md` pointer.
- Re-fetch origin/main each slice; three-dot diffs; pre-merge divergence re-check; never touch other sessions' worktrees.

## Stop + report (do NOT invent work to keep the loop alive)

STOP and give a final report when: the backlog above is exhausted; OR every remaining item is blocked on META-side
config rather than code; OR a slice needs a product/scope decision you cannot make from the code alone. Report:
what merged, what is open awaiting my merge (with PR links), what is left and why.
