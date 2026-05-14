/**
 * Sticky bucket header (TODAY / YESTERDAY / THIS WEEK / EARLIER). The
 * count chip on the right shows how many moments fall in that bucket.
 * Empty buckets do not render at all — the page-level grouping skips
 * them rather than showing "no notifications today" placeholders.
 */
export function SectionHead({ children, count }: { children: React.ReactNode; count?: number }) {
  return (
    <div
      style={{
        padding: '18px 16px 8px',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: '#8C7B6B',
        background: '#F5F0E8',
        position: 'sticky',
        top: 0,
        zIndex: 2,
      }}
    >
      <span>{children}</span>
      {count != null && (
        <span
          style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: 10,
            background: 'rgba(140,123,107,0.15)',
            color: '#5A4D40',
            padding: '1px 6px',
            borderRadius: 9999,
            letterSpacing: 0,
          }}
        >
          {count}
        </span>
      )}
    </div>
  )
}
