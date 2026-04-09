import type { PrismaDbClient } from "../prisma-db.js";
import type { AgentPersona } from "@switchboard/schemas";

type PersonaCreateData = Omit<AgentPersona, "id" | "organizationId" | "createdAt" | "updatedAt">;

export class PrismaAgentPersonaStore {
  constructor(private prisma: PrismaDbClient) {}

  async getByOrgId(organizationId: string): Promise<AgentPersona | null> {
    return this.prisma.agentPersona.findUnique({
      where: { organizationId },
    }) as unknown as AgentPersona | null;
  }

  async upsert(organizationId: string, data: PersonaCreateData): Promise<AgentPersona> {
    return this.prisma.agentPersona.upsert({
      where: { organizationId },
      create: {
        organizationId,
        businessName: data.businessName,
        businessType: data.businessType,
        productService: data.productService,
        valueProposition: data.valueProposition,
        tone: data.tone,
        qualificationCriteria: data.qualificationCriteria as object,
        disqualificationCriteria: data.disqualificationCriteria as object,
        bookingLink: data.bookingLink,
        escalationRules: data.escalationRules as object,
        customInstructions: data.customInstructions,
      },
      update: {
        businessName: data.businessName,
        businessType: data.businessType,
        productService: data.productService,
        valueProposition: data.valueProposition,
        tone: data.tone,
        qualificationCriteria: data.qualificationCriteria as object,
        disqualificationCriteria: data.disqualificationCriteria as object,
        bookingLink: data.bookingLink,
        escalationRules: data.escalationRules as object,
        customInstructions: data.customInstructions,
      },
    }) as unknown as AgentPersona;
  }

  async delete(organizationId: string): Promise<void> {
    await this.prisma.agentPersona.delete({
      where: { organizationId },
    });
  }
}
