import { RefreshCw } from 'lucide-react'

/**
 * LiveViewStrip — the v2 "this list is computed live" banner shown atop a
 * built-in list's detail page (HOR-248). Built-in lists (Watch closely /
 * Warming up) have no stored membership — Horace recomputes them from the
 * intent score on every page load, so the strip sets that expectation +
 * stamps the refresh time. Saved-views + manual lists don't render it.
 */
export function LiveViewStrip({ refreshedAt }: { refreshedAt: Date }) {
  const stamp = refreshedAt.toLocaleTimeString('en-AU', {
    hour: 'numeric',
    minute: '2-digit',
  })
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 14px',
        marginBottom: 14,
        background: 'rgba(196,98,45,0.06)',
        border: '1px solid rgba(196,98,45,0.18)',
        borderRadius: 8,
        fontSize: 12,
        color: '#5E5246',
      }}
    >
      <RefreshCw style={{ width: 13, height: 13, color: '#C4622D', flexShrink: 0 }} aria-hidden />
      <span>
        <strong style={{ color: '#A85220', fontWeight: 600 }}>Live view</strong> — Horace recomputes
        this every page load
      </span>
      <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 11, color: '#8C7B6B' }}>
        last refresh {stamp}
      </span>
    </div>
  )
}
