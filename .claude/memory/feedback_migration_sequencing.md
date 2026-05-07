---
name: feedback-migration-sequencing
description: Migration sequencing principle — deterministic-heavy domains before latent-heavy, and SP2 defines the pattern all future domains follow
type: feedback
---

When sequencing domain migrations from TypeScript to skills:

1. **Deterministic-heavy before latent-heavy.** Lifecycle (stage transitions, validation) before dialogue (tone, emotion, ambiguity). Stabilize the deterministic layer first so latent domains sit on a proven base. Otherwise you'll think the system is broken when it's actually model variability.

2. **SP2 defines the pattern, not just ships a domain.** Treat the second migration as pattern-definition: skill structure, tool boundary clarity, resolver discipline, error handling pattern, eval framework reuse. Speed comes later.

3. **Don't translate TypeScript 1:1 into markdown.** Rewrite as a decision process. Let the model generalize instead of hardcoding rules. `if contains "shopify" → shopify` becomes "analyze page structure, identify platform signals, infer most likely platform."

4. **Speed vs learning tradeoff.** SP2 slow and deliberate. SP3-4 faster, reuse patterns. SP5+ accelerate. Going too fast copies patterns blindly and calcifies mistakes.

**Why:** Debugging latent (LLM judgment) failures is much harder than deterministic failures. Model variability in dialogue/emotional classification will look like system bugs if the deterministic foundation isn't locked down first.

**How to apply:** Correct sequence is website-scanner → handoff → lifecycle → dialogue → ad-optimizer → creative-pipeline. Each migration must validate: skill structure, tool boundaries, error handling, and eval reuse.
