import prompts from "prompts";

export interface CartridgeAnswers {
  name: string;
  displayName: string;
  description: string;
  actionType: string;
  actionName: string;
  connectionId: string;
  author: string;
}

const KEBAB_RE = /^[a-z][a-z0-9-]*$/;
const DOTTED_RE = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9_]*){1,4}$/;

function deriveDisplayName(name: string): string {
  return name
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function deriveActionName(actionType: string): string {
  const parts = actionType.split(".");
  const last = parts[parts.length - 1] ?? "action";
  const secondLast = parts[parts.length - 2] ?? "";
  return `${last.charAt(0).toUpperCase()}${last.slice(1)} ${secondLast}`.trim();
}

function derivePrefix(name: string): string {
  return name.replace(/-/g, "");
}

export async function collectAnswers(): Promise<CartridgeAnswers | null> {
  const response = await prompts(
    [
      {
        type: "text",
        name: "name",
        message: "Cartridge name (kebab-case)",
        validate: (v: string) =>
          KEBAB_RE.test(v) || "Must be kebab-case starting with a lowercase letter",
      },
      {
        type: "text",
        name: "displayName",
        message: "Display name",
        initial: (_prev: unknown, values: Record<string, string>) =>
          deriveDisplayName(values["name"] ?? ""),
        validate: (v: string) => v.trim().length > 0 || "Must be non-empty",
      },
      {
        type: "text",
        name: "description",
        message: "Description",
        validate: (v: string) => v.trim().length > 0 || "Must be non-empty",
      },
      {
        type: "text",
        name: "actionType",
        message: "First action type (dotted notation, e.g. stripe.payment.create)",
        initial: (_prev: unknown, values: Record<string, string>) =>
          `${derivePrefix(values["name"] ?? "")}.resource.verb`,
        validate: (v: string) =>
          DOTTED_RE.test(v) || "Must be dotted notation with 2+ segments",
      },
      {
        type: "text",
        name: "actionName",
        message: "First action name",
        initial: (_prev: unknown, values: Record<string, string>) =>
          deriveActionName(values["actionType"] ?? ""),
        validate: (v: string) => v.trim().length > 0 || "Must be non-empty",
      },
      {
        type: "text",
        name: "connectionId",
        message: "Connection ID (kebab-case)",
        initial: (_prev: unknown, values: Record<string, string>) =>
          `${derivePrefix(values["name"] ?? "")}-api`,
        validate: (v: string) =>
          KEBAB_RE.test(v) || "Must be kebab-case starting with a lowercase letter",
      },
      {
        type: "text",
        name: "author",
        message: "Author",
        validate: (v: string) => v.trim().length > 0 || "Must be non-empty",
      },
    ],
    { onCancel: () => false },
  );

  if (!response["name"]) return null;
  return response as CartridgeAnswers;
}
