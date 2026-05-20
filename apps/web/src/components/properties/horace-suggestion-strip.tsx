'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Star, X } from 'lucide-react'

/**
 * HoraceSuggestionStrip — the v2 cream suggestion card above the
 * Properties list (HOR-247). Surfaces the workspace's hottest property
 * in Horace's voice with a "Worth watching?" nudge + Watch / Dismiss.
 *
 * Dismiss is durable two ways:
 *   - localStorage (`horace.suggestion.dismissed.<id>`) so the strip
 *     stays hidden on reload for this device immediately, and
 *   - a POST to /api/companion/dismiss (scope `property-suggestion:<id>`)
 *     so the dismissal is recorded per-agent for the digest + cross-device
 *     (server-side filtering of suggestions is a follow-up).
 *
 * Renders nothing when there's no candidate or the candidate is already
 * dismissed on this device.
 */

export interface PropertySuggestion {
  propertyId: string
  address: string
  /** Horace-voiced line, e.g. "47 Maple is heating up — three named visits this week." */
  line: string
}

interface Props {
  suggestion: PropertySuggestion | null
  /** Called when the agent clicks Watch (host sets status = 'watching'). */
  onWatch: (propertyId: string) => void
}

function dismissedKey(id: string) {
  return `horace.suggestion.dismissed.${id}`
}

export function HoraceSuggestionStrip({ suggestion, onWatch }: Props) {
  const [dismissed, setDismissed] = useState(false)

  // Hide on reload if previously dismissed on this device.
  useEffect(() => {
    if (!suggestion) return
    try {
      if (window.localStorage.getItem(dismissedKey(suggestion.propertyId)) === 'true') {
        setDismissed(true)
      }
    } catch {
      /* localStorage disabled — show the strip; dismiss still posts. */
    }
  }, [suggestion])

  if (!suggestion || dismissed) return null

  function handleDismiss() {
    if (!suggestion) return
    setDismissed(true)
    try {
      window.localStorage.setItem(dismissedKey(suggestion.propertyId), 'true')
    } catch {
      /* ignore */
    }
    void fetch('/api/companion/dismiss', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scope: `property-suggestion:${suggestion.propertyId}`,
        reason: 'properties-suggestion-dismiss',
      }),
    }).catch((err) => console.warn('[properties] suggestion dismiss failed:', err))
  }

  return (
    <div
      style={{
        marginBottom: 18,
        padding: '14px 18px',
        background: '#FAF7F2',
        border: '1px solid rgba(140,123,107,0.2)',
        borderRadius: 10,
        display: 'flex',
        gap: 14,
        alignItems: 'center',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: '#C4622D',
          flexShrink: 0,
        }}
      />
      <p
        className="font-display"
        style={{
          margin: 0,
          flex: 1,
          fontSize: 14,
          fontStyle: 'italic',
          lineHeight: 1.5,
          color: '#1A1612',
        }}
      >
        {suggestion.line}{' '}
        <Link
          href={`/properties/${suggestion.propertyId}`}
          style={{ color: '#A85220', textDecoration: 'none', fontStyle: 'normal', fontWeight: 500 }}
        >
          Worth watching?
        </Link>
      </p>
      <button
        type="button"
        onClick={() => onWatch(suggestion.propertyId)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '7px 12px',
          fontSize: 11.5,
          fontWeight: 500,
          background: '#FAF7F2',
          color: '#5E5246',
          border: '1px solid rgba(140,123,107,0.3)',
          borderRadius: 7,
          cursor: 'pointer',
          fontFamily: 'var(--font-body)',
        }}
      >
        <Star style={{ width: 12, height: 12 }} aria-hidden /> Watch
      </button>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss suggestion"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '7px 10px',
          fontSize: 11.5,
          background: 'transparent',
          border: 'none',
          color: '#8C7B6B',
          cursor: 'pointer',
          fontFamily: 'var(--font-body)',
        }}
      >
        <X style={{ width: 12, height: 12 }} aria-hidden />
      </button>
    </div>
  )
}
