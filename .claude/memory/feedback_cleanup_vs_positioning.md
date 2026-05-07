---
name: Separate cleanup from positioning
description: Don't mix structural cleanup (dead code removal) with semantic repositioning (label changes, IA rewording) in the same pass
type: feedback
originSessionId: db88cf81-51b0-4440-a700-9b1a5a402d50
---

Don't mix structural cleanup with semantic repositioning in the same pass.

**Why:** User corrected the approach when Approach B was recommended (cleanup + label renaming). Cleanup is mechanical and low-risk. Renaming/repositioning is a product decision that deserves its own intent. Mixing them makes the pass harder to review and easier to scope-creep.

**How to apply:** When proposing a cleanup pass, keep it to Remove/Fix/Keep. If naming or positioning changes come up, flag them for a separate pass. Present them as "Approach B for later" rather than bundling.
