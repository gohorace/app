'use client'

import { useState, useRef, useEffect } from 'react'
import { MapPin, Pencil, Check, X } from 'lucide-react'

interface PropertyAddressProps {
  contactId: string
  initial: string | null
}

export function PropertyAddress({ contactId, initial }: PropertyAddressProps) {
  const [address, setAddress]   = useState(initial ?? '')
  const [editing, setEditing]   = useState(false)
  const [draft, setDraft]       = useState(address)
  const [saving, setSaving]     = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  async function save() {
    if (draft === address) { setEditing(false); return }
    setSaving(true)
    try {
      await fetch(`/api/contacts/${contactId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ property_address: draft.trim() || null }),
      })
      setAddress(draft.trim())
    } finally {
      setSaving(false)
      setEditing(false)
    }
  }

  function cancel() {
    setDraft(address)
    setEditing(false)
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter')  save()
    if (e.key === 'Escape') cancel()
  }

  if (editing) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <MapPin style={{ width: '14px', height: '14px', color: '#C4622D', flexShrink: 0 }} />
        <input
          ref={inputRef}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Enter property address"
          style={{
            flex: 1,
            fontSize: '13px',
            color: '#1A1612',
            background: 'rgba(196,98,45,0.05)',
            border: '1px solid rgba(196,98,45,0.3)',
            borderRadius: '5px',
            padding: '4px 8px',
            outline: 'none',
          }}
        />
        <button
          onClick={save}
          disabled={saving}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', color: '#3D5246', lineHeight: 0 }}
          title="Save"
        >
          <Check style={{ width: '14px', height: '14px' }} />
        </button>
        <button
          onClick={cancel}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', color: '#8C7B6B', lineHeight: 0 }}
          title="Cancel"
        >
          <X style={{ width: '14px', height: '14px' }} />
        </button>
      </div>
    )
  }

  return (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}
      onClick={() => { setDraft(address); setEditing(true) }}
      title="Click to edit"
      className="group"
    >
      <MapPin style={{
        width: '14px', height: '14px', flexShrink: 0,
        color: address ? '#C4622D' : '#8C7B6B',
      }} />
      <span style={{
        fontSize: '13px',
        color: address ? '#1A1612' : '#8C7B6B',
        fontStyle: address ? 'normal' : 'italic',
      }}>
        {address || 'Add property address'}
      </span>
      <Pencil style={{ width: '11px', height: '11px', color: '#8C7B6B', opacity: 0, transition: 'opacity 150ms' }} className="group-hover:opacity-100" />
    </div>
  )
}
