// Pure form model for the operational-state editor (Riley v3 slice 4b).
// Carries the form honesty semantics so they are unit-testable without DOM
// machinery: absent dimension = unconfirmed (never a pre-checked
// "open"/"normal"); confirm-toggled [] = operator confirmed NONE, distinct
// from absent; a note alone never serializes to a confirmation.

import type { OperationalInterval, OperationalState } from "@switchboard/schemas";
import { instantToInclusiveEndDate, instantToLocalDate, localDateToInstant } from "./local-date";

const LOCAL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface IntervalDraft {
  /** Inclusive local start date (YYYY-MM-DD) in the org timezone. */
  startDate: string;
  /** Inclusive local end date; ignored when openEnded. */
  endDate: string;
  /** "Until further notice": serializes with no end bound. */
  openEnded: boolean;
  label: string;
}

export interface OperationalStateFormModel {
  operatingStatus: "" | "open" | "temporarily_closed";
  staffing: "" | "normal" | "shortfall";
  inventory: "" | "normal" | "outage";
  /** Checked = the operator IS confirming this list ([] = confirmed none). */
  confirmPromoWindows: boolean;
  promoWindows: IntervalDraft[];
  confirmClosures: boolean;
  closures: IntervalDraft[];
  note: string;
}

/** HONESTY FLOOR: every dimension starts unconfirmed; nothing defaults to "open"/"normal". */
export function emptyOperationalStateForm(): OperationalStateFormModel {
  return {
    operatingStatus: "",
    staffing: "",
    inventory: "",
    confirmPromoWindows: false,
    promoWindows: [],
    confirmClosures: false,
    closures: [],
    note: "",
  };
}

export function emptyIntervalDraft(): IntervalDraft {
  return { startDate: "", endDate: "", openEnded: false, label: "" };
}

/** Human-readable validation message for one draft, or null when valid. */
export function intervalDraftError(draft: IntervalDraft): string | null {
  if (!LOCAL_DATE_RE.test(draft.startDate)) return "Start date is required";
  if (!draft.openEnded) {
    if (!LOCAL_DATE_RE.test(draft.endDate)) {
      return "End date is required (or mark as open-ended)";
    }
    // Lexical compare is correct for YYYY-MM-DD. Same-day is a valid
    // single-day window: the end converts to the start of the NEXT local day.
    if (draft.endDate < draft.startDate) return "End date must not be before the start date";
  }
  return null;
}

function draftToInterval(draft: IntervalDraft, timeZone: string): OperationalInterval {
  const label = draft.label.trim();
  return {
    start: localDateToInstant(draft.startDate, timeZone, "start"),
    ...(draft.openEnded ? {} : { end: localDateToInstant(draft.endDate, timeZone, "end") }),
    ...(label !== "" ? { label } : {}),
  };
}

function intervalToDraft(interval: OperationalInterval, timeZone: string): IntervalDraft {
  return {
    startDate: instantToLocalDate(interval.start, timeZone),
    endDate: interval.end ? instantToInclusiveEndDate(interval.end, timeZone) : "",
    openEnded: interval.end === undefined,
    label: interval.label ?? "",
  };
}

/**
 * Serialize the form to an OperationalState payload, or null when the model
 * confirms NO operational dimension (the empty and note-only cases). The
 * editor disables submit on null; the proxy, route, store, and DB CHECK all
 * reject the same payloads independently. Callers must validate interval
 * drafts (intervalDraftError) before serializing.
 */
export function serializeOperationalStateForm(
  model: OperationalStateFormModel,
  timeZone: string,
): OperationalState | null {
  const state: OperationalState = {};
  if (model.operatingStatus !== "") state.operatingStatus = model.operatingStatus;
  if (model.staffing !== "") state.staffing = model.staffing;
  if (model.inventory !== "") state.inventory = model.inventory;
  if (model.confirmPromoWindows) {
    state.promoWindows = model.promoWindows.map((d) => draftToInterval(d, timeZone));
  }
  if (model.confirmClosures) {
    state.closures = model.closures.map((d) => draftToInterval(d, timeZone));
  }
  const note = model.note.trim();
  if (note !== "") state.note = note;

  const confirmsAnything =
    state.operatingStatus !== undefined ||
    state.staffing !== undefined ||
    state.inventory !== undefined ||
    state.promoWindows !== undefined ||
    state.closures !== undefined;
  return confirmsAnything ? state : null;
}

/**
 * Map the LATEST confirmed state back onto the form (pre-filling from the
 * latest confirmation is allowed; unconfirmed dimensions stay unset).
 */
export function prefillFromState(
  state: OperationalState,
  timeZone: string,
): OperationalStateFormModel {
  return {
    operatingStatus: state.operatingStatus ?? "",
    staffing: state.staffing ?? "",
    inventory: state.inventory ?? "",
    confirmPromoWindows: state.promoWindows !== undefined,
    promoWindows: (state.promoWindows ?? []).map((i) => intervalToDraft(i, timeZone)),
    confirmClosures: state.closures !== undefined,
    closures: (state.closures ?? []).map((i) => intervalToDraft(i, timeZone)),
    note: state.note ?? "",
  };
}
