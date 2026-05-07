---
name: feedback-interpretive-not-extractive
description: Skills should produce decision-ready intelligence, not just structured data extraction. Add business interpretation, confidence, and data quality signals.
type: feedback
---

When designing skills, shift from "extract structured data" to "produce decision-ready intelligence."

**Why:** Switchboard is an operating system for revenue, not a scraper. Downstream agents (lead qualification, ad optimization, funnel diagnosis) need business understanding, not just fields.

**How to apply — add these to every extraction skill:**

1. **Interpretive fields** — not just `businessName` but also `businessModel` (service/ecommerce/hybrid), `pricePositioning`, `primaryCTA`, `leadIntentType`. These feed directly into other agents.

2. **Confidence + reasoning** — for any judgment the LLM makes, include `{ field, confidence: high|medium|low, reasoning: "brief" }`. Downstream systems need to know reliability, not just answer.

3. **Data completeness signal** — `{ dataCompleteness: high|medium|low, missingFields: [...] }`. Downstream agents need to know "can I trust this profile?"

4. **Structure for future decomposition** — use Step 4A/4B/4C internal headings even in one skill. Makes splitting into sub-skills trivial later.

5. **Test contradictory signals** — add eval cases where tool hint and content disagree (e.g., regex says WordPress but content looks like Shopify). This is exactly where LLMs shine over deterministic logic.
