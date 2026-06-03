/* eslint-disable max-lines */
// Mira pixel-sprite variants, 24x24 grids. Creative / UGC agent: short violet
// bob, blunt bangs, viewfinder, chest camera. Authored to match the Alex/Riley
// family discipline; frame literals are pixel-art data, not code, so the
// arch-check eslint-disable above is intentional.
import { mergeSprite } from "./build-sprite";
import type { Frame, Palette, SpriteCommand, VariantBundle } from "./types";

function R(s: string): string {
  if (s.length !== 24) throw new Error(`sprite row length ${s.length}, expected 24: ${s}`);
  return s;
}

const M_PAL: Palette = {
  K: "#1a1108", // outline
  H: "#6e4bb0", // violet hair main
  E: "#9a72d0", // violet hair highlight
  S: "#f5c79a", // skin (family match)
  D: "#cd8a5a", // skin shadow
  M: "#1a0c06", // eyes / mouth
  C: "#d2628f", // berry lip / cheek
  B: "#7d5bb8", // violet creative top
  L: "#9b7ed0", // top highlight
  W: "#f3ead0", // cream collar
  T: "#241733", // camera body
  G: "#bfe0d8", // camera lens (mint)
  N: "#efe8ff", // glint / highlight
  V: "#b98fe0", // eyeshadow / lash
  Z: "#7c6a48", // sleep Z
  Y: "#f1c34a", // star
  P: "#ffffff", // sparkle
  R: "#d94f7a", // REC dot
};

const M_BASE: Frame = [
  R("........................"),
  R("......KKKKKKKKKKKK......"),
  R(".....KHHHHHHHHHHHHK....."),
  R("....KHHHHHHHHHHHHHHK...."),
  R("...KHHHEHHHHHHHHEHHHK..."),
  R("...KHHHHHEHHHHEHHHHHK..."),
  R("...KHHHHHHHHHHHHHHHHK..."),
  R("...KHHHHHHHHHHHHHHHHK..."),
  R("...KHHHSSSSSSSSSSHHHK..."),
  R("...KHHSSVVSSSSVVSSHHK..."),
  R("...KHHSSMMSSSSMMSSHHK..."),
  R("...KHHSSMMSSSSMMSSHHK..."),
  R("...KHHSCSSSSSSSSCSHHK..."),
  R("...KHHSSSSCMMCSSSSHHK..."),
  R("...KHHSSSSSSSSSSSSHHK..."),
  R(".....KSSSSSSSSSSSSK....."),
  R("......KSSSSSSSSSSK......"),
  R("....KKBBBBBWWWWBBBBKK..."),
  R("...KBBBBLBWWWWBLBBBBK..."),
  R("..KBBBBBBBBBBBBBBBBBK..."),
  R(".KBBBBBBBKKKKKKBBBBBBBK."),
  R("KBBBBBBBBKKGGKKBBBBBBBBK"),
  R("KBBBBBBBBBKKKKBBBBBBBBBK"),
  R("KBBBBBBBBBBBBBBBBBBBBBBK"),
];

const M_BLINK: Frame = mergeSprite(M_BASE, [["row", 10, 0, "...KHHSSSSSSSSSSSSHHK..."]]);

const VIEWFINDER: SpriteCommand[] = [
  ["px", 1, 8, "G"],
  ["px", 2, 8, "G"],
  ["px", 1, 9, "G"],
  ["px", 22, 8, "G"],
  ["px", 21, 8, "G"],
  ["px", 22, 9, "G"],
  ["px", 1, 14, "G"],
  ["px", 2, 14, "G"],
  ["px", 1, 13, "G"],
  ["px", 22, 14, "G"],
  ["px", 21, 14, "G"],
  ["px", 22, 13, "G"],
];
const M_DRAFT_1: Frame = mergeSprite(M_BASE, [
  ...VIEWFINDER,
  ["row", 13, 0, "...KHHSSSCMMMCSSSSHHK..."],
  ["px", 20, 3, "R"],
]);
const M_DRAFT_2: Frame = mergeSprite(M_BASE, [
  ...VIEWFINDER,
  ["row", 13, 0, "...KHHSSSSCMMCSSSSHHK..."],
]);

const M_SLEEP_1: Frame = mergeSprite(M_BASE, [
  ["row", 10, 0, "...KHHSSSSSSSSSSSSHHK..."],
  ["row", 13, 0, "...KHHSSSSSMMSSSSSHHK..."],
  ["px", 19, 2, "Z"],
  ["px", 20, 2, "Z"],
  ["px", 21, 2, "Z"],
  ["px", 21, 3, "Z"],
  ["px", 20, 4, "Z"],
  ["px", 19, 5, "Z"],
  ["px", 20, 5, "Z"],
  ["px", 21, 5, "Z"],
]);
const M_SLEEP_2: Frame = mergeSprite(M_BASE, [
  ["row", 10, 0, "...KHHSSSSSSSSSSSSHHK..."],
  ["row", 13, 0, "...KHHSSSSSMMSSSSSHHK..."],
  ["px", 18, 0, "Z"],
  ["px", 19, 0, "Z"],
  ["px", 20, 0, "Z"],
  ["px", 20, 1, "Z"],
  ["px", 19, 2, "Z"],
  ["px", 18, 3, "Z"],
  ["px", 19, 3, "Z"],
  ["px", 20, 3, "Z"],
]);

const M_WON: Frame = mergeSprite(M_BASE, [
  ["row", 13, 0, "...KHHSSSCMMMMCSSSHHK..."],
  ["row", 14, 0, "...KHHSSSSCMMCSSSSHHK..."],
  ["px", 8, 10, "P"],
  ["px", 14, 10, "P"],
  ["row", 21, 0, "KBBBBBBBBKKNNKKBBBBBBBBK"],
]);
const M_WON_STAR_A: Frame = mergeSprite(M_WON, [
  ["px", 2, 5, "Y"],
  ["px", 1, 6, "Y"],
  ["px", 3, 6, "Y"],
  ["px", 2, 7, "Y"],
  ["px", 21, 16, "Y"],
  ["px", 20, 17, "Y"],
  ["px", 22, 17, "Y"],
  ["px", 21, 18, "Y"],
]);
const M_WON_STAR_B: Frame = mergeSprite(M_WON, [
  ["px", 21, 3, "P"],
  ["px", 2, 16, "P"],
  ["px", 20, 6, "Y"],
]);

export const MIRA_VARIANTS: VariantBundle = {
  maker: {
    name: "Mira Maker",
    blurb: "Creative and UGC. Short violet bob, viewfinder, chest camera.",
    palette: M_PAL,
    states: {
      idle: [
        { rows: M_BASE, dur: 3200 },
        { rows: M_BLINK, dur: 140 },
        { rows: M_BASE, dur: 2400 },
        { rows: M_BLINK, dur: 120 },
      ],
      draft: [
        { rows: M_DRAFT_1, dur: 220 },
        { rows: M_DRAFT_2, dur: 220 },
      ],
      sleep: [
        { rows: M_SLEEP_1, dur: 900 },
        { rows: M_SLEEP_2, dur: 900 },
      ],
      won: [
        { rows: M_WON_STAR_A, dur: 380 },
        { rows: M_WON_STAR_B, dur: 380 },
        { rows: M_WON, dur: 280 },
      ],
    },
  },
};
