'use client'

import { useCompanion } from '@/components/companion/companion-context'
import { QuillIcon } from '@/components/ui/quill-icon'

/**
 * Ask Horace — topbar button on /inspections (HOR-249). Opens the
 * companion pre-prompted to set up an inspection; the companion's
 * `respondTo` matches "set up an inspection" and returns a
 * `create-inspection` ActionConfirm card.
 */
export function InspectionsAskHorace() {
  const { openCompanion } = useCompanion()
  return (
    <button
      type="button"
      onClick={() =>
        openCompanion({
          prompt: 'Help me set up an inspection',
          contextLabel: 'Inspections',
        })
      }
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '10px 14px',
        fontSize: 13,
        fontWeight: 500,
        background: '#FAF7F2',
        color: '#5E5246',
        border: '1px solid rgba(140,123,107,0.3)',
        borderRadius: 6,
        cursor: 'pointer',
        fontFamily: 'var(--font-body)',
        whiteSpace: 'nowrap',
      }}
    >
      <QuillIcon style={{ width: 14, height: 14 }} color="#A85220" />
      Ask Horace
    </button>
  )
}
