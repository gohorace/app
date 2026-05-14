'use client'

/**
 * HOR-148 — Doorstep inspections create form.
 *
 * Client component rendered inside `/inspections/new`. Three inputs:
 *   - Property (required, via the shared AddressAutocomplete; resolves
 *     through `resolve_residence_property` on submit)
 *   - Start (required, native datetime-local)
 *   - Duration (required, 15 / 30 / 60 min — server-side window_end_at)
 *
 * Submit posts to `/api/inspections`. On success the agent lands on
 * `/inspections/[id]` (the detail page with the QR) so they can show
 * it immediately.
 *
 * v1 hard-codes `inspection_type='open_home'` server-side; this form
 * has no UI selector for it. A toggle lands here when private
 * inspections ship in v2.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AddressAutocomplete } from '@/components/address/address-autocomplete'
import type { SelectedAddress } from '@/components/address/types'

type Duration = 15 | 30 | 60

const DURATIONS: { value: Duration; label: string }[] = [
  { value: 15, label: '15 min' },
  { value: 30, label: '30 min' },
  { value: 60, label: '60 min' },
]

const DEFAULT_DURATION: Duration = 30

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

const durationChipBase: React.CSSProperties = {
  flex: 1,
  padding: '10px 6px',
  fontSize: 13,
  fontWeight: 500,
  background: '#FFFFFF',
  border: '1px solid rgba(140,123,107,0.25)',
  borderRadius: 6,
  cursor: 'pointer',
  fontFamily: 'inherit',
  color: '#3D332B',
}

const durationChipActive: React.CSSProperties = {
  ...durationChipBase,
  background: 'rgba(196,98,45,0.12)',
  borderColor: '#C4622D',
  color: '#9C4A1F',
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
  const [durationMinutes, setDurationMinutes] = useState<Duration>(DEFAULT_DURATION)
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
          duration_minutes: durationMinutes,
        }),
      })

      const data = (await res.json()) as { id?: string; error?: string }
      if (!res.ok) {
        setError(data?.error ?? 'Could not save the inspection')
        setSaving(false)
        return
      }

      // Land on the detail page so the agent can show the QR
      // immediately — that's the common next step at the inspection.
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
        <span style={fieldLabelStyle}>How long does it run?</span>
        <div style={{ display: 'flex', gap: 8 }} role="radiogroup" aria-label="Inspection duration">
          {DURATIONS.map((d) => {
            const isActive = durationMinutes === d.value
            return (
              <button
                key={d.value}
                type="button"
                role="radio"
                aria-checked={isActive}
                onClick={() => setDurationMinutes(d.value)}
                style={isActive ? durationChipActive : durationChipBase}
              >
                {d.label}
              </button>
            )
          })}
        </div>
      </div>

      <button
        type="submit"
        disabled={!canSubmit}
        style={canSubmit ? submitStyle : submitDisabledStyle}
      >
        {saving ? 'Saving…' : 'Create inspection'}
      </button>

      {error && (
        <p role="alert" style={errorStyle}>
          {error}
        </p>
      )}
    </form>
  )
}
