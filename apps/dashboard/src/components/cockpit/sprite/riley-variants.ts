// Riley pixel-sprite variants — 24×24 grids.
// Ported byte-identical from docs/design-prompts/locked/switchboard/project/agent-home-v3/riley-sprites.jsx.
// Frame literals are NOT to be edited; if the design updates, re-port the file.
// Bundle keys: analyst | trader | bot (NOT the variantOption labels in riley-config.jsx
// which drifted to terminal | agent — see spec §6.1).

import { mergeSprite } from "./build-sprite";
import type { Frame, Palette, VariantBundle } from "./types";

// Always throws on bad row length — malformed rows are a build-time bug,
// not a runtime condition. (Design's riley-sprites.jsx uses console.warn; we
// upgraded to throw because the design canvas is dev-only.)
function R(s: string): string {
  if (s.length !== 24) throw new Error(`sprite row length ${s.length}, expected 24: ${s}`);
  return s;
}

// ═══════════════════════════════════════════════════════════════════
// Variant A — RILEY ANALYST
// Ponytail, big rounded glasses, lavender blouse + pearl. Reads as
// sharp marketing-ops. Glasses pop is the silhouette.
// ═══════════════════════════════════════════════════════════════════
const RA_PAL: Palette = {
  K: "#1a1108",
  H: "#3a1e10", // dark auburn hair
  E: "#6a3018",
  S: "#f5c79a",
  D: "#cd8a5a",
  G: "#e6f2ff", // glasses lens
  M: "#1a0c06",
  C: "#dc7a6a",
  B: "#9d8ac8", // lavender blouse
  L: "#bba6e0",
  W: "#f5ebd6",
  T: "#f0d885", // gold pearl
  Z: "#7c6a48",
  Y: "#f1c34a",
  P: "#ffffff",
  X: "#3a8a5a", // green up-arrow / chart
  Q: "#c0533c", // red bar
};

const RA_BASE: Frame = [
  R("........................"), //  0
  R("........KKKKKKKK........"), //  1 hair crown
  R(".......KHHHHHHHHK......."), //  2
  R("......KHHEHHHHEHHK......"), //  3 highlight
  R(".....KHHHHHHHHHHHHK....."), //  4
  R("....KHHHHHHHHHHHHHHK...."), //  5
  R("...KHHHSSSSSSSSSSHHHK..."), //  6 bangs framed in hair
  R("..KHHHSSSSSSSSSSSSHHHK.."), //  7 long hair sides begin
  R("..KHHSSSSSSSSSSSSSSHHK.."), //  8
  R("..HHKKGGGGSSSSGGGGKKHH.."), //  9 glasses + long hair
  R("..HHKGGMMGSSSSGMMGGKHH.."), // 10 pupils
  R("..HHKGGMMGSSSSGMMGGKHH.."), // 11
  R("..HHKKGGGGSSSSGGGGKKHH.."), // 12
  R("..HHKSCSSSSCCSSCSKHH...."), // 13 lipstick (pink C in centre)
  R("...HHKSSSSSSSSSSSSKHH..."), // 14
  R("...HHHKSSSSSSSSSSKHHH..."), // 15 hair tips
  R("....HHKSSSSSSSSKHH......"), // 16
  R("....KKBBBBBWWWWBBBBKK..."), // 17 collar
  R("...KBBLBBBBKTKBBBBLBBK.."), // 18 pearl
  R("..KBBBBBBLBBBBBLBBBBBBK."), // 19
  R(".KBBBBLBBBBBBBBBBBLBBBK."), // 20
  R("KBLBBBBBBBLBBBLBBBBBBBLK"), // 21
  R("KBBBBBBBBBBBBBBBBBBBBBBK"), // 22
  R("KBBBBBBBBBBBBBBBBBBBBBBK"), // 23
];

const RA_BLINK: Frame = mergeSprite(RA_BASE, [
  ["row", 10, 0, "....KGGSSGSSSSGSSGGK...."],
  ["row", 11, 0, "....KGGSSGSSSSGSSGGK...."],
  ["px", 6, 10, "M"],
  ["px", 7, 10, "M"],
  ["px", 16, 10, "M"],
  ["px", 17, 10, "M"],
]);

const RA_DRAFT_BASE: Frame = mergeSprite(RA_BASE, [
  ["px", 6, 8, "H"],
  ["px", 7, 8, "H"],
  ["px", 16, 8, "H"],
  ["px", 17, 8, "H"],
  ["row", 13, 0, ".....KSCSSSMMSSSCSK....."],
]);
const RA_DRAFT_1: Frame = RA_DRAFT_BASE;
const RA_DRAFT_2: Frame = mergeSprite(RA_DRAFT_BASE, [["row", 13, 0, ".....KSCSSMMMMSSCSK....."]]);

const RA_SLEEP: Frame = mergeSprite(RA_BASE, [
  ["row", 10, 0, "....KGGSSGSSSSGSSGGK...."],
  ["row", 11, 0, "....KGGSSGSSSSGSSGGK...."],
  ["px", 6, 10, "M"],
  ["px", 7, 10, "M"],
  ["px", 16, 10, "M"],
  ["px", 17, 10, "M"],
  ["row", 13, 0, ".....KSSSSSMMSSSSSK....."],
  ["px", 19, 2, "Z"],
  ["px", 20, 2, "Z"],
  ["px", 21, 2, "Z"],
  ["px", 21, 3, "Z"],
  ["px", 20, 4, "Z"],
  ["px", 19, 5, "Z"],
  ["px", 20, 5, "Z"],
  ["px", 21, 5, "Z"],
]);
const RA_SLEEP_2: Frame = mergeSprite(RA_BASE, [
  ["row", 10, 0, "....KGGSSGSSSSGSSGGK...."],
  ["row", 11, 0, "....KGGSSGSSSSGSSGGK...."],
  ["px", 6, 10, "M"],
  ["px", 7, 10, "M"],
  ["px", 16, 10, "M"],
  ["px", 17, 10, "M"],
  ["row", 13, 0, ".....KSSSSSMMSSSSSK....."],
  ["px", 18, 0, "Z"],
  ["px", 19, 0, "Z"],
  ["px", 20, 0, "Z"],
  ["px", 20, 1, "Z"],
  ["px", 19, 2, "Z"],
  ["px", 18, 3, "Z"],
  ["px", 19, 3, "Z"],
  ["px", 20, 3, "Z"],
]);

// Win = CTR spike. Tiny chart bars + up arrow.
const RA_WON: Frame = mergeSprite(RA_BASE, [
  ["row", 13, 0, ".....KSMMMMMMMMMSSK....."],
  ["row", 14, 0, ".....KSSSMMMMMSSSSK....."],
  ["px", 8, 10, "P"],
  ["px", 15, 10, "P"],
]);
const RA_WON_STAR_A: Frame = mergeSprite(RA_WON, [
  // up-arrow chart top-right
  ["px", 22, 5, "X"],
  ["px", 21, 6, "X"],
  ["px", 22, 6, "X"],
  ["px", 20, 7, "X"],
  ["px", 21, 7, "X"],
  ["px", 22, 7, "X"],
  // little bars top-left
  ["px", 1, 7, "Q"],
  ["px", 2, 6, "Q"],
  ["px", 3, 5, "X"],
  ["px", 4, 4, "X"],
]);
const RA_WON_STAR_B: Frame = mergeSprite(RA_WON, [
  ["px", 22, 6, "X"],
  ["px", 21, 7, "X"],
  ["px", 22, 7, "X"],
  ["px", 1, 8, "Q"],
  ["px", 2, 7, "Q"],
  ["px", 3, 6, "X"],
  ["px", 4, 5, "X"],
  ["px", 5, 4, "Y"],
]);

// ═══════════════════════════════════════════════════════════════════
// Variant C — RILEY PIXEL TRADER
// Bloomberg-terminal energy. Green CRT visor over eyes (scrolling
// digits), headphones, dark jacket. Intense / nocturnal.
// ═══════════════════════════════════════════════════════════════════
const RC_PAL: Palette = {
  K: "#08120c",
  H: "#1a1108",
  E: "#3a2a18",
  S: "#f0bd92",
  D: "#cb8a5a",
  G: "#0a3a18", // CRT dark green
  M: "#7af0a0", // bright green digits
  C: "#dc7a6a",
  B: "#1a1a26", // dark navy/black jacket
  L: "#3a3a4e",
  W: "#5e8a72", // green shirt collar
  T: "#7af0a0",
  R: "#1a1108",
  N: "#bcb29a",
  Z: "#7c6a48",
  Y: "#f1c34a",
  P: "#ffffff",
  X: "#7af0a0",
  Q: "#dc4040",
};

const RC_BASE: Frame = [
  R("........................"), //  0
  R("........................"), //  1
  R("......KKKKKKKKKKKK......"), //  2 hair top
  R(".....KHHHHHHHHHHHHK....."), //  3
  R(".....KHHEHHHHHHHHEK....."), //  4
  R("....KHHHHHHHHHHHHHHK...."), //  5
  R("...KHHHHHHHHHHHHHHHHK..."), //  6 hair widens
  R("...KHHSSSSSSSSSSSSHHK..."), //  7 long sides
  R("..KKHKSSSSSSSSSSSSKHKK.."), //  8 headphone tops + hair
  R("..KRRKKKKKKKKKKKKKKRRKK."), //  9 CRT visor outer band
  R("..KRRKKGMGMGMGMGMGKRRK.."), // 10 CRT scanning digits
  R("..KRRKKGMGMGMGMGMGKRRK.."), // 11
  R("..HHKKKKKKKKKKKKKKKKHH.."), // 12 hair around jaw
  R("...HHKSCSSSMMSSCSSKHH..."), // 13 lipstick (C dot inside)
  R("....HHKSSSSSSSSSSKHH...."), // 14
  R(".....HHKSSSSSSSSKHH....."), // 15
  R("......HHKSSSSSSKHH......"), // 16
  R("....KKBBBBBWWWWBBBBBKK.."), // 17 lapel collar
  R("...KBBBBBLWTTTWLBBBBBK.."), // 18 trader tie (green)
  R("..KBBBBBBLWTTTWLBBBBBBK."), // 19
  R(".KBBBBBBBLWTTTWLBBBBBBBK"), // 20
  R("KBBBBBBBBBWTTTWBBBBBBBBK"), // 21
  R("KBBBBBBBBBBWTWBBBBBBBBBK"), // 22
  R("KBBBBBBBBBBBBBBBBBBBBBBK"), // 23
];

const RC_BLINK: Frame = mergeSprite(RC_BASE, [
  // visor flicker (digits go dark)
  ["row", 10, 0, "..KRRK.KGGGGGGGGGGK.RRK."],
  ["row", 11, 0, "..KRRK.KGGGGGGGGGGK.RRK."],
]);
const RC_SCAN_A: Frame = mergeSprite(RC_BASE, [["row", 10, 0, "..KRRK.KMGMGMGMGMGK.RRK."]]);

const RC_DRAFT_1: Frame = mergeSprite(RC_BASE, [
  ["row", 10, 0, "..KRRK.KMGMGMGMGMGK.RRK."],
  ["row", 11, 0, "..KRRK.KGMGMGMGMGMK.RRK."],
]);
const RC_DRAFT_2: Frame = mergeSprite(RC_BASE, [
  ["row", 10, 0, "..KRRK.KGMGMGMGMGMK.RRK."],
  ["row", 11, 0, "..KRRK.KMGMGMGMGMGK.RRK."],
]);

const RC_SLEEP: Frame = mergeSprite(RC_BASE, [
  // visor goes dark
  ["row", 10, 0, "..KRRK.KGGGGGGGGGGK.RRK."],
  ["row", 11, 0, "..KRRK.KGGGGGGGGGGK.RRK."],
  ["row", 13, 0, "......KSSSSSMMSSSSSK...."],
  ["px", 19, 2, "Z"],
  ["px", 20, 2, "Z"],
  ["px", 21, 2, "Z"],
  ["px", 21, 3, "Z"],
  ["px", 20, 4, "Z"],
  ["px", 19, 5, "Z"],
  ["px", 20, 5, "Z"],
  ["px", 21, 5, "Z"],
]);
const RC_SLEEP_2: Frame = mergeSprite(RC_BASE, [
  ["row", 10, 0, "..KRRK.KGGGGGGGGGGK.RRK."],
  ["row", 11, 0, "..KRRK.KGGGGGGGGGGK.RRK."],
  ["row", 13, 0, "......KSSSSSMMSSSSSK...."],
  ["px", 18, 0, "Z"],
  ["px", 19, 0, "Z"],
  ["px", 20, 0, "Z"],
  ["px", 20, 1, "Z"],
  ["px", 19, 2, "Z"],
  ["px", 18, 3, "Z"],
  ["px", 19, 3, "Z"],
  ["px", 20, 3, "Z"],
]);

const RC_WON: Frame = mergeSprite(RC_BASE, [
  // visor flares bright
  ["row", 10, 0, "..KRRK.KMMMMMMMMMMK.RRK."],
  ["row", 11, 0, "..KRRK.KMMMMMMMMMMK.RRK."],
  ["row", 13, 0, "......KSMMMMMMMSSSSK...."],
]);
const RC_WON_STAR_A: Frame = mergeSprite(RC_WON, [
  ["px", 22, 5, "X"],
  ["px", 21, 6, "X"],
  ["px", 22, 6, "X"],
  ["px", 1, 7, "X"],
  ["px", 2, 6, "X"],
  ["px", 3, 5, "X"],
  ["px", 4, 4, "X"],
]);
const RC_WON_STAR_B: Frame = mergeSprite(RC_WON, [
  ["px", 22, 6, "X"],
  ["px", 21, 7, "X"],
  ["px", 22, 7, "X"],
  ["px", 1, 8, "X"],
  ["px", 2, 7, "X"],
  ["px", 3, 6, "X"],
  ["px", 4, 5, "Y"],
  ["px", 5, 4, "Y"],
]);

// ═══════════════════════════════════════════════════════════════════
// Variant D — RILEY BOT
// Pastel android sibling to Alex Agent — different palette (teal +
// magenta, the "ad spend" colors). Antenna LED, visor, chest dial.
// ═══════════════════════════════════════════════════════════════════
const RD_PAL: Palette = {
  K: "#1a1820",
  H: "#363b4f",
  E: "#525a73",
  S: "#e6dbf1", // lavender face plate
  D: "#b8a8c7",
  G: "#f2a3c4", // magenta visor
  M: "#1a1820",
  C: "#9ce0d4", // teal cheek LED
  B: "#5a3a78", // purple chassis
  L: "#7e5a9e", // chassis highlight
  W: "#e8edf6",
  T: "#9ce0d4", // teal chest LED
  R: "#1a1820",
  N: "#bcc4d5",
  Z: "#6c6a8a",
  Y: "#f4d35e",
  P: "#ffffff",
  X: "#3a8a5a",
  Q: "#c25a3c",
};

const RD_BASE: Frame = [
  R("...........KK..........."), //  0 antenna
  R("...........KK..........."),
  R("..........KGGK.........."), //  2 antenna LED (magenta = active)
  R("........KKHHHHKK........"), //  3 helmet top
  R(".......KHHHHHHHHK......."), //  4
  R("......KHHHEHHEHHHK......"), //  5
  R("......KHHHHHHHHHHK......"), //  6
  R("....HHKSSSSSSSSSSSSKHH.."), //  7 hair tips out from helmet
  R("...HHKSSSSSSSSSSSSSSKHH."), //  8
  R("...HHKSSGGGGSSGGGGSSKHH."), //  9 visor outer
  R("...HHKSSGGMGSSGMGGSSKHH."), // 10 pupils
  R("...HHKSSGGGGSSGGGGSSKHH."), // 11
  R("...HHKSCSSSSSSSSSSCSKHH."), // 12 teal cheek LEDs + hair
  R("....HHKSSSCCMMCCSSSKHH.."), // 13 grille + pink lip hint
  R(".....HHKSDSSSSSSSSDSKHH."), // 14
  R("......HHKSDDDDDDDDSKH..."), // 15
  R(".......KSSSSSSSSK......."), // 16
  R("....KKBBBBLLLLBBBBKK...."), // 17 chest top
  R("...KBBBBBLNTNLBBBBBK...."), // 18 chest dial
  R("..KBBBBBBLNTNLBBBBBBK..."), // 19
  R(".KBBBBBBBLNTNLBBBBBBBK.."), // 20
  R("KBBBBBBBBBLLLLBBBBBBBBKK"), // 21
  R("KBBBBBBBBBBBBBBBBBBBBBKK"), // 22
  R("KBBBBBBBBBBBBBBBBBBBBBKK"), // 23
];

const RD_SCAN_L: Frame = mergeSprite(RD_BASE, [["row", 10, 0, "....KSSGMGGSSGMGGSSK...."]]);
const RD_SCAN_R: Frame = mergeSprite(RD_BASE, [["row", 10, 0, "....KSSGGGMSSGGGMSSK...."]]);

const RD_DRAFT_BASE: Frame = mergeSprite(RD_BASE, [
  ["row", 2, 0, "..........KYYK.........."],
  ["row", 13, 0, ".....KSSSSMMSSSSSSK....."],
]);
const RD_DRAFT_1: Frame = RD_DRAFT_BASE;
const RD_DRAFT_2: Frame = mergeSprite(RD_DRAFT_BASE, [["row", 13, 0, ".....KSSSMMMMSSSSSK....."]]);

const RD_SLEEP: Frame = mergeSprite(RD_BASE, [
  ["row", 2, 0, "..........KHHK.........."],
  ["row", 9, 0, "....KSSDDDDSSDDDDSSK...."],
  ["row", 10, 0, "....KSSDDDDSSDDDDSSK...."],
  ["row", 11, 0, "....KSSDDDDSSDDDDSSK...."],
  ["row", 13, 0, ".....KSSSSSMMSSSSSK....."],
  ["px", 19, 2, "Z"],
  ["px", 20, 2, "Z"],
  ["px", 21, 2, "Z"],
  ["px", 21, 3, "Z"],
  ["px", 20, 4, "Z"],
  ["px", 19, 5, "Z"],
  ["px", 20, 5, "Z"],
  ["px", 21, 5, "Z"],
]);
const RD_SLEEP_2: Frame = mergeSprite(RD_BASE, [
  ["row", 2, 0, "..........KHHK.........."],
  ["row", 9, 0, "....KSSDDDDSSDDDDSSK...."],
  ["row", 10, 0, "....KSSDDDDSSDDDDSSK...."],
  ["row", 11, 0, "....KSSDDDDSSDDDDSSK...."],
  ["row", 13, 0, ".....KSSSSSMMSSSSSK....."],
  ["px", 18, 0, "Z"],
  ["px", 19, 0, "Z"],
  ["px", 20, 0, "Z"],
  ["px", 20, 1, "Z"],
  ["px", 19, 2, "Z"],
  ["px", 18, 3, "Z"],
  ["px", 19, 3, "Z"],
  ["px", 20, 3, "Z"],
]);

const RD_WON: Frame = mergeSprite(RD_BASE, [
  ["px", 8, 10, "P"],
  ["px", 15, 10, "P"],
  ["row", 13, 0, ".....KSSMMMMMMMSSSK....."],
  ["row", 2, 0, "..........KYYK.........."],
]);
const RD_WON_STAR_A: Frame = mergeSprite(RD_WON, [
  ["px", 22, 5, "X"],
  ["px", 21, 6, "X"],
  ["px", 22, 6, "X"],
  ["px", 1, 7, "Q"],
  ["px", 2, 6, "Q"],
  ["px", 3, 5, "X"],
  ["px", 4, 4, "X"],
]);
const RD_WON_STAR_B: Frame = mergeSprite(RD_WON, [
  ["px", 22, 6, "X"],
  ["px", 21, 7, "X"],
  ["px", 22, 7, "X"],
  ["px", 1, 8, "Q"],
  ["px", 2, 7, "Q"],
  ["px", 3, 6, "X"],
  ["px", 4, 5, "X"],
  ["px", 5, 4, "Y"],
]);

// ═══════════════════════════════════════════════════════════════════
// Export bundle
// Bundle keys are canonical truth: analyst | trader | bot
// ═══════════════════════════════════════════════════════════════════
export const RILEY_VARIANTS: VariantBundle = {
  analyst: {
    name: "Riley Analyst",
    blurb: "Sharp marketing-ops. Ponytail, big round glasses, lavender blouse + pearl.",
    palette: RA_PAL,
    states: {
      idle: [
        { rows: RA_BASE, dur: 3200 },
        { rows: RA_BLINK, dur: 140 },
        { rows: RA_BASE, dur: 2400 },
        { rows: RA_BLINK, dur: 120 },
      ],
      draft: [
        { rows: RA_DRAFT_1, dur: 220 },
        { rows: RA_DRAFT_2, dur: 220 },
      ],
      sleep: [
        { rows: RA_SLEEP, dur: 900 },
        { rows: RA_SLEEP_2, dur: 900 },
      ],
      won: [
        { rows: RA_WON_STAR_A, dur: 380 },
        { rows: RA_WON_STAR_B, dur: 380 },
        { rows: RA_WON, dur: 280 },
      ],
    },
  },
  trader: {
    name: "Riley Pixel Trader",
    blurb: "Bloomberg-terminal energy. CRT visor with scanning digits, headphones, dark jacket.",
    palette: RC_PAL,
    states: {
      idle: [
        { rows: RC_BASE, dur: 1400 },
        { rows: RC_SCAN_A, dur: 700 },
        { rows: RC_BLINK, dur: 140 },
        { rows: RC_BASE, dur: 1800 },
      ],
      draft: [
        { rows: RC_DRAFT_1, dur: 160 },
        { rows: RC_DRAFT_2, dur: 160 },
      ],
      sleep: [
        { rows: RC_SLEEP, dur: 900 },
        { rows: RC_SLEEP_2, dur: 900 },
      ],
      won: [
        { rows: RC_WON_STAR_A, dur: 360 },
        { rows: RC_WON_STAR_B, dur: 360 },
        { rows: RC_WON, dur: 260 },
      ],
    },
  },
  bot: {
    name: "Riley Bot",
    blurb: "Pastel android. Magenta visor + teal cheek LEDs — the ad-spend palette.",
    palette: RD_PAL,
    states: {
      idle: [
        { rows: RD_BASE, dur: 1400 },
        { rows: RD_SCAN_L, dur: 800 },
        { rows: RD_BASE, dur: 1200 },
        { rows: RD_SCAN_R, dur: 800 },
      ],
      draft: [
        { rows: RD_DRAFT_1, dur: 220 },
        { rows: RD_DRAFT_2, dur: 220 },
      ],
      sleep: [
        { rows: RD_SLEEP, dur: 1100 },
        { rows: RD_SLEEP_2, dur: 1100 },
      ],
      won: [
        { rows: RD_WON_STAR_A, dur: 380 },
        { rows: RD_WON_STAR_B, dur: 380 },
        { rows: RD_WON, dur: 280 },
      ],
    },
  },
};
