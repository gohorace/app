'use client'

/**
 * HOR-410 — top-level "Add property" entry point for the (read-only)
 * Properties reference table. The reference table itself stays read-only
 * by design; this button is a sibling affordance that mounts the
 * existing AddPropertyModal.
 *
 * The modal resolves the address through resolve_residence_property, so
 * an address G-NAF doesn't carry (new development, off-market, rural,
 * unpublished subdivision) is still addable — via Google autocomplete or
 * the modal's manual structured-field fallback — and lands as a property
 * with gnaf_address_detail_pid = NULL. On success we route to the new
 * property's detail page.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import { AddPropertyModal } from './add-property-modal'

export function AddPropertyButton() {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '7px 13px',
          borderRadius: 7,
          background: '#1A1612',
          color: '#FAF7F2',
          fontSize: 12.5,
          fontWeight: 500,
          border: '1px solid #1A1612',
          cursor: 'pointer',
          fontFamily: 'var(--font-body)',
        }}
      >
        <Plus style={{ width: 14, height: 14 }} />
        Add property
      </button>

      {open && (
        <AddPropertyModal
          onClose={() => setOpen(false)}
          onComplete={(id) => {
            setOpen(false)
            router.push(`/properties/${id}`)
          }}
        />
      )}
    </>
  )
}
