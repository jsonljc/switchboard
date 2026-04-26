import type { SourceFile, CallExpression } from "ts-morph";
import { SyntaxKind } from "ts-morph";

export type Framework = "fastify" | "next";
export type HttpMethod = "POST" | "PUT" | "PATCH" | "DELETE";

export interface RouteHandler {
  framework: Framework;
  method: HttpMethod;
  line: number;
}

const MUTATING_METHODS: HttpMethod[] = ["POST", "PUT", "PATCH", "DELETE"];

const FASTIFY_METHOD_NAMES = new Set(["post", "put", "patch", "delete"]);

export function findMutatingRouteHandlers(sf: SourceFile): RouteHandler[] {
  const out: RouteHandler[] = [];
  out.push(...findFastifyHandlers(sf));
  out.push(...findNextHandlers(sf));
  return out;
}

function findFastifyHandlers(sf: SourceFile): RouteHandler[] {
  const out: RouteHandler[] = [];
  sf.forEachDescendant((node) => {
    if (node.getKind() !== SyntaxKind.CallExpression) return;
    const call = node as CallExpression;
    const expr = call.getExpression();
    if (expr.getKind() !== SyntaxKind.PropertyAccessExpression) return;
    const propAccess = expr.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
    const methodName = propAccess.getName();
    if (!FASTIFY_METHOD_NAMES.has(methodName)) return;
    const args = call.getArguments();
    if (args.length === 0) return;
    if (args[0].getKind() !== SyntaxKind.StringLiteral) return;
    out.push({
      framework: "fastify",
      method: methodName.toUpperCase() as HttpMethod,
      line: call.getStartLineNumber(),
    });
  });
  return out;
}

function findNextHandlers(sf: SourceFile): RouteHandler[] {
  const out: RouteHandler[] = [];
  const filename = sf.getBaseName();
  if (filename !== "route.ts" && filename !== "route.tsx") {
    if (!sf.getFilePath().includes("route-next")) return out;
  }
  for (const fn of sf.getFunctions()) {
    if (!fn.isExported()) continue;
    const name = fn.getName();
    if (!name) continue;
    if ((MUTATING_METHODS as string[]).includes(name)) {
      out.push({
        framework: "next",
        method: name as HttpMethod,
        line: fn.getStartLineNumber(),
      });
    }
  }
  for (const stmt of sf.getVariableStatements()) {
    if (!stmt.isExported()) continue;
    for (const decl of stmt.getDeclarations()) {
      const name = decl.getName();
      if ((MUTATING_METHODS as string[]).includes(name)) {
        out.push({
          framework: "next",
          method: name as HttpMethod,
          line: decl.getStartLineNumber(),
        });
      }
    }
  }
  return out;
}
