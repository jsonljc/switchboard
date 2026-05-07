---
name: Alex Wedge Live Wiring
description: Activated converged skill runtime and wired calendar booking into Alex WhatsApp path. Shipped 2026-04-18.
type: project
originSessionId: a7cafa96-6945-4c27-9a7f-60a9f3820859
---

Skill runtime activated and Alex booking wired. Shipped 2026-04-18 (PR #210).

**What shipped:**

- SkillMode registered in API server alongside CartridgeMode
- Skill intents (`{slug}.respond`) registered with `mode: "skill"` for deterministic routing
- Chat→API delegation via HttpPlatformIngressAdapter (chat is transport edge, API executes)
- Gateway connection loader supports all channel types (was Telegram-only)
- `createCalendarBookTool` exported and wired in tools map
- Alex skill prompt updated: slot query → numbered list → deterministic selection → booking create → confirmation
- businessHours added to OrganizationConfig, seeded for demo org
- Runtime observability: deployment resolution, mode dispatch, tool call logs

**Remaining gap:** Calendar-book tool uses stub CalendarProvider that returns empty slots and throws on booking. Real `GoogleCalendarAdapter` wires in when a `google_calendar` connection is provisioned for the org. This is a connection-provisioning step, not more architecture.

**Next move:** Live validation pass — provision real Google Calendar connection, run one end-to-end WhatsApp conversation through the full booking path.

**How to apply:** Do not build more infrastructure. The next action is operational: provision a real calendar connection and test the full lead→qualify→slots→book→event→ROI path.
