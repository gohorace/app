'use client'

import { ArrowUpRight, X } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import type {
  CompanionAction,
  CompanionMessage,
  HoraceMessage,
} from '@/lib/companion/types'
import {
  emptyConversation,
  initialMessages,
  respond,
  suggestedPrompts,
} from '@/lib/companion/respond'
import { ActionConfirm } from './action-confirm'

/**
 * CompanionDrawer — the right-anchored 460px panel that hosts the
 * Horace conversation. Header (charcoal), messages, suggested prompts
 * (when conversation is empty), composer.
 *
 * v2.0 brain is the pattern-matched `respond()` mock — see
 * `lib/companion/respond.ts`. The drawer pretends Horace is "typing"
 * with a 600ms delay before the response shows up, matching the
 * prototype's pacing.
 *
 * Open / close is owned by the parent (`CompanionMount`). The drawer
 * stays mounted while closed (display: none) so animation state and
 * scroll position survive close-then-reopen-quickly. The header X +
 * Escape both fire `onClose`; the parent decides whether to clear the
 * conversation or keep it for the session.
 */

export interface ActionAck {
  /** System-pill text to surface in the thread after the action lands. */
  text: string
  /** Whether the backend call succeeded. ok=false still renders a pill —
   *  the wording itself differs (soft "didn't save" copy). */
  ok: boolean
}

interface CompanionDrawerProps {
  open: boolean
  contextLabel: string | undefined
  /** Latest prompt from `openCompanion(...)`. Re-keyed on `openToken`. */
  prompt: string | undefined
  openToken: number
  onClose: () => void
  onAction: (action: CompanionAction) => Promise<ActionAck>
}

export function CompanionDrawer({
  open,
  contextLabel,
  prompt,
  openToken,
  onClose,
  onAction,
}: CompanionDrawerProps) {
  const [messages, setMessages] = useState<CompanionMessage[]>(() =>
    prompt ? initialMessages(prompt, contextLabel) : emptyConversation(contextLabel),
  )
  const [input, setInput] = useState('')
  const [pendingAction, setPendingAction] = useState<CompanionAction | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  // Reset conversation whenever the agent opens the drawer fresh. The
  // openToken changes on every `openCompanion` call, so even identical
  // (prompt, contextLabel) re-keys the thread — matches prototype UX.
  useEffect(() => {
    if (!open) return
    setPendingAction(null)
    if (prompt) {
      setMessages(initialMessages(prompt, contextLabel))
      const t = window.setTimeout(() => {
        const reply = respond(prompt, contextLabel)
        setMessages((m) => [...m, reply])
        if (reply.action) setPendingAction(reply.action)
      }, 600)
      return () => window.clearTimeout(t)
    } else {
      setMessages(emptyConversation(contextLabel))
    }
  }, [open, openToken, prompt, contextLabel])

  // Scroll to bottom whenever messages change or the action card appears.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, pendingAction])

  // Esc closes (only when open).
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  function send(text: string) {
    const trimmed = text.trim()
    if (!trimmed) return
    setMessages((m) => [...m, { kind: 'agent', text: trimmed }])
    setInput('')
    window.setTimeout(() => {
      const reply = respond(trimmed, contextLabel)
      setMessages((m) => [...m, reply])
      if (reply.action) setPendingAction(reply.action)
    }, 600)
  }

  async function confirm(action: CompanionAction) {
    setPendingAction(null)
    const ack = await onAction(action)
    setMessages((m) => [...m, { kind: 'system', text: ack.text }])
  }

  if (!open) return null

  const conversationIsEmpty = messages.length <= 2 && !pendingAction

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 150,
        pointerEvents: 'none',
      }}
    >
      <aside
        role="dialog"
        aria-label="Ask Horace"
        className="flex flex-col w-full md:w-[460px]"
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          background: '#FAF7F2',
          borderLeft: '1px solid rgba(140,123,107,0.25)',
          boxShadow: 'var(--shadow-xl)',
          pointerEvents: 'auto',
          animation: 'drawer-slide-in 320ms var(--ease-out)',
        }}
      >
        {/* Header — charcoal */}
        <header
          style={{
            padding: '16px 18px 14px',
            background: '#2E2823',
            color: '#F5F0E8',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flexShrink: 0,
          }}
        >
          <Image
            src="/horace-charcoal.png"
            alt=""
            width={36}
            height={36}
            style={{
              borderRadius: '50%',
              background: '#1A1612',
              flexShrink: 0,
            }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h2
                className="font-display"
                style={{
                  fontSize: 17,
                  fontWeight: 600,
                  color: '#F5F0E8',
                  letterSpacing: '-0.015em',
                  margin: 0,
                }}
              >
                Horace
              </h2>
              <span
                aria-hidden
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: '#3DA361',
                  animation: 'pulse-dot 2.2s infinite',
                }}
              />
              <span style={{ fontSize: 10.5, color: 'rgba(245,240,232,0.55)' }}>online</span>
            </div>
            {contextLabel && (
              <div
                style={{
                  fontSize: 11,
                  color: 'rgba(245,240,232,0.55)',
                  marginTop: 2,
                  fontFamily: 'var(--font-mono)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                Context · {contextLabel}
              </div>
            )}
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            style={{
              width: 28,
              height: 28,
              borderRadius: 7,
              background: 'rgba(245,240,232,0.08)',
              border: 'none',
              color: 'rgba(245,240,232,0.7)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              padding: 0,
            }}
          >
            <X size={14} />
          </button>
        </header>

        {/* Messages */}
        <div
          ref={scrollRef}
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '18px 18px 8px',
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}
        >
          {messages.map((m, i) => (
            <MessageBubble key={i} message={m} />
          ))}
          {pendingAction && (
            <ActionConfirm
              action={pendingAction}
              onConfirm={() => confirm(pendingAction)}
              onCancel={() => setPendingAction(null)}
            />
          )}
        </div>

        {/* Suggested prompts — visible when conversation is essentially empty */}
        {conversationIsEmpty && (
          <div
            style={{
              padding: '4px 18px 12px',
              display: 'flex',
              flexWrap: 'wrap',
              gap: 6,
              flexShrink: 0,
            }}
          >
            {suggestedPrompts(contextLabel).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => send(p)}
                style={{
                  padding: '6px 11px',
                  fontSize: 11.5,
                  fontWeight: 500,
                  background: '#FAF7F2',
                  color: '#5E5246',
                  border: '1px solid rgba(140,123,107,0.25)',
                  borderRadius: 999,
                  cursor: 'pointer',
                  fontFamily: 'var(--font-body)',
                }}
              >
                {p}
              </button>
            ))}
          </div>
        )}

        {/* Composer */}
        <div
          style={{
            padding: '12px 18px 16px',
            borderTop: '1px solid rgba(140,123,107,0.18)',
            background: 'rgba(245,240,232,0.65)',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-end',
              gap: 8,
              padding: '10px 12px',
              background: '#FFFFFF',
              border: '1px solid rgba(140,123,107,0.25)',
              borderRadius: 10,
              transition: 'border-color 120ms var(--ease-out)',
            }}
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  send(input)
                }
              }}
              placeholder="Ask Horace…"
              rows={1}
              aria-label="Message Horace"
              style={{
                flex: 1,
                resize: 'none',
                background: 'transparent',
                border: 'none',
                outline: 'none',
                fontSize: 13.5,
                color: '#1A1612',
                fontFamily: 'var(--font-body)',
                lineHeight: 1.5,
                maxHeight: 100,
              }}
            />
            <button
              type="button"
              onClick={() => send(input)}
              disabled={!input.trim()}
              aria-label="Send"
              style={{
                width: 28,
                height: 28,
                borderRadius: 7,
                background: input.trim() ? '#C4622D' : 'rgba(140,123,107,0.15)',
                border: 'none',
                color: input.trim() ? '#FAF7F2' : '#8C7B6B',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: input.trim() ? 'pointer' : 'default',
                padding: 0,
                transition: 'background 120ms',
              }}
            >
              <ArrowUpRight size={13} />
            </button>
          </div>
          <div
            style={{
              marginTop: 8,
              fontSize: 10.5,
              color: '#8C7B6B',
              display: 'flex',
              justifyContent: 'space-between',
              fontFamily: 'var(--font-mono)',
            }}
          >
            <span>⏎ to send · shift⏎ for newline</span>
            <span>esc to close</span>
          </div>
        </div>
      </aside>
    </div>
  )
}

// ── Message bubble ──────────────────────────────────────────────────────────

function MessageBubble({ message }: { message: CompanionMessage }) {
  if (message.kind === 'agent') {
    return (
      <div style={{ alignSelf: 'flex-end', maxWidth: '85%' }}>
        <div
          style={{
            padding: '10px 14px',
            background: '#1A1612',
            color: '#F5F0E8',
            borderRadius: '14px 14px 4px 14px',
            fontSize: 13.5,
            lineHeight: 1.5,
            fontFamily: 'var(--font-body)',
          }}
        >
          {message.text}
        </div>
        <div
          style={{
            fontSize: 10,
            color: '#8C7B6B',
            marginTop: 3,
            textAlign: 'right',
            fontFamily: 'var(--font-mono)',
          }}
        >
          You · just now
        </div>
      </div>
    )
  }

  if (message.kind === 'system') {
    return (
      <div
        style={{
          alignSelf: 'center',
          padding: '8px 14px',
          background: 'rgba(61,82,70,0.1)',
          color: '#3D5246',
          borderRadius: 999,
          fontSize: 11.5,
          fontWeight: 500,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          fontFamily: 'var(--font-body)',
        }}
      >
        {/* Simple ✓ glyph — keeps the chip noise-free at small sizes. */}
        <span aria-hidden style={{ fontSize: 11, lineHeight: 1 }}>
          ✓
        </span>{' '}
        {message.text}
      </div>
    )
  }

  return <HoraceBubble message={message} />
}

function HoraceBubble({ message }: { message: HoraceMessage }) {
  return (
    <div style={{ alignSelf: 'flex-start', maxWidth: '90%' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <Image
          src="/horace-parchment.png"
          alt=""
          width={28}
          height={28}
          style={{ borderRadius: '50%', flexShrink: 0, marginTop: 2 }}
        />
        <div style={{ flex: 1 }}>
          <div
            style={{
              padding: '10px 14px',
              background: '#FAF7F2',
              border: '1px solid rgba(140,123,107,0.2)',
              borderRadius: '14px 14px 14px 4px',
              color: '#1A1612',
            }}
          >
            <p
              style={{
                margin: 0,
                fontSize: 13.5,
                lineHeight: 1.55,
                fontFamily: 'var(--font-body)',
              }}
            >
              {message.text}
            </p>
            {message.italics && (
              <p
                className="horace-nudge"
                style={{ marginTop: 8, fontSize: 13.5, color: '#2E2823' }}
              >
                {message.italics}
              </p>
            )}
            {message.references && message.references.length > 0 && (
              <div
                style={{
                  marginTop: 10,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  paddingTop: 10,
                  borderTop: '1px solid rgba(140,123,107,0.18)',
                }}
              >
                {message.references.map((ref) => (
                  <Link
                    key={ref.route}
                    href={ref.route}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      fontSize: 11.5,
                      color: '#A85220',
                      textDecoration: 'none',
                      fontWeight: 500,
                    }}
                  >
                    <ArrowUpRight size={11} aria-hidden /> {ref.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
          <div
            style={{
              fontSize: 10,
              color: '#8C7B6B',
              marginTop: 3,
              fontFamily: 'var(--font-mono)',
            }}
          >
            Horace · 1s
          </div>
        </div>
      </div>
    </div>
  )
}
