"use client";

import { usePlaybook, useUpdatePlaybook } from "@/hooks/use-playbook";
import { PlaybookPanel } from "@/components/onboarding/playbook-panel";
import type { PlaybookService } from "@switchboard/schemas";

export function PlaybookView() {
  const { data, isLoading } = usePlaybook();
  const updatePlaybook = useUpdatePlaybook();

  if (isLoading || !data) {
    return (
      <p className="text-[16px]" style={{ color: "var(--sw-text-muted)" }}>
        Loading playbook...
      </p>
    );
  }

  const { playbook } = data;

  return (
    <div className="-mx-8 -mt-4">
      <PlaybookPanel
        playbook={playbook}
        businessName={playbook.businessIdentity.name}
        onUpdateSection={(section, sectionData) => {
          updatePlaybook.mutate({ playbook: { ...playbook, [section]: sectionData } });
        }}
        onUpdateService={(service: PlaybookService) => {
          updatePlaybook.mutate({
            playbook: {
              ...playbook,
              services: playbook.services.map((s) => (s.id === service.id ? service : s)),
            },
          });
        }}
        onDeleteService={(id: string) => {
          updatePlaybook.mutate({
            playbook: { ...playbook, services: playbook.services.filter((s) => s.id !== id) },
          });
        }}
        onAddService={() => {
          updatePlaybook.mutate({
            playbook: {
              ...playbook,
              services: [
                ...playbook.services,
                {
                  id: `svc-${Date.now()}`,
                  name: "",
                  bookingBehavior: "ask_first" as const,
                  status: "missing" as const,
                  source: "manual" as const,
                },
              ],
            },
          });
        }}
      />
    </div>
  );
}
