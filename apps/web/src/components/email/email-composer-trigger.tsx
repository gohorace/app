'use client'

/**
 * Button/CTA that opens the TrackedEmailComposer. TipTap is heavy + doesn't
 * SSR, so the composer itself is loaded via next/dynamic with ssr:false.
 *
 * Two embed shapes:
 *   - <SendTrackedEmailButton ...>   — bare button styled to the host surface
 *   - <SendTrackedEmailLink ...>     — text link form for prompt cards
 *
 * Both share the same props + open the same modal.
 */

import dynamic from 'next/dynamic'
import { useState, type CSSProperties, type ReactNode } from 'react'
import { Send } from 'lucide-react'

const TrackedEmailComposer = dynamic(
  () =>
    import('./tracked-email-composer').then(
      (m) => m.TrackedEmailComposer,
    ),
  { ssr: false },
)

export interface ComposerTriggerProps {
  contactId: string
  contactEmail: string | null
  contactName?: string | null
  source?: 'ui' | 'digest_prompt'
  onSent?: () => void
}

interface ButtonProps extends ComposerTriggerProps {
  /** Inline style for the wrapping button (matches host action-bar). */
  buttonStyle?: CSSProperties
  /** Render prop alternative: receives `onClick` + `disabled`. */
  children?: (args: { onClick: () => void; disabled: boolean }) => ReactNode
  /** Optional flat label when not using render prop. */
  label?: string
  icon?: boolean
}

export function SendTrackedEmailButton({
  contactId,
  contactEmail,
  contactName,
  source,
  buttonStyle,
  children,
  label = 'Send tracked email',
  icon = true,
  onSent,
}: ButtonProps) {
  const [open, setOpen] = useState(false)

  const disabled = !contactEmail

  const trigger = children ? (
    children({ onClick: () => setOpen(true), disabled })
  ) : (
    <button
      type="button"
      onClick={() => setOpen(true)}
      disabled={disabled}
      title={disabled ? 'This contact has no email address on file' : undefined}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        background: 'transparent',
        color: '#5A4D40',
        border: '1.5px solid rgba(140,123,107,0.25)',
        borderRadius: 8,
        padding: '8px 14px',
        fontSize: '0.85rem',
        fontWeight: 500,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        ...buttonStyle,
      }}
    >
      {icon && <Send size={14} />}
      {label}
    </button>
  )

  return (
    <>
      {trigger}
      {open && contactEmail && (
        <TrackedEmailComposer
          contactId={contactId}
          defaultToEmail={contactEmail}
          contactName={contactName}
          source={source}
          onClose={() => setOpen(false)}
          onSent={() => {
            onSent?.()
          }}
        />
      )}
    </>
  )
}
