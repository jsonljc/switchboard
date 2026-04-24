import { EscalationList } from "@/components/escalations/escalation-list";

export default function EscalationsPage() {
  return (
    <div className="max-w-2xl mx-auto py-6 px-4">
      <h1 className="text-xl font-semibold mb-4">Escalations</h1>
      <EscalationList />
    </div>
  );
}
