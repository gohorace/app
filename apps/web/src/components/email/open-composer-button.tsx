'use client'

/**
 * Button that opens the tracked-email composer dock (HOR-361). Replaces the
 * old modal-based `SendTrackedEmailButton`. Thin wrapper over
 * `useComposerDock().openComposer` — the dock itself is a single global mount,
 * so this just fires the open with the right payload + per-surface `source`.
 */

import { Send } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'
import { useComposerDock } from './composer-dock-context'
import type { OpenComposerOptions } from '@/lib/email/composer-dock-types'

interface OpenComposerButtonProps {
  contactId: string
  recipient: string | null
  contactName?: string | null
  source: OpenComposerOptions['source']
  autoDraft?: boolean
  signalContext?: OpenComposerOptions['signalContext']
  buttonStyle?: CSSProperties
  label?: string
  icon?: boolean
  /** Render-prop alternative: receives onClick + disabled. */
  children?: (args: { onClick: () => void; disabled: boolean }) => ReactNode
}

export function OpenComposerButton({
  contactId,
  recipient,
  contactName,
  source,
  autoDraft = false,
  signalContext,
  buttonStyle,
  label = 'Email',
  icon = true,
  children,
}: OpenComposerButtonProps) {
  const { openComposer } = useComposerDock()
  const disabled = !recipient

  const onClick = () => {
    if (!recipient) return
    openComposer({ contactId, recipient, contactName, source, autoDraft, signalContext })
  }

  if (children) return <>{children({ onClick, disabled })}</>

  return (
    <button
      type="button"
      onClick={onClick}
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
}
