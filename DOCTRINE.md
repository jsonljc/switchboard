# Switchboard Doctrine: Execution Sovereignty in Agent Systems

## 1. Execution Sovereignty

Only Switchboard can execute privileged actions.

Agents can:
- Propose
- Analyze
- Suggest

Agents cannot:
- Hold credentials
- Execute mutations directly
- Bypass approval
- Modify production state

Switchboard is the only entity allowed to:
- Call Meta Marketing API
- Inject credentials
- Mutate campaigns
- Restore snapshots

Execution authority is centralized. Always.

## 2. Blind Agents

Agents are intentionally blind to credentials.

- No API keys in agent memory.
- No OAuth tokens exposed.
- No `.env` secrets accessible.
- No raw Meta endpoints callable from agent context.

If an agent is compromised, there must be nothing usable to steal.

Blindness is a feature, not a limitation.

## 3. Sealed Approvals

Mutations require sealed, payload-bound approval tokens.

Every mutating action must require:
- `approval_token`
- `snapshot_id`
- `idempotency_key`

The approval token must:
- Be bound to the exact payload hash
- Expire quickly
- Be single-use
- Be clinic-scoped

If the payload changes → token invalid.
No token → no execution.

## 4. Snapshot Before Mutation

Every state change must be reversible.

Before any mutation:
- Capture Last Known Good State.
- Store structural metadata.
- Timestamp and hash the snapshot.

After mutation:
- Verify outcome.
- Log before/after diff.

Revert must:
- Be callable from Telegram.
- Require approval for destructive restore.
- Restore deterministically.

Undo is not optional. It is structural.

## 5. Deterministic Gates Over Model Judgment

Models suggest. Code decides.

All guardrails must be implemented as deterministic logic:
- Budget delta caps
- Max entity mutation limits
- Minimum data thresholds
- Cooldowns after revert
- Step count limits
- Duplicate call detection

Never rely on:
- Prompt instructions
- "Please behave"
- Model-based risk scoring alone

Governance must survive model failure.

## 6. Tool Boundary Is the Governance Boundary

The MCP tool layer is the only mutation surface.

All privileged actions must exist only as Switchboard tools.

Agents may have other tools. They may browse. They may reason.

But they cannot execute privileged actions except through Switchboard.

The tool boundary is the control boundary.

## 7. Audit Is Non-Optional

Every action must generate:
- Who requested
- What was proposed
- What was approved
- What changed
- Verification result
- Snapshot reference

If something breaks, you must be able to replay history.

Receipts over intelligence.

## 8. FinOps and Loop Control

Autonomy must have cost ceilings.

Switchboard must enforce:
- Step count limits
- Repeated identical call detection
- Token budget ceilings
- Anomaly kill switches
- Forced human escalation

No infinite loops. No runaway spend.

## 9. Replaceable Cognition

Models are replaceable. Governance is not.

Switchboard must not depend on:
- Manus
- OpenClaw
- Claude
- OpenAI
- Any specific LLM

You can swap models tomorrow.
You cannot swap governance without breaking trust.

## 10. Clinics Don't Buy Intelligence

They buy:
- Stability
- Predictability
- Undo
- Clear receipts
- Human approval control

If a feature increases intelligence but decreases control, it violates the doctrine.

---

## The Core Mental Model

**Agent:** "Here's what I think we should do."

**Switchboard:** "Here's what is allowed. Here's what is approved. Here's what is executed. Here's how to undo it."

## The One Sentence That Keeps You Sane

> Switchboard does not govern agents. Switchboard governs execution.

If you follow this document strictly, you don't need:
- Hook governance
- Platform dependence
- Impossible tool lockdown fantasies

You only need:
- Credential sovereignty
- Deterministic gates
- Tool boundary enforcement
- Snapshot + revert

And that's buildable.
