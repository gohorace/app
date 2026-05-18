/**
 * HOR-204 — Public capture URL with copy-to-clipboard.
 *
 * Small client component rendered inside the server-rendered inspection
 * detail page (apps/web/src/app/(dashboard)/inspections/[id]/page.tsx).
 * Lifted out of the page so the page can stay a server component while
 * the Copy button gets its required clipboard API access.
 *
 * Visual styling matches the surrounding inline-styled detail page
 * (cream box, mono URL) so it slots in without restyling neighbours.
 */

'use client'

import { useState } from 'react'
import { Copy } from 'lucide-react'

export function ShareLinkBlock({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Older browsers / blocked clipboard — silently no-op. The URL is
      // still selectable, so the user can fall back to manual select+copy.
    }
  }

  return (
    <div
      style={{
        marginTop: 16,
        padding: '12px 14px',
        background: '#FAF7F2',
        border: '1px solid rgba(140,123,107,0.15)',
        borderRadius: 8,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: 6,
          gap: 12,
        }}
      >
        <div style={{ fontSize: 11, color: '#8C7B6B' }}>Or share the link directly:</div>
        <button
          type="button"
          onClick={handleCopy}
          style={{
            background: copied ? '#C4622D' : 'transparent',
            color: copied ? '#FFFDF8' : '#5E5246',
            border: '1px solid',
            borderColor: copied ? '#C4622D' : 'rgba(140,123,107,0.4)',
            borderRadius: 6,
            padding: '4px 10px',
            fontSize: 11,
            fontWeight: 500,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            transition: 'all 160ms ease-out',
          }}
        >
          <Copy size={11} strokeWidth={2.25} />
          {copied ? 'Copied' : 'Copy link'}
        </button>
      </div>
      <code
        style={{
          fontSize: 12,
          fontFamily: 'var(--font-mono)',
          color: '#3D332B',
          wordBreak: 'break-all',
        }}
      >
        {url}
      </code>
    </div>
  )
}
