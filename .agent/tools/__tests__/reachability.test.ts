import { describe, it, expect } from "vitest";
import { Project } from "ts-morph";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { reachesIngress } from "../reachability.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => join(here, "fixtures", name);

function loadProject(): Project {
  return new Project({ useInMemoryFileSystem: false, skipFileDependencyResolution: false });
}

describe("reachesIngress", () => {
  it("returns true when route file references PlatformIngress directly", () => {
    const p = loadProject();
    const sf = p.addSourceFileAtPath(fixture("reaches-ingress-direct.ts"));
    expect(reachesIngress(sf)).toBe(true);
  });

  it("returns true when an imported helper file references PlatformIngress", () => {
    const p = loadProject();
    p.addSourceFileAtPath(fixture("reaches-ingress-helper.ts"));
    const sf = p.addSourceFileAtPath(fixture("reaches-ingress-via-helper.ts"));
    expect(reachesIngress(sf)).toBe(true);
  });

  it("returns false when neither the route nor any direct import references PlatformIngress", () => {
    const p = loadProject();
    const sf = p.addSourceFileAtPath(fixture("no-ingress.ts"));
    expect(reachesIngress(sf)).toBe(false);
  });
});
