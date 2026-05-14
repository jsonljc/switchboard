/* /reports — three fixtures matching schema at packages/schemas/src/reports/v1.ts
   Context: Aurora Aesthetics, Singapore medspa.
   All monetary values are in SGD CENTS (per backend contract — fmtSGD does the divide).
*/

window.REPORTS_FIXTURES = (() => {

  // ── helpers ──────────────────────────────────────────────────────────────
  const sgd = (dollars) => Math.round(dollars * 100);    // dollars → cents
  const cents = (c) => c;                                // cents passthrough (clarity)

  // ── THIS MONTH — goodFixture (the showcase) ─────────────────────────────
  const THIS_MONTH = {
    label: "THIS MONTH",
    period: "APR 1 — APR 30",
    dateFolio: "APR 1 — APR 30",
    pullquote: {
      pre:  "Your team earned you ",
      value: "S$14,720",
      mid:  " in attributed pipeline this month against ",
      cost: "S$612",
      post: " paid. Riley caught the creative-fatigue dip on Apr 8 before it cost you a weekend; Alex pulled three replies back from cold."
    },
    attribution: {
      total: sgd(14720),
      delta: { kind: "pos", text: "↑ 22% vs Mar" },
      riley: { value: sgd(9180), caption: "ad-driven leads converted" },
      alex:  { value: sgd(5540), caption: "reply conversions" }
    },
    funnel: [
      { stage: "Impressions",    n: 342_000, label: "342k",  delta: { kind: "pos",  text: "↑ 8%"  } },
      { stage: "Clicks",         n: 4_182,   label: "4,182", delta: { kind: "pos",  text: "↑ 3%"  } },
      { stage: "Landing visits", n: 3_896,   label: "3,896", delta: { kind: "flat", text: "—"    } },
      { stage: "Leads",          n: 247,     label: "247",   delta: { kind: "pos",  text: "↑ 14%" } },
      { stage: "Bookings",       n: 47,      label: "47",    delta: { kind: "pos",  text: "↑ 9%"  } },
    ],
    funnelNarrative: {
      marker: "Riley · Apr 22",
      text: "CTR is sitting above the medspa benchmark of 1.1%. Spring-Hydrafacial is doing most of the lift; Q2-Lookalikes is dragging the average and probably wants pausing or fresh creative."
    },
    campaigns: [
      { name: "Spring-Hydrafacial",   spend: sgd(620),  impressions: 138_400, inlineLinkClicks: 1_842, costPerInlineLinkClick: sgd(0.34), inlineLinkClickCtr: 0.0133, leads: 88, revenue: sgd(6240), cpl: sgd(7.05),  clickToLeadRate: 0.0478, roas: 10.06 },
      { name: "Botox-Touchup-Q2",     spend: sgd(410),  impressions: 76_200,  inlineLinkClicks: 982,   costPerInlineLinkClick: sgd(0.42), inlineLinkClickCtr: 0.0129, leads: 41, revenue: sgd(2890), cpl: sgd(10.00), clickToLeadRate: 0.0418, roas: 7.05 },
      { name: "Retargeting-30d",      spend: sgd(217),  impressions: 41_800,  inlineLinkClicks: 612,   costPerInlineLinkClick: sgd(0.35), inlineLinkClickCtr: 0.0146, leads: 58, revenue: sgd(3420), cpl: sgd(3.74),  clickToLeadRate: 0.0948, roas: 15.76 },
      { name: "Skin-Booster-Search",  spend: sgd(168),  impressions: 22_900,  inlineLinkClicks: 384,   costPerInlineLinkClick: sgd(0.44), inlineLinkClickCtr: 0.0168, leads: 28, revenue: sgd(1980), cpl: sgd(6.00),  clickToLeadRate: 0.0729, roas: 11.79 },
      { name: "Lookalike-Q2-Wide",    spend: sgd(412),  impressions: 58_900,  inlineLinkClicks: 318,   costPerInlineLinkClick: sgd(1.30), inlineLinkClickCtr: 0.0054, leads: 9,  revenue: sgd(190),  cpl: sgd(45.78), clickToLeadRate: 0.0283, roas: 0.46 },
      { name: "TikTok-Discovery",     spend: sgd(285),  impressions: 81_400,  inlineLinkClicks: 442,   costPerInlineLinkClick: sgd(0.64), inlineLinkClickCtr: 0.0054, leads: 6,  revenue: sgd(0),    cpl: null,       clickToLeadRate: 0.0136, roas: 0.00 },
    ],
    cost: {
      paid:    sgd(612),     // your bill
      alt:     sgd(8000),    // SDR + agency alt
      saving:  sgd(7388)
    },
    costNarrative: "vs. an SDR at ~S$5,000/month plus a small ad-agency retainer at ~S$3,000. Your team replaces both, and they're on duty after hours.",
    managedComparison: {
      ads:          { spend:   { managed: sgd(2112), unmanaged: sgd(1840) },
                      revenue: { managed: sgd(14720), unmanaged: sgd(6420) },
                      roas:    { managed: 6.97, unmanaged: 3.49 } },
      conversations:{ replies:          { managed: 312, unmanaged: 156 },
                      conversionRate:   { managed: 0.221, unmanaged: 0.092 },
                      replyMinutesP50:  { managed: 4, unmanaged: 47 } }
    }
  };

  // ── THIS WEEK — quietFixture (low numbers, flat, no managed) ────────────
  const THIS_WEEK = {
    label: "THIS WEEK",
    period: "APR 27 — MAY 3",
    dateFolio: "APR 27 — MAY 3",
    pullquote: {
      pre:  "Quieter week — ",
      value: "S$3,184",
      mid:  " of attributed pipeline against ",
      cost: "S$142",
      post: " paid. Mostly Spring-Hydrafacial. Worth a call about whether to scale into Mother's Day or hold flat."
    },
    attribution: {
      total: sgd(3184),
      delta: { kind: "flat", text: "— roughly flat WoW" },
      riley: { value: sgd(2104), caption: "ad-driven leads converted" },
      alex:  { value: sgd(1080), caption: "reply conversions" }
    },
    funnel: [
      { stage: "Impressions",    n: 78_400, label: "78k",  delta: null },
      { stage: "Clicks",         n: 924,    label: "924",  delta: null },
      { stage: "Landing visits", n: 871,    label: "871",  delta: null },
      { stage: "Leads",          n: 54,     label: "54",   delta: { kind: "flat", text: "—" } },
      { stage: "Bookings",       n: 9,      label: "9",    delta: { kind: "flat", text: "—" } },
    ],
    funnelNarrative: {
      marker: "Riley · Apr 30",
      text: "Volume is light because we paused TikTok-Discovery on Tuesday. CTR and conversion shape both look healthy underneath — this isn't a soft week, it's a smaller week."
    },
    campaigns: [
      { name: "Spring-Hydrafacial",   spend: sgd(142), impressions: 31_200, inlineLinkClicks: 412, costPerInlineLinkClick: sgd(0.34), inlineLinkClickCtr: 0.0132, leads: 22, revenue: sgd(1560), cpl: sgd(6.45), clickToLeadRate: 0.0534, roas: 10.99 },
      { name: "Retargeting-30d",      spend: sgd(58),  impressions: 9_400,  inlineLinkClicks: 138, costPerInlineLinkClick: sgd(0.42), inlineLinkClickCtr: 0.0147, leads: 13, revenue: sgd(820),  cpl: sgd(4.46), clickToLeadRate: 0.0942, roas: 14.14 },
      { name: "Botox-Touchup-Q2",     spend: sgd(94),  impressions: 17_800, inlineLinkClicks: 224, costPerInlineLinkClick: sgd(0.42), inlineLinkClickCtr: 0.0126, leads: 8,  revenue: sgd(584),  cpl: sgd(11.75),clickToLeadRate: 0.0357, roas: 6.21 },
      { name: "Skin-Booster-Search",  spend: sgd(41),  impressions: 4_900,  inlineLinkClicks: 86,  costPerInlineLinkClick: sgd(0.48), inlineLinkClickCtr: 0.0176, leads: 5,  revenue: sgd(220),  cpl: sgd(8.20), clickToLeadRate: 0.0581, roas: 5.37 },
    ],
    cost: {
      paid:    sgd(142),
      alt:     sgd(1846),    // pro-rated weekly
      saving:  sgd(1704)
    },
    costNarrative: "vs. an SDR + agency retainer pro-rated weekly. Even at low volume the base cost is a small fraction.",
    managedComparison: null
  };

  // ── THIS QUARTER — problemFixture (mixed signals, negative delta) ───────
  const THIS_QUARTER = {
    label: "THIS QUARTER",
    period: "FEB 1 — APR 30",
    dateFolio: "FEB 1 — APR 30",
    pullquote: {
      pre:  "Mixed quarter — ",
      value: "S$28,402",
      mid:  " attributed against ",
      cost: "S$1,343",
      post: ". February was strong; March slipped on creative fatigue. Riley flagged it on Mar 14 and we recovered through April."
    },
    attribution: {
      total: sgd(28402),
      delta: { kind: "neg", text: "↓ 6% vs Q1" },
      riley: { value: sgd(18620), caption: "ad-driven leads converted" },
      alex:  { value: sgd(9782),  caption: "reply conversions" }
    },
    funnel: [
      { stage: "Impressions",    n: 1_020_000, label: "1.02m", delta: { kind: "pos",  text: "↑ 4%"  } },
      { stage: "Clicks",         n: 11_842,    label: "11.8k", delta: { kind: "neg",  text: "↓ 9%"  } },
      { stage: "Landing visits", n: 10_948,    label: "10.9k", delta: null },
      { stage: "Leads",          n: 612,       label: "612",   delta: { kind: "neg",  text: "↓ 12%" } },
      { stage: "Bookings",       n: 118,       label: "118",   delta: { kind: "neg",  text: "↓ 8%"  } },
    ],
    funnelNarrative: {
      marker: "Riley · Mar 14",
      text: "Friction between clicks and leads. CTR was holding but conversion dropped — read as creative fatigue on the March wave. New Hydrafacial set went live Mar 22 and the rate came back."
    },
    campaigns: [
      { name: "Spring-Hydrafacial",   spend: sgd(1820), impressions: 412_000, inlineLinkClicks: 5_482, costPerInlineLinkClick: sgd(0.33), inlineLinkClickCtr: 0.0133, leads: 238, revenue: sgd(16880), cpl: sgd(7.65),  clickToLeadRate: 0.0434, roas: 9.27 },
      { name: "Botox-Touchup-Q1",     spend: sgd(1240), impressions: 198_000, inlineLinkClicks: 2_412, costPerInlineLinkClick: sgd(0.51), inlineLinkClickCtr: 0.0122, leads: 86,  revenue: sgd(6080),  cpl: sgd(14.42), clickToLeadRate: 0.0356, roas: 4.90 },
      { name: "Retargeting-30d",      spend: sgd(651),  impressions: 122_000, inlineLinkClicks: 1_812, costPerInlineLinkClick: sgd(0.36), inlineLinkClickCtr: 0.0149, leads: 142, revenue: sgd(3920),  cpl: sgd(4.58),  clickToLeadRate: 0.0784, roas: 6.02 },
      { name: "Skin-Booster-Search",  spend: sgd(504),  impressions: 68_400,  inlineLinkClicks: 1_142, costPerInlineLinkClick: sgd(0.44), inlineLinkClickCtr: 0.0167, leads: 84,  revenue: sgd(1390),  cpl: sgd(6.00),  clickToLeadRate: 0.0735, roas: 2.76 },
      { name: "Lookalike-Q2-Wide",    spend: sgd(285),  impressions: 41_200,  inlineLinkClicks: 218,   costPerInlineLinkClick: sgd(1.31), inlineLinkClickCtr: 0.0053, leads: 12,  revenue: sgd(180),   cpl: sgd(23.75), clickToLeadRate: 0.0550, roas: 0.63 },
      { name: "TikTok-Discovery",     spend: sgd(412),  impressions: 178_400, inlineLinkClicks: 776,   costPerInlineLinkClick: sgd(0.53), inlineLinkClickCtr: 0.0044, leads: 28,  revenue: sgd(0),     cpl: null,       clickToLeadRate: 0.0361, roas: 0.00 },
      { name: "Mar-Creative-Test",    spend: sgd(248),  impressions: 38_800,  inlineLinkClicks: 0,     costPerInlineLinkClick: null,      inlineLinkClickCtr: 0.0000, leads: 0,   revenue: sgd(0),     cpl: null,       clickToLeadRate: null,   roas: 0.00 },
    ],
    cost: {
      paid:    sgd(1343),
      alt:     sgd(24000),
      saving:  sgd(22657)
    },
    costNarrative: "vs. SDR + agency retainer across three months. Even in a soft quarter the price gap is roughly one-eighteenth.",
    managedComparison: {
      ads:          { spend:   { managed: sgd(5160), unmanaged: sgd(4280) },
                      revenue: { managed: sgd(28402), unmanaged: sgd(12180) },
                      roas:    { managed: 5.50, unmanaged: 2.85 } },
      conversations:{ replies:          { managed: 842, unmanaged: 412 },
                      conversionRate:   { managed: 0.186, unmanaged: 0.078 },
                      replyMinutesP50:  { managed: 6, unmanaged: 62 } }
    }
  };

  return {
    "THIS WEEK":    THIS_WEEK,
    "THIS MONTH":   THIS_MONTH,
    "THIS QUARTER": THIS_QUARTER,
  };
})();

window.REPORTS_META = {
  org: "Aurora Aesthetics",
  currentUser: { display: "Mei Lin Tan", initials: "MT" },
  generatedAt: "2026-05-09T09:14:22+08:00",
  cacheAgeMin: 47,
  liveMode: false, // NEXT_PUBLIC_REPORTS_LIVE
  hasMetaConnection: true,
};
