export const T = {
  bg: "#FAF8F2",
  paper: "#FFFFFF",
  ink: "#0E0C0A",
  ink2: "#3A332B",
  ink3: "#6B6052",
  ink4: "#A39786",
  ink5: "#C8BEAE",
  hair: "rgba(14, 12, 10, 0.08)",
  hairSoft: "rgba(14, 12, 10, 0.04)",
  amber: "#B8782E",
  amberDeep: "#7C4F1C",
  amberSoft: "#F1E2C2",
  amberPaper: "#FBF1D6",
  green: "#3F7A36",
  red: "#A03A2E",
  blue: "#3A5A80",
} as const;

export type CockpitToken = keyof typeof T;
