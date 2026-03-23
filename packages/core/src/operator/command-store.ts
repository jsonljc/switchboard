import type { OperatorRequest, OperatorCommand, CommandStatus } from "@switchboard/schemas";

export interface OperatorCommandStore {
  saveRequest(request: OperatorRequest): Promise<void>;
  saveCommand(command: OperatorCommand): Promise<void>;
  updateCommandStatus(
    commandId: string,
    status: CommandStatus,
    updates?: Partial<Pick<OperatorCommand, "resultSummary" | "completedAt" | "workflowIds">>,
  ): Promise<void>;
  getCommandById(commandId: string): Promise<OperatorCommand | null>;
  listCommands(filters: {
    organizationId: string;
    limit?: number;
    offset?: number;
  }): Promise<OperatorCommand[]>;
  getRequestById(requestId: string): Promise<OperatorRequest | null>;
}
