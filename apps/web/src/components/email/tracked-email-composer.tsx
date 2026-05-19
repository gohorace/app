'use client'

/**
 * Tracked-email composer modal (HOR-226 / slice D).
 *
 * TipTap-backed rich-text editor inside a custom modal (matches Horace's
 * `attach-role-dialog` pattern — no Radix Dialog dependency).
 *
 * The composer:
 *   - defaults `to_email` from the contact, allows override
 *   - shows an inline banner when the recipient is on the agent's exclusion
 *     list or has unsubscribed (via /api/email/check-recipient)
 *   - has a "Tracking on/off" toggle (default on)
 *   - on Send: POST /api/email/send → close + onSent callback
 *
 * SSR note: TipTap doesn't SSR. We render the editor only in the client
 * (the parent uses next/dynamic with `ssr: false` to load this component).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import {
  AlertTriangle,
  Bold,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Loader2,
  ShieldOff,
  X,
} from 'lucide-react'

import type {
  EmailSendErrorBody,
  EmailSendPayload,
  EmailSendResult,
} from '@/lib/email/types'

export interface TrackedEmailComposerProps {
  contactId: string
  defaultToEmail: string
  contactName?: string | null
  /** Where the composer was opened from. Default 'ui'. */
  source?: 'ui' | 'digest_prompt'
  onClose: () => void
  onSent?: (result: EmailSendResult) => void
}

interface RecipientCheck {
  excluded: boolean
  reason: string | null
}

export function TrackedEmailComposer({
  contactId,
  defaultToEmail,
  contactName,
  source = 'ui',
  onClose,
  onSent,
}: TrackedEmailComposerProps) {
  const [toEmail, setToEmail] = useState(defaultToEmail)
  const [subject, setSubject] = useState('')
  const [tracked, setTracked] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recipientCheck, setRecipientCheck] = useState<RecipientCheck | null>(null)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,        // no headings in 1:1 prospect emails
        horizontalRule: false, // no <hr> noise
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: {
          rel: 'noopener noreferrer nofollow',
          target: '_blank',
        },
      }),
    ],
    content: '<p></p>',
    autofocus: false,
    editorProps: {
      attributes: {
        class: 'tracked-email-editor-content',
      },
    },
    // TipTap v2 requires this to opt-in to render in non-React shells; in
    // Next.js 14 App Router client components it's safe to leave default.
    immediatelyRender: false,
  })

  // Recipient exclusion check — re-run on every email-field change with a
  // small debounce.
  useEffect(() => {
    const candidate = toEmail.trim().toLowerCase()
    if (!candidate || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate)) {
      setRecipientCheck(null)
      return
    }
    const handle = setTimeout(() => {
      fetch(`/api/email/check-recipient?email=${encodeURIComponent(candidate)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data: RecipientCheck | null) => setRecipientCheck(data))
        .catch(() => setRecipientCheck(null))
    }, 300)
    return () => clearTimeout(handle)
  }, [toEmail])

  const handleSend = useCallback(async () => {
    if (!editor) return
    const bodyHtml = editor.getHTML().trim()
    if (!bodyHtml || bodyHtml === '<p></p>') {
      setError('Write something before sending.')
      return
    }
    if (subject.trim().length < 1) {
      setError('Subject is required.')
      return
    }
    if (recipientCheck?.excluded) {
      setError(
        recipientCheck.reason === 'unsubscribed'
          ? 'This contact has unsubscribed — you cannot send to them.'
          : 'Recipient is on your exclusion list — remove from Settings → Email exclusions to send.',
      )
      return
    }

    setSending(true)
    setError(null)

    const payload: EmailSendPayload = {
      contact_id: contactId,
      to_email: toEmail.trim(),
      subject: subject.trim(),
      body_html: bodyHtml,
      tracked,
      source,
    }

    try {
      const res = await fetch('/api/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as EmailSendErrorBody | null
        setError(body?.error ?? `Send failed (${res.status})`)
        setSending(false)
        return
      }
      const result = (await res.json()) as EmailSendResult
      onSent?.(result)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Send failed')
      setSending(false)
    }
  }, [editor, subject, toEmail, tracked, recipientCheck, contactId, source, onSent, onClose])

  const banner = useMemo(() => {
    if (!recipientCheck?.excluded) return null
    if (recipientCheck.reason === 'unsubscribed') {
      return {
        kind: 'destructive' as const,
        icon: ShieldOff,
        text: 'This contact has unsubscribed. You cannot send to them.',
      }
    }
    if (recipientCheck.reason === 'au_default') {
      return {
        kind: 'warning' as const,
        icon: AlertTriangle,
        text: 'On your exclusion list (AU default domain). Update in Settings → Email exclusions.',
      }
    }
    return {
      kind: 'warning' as const,
      icon: AlertTriangle,
      text: 'On your exclusion list. Remove from Settings → Email exclusions to send.',
    }
  }, [recipientCheck])

  return (
    <div
      role="dialog"
      aria-modal
      aria-label="Compose tracked email"
      onClick={(e) => {
        if (e.target === e.currentTarget && !sending) onClose()
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(26,22,18,0.55)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
        padding: 20,
      }}
    >
      <div
        style={{
          background: '#F5F0E8',
          borderRadius: 14,
          width: '100%',
          maxWidth: 640,
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
          overflow: 'hidden',
        }}
      >
        {/* ── Header ── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px',
            borderBottom: '1px solid rgba(140,123,107,0.18)',
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 600 }}>
              Send tracked email
            </h2>
            {contactName && (
              <p style={{ margin: '2px 0 0', fontSize: '0.8rem', color: '#5A4D40' }}>
                to {contactName}
              </p>
            )}
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            disabled={sending}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: sending ? 'not-allowed' : 'pointer',
              color: '#5A4D40',
              padding: 4,
              borderRadius: 6,
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* ── Body ── */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: 20,
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}
        >
          {banner && (
            <div
              style={{
                display: 'flex',
                gap: 8,
                padding: '10px 12px',
                borderRadius: 8,
                fontSize: '0.85rem',
                background:
                  banner.kind === 'destructive'
                    ? 'rgba(196,98,45,0.12)'
                    : 'rgba(181,146,42,0.12)',
                color: banner.kind === 'destructive' ? '#A5511E' : '#8A6A00',
                border:
                  banner.kind === 'destructive'
                    ? '1px solid rgba(196,98,45,0.3)'
                    : '1px solid rgba(181,146,42,0.3)',
              }}
            >
              <banner.icon size={16} style={{ marginTop: 1, flexShrink: 0 }} />
              <span>{banner.text}</span>
            </div>
          )}

          <Field label="To">
            <input
              type="email"
              value={toEmail}
              onChange={(e) => setToEmail(e.target.value)}
              placeholder="recipient@example.com"
              style={fieldInputStyle}
              disabled={sending}
            />
          </Field>

          <Field label="Subject">
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="A short, specific subject line"
              maxLength={200}
              style={fieldInputStyle}
              disabled={sending}
            />
          </Field>

          <Field label="Message">
            {editor && (
              <>
                <EditorToolbar editor={editor} disabled={sending} />
                <div style={editorWrapperStyle}>
                  <EditorContent editor={editor} />
                </div>
              </>
            )}
          </Field>

          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: '0.85rem',
              color: '#5A4D40',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={tracked}
              onChange={(e) => setTracked(e.target.checked)}
              disabled={sending}
            />
            Tracking on{' '}
            <span style={{ color: '#8C7B6B', fontSize: '0.8rem' }}>
              (pixel + link rewriting; uncheck for plain send)
            </span>
          </label>

          {error && (
            <p
              style={{
                fontSize: '0.85rem',
                color: '#A5511E',
                margin: 0,
              }}
              role="alert"
            >
              {error}
            </p>
          )}
        </div>

        {/* ── Footer ── */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 10,
            padding: '14px 20px',
            borderTop: '1px solid rgba(140,123,107,0.18)',
            background: '#FAF5EE',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={sending}
            style={secondaryBtnStyle}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSend}
            disabled={sending || recipientCheck?.excluded === true}
            style={primaryBtnStyle}
          >
            {sending ? (
              <>
                <Loader2 size={14} className="animate-spin" /> Sending…
              </>
            ) : (
              'Send'
            )}
          </button>
        </div>
      </div>

      <style jsx global>{`
        .tracked-email-editor-content {
          min-height: 160px;
          outline: none;
          font-family: var(--font-body), system-ui, sans-serif;
          font-size: 0.95rem;
          line-height: 1.55;
          color: #1A1612;
        }
        .tracked-email-editor-content p { margin: 0 0 0.6em; }
        .tracked-email-editor-content p:last-child { margin-bottom: 0; }
        .tracked-email-editor-content ul,
        .tracked-email-editor-content ol { padding-left: 1.2em; margin: 0 0 0.6em; }
        .tracked-email-editor-content a { color: #C4622D; text-decoration: underline; }
        .tracked-email-editor-content:focus { outline: none; }
      `}</style>
    </div>
  )
}

// ── UI primitives ───────────────────────────────────────────────────────────

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: '0.8rem', color: '#5A4D40', fontWeight: 500 }}>
        {label}
      </span>
      {children}
    </label>
  )
}

function EditorToolbar({ editor, disabled }: { editor: Editor; disabled: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 4,
        padding: '6px 8px',
        background: '#FFFFFF',
        border: '1.5px solid rgba(140,123,107,0.18)',
        borderBottom: 'none',
        borderTopLeftRadius: 8,
        borderTopRightRadius: 8,
      }}
    >
      <ToolbarBtn
        onClick={() => editor.chain().focus().toggleBold().run()}
        active={editor.isActive('bold')}
        disabled={disabled}
        label="Bold"
      >
        <Bold size={14} />
      </ToolbarBtn>
      <ToolbarBtn
        onClick={() => editor.chain().focus().toggleItalic().run()}
        active={editor.isActive('italic')}
        disabled={disabled}
        label="Italic"
      >
        <Italic size={14} />
      </ToolbarBtn>
      <ToolbarBtn
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        active={editor.isActive('bulletList')}
        disabled={disabled}
        label="Bullet list"
      >
        <List size={14} />
      </ToolbarBtn>
      <ToolbarBtn
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        active={editor.isActive('orderedList')}
        disabled={disabled}
        label="Numbered list"
      >
        <ListOrdered size={14} />
      </ToolbarBtn>
      <ToolbarBtn
        onClick={() => {
          const previousUrl = editor.getAttributes('link').href as string | undefined
          const url = window.prompt('URL', previousUrl ?? 'https://')
          if (url === null) return
          if (url === '') {
            editor.chain().focus().extendMarkRange('link').unsetLink().run()
            return
          }
          editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
        }}
        active={editor.isActive('link')}
        disabled={disabled}
        label="Insert link"
      >
        <LinkIcon size={14} />
      </ToolbarBtn>
    </div>
  )
}

function ToolbarBtn({
  onClick,
  active,
  disabled,
  label,
  children,
}: {
  onClick: () => void
  active: boolean
  disabled: boolean
  label: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      disabled={disabled}
      style={{
        background: active ? 'rgba(196,98,45,0.12)' : 'transparent',
        border: 'none',
        padding: '4px 6px',
        borderRadius: 4,
        cursor: disabled ? 'not-allowed' : 'pointer',
        color: active ? '#A5511E' : '#5A4D40',
        display: 'inline-flex',
        alignItems: 'center',
      }}
    >
      {children}
    </button>
  )
}

// ── Styles ──────────────────────────────────────────────────────────────────

const fieldInputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  fontSize: '0.95rem',
  fontFamily: 'inherit',
  background: '#FFFFFF',
  border: '1.5px solid rgba(140,123,107,0.18)',
  borderRadius: 8,
  outline: 'none',
  color: '#1A1612',
}

const editorWrapperStyle: React.CSSProperties = {
  padding: '10px 12px',
  background: '#FFFFFF',
  border: '1.5px solid rgba(140,123,107,0.18)',
  borderBottomLeftRadius: 8,
  borderBottomRightRadius: 8,
}

const primaryBtnStyle: React.CSSProperties = {
  background: '#C4622D',
  color: '#FFFFFF',
  border: 'none',
  borderRadius: 8,
  padding: '8px 16px',
  fontSize: '0.9rem',
  fontWeight: 600,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
}

const secondaryBtnStyle: React.CSSProperties = {
  background: 'transparent',
  color: '#5A4D40',
  border: '1.5px solid rgba(140,123,107,0.25)',
  borderRadius: 8,
  padding: '8px 16px',
  fontSize: '0.9rem',
  fontWeight: 500,
  cursor: 'pointer',
}
