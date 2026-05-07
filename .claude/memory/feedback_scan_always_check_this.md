---
name: Scan data always enters as check_this
description: Scan-hydrated playbook fields must never be marked ready — only user-confirmed content becomes ready
type: feedback
originSessionId: cc202c1e-90dc-42d0-8aaf-7ddcff19c513
---

Scan-hydrated fields always enter as `check_this`, never `ready`. Only user-confirmed or directly entered content should be `ready`.

**Why:** The playbook-first model requires owner confirmation. Silently upgrading draft data to "ready" based on scan confidence breaks the trust contract — even high-confidence scan data might be wrong.

**How to apply:** Any transformer that maps external data (scan results, LLM extraction, third-party imports) into the playbook must default to `check_this` status and `scan`/`interview` source. The `ready` status is reserved for manual confirmation.
