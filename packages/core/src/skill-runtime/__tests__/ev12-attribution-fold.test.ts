import { describe, it, expect } from "vitest";
import type { AttributionChain } from "@switchboard/schemas";
import { buildBookedConversionPayload } from "../tools/booked-conversion-payload.js";

/**
 * EV-12 — Attribution chain (Layer-3 / core "fold" half). DETERMINISTIC: a pure
 * function over a folded Contact — no DB, no Meta call. Sibling to the
 * ad-optimizer dispatch-boundary half in
 * `packages/ad-optimizer/src/__tests__/ev12-attribution-chain.test.ts`; the two
 * pin the chain from both ends because ad-optimizer (Layer 2) cannot import
 * `@switchboard/core` (Layer 3).
 *
 * MONEY-5 HEADLINE under test: "the CTWA click id (`ctwa_clid`) is preserved
 * THROUGH contact folding into the booked conversion, and the campaign is never
 * mis-assigned." `buildBookedConversionPayload` is the fold -> booked-payload hop
 * the LIVE booked conversion actually travels:
 *   calendar-book.ts:347 (buildBookedConversionPayload)
 *     -> outboxEvent.payload.attribution (calendar-book.ts:362)
 *     -> ConversionEvent.attribution
 *     -> MetaCAPIDispatcher user_data.
 *
 * FINDING (MONEY-5 attribution loss — SURFACE only, NOT fixed here): the live
 * booked payload DROPS `ctwa_clid`. `buildBookedConversionPayload` forwards only
 * `{ fbclid, lead_id }`, and its output type `BookedConversionPayload.attribution`
 * has no `ctwa_clid` slot — and neither does `ConversionEvent.attribution`
 * (schemas/conversion.ts) nor the `MetaCAPIDispatcher` user_data builder. So for a
 * PURE CTWA lead (fbclid + leadgen_id both null) the booked conversion reaches
 * Meta with NO click-level identifier at all: Meta cannot tie the booked
 * conversion back to the click-to-WhatsApp click via `ctwa_clid`. Campaign/ad ids
 * DO survive (`sourceCampaignId` / `sourceAdId`), so the loss is scoped to the
 * click id. The only path that WOULD forward the whole attribution map (incl.
 * `ctwa_clid`) is the `OutcomeDispatcher` (ad-optimizer), which is explicitly
 * DORMANT — it must REPLACE, not run beside, `MetaCAPIDispatcher`
 * (apps/api/src/bootstrap/outcome-wiring.ts), so it is not the live path today.
 *
 * These tests PIN the drop as CURRENT behavior; the fix belongs in a separate
 * production PR (see this PR's body). Do NOT change production
 * `buildBookedConversionPayload` to make them go green.
 */

/**
 * A PURE CTWA (click-to-WhatsApp) lead: the ONLY click identifier is `ctwa_clid`
 * (fbclid + leadgen_id are null/absent). This is the worst case for the drop —
 * removing `ctwa_clid` leaves the booked conversion with zero click-level id.
 */
function ctwaContact(overrides?: Partial<AttributionChain>) {
  const attribution: AttributionChain = {
    fbclid: null,
    gclid: null,
    ttclid: null,
    sourceCampaignId: "camp_ctwa",
    sourceAdId: "ad_ctwa",
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    ctwa_clid: "clid_A",
    ...overrides,
  };
  return { email: "jane@example.com", phone: "+6591234567", attribution };
}

describe("EV-12 fold half — ctwa_clid through the booked-payload fold (MONEY-5)", () => {
  it("DROPS ctwa_clid from the booked payload (current behavior — attribution-loss FINDING)", () => {
    const result = buildBookedConversionPayload(ctwaContact());

    // Full current shape. The headline claim is "ctwa_clid preserved through the
    // fold"; it is NOT — there is no ctwa_clid anywhere in the booked payload, and
    // for a pure CTWA lead both surviving click ids are null.
    expect(result).toEqual({
      sourceCampaignId: "camp_ctwa",
      sourceAdId: "ad_ctwa",
      customer: { email: "jane@example.com", phone: "+6591234567" },
      attribution: { fbclid: null, lead_id: null },
    });

    // Load-bearing finding pin (self-documenting): the click identifier is gone, so
    // Meta loses the tie back to the CTWA click. A mutant that forwards ctwa_clid
    // (even as null/undefined) flips this assertion — the guard is non-vacuous.
    expect("ctwa_clid" in result.attribution).toBe(false);
  });

  it("forwards the CTWA contact's own campaign/ad verbatim — never mis-assigns the campaign", () => {
    const result = buildBookedConversionPayload(ctwaContact());

    // Campaign/ad-level attribution DOES survive the fold (the loss is scoped to the
    // click id). These must be THIS contact's ids — never inferred, defaulted, or swapped.
    expect(result.sourceCampaignId).toBe("camp_ctwa");
    expect(result.sourceAdId).toBe("ad_ctwa");
  });

  it("is a deterministic pure fold: distinct folded contacts never cross-assign campaign", () => {
    // The A4 contact fold collapses a same-person CTWA click pair upstream; here we
    // pin that the booked payload reflects ONLY its own folded contact's campaign —
    // clid_A's campaign never leaks into clid_B's payload, and vice versa.
    const a = buildBookedConversionPayload(
      ctwaContact({ ctwa_clid: "clid_A", sourceCampaignId: "camp_A", sourceAdId: "ad_A" }),
    );
    const b = buildBookedConversionPayload(
      ctwaContact({ ctwa_clid: "clid_B", sourceCampaignId: "camp_B", sourceAdId: "ad_B" }),
    );

    expect(a.sourceCampaignId).toBe("camp_A");
    expect(b.sourceCampaignId).toBe("camp_B");
    expect(a.sourceAdId).toBe("ad_A");
    expect(b.sourceAdId).toBe("ad_B");

    // ...and both still drop their ctwa_clid — the finding holds regardless of fold.
    expect("ctwa_clid" in a.attribution).toBe(false);
    expect("ctwa_clid" in b.attribution).toBe(false);
  });
});
