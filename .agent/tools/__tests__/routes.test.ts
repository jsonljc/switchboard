import { describe, it, expect } from "vitest";
import { Project } from "ts-morph";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { findMutatingRouteHandlers } from "../routes.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => join(here, "fixtures", name);

function project(): Project {
  return new Project({ useInMemoryFileSystem: false, skipFileDependencyResolution: true });
}

describe("findMutatingRouteHandlers", () => {
  it("finds Fastify POST handlers", () => {
    const p = project();
    const sf = p.addSourceFileAtPath(fixture("route-fastify-mutating.ts"));
    const found = findMutatingRouteHandlers(sf);
    expect(found).toHaveLength(1);
    expect(found[0].framework).toBe("fastify");
    expect(found[0].method).toBe("POST");
    expect(found[0].line).toBeGreaterThan(0);
  });

  it("ignores Fastify GET handlers", () => {
    const p = project();
    const sf = p.addSourceFileAtPath(fixture("route-fastify-readonly.ts"));
    const found = findMutatingRouteHandlers(sf);
    expect(found).toHaveLength(0);
  });

  it("finds Next App Router POST/PUT/PATCH/DELETE exports", () => {
    const p = project();
    const sf = p.addSourceFileAtPath(fixture("route-next-mutating.ts"));
    const found = findMutatingRouteHandlers(sf);
    expect(found).toHaveLength(1);
    expect(found[0].framework).toBe("next");
    expect(found[0].method).toBe("POST");
  });

  it("ignores Next App Router GET-only files", () => {
    const p = project();
    const sf = p.addSourceFileAtPath(fixture("route-next-readonly.ts"));
    const found = findMutatingRouteHandlers(sf);
    expect(found).toHaveLength(0);
  });
});
