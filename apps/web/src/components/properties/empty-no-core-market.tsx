'use client'

/**
 * Properties screen empty state — "no core markets set" (HOR-195).
 *
 * Brief: "If agent has no core market set, Properties screen shows a
 * primary empty state (not a dismissible banner). Single CTA opens
 * the suburb picker. Disappears once at least one core market is set.
 * Returns if agent removes their last core market."
 *
 * Full-surface (replaces the whole properties grid), not a banner.
 * Visual parity with components/notifications/empty-state.tsx — same
 * parchment + Playfair pairing, same "Seize the moment" sign-off.
 *
 * The CTA opens an inline modal hosting <SuburbPicker min=1 max=3>.
 * On save, POSTs each selected locality to /api/core-markets and
 * calls router.refresh() so the page re-renders without the empty
 * state once any market lands.
 */

import { useCallback, useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { MapPin, X } from 'lucide-react'
import { SuburbPicker, type SelectedLocality } from '@/components/core-markets/suburb-picker'

export function EmptyNoCoreMarket() {
  const router = useRouter()
  const [modalOpen, setModalOpen] = useState(false)
  const [selected, setSelected]   = useState<SelectedLocality[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = useCallback(async () => {
    if (selected.length === 0 || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      for (const s of selected) {
        const res = await fetch('/api/core-markets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ locality_pid: s.locality_pid }),
        })
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          setError(body.error ?? `Couldn't add ${s.locality_name}. Try again?`)
          return
        }
      }
      setModalOpen(false)
      setSelected([])
      router.refresh()
    } catch {
      setError('Network error — please try again.')
    } finally {
      setSubmitting(false)
    }
  }, [selected, submitting, router])

  return (
    <>
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '96px 32px 120px',
          textAlign: 'center',
        }}
      >
        <Image
          src="/horace-parchment.png"
          alt=""
          width={72}
          height={72}
          style={{ borderRadius: '50%', marginBottom: 24, opacity: 0.95 }}
        />

        <div
          style={{
            fontFamily: "'Playfair Display', serif",
            fontSize: 28,
            fontWeight: 600,
            color: '#1A1612',
            letterSpacing: '-0.02em',
            marginBottom: 10,
          }}
        >
          Pick where you work.
        </div>

        <div
          style={{
            fontFamily: "'Playfair Display', serif",
            fontStyle: 'italic',
            fontSize: 16,
            color: '#5A4D40',
            lineHeight: 1.55,
            maxWidth: 380,
            marginBottom: 32,
          }}
        >
          Horace can&rsquo;t show you the patch until you tell it where it is.
          One to three suburbs is the right number.
        </div>

        <button
          type="button"
          onClick={() => setModalOpen(true)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '12px 22px',
            background: '#C4622D',
            color: '#FAF7F2',
            fontFamily: 'var(--font-body)',
            fontSize: 15,
            fontWeight: 500,
            border: '1px solid #C4622D',
            borderRadius: 8,
            cursor: 'pointer',
            boxShadow: '0 4px 12px rgba(196, 98, 45, 0.18)',
            transition: 'all 150ms ease-out',
          }}
        >
          <MapPin size={16} />
          Pick suburbs
        </button>

        <div
          style={{
            marginTop: 56,
            fontSize: 9,
            fontWeight: 600,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'rgba(140,123,107,0.6)',
          }}
        >
          Seize the moment &mdash; Horace
        </div>
      </div>

      {modalOpen && (
        <PickerModal
          selected={selected}
          onChange={setSelected}
          onClose={() => { setModalOpen(false); setSelected([]); setError(null) }}
          onSave={submit}
          submitting={submitting}
          error={error}
        />
      )}
    </>
  )
}

// ── Modal ────────────────────────────────────────────────────────────

function PickerModal({
  selected,
  onChange,
  onClose,
  onSave,
  submitting,
  error,
}: {
  selected:   SelectedLocality[]
  onChange:   (next: SelectedLocality[]) => void
  onClose:    () => void
  onSave:     () => void
  submitting: boolean
  error:      string | null
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="picker-modal-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(26, 22, 18, 0.45)',
        backdropFilter: 'blur(2px)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose()
      }}
    >
      <div
        style={{
          width: 'min(520px, calc(100vw - 32px))',
          background: '#FFFFFF',
          borderRadius: 14,
          boxShadow: '0 24px 64px rgba(0, 0, 0, 0.25)',
          padding: '28px 28px 24px',
          fontFamily: 'var(--font-body)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 16,
            marginBottom: 20,
          }}
        >
          <div>
            <h2
              id="picker-modal-title"
              style={{
                margin: 0,
                fontFamily: "'Playfair Display', serif",
                fontSize: 22,
                fontWeight: 600,
                color: '#1A1612',
                letterSpacing: '-0.01em',
              }}
            >
              Pick your suburbs
            </h2>
            <p style={{ margin: '6px 0 0', fontSize: 13, color: '#8C7B6B', lineHeight: 1.5 }}>
              One to three suburbs. You can change these any time in Settings.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: submitting ? 'not-allowed' : 'pointer',
              color: '#8C7B6B',
              padding: 4,
              borderRadius: 6,
            }}
          >
            <X size={18} />
          </button>
        </div>

        <SuburbPicker
          selected={selected}
          onChange={onChange}
          min={1}
          max={3}
          autoFocus
          placeholder="e.g. Paddington"
        />

        {error && (
          <p style={{ marginTop: 12, fontSize: 13, color: '#B91C1C' }}>{error}</p>
        )}

        <div
          style={{
            marginTop: 24,
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 10,
            paddingTop: 18,
            borderTop: '1px solid rgba(140,123,107,0.18)',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            style={{
              padding: '10px 16px',
              background: 'transparent',
              border: 'none',
              color: '#8C7B6B',
              fontSize: 14,
              fontFamily: 'var(--font-body)',
              cursor: submitting ? 'not-allowed' : 'pointer',
              borderRadius: 7,
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={selected.length === 0 || submitting}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '10px 18px',
              background: selected.length === 0 ? 'rgba(196, 98, 45, 0.45)' : '#C4622D',
              border: 'none',
              color: '#FAF7F2',
              fontSize: 14,
              fontWeight: 500,
              fontFamily: 'var(--font-body)',
              cursor: selected.length === 0 || submitting ? 'not-allowed' : 'pointer',
              borderRadius: 7,
            }}
          >
            {submitting
              ? 'Adding…'
              : selected.length > 1
                ? `Add ${selected.length} suburbs`
                : selected.length === 1 ? 'Add this suburb' : 'Add suburbs'}
          </button>
        </div>
      </div>
    </div>
  )
}
