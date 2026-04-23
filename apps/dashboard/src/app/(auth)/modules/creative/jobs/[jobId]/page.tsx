import { notFound } from "next/navigation";

interface PageProps {
  params: Promise<{ jobId: string }>;
}

export default async function CreativeJobDetailPage({ params }: PageProps) {
  const { jobId } = await params;

  if (!jobId) notFound();

  return (
    <div className="dashboard-frame">
      <h1 className="text-xl font-semibold" style={{ fontFamily: "var(--font-display)" }}>
        Creative Job
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Creative job detail for {jobId} will be wired here. Reuses existing creative job components.
      </p>
    </div>
  );
}
