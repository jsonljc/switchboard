---
jurisdiction: both
vertical: medspa
clinicType: both
appliesTo: channel
riskLevel: high
lastReviewedAt: "2026-05-10"
owner: jasonli
sources:
  - "https://business.whatsapp.com/policy"
  - "https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/template-messages/"
---

# WhatsApp 24-hour window & template rules

> **TODO — Phase 1a placeholder.** Phase 1d wires window detection and template selection in the harness.

## 24-hour customer-service window

Free-form replies allowed only within 24h of the user's last inbound message. Each inbound resets the timer.

## Outside the window

Only Meta-pre-approved templates: Utility (appt confirm/reminder/reschedule, receipt), Marketing (promos, re-engagement, package launches), Authentication (OTP).

## Templates support

- Variables (`{{1}}`)
- Buttons: Quick Reply, Call, URL

## Tier

New WABA numbers: 250 business-initiated conversations / 24h. Scales with quality rating.
