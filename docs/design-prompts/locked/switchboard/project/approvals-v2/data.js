/* Mock fixtures for /approvals
   Shape mirrors GET /api/approvals/pending and /api/approvals/:id
   (see packages/schemas/src/approval-lifecycle.ts).
   Context: Aurora Aesthetics, a Singapore medspa operator.
*/
window.APPROVALS_DATA = (() => {
  const now = Date.now();
  const min = 60_000;
  const hr = 60 * min;

  // 32-hex-char binding hashes (deterministic-looking, not real)
  const h = (s) => "0x" + s;

  const pending = [
    {
      id: "apr_2f1a08",
      envelopeId: "env_2f1a08c4",
      summary: "Refund SGD 4,820 to client #SG-44120 for adverse reaction during HydraFacial session",
      riskCategory: "critical",
      status: "pending",
      bindingHash: h("2f1a08c4e9b1d7a4f0c3b8a5d2e7f1a9"),
      createdAt: now - 41 * min,
      expiresAt: now + 4 * min + 12_000,           // < 5 min — surfaced in fixture per spec
      agent: "billing-agent",
      requestedBy: "Billing",
      request: {
        action: "billing.refund.issue",
        parametersSnapshot: {
          accountId: "SG-44120",
          amount: 4820,
          currency: "SGD",
          reason: "adverse_reaction_treatment",
          rail: "stripe.refund",
          memo: "HydraFacial 2026-05-08 — adverse reaction, full refund per care policy"
        },
        approvers: ["you", "kira.l"],
        approvalsRequired: 2
      },
      state: { approvalHashes: [], respondedBy: null, respondedAt: null }
    },
    {
      id: "apr_9b73c1",
      envelopeId: "env_9b73c1aa",
      summary: "Send promo SMS (15% off May) to 4,208 lapsed clients — PDPA-opted-in, SG locale",
      riskCategory: "high",
      status: "pending",
      bindingHash: h("9b73c1aa4f1d6c92e2a5b8d1f4c7e0a3"),
      createdAt: now - 22 * min,
      expiresAt: now + 38 * min,
      agent: "growth-agent",
      requestedBy: "Growth",
      request: {
        action: "comms.sms.broadcast",
        parametersSnapshot: {
          channel: "sms.twilio",
          segment: "lapsed_90d_sg_pdpa_optin",
          recipients: 4208,
          copy: "Hi {first_name}, we miss you at Aurora. 15% off any treatment this May with MAY15. Reply STOP to opt out.",
          sendWindow: "Today 14:00–17:00 SGT",
          promoCode: "MAY15",
          estimatedCost: "SGD 252.48"
        },
        approvers: ["you", "kira.l", "marcus.t"],
        approvalsRequired: 3,
      },
      // 2 of 3 already approved — operator is the third
      state: { approvalHashes: ["0xK1RA", "0xMARC"], respondedBy: null, respondedAt: null }
    },
    {
      id: "apr_d77c20",
      envelopeId: "env_d77c20b7",
      summary: "Apply 25% loyalty discount on Botox renewal · order #SG-44109",
      riskCategory: "medium",
      status: "pending",
      bindingHash: h("d77c20b73f6b9c2e5d8a1f4c7b0e3a6d"),
      createdAt: now - 18 * min,
      expiresAt: now + 42 * min,
      agent: "support-agent",
      requestedBy: "Care",
      request: {
        action: "billing.discount.apply",
        parametersSnapshot: {
          orderId: "SG-44109",
          clientId: "SG-19224",
          clientTier: "platinum",
          treatment: "Botox renewal · forehead + glabella",
          basePriceSGD: 1280,
          discountPct: 10,
          memo: "Initial 10% per loyalty policy"
        },
        approvers: ["you"],
        approvalsRequired: 1
      },
      // Worked example for patch flow: previously patched draft on the wire
      patchProposal: {
        proposedBy: "you",
        proposedAt: now - 2 * min,
        diff: { discountPct: 25, memo: "Customer churn-risk; tier exception applies. Bumping to 25% to retain." }
      },
      state: { approvalHashes: [], respondedBy: null, respondedAt: null }
    },
    {
      id: "apr_4e082a",
      envelopeId: "env_4e082afc",
      summary: "Rotate prod read-replica credentials · aurora-bookings-db",
      riskCategory: "high",
      status: "pending",
      bindingHash: h("4e082afc18d2c5e8b1a4f7d0c3e6b9d2"),
      createdAt: now - 9 * min,
      expiresAt: now + 51 * min,
      agent: "ops-agent",
      requestedBy: "Ops",
      request: {
        action: "infra.db.rotate-credentials",
        parametersSnapshot: {
          host: "aurora-bookings-db.replica.sg",
          engine: "postgres 15",
          rotation: "read-replica only",
          downtimeEstimate: "0s",
          rollbackPlan: "stored-snapshot 12h"
        },
        approvers: ["you", "kira.l"],
        approvalsRequired: 2
      },
      // 1-of-2 quorum
      state: { approvalHashes: ["0xK1RA"], respondedBy: null, respondedAt: null }
    },
    {
      id: "apr_55ab10",
      envelopeId: "env_55ab10d2",
      summary: "Charge no-show fee SGD 80 to client #SG-9221 (CoolSculpting 2026-05-12)",
      riskCategory: "low",
      status: "pending",
      bindingHash: h("55ab10d2e7f4a1c8b5e2a9d6c3f0b7e4"),
      createdAt: now - 4 * min,
      expiresAt: now + 2 * hr,
      agent: "billing-agent",
      requestedBy: "Billing",
      request: {
        action: "billing.fee.apply",
        parametersSnapshot: {
          clientId: "SG-9221",
          appointmentId: "appt_88412",
          amount: 80,
          currency: "SGD",
          reason: "no_show_under_24h",
          policy: "cancellation.v3"
        },
        approvers: ["you"],
        approvalsRequired: 1
      },
      state: { approvalHashes: [], respondedBy: null, respondedAt: null }
    },
    {
      id: "apr_a44f02",
      envelopeId: "env_a44f02b5",
      summary: "Update IPL Hair Removal package prices · +12% across 6 tiers",
      riskCategory: "medium",
      status: "pending",
      bindingHash: h("a44f02b5d8e1c4f7a0c3e6b9d2f5a8c1"),
      createdAt: now - 12 * min,
      expiresAt: now + 5 * hr + 22 * min,
      agent: "ad-optimizer",
      requestedBy: "Growth",
      request: {
        action: "catalog.price.update",
        parametersSnapshot: {
          catalog: "ipl_hair_removal_2026",
          tiersAffected: 6,
          adjustmentPct: 12,
          effectiveAt: "2026-05-15T00:00:00+08:00",
          rationale: "Q2 cost-pass-through; matches reference set in S2 review"
        },
        approvers: ["you"],
        approvalsRequired: 1
      },
      state: { approvalHashes: [], respondedBy: null, respondedAt: null }
    },
    {
      id: "apr_19fe44",
      envelopeId: "env_19fe44a7",
      summary: "Reschedule 14 appointments after laser tech sick-leave (Wed 14 May)",
      riskCategory: "low",
      status: "pending",
      bindingHash: h("19fe44a7c2e5b8d1f4c7e0a3b6d9c2f5"),
      createdAt: now - 88 * min,
      expiresAt: now + 6 * hr,
      agent: "bookings-agent",
      requestedBy: "Bookings",
      request: {
        action: "calendar.reschedule.bulk",
        parametersSnapshot: {
          count: 14,
          fromDate: "2026-05-14",
          windowSearch: "next_4_business_days",
          notify: "sms+email",
          notifyTemplate: "tech_unavailable_v2"
        },
        approvers: ["you"],
        approvalsRequired: 1
      },
      state: { approvalHashes: [], respondedBy: null, respondedAt: null }
    },
    {
      id: "apr_c81b33",
      envelopeId: "env_c81b33f6",
      summary: "Purge 4,210 inactive guest sessions older than 30d (PDPA retention)",
      riskCategory: "high",
      status: "pending",
      bindingHash: h("c81b33f6a9d2c5e8b1a4f7d0c3e6b9d2"),
      createdAt: now - 33 * min,
      expiresAt: now + 90 * min,
      agent: "data-agent",
      requestedBy: "Ops",
      request: {
        action: "data.session.purge",
        parametersSnapshot: {
          rows: 4210,
          table: "session_guest_v2",
          oldestRow: "2026-03-30",
          backupAvailable: false,
          reversible: false
        },
        approvers: ["you"],
        approvalsRequired: 1
      },
      state: { approvalHashes: [], respondedBy: null, respondedAt: null }
    },
    {
      id: "apr_2e9bd1",
      envelopeId: "env_2e9bd14c",
      summary: "Issue SGD 500 service voucher · client #SG-77104 (post-treatment complaint)",
      riskCategory: "medium",
      status: "pending",
      bindingHash: h("2e9bd14c7a0d3f6b9e2c5a8d1f4c7e0a"),
      createdAt: now - 4 * hr,
      expiresAt: now + 18 * hr,
      agent: "support-agent",
      requestedBy: "Care",
      request: {
        action: "billing.voucher.issue",
        parametersSnapshot: {
          clientId: "SG-77104",
          amount: 500,
          currency: "SGD",
          expiresDays: 180,
          memo: "Goodwill voucher per Care escalation #ESC-3318"
        },
        approvers: ["you"],
        approvalsRequired: 1
      },
      state: { approvalHashes: [], respondedBy: null, respondedAt: null }
    },
    {
      id: "apr_f01a99",
      envelopeId: "env_f01a99e2",
      summary: "Scale daily ad budget · Cleaning treatments · +20%",
      riskCategory: "low",
      status: "pending",
      bindingHash: h("f01a99e2b5c8d1f4a7c0e3b6d9c2f5a8"),
      createdAt: now - 2 * hr,
      expiresAt: now + 3 * hr,
      agent: "ad-optimizer",
      requestedBy: "Growth",
      request: {
        action: "ads.budget.scale",
        parametersSnapshot: {
          adset: "Cleaning · retarget · 30d",
          currentBudget: "SGD 200/day",
          proposedBudget: "SGD 240/day",
          guardrail: "+25% max",
          roas7d: 4.1
        },
        approvers: ["you"],
        approvalsRequired: 1
      },
      state: { approvalHashes: [], respondedBy: null, respondedAt: null }
    },
    {
      id: "apr_b21d7f",
      envelopeId: "env_b21d7f4e",
      summary: "Push updated PDPA consent form (v4) to all booking flows",
      riskCategory: "high",
      status: "pending",
      bindingHash: h("b21d7f4e8c1a5f2d7b3e6a9c2f5d8e1b"),
      createdAt: now - 26 * min,
      expiresAt: now + 90 * min,
      agent: "compliance-agent",
      requestedBy: "Ops",
      request: {
        action: "cms.consent.publish",
        parametersSnapshot: {
          documentId: "pdpa_consent_v4",
          replaces: "pdpa_consent_v3",
          effectiveAt: "immediate",
          surfaces: ["web", "ios", "android", "kiosk"],
          legalReviewer: "S. Lim (Counsel)"
        },
        approvers: ["you", "kira.l"],
        approvalsRequired: 2
      },
      state: { approvalHashes: [], respondedBy: null, respondedAt: null }
    },
    {
      id: "apr_e0c4a5",
      envelopeId: "env_e0c4a5d1",
      summary: "Run GDPR/PDPA data export · subject sarah.k@example.com",
      riskCategory: "medium",
      status: "recovery_required",
      bindingHash: h("e0c4a5d1b8e3a6c9f2d5b8e1a4d7c0e3"),
      createdAt: now - 6 * hr,
      expiresAt: now + 18 * hr,
      agent: "compliance-agent",
      requestedBy: "Ops",
      request: {
        action: "compliance.gdpr.export",
        parametersSnapshot: {
          subject: "sarah.k@example.com",
          deliverBy: "2026-05-18",
          format: "json+csv bundle",
          scope: ["orders", "sessions", "support_threads", "treatment_notes"]
        },
        approvers: ["you"],
        approvalsRequired: 1
      },
      recovery: {
        reason: "Upstream cartridge `compliance-export@1.4.2` returned 502 during dry-run binding capture.",
        proposedFix: "Re-run the binding capture; lifecycle will be re-instantiated with a fresh parametersSnapshot.",
        lastAttemptAt: now - 11 * min
      },
      state: { approvalHashes: [], respondedBy: null, respondedAt: null }
    }
  ];

  // history (separate tab — not the focus, but used for the "last cleared" empty state)
  const lastCleared = now - 13 * min;

  return {
    pending,
    lastCleared,
    currentUser: { id: "you", display: "You · MN", initials: "MN" },
    org: "Aurora Aesthetics · Orchard"
  };
})();
