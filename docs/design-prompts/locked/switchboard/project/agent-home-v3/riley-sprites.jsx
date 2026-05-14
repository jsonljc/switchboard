// Riley sprite variants — 24×24 pixel art.
// Companion to ALEX_VARIANTS. Riley is the ad optimizer.
// Same engine: PixelSprite/AnimatedSprite + mergeSprite() from sprite.jsx.

function rR(s) {
  if (s.length !== 24) console.warn('riley row len', s.length, JSON.stringify(s));
  return s;
}

// ═══════════════════════════════════════════════════════════════════
// Variant A — RILEY ANALYST
// Ponytail, big rounded glasses, lavender blouse + pearl. Reads as
// sharp marketing-ops. Glasses pop is the silhouette.
// ═══════════════════════════════════════════════════════════════════
const RA_PAL = {
  K: '#1a1108',
  H: '#3a1e10',       // dark auburn hair
  E: '#6a3018',
  S: '#f5c79a',
  D: '#cd8a5a',
  G: '#e6f2ff',       // glasses lens
  M: '#1a0c06',
  C: '#dc7a6a',
  B: '#9d8ac8',       // lavender blouse
  L: '#bba6e0',
  W: '#f5ebd6',
  T: '#f0d885',       // gold pearl
  Z: '#7c6a48',
  Y: '#f1c34a',
  P: '#ffffff',
  X: '#3a8a5a',       // green up-arrow / chart
  Q: '#c0533c',       // red bar
};

const RA_BASE = [
  rR('........................'), //  0
  rR('........KKKKKKKK........'), //  1 hair crown
  rR('.......KHHHHHHHHK.......'), //  2
  rR('......KHHEHHHHEHHK......'), //  3 highlight
  rR('.....KHHHHHHHHHHHHK.....'), //  4
  rR('....KHHHHHHHHHHHHHHK....'), //  5
  rR('...KHHHSSSSSSSSSSHHHK...'), //  6 bangs framed in hair
  rR('..KHHHSSSSSSSSSSSSHHHK..'), //  7 long hair sides begin
  rR('..KHHSSSSSSSSSSSSSSHHK..'), //  8
  rR('..HHKKGGGGSSSSGGGGKKHH..'), //  9 glasses + long hair
  rR('..HHKGGMMGSSSSGMMGGKHH..'), // 10 pupils
  rR('..HHKGGMMGSSSSGMMGGKHH..'), // 11
  rR('..HHKKGGGGSSSSGGGGKKHH..'), // 12
  rR('..HHKSCSSSSCCSSCSKHH....'), // 13 lipstick (pink C in centre)
  rR('...HHKSSSSSSSSSSSSKHH...'), // 14
  rR('...HHHKSSSSSSSSSSKHHH...'), // 15 hair tips
  rR('....HHKSSSSSSSSKHH......'), // 16
  rR('....KKBBBBBWWWWBBBBKK...'), // 17 collar
  rR('...KBBLBBBBKTKBBBBLBBK..'), // 18 pearl
  rR('..KBBBBBBLBBBBBLBBBBBBK.'), // 19
  rR('.KBBBBLBBBBBBBBBBBLBBBK.'), // 20
  rR('KBLBBBBBBBLBBBLBBBBBBBLK'), // 21
  rR('KBBBBBBBBBBBBBBBBBBBBBBK'), // 22
  rR('KBBBBBBBBBBBBBBBBBBBBBBK'), // 23
];

const RA_BLINK = mergeSprite(RA_BASE, [
  ['row', 10, 0, '....KGGSSGSSSSGSSGGK....'],
  ['row', 11, 0, '....KGGSSGSSSSGSSGGK....'],
  ['px', 6, 10, 'M'], ['px', 7, 10, 'M'],
  ['px', 16, 10, 'M'], ['px', 17, 10, 'M'],
]);

const RA_DRAFT_BASE = mergeSprite(RA_BASE, [
  ['px', 6, 8, 'H'], ['px', 7, 8, 'H'],
  ['px', 16, 8, 'H'], ['px', 17, 8, 'H'],
  ['row', 13, 0, '.....KSCSSSMMSSSCSK.....'],
]);
const RA_DRAFT_1 = RA_DRAFT_BASE;
const RA_DRAFT_2 = mergeSprite(RA_DRAFT_BASE, [
  ['row', 13, 0, '.....KSCSSMMMMSSCSK.....'],
]);

const RA_SLEEP = mergeSprite(RA_BASE, [
  ['row', 10, 0, '....KGGSSGSSSSGSSGGK....'],
  ['row', 11, 0, '....KGGSSGSSSSGSSGGK....'],
  ['px', 6, 10, 'M'], ['px', 7, 10, 'M'],
  ['px', 16, 10, 'M'], ['px', 17, 10, 'M'],
  ['row', 13, 0, '.....KSSSSSMMSSSSSK.....'],
  ['px', 19, 2, 'Z'], ['px', 20, 2, 'Z'], ['px', 21, 2, 'Z'],
  ['px', 21, 3, 'Z'], ['px', 20, 4, 'Z'],
  ['px', 19, 5, 'Z'], ['px', 20, 5, 'Z'], ['px', 21, 5, 'Z'],
]);
const RA_SLEEP_2 = mergeSprite(RA_BASE, [
  ['row', 10, 0, '....KGGSSGSSSSGSSGGK....'],
  ['row', 11, 0, '....KGGSSGSSSSGSSGGK....'],
  ['px', 6, 10, 'M'], ['px', 7, 10, 'M'],
  ['px', 16, 10, 'M'], ['px', 17, 10, 'M'],
  ['row', 13, 0, '.....KSSSSSMMSSSSSK.....'],
  ['px', 18, 0, 'Z'], ['px', 19, 0, 'Z'], ['px', 20, 0, 'Z'],
  ['px', 20, 1, 'Z'], ['px', 19, 2, 'Z'],
  ['px', 18, 3, 'Z'], ['px', 19, 3, 'Z'], ['px', 20, 3, 'Z'],
]);

// Win = CTR spike. Tiny chart bars + up arrow.
const RA_WON = mergeSprite(RA_BASE, [
  ['row', 13, 0, '.....KSMMMMMMMMMSSK.....'],
  ['row', 14, 0, '.....KSSSMMMMMSSSSK.....'],
  ['px', 8, 10, 'P'], ['px', 15, 10, 'P'],
]);
const RA_WON_STAR_A = mergeSprite(RA_WON, [
  // up-arrow chart top-right
  ['px', 22, 5, 'X'], ['px', 21, 6, 'X'], ['px', 22, 6, 'X'], ['px', 20, 7, 'X'],
  ['px', 21, 7, 'X'], ['px', 22, 7, 'X'],
  // little bars top-left
  ['px', 1, 7, 'Q'], ['px', 2, 6, 'Q'], ['px', 3, 5, 'X'], ['px', 4, 4, 'X'],
]);
const RA_WON_STAR_B = mergeSprite(RA_WON, [
  ['px', 22, 6, 'X'], ['px', 21, 7, 'X'], ['px', 22, 7, 'X'],
  ['px', 1, 8, 'Q'], ['px', 2, 7, 'Q'], ['px', 3, 6, 'X'], ['px', 4, 5, 'X'], ['px', 5, 4, 'Y'],
]);

// ═══════════════════════════════════════════════════════════════════
// Variant B — RILEY CREATIVE
// Beanie, casual hoodie, pencil/marker tucked behind ear. Designer.
// ═══════════════════════════════════════════════════════════════════
const RB_PAL = {
  K: '#1a1108',
  H: '#2a1a10',       // dark hair under beanie
  E: '#4a2a18',
  S: '#f4c298',
  D: '#cc8a5a',
  G: '#f2e8d0',       // unused
  M: '#1a0c06',
  C: '#dc7a6a',
  B: '#3a6a5a',       // teal hoodie
  L: '#5a8a78',       // hoodie highlight
  W: '#f3ead0',       // tee under hoodie
  T: '#dc8a3a',       // marker / pencil
  N: '#c25a3c',       // beanie accent stripe
  Z: '#7c6a48',
  Y: '#f1c34a',
  P: '#ffffff',
  X: '#3a8a5a',
  Q: '#c25a3c',
};

const RB_BASE = [
  rR('........................'), //  0
  rR('........................'), //  1
  rR('......KKKKKKKKKKKK......'), //  2 beanie cuff
  rR('.....KBBBBBBBBBBBBK.....'), //  3 beanie body
  rR('.....KBBLBBBBBBLBBK.....'), //  4 beanie highlight
  rR('.....KNNNNNNNNNNNNK.....'), //  5 beanie stripe
  rR('....KHHHHHHHHHHHHHHK....'), //  6 hair widens under beanie
  rR('...HKHSSSSSSSSSSSSHKHT..'), //  7 long hair sides + pencil
  rR('...HKSSSSSSSSSSSSSSKHT..'), //  8
  rR('...HKSSMSSSSSSSSMSSKH.T.'), //  9 eyes + pencil shaft
  rR('...HKSSSSSSSSSSSSSSKH...'), // 10
  rR('...HKSSMSSSSSSSSMSSKH...'), // 11 pupils
  rR('...HKSCSSSSCCSSSSCSKH...'), // 12 lipstick hint
  rR('....KSSSSMMMMSSSSK......'), // 13 friendly smile
  rR('...HHKSSSSSSSSSSSSKHH...'), // 14 hair flow continues
  rR('...HHHKSSSSSSSSSSKHHH...'), // 15
  rR('....HHKSSSSSSSSKHH......'), // 16
  rR('...KKBBBBBWWWWBBBBBKK...'), // 17 hoodie shoulders + tee
  rR('..KBBBBBLBWWWWBLBBBBBK..'), // 18 hoodie strings (W center)
  rR('.KBBBBBBBBLWWLBBBBBBBBK.'), // 19
  rR('KBBBBBBLBBBWWBBBBLBBBBBK'), // 20
  rR('KBBBBBBBBBBBWBBBBBBBBBBK'), // 21
  rR('KBLBBBBBBBBBBBBBBBBBLBK.'), // 22
  rR('KBBBBBBBBBBBBBBBBBBBBBK.'), // 23
];

const RB_BLINK = mergeSprite(RB_BASE, [
  ['row', 11, 0, '....KSSSSSSSSSSSSSSK....'],
  ['px', 7, 11, 'M'], ['px', 16, 11, 'M'],
]);

const RB_DRAFT_BASE = mergeSprite(RB_BASE, [
  // marker held in hand to right of face (pencil pulled forward)
  ['px', 20, 12, 'T'], ['px', 20, 13, 'T'], ['px', 20, 14, 'K'],
  ['row', 13, 0, '.....KSSSSSMMSSSSK......'],
]);
const RB_DRAFT_1 = RB_DRAFT_BASE;
const RB_DRAFT_2 = mergeSprite(RB_DRAFT_BASE, [
  ['row', 13, 0, '.....KSSSSMMMMSSSSK.....'],
]);

const RB_SLEEP = mergeSprite(RB_BASE, [
  ['row', 11, 0, '....KSSSSSSSSSSSSSSK....'],
  ['px', 7, 11, 'M'], ['px', 16, 11, 'M'],
  ['row', 13, 0, '.....KSSSSSMMSSSSSK.....'],
  ['px', 19, 2, 'Z'], ['px', 20, 2, 'Z'], ['px', 21, 2, 'Z'],
  ['px', 21, 3, 'Z'], ['px', 20, 4, 'Z'],
  ['px', 19, 5, 'Z'], ['px', 20, 5, 'Z'], ['px', 21, 5, 'Z'],
]);
const RB_SLEEP_2 = mergeSprite(RB_BASE, [
  ['row', 11, 0, '....KSSSSSSSSSSSSSSK....'],
  ['px', 7, 11, 'M'], ['px', 16, 11, 'M'],
  ['row', 13, 0, '.....KSSSSSMMSSSSSK.....'],
  ['px', 18, 0, 'Z'], ['px', 19, 0, 'Z'], ['px', 20, 0, 'Z'],
  ['px', 20, 1, 'Z'], ['px', 19, 2, 'Z'],
  ['px', 18, 3, 'Z'], ['px', 19, 3, 'Z'], ['px', 20, 3, 'Z'],
]);

const RB_WON = mergeSprite(RB_BASE, [
  ['row', 13, 0, '.....KSMMMMMMMMMSSK.....'],
  ['row', 14, 0, '.....KSSSMMMMMSSSSK.....'],
  ['px', 7, 11, 'P'], ['px', 16, 11, 'P'],
]);
const RB_WON_STAR_A = mergeSprite(RB_WON, [
  ['px', 22, 5, 'X'], ['px', 21, 6, 'X'], ['px', 22, 6, 'X'],
  ['px', 1, 7, 'Q'], ['px', 2, 6, 'Q'], ['px', 3, 5, 'X'], ['px', 4, 4, 'X'],
]);
const RB_WON_STAR_B = mergeSprite(RB_WON, [
  ['px', 22, 6, 'X'], ['px', 21, 7, 'X'], ['px', 22, 7, 'X'],
  ['px', 1, 8, 'Q'], ['px', 2, 7, 'Q'], ['px', 3, 6, 'X'], ['px', 4, 5, 'X'], ['px', 5, 4, 'Y'],
]);

// ═══════════════════════════════════════════════════════════════════
// Variant C — RILEY PIXEL TRADER
// Bloomberg-terminal energy. Green CRT visor over eyes (scrolling
// digits), headphones, dark jacket. Intense / nocturnal.
// ═══════════════════════════════════════════════════════════════════
const RC_PAL = {
  K: '#08120c',
  H: '#1a1108',
  E: '#3a2a18',
  S: '#f0bd92',
  D: '#cb8a5a',
  G: '#0a3a18',       // CRT dark green
  M: '#7af0a0',       // bright green digits
  C: '#dc7a6a',
  B: '#1a1a26',       // dark navy/black jacket
  L: '#3a3a4e',
  W: '#5e8a72',       // green shirt collar
  T: '#7af0a0',
  R: '#1a1108',
  N: '#bcb29a',
  Z: '#7c6a48',
  Y: '#f1c34a',
  P: '#ffffff',
  X: '#7af0a0',
  Q: '#dc4040',
};

const RC_BASE = [
  rR('........................'), //  0
  rR('........................'), //  1
  rR('......KKKKKKKKKKKK......'), //  2 hair top
  rR('.....KHHHHHHHHHHHHK.....'), //  3
  rR('.....KHHEHHHHHHHHEK.....'), //  4
  rR('....KHHHHHHHHHHHHHHK....'), //  5
  rR('...KHHHHHHHHHHHHHHHHK...'), //  6 hair widens
  rR('...KHHSSSSSSSSSSSSHHK...'), //  7 long sides
  rR('..KKHKSSSSSSSSSSSSKHKK..'), //  8 headphone tops + hair
  rR('..KRRKKKKKKKKKKKKKKRRKK.'), //  9 CRT visor outer band
  rR('..KRRKKGMGMGMGMGMGKRRK..'), // 10 CRT scanning digits
  rR('..KRRKKGMGMGMGMGMGKRRK..'), // 11
  rR('..HHKKKKKKKKKKKKKKKKHH..'), // 12 hair around jaw
  rR('...HHKSCSSSMMSSCSSKHH...'), // 13 lipstick (C dot inside)
  rR('....HHKSSSSSSSSSSKHH....'), // 14
  rR('.....HHKSSSSSSSSKHH.....'), // 15
  rR('......HHKSSSSSSKHH......'), // 16
  rR('....KKBBBBBWWWWBBBBBKK..'), // 17 lapel collar
  rR('...KBBBBBLWTTTWLBBBBBK..'), // 18 trader tie (green)
  rR('..KBBBBBBLWTTTWLBBBBBBK.'), // 19
  rR('.KBBBBBBBLWTTTWLBBBBBBBK'), // 20
  rR('KBBBBBBBBBWTTTWBBBBBBBBK'), // 21
  rR('KBBBBBBBBBBWTWBBBBBBBBBK'), // 22
  rR('KBBBBBBBBBBBBBBBBBBBBBBK'), // 23
];

const RC_BLINK = mergeSprite(RC_BASE, [
  // visor flicker (digits go dark)
  ['row', 10, 0, '..KRRK.KGGGGGGGGGGK.RRK.'],
  ['row', 11, 0, '..KRRK.KGGGGGGGGGGK.RRK.'],
]);
const RC_SCAN_A = mergeSprite(RC_BASE, [
  ['row', 10, 0, '..KRRK.KMGMGMGMGMGK.RRK.'],
]);

const RC_DRAFT_BASE = RC_BASE;
const RC_DRAFT_1 = mergeSprite(RC_BASE, [
  ['row', 10, 0, '..KRRK.KMGMGMGMGMGK.RRK.'],
  ['row', 11, 0, '..KRRK.KGMGMGMGMGMK.RRK.'],
]);
const RC_DRAFT_2 = mergeSprite(RC_BASE, [
  ['row', 10, 0, '..KRRK.KGMGMGMGMGMK.RRK.'],
  ['row', 11, 0, '..KRRK.KMGMGMGMGMGK.RRK.'],
]);

const RC_SLEEP = mergeSprite(RC_BASE, [
  // visor goes dark
  ['row', 10, 0, '..KRRK.KGGGGGGGGGGK.RRK.'],
  ['row', 11, 0, '..KRRK.KGGGGGGGGGGK.RRK.'],
  ['row', 13, 0, '......KSSSSSMMSSSSSK....'],
  ['px', 19, 2, 'Z'], ['px', 20, 2, 'Z'], ['px', 21, 2, 'Z'],
  ['px', 21, 3, 'Z'], ['px', 20, 4, 'Z'],
  ['px', 19, 5, 'Z'], ['px', 20, 5, 'Z'], ['px', 21, 5, 'Z'],
]);
const RC_SLEEP_2 = mergeSprite(RC_BASE, [
  ['row', 10, 0, '..KRRK.KGGGGGGGGGGK.RRK.'],
  ['row', 11, 0, '..KRRK.KGGGGGGGGGGK.RRK.'],
  ['row', 13, 0, '......KSSSSSMMSSSSSK....'],
  ['px', 18, 0, 'Z'], ['px', 19, 0, 'Z'], ['px', 20, 0, 'Z'],
  ['px', 20, 1, 'Z'], ['px', 19, 2, 'Z'],
  ['px', 18, 3, 'Z'], ['px', 19, 3, 'Z'], ['px', 20, 3, 'Z'],
]);

const RC_WON = mergeSprite(RC_BASE, [
  // visor flares bright
  ['row', 10, 0, '..KRRK.KMMMMMMMMMMK.RRK.'],
  ['row', 11, 0, '..KRRK.KMMMMMMMMMMK.RRK.'],
  ['row', 13, 0, '......KSMMMMMMMSSSSK....'],
]);
const RC_WON_STAR_A = mergeSprite(RC_WON, [
  ['px', 22, 5, 'X'], ['px', 21, 6, 'X'], ['px', 22, 6, 'X'],
  ['px', 1, 7, 'X'], ['px', 2, 6, 'X'], ['px', 3, 5, 'X'], ['px', 4, 4, 'X'],
]);
const RC_WON_STAR_B = mergeSprite(RC_WON, [
  ['px', 22, 6, 'X'], ['px', 21, 7, 'X'], ['px', 22, 7, 'X'],
  ['px', 1, 8, 'X'], ['px', 2, 7, 'X'], ['px', 3, 6, 'X'], ['px', 4, 5, 'Y'], ['px', 5, 4, 'Y'],
]);

// ═══════════════════════════════════════════════════════════════════
// Variant D — RILEY BOT
// Pastel android sibling to Alex Agent — different palette (teal +
// magenta, the "ad spend" colors). Antenna LED, visor, chest dial.
// ═══════════════════════════════════════════════════════════════════
const RD_PAL = {
  K: '#1a1820',
  H: '#363b4f',
  E: '#525a73',
  S: '#e6dbf1',       // lavender face plate
  D: '#b8a8c7',
  G: '#f2a3c4',       // magenta visor
  M: '#1a1820',
  C: '#9ce0d4',       // teal cheek LED
  B: '#5a3a78',       // purple chassis
  L: '#7e5a9e',       // chassis highlight
  W: '#e8edf6',
  T: '#9ce0d4',       // teal chest LED
  R: '#1a1820',
  N: '#bcc4d5',
  Z: '#6c6a8a',
  Y: '#f4d35e',
  P: '#ffffff',
  X: '#3a8a5a',
  Q: '#c25a3c',
};

const RD_BASE = [
  rR('...........KK...........'), //  0 antenna
  rR('...........KK...........'),
  rR('..........KGGK..........'), //  2 antenna LED (magenta = active)
  rR('........KKHHHHKK........'), //  3 helmet top
  rR('.......KHHHHHHHHK.......'), //  4
  rR('......KHHHEHHEHHHK......'), //  5
  rR('......KHHHHHHHHHHK......'), //  6
  rR('....HHKSSSSSSSSSSSSKHH..'), //  7 hair tips out from helmet
  rR('...HHKSSSSSSSSSSSSSSKHH.'), //  8
  rR('...HHKSSGGGGSSGGGGSSKHH.'), //  9 visor outer
  rR('...HHKSSGGMGSSGMGGSSKHH.'), // 10 pupils
  rR('...HHKSSGGGGSSGGGGSSKHH.'), // 11
  rR('...HHKSCSSSSSSSSSSCSKHH.'), // 12 teal cheek LEDs + hair
  rR('....HHKSSSCCMMCCSSSKHH..'), // 13 grille + pink lip hint
  rR('.....HHKSDSSSSSSSSDSKHH.'), // 14
  rR('......HHKSDDDDDDDDSKH...'), // 15
  rR('.......KSSSSSSSSK.......'), // 16
  rR('....KKBBBBLLLLBBBBKK....'), // 17 chest top
  rR('...KBBBBBLNTNLBBBBBK....'), // 18 chest dial
  rR('..KBBBBBBLNTNLBBBBBBK...'), // 19
  rR('.KBBBBBBBLNTNLBBBBBBBK..'), // 20
  rR('KBBBBBBBBBLLLLBBBBBBBBKK'), // 21
  rR('KBBBBBBBBBBBBBBBBBBBBBKK'), // 22
  rR('KBBBBBBBBBBBBBBBBBBBBBKK'), // 23
];

const RD_SCAN_L = mergeSprite(RD_BASE, [
  ['row', 10, 0, '....KSSGMGGSSGMGGSSK....'],
]);
const RD_SCAN_R = mergeSprite(RD_BASE, [
  ['row', 10, 0, '....KSSGGGMSSGGGMSSK....'],
]);

const RD_DRAFT_BASE = mergeSprite(RD_BASE, [
  ['row', 2, 0, '..........KYYK..........'],
  ['row', 13, 0, '.....KSSSSMMSSSSSSK.....'],
]);
const RD_DRAFT_1 = RD_DRAFT_BASE;
const RD_DRAFT_2 = mergeSprite(RD_DRAFT_BASE, [
  ['row', 13, 0, '.....KSSSMMMMSSSSSK.....'],
]);

const RD_SLEEP = mergeSprite(RD_BASE, [
  ['row', 2, 0, '..........KHHK..........'],
  ['row', 9, 0,  '....KSSDDDDSSDDDDSSK....'],
  ['row', 10, 0, '....KSSDDDDSSDDDDSSK....'],
  ['row', 11, 0, '....KSSDDDDSSDDDDSSK....'],
  ['row', 13, 0, '.....KSSSSSMMSSSSSK.....'],
  ['px', 19, 2, 'Z'], ['px', 20, 2, 'Z'], ['px', 21, 2, 'Z'],
  ['px', 21, 3, 'Z'], ['px', 20, 4, 'Z'],
  ['px', 19, 5, 'Z'], ['px', 20, 5, 'Z'], ['px', 21, 5, 'Z'],
]);
const RD_SLEEP_2 = mergeSprite(RD_BASE, [
  ['row', 2, 0, '..........KHHK..........'],
  ['row', 9, 0,  '....KSSDDDDSSDDDDSSK....'],
  ['row', 10, 0, '....KSSDDDDSSDDDDSSK....'],
  ['row', 11, 0, '....KSSDDDDSSDDDDSSK....'],
  ['row', 13, 0, '.....KSSSSSMMSSSSSK.....'],
  ['px', 18, 0, 'Z'], ['px', 19, 0, 'Z'], ['px', 20, 0, 'Z'],
  ['px', 20, 1, 'Z'], ['px', 19, 2, 'Z'],
  ['px', 18, 3, 'Z'], ['px', 19, 3, 'Z'], ['px', 20, 3, 'Z'],
]);

const RD_WON = mergeSprite(RD_BASE, [
  ['px', 8, 10, 'P'], ['px', 15, 10, 'P'],
  ['row', 13, 0, '.....KSSMMMMMMMSSSK.....'],
  ['row', 2, 0, '..........KYYK..........'],
]);
const RD_WON_STAR_A = mergeSprite(RD_WON, [
  ['px', 22, 5, 'X'], ['px', 21, 6, 'X'], ['px', 22, 6, 'X'],
  ['px', 1, 7, 'Q'], ['px', 2, 6, 'Q'], ['px', 3, 5, 'X'], ['px', 4, 4, 'X'],
]);
const RD_WON_STAR_B = mergeSprite(RD_WON, [
  ['px', 22, 6, 'X'], ['px', 21, 7, 'X'], ['px', 22, 7, 'X'],
  ['px', 1, 8, 'Q'], ['px', 2, 7, 'Q'], ['px', 3, 6, 'X'], ['px', 4, 5, 'X'], ['px', 5, 4, 'Y'],
]);

// ═══════════════════════════════════════════════════════════════════
// Bundle
// ═══════════════════════════════════════════════════════════════════
const RILEY_VARIANTS = {
  analyst: {
    name: 'Riley Analyst',
    blurb: 'Sharp marketing-ops. Ponytail, big round glasses, lavender blouse + pearl.',
    palette: RA_PAL,
    states: {
      idle:  [{ rows: RA_BASE, dur: 3200 }, { rows: RA_BLINK, dur: 140 }, { rows: RA_BASE, dur: 2400 }, { rows: RA_BLINK, dur: 120 }],
      draft: [{ rows: RA_DRAFT_1, dur: 220 }, { rows: RA_DRAFT_2, dur: 220 }],
      sleep: [{ rows: RA_SLEEP, dur: 900 }, { rows: RA_SLEEP_2, dur: 900 }],
      won:   [{ rows: RA_WON_STAR_A, dur: 380 }, { rows: RA_WON_STAR_B, dur: 380 }, { rows: RA_WON, dur: 280 }],
    },
  },
  trader: {
    name: 'Riley Pixel Trader',
    blurb: 'Bloomberg-terminal energy. CRT visor with scanning digits, headphones, dark jacket.',
    palette: RC_PAL,
    states: {
      idle:  [{ rows: RC_BASE, dur: 1400 }, { rows: RC_SCAN_A, dur: 700 }, { rows: RC_BLINK, dur: 140 }, { rows: RC_BASE, dur: 1800 }],
      draft: [{ rows: RC_DRAFT_1, dur: 160 }, { rows: RC_DRAFT_2, dur: 160 }],
      sleep: [{ rows: RC_SLEEP, dur: 900 }, { rows: RC_SLEEP_2, dur: 900 }],
      won:   [{ rows: RC_WON_STAR_A, dur: 360 }, { rows: RC_WON_STAR_B, dur: 360 }, { rows: RC_WON, dur: 260 }],
    },
  },
  bot: {
    name: 'Riley Bot',
    blurb: 'Pastel android. Magenta visor + teal cheek LEDs — the ad-spend palette.',
    palette: RD_PAL,
    states: {
      idle:  [{ rows: RD_BASE, dur: 1400 }, { rows: RD_SCAN_L, dur: 800 }, { rows: RD_BASE, dur: 1200 }, { rows: RD_SCAN_R, dur: 800 }],
      draft: [{ rows: RD_DRAFT_1, dur: 220 }, { rows: RD_DRAFT_2, dur: 220 }],
      sleep: [{ rows: RD_SLEEP, dur: 1100 }, { rows: RD_SLEEP_2, dur: 1100 }],
      won:   [{ rows: RD_WON_STAR_A, dur: 380 }, { rows: RD_WON_STAR_B, dur: 380 }, { rows: RD_WON, dur: 280 }],
    },
  },
};

Object.assign(window, { RILEY_VARIANTS });
