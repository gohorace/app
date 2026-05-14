'use client'

/**
 * HOR-148 — Doorstep inspections create form.
 *
 * Client component rendered inside `/inspections/new`. Three fields:
 *   - Property (required, via the shared AddressAutocomplete; resolves
 *     through `resolve_residence_property` on submit)
 *   - Scheduled at (required, native datetime-local)
 *   - Window end (optional, native datetime-local)
 *
 * Submit posts to `/api/inspections`. On success we send the agent back
 * to `/inspections` — the detail page lands in HOR-150, at which point
 * we'll redirect to `/inspections/[id]` instead.
 *
 * v1 hard-codes `inspection_type='open_home'` server-side; this form has
 * no UI selector for it. When private inspections ship (v2) a toggle
 * lands here.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AddressAutocomplete } from '@/components/address/address-autocomplete'
import type { SelectedAddress } from '@/components/address/types'

const cardStyle: React.CSSProperties = {
  background: '#FAF7F2',
  border: '1px solid rgba(140,123,107,0.2)',
  borderRadius: 10,
  padding: 24,
  maxWidth: 560,
}

const fieldLabelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 500,
  color: '#5E5246',
  marginBottom: 6,
}

const fieldHintStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#8C7B6B',
  marginTop: 4,
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  fontSize: 14,
  background: '#FFFFFF',
  border: '1px solid rgba(140,123,107,0.25)',
  borderRadius: 6,
  color: '#3D332B',
  fontFamily: 'inherit',
}

const submitStyle: React.CSSProperties = {
  padding: '10px 18px',
  fontSize: 13,
  fontWeight: 500,
  background: '#C4622D',
  color: '#FFFFFF',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
}

const submitDisabledStyle: React.CSSProperties = {
  ...submitStyle,
  background: 'rgba(196,98,45,0.4)',
  cursor: 'not-allowed',
}

const errorStyle: React.CSSProperties = {
  marginTop: 12,
  padding: '8px 10px',
  background: 'rgba(196,98,45,0.08)',
  border: '1px solid rgba(196,98,45,0.25)',
  borderRadius: 6,
  fontSize: 12,
  color: '#9C4A1F',
}

export function InspectionsCreateForm() {
  const router = useRouter()
  const [residence, setResidence] = useState<SelectedAddress | null>(null)
  const [scheduledAt, setScheduledAt] = useState('')
  const [windowEndAt, setWindowEndAt] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function hasAddress(a: SelectedAddress | null): boolean {
    if (!a) return false
    return Boolean(
      a.google_place_id ||
        a.street_number ||
        a.street_name ||
        a.suburb ||
        a.postcode ||
        a.formatted,
    )
  }

  const canSubmit = hasAddress(residence) && Boolean(scheduledAt) && !saving

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return

    setSaving(true)
    setError(null)

    try {
      const res = await fetch('/api/inspections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          residence,
          scheduled_at: scheduledAt,
          window_end_at: windowEndAt || null,
        }),
      })

      const data = (await res.json()) as { id?: string; error?: string }
      if (!res.ok) {
        setError(data?.error ?? 'Could not save the open home')
        setSaving(false)
        return
      }

      // Land on the detail page so the agent can show the QR
      // immediately — that's the common next step at the open home.
      router.refresh()
      router.push(data.id ? `/inspections/${data.id}` : '/inspections')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} style={cardStyle}>
      <div style={{ marginBottom: 18 }}>
        <AddressAutocomplete
          label="Property address"
          defaultValue={residence}
          onChange={setResidence}
        />
        <div style={fieldHintStyle}>
          New addresses join your Properties list automatically. Existing ones reuse the row.
        </div>
      </div>

      <div style={{ marginBottom: 18 }}>
        <label style={fieldLabelStyle} htmlFor="scheduled_at">
          When does it start?
        </label>
        <input
          id="scheduled_at"
          type="datetime-local"
          required
          value={scheduledAt}
          onChange={(e) => setScheduledAt(e.target.value)}
          style={inputStyle}
        />
      </div>

      <div style={{ marginBottom: 24 }}>
        <label style={fieldLabelStyle} htmlFor="window_end_at">
          When does it end? <span style={{ color: '#8C7B6B', fontWeight: 400 }}>(optional)</span>
        </label>
        <input
          id="window_end_at"
          type="datetime-local"
          value={windowEndAt}
          onChange={(e) => setWindowEndAt(e.target.value)}
          style={inputStyle}
        />
        <div style={fieldHintStyle}>
          Lets the next-morning briefing scope its summary to people who actually attended.
        </div>
      </div>

      <button
        type="submit"
        disabled={!canSubmit}
        style={canSubmit ? submitStyle : submitDisabledStyle}
      >
        {saving ? 'Saving…' : 'Create open home'}
      </button>

      {error && (
        <p role="alert" style={errorStyle}>
          {error}
        </p>
      )}
    </form>
  )
}
