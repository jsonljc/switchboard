import { notFound } from "next/navigation";
import { EditorialAuthShell } from "@/components/layout/editorial-auth-shell";

export default async function OwnerHomePage() {
  if (process.env.NEXT_PUBLIC_DEPLOY_ENV === "production") notFound();
  return (
    <EditorialAuthShell>
      <section className="section page" data-block="owner-home-placeholder">
        <div className="folio">
          <span className="folio-l">Owner Home</span>
          <span className="folio-r">Coming soon</span>
        </div>
        <p className="empty-state">
          <em>This section will land here in a follow-up slice.</em>
        </p>
      </section>
    </EditorialAuthShell>
  );
}
