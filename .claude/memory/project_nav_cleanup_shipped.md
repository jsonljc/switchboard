---
name: Navigation Cleanup Shipped
description: Staff view removed, footer trimmed, dead links cleaned — owner-only navigation shipped 2026-04-21
type: project
originSessionId: db88cf81-51b0-4440-a700-9b1a5a402d50
---

Navigation cleanup shipped 2026-04-21 on feat/login-redesign-and-specs (9 commits).

**What was removed:**

- Entire staff view: StaffNav, StaffMobileMenu, StaffShell, StaffDashboard, view preference hook
- All staff/owner toggle switches (Me page, settings sidebar, mobile menu)
- `/agent/[slug]` singular legacy route (updated storefront URL to `/agents/`)
- Footer: "Build an agent" mailto, "Get started" link
- DevPanel: `/crm`, `/performance` dead links

**What stays:**

- Owner tabs: Today, Hire, Decide, Me (no label changes this pass)
- Public nav: How it works, Pricing, Get early access
- `/agents` + `/agents/[slug]` public catalog (actively wired into funnel)
- All auth routes unchanged
- Settings sidebar: 7 items unchanged

**Flagged for separate pass:**

- `/marketplace` tab resolves to public layout (routing/IA decision, not cleanup)
- Navigation label review: "Hire", "Get early access", "Contact us" may need positioning alignment

**Why:** Owner-first product, agent-visible funnel. Staff view no longer matches product direction. OwnerToday is the real delivered surface.

**How to apply:** No staff view exists. AppShell always renders OwnerShell. Don't recreate staff branching.
