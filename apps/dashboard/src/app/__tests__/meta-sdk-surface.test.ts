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
  it("the (auth) layout mounts MetaSdkScript only for an authenticated session", () => {
    const authLayout = readSource("src/app/(auth)/layout.tsx");
    expect(authLayout).toContain("MetaSdkScript");
    // Gate on the real session, not merely (auth) route-group membership: a few
    // (auth) routes (for example /mira, /operator) are not in the middleware
    // auth matcher, so an unauthenticated request could otherwise reach the
    // layout and load the SDK. With null session in production, it does not.
    expect(authLayout).toMatch(/session\s*&&\s*<MetaSdkScript/);
  });

  it("the root layout no longer references the Meta SDK", () => {
    const rootLayout = readSource("src/app/layout.tsx");
    expect(rootLayout).not.toContain("connect.facebook.net");
    expect(rootLayout).not.toContain("window.FB");
    expect(rootLayout).not.toContain("MetaSdkScript");
  });

  it("no file in the (public) route group references the Meta SDK", () => {
    const publicDir = path.resolve(process.cwd(), "src/app/(public)");
    // Scan source text for the SDK script path and the loader component. We match
    // the script PATH ("/en_US/sdk.js"), not the bare host, so this reads as a
    // source-text fingerprint scan rather than URL host validation.
    const offenders = walk(publicDir).filter((file) => {
      const src = readFileSync(file, "utf8");
      return src.includes("/en_US/sdk.js") || src.includes("MetaSdkScript");
    });
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("the SDK url is centralized in the MetaSdkScript component", () => {
    expect(readSource("src/components/settings/meta-sdk-script.tsx")).toContain(
      "connect.facebook.net",
    );
  });
});

describe("dashboard CSP", () => {
  it("allows the Meta SDK host in the script-src directive", () => {
    const config = readFileSync(path.resolve(process.cwd(), "next.config.mjs"), "utf8");
    // Capture the script-src directive content (up to the next backtick or comma)
    // so the assertion targets the directive, not an unrelated line.
    const match = config.match(/script-src([^`,]*)/);
    expect(match, "script-src directive not found").not.toBeNull();
    expect(match![1]).toContain("https://connect.facebook.net");
  });

  it("allows the Meta Embedded Signup frame hosts in the frame-src directive", () => {
    // Embedded Signup runs cross-domain iframes: the SDK xd_arbiter on
    // staticxx.facebook.com and the auth/ESU dialog on www.facebook.com. They
    // deliver the OAuth code + session info back via postMessage. Without an
    // explicit frame-src they fall back to default-src 'self' and are blocked,
    // so the ESU handshake never completes. Match the directive only (not an
    // unrelated line) up to the next backtick or comma.
    const config = readFileSync(path.resolve(process.cwd(), "next.config.mjs"), "utf8");
    const match = config.match(/frame-src([^`,]*)/);
    expect(match, "frame-src directive not found").not.toBeNull();
    expect(match![1]).toContain("https://www.facebook.com");
    expect(match![1]).toContain("https://staticxx.facebook.com");
  });
});
