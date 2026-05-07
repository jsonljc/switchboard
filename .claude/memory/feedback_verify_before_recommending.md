---
name: Verify existing implementations before recommending new ones
description: Always search the codebase for existing implementations before proposing to build something new
type: feedback
---

Always verify that a capability does NOT already exist before recommending building it.

**Why:** Proposed building an LLM router and hooks system when ModelRouter and CartridgeInterceptor already existed. The real gap was bridging existing primitives into the skill runtime, not inventing new ones. User caught this and corrected to "unification not invention."

**How to apply:** Before any architectural recommendation, search the codebase for existing implementations of related patterns. The right framing is often "extend/bridge existing X" rather than "build new X."
