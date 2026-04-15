import { SkillParameterError } from "./types.js";
import type { ParameterDeclaration } from "./types.js";

function sortedYaml(obj: Record<string, unknown>, indent = 0): string {
  const prefix = "  ".repeat(indent);
  return Object.keys(obj)
    .sort()
    .map((key) => {
      const val = obj[key];
      if (val !== null && typeof val === "object" && !Array.isArray(val)) {
        return `${prefix}${key}:\n${sortedYaml(val as Record<string, unknown>, indent + 1)}`;
      }
      return `${prefix}${key}: ${String(val)}`;
    })
    .join("\n");
}

function resolveValue(
  paramName: string,
  field: string | undefined,
  params: Record<string, unknown>,
  decl: ParameterDeclaration | undefined,
): string {
  const value = params[paramName];

  if (value === undefined || value === null) {
    if (decl?.required) {
      throw new SkillParameterError(`Missing required parameter: ${paramName}`);
    }
    return "";
  }

  // Validate enum
  if (decl?.type === "enum" && decl.values) {
    if (!decl.values.includes(String(value))) {
      throw new SkillParameterError(
        `Parameter ${paramName} must be one of [${decl.values.join(", ")}], got "${String(value)}"`,
      );
    }
  }

  // Dot access: {{PARAM.field}}
  if (field) {
    if (typeof value !== "object" || value === null) {
      throw new SkillParameterError(`Cannot access .${field} on non-object parameter ${paramName}`);
    }
    const nested = (value as Record<string, unknown>)[field];
    if (nested === undefined) {
      throw new SkillParameterError(`Missing field "${field}" in parameter ${paramName}`);
    }
    if (typeof nested === "object" && nested !== null && !Array.isArray(nested)) {
      return sortedYaml(nested as Record<string, unknown>);
    }
    return String(nested);
  }

  // Full object → YAML
  if (typeof value === "object" && !Array.isArray(value)) {
    return sortedYaml(value as Record<string, unknown>);
  }

  return String(value);
}

export function interpolate(
  template: string,
  params: Record<string, unknown>,
  declarations: ParameterDeclaration[],
): string {
  const declMap = new Map(declarations.map((d) => [d.name, d]));

  // Validate all required params are present before interpolation
  for (const decl of declarations) {
    if (decl.required && !(decl.name in params)) {
      throw new SkillParameterError(`Missing required parameter: ${decl.name}`);
    }
  }

  // Replace {{PARAM}} and {{PARAM.field}}
  return template.replace(
    /\{\{(\w+)(?:\.(\w+))?\}\}/g,
    (_match, paramName: string, field?: string) => {
      const decl = declMap.get(paramName);
      return resolveValue(paramName, field, params, decl);
    },
  );
}
