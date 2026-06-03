import styles from '../handbook.module.css'

export function Pullquote({ text }: { text: string }) {
  return (
    <div className={styles.pullquote}>
      <div className={styles.pqDot} />
      <blockquote data-speak="">{text}</blockquote>
    </div>
  )
}
