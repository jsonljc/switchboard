import { describe, it, expect } from "vitest";
import type { PlaybookService } from "@switchboard/schemas";
import { resolveBookedValueCents, classifyBookedValue } from "./booking-value.js";
import type { ResolveBookedValueInput } from "./booking-value.js";

function svc(overrides: Partial<PlaybookService> & { id: string }): PlaybookService {
  return {
    id: overrides.id,
    name: overrides.name ?? "Service",
    price: overrides.price,
    duration: overrides.duration,
    bookingBehavior: overrides.bookingBehavior ?? "ask_first",
    details: overrides.details,
    status: overrides.status ?? "ready",
    source: overrides.source ?? "manual",
  };
}

describe("resolveBookedValueCents", () => {
  it("converts a matched dollar price to cents (matched by id)", () => {
    const services = [svc({ id: "botox", price: 250 }), svc({ id: "filler", price: 600 })];
    expect(resolveBookedValueCents({ service: "botox", services })).toBe(25000);
  });

  it("matches by case-insensitive, trimmed display name (Alex passes the discussed service text)", () => {
    const services = [svc({ id: "svc_1", name: "Botox", price: 250 })];
    expect(resolveBookedValueCents({ service: "Botox", services })).toBe(25000);
    expect(resolveBookedValueCents({ service: "  botox  ", services })).toBe(25000);
  });

  it("rounds fractional dollars to the nearest cent", () => {
    expect(
      resolveBookedValueCents({ service: "s", services: [svc({ id: "s", price: 49.99 })] }),
    ).toBe(4999);
    // 19.999 * 100 = 1999.9 -> rounds to 2000 (never a sub-cent fraction).
    expect(
      resolveBookedValueCents({ service: "s", services: [svc({ id: "s", price: 19.999 })] }),
    ).toBe(2000);
  });

  it("abstains (null) when neither id nor exact name matches (no fuzzy matching)", () => {
    const services = [svc({ id: "svc_1", name: "Botox", price: 250 })];
    expect(resolveBookedValueCents({ service: "Botox treatment", services })).toBeNull();
    expect(resolveBookedValueCents({ service: "missing", services })).toBeNull();
  });

  it("abstains (null) for a matched but unpriced service (never 0)", () => {
    expect(resolveBookedValueCents({ service: "s", services: [svc({ id: "s" })] })).toBeNull();
  });

  it("abstains (null) when services is undefined", () => {
    expect(resolveBookedValueCents({ service: "s", services: undefined })).toBeNull();
  });

  it("abstains (null) when services is empty", () => {
    expect(resolveBookedValueCents({ service: "s", services: [] })).toBeNull();
  });

  it("abstains (null) on a non-finite price (NaN/Infinity), never NaN cents", () => {
    expect(
      resolveBookedValueCents({ service: "s", services: [svc({ id: "s", price: Number.NaN })] }),
    ).toBeNull();
    expect(
      resolveBookedValueCents({
        service: "s",
        services: [svc({ id: "s", price: Number.POSITIVE_INFINITY })],
      }),
    ).toBeNull();
  });

  it("abstains (null) on a zero or negative price (never records 0/negative)", () => {
    expect(
      resolveBookedValueCents({ service: "s", services: [svc({ id: "s", price: 0 })] }),
    ).toBeNull();
    expect(
      resolveBookedValueCents({ service: "s", services: [svc({ id: "s", price: -50 })] }),
    ).toBeNull();
  });

  it("matches the service whose id equals the booked service (not by position)", () => {
    const services = [svc({ id: "a", price: 100 }), svc({ id: "b", price: 200 })];
    expect(resolveBookedValueCents({ service: "b", services })).toBe(20000);
  });
});

describe("classifyBookedValue", () => {
  const services = [
    svc({ id: "botox", name: "Botox", price: 250 }),
    svc({ id: "consult", name: "Consultation" }), // matched but unpriced
  ];

  it("resolved: matched + priced -> value + outcome:resolved", () => {
    expect(classifyBookedValue({ service: "Botox", services })).toEqual({
      valueCents: 25000,
      outcome: "resolved",
    });
  });

  it("no_playbook: undefined services", () => {
    expect(classifyBookedValue({ service: "x", services: undefined })).toEqual({
      valueCents: null,
      outcome: "no_playbook",
    });
  });

  it("no_playbook: empty services", () => {
    expect(classifyBookedValue({ service: "x", services: [] })).toEqual({
      valueCents: null,
      outcome: "no_playbook",
    });
  });

  it("no_match: playbook present, booked service not in it (the alignment-miss signal)", () => {
    expect(classifyBookedValue({ service: "Dermaplaning", services })).toEqual({
      valueCents: null,
      outcome: "no_match",
    });
  });

  it("matched_unpriced: matched a service with no usable price", () => {
    expect(classifyBookedValue({ service: "Consultation", services })).toEqual({
      valueCents: null,
      outcome: "matched_unpriced",
    });
  });

  it("matched_unpriced: matched but non-finite / non-positive price (never fabricates)", () => {
    expect(
      classifyBookedValue({ service: "z", services: [svc({ id: "z", price: Number.NaN })] })
        .outcome,
    ).toBe("matched_unpriced");
    expect(
      classifyBookedValue({ service: "z", services: [svc({ id: "z", price: 0 })] }).outcome,
    ).toBe("matched_unpriced");
  });

  // ALIGNMENT SEAM (divergence guard): the outcome label must never disagree with
  // the value's nullness, and the value must equal the resolver verbatim (single
  // source of truth). If the classifier's match predicate ever drifts from the
  // resolver's, this reds.
  it("ALIGNMENT: outcome:resolved iff valueCents non-null, and value tracks resolveBookedValueCents", () => {
    const cases: ResolveBookedValueInput[] = [
      { service: "Botox", services },
      { service: "botox", services }, // id match
      { service: "Consultation", services },
      { service: "Dermaplaning", services },
      { service: "x", services: [] },
      { service: "x", services: undefined },
      { service: "z", services: [svc({ id: "z", price: 0 })] },
      { service: "z", services: [svc({ id: "z", price: Number.POSITIVE_INFINITY })] },
    ];
    for (const c of cases) {
      const { valueCents, outcome } = classifyBookedValue(c);
      expect(valueCents).toBe(resolveBookedValueCents(c));
      expect(outcome === "resolved").toBe(valueCents !== null);
    }
  });
});
