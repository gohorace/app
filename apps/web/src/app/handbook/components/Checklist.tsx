import clsx from 'clsx'
import { Check } from 'lucide-react'
import type { CheckItem } from '../content'
import styles from '../handbook.module.css'

export function Checklist({ items }: { items: CheckItem[] }) {
  return (
    <>
      {items.map((item, i) => (
        <div
          key={i}
          data-speak="check"
          className={clsx(styles.checkItem, i === items.length - 1 && styles.last)}
        >
          <div className={styles.checkMark}>
            <Check />
          </div>
          <div className={styles.checkBody}>
            <h4>{item.title}</h4>
            <p>{item.body}</p>
          </div>
        </div>
      ))}
    </>
  )
}
