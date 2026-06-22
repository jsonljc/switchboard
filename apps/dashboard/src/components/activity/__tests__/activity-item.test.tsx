import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// The activity-item icon-color map must speak the editorial register's
// semantic tokens (text-positive / text-caution / text-destructive /
// text-muted-foreground), never a raw Tailwind palette color. A raw
// text-blue-500 (info) was the last register-fracture leak in this map.
const source = readFileSync(
  path.resolve(process.cwd(), "src/components/activity/activity-item.tsx"),
  "utf8",
);
const mapMatch = source.match(/const iconColorMap = \{([\s\S]*?)\};/);

describe("activity-item icon colors — editorial register tokens only", () => {
  it("defines the iconColorMap literal", () => {
    expect(mapMatch, "iconColorMap literal must exist").not.toBeNull();
  });

  it("uses no raw Tailwind palette color in the icon-color map", () => {
    const RAW_TW_COLOR =
      /text-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}/;
    expect(
      RAW_TW_COLOR.test(mapMatch![1]),
      `raw Tailwind color in iconColorMap: ${mapMatch![1]}`,
    ).toBe(false);
  });

  it("maps the info severity to a neutral semantic ink (not a hue)", () => {
    expect(mapMatch![1]).toMatch(/info:\s*"text-muted-foreground"/);
  });
});
