import type { Matrix } from '../content'
import styles from '../handbook.module.css'

export function MatrixTable({ matrix }: { matrix: Matrix }) {
  const [hStage, hGives, hReads] = matrix.headers
  return (
    <div className={styles.matrixWrap}>
      <div className={styles.matrixInner}>
        <div className={styles.matrixCap}>{matrix.caption}</div>
        <table className={styles.matrix}>
        <colgroup>
          <col className={styles.cStage} />
          <col className={styles.cGives} />
          <col className={styles.cReads} />
        </colgroup>
        <thead>
          <tr>
            <th>{hStage}</th>
            <th>{hGives}</th>
            <th>{hReads}</th>
          </tr>
        </thead>
        <tbody>
          {matrix.rows.map((row, i) => (
            <tr key={i} data-speak="row">
              <td className={styles.stage} data-h={hStage}>
                <strong data-stage>{row.stageTitle}</strong>
                {row.stageSub && <span>{row.stageSub}</span>}
              </td>
              <td className={styles.gives} data-h={hGives}>
                {row.gives}
              </td>
              <td className={`${styles.reads} ${styles.readsCell}`} data-h={hReads} data-reads>
                {row.reads}
              </td>
            </tr>
          ))}
        </tbody>
        </table>
      </div>
    </div>
  )
}
