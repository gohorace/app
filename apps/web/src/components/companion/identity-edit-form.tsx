'use client'

/**
 * IdentityEditForm — the structured "Edit details" light form (HOR-246
 * amendment, Phase 2a). Rendered inside the Companion drawer as the decided
 * edit surface for *agent-supplied* identity. Faithful port of the prototype
 * `IdentityEditForm` (design_handoff_contact_v2/companion.jsx).
 *
 * Provenance contract: Display name / Phone / Suburb are agent-supplied and
 * editable; the observed Email is shown locked (never editable). Save writes
 * only the changed agent-supplied fields via PATCH /api/contacts/[id] —
 * email is never sent. Phase 2b adds the spoken/NLU writer; the "tell Horace
 * in your own words" affordance is intentionally inert here.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Lock, MessageSquare, ArrowRight, User, Phone, Anchor } from 'lucide-react'
import type { EditIdentityContext } from '@/lib/companion/types'

const TERRA = '#C4622D'
const STONE = '#8C7B6B'
const BORDER = 'rgba(140,123,107,0.2)'
const BORDER_SOFT = 'rgba(140,123,107,0.14)'

/** Split a single display-name field into first/last on the first space. */
export function splitDisplayName(input: string): { first_name: string | null; last_name: string | null } {
  const trimmed = input.trim()
  if (!trimmed) return { first_name: null, last_name: null }
  const i = trimmed.indexOf(' ')
  if (i === -1) return { first_name: trimmed, last_name: null }
  return { first_name: trimmed.slice(0, i), last_name: trimmed.slice(i + 1).trim() || null }
}

export interface IdentityEditFormProps {
  context: EditIdentityContext
  onSaved: (ack: { text: string; ok: boolean }) => void
  onCancel: () => void
  /** Phase 2b: drop into the conversation so the agent can speak the edit. */
  onSpoken?: () => void
}

export function IdentityEditForm({ context, onSaved, onCancel, onSpoken }: IdentityEditFormProps) {
  const router = useRouter()
  const [displayName, setDisplayName] = useState(context.displayName ?? '')
  const [phone, setPhone] = useState(context.phone ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    if (saving) return
    setError(null)

    const body: Record<string, unknown> = {}
    // Display name → first_name / last_name (only when changed).
    if (displayName.trim() !== (context.displayName ?? '').trim()) {
      Object.assign(body, splitDisplayName(displayName))
    }
    // Phone (only when changed).
    if (phone.trim() !== (context.phone ?? '').trim()) {
      body.phone = phone.trim() || null
    }

    if (Object.keys(body).length === 0) {
      onCancel()
      return
    }

    setSaving(true)
    try {
      const res = await fetch(`/api/contacts/${context.contactId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        setSaving(false)
        setError('That didn’t save — try again in a moment.')
        return
      }
      router.refresh()
      onSaved({ text: 'Details updated — agent-supplied', ok: true })
    } catch {
      setSaving(false)
      setError('That didn’t save — try again in a moment.')
    }
  }

  return (
    <div
      style={{
        alignSelf: 'stretch',
        background: '#FFFFFF',
        border: `1px solid ${BORDER}`,
        borderRadius: 12,
        padding: '15px 16px',
        boxShadow: '0 1px 3px rgba(26,22,18,0.06)',
      }}
    >
      <div
        style={{
          fontSize: 10.5,
          fontWeight: 600,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: TERRA,
          marginBottom: 12,
        }}
      >
        Edit details
      </div>

      <TextField
        label="Display name"
        Icon={User}
        value={displayName}
        onChange={setDisplayName}
        placeholder="Name this contact"
        focused={context.focusField === 'name'}
        autoFocus={context.focusField === 'name'}
      />
      <TextField
        label="Phone"
        Icon={Phone}
        value={phone}
        onChange={setPhone}
        placeholder="Add a phone"
        inputMode="tel"
        focused={context.focusField === 'phone'}
        autoFocus={context.focusField === 'phone'}
      />

      {/* Locked observed fact — visible, never editable */}
      {context.email && (
        <div style={{ marginTop: 14, paddingTop: 13, borderTop: `1px solid ${BORDER_SOFT}` }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 10.5,
              fontWeight: 600,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: STONE,
              marginBottom: 5,
            }}
          >
            <Lock style={{ width: 11, height: 11 }} /> Email · observed
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '9px 11px',
              background: 'rgba(140,123,107,0.07)',
              border: `1px solid ${BORDER_SOFT}`,
              borderRadius: 8,
              cursor: 'not-allowed',
            }}
          >
            <span style={{ flex: 1, fontSize: 13.5, color: '#5E5246', wordBreak: 'break-all' }}>
              {context.email}
            </span>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 10.5,
                color: STONE,
                fontStyle: 'italic',
                whiteSpace: 'nowrap',
              }}
            >
              <Lock style={{ width: 10, height: 10 }} /> {context.seenLabel}
            </span>
          </div>
        </div>
      )}

      <p
        style={{
          margin: '12px 0 13px',
          fontSize: 11.5,
          color: STONE,
          lineHeight: 1.5,
          display: 'flex',
          gap: 6,
        }}
      >
        <Anchor style={{ width: 13, height: 13, flexShrink: 0, marginTop: 1 }} />
        Observed facts stay locked — they’re how Horace recognised them. Changes save to your annotations only.
      </p>

      {error && (
        <p style={{ margin: '0 0 10px', fontSize: 12, color: '#9C4A1F' }}>{error}</p>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          style={{
            flex: 1,
            padding: '10px 12px',
            background: TERRA,
            color: '#FAF7F2',
            border: 'none',
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            fontFamily: 'var(--font-body)',
            cursor: saving ? 'default' : 'pointer',
            opacity: saving ? 0.7 : 1,
          }}
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          style={{
            padding: '10px 15px',
            background: 'transparent',
            color: STONE,
            border: `1px solid ${BORDER}`,
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 500,
            fontFamily: 'var(--font-body)',
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
      </div>

      {/* Phase 2b: drop into the conversation to speak the edit. */}
      {onSpoken && (
        <button
          type="button"
          onClick={onSpoken}
          disabled={saving}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            width: '100%',
            marginTop: 10,
            background: 'transparent',
            border: 'none',
            color: STONE,
            fontSize: 12,
            fontFamily: 'var(--font-body)',
            cursor: 'pointer',
          }}
        >
          <MessageSquare style={{ width: 13, height: 13 }} /> Or just tell Horace in your own words
          <ArrowRight style={{ width: 12, height: 12 }} />
        </button>
      )}
    </div>
  )
}

// ── Field atoms ──────────────────────────────────────────────────────────────

function FieldLabel({ Icon, label }: { Icon: typeof User; label: string }) {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 10.5,
        fontWeight: 600,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: STONE,
        marginBottom: 5,
      }}
    >
      <Icon style={{ width: 11, height: 11 }} /> {label}
      <span
        style={{
          fontWeight: 500,
          letterSpacing: 0,
          textTransform: 'none',
          color: 'rgba(140,123,107,0.8)',
        }}
      >
        · agent-supplied
      </span>
    </label>
  )
}

function TextField({
  label,
  Icon,
  value,
  onChange,
  placeholder,
  focused,
  autoFocus,
  inputMode,
}: {
  label: string
  Icon: typeof User
  value: string
  onChange: (v: string) => void
  placeholder: string
  focused?: boolean
  autoFocus?: boolean
  inputMode?: 'tel' | 'text'
}) {
  return (
    <div style={{ marginBottom: 10 }}>
      <FieldLabel Icon={Icon} label={label} />
      <input
        type="text"
        inputMode={inputMode}
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: '100%',
          padding: '9px 11px',
          background: '#FFFFFF',
          border: `${focused ? 2 : 1}px solid ${focused ? TERRA : BORDER}`,
          borderRadius: 8,
          fontSize: 13.5,
          color: '#1A1612',
          fontFamily: 'var(--font-body)',
          outline: 'none',
        }}
      />
    </div>
  )
}
