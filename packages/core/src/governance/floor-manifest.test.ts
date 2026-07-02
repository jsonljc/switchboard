import { describe, it, expect } from "vitest";
import {
  assertFloorCoverage,
  BANNED_PHRASE_FLOOR_MANIFEST,
  ESCALATION_FLOOR_MANIFEST,
} from "./floor-manifest.js";
import { COMMON_BANNED_PHRASES } from "./banned-phrases/common.js";
import { SG_BANNED_PHRASES } from "./banned-phrases/sg.js";
import { MY_BANNED_PHRASES } from "./banned-phrases/my.js";
import type { BannedPhraseEntry } from "./banned-phrases/types.js";
import { scanForBannedPhrases } from "./scanner/banned-phrase-scanner.js";
import { COMMON_ESCALATION_TRIGGERS } from "./escalation-triggers/common.js";
import { SG_ESCALATION_TRIGGERS } from "./escalation-triggers/sg.js";
import { MY_ESCALATION_TRIGGERS } from "./escalation-triggers/my.js";
import type { EscalationTriggerEntry } from "./escalation-triggers/types.js";
import { scanForEscalationTriggers } from "./scanner/escalation-trigger-scanner.js";

const bannedCovered = (probe: string, entries: ReadonlyArray<BannedPhraseEntry>): boolean =>
  scanForBannedPhrases(probe, entries).length > 0;
const escalationCovered = (
  probe: string,
  entries: ReadonlyArray<EscalationTriggerEntry>,
): boolean => scanForEscalationTriggers(probe, entries).length > 0;

describe("banned-phrase floor manifest: medspa passes with ZERO edits", () => {
  it("the medspa SG merged table covers every floor requirement", () => {
    const merged = [...COMMON_BANNED_PHRASES, ...SG_BANNED_PHRASES];
    expect(() =>
      assertFloorCoverage(merged, BANNED_PHRASE_FLOOR_MANIFEST, bannedCovered, "medspa/SG"),
    ).not.toThrow();
  });

  it("the medspa MY merged table covers every floor requirement", () => {
    const merged = [...COMMON_BANNED_PHRASES, ...MY_BANNED_PHRASES];
    expect(() =>
      assertFloorCoverage(merged, BANNED_PHRASE_FLOOR_MANIFEST, bannedCovered, "medspa/MY"),
    ).not.toThrow();
  });
});

describe("banned-phrase floor manifest: fail-closed on a dropped boundary", () => {
  it("throws when the merged table drops the superlative + health-claim boundaries", () => {
    const deficient: BannedPhraseEntry[] = [
      { id: "g", category: "guarantee", patterns: ["guaranteed"], severity: "block" },
    ];
    expect(() =>
      assertFloorCoverage(deficient, BANNED_PHRASE_FLOOR_MANIFEST, bannedCovered, "deficient/SG"),
    ).toThrow(/superlative/);
  });

  it("names the failing requirement id and the label in the message", () => {
    expect(() =>
      assertFloorCoverage([], BANNED_PHRASE_FLOOR_MANIFEST, bannedCovered, "empty-pack/SG"),
    ).toThrow(/empty-pack\/SG/);
  });
});

describe("escalation floor manifest: medspa passes with ZERO edits", () => {
  it("the medspa SG merged table covers every floor requirement", () => {
    const merged = [...COMMON_ESCALATION_TRIGGERS, ...SG_ESCALATION_TRIGGERS];
    expect(() =>
      assertFloorCoverage(merged, ESCALATION_FLOOR_MANIFEST, escalationCovered, "medspa/SG"),
    ).not.toThrow();
  });

  it("the medspa MY merged table covers every floor requirement", () => {
    const merged = [...COMMON_ESCALATION_TRIGGERS, ...MY_ESCALATION_TRIGGERS];
    expect(() =>
      assertFloorCoverage(merged, ESCALATION_FLOOR_MANIFEST, escalationCovered, "medspa/MY"),
    ).not.toThrow();
  });
});

describe("escalation floor manifest: fail-closed on a dropped boundary", () => {
  it("throws when the minor-protection boundary is missing", () => {
    const deficient: EscalationTriggerEntry[] = [
      { id: "sui", category: "sensitive_keyword", patterns: [/\bsuicidal\b/i] },
    ];
    expect(() =>
      assertFloorCoverage(deficient, ESCALATION_FLOOR_MANIFEST, escalationCovered, "deficient/SG"),
    ).toThrow(/minor/);
  });
});
