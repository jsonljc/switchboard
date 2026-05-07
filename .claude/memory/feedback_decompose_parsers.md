---
name: Decompose parsers into per-section pure functions
description: Interview/extraction logic should be split into small pure functions per section, not monolithic switches
type: feedback
originSessionId: cc202c1e-90dc-42d0-8aaf-7ddcff19c513
---

When implementing response parsing or data extraction, split into per-section pure functions (e.g., `parseBusinessIdentityResponse`, `parseServicesResponse`) rather than a monolithic switch statement.

**Why:** A single switch with inline parsing becomes stringly-typed sludge that leaks low-quality data into structured models. Pure per-section functions are testable, replaceable, and make confidence boundaries explicit.

**How to apply:** Create a separate file (e.g., `interview-parsers.ts`) with one exported function per section. Each returns a typed result or `null`. The engine delegates to them. When parsing confidence is low, preserve raw text in an `unparsedInput` field rather than pretending it's structured.
