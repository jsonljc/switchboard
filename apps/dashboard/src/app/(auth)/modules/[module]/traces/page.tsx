import { notFound } from "next/navigation";
import { MODULE_IDS } from "@/lib/module-types";
import type { ModuleId } from "@/lib/module-types";

interface PageProps {
  params: Promise<{ module: string }>;
}

export default async function ModuleTracesPage({ params }: PageProps) {
  const { module: moduleSlug } = await params;

  if (!MODULE_IDS.includes(moduleSlug as ModuleId)) {
    notFound();
  }

  return (
    <div className="dashboard-frame">
      <h1 className="text-xl font-semibold" style={{ fontFamily: "var(--font-display)" }}>
        Execution Traces
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Trace viewer for {moduleSlug} module will be wired here.
      </p>
    </div>
  );
}
