"use client";

import { AgentFamilyCharacter } from "@/components/landing/agent-family-character";

interface ComingSoonFamilyProps {
  name: string;
  family: string;
  description: string;
}

export function ComingSoonFamily({ name, family: _family, description }: ComingSoonFamilyProps) {
  return (
    <div className="flex flex-col items-center py-16">
      <AgentFamilyCharacter name={name} roleFocus="default" status="coming" className="mb-6" />
      <p className="text-muted-foreground text-center max-w-md mb-4">{description}</p>
      <span className="font-mono text-sm text-muted-foreground">Coming soon</span>
    </div>
  );
}
