"use client";

import { ContactsHeader } from "../components/header";
import { useContactDetail } from "./hooks/use-contact-detail";
import { HeaderSection } from "./components/header-section";
import { ProfileSection } from "./components/profile-section";
import { OpportunitiesSection } from "./components/opportunities-section";
import { ThreadsSection } from "./components/threads-section";
import { OpenDecisionsSection } from "./components/open-decisions-section";
import { RevenueEventsSection } from "./components/revenue-events-section";
import styles from "./contact-detail.module.css";

export function ContactDetailPage({ contactId }: { contactId: string }) {
  const result = useContactDetail(contactId);

  return (
    <div className={styles.contactDetailPage}>
      <ContactsHeader />
      <main className={styles.page}>
        {result.isLoading ? (
          <DetailSkeleton />
        ) : result.isError ? (
          <ErrorState onRetry={() => result.refetch()} />
        ) : result.data ? (
          <>
            <HeaderSection profile={result.data.profile} />
            <ProfileSection profile={result.data.profile} />
            <OpportunitiesSection items={result.data.opportunities} />
            <ThreadsSection items={result.data.threads} />
            <OpenDecisionsSection items={result.data.openDecisions} />
            <RevenueEventsSection items={result.data.revenueEvents} />
          </>
        ) : null}
      </main>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div aria-label="Loading contact" className={styles.skeleton}>
      <div className={styles.skeletonHeader} />
      <div className={styles.skeletonRow} />
      <div className={styles.skeletonRow} />
      <div className={styles.skeletonRow} />
      <div className={styles.skeletonRow} />
      <div className={styles.skeletonRow} />
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className={styles.errorState}>
      <p>Couldn&apos;t load contact.</p>
      <button type="button" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}
