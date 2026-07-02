import { describe, it, expect, beforeEach } from "vitest";
import { loadBannedPhrases, _resetBannedPhraseCache } from "./banned-phrases/loader.js";
import { COMMON_BANNED_PHRASES, GENERIC_COMMON_BANNED_PHRASES } from "./banned-phrases/common.js";
import {
  loadEscalationTriggers,
  _resetEscalationTriggerCache,
} from "./escalation-triggers/loader.js";
import {
  COMMON_ESCALATION_TRIGGERS,
  GENERIC_COMMON_ESCALATION_TRIGGERS,
} from "./escalation-triggers/common.js";

describe("generic banned-phrase floor (SH-2)", () => {
  it("is a strict, non-empty subset of the medspa common table", () => {
    const medspaIds = new Set(COMMON_BANNED_PHRASES.map((e) => e.id));
    expect(GENERIC_COMMON_BANNED_PHRASES.length).toBeGreaterThan(0);
    expect(GENERIC_COMMON_BANNED_PHRASES.length).toBeLessThan(COMMON_BANNED_PHRASES.length);
    for (const e of GENERIC_COMMON_BANNED_PHRASES) {
      expect(medspaIds.has(e.id), `${e.id} present in medspa`).toBe(true);
    }
  });

  it("keeps the universal claim boundaries and the generic cure ban", () => {
    const ids = new Set(GENERIC_COMMON_BANNED_PHRASES.map((e) => e.id));
    expect(ids.has("guarantee_basic")).toBe(true);
    expect(ids.has("superlative_world_class")).toBe(true);
    expect(ids.has("medical_cure")).toBe(true);
  });

  it("drops the medspa-specific medical-claim entries", () => {
    const ids = new Set(GENERIC_COMMON_BANNED_PHRASES.map((e) => e.id));
    for (const id of [
      "medical_treats",
      "medical_fixes",
      "medical_eliminates",
      "medical_reverse_aging",
      "medical_removes",
    ]) {
      expect(ids.has(id), `${id} excluded from generic`).toBe(false);
    }
  });
});

describe("generic escalation floor (SH-2)", () => {
  it("is a strict subset of medspa common incl. the universal safety categories", () => {
    const medspaIds = new Set(COMMON_ESCALATION_TRIGGERS.map((e) => e.id));
    const ids = new Set(GENERIC_COMMON_ESCALATION_TRIGGERS.map((e) => e.id));
    expect(GENERIC_COMMON_ESCALATION_TRIGGERS.length).toBeGreaterThan(0);
    expect(GENERIC_COMMON_ESCALATION_TRIGGERS.length).toBeLessThan(
      COMMON_ESCALATION_TRIGGERS.length,
    );
    for (const e of GENERIC_COMMON_ESCALATION_TRIGGERS) {
      expect(medspaIds.has(e.id), `${e.id} present in medspa`).toBe(true);
    }
    expect(ids.has("sensitive_keyword_minor")).toBe(true);
    expect(ids.has("sensitive_keyword_mental_health")).toBe(true);
  });

  it("drops the medspa-procedure-specific triggers", () => {
    const ids = new Set(GENERIC_COMMON_ESCALATION_TRIGGERS.map((e) => e.id));
    for (const id of [
      "anticoagulant_use",
      "suspicious_lesion",
      "recent_procedure",
      "prior_adverse_reaction",
      "pregnancy",
    ]) {
      expect(ids.has(id), `${id} excluded from generic`).toBe(false);
    }
  });
});

describe("generic vertical resolves the floor, not the medspa table (SH-2)", () => {
  beforeEach(() => {
    _resetBannedPhraseCache();
    _resetEscalationTriggerCache();
  });

  it("loads the generic banned floor (fewer than medspa) and still passes the manifest guard", () => {
    const medspa = loadBannedPhrases("SG", "medspa");
    const generic = loadBannedPhrases("SG", "generic");
    expect(generic.length).toBeLessThan(medspa.length);
    // no throw from the loader == the generic merged table satisfies the floor manifest
  });

  it("loads the generic escalation floor (fewer than medspa)", () => {
    const medspa = loadEscalationTriggers("SG", "medspa");
    const generic = loadEscalationTriggers("SG", "generic");
    expect(generic.length).toBeLessThan(medspa.length);
  });
});
