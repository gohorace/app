'use client'

/**
 * OutreachReview — HOR-389 (P5)
 *
 * The agent's review surface for a nudge: three drafts (email / SMS / call
 * notes) grounded in matched site content. Email sends through Horace; SMS is
 * copy-to-clipboard (v1); call notes are agent-only. Each referenced item can
 * be swapped for an alternative, every draft is editable inline, and content
 * types can be muted globally.
 *
 * Functional v1 — no finalised design; tabbed layout per the epic recommendation.
 */

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/segmented'
import { Switch } from '@/components/ui/switch'
import { CopyButton } from '@/components/ui/copy-button'
import { EmptyState } from '@/components/ui/empty-state'

type ContentType = 'listing' | 'sold' | 'suburb_report'
interface Candidate {
  id: string
  content_type: ContentType
  source_url: string
  address: string | null
  title: string | null
  suburb: string | null
  price_text: string | null
  sold_price_text: string | null
}
interface Slot {
  role: string
  chosen: Candidate
  alternatives: Candidate[]
}
interface DraftsResponse {
  rule: string
  suburb: string | null
  email: { subject: string; body: string } | null
  sms: string | null
  call_notes: { spokenOpener: string; referenceContext: string }
  slots: Slot[]
  pretext_label: string
}

const TYPE_LABEL: Record<ContentType, string> = {
  listing: 'Listings',
  sold: 'Sold results',
  suburb_report: 'Suburb reports',
}

function describe(c: Candidate): string {
  const where = c.address ?? c.title ?? c.suburb ?? 'this property'
  if (c.content_type === 'sold') return `${where}${c.sold_price_text ? ` — sold ${c.sold_price_text}` : ''}`
  if (c.content_type === 'suburb_report') return c.title ?? `${c.suburb} report`
  return `${where}${c.price_text ? ` — ${c.price_text}` : ''}`
}

export function OutreachReview({ contactId }: { contactId: string }) {
  const [data, setData] = useState<DraftsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'email' | 'sms' | 'call'>('email')

  const [subject, setSubject] = useState('')
  const [bodyText, setBodyText] = useState('')
  const [smsText, setSmsText] = useState('')
  const [featured, setFeatured] = useState<Record<number, Candidate>>({})
  const [muted, setMuted] = useState<Set<ContentType>>(new Set())
  const [sendState, setSendState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [draftsRes, mutesRes] = await Promise.all([
        fetch('/api/outreach/drafts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contact_id: contactId }) }),
        fetch('/api/outreach/mutes'),
      ])
      if (!draftsRes.ok) throw new Error(`drafts ${draftsRes.status}`)
      const d = (await draftsRes.json()) as DraftsResponse
      setData(d)
      setSubject(d.email?.subject ?? '')
      setBodyText(d.email?.body ?? '')
      setSmsText(d.sms ?? '')
      setFeatured(Object.fromEntries(d.slots.map((s, i) => [i, s.chosen])))
      if (mutesRes.ok) {
        const m = (await mutesRes.json()) as { muted: ContentType[] }
        setMuted(new Set(m.muted))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load drafts')
    } finally {
      setLoading(false)
    }
  }, [contactId])

  useEffect(() => {
    void load()
  }, [load])

  const toggleMute = async (type: ContentType, next: boolean) => {
    setMuted((prev) => {
      const s = new Set(prev)
      if (next) s.add(type)
      else s.delete(type)
      return s
    })
    await fetch('/api/outreach/mutes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content_type: type, muted: next }) })
    // Re-run matching with the new mute applied.
    await load()
  }

  const sendEmail = async () => {
    setSendState('sending')
    const bodyHtml = bodyText.split('\n').map((l) => (l.trim() ? `<p>${escapeHtml(l)}</p>` : '<br/>')).join('')
    const res = await fetch('/api/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contact_id: contactId, subject, body_html: bodyHtml }),
    })
    setSendState(res.ok ? 'sent' : 'error')
  }

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Drafting…</div>
  if (error) return <div className="p-6 text-sm text-red-600">Couldn’t load drafts — {error}. <button className="underline" onClick={() => void load()}>Retry</button></div>
  if (!data) return null

  const hasContent = data.slots.length > 0

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <header className="space-y-1">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">Reasoned from {data.pretext_label}</div>
        <Segmented
          value={tab}
          onValueChange={(v) => setTab(v as typeof tab)}
          options={[{ value: 'email', label: 'Email' }, { value: 'sms', label: 'SMS' }, { value: 'call', label: 'Call notes' }]}
        />
      </header>

      {/* Featured content + swap */}
      {hasContent ? (
        <div className="space-y-2 rounded-md border border-border p-3">
          <div className="text-xs font-medium text-muted-foreground">Referencing your content</div>
          {data.slots.map((slot, i) => (
            <SlotRow key={i} slot={slot} featured={featured[i] ?? slot.chosen} onSwap={(c) => setFeatured((f) => ({ ...f, [i]: c }))} />
          ))}
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
          No fresh matching content for {data.suburb ?? 'this contact'} — drafts lead with the pretext only (nothing unrelated inserted).
        </div>
      )}

      {/* Tab bodies */}
      {tab === 'email' && (
        data.email ? (
          <div className="space-y-2">
            <input className="w-full rounded-md border border-border px-3 py-2 text-sm" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" />
            <textarea className="min-h-[180px] w-full rounded-md border border-border px-3 py-2 text-sm font-[inherit]" value={bodyText} onChange={(e) => setBodyText(e.target.value)} />
            <div className="flex items-center gap-2">
              <Button onClick={() => void sendEmail()} disabled={sendState === 'sending' || sendState === 'sent'}>
                {sendState === 'sent' ? 'Sent ✓' : sendState === 'sending' ? 'Sending…' : 'Send email'}
              </Button>
              {sendState === 'error' && <span className="text-sm text-red-600">Send failed — try again.</span>}
            </div>
          </div>
        ) : (
          <EmptyState quote="Horace couldn’t draft a clean email for this one. The call notes below still have the context." />
        )
      )}

      {tab === 'sms' && (
        data.sms ? (
          <div className="space-y-2">
            <textarea className="min-h-[90px] w-full rounded-md border border-border px-3 py-2 text-sm" value={smsText} onChange={(e) => setSmsText(e.target.value)} />
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{smsText.length} chars</span>
              <CopyButton text={smsText} />
            </div>
          </div>
        ) : (
          <EmptyState quote="No SMS draft — there was no fresh link to share." />
        )
      )}

      {tab === 'call' && (
        <div className="space-y-3">
          <div>
            <div className="mb-1 text-xs font-medium text-muted-foreground">Spoken opener</div>
            <div className="rounded-md border border-border p-3 text-sm">{data.call_notes.spokenOpener || '—'}</div>
          </div>
          <div>
            <div className="mb-1 text-xs font-medium text-muted-foreground">Your context — never say this to the lead</div>
            <pre className="whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-3 text-sm">{data.call_notes.referenceContext}</pre>
          </div>
        </div>
      )}

      {/* Mutes */}
      <div className="space-y-2 rounded-md border border-border p-3">
        <div className="text-xs font-medium text-muted-foreground">Never insert</div>
        {(Object.keys(TYPE_LABEL) as ContentType[]).map((t) => (
          <label key={t} className="flex items-center justify-between text-sm">
            <span>{TYPE_LABEL[t]}</span>
            <Switch checked={muted.has(t)} onCheckedChange={(v: boolean) => void toggleMute(t, v)} />
          </label>
        ))}
      </div>
    </div>
  )
}

function SlotRow({ slot, featured, onSwap }: { slot: Slot; featured: Candidate; onSwap: (c: Candidate) => void }) {
  const [open, setOpen] = useState(false)
  const others = [slot.chosen, ...slot.alternatives].filter((c) => c.id !== featured.id)
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <a href={featured.source_url} target="_blank" rel="noreferrer" className="truncate text-sm text-primary underline">{describe(featured)}</a>
        {others.length > 0 && (
          <button className="shrink-0 text-xs text-muted-foreground underline" onClick={() => setOpen((o) => !o)}>{open ? 'Close' : 'Swap'}</button>
        )}
      </div>
      {open && (
        <div className="space-y-1 rounded-md bg-muted/30 p-2">
          {others.map((c) => (
            <button key={c.id} className="block w-full truncate text-left text-xs text-foreground hover:underline" onClick={() => { onSwap(c); setOpen(false) }}>{describe(c)}</button>
          ))}
        </div>
      )}
    </div>
  )
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
