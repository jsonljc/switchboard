"use client";
import { useEffect, useState } from "react";
import styles from "../reports.module.css";
import { SwitchboardMark } from "./switchboard-mark";

export interface TopbarProps {
  org: string;
  currentUser: { display: string; initials: string };
  liveMode: boolean;
}

export function Topbar({ org, currentUser, liveMode }: TopbarProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const time = new Date(now).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <header className={styles.topbar}>
      <div className={styles.topbarRow}>
        <div className={styles.brandCluster}>
          <span className={styles.brandMark}>
            <SwitchboardMark />
            Switchboard
          </span>
          <span className={styles.brandSep}>/</span>
          <span className={styles.brandOrg}>{org}</span>
          <span className={styles.brandSep}>/</span>
          <span className={styles.brandPage}>Reports</span>
        </div>
        <div className={styles.topbarRight}>
          <span className={`${styles.livePip} ${liveMode ? "" : styles.fixture}`}>
            {liveMode ? "live data" : "sample data"}
          </span>
          <span>SGT · {time}</span>
          <span className={styles.topbarUser}>
            <span className={styles.me}>{currentUser.initials}</span>
            <span>{currentUser.display}</span>
          </span>
        </div>
      </div>
    </header>
  );
}
