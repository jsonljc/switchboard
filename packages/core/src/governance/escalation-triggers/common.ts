import type { EscalationTriggerEntry } from "./types.js";

export const COMMON_ESCALATION_TRIGGERS: ReadonlyArray<EscalationTriggerEntry> = [
  {
    id: "pregnancy",
    category: "pregnancy_breastfeeding",
    patterns: [/\bpregnan(t|cy)\b/i, /\b(expect(ing)?|with child)\b/i],
    negations: [/\b(not|never|no longer|wasn'?t)\b[^.!?]*\b(pregnan(t|cy)|expecting)\b/i],
  },
  {
    id: "breastfeeding",
    category: "pregnancy_breastfeeding",
    patterns: [/\b(breast ?feeding|nursing|lactating)\b/i],
    negations: [/\b(not|never|no longer|stopped)\b[^.!?]*\b(breast ?feeding|nursing|lactating)\b/i],
  },
  {
    id: "prior_adverse_reaction",
    category: "prior_adverse_reaction",
    patterns: [
      /\b(allergic reaction|allergy|severe reaction|bad reaction|anaphylaxis)\b/i,
      /\b(burn(ed|t)?|scarred|swollen badly) after\b/i,
    ],
    negations: [/\b(no|never|no history of)\b[^.!?]*\b(reaction|allergy)\b/i],
  },
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
  {
    id: "prior_complaint",
    category: "prior_complaint",
    patterns: [
      /\b(complain(ed|t)|filed (a )?complaint|legal action)\b/i,
      /\b(unhappy|disappointed|refund) (with|from) (the|my last|previous) (clinic|treatment)\b/i,
    ],
    negations: [/\b(no|never had a|didn'?t)\b[^.!?]*\bcomplain/i],
  },
  {
    id: "competitor_negative",
    category: "competitor_negative",
    patterns: [
      /\b(better than|cheaper than|inferior to)\b[^.!?]*\b(other clinic|competitor)\b/i,
      /\b(scammed|cheated|misled) by\b/i,
    ],
  },
  {
    id: "multi_treatment_combo",
    category: "multi_treatment_combo",
    patterns: [
      /\b(combine|stack|together|same day)\b[^.!?]*\b(botox|filler|laser|peel|skinbooster|profhilo)\b/i,
    ],
    // T1.2b: do not escalate when the user is declining a combo.
    negations: [
      /\b(?:not|don'?t|do not|rather not|prefer not|avoid|without|never)\b[^.!?]{0,20}\b(?:combin\w*|stack\w*|together|same day)\b/i,
    ],
  },
  {
    id: "sensitive_keyword_minor",
    category: "sensitive_keyword",
    patterns: [
      /\b(my (daughter|son)|teenage|under ?\s?(16|18))\b/i,
      // T1.5: self-disclosed age 10-17 (numeric or spelled). Present-tense only
      // ("I'm"/"I am"/"I (just) turned"); past-tense "I was 16" is adult
      // reminiscence, not a minor. The unit lookahead rejects duration/measure
      // phrasings ("16 years of experience", "16 weeks", "160cm"); \b after 1[0-7]
      // rejects "160"; 18 is excluded (can consent). ['’] accepts a curly
      // apostrophe (mobile autocorrect) as well as a straight one.
      /\bi(?:['’]?m| am)\s+(?:only\s+|just\s+|almost\s+|nearly\s+|turning\s+)?(1[0-7]|thirteen|fourteen|fifteen|sixteen|seventeen)\b(?!\s*(?:years?\s+of|weeks?|months?|days?|hours?|min(?:ute)?s?|kg|kgs|lbs?|pounds?|stone|cm|%|percent|sessions?|times?|grand|dollars?))/i,
      // "I (just) turned 16" — a recent birthday, so currently a minor.
      /\bi\s+(?:just\s+|recently\s+)?turned\s+(1[0-7])\b(?!\s*years?\s+(?:of|into|ago))/i,
      // glued age-unit shorthand the \b above misses: "16yo", "16 y/o", "16yrs".
      /\bi(?:['’]?m| am)\s+(?:only\s+|just\s+)?(1[0-7])\s*(?:yo|y\/o|yrs?)\b/i,
      /\bi(?:['’]?m| am)\s+(?:a\s+)?(minor|underage|under ?18|not (?:yet )?18|below 18)\b/i,
    ],
  },
  {
    id: "sensitive_keyword_medical_condition",
    category: "sensitive_keyword",
    patterns: [
      /\b(diabet(es|ic)|hypertension|high blood pressure|cancer|chemo(therapy)?|pacemaker|epilepsy|seizures?)\b/i,
    ],
    // T1.2b: suppress clear self-negations and third-party (family-history)
    // attributions. Tight windows keep a genuine first-person condition escalating.
    negations: [
      /\b(?:not|never|don'?t|doesn'?t|do not|does not|isn'?t|aren'?t|haven'?t|hasn'?t)\b[^.!?]{0,12}\b(?:diabet(?:es|ic)|hypertension|high blood pressure|cancer|chemo(?:therapy)?|pacemaker|epilepsy|seizures?)\b/i,
      /\bno\s+(?:history\s+of\s+|family\s+history\s+of\s+|known\s+|prior\s+)?(?:diabet(?:es|ic)|hypertension|high blood pressure|cancer|chemo(?:therapy)?|pacemaker|epilepsy|seizures?)\b/i,
      /\b(?:my|her|his|their|our)\s+(?:mum|mom|mother|father|dad|sister|brother|aunt|uncle|grand(?:ma|pa|mother|father)|cousin|friend|partner|husband|wife|parent|relative)\b[^.!?]{0,16}\b(?:diabet(?:es|ic)|hypertension|high blood pressure|cancer|chemo(?:therapy)?|pacemaker|epilepsy|seizures?)\b/i,
    ],
  },
  // §2.5 conservative seed addition — mental health keywords.
  // T1.2a: bare "anxious"/"anxiety" no longer escalates (it is the designed
  // aesthetic-anxiety objection Alex handles, e.g. "anxious about my results").
  // Clinical / condition / history forms still escalate: suicidal ideation,
  // self-harm, eating disorders, clinical depression, panic attacks, and anxiety
  // framed as a disorder/condition ("anxiety disorder", "history of anxiety",
  // "diagnosed with / dealing with anxiety", etc.) require immediate human review.
  {
    id: "sensitive_keyword_mental_health",
    category: "sensitive_keyword",
    patterns: [
      /\b(depress(ed|ion)|suicidal|self.harm|eating disorder|anorexia|bulimia|panic (attacks?|disorder)|anxiety (disorder|attacks?)|(generali[sz]ed|social|chronic|severe) anxiety|(history of|suffer(s|ing)? from|diagnosed with|struggl(e|es|ing) with|dealing with|battl(e|es|ing) with) anxiety|anxiety (medication|meds|pills))\b/i,
    ],
    negations: [
      /\b(?:not|never|don'?t|doesn'?t|do not|does not|isn'?t|aren'?t)\b[^.!?]{0,12}\b(?:depress(?:ed|ion)|suicidal|self.harm|eating disorder|anorexia|bulimia|panic (?:attacks?|disorder)|anxiety)\b/i,
    ],
  },
];
