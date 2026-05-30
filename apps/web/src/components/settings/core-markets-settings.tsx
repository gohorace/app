'use client'

/**
 * Settings → Core markets (HOR-196) client component.
 *
 * Lists current active markets with archive (×) buttons + an
 * "Add another" affordance that opens a modal with the reusable
 * SuburbPicker (HOR-194). Disables already-active localities in the
 * picker so an agent can't try to re-add one.
 */

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { MapPin, Plus, X, Loader2 } from 'lucide-react'
import { SuburbPicker, type SelectedLocality } from '@/components/core-markets/suburb-picker'
import { SectionHeading } from '@/components/ui/section-heading'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

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

// Map import_status to Badge variant + label (mirrors prototype statusBadge).
const STATUS_MAP: Record<
  NonNullable<CoreMarketRow['import_status']>,
  { variant: 'moss' | 'amber' | 'stone' | 'accent'; label: string }
> = {
  complete: { variant: 'moss',   label: 'Tracking'  },
  running:  { variant: 'amber',  label: 'Importing' },
  pending:  { variant: 'stone',  label: 'Queued'    },
  error:    { variant: 'accent', label: 'Error'     },
}

export function CoreMarketsSettings({ markets }: Props) {
  const router = useRouter()
  const [modalOpen, setModalOpen] = useState(false)
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
    <div className="p-4 md:p-8 space-y-5 max-w-[660px]">
      <SectionHeading
        title="Core markets"
        description="The suburbs you cover. Horace pulls every address inside them and tells you the moment a contact you know moves on one. Pick up to three."
      />

      {markets.length === 0 ? (
        <EmptyCard onAdd={() => setModalOpen(true)} />
      ) : (
        <div className="overflow-hidden rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 shadow-[var(--shadow-sm)]">
          {markets.map((m, i) => {
            const statusDef = m.import_status ? STATUS_MAP[m.import_status] : null
            return (
              <div
                key={m.id}
                className={[
                  'flex items-center gap-3 px-2.5 py-3',
                  archiving.has(m.id) ? 'opacity-55' : '',
                  i < markets.length - 1 ? 'border-b border-[var(--border-subtle)]' : '',
                ].join(' ')}
              >
                <MapPin className="size-4 shrink-0 text-[var(--color-terracotta)]" />
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-semibold text-[var(--fg-primary)]">
                    {m.locality_name}
                  </span>
                  <span className="ml-2 font-mono text-xs text-[var(--fg-secondary)]">
                    {m.state_abbrev}{m.postcode ? ` · ${m.postcode}` : ''}
                  </span>
                </div>
                {statusDef && (
                  <Badge variant={statusDef.variant} dot>{statusDef.label}</Badge>
                )}
                <button
                  type="button"
                  onClick={() => archive(m.id)}
                  disabled={archiving.has(m.id)}
                  aria-label={`Archive ${m.locality_name}`}
                  className="flex size-7 shrink-0 items-center justify-center rounded-md border border-[var(--border-subtle)] text-[var(--fg-tertiary)] transition-colors hover:text-[var(--fg-primary)] disabled:cursor-not-allowed"
                >
                  {archiving.has(m.id)
                    ? <Loader2 className="size-3.5 animate-spin" />
                    : <X className="size-3.5" />}
                </button>
              </div>
            )
          })}
        </div>
      )}

      <Button
        variant="secondary"
        onClick={() => setModalOpen(true)}
        disabled={atMax}
      >
        <Plus className="size-3.5" />
        {atMax ? `Maximum of ${MAX_ACTIVE} markets` : 'Add another market'}
      </Button>

      {archiveError && (
        <p className="text-xs text-[var(--color-terracotta)]">{archiveError}</p>
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

// ── Empty state ──────────────────────────────────────────────────────────────

function EmptyCard({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-7 text-center shadow-[var(--shadow-sm)]">
      <div className="mx-auto mb-3 flex size-11 items-center justify-center rounded-full bg-[rgba(196,98,45,0.1)]">
        <MapPin className="size-[22px] text-[var(--color-terracotta)]" />
      </div>
      <div className="mb-1.5 font-serif text-lg font-semibold text-[var(--fg-primary)]">
        No markets yet.
      </div>
      <p className="mx-auto mb-4 max-w-[360px] text-sm leading-relaxed text-[var(--fg-secondary)]">
        Tell Horace which suburbs you cover and it&rsquo;ll pull every address in them,
        ready to be matched against your contacts.
      </p>
      <Button onClick={onAdd}>
        <Plus className="size-3.5" />
        Pick suburbs
      </Button>
    </div>
  )
}

// ── Picker modal ─────────────────────────────────────────────────────────────

function PickerModal({
  existing,
  onClose,
  onSaved,
}: {
  existing: CoreMarketRow[]
  onClose:  () => void
  onSaved:  () => void
}) {
  const [selected, setSelected]     = useState<SelectedLocality[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]           = useState<string | null>(null)

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
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[rgba(26,22,18,0.45)] backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget && !submitting) onClose() }}
    >
      <div className="w-[min(520px,calc(100vw-32px))] rounded-xl bg-[var(--bg-surface)] p-7 shadow-[0_24px_64px_rgba(0,0,0,0.25)]">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2
              id="cm-settings-modal-title"
              className="font-serif text-xl font-semibold tracking-tight text-[var(--fg-primary)]"
            >
              {existing.length === 0 ? 'Pick your suburbs' : 'Add another suburb'}
            </h2>
            <p className="mt-1.5 text-sm text-[var(--fg-secondary)]">
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
            className="rounded-md p-1 text-[var(--fg-tertiary)] hover:text-[var(--fg-primary)] disabled:cursor-not-allowed"
          >
            <X className="size-[18px]" />
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
          <p className="mt-3 text-xs text-[var(--color-terracotta)]">{error}</p>
        )}

        <div className="mt-6 flex justify-end gap-2.5 border-t border-[var(--border-subtle)] pt-5">
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={selected.length === 0 || submitting}>
            {submitting
              ? 'Adding…'
              : selected.length > 1
                ? `Add ${selected.length} suburbs`
                : selected.length === 1
                  ? 'Add this suburb'
                  : 'Add suburbs'}
          </Button>
        </div>
      </div>
    </div>
  )
}
