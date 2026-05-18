import styles from './agentic-shell.module.css'

interface Props {
  text: string
}

/** A user-voiced message. Right-aligned, charcoal on stone — visually
 *  inverted from a Horace bubble. Renders only what the agent said back;
 *  no pills, no avatar. */
export function UserBubble({ text }: Props) {
  return (
    <div className={styles.bubbleRow} data-role="user">
      <div className={styles.bubble} data-role="user">
        <p className={styles.bubbleText}>{text}</p>
      </div>
    </div>
  )
}
