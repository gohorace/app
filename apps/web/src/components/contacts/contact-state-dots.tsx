'use client'

import type { IdentityState } from '@/lib/design/badges'

/**
 * ContactStateDots — the compact four-dot identity indicator for the v2
 * contacts row (HOR-246). Replaces the v1 identity gradient pill inline
 * with the name.
 *
 * Maps the codebase's four-tier `IdentityState` onto the prototype's
 * dot fill:
 *   - known / partial → 4 terracotta dots (the agent has them in the book)
 *   - email           → 2 stone dots (contactable but anon-named)
 *   - anonymous       → 0 filled dots (tracked by device only)
 *
 * `newlyKnown` bumps the title copy to "Newly known" — the dots stay
 * terracotta-4 (a freshly resolved contact reads as fully known).
 */

interface ContactStateDotsProps {
  identity: IdentityState
  /** When true, the tooltip reads "Newly known". */
  newlyKnown?: boolean
}

const FILL: Record<IdentityState, { count: number; color: string; title: string }> = {
  known:     { count: 4, color: '#C4622D', title: 'Known' },
  partial:   { count: 4, color: '#C4622D', title: 'Identified' },
  email:     { count: 2, color: '#8C7B6B', title: 'Email only' },
  anonymous: { count: 0, color: '#8C7B6B', title: 'Anonymous' },
}

export function ContactStateDots({ identity, newlyKnown = false }: ContactStateDotsProps) {
  const m = FILL[identity]
  const title = newlyKnown && (identity === 'known' || identity === 'partial')
    ? 'Newly known'
    : m.title
  return (
    <span
      title={title}
      aria-label={title}
      style={{ display: 'inline-flex', gap: 2, alignItems: 'center', flexShrink: 0 }}
    >
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          style={{
            width: 4,
            height: 4,
            borderRadius: '50%',
            background: i < m.count ? m.color : 'rgba(140,123,107,0.25)',
          }}
        />
      ))}
    </span>
  )
}
