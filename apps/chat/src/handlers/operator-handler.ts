import type { EventLoopDelegateConfig } from "./lead-handler.js";

export function isOperatorMessage(roles: string[] | undefined): boolean {
  return Array.isArray(roles) && roles.includes("operator");
}

export interface DelegateOperatorInput {
  rawInput: string;
  channel: "telegram" | "whatsapp" | "dashboard";
  operatorId: string;
  organizationId: string;
  sendReply: (text: string) => Promise<void> | void;
}

export async function delegateOperatorCommand(
  config: EventLoopDelegateConfig,
  input: DelegateOperatorInput,
): Promise<void> {
  const url = `${config.apiUrl}/api/operator/command`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.apiKey) {
    headers["Authorization"] = `Bearer ${config.apiKey}`;
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        rawInput: input.rawInput,
        channel: input.channel,
        operatorId: input.operatorId,
      }),
    });

    if (!res.ok) {
      console.error(`[OperatorHandler] API error: ${res.status} ${res.statusText}`);
      await input.sendReply("Sorry, something went wrong processing your command.");
      return;
    }

    const body = (await res.json()) as {
      commandId: string;
      status: string;
      message: string;
    };

    await input.sendReply(body.message);
  } catch (err) {
    console.error("[OperatorHandler] Delegation error:", err);
    await input.sendReply("Sorry, something went wrong processing your command.");
  }
}
