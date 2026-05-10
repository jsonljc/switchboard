import type { AttributionData } from "../fixtures";
import { fmtMoney } from "./format";
import styles from "../reports.module.css";

interface AttributionProps {
  data: AttributionData;
  period: string;
}

export function Attribution({ data, period }: AttributionProps) {
  const dKind = data.delta.kind;
  const dClass =
    dKind === "pos" ? styles.deltaPos : dKind === "neg" ? styles.deltaNeg : styles.deltaFlat;
  return (
    <>
      <div className={styles.folio}>
        <span className={styles.folioL}>Attributed value</span>
        <span className={styles.folioR}>{period}</span>
      </div>
      <div className={styles.attribution}>
        <div className={`${styles.attrCell} ${styles.isTotal}`}>
          <span className={`${styles.attrNum} ${styles.isHero} ${styles.fadeIn}`} key={data.total}>
            {fmtMoney(data.total)}
          </span>
          <span className={`${styles.attrSub} ${dClass}`}>{data.delta.text}</span>
        </div>
        <div className={`${styles.attrCell} ${styles.isA}`}>
          <span className={styles.attrFolio}>Riley</span>
          <span className={`${styles.attrNum} ${styles.fadeIn}`} key={data.riley.value}>
            {fmtMoney(data.riley.value)}
          </span>
          <span className={`${styles.attrSub} ${styles.italic}`}>{data.riley.caption}</span>
        </div>
        <div className={`${styles.attrCell} ${styles.isB}`}>
          <span className={styles.attrFolio}>Alex</span>
          <span className={`${styles.attrNum} ${styles.fadeIn}`} key={data.alex.value}>
            {fmtMoney(data.alex.value)}
          </span>
          <span className={`${styles.attrSub} ${styles.italic}`}>{data.alex.caption}</span>
        </div>
      </div>
    </>
  );
}
