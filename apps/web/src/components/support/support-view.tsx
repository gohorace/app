'use client'

import Image from 'next/image'
import Link from 'next/link'
import { ArrowUpRight, Calendar, Mail, MessageCircle } from 'lucide-react'
import { useCompanion } from '@/components/companion/companion-context'
import { QuillIcon } from '@/components/ui/quill-icon'
import { BellButton } from '@/components/dashboard/bell-button'
import {
  SUPPORT_CHANNELS,
  SUPPORT_GUIDES,
  SUPPORT_STATUS,
  type SupportChannelDef,
} from '@/lib/support/status'

/**
 * SupportView — the v2 /support surface (HOR-251). Topbar with Ask Horace
 * CTA, charcoal "Start here" hero, two-column Guides × Talk-to-a-human
 * grid, and a moss status strip. Static config from lib/support/status.ts;
 * a live status feed is HOR-261 (v2-D8).
 */

const CHANNEL_ICON = {
  mail: Mail,
  chat: MessageCircle,
  calendar: Calendar,
} as const

export function SupportView({ attentionCount }: { attentionCount: number }) {
  const { openCompanion } = useCompanion()
  const askHorace = () => openCompanion({ contextLabel: 'Support' })

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '28px 32px 80px' }}>
      <div style={{ maxWidth: 1080 }}>
        {/* Topbar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 16,
            marginBottom: 22,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 11,
                fontWeight: 500,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: '#8C7B6B',
                marginBottom: 8,
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#C4622D' }} />
              Account · Help &amp; support
            </div>
            <h1
              className="font-display"
              style={{ margin: 0, fontSize: 32, fontWeight: 600, letterSpacing: '-0.02em', color: '#1A1612' }}
            >
              Support
            </h1>
            <p style={{ margin: '6px 0 0', fontSize: 13, color: '#8C7B6B', maxWidth: 560, lineHeight: 1.5 }}>
              Help guides, contact the team, or ask Horace anything — first stop is usually the quill.
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <button
              type="button"
              onClick={askHorace}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '9px 14px',
                background: '#C4622D',
                color: '#FAF7F2',
                border: 'none',
                borderRadius: 7,
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
                fontFamily: 'var(--font-body)',
                whiteSpace: 'nowrap',
              }}
            >
              <QuillIcon style={{ width: 13, height: 13 }} />
              Ask Horace
            </button>
            <BellButton attentionCount={attentionCount} />
          </div>
        </div>

        {/* Hero — Start here */}
        <div
          style={{
            padding: '24px 26px',
            background: '#2E2823',
            color: '#F5F0E8',
            borderRadius: 14,
            marginBottom: 22,
            display: 'flex',
            gap: 18,
            alignItems: 'center',
          }}
        >
          <Image
            src="/horace-charcoal.png"
            alt=""
            width={56}
            height={56}
            style={{ borderRadius: '50%', background: '#1A1612', flexShrink: 0 }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: 'rgba(245,240,232,0.55)',
                marginBottom: 6,
              }}
            >
              Start here
            </div>
            <p
              className="font-display"
              style={{
                margin: 0,
                fontStyle: 'italic',
                fontSize: 18,
                lineHeight: 1.5,
                color: 'rgba(245,240,232,0.95)',
                letterSpacing: '-0.005em',
              }}
            >
              Most questions resolve in one go. Ask the quill — I&rsquo;ll either answer, or hand it to the team.
            </p>
          </div>
          <button
            type="button"
            onClick={askHorace}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '10px 16px',
              background: '#C4622D',
              color: '#FAF7F2',
              border: 'none',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
              fontFamily: 'var(--font-body)',
              flexShrink: 0,
            }}
          >
            <QuillIcon style={{ width: 13, height: 13 }} />
            Open Horace
          </button>
        </div>

        {/* Two-column grid — collapses to a single column on narrow viewports
            (auto-fit + min() avoids each column crushing to ~146px on mobile). */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(260px, 100%), 1fr))', gap: 18 }}>
          {/* Guides */}
          <section style={panelStyle}>
            <h2 style={panelHeadingStyle}>Guides</h2>
            <p style={panelSubStyle}>How Horace thinks — in your own time.</p>
            {SUPPORT_GUIDES.map((g, i) => (
              <Link
                key={g.title}
                href={g.href}
                className="settings-nav-row"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px 0',
                  borderBottom: i === SUPPORT_GUIDES.length - 1 ? 'none' : '1px solid rgba(140,123,107,0.12)',
                  textDecoration: 'none',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: '#1A1612' }}>{g.title}</div>
                  <div style={{ fontSize: 11.5, color: '#8C7B6B', marginTop: 2 }}>{g.sub}</div>
                </div>
                <ArrowUpRight style={{ width: 13, height: 13, color: '#8C7B6B', flexShrink: 0 }} aria-hidden />
              </Link>
            ))}
          </section>

          {/* Talk to a human */}
          <section style={panelStyle}>
            <h2 style={panelHeadingStyle}>Talk to a human</h2>
            <p style={panelSubStyle}>When the quill isn&rsquo;t enough.</p>
            {SUPPORT_CHANNELS.map((c, i) => (
              <SupportChannel key={c.title} channel={c} isLast={i === SUPPORT_CHANNELS.length - 1} />
            ))}
          </section>
        </div>

        {/* Status strip */}
        <div
          style={{
            marginTop: 22,
            padding: '14px 20px',
            background: 'rgba(61,82,70,0.08)',
            border: '1px solid rgba(61,82,70,0.18)',
            borderRadius: 10,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <span
            aria-hidden
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: '#3D5246',
              animation: 'pulse-dot 2.2s infinite',
              flexShrink: 0,
            }}
          />
          <span style={{ fontSize: 13, color: '#1A1612', fontWeight: 500 }}>{SUPPORT_STATUS.headline}</span>
          <span
            className="font-display"
            style={{ fontSize: 12, color: '#5E5246', fontStyle: 'italic' }}
          >
            {SUPPORT_STATUS.detail}
          </span>
          <a
            href={SUPPORT_STATUS.pageUrl}
            target="_blank"
            rel="noreferrer"
            style={{ marginLeft: 'auto', fontSize: 11.5, color: '#3D5246', fontWeight: 500, textDecoration: 'none' }}
          >
            status.gohorace.com ↗
          </a>
        </div>
      </div>
    </div>
  )
}

function SupportChannel({ channel, isLast }: { channel: SupportChannelDef; isLast: boolean }) {
  const Icon = CHANNEL_ICON[channel.icon]
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 0',
        borderBottom: isLast ? 'none' : '1px solid rgba(140,123,107,0.12)',
      }}
    >
      <span
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          background: 'rgba(140,123,107,0.12)',
          color: '#5E5246',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <Icon style={{ width: 14, height: 14 }} aria-hidden />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: '#1A1612' }}>{channel.title}</div>
        <div style={{ fontSize: 11.5, color: '#8C7B6B', marginTop: 2, lineHeight: 1.4 }}>{channel.sub}</div>
      </div>
      <a
        href={channel.href}
        {...(channel.external ? { target: '_blank', rel: 'noreferrer' } : {})}
        style={{
          padding: '6px 12px',
          fontSize: 11.5,
          fontWeight: 500,
          color: '#1A1612',
          background: 'transparent',
          border: '1px solid rgba(140,123,107,0.3)',
          borderRadius: 7,
          textDecoration: 'none',
          whiteSpace: 'nowrap',
          flexShrink: 0,
        }}
      >
        {channel.cta}
      </a>
    </div>
  )
}

const panelStyle: React.CSSProperties = {
  background: '#FAF7F2',
  border: '1px solid rgba(140,123,107,0.2)',
  borderRadius: 12,
  padding: '20px 22px',
}
const panelHeadingStyle: React.CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontSize: 18,
  fontWeight: 600,
  color: '#1A1612',
  letterSpacing: '-0.015em',
  margin: '0 0 4px',
}
const panelSubStyle: React.CSSProperties = {
  fontSize: 12.5,
  color: '#8C7B6B',
  margin: '0 0 14px',
}
