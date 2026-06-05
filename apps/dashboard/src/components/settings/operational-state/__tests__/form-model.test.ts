import { describe, it, expect } from "vitest";
import {
  emptyOperationalStateForm,
  intervalDraftError,
  prefillFromState,
  serializeOperationalStateForm,
} from "../form-model";

const TZ = "Asia/Singapore";

describe("emptyOperationalStateForm", () => {
  it("starts every dimension UNCONFIRMED (honesty floor: no fabricated defaults)", () => {
    const model = emptyOperationalStateForm();
    expect(model.operatingStatus).toBe("");
    expect(model.staffing).toBe("");
    expect(model.inventory).toBe("");
    expect(model.confirmPromoWindows).toBe(false);
    expect(model.confirmClosures).toBe(false);
    expect(model.promoWindows).toEqual([]);
    expect(model.closures).toEqual([]);
    expect(model.note).toBe("");
  });
});

describe("serializeOperationalStateForm", () => {
  it("returns null for the empty model (confirming nothing is not a confirmation)", () => {
    expect(serializeOperationalStateForm(emptyOperationalStateForm(), TZ)).toBeNull();
  });

  it("returns null for a note-only model (a note alone never satisfies a confirmation)", () => {
    const model = { ...emptyOperationalStateForm(), note: "all quiet" };
    expect(serializeOperationalStateForm(model, TZ)).toBeNull();
  });

  it("omits unconfirmed dimensions entirely (absent, never a fabricated value)", () => {
    const model = { ...emptyOperationalStateForm(), staffing: "shortfall" as const };
    const state = serializeOperationalStateForm(model, TZ);
    expect(state).toEqual({ staffing: "shortfall" });
    expect(Object.prototype.hasOwnProperty.call(state, "operatingStatus")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(state, "promoWindows")).toBe(false);
  });

  it("confirm-toggled empty list serializes as [] (operator confirmed NONE, distinct from absent)", () => {
    const model = { ...emptyOperationalStateForm(), confirmPromoWindows: true };
    expect(serializeOperationalStateForm(model, TZ)).toEqual({ promoWindows: [] });
  });

  it("converts interval drafts to org-timezone instants with half-open day boundaries", () => {
    const model = {
      ...emptyOperationalStateForm(),
      confirmPromoWindows: true,
      promoWindows: [
        { startDate: "2026-06-01", endDate: "2026-06-15", openEnded: false, label: "june glow" },
      ],
    };
    expect(serializeOperationalStateForm(model, TZ)).toEqual({
      promoWindows: [
        {
          start: "2026-05-31T16:00:00.000Z",
          end: "2026-06-15T16:00:00.000Z",
          label: "june glow",
        },
      ],
    });
  });

  it("omits end for an open-ended interval and label when blank", () => {
    const model = {
      ...emptyOperationalStateForm(),
      confirmClosures: true,
      closures: [{ startDate: "2026-06-20", endDate: "", openEnded: true, label: "  " }],
    };
    const state = serializeOperationalStateForm(model, TZ);
    expect(state?.closures).toEqual([{ start: "2026-06-19T16:00:00.000Z" }]);
  });

  it("attaches a trimmed note alongside a confirmed dimension", () => {
    const model = {
      ...emptyOperationalStateForm(),
      inventory: "outage" as const,
      note: "  filler restock due friday  ",
    };
    expect(serializeOperationalStateForm(model, TZ)).toEqual({
      inventory: "outage",
      note: "filler restock due friday",
    });
  });
});

describe("prefillFromState", () => {
  it("maps the latest confirmed state back onto the form, leaving unconfirmed dimensions unset", () => {
    const model = prefillFromState(
      {
        staffing: "shortfall",
        promoWindows: [
          {
            start: "2026-05-31T16:00:00.000Z",
            end: "2026-06-15T16:00:00.000Z",
            label: "june glow",
          },
        ],
      },
      TZ,
    );
    expect(model.staffing).toBe("shortfall");
    expect(model.operatingStatus).toBe("");
    expect(model.inventory).toBe("");
    expect(model.confirmPromoWindows).toBe(true);
    expect(model.promoWindows).toEqual([
      { startDate: "2026-06-01", endDate: "2026-06-15", openEnded: false, label: "june glow" },
    ]);
    expect(model.confirmClosures).toBe(false);
  });

  it("distinguishes confirmed-none ([]) from absent when prefilling", () => {
    const model = prefillFromState({ promoWindows: [] }, TZ);
    expect(model.confirmPromoWindows).toBe(true);
    expect(model.promoWindows).toEqual([]);
    expect(model.confirmClosures).toBe(false);
  });

  it("prefills an open-ended interval", () => {
    const model = prefillFromState({ closures: [{ start: "2026-06-19T16:00:00.000Z" }] }, TZ);
    expect(model.closures).toEqual([
      { startDate: "2026-06-20", endDate: "", openEnded: true, label: "" },
    ]);
  });
});

describe("intervalDraftError", () => {
  it("requires a start date", () => {
    expect(intervalDraftError({ startDate: "", endDate: "", openEnded: true, label: "" })).toMatch(
      /start date/i,
    );
  });

  it("requires an end date unless open-ended", () => {
    expect(
      intervalDraftError({ startDate: "2026-06-01", endDate: "", openEnded: false, label: "" }),
    ).toMatch(/end date/i);
    expect(
      intervalDraftError({ startDate: "2026-06-01", endDate: "", openEnded: true, label: "" }),
    ).toBeNull();
  });

  it("rejects an end date before the start date but allows a single-day window", () => {
    expect(
      intervalDraftError({
        startDate: "2026-06-15",
        endDate: "2026-06-01",
        openEnded: false,
        label: "",
      }),
    ).toMatch(/before/i);
    expect(
      intervalDraftError({
        startDate: "2026-06-01",
        endDate: "2026-06-01",
        openEnded: false,
        label: "",
      }),
    ).toBeNull();
  });
});
