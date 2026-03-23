import type { OperatorChannel, CommandEntity } from "@switchboard/schemas";

export class SummaryFormatter {
  formatSuccess(
    intent: string,
    resultData: Record<string, unknown>,
    channel: OperatorChannel,
  ): string {
    const summary = this.buildSuccessSummary(intent, resultData);
    return channel === "dashboard" ? this.wrapRich(summary, resultData) : summary;
  }

  formatError(error: string, _channel: OperatorChannel): string {
    return `Something failed: ${error}`;
  }

  formatConfirmationPrompt(
    intent: string,
    entities: CommandEntity[],
    _channel: OperatorChannel,
  ): string {
    const targetDesc =
      entities.length > 0
        ? entities.map((e) => (e.id ? `${e.type} ${e.id}` : e.type)).join(", ")
        : "the selected items";
    return `I'll ${this.intentToVerb(intent)} ${targetDesc}. Reply "confirm" to proceed or "cancel" to abort.`;
  }

  formatClarificationPrompt(missingEntities: string[], _channel: OperatorChannel): string {
    return `I need a bit more detail. Which ${missingEntities.join(" and ")} should I target?`;
  }

  private buildSuccessSummary(intent: string, data: Record<string, unknown>): string {
    const verb = this.intentToVerb(intent);
    const details = Object.entries(data)
      .map(([k, v]) => `${this.camelToWords(k)}: ${String(v)}`)
      .join(", ");
    return details ? `Done — ${verb}. ${details}.` : `Done — ${verb}.`;
  }

  private wrapRich(_summary: string, data: Record<string, unknown>): string {
    const verb = "Result";
    const lines = Object.entries(data).map(
      ([k, v]) => `- **${this.camelToWords(k)}**: ${String(v)}`,
    );
    return `${verb}\n\n${lines.join("\n")}`;
  }

  private intentToVerb(intent: string): string {
    const map: Record<string, string> = {
      follow_up_leads: "followed up with leads",
      pause_campaigns: "paused campaigns",
      resume_campaigns: "resumed campaigns",
      show_pipeline: "pipeline summary",
      reassign_leads: "reassigned leads",
      draft_campaign: "drafted campaign",
      query_lead_history: "lead history",
      show_status: "status overview",
    };
    return map[intent] ?? intent.replace(/_/g, " ");
  }

  private camelToWords(s: string): string {
    return s
      .replace(/([A-Z])/g, " $1")
      .replace(/^./, (c) => c.toUpperCase())
      .trim();
  }
}
