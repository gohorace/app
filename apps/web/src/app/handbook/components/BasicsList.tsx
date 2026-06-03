import clsx from 'clsx'
import { Check } from 'lucide-react'
import styles from '../handbook.module.css'
import { renderInline } from './inline'

/** The "basics a great site gets right" list (chapter 04) — tick + one line. */
export function BasicsList({ items }: { items: string[] }) {
  return (
    <>
      {items.map((item, i) => (
        <div
          key={i}
          data-speak=""
          className={clsx(styles.checkItem, i === items.length - 1 && styles.last)}
        >
          <div className={styles.checkMark}>
            <Check />
          </div>
          <div className={styles.checkBody}>
            <p>{renderInline(item)}</p>
          </div>
        </div>
      ))}
    </>
  )
}
