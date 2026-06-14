import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

function readSource(rel: string): string {
  return readFileSync(path.resolve(process.cwd(), rel), "utf8");
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

// The Meta SDK is a third-party tracking script. It must load only in the
// authenticated app. These are cheap regression tripwires, NOT an authoritative
// guarantee (a regression hiding the URL behind a constant or dynamic import
// could slip past a source-text scan). The running-app network-panel check is
// the authoritative proof. See the spec, section 6.
describe("Meta SDK loads only in the authenticated app", () => {
  it("the (auth) layout mounts MetaSdkScript", () => {
    expect(readSource("src/app/(auth)/layout.tsx")).toContain("MetaSdkScript");
  });

  it("the root layout no longer references the Meta SDK", () => {
    const rootLayout = readSource("src/app/layout.tsx");
    expect(rootLayout).not.toContain("connect.facebook.net");
    expect(rootLayout).not.toContain("window.FB");
    expect(rootLayout).not.toContain("MetaSdkScript");
  });

  it("no file in the (public) route group references the Meta SDK", () => {
    const publicDir = path.resolve(process.cwd(), "src/app/(public)");
    const offenders = walk(publicDir).filter((file) => {
      const src = readFileSync(file, "utf8");
      return src.includes("connect.facebook.net") || src.includes("MetaSdkScript");
    });
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("the SDK url is centralized in the MetaSdkScript component", () => {
    expect(readSource("src/components/settings/meta-sdk-script.tsx")).toContain(
      "connect.facebook.net",
    );
  });
});
