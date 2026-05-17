'use client'

/**
 * Settings → Core markets (HOR-196) client component.
 *
 * Lists current active markets with archive (×) buttons + an
 * "Add another" affordance that opens a modal with the reusable
 * SuburbPicker (HOR-194). Disables already-active localities in the
 * picker so an agent can't try to re-add one.
 *
 * UI parity with tracked-links-settings.tsx — same outer container,
 * "Settings" back link, h1 + body sub, cream-card sections. The list
 * items use the parchment palette established in suburb-picker chips.
 */

import { useCallback, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, MapPin, Plus, X, Check, AlertCircle, Loader2 } from 'lucide-react'
import { SuburbPicker, type SelectedLocality } from '@/components/core-markets/suburb-picker'

export interface CoreMarketRow {
  id:            string
  locality_pid:  string
  locality_name: string
  state_abbrev:  string
  postcode:      string | null
  created_at:    string
  /** Latest import status — null when no import has been enqueued yet. */
  import_status: 'pending' | 'running' | 'complete' | 'error' | null
}

interface Props {
  markets: CoreMarketRow[]
}

const MAX_ACTIVE = 3

export function CoreMarketsSettings({ markets }: Props) {
  const router = useRouter()
  const [modalOpen, setModalOpen] = useState(false)
  // Track in-flight archives so the × button can show a spinner per row.
  const [archiving, setArchiving] = useState<Set<string>>(new Set())
  const [archiveError, setArchiveError] = useState<string | null>(null)

  const atMax = markets.length >= MAX_ACTIVE

  const archive = useCallback(async (id: string) => {
    if (archiving.has(id)) return
    setArchiveError(null)
    setArchiving((prev) => new Set(prev).add(id))
    try {
      const res = await fetch(`/api/core-markets/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setArchiveError(body.error ?? 'Could not archive this market.')
        return
      }
      router.refresh()
    } catch {
      setArchiveError('Network error — try again.')
    } finally {
      setArchiving((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }, [archiving, router])

  return (
    <div className="p-4 md:p-8 space-y-5 max-w-2xl">
      <Link
        href="/settings"
        className="inline-flex items-center gap-1.5 text-sm font-medium"
        style={{ color: '#8C7B6B' }}
      >
        <ArrowLeft className="w-4 h-4" />
        Settings
      </Link>

      <div>
        <h1 className="font-display font-semibold tracking-tight" style={{ fontSize: '24px', color: '#1A1612' }}>
          Core markets
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          The suburbs you cover. Horace pulls every address inside them and
          tells you the moment a contact you know moves on one. Pick up to
          three.
        </p>
      </div>

      {markets.length === 0 ? (
        <EmptyCard onAdd={() => setModalOpen(true)} />
      ) : (
        <div
          style={{
            background: '#FAF7F2',
            border: '1px solid rgba(140,123,107,0.2)',
            borderRadius: 12,
            padding: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          {markets.map((m) => (
            <MarketRow
              key={m.id}
              market={m}
              isArchiving={archiving.has(m.id)}
              onArchive={() => archive(m.id)}
            />
          ))}

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              disabled={atMax}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 14px',
                borderRadius: 8,
                background: atMax ? 'rgba(196,98,45,0.45)' : '#C4622D',
                color: '#FAF7F2',
                fontFamily: 'var(--font-body)',
                fontSize: 13,
                fontWeight: 500,
                border: 'none',
                cursor: atMax ? 'not-allowed' : 'pointer',
              }}
              title={atMax ? `Maximum ${MAX_ACTIVE} markets — archive one to add another` : undefined}
            >
              <Plus size={14} />
              Add another
            </button>
          </div>
        </div>
      )}

      {archiveError && (
        <p style={{ color: '#B91C1C', fontSize: 13 }}>{archiveError}</p>
      )}

      {modalOpen && (
        <PickerModal
          existing={markets}
          onClose={() => setModalOpen(false)}
          onSaved={() => {
            setModalOpen(false)
            router.refresh()
          }}
        />
      )}
    </div>
  )
}

// ── Single market row ────────────────────────────────────────────────

function MarketRow({
  market,
  isArchiving,
  onArchive,
}: {
  market: CoreMarketRow
  isArchiving: boolean
  onArchive: () => void
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 14px',
        background: '#FFFFFF',
        border: '1px solid rgba(140,123,107,0.18)',
        borderRadius: 10,
        opacity: isArchiving ? 0.55 : 1,
        transition: 'opacity 120ms ease-out',
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          background: 'rgba(196,98,45,0.1)',
          color: '#C4622D',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <MapPin size={16} />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 15,
            fontWeight: 600,
            color: '#1A1612',
          }}
        >
          {market.locality_name}, {market.state_abbrev}
          {market.postcode && (
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                color: '#8C7B6B',
                marginLeft: 6,
                fontWeight: 400,
              }}
            >
              {market.postcode}
            </span>
          )}
        </div>
        <ImportStatusPill status={market.import_status} />
      </div>

      <button
        type="button"
        onClick={onArchive}
        disabled={isArchiving}
        aria-label={`Archive ${market.locality_name}`}
        style={{
          background: 'transparent',
          border: '1px solid rgba(140,123,107,0.22)',
          borderRadius: 6,
          padding: 6,
          cursor: isArchiving ? 'not-allowed' : 'pointer',
          color: '#8C7B6B',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {isArchiving ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
      </button>
    </div>
  )
}

function ImportStatusPill({ status }: { status: CoreMarketRow['import_status'] }) {
  if (status === null) {
    return null
  }
  const config: Record<NonNullable<CoreMarketRow['import_status']>, { label: string; color: string; bg: string; Icon: typeof Check }> = {
    pending:  { label: 'Queued',     color: '#8C7B6B', bg: 'rgba(140,123,107,0.12)', Icon: Loader2 },
    running:  { label: 'Importing…', color: '#C4622D', bg: 'rgba(196,98,45,0.10)',  Icon: Loader2 },
    complete: { label: 'Ready',      color: '#3D5246', bg: 'rgba(61,82,70,0.14)',    Icon: Check },
    error:    { label: 'Error',      color: '#B91C1C', bg: 'rgba(185,28,28,0.10)',   Icon: AlertCircle },
  }
  const c = config[status]
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        marginTop: 4,
        padding: '2px 8px',
        background: c.bg,
        color: c.color,
        borderRadius: 999,
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
      }}
    >
      <c.Icon size={10} className={status === 'pending' || status === 'running' ? 'animate-spin' : ''} />
      {c.label}
    </span>
  )
}

// ── Empty state card (rendered when zero active markets) ─────────────

function EmptyCard({ onAdd }: { onAdd: () => void }) {
  return (
    <div
      style={{
        background: '#FAF7F2',
        border: '1px solid rgba(140,123,107,0.2)',
        borderRadius: 12,
        padding: 28,
        textAlign: 'center',
      }}
    >
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: 12,
          background: 'rgba(196,98,45,0.1)',
          color: '#C4622D',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 12,
        }}
      >
        <MapPin size={22} />
      </div>
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 17,
          fontWeight: 600,
          color: '#1A1612',
          marginBottom: 6,
        }}
      >
        No markets yet.
      </div>
      <div
        style={{
          fontSize: 13,
          color: '#8C7B6B',
          maxWidth: 360,
          margin: '0 auto 16px',
          lineHeight: 1.5,
        }}
      >
        Tell Horace which suburbs you cover and it&rsquo;ll pull every address
        in them, ready to be matched against your contacts.
      </div>
      <button
        type="button"
        onClick={onAdd}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '10px 18px',
          background: '#C4622D',
          color: '#FAF7F2',
          fontFamily: 'var(--font-body)',
          fontSize: 14,
          fontWeight: 500,
          border: 'none',
          borderRadius: 8,
          cursor: 'pointer',
        }}
      >
        <Plus size={14} />
        Pick suburbs
      </button>
    </div>
  )
}

// ── Picker modal ─────────────────────────────────────────────────────

function PickerModal({
  existing,
  onClose,
  onSaved,
}: {
  existing: CoreMarketRow[]
  onClose:  () => void
  onSaved:  () => void
}) {
  const [selected, setSelected]       = useState<SelectedLocality[]>([])
  const [submitting, setSubmitting]   = useState(false)
  const [error, setError]             = useState<string | null>(null)

  // Cap remaining slots so the picker never lets the agent overshoot
  // the 3-active limit.
  const remaining = Math.max(0, MAX_ACTIVE - existing.length)
  const disabledLocalityPids = existing.map((m) => m.locality_pid)

  const submit = async () => {
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
      onSaved()
    } catch {
      setError('Network error — please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cm-settings-modal-title"
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
              id="cm-settings-modal-title"
              style={{
                margin: 0,
                fontFamily: 'var(--font-display)',
                fontSize: 20,
                fontWeight: 600,
                color: '#1A1612',
                letterSpacing: '-0.01em',
              }}
            >
              {existing.length === 0 ? 'Pick your suburbs' : 'Add another suburb'}
            </h2>
            <p style={{ margin: '6px 0 0', fontSize: 13, color: '#8C7B6B', lineHeight: 1.5 }}>
              {remaining === MAX_ACTIVE
                ? 'One to three suburbs.'
                : `${remaining} more ${remaining === 1 ? 'slot' : 'slots'} available.`}
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
          onChange={setSelected}
          min={1}
          max={remaining}
          disabledLocalityPids={disabledLocalityPids}
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
            onClick={submit}
            disabled={selected.length === 0 || submitting}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '10px 18px',
              background: selected.length === 0 ? 'rgba(196,98,45,0.45)' : '#C4622D',
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
