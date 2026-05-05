'use client'

import { useRouter, usePathname } from 'next/navigation'

const FILTERS = [
  { id: 'all',  label: 'All' },
  { id: 'high', label: 'High intent' },
  { id: 'mid',  label: 'Mid intent' },
  { id: 'low',  label: 'Watching' },
]

export function SignalFilters({ active }: { active: string }) {
  const router   = useRouter()
  const pathname = usePathname()

  function setFilter(id: string) {
    const params = id === 'all' ? '' : `?filter=${id}`
    router.push(`${pathname}${params}`)
  }

  return (
    <div style={{ display: 'flex', gap: '6px' }}>
      {FILTERS.map(f => {
        const isActive = f.id === active
        return (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            style={{
              padding: '5px 14px',
              borderRadius: '9999px',
              fontSize: '12px',
              fontWeight: 500,
              fontFamily: 'var(--font-body)',
              cursor: 'pointer',
              transition: 'all 180ms',
              border: isActive ? '1px solid #1A1612' : '1px solid transparent',
              background: isActive ? '#1A1612' : 'rgba(140,123,107,0.08)',
              color: isActive ? '#FAF7F2' : '#8C7B6B',
            }}
          >
            {f.label}
          </button>
        )
      })}
    </div>
  )
}
