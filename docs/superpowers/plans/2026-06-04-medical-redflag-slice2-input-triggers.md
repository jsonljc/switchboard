# Medical Red-Flag Slice 2: Input Triggers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Catch the three verified medical red-flag gaps (anticoagulants, suspicious lesions, recent surgery) deterministically at the pre-input gate, route medical enforce-blocks through handoff reason `medical_safety`, and fix the #843 per-entry negation over-suppression.

**Architecture:** Pure `packages/core` slice: extend the escalation-trigger taxonomy (`escalation-triggers/`), change the scanner to per-match overlap suppression, and parameterize the input gate's inline handoff builder. No schemas/db/apps/eval changes. Everything is latent for off-mode deployments and log-only under the #870 observe-seeded pilot.

**Tech Stack:** TypeScript ESM (`.js` import extensions), vitest, exhaustive `Record` typing as compile-time bites.

**Spec:** `docs/superpowers/specs/2026-06-04-medical-redflag-slice2-input-triggers-design.md`

**Verification ground rules (apply to every task):**

- Run tests from the worktree root: `pnpm --filter @switchboard/core test <file-filter>`.
- Conventional Commits, lowercase first word after the colon, body lines wrapped at 100 chars, no em-dashes.
- Before each commit: `git branch --show-current` must print `feat/alex-medical-redflag-slice2`.

---

### Task 1: Per-match negation suppression in the scanner

The scanner currently skips a whole sentence for an entry when ANY negation matches it
(`escalation-trigger-scanner.ts:62`). Replace with: a pattern occurrence is suppressed
iff its span overlaps a negation match span. Verified safe: all 7 existing scanner tests
and all #843 suppression tests in `common.test.ts` pass under overlap semantics (the
negation span always overlaps the occurrence it guards, because every negation regex is
shaped `negword [window] term`).

**Files:**

- Modify: `packages/core/src/governance/scanner/escalation-trigger-scanner.ts`
- Test: `packages/core/src/governance/scanner/__tests__/escalation-trigger-scanner.test.ts`

- [ ] **Step 1.1: Add failing per-match tests**

Append to `escalation-trigger-scanner.test.ts`:

```ts
describe("scanForEscalationTriggers - per-match negation suppression", () => {
  const CONDITION_ENTRY: EscalationTriggerEntry = {
    id: "test_condition",
    category: "sensitive_keyword",
    patterns: [/\b(?:diabetes|warfarin|aspirin)\b/i],
    negations: [
      /\b(?:not|never)\b[^.!?]{0,12}\b(?:diabetes|warfarin|aspirin)\b/i,
      /\bmy\s+(?:mum|mother)\b[^.!?]{0,16}\b(?:diabetes|warfarin|aspirin)\b/i,
    ],
  };

  it("still suppresses an occurrence overlapped by a negation span", () => {
    expect(scanForEscalationTriggers("I'm not on warfarin", [CONDITION_ENTRY])).toHaveLength(0);
  });

  it("fires on a genuine disclosure beside a negated one in the same sentence", () => {
    const ms = scanForEscalationTriggers("I'm not on aspirin but I do take warfarin daily", [
      CONDITION_ENTRY,
    ]);
    expect(ms).toHaveLength(1);
    expect(ms[0]!.matched.toLowerCase()).toBe("warfarin");
  });

  it("fires on a first-person condition after a third-party clause (the #843 run-on)", () => {
    const ms = scanForEscalationTriggers("my mum had diabetes and I have diabetes too", [
      CONDITION_ENTRY,
    ]);
    expect(ms).toHaveLength(1);
    // The first occurrence (mum's) is suppressed; the reported match is the second.
    expect(ms[0]!.index).toBeGreaterThan("my mum had diabetes".length - 1);
  });

  it("keeps suppressing when the negation span overlaps the start of a wider match", () => {
    const combo: EscalationTriggerEntry = {
      id: "test_combo",
      category: "multi_treatment_combo",
      patterns: [/\bcombine\b[^.!?]*\b(?:botox|filler)\b/i],
      negations: [/\b(?:rather not|not)\b[^.!?]{0,20}\bcombine\b/i],
    };
    expect(
      scanForEscalationTriggers("I'd rather not combine botox and filler", [combo]),
    ).toHaveLength(0);
  });

  it("applies per-occurrence logic to string patterns too", () => {
    const e: EscalationTriggerEntry = {
      id: "test_str",
      category: "sensitive_keyword",
      patterns: ["warfarin"],
      negations: [/\bnot\b[^.!?]{0,12}\bwarfarin\b/i],
    };
    const ms = scanForEscalationTriggers("not warfarin but warfarin anyway", [e]);
    expect(ms).toHaveLength(1);
    expect(ms[0]!.index).toBeGreaterThan("not warfarin".length - 1);
  });

  it("reports at most one match per entry per sentence", () => {
    const ms = scanForEscalationTriggers("I take warfarin and more warfarin", [CONDITION_ENTRY]);
    expect(ms).toHaveLength(1);
  });
});
```

- [ ] **Step 1.2: Run to verify the new tests fail**

Run: `pnpm --filter @switchboard/core test escalation-trigger-scanner`
Expected: the "fires on a genuine disclosure", "#843 run-on", and "string patterns" tests
FAIL (current per-entry semantics suppress the whole sentence); the rest pass.

- [ ] **Step 1.3: Implement overlap suppression**

Replace the body of `escalation-trigger-scanner.ts` below the `toSentenceSpans` helper
(keep imports, interfaces, `toSentenceSpans`) with:

```ts
interface MatchSpan {
  start: number;
  end: number;
}

/** All occurrences of a pattern in `text` as [start, end) spans. */
function allMatchSpans(text: string, pattern: string | RegExp): MatchSpan[] {
  const spans: MatchSpan[] = [];
  if (typeof pattern === "string") {
    if (pattern.length === 0) return spans;
    const hay = text.toLowerCase();
    const needle = pattern.toLowerCase();
    let idx = hay.indexOf(needle);
    while (idx >= 0) {
      spans.push({ start: idx, end: idx + needle.length });
      idx = hay.indexOf(needle, idx + needle.length);
    }
    return spans;
  }
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const re = new RegExp(pattern.source, flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    spans.push({ start: m.index, end: m.index + m[0].length });
    if (m[0].length === 0) re.lastIndex++;
  }
  return spans;
}

function overlaps(a: MatchSpan, b: MatchSpan): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * Per-MATCH negation suppression (supersedes 1b-1's per-entry rule, the
 * limitation documented in #843): a pattern occurrence is suppressed iff its
 * span overlaps a negation match span in the same sentence. A run-on sentence
 * mixing a negated clause with a separate genuine disclosure ("I'm not on
 * aspirin but I do take warfarin daily") now reports the genuine one.
 *
 * Overlap (not containment) is required: windowed negations like
 * "not [window] combine" end inside a wider pattern match ("combine ... filler")
 * and must still suppress it.
 *
 * Each entry still reports at most one match per sentence (the first
 * unsuppressed occurrence of the first matching pattern).
 */
export function scanForEscalationTriggers(
  text: string,
  entries: ReadonlyArray<EscalationTriggerEntry>,
): EscalationTriggerMatch[] {
  const sentences = toSentenceSpans(text);
  const matches: EscalationTriggerMatch[] = [];

  for (const entry of entries) {
    for (const sentence of sentences) {
      const negationSpans = (entry.negations ?? []).flatMap((n) => allMatchSpans(sentence.text, n));
      let reported = false;
      for (const pattern of entry.patterns) {
        for (const occurrence of allMatchSpans(sentence.text, pattern)) {
          if (negationSpans.some((neg) => overlaps(neg, occurrence))) continue;
          matches.push({
            entry,
            matched: sentence.text.slice(occurrence.start, occurrence.end),
            index: sentence.start + occurrence.start,
            sentence: sentence.text,
          });
          reported = true;
          break;
        }
        if (reported) break;
      }
    }
  }

  return matches;
}
```

Also update the `negations` doc line in `escalation-triggers/types.ts`:

```ts
  /** A pattern occurrence is suppressed when a negation match span overlaps it (same sentence). */
  negations?: ReadonlyArray<string | RegExp>;
```

- [ ] **Step 1.4: Run scanner + trigger + gate suites**

Run: `pnpm --filter @switchboard/core test escalation-trigger`
Expected: all scanner tests pass, `common.test.ts` passes unchanged (no #843 fixture
pins per-entry semantics; verified before writing this plan).

Run: `pnpm --filter @switchboard/core test channel-gateway`
Expected: PASS (gate behavior unchanged for fixture triggers).

- [ ] **Step 1.5: Commit**

```bash
git add packages/core/src/governance/scanner packages/core/src/governance/escalation-triggers/types.ts
git commit -m "feat(core): per-match negation suppression in escalation-trigger scanner"
```

---

### Task 2: `anticoagulant_use` trigger

**Files:**

- Modify: `packages/core/src/governance/escalation-triggers/types.ts` (category union + `REASON_CODE_BY_TRIGGER`)
- Modify: `packages/core/src/governance/escalation-triggers/common.ts` (new entry)
- Test: `packages/core/src/governance/escalation-triggers/__tests__/common.test.ts`

- [ ] **Step 2.1: Add failing fixtures**

Append to `common.test.ts`:

```ts
describe("COMMON_ESCALATION_TRIGGERS - anticoagulant_use (medical red-flag slice 2)", () => {
  it("fires on blood-thinner class terms alone (qualification-answer flow)", () => {
    expect(matchedIds("I'm on blood thinners, can I still get filler?")).toContain(
      "anticoagulant_use",
    );
    expect(matchedIds("im on blood thinners can i still get filler")).toContain(
      "anticoagulant_use",
    );
    expect(matchedIds("I take a blood-thinning medication")).toContain("anticoagulant_use");
    expect(matchedIds("I'm on anticoagulants")).toContain("anticoagulant_use");
  });

  it("fires on named anticoagulant drugs alone", () => {
    expect(matchedIds("yes, warfarin")).toContain("anticoagulant_use");
    expect(matchedIds("I'm on Eliquis for my heart")).toContain("anticoagulant_use");
    expect(matchedIds("taking Xarelto since my surgery in 2019")).toContain("anticoagulant_use");
    expect(matchedIds("I take clopidogrel")).toContain("anticoagulant_use");
  });

  it("fires on aspirin only in therapy phrasing", () => {
    expect(matchedIds("I'm on aspirin")).toContain("anticoagulant_use");
    expect(matchedIds("I take low-dose aspirin every morning")).toContain("anticoagulant_use");
    expect(matchedIds("I was prescribed baby aspirin")).toContain("anticoagulant_use");
  });

  it("stays silent on casual aspirin mentions", () => {
    expect(matchedIds("I took an aspirin for my headache yesterday")).not.toContain(
      "anticoagulant_use",
    );
    expect(matchedIds("do you sell aspirin?")).not.toContain("anticoagulant_use");
  });

  it("suppresses self-negations (incl. curly apostrophe)", () => {
    expect(matchedIds("I'm not on blood thinners")).not.toContain("anticoagulant_use");
    expect(matchedIds("I don't take warfarin")).not.toContain("anticoagulant_use");
    expect(matchedIds("I don’t take blood thinners")).not.toContain("anticoagulant_use");
    expect(matchedIds("never been on anticoagulants")).not.toContain("anticoagulant_use");
  });

  it("suppresses third-party attribution", () => {
    expect(matchedIds("my dad is on warfarin")).not.toContain("anticoagulant_use");
    expect(matchedIds("my mum takes blood thinners")).not.toContain("anticoagulant_use");
  });

  it("still fires on a genuine disclosure beside a negated one (per-match)", () => {
    expect(matchedIds("I'm not on aspirin but I do take warfarin daily")).toContain(
      "anticoagulant_use",
    );
  });

  it("does NOT suppress cessation (recent stop is still a clinician question)", () => {
    expect(matchedIds("I stopped warfarin last month")).toContain("anticoagulant_use");
    expect(matchedIds("my doctor took me off blood thinners recently")).toContain(
      "anticoagulant_use",
    );
  });
});
```

Note the cessation case "my doctor took me off blood thinners": the third-party negation
requires a relative noun after the possessive ("my mum/dad/..."), and "my doctor" is not
in that list, so it fires. Keep "doctor" out of the third-party noun list for exactly
this reason: "my doctor put me on warfarin" is a first-person therapy disclosure.

- [ ] **Step 2.2: Run to verify failure**

Run: `pnpm --filter @switchboard/core test common.test`
Expected: every `anticoagulant_use` `toContain` assertion FAILS (category does not
exist yet); the `not.toContain` assertions pass vacuously.

- [ ] **Step 2.3: Add the category + mapping + entry**

In `types.ts`, extend the union (after `"prior_adverse_reaction"`):

```ts
export type EscalationTriggerCategory =
  | "pregnancy_breastfeeding"
  | "prior_adverse_reaction"
  | "anticoagulant_use"
  | "prior_complaint"
  | "competitor_negative"
  | "multi_treatment_combo"
  | "sensitive_keyword";
```

Add to `REASON_CODE_BY_TRIGGER` (keeping key order aligned with the union):

```ts
  anticoagulant_use: "medical_safety_trigger",
```

In `common.ts`, append after `prior_adverse_reaction` (keep medical entries together):

```ts
  // Medical red-flag slice 2: the three deterministic gaps verified 2026-06-01.
  // Calibration: the disclosure alone fires (Alex asks "any medications?" and
  // the lead answers bare "warfarin"; the conversation supplies the treatment
  // context). High precision comes from unambiguous terms, not co-occurrence.
  {
    id: "anticoagulant_use",
    category: "anticoagulant_use",
    patterns: [
      // Drug-class terms: unambiguous therapy disclosures, fire alone.
      /\b(?:blood[ -]?thinn(?:er|ers|ing)|anti[ -]?coagulants?|anti[ -]?platelets?)\b/i,
      // Named anticoagulant/antiplatelet drugs: high-precision, fire alone.
      /\b(?:warfarin|coumadin|heparin|apixaban|eliquis|rivaroxaban|xarelto|dabigatran|pradaxa|edoxaban|clopidogrel|plavix)\b/i,
      // Aspirin only in possession/therapy phrasing; a casual one-off mention
      // ("took an aspirin for my headache") stays silent.
      /\b(?:on|taking|take|prescribed)\s+(?:daily\s+|low[ -]dose\s+|baby\s+)?aspirin\b/i,
      /\baspirin\s+(?:daily|every ?day|therapy|regimen)\b/i,
    ],
    // Self-negation + third-party family attribution. Deliberately NOT
    // suppressed: cessation ("stopped/off warfarin"); recent cessation before
    // a procedure is itself a clinician question (asymmetric with pregnancy's
    // "no longer pregnant", which is a resolved state).
    negations: [
      /\b(?:not|never|don['’]?t|do not|haven['’]?t|am not|isn['’]?t)\b[^.!?]{0,16}\b(?:blood[ -]?thinn\w*|anti[ -]?coagulants?|anti[ -]?platelets?|warfarin|coumadin|heparin|apixaban|eliquis|rivaroxaban|xarelto|dabigatran|pradaxa|edoxaban|clopidogrel|plavix|aspirin)\b/i,
      /\b(?:my|her|his|their|our)\s+(?:mum|mom|mother|father|dad|sister|brother|aunt|uncle|grand(?:ma|pa|mother|father)|cousin|friend|partner|husband|wife|parent|relative)\b[^.!?]{0,20}\b(?:blood[ -]?thinn\w*|anti[ -]?coagulants?|anti[ -]?platelets?|warfarin|coumadin|heparin|apixaban|eliquis|rivaroxaban|xarelto|dabigatran|pradaxa|edoxaban|clopidogrel|plavix|aspirin)\b/i,
    ],
  },
```

- [ ] **Step 2.4: Run to verify pass**

Run: `pnpm --filter @switchboard/core test common.test`
Expected: PASS.

Run: `pnpm --filter @switchboard/core typecheck`
Expected: PASS (the exhaustive `Record` is satisfied).

- [ ] **Step 2.5: Commit**

```bash
git add packages/core/src/governance/escalation-triggers
git commit -m "feat(core): anticoagulant escalation trigger (medical red-flag slice 2)"
```

---

### Task 3: `suspicious_lesion` trigger

**Files:**

- Modify: `packages/core/src/governance/escalation-triggers/types.ts`
- Modify: `packages/core/src/governance/escalation-triggers/common.ts`
- Test: `packages/core/src/governance/escalation-triggers/__tests__/common.test.ts`

- [ ] **Step 3.1: Add failing fixtures**

```ts
describe("COMMON_ESCALATION_TRIGGERS - suspicious_lesion (medical red-flag slice 2)", () => {
  it("fires on lesion noun + change qualifier (both orders)", () => {
    expect(matchedIds("I have a mole that's been getting darker")).toContain("suspicious_lesion");
    expect(matchedIds("my mole is changing")).toContain("suspicious_lesion");
    expect(matchedIds("there's a dark patch that keeps growing")).toContain("suspicious_lesion");
    expect(matchedIds("a suspicious mole on my cheek")).toContain("suspicious_lesion");
    expect(matchedIds("I'm worried about a changing mole")).toContain("suspicious_lesion");
    expect(matchedIds("my mole started bleeding")).toContain("suspicious_lesion");
    expect(matchedIds("ive got a weird looking mole can you laser it off")).toContain(
      "suspicious_lesion",
    );
  });

  it("fires on a new mole and non-healing sores", () => {
    expect(matchedIds("a new mole appeared on my arm")).toContain("suspicious_lesion");
    expect(matchedIds("I have a sore that won't heal")).toContain("suspicious_lesion");
  });

  it("fires on explicit melanoma worry", () => {
    expect(matchedIds("could this be melanoma?")).toContain("suspicious_lesion");
  });

  it("stays silent on routine mole-removal and pigmentation requests", () => {
    expect(matchedIds("can you remove a mole?")).not.toContain("suspicious_lesion");
    expect(matchedIds("I want my moles removed")).not.toContain("suspicious_lesion");
    expect(matchedIds("do you treat dark spots from acne?")).not.toContain("suspicious_lesion");
    expect(matchedIds("my acne marks are getting darker")).not.toContain("suspicious_lesion");
    expect(matchedIds("melasma patches on my cheeks")).not.toContain("suspicious_lesion");
    expect(matchedIds("price for pigmentation removal?")).not.toContain("suspicious_lesion");
    expect(matchedIds("I have a new spot from a breakout")).not.toContain("suspicious_lesion");
    // Review pin: "weird" qualifier + pimple context must stay suppressed by the
    // acne/breakout negation (the negation span overlaps the "weird spot" occurrence).
    expect(matchedIds("I have a weird spot from a pimple")).not.toContain("suspicious_lesion");
  });

  it("suppresses stable/unchanged disclosures and third-party lesions", () => {
    expect(matchedIds("my mole hasn't changed in years")).not.toContain("suspicious_lesion");
    expect(matchedIds("my mum has a weird mole")).not.toContain("suspicious_lesion");
  });
});
```

- [ ] **Step 3.2: Run to verify failure**

Run: `pnpm --filter @switchboard/core test common.test`
Expected: the `toContain("suspicious_lesion")` assertions FAIL.

- [ ] **Step 3.3: Add category + mapping + entry**

`types.ts` union (after `anticoagulant_use`): add `| "suspicious_lesion"`.
`REASON_CODE_BY_TRIGGER`: add `suspicious_lesion: "medical_safety_trigger",`.

`common.ts`, append after the `anticoagulant_use` entry:

```ts
  // The change/concern qualifier is the red flag (evolving lesion = melanoma
  // warning). A stable lesion or a routine pigmentation/melasma/acne request
  // is a normal service inquiry and must stay silent.
  {
    id: "suspicious_lesion",
    category: "suspicious_lesion",
    patterns: [
      // Lesion noun followed by a change/concern qualifier in the same clause.
      /\b(?:moles?|spots?|patch(?:es)?|birthmarks?|freckles?|lesions?|growths?|lumps?|bumps?|sores?)\b[^.!?]{0,40}\b(?:chang(?:ing|ed|es)|grow(?:ing|n|s)|bigger|darker|darken(?:ing|ed)|bleed(?:ing|s)?|bled|itch(?:y|ing|es)?|crust(?:y|ing|ed)?|scab(?:by|bing|bed)?|flak(?:y|ing)|painful|hurts?|raised|irregular|asymmetric(?:al)?|uneven|jagged|suspicious|concerning|worrying|weird|strange|odd|newly appeared|won['’]?t (?:go away|heal)|doesn['’]?t (?:go away|heal)|not healing)\b/i,
      // Qualifier-first order: "a changing/darkening/suspicious mole".
      /\b(?:chang(?:ing|ed)|grow(?:ing)|darken(?:ing|ed)|darker|bleeding|itchy|crusty|scabby|flaky|painful|irregular|asymmetric(?:al)?|uneven|jagged|suspicious|concerning|worrying|weird|strange|odd)\b[^.!?]{0,24}\b(?:moles?|spots?|patch(?:es)?|birthmarks?|freckles?|lesions?|growths?|lumps?|bumps?|sores?)\b/i,
      // A NEW mole/lesion/growth (tight adjacency; "new spot" excluded as
      // routine acne/pigmentation phrasing).
      /\bnew\s+(?:moles?|lesions?|growths?)\b/i,
      // Explicit melanoma mention ("skin cancer" already fires via the
      // medical-condition entry's cancer pattern).
      /\bmelanomas?\b/i,
    ],
    negations: [
      // Stable/unchanged disclosures: "my mole hasn't changed".
      /\b(?:hasn['’]?t|haven['’]?t|not|never|no)\b[^.!?]{0,12}\b(?:chang(?:ed|ing)|grow(?:n|ing)|darken(?:ed|ing)|bigger|bleeding|itchy)\b/i,
      // Routine acne/melasma pigmentation contexts.
      /\bacne\s+(?:spots?|scars?|marks?|patch(?:es)?)\b/i,
      /\b(?:spots?|scars?|marks?|patch(?:es)?)\s+(?:from|after|left by)\s+(?:my\s+|a\s+)?(?:acne|breakouts?|pimples?)\b/i,
      /\bmelasma\b[^.!?]{0,12}\b(?:patch(?:es)?|spots?)\b/i,
      /\b(?:patch(?:es)?|spots?)\b[^.!?]{0,12}\bmelasma\b/i,
      // Third-party attribution.
      /\b(?:my|her|his|their|our)\s+(?:mum|mom|mother|father|dad|sister|brother|aunt|uncle|grand(?:ma|pa|mother|father)|cousin|friend|partner|husband|wife|parent|relative)(?:['’]s)?\b[^.!?]{0,24}\b(?:moles?|spots?|patch(?:es)?|lesions?|growths?|melanomas?|birthmarks?)\b/i,
    ],
  },
```

Window-math notes for the engineer:

- "mole that's been getting darker": noun + 19-char window + qualifier, fits {0,40}.
- "acne marks are getting darker": pattern 1 matches ("marks ... darker") but the acne
  negation span ("acne marks") overlaps the occurrence start, so it is suppressed.
- "new spot from a breakout": "new spot" is not in the new-noun alternation (only
  mole/lesion/growth) and "spot ... breakout" has no qualifier, so no pattern matches.

- [ ] **Step 3.4: Run to verify pass**

Run: `pnpm --filter @switchboard/core test common.test`
Expected: PASS.

- [ ] **Step 3.5: Commit**

```bash
git add packages/core/src/governance/escalation-triggers
git commit -m "feat(core): suspicious-lesion escalation trigger (medical red-flag slice 2)"
```

---

### Task 4: `recent_procedure` trigger

**Files:**

- Modify: `packages/core/src/governance/escalation-triggers/types.ts`
- Modify: `packages/core/src/governance/escalation-triggers/common.ts`
- Test: `packages/core/src/governance/escalation-triggers/__tests__/common.test.ts`

- [ ] **Step 4.1: Add failing fixtures**

```ts
describe("COMMON_ESCALATION_TRIGGERS - recent_procedure (medical red-flag slice 2)", () => {
  it("fires on just/recently + surgical noun", () => {
    expect(matchedIds("I just had a facelift, is HIFU ok?")).toContain("recent_procedure");
    expect(matchedIds("recently underwent surgery on my jaw")).toContain("recent_procedure");
    expect(matchedIds("i just got a nose job")).toContain("recent_procedure");
  });

  it("fires on surgical noun + recency marker", () => {
    expect(matchedIds("I had liposuction 3 weeks ago")).toContain("recent_procedure");
    expect(matchedIds("rhinoplasty last month, can I do laser?")).toContain("recent_procedure");
    expect(matchedIds("I had an operation on my nose two weeks ago")).toContain("recent_procedure");
    expect(matchedIds("had surgery yesterday")).toContain("recent_procedure");
  });

  it("fires on healing-state disclosures", () => {
    expect(matchedIds("I'm two weeks post-op")).toContain("recent_procedure");
    expect(matchedIds("still have stitches from my tummy tuck")).toContain("recent_procedure");
    expect(matchedIds("I'm still recovering from surgery")).toContain("recent_procedure");
  });

  it("stays silent on future/desire phrasing", () => {
    expect(matchedIds("I want a nose job")).not.toContain("recent_procedure");
    expect(matchedIds("thinking about a facelift next year")).not.toContain("recent_procedure");
    expect(matchedIds("I'm considering surgery next month")).not.toContain("recent_procedure");
  });

  it("stays silent on routine clinic treatments and old surgery", () => {
    expect(matchedIds("I had botox 2 weeks ago, want a top-up")).not.toContain("recent_procedure");
    expect(matchedIds("I had a facial last week")).not.toContain("recent_procedure");
    expect(matchedIds("I had surgery in 2019")).not.toContain("recent_procedure");
    expect(matchedIds("my surgery was ten years ago")).not.toContain("recent_procedure");
  });

  it("suppresses negations and third-party surgery", () => {
    expect(matchedIds("I haven't had any surgery, just botox last week")).not.toContain(
      "recent_procedure",
    );
    expect(matchedIds("no surgery last month, only facials")).not.toContain("recent_procedure");
    expect(matchedIds("my sister had a facelift last month")).not.toContain("recent_procedure");
  });
});
```

- [ ] **Step 4.2: Run to verify failure**

Run: `pnpm --filter @switchboard/core test common.test`
Expected: the `toContain("recent_procedure")` assertions FAIL.

- [ ] **Step 4.3: Add category + mapping + entry**

`types.ts` union (after `suspicious_lesion`): add `| "recent_procedure"`.
`REASON_CODE_BY_TRIGGER`: add `recent_procedure: "medical_safety_trigger",`.

`common.ts`, append after the `suspicious_lesion` entry:

```ts
  // Recent surgery near a treatment area + energy device is the locked red
  // flag; the deterministic net fires on the recent-surgery disclosure alone
  // (in-area-ness is conversational context a regex cannot adjudicate).
  // Surgical nouns only: "I had botox/a facial last week" is a returning
  // customer, not a red flag, so routine clinic treatments and the bare word
  // "procedure" are deliberately excluded.
  {
    id: "recent_procedure",
    category: "recent_procedure",
    patterns: [
      /\b(?:just|recently)\s+(?:had|got|underwent|finished)\b[^.!?]{0,30}\b(?:surgery|operation|facelift|face[ -]lift|liposuction|lipo|rhinoplasty|nose job|blepharoplasty|eyelid surgery|tummy tuck|abdominoplasty|implants?|thread[ -]?lift)\b/i,
      /\b(?:surgery|operation|facelift|face[ -]lift|liposuction|rhinoplasty|nose job|blepharoplasty|eyelid surgery|tummy tuck|abdominoplasty|thread[ -]?lift)\b[^.!?]{0,30}\b(?:(?:a|one|two|three|four|five|six|couple of|few|\d{1,2})\s+(?:days?|weeks?)\s+ago|(?:a|one|two|three|four|five|six|couple of|few)\s+months?\s+ago|last\s+(?:week|month)|this\s+(?:week|month)|yesterday)\b/i,
      /\b(?:had|got|underwent)\b[^.!?]{0,16}\b(?:surgery|operation|facelift|liposuction|rhinoplasty|blepharoplasty|tummy tuck|thread[ -]?lift)\b[^.!?]{0,30}\b(?:(?:a|one|two|three|four|five|six|couple of|few|\d{1,2})\s+(?:days?|weeks?)\s+ago|(?:a|one|two|three|four|five|six|couple of|few)\s+months?\s+ago|last\s+(?:week|month)|this\s+(?:week|month)|yesterday)\b/i,
      /\bpost[ -]?op(?:erative)?\b/i,
      /\b(?:recover(?:ing|y)|healing)\s+from\b[^.!?]{0,20}\b(?:surgery|operation|facelift|liposuction|rhinoplasty|blepharoplasty|tummy tuck|thread[ -]?lift)\b/i,
      /\b(?:still\s+have|got)\s+(?:stitches|sutures)\b|\b(?:stitches|sutures)\s+(?:from|out|removed)\b/i,
    ],
    negations: [
      /\b(?:no|never|haven['’]?t|not|didn['’]?t)\b[^.!?]{0,16}\b(?:surgery|operation|surgical)\b/i,
      /\b(?:my|her|his|their|our)\s+(?:mum|mom|mother|father|dad|sister|brother|aunt|uncle|grand(?:ma|pa|mother|father)|cousin|friend|partner|husband|wife|parent|relative)\b[^.!?]{0,20}\b(?:surgery|operation|facelift|liposuction|rhinoplasty|blepharoplasty|tummy tuck)\b/i,
    ],
  },
```

Window-math notes:

- "I had surgery in 2019": pattern 2 requires ago/last/this/yesterday, "in 2019" never
  matches; patterns 1/3 require just/recently or a recency tail. Silent.
- "no surgery last month": pattern 2 matches ("surgery ... last month") but the negation
  span ("no ... surgery") overlaps the occurrence start. Suppressed.
- "I had botox 2 weeks ago": botox is not in the surgical-noun alternation. Silent.

- [ ] **Step 4.4: Run to verify pass**

Run: `pnpm --filter @switchboard/core test common.test`
Expected: PASS.

- [ ] **Step 4.5: Commit**

```bash
git add packages/core/src/governance/escalation-triggers
git commit -m "feat(core): recent-procedure escalation trigger (medical red-flag slice 2)"
```

---

### Task 5: Loader exhaustiveness for the nine categories

**Files:**

- Test: `packages/core/src/governance/escalation-triggers/__tests__/loader.test.ts`

- [ ] **Step 5.1: Update the category-coverage and entry-floor tests**

In `loader.test.ts`, the "merged tables cover all six trigger categories" test: rename to
"merged tables cover all nine trigger categories" and extend `allCategories`:

```ts
const allCategories = [
  "pregnancy_breastfeeding",
  "prior_adverse_reaction",
  "anticoagulant_use",
  "suspicious_lesion",
  "recent_procedure",
  "prior_complaint",
  "competitor_negative",
  "multi_treatment_combo",
  "sensitive_keyword",
] as const;
```

In the entry-floor test, raise the floor from 10 to 13 (12 common + 1 jurisdiction
entry as of this slice) so accidental entry deletion bites. The category-coverage test
above is the load-bearing one; the floor is just a tripwire, so keep its comment honest
about that:

```ts
expect(entries.length, `${j} total escalation-trigger entries`).toBeGreaterThanOrEqual(13);
```

- [ ] **Step 5.2: Run to verify pass**

Run: `pnpm --filter @switchboard/core test loader.test`
Expected: PASS (entries already exist from Tasks 2-4; this pins them).

- [ ] **Step 5.3: Commit**

```bash
git add packages/core/src/governance/escalation-triggers/__tests__/loader.test.ts
git commit -m "test(core): loader exhaustiveness covers the three new trigger categories"
```

---

### Task 6: Route medical trigger handoffs through reason `medical_safety`

**Files:**

- Modify: `packages/core/src/governance/escalation-triggers/types.ts` (mapping function)
- Modify: `packages/core/src/channel-gateway/pre-input-gate.ts` (builder + both call sites)
- Test: `packages/core/src/governance/escalation-triggers/__tests__/types.test.ts` (new)
- Test: `packages/core/src/channel-gateway/__tests__/channel-gateway-deterministic-gate.test.ts` (update one pin)

- [ ] **Step 6.1: Write the failing mapping test**

Create `packages/core/src/governance/escalation-triggers/__tests__/types.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { EscalationTriggerCategory } from "../types.js";
import { REASON_CODE_BY_TRIGGER, handoffReasonForTriggerCategory } from "../types.js";

describe("handoffReasonForTriggerCategory", () => {
  it("routes every medical_safety_trigger category to handoff reason medical_safety", () => {
    const medical: EscalationTriggerCategory[] = [
      "pregnancy_breastfeeding",
      "prior_adverse_reaction",
      "anticoagulant_use",
      "suspicious_lesion",
      "recent_procedure",
    ];
    for (const c of medical) {
      expect(REASON_CODE_BY_TRIGGER[c]).toBe("medical_safety_trigger");
      expect(handoffReasonForTriggerCategory(c)).toBe("medical_safety");
    }
  });

  it("keeps every non-medical category on compliance_concern", () => {
    const all = Object.keys(REASON_CODE_BY_TRIGGER) as EscalationTriggerCategory[];
    for (const c of all) {
      if (REASON_CODE_BY_TRIGGER[c] === "medical_safety_trigger") continue;
      expect(handoffReasonForTriggerCategory(c)).toBe("compliance_concern");
    }
  });
});
```

- [ ] **Step 6.2: Run to verify failure**

Run: `pnpm --filter @switchboard/core test escalation-triggers/__tests__/types`
Expected: FAIL ("handoffReasonForTriggerCategory" is not exported).

- [ ] **Step 6.3: Implement the mapping + thread it through the gate**

In `types.ts`, change the schemas import to include `HandoffReason` and add the function:

```ts
import type { GovernanceVerdictReason, HandoffReason } from "@switchboard/schemas";
```

```ts
/**
 * Handoff reason for an enforce-mode input-gate block, derived from the
 * verdict reason so the two taxonomies stay deliberately mapped (#791
 * seam-reuse finding): a trigger category is medical iff its verdict reason
 * is medical_safety_trigger.
 */
export function handoffReasonForTriggerCategory(
  category: EscalationTriggerCategory,
): HandoffReason {
  return REASON_CODE_BY_TRIGGER[category] === "medical_safety_trigger"
    ? "medical_safety"
    : "compliance_concern";
}
```

In `pre-input-gate.ts`:

1. Extend the import:

```ts
import {
  REASON_CODE_BY_TRIGGER,
  handoffReasonForTriggerCategory,
} from "../governance/escalation-triggers/types.js";
```

2. `buildInputHandoffPackage` gains a `reason` parameter (type via the existing
   `Handoff` import, no new type imports):

```ts
function buildInputHandoffPackage(
  sessionId: string,
  orgId: string,
  reason: Handoff["reason"],
  clock: () => Date,
): Handoff {
  return {
    id: createId(),
    sessionId,
    organizationId: orgId,
    reason,
    status: "pending",
    ...
```

3. Both call sites (main enforce path ~line 176, fail-closed path ~line 328) become:

```ts
await handoffStore.save(
  buildInputHandoffPackage(
    sessionId,
    organizationId,
    handoffReasonForTriggerCategory(firstEntry.category),
    () => new Date(),
  ),
);
```

Verified: `firstEntry` is already in scope at BOTH sites (main path computes it at
`pre-input-gate.ts:105-107`; the fail-closed branch computes its own at `:263-264` for
the verdict reasonCode). Derive the handoff reason from that same first matched entry;
do NOT infer medical safety from raw text or reason strings, and do NOT hardcode
`"medical_safety"` at either site.

4. Update the existing pin in `channel-gateway-deterministic-gate.test.ts` (~line 377,
   Test 4, which matches a pregnancy fixture):

```ts
// pregnancy_breastfeeding is a medical category: handoff reason routes to
// medical_safety (slice 2); non-medical categories keep compliance_concern.
expect(handoffPkg.reason).toBe("medical_safety");
```

- [ ] **Step 6.4: Run to verify pass**

Run: `pnpm --filter @switchboard/core test escalation-triggers channel-gateway`
Expected: PASS.

Run: `pnpm --filter @switchboard/core typecheck`
Expected: PASS.

- [ ] **Step 6.5: Commit**

```bash
git add packages/core/src/governance/escalation-triggers packages/core/src/channel-gateway
git commit -m "feat(core): route medical trigger handoffs through reason medical_safety"
```

---

### Task 7: Real-taxonomy gate suite under the seeded observe posture

**Files:**

- Create: `packages/core/src/channel-gateway/__tests__/channel-gateway-medical-redflag-gate.test.ts`

- [ ] **Step 7.1: Write the suite (it should pass immediately; its red state is demonstrated adversarially in Task 8)**

```ts
/**
 * Medical red-flag slice 2: real-taxonomy tests for the pre-input gate.
 *
 * Unlike channel-gateway-deterministic-gate.test.ts (hand-built fixture
 * triggers), this suite drives ChannelGateway.handleIncoming with:
 *   - the REAL merged trigger taxonomy via loadEscalationTriggers, and
 *   - the REAL seeded pilot posture via buildObserveGovernanceConfig (the
 *     exact factory call packages/db/src/seed/medspa-governance-config.ts
 *     pins via its producer-parity test), so what is observed here is what
 *     the seed deploys.
 *
 * Acceptance proof: under the seeded observe posture the three new red-flag
 * categories are log-only (verdict allow/warning; submit proceeds with the
 * unchanged text; no handoff, no status flip, normal AI reply), and under a
 * future enforce posture they block with handoff reason "medical_safety".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildObserveGovernanceConfig } from "@switchboard/schemas";
import { ChannelGateway } from "../channel-gateway.js";
import type { ChannelGatewayConfig, IncomingChannelMessage } from "../types.js";
import { InMemoryGovernancePostureCache } from "../../governance/posture-cache.js";
import type { GovernanceConfigResolver } from "../../governance/governance-config-resolver.js";
import {
  loadEscalationTriggers,
  _resetEscalationTriggerCache,
} from "../../governance/escalation-triggers/index.js";
import type { SaveGovernanceVerdictInput } from "../../governance/governance-verdict-store/types.js";

const SG_HANDOFF_SUBSTRING = "I'll get them";

/** The real seeded pilot posture (see packages/db/src/seed/medspa-governance-config.ts). */
const OBSERVE_PILOT_CONFIG = buildObserveGovernanceConfig({
  jurisdiction: "SG",
  clinicType: "medical",
});

const RED_FLAGS = [
  {
    name: "anticoagulant_use",
    text: "I'm on blood thinners, can I still get filler?",
  },
  {
    name: "suspicious_lesion",
    text: "I have a mole that's been getting darker, can laser remove it?",
  },
  {
    name: "recent_procedure",
    text: "I just had a facelift, is HIFU ok?",
  },
] as const;

type Spy = ReturnType<typeof vi.fn>;

function makeMessage(text: string): IncomingChannelMessage {
  return { channel: "web_widget", token: "tok", sessionId: "sess-1", text };
}

function makeDeps() {
  return {
    verdictStore: {
      save: vi.fn().mockResolvedValue({ id: "vr-1" }),
      listByConversation: vi.fn(),
      listByDeployment: vi.fn(),
      countByDeploymentAndClaim: vi.fn(),
    },
    handoffStore: {
      save: vi.fn().mockResolvedValue(undefined),
      getById: vi.fn(),
      getBySessionId: vi.fn(),
      updateStatus: vi.fn(),
      listPending: vi.fn(),
    },
    statusSetter: { setConversationStatus: vi.fn().mockResolvedValue(undefined) },
    sendSpy: vi.fn().mockResolvedValue(undefined) as Spy,
    submitSpy: vi.fn().mockResolvedValue({
      ok: true,
      result: { outcome: "completed", outputs: { response: "Hello from agent" }, summary: "ok" },
      workUnit: { id: "wu-1", traceId: "trace-1" },
    }) as Spy,
  };
}

type Deps = ReturnType<typeof makeDeps>;

function makeConfig(resolver: GovernanceConfigResolver, deps: Deps): ChannelGatewayConfig {
  return {
    conversationStore: {
      getOrCreateBySession: vi.fn().mockResolvedValue({ conversationId: "conv-1", messages: [] }),
      addMessage: vi.fn().mockResolvedValue(undefined),
    },
    deploymentResolver: {
      resolveByChannelToken: vi.fn().mockResolvedValue({
        deploymentId: "dep-1",
        listingId: "listing-1",
        organizationId: "org-1",
        skillSlug: "alex",
        trustLevel: "guided",
        trustScore: 50,
        inputConfig: {},
      }),
      resolveByDeploymentId: vi.fn(),
      resolveByOrgAndSlug: vi.fn(),
    },
    platformIngress: { submit: deps.submitSpy },
    approvalStore: {
      save: vi.fn().mockResolvedValue(undefined),
      getById: vi.fn().mockResolvedValue(null),
      updateState: vi.fn().mockResolvedValue(undefined),
      listPending: vi.fn().mockResolvedValue([]),
    },
    governanceConfigResolver: resolver,
    escalationTriggerLoader: (j: "SG" | "MY") => loadEscalationTriggers(j),
    verdictStore: deps.verdictStore,
    postureCache: new InMemoryGovernancePostureCache(),
    handoffStore: deps.handoffStore,
    conversationStatusSetter: deps.statusSetter,
  };
}

function observeResolver(): GovernanceConfigResolver {
  return vi.fn().mockResolvedValue({ status: "resolved", config: OBSERVE_PILOT_CONFIG });
}

function enforceResolver(): GovernanceConfigResolver {
  return vi.fn().mockResolvedValue({
    status: "resolved",
    config: {
      ...OBSERVE_PILOT_CONFIG,
      deterministicGate: { mode: "enforce" },
    },
  });
}

describe("medical red-flag triggers through the real gate (seeded observe posture)", () => {
  let deps: Deps;

  beforeEach(() => {
    _resetEscalationTriggerCache();
    deps = makeDeps();
  });

  for (const flag of RED_FLAGS) {
    it(`${flag.name}: observe is log-only and lead-invisible`, async () => {
      const gw = new ChannelGateway(makeConfig(observeResolver(), deps));

      await gw.handleIncoming(makeMessage(flag.text), { send: deps.sendSpy });

      // Submit proceeds with the UNCHANGED inbound text (field-level assertion:
      // the gateway submits the raw text as parameters.message,
      // channel-gateway.ts:314-315).
      expect(deps.submitSpy).toHaveBeenCalledOnce();
      const submitted = deps.submitSpy.mock.calls[0]![0];
      expect(submitted.parameters.message).toBe(flag.text);

      // Normal AI reply reaches the lead; no handoff text.
      expect(deps.sendSpy).toHaveBeenCalledWith("Hello from agent");

      // Verdict persisted log-only: allow/warning with the medical reason.
      expect(deps.verdictStore.save).toHaveBeenCalledOnce();
      const v = deps.verdictStore.save.mock.calls[0]![0] as SaveGovernanceVerdictInput;
      expect(v.action).toBe("allow");
      expect(v.auditLevel).toBe("warning");
      expect(v.reasonCode).toBe("medical_safety_trigger");
      expect(v.sourceGuard).toBe("escalation_trigger");
      expect(v.jurisdiction).toBe("SG");
      expect(v.details?.matchCategory).toBe(flag.name);

      // No handoff, no status flip: byte-identical lead experience.
      expect(deps.handoffStore.save).not.toHaveBeenCalled();
      expect(deps.statusSetter.setConversationStatus).not.toHaveBeenCalled();
    });
  }

  it("clean booking message under observe: no verdict at all", async () => {
    const gw = new ChannelGateway(makeConfig(observeResolver(), deps));
    await gw.handleIncoming(makeMessage("hello, I'd like to book an appointment"), {
      send: deps.sendSpy,
    });
    expect(deps.submitSpy).toHaveBeenCalledOnce();
    expect(deps.verdictStore.save).not.toHaveBeenCalled();
  });

  it("negated disclosure under observe: no verdict (real-taxonomy negation proof)", async () => {
    const gw = new ChannelGateway(makeConfig(observeResolver(), deps));
    await gw.handleIncoming(makeMessage("I'm not on blood thinners, just vitamins"), {
      send: deps.sendSpy,
    });
    expect(deps.submitSpy).toHaveBeenCalledOnce();
    expect(deps.verdictStore.save).not.toHaveBeenCalled();
  });
});

describe("medical red-flag triggers through the real gate (future enforce posture)", () => {
  let deps: Deps;

  beforeEach(() => {
    _resetEscalationTriggerCache();
    deps = makeDeps();
  });

  for (const flag of RED_FLAGS) {
    it(`${flag.name}: enforce blocks submit and hands off with reason medical_safety`, async () => {
      const gw = new ChannelGateway(makeConfig(enforceResolver(), deps));

      await gw.handleIncoming(makeMessage(flag.text), { send: deps.sendSpy });

      expect(deps.submitSpy).not.toHaveBeenCalled();
      expect(deps.statusSetter.setConversationStatus).toHaveBeenCalledWith(
        "sess-1",
        "human_override",
        { channel: "web_widget", principalId: "visitor-sess-1" },
      );
      expect(deps.handoffStore.save).toHaveBeenCalledOnce();
      expect(deps.handoffStore.save.mock.calls[0]![0].reason).toBe("medical_safety");
      expect(deps.sendSpy.mock.calls[0]![0]).toContain(SG_HANDOFF_SUBSTRING);

      const v = deps.verdictStore.save.mock.calls[0]![0] as SaveGovernanceVerdictInput;
      expect(v.action).toBe("escalate");
      expect(v.auditLevel).toBe("critical");
      expect(v.reasonCode).toBe("medical_safety_trigger");
    });
  }

  it("fail-closed cached-enforce path carries the medical handoff reason too", async () => {
    const erroringResolver: GovernanceConfigResolver = vi.fn().mockResolvedValue({
      status: "error",
      error: new Error("DB timeout"),
    });
    const config = makeConfig(erroringResolver, deps);
    config.postureCache!.remember("dep-1", {
      mode: "enforce",
      jurisdiction: "SG",
      clinicType: "medical",
    });
    const gw = new ChannelGateway(config);

    await gw.handleIncoming(makeMessage(RED_FLAGS[0].text), { send: deps.sendSpy });

    expect(deps.submitSpy).not.toHaveBeenCalled();
    expect(deps.handoffStore.save).toHaveBeenCalledOnce();
    expect(deps.handoffStore.save.mock.calls[0]![0].reason).toBe("medical_safety");
  });
});
```

Note: if `postureCache` is not optional on the config type, drop the `!` accordingly;
if `ChannelGatewayConfig` requires fields this harness omits, mirror the stub shape from
`channel-gateway-deterministic-gate.test.ts` (it is the canonical harness).

- [ ] **Step 7.2: Run to verify pass**

Run: `pnpm --filter @switchboard/core test channel-gateway-medical-redflag-gate`
Expected: PASS (8 tests).

- [ ] **Step 7.3: Run the whole core suite**

Run: `pnpm --filter @switchboard/core test`
Expected: PASS (no regressions elsewhere in core).

- [ ] **Step 7.4: Commit**

```bash
git add packages/core/src/channel-gateway/__tests__/channel-gateway-medical-redflag-gate.test.ts
git commit -m "test(core): real-taxonomy medical red-flag gate suite under seeded observe posture"
```

---

### Task 8: Adversarial bites + full local gate

- [ ] **Step 8.1: Demonstrate bite A (pattern removal reds the net)**

Temporarily comment out the entire `anticoagulant_use` entry in `common.ts`. Run:

`pnpm --filter @switchboard/core test common.test channel-gateway-medical-redflag-gate`

Expected: FAIL (trigger-unit fixtures + the observe and enforce integration tests for
anticoagulant_use go red). Capture the failure summary for the PR body. Restore the
entry, re-run, confirm green.

- [ ] **Step 8.2: Demonstrate bite B (mapping reversion fails typecheck)**

Temporarily delete the `anticoagulant_use` line from `REASON_CODE_BY_TRIGGER`. Run:

`pnpm --filter @switchboard/core typecheck`

Expected: FAIL (TS2741: property `anticoagulant_use` missing in the exhaustive Record).
Capture the error for the PR body. Restore, re-run, confirm green.

- [ ] **Step 8.3: Demonstrate bite C (handoff-reason call-site reversion reds the suite)**

Temporarily revert one call site to `buildInputHandoffPackage(sessionId, organizationId,
"compliance_concern", () => new Date())`. Run:

`pnpm --filter @switchboard/core test channel-gateway-medical-redflag-gate`

Expected: FAIL (enforce tests assert `medical_safety`). Restore, confirm green.

- [ ] **Step 8.4: Full local gate**

```bash
pnpm build && pnpm typecheck && pnpm test && pnpm format:check && pnpm lint && pnpm arch:check
```

Expected: green, modulo the documented pre-existing flakes ONLY:

- chat `gateway-bridge-attribution` may flake under full-suite load (passes isolated)
- db `pg_advisory`/ledger/greeting tests need local Postgres
- `Eval - Claim Classifier` live-model step is red on main (#631 bake, not ours)

If `pnpm format:check` flags the new/edited files, run `pnpm format` (or
`pnpm exec prettier --write <files>`) and amend.

- [ ] **Step 8.5: Commit any gate fixes**

```bash
git add -A && git commit -m "chore(core): format and gate fixes for medical red-flag slice 2"
```

(Skip if the gate was already clean.)

---

## Self-review checklist (run after implementation)

1. Spec coverage: §4.1 (Tasks 2-4), §4.2 (Task 6), §4.3 (Task 1), §5 layers 1-3
   (Tasks 2-4 / 1 / 7), §5 item 4 bites (Task 8), §6 acceptance 1-7 all mapped.
2. No new files outside `packages/core/src/governance/**`, `packages/core/src/channel-gateway/**`,
   `docs/superpowers/**`.
3. `git log origin/main..HEAD --name-only` touches no schemas/db/apps/eval paths.
4. Classifier untouched: `git diff origin/main --stat -- 'packages/core/src/governance/classifier'`
   is empty.
