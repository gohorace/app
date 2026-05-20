'use client'

import { QuillIcon } from '@/components/ui/quill-icon'

/**
 * CompanionTrigger — pinned bottom-right launcher for the Horace
 * companion drawer. Ships only the prototype's `quill` variant per the
 * v2 plan (pill / bust were design A/B options, discarded).
 *
 * Visual: 50px ink circle, 18px ember Quill icon, soft shadow that
 * lifts on hover. Hidden while the drawer is open — see CompanionMount.
 */

interface CompanionTriggerProps {
  onClick: () => void
}

export function CompanionTrigger({ onClick }: CompanionTriggerProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="companion-trigger focus:outline-none focus-visible:ring-2 focus-visible:ring-[#C4622D]"
      aria-label="Ask Horace"
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        zIndex: 100,
        width: 50,
        height: 50,
        background: '#1A1612',
        color: '#FAF7F2',
        border: 'none',
        borderRadius: '50%',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: 'var(--shadow-md)',
        transition: 'box-shadow 180ms var(--ease-out), transform 180ms',
      }}
    >
      <QuillIcon size={18} color="#E8956D" strokeWidth={1.75} />
    </button>
  )
}
