'use client'

/**
 * ComposerDock — the modeless tracked-email composer dock (HOR-354).
 *
 * A 420px panel that floats bottom-right over the Stream. Governing principle:
 * the email is the AGENT's, so the chrome is the agent's light compose surface
 * and Horace appears only as the assist control, the draft tag, and helper
 * microcopy (ember accent + the bear mark — never terracotta, which is the
 * Send CTA's colour).
 *
 * Owns its own assist state machine:
 *   empty → drafting → drafted → edited → sending
 * plus failed-draft, failed-send, setup. Opened from the global mount with an
 * `OpenComposerOptions` payload; Companion opens with autoDraft=true.
 *
 * Includes two detachable layers from the handoff:
 *   • GuardrailBand (#3 / HOR-359) — recipient compliance, above the footer.
 *   • ScheduleLayer (#6 / HOR-360) — Send split-button → menu → popover →
 *     scheduled pinned bar, on the HOR-357 backend.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import {
  Mail,
  MessageSquare,
  Phone,
  Send,
  Clock,
  ChevronDown,
  ChevronRight,
  X,
  Eye,
  Lock,
  ArrowUp,
  Info,
  Repeat,
  Home,
  TrendingUp,
  FileText,
  Check,
  Copy,
} from 'lucide-react'

import type {
  ComposerChannel,
  ComposerGuardrail,
  ComposerScenario,
  OpenComposerOptions,
} from '@/lib/email/composer-dock-types'
import type {
  ContentSource,
  ContentSourceType,
  EmailSendErrorBody,
  EmailSendResult,
} from '@/lib/email/types'

const HEAD_BG = '#EFE7D9'
const DANGER = '#A5511E'
const WARN = '#8A6A00'

/** SSR-safe < 768px detection — below this the dock becomes a bottom sheet. */
export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const update = () => setMobile(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])
  return mobile
}

export interface ComposerDockProps {
  payload: OpenComposerOptions
  onClose: () => void
  /** Pixels to offset the dock from the right edge (Companion clearance + stack — HOR-361). */
  rightOffset?: number
  /** Bumped by the provider when a second open re-targets this dock — expands it. */
  focusNonce?: number
}

interface DraftResponse {
  subject?: string
  body?: string
  setup_required?: boolean
  missing?: string[]
}

interface RecipientCheck {
  excluded: boolean
  reason: string | null
}

// ── Horace avatar (the bear mark = Horace) ────────────────────────────────────
function HoraceAvatar({ size = 24 }: { size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/horace-parchment.png"
      alt=""
      width={size}
      height={size}
      style={{ borderRadius: '50%', flexShrink: 0, display: 'block', background: 'var(--color-parchment)' }}
    />
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        width: 58,
        flexShrink: 0,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        color: 'var(--color-stone)',
        fontFamily: 'var(--font-body)',
        paddingTop: 3,
      }}
    >
      {children}
    </span>
  )
}

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** Convert the model's plain-text body (newline-delimited) to TipTap HTML. */
function bodyTextToHtml(text: string): string {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join('')
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * Public entry. Dispatches to V3 (Outreach Review re-skin) when the env flag is
 * set; otherwise the current V2 shell (HOR-354) renders. The flag is build-time
 * inlined via NEXT_PUBLIC_, so the dead branch tree-shakes out of the bundle.
 */
export function ComposerDock(props: ComposerDockProps) {
  if (process.env.NEXT_PUBLIC_COMPOSER_V3_ENABLED === '1') {
    return <ComposerDockV3 {...props} />
  }
  return <ComposerDockV2 {...props} />
}

function ComposerDockV2({ payload, onClose, rightOffset = 24, focusNonce = 0 }: ComposerDockProps) {
  const mobile = useIsMobile()

  // Recipient may arrive on the payload (Contact header) or need resolving from
  // the contact record (Stream / Companion only carry a contactId).
  const [recipient, setRecipient] = useState<string | null>(payload.recipient ?? null)
  const [resolvedName, setResolvedName] = useState<string | null>(payload.contactName ?? null)
  const [recipientState, setRecipientState] = useState<'ready' | 'resolving' | 'missing'>(
    payload.recipient ? 'ready' : 'resolving',
  )

  const name = (resolvedName?.trim() || recipient || 'this contact').trim()
  const firstName = name.split(/\s+/)[0] || name

  const [scenario, setScenario] = useState<ComposerScenario>(
    payload.draft ? 'drafted' : payload.autoDraft ? 'drafting' : 'empty',
  )
  const [collapsed, setCollapsed] = useState(false)
  const [subject, setSubject] = useState('')
  const [draftedByHorace, setDraftedByHorace] = useState(false)
  const [guardrail, setGuardrail] = useState<ComposerGuardrail>(null)
  const [scheduleView, setScheduleView] = useState<null | 'menu' | 'popover'>(null)
  const [scheduledLabel, setScheduledLabel] = useState<string | null>(null)
  const [writing, setWriting] = useState(false)
  const [bodyEmpty, setBodyEmpty] = useState(true)

  // Resolve the recipient email from the contact record when not supplied.
  useEffect(() => {
    if (payload.recipient) return
    let cancelled = false
    fetch(`/api/contacts/${payload.contactId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { contact?: { email?: string | null; first_name?: string | null; last_name?: string | null } } | null) => {
        if (cancelled) return
        const c = data?.contact
        const email = c?.email?.trim() || null
        if (!email) {
          setRecipientState('missing')
          return
        }
        setRecipient(email)
        if (!payload.contactName) {
          const full = [c?.first_name, c?.last_name].filter(Boolean).join(' ')
          if (full) setResolvedName(full)
        }
        setRecipientState('ready')
      })
      .catch(() => {
        if (!cancelled) setRecipientState('missing')
      })
    return () => {
      cancelled = true
    }
  }, [payload.contactId, payload.recipient, payload.contactName])

  // Guards a programmatic setContent so the draft-fill doesn't read as an edit.
  const programmaticFill = useRef(false)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false, horizontalRule: false }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
      }),
    ],
    content: '<p></p>',
    autofocus: false,
    immediatelyRender: false,
    editorProps: { attributes: { class: 'composer-dock-editor' } },
    onUpdate({ editor }) {
      setBodyEmpty(editor.isEmpty)
      if (programmaticFill.current) return
      // First real keystroke on a Horace draft hands ownership to the agent.
      setDraftedByHorace((wasHorace) => {
        if (wasHorace) setScenario('edited')
        return false
      })
    },
  })

  const locked = scenario === 'drafting' || scenario === 'sending'
  useEffect(() => {
    editor?.setEditable(!locked)
  }, [editor, locked])

  // Re-opening a send to a contact that already has this dock open expands it.
  useEffect(() => {
    if (focusNonce > 0) setCollapsed(false)
  }, [focusNonce])

  // ── Draft (Ask Horace) ──────────────────────────────────────────────────
  const runDraft = useCallback(async () => {
    setScenario('drafting')
    try {
      const res = await fetch('/api/email/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact_id: payload.contactId }),
      })
      const data = (await res.json().catch(() => null)) as DraftResponse | null
      if (data?.setup_required) {
        setScenario('setup')
        return
      }
      if (!res.ok || !data?.subject || !data?.body) {
        setScenario('failed-draft')
        return
      }
      setSubject(data.subject)
      if (editor) {
        programmaticFill.current = true
        editor.commands.setContent(bodyTextToHtml(data.body), false)
        setBodyEmpty(editor.isEmpty)
        programmaticFill.current = false
      }
      setDraftedByHorace(true)
      setWriting(true)
      setScenario('drafted')
    } catch {
      setScenario('failed-draft')
    }
  }, [editor, payload.contactId])

  // Escape hatch — write it yourself, from any state (idle, setup, or a failed
  // draft). The email is the agent's; Horace is never mandatory.
  const writeMyself = useCallback(() => {
    setDraftedByHorace(false)
    setScenario('empty')
    setWriting(true)
    editor?.commands.focus()
  }, [editor])

  // A pre-supplied draft (e.g. from the Companion) fills the editor once, in
  // the `drafted` state — no round-trip to the draft endpoint.
  const seededDraft = useRef(false)
  useEffect(() => {
    if (!payload.draft || !editor || seededDraft.current) return
    seededDraft.current = true
    setSubject(payload.draft.subject)
    programmaticFill.current = true
    editor.commands.setContent(bodyTextToHtml(payload.draft.body), false)
    setBodyEmpty(editor.isEmpty)
    programmaticFill.current = false
    setDraftedByHorace(true)
    setWriting(true)
    setScenario('drafted')
  }, [payload.draft, editor])

  // Companion entry auto-drafts on open (once the editor is ready) — unless a
  // draft was already supplied, in which case the seed effect above handles it.
  const autoKicked = useRef(false)
  useEffect(() => {
    if (payload.autoDraft && !payload.draft && editor && !autoKicked.current) {
      autoKicked.current = true
      void runDraft()
    }
  }, [payload.autoDraft, payload.draft, editor, runDraft])

  // ── Recipient guardrail check (#3) ────────────────────────────────────────
  useEffect(() => {
    const email = recipient?.trim().toLowerCase()
    if (!email) return
    let cancelled = false
    fetch(`/api/email/check-recipient?email=${encodeURIComponent(email)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: RecipientCheck | null) => {
        if (cancelled || !data?.excluded) return
        setGuardrail(data.reason === 'unsubscribed' ? 'unsubscribed' : 'excluded')
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [recipient])

  const sendBlocked = guardrail === 'unsubscribed' || guardrail === 'excluded'
  const tracked = guardrail !== 'untracked'
  const hasContent = !!subject.trim() && !bodyEmpty
  const canSend = hasContent && !sendBlocked && !locked && recipientState === 'ready' && !!recipient

  // ── Send ──────────────────────────────────────────────────────────────────
  const submit = useCallback(
    async (scheduledAtIso?: string) => {
      if (!editor) return
      const bodyHtml = editor.getHTML().trim()
      if (!subject.trim() || !bodyHtml || bodyHtml === '<p></p>') return
      setScenario('sending')
      try {
        const res = await fetch('/api/email/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contact_id: payload.contactId,
            to_email: recipient,
            subject: subject.trim(),
            body_html: bodyHtml,
            tracked,
            source: payload.source,
            ...(scheduledAtIso ? { scheduled_at: scheduledAtIso } : {}),
          }),
        })
        if (!res.ok) {
          await res.json().catch(() => null as EmailSendErrorBody | null)
          setScenario('failed-send')
          return
        }
        if (scheduledAtIso) {
          setScheduledLabel(formatScheduleLabel(scheduledAtIso))
          setScheduleView(null)
          setCollapsed(true)
          return
        }
        ;(await res.json()) as EmailSendResult
        onClose()
      } catch {
        setScenario('failed-send')
      }
    },
    [editor, subject, tracked, recipient, payload.contactId, payload.source, onClose],
  )

  const initials = useMemo(() => initialsFor(name), [name])

  // ── Collapsed / scheduled bar ──────────────────────────────────────────────
  if (collapsed || scheduledLabel) {
    return (
      <DockShell rightOffset={rightOffset} width={scheduledLabel ? 300 : 420} collapsedBar mobile={mobile}>
        <DockHeader
          title={scheduledLabel ?? `New email — ${name}`}
          icon={scheduledLabel ? 'clock' : 'mail'}
          collapsed
          onToggleCollapse={() => {
            if (scheduledLabel) return // scheduled bar is terminal here
            setCollapsed(false)
          }}
          onClose={onClose}
        />
      </DockShell>
    )
  }

  const filledSubject = scenario === 'drafted' || scenario === 'edited' || scenario === 'sending'

  return (
    <DockShell rightOffset={rightOffset} width={420} mobile={mobile} onScrimClick={() => setCollapsed(true)}>
      <DockHeader
        title={`New email — ${name}`}
        icon="mail"
        onToggleCollapse={() => setCollapsed(true)}
        onClose={onClose}
      />

      {/* Fields */}
      <div style={{ padding: '11px 16px 9px', display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4, padding: '2px 0' }}>
          <FieldLabel>To</FieldLabel>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 7,
                padding: '4px 10px 4px 4px',
                borderRadius: 9999,
                background: 'rgba(140,123,107,0.1)',
                border: '1px solid var(--border-default)',
                maxWidth: '100%',
              }}
            >
              <span
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  background: 'rgba(196,98,45,0.16)',
                  color: 'var(--color-terracotta)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 9.5,
                  fontWeight: 600,
                  fontFamily: 'var(--font-display)',
                  flexShrink: 0,
                }}
              >
                {initials}
              </span>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: 'var(--color-ink)',
                  fontFamily: 'var(--font-body)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {name}
              </span>
            </span>
            {guardrail === 'untracked' ? (
              <span style={{ fontSize: 11.5, color: WARN, fontFamily: 'var(--font-mono)' }}>edited address</span>
            ) : recipientState === 'missing' ? (
              <span style={{ fontSize: 11.5, color: WARN, fontFamily: 'var(--font-body)' }}>No email on file — add one to send</span>
            ) : recipientState === 'resolving' ? (
              <span style={{ fontSize: 11.5, color: 'var(--color-stone)', fontFamily: 'var(--font-body)' }}>Finding email…</span>
            ) : (
              <span style={{ fontSize: 11.5, color: 'var(--color-stone)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {recipient}
              </span>
            )}
          </div>
        </div>
        <div style={{ height: 1, background: 'var(--border-subtle)', margin: '2px 0' }} />
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4, padding: '2px 0' }}>
          <FieldLabel>Subject</FieldLabel>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="A short, specific subject line"
            disabled={locked}
            maxLength={200}
            style={{
              flex: 1,
              minWidth: 0,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              fontSize: 13.5,
              color: subject ? 'var(--color-ink)' : 'rgba(140,123,107,0.7)',
              fontFamily: 'var(--font-body)',
            }}
          />
        </div>
      </div>
      <div style={{ height: 1, background: 'var(--border-subtle)' }} />

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
        {scenario === 'drafting' && <DraftingBody />}
        {scenario === 'failed-draft' && <FailedDraftBody onRetry={runDraft} onWriteMyself={writeMyself} />}
        {scenario === 'setup' && <SetupBody onWriteMyself={writeMyself} />}
        {scenario !== 'drafting' && scenario !== 'failed-draft' && scenario !== 'setup' && (
          <WriteableBody
            scenario={scenario}
            firstName={firstName}
            showIdle={scenario === 'empty' && !writing && bodyEmpty}
            onAskHorace={runDraft}
            onStartWriting={() => {
              setWriting(true)
              editor?.commands.focus()
            }}
            editor={editor}
            showAgainButton={scenario === 'drafted' || scenario === 'edited'}
          />
        )}
      </div>

      {/* #3 Guardrail band (detachable) */}
      <GuardrailBand kind={guardrail} firstName={firstName} />

      {scenario === 'failed-send' && (
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 9,
            margin: '0 16px 12px',
            padding: '10px 12px',
            borderRadius: 8,
            background: 'rgba(196,98,45,0.1)',
            border: '1px solid rgba(196,98,45,0.32)',
          }}
          role="alert"
        >
          <ArrowUp size={15} color={DANGER} style={{ transform: 'rotate(45deg)', marginTop: 1, flexShrink: 0 }} />
          <div style={{ flex: 1, fontSize: 12.5, color: DANGER, fontFamily: 'var(--font-body)', lineHeight: 1.5 }}>
            That didn’t send — nothing’s lost.{' '}
            <button
              type="button"
              onClick={() => submit()}
              style={{ color: DANGER, fontWeight: 600, textDecoration: 'underline', textUnderlineOffset: 2, cursor: 'pointer', background: 'none', border: 'none', padding: 0, font: 'inherit' }}
            >
              Try again
            </button>
          </div>
        </div>
      )}

      {/* Footer */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '11px 16px',
          borderTop: '1px solid var(--border-default)',
          background: HEAD_BG,
          flexShrink: 0,
        }}
      >
        <TrackingIndicator untracked={guardrail === 'untracked'} />
        <SendSplitButton
          sending={scenario === 'sending'}
          disabled={!canSend && scenario !== 'failed-send'}
          mobile={mobile}
          onSend={() => submit()}
          onCaret={() => setScheduleView((v) => (v === 'menu' ? null : 'menu'))}
        />
      </div>

      {/* #6 Schedule overlays (detachable) */}
      {scheduleView === 'menu' && (
        <ScheduleMenu
          onSendNow={() => {
            setScheduleView(null)
            void submit()
          }}
          onSchedule={() => setScheduleView('popover')}
        />
      )}
      {scheduleView === 'popover' && (
        <SchedulePopover
          onConfirm={(iso) => void submit(iso)}
          onCancel={() => setScheduleView(null)}
        />
      )}

      <DockStyles />
    </DockShell>
  )
}

// ── Shell + header ────────────────────────────────────────────────────────────

function DockShell({
  children,
  rightOffset,
  width,
  collapsedBar = false,
  mobile = false,
  onScrimClick,
}: {
  children: React.ReactNode
  rightOffset: number
  width: number
  collapsedBar?: boolean
  mobile?: boolean
  onScrimClick?: () => void
}) {
  // Mobile (<768px): full-width bottom sheet. A collapsed/scheduled bar stays
  // a pinned full-width bar at the bottom; the expanded sheet gets a scrim +
  // focus trap behind it (HOR-361).
  const mobileSheet: React.CSSProperties = {
    position: 'fixed',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 51,
    width: 'auto',
    maxWidth: '100vw',
    height: collapsedBar ? undefined : 'min(88vh, calc(100vh - 24px))',
    background: 'var(--color-cream)',
    borderTop: '1px solid var(--border-default)',
    borderRadius: '16px 16px 0 0',
    boxShadow: '0 -8px 32px rgba(26,22,18,0.22)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  }
  const desktopDock: React.CSSProperties = {
    position: 'fixed',
    bottom: 24,
    right: rightOffset,
    zIndex: 50,
    width,
    maxWidth: 'calc(100vw - 32px)',
    height: collapsedBar ? undefined : 'min(560px, calc(100vh - 48px))',
    background: 'var(--color-cream)',
    border: '1px solid var(--border-default)',
    borderRadius: 12,
    boxShadow: '0 16px 48px rgba(26,22,18,0.22)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  }
  return (
    <>
      {mobile && !collapsedBar && (
        <div
          aria-hidden
          onClick={onScrimClick}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 50,
            background: 'rgba(26,22,18,0.28)',
            backdropFilter: 'blur(2px)',
            WebkitBackdropFilter: 'blur(2px)',
          }}
        />
      )}
      <div
        role="dialog"
        aria-modal={mobile && !collapsedBar ? true : undefined}
        aria-label="Tracked email composer"
        className="composer-dock-shell"
        style={mobile ? mobileSheet : desktopDock}
      >
        {children}
      </div>
    </>
  )
}

function DockHeader({
  title,
  icon,
  collapsed = false,
  onToggleCollapse,
  onClose,
}: {
  title: string
  icon: 'mail' | 'clock'
  collapsed?: boolean
  onToggleCollapse: () => void
  onClose: () => void
}) {
  const iconCtl: React.CSSProperties = {
    width: 26,
    height: 26,
    borderRadius: 7,
    background: 'transparent',
    border: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    padding: 0,
    color: 'var(--color-stone-aa)',
  }
  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '11px 12px 11px 15px',
        background: HEAD_BG,
        borderBottom: collapsed ? 'none' : '1px solid var(--border-default)',
        flexShrink: 0,
      }}
    >
      {icon === 'clock' ? (
        <Clock size={15} style={{ color: 'var(--color-terracotta)', flexShrink: 0 }} />
      ) : (
        <Mail size={15} style={{ color: 'var(--color-stone-aa)', flexShrink: 0 }} />
      )}
      <button
        type="button"
        onClick={onToggleCollapse}
        style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
        aria-label={collapsed ? 'Expand' : 'Collapse'}
      >
        <span
          style={{
            display: 'block',
            fontSize: 13.5,
            fontWeight: 600,
            color: 'var(--color-ink)',
            fontFamily: 'var(--font-body)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {title}
        </span>
      </button>
      <button type="button" aria-label={collapsed ? 'Expand' : 'Collapse'} onClick={onToggleCollapse} style={iconCtl}>
        {collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
      </button>
      <button type="button" aria-label="Close" onClick={onClose} style={iconCtl}>
        <X size={14} />
      </button>
    </header>
  )
}

// ── Body states ─────────────────────────────────────────────────────────────

function DraftingBody() {
  const bar = (w: string, mt: number) => (
    <div
      style={{
        height: 10,
        width: w,
        borderRadius: 5,
        background: 'rgba(140,123,107,0.22)',
        marginTop: mt,
        animation: 'cdock-shimmer 1.4s ease-in-out infinite',
      }}
    />
  )
  return (
    <div style={{ flex: 1, padding: '14px 16px', display: 'flex', flexDirection: 'column' }} aria-live="polite">
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 9,
          alignSelf: 'flex-start',
          marginBottom: 16,
          padding: '6px 12px 6px 6px',
          borderRadius: 9999,
          background: 'var(--accent-horace-tint-bg)',
          border: '1px solid var(--accent-horace-tint-bd)',
        }}
      >
        <HoraceAvatar size={20} />
        <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--accent-horace-ink)', fontFamily: 'var(--font-body)' }}>
          Horace is drafting…
        </span>
        <span
          style={{
            width: 12,
            height: 12,
            borderRadius: '50%',
            border: '1.6px solid rgba(156,90,48,0.3)',
            borderTopColor: 'var(--accent-horace-ink)',
            animation: 'cdock-spin 0.7s linear infinite',
          }}
        />
      </div>
      {bar('38%', 0)}
      {bar('92%', 14)}
      {bar('86%', 9)}
      {bar('64%', 9)}
      {bar('80%', 18)}
      {bar('42%', 9)}
    </div>
  )
}

function WriteableBody({
  scenario,
  firstName,
  showIdle,
  onAskHorace,
  onStartWriting,
  editor,
  showAgainButton,
}: {
  scenario: ComposerScenario
  firstName: string
  showIdle: boolean
  onAskHorace: () => void
  onStartWriting: () => void
  editor: ReturnType<typeof useEditor>
  showAgainButton: boolean
}) {
  if (showIdle) {
    return (
      <div
        style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '26px 16px' }}
      >
        <button
          type="button"
          onClick={onAskHorace}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 11,
            padding: '10px 18px 10px 11px',
            borderRadius: 9999,
            background: '#FFFFFF',
            border: '1px solid var(--accent-horace-tint-bd)',
            boxShadow: '0 3px 16px rgba(232,149,109,0.22)',
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          <HoraceAvatar size={30} />
          <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-ink)', fontFamily: 'var(--font-body)' }}>
              Ask Horace to draft
            </span>
            <span style={{ fontSize: 11.5, color: 'var(--color-stone)', fontFamily: 'var(--font-body)' }}>
              From {firstName}’s recent activity
            </span>
          </span>
        </button>
        <p style={{ margin: 0, maxWidth: 250, textAlign: 'center', fontSize: 12, color: 'var(--color-stone)', fontFamily: 'var(--font-body)', lineHeight: 1.5 }}>
          It’s your email, in your voice —{' '}
          <button
            type="button"
            onClick={onStartWriting}
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit', color: 'var(--color-terracotta-text)', fontWeight: 600, textDecoration: 'underline', textUnderlineOffset: 2 }}
          >
            just start writing
          </button>
          .
        </p>
      </div>
    )
  }

  return (
    <div style={{ flex: 1, padding: '14px 16px 6px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {scenario === 'drafted' && (
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            alignSelf: 'flex-start',
            marginBottom: 12,
            padding: '5px 9px 5px 5px',
            borderRadius: 9999,
            background: 'var(--accent-horace-tint-bg)',
            border: '1px solid var(--accent-horace-tint-bd)',
            animation: 'cdock-rise 220ms var(--ease-out)',
          }}
        >
          <HoraceAvatar size={18} />
          <span style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--accent-horace-ink)', fontFamily: 'var(--font-body)' }}>
            Drafted by Horace — edit freely
          </span>
        </div>
      )}
      {scenario === 'edited' && (
        <div style={{ alignSelf: 'flex-start', marginBottom: 10, fontSize: 11, color: 'var(--color-stone)', fontFamily: 'var(--font-body)', fontStyle: 'italic' }}>
          Your edits — Horace tag cleared
        </div>
      )}
      <EditorContent editor={editor} />
      {showAgainButton && (
        <button
          type="button"
          onClick={onAskHorace}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 7, alignSelf: 'flex-start', marginTop: 14, padding: '6px 4px', background: 'transparent', border: 'none', cursor: 'pointer' }}
        >
          <HoraceAvatar size={18} />
          <span style={{ fontSize: 12, color: 'var(--color-stone)', fontFamily: 'var(--font-body)' }}>Ask Horace again</span>
        </button>
      )}
    </div>
  )
}

function FailedDraftBody({ onRetry, onWriteMyself }: { onRetry: () => void; onWriteMyself: () => void }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 13, padding: '24px 22px' }}>
      <HoraceAvatar size={34} />
      <p style={{ margin: 0, maxWidth: 260, textAlign: 'center', fontSize: 13, color: 'var(--color-stone-aa)', fontFamily: 'var(--font-body)', lineHeight: 1.55 }}>
        Horace couldn’t draft this one. Try again, or write it yourself.
      </p>
      <button
        type="button"
        onClick={onRetry}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 15px 8px 9px', borderRadius: 9999, background: '#FFFFFF', border: '1px solid var(--accent-horace-tint-bd)', cursor: 'pointer' }}
      >
        <HoraceAvatar size={20} />
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-ink)', fontFamily: 'var(--font-body)' }}>Ask Horace again</span>
      </button>
      <button type="button" onClick={onWriteMyself} style={writeMyselfBtnStyle}>
        Write it yourself
      </button>
    </div>
  )
}

function SetupBody({ onWriteMyself }: { onWriteMyself: () => void }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '24px 22px' }}>
      <HoraceAvatar size={34} />
      <p style={{ margin: 0, maxWidth: 270, textAlign: 'center', fontSize: 13, color: 'var(--color-stone-aa)', fontFamily: 'var(--font-body)', lineHeight: 1.55 }}>
        Before I draft in your voice, I need your brand voice and signature — a two-minute setup.
      </p>
      <a
        href="/settings#brand-voice"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 16px', borderRadius: 9, background: 'var(--color-terracotta)', color: 'var(--color-cream)', textDecoration: 'none', fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-body)' }}
      >
        Set up your voice
      </a>
      <button type="button" onClick={onWriteMyself} style={writeMyselfBtnStyle}>
        Or write this one yourself
      </button>
    </div>
  )
}

// Quiet ghost link shared by the failed-draft + setup escape hatches.
const writeMyselfBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  padding: 4,
  cursor: 'pointer',
  fontSize: 12,
  color: 'var(--color-stone-aa)',
  fontFamily: 'var(--font-body)',
  textDecoration: 'underline',
  textUnderlineOffset: 2,
}

// ── #3 GuardrailBand ──────────────────────────────────────────────────────────

function GuardrailBand({ kind, firstName }: { kind: ComposerGuardrail; firstName: string }) {
  if (!kind) return null
  const map = {
    unsubscribed: {
      bg: 'rgba(196,98,45,0.1)',
      bd: 'rgba(196,98,45,0.32)',
      fg: DANGER,
      icon: 'lock' as const,
      text: `${firstName} has unsubscribed — you can’t send to them.`,
      link: { label: 'Why?', href: '/settings/email-exclusions' },
    },
    excluded: {
      bg: 'rgba(181,146,42,0.12)',
      bd: 'rgba(181,146,42,0.34)',
      fg: WARN,
      icon: 'lock' as const,
      text: 'This address is on your exclusion list.',
      link: { label: 'Settings → Email exclusions', href: '/settings/email-exclusions' },
    },
    untracked: {
      bg: 'rgba(140,123,107,0.1)',
      bd: 'var(--border-default)',
      fg: 'var(--color-stone-aa)',
      icon: 'eye' as const,
      text: 'You’ve changed the address — this send won’t be tracked.',
      link: null,
    },
  }[kind]

  return (
    <div
      style={{ display: 'flex', alignItems: 'flex-start', gap: 9, margin: '0 16px 12px', padding: '10px 12px', borderRadius: 8, background: map.bg, border: `1px solid ${map.bd}` }}
    >
      {map.icon === 'lock' ? (
        <Lock size={15} color={map.fg} style={{ marginTop: 1, flexShrink: 0 }} />
      ) : (
        <Eye size={15} color={map.fg} style={{ marginTop: 1, flexShrink: 0 }} />
      )}
      <div style={{ flex: 1, fontSize: 12.5, color: map.fg, fontFamily: 'var(--font-body)', lineHeight: 1.5 }}>
        {map.text}
        {map.link && (
          <a
            href={map.link.href}
            style={{ display: 'block', marginTop: 3, color: map.fg, fontWeight: 600, textDecoration: 'underline', textUnderlineOffset: 2, fontSize: 11.5 }}
          >
            {map.link.label}
          </a>
        )}
      </div>
    </div>
  )
}

// ── Tracking indicator ────────────────────────────────────────────────────────

function TrackingIndicator({ untracked }: { untracked: boolean }) {
  if (untracked) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'rgba(140,123,107,0.85)', fontFamily: 'var(--font-body)' }}>
        <Eye size={13} color="rgba(140,123,107,0.7)" /> Tracking unavailable
      </span>
    )
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--color-stone)', fontFamily: 'var(--font-body)' }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--color-moss)', boxShadow: '0 0 0 3px rgba(61,82,70,0.16)' }} />
      <span>
        <strong style={{ color: 'var(--color-ink)', fontWeight: 600 }}>Tracking</strong> on
      </span>
    </span>
  )
}

// ── Send split button (#6 adds the caret) ─────────────────────────────────────

function SendSplitButton({
  sending,
  disabled,
  mobile = false,
  onSend,
  onCaret,
}: {
  sending: boolean
  disabled: boolean
  mobile?: boolean
  onSend: () => void
  onCaret: () => void
}) {
  const bg = disabled ? 'rgba(196,98,45,0.4)' : 'var(--color-terracotta)'
  return (
    <div style={{ display: 'inline-flex', flex: mobile ? 1 : undefined, boxShadow: disabled ? 'none' : '0 2px 8px rgba(196,98,45,0.28)', borderRadius: 9 }}>
      <button
        type="button"
        disabled={disabled || sending}
        onClick={onSend}
        style={{
          display: 'inline-flex',
          flex: mobile ? 1 : undefined,
          alignItems: 'center',
          justifyContent: 'center',
          gap: 7,
          padding: mobile ? '15px 16px' : '9px 16px',
          background: bg,
          color: 'var(--color-cream)',
          border: 'none',
          cursor: disabled ? 'not-allowed' : 'pointer',
          fontSize: 13.5,
          fontWeight: 600,
          fontFamily: 'var(--font-body)',
          borderRadius: '9px 0 0 9px',
          whiteSpace: 'nowrap',
        }}
      >
        {sending ? (
          <>
            <span style={{ width: 13, height: 13, borderRadius: '50%', border: '1.6px solid rgba(250,247,242,0.4)', borderTopColor: 'var(--color-cream)', animation: 'cdock-spin 0.7s linear infinite' }} /> Sending…
          </>
        ) : (
          <>
            <Send size={14} color="var(--color-cream)" /> Send
          </>
        )}
      </button>
      <button
        type="button"
        disabled={disabled || sending}
        onClick={onCaret}
        aria-haspopup="menu"
        aria-label="Schedule send"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 34,
          background: bg,
          color: 'var(--color-cream)',
          border: 'none',
          borderLeft: '1px solid rgba(250,247,242,0.22)',
          borderRadius: '0 9px 9px 0',
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
      >
        <ChevronDown size={15} color="var(--color-cream)" />
      </button>
    </div>
  )
}

// ── #6 ScheduleLayer ──────────────────────────────────────────────────────────

function ScheduleMenu({ onSendNow, onSchedule }: { onSendNow: () => void; onSchedule: () => void }) {
  const row = (node: React.ReactNode, onClick: () => void, primary?: boolean) => (
    <button
      type="button"
      onClick={onClick}
      style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '9px 12px', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: primary ? 600 : 500, color: 'var(--color-ink)', fontFamily: 'var(--font-body)', textAlign: 'left' }}
    >
      {node}
    </button>
  )
  return (
    <div
      role="menu"
      style={{ position: 'absolute', right: 16, bottom: 56, width: 190, background: 'var(--color-cream)', border: '1px solid var(--border-default)', borderRadius: 10, boxShadow: '0 8px 32px rgba(26,22,18,0.18)', overflow: 'hidden', zIndex: 5, animation: 'cdock-rise 130ms var(--ease-out)' }}
    >
      {row(<><Send size={15} color="var(--color-terracotta)" /> Send now</>, onSendNow, true)}
      <div style={{ height: 1, background: 'var(--border-subtle)' }} />
      {row(<><Clock size={15} color="var(--color-stone)" /> Schedule send…</>, onSchedule)}
    </div>
  )
}

function SchedulePopover({ onConfirm, onCancel }: { onConfirm: (iso: string) => void; onCancel: () => void }) {
  const presets = useMemo(() => buildSchedulePresets(), [])
  // Selection is either a preset iso, or 'custom' (driven by the date/time row).
  const [selected, setSelected] = useState<string>(presets[1]?.iso ?? presets[0]?.iso ?? 'custom')
  // Custom inputs default to tomorrow 08:00 local.
  const customDefault = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    d.setHours(8, 0, 0, 0)
    return d
  }, [])
  const [date, setDate] = useState(() => toDateInput(customDefault))
  const [time, setTime] = useState(() => toTimeInput(customDefault))

  const isCustom = selected === 'custom'
  const customIso = useMemo(() => {
    if (!date || !time) return null
    const d = new Date(`${date}T${time}`)
    return Number.isNaN(d.getTime()) ? null : d
  }, [date, time])
  const customValid = !!customIso && customIso.getTime() > Date.now()

  const chosenIso = isCustom ? (customValid ? customIso!.toISOString() : null) : selected
  const canSchedule = !!chosenIso

  return (
    <div
      style={{ position: 'absolute', right: 16, bottom: 56, width: 286, background: 'var(--color-cream)', border: '1px solid var(--border-default)', borderRadius: 12, boxShadow: '0 8px 32px rgba(26,22,18,0.2)', padding: 14, zIndex: 5, animation: 'cdock-rise 140ms var(--ease-out)' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 12 }}>
        <Clock size={14} color="var(--color-terracotta)" />
        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--color-ink)', fontFamily: 'var(--font-body)' }}>Schedule send</span>
      </div>
      {presets.map((p) => {
        const active = !isCustom && p.iso === selected
        return (
          <button
            key={p.iso}
            type="button"
            onClick={() => setSelected(p.iso)}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '9px 11px', background: active ? 'rgba(196,98,45,0.1)' : '#FFFFFF', border: `1px solid ${active ? 'rgba(196,98,45,0.4)' : 'var(--border-default)'}`, borderRadius: 8, cursor: 'pointer', marginBottom: 7 }}
          >
            <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-ink)', fontFamily: 'var(--font-body)' }}>{p.label}</span>
            <span style={{ fontSize: 11.5, color: 'var(--color-stone)', fontFamily: 'var(--font-mono)' }}>{p.sub}</span>
          </button>
        )
      })}

      {/* Custom date + time — selecting/editing it switches to a custom send time. */}
      <div
        style={{
          display: 'flex',
          gap: 7,
          margin: '4px 0 0',
          padding: 7,
          borderRadius: 8,
          border: `1px solid ${isCustom ? 'rgba(196,98,45,0.4)' : 'var(--border-default)'}`,
          background: isCustom ? 'rgba(196,98,45,0.06)' : 'transparent',
        }}
        onFocusCapture={() => setSelected('custom')}
      >
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, padding: '7px 9px', background: '#FFFFFF', border: '1px solid var(--border-default)', borderRadius: 8 }}>
          <Clock size={12} color="var(--color-stone)" style={{ flexShrink: 0 }} />
          <input
            type="date"
            value={date}
            min={toDateInput(new Date())}
            onChange={(e) => {
              setDate(e.target.value)
              setSelected('custom')
            }}
            style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: 12, color: 'var(--color-ink)', fontFamily: 'var(--font-mono)', width: '100%' }}
          />
        </div>
        <div style={{ width: 96, display: 'flex', alignItems: 'center', padding: '7px 9px', background: '#FFFFFF', border: '1px solid var(--border-default)', borderRadius: 8 }}>
          <input
            type="time"
            value={time}
            onChange={(e) => {
              setTime(e.target.value)
              setSelected('custom')
            }}
            style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: 12, color: 'var(--color-ink)', fontFamily: 'var(--font-mono)', width: '100%' }}
          />
        </div>
      </div>
      {isCustom && !customValid && (
        <p style={{ margin: '6px 2px 0', fontSize: 11, color: '#A5511E', fontFamily: 'var(--font-body)' }}>
          Pick a time in the future.
        </p>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button
          type="button"
          disabled={!canSchedule}
          onClick={() => chosenIso && onConfirm(chosenIso)}
          style={{ flex: 1, padding: '9px 12px', background: canSchedule ? 'var(--color-terracotta)' : 'rgba(196,98,45,0.4)', color: 'var(--color-cream)', border: 'none', borderRadius: 8, fontSize: 12.5, fontWeight: 600, fontFamily: 'var(--font-body)', cursor: canSchedule ? 'pointer' : 'not-allowed' }}
        >
          Schedule
        </button>
        <button
          type="button"
          onClick={onCancel}
          style={{ padding: '9px 14px', background: 'transparent', color: 'var(--color-stone)', border: '1px solid var(--border-default)', borderRadius: 8, fontSize: 12.5, fontWeight: 500, fontFamily: 'var(--font-body)', cursor: 'pointer' }}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

// ── Schedule preset helpers ────────────────────────────────────────────────────

interface SchedulePreset {
  label: string
  sub: string
  iso: string
}

function buildSchedulePresets(): SchedulePreset[] {
  const now = new Date()
  const out: SchedulePreset[] = []

  // Later today — next round hour ≥ now+2h, capped at 5pm; only if before 5pm.
  const laterToday = new Date(now)
  laterToday.setHours(17, 0, 0, 0)
  if (laterToday.getTime() > now.getTime() + 2 * 3600_000) {
    out.push({ label: 'Later today', sub: fmtTime(laterToday), iso: laterToday.toISOString() })
  }

  // Tomorrow morning — 8am.
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(8, 0, 0, 0)
  out.push({ label: 'Tomorrow morning', sub: `${fmtDay(tomorrow)} · ${fmtTime(tomorrow)}`, iso: tomorrow.toISOString() })

  // Next Monday — 8am.
  const monday = new Date(now)
  const daysToMon = ((1 - monday.getDay() + 7) % 7) || 7
  monday.setDate(monday.getDate() + daysToMon)
  monday.setHours(8, 0, 0, 0)
  out.push({ label: 'Monday', sub: `${fmtDate(monday)} · ${fmtTime(monday)}`, iso: monday.toISOString() })

  return out
}

function fmtTime(d: Date): string {
  return d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase().replace(' ', ' ')
}
function fmtDay(d: Date): string {
  return d.toLocaleDateString('en-AU', { weekday: 'short' })
}
function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
}
function formatScheduleLabel(iso: string): string {
  const d = new Date(iso)
  return `Scheduled — ${d.toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })}, ${fmtTime(d)}`
}
/** Local YYYY-MM-DD for <input type="date">. */
function toDateInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
/** Local HH:MM for <input type="time">. */
function toTimeInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ── Scoped styles ──────────────────────────────────────────────────────────────

function DockStyles() {
  return (
    <style jsx global>{`
      @keyframes cdock-shimmer {
        0% { opacity: 0.45; }
        50% { opacity: 0.8; }
        100% { opacity: 0.45; }
      }
      @keyframes cdock-spin {
        to { transform: rotate(360deg); }
      }
      @keyframes cdock-rise {
        from { transform: translateY(10px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
      .composer-dock-shell {
        animation: cdock-rise 220ms var(--ease-out);
      }
      .composer-dock-editor {
        min-height: 120px;
        outline: none;
        font-family: var(--font-body);
        font-size: 13.5px;
        line-height: 1.6;
        color: var(--color-ink);
      }
      .composer-dock-editor p { margin: 0 0 9px; }
      .composer-dock-editor p:last-child { margin-bottom: 0; }
      .composer-dock-editor a { color: var(--color-terracotta); text-decoration: underline; }
      .composer-dock-editor:focus { outline: none; }
      @media (prefers-reduced-motion: reduce) {
        .composer-dock-shell,
        .composer-dock-shell * { animation-duration: 0.001ms !important; }
      }
    `}</style>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// V3 — Outreach Review composer dock (re-skin + 3-channel expansion)
// ═════════════════════════════════════════════════════════════════════════════
// Pixel-faithful implementation of /Users/andytwomey/Downloads/design_handoff_outreach_review.
// Shares the existing host (provider + mount + open button) and send pipeline
// (`/api/email/send`, `/api/email/draft`). Gated behind
// NEXT_PUBLIC_COMPOSER_V3_ENABLED so V2 stays live until smoke passes.

// — V3 design tokens (mirror the handoff's hard-coded values) ——————————————
const V3 = {
  ink: '#1A1612',
  charcoal: '#2E2823',
  stone: '#8C7B6B',
  stoneAA: '#6B5D4F',
  stoneSoft: '#A8998A',
  parchment: '#F5F0E8',
  cream: '#FAF7F2',
  surface: '#FFFFFF',
  headBg: '#EAE2D5',
  terracotta: '#C4622D',
  terracottaDark: '#A8521F',
  ember: '#E8956D',
  moss: '#3D5246',
  mossDark: '#34463B',
  error: '#B23A2E',
  border: 'rgba(140,123,107,0.18)',
  borderSoft: 'rgba(140,123,107,0.12)',
  borderStrong: 'rgba(140,123,107,0.3)',
  rowBg: 'rgba(140,123,107,0.035)',
  segTrack: 'rgba(140,123,107,0.12)',
  hover: 'rgba(140,123,107,0.14)',
  font: "'DM Sans', var(--font-body), sans-serif",
  mono: "'DM Mono', var(--font-mono), monospace",
  channelAccent: { email: '#C4622D', sms: '#3D5246', call: '#6B5D4F' } as Record<ComposerChannel, string>,
}

// — Mutes persistence (per-agent localStorage, key derived from contact-host) —
const MUTES_KEY = 'horace.composerV3.mutes.v1'
type MuteState = { listings: boolean; sold: boolean; reports: boolean }
const DEFAULT_MUTES: MuteState = { listings: false, sold: false, reports: false }

function loadMutes(): MuteState {
  if (typeof window === 'undefined') return DEFAULT_MUTES
  try {
    const raw = window.localStorage.getItem(MUTES_KEY)
    if (!raw) return DEFAULT_MUTES
    const parsed = JSON.parse(raw) as Partial<MuteState>
    return {
      listings: !!parsed.listings,
      sold: !!parsed.sold,
      reports: !!parsed.reports,
    }
  } catch {
    return DEFAULT_MUTES
  }
}

function saveMutes(m: MuteState) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(MUTES_KEY, JSON.stringify(m))
  } catch {
    /* quota / private mode — silently ignore */
  }
}

// — Draft response (extends V2 shape with `sources` + `pretext_label`) ————————
interface DraftResponseV3 {
  subject?: string
  body?: string
  pretext_label?: string
  sources?: ContentSource[]
  setup_required?: boolean
  missing?: string[]
}

// — Contact resolution shape ———————————————————————————————————————————————
interface ResolvedContact {
  email: string | null
  phone: string | null
  firstName: string
  fullName: string
}

function ComposerDockV3({ payload, onClose, rightOffset = 24, focusNonce = 0 }: ComposerDockProps) {
  const mobile = useIsMobile()

  // ── Channel ──────────────────────────────────────────────────────────────
  const [mode, setMode] = useState<ComposerChannel>(payload.defaultChannel ?? 'email')

  // ── Recipient (email + phone, resolved on mount) ─────────────────────────
  const [contact, setContact] = useState<ResolvedContact>(() => {
    const full = (payload.contactName ?? '').trim() || payload.recipient || 'this contact'
    return {
      email: payload.recipient ?? null,
      phone: payload.recipientPhone ?? null,
      firstName: full.split(/\s+/)[0] || full,
      fullName: full,
    }
  })
  const [recipientState, setRecipientState] = useState<'ready' | 'resolving' | 'missing'>(
    payload.recipient ? 'ready' : 'resolving',
  )

  useEffect(() => {
    if (payload.recipient && payload.recipientPhone && payload.contactName) return
    let cancelled = false
    fetch(`/api/contacts/${payload.contactId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (data: {
          contact?: {
            email?: string | null
            phone?: string | null
            first_name?: string | null
            last_name?: string | null
          }
        } | null) => {
          if (cancelled) return
          const c = data?.contact
          const email = c?.email?.trim() || payload.recipient || null
          const phone = c?.phone?.trim() || payload.recipientPhone || null
          const full = [c?.first_name, c?.last_name].filter(Boolean).join(' ') || payload.contactName || email || 'this contact'
          setContact({
            email,
            phone,
            firstName: full.split(/\s+/)[0] || full,
            fullName: full,
          })
          setRecipientState(email ? 'ready' : 'missing')
        },
      )
      .catch(() => {
        if (!cancelled) setRecipientState(payload.recipient ? 'ready' : 'missing')
      })
    return () => {
      cancelled = true
    }
  }, [payload.contactId, payload.recipient, payload.recipientPhone, payload.contactName])

  // ── Email state (TipTap editor preserved from V2) ────────────────────────
  const programmaticFill = useRef(false)
  const [scenario, setScenario] = useState<ComposerScenario>(
    payload.draft ? 'drafted' : payload.autoDraft ? 'drafting' : 'empty',
  )
  const [collapsed, setCollapsed] = useState(false)
  const [subject, setSubject] = useState('')
  const [draftedByHorace, setDraftedByHorace] = useState(false)
  const [bodyEmpty, setBodyEmpty] = useState(true)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false, horizontalRule: false }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
      }),
    ],
    content: '<p></p>',
    autofocus: false,
    immediatelyRender: false,
    editorProps: { attributes: { class: 'composer-dock-editor composer-dock-editor-v3' } },
    onUpdate({ editor }) {
      setBodyEmpty(editor.isEmpty)
      if (programmaticFill.current) return
      setDraftedByHorace((wasHorace) => {
        if (wasHorace) setScenario('edited')
        return false
      })
    },
  })

  const locked = scenario === 'drafting' || scenario === 'sending'
  useEffect(() => {
    editor?.setEditable(!locked)
  }, [editor, locked])

  useEffect(() => {
    if (focusNonce > 0) setCollapsed(false)
  }, [focusNonce])

  // ── SMS state ────────────────────────────────────────────────────────────
  const [smsText, setSmsText] = useState('')
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle')
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Insight & Content panel state ────────────────────────────────────────
  const [sources, setSources] = useState<ContentSource[]>([])
  const [activeSoldIdx, setActiveSoldIdx] = useState(0)
  const [featuredOpen, setFeaturedOpen] = useState(false)
  const [tipOpen, setTipOpen] = useState(false)
  const [swapOpen, setSwapOpen] = useState<ContentSourceType | null>(null)
  const [mutes, setMutes] = useState<MuteState>(DEFAULT_MUTES)
  const [draftsUpdated, setDraftsUpdated] = useState(false)
  const updatedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    setMutes(loadMutes())
  }, [])
  useEffect(() => () => {
    if (updatedTimer.current) clearTimeout(updatedTimer.current)
    if (copyTimer.current) clearTimeout(copyTimer.current)
  }, [])
  const flashUpdated = useCallback(() => {
    setDraftsUpdated(true)
    if (updatedTimer.current) clearTimeout(updatedTimer.current)
    updatedTimer.current = setTimeout(() => setDraftsUpdated(false), 2200)
  }, [])

  // ── Tracking + send menu ─────────────────────────────────────────────────
  const [tracking, setTracking] = useState(true)
  const [sendMenuOpen, setSendMenuOpen] = useState(false)
  const [scheduleView, setScheduleView] = useState<null | 'popover'>(null)
  const [scheduledLabel, setScheduledLabel] = useState<string | null>(null)
  const [sendErrored, setSendErrored] = useState(false)

  // ── Draft (Ask Horace) ───────────────────────────────────────────────────
  const runDraft = useCallback(async () => {
    setScenario('drafting')
    setSendErrored(false)
    try {
      const res = await fetch('/api/email/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact_id: payload.contactId }),
      })
      const data = (await res.json().catch(() => null)) as DraftResponseV3 | null
      if (data?.setup_required) {
        setScenario('setup')
        return
      }
      if (!res.ok || !data?.subject || !data?.body) {
        setScenario('failed-draft')
        return
      }
      setSubject(data.subject)
      if (editor) {
        programmaticFill.current = true
        editor.commands.setContent(bodyTextToHtml(data.body), false)
        setBodyEmpty(editor.isEmpty)
        programmaticFill.current = false
      }
      setSources(data.sources ?? [])
      setActiveSoldIdx(0)
      // Seed an SMS draft derived from the email body so the SMS channel has
      // something useful when first opened. Truncated to 160 chars.
      setSmsText(deriveSmsFromBody(data.body, contact.firstName))
      setDraftedByHorace(true)
      setScenario('drafted')
    } catch {
      setScenario('failed-draft')
    }
  }, [editor, payload.contactId, contact.firstName])

  // Seed flow — Companion may pre-supply a draft.
  const seededDraft = useRef(false)
  useEffect(() => {
    if (!payload.draft || !editor || seededDraft.current) return
    seededDraft.current = true
    setSubject(payload.draft.subject)
    programmaticFill.current = true
    editor.commands.setContent(bodyTextToHtml(payload.draft.body), false)
    setBodyEmpty(editor.isEmpty)
    programmaticFill.current = false
    setSmsText(deriveSmsFromBody(payload.draft.body, contact.firstName))
    setDraftedByHorace(true)
    setScenario('drafted')
  }, [payload.draft, editor, contact.firstName])

  const autoKicked = useRef(false)
  useEffect(() => {
    if (payload.autoDraft && !payload.draft && editor && !autoKicked.current) {
      autoKicked.current = true
      void runDraft()
    }
  }, [payload.autoDraft, payload.draft, editor, runDraft])

  // ── Swap (find-replace in email body + SMS text) ─────────────────────────
  const visibleSources = useMemo(
    () => sources.filter((s) => !mutes[s.type]),
    [sources, mutes],
  )

  const activeSoldRow = visibleSources.find((s) => s.type === 'sold')

  const onPickAlt = useCallback(
    (altIdx: number) => {
      const row = activeSoldRow
      if (!row || !row.alts || !editor) return
      const oldAlt = row.alts[activeSoldIdx]
      const nextAlt = row.alts[altIdx]
      if (!oldAlt || !nextAlt || oldAlt.id === nextAlt.id) {
        setSwapOpen(null)
        return
      }
      // Find-replace street+price in the email body HTML and the SMS text.
      const oldStreet = oldAlt.address.split(',')[0].trim()
      const nextStreet = nextAlt.address.split(',')[0].trim()
      const html = editor.getHTML()
      const newHtml = replaceAll(replaceAll(html, oldStreet, nextStreet), oldAlt.price, nextAlt.price)
      if (newHtml !== html) {
        programmaticFill.current = true
        editor.commands.setContent(newHtml, false)
        programmaticFill.current = false
      }
      setSmsText((prev) => replaceAll(replaceAll(prev, oldStreet, nextStreet), oldAlt.price, nextAlt.price))
      setSources((prev) =>
        prev.map((s) =>
          s.type === 'sold'
            ? { ...s, label: `Sold — ${nextAlt.address} · ${nextAlt.price}`, address: nextAlt.address, price: nextAlt.price }
            : s,
        ),
      )
      setActiveSoldIdx(altIdx)
      setSwapOpen(null)
      flashUpdated()
    },
    [activeSoldRow, activeSoldIdx, editor, flashUpdated],
  )

  const onToggleMute = useCallback(
    (key: keyof MuteState) => {
      setMutes((prev) => {
        const next = { ...prev, [key]: !prev[key] }
        saveMutes(next)
        return next
      })
      setSwapOpen(null)
      flashUpdated()
    },
    [flashUpdated],
  )

  // ── Send (email only) ────────────────────────────────────────────────────
  const hasContent = !!subject.trim() && !bodyEmpty
  const canSend = hasContent && !locked && recipientState === 'ready' && !!contact.email

  const submit = useCallback(
    async (scheduledAtIso?: string) => {
      if (!editor) return
      const bodyHtml = editor.getHTML().trim()
      if (!subject.trim() || !bodyHtml || bodyHtml === '<p></p>') return
      setScenario('sending')
      setSendErrored(false)
      try {
        const res = await fetch('/api/email/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contact_id: payload.contactId,
            to_email: contact.email,
            subject: subject.trim(),
            body_html: bodyHtml,
            tracked: tracking,
            source: payload.source,
            ...(scheduledAtIso ? { scheduled_at: scheduledAtIso } : {}),
          }),
        })
        if (!res.ok) {
          await res.json().catch(() => null as EmailSendErrorBody | null)
          setScenario('failed-send')
          setSendErrored(true)
          return
        }
        if (scheduledAtIso) {
          setScheduledLabel(formatScheduleLabel(scheduledAtIso))
          setCollapsed(true)
          return
        }
        ;(await res.json()) as EmailSendResult
        onClose()
      } catch {
        setScenario('failed-send')
        setSendErrored(true)
      }
    },
    [editor, subject, tracking, contact.email, payload.contactId, payload.source, onClose],
  )

  // ── Copy (SMS) ───────────────────────────────────────────────────────────
  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(smsText)
    } catch {
      /* clipboard blocked — still flash so the agent knows the action fired */
    }
    setCopyState('copied')
    if (copyTimer.current) clearTimeout(copyTimer.current)
    copyTimer.current = setTimeout(() => setCopyState('idle'), 2500)
  }, [smsText])

  // ── Channel switch closes transient overlays ─────────────────────────────
  const switchMode = useCallback((next: ComposerChannel) => {
    setMode(next)
    setSwapOpen(null)
    setSendMenuOpen(false)
    setTipOpen(false)
  }, [])

  const initials = useMemo(() => initialsFor(contact.fullName), [contact.fullName])

  // ── Collapsed / scheduled pinned bar ─────────────────────────────────────
  if (collapsed || scheduledLabel) {
    return (
      <V3Shell rightOffset={rightOffset} mobile={mobile} collapsedBar>
        <V3Header
          title={scheduledLabel ?? headerTitleFor(mode, contact.fullName)}
          mode={mode}
          collapsed
          onCollapse={() => {
            if (scheduledLabel) return
            setCollapsed(false)
          }}
          onClose={onClose}
        />
        <V3Styles />
      </V3Shell>
    )
  }

  const notDrafted = scenario === 'empty' || scenario === 'drafting' || scenario === 'failed-draft' || scenario === 'setup'
  const drafted = !notDrafted

  return (
    <V3Shell rightOffset={rightOffset} mobile={mobile} onScrimClick={() => setCollapsed(true)}>
      <V3Header
        title={headerTitleFor(mode, contact.fullName)}
        mode={mode}
        onCollapse={() => setCollapsed(true)}
        onClose={onClose}
      />

      <V3ChannelSwitcher mode={mode} onChange={switchMode} />

      {/* Scroll body */}
      <div className="or-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        <V3ToRow
          mode={mode}
          fullName={contact.fullName}
          initials={initials}
          email={contact.email}
          phone={contact.phone}
          recipientState={recipientState}
        />

        {mode === 'email' && (
          <V3SubjectRow value={subject} disabled={locked} onChange={setSubject} />
        )}

        {mode !== 'call' && (
          <V3InsightAndContent
            sources={visibleSources}
            mutes={mutes}
            featuredOpen={featuredOpen}
            tipOpen={tipOpen}
            swapOpen={swapOpen}
            activeSoldIdx={activeSoldIdx}
            draftsUpdated={draftsUpdated}
            onToggleFeatured={() => setFeaturedOpen((v) => { if (v) setSwapOpen(null); return !v })}
            onTipEnter={() => setTipOpen(true)}
            onTipLeave={() => setTipOpen(false)}
            onTipToggle={() => setTipOpen((v) => !v)}
            onOpenSwap={(t) => setSwapOpen((cur) => (cur === t ? null : t))}
            onPickAlt={onPickAlt}
            onToggleMute={onToggleMute}
          />
        )}

        {mode === 'email' && (
          <V3EmailBody
            scenario={scenario}
            firstName={contact.firstName}
            drafted={drafted}
            editor={editor}
            onAskHorace={runDraft}
          />
        )}

        {mode === 'sms' && (
          <V3SmsBody value={smsText} onChange={setSmsText} />
        )}

        {mode === 'call' && (
          <V3CallBody firstName={contact.firstName} signalLabel={payload.signalContext?.label} />
        )}
      </div>

      <V3Footer
        mode={mode}
        sending={scenario === 'sending'}
        sent={false /* on send-success the dock closes; no sent pulse needed here */}
        sendDisabled={!canSend && !sendErrored}
        sendErrored={sendErrored}
        tracking={tracking}
        sendMenuOpen={sendMenuOpen}
        copyState={copyState}
        onSend={() => submit()}
        onSendMenuToggle={() => {
          if (canSend || sendErrored) setSendMenuOpen((v) => !v)
        }}
        onSendMenuSelect={(action) => {
          setSendMenuOpen(false)
          if (action === 'send-now') void submit()
          if (action === 'schedule') setScheduleView('popover')
        }}
        onTrackingToggle={() => setTracking((v) => !v)}
        onCopy={onCopy}
        mobile={mobile}
      />

      {/* Schedule popover — rendered at the dock root so V2's hardcoded
          right:16 / bottom:56 anchors to the dock, not the footer. */}
      {scheduleView === 'popover' && (
        <SchedulePopover
          onConfirm={(iso) => {
            setScheduleView(null)
            void submit(iso)
          }}
          onCancel={() => setScheduleView(null)}
        />
      )}

      <V3Styles />
    </V3Shell>
  )
}

// ── V3 helpers ────────────────────────────────────────────────────────────

function headerTitleFor(mode: ComposerChannel, name: string): string {
  if (mode === 'email') return `New email — ${name}`
  if (mode === 'sms') return `New message — ${name}`
  return `Call notes — ${name}`
}

function replaceAll(haystack: string, needle: string, replacement: string): string {
  if (!needle || needle === replacement) return haystack
  return haystack.split(needle).join(replacement)
}

/** Build a 160-char SMS draft from the firewall-safe email body so the SMS
 *  channel has a sensible starting point. Keeps the first non-greeting sentence
 *  + a generic close. Truncated hard at 158 chars + "…". */
function deriveSmsFromBody(body: string, firstName: string): string {
  const lines = body
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l && !/^(hi|hello|hey|warm regards|kind regards|regards|cheers|thanks),?$/i.test(l))
  const opener = `Hi ${firstName.split(/\s+/)[0]}, `
  let text = opener + (lines[0] ?? '')
  if (text.length <= 160) return text
  text = text.slice(0, 158).replace(/\s+\S*$/, '') + '…'
  return text
}

// ── V3 Shell ──────────────────────────────────────────────────────────────

function V3Shell({
  children,
  rightOffset,
  mobile,
  collapsedBar = false,
  onScrimClick,
}: {
  children: React.ReactNode
  rightOffset: number
  mobile: boolean
  collapsedBar?: boolean
  onScrimClick?: () => void
}) {
  const desktop: React.CSSProperties = {
    position: 'fixed',
    bottom: 22,
    right: rightOffset,
    zIndex: 50,
    width: 420,
    maxWidth: 'calc(100vw - 32px)',
    height: collapsedBar ? undefined : 'min(622px, calc(100vh - 48px))',
    background: V3.parchment,
    border: '1px solid rgba(140,123,107,0.2)',
    borderRadius: 12,
    boxShadow: '0 16px 48px rgba(26,22,18,0.2), 0 8px 16px rgba(26,22,18,0.1)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    color: V3.ink,
    fontFamily: V3.font,
    animation: 'or-dockUp 180ms cubic-bezier(0.16,1,0.3,1)',
  }
  const sheet: React.CSSProperties = {
    position: 'fixed',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 51,
    width: 'auto',
    maxWidth: '100vw',
    height: collapsedBar ? undefined : 'min(88vh, calc(100vh - 24px))',
    background: V3.parchment,
    borderTop: '1px solid rgba(140,123,107,0.18)',
    borderRadius: '18px 18px 0 0',
    boxShadow: '0 -8px 32px rgba(26,22,18,0.16)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    color: V3.ink,
    fontFamily: V3.font,
    animation: 'or-dockUp 180ms cubic-bezier(0.16,1,0.3,1)',
  }
  return (
    <>
      {mobile && !collapsedBar && (
        <div
          aria-hidden
          onClick={onScrimClick}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 50,
            background: 'rgba(26,22,18,0.28)',
            backdropFilter: 'blur(2px)',
            WebkitBackdropFilter: 'blur(2px)',
          }}
        />
      )}
      <div
        role="dialog"
        aria-modal={mobile && !collapsedBar ? true : undefined}
        aria-label="Outreach review composer"
        className="or-shell"
        style={mobile ? sheet : desktop}
      >
        {mobile && !collapsedBar && (
          <div
            style={{
              flexShrink: 0,
              display: 'flex',
              justifyContent: 'center',
              padding: '8px 0 0',
              background: V3.headBg,
            }}
            aria-hidden
          >
            <div style={{ width: 36, height: 4, borderRadius: 9999, background: 'rgba(140,123,107,0.35)' }} />
          </div>
        )}
        {children}
      </div>
    </>
  )
}

// ── V3 Header ─────────────────────────────────────────────────────────────

function V3Header({
  title,
  mode,
  collapsed = false,
  onCollapse,
  onClose,
}: {
  title: string
  mode: ComposerChannel
  collapsed?: boolean
  onCollapse: () => void
  onClose: () => void
}) {
  return (
    <div
      style={{
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '14px 18px',
        background: V3.headBg,
        borderBottom: collapsed ? 'none' : `1px solid ${V3.border}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
        <V3ChannelIcon mode={mode} size={19} stroke={1.7} color={V3.ink} />
        <span
          style={{
            fontSize: 16,
            fontWeight: 600,
            color: V3.ink,
            fontFamily: V3.font,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {title}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        <V3IconBtn label={collapsed ? 'Expand' : 'Minimise'} onClick={onCollapse}>
          {collapsed ? <ChevronRight size={18} /> : <ChevronDown size={18} />}
        </V3IconBtn>
        <V3IconBtn label="Close" onClick={onClose}>
          <X size={18} />
        </V3IconBtn>
      </div>
    </div>
  )
}

function V3IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="or-icon-btn"
      style={{
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        color: V3.stone,
        padding: 4,
        borderRadius: 5,
        display: 'flex',
        lineHeight: 0,
      }}
    >
      {children}
    </button>
  )
}

function V3ChannelIcon({ mode, size = 14, stroke = 1.8, color = 'currentColor' }: { mode: ComposerChannel; size?: number; stroke?: number; color?: string }) {
  const props = { size, color, strokeWidth: stroke }
  if (mode === 'email') return <Mail {...props} />
  if (mode === 'sms') return <MessageSquare {...props} />
  return <Phone {...props} />
}

// ── V3 Channel switcher ───────────────────────────────────────────────────

function V3ChannelSwitcher({ mode, onChange }: { mode: ComposerChannel; onChange: (m: ComposerChannel) => void }) {
  const seg = (id: ComposerChannel, label: string) => {
    const active = mode === id
    return (
      <button
        key={id}
        type="button"
        role="tab"
        aria-selected={active}
        onClick={() => onChange(id)}
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          padding: '7px 6px',
          borderRadius: 5,
          border: 'none',
          cursor: 'pointer',
          fontFamily: V3.font,
          fontSize: 12.5,
          fontWeight: 600,
          background: active ? V3.surface : 'transparent',
          boxShadow: active ? '0 1px 2px rgba(26,22,18,0.06)' : 'none',
          color: active ? V3.channelAccent[id] : V3.stone,
          transition: 'color 150ms, background 150ms, box-shadow 150ms',
        }}
      >
        <V3ChannelIcon mode={id} size={14} stroke={1.8} />
        {label}
      </button>
    )
  }
  return (
    <div style={{ flexShrink: 0, padding: '12px 18px 0' }}>
      <div
        role="tablist"
        aria-label="Outreach channel"
        style={{
          display: 'flex',
          gap: 3,
          padding: 3,
          background: V3.segTrack,
          borderRadius: 7,
        }}
      >
        {seg('email', 'Email')}
        {seg('sms', 'SMS')}
        {seg('call', 'Call notes')}
      </div>
    </div>
  )
}

// ── V3 TO row ─────────────────────────────────────────────────────────────

function V3ToRow({
  mode,
  fullName,
  initials,
  email,
  phone,
  recipientState,
}: {
  mode: ComposerChannel
  fullName: string
  initials: string
  email: string | null
  phone: string | null
  recipientState: 'ready' | 'resolving' | 'missing'
}) {
  const label = mode === 'call' ? 'Call' : 'To'
  const detail =
    mode === 'email'
      ? email ?? (recipientState === 'resolving' ? 'Finding email…' : 'No email on file')
      : phone ?? (recipientState === 'resolving' ? 'Finding number…' : 'No number on file')
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 18px',
        borderBottom: `1px solid ${V3.borderSoft}`,
      }}
    >
      <span
        style={{
          width: 52,
          flexShrink: 0,
          fontSize: 10.5,
          fontWeight: 600,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: V3.stone,
          fontFamily: V3.font,
        }}
      >
        {label}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 7,
            background: V3.cream,
            border: `1px solid ${V3.borderStrong}`,
            borderRadius: 9999,
            padding: '3px 12px 3px 4px',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              width: 22,
              height: 22,
              borderRadius: '50%',
              background: 'rgba(196,98,45,0.14)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 9.5,
              fontWeight: 600,
              color: V3.terracotta,
              fontFamily: V3.font,
            }}
          >
            {initials}
          </div>
          <span style={{ fontSize: 13, fontWeight: 500, color: V3.ink, fontFamily: V3.font }}>{fullName}</span>
        </div>
        <span
          style={{
            fontFamily: V3.mono,
            fontSize: 12,
            color: V3.stone,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {detail}
        </span>
      </div>
    </div>
  )
}

// ── V3 Subject row ────────────────────────────────────────────────────────

function V3SubjectRow({ value, disabled, onChange }: { value: string; disabled: boolean; onChange: (v: string) => void }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '11px 18px',
        borderBottom: `1px solid ${V3.borderSoft}`,
      }}
    >
      <span
        style={{
          width: 52,
          flexShrink: 0,
          fontSize: 10.5,
          fontWeight: 600,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: V3.stone,
          fontFamily: V3.font,
        }}
      >
        Subject
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="A short, specific subject line"
        disabled={disabled}
        maxLength={200}
        style={{
          flex: 1,
          minWidth: 0,
          border: 'none',
          background: 'transparent',
          outline: 'none',
          fontSize: 14.5,
          color: V3.ink,
          fontFamily: V3.font,
        }}
      />
    </div>
  )
}

// ── V3 Insight & Content panel ────────────────────────────────────────────

function V3InsightAndContent({
  sources,
  mutes,
  featuredOpen,
  tipOpen,
  swapOpen,
  activeSoldIdx,
  draftsUpdated,
  onToggleFeatured,
  onTipEnter,
  onTipLeave,
  onTipToggle,
  onOpenSwap,
  onPickAlt,
  onToggleMute,
}: {
  sources: ContentSource[]
  mutes: MuteState
  featuredOpen: boolean
  tipOpen: boolean
  swapOpen: ContentSourceType | null
  activeSoldIdx: number
  draftsUpdated: boolean
  onToggleFeatured: () => void
  onTipEnter: () => void
  onTipLeave: () => void
  onTipToggle: () => void
  onOpenSwap: (t: ContentSourceType) => void
  onPickAlt: (idx: number) => void
  onToggleMute: (k: keyof MuteState) => void
}) {
  if (sources.length === 0) return null
  const countLabel = `· ${sources.length} source${sources.length === 1 ? '' : 's'}`
  return (
    <div
      style={{
        padding: '11px 18px',
        borderBottom: `1px solid ${V3.borderSoft}`,
        background: V3.rowBg,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
        <button
          type="button"
          onClick={onToggleFeatured}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
          }}
        >
          <ChevronRight
            size={13}
            color={V3.stone}
            style={{ transform: featuredOpen ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 150ms', flexShrink: 0 }}
          />
          <span
            style={{
              fontSize: 10.5,
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: V3.stone,
              fontFamily: V3.font,
            }}
          >
            Insight and Content
          </span>
          <span style={{ fontSize: 11.5, color: V3.stoneSoft, fontFamily: V3.font }}>{countLabel}</span>
        </button>
        <span style={{ position: 'relative', display: 'flex' }} onMouseEnter={onTipEnter} onMouseLeave={onTipLeave}>
          <button
            type="button"
            onClick={onTipToggle}
            aria-label="Why this content was used"
            style={{ display: 'flex', background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: V3.stoneSoft, lineHeight: 0 }}
            className="or-tip-icon"
          >
            <Info size={13} />
          </button>
          {tipOpen && (
            <div
              role="tooltip"
              style={{
                position: 'absolute',
                top: 'calc(100% + 7px)',
                left: -10,
                zIndex: 70,
                width: 228,
                background: V3.charcoal,
                color: V3.parchment,
                fontSize: 11.5,
                lineHeight: 1.5,
                fontFamily: V3.font,
                padding: '9px 11px',
                borderRadius: 7,
                boxShadow: '0 8px 24px rgba(26,22,18,0.26)',
              }}
            >
              This content was utilised as part of this messaging based upon the prospect&apos;s behaviour on site.
            </div>
          )}
        </span>
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5 }}>
          {draftsUpdated && (
            <span style={{ fontSize: 10.5, color: V3.moss, fontFamily: V3.font, display: 'flex', alignItems: 'center', gap: 4 }}>
              <Check size={11} strokeWidth={2.4} />
              Updated
            </span>
          )}
          {!featuredOpen && (
            <span style={{ display: 'flex', gap: 4 }}>
              {sources.map((s, i) => (
                <span
                  key={s.id ?? i}
                  style={{ width: 6, height: 6, borderRadius: '50%', background: 'rgba(196,98,45,0.55)' }}
                  aria-hidden
                />
              ))}
            </span>
          )}
        </span>
      </div>

      {featuredOpen && (
        <div style={{ marginTop: 10 }}>
          {sources.map((row) => (
            <V3SourceRow
              key={row.id}
              row={row}
              activeSoldIdx={activeSoldIdx}
              swapOpen={swapOpen === row.type}
              onOpenSwap={() => onOpenSwap(row.type)}
              onPickAlt={onPickAlt}
            />
          ))}

          <div style={{ marginTop: 10, paddingTop: 9, borderTop: '1px solid rgba(140,123,107,0.14)' }}>
            <div
              style={{
                fontSize: 9.5,
                fontWeight: 600,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: V3.stone,
                fontFamily: V3.font,
                marginBottom: 4,
              }}
            >
              Never insert
            </div>
            <V3MuteRow label="Listings" on={mutes.listings} onToggle={() => onToggleMute('listings')} />
            <V3MuteRow label="Sold results" on={mutes.sold} onToggle={() => onToggleMute('sold')} />
            <V3MuteRow label="Suburb reports" on={mutes.reports} onToggle={() => onToggleMute('reports')} />
          </div>
        </div>
      )}
    </div>
  )
}

function V3SourceRow({
  row,
  activeSoldIdx,
  swapOpen,
  onOpenSwap,
  onPickAlt,
}: {
  row: ContentSource
  activeSoldIdx: number
  swapOpen: boolean
  onOpenSwap: () => void
  onPickAlt: (idx: number) => void
}) {
  const tagViewed = row.tag === 'viewed'
  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 9px',
        border: '1px solid rgba(140,123,107,0.2)',
        borderRadius: 6,
        background: V3.surface,
        marginBottom: 6,
      }}
    >
      <div
        style={{
          width: 26,
          height: 26,
          borderRadius: 6,
          background: 'rgba(196,98,45,0.1)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: V3.terracotta,
          flexShrink: 0,
        }}
      >
        <V3SourceIcon type={row.type} />
      </div>
      {row.url ? (
        <a
          href={row.url}
          target="_blank"
          rel="noreferrer noopener"
          title={row.label}
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 12.5,
            fontWeight: 500,
            color: V3.ink,
            fontFamily: V3.font,
            textDecoration: 'none',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
          className="or-source-link"
        >
          {row.label}
        </a>
      ) : (
        <span
          title={row.label}
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 12.5,
            fontWeight: 500,
            color: V3.ink,
            fontFamily: V3.font,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {row.label}
        </span>
      )}
      <span
        style={{
          flexShrink: 0,
          fontSize: 9,
          fontWeight: 600,
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
          padding: '2px 7px',
          borderRadius: 9999,
          fontFamily: V3.font,
          whiteSpace: 'nowrap',
          background: tagViewed ? 'rgba(140,123,107,0.16)' : 'rgba(196,98,45,0.12)',
          color: tagViewed ? V3.stoneAA : V3.terracotta,
        }}
      >
        {tagViewed ? 'Viewed' : 'Relevant'}
      </span>
      {row.alts && row.alts.length > 1 && (
        <>
          <button
            type="button"
            onClick={onOpenSwap}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              flexShrink: 0,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: 11,
              fontWeight: 600,
              color: V3.stone,
              fontFamily: V3.font,
              padding: '3px 5px',
              borderRadius: 4,
            }}
            className="or-swap-btn"
          >
            <Repeat size={12} strokeWidth={1.9} />
            Swap
          </button>
          {swapOpen && (
            <div
              style={{
                position: 'absolute',
                top: 'calc(100% + 5px)',
                right: 0,
                zIndex: 50,
                width: 262,
                background: V3.surface,
                border: '1px solid rgba(140,123,107,0.25)',
                borderRadius: 8,
                boxShadow: '0 8px 32px rgba(26,22,18,0.16), 0 4px 8px rgba(26,22,18,0.08)',
                padding: 6,
                animation: 'or-popRise 120ms cubic-bezier(0.16,1,0.3,1)',
              }}
            >
              <div
                style={{
                  fontSize: 9.5,
                  fontWeight: 600,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: V3.stone,
                  fontFamily: V3.font,
                  padding: '6px 8px 4px',
                }}
              >
                Other matched results
              </div>
              {row.alts.map((alt, i) => {
                const active = i === activeSoldIdx
                return (
                  <button
                    key={alt.id}
                    type="button"
                    onClick={() => onPickAlt(i)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      width: '100%',
                      textAlign: 'left',
                      padding: 8,
                      borderRadius: 5,
                      border: 'none',
                      cursor: 'pointer',
                      background: active ? 'rgba(196,98,45,0.08)' : 'transparent',
                      fontFamily: V3.font,
                      fontSize: 12,
                      fontWeight: active ? 600 : 400,
                      color: active ? V3.terracotta : V3.charcoal,
                    }}
                  >
                    <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{alt.label}</span>
                    {active && <Check size={13} color={V3.terracotta} strokeWidth={2.4} style={{ flexShrink: 0 }} />}
                  </button>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function V3SourceIcon({ type }: { type: ContentSourceType }) {
  if (type === 'listings') return <Home size={15} strokeWidth={1.7} />
  if (type === 'sold') return <TrendingUp size={15} strokeWidth={1.7} />
  return <FileText size={15} strokeWidth={1.7} />
}

function V3MuteRow({ label, on, onToggle }: { label: string; on: boolean; onToggle: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 0' }}>
      <span style={{ fontSize: 12.5, color: V3.ink, fontFamily: V3.font }}>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={`Never insert ${label}`}
        onClick={onToggle}
        style={{
          width: 34,
          height: 20,
          borderRadius: 9999,
          border: 'none',
          cursor: 'pointer',
          padding: 2,
          display: 'flex',
          flexShrink: 0,
          background: on ? V3.terracotta : 'rgba(140,123,107,0.35)',
          justifyContent: on ? 'flex-end' : 'flex-start',
          transition: 'background 150ms',
        }}
      >
        <span
          style={{
            width: 16,
            height: 16,
            borderRadius: '50%',
            background: V3.surface,
            boxShadow: '0 1px 2px rgba(26,22,18,0.2)',
          }}
        />
      </button>
    </div>
  )
}

// ── V3 Email body (drafted + empty) ───────────────────────────────────────

function V3EmailBody({
  scenario,
  firstName,
  drafted,
  editor,
  onAskHorace,
}: {
  scenario: ComposerScenario
  firstName: string
  drafted: boolean
  editor: ReturnType<typeof useEditor>
  onAskHorace: () => void
}) {
  if (scenario === 'drafting') {
    return (
      <div style={{ padding: '14px 18px 18px' }} aria-live="polite">
        <V3DraftingShimmer />
      </div>
    )
  }
  if (scenario === 'failed-draft') {
    return (
      <div style={{ padding: '32px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 12 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/horace-parchment.png" alt="" width={36} height={36} style={{ borderRadius: '50%' }} />
        <p style={{ margin: 0, fontSize: 13, color: V3.stoneAA, fontFamily: V3.font, maxWidth: 270, lineHeight: 1.5 }}>
          Horace couldn&apos;t draft this one. Try again, or write it yourself.
        </p>
        <button
          type="button"
          onClick={onAskHorace}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 7,
            padding: '8px 15px',
            borderRadius: 9999,
            background: V3.surface,
            border: `1px solid rgba(196,98,45,0.25)`,
            cursor: 'pointer',
            fontFamily: V3.font,
            fontWeight: 600,
            fontSize: 13,
            color: V3.ink,
          }}
        >
          Ask Horace again
        </button>
      </div>
    )
  }
  if (scenario === 'setup') {
    return (
      <div style={{ padding: '32px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 12 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/horace-parchment.png" alt="" width={36} height={36} style={{ borderRadius: '50%' }} />
        <p style={{ margin: 0, fontSize: 13, color: V3.stoneAA, fontFamily: V3.font, maxWidth: 270, lineHeight: 1.5 }}>
          Before I draft in your voice, I need your brand voice and signature — a two-minute setup.
        </p>
        <a
          href="/settings#brand-voice"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '9px 16px',
            borderRadius: 8,
            background: V3.terracotta,
            color: V3.cream,
            textDecoration: 'none',
            fontSize: 13,
            fontWeight: 600,
            fontFamily: V3.font,
          }}
        >
          Set up your voice
        </a>
      </div>
    )
  }
  if (!drafted) {
    // Empty / pre-draft state — Ask Horace pill (matches design exactly)
    return (
      <div
        style={{
          padding: '48px 24px 40px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          minHeight: 196,
        }}
        role="tabpanel"
        aria-label="Email draft — empty"
      >
        <button
          type="button"
          onClick={onAskHorace}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 12,
            background: V3.surface,
            border: `1px solid rgba(196,98,45,0.25)`,
            borderRadius: 9999,
            padding: '9px 22px 9px 11px',
            cursor: 'pointer',
            animation: 'or-glowPulse 2.6s ease-in-out infinite',
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/horace-parchment.png" alt="Horace" width={38} height={38} style={{ borderRadius: '50%', objectFit: 'cover', flexShrink: 0, display: 'block' }} />
          <span style={{ textAlign: 'left' }}>
            <span style={{ display: 'block', fontSize: 15, fontWeight: 600, color: V3.ink, fontFamily: V3.font }}>
              Ask Horace to draft
            </span>
            <span style={{ display: 'block', fontSize: 12, color: V3.stone, fontFamily: V3.font, marginTop: 1 }}>
              From {firstName}&apos;s recent activity
            </span>
          </span>
        </button>
        <div style={{ marginTop: 18, fontSize: 13.5, color: V3.stone, fontFamily: V3.font, lineHeight: 1.5 }}>
          It&apos;s your email, in your voice —
          <br />
          <button
            type="button"
            onClick={onAskHorace}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              color: V3.terracotta,
              textDecoration: 'underline',
              fontWeight: 600,
              fontFamily: V3.font,
              fontSize: 13.5,
            }}
          >
            just start writing
          </button>
          .
        </div>
      </div>
    )
  }
  // Drafted / edited / sending — the TipTap editor renders here, styled
  // borderless to match the design's "borderless, auto-growing textarea" look.
  return (
    <div style={{ padding: '14px 18px 18px' }} role="tabpanel" aria-label="Email draft">
      <EditorContent editor={editor} />
    </div>
  )
}

function V3DraftingShimmer() {
  const bar = (w: string, mt: number, key: string) => (
    <div
      key={key}
      style={{
        height: 10,
        width: w,
        borderRadius: 5,
        background: 'rgba(140,123,107,0.22)',
        marginTop: mt,
        animation: 'cdock-shimmer 1.4s ease-in-out infinite',
      }}
    />
  )
  return (
    <div>
      {bar('42%', 0, 'a')}
      {bar('92%', 14, 'b')}
      {bar('86%', 9, 'c')}
      {bar('64%', 9, 'd')}
      {bar('80%', 18, 'e')}
      {bar('44%', 9, 'f')}
    </div>
  )
}

// ── V3 SMS body ───────────────────────────────────────────────────────────

function V3SmsBody({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const charCount = value.length
  const over = charCount > 160
  return (
    <div role="tabpanel" aria-label="SMS draft" style={{ padding: '14px 18px 16px' }}>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Hi …"
        style={{
          width: '100%',
          boxSizing: 'border-box',
          minHeight: 104,
          border: 'none',
          background: 'transparent',
          outline: 'none',
          resize: 'none',
          fontSize: 14,
          lineHeight: 1.6,
          color: V3.ink,
          fontFamily: V3.font,
        }}
      />
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
        <span style={{ fontFamily: V3.mono, fontSize: 11, color: over ? V3.error : V3.stone, fontWeight: over ? 600 : 400 }}>
          {charCount} / 160
        </span>
      </div>
    </div>
  )
}

// ── V3 Call notes body ────────────────────────────────────────────────────

function V3CallBody({ firstName, signalLabel }: { firstName: string; signalLabel?: string }) {
  // The call-notes content is reference-only — never sent. Spoken opener stays
  // generic + warm; the "your eyes only" card carries the agent-private signal
  // context when one was supplied by the launching surface, falling back to a
  // neutral coaching note otherwise. (The firewall still applies: nothing here
  // is ever shown to the lead.)
  const coaching =
    signalLabel?.trim()
      ? `${signalLabel.trim()} — strong pre-listing behaviour. Don't reveal you can see this; let ${firstName} raise selling. Lead with the recent local sale as a natural in.`
      : `Reference recent local activity in their suburb as a natural opener. Don't reveal site-behaviour signals — let ${firstName} raise selling.`
  return (
    <div
      role="tabpanel"
      aria-label="Call notes"
      style={{ padding: '14px 18px 16px', display: 'flex', flexDirection: 'column', gap: 11 }}
    >
      <div
        style={{
          border: '1px solid rgba(140,123,107,0.22)',
          borderRadius: 7,
          background: V3.surface,
          padding: '11px 12px',
        }}
      >
        <div
          style={{
            fontSize: 9.5,
            fontWeight: 600,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: V3.stone,
            fontFamily: V3.font,
            marginBottom: 6,
          }}
        >
          Spoken opener
        </div>
        <p style={{ fontSize: 13, lineHeight: 1.55, color: V3.ink, fontFamily: V3.font, margin: 0 }}>
          &ldquo;Hi {firstName} — is now a good time? I was just going over recent sales in your area and thought of you.&rdquo;
        </p>
      </div>
      <div
        style={{
          border: '1px solid rgba(140,123,107,0.4)',
          borderRadius: 7,
          background: 'rgba(140,123,107,0.07)',
          padding: '11px 12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 7, color: V3.stoneAA }}>
          <Lock size={13} strokeWidth={1.9} style={{ flexShrink: 0 }} />
          <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', fontFamily: V3.font }}>
            Your eyes only · never say this to the lead
          </span>
        </div>
        <p style={{ fontSize: 12.5, lineHeight: 1.55, color: V3.charcoal, fontFamily: V3.font, margin: 0 }}>
          {coaching}
        </p>
      </div>
    </div>
  )
}

// ── V3 Footer ─────────────────────────────────────────────────────────────

function V3Footer({
  mode,
  sending,
  sent,
  sendDisabled,
  sendErrored,
  tracking,
  sendMenuOpen,
  copyState,
  onSend,
  onSendMenuToggle,
  onSendMenuSelect,
  onTrackingToggle,
  onCopy,
  mobile,
}: {
  mode: ComposerChannel
  sending: boolean
  sent: boolean
  sendDisabled: boolean
  sendErrored: boolean
  tracking: boolean
  sendMenuOpen: boolean
  copyState: 'idle' | 'copied'
  onSend: () => void
  onSendMenuToggle: () => void
  onSendMenuSelect: (action: 'send-now' | 'schedule' | 'save-draft') => void
  onTrackingToggle: () => void
  onCopy: () => void
  mobile: boolean
}) {
  return (
    <div
      style={{
        flexShrink: 0,
        position: 'relative',
        padding: mobile ? '13px 18px calc(13px + env(safe-area-inset-bottom))' : '12px 18px',
        borderTop: `1px solid ${V3.border}`,
        background: V3.headBg,
      }}
    >
      {mode === 'email' && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <button
              type="button"
              aria-pressed={tracking}
              onClick={onTrackingToggle}
              style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'none', border: 'none', cursor: 'pointer', padding: '4px 2px' }}
            >
              <span
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: '50%',
                  background: tracking ? V3.moss : 'transparent',
                  border: tracking ? 'none' : `1.5px solid ${V3.stone}`,
                  boxShadow: tracking ? '0 0 0 3px rgba(61,82,70,0.16)' : 'none',
                  transition: 'all 150ms',
                  flexShrink: 0,
                }}
              />
              <span style={{ fontSize: 12.5, fontWeight: 600, color: V3.ink, fontFamily: V3.font }}>Tracking</span>
              <span style={{ fontSize: 12.5, color: V3.stone, fontFamily: V3.font }}>{tracking ? 'on' : 'off'}</span>
            </button>
            <V3SendSplit
              sending={sending}
              sent={sent}
              disabled={sendDisabled}
              onSend={onSend}
              onMenu={onSendMenuToggle}
            />
          </div>
          {sendErrored && (
            <div aria-live="polite" style={{ fontSize: 11.5, color: V3.error, fontFamily: V3.font, marginTop: 7, textAlign: 'right' }}>
              Send failed — try again.
            </div>
          )}
          {sendMenuOpen && (
            <div
              role="menu"
              style={{
                position: 'absolute',
                bottom: 'calc(100% + 6px)',
                right: 18,
                zIndex: 60,
                width: 188,
                background: V3.surface,
                border: '1px solid rgba(140,123,107,0.25)',
                borderRadius: 8,
                boxShadow: '0 8px 32px rgba(26,22,18,0.16), 0 4px 8px rgba(26,22,18,0.08)',
                padding: 5,
                animation: 'or-popRise 120ms cubic-bezier(0.16,1,0.3,1)',
              }}
            >
              <V3MenuItem label="Send now" onClick={() => onSendMenuSelect('send-now')} />
              <V3MenuItem label="Schedule send…" onClick={() => onSendMenuSelect('schedule')} />
              <V3MenuItem label="Save as draft" onClick={() => onSendMenuSelect('save-draft')} disabled />
            </div>
          )}
          {/* aria-live status region */}
          <span aria-live="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
            {sending ? 'Sending email' : ''}
          </span>
        </>
      )}

      {mode === 'sms' && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <span style={{ fontSize: 11.5, color: V3.stone, fontFamily: V3.font }}>Copy &amp; paste into Messages.</span>
          <button
            type="button"
            onClick={onCopy}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              flexShrink: 0,
              padding: '9px 16px',
              borderRadius: 7,
              cursor: 'pointer',
              fontFamily: V3.font,
              fontSize: 13,
              fontWeight: 600,
              transition: 'all 150ms',
              background: copyState === 'copied' ? 'rgba(61,82,70,0.12)' : 'transparent',
              border: `1px solid ${copyState === 'copied' ? 'rgba(61,82,70,0.4)' : V3.borderStrong}`,
              color: copyState === 'copied' ? V3.moss : V3.ink,
            }}
          >
            {copyState === 'copied' ? (
              <Check size={14} strokeWidth={2.4} style={{ animation: 'or-checkIn 150ms cubic-bezier(0.16,1,0.3,1)' }} />
            ) : (
              <Copy size={14} strokeWidth={1.8} />
            )}
            {copyState === 'copied' ? 'Copied' : 'Copy'}
          </button>
        </div>
      )}

      {mode === 'call' && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, color: V3.stone }}>
          <Info size={13} strokeWidth={1.8} />
          <span style={{ fontSize: 12, fontWeight: 500, fontFamily: V3.font }}>
            Reference while you call — nothing is sent.
          </span>
        </div>
      )}
    </div>
  )
}

function V3SendSplit({
  sending,
  sent,
  disabled,
  onSend,
  onMenu,
}: {
  sending: boolean
  sent: boolean
  disabled: boolean
  onSend: () => void
  onMenu: () => void
}) {
  const bg = sent ? V3.moss : V3.terracotta
  const chevBg = sent ? V3.mossDark : V3.terracottaDark
  const opacity = sending ? 0.75 : disabled ? 0.5 : 1
  return (
    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'stretch' }}>
      <button
        type="button"
        onClick={onSend}
        disabled={disabled || sending || sent}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          padding: '10px 15px',
          border: 'none',
          cursor: disabled || sending || sent ? 'default' : 'pointer',
          fontFamily: V3.font,
          fontSize: 13.5,
          fontWeight: 600,
          background: bg,
          color: V3.cream,
          borderRadius: '8px 0 0 8px',
          opacity,
          transition: 'background 150ms, opacity 150ms',
        }}
      >
        {sent ? (
          <Check size={15} strokeWidth={2.4} style={{ animation: 'or-checkIn 150ms cubic-bezier(0.16,1,0.3,1)' }} />
        ) : (
          <Send size={15} strokeWidth={1.8} />
        )}
        {sending ? 'Sending…' : sent ? 'Sent' : 'Send'}
      </button>
      <button
        type="button"
        onClick={onMenu}
        disabled={disabled || sending || sent}
        aria-label="Send options"
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '10px 9px',
          border: 'none',
          cursor: disabled || sending || sent ? 'default' : 'pointer',
          background: chevBg,
          color: V3.cream,
          borderRadius: '0 8px 8px 0',
          borderLeft: '1px solid rgba(255,255,255,0.22)',
          opacity,
        }}
      >
        <ChevronDown size={14} strokeWidth={2} />
      </button>
    </div>
  )
}

function V3MenuItem({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      role="menuitem"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        width: '100%',
        textAlign: 'left',
        padding: '8px 9px',
        border: 'none',
        borderRadius: 5,
        cursor: disabled ? 'not-allowed' : 'pointer',
        background: 'transparent',
        fontFamily: V3.font,
        fontSize: 12.5,
        color: disabled ? V3.stoneSoft : V3.ink,
      }}
      className="or-menu-item"
    >
      {label}
    </button>
  )
}

// ── V3 styles ─────────────────────────────────────────────────────────────

function V3Styles() {
  return (
    <style jsx global>{`
      @keyframes or-dockUp {
        from { opacity: 0; transform: translateY(16px); }
        to { opacity: 1; transform: translateY(0); }
      }
      @keyframes or-popRise {
        from { opacity: 0; transform: translateY(4px); }
        to { opacity: 1; transform: translateY(0); }
      }
      @keyframes or-checkIn {
        from { opacity: 0; transform: scale(0.6); }
        to { opacity: 1; transform: scale(1); }
      }
      @keyframes or-glowPulse {
        0%, 100% { box-shadow: 0 4px 18px rgba(196,98,45,0.16); }
        50%      { box-shadow: 0 4px 24px rgba(196,98,45,0.3); }
      }
      .or-scroll::-webkit-scrollbar { width: 6px; }
      .or-scroll::-webkit-scrollbar-track { background: transparent; }
      .or-scroll::-webkit-scrollbar-thumb { background: rgba(140,123,107,0.25); border-radius: 3px; }
      .or-icon-btn:hover { background: rgba(140,123,107,0.14); color: #1A1612; }
      .or-tip-icon:hover { color: #C4622D; }
      .or-source-link:hover { color: #C4622D; text-decoration: underline; }
      .or-swap-btn:hover { color: #C4622D; background: rgba(196,98,45,0.08); }
      .or-menu-item:hover:not(:disabled) { background: rgba(140,123,107,0.1); }
      .composer-dock-editor-v3 {
        min-height: 196px;
        outline: none;
        font-family: 'DM Sans', var(--font-body), sans-serif;
        font-size: 14px;
        line-height: 1.65;
        color: #1A1612;
      }
      .composer-dock-editor-v3 p { margin: 0 0 14px; }
      .composer-dock-editor-v3 p:last-child { margin-bottom: 0; }
      .composer-dock-editor-v3 a { color: #C4622D; text-decoration: underline; }
      @media (prefers-reduced-motion: reduce) {
        .or-shell,
        .or-shell * { animation-duration: 0.001ms !important; }
      }
    `}</style>
  )
}
