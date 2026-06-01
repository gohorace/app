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
  Send,
  Clock,
  ChevronDown,
  ChevronRight,
  X,
  Eye,
  Lock,
  ArrowUp,
} from 'lucide-react'

import type {
  ComposerGuardrail,
  ComposerScenario,
  OpenComposerOptions,
} from '@/lib/email/composer-dock-types'
import type { EmailSendErrorBody, EmailSendResult } from '@/lib/email/types'

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

export function ComposerDock({ payload, onClose, rightOffset = 24, focusNonce = 0 }: ComposerDockProps) {
  const name = (payload.contactName?.trim() || payload.recipient).trim()
  const firstName = name.split(/\s+/)[0] || name
  const mobile = useIsMobile()

  const [scenario, setScenario] = useState<ComposerScenario>(
    payload.autoDraft ? 'drafting' : 'empty',
  )
  const [collapsed, setCollapsed] = useState(false)
  const [subject, setSubject] = useState('')
  const [draftedByHorace, setDraftedByHorace] = useState(false)
  const [guardrail, setGuardrail] = useState<ComposerGuardrail>(null)
  const [scheduleView, setScheduleView] = useState<null | 'menu' | 'popover'>(null)
  const [scheduledLabel, setScheduledLabel] = useState<string | null>(null)
  const [writing, setWriting] = useState(false)
  const [bodyEmpty, setBodyEmpty] = useState(true)

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

  // Companion entry auto-drafts on open (once the editor is ready).
  const autoKicked = useRef(false)
  useEffect(() => {
    if (payload.autoDraft && editor && !autoKicked.current) {
      autoKicked.current = true
      void runDraft()
    }
  }, [payload.autoDraft, editor, runDraft])

  // ── Recipient guardrail check (#3) ────────────────────────────────────────
  useEffect(() => {
    const email = payload.recipient.trim().toLowerCase()
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
  }, [payload.recipient])

  const sendBlocked = guardrail === 'unsubscribed' || guardrail === 'excluded'
  const tracked = guardrail !== 'untracked'
  const hasContent = !!subject.trim() && !bodyEmpty
  const canSend = hasContent && !sendBlocked && !locked

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
            to_email: payload.recipient,
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
    [editor, subject, tracked, payload.contactId, payload.recipient, payload.source, onClose],
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
            {guardrail !== 'untracked' ? (
              <span style={{ fontSize: 11.5, color: 'var(--color-stone)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {payload.recipient}
              </span>
            ) : (
              <span style={{ fontSize: 11.5, color: WARN, fontFamily: 'var(--font-mono)' }}>edited address</span>
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
        {scenario === 'failed-draft' && <FailedDraftBody onRetry={runDraft} />}
        {scenario === 'setup' && <SetupBody />}
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
        <button
          type="button"
          onClick={onStartWriting}
          style={{ margin: 0, maxWidth: 250, textAlign: 'center', fontSize: 12, color: 'var(--color-stone)', fontFamily: 'var(--font-body)', lineHeight: 1.5, background: 'none', border: 'none', cursor: 'text' }}
        >
          Or just start writing — it’s your email, in your voice.
        </button>
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

function FailedDraftBody({ onRetry }: { onRetry: () => void }) {
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
    </div>
  )
}

function SetupBody() {
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
      <span style={{ fontSize: 11.5, color: 'var(--color-stone)', fontFamily: 'var(--font-body)' }}>Or write this one yourself</span>
    </div>
  )
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
