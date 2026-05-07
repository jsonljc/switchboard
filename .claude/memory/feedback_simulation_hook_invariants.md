---
name: Simulation hook safety invariants
description: When extending HookResult with substituteResult, enforce invariant that substituteResult requires decision=undefined. Also inject simulation system prompt to prevent LLM from speaking as if actions happened.
type: feedback
originSessionId: ce279968-e518-40a8-9dfc-7670d740c16c
---

When modifying the execution engine's hook contract (HookResult.substituteResult):

1. **Invariant:** `substituteResult` is ONLY allowed when `proceed=false` AND `decision` is undefined. If both `decision` and `substituteResult` are set, behavior is ambiguous. Assert this at runtime.

2. **LLM hallucination risk:** Returning `ok({ simulated: true })` gives the LLM flow continuity, but without explicit instruction, the LLM may speak as if actions actually happened ("Your booking is confirmed"). Inject a system message: "You are in simulation mode. Actions are not real. Always communicate that outcomes are simulated."

**Why:** The execution loop is the highest-risk path. Small contract ambiguities compound into hard-to-debug issues. LLM behavior follows the path of least resistance — if results look successful, it narrates success.

**How to apply:** Any future HookResult extensions must maintain clean mutual exclusivity between fields. Any simulation/dry-run mode must include prompt-level guardrails, not just data-level markers.
