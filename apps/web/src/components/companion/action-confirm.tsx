'use client'

import { DoorOpen, ListPlus, X } from 'lucide-react'
import type { CompanionAction } from '@/lib/companion/types'

/**
 * ActionConfirm — in-drawer confirmation card that appears under
 * Horace's bubble whenever a response carries an `action`. Pattern is
 * uniform across the four kinds: charcoal card, `Confirm` eyebrow, the
 * kind-specific summary, then a terracotta `Yes — do it` + outlined
 * `Not yet` button row.
 *
 * Heavy lifting (the actual API call) happens in CompanionMount on
 * confirm. This component is presentation + a callback.
 */

interface ActionConfirmProps {
  action: CompanionAction
  onConfirm: () => void
  onCancel: () => void
}

export function ActionConfirm({ action, onConfirm, onCancel }: ActionConfirmProps) {
  return (
    <div style={{ alignSelf: 'flex-start', maxWidth: '90%', marginLeft: 38 }}>
      <div
        style={{
          background: '#2E2823',
          color: '#F5F0E8',
          borderRadius: 10,
          padding: '14px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            className="label-uppercase"
            style={{ color: 'rgba(245,240,232,0.55)', fontSize: 9.5 }}
          >
            Confirm
          </span>
        </div>

        {action.kind === 'draft-email' && <DraftPreview action={action} />}

        {action.kind === 'add-to-list' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <ListPlus size={14} color="#E8956D" aria-hidden />
            <span style={{ fontSize: 13, color: '#F5F0E8' }}>
              Add <strong>{action.target}</strong> to{' '}
              <strong>{action.listName}</strong>.
            </span>
          </div>
        )}

        {action.kind === 'dismiss' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <X size={14} color="#E8956D" aria-hidden />
            <span style={{ fontSize: 13, color: '#F5F0E8' }}>
              Dismiss <strong>{action.target}</strong> from today&rsquo;s digest.
            </span>
          </div>
        )}

        {action.kind === 'create-inspection' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <DoorOpen size={14} color="#E8956D" aria-hidden />
              <span style={{ fontSize: 13, color: '#F5F0E8' }}>
                Schedule inspection — <strong>{action.target}</strong>, {action.when}.
              </span>
            </div>
            <div
              style={{
                background: 'rgba(245,240,232,0.06)',
                border: '1px solid rgba(245,240,232,0.14)',
                borderRadius: 8,
                padding: '8px 12px',
                fontSize: 11.5,
                color: 'rgba(245,240,232,0.78)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              QR token · gohorace.com/i/{action.token}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={onConfirm}
            style={{
              flex: 1,
              padding: '9px 12px',
              background: '#C4622D',
              color: '#FAF7F2',
              border: 'none',
              borderRadius: 7,
              fontSize: 12.5,
              fontWeight: 500,
              cursor: 'pointer',
              fontFamily: 'var(--font-body)',
            }}
          >
            Yes — do it
          </button>
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: '9px 14px',
              background: 'rgba(245,240,232,0.08)',
              color: 'rgba(245,240,232,0.7)',
              border: '1px solid rgba(245,240,232,0.18)',
              borderRadius: 7,
              fontSize: 12.5,
              fontWeight: 500,
              cursor: 'pointer',
              fontFamily: 'var(--font-body)',
            }}
          >
            Not yet
          </button>
        </div>
      </div>
    </div>
  )
}

function DraftPreview({ action }: { action: Extract<CompanionAction, { kind: 'draft-email' }> }) {
  return (
    <div>
      <div style={{ fontSize: 13, color: '#F5F0E8', marginBottom: 8 }}>
        Send to <strong>{action.target}</strong>:
      </div>
      <div
        style={{
          background: 'rgba(245,240,232,0.06)',
          border: '1px solid rgba(245,240,232,0.14)',
          borderRadius: 8,
          padding: '10px 12px',
          fontSize: 12.5,
          color: 'rgba(245,240,232,0.92)',
          lineHeight: 1.55,
          fontFamily: 'var(--font-body)',
        }}
      >
        <div
          style={{
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'rgba(245,240,232,0.55)',
            marginBottom: 6,
          }}
        >
          Subject: {action.subject}
        </div>
        {action.body}
      </div>
    </div>
  )
}
