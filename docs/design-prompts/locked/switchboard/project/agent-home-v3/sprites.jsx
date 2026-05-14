// Alex sprite variants — 24×24 pixel art.
// Each variant: palette + base rows + animation deltas.
// Authoring style: rows are 24-char strings, '.' = transparent.

// ── small helper ────────────────────────────────────────────────────
// 24-char row checker for dev sanity (run once)
function R(s) {
  if (s.length !== 24) console.warn('row len', s.length, JSON.stringify(s));
  return s;
}

// ═══════════════════════════════════════════════════════════════════
// Variant A — ALEX CLASSIC
// Friendly nerd × sales pro. Brown side-part, glasses, headset,
// navy blazer + red tie. The most "obvious" Alex.
// ═══════════════════════════════════════════════════════════════════
const A_PAL = {
  K: '#1a1108',     // outline
  H: '#5a3418',     // hair main
  E: '#7a4a26',     // hair highlight
  S: '#f5c79a',     // skin
  D: '#cd8a5a',     // skin shadow
  G: '#dceeff',     // glasses lens
  M: '#2a1408',     // eyes/mouth
  C: '#dc8474',     // cheek
  B: '#2d4a78',     // navy blazer
  L: '#4a6c98',     // blazer highlight
  W: '#f1e7ce',     // shirt
  T: '#c0533c',     // red tie
  R: '#1a1108',     // headset dark
  N: '#bfb29a',     // headset highlight
  Z: '#7c6a48',     // sleep Z
  Y: '#f3d24e',     // star yellow
  P: '#ffffff',     // white sparkle
};

const A_BASE = [
//   0         1         2
//   012345678901234567890123
  R('........................'), //  0
  R('........................'), //  1
  R('........KKKKKKKK........'), //  2  headband top
  R('.......KHHHHHHHHK.......'), //  3
  R('......KHHHHHHHHHHK......'), //  4  hair top
  R('.....KHHEHHHHHHEHHK.....'), //  5  hair highlight
  R('.....KHHHHHHHHHHHHK.....'), //  6
  R('.....KHSSSSSSSSSSHK.....'), //  7  hair fade -> forehead
  R('...KK.KSSSSSSSSSS.KK....'), //  8  earcups top
  R('..KRRK.KSGGSSSGGSK.KRRK.'), //  9  earcup body + glasses outer
  R('..KRRK.KSGMGSGMGSK.KRRK.'), // 10  pupils
  R('..KRRK.KSGGSSSGGSK.KRRK.'), // 11
  R('...KK.KSCSSSSSSCSK.KK...'), // 12  cheeks + mic boom
  R('......KSSSSMMMMSSK.K....'), // 13  mouth + mic tip
  R('......KSSSSSSSSSSK.K....'), // 14  jaw + mic line
  R('.......KSSSSSSSSK..N....'), // 15
  R('........KSSSSSSK........'), // 16  chin
  R('....KKBBBBWWWWBBBBKK....'), // 17  shoulders + collar
  R('...KBBBBBLWTTWLBBBBBK...'), // 18
  R('..KBBBBBBBWTTWBBBBBBBK..'), // 19
  R('.KBBBBBBBLWTTWLBBBBBBBK.'), // 20
  R('KBBBBBBBBBWTTWBBBBBBBBBK'), // 21
  R('KBBBBBBBBBBWTWBBBBBBBBBK'), // 22
  R('KBBBBBBBBBBBBBBBBBBBBBBK'), // 23
];

const A_BLINK = mergeSprite(A_BASE, [
  // pupils -> skin (closed eyes drawn as eyelid line)
  ['row', 10, 0, '..KRRK.KSGSGSGSGSK.KRRK.'],
  ['px', 9, 10, 'M'], ['px', 10, 10, 'M'],
  ['px', 13, 10, 'M'], ['px', 14, 10, 'M'],
]);

// Drafting: focused brow + typing cursor blinking off-canvas to right.
// We render the cursor by toggling a 1-px dot near the mouth as "speech tick"
const A_DRAFT_BASE = mergeSprite(A_BASE, [
  // brow above glasses
  ['px', 8, 8, 'H'], ['px', 9, 8, 'H'],
  ['px', 14, 8, 'H'], ['px', 15, 8, 'H'],
  // small "o" mouth
  ['row', 13, 0, '......KSSSSMMSSSSK.K....'],
  ['row', 14, 0, '......KSSSSMSSSSSK.K....'],
]);
const A_DRAFT_1 = A_DRAFT_BASE;
const A_DRAFT_2 = mergeSprite(A_DRAFT_BASE, [
  // mouth shape shift (forming next word)
  ['row', 13, 0, '......KSSSMMMMSSSSK.K...'],
]);

const A_SLEEP = mergeSprite(A_BASE, [
  ['row', 10, 0, '..KRRK.KSGSGSGSGSK.KRRK.'],
  ['px', 9, 10, 'M'], ['px', 10, 10, 'M'],
  ['px', 13, 10, 'M'], ['px', 14, 10, 'M'],
  ['row', 13, 0, '......KSSSSSMMSSSSK.K...'],
  // Z floating top-right
  ['px', 19, 2, 'Z'], ['px', 20, 2, 'Z'], ['px', 21, 2, 'Z'],
  ['px', 21, 3, 'Z'], ['px', 20, 4, 'Z'],
  ['px', 19, 5, 'Z'], ['px', 20, 5, 'Z'], ['px', 21, 5, 'Z'],
]);
const A_SLEEP_2 = mergeSprite(A_BASE, [
  ['row', 10, 0, '..KRRK.KSGSGSGSGSK.KRRK.'],
  ['px', 9, 10, 'M'], ['px', 10, 10, 'M'],
  ['px', 13, 10, 'M'], ['px', 14, 10, 'M'],
  ['row', 13, 0, '......KSSSSSMMSSSSK.K...'],
  ['px', 18, 0, 'Z'], ['px', 19, 0, 'Z'], ['px', 20, 0, 'Z'],
  ['px', 20, 1, 'Z'], ['px', 19, 2, 'Z'],
  ['px', 18, 3, 'Z'], ['px', 19, 3, 'Z'], ['px', 20, 3, 'Z'],
]);

const A_WON = mergeSprite(A_BASE, [
  // grin
  ['row', 13, 0, '......KSSMMMMMMSSK.K....'],
  ['row', 14, 0, '......KSSSMMMMSSSK.K....'],
  // sparkle eyes
  ['px', 10, 9, 'P'], ['px', 13, 9, 'P'],
]);
const A_WON_STAR_A = mergeSprite(A_WON, [
  ['px', 2, 5, 'Y'], ['px', 1, 6, 'Y'], ['px', 3, 6, 'Y'], ['px', 2, 7, 'Y'],
  ['px', 22, 16, 'Y'], ['px', 21, 17, 'Y'], ['px', 23, 17, 'Y'], ['px', 22, 18, 'Y'],
]);
const A_WON_STAR_B = mergeSprite(A_WON, [
  ['px', 21, 2, 'P'],
  ['px', 1, 16, 'P'],
  ['px', 22, 11, 'Y'],
]);

// ═══════════════════════════════════════════════════════════════════
// Variant B — ALEX OPERATOR
// Period-ish "switchboard operator": chunky headset, warm camel jacket,
// dark slim tie, brass band accents (matches Switchboard amber).
// ═══════════════════════════════════════════════════════════════════
const B_PAL = {
  K: '#1a120a',
  H: '#3a2614',
  E: '#5a3a1a',
  S: '#f6c89a',
  D: '#cd8a5a',
  M: '#1a0e06',
  C: '#dc7d6a',
  B: '#7c4a26',      // camel jacket
  L: '#9c6a3a',      // jacket highlight
  W: '#f3ead0',      // shirt cream
  T: '#1a120a',      // dark slim tie
  R: '#1f150c',      // headset
  N: '#d3a14e',      // brass highlight
  Z: '#7c6a48',
  Y: '#e0a93a',
  P: '#ffffff',
  G: '#ffffff',      // unused (no glasses)
};

const B_BASE = [
  R('........................'),
  R('.........NNNNNN.........'), //  1 brass band top
  R('........NKKKKKKN........'), //  2
  R('.......KHHHHHHHHK.......'), //  3
  R('......KHHHHHHHHHHK......'), //  4
  R('......KEHHHHHHHHHK......'), //  5  side-part shadow
  R('......KEHHHHHHHHHK......'), //  6
  R('......KHSSSSSSSSHK......'), //  7
  R('..KKK.KSSSSSSSSSSK.KKK..'), //  8 earcup top
  R('.KRRRKKSSSSSSSSSSKKRRRK.'), //  9
  R('.KRRRKKSSMSSSSMMSSKKRRRK'), // 10  pupils (slight asymmetry = looking)
  R('.KRRRKKSSSSSSSSSSKKRRRK.'), // 11
  R('..KKK.KSCSSSSSSCSK.KKK..'), // 12
  R('......KSSSSMMMMSSK.K....'), // 13  + boom mic start
  R('......KSSSSSSSSSSK.K....'), // 14
  R('.......KSSSSSSSSK..N....'), // 15
  R('........KSSSSSSK........'), // 16
  R('....KKBBBBWWWWBBBBKK....'), // 17
  R('...KBBBBBLWTTWLBBBBBK...'), // 18
  R('..KBBBBBBLWTTWLBBBBBBK..'), // 19
  R('.KBBBBBBBLWTTWLBBBBBBBK.'), // 20
  R('KBBBBBBBBBWTTWBBBBBBBBBK'), // 21
  R('KBBBBBBBBBBWTWBBBBBBBBBK'), // 22
  R('KBBBBBBBBBBBBBBBBBBBBBBK'), // 23
];

const B_BLINK = mergeSprite(B_BASE, [
  ['row', 10, 0, '.KRRRKKSSSSSSSSSSSKKRRRK'],
  ['px', 9, 10, 'M'], ['px', 10, 10, 'M'],
  ['px', 14, 10, 'M'], ['px', 15, 10, 'M'],
]);

const B_DRAFT_BASE = mergeSprite(B_BASE, [
  ['px', 8, 9, 'M'], ['px', 9, 9, 'M'],
  ['px', 14, 9, 'M'], ['px', 15, 9, 'M'],
  ['row', 13, 0, '......KSSSSMMSSSSK.K....'],
]);
const B_DRAFT_1 = B_DRAFT_BASE;
const B_DRAFT_2 = mergeSprite(B_DRAFT_BASE, [
  ['row', 13, 0, '......KSSSMMMMSSSK.K....'],
]);

const B_SLEEP = mergeSprite(B_BASE, [
  ['row', 10, 0, '.KRRRKKSSSSSSSSSSSKKRRRK'],
  ['px', 9, 10, 'M'], ['px', 10, 10, 'M'],
  ['px', 14, 10, 'M'], ['px', 15, 10, 'M'],
  ['row', 13, 0, '......KSSSSSMMSSSSK.K...'],
  ['px', 19, 2, 'Z'], ['px', 20, 2, 'Z'], ['px', 21, 2, 'Z'],
  ['px', 21, 3, 'Z'], ['px', 20, 4, 'Z'],
  ['px', 19, 5, 'Z'], ['px', 20, 5, 'Z'], ['px', 21, 5, 'Z'],
]);
const B_SLEEP_2 = mergeSprite(B_BASE, [
  ['row', 10, 0, '.KRRRKKSSSSSSSSSSSKKRRRK'],
  ['px', 9, 10, 'M'], ['px', 10, 10, 'M'],
  ['px', 14, 10, 'M'], ['px', 15, 10, 'M'],
  ['row', 13, 0, '......KSSSSSMMSSSSK.K...'],
  ['px', 18, 0, 'Z'], ['px', 19, 0, 'Z'], ['px', 20, 0, 'Z'],
  ['px', 20, 1, 'Z'], ['px', 19, 2, 'Z'],
  ['px', 18, 3, 'Z'], ['px', 19, 3, 'Z'], ['px', 20, 3, 'Z'],
]);

const B_WON = mergeSprite(B_BASE, [
  ['row', 13, 0, '......KSSMMMMMMSSK.K....'],
  ['row', 14, 0, '......KSSSMMMMSSSK.K....'],
  ['px', 10, 9, 'P'], ['px', 15, 9, 'P'],
]);
const B_WON_STAR_A = mergeSprite(B_WON, [
  ['px', 2, 5, 'Y'], ['px', 1, 6, 'Y'], ['px', 3, 6, 'Y'], ['px', 2, 7, 'Y'],
]);
const B_WON_STAR_B = mergeSprite(B_WON, [
  ['px', 22, 16, 'Y'], ['px', 21, 17, 'Y'], ['px', 23, 17, 'Y'], ['px', 22, 18, 'Y'],
]);

// ═══════════════════════════════════════════════════════════════════
// Variant C — ALEX COZY QUANT
// Big round glasses, messy hair, burgundy sweater-vest over collared
// shirt + forest tie. No headset — a "call indicator" hovers separately.
// ═══════════════════════════════════════════════════════════════════
const C_PAL = {
  K: '#1a1208',
  H: '#3a2010',
  E: '#5a3a1c',
  S: '#f2bd92',
  D: '#c8865c',
  G: '#e8f2ff',     // glasses lens
  M: '#1a0c06',
  C: '#d77866',
  B: '#7a3a3a',     // burgundy
  L: '#9a5959',
  W: '#f3ebd2',
  T: '#3e6044',     // forest tie
  R: '#1a1208',
  N: '#c0a35a',
  Z: '#7c6a48',
  Y: '#f1c34a',
  P: '#ffffff',
};

const C_BASE = [
  R('........................'),
  R('........................'),
  R('......KKKKKKKKKKKK......'), //  2 hair top
  R('.....KHHHHHHHHHHHHK.....'), //  3
  R('.....KHHHHHHHHHHHHK.....'), //  4
  R('....KHHEHHHHHHHHEHHK....'), //  5 highlights
  R('....KHHHHHHHHHHHHHHK....'), //  6
  R('....KHSSSSSSSSSSSSHK....'), //  7
  R('.....KSSSSSSSSSSSSK.....'), //  8
  R('....KKGGGGKKKKGGGGKK....'), //  9 big glasses outer
  R('....KGGMMGKKKGMMGGK.....'), // 10 pupils
  R('....KGGMMGKKKGMMGGK.....'), // 11
  R('....KKGGGGKKKKGGGGKK....'), // 12
  R('.....KSCSSMMMMSSCSK.....'), // 13 mouth
  R('.....KSSSSSSSSSSSSK.....'), // 14
  R('......KSSSSSSSSSSK......'), // 15
  R('.......KSSSSSSSSK.......'), // 16
  R('....KKBBBBKWWWWKBBBBKK..'), // 17 vest opening
  R('...KBLBBBKWTTWKBBBLBK...'), // 18 v-neck
  R('..KBBBLBBBWTTWBBBLBBBK..'), // 19
  R('.KBBBBBLBBWTTWBBLBBBBBK.'), // 20
  R('KBLBBBBBBBWTWBBBBBBBLBKK'), // 21
  R('KBBBBLBBBBBWBBBBBLBBBBKK'), // 22
  R('KBBBBBBBBBBBBBBBBBBBBBKK'), // 23
];

const C_BLINK = mergeSprite(C_BASE, [
  ['row', 10, 0, '....KGGSSGKKKGSSGGK.....'],
  ['row', 11, 0, '....KGGSSGKKKGSSGGK.....'],
  ['px', 6, 10, 'M'], ['px', 7, 10, 'M'],
  ['px', 13, 10, 'M'], ['px', 14, 10, 'M'],
]);

const C_DRAFT_BASE = mergeSprite(C_BASE, [
  // hand by chin pixel cluster (rests on the right cheek edge)
  ['px', 18, 13, 'D'], ['px', 18, 14, 'S'], ['px', 19, 14, 'S'],
  ['px', 18, 15, 'S'], ['px', 19, 15, 'S'], ['px', 20, 15, 'D'],
  // narrowed/thinking mouth
  ['row', 13, 0, '.....KSCSSSMMSSSCSK.....'],
]);
const C_DRAFT_1 = C_DRAFT_BASE;
const C_DRAFT_2 = mergeSprite(C_DRAFT_BASE, [
  ['row', 13, 0, '.....KSCSSMMMMSSCSK.....'],
]);

const C_SLEEP = mergeSprite(C_BASE, [
  ['row', 10, 0, '....KGGSSGKKKGSSGGK.....'],
  ['row', 11, 0, '....KGGSSGKKKGSSGGK.....'],
  ['px', 6, 10, 'M'], ['px', 7, 10, 'M'],
  ['px', 13, 10, 'M'], ['px', 14, 10, 'M'],
  ['row', 13, 0, '.....KSCSSSMMSSSCSK.....'],
  ['px', 19, 2, 'Z'], ['px', 20, 2, 'Z'], ['px', 21, 2, 'Z'],
  ['px', 21, 3, 'Z'], ['px', 20, 4, 'Z'],
  ['px', 19, 5, 'Z'], ['px', 20, 5, 'Z'], ['px', 21, 5, 'Z'],
]);
const C_SLEEP_2 = mergeSprite(C_BASE, [
  ['row', 10, 0, '....KGGSSGKKKGSSGGK.....'],
  ['row', 11, 0, '....KGGSSGKKKGSSGGK.....'],
  ['px', 6, 10, 'M'], ['px', 7, 10, 'M'],
  ['px', 13, 10, 'M'], ['px', 14, 10, 'M'],
  ['row', 13, 0, '.....KSCSSSMMSSSCSK.....'],
  ['px', 18, 0, 'Z'], ['px', 19, 0, 'Z'], ['px', 20, 0, 'Z'],
  ['px', 20, 1, 'Z'], ['px', 19, 2, 'Z'],
  ['px', 18, 3, 'Z'], ['px', 19, 3, 'Z'], ['px', 20, 3, 'Z'],
]);

const C_WON = mergeSprite(C_BASE, [
  ['row', 13, 0, '.....KSMMMMMMMMSSK......'],
  ['row', 14, 0, '.....KSSSMMMMMSSSK......'],
  ['px', 7, 10, 'P'], ['px', 14, 10, 'P'],
]);
const C_WON_STAR_A = mergeSprite(C_WON, [
  ['px', 2, 5, 'Y'], ['px', 1, 6, 'Y'], ['px', 3, 6, 'Y'], ['px', 2, 7, 'Y'],
]);
const C_WON_STAR_B = mergeSprite(C_WON, [
  ['px', 22, 16, 'Y'], ['px', 21, 17, 'Y'], ['px', 23, 17, 'Y'], ['px', 22, 18, 'Y'],
]);

// ═══════════════════════════════════════════════════════════════════
// Variant D — ALEX THE AGENT
// Soft pastel android. Round helmet, single antenna w/ LED, visor eyes,
// pink LED cheeks, slate chassis, warm-amber status light at the chest.
// ═══════════════════════════════════════════════════════════════════
const D_PAL = {
  K: '#1a1820',
  H: '#363b4f',
  E: '#525a73',
  S: '#dbe3f1',     // face plate
  D: '#a8b3c7',     // plate shadow
  G: '#9cdcd6',     // visor glow
  M: '#1a1820',
  C: '#f29ab2',     // pink LED cheek
  B: '#3e4a76',     // chassis
  L: '#5e6e9e',     // chassis highlight
  W: '#e8edf6',
  T: '#c25a3c',     // chest LED (warm)
  R: '#1a1820',
  N: '#bcc4d5',
  Z: '#6c6a8a',
  Y: '#f4d35e',
  P: '#ffffff',
};

const D_BASE = [
  R('...........KK...........'), //  0 antenna
  R('...........KK...........'),
  R('..........KCCK..........'), //  2 antenna LED (pink)
  R('........KKHHHHKK........'), //  3 helmet top
  R('.......KHHHHHHHHK.......'), //  4
  R('......KHHHEHHEHHHK......'), //  5 helmet rivets
  R('......KHHHHHHHHHHK......'), //  6
  R('.....KSSSSSSSSSSSSK.....'), //  7 face plate top
  R('....KSSSSSSSSSSSSSSK....'), //  8
  R('....KSSGGGGSSGGGGSSK....'), //  9 visor outer
  R('....KSSGGMGSSGMGGSSK....'), // 10 pupil dot
  R('....KSSGGGGSSGGGGSSK....'), // 11
  R('....KSCSSSSSSSSSSCSK....'), // 12 cheek LEDs
  R('.....KSSSSMMMMSSSSSK....'), // 13 mouth speaker grille
  R('.....KSDSSSSSSSSDSK.....'), // 14 jaw shadow
  R('......KSDDDDDDDDSK......'), // 15
  R('.......KSSSSSSSSK.......'), // 16
  R('....KKBBBBLLLLBBBBKK....'), // 17 chest top
  R('...KBBBBBLNTNLBBBBBK....'), // 18 chest LED
  R('..KBBBBBBLNTNLBBBBBBK...'), // 19
  R('.KBBBBBBBLNTNLBBBBBBBK..'), // 20
  R('KBBBBBBBBBLLLLBBBBBBBBK.'), // 21
  R('KBBBBBBBBBBBBBBBBBBBBBK.'), // 22
  R('KBBBBBBBBBBBBBBBBBBBBBK.'), // 23
];

// Idle "scan": visor pupil shifts left/right
const D_SCAN_L = mergeSprite(D_BASE, [
  ['row', 10, 0, '....KSSGMGGSSGMGGSSK....'],
]);
const D_SCAN_R = mergeSprite(D_BASE, [
  ['row', 10, 0, '....KSSGGGMSSGGGMSSK....'],
]);

const D_DRAFT_BASE = mergeSprite(D_BASE, [
  // antenna LED brighter / different state — pulse
  ['row', 2, 0, '..........KYYK..........'],
  // mouth speaker animated
  ['row', 13, 0, '.....KSSSSMMSSSSSSK.....'],
]);
const D_DRAFT_1 = D_DRAFT_BASE;
const D_DRAFT_2 = mergeSprite(D_DRAFT_BASE, [
  ['row', 13, 0, '.....KSSSMMMMSSSSSK.....'],
]);

const D_SLEEP = mergeSprite(D_BASE, [
  // antenna LED off
  ['row', 2, 0, '..........KHHK..........'],
  // visor dim — replace G with D
  ['row', 9, 0,  '....KSSDDDDSSDDDDSSK....'],
  ['row', 10, 0, '....KSSDDDDSSDDDDSSK....'],
  ['row', 11, 0, '....KSSDDDDSSDDDDSSK....'],
  ['row', 13, 0, '.....KSSSSSMMSSSSSK.....'],
  ['px', 19, 2, 'Z'], ['px', 20, 2, 'Z'], ['px', 21, 2, 'Z'],
  ['px', 21, 3, 'Z'], ['px', 20, 4, 'Z'],
  ['px', 19, 5, 'Z'], ['px', 20, 5, 'Z'], ['px', 21, 5, 'Z'],
]);
const D_SLEEP_2 = mergeSprite(D_BASE, [
  ['row', 2, 0, '..........KHHK..........'],
  ['row', 9, 0,  '....KSSDDDDSSDDDDSSK....'],
  ['row', 10, 0, '....KSSDDDDSSDDDDSSK....'],
  ['row', 11, 0, '....KSSDDDDSSDDDDSSK....'],
  ['row', 13, 0, '.....KSSSSSMMSSSSSK.....'],
  ['px', 18, 0, 'Z'], ['px', 19, 0, 'Z'], ['px', 20, 0, 'Z'],
  ['px', 20, 1, 'Z'], ['px', 19, 2, 'Z'],
  ['px', 18, 3, 'Z'], ['px', 19, 3, 'Z'], ['px', 20, 3, 'Z'],
]);

const D_WON = mergeSprite(D_BASE, [
  // Visor full-bright -> add white sparkle in centre of each lens
  ['px', 8, 10, 'P'], ['px', 15, 10, 'P'],
  // Mouth wide
  ['row', 13, 0, '.....KSSMMMMMMMSSSK.....'],
  // antenna LED bright yellow
  ['row', 2, 0, '..........KYYK..........'],
]);
const D_WON_STAR_A = mergeSprite(D_WON, [
  ['px', 2, 5, 'Y'], ['px', 1, 6, 'Y'], ['px', 3, 6, 'Y'], ['px', 2, 7, 'Y'],
]);
const D_WON_STAR_B = mergeSprite(D_WON, [
  ['px', 22, 16, 'Y'], ['px', 21, 17, 'Y'], ['px', 23, 17, 'Y'], ['px', 22, 18, 'Y'],
]);

// ═══════════════════════════════════════════════════════════════════
// Export bundle
// ═══════════════════════════════════════════════════════════════════
const ALEX_VARIANTS = {
  classic: {
    name: 'Alex Classic',
    blurb: 'Friendly nerd × sales pro. Headset, glasses, navy blazer + red tie.',
    palette: A_PAL,
    states: {
      idle:  [{ rows: A_BASE, dur: 3200 }, { rows: A_BLINK, dur: 140 }, { rows: A_BASE, dur: 2400 }, { rows: A_BLINK, dur: 120 }],
      draft: [{ rows: A_DRAFT_1, dur: 220 }, { rows: A_DRAFT_2, dur: 220 }],
      sleep: [{ rows: A_SLEEP, dur: 900 }, { rows: A_SLEEP_2, dur: 900 }],
      won:   [{ rows: A_WON_STAR_A, dur: 380 }, { rows: A_WON_STAR_B, dur: 380 }, { rows: A_WON, dur: 280 }],
    },
  },
  operator: {
    name: 'Alex Operator',
    blurb: 'Switchboard-era operator. Brass band, chunky cans, camel jacket.',
    palette: B_PAL,
    states: {
      idle:  [{ rows: B_BASE, dur: 3000 }, { rows: B_BLINK, dur: 140 }, { rows: B_BASE, dur: 2600 }, { rows: B_BLINK, dur: 120 }],
      draft: [{ rows: B_DRAFT_1, dur: 220 }, { rows: B_DRAFT_2, dur: 220 }],
      sleep: [{ rows: B_SLEEP, dur: 900 }, { rows: B_SLEEP_2, dur: 900 }],
      won:   [{ rows: B_WON_STAR_A, dur: 380 }, { rows: B_WON_STAR_B, dur: 380 }, { rows: B_WON, dur: 280 }],
    },
  },
  cozy: {
    name: 'Alex Cozy Quant',
    blurb: 'Sweater-vest, big round glasses, no headset. Thoughtful tone.',
    palette: C_PAL,
    states: {
      idle:  [{ rows: C_BASE, dur: 3400 }, { rows: C_BLINK, dur: 140 }, { rows: C_BASE, dur: 2200 }, { rows: C_BLINK, dur: 120 }],
      draft: [{ rows: C_DRAFT_1, dur: 260 }, { rows: C_DRAFT_2, dur: 260 }],
      sleep: [{ rows: C_SLEEP, dur: 900 }, { rows: C_SLEEP_2, dur: 900 }],
      won:   [{ rows: C_WON_STAR_A, dur: 380 }, { rows: C_WON_STAR_B, dur: 380 }, { rows: C_WON, dur: 280 }],
    },
  },
  agent: {
    name: 'Alex the Agent',
    blurb: 'Soft-pastel android. Antenna LED, visor eyes, chest status light.',
    palette: D_PAL,
    states: {
      idle:  [{ rows: D_BASE, dur: 1400 }, { rows: D_SCAN_L, dur: 800 }, { rows: D_BASE, dur: 1200 }, { rows: D_SCAN_R, dur: 800 }],
      draft: [{ rows: D_DRAFT_1, dur: 220 }, { rows: D_DRAFT_2, dur: 220 }],
      sleep: [{ rows: D_SLEEP, dur: 1100 }, { rows: D_SLEEP_2, dur: 1100 }],
      won:   [{ rows: D_WON_STAR_A, dur: 380 }, { rows: D_WON_STAR_B, dur: 380 }, { rows: D_WON, dur: 280 }],
    },
  },
};

Object.assign(window, { ALEX_VARIANTS });
